'use strict';
/* "Keep JARVIS running" (opt-in, Settings). When on, Windows Task Scheduler runs keepalive.ps1 every 5 minutes (through keepalive.vbs, so no window flashes);
   if JARVIS is not answering it is started again, without opening the browser, and a note is left for the page ("JARVIS was restarted at 14:32").
   It never restarts a JARVIS that you stopped on purpose: "Stop JARVIS" and Settings → Stop leave ~/jarvis/.stopped-by-user until you start it yourself.
   This file only switches the task on and off and reports; the decision logic is keepalive.ps1 (tested with its -DryRun mode).
   Only a scheduled task of this user, with fixed names and arguments; nothing from the page reaches a command line. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TASK = 'JARVIS Keepalive';

function makeKeepalive({ isWin, home, cwd, run, now = Date.now }) {
  const dir = path.join(home, 'jarvis');
  const flagFile = path.join(dir, '.keepalive.json'), noteFile = path.join(dir, '.restarted.json');
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
  const taskExists = async () => { try { const r = await run('schtasks', ['/query', '/tn', TASK]); return r.code === 0; } catch { return false; } };

  async function status() {
    if (!isWin) return { supported: false, on: false };
    const flag = readJson(flagFile), exists = await taskExists();
    const note = readJson(noteFile);
    const out = { supported: true, on: !!(flag && exists), minutes: 5, restarted: note && !note.acked && note.at ? { at: Date.parse(note.at) || null } : null };
    if (flag && !exists) out.note = 'The scheduled task is missing (removed outside JARVIS). Turn it on again to recreate it.';
    if (!flag && exists) out.note = 'A task named “' + TASK + '” exists but JARVIS did not make it switch on. Turn it on again to adopt it.';
    return out;
  }
  async function set(on) {
    if (!isWin) return { ok: false, error: 'only on Windows' };
    if (on) {
      const vbs = path.join(cwd, 'keepalive.vbs');
      if (!fs.existsSync(vbs)) return { ok: false, error: 'keepalive.vbs is missing from the JARVIS folder' };
      const r = await run('schtasks', ['/create', '/tn', TASK, '/tr', 'wscript.exe //B "' + vbs + '"', '/sc', 'minute', '/mo', '5', '/f']);
      if (r.code !== 0) return { ok: false, error: 'Windows would not create the task (' + String(r.err || r.out || 'error').split('\n')[0].slice(0, 100) + ')' };
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(flagFile, JSON.stringify({ on: true, at: now() })); } catch (e) { return { ok: false, error: e.message }; }
      return { ok: true, on: true };
    }
    const r = await run('schtasks', ['/delete', '/tn', TASK, '/f']);
    try { fs.rmSync(flagFile, { force: true }); } catch {}
    if (r.code !== 0 && /ERROR/i.test(String(r.err || r.out)) && !/cannot find|does not exist/i.test(String(r.err || r.out))) return { ok: false, error: 'Windows would not remove the task (' + String(r.err || r.out).split('\n')[0].slice(0, 100) + ')' };
    return { ok: true, on: false };
  }
  const ack = () => { try { fs.rmSync(noteFile, { force: true }); } catch {} return { ok: true }; };
  return { status, set, ack, TASK };
}

const realRun = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 20000 }, (err, out, serr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || ''), err: String(serr || '') })));

module.exports = function setupKeepalive(app, { IS_WIN }) {
  const ka = makeKeepalive({ isWin: !!IS_WIN, home: os.homedir(), cwd: process.cwd(), run: realRun });
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  app.get('/api/keepalive/status', async (req, res) => res.json({ success: true, ...(await ka.status()) }));
  app.post('/api/keepalive/set', async (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Change this from JARVIS on the laptop.' });
    const r = await ka.set(!!(req.body && req.body.on));
    res.status(r.ok ? 200 : 500).json({ success: r.ok, ...r, ...(r.ok ? await ka.status() : {}) });
  });
  app.post('/api/keepalive/ack', (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Change this from JARVIS on the laptop.' });
    res.json({ success: true, ...ka.ack() });
  });
};
Object.assign(module.exports, { makeKeepalive, TASK });
