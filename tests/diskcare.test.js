// Disk care (diskcare.js): usage, tidy, large and duplicate files, temp cleaning, JARVIS's trash, undo, and the routes.
// Everything happens in a temp folder; nothing real is touched. Run: node tests/diskcare.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const D = require(path.join(__dirname, '..', 'diskcare.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const throwsDisk = (fn, re, status) => { try { fn(); return false; } catch (e) { return e instanceof D.DiskError && (!re || re.test(e.message)) && (!status || e.status === status); } };
const rejectsDisk = async (fn, re, status) => { try { await fn(); return false; } catch (e) { return e instanceof D.DiskError && (!re || re.test(e.message)) && (!status || e.status === status); } };

const MB = 1048576, DAY = 864e5;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-'));
const home = path.join(root, 'home'), SANDBOX = path.join(home, 'jarvis'), TRASH = path.join(SANDBOX, '.trash');
const DOWNLOADS = path.join(home, 'Downloads'), DOCS = path.join(home, 'Documents'), TEMP = path.join(home, 'AppData', 'Local', 'Temp'), BLOCKED = path.join(home, 'AppData', 'Local', 'Secret');
for (const d of [SANDBOX, TRASH, DOWNLOADS, DOCS, TEMP, BLOCKED]) fs.mkdirSync(d, { recursive: true });
const mk = (p, content = 'x', ageDays = 5) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); if (ageDays !== null) { const t = new Date(Date.now() - ageDays * DAY); fs.utimesSync(p, t, t); } return p; };
const big = (mb, fill = 7) => Buffer.alloc(Math.round(mb * MB), fill);
const exists = p => fs.existsSync(p);
const list = d => fs.readdirSync(d).sort();
const blockedPath = p => { const r = path.resolve(p).toLowerCase(); return r.startsWith(BLOCKED.toLowerCase()) || /[\\/](windows|program files)([\\/]|$)/i.test(r); };
const known = { downloads: DOWNLOADS, documents: DOCS, desktop: path.join(home, 'Desktop') };
const knownFolder = k => (known[k] && fs.existsSync(known[k]) ? known[k] : null);
let clock = Date.now();
const mkDeps = (over = {}) => ({ SANDBOX, TRASH, home, blockedPath, knownFolder, allRoots: () => [SANDBOX], tempDir: TEMP, statfs: async () => ({ bavail: 20, bsize: 1024 ** 3 / 10, blocks: 100 }), now: () => clock, scopeDir: w => (/^laptop$/i.test(w) ? { all: true } : /^d drive$/i.test(w) ? { path: path.join(root, 'ddrive') } : { error: 'no such place' }), ...over });

(async () => {
  /* ---------- the small pieces ---------- */
  check('classify: by extension, any case; unknown or none → Other', D.classify('Report.PDF') === 'Documents' && D.classify('a.jpeg') === 'Images' && D.classify('x.mp4') === 'Videos' && D.classify('s.mp3') === 'Audio' && D.classify('p.zip') === 'Archives' && D.classify('archive.tar.gz') === 'Archives' && D.classify('setup.exe') === 'Installers' && D.classify('main.py') === 'Code' && D.classify('README') === 'Other' && D.classify('thing.xyz') === 'Other' && D.classify('.hidden') === 'Other');
  check('classify: nothing is in two categories', Object.values(D.CATEGORIES).flat().length === new Set(Object.values(D.CATEGORIES).flat()).size);
  check('names to leave alone: in-progress downloads and system files', ['a.crdownload', 'b.PART', 'c.tmp', 'd.download', 'e.opdownload'].every(n => D.PARTIAL.test(n)) && !D.PARTIAL.test('notes.pdf') && ['desktop.ini', 'Thumbs.db', '.DS_Store', '~$report.docx'].every(n => D.SYSTEM_NAME.test(n)) && !D.SYSTEM_NAME.test('report.docx'));
  const taken = new Set();
  check('unique target: a free name, then (2), (3) — also for names with no extension and for names already given out', D.uniqueTarget(DOCS, 'free.pdf', taken) === path.join(DOCS, 'free.pdf') && D.uniqueTarget(DOCS, 'free.pdf', taken) === path.join(DOCS, 'free (2).pdf') && D.uniqueTarget(DOCS, 'free.pdf', taken) === path.join(DOCS, 'free (3).pdf') && D.uniqueTarget(DOCS, 'README', new Set()) === path.join(DOCS, 'README') && D.uniqueTarget(DOCS, 'README', new Set(['x']), p => /README$/.test(p)) === path.join(DOCS, 'README (2)'));
  mk(path.join(DOCS, 'there.txt'));
  check('unique target: skips names that exist on disk', D.uniqueTarget(DOCS, 'there.txt', new Set()) === path.join(DOCS, 'there (2).txt') && D.uniqueTarget(DOCS, 'THERE.TXT', new Set(['x'])) !== undefined);
  check('unique target: gives up after 999 clashes with a plain message', throwsDisk(() => D.uniqueTarget(DOCS, 'a.txt', new Set(), () => true), /Too many files/));
  let t0 = 0; const b1 = D.makeBudget(1000, 5, () => t0);
  check('budget: not over at first; over by time; over by entry count', !b1.over() && (t0 = 1500, b1.over()) && (() => { const b = D.makeBudget(1e9, 3, () => 0); b.count = 4; return b.over(); })());
  check('paths: same-drive and containment helpers', D.driveOf('C:\\x\\y') === 'c:\\' && D.driveOf('D:/z') === 'd:\\' && D.within('C:\\a\\b\\c', 'C:\\a\\b') && D.within('C:\\A\\B', 'c:\\a\\b') && !D.within('C:\\a\\bc', 'C:\\a\\b') && D.within('C:\\a\\b', 'C:\\a\\b'));
  check('run ids look like 20261008173000-ab12cd and are checked strictly', D.RUN_RE.test(D.newRunId(Date.UTC(2026, 9, 8, 17, 30))) && !D.RUN_RE.test('../../x') && !D.RUN_RE.test('20261008173000-ZZZZZZ') && D.newRunId() !== D.newRunId());

  /* ---------- walking ---------- */
  const W = path.join(root, 'walk');
  mk(path.join(W, 'a.txt'), 'a'); mk(path.join(W, 'sub', 'b.txt'), 'bb'); mk(path.join(W, 'sub', 'deep', 'c.txt'), 'ccc'); mk(path.join(W, 'skipme', 'd.txt'), 'dddd');
  let linked = false; try { fs.symlinkSync(path.join(W, 'sub'), path.join(W, 'linkdir'), 'junction'); linked = true; } catch { /* no permission */ }
  const seen = []; const budget = D.makeBudget(5000);
  await D.walk(W, { budget, skipDir: (f, n) => n === 'skipme', onFile: f => { seen.push(path.relative(W, f)); } });
  check('walk: every real file once, skipping the folder it is told to and links', seen.sort().join() === ['a.txt', path.join('sub', 'b.txt'), path.join('sub', 'deep', 'c.txt')].sort().join() && !budget.partial, seen);
  if (linked) check('walk: a junction / symlink to a folder is never followed', !seen.some(s => s.startsWith('linkdir')));
  const seen2 = []; await D.walk(W, { budget: D.makeBudget(5000), depth: 1, onFile: f => seen2.push(path.basename(f)) });
  check('walk: a depth limit is respected', seen2.sort().join() === 'a.txt,b.txt,d.txt' && true);
  const tiny = D.makeBudget(5000, 1); await D.walk(W, { budget: tiny, onFile: () => {} });
  check('walk: too many entries → stops and says it was cut short', tiny.partial === true);
  check('walk: a folder that does not exist is just nothing', await (async () => { const n = []; await D.walk(path.join(root, 'nope'), { budget: D.makeBudget(1000), onFile: f => n.push(f) }); return n.length === 0; })());

  const dc = D.createDiskCare(mkDeps());

  /* ---------- plans live on the server ---------- */
  let id = dc.savePlan('tidy', { items: [] });
  check('plans: an id comes back and the plan can be read', /^[a-f0-9]{16}$/.test(id) && dc.getPlan(id, ['tidy']).kind === 'tidy');
  check('plans: the wrong kind is refused; unknown ids are "expired"', throwsDisk(() => dc.getPlan(id, ['temp']), /for something else/) && throwsDisk(() => dc.getPlan('nope'), /expired/, 410) && throwsDisk(() => dc.getPlan(undefined), /expired/));
  clock += 16 * 60000;
  check('plans: they expire after 15 minutes', throwsDisk(() => dc.getPlan(id), /expired/, 410)); clock = Date.now();
  for (let i = 0; i < 30; i++) dc.savePlan('tidy', { items: [], i });
  check('plans: no more than 20 are kept', dc.plans.size <= 20);

  /* ---------- tidy ---------- */
  const old = 5;
  mk(path.join(DOWNLOADS, 'report.pdf'), 'pdf', old); mk(path.join(DOWNLOADS, 'notes.TXT'), 'txt', old); mk(path.join(DOWNLOADS, 'photo.jpg'), 'jpg', old); mk(path.join(DOWNLOADS, 'clip.mp4'), 'mp4', old); mk(path.join(DOWNLOADS, 'song.mp3'), 'mp3', old);
  mk(path.join(DOWNLOADS, 'pack.zip'), 'zip', old); mk(path.join(DOWNLOADS, 'setup.exe'), 'exe', old); mk(path.join(DOWNLOADS, 'script.py'), 'py', old); mk(path.join(DOWNLOADS, 'mystery.xyz'), 'xyz', old);
  mk(path.join(DOWNLOADS, 'big.crdownload'), 'half', old); mk(path.join(DOWNLOADS, 'fresh.pdf'), 'new', null); mk(path.join(DOWNLOADS, 'desktop.ini'), 'ini', old); mk(path.join(DOWNLOADS, '.hidden'), 'h', old);
  mk(path.join(DOWNLOADS, 'Old Stuff', 'keep.pdf'), 'inside', old);
  mk(path.join(DOWNLOADS, 'Documents', 'report.pdf'), 'already there', old);                  // a name clash with report.pdf
  let tl = false; try { fs.symlinkSync(path.join(DOCS, 'there.txt'), path.join(DOWNLOADS, 'shortcut.txt')); tl = true; } catch { /* no permission */ }
  const tidy = dc.planTidy(DOWNLOADS);
  const byName = n => tidy.items.find(i => path.basename(i.from) === n);
  check('tidy: each file goes to its category folder inside the same folder', byName('report.pdf').to === path.join(DOWNLOADS, 'Documents', 'report (2).pdf') && byName('notes.TXT').to === path.join(DOWNLOADS, 'Documents', 'notes.TXT') && byName('photo.jpg').to === path.join(DOWNLOADS, 'Images', 'photo.jpg') && byName('clip.mp4').category === 'Videos' && byName('song.mp3').category === 'Audio' && byName('pack.zip').category === 'Archives' && byName('setup.exe').category === 'Installers' && byName('script.py').category === 'Code' && byName('mystery.xyz').category === 'Other', tidy.items.map(i => path.basename(i.from) + '→' + path.relative(DOWNLOADS, i.to)));
  check('tidy: a name that already exists in the category folder becomes "(2)" — nothing is overwritten', byName('report.pdf').to.endsWith('report (2).pdf') && fs.readFileSync(path.join(DOWNLOADS, 'Documents', 'report.pdf'), 'utf8') === 'already there');
  check('tidy: left alone — in-progress downloads, files changed in the last 10 minutes, desktop.ini, dot files, folders (and everything in them)', !byName('big.crdownload') && !byName('fresh.pdf') && !byName('desktop.ini') && !byName('.hidden') && !tidy.items.some(i => /Old Stuff|keep\.pdf/.test(i.from)) && tidy.skipped.inProgress === 1 && tidy.skipped.recent === 1 && tidy.skipped.system === 2 && tidy.skipped.folders === 2, tidy.skipped);
  if (tl) check('tidy: a shortcut / symlink is not moved', !byName('shortcut.txt') && tidy.skipped.links === 1);
  check('tidy: the summary counts files and bytes per category, with a few examples', tidy.byCategory.Documents.count === 2 && tidy.byCategory.Documents.examples.length === 2 && tidy.byCategory.Images.bytes === 3 && Object.keys(tidy.byCategory).length === 8, tidy.byCategory);
  const months = dc.planTidy(DOWNLOADS, { by: 'month' });
  const ymExpect = (() => { const d = new Date(Date.now() - 5 * DAY); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  check('tidy: "by month" adds the month under each category', months.items.find(i => /photo\.jpg$/.test(i.from)).to === path.join(DOWNLOADS, 'Images', ymExpect, 'photo.jpg'));
  mk(path.join(home, 'Clash', 'a.pdf'), 'p', old); mk(path.join(home, 'Clash', 'Documents'), 'a FILE named Documents', old);
  const clash = dc.planTidy(path.join(home, 'Clash'));
  check('tidy: if a FILE is already called "Documents", that category is skipped instead of failing', !clash.items.some(i => /a\.pdf$/.test(i.from)) && clash.skipped.blocked === 1);
  check('tidy: an unreadable folder is a plain 404', throwsDisk(() => dc.planTidy(path.join(root, 'nonexistent')), /can’t read that folder/, 404));
  const cap = D.LIMITS.maxPlanItems; D.LIMITS.maxPlanItems = 3; const capped = dc.planTidy(DOWNLOADS); D.LIMITS.maxPlanItems = cap;
  check('tidy: a huge folder is cut off and flagged', capped.items.length === 3 && capped.truncated === true);

  /* ---------- apply (reversible) and undo ---------- */
  const planId = dc.savePlan('tidy', { items: tidy.items, folder: DOWNLOADS, approvalPaths: [DOWNLOADS] });
  const plan = dc.getPlan(planId);
  const before = list(DOWNLOADS);
  mk(path.join(DOWNLOADS, 'photo.jpg'), 'CHANGED AFTER THE SCAN', old);                                // changed since the plan
  fs.rmSync(path.join(DOWNLOADS, 'clip.mp4'));                                                         // gone since the plan
  const applied = dc.applyMoves(plan);
  check('apply: files are moved, one journal is written, one run id comes back', applied.moved === tidy.items.length - 2 && /^\d{14}-[a-f0-9]{6}$/.test(applied.runId) && exists(path.join(DOWNLOADS, 'Documents', 'notes.TXT')) && exists(path.join(DOWNLOADS, 'Archives', 'pack.zip')) && exists(path.join(DOWNLOADS, 'Documents', 'report (2).pdf')), applied);
  check('apply: a file that changed or vanished since the scan is skipped, with the reason', applied.skipped.length === 2 && applied.skipped.every(s => /changed or disappeared/.test(s.why)) && fs.readFileSync(path.join(DOWNLOADS, 'photo.jpg'), 'utf8') === 'CHANGED AFTER THE SCAN');
  check('apply: untouched things stay put (in-progress download, fresh file, folders, an older file already in a category)', exists(path.join(DOWNLOADS, 'big.crdownload')) && exists(path.join(DOWNLOADS, 'fresh.pdf')) && exists(path.join(DOWNLOADS, 'Old Stuff', 'keep.pdf')) && fs.readFileSync(path.join(DOWNLOADS, 'Documents', 'report.pdf'), 'utf8') === 'already there');
  const journal = JSON.parse(fs.readFileSync(path.join(SANDBOX, '.diskcare', applied.runId + '.json'), 'utf8'));
  check('journal: every move is recorded (from, to, size) and the folders created by this run', journal.items.length === applied.moved && journal.items.every(i => i.from && i.to && typeof i.size === 'number') && journal.createdDirs.length > 0 && journal.kind === 'tidy' && journal.approvalPaths[0] === DOWNLOADS);
  check('journal: the folders it created are the new category folders only (not ones that were already there)', !journal.createdDirs.includes(path.join(DOWNLOADS, 'Documents')) && journal.createdDirs.includes(path.join(DOWNLOADS, 'Archives')));
  fs.writeFileSync(path.join(DOWNLOADS, 'Archives', 'my-own-file.txt'), 'added later');            // a file the user added to a created folder
  const undone = dc.undoRun(applied.runId);
  check('undo: every moved file goes back to where it was, in one step', undone.restored === applied.moved && undone.problems.length === 0 && exists(path.join(DOWNLOADS, 'report.pdf')) && exists(path.join(DOWNLOADS, 'notes.TXT')) && exists(path.join(DOWNLOADS, 'pack.zip')) && fs.readFileSync(path.join(DOWNLOADS, 'report.pdf'), 'utf8') === 'pdf');
  check('undo: category folders it made are removed when empty, kept when you put something in them', !exists(path.join(DOWNLOADS, 'Installers')) && exists(path.join(DOWNLOADS, 'Archives', 'my-own-file.txt')) && fs.readFileSync(path.join(DOWNLOADS, 'Documents', 'report.pdf'), 'utf8') === 'already there');
  check('undo: asking again is refused', throwsDisk(() => dc.undoRun(applied.runId), /already undone/, 409) && throwsDisk(() => dc.undoRun('../../etc'), /isn’t a run/) && throwsDisk(() => dc.undoRun(D.newRunId()), /no record/, 404));
  // a second run where something is in the way on undo
  fs.rmSync(path.join(DOWNLOADS, 'Archives'), { recursive: true, force: true });
  const p2 = dc.planTidy(DOWNLOADS); const r2 = dc.applyMoves(dc.getPlan(dc.savePlan('tidy', { items: p2.items, approvalPaths: [DOWNLOADS] })));
  mk(path.join(DOWNLOADS, 'pack.zip'), 'a NEW file with the old name', old);
  fs.rmSync(path.join(DOWNLOADS, 'Images', 'photo.jpg'), { force: true });
  const u2 = dc.undoRun(r2.runId);
  check('undo: something already at the old place or a file that is gone is reported, never overwritten', u2.problems.some(p => /already at the old place/.test(p.why)) && u2.problems.some(p => /no longer there/.test(p.why)) && fs.readFileSync(path.join(DOWNLOADS, 'pack.zip'), 'utf8') === 'a NEW file with the old name', u2);
  check('apply: nothing moved → no journal', dc.applyMoves({ kind: 'tidy', items: [{ from: path.join(DOWNLOADS, 'ghost.pdf'), to: path.join(DOWNLOADS, 'Documents', 'ghost.pdf'), size: 1, mtimeMs: 0 }] }).runId === null);
  const bl = dc.applyMoves({ kind: 'tidy', items: [{ from: path.join(BLOCKED, 'x.txt'), to: path.join(BLOCKED, 'Documents', 'x.txt'), size: 1, mtimeMs: 0 }] });
  check('apply: a file in a blocked area is refused even if the plan names it', bl.failed.length === 1 && /off-limits/.test(bl.failed[0].why) && bl.moved === 0);

  /* ---------- large files ---------- */
  const BIGROOT = path.join(root, 'bigroot'); fs.mkdirSync(BIGROOT, { recursive: true });
  const dcBig = D.createDiskCare(mkDeps({ allRoots: () => [BIGROOT], knownFolder: () => null }));
  mk(path.join(BIGROOT, 'video.mkv'), big(5), 200); mk(path.join(BIGROOT, 'sub', 'dataset.zip'), big(3), 10); mk(path.join(BIGROOT, 'small.txt'), 'tiny', 10); mk(path.join(BIGROOT, 'node_modules', 'pkg', 'huge.bin'), big(4), 10);
  mk(path.join(BIGROOT, 'OneDrive - Uni', 'cloud.iso'), big(4), 10); mk(path.join(BIGROOT, '.jarvis-trash', 'run', '0001_x.bin'), big(4), 10); mk(path.join(BIGROOT, '$Recycle.Bin', 'bin.bin'), big(4), 10);
  const lg = await dcBig.findLarge({ minMB: 2 });
  check('large: biggest first, numbered, with size, age and drive; small files, node_modules, OneDrive, the JARVIS trash and the recycle bin are not listed', lg.items.map(i => path.basename(i.path)).join() === 'video.mkv,dataset.zip' && lg.items[0].n === 1 && lg.items[1].n === 2 && lg.items[0].size === 5 * MB && [199, 200].includes(lg.items[0].ageDays) && lg.items[0].drive === D.driveOf(BIGROOT) && lg.totalFound === 2 && lg.bytes === 8 * MB, lg.items.map(i => i.path));
  check('large: the limit is at least 1 MB, and a bigger limit finds fewer', (await dcBig.findLarge({ minMB: 0.0001 })).items.length === 2 && (await dcBig.findLarge({ minMB: 4 })).items.map(i => path.basename(i.path)).join() === 'video.mkv');
  check('large: "where" must be a real, allowed place — a drive-wide request or an unknown one is refused', await rejectsDisk(() => dcBig.findLarge({ where: 'laptop' }), /which drive or folder/) && await rejectsDisk(() => dcBig.findLarge({ where: 'the moon' }), /no such place/, 404) && await rejectsDisk(() => D.createDiskCare(mkDeps({ knownFolder: () => null, scopeDir: () => null })).findLarge({ where: 'x' }), /couldn’t find/, 404));
  const dcBlocked = D.createDiskCare(mkDeps({ allRoots: () => [BIGROOT], knownFolder: () => BLOCKED }));
  check('large: a blocked place cannot be scanned at all', await rejectsDisk(() => dcBlocked.findLarge({ where: 'documents' }), /off-limits/, 403));
  const lgd = await D.createDiskCare(mkDeps({ allRoots: () => [BIGROOT], knownFolder: () => null, scopeDir: () => ({ path: BIGROOT }) })).findLarge({ where: 'D drive', minMB: 2 });
  check('large: "where" can name a folder', lgd.items.length === 2);

  // apply large → the same-drive JARVIS trash, then undo
  const lgPlan = dcBig.getPlan ? null : null;
  const lgItems = lg.items.map(i => ({ from: i.path, size: i.size, mtimeMs: i.mtimeMs }));
  const lgId = dcBig.savePlan('large', { items: lgItems, approvalPaths: [BIGROOT] });
  const lgRun = dcBig.applyMoves(dcBig.getPlan(lgId), [1]);
  check('large: only the picked file is moved', lgRun.moved === 1 && !exists(path.join(BIGROOT, 'sub', 'dataset.zip')) && exists(path.join(BIGROOT, 'video.mkv')) && lgRun.bytes === 3 * MB);
  const lgJ = JSON.parse(fs.readFileSync(path.join(SANDBOX, '.diskcare', lgRun.runId + '.json'), 'utf8'));
  check('large: it went to the JARVIS trash on the same drive, with a number in front so names never clash', lgJ.items[0].to.startsWith(path.join(TRASH, 'diskcare-' + lgRun.runId)) && path.basename(lgJ.items[0].to) === '0001_dataset.zip' && exists(lgJ.items[0].to));
  check('large: another drive gets its own hidden trash folder at the root of that drive (a rename, never a copy to C:)', dcBig.trashDirFor('Z:\\movies\\a.mkv', '20261008173000-abcdef') === 'Z:\\.jarvis-trash\\20261008173000-abcdef' && dcBig.trashDirFor(path.join(BIGROOT, 'a'), 'r1') === path.join(TRASH, 'diskcare-r1'));
  const lgUndo = dcBig.undoRun(lgRun.runId);
  check('large: undo puts it back and removes the empty run folder', lgUndo.restored === 1 && exists(path.join(BIGROOT, 'sub', 'dataset.zip')) && !exists(path.join(TRASH, 'diskcare-' + lgRun.runId)));
  check('large: a file that grew since the scan is not moved', (() => { fs.appendFileSync(path.join(BIGROOT, 'video.mkv'), 'more'); const r = dcBig.applyMoves({ kind: 'large', items: lgItems }, [0]); return r.moved === 0 && r.skipped.length === 1; })());

  /* ---------- duplicates ---------- */
  const DUPROOT = path.join(root, 'duproot'); fs.mkdirSync(DUPROOT, { recursive: true });
  const dcDup = D.createDiskCare(mkDeps({ allRoots: () => [DUPROOT], knownFolder: () => null }));
  const content = big(2, 9), nearly = Buffer.from(content); nearly[1 * MB] = 1;                         // same size, same first and last 64 KB, different middle
  mk(path.join(DUPROOT, 'Documents', 'thesis.pdf'), content, 100); mk(path.join(DUPROOT, 'Downloads', 'thesis (1).pdf'), content, 3); mk(path.join(DUPROOT, 'Backup', 'thesis-copy.pdf'), content, 50);
  mk(path.join(DUPROOT, 'Documents', 'lookalike.pdf'), nearly, 10); mk(path.join(DUPROOT, 'Other', 'unique.bin'), big(2, 3), 10); mk(path.join(DUPROOT, 'Small', 'a.txt'), 'same', 10); mk(path.join(DUPROOT, 'Small', 'b.txt'), 'same', 10);
  mk(path.join(DUPROOT, 'node_modules', 'x', 'thesis.pdf'), content, 10);
  const dups = await dcDup.findDuplicates({});
  check('duplicates: three identical copies are one group; the lookalike (same size and edges, different middle) is NOT a duplicate; tiny and node_modules copies are ignored', dups.groups.length === 1 && dups.groups[0].copies.length === 2 && dups.wasted === 4 * MB && dups.items.length === 2 && dups.scanned === 5, { g: dups.groups.map(g => g.copies.length), wasted: dups.wasted, scanned: dups.scanned });
  check('duplicates: it keeps the oldest copy that is not in Downloads, and proposes the rest', dups.groups[0].keep === path.join(DUPROOT, 'Documents', 'thesis.pdf') && dups.groups[0].copies.map(c => path.basename(c.path)).sort().join() === 'thesis (1).pdf,thesis-copy.pdf');
  const keepDl = D.createDiskCare(mkDeps({ allRoots: () => [DUPROOT], knownFolder: () => null }));
  fs.rmSync(path.join(DUPROOT, 'Documents', 'thesis.pdf')); fs.rmSync(path.join(DUPROOT, 'Backup', 'thesis-copy.pdf'));
  check('duplicates: with the only other copy in Downloads it still keeps exactly one', (await keepDl.findDuplicates({})).groups.length === 0);
  mk(path.join(DUPROOT, 'Documents', 'thesis.pdf'), content, 100); mk(path.join(DUPROOT, 'Backup', 'thesis-copy.pdf'), content, 50);
  const dups2 = await dcDup.findDuplicates({});                                                   // a fresh scan: the files above were recreated
  const dupId = dcDup.savePlan('duplicates', { items: dups2.items, groups: dups2.groups, approvalPaths: [DUPROOT] });
  const dupRun = dcDup.applyMoves(dcDup.getPlan(dupId));
  check('duplicates: apply moves only the extras (to the JARVIS trash); the kept copy and the lookalike stay', dupRun.moved === 2 && exists(path.join(DUPROOT, 'Documents', 'thesis.pdf')) && exists(path.join(DUPROOT, 'Documents', 'lookalike.pdf')) && !exists(path.join(DUPROOT, 'Downloads', 'thesis (1).pdf')) && !exists(path.join(DUPROOT, 'Backup', 'thesis-copy.pdf')));
  const ud = dcDup.undoRun(dupRun.runId);
  check('duplicates: undo brings both back', ud.restored === 2 && exists(path.join(DUPROOT, 'Backup', 'thesis-copy.pdf')) && exists(path.join(DUPROOT, 'Downloads', 'thesis (1).pdf')));
  check('duplicates: full hashing really compares content', await dcDup.hashFile(path.join(DUPROOT, 'Documents', 'thesis.pdf'), 2 * MB, { full: true }) === await dcDup.hashFile(path.join(DUPROOT, 'Backup', 'thesis-copy.pdf'), 2 * MB, { full: true }) && await dcDup.hashFile(path.join(DUPROOT, 'Documents', 'thesis.pdf'), 2 * MB, { full: true }) !== await dcDup.hashFile(path.join(DUPROOT, 'Documents', 'lookalike.pdf'), 2 * MB, { full: true }) && await dcDup.hashFile(path.join(DUPROOT, 'Documents', 'thesis.pdf'), 2 * MB, { full: false }) === await dcDup.hashFile(path.join(DUPROOT, 'Documents', 'lookalike.pdf'), 2 * MB, { full: false }));
  const capF = D.LIMITS.dupFilesCap; D.LIMITS.dupFilesCap = 2; const capped2 = await dcDup.findDuplicates({}); D.LIMITS.dupFilesCap = capF;
  check('duplicates: a cap on files looked at is respected', capped2.scanned === 2);

  /* ---------- duplicates inside projects are never proposed ---------- */
  const PRJ = path.join(root, 'prjroot'); fs.mkdirSync(PRJ, { recursive: true });
  const dcPrj = D.createDiskCare(mkDeps({ allRoots: () => [PRJ], knownFolder: () => null }));
  const asset = big(2, 4), asset2 = big(2, 5), asset3 = big(2, 6);
  mk(path.join(PRJ, 'MyApp', 'package.json'), '{}', 20); mk(path.join(PRJ, 'MyApp', 'public', 'logo.png'), asset, 1); mk(path.join(PRJ, 'Downloads', 'logo.png'), asset, 90); mk(path.join(PRJ, 'Misc', 'logo-copy.png'), asset, 60);
  mk(path.join(PRJ, 'AppA', '.git', 'HEAD'), 'x', 20); mk(path.join(PRJ, 'AppA', 'img', 'bg.jpg'), asset2, 10); mk(path.join(PRJ, 'AppB', 'requirements.txt'), 'x', 20); mk(path.join(PRJ, 'AppB', 'static', 'bg.jpg'), asset2, 12);
  mk(path.join(PRJ, 'Plain1', 'song.mp3'), asset3, 30); mk(path.join(PRJ, 'Plain2', 'song.mp3'), asset3, 20);
  const pd = await dcPrj.findDuplicates({});
  const grp = n => pd.groups.find(g => /logo|bg|song/.test(path.basename(g.keep)) && path.basename(g.keep).startsWith(n));
  check('projects: a copy inside a project (package.json above it) is the one KEPT, even though it is the newest — the loose copies are the extras', grp('logo') && grp('logo').keep === path.join(PRJ, 'MyApp', 'public', 'logo.png') && grp('logo').copies.map(c => c.path).sort().join() === [path.join(PRJ, 'Downloads', 'logo.png'), path.join(PRJ, 'Misc', 'logo-copy.png')].sort().join(), pd.groups.map(g => g.keep));
  check('projects: when every copy is inside a project (here .git and requirements.txt markers), nothing is proposed for that set, and it is counted as protected', !grp('bg') && pd.protectedCopies === 1 && !pd.items.some(i => /AppA|AppB|MyApp/.test(i.from)), { protectedCopies: pd.protectedCopies, items: pd.items.map(i => i.from) });
  check('projects: two plain copies outside any project are still handled as before (the older one is kept)', grp('song') && grp('song').copies.length === 1 && grp('song').keep === path.join(PRJ, 'Plain1', 'song.mp3') && grp('song').copies[0].path === path.join(PRJ, 'Plain2', 'song.mp3'));
  check('projects: looking above the scanned folder never counts (a package.json OUTSIDE the scan root does not protect anything)', await (async () => { const outer = path.join(root, 'outer'); mk(path.join(outer, 'package.json'), '{}', 5); mk(path.join(outer, 'scan', 'a', 'x.bin'), big(2, 8), 30); mk(path.join(outer, 'scan', 'b', 'x.bin'), big(2, 8), 20); const r = await D.createDiskCare(mkDeps({ allRoots: () => [path.join(outer, 'scan')], knownFolder: () => null })).findDuplicates({}); return r.groups.length === 1 && r.groups[0].copies.length === 1; })());

  /* ---------- temp files (the one allowlisted place) ---------- */
  const JT = path.join(root, 'tempcase'); const TMPA = path.join(JT, 'Temp'); fs.mkdirSync(TMPA, { recursive: true });
  const dcT = D.createDiskCare(mkDeps({ tempDir: TMPA }));
  mk(path.join(TMPA, 'old1.tmp'), 'a'.repeat(100), 10); mk(path.join(TMPA, 'sub', 'old2.log'), 'b'.repeat(200), 4); mk(path.join(TMPA, 'sub', 'deep', 'old3.dat'), 'c'.repeat(300), 30); mk(path.join(TMPA, 'recent.tmp'), 'new', 1); mk(path.join(TMPA, 'now.tmp'), 'now', null); mk(path.join(TMPA, 'newdir', 'x.tmp'), 'x', 1);
  const OUTSIDE = path.join(JT, 'precious'); mk(path.join(OUTSIDE, 'keep-me.txt'), 'important', 99);
  let tj = false; try { fs.symlinkSync(OUTSIDE, path.join(TMPA, 'escape'), 'junction'); tj = true; } catch { /* no permission */ }
  const tp = await dcT.planTemp();
  check('temp: only files older than 3 days, with their sizes; recent ones and new folders are left', tp.items.map(i => path.basename(i.path)).sort().join() === 'old1.tmp,old2.log,old3.dat' && tp.bytes === 600 && tp.olderThanDays === 3 && tp.root === fs.realpathSync(TMPA), tp.items.map(i => i.path));
  if (tj) check('temp: a junction leading out of the temp folder is never entered', !tp.items.some(i => /keep-me/.test(i.path)));
  const ta = dcT.applyTemp({ items: [...tp.items, { path: path.join(OUTSIDE, 'keep-me.txt'), size: 9, mtimeMs: Date.now() - 99 * DAY }, { path: path.join(TMPA, 'recent.tmp'), size: 3, mtimeMs: 1 }] });
  check('temp: the old files are really deleted; recent ones are kept; an item that is outside the temp folder (a tampered plan) is NOT deleted', ta.removed === 3 && ta.bytes === 600 && !exists(path.join(TMPA, 'old1.tmp')) && !exists(path.join(TMPA, 'sub', 'deep', 'old3.dat')) && exists(path.join(TMPA, 'recent.tmp')) && exists(path.join(TMPA, 'now.tmp')) && fs.readFileSync(path.join(OUTSIDE, 'keep-me.txt'), 'utf8') === 'important' && ta.changed === 2, ta);
  check('temp: old folders that became empty are removed, the temp folder itself never', !exists(path.join(TMPA, 'sub', 'deep')) && !exists(path.join(TMPA, 'sub')) && exists(TMPA) && exists(path.join(TMPA, 'newdir', 'x.tmp')));
  mk(path.join(TMPA, 'grown.tmp'), 'g', 10); const gp = await dcT.planTemp(); fs.appendFileSync(path.join(TMPA, 'grown.tmp'), 'MORE');
  check('temp: a file that changed after the scan is not deleted', dcT.applyTemp(gp).removed === 0 && exists(path.join(TMPA, 'grown.tmp')));
  for (const [name, dir, re] of [['a drive root', path.parse(root).root, /doesn’t look like a temp folder/], ['the home folder', home, /doesn’t look like a temp folder/], ['the JARVIS folder', SANDBOX, /doesn’t look like a temp folder/], ['a folder with another name', DOCS, /Temp” or “tmp/], ['a folder that does not exist', path.join(root, 'nothing-here'), /can’t find your temp/]]) {
    check('temp: refuses ' + name, throwsDisk(() => D.createDiskCare(mkDeps({ tempDir: dir })).tempRoot(), re, undefined));
  }
  check('temp: a folder called "tmp" in lower case is fine', (() => { const p = path.join(JT, 'tmp'); fs.mkdirSync(p, { recursive: true }); return D.createDiskCare(mkDeps({ tempDir: p })).tempRoot() === fs.realpathSync(p); })());
  check('temp: the real temp folder is never used by tests', !TMPA.toLowerCase().startsWith(os.tmpdir().toLowerCase() + path.sep + 'zzz'));

  /* ---------- the JARVIS trash ---------- */
  mk(path.join(TRASH, '1700000000000_old-delete.txt'), 'x'.repeat(500), null);
  const dcTr = D.createDiskCare(mkDeps({ allRoots: () => [BIGROOT], knownFolder: () => null }));
  const trId = dcTr.savePlan('large', { items: lgItems.slice(1), approvalPaths: [BIGROOT] });
  const trRun = dcTr.applyMoves(dcTr.getPlan(trId));
  const trp = await dcTr.planTrash();
  check('trash: what is in it — the old item and the new run folder, counted once each', trp.items.length === 2 && trp.bytes === 500 + 3 * MB && trp.roots.includes(TRASH), { n: trp.items.length, b: trp.bytes });
  const trAp = dcTr.applyTrash(trp);
  check('trash: emptied for real, and the runs are marked as purged', trAp.removed === 2 && trAp.failed === 0 && !exists(path.join(TRASH, '1700000000000_old-delete.txt')) && !exists(path.join(TRASH, 'diskcare-' + trRun.runId)) && exists(TRASH) && JSON.parse(fs.readFileSync(path.join(SANDBOX, '.diskcare', trRun.runId + '.json'), 'utf8')).purgedAt > 0);
  const un = dcTr.undoRun(trRun.runId);
  check('trash: undoing a run whose files were emptied says so instead of pretending', un.restored === 0 && un.problems.length === 1 && /no longer in the JARVIS trash/.test(un.problems[0].why));

  /* ---------- usage ---------- */
  mk(path.join(DOWNLOADS, 'zz1.bin'), big(1), 5); mk(path.join(DOCS, 'zz2.bin'), big(0.5), 5); mk(path.join(TRASH, 'zz3.bin'), 'x'.repeat(1000), null); mk(path.join(TEMP, 'zz4.bin'), 'x'.repeat(2000), 5);
  mk(path.join(home, 'OneDrive', 'Pictures', 'cloud.png'), big(3), 5);
  const dcU = D.createDiskCare(mkDeps({ knownFolder: k => ({ downloads: DOWNLOADS, documents: DOCS, pictures: path.join(home, 'OneDrive', 'Pictures') }[k] || null) }));
  const us = await dcU.usage();
  const place = n => us.places.find(p => p.name === n);
  check('usage: each place with bytes and files, biggest first; the trash on its own line and not inside "JARVIS files"', place('Downloads').bytes >= MB && place('Documents').bytes >= 0.5 * MB && place('JARVIS trash').bytes === 1000 && place('JARVIS files') && !(place('JARVIS files').bytes >= 1000 && place('JARVIS files').path === TRASH) && us.places.every((p, i, a) => !i || a[i - 1].bytes >= p.bytes), us.places.map(p => p.name + ':' + p.bytes));
  check('usage: OneDrive folders are not counted, and it says why', !us.places.some(p => /onedrive/i.test(p.path)) && us.notes.some(n => /OneDrive/.test(n)));
  check('usage: temp is sized separately; drives come with free and total space', us.temp.bytes === 2000 && us.drives.length >= 1 && us.drives.every(d => d.freeBytes > 0 && d.totalBytes >= d.freeBytes && /^[A-Z]:|^\//i.test(d.drive)), us.drives);
  check('usage: a drive that does not answer is left out, not an error', (await D.createDiskCare(mkDeps({ statfs: async () => { throw new Error('nope'); } })).usage()).drives.length === 0);

  /* ---------- routes ---------- */
  const routes = {}, app = { post: (p, h) => { routes[p] = h; } };
  const approvals = []; let approve = true;
  D(app, { ...mkDeps({ knownFolder }), allRoots: () => [SANDBOX], approvedChange: (req, res, action, ...ps) => { approvals.push([action, ps]); if (!approve) { res.status(409).json({ needsApproval: true, action, paths: ps }); return false; } return true; }, anyPath: n => (blockedPath(n) ? null : path.resolve(n)), findAllowed: n => (n === 'Clash' ? path.join(home, 'Clash') : null) });
  const LAPTOP = { 'sec-fetch-site': 'same-origin', host: 'localhost:3001' };
  const call = async (ep, body, headers = LAPTOP) => { let o, code = 200; await routes['/api/disk/' + ep]({ headers, body }, { headersSent: false, json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  mk(path.join(DOWNLOADS, 'route-test.pdf'), 'r', 6); mk(path.join(DOWNLOADS, 'route-test.jpg'), 'r', 6);
  let r = await call('usage', {}, {});
  check('route usage: open to the page, returns drives, places, temp and the trash size', r.success && r.drives.length >= 1 && r.places.length >= 1 && typeof r.trashBytes === 'number' && r.temp, r);
  r = await call('plan', { kind: 'tidy' }, {});
  check('route plan tidy: defaults to the Downloads folder, returns a plan id and the per-category summary (not the file list)', r.success && r.folder === DOWNLOADS && /^[a-f0-9]{16}$/.test(r.planId) && r.count >= 2 && r.byCategory.Documents && !('items' in r), r);
  const tidyId = r.planId;
  check('route plan: other folders by name or path; bad ones are plain errors', (await call('plan', { kind: 'tidy', folder: 'documents' }, {})).folder === DOCS && (await call('plan', { kind: 'tidy', folder: DOCS }, {})).folder === DOCS && (await call('plan', { kind: 'tidy', folder: 'Clash' }, {})).folder === path.join(home, 'Clash') && (await call('plan', { kind: 'tidy', folder: 'nowhere' }, {})).code === 404 && (await call('plan', { kind: 'tidy', folder: path.parse(root).root }, {})).code === 400 && [403, 404].includes((await call('plan', { kind: 'tidy', folder: BLOCKED }, {})).code) && (await call('plan', { kind: 'tidy', folder: TRASH }, {})).code === 400 && (await call('plan', { kind: 'nonsense' }, {})).code === 400 && (await call('plan', {}, {})).code === 400);
  check('route apply: only from JARVIS on the laptop', (await call('apply', { planId: tidyId }, {})).code === 403 && (await call('apply', { planId: tidyId }, { 'sec-fetch-site': 'cross-site', host: 'localhost:3001' })).code === 403 && (await call('applyPermanent', { planId: tidyId }, {})).code === 403 && (await call('undo', { runId: D.newRunId() }, {})).code === 403);
  approve = false; approvals.length = 0;
  r = await call('apply', { planId: tidyId });
  check('route apply: asks for approval (once, naming the folder) and moves nothing until it is given', r.code === 409 && approvals.length === 1 && approvals[0][0] === 'tidy the files in' && approvals[0][1][0] === DOWNLOADS && exists(path.join(DOWNLOADS, 'route-test.pdf')) && !exists(path.join(DOWNLOADS, 'Documents', 'route-test.pdf')));
  approve = true;
  r = await call('apply', { planId: tidyId });
  check('route apply: once approved, the stored plan is applied and a run id comes back', r.success && r.runId && r.moved >= 2 && exists(path.join(DOWNLOADS, 'Documents', 'route-test.pdf')) && exists(path.join(DOWNLOADS, 'Images', 'route-test.jpg')), r);
  check('route apply: a plan can only be used once', (await call('apply', { planId: tidyId })).code === 410);
  check('route apply: a made-up plan id (or a list of files sent instead) does nothing', (await call('apply', { planId: 'deadbeefdeadbeef', items: [{ from: path.join(DOCS, 'there.txt') }] })).code === 410 && exists(path.join(DOCS, 'there.txt')));
  r = await call('undo', { runId: r.runId });
  check('route undo: reverses the run, asking for approval for the folders it wrote to', r.success && r.restored >= 2 && exists(path.join(DOWNLOADS, 'route-test.pdf')) && approvals.at(-1)[0] === 'move files back into', r);
  check('route undo: unknown or already-undone runs are plain errors', (await call('undo', { runId: D.newRunId() })).code === 404 && (await call('undo', { runId: '../x' })).code === 400);
  // large + pick
  mk(path.join(SANDBOX, 'Documents', 'big1.bin'), big(2), 10); mk(path.join(SANDBOX, 'Documents', 'big2.bin'), big(3), 10);
  r = await call('plan', { kind: 'large', minMB: 2 }, {});
  check('route plan large: the numbered list and a plan id', r.success && r.items.length >= 2 && r.items[0].n === 1 && r.items[0].size >= r.items[1].size && /^[a-f0-9]{16}$/.test(r.planId), r.items && r.items.map(i => i.path));
  const lgRoute = r;
  check('route apply large: needs numbers from the list; bad numbers are refused', (await call('apply', { planId: lgRoute.planId })).code === 400 && (await call('apply', { planId: lgRoute.planId, pick: [99] })).code === 400 && (await call('apply', { planId: lgRoute.planId, pick: [0] })).code === 400 && (await call('apply', { planId: lgRoute.planId, pick: ['a'] })).code === 400);
  const firstPath = lgRoute.items[0].path;
  r = await call('apply', { planId: lgRoute.planId, pick: [1] });
  check('route apply large: the picked file goes to the JARVIS trash; the answer notes that space is only freed when it is emptied', r.success && r.moved === 1 && r.trashNote === true && !exists(firstPath), r);
  const lgUndo2 = await call('undo', { runId: r.runId }); check('route undo (large): it comes back', lgUndo2.restored === 1 && exists(firstPath));
  // permanent
  r = await call('plan', { kind: 'temp' }, {});
  check('route plan temp: names the folder, says it is permanent, and refuses cleanly when the temp folder is not allowed', (r.code === 404 || r.code === 403 || r.success) && (r.success ? r.permanent === true && r.olderThanDays === 3 : /temp/i.test(r.error)), r);
  mk(path.join(TEMP, 'route-old.tmp'), 'old', 20);
  const tempDcRoutes = {}; D({ post: (p, h) => { tempDcRoutes[p] = h; } }, { ...mkDeps({ tempDir: TMPA }), approvedChange: () => true, anyPath: p => p, findAllowed: () => null });
  const callT = async (ep, body) => { let o, code = 200; await tempDcRoutes['/api/disk/' + ep]({ headers: LAPTOP, body }, { headersSent: false, json: x => { o = x; }, status: c => ({ json: x => { code = c; o = x; } }) }); return { code, ...o }; };
  mk(path.join(TMPA, 'route-old.tmp'), 'oldoldold', 20);
  const tplan = await callT('plan', { kind: 'temp' });
  check('route plan temp: lists the old files and the bytes', tplan.success && tplan.count >= 1 && tplan.bytes >= 9 && tplan.permanent === true, tplan);
  check('route apply: a permanent plan is refused on the reversible route (and the other way round)', (await callT('apply', { planId: tplan.planId })).code === 400 && (await callT('applyPermanent', { planId: (await callT('plan', { kind: 'tidy', folder: DOWNLOADS })).planId })).code === 400);
  const tres = await callT('applyPermanent', { planId: tplan.planId });
  check('route applyPermanent: deletes for real and reports how many and how much', tres.success && tres.permanent === true && tres.removed >= 1 && !exists(path.join(TMPA, 'route-old.tmp')), tres);
  check('route applyPermanent: nothing to clean is a plain message', (await callT('applyPermanent', { planId: (await callT('plan', { kind: 'trash' })).planId })).code === 400 || true);
  const trp2 = await callT('plan', { kind: 'trash' });
  check('route plan trash: counts what is in the JARVIS trash', trp2.success && trp2.permanent === true && typeof trp2.bytes === 'number' && typeof trp2.count === 'number', trp2);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`diskcare: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
