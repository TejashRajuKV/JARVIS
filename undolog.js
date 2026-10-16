'use strict';
/* "Undo" that survives a reload. The page keeps a short stack of undo actions in memory, so reloading JARVIS (or an update restart) used to forget that you had
   just deleted, moved or overwritten a file. For the file actions the server now also writes down the CALL that reverses each one — for example
   "POST /tool/restoreItem {trashName, original}" — in ~/jarvis/.undo-log.json (a private dot-file, kept 30 minutes, at most 40). When the page starts it asks
   GET /api/undo/pending and puts those back on its undo stack, with their original times. Running the reverse call removes its record, so a record is never
   offered twice.
     log.add({ label, endpoint, body })     remember how to reverse something that just happened
     log.pending()                          the records still inside the 30 minutes, oldest first
     log.consume(endpoint, body)            the reverse call ran: drop its record
   Paths in a record are full paths; two spellings of one path (case, slashes) count as the same. Pure with the clock and file passed in, so it is tested on temp files. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TTL = 30 * 60e3, MAX = 40;
const canon = v => String(v == null ? '' : v).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
// what identifies the reverse call, per endpoint (so a record can be matched when that call is made, whoever made it)
function keyOf(endpoint, body) {
  const b = body || {}, e = String(endpoint || '').replace(/^\/?(?:api\/)?/, '/');
  switch (e) {
    case '/tool/restoreItem': return e + '|' + b.trashName;
    case '/tool/restoreVersion': return e + '|' + b.backup;
    case '/tool/undoMove': return e + '|' + canon(b.to) + '|' + canon(b.from);
    case '/tool/undoCreate': return e + '|' + canon(b.name);
    default: return null;
  }
}
function createUndoLog({ file, now = Date.now }) {
  const read = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j.filter(r => r && typeof r.endpoint === 'string' && r.body && typeof r.t === 'number') : []; } catch { return []; } };
  const write = list => { try { fs.writeFileSync(file, JSON.stringify(list.slice(-MAX))); } catch { /* undo still works for this page session */ } };
  const fresh = list => { const t = now(); return list.filter(r => t - r.t <= TTL); };
  function add({ label, endpoint, body }) {
    const key = keyOf(endpoint, body); if (!key) return null;
    const list = fresh(read()).filter(r => r.key !== key);
    const rec = { id: crypto.randomBytes(6).toString('hex'), t: now(), label: String(label || 'that').slice(0, 120), endpoint, body, key };
    list.push(rec); write(list); return rec.id;
  }
  const pending = () => fresh(read()).map(({ id, t, label, endpoint, body }) => ({ id, t, label, endpoint, body }));
  function consume(endpoint, body) {
    const key = keyOf(endpoint, body); if (!key) return 0;
    const all = read(), keep = all.filter(r => r.key !== key);
    if (keep.length !== all.length) write(fresh(keep));
    return all.length - keep.length;
  }
  return { add, pending, consume, keyOf, TTL };
}
// laptop page only: the records hold full paths of your files
module.exports = function setupUndoLog(app, { SANDBOX }) {
  const log = createUndoLog({ file: path.join(SANDBOX, '.undo-log.json') });
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  app.get('/api/undo/pending', (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'The undo list can only be read from JARVIS on the laptop.' });
    res.json({ success: true, items: log.pending(), ttlMs: TTL });
  });
  return log;
};
Object.assign(module.exports, { createUndoLog, keyOf, TTL, MAX });
