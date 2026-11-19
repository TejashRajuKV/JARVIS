'use strict';

const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createApprovals } = require('./approvals');
const { parseCSV, MAX_BYTES } = require('./csvtools');
const { extractDocText, MAX_FILE } = require('./doctext');

const fold = name => name.normalize('NFC').toLowerCase();
const fingerprint = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':');
const existing = file => fs.lstat(file, { bigint: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';

async function digest(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

function createBatch({ sandbox, safePath, control, power }) {
  const approvals = createApprovals({ ttl: 120000, max: 10 });
  const pending = new Map();
  const root = path.join(sandbox, '.marks-batches');
  let active = null, generation = 0;
  const clear = () => { generation++; active?.abort(); approvals.clear(); pending.clear(); };
  control.onStop(clear);

  async function assertDirectory(dir) {
    const stat = await existing(dir);
    if (!stat?.isDirectory() || stat.isSymbolicLink() || fold(await fs.realpath(dir)) !== fold(path.resolve(dir))) {
      throw new Error('Marks recovery storage must be a regular local directory.');
    }
  }

  async function folder(name) {
    const resolved = safePath(name);
    const parent = resolved && path.relative(sandbox, resolved);
    if (!resolved || !parent || parent === '..' || parent.startsWith('..' + path.sep) || path.isAbsolute(parent) ||
        parent.split(path.sep).some(part => part.startsWith('.')) || !safePath(path.join(resolved, '_marks-check'))) {
      throw new Error('Choose a folder inside JARVIS data, such as Documents or a dedicated project subfolder.');
    }
    const stat = await existing(resolved);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose an existing ordinary folder.');
    return resolved;
  }

  async function prepare({ text, signal, profile }) {
    if (/^batches$/i.test(text)) {
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      if (entries.length) await assertDirectory(root);
      const records = [];
      for (const entry of entries.slice(-30)) {
        if (!entry.isDirectory() || !/^[\da-f-]{36}$/.test(entry.name)) continue;
        try {
          const report = JSON.parse(await fs.readFile(path.join(root, entry.name, 'status.json'), 'utf8'));
          records.push(`${entry.name} · ${report.status} · ${report.completed}/${report.total}`);
        } catch { records.push(`${entry.name} · review interrupted batch`); }
      }
      return { text: records.join('\n') || 'No saved batches.' };
    }
    const undo = /^undo batch ([\da-f-]{36})$/i.exec(text);
    if (undo) return prepareUndo(undo[1], profile.id);
    const quarantine = profile.id === 'mark-44' && /^quarantine files in "([^"\r\n]+)" with extension "(\.[a-z0-9]{1,12})"$/i.exec(text);
    const rename = /^prefix files in "([^"\r\n]+)" with "([\w .-]{1,40})"$/i.exec(text);
    const convert = /^convert documents in "([^"\r\n]+)" to text$/i.exec(text);
    const clean = /^clean csv in "([^"\r\n]+)"$/i.exec(text);
    const operation = quarantine ? 'quarantine' : profile.id === 'mark-44' ? null : rename ? 'rename' : convert ? 'convert' : clean ? 'clean' : null;
    if (!operation && profile.id === 'mark-44') throw new Error('Use quarantine files in "folder" with extension ".ext", batches, or undo batch ID.');
    if (!operation) throw new Error('Use prefix files in "folder" with "prefix", convert documents in "folder" to text, clean CSV in "folder", batches, or undo batch ID.');
    const dir = await folder((quarantine || rename || convert || clean)[1]);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = new Set(entries.map(entry => fold(entry.name)));
    const items = [];
    let required = 0n;
    for (const entry of entries) {
      if (!entry.isFile() || /^[.$]/.test(entry.name)) continue;
      signal.throwIfAborted();
      const source = path.join(dir, entry.name);
      if (!safePath(source) || !/^[^<>:"/\\|?*\x00-\x1f]+$/u.test(entry.name)) continue;
      let target;
      if (quarantine && path.extname(entry.name).toLowerCase() === quarantine[2].toLowerCase()) target = entry.name;
      else if (operation === 'rename') target = rename[2] + entry.name;
      else if (convert && /\.(?:docx|pptx|xlsx)$/i.test(entry.name)) target = entry.name + '.txt';
      else if (clean && /\.csv$/i.test(entry.name) && !/\.clean\.csv$/i.test(entry.name)) target = entry.name.slice(0, -4) + '.clean.csv';
      else continue;
      if (operation !== 'quarantine' && (Buffer.byteLength(target) > 240 || names.has(fold(target)) || !safePath(path.join(dir, target)))) throw new Error(`Destination already exists or is invalid: ${target}`);
      names.add(fold(target));
      const stat = await existing(source);
      if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`Source changed: ${entry.name}`);
      if (['convert', 'clean'].includes(operation) && stat.size > BigInt(operation === 'convert' ? MAX_FILE : MAX_BYTES)) throw new Error(`Source exceeds the preview limit: ${entry.name}`);
      required += ['rename', 'quarantine'].includes(operation) ? stat.size : stat.size * 8n;
      items.push({ source: entry.name, target, identity: fingerprint(stat) });
      if (items.length > 10000) throw new Error('Use at most 10,000 matching files per batch.');
    }
    if (!items.length) throw new Error('No matching files in that folder.');
    const disk = await fs.statfs(dir, { bigint: true });
    const backupDisk = await fs.statfs(sandbox, { bigint: true });
    if (disk.bavail * disk.bsize < required || backupDisk.bavail * backupDisk.bsize < required) throw new Error('There is not enough free space for the batch and its recovery data.');
    signal.throwIfAborted();
    return review({ operation, dir, items, profileId: profile.id });
  }

  function review(plan) {
    const id = randomUUID();
    if (pending.size >= 10) pending.delete(pending.keys().next().value);
    pending.set(id, plan);
    return { text: `Review ${plan.items.length} files in ${plan.dir}.`, review: { kind: 'batch', id, token: approvals.issue(id),
      details: [`${plan.operation} · ${plan.dir}`, ...plan.items.map(item => plan.operation === 'quarantine'
        ? `${item.source} → Marks recovery storage` : `${item.source} → ${item.target}`)] } };
  }

  async function readOriginal(file, item) {
    const current = await existing(file);
    if (!current?.isFile() || fingerprint(current) !== item.identity) throw new Error(`Source changed: ${item.source}`);
    return current;
  }

  async function output(operation, source) {
    const input = await fs.readFile(source);
    if (operation === 'convert') {
      const result = extractDocText(source, input);
      if (result.error) throw new Error(result.error);
      return result.pages.join('\n\n');
    }
    const { header, rows, ragged, truncated } = parseCSV(input.toString('utf8'));
    if (ragged || truncated) throw new Error('CSV has uneven rows or exceeds the complete-read limit.');
    const unique = new Set();
    for (const row of rows) {
      const values = row.map(value => String(value ?? '').trim());
      if (values.some(Boolean)) unique.add(values.map(csvCell).join(','));
    }
    return [header.map(csvCell).join(','), ...unique].join('\r\n') + '\r\n';
  }

  async function records(id) {
    const journal = path.join(root, id);
    await assertDirectory(root);
    await assertDirectory(journal);
    const plan = JSON.parse(await fs.readFile(path.join(journal, 'plan.json'), 'utf8'));
    const events = (await fs.readFile(path.join(journal, 'changes.jsonl'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    })).split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { journal, plan, events };
  }

  async function prepareUndo(id, profileId) {
    const { journal, plan, events } = await records(id);
    if (plan.operation === 'undo' || plan.profileId !== profileId) throw new Error('Choose an original batch ID from this profile.');
    const dir = await folder(plan.dir);
    const items = [];
    for (const event of events.toReversed()) {
      const item = plan.items[event.index];
      if (!item || ![item.source, item.target].every(value => typeof value === 'string' && path.basename(value) === value) ||
          !safePath(path.join(dir, item.target)) || !safePath(path.join(dir, item.source))) throw new Error('The backup manifest contains an invalid item.');
      const backup = ['rename', 'quarantine'].includes(plan.operation) ? path.join(journal, `${event.index}.original`) : null;
      if (backup) {
        const saved = await existing(backup);
        if (!saved?.isFile() || fingerprint(saved) !== event.backupIdentity) throw new Error(`Backup changed: ${item.source}`);
      }
      if (plan.operation === 'quarantine') {
        if (!await existing(path.join(dir, item.source))) items.push({ source: item.source, target: item.source, backup, backupIdentity: event.backupIdentity,
          hash: event.hash, restoreOnly: true });
        continue;
      }
      const target = await existing(path.join(dir, item.target));
      if (!target || fingerprint(target) !== event.identity) continue;
      const original = backup && await existing(path.join(dir, item.source));
      if (original && (!original.isFile() || (fingerprint(original) !== item.identity && await digest(path.join(dir, item.source)) !== event.hash))) {
        throw new Error(`Restore would overwrite ${item.source}.`);
      }
      items.push({ source: item.target, target: item.source, identity: event.identity,
        backup: original ? null : backup, backupIdentity: event.backupIdentity, hash: event.hash });
    }
    if (!items.length) throw new Error('No unchanged outputs are available to restore.');
    return review({ dir, operation: 'undo', items, profileId });
  }

  async function apply(id, token, externalSignal) {
    if (active) throw new Error('Another Marks batch is running.');
    control.assertRunning();
    const started = generation;
    const plan = pending.get(id);
    if (!plan || !approvals.consume(token, id)) throw new Error('The batch review expired. Prepare it again.');
    pending.delete(id);
    const running = control.operation();
    active = new AbortController();
    const journal = path.join(root, id);
    const signal = AbortSignal.any([running.signal, active.signal, AbortSignal.timeout(14400000), ...(externalSignal ? [externalSignal] : [])]);
    const itemPath = name => path.join(plan.dir, name);
    let completed = 0;
    let failure;
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      await assertDirectory(root);
      await fs.mkdir(journal, { mode: 0o700 });
      await fs.writeFile(path.join(journal, 'plan.json'), JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
      const backups = [];
      if (['rename', 'quarantine'].includes(plan.operation)) {
        for (const [index, item] of plan.items.entries()) {
          await power.wait(signal);
          if (started !== generation) throw new Error('Batch disabled.');
          const source = itemPath(item.source);
          if (!safePath(source)) throw new Error('The source is no longer approved.');
          await readOriginal(source, item);
          const destination = path.join(journal, `${index}.original`);
          const hash = await digest(source, signal);
          await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
          if (await digest(destination, signal) !== hash) throw new Error(`Backup verification failed: ${item.source}`);
          await readOriginal(source, item);
          backups[index] = { hash, identity: fingerprint(await existing(destination)) };
        }
      }
      for (const [index, item] of plan.items.entries()) {
        await power.wait(signal);
        if (started !== generation) throw new Error('Batch disabled.');
        const source = itemPath(item.source), target = itemPath(item.target);
        if (!safePath(source) || !safePath(target)) throw new Error('A file path is no longer approved.');
        if (!item.restoreOnly) await readOriginal(source, item);
        if (plan.operation === 'undo') {
          if (item.backup) {
            const saved = await existing(item.backup);
            if (!saved?.isFile() || fingerprint(saved) !== item.backupIdentity || await digest(item.backup, signal) !== item.hash) throw new Error('The backup changed before restore.');
            await fs.copyFile(item.backup, target, constants.COPYFILE_EXCL);
            if (await digest(target, signal) !== item.hash) throw new Error('Restored file contents could not be verified.');
          }
          if (!item.restoreOnly) {
            await readOriginal(source, item);
            if (item.hash && await digest(target, signal) !== item.hash) throw new Error('The original could not be verified before removing the renamed copy.');
            signal.throwIfAborted();
            if (started !== generation) throw new Error('Batch disabled.');
            await fs.unlink(source);
          }
          completed++;
          continue;
        }
        if (await existing(target) && plan.operation !== 'quarantine') throw new Error(`Destination appeared: ${item.target}`);
        const backup = backups[index];
        let identity = item.identity;
        let staged;
        if (!backup) {
          const content = await output(plan.operation, source);
          await readOriginal(source, item);
          staged = path.join(journal, `${index}.output`);
          await fs.writeFile(staged, content, { flag: 'wx', mode: 0o600 });
          identity = fingerprint(await existing(staged));
        }
        await fs.appendFile(path.join(journal, 'changes.jsonl'), JSON.stringify({ index, identity, backupIdentity: backup?.identity, hash: backup?.hash }) + '\n', { mode: 0o600 });
        signal.throwIfAborted();
        if (started !== generation) throw new Error('Batch disabled.');
        if (plan.operation !== 'quarantine') await fs.link(staged || source, target);
        if (backup) {
          await readOriginal(source, item);
          if (plan.operation === 'rename' && fingerprint(await existing(target)) !== item.identity) throw new Error(`The rename target changed: ${item.target}`);
          signal.throwIfAborted();
          if (started !== generation) throw new Error('Batch disabled.');
          await fs.unlink(source);
        }
        completed++;
      }
    } catch (error) { failure = error.message; }
    finally { active = null; running.release(); }
    const status = failure ? 'needs_review' : 'completed';
    await fs.writeFile(path.join(journal, 'status.json'), JSON.stringify({ status, completed, total: plan.items.length }), { mode: 0o600 }).catch(() => {});
    return { text: `${completed}/${plan.items.length} files processed. Batch ${id}.${failure ? ` Paused for review. ${failure}` : ''}` };
  }

  return { prepare, apply, clear };
}

module.exports = { createBatch };
