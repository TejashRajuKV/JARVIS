'use strict';
/* JARVIS's trash, kept tidy.
     Same drive   A deleted item goes to a trash folder ON ITS OWN DRIVE (<drive>\.jarvis-trash\items), not to ~/jarvis/.trash on C:. Moving inside one drive is a
                  rename, so deleting a 20 GB folder on D: no longer copies 20 GB onto a nearly full C: first (and restoring it is a rename too).
     Find it      restore looks in ~/jarvis/.trash first, then in the trash of the drive the item came from.
     Expire       items older than 30 days are removed for good (at start and then once a day), from every trash folder JARVIS has used. Only names that look
                  like JARVIS's own trash entries (<13-digit time>_<name>) are ever removed, and only inside those folders.
   Pure functions with the file system passed in where it matters, so they are tested on temp folders. */
const fs = require('fs');
const path = require('path');

const DAY = 864e5, ENTRY = /^(\d{13})_[^\\/:*?"<>|]+$/;
const driveOf = p => path.parse(path.resolve(p)).root.toLowerCase();
const sameDrive = (a, b) => driveOf(a) === driveOf(b);
// where an item on another drive goes
const altDir = p => path.join(path.parse(path.resolve(p)).root, '.jarvis-trash', 'items');

function createTrashKeep({ TRASH, SANDBOX, now = Date.now, altDirOf = altDir }) {
  const memory = path.join(SANDBOX, '.trash-drives.json');
  const read = () => { try { const j = JSON.parse(fs.readFileSync(memory, 'utf8')); return Array.isArray(j) ? j.filter(x => typeof x === 'string') : []; } catch { return []; } };
  const remember = dir => { const all = read(); if (!all.some(x => x.toLowerCase() === dir.toLowerCase())) { all.push(dir); try { fs.writeFileSync(memory, JSON.stringify(all.slice(-30))); } catch { /* it just forgets */ } } };
  // the folder a deleted item should go to
  const dirFor = p => (sameDrive(p, SANDBOX) ? TRASH : altDirOf(p));
  // → full path of a trashed item, looking in the main trash and then in the trash of the drive of `original`; null if gone
  function locate(trashName, original) {
    if (!ENTRY.test(String(trashName || ''))) return null;
    const tries = [path.join(TRASH, trashName)];
    if (original) { try { tries.push(path.join(altDirOf(original), trashName)); } catch { /* bad path */ } }
    for (const d of read()) tries.push(path.join(d, trashName));
    return tries.find(t => { try { return fs.existsSync(t); } catch { return false; } }) || null;
  }
  // removes entries older than `days` from the main trash and every remembered drive trash → { removed, bytes? , dirs }
  function prune({ days = 30, rm = (p) => fs.rmSync(p, { recursive: true, force: true }) } = {}) {
    const cutoff = now() - days * DAY, dirs = [TRASH, ...read()], out = { removed: 0, dirs: 0, kept: 0 };
    for (const d of dirs) {
      let names; try { names = fs.readdirSync(d); } catch { continue; }
      out.dirs++;
      for (const n of names) {
        const m = n.match(ENTRY);
        if (!m) continue;                                           // anything else in there is not ours to remove
        if (+m[1] < cutoff) { try { rm(path.join(d, n)); out.removed++; } catch { out.kept++; } } else out.kept++;
      }
    }
    return out;
  }
  return { dirFor, locate, prune, remember, drives: read };
}
module.exports = { createTrashKeep, driveOf, sameDrive, altDir, ENTRY };
