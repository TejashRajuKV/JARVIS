'use strict';
/* Start with Windows (opt-in): the page's Settings toggle lands here. The server creates or removes
   a "JARVIS.lnk" in the user's Startup folder, pointing at jarvis-silent.vbs (the no-window launcher),
   so JARVIS is already running after a reboot. A JARVIS-owned shortcut is replaced/removed; a Startup
   entry pointing somewhere else is reported as "on" but never touched (it isn't ours to manage). */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function makeAutostart({ isWin, home, scriptName = 'jarvis-silent.vbs', shell = 'powershell.exe', run, exists, readlink, unlink, now = Date.now }) {
  const started = now();
  const stateFile = path.join(home, 'jarvis', '.autostart.json');
  const saveState = on => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ on, at: now() })); } catch {} };
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };

  const status = async () => {
    if (!isWin) return { supported: false, on: false };
    const lnk = path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'JARVIS.lnk');
    const target = exists(lnk) ? readlink(lnk) : '';
    if (target && !/jarvis-silent\.vbs$/i.test(target)) return { supported: true, on: true, foreign: true, target };
    if (target) return { supported: true, on: true };
    const ours = readState();
    if (ours.on) return { supported: true, on: false, note: 'The Startup entry was removed outside JARVIS. Turn it on again to recreate it.' };
    return { supported: true, on: false };
  };

  const set = async on => {
    if (!isWin) return { ok: false, error: 'only on Windows' };
    const lnk = path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'JARVIS.lnk');
    const script = path.join(process.cwd(), scriptName);
    if (!exists(script)) return { ok: false, error: 'launcher not found: ' + scriptName };
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      '$s=(New-Object -ComObject WScript.Shell).CreateShortcut(\'' + lnk.replace(/'/g, "''") + '\');' +
      '$s.TargetPath=\'' + script.replace(/'/g, "''") + '\';$s.WorkingDirectory=\'' + process.cwd().replace(/'/g, "''") + '\';' +
      '$s.WindowStyle=7;$s.Description=\'JARVIS\';$s.Save()'];
    if (on) {
      try { run(shell, args); saveState(true); return { ok: true, on: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    // Off: remove it only if it is ours. A Startup entry pointing somewhere else isn't ours to delete.
    if (exists(lnk)) {
      const target = readlink(lnk);
      if (target && !/jarvis-silent\.vbs$/i.test(target)) {
        saveState(false);
        return { ok: true, on: true, foreign: true, note: 'There is already a Startup entry pointing at ' + target + ' — left it alone.' };
      }
      try { unlink(lnk); } catch {}
    }
    saveState(false);
    return { ok: true, on: false };
  };

  return { status, set, _lnkName: 'JARVIS.lnk', _started: started };
}

function setup(app, { IS_WIN }) {
  const autostart = makeAutostart({
    isWin: !!IS_WIN, home: require('os').homedir(),
    run: (file, args) => execFile(file, args, { windowsHide: true, timeout: 15000 }, () => {}),
    exists: p => fs.existsSync(p),
    readlink: p => { try { const w = new (require('child_process').execFileSync)('powershell.exe', ['-NoProfile', '-Command', '(New-Object -ComObject WScript.Shell).CreateShortcut(\'' + String(p).replace(/'/g, "''") + '\').TargetPath'], { encoding: 'utf8', timeout: 15000, windowsHide: true }); return String(w).trim(); } catch { return ''; } },
    unlink: p => fs.unlinkSync(p),
  });

  app.get('/api/autostart', async (req, res) => {
    try { res.json({ success: true, ...(await autostart.status()) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/autostart', async (req, res) => {
    const on = !!(req.body && req.body.on);
    const r = await autostart.set(on);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(Object.assign({ success: true }, await autostart.status()));
  });
  return autostart;
}

module.exports = setup;
module.exports.makeAutostart = makeAutostart;
