// Creating new files without following links (safewrite.js): existing files, existing and dangling symlinks, folders,
// unique names and many writers at once — on a temp folder. Run: node tests/safewrite.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const W = require(path.join(__dirname, '..', 'safewrite.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const code = fn => { try { fn(); return null; } catch (e) { return e.code; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-safewrite-'));
const dir = path.join(tmp, 'Documents'), outside = path.join(tmp, 'outside');
fs.mkdirSync(dir); fs.mkdirSync(outside);

(async () => {
  try {
    /* ---------- writeExclusive ---------- */
    const a = path.join(dir, 'a.txt');
    check('writeExclusive: a new file is created with the data', W.writeExclusive(a, 'hello') === a && fs.readFileSync(a, 'utf8') === 'hello');
    check('writeExclusive: an existing file is EEXIST and left unchanged', code(() => W.writeExclusive(a, 'other')) === 'EEXIST' && fs.readFileSync(a, 'utf8') === 'hello');
    fs.mkdirSync(path.join(dir, 'sub'));
    check('writeExclusive: an existing folder is EEXIST', code(() => W.writeExclusive(path.join(dir, 'sub'), 'x')) === 'EEXIST');
    check('writeExclusive: a missing parent folder is an error, not a silent mkdir', code(() => W.writeExclusive(path.join(dir, 'nope', 'b.txt'), 'x')) === 'ENOENT');

    let links = true;
    const dangling = path.join(dir, 'dangling.txt'), target = path.join(outside, 'created-by-link.txt');
    const live = path.join(dir, 'live.txt'), liveTarget = path.join(outside, 'secret.txt');
    fs.writeFileSync(liveTarget, 'secret');
    try { fs.symlinkSync(target, dangling, 'file'); fs.symlinkSync(liveTarget, live, 'file'); }
    catch (e) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) throw e; links = false; console.log('SKIP symlink checks: this environment does not permit creating symlinks'); }
    if (links) {
      check('writeExclusive: a dangling symlink is EEXIST and its target is NOT created', code(() => W.writeExclusive(dangling, 'x')) === 'EEXIST' && !fs.existsSync(target));
      check('writeExclusive: a symlink to an existing file is EEXIST and the target is unchanged', code(() => W.writeExclusive(live, 'x')) === 'EEXIST' && fs.readFileSync(liveTarget, 'utf8') === 'secret');
    }

    /* ---------- writeUnique ---------- */
    const name = n => n === 1 ? 'report.txt' : 'report (' + n + ').txt';
    const r1 = W.writeUnique(dir, name, 'one'), r2 = W.writeUnique(dir, name, 'two');
    check('writeUnique: the first free name is used, then (2)', path.basename(r1) === 'report.txt' && path.basename(r2) === 'report (2).txt' && fs.readFileSync(r1, 'utf8') === 'one');
    if (links) {
      const d = W.writeUnique(dir, n => n === 1 ? 'dangling.txt' : 'dangling (' + n + ').txt', 'safe');
      check('writeUnique: a dangling symlink name is skipped; the data goes to (2) inside the folder', path.basename(d) === 'dangling (2).txt' && fs.readFileSync(d, 'utf8') === 'safe' && !fs.existsSync(target));
      const l = W.writeUnique(dir, n => n === 1 ? 'live.txt' : 'live (' + n + ').txt', 'safe');
      check('writeUnique: a symlink to a real file is skipped and the target is untouched', path.basename(l) === 'live (2).txt' && fs.readFileSync(liveTarget, 'utf8') === 'secret');
    }
    const esc = W.writeUnique(dir, () => '../../escape.txt', 'x');
    check('writeUnique: a path in the name cannot leave the folder (only its last part is used)', path.dirname(esc) === dir && path.basename(esc) === 'escape.txt' && !fs.existsSync(path.join(tmp, 'escape.txt')));
    check('writeUnique: gives up with ETOOMANY when every name is taken', code(() => W.writeUnique(dir, () => 'a.txt', 'x', { max: 3 })) === 'ETOOMANY');

    /* ---------- many writers at once ---------- */
    const race = path.join(tmp, 'race'); fs.mkdirSync(race);
    const script = `const W = require(${JSON.stringify(path.join(__dirname, '..', 'safewrite.js'))});
      for (let i = 0; i < 20; i++) W.writeUnique(${JSON.stringify(race)}, n => n === 1 ? 'same.txt' : 'same (' + n + ').txt', process.argv[1] + ':' + i);`;
    const runs = Array.from({ length: 4 }, (_, k) => new Promise(res => {
      const c = spawn(process.execPath, ['-e', script, 'w' + k], { stdio: 'ignore', windowsHide: true });
      c.on('exit', status => res(status));
    }));
    const statuses = await Promise.all(runs);
    const files = fs.readdirSync(race), contents = new Set(files.map(f => fs.readFileSync(path.join(race, f), 'utf8')));
    check('writeUnique: 4 processes × 20 writes of the same name give 80 distinct files, none overwritten', statuses.every(s => s === 0) && files.length === 80 && contents.size === 80, { statuses, files: files.length, contents: contents.size });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`safewrite: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
