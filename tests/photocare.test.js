// Photo care (diskcare.js): similar photos (picture fingerprints, cache, project protection, plan → apply → undo) and shrinking big JPEGs
// (the original always kept in the JARVIS trash, nothing replaced unless the new file is valid and smaller, undo puts it back).
// Part 1 uses a fake hasher/shrinker so every rule is tested exactly; part 2 runs the real Windows image tools on pictures drawn here.
// Everything happens in a temp folder. Run: node tests/photocare.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFile } = require('child_process');
const D = require(path.join(__dirname, '..', 'diskcare.js'));
const ScanMath = require(path.join(__dirname, '..', 'scanmath.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);
const MB = 1024, RMB = 1048576, DAY = 864e5;      // in this file "MB" is 1 KB: the fake pictures are tiny, and the thresholds are scaled to match
D.LIMITS.shrinkMinMB = 3 / 1024;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-'));
const home = path.join(root, 'home'), SANDBOX = path.join(home, 'jarvis'), TRASH = path.join(SANDBOX, '.trash');
for (const d of [SANDBOX, TRASH]) fs.mkdirSync(d, { recursive: true });
const exists = p => fs.existsSync(p);
const blockedPath = p => /[\\/](windows|program files)([\\/]|$)/i.test(path.resolve(p));
const setAge = (p, days) => { const t = new Date(Date.now() - days * DAY); fs.utimesSync(p, t, t); };
let clock = Date.now();
const mkDeps = (over = {}) => ({ SANDBOX, TRASH, home, blockedPath, knownFolder: () => null, allRoots: () => [SANDBOX], tempDir: path.join(root, 'Temp'), statfs: async () => ({ bavail: 20, bsize: 1e8, blocks: 100 }), now: () => clock, ...over });

/* ---------- fake pictures: the file starts with {g, w, h} (what the fake hasher "sees") ---------- */
let seed = 1; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pattern = () => Array.from({ length: 72 }, () => Math.floor(rnd() * 255));
const variant = (g, flips) => { const o = g.slice(); for (let i = 0; i < flips; i++) { const k = i * 9 + 3; o[k] = o[k + 1] + (o[k] > o[k + 1] ? -60 : 60); o[k] = Math.max(0, Math.min(255, o[k])); } return o; };
const photo = (file, g, { kb = 100, w = 800, h = 600, age = 10 } = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = Buffer.from(JSON.stringify({ g, w, h }) + '\n');
  fs.writeFileSync(file, Buffer.concat([head, Buffer.alloc(Math.max(0, kb * 1024 - head.length), 5)]));
  setAge(file, age);
};
let hashCalls = [];
const fakeHash = async paths => { hashCalls.push(paths.slice()); const m = new Map(); for (const p of paths) { try { const j = JSON.parse(fs.readFileSync(p, 'latin1').split('\n')[0]); m.set(p, { g: j.g, w: j.w, h: j.h }); } catch { m.set(p, null); } } return m; };

(async () => {
  /* ================= similar photos ================= */
  const P = path.join(root, 'pics'); fs.mkdirSync(P, { recursive: true });
  const dc = D.createDiskCare(mkDeps({ allRoots: () => [P], hashImages: fakeHash }));
  const A = pattern(), B = pattern(), C = pattern(), E = pattern();
  photo(path.join(P, 'holiday', 'IMG_001.jpg'), A, { kb: 400, w: 4000, h: 3000, age: 50 });
  photo(path.join(P, 'holiday', 'IMG_001 (1).jpg'), A, { kb: 150, w: 1000, h: 750, age: 20 });                // a smaller copy of the same picture
  photo(path.join(P, 'whatsapp', 'IMG-2024-WA0001.jpg'), variant(A, 2), { kb: 90, w: 1280, h: 960, age: 5 });  // re-saved with a little change (distance ≤ 6)
  photo(path.join(P, 'holiday', 'beach.png'), B, { kb: 300, w: 2000, h: 1500, age: 40 });
  photo(path.join(P, 'other', 'beach copy.png'), B, { kb: 300, w: 2000, h: 1500, age: 30 });                    // exactly the same size: older one is kept
  photo(path.join(P, 'other', 'different.jpg'), C, { kb: 200 });                                                // unrelated
  photo(path.join(P, 'other', 'tiny.jpg'), A, { kb: 10 });                                                       // under 30 KB: ignored
  photo(path.join(P, 'other', 'notes.txt'), A, { kb: 200 });                                                     // not a picture
  photo(path.join(P, 'other', 'broken.jpg'), A, { kb: 60 }); fs.writeFileSync(path.join(P, 'other', 'broken.jpg'), Buffer.alloc(60 * 1024, 1));   // cannot be read
  photo(path.join(P, 'node_modules', 'x', 'a.jpg'), A, { kb: 200 });
  let r = await dc.findSimilarPhotos({});
  const names = g => [g.keep.path, ...g.copies.map(c => c.path)].map(x => path.basename(x)).sort().join('|');
  check('photos: the 3 versions of one picture (even re-saved, smaller, different size) form one set; the 2 PNG copies another; the unrelated one, the tiny one, the text file, node_modules and the unreadable one are left out', r.groups.length === 2 && r.groups.some(g => names(g) === 'IMG-2024-WA0001.jpg|IMG_001 (1).jpg|IMG_001.jpg') && r.groups.some(g => names(g) === 'beach copy.png|beach.png') && r.scanned === 7 && r.unreadable === 1, { g: r.groups.map(names), scanned: r.scanned, unreadable: r.unreadable });
  const g1 = r.groups.find(g => /IMG_001/.test(names(g)));
  check('photos: the biggest picture (most pixels) is kept, the others are the extras, each with how alike it is', path.basename(g1.keep.path) === 'IMG_001.jpg' && g1.copies.length === 2 && g1.copies.every(c => c.distance <= 6) && g1.copies.some(c => c.distance > 0) && g1.copies.some(c => c.distance === 0), g1);
  const g2 = r.groups.find(g => /beach/.test(names(g)));
  check('photos: for the same picture twice with the same size, the older copy is kept', path.basename(g2.keep.path) === 'beach.png' && path.basename(g2.copies[0].path) === 'beach copy.png');
  check('photos: the space the extras take is counted, and the plan lists exactly the extras', r.wasted === (150 + 90 + 300) * 1024 && r.items.length === 3 && r.items.every(i => i.group >= 0) && r.hashedNow === 6);
  // cache
  hashCalls = []; const r2 = await dc.findSimilarPhotos({});
  check('photos: a second look reads nothing again (fingerprints, and pictures that could not be read, are cached by path, size and date), and gives the same sets', hashCalls.length === 0 && r2.cached === 6 && r2.unreadable === 1 && r2.hashedNow === 0 && r2.groups.length === 2, { calls: hashCalls.length, cached: r2.cached, unreadable: r2.unreadable });
  check('photos: the cache is a small file in .diskcare, not in the pictures folder', exists(path.join(SANDBOX, '.diskcare', 'photohash.json')) && fs.readdirSync(path.join(P, 'holiday')).every(f => !/hash/i.test(f)));
  photo(path.join(P, 'other', 'different.jpg'), variant(C, 1), { kb: 200 });                                    // changed on disk: must be read again, and only it
  hashCalls = []; await dc.findSimilarPhotos({});
  check('photos: only the changed picture is read again', hashCalls.length === 1 && hashCalls[0].length === 1 && /different\.jpg$/.test(hashCalls[0][0]), hashCalls);
  // threshold
  check('photos: distance limit is respected (a picture 2 bits away joins, 20 bits away does not)', ScanMath.hamming(ScanMath.dHash(A), ScanMath.dHash(variant(A, 2))) <= 6 && ScanMath.hamming(ScanMath.dHash(A), ScanMath.dHash(E)) > 6);
  // time budget → partial, progress kept
  fs.rmSync(path.join(SANDBOX, '.diskcare', 'photohash.json'));
  const T = path.join(root, 'many'); for (let i = 0; i < 7; i++) photo(path.join(T, 'p' + i + '.jpg'), pattern(), { kb: 40 });
  let ticks = 0; const dcSlow = D.createDiskCare(mkDeps({ allRoots: () => [T], hashImages: fakeHash, now: () => (ticks++ > 4 ? Date.now() + 1e9 : Date.now()) }));
  const old = D.LIMITS.hashBatch; D.LIMITS.hashBatch = 2;
  const pr = await dcSlow.findSimilarPhotos({ ms: 1 }); D.LIMITS.hashBatch = old;
  check('photos: when time runs out it says so, keeps what it read, and the next look carries on', pr.partial === true && (pr.remaining >= 0), { partial: pr.partial, hashedNow: pr.hashedNow, remaining: pr.remaining });
  // project protection
  const PR = path.join(root, 'proj'); const dcP = D.createDiskCare(mkDeps({ allRoots: () => [PR], hashImages: fakeHash }));
  fs.mkdirSync(path.join(PR, 'App'), { recursive: true }); fs.writeFileSync(path.join(PR, 'App', 'package.json'), '{}');
  const L = pattern();
  photo(path.join(PR, 'App', 'public', 'logo.jpg'), L, { kb: 80, w: 500, h: 500, age: 1 }); photo(path.join(PR, 'Misc', 'logo-big.jpg'), L, { kb: 200, w: 1000, h: 1000, age: 60 }); photo(path.join(PR, 'Misc2', 'logo-big2.jpg'), L, { kb: 190, w: 900, h: 900, age: 60 });
  const pp = await dcP.findSimilarPhotos({});
  check('photos: a picture inside a project is KEPT even if it is smaller; only the loose copies are proposed, never the project one', pp.groups.length === 1 && /[\\/]App[\\/]/.test(pp.groups[0].keep.path) && pp.groups[0].copies.every(c => !/[\\/]App[\\/]/.test(c.path)) && pp.items.every(i => !/[\\/]App[\\/]/.test(i.from)), pp.groups.map(names));
  const PR2 = path.join(root, 'proj2'); fs.mkdirSync(path.join(PR2, 'A'), { recursive: true }); fs.mkdirSync(path.join(PR2, 'B'), { recursive: true }); fs.writeFileSync(path.join(PR2, 'A', 'package.json'), '{}'); fs.writeFileSync(path.join(PR2, 'B', 'requirements.txt'), 'x');
  photo(path.join(PR2, 'A', 'i.jpg'), L, { kb: 80 }); photo(path.join(PR2, 'B', 'i.jpg'), L, { kb: 80 });
  const pp2 = await D.createDiskCare(mkDeps({ allRoots: () => [PR2], hashImages: fakeHash })).findSimilarPhotos({});
  check('photos: when every copy is in a project, nothing is proposed and they are counted as protected', pp2.groups.length === 0 && pp2.items.length === 0 && pp2.protectedCopies === 1);
  // apply + undo (the generic move-to-trash path)
  const id = dc.savePlan('photos', { items: r.items, groups: r.groups, approvalPaths: [P] });
  const run = dc.applyMoves(dc.getPlan(id));
  check('photos: apply moves only the extras to the JARVIS trash; the kept pictures and the unrelated one stay', run.moved === 3 && exists(path.join(P, 'holiday', 'IMG_001.jpg')) && exists(path.join(P, 'holiday', 'beach.png')) && exists(path.join(P, 'other', 'different.jpg')) && !exists(path.join(P, 'holiday', 'IMG_001 (1).jpg')) && !exists(path.join(P, 'other', 'beach copy.png')) && !exists(path.join(P, 'whatsapp', 'IMG-2024-WA0001.jpg')), run);
  const un = dc.undoRun(run.runId);
  check('photos: undo brings all three back', un.restored === 3 && exists(path.join(P, 'holiday', 'IMG_001 (1).jpg')) && exists(path.join(P, 'other', 'beach copy.png')) && exists(path.join(P, 'whatsapp', 'IMG-2024-WA0001.jpg')));

  /* ================= shrink ================= */
  const S = path.join(root, 'shots'); fs.mkdirSync(S, { recursive: true });
  const jpegBytes = (n, fill = 3) => { const b = Buffer.alloc(n, fill); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[n - 2] = 0xFF; b[n - 1] = 0xD9; return b; };
  const mkBig = (p, mb, age = 120, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content || jpegBytes(Math.round(mb * MB))); setAge(p, age); };
  mkBig(path.join(S, 'Trip', 'DSC_1.JPG'), 5, 200); mkBig(path.join(S, 'Trip', 'DSC_2.jpeg'), 4, 120); mkBig(path.join(S, 'Trip', 'small.jpg'), 1, 300);
  mkBig(path.join(S, 'Trip', 'recent.jpg'), 6, 10); mkBig(path.join(S, 'Trip', 'pic.png'), 6, 300, Buffer.alloc(6 * MB, 1)); mkBig(path.join(S, 'Trip', 'movie.mp4'), 6, 300, Buffer.alloc(6 * MB, 2));
  fs.mkdirSync(path.join(S, 'App'), { recursive: true }); fs.writeFileSync(path.join(S, 'App', 'package.json'), '{}'); mkBig(path.join(S, 'App', 'assets', 'hero.jpg'), 8, 400);
  const calls = [];
  const fakeShrink = (mode = 'ok') => async jobs => { calls.push(jobs.map(j => j.from)); return jobs.map(j => {
    const size = fs.statSync(j.from).size;
    if (mode === 'fail') return { p: j.from, ok: false, e: 'out of memory' };
    if (mode === 'same') { fs.writeFileSync(j.out, jpegBytes(Math.round(size * 0.97))); return { p: j.from, ok: true, w: 100, h: 100 }; }
    if (mode === 'junk') { fs.writeFileSync(j.out, Buffer.alloc(Math.round(size * 0.3), 7)); return { p: j.from, ok: true, w: 100, h: 100 }; }
    if (mode === 'missing') return { p: j.from, ok: true, w: 100, h: 100 };
    fs.writeFileSync(j.out, jpegBytes(Math.round(size * 0.3), 9)); return { p: j.from, ok: true, w: 2560, h: 1440 };
  }); };
  const dcS = D.createDiskCare(mkDeps({ allRoots: () => [S], shrinkImages: fakeShrink('ok') }));
  const sh = await dcS.findShrinkable({});
  check('shrink: only JPEGs over 3 MB older than 90 days are offered (not the small one, the recent one, the PNG, the video, or the one inside a project), biggest first', sh.items.map(i => path.basename(i.from)).join() === 'DSC_1.JPG,DSC_2.jpeg' && sh.protectedFiles === 1, { items: sh.items.map(i => path.basename(i.from)), prot: sh.protectedFiles });
  check('shrink: the totals are right', sh.totalFound === 2 && sh.bytes === 9 * MB && Math.abs(sh.minMB - 3 / 1024) < 1e-9 && sh.olderDays === 90);
  const shMany = path.join(root, 'shmany'); for (let i = 0; i < 70; i++) mkBig(path.join(shMany, 'p' + i + '.jpg'), 3.2, 200, jpegBytes(Math.round(3.2 * MB) + i));   // 3.2 "MB" each = 3.2 KB
  const many = await D.createDiskCare(mkDeps({ allRoots: () => [shMany] })).findShrinkable({});
  check('shrink: one run is limited to 60 pictures; the rest are counted', many.items.length === 60 && many.totalFound === 70);
  const origSizes = Object.fromEntries(sh.items.map(i => [path.basename(i.from), i.size]));
  const planId = dcS.savePlan('shrink', { items: sh.items, approvalPaths: [path.join(S, 'Trip')] });
  const res = await dcS.applyShrink(dcS.getPlan(planId));
  const f1 = path.join(S, 'Trip', 'DSC_1.JPG'), f2 = path.join(S, 'Trip', 'DSC_2.jpeg');
  check('shrink: both are replaced by smaller copies (30% of the size here) under the SAME name, with the SAME date', res.moved === 2 && fs.statSync(f1).size === Math.round(5 * MB * 0.3) && fs.statSync(f2).size === Math.round(4 * MB * 0.3) && Math.abs(fs.statSync(f1).mtimeMs - (Date.now() - 200 * DAY)) < 5000 && res.saved === Math.round(9 * MB) - fs.statSync(f1).size - fs.statSync(f2).size, res);
  const j = dcS.journals().find(x => x.runId === res.runId);
  check('shrink: the ORIGINALS are in the JARVIS trash (full size), recorded in the journal as replaced', j && j.kind === 'shrink' && j.items.length === 2 && j.items.every(i => i.replaced && exists(i.to) && fs.statSync(i.to).size === origSizes[path.basename(i.from)]), j);
  check('shrink: no leftovers (no .jarvis-new files, no temp folder)', fs.readdirSync(path.join(S, 'Trip')).every(f => !/jarvis-new/.test(f)) && fs.readdirSync(path.join(SANDBOX, '.diskcare')).every(f => !/^shrink-/.test(f)));
  check('shrink: the picture in the project and the other files were not touched', fs.statSync(path.join(S, 'App', 'assets', 'hero.jpg')).size === 8 * MB && fs.statSync(path.join(S, 'Trip', 'recent.jpg')).size === 6 * MB && fs.statSync(path.join(S, 'Trip', 'pic.png')).size === 6 * MB);
  const undo = dcS.undoRun(res.runId);
  check('shrink: undo puts both originals back at full size, replacing the smaller copies', undo.restored === 2 && !undo.problems.length && fs.statSync(f1).size === 5 * MB && fs.statSync(f2).size === 4 * MB && fs.readdirSync(path.join(S, 'Trip')).every(f => !/jarvis-new/.test(f)), undo);
  // undo when the smaller copy was edited since
  const planB = dcS.savePlan('shrink', { items: (await dcS.findShrinkable({})).items, approvalPaths: [S] });
  const resB = await dcS.applyShrink(dcS.getPlan(planB));
  fs.appendFileSync(f1, Buffer.from('edited later'));
  const undoB = dcS.undoRun(resB.runId);
  check('shrink: if the smaller copy was changed after the shrink, undo leaves both and says so (nothing you did is lost)', undoB.restored === 1 && undoB.problems.length === 1 && /changed since/.test(undoB.problems[0].why) && exists(f1) && fs.readdirSync(path.join(TRASH)).length >= 0, undoB);
  // clean slate again for the refusal cases
  fs.rmSync(S, { recursive: true, force: true });
  mkBig(path.join(S, 'a.jpg'), 4, 200); mkBig(path.join(S, 'b.jpg'), 4, 200); mkBig(path.join(S, 'c.jpg'), 4, 200);
  for (const [mode, expect] of [['fail', /could not be re-saved/], ['junk', /not a valid picture/], ['missing', /not a valid picture/], ['same', /already small enough/]]) {
    const d2 = D.createDiskCare(mkDeps({ allRoots: () => [S], shrinkImages: fakeShrink(mode) }));
    const plan = d2.savePlan('shrink', { items: (await d2.findShrinkable({})).items, approvalPaths: [S] });
    const out = await d2.applyShrink(d2.getPlan(plan));
    const why = [...out.failed, ...out.skipped].map(x => x.why).join(' ');
    check('shrink refusal "' + mode + '": the originals stay exactly as they were, nothing goes to the trash, and the reason is given', out.moved === 0 && out.runId === null && ['a', 'b', 'c'].every(n => fs.statSync(path.join(S, n + '.jpg')).size === 4 * MB) && expect.test(why) && fs.readdirSync(S).every(f => /^[abc]\.jpg$/.test(f)), { mode, out });
  }
  // a file changed between the scan and the apply
  const d3 = D.createDiskCare(mkDeps({ allRoots: () => [S], shrinkImages: fakeShrink('ok') }));
  const sc3 = await d3.findShrinkable({}); const p3 = d3.savePlan('shrink', { items: sc3.items, approvalPaths: [S] });
  fs.appendFileSync(path.join(S, 'b.jpg'), 'x');
  const out3 = await d3.applyShrink(d3.getPlan(p3));
  check('shrink: a picture that changed after the scan is skipped, the others are done', out3.moved === 2 && out3.skipped.length === 1 && /changed/.test(out3.skipped[0].why) && fs.statSync(path.join(S, 'b.jpg')).size === 4 * MB + 1);
  // picks
  const d4 = D.createDiskCare(mkDeps({ allRoots: () => [S], shrinkImages: fakeShrink('ok') }));
  mkBig(path.join(S, 'd.jpg'), 4, 200, jpegBytes(4 * MB + 7)); mkBig(path.join(S, 'e.jpg'), 4, 200, jpegBytes(4 * MB + 9));
  const sc4 = await d4.findShrinkable({});
  const only = await d4.applyShrink({ ...d4.getPlan(d4.savePlan('shrink', { items: sc4.items })), }, [0]);
  check('shrink: choosing numbers shrinks only those', only.moved === 1);
  // an off-limits place
  const d5 = D.createDiskCare(mkDeps({ allRoots: () => [S], blockedPath: p => /e\.jpg$/.test(p), shrinkImages: fakeShrink('ok') }));
  const out5 = await d5.applyShrink({ items: [{ from: path.join(S, 'e.jpg'), size: 4 * MB + 9, mtimeMs: fs.statSync(path.join(S, 'e.jpg')).mtimeMs }] });
  check('shrink: an off-limits location is refused', out5.moved === 0 && out5.failed.length === 1 && /off-limits/.test(out5.failed[0].why));

  /* ================= routes ================= */
  const routes = {}, app = { post: (p, h) => { routes[p] = h; }, locals: {} };
  const approvals = [];
  D(app, { ...mkDeps({ allRoots: () => [P], hashImages: fakeHash, shrinkImages: fakeShrink('ok') }), approvedChange: (req, res, action, ...ps) => { approvals.push([action, ps]); return true; }, anyPath: n => path.resolve(n), findAllowed: () => null });
  const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
  const call = async (ep, body, headers = LAPTOP) => { let o, code = 200; await routes['/api/disk/' + ep]({ headers, body }, { headersSent: false, json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  const rp = await call('plan', { kind: 'photos' }, {});
  check('route plan photos: sets numbered from 1, each with the kept picture and the extras, a plan id, and no file contents', rp.success && rp.groupCount === 2 && rp.extraCopies === 3 && rp.groups[0].n === 1 && rp.groups[0].keep.path && rp.groups[0].copies.length >= 1 && /^[a-f0-9]{16}$/.test(rp.planId) && rp.groups.every(g => g.copies.every(c => 'distance' in c)), rp);
  check('route apply photos: from another site is refused', (await call('apply', { planId: rp.planId }, { 'sec-fetch-site': 'cross-site', host: 'localhost:3001' })).code === 403);
  check('route apply photos: a set number that does not exist is refused', (await call('apply', { planId: rp.planId, pick: [1, 9] })).code === 400);
  const ra = await call('apply', { planId: rp.planId, pick: [2] });
  check('route apply photos: only the chosen set is moved, after asking permission for those folders', ra.success && ra.kind === 'photos' && ra.moved >= 1 && ra.moved < 3 && approvals.some(a => /similar photos/.test(a[0])), ra);
  const rp2 = await call('plan', { kind: 'photos' }, {});
  check('route plan photos: after cleaning a set, the next look finds only the other set', rp2.groupCount === 1, rp2.groupCount);
  const rr = await call('undo', { runId: ra.runId });
  check('route undo: brings that set back', rr.success && rr.restored === ra.moved, rr);
  fs.rmSync(S, { recursive: true, force: true }); mkBig(path.join(S, 'big1.jpg'), 4, 200, jpegBytes(4 * MB + 11)); mkBig(path.join(S, 'big2.jpg'), 4, 200, jpegBytes(4 * MB + 13));
  D(app, { ...mkDeps({ allRoots: () => [S], shrinkImages: fakeShrink('ok') }), approvedChange: () => true, anyPath: n => path.resolve(n), findAllowed: () => null });
  const rs = await call('plan', { kind: 'shrink' }, {});
  check('route plan shrink: the pictures, the sizes, and what will be done (quality, longest side)', rs.success && rs.count === 2 && rs.bytes === 8 * MB + 24 && rs.quality === 82 && rs.maxSide === 2560 && rs.items.length === 2 && Math.abs(rs.minMB - 3 / 1024) < 1e-9, rs);
  check('route apply shrink: a number that is not in the list is refused', (await call('apply', { planId: rs.planId, pick: [5] })).code === 400);
  const rsa = await call('apply', { planId: rs.planId });
  check('route apply shrink: shrinks them, reports what was saved and where the originals are', rsa.success && rsa.moved === 2 && rsa.saved > 4 * MB && rsa.trashNote === true && rsa.runId, rsa);
  check('route plan: an unknown kind lists what it can plan, now including photos and shrink', /photos, shrink/.test((await call('plan', { kind: 'nope' }, {})).error));

  /* ================= part 2: the real Windows image tools ================= */
  if (process.platform === 'win32') {
    const ps = (script, env = {}, timeout = 60000) => new Promise(resolve => {
      const full = '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try {\n' + script + '\n} catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)) }';
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full], { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
        const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
        try { return resolve(JSON.parse(line)); } catch {}
        resolve({ error: (err && err.killed ? 'Timed out' : (stderr || (err && err.message) || 'No output')).toString().trim().split('\n')[0] });
      });
    });
    const R = path.join(root, 'real'); fs.mkdirSync(R, { recursive: true });
    // draw: a scene (three shapes + noise-free gradient) at a size, saved as JPEG at a quality; optional EXIF orientation
    const draw = async (file, w, h, { quality = 95, variantNo = 0, noise = false, orient = 1 } = {}) => {
      const out = await ps(`
Add-Type -AssemblyName System.Drawing
$w = [int]$env:W; $h = [int]$env:H; $v = [int]$env:V
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
if ($v -eq 0) {
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0,0)), ([System.Drawing.Point]::new($w,$h)), ([System.Drawing.Color]::DarkBlue), ([System.Drawing.Color]::Orange)
  $g.FillRectangle($br, 0, 0, $w, $h)
  $g.FillEllipse([System.Drawing.Brushes]::White, [int]($w*0.1), [int]($h*0.1), [int]($w*0.3), [int]($h*0.4))
  $g.FillRectangle([System.Drawing.Brushes]::Black, [int]($w*0.55), [int]($h*0.5), [int]($w*0.35), [int]($h*0.3))
} else {
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new($w,0)), ([System.Drawing.Point]::new(0,$h)), ([System.Drawing.Color]::DarkGreen), ([System.Drawing.Color]::Yellow)
  $g.FillRectangle($br, 0, 0, $w, $h)
  $g.FillRectangle([System.Drawing.Brushes]::Red, [int]($w*0.6), [int]($h*0.05), [int]($w*0.3), [int]($h*0.5))
  $g.FillEllipse([System.Drawing.Brushes]::Black, [int]($w*0.05), [int]($h*0.55), [int]($w*0.4), [int]($h*0.4))
}
if ($env:NOISE -eq '1') { $rnd = New-Object System.Random 5; for ($i = 0; $i -lt ($w * $h / 6); $i++) { $bmp.SetPixel($rnd.Next($w), $rnd.Next($h), [System.Drawing.Color]::FromArgb($rnd.Next(256), $rnd.Next(256), $rnd.Next(256))) } }
$g.Dispose()
$o = [int]$env:ORIENT
if ($o -ne 1) { $pi = [System.Runtime.Serialization.FormatterServices]::GetUninitializedObject([System.Drawing.Imaging.PropertyItem]); $pi.Id = 0x0112; $pi.Type = 3; $pi.Len = 2; $pi.Value = [byte[]]@($o, 0); $bmp.SetPropertyItem($pi) }
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$env:QUALITY)
$bmp.Save($env:OUT, $codec, $ep); $bmp.Dispose()
[Console]::Out.WriteLine('{"ok":true}')`, { W: String(w), H: String(h), V: String(variantNo), NOISE: noise ? '1' : '0', ORIENT: String(orient), QUALITY: String(quality), OUT: file });
      return out && out.ok;
    };
    const mk1 = await draw(path.join(R, 'scene.jpg'), 1600, 1200, { quality: 95 });
    const mk2 = await draw(path.join(R, 'scene small.jpg'), 640, 480, { quality: 70 });                          // the same scene, smaller and more compressed
    const mk3 = await draw(path.join(R, 'other scene.jpg'), 1600, 1200, { quality: 95, variantNo: 1 });
    check('real: the test pictures could be drawn', mk1 && mk2 && mk3 && [...fs.readdirSync(R)].length === 3, { mk1, mk2, mk3 });
    for (const f of fs.readdirSync(R)) { const p = path.join(R, f); if (fs.statSync(p).size < 30 * 1024) fs.appendFileSync(p, Buffer.alloc(31 * 1024 - fs.statSync(p).size, 0)); }   // trailing bytes keep it a valid JPEG for viewers, and over the size floor
    const dcR = D.createDiskCare(mkDeps({ allRoots: () => [R], ps }));
    const real = await dcR.findSimilarPhotos({});
    const rnames = real.groups.map(g => [g.keep.path, ...g.copies.map(c => c.path)].map(x => path.basename(x)).sort().join('|'));
    check('real: Windows image tools group the big scene with its smaller, more compressed copy, and leave the other scene alone', real.groups.length === 1 && rnames[0] === 'scene small.jpg|scene.jpg' && path.basename(real.groups[0].keep.path) === 'scene.jpg' && real.hashedNow === 3, { rnames, hashedNow: real.hashedNow, unreadable: real.unreadable, dist: real.groups.map(g => g.copies.map(c => c.distance)) });
    check('real: the fingerprints of different scenes are far apart', await (async () => { const m = await dcR.findSimilarPhotos({}); return m.cached === 3; })());

    // shrink for real: a big noisy JPEG that is older than 90 days, plus one with EXIF orientation 6 (rotated)
    const BIG = path.join(root, 'realshrink'); fs.mkdirSync(BIG, { recursive: true });
    const b1 = await draw(path.join(BIG, 'big.jpg'), 3200, 2100, { quality: 100, noise: true });
    const b2 = await draw(path.join(BIG, 'rotated.jpg'), 2800, 1900, { quality: 100, noise: true, orient: 6 });
    const sizeBig = b1 ? fs.statSync(path.join(BIG, 'big.jpg')).size : 0;
    check('real: the big test pictures exist and are over 2 MB', b1 && b2 && sizeBig > 2 * RMB && fs.statSync(path.join(BIG, 'rotated.jpg')).size > 2 * RMB, { sizeBig });
    setAge(path.join(BIG, 'big.jpg'), 200); setAge(path.join(BIG, 'rotated.jpg'), 200);
    const origBytes = Object.fromEntries(['big.jpg', 'rotated.jpg'].map(n => [n, fs.statSync(path.join(BIG, n)).size]));
    const dcB = D.createDiskCare(mkDeps({ allRoots: () => [BIG], ps }));
    const scB = await dcB.findShrinkable({});
    check('real: both are offered', scB.items.length === 2, scB.items.map(i => i.from));
    const t0 = Date.now();
    const resB2 = await dcB.applyShrink(dcB.getPlan(dcB.savePlan('shrink', { items: scB.items, approvalPaths: [BIG] })));
    check('real: both are replaced by much smaller, valid JPEGs (quality 82, longest side 2560), in ' + Math.round((Date.now() - t0) / 1000) + ' s', resB2.moved === 2 && resB2.failed.length === 0 && resB2.saved > 1 * RMB && fs.statSync(path.join(BIG, 'big.jpg')).size < origBytes['big.jpg'] * 0.9 && fs.statSync(path.join(BIG, 'rotated.jpg')).size < origBytes['rotated.jpg'] * 0.9, { resB2, sizes: fs.readdirSync(BIG).map(n => [n, fs.statSync(path.join(BIG, n)).size]) });
    const dims = await ps(`
Add-Type -AssemblyName System.Drawing
$r = @()
foreach ($n in @('big.jpg', 'rotated.jpg')) {
  $i = [System.Drawing.Image]::FromFile((Join-Path $env:DIR $n))
  $o = 0; try { $o = [int]$i.GetPropertyItem(0x0112).Value[0] } catch {}
  $r += @{ n = $n; w = $i.Width; h = $i.Height; o = $o }; $i.Dispose()
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($r) -Compress))`, { DIR: BIG });
    const dBig = (Array.isArray(dims) ? dims : []).find(x => x.n === 'big.jpg') || {}, dRot = (Array.isArray(dims) ? dims : []).find(x => x.n === 'rotated.jpg') || {};
    check('real: the longest side is now 2560 and the shape is kept (3200×2100 → 2560×1680)', dBig.w === 2560 && Math.abs(dBig.h - 1680) <= 1, dBig);
    check('real: a picture marked "rotate 90°" is really turned (2800×1900 → 1737×2560, not 2560×1737) and the rotation mark is reset, so it does not turn twice', Math.abs(dRot.w - 1737) <= 1 && dRot.h === 2560 && (dRot.o === 1 || dRot.o === 0), dRot);
    const unB = dcB.undoRun(resB2.runId);
    check('real: undo puts the full-size originals back, byte for byte in size', unB.restored === 2 && !unB.problems.length && fs.statSync(path.join(BIG, 'big.jpg')).size === origBytes['big.jpg'] && fs.statSync(path.join(BIG, 'rotated.jpg')).size === origBytes['rotated.jpg'], unB);
  } else console.log('photocare: (real Windows image checks skipped on this system)');

  clearInterval(keep);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`photocare: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
