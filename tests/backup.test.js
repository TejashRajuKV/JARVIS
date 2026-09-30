// Backup / import (backup.js): building, sealing secrets, validating hostile files, merge rules, snapshots.
// Run: node tests/backup.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const B = require(path.join(__dirname, '..', 'backup.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const state = {
  'jarvis.todos': [{ id: 'a', text: 'revise', done: false }], 'jarvis.flashcards': [{ id: 'f1', q: 'q', a: 'a' }], 'jarvis.chat': [{ role: 'user', text: 'hi', t: 1 }],
  'jarvis.settings': { wakeWord: 'jarvis', model: 'qwen3.5:4b' }, 'jarvis.stats': { '2026-10-01': { focusMin: 30, todosDone: 1 } }, 'jarvis.migrated': true,
};
const secrets = { providers: [{ id: 'openai', preset: 'openai', apiKey: 'sk-SUPERSECRET-123456' }], phoneAuth: { secret: 'ABCDEFGH' } };

/* ---------- sealing ---------- */
{
  const env = B.seal(secrets, 'correct horse battery');
  check('seal hides the key', !JSON.stringify(env).includes('SUPERSECRET'));
  check('unseal round trip', JSON.stringify(B.unseal(env, 'correct horse battery')) === JSON.stringify(secrets));
  let e1 = ''; try { B.unseal(env, 'wrong password!!') } catch (e) { e1 = e.message; }
  check('wrong password rejected with a plain message', /Wrong password/.test(e1), e1);
  const bad = { ...env, data: Buffer.from('tampered' + env.data).toString('base64') };
  let e2 = ''; try { B.unseal(bad, 'correct horse battery') } catch (e) { e2 = e.message; }
  check('tampered file rejected (GCM tag)', /Wrong password|damaged/.test(e2), e2);
  let e3 = ''; try { B.seal(secrets, 'short') } catch (e) { e3 = e.message; }
  check('short password refused', /at least 8/.test(e3));
  check('same secrets sealed twice differ (random salt/iv)', B.seal(secrets, 'correct horse battery').data !== env.data);
}

/* ---------- build + parse ---------- */
{
  const plain = B.buildBackup({ state, roots: ['D:\\proj'], appVersion: '1.1.0', now: 1e12 });
  check('plain backup has no secrets field', !('secrets' in plain) && !JSON.stringify(plain).includes('apiKey'));
  const r = B.parseBackup(JSON.stringify(plain));
  check('parses back', r.ok && Object.keys(r.backup.state).length === 6 && r.backup.roots[0] === 'D:\\proj', r);
  const withS = B.buildBackup({ state, roots: [], secrets, password: 'correct horse battery' });
  const r2 = B.parseBackup(JSON.stringify(withS));
  check('secrets survive as a sealed envelope', r2.ok && r2.backup.secrets && r2.backup.secrets.enc === 'aes-256-gcm' && !JSON.stringify(withS).includes('SUPERSECRET'));
  const s = B.summarize(r.backup);
  check('summary counts areas', s.areas['to-dos'] === 1 && s.areas.flashcards === 1 && s.areas['chat messages'] === 1 && s.hasSecrets === false, s);
}
check('not JSON', !B.parseBackup('hello').ok);
check('wrong format', !B.parseBackup('{"format":"other","state":{}}').ok);
check('newer version refused', /newer/.test(B.parseBackup(JSON.stringify({ format: 'jarvis-backup', version: 99, state: {} })).error || ''));
check('empty / non-string', !B.parseBackup('').ok && !B.parseBackup(null).ok);
check('too big', !B.parseBackup('x'.repeat(7 * 1024 * 1024)).ok);
{
  const r = B.parseBackup(JSON.stringify({ format: 'jarvis-backup', version: 1, state: { 'jarvis.todos': [], '__proto__': { x: 1 }, 'evil': 1, 'jarvis.a/b': 2, ['jarvis.' + 'x'.repeat(50)]: 3 }, roots: ['D:\\ok', 5, 'x'.repeat(500)] }));
  check('hostile keys are dropped, not imported', r.ok && Object.keys(r.backup.state).join() === 'jarvis.todos' && r.backup.rejected.length >= 3, r.backup && r.backup.rejected);
  check('only sane roots survive parsing', r.backup.roots.length === 1);
  check('no prototype pollution', ({}).x === undefined);
}

/* ---------- merge ---------- */
{
  const cur = { 'jarvis.todos': [{ id: 'a', text: 'mine' }], 'jarvis.settings': { model: 'local', tts: true }, 'jarvis.stats': { d1: { focusMin: 20, todosDone: 5 } }, 'jarvis.memory': [{ k: 'name', v: 'Tejas' }], 'jarvis.chat': [{ t: 5, text: 'b' }] };
  const inc = { 'jarvis.todos': [{ id: 'a', text: 'theirs' }, { id: 'b', text: 'new' }], 'jarvis.settings': { model: 'other', wakeWord: 'friday' }, 'jarvis.stats': { d1: { focusMin: 50, todosDone: 1 }, d2: { focusMin: 10 } },
    'jarvis.memory': [{ k: 'name', v: 'Tejas' }, { k: 'city', v: 'Hyd' }], 'jarvis.chat': [{ t: 2, text: 'a' }, { t: 5, text: 'b' }], 'jarvis.flashcards': [{ id: 'f', q: 'x' }] };
  const m = B.mergeState(cur, inc, (a, b) => [...a, ...b]);
  check('merge: id lists union, current wins on the same id', m['jarvis.todos'].length === 2 && m['jarvis.todos'][0].text === 'mine' && m['jarvis.todos'][1].id === 'b');
  check('merge: this laptop\u2019s settings win, gaps filled', m['jarvis.settings'].model === 'local' && m['jarvis.settings'].wakeWord === 'friday' && m['jarvis.settings'].tts === true);
  check('merge: stats take the larger number per counter, keep new days', m['jarvis.stats'].d1.focusMin === 50 && m['jarvis.stats'].d1.todosDone === 5 && m['jarvis.stats'].d2.focusMin === 10);
  check('merge: id-less lists de-duplicate', m['jarvis.memory'].length === 2);
  check('merge: chat merged in time order without duplicates', m['jarvis.chat'].length === 2 && m['jarvis.chat'][0].t === 2);
  check('merge: new areas are added', m['jarvis.flashcards'].length === 1);
  check('merge: reminders use the supplied merger', B.mergeState({ 'jarvis.reminders': [1] }, { 'jarvis.reminders': [2] }, (a, b) => ['M', ...a, ...b])['jarvis.reminders'][0] === 'M');
}

/* ---------- routes + snapshots against a temp folder ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
let current = { ...state }; const cfg = { roots: [], providers: [], phoneAuth: null };
const routes = {};
const app = { post: (p, h) => { routes[p] = h; }, get: (p, h) => { routes[p] = h; } };
const api = B(app, { getState: () => current, setState: s => { current = s; }, getConfig: () => cfg, saveConfig: () => {}, mergeReminders: (a, b) => b, addRoot: p => p === 'D:\\ok', dir, appVersion: '1.1.0' });
const good = { headers: { 'sec-fetch-site': 'same-origin', host: 'localhost:3000' } };
const call = async (p, body, hdr = good) => { let out, code = 200; await routes[p]({ ...hdr, body }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
(async () => {
  check('routes refuse other origins', (await call('/api/backup/export', {}, { headers: { 'sec-fetch-site': 'cross-site', host: 'localhost:3000' } })).code === 403);
  check('routes refuse a Tailscale/phone host', (await call('/api/backup/export', {}, { headers: { 'sec-fetch-site': 'same-origin', host: 'laptop.tail1234.ts.net' } })).code === 403);
  const ex = await call('/api/backup/export', {});
  check('export: plain by default', ex.success && !ex.content.includes('apiKey') && /\.jarvis-backup$/.test(ex.filename));
  cfg.providers = secrets.providers; cfg.phoneAuth = secrets.phoneAuth;
  check('export with secrets needs a password', (await call('/api/backup/export', { includeSecrets: true })).code === 400);
  const exs = await call('/api/backup/export', { includeSecrets: true, password: 'correct horse battery' });
  check('export with secrets: sealed', exs.success && !exs.content.includes('SUPERSECRET'));
  const pv = await call('/api/backup/preview', { content: ex.content });
  check('preview', pv.success && pv.areas['to-dos'] === 1 && pv.hasSecrets === false, pv);

  // replace: everything from the backup, safety snapshot first, the migrated marker kept
  current = { 'jarvis.todos': [{ id: 'zzz' }], 'jarvis.migrated': 'yes' };
  cfg.providers = []; cfg.phoneAuth = null;
  const imp = await call('/api/backup/import', { content: exs.content, mode: 'replace', withSecrets: true, password: 'correct horse battery' });
  check('import replace: data restored', imp.success && current['jarvis.todos'][0].id === 'a' && current['jarvis.migrated'] === 'yes', imp);
  check('import: API keys and phone key restored from the sealed part', cfg.providers[0].apiKey === 'sk-SUPERSECRET-123456' && cfg.phoneAuth.secret === 'ABCDEFGH');
  check('import took a safety copy first', imp.safetyCopy && fs.existsSync(path.join(dir, imp.safetyCopy)) && JSON.parse(fs.readFileSync(path.join(dir, imp.safetyCopy), 'utf8'))['jarvis.todos'][0].id === 'zzz');
  check('safety copy holds no secrets', !fs.readFileSync(path.join(dir, imp.safetyCopy), 'utf8').includes('SUPERSECRET'));
  check('wrong password refused, nothing changed', (await call('/api/backup/import', { content: exs.content, mode: 'replace', withSecrets: true, password: 'nope nope nope' })).code === 400);
  check('secrets requested but backup has none', (await call('/api/backup/import', { content: ex.content, mode: 'replace', withSecrets: true, password: 'x' })).code === 400);
  const rootBk = B.buildBackup({ state: {}, roots: ['D:\\ok', 'D:\\bad'] });
  const imp2 = await call('/api/backup/import', { content: JSON.stringify(rootBk), mode: 'merge' });
  check('project folders re-added only when they pass the checks', imp2.folders === 1, imp2);
  check('garbage import refused', (await call('/api/backup/import', { content: 'nope', mode: 'replace' })).code === 400);

  // snapshots
  const before = await call('/api/backup/snapshots', {});
  check('snapshots listed, newest first', before.snapshots.length >= 2 && before.snapshots[0].at >= before.snapshots[1].at);
  const snapName = api.snapshot('before-erase');
  check('named snapshot created', /^before-erase-.*\.json$/.test(snapName) && fs.existsSync(path.join(dir, snapName)));
  const rs = await call('/api/backup/restore', { name: snapName });
  check('restore from a snapshot', rs.success);
  check('restore refuses path tricks', (await call('/api/backup/restore', { name: '../../config.json' })).code === 404 && (await call('/api/backup/restore', { name: '..\\x.json' })).code === 404);
  for (let i = 0; i < 14; i++) api.snapshot('before-import');
  check('safety copies are pruned to 10', api.listSnaps().filter(s => !s.name.startsWith('daily-')).length <= 10);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`backup: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
