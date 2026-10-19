'use strict';
/* One JARVIS per user. However the server is started (desktop icon, `npm start`, an AI tool, VS Code), a second copy
   would keep its own chat in memory, open a second ntfy stream and start a second wake-word listener. So the first
   copy takes ~/jarvis/.jarvis.lock; a later start finds it, says where JARVIS is, and exits. A lock left behind by
   a crash (its process is gone) is simply replaced. Set JARVIS_ALLOW_MULTI=1 to run several on purpose. */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const HOME = path.join(os.homedir(), 'jarvis');
const LOCK = path.join(HOME, '.jarvis.lock');
const PID_FILE = path.join(HOME, '.jarvis.pid');
const PORT_FILE = path.join(HOME, '.jarvis-port');

// Is `pid` a live process (on Windows: a node.exe, so a reused pid number doesn't count)?
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  if (process.platform !== 'win32') return true;
  try {
    const out = execFileSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return /"node(\.exe)?"/i.test(out);
  } catch { return true; }   // can't tell: trust the signal check
}
const readLock = () => { try { const j = JSON.parse(fs.readFileSync(LOCK, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };

// The port a start with no PORT setting should use: the one remembered from last time (3000–3010), else 3000.
function rememberedPort() {
  try { const n = parseInt(fs.readFileSync(PORT_FILE, 'utf8'), 10); if (n >= 3000 && n <= 3010) return n; } catch {}
  return 3000;
}

// Take the lock. Returns { running: true, port, pid } when another JARVIS already holds it, else { running: false, release, update }.
function claim(port) {
  if (process.env.JARVIS_ALLOW_MULTI === '1') return { running: false, release() {}, update() {} };
  fs.mkdirSync(HOME, { recursive: true });
  const body = () => JSON.stringify({ pid: process.pid, port, started: new Date().toISOString(), dir: path.resolve(__dirname) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(LOCK, body(), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') return { running: false, release() {}, update() {} };   // can't lock (read-only home?): run anyway
      const cur = readLock();
      if (cur && cur.pid !== process.pid && alive(cur.pid)) return { running: true, port: cur.port, pid: cur.pid };
      try { fs.unlinkSync(LOCK); } catch {}   // stale: its process is gone
      if (attempt === 2) return { running: false, release() {}, update() {} };
    }
  }
  const mine = () => { const l = readLock(); return l && l.pid === process.pid; };
  const release = () => { try { if (mine()) fs.unlinkSync(LOCK); } catch {} try { if (String(fs.readFileSync(PID_FILE, 'utf8')).trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {} };
  process.on('exit', release);
  return {
    running: false, release,
    // Once listening: record the real port, and leave the pid and port where the launcher and Stop JARVIS look.
    update(p) {
      try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port: p, started: new Date().toISOString(), dir: path.resolve(__dirname) })); } catch {}
      try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
      try { fs.writeFileSync(PORT_FILE, String(p)); } catch {}
    },
  };
}

module.exports = { claim, rememberedPort, alive, readLock, LOCK };
