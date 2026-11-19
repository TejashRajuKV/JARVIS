'use strict';
const path = require('node:path');
function createHotkey({ supported = process.platform === 'win32', spawn = require('node:child_process').spawn,
  onStop, save = () => {}, enabled = false } = {}) {
  let child = null, ready = false, error = '', wanted = false;
  const status = () => ({ supported, enabled: wanted, running: ready, error, shortcut: 'Ctrl+Alt+Pause' });
  function stop() { const previous = child; child = null; ready = false; if (previous) previous.kill(); }
  function set(on) {
    if (typeof on !== 'boolean') throw new Error('Use a boolean enabled value.');
    if (on && !supported) throw new Error('The emergency hotkey requires Windows.');
    if (on && child) return status();
    // Revoke the live registration before attempting persistence. A full disk or
    // configuration-write failure must never keep a disabled listener running.
    wanted = on; stop(); error = ''; save(on);
    if (!on) return status();
    const process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'emergency-hotkey.ps1')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...global.process.env, JARVIS_SAFETY_PARENT: String(global.process.pid) } });
    child = process; let buffer = '';
    process.stdout.on('data', data => {
      if (child !== process) return;
      buffer += data.toString();
      if (buffer.length > 4096) { error = 'Invalid hotkey helper output.'; stop(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (line === 'READY') ready = true;
        else if (line === 'STOP' && ready) onStop();
        else if (line === 'TAKEN') { error = 'Ctrl+Alt+Pause is already registered by another app.'; stop(); }
      }
    });
    process.stderr.on('data', () => { if (child === process) error = 'Windows hotkey helper reported an error.'; });
    process.on('error', () => { if (child === process) { error = 'Could not start the emergency hotkey.'; child = null; ready = false; } });
    process.on('exit', () => { if (child === process) { child = null; ready = false; error ||= 'The hotkey listener stopped. Re-enable it to retry.'; } });
    return status();
  }
  if (enabled && supported) set(true);
  return { status, set, close: stop };
}
function register(app, { control, getConfig, saveConfig, supported }) {
  const hotkey = createHotkey({ supported, enabled: getConfig().emergencyHotkey === true,
    save: enabled => { getConfig().emergencyHotkey = enabled; saveConfig(); }, onStop: () => control.stop() });
  process.on('exit', hotkey.close);
  app.get('/api/safety/hotkey', (_req, res) => res.set('Cache-Control', 'no-store').json(hotkey.status()));
  app.post('/api/safety/hotkey', (req, res) => { try { res.json(hotkey.set(req.body.enabled)); } catch (error) { res.status(400).json({ error: error.message }); } });
  return hotkey;
}
module.exports = { createHotkey, register };
