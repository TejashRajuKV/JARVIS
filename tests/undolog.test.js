// The undo log (undolog.js): how each file action is reversed, kept 30 minutes in a private file so undo survives a reload. Run: node tests/undolog.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const U = require(path.join(__dirname, '..', 'undolog.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-undolog-')), file = path.join(tmp, '.undo-log.json');
let clock = 1e12; const log = U.createUndoLog({ file, now: () => clock });
const MIN = 60e3;

check('keyOf: one key per reverse call; calls that are not file undos have none', U.keyOf('/tool/restoreItem', { trashName: '1_a.txt' }) === '/tool/restoreItem|1_a.txt' && U.keyOf('/tool/restoreVersion', { backup: '2_b' }) === '/tool/restoreVersion|2_b' && U.keyOf('/tool/undoMove', { to: 'C:/A/b', from: 'c:\\a\\B\\' }) === '/tool/undoMove|c:\\a\\b|c:\\a\\b' && U.keyOf('/tool/undoCreate', { name: 'D:\\x' }) === '/tool/undoCreate|d:\\x' && U.keyOf('/tool/shutdown', {}) === null && U.keyOf('/api/tool/undoCreate', { name: 'D:\\x' }) === '/tool/undoCreate|d:\\x');
check('empty at first', log.pending().length === 0);
const id1 = log.add({ label: 'deleted a.txt', endpoint: '/tool/restoreItem', body: { trashName: '1_a.txt', original: 'C:\\x\\a.txt' } });
clock += MIN; const id2 = log.add({ label: 'renamed b', endpoint: '/tool/undoMove', body: { to: 'C:\\x\\b2', from: 'C:\\x\\b' } });
clock += MIN; log.add({ label: 'created c', endpoint: '/tool/undoCreate', body: { name: 'C:\\x\\c.txt' } });
let p = log.pending();
check('add: ids returned; pending lists records oldest first with label, time, the call to make and its body', id1 && id2 && p.length === 3 && p[0].label === 'deleted a.txt' && p[0].endpoint === '/tool/restoreItem' && p[0].body.trashName === '1_a.txt' && p[2].endpoint === '/tool/undoCreate' && p[0].t < p[2].t, p);
check('add: a call with no known reverse is refused (null) and nothing is stored', log.add({ label: 'x', endpoint: '/tool/shutdownSystem', body: {} }) === null && log.pending().length === 3);
check('the file is a private dot-file holding only the records (with the keys)', fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).length === 3);
const log2 = U.createUndoLog({ file, now: () => clock }); check('a new instance (a restarted server) sees the same records', log2.pending().length === 3);
log.add({ label: 'deleted a.txt again', endpoint: '/tool/restoreItem', body: { trashName: '1_a.txt', original: 'C:\\x\\a.txt' } });
check('adding the same reverse call again replaces the old record instead of doubling it', log.pending().filter(r => r.body.trashName === '1_a.txt').length === 1 && log.pending().length === 3);
check('consume: running the reverse call removes its record (any spelling of the paths)', log.consume('/tool/undoMove', { to: 'c:/x/B2', from: 'c:/x/b/' }) === 1 && log.pending().length === 2 && log.pending().every(r => r.endpoint !== '/tool/undoMove'));
check('consume: a call nobody recorded changes nothing; an unknown endpoint too', log.consume('/tool/restoreItem', { trashName: 'nope' }) === 0 && log.consume('/tool/foo', {}) === 0 && log.pending().length === 2);
clock += 29 * MIN; check('records are kept for 30 minutes from when the action happened', log.pending().length >= 1 && log.pending().every(r => clock - r.t <= U.TTL));
clock += 5 * MIN; check('…and then forgotten', log.pending().length === 0 && log.pending().length === 0);
for (let i = 0; i < 60; i++) { clock += 1000; log.add({ label: 'n' + i, endpoint: '/tool/undoCreate', body: { name: 'C:\\f' + i } }); }
check('at most 40 records are kept (the newest)', log.pending().length === 40 && log.pending()[39].label === 'n59' && log.pending()[0].label === 'n20');
fs.writeFileSync(file, '{not json'); check('a damaged file reads as empty and the next add repairs it', log.pending().length === 0 && (log.add({ label: 'ok', endpoint: '/tool/undoCreate', body: { name: 'C:\\z' } }), log.pending().length === 1));
fs.writeFileSync(file, JSON.stringify([{ endpoint: '/tool/undoCreate', body: { name: 'x' }, t: clock }, { nonsense: true }, null, 7, { endpoint: 5, body: {}, t: clock }])); check('records of the wrong shape are ignored', log.pending().length === 1);
// the route
const routes = {}; U({ get: (p, h) => { routes[p] = h; } }, { SANDBOX: tmp });
const call = headers => { let out, code = 200; routes['/api/undo/pending']({ headers }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
check('route: the laptop page gets the list; another site, another device or no headers are refused', call({ 'sec-fetch-site': 'same-origin', host: 'localhost:3001' }).success === true && call({ 'sec-fetch-site': 'cross-site', host: 'localhost:3001' }).code === 403 && call({ 'sec-fetch-site': 'same-origin', host: 'x.tail1.ts.net' }).code === 403 && call({}).code === 403);

fs.rmSync(tmp, { recursive: true, force: true });
{ // a record keeps the plan run it came from (X-Jarvis-Run), so a whole plan can be undone after a reload; anything else is dropped
  const lr = U.createUndoLog({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-undolog-run-')), '.undo-log.json'), now: () => clock });
  const idr = lr.add({ label: 'deleted r.txt', endpoint: '/tool/restoreItem', body: { trashName: '9_r.txt', original: 'C:\\x\\r.txt' }, run: 'AGT-20261019-007' });
  lr.add({ label: 'deleted s.txt', endpoint: '/tool/restoreItem', body: { trashName: '9_s.txt', original: 'C:\\x\\s.txt' }, run: '../../evil' });
  const pr = lr.pending();
  check('add: the plan run id is kept with the record; a value that is not a run id is not stored', pr.find(x => x.id === idr).run === 'AGT-20261019-007' && pr.find(x => x.label === 'deleted s.txt').run === undefined, pr);
}
console.log(`undolog: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
