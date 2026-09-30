// LIVE checks on your real laptop — opt-in only: npm run test:live (never part of npm test).
// Only reversible actions, always restored in `finally` even if a check fails:
//   volume and brightness: read → set a test value → read back → restore the original;
//   Notepad: opened and closed, and ONLY if no Notepad was already open (closing kills every notepad.exe).
// Never: lock, sleep, shutdown, restart, radios, closing your apps, clipboard. Data stays isolated (temp home).
'use strict';
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('live');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (process.platform !== 'win32') { console.log('live: skipped — the laptop controls are Windows-only'); process.exit(0); }
  const S = await startServer();
  const running = async app => { const r = await S.post('/api/tool/runningApps', { apps: [app] }); return (r.json.checked || []).includes(app) ? r.json.running.includes(app) : null; };
  try {
    /* ---- read-only ---- */
    check('Laptop (live)', 'system info reads CPU and RAM', typeof (await S.get('/api/tool/systemInfo')).json.cpuUsage === 'number');
    const bat = (await S.post('/api/tool/batteryStatus', {})).json;
    check('Laptop (live)', 'battery reads (' + (bat.level ?? 'no battery') + ')', bat.success);
    check('Laptop (live)', 'Wi-Fi reads', (await S.get('/api/sys/wifi')).status === 200);
    check('Laptop (live)', 'Windows theme reads', /light|dark/.test((await S.post('/api/sys/theme', {})).json.mode || ''));
    check('Laptop (live)', 'Bluetooth state reads', (await S.post('/api/sys/radio', { kind: 'bluetooth' })).status < 500);

    /* ---- volume: set, read back, restore ---- */
    const v0 = (await S.post('/api/sys/volume', {})).json.level;
    if (typeof v0 === 'number') {
      const test = v0 === 37 ? 38 : 37;
      try {
        await S.post('/api/sys/volume', { level: test });
        const back = (await S.post('/api/sys/volume', {})).json.level;
        check('Laptop (live)', 'set the volume to ' + test + '% and read it back', Math.abs(back - test) <= 1, back);
      } finally {
        await S.post('/api/sys/volume', { level: v0 });
      }
      check('Laptop (live)', 'volume restored to ' + v0 + '%', Math.abs((await S.post('/api/sys/volume', {})).json.level - v0) <= 1);
    } else check('Laptop (live)', 'volume can be read', false, v0);

    /* ---- brightness (laptop screens only) ---- */
    const b = await S.post('/api/sys/brightness', {});
    if (b.status === 501) console.log('live: brightness not available on this display — skipped');
    else {
      const b0 = b.json.level, test = b0 >= 50 ? b0 - 10 : b0 + 10;
      try {
        await S.post('/api/sys/brightness', { level: test });
        await sleep(300);
        const back = (await S.post('/api/sys/brightness', {})).json.level;
        check('Laptop (live)', 'set brightness to ' + test + '% and read it back', Math.abs(back - test) <= 2, back);
      } finally {
        await S.post('/api/sys/brightness', { level: b0 });
      }
      await sleep(300);
      check('Laptop (live)', 'brightness restored to ' + b0 + '%', Math.abs((await S.post('/api/sys/brightness', {})).json.level - b0) <= 2);
    }

    /* ---- open and close Notepad (only if you don't have one open) ---- */
    const already = await running('notepad');
    if (already === null) check('Laptop (live)', 'can tell whether Notepad is running', false);
    else if (already) console.log('live: Notepad is already open — skipped open/close so your notes are never closed');
    else {
      let opened = false;
      try {
        const o = await S.post('/api/tool/openApplication', { app: 'notepad' });
        for (let i = 0; i < 20 && !opened; i++) { await sleep(250); opened = await running('notepad'); }
        check('Laptop (live)', 'open Notepad (it starts)', o.json.success && opened, o.json);
      } finally {
        if (opened || await running('notepad')) await S.post('/api/tool/closeApplication', { app: 'notepad' });
      }
      let closed = false;
      for (let i = 0; i < 20 && !closed; i++) { await sleep(250); closed = (await running('notepad')) === false; }
      check('Laptop (live)', 'close Notepad (it stops)', closed);
    }
  } catch (e) {
    check('Harness', 'live checks ran', false, e.stack);
  } finally {
    await S.stop();
  }
  process.exit(done() ? 1 : 0);
})();
