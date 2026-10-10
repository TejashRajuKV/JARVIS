// Backup to another folder (mirror.js): where it may go, what is copied and what never is, incremental runs, old versions kept, nothing deleted,
// the weekly automatic run, and the laptop-only routes. All in temp folders. Run: node tests/mirror.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const M = require(path.join(__dirname, '..', 'mirror.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
const SB = path.join(root, 'home', 'jarvis'), PROJ = path.join(root, 'work', 'MyApp'), DEST = path.join(root, 'bk', 'JARVIS-Backup');
const mk = (p, c = 'x', mtime) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); if (mtime) fs.utimesSync(p, new Date(mtime), new Date(mtime)); };
const read = p => fs.readFileSync(p, 'utf8');
const exists = p => fs.existsSync(p);
const throwsMsg = (fn, re, status) => { try { fn(); return false; } catch (e) { return e instanceof M.MirrorError && (!re || re.test(e.message)) && (!status || e.status === status); } };
let clock = Date.now();
let stN = 0;   // every mirror in these tests keeps its own state file, as separate installs would
const mkM = (o = {}) => M.createMirror({ SANDBOX: SB, roots: () => [SB, PROJ], blockedPath: p => /[\\/]blocked([\\/]|$)/i.test(p), now: () => clock, stateFile: path.join(root, 'st-' + (++stN) + '.json'), ...o });

(async () => {
  mk(path.join(SB, 'Notes', 'dbms.md'), 'normalization notes'); mk(path.join(SB, 'Notes', 'sub', 'os.md'), 'processes'); mk(path.join(SB, 'Documents', 'a.pdf'), 'PDF'.repeat(10));
  mk(path.join(SB, '.config.json'), '{"apiKey":"SECRET-KEY"}'); mk(path.join(SB, '.trash', 'old.txt'), 'trashed'); mk(path.join(SB, '.jarvis.lock'), '{}'); mk(path.join(SB, '.diskcare', 'j.json'), '{}');
  mk(path.join(SB, '.backups', 'daily-1.json'), '{"state":1}'); mk(path.join(SB, '.chat-archive', '2026-10.jsonl'), '{"t":1}\n'); mk(path.join(SB, '.jarvis-state.json'), '{"big":"live state"}');
  mk(path.join(PROJ, 'index.js'), 'console.log(1)'); mk(path.join(PROJ, 'node_modules', 'x', 'big.js'), 'huge'); mk(path.join(PROJ, '.git', 'HEAD'), 'ref'); mk(path.join(PROJ, 'dist', 'out.js'), 'built');
  try { fs.symlinkSync(path.join(SB, 'Notes'), path.join(SB, 'linked'), 'junction'); } catch { /* no permission */ }
  const m = mkM();

  /* ---------- where it may go ---------- */
  check('dest: a relative path, a whole drive, a file are refused with what to do instead', throwsMsg(() => m.checkDest('backup'), /full folder path/) && throwsMsg(() => m.checkDest(path.parse(root).root), /whole drive/) && (() => { const f = path.join(root, 'afile.txt'); mk(f, 'x'); return throwsMsg(() => m.checkDest(f), /file, not a folder/); })());
  check('dest: inside the folder being backed up, or holding it, is refused (that would copy itself into itself)', throwsMsg(() => m.checkDest(path.join(SB, 'Backups')), /inside the folder/) && throwsMsg(() => m.checkDest(path.join(root, 'home')), /inside the folder it backs up, or hold it/) && throwsMsg(() => m.checkDest(path.join(PROJ, 'bk')), /inside/));
  check('dest: off-limits locations are refused', throwsMsg(() => m.checkDest(path.join(root, 'blocked', 'x')), /off-limits/, 403));
  mk(path.join(root, 'full', 'photos', 'p.jpg'), 'x');
  check('dest: a folder that already holds other things is refused (your backup stays separate); an empty or new one is fine', throwsMsg(() => m.checkDest(path.join(root, 'full')), /already has other files/) && m.checkDest(path.join(root, 'bk', 'new')) === path.join(root, 'bk', 'new') && (fs.mkdirSync(path.join(root, 'empty'), { recursive: true }), m.checkDest(path.join(root, 'empty'))));
  check('run: with no folder set it says how to set one', await m.run({}).then(() => false, e => /No backup folder is set/.test(e.message)));

  /* ---------- the first run ---------- */
  let r = await m.run({ dest: DEST });
  const B = p => path.join(DEST, ...p.split('/'));
  check('first run: your notes and documents are copied with their folders and their contents', read(B('jarvis/Notes/dbms.md')) === 'normalization notes' && read(B('jarvis/Notes/sub/os.md')) === 'processes' && exists(B('jarvis/Documents/a.pdf')) && r.stats.copied === 5 && r.stats.errors.length === 0, r.stats);
  check('first run: snapshots and the chat archive go too (they are YOUR data)', read(B('jarvis/.backups/daily-1.json')) === '{"state":1}' && exists(B('jarvis/.chat-archive/2026-10.jsonl')));
  check('first run: NEVER the keys file, the trash, lock files, disk-care journals or the live state file', !exists(B('jarvis/.config.json')) && !exists(B('jarvis/.trash/old.txt')) && !exists(B('jarvis/.jarvis.lock')) && !exists(B('jarvis/.diskcare/j.json')) && !exists(B('jarvis/.jarvis-state.json')) && !JSON.stringify(fs.readdirSync(DEST, { recursive: true })).includes('SECRET'));
  check('first run: links are not followed, and projects are NOT included unless asked', !exists(B('jarvis/linked')) && !exists(B('projects')));
  check('first run: the folder is marked as a JARVIS backup, and the dates of files are kept', exists(path.join(DEST, M.MARKER)) && Math.abs(fs.statSync(B('jarvis/Notes/dbms.md')).mtimeMs - fs.statSync(path.join(SB, 'Notes', 'dbms.md')).mtimeMs) < 2000);
  check('first run: no half-copied ".part" files are left', !JSON.stringify(fs.readdirSync(DEST, { recursive: true })).includes('.part'));
  check('status: the folder, when it ran, and what it did', m.status().dest === DEST && m.status().lastRun === clock && m.status().last.copied === r.stats.copied && m.status().running === false);

  /* ---------- the second run ---------- */
  clock += 1000; r = await m.run({});
  check('second run: nothing changed → nothing copied, everything counted as unchanged', r.stats.copied === 0 && r.stats.unchanged === r.stats.files && r.stats.replaced === 0, r.stats);
  mk(path.join(SB, 'Notes', 'dbms.md'), 'normalization notes, now with BCNF', Date.now() + 5000); mk(path.join(SB, 'Notes', 'new.md'), 'a new note');
  clock += 1000; r = await m.run({});
  check('changed file: the new version replaces it, and the OLD version is kept in _previous/<date>/', read(B('jarvis/Notes/dbms.md')) === 'normalization notes, now with BCNF' && r.stats.copied === 2 && r.stats.replaced === 1 && read(path.join(DEST, '_previous', new Date(clock).getFullYear() + '-' + String(new Date(clock).getMonth() + 1).padStart(2, '0') + '-' + String(new Date(clock).getDate()).padStart(2, '0'), 'jarvis', 'Notes', 'dbms.md')) === 'normalization notes', r.stats);
  fs.rmSync(path.join(SB, 'Notes', 'sub', 'os.md'));
  clock += 1000; r = await m.run({});
  check('a file deleted from your laptop stays in the backup (nothing is ever deleted there)', exists(B('jarvis/Notes/sub/os.md')) && read(B('jarvis/Notes/sub/os.md')) === 'processes');
  // old _previous folders are cleaned after 30 days
  fs.mkdirSync(path.join(DEST, '_previous', '2020-01-01', 'jarvis'), { recursive: true }); fs.writeFileSync(path.join(DEST, '_previous', '2020-01-01', 'jarvis', 'x.txt'), 'old');
  clock += 1000; r = await m.run({});
  check('old versions older than 30 days are removed; recent ones stay', !exists(path.join(DEST, '_previous', '2020-01-01')) && r.stats.prunedDays >= 1 && fs.readdirSync(path.join(DEST, '_previous')).length >= 1);

  /* ---------- projects ---------- */
  clock += 1000; r = await m.run({ includeProjects: true });
  check('with projects on: your project files are copied under projects/<name>, without node_modules, build output; .git is kept', read(B('projects/MyApp/index.js')) === 'console.log(1)' && exists(B('projects/MyApp/.git/HEAD')) && !exists(B('projects/MyApp/node_modules')) && !exists(B('projects/MyApp/dist')) && m.status().includeProjects === true);

  /* ---------- limits and failures ---------- */
  clock += 1000; r = await m.run({ budgetMs: -1 });
  check('time budget: when it runs out it stops, says so, and what was done is kept', r.stats.partial === true);
  const tiny = mkM({ statfs: async () => ({ bavail: 1, bsize: 1024 }) });
  mk(path.join(SB, 'Notes', 'zz1.md'), 'z'); const r2 = await tiny.run({ dest: path.join(root, 'bk2', 'B') });
  check('a nearly full backup drive stops the run with a plain reason (nothing half-written)', r2.stats.partial === true && r2.stats.errors.some(e => /nearly full/.test(e.why)) && !JSON.stringify(fs.readdirSync(path.join(root, 'bk2'), { recursive: true })).includes('.part'), r2.stats);
  const slow = mkM(); const p1 = slow.run({ dest: DEST }); const e2 = await slow.run({ dest: DEST }).then(() => null, e => e); await p1;
  check('only one backup at a time (the second is refused politely)', e2 && e2.status === 409 && /already running/.test(e2.message));
  const locked = mkM(); mk(path.join(SB, 'Notes', 'locked.md'), 'L'); const origCopy = fs.promises.copyFile;
  fs.promises.copyFile = async (a, b) => { if (/locked\.md/.test(a)) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return origCopy(a, b); };
  const r3 = await locked.run({ dest: DEST }); fs.promises.copyFile = origCopy;
  check('a file in use is skipped and listed ("in use or protected"); the rest still goes', r3.stats.skipped >= 1 && r3.stats.errors.some(e => /locked\.md/.test(e.path) && /in use/.test(e.why)) && !exists(B('jarvis/Notes/locked.md')) && r3.stats.copied >= 0);
  const bad = mkM(); fs.promises.copyFile = async (a, b) => { await origCopy(a, b); if (/zz1\.md/.test(a)) fs.writeFileSync(b, 'CORRUPT!'); };
  mk(path.join(SB, 'Notes', 'zz1.md'), 'good content', Date.now() + 9000);
  const r4 = await bad.run({ dest: DEST }); fs.promises.copyFile = origCopy;
  check('a copy that does not match the original is caught and discarded, never kept as the backup', r4.stats.errors.some(e => /zz1\.md/.test(e.path) && /did not match|wrong size/.test(e.why)) && (!exists(B('jarvis/Notes/zz1.md')) || read(B('jarvis/Notes/zz1.md')) !== 'CORRUPT!') && !exists(B('jarvis/Notes/zz1.md.part')), r4.stats.errors);

  /* ---------- weekly ---------- */
  const w = mkM(); clock = Date.now(); const W = 7 * 864e5;
  w.configure({ dest: path.join(root, 'bk3', 'B'), approved: true });
  check('weekly: switching it on needs a folder first', throwsMsg(() => mkM({}).configure({ enabled: true }), /Set the backup folder first/));
  w.configure({ enabled: true });
  check('weekly: due at once the first time (never run)', (await w.autoTick()) !== null && w.status().lastRun === clock);
  clock += 3 * 864e5; check('weekly: not again for 7 days', (await w.autoTick()) === null);
  clock += 5 * 864e5; check('weekly: after 7 days it runs again by itself', (await w.autoTick()) !== null);
  w.configure({ enabled: false }); clock += W * 2; check('weekly: off means off', (await w.autoTick()) === null);
  const unapproved = mkM(); unapproved.configure({ dest: path.join(root, 'bk4', 'B') }); unapproved.configure({ enabled: true });
  check('weekly: only into a folder you approved from JARVIS (a folder set another way never gets an automatic run)', (await unapproved.autoTick()) === null);
  const fl = mkM({ stateFile: path.join(root, 'state-fail.json') }); fl.configure({ dest: path.join(root, 'bk5', 'B'), approved: true }); fl.configure({ enabled: true });
  fs.mkdirSync(path.join(root, 'bk5', 'B'), { recursive: true }); fs.writeFileSync(path.join(root, 'bk5', 'B', 'other.txt'), 'someone else\'s file');
  await fl.autoTick(); const before = fl.status().lastError; clock += 3600e3;
  check('weekly: a failed automatic run is not retried every hour, and the reason is kept', /already has other files/.test(before || '') && (await fl.autoTick()) === null);

  /* ---------- routes ---------- */
  const routes = {}; const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const approvals = []; let approve = true;
  const rm = M(app, { SANDBOX: SB, roots: () => [SB], blockedPath: () => false, approvedChange: (req, res, action, ...p) => { approvals.push([action, p]); if (!approve) { res.status(409).json({ needsApproval: true }); return false; } return true; }, snapshot: () => { approvals.push(['snapshot']); } });
  const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
  const call = async (key, body, headers = LAPTOP) => { let o, code = 200; await routes[key]({ headers, body }, { headersSent: false, json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  check('routes: every route refuses another site / device', (await Promise.all(['GET /api/mirror/status', 'POST /api/mirror/setdest', 'POST /api/mirror/run', 'POST /api/mirror/config'].flatMap(k => [call(k, {}, {}), call(k, {}, { 'sec-fetch-site': 'same-origin', host: 'x.ts.net' })]))).every(x => x.code === 403));
  const D6 = path.join(root, 'bk6', 'B');
  check('routes: running before a folder is set, or before it was approved here, is refused', (await call('POST /api/mirror/run', {})).code === 400 && (rm.configure({ dest: D6 }), (await call('POST /api/mirror/run', {})).code === 403));
  approve = false; check('routes: setting the folder asks your permission first (the 409 card); "no" sets nothing', (await call('POST /api/mirror/setdest', { dest: path.join(root, 'bk7', 'B') })).code === 409 && rm.status().dest === D6); approve = true;
  const sd = await call('POST /api/mirror/setdest', { dest: D6, enabled: false });
  check('routes: once approved the folder is saved as approved and it names what it asked about', sd.success && sd.approved === D6 && approvals.some(a => /back up your JARVIS files into/.test(a[0] || '') && a[1][0] === D6), approvals);
  check('routes: a bad folder is a plain 400', (await call('POST /api/mirror/setdest', { dest: 'D:' })).code === 400);
  const start = await call('POST /api/mirror/run', {}); await new Promise(r => setTimeout(r, 800));
  check('routes: run starts at once in the background, takes a fresh snapshot first, and status shows the result', start.success && start.started && approvals.some(a => a[0] === 'snapshot') && (await call('GET /api/mirror/status')).lastRun > 0 && (await call('GET /api/mirror/status')).last.copied >= 1);
  check('routes: weekly and the projects option can be switched', (await call('POST /api/mirror/config', { enabled: true, includeProjects: true })).enabled === true && (await call('POST /api/mirror/config', { enabled: false })).enabled === false);

  clearInterval(keep);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`mirror: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
  process.exit(process.exitCode);
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
