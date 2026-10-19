// Creates new files without following links. O_EXCL alone is not enough on Windows: opening a dangling symlink
// with 'wx' creates the link's target, so a link planted in ~/jarvis/Documents could redirect a write anywhere.
'use strict';
const fs = require('fs'), path = require('path');

const err = (code, msg) => Object.assign(new Error(msg), { code });

// Writes data to a file that must not exist yet (not even as a dangling link). Throws EEXIST if anything is there.
function writeExclusive(file, data, mode = 0o600) {
  try { fs.lstatSync(file); throw err('EEXIST', 'File already exists: ' + file); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const fd = fs.openSync(file, 'wx', mode);
  try {
    // A link swapped in between lstat and open would make the descriptor point elsewhere: check before writing.
    const opened = fs.fstatSync(fd), here = fs.lstatSync(file);
    if (here.isSymbolicLink() || !here.isFile() || opened.ino !== here.ino || opened.dev !== here.dev)
      throw err('ELINK', 'Refusing to write through a link: ' + file);
    fs.writeFileSync(fd, data);
  } finally { fs.closeSync(fd); }
  return file;
}

// Writes data to the first free name nameFor(1), nameFor(2), … in dir; anything already there (files, folders, links) is skipped.
function writeUnique(dir, nameFor, data, { mode = 0o600, max = 1000 } = {}) {
  for (let n = 1; n <= max; n++) {
    const file = path.join(dir, path.basename(nameFor(n)));
    try { return writeExclusive(file, data, mode); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw err('ETOOMANY', 'Too many files with that name already exist');
}

module.exports = { writeExclusive, writeUnique };
