// Screenshot search (shotindex.js) on temp folders with a fake text reader. Run: node tests/shotindex.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { createShotIndex, tokens } = require(path.join(__dirname, '..', 'shotindex.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-shots-'));
const S = path.join(tmp, 'home'), A = path.join(tmp, 'Screenshots'), B = path.join(tmp, 'Other');
for (const d of [S, A, B, path.join(A, 'sub'), path.join(A, 'sub', 'deep', 'deeper')]) fs.mkdirSync(d, { recursive: true });
// a "picture": a PNG signature, then the words the fake reader will "see"
const put = (dir, name, words, ageDays = 0) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('::' + words + '::'.padEnd(1100, ' '))])); const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(p, t, t); return p; };
let reads = 0, ocrFail = null;
const ocr = async buf => { reads++; if (ocrFail) return { error: ocrFail }; const m = buf.toString('latin1').match(/::(.*?)::/); return { text: m ? m[1] : '' }; };
const mk = (extra = {}) => createShotIndex({ SANDBOX: S, ocr, folders: () => [A], ...extra });

(async () => {
  check('tokens: lowercased words, filler words dropped, emails and versions kept', tokens('Find the screenshot with the WiFi password').join() === 'wifi,password' && tokens('mail me at a.b@c.com v2.1').join() === 'mail,a.b@c.com,v2.1');
  check('tokens: stop words go', tokens('the screenshot of my error').join() === 'error');

  const p1 = put(A, 'Screenshot 1.png', 'Wi-Fi password is hunter42 for the hostel network', 2);
  const p2 = put(A, 'Screenshot 2.png', 'Flight booking confirmation PNR 8XK2L Bengaluru to Hyderabad', 10);
  const p3 = put(path.join(A, 'sub'), 'Screenshot 3.png', 'Error: Cannot find module express at server.js line 3', 1);
  put(path.join(A, 'sub', 'deep', 'deeper'), 'too-deep.png', 'hidden three levels down', 1);
  fs.writeFileSync(path.join(A, 'notes.txt'), 'not an image'); fs.writeFileSync(path.join(A, 'tiny.png'), 'x');
  const I = mk();
  let st = await I.status();
  check('status: before reading, 3 pictures found (two levels deep, images only, tiny files ignored), none indexed', st.total === 3 && st.indexed === 0 && st.pending === 3 && !st.running, st);
  check('status: the folder list is the real folders only', st.folders.length === 1 && st.folders[0] === path.resolve(A));
  const r1 = await I.update();
  check('update: all three read, none failed, nothing left', r1.done === 3 && r1.failed === 0 && r1.remaining === 0 && reads === 3, r1);
  const r2 = await I.update(); check('update: a second run reads nothing new', reads === 3 && r2.done === 0);
  check('index file written', fs.existsSync(path.join(S, '.shotindex.json')));

  let s = I.search('wifi password');
  check('search: words find the right picture; wording is by words not exact text', s.results.length === 1 && s.results[0].path === p1 && /hunter42/.test(s.results[0].snippet), s);
  s = I.search('wi-fi password'); check('search: "wi-fi" matches the hyphenated text', s.results.length === 1 && s.results[0].path === p1, s);
  s = I.search('flight pnr'); check('search: two words both present rank first', s.results[0].path === p2 && s.results[0].score >= 1, s.results);
  s = I.search('cannot find module'); check('search: a phrase in order scores higher than words apart; finds the nested one', s.results[0].path === p3 && s.results[0].score > 1, s.results);
  s = I.search('error'); check('search: a word in one picture only', s.results.length === 1 && s.results[0].path === p3);
  s = I.search('the of screenshot'); check('search: only filler words → asks for a real word', !!s.error);
  s = I.search('xyzzy'); check('search: nothing found is an empty list, not an error', !s.error && s.results.length === 0 && s.total === 0);
  s = I.search('password flight error', { limit: 2 }); check('search: limit applies, total counts all', s.results.length === 2 && s.total === 3);
  s = I.search('password flight', { from: Date.now() - 5 * 864e5 }); check('search: a date window drops older pictures', s.results.length === 1 && s.results[0].path === p1);
  s = I.search('password flight', { to: Date.now() - 5 * 864e5 }); check('search: the other end of the window', s.results.length === 1 && s.results[0].path === p2);
  s = I.search('deep hidden'); check('search: a picture three levels down was not indexed', s.results.length === 0);

  // new and changed pictures
  const p4 = put(A, 'Screenshot 4.png', 'Meeting link zoom.us 555 123', 0);
  st = await I.status(); check('status: a new picture shows as pending', st.total === 4 && st.pending === 1 && st.indexed === 3, st);
  await I.update(); check('update: only the new picture is read', reads === 4 && I.search('zoom').results[0].path === p4);
  put(A, 'Screenshot 4.png', 'Meeting link now teams', 0); fs.utimesSync(p4, new Date(), new Date(Date.now() + 5000));
  await I.update(); check('update: a changed picture is read again and the old words are gone', reads === 5 && I.search('teams').results.length === 1 && I.search('zoom').results.length === 0);
  fs.rmSync(p4); await I.update(); check('update: a picture that was deleted drops out of the index', I.search('teams').results.length === 0 && (await I.status()).total === 3);

  // persistence, a second instance, isIndexed
  const J = mk(); check('a new instance reads the saved index (nothing is read again)', J.search('wifi').results.length === 1 && (await J.status()).pending === 0 && reads === 5);
  check('isIndexed: true for an indexed file, false for anything else (even a real file outside)', J.isIndexed(p1) && !J.isIndexed(path.join(A, 'notes.txt')) && !J.isIndexed(path.join(S, '.shotindex.json')) && !J.isIndexed('') && !J.isIndexed(null));

  // limits and failures
  const bigDir = path.join(tmp, 'big'); fs.mkdirSync(bigDir); const big = path.join(bigDir, 'huge.png'); fs.writeFileSync(big, Buffer.alloc(13 * 1048576, 1));
  const K = mk({ folders: () => [bigDir] }); check('a picture over 12 MB is not even listed', (await K.status()).total === 0);
  const fdir = path.join(tmp, 'fail'); fs.mkdirSync(fdir); put(fdir, 'a.png', 'one'); put(fdir, 'b.png', 'two');
  const F = mk({ folders: () => [fdir], stateFile: path.join(S, 'fail.json') }); ocrFail = 'no OCR language installed';
  const rf = await F.update(); check('a reader that is not available stops the run at once; the file is marked (not retried today) and the other stays pending', rf.failed === 1 && rf.done === 0 && (await F.status()).pending === 1, rf);
  ocrFail = 'could not be decoded'; const F2 = mk({ folders: () => [fdir], stateFile: path.join(S, 'fail2.json') }); const rf2 = await F2.update(); check('a picture that fails is counted as failed and not retried for a day', rf2.failed === 2 && rf2.done === 0 && (await F2.status()).pending === 0, rf2);
  ocrFail = null;
  const slow = createShotIndex({ SANDBOX: S, folders: () => [A], stateFile: path.join(S, 'slow.json'), ocr: async buf => { await new Promise(r => setTimeout(r, 30)); return { text: 'x' + buf.length }; } });
  const run1 = slow.update(), run2 = slow.update(); check('update: asking again while it runs gives the same run (one at a time)', run1 === run2 && (await slow.status()).running === true); await run1;
  const lim = mk({ stateFile: path.join(S, 'lim.json') }); const rl = await lim.update({ max: 1 }); check('update: `max` limits one run, the rest stay pending', rl.done === 1 && rl.remaining === 2, rl);
  const tb = mk({ stateFile: path.join(S, 'tb.json') }); const rt = await tb.update({ budgetMs: -1 }); check('update: a spent time budget stops before reading', rt.done === 0 && rt.remaining === 3, rt);

  // folders and forgetting
  put(B, 'other.png', 'library card number 0042', 0);
  const G = mk({ stateFile: path.join(S, 'g.json') });
  check('folders: add a real folder', G.addFolder(B).folder === path.resolve(B) && (await G.status()).total === 4);
  check('folders: add is idempotent, a missing folder and a whole drive are refused', G.addFolder(B.toUpperCase() === B ? B : B).folder && (await G.status()).extra.length === 1 && !!G.addFolder(path.join(tmp, 'nope')).error && !!G.addFolder(path.parse(tmp).root).error);
  await G.update(); check('folders: pictures in the added folder are searchable', G.search('library card').results.length === 1);
  check('folders: remove', G.removeFolder(B).removed === 1 && (await G.status()).total === 3);
  await G.update(); check('folders: after removing, its pictures drop out at the next update', G.search('library card').results.length === 0);
  const fg = G.forget(); check('forget: clears the index (count returned) and a new search finds nothing', fg.forgotten >= 3 && G.search('wifi').results.length === 0 && (await G.status()).indexed === 0);
  const H = mk({ stateFile: path.join(S, 'g.json') }); check('forget: stays forgotten after a reload', H.search('wifi').results.length === 0);
  check('junk: a corrupt state file is ignored', (() => { fs.writeFileSync(path.join(S, 'bad.json'), '{not json'); return mk({ stateFile: path.join(S, 'bad.json') }).search('x1').results.length === 0; })());

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`shotindex: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
