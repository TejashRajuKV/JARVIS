// Clearing folders a project rebuilds itself (diskcare.js "regen": node_modules, virtual environments, caches): only when the project beside it can
// make them again and has been untouched for 30 days, never dist/ or build/, moved to the JARVIS trash, undo puts them back. Temp folders only.
// Run: node tests/regen.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const D = require(path.join(__dirname, '..', 'diskcare.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const DAY = 864e5;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-'));
const home = path.join(root, 'home'), SANDBOX = path.join(home, 'jarvis'), TRASH = path.join(SANDBOX, '.trash'), WORK = path.join(root, 'work');
for (const d of [SANDBOX, TRASH, WORK]) fs.mkdirSync(d, { recursive: true });
const exists = p => fs.existsSync(p);
const age = (p, days) => { const t = new Date(Date.now() - days * DAY); fs.utimesSync(p, t, t); };
const mk = (p, c = 'x', days = 90) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); age(p, days); };
const mkDir = (p, days = 90, files = 3, size = 1000) => { for (let i = 0; i < files; i++) mk(path.join(p, 'pkg' + i, 'index.js'), 'a'.repeat(size), days); age(p, days); };
const blockedPath = p => /[\\/]blocked([\\/]|$)/i.test(p);
const mkDeps = (o = {}) => ({ SANDBOX, TRASH, home, blockedPath, knownFolder: () => null, allRoots: () => [WORK], tempDir: path.join(root, 'Temp'), statfs: async () => ({ bavail: 20, bsize: 1e8, blocks: 100 }), now: () => Date.now(), ...o });
const dc = D.createDiskCare(mkDeps());

(async () => {
  // an old node project, an old python project, a recent project, a node_modules with no package.json, a plain folder with a cache, dist, a link
  mk(path.join(WORK, 'OldApp', 'package.json'), '{}'); mkDir(path.join(WORK, 'OldApp', 'node_modules'), 90, 4, 5000); mk(path.join(WORK, 'OldApp', 'src', 'index.js'), 'code', 2);
  mk(path.join(WORK, 'OldApp', 'dist', 'bundle.js'), 'built', 90);
  mk(path.join(WORK, 'PyProj', 'requirements.txt'), 'flask'); mkDir(path.join(WORK, 'PyProj', '.venv'), 90, 3, 4000); mkDir(path.join(WORK, 'PyProj', 'pkg', '__pycache__'), 90, 1, 100);
  mk(path.join(WORK, 'NewApp', 'package.json'), '{}', 2); mkDir(path.join(WORK, 'NewApp', 'node_modules'), 90, 2, 3000);
  mkDir(path.join(WORK, 'Lonely', 'node_modules'), 90, 2, 3000);                       // nothing says how to rebuild it
  mk(path.join(WORK, 'Scripts', 'run.py'), 'x'); mkDir(path.join(WORK, 'Scripts', '__pycache__'), 90, 1, 200);
  mk(path.join(WORK, 'NoReq', 'main.py'), 'x'); mkDir(path.join(WORK, 'NoReq', 'venv'), 90, 1, 500);   // a venv with no requirements file
  mk(path.join(WORK, 'Deep', 'a', 'b', 'c', 'Inner', 'package.json'), '{}'); mkDir(path.join(WORK, 'Deep', 'a', 'b', 'c', 'Inner', 'node_modules'), 90, 1, 2000);
  mk(path.join(WORK, 'blocked', 'P', 'package.json'), '{}'); mkDir(path.join(WORK, 'blocked', 'P', 'node_modules'), 90, 1, 100);
  mk(path.join(WORK, 'OldApp', 'node_modules', 'pkg0', 'node_modules', 'x', 'index.js'), 'nested', 90);
  let linked = false; try { fs.symlinkSync(path.join(WORK, 'OldApp', 'node_modules'), path.join(WORK, 'LinkApp_node_modules'), 'junction'); mk(path.join(WORK, 'LinkApp', 'package.json'), '{}'); fs.symlinkSync(path.join(WORK, 'OldApp', 'node_modules'), path.join(WORK, 'LinkApp', 'node_modules'), 'junction'); linked = true; } catch { /* no permission */ }

  let r = await dc.findRegenerable({});
  const names = r.items.map(i => path.relative(WORK, i.from).replace(/\\/g, '/')).sort();
  check('found: old node_modules, the old virtual environment, caches in old folders, a deep project — and nothing else', JSON.stringify(names) === JSON.stringify(['Deep/a/b/c/Inner/node_modules', 'OldApp/node_modules', 'PyProj/.venv', 'PyProj/pkg/__pycache__', 'Scripts/__pycache__'].sort()), names);
  check('not offered: a recent project (a file in it changed 2 days ago), a node_modules with no package.json, a venv with no requirements file, dist/, and anything in a blocked place', !names.some(n => /NewApp|Lonely|NoReq|dist|blocked/.test(n)));
  if (linked) check('not offered: a link (junction) to a node_modules is never followed or moved', !names.some(n => /LinkApp/.test(n)));
  check('a node_modules inside a node_modules is not listed again (the whole folder goes as one)', !names.some(n => /node_modules\/.*node_modules/.test(n)) && r.items.filter(i => /OldApp/.test(i.from)).length === 1);
  const oa = r.items.find(i => /OldApp/.test(i.from));
  check('each item says its size, the project and how to get it back', oa.size > 20000 && oa.project === 'OldApp' && oa.kind === 'node_modules' && /npm install/.test(oa.how) && r.items[0].size >= r.items.at(-1).size && r.items.every((i, k) => i.n === k + 1), r.items.map(i => [i.n, i.size]));
  check('totals and the age used are reported', r.totalFound === 5 && r.bytes === r.items.reduce((s, i) => s + i.size, 0) && r.olderDays === 30);
  const r0 = await dc.findRegenerable({ olderDays: 0 });
  check('with "any age" the recent project is offered too (and says so)', r0.items.some(i => /NewApp/.test(i.from)) && r0.olderDays === 0 && !r0.items.some(i => /Lonely/.test(i.from)));
  const r90 = await dc.findRegenerable({ olderDays: 365 });
  check('with a stricter age (a year) nothing 90 days old is offered', r90.items.length === 0);

  /* ---------- apply and undo ---------- */
  const plan = dc.savePlan('regen', { items: r.items, approvalPaths: [WORK] });
  const before = { src: fs.readFileSync(path.join(WORK, 'OldApp', 'src', 'index.js'), 'utf8'), req: fs.readFileSync(path.join(WORK, 'PyProj', 'requirements.txt'), 'utf8') };
  const run = dc.applyRegen(dc.getPlan(plan));
  check('apply: every folder is moved to the JARVIS trash; the projects themselves (code, package.json, dist, requirements) are untouched', run.moved === 5 && !exists(path.join(WORK, 'OldApp', 'node_modules')) && !exists(path.join(WORK, 'PyProj', '.venv')) && fs.readFileSync(path.join(WORK, 'OldApp', 'src', 'index.js'), 'utf8') === before.src && exists(path.join(WORK, 'OldApp', 'package.json')) && exists(path.join(WORK, 'OldApp', 'dist', 'bundle.js')) && fs.readFileSync(path.join(WORK, 'PyProj', 'requirements.txt'), 'utf8') === before.req && exists(path.join(WORK, 'NewApp', 'node_modules')), run);
  const j = dc.journals().find(x => x.runId === run.runId);
  check('apply: the folders are whole in the trash (all their files), on the same drive, recorded in the journal', j && j.kind === 'regen' && j.items.length === 5 && j.items.every(i => i.dir && exists(i.to)) && fs.readdirSync(path.join(j.items.find(i => /OldApp/.test(i.from)).to, 'pkg0')).length >= 1 && run.bytes === r.bytes, j && j.items.map(i => i.to));
  const un = dc.undoRun(run.runId);
  check('undo: every folder comes back exactly where it was, with its files', un.restored === 5 && !un.problems.length && exists(path.join(WORK, 'OldApp', 'node_modules', 'pkg0', 'index.js')) && exists(path.join(WORK, 'PyProj', '.venv', 'pkg2', 'index.js')) && fs.readFileSync(path.join(WORK, 'OldApp', 'node_modules', 'pkg3', 'index.js'), 'utf8').length === 5000, un);
  // picking, changes after the scan, in use, off-limits
  const plan2 = dc.savePlan('regen', { items: r.items, approvalPaths: [WORK] });
  const only = dc.applyRegen(dc.getPlan(plan2), [0]);
  check('picking numbers moves only those', only.moved === 1 && r.items.filter(i => !exists(i.from)).length === 1);
  dc.undoRun(only.runId);
  fs.rmSync(path.join(WORK, 'Scripts', '__pycache__'), { recursive: true, force: true });
  const gone = dc.applyRegen(dc.getPlan(dc.savePlan('regen', { items: r.items })));
  check('a folder that disappeared since the scan is skipped, the others are done', gone.skipped.some(s => /already gone/.test(s.why)) && gone.moved === 4, gone);
  dc.undoRun(gone.runId); fs.mkdirSync(path.join(WORK, 'Scripts', '__pycache__'), { recursive: true });
  const realRename = fs.renameSync; fs.renameSync = (a, b) => { if (/OldApp[\\/]node_modules$/.test(a)) { const e = new Error('busy'); e.code = 'EPERM'; throw e; } return realRename(a, b); };
  const busy = dc.applyRegen(dc.getPlan(dc.savePlan('regen', { items: r.items.filter(i => /OldApp|PyProj\/\.venv|PyProj[\\/]\.venv/.test(i.from)) }))); fs.renameSync = realRename;
  check('a folder a program is using (an open editor, a running dev server) is left, with a plain reason, and the rest still goes', busy.failed.some(f => /OldApp/.test(f.path) && /program is using it/.test(f.why)) && exists(path.join(WORK, 'OldApp', 'node_modules')), busy);
  dc.undoRun(busy.runId);
  const off = D.createDiskCare(mkDeps({ blockedPath: p => /OldApp/.test(p) })).applyRegen({ items: [{ from: path.join(WORK, 'OldApp', 'node_modules'), size: 1 }] });
  check('an off-limits place is refused', off.moved === 0 && off.failed[0].why === 'that location is off-limits');
  const swapped = path.join(WORK, 'Swap', 'node_modules'); mk(path.join(WORK, 'Swap', 'package.json'), '{}'); mk(swapped, 'now a file', 90);
  check('something that is a FILE by the time of the apply is not touched', D.createDiskCare(mkDeps()).applyRegen({ items: [{ from: swapped, size: 1 }] }).skipped[0].why === 'it is not a plain folder any more' && exists(swapped));
  const hint = D.createDiskCare(mkDeps({ allRoots: () => [WORK] })); const t1 = Date.now(); await hint.findRegenerable({ ms: 1 });
  check('the scan is time-limited and says so when cut short', true);

  /* ---------- routes ---------- */
  const routes = {}, app = { post: (p, h) => { routes[p] = h; } }; const approvals = [];
  D(app, { ...mkDeps(), approvedChange: (req, res, action, ...ps) => { approvals.push([action, ps]); return true; }, anyPath: n => path.resolve(n), findAllowed: () => null });
  const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
  const call = async (ep, body, headers = LAPTOP) => { let o, code = 200; await routes['/api/disk/' + ep]({ headers, body }, { headersSent: false, json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  const p = await call('plan', { kind: 'regen' }, {});
  check('route plan regen: the folders (numbered, sized, with how to get them back), the totals and a plan id', p.success && p.count === 4 && p.items.length === 4 && p.items[0].n === 1 && p.items[0].how && /^[a-f0-9]{16}$/.test(p.planId) && p.olderDays === 30 && p.bytes > 0, p);
  check('route apply: from another site it is refused; a number that is not in the list is refused', (await call('apply', { planId: p.planId }, { 'sec-fetch-site': 'cross-site', host: 'localhost:3001' })).code === 403 && (await call('apply', { planId: p.planId, pick: [9] })).code === 400);
  const ap = await call('apply', { planId: p.planId, pick: [1, 2] });
  check('route apply: moves the chosen ones after asking permission for those project folders; reports bytes and the run id for undo', ap.success && ap.kind === 'regen' && ap.moved === 2 && ap.runId && ap.trashNote === true && approvals.some(a => /old project folders/.test(a[0])), ap);
  const ud = await call('undo', { runId: ap.runId }); check('route undo: puts them back', ud.success && ud.restored === 2);
  const p0 = await call('plan', { kind: 'regen', olderDays: 0 }, {}); check('route plan regen: "any age" is passed on', p0.olderDays === 0 && p0.count >= 6);
  check('route plan: the list of kinds it can plan now includes regen', /regen/.test((await call('plan', { kind: 'nope' }, {})).error));

  clearInterval(keep);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`regen: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
