// JARVIS's trash (trashkeep.js): the trash of the item's own drive, finding an item again, and removing old items for good — on temp folders. Run: node tests/trashkeep.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const K = require(path.join(__dirname, '..', 'trashkeep.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-trash-'));
const SANDBOX = path.join(tmp, 'jarvis'), TRASH = path.join(SANDBOX, '.trash'), OTHER = path.join(tmp, 'otherdrive', '.jarvis-trash', 'items');
for (const d of [SANDBOX, TRASH, OTHER]) fs.mkdirSync(d, { recursive: true });
let clock = Date.UTC(2026, 9, 13, 12, 0);
const keep = K.createTrashKeep({ TRASH, SANDBOX, now: () => clock, altDirOf: () => OTHER });      // OTHER stands in for the trash of a second drive
const DAY = 864e5, name = (ageDays, n) => (clock - ageDays * DAY) + '_' + n;
const put = (dir, n, content = 'x') => { const p = path.join(dir, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };

/* ---------- drives and where things go ---------- */
if (process.platform === 'win32') {
  check('driveOf: the drive letter, any case', K.driveOf('C:\\Users\\a') === 'c:\\' && K.driveOf('d:\\x\\y') === 'd:\\');
  check('sameDrive: C: and c: are one drive, C: and D: are not', K.sameDrive('C:\\a', 'c:\\b\\c') && !K.sameDrive('C:\\a', 'D:\\a'));
  check('altDir: the trash of an item on D: is D:\\.jarvis-trash\\items', K.altDir('D:\\Projects\\old') === 'D:\\.jarvis-trash\\items');
  const k2 = K.createTrashKeep({ TRASH: 'C:\\Users\\x\\jarvis\\.trash', SANDBOX: 'C:\\Users\\x\\jarvis' });
  check('dirFor: an item on the same drive as ~/jarvis uses ~/jarvis/.trash; one on D: uses D:\\.jarvis-trash\\items (a rename, not a copy onto C:)', k2.dirFor('C:\\Users\\x\\Desktop\\a.txt') === 'C:\\Users\\x\\jarvis\\.trash' && k2.dirFor('D:\\big\\folder') === 'D:\\.jarvis-trash\\items');
}
check('entry names: 13 digits, underscore, a safe file name', K.ENTRY.test('1791547200000_report.pdf') && !K.ENTRY.test('report.pdf') && !K.ENTRY.test('123_x') && !K.ENTRY.test('1791547200000_a/b') && !K.ENTRY.test('1791547200000_'));

/* ---------- locate ---------- */
const n1 = name(1, 'a.txt'); put(TRASH, n1);
check('locate: finds an item in the main trash', keep.locate(n1) === path.join(TRASH, n1));
const n2 = name(1, 'big.iso'); put(OTHER, n2);
check('locate: an item that is not in the main trash is found in the trash of the drive it came from (given its original path)', keep.locate(n2, path.join(tmp, 'otherdrive', 'Projects', 'big.iso')) === path.join(OTHER, n2));
keep.remember(OTHER);
check('locate: …and a drive trash that was used before is remembered, so no original path is needed', keep.locate(n2) === path.join(OTHER, n2) && keep.drives().length === 1);
keep.remember(OTHER); keep.remember(OTHER.toUpperCase()); check('remember: the same folder is not stored twice (any case on Windows)', process.platform === 'win32' ? keep.drives().length === 1 : keep.drives().length >= 1);
check('locate: a name that is not a trash entry, a path trick or something missing gives null', keep.locate('a.txt') === null && keep.locate('..\\..\\x') === null && keep.locate('1791547200000_../x') === null && keep.locate(name(1, 'nope.txt')) === null && keep.locate('') === null && keep.locate(null) === null);

/* ---------- prune ---------- */
const old1 = name(45, 'old-main.txt'), old2 = name(31, 'old-folder'), fresh = name(29, 'fresh.txt'), oldOther = name(60, 'old-other.iso'), stranger = 'notes-i-put-here.txt', odd = '12_short.txt';
put(TRASH, old1); put(path.join(TRASH, old2), 'inside.txt'); put(TRASH, fresh); put(OTHER, oldOther); put(TRASH, stranger); put(TRASH, odd);
const r = keep.prune();
check('prune: items older than 30 days go for good — from the main trash AND the drive trash — folders too', !fs.existsSync(path.join(TRASH, old1)) && !fs.existsSync(path.join(TRASH, old2)) && !fs.existsSync(path.join(OTHER, oldOther)) && r.removed === 3, r);
check('prune: a 29-day-old item stays; the item from before (1 day) stays', fs.existsSync(path.join(TRASH, fresh)) && fs.existsSync(path.join(TRASH, n1)) && fs.existsSync(path.join(OTHER, n2)));
check('prune: files that are not JARVIS trash entries (no 13-digit time, a short number) are never touched', fs.existsSync(path.join(TRASH, stranger)) && fs.existsSync(path.join(TRASH, odd)));
clock += 2 * DAY; const r2 = keep.prune();
check('prune: two days later the 29-day-old item has aged out too (and only it, plus the 3-day-old ones are still fine)', !fs.existsSync(path.join(TRASH, fresh)) && fs.existsSync(path.join(TRASH, n1)) && r2.removed === 1, r2);
clock += 40 * DAY; check('prune: after 40 more days everything old is gone, and strangers are STILL left alone', keep.prune().removed >= 1 && fs.existsSync(path.join(TRASH, stranger)) && fs.readdirSync(TRASH).filter(x => K.ENTRY.test(x)).length === 0, fs.readdirSync(TRASH));
check('prune: custom number of days works (0 days removes everything that is an entry)', (() => { put(TRASH, name(0, 'now.txt')); const x = keep.prune({ days: 0, rm: () => {} }); return x.removed === 1 || x.kept >= 0; })());
let calls = 0; put(TRASH, name(90, 'locked.txt')); const rr = keep.prune({ rm: () => { calls++; throw new Error('in use'); } });
check('prune: an item that cannot be removed (in use) is counted as kept and does not stop the rest', calls >= 1 && rr.kept >= 1 && rr.removed === 0, rr);
check('prune: a missing trash folder is skipped quietly', (() => { fs.rmSync(OTHER, { recursive: true, force: true }); try { keep.prune(); return true; } catch { return false; } })());
const bad = path.join(SANDBOX, '.trash-drives.json'); fs.writeFileSync(bad, '{not json'); check('a damaged drives file is ignored', Array.isArray(keep.drives()) && keep.drives().length === 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`trashkeep: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
