// End-to-end: the real JARVIS page, in headless Edge/Chrome, against an isolated server (temp home, AI offline).
// Drives the browser over the DevTools protocol with Node's built-in WebSocket — no Puppeteer/Playwright.
// Injects tests/e2e/selftest.js, which fakes every laptop action and runs each feature through the chat pipeline.
// Skips (passes with a note) when no Edge/Chrome is installed. Run: node tests/e2e.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('e2e');

const BROWSERS = [
  process.env.JARVIS_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FAKE_SR = `(() => {
  const S = window.__sr = { made: 0, active: null, starts: 0, aborted: 0, withTrack: 0 };
  class FakeSR {
    constructor() { S.made++; this.results = []; this.lang = 'en-IN'; this.continuous = false; this.interimResults = false; }
    start(track) {
      if (this._on) throw new Error('InvalidStateError: recognition has already started');
      this._on = true; S.starts++; if (track) S.withTrack++;
      setTimeout(() => {
        if (!this._on) return;
        if (S.active && S.active !== this) { const o = S.active; S.aborted++; o._on = false; o.onerror && o.onerror({ error: 'aborted' }); o.onend && o.onend(); }
        S.active = this; this.results = []; this.onstart && this.onstart();
      }, 700);   // real Chrome takes ~0.3–1 s to start
    }
    _end() { if (!this._on) return; this._on = false; if (S.active === this) S.active = null; setTimeout(() => this.onend && this.onend(), 10); }
    stop() { this._end(); }
    abort() { this._end(); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__srSay = (text, isFinal) => {
    const r = S.active; if (!r) return false;
    const last = r.results[r.results.length - 1];
    const item = { 0: { transcript: text }, length: 1, isFinal: !!isFinal };
    if (last && !last.isFinal) r.results[r.results.length - 1] = item; else r.results.push(item);
    r.onresult && r.onresult({ resultIndex: 0, results: r.results.slice() });
    return true;
  };
})();`;
// Edge/Chrome start a tree of processes; killing only the launcher left ~10 headless browsers running per test run,
// which piled up until the machine (and the test server) choked. On Windows, end the whole tree.
function killBrowser(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') { try { require('child_process').execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  try { child.kill('SIGKILL'); } catch {}
}
// Only our test browsers: every process using a jarvis-browser-* temp profile (all of them, or just this run's).
// Edge's launcher exits once the real browser is up, so a process tree isn't enough — the profile path is the handle.
function killLeftoverTestBrowsers(profile) {
  if (process.platform !== 'win32') return;
  const match = profile ? path.basename(profile) : 'jarvis-browser-';
  try {
    require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | Where-Object { $_.CommandLine -match '" + match + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { stdio: 'ignore', timeout: 20000 });
  } catch {}
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools connection failed')); });
  let id = 0; const waiting = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { send, evaluate, close: () => ws.close() };
}

(async () => {
  const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!exe) { console.log('e2e: skipped — no Edge or Chrome found (set JARVIS_BROWSER to its path)'); process.exit(0); }
  if (typeof WebSocket === 'undefined') { console.log('e2e: skipped — needs Node 22+ (built-in WebSocket); this is ' + process.version); process.exit(0); }
  killLeftoverTestBrowsers();
  const S = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-browser-'));
  let browser = null, page = null;
  try {
    // Seed settings like a set-up install: no speech, no first-run wizard, Online tools off.
    await S.post('/api/state', { set: { 'jarvis.settings': { tts: false, sound: false, setupDone: true, online: false, wakeWord: 'jarvis' }, 'jarvis.migrated': true } });
    browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let portFile = path.join(profile, 'DevToolsActivePort'), port = 0;
    for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = +fs.readFileSync(portFile, 'utf8').split('\n')[0]; } catch {} }
    if (!port) throw new Error('the browser did not open a DevTools port');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    page = await cdp(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    // A fake speech recogniser that behaves like Chrome's: starting is asynchronous, only ONE session can run (a new
    // start aborts the running one), stop/abort end it. Tests speak into it with window.__srSay(text, isFinal).
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SR });
    // Reduced motion (an accessibility setting the app honours): replies appear at once instead of being typed out.
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.send('Page.navigate', { url: S.base + '/?skipboot' });
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) { await sleep(100); ready = await page.evaluate("typeof handleUser === 'function' && typeof Agent === 'object'").catch(() => false); }
    check('Harness', 'the page loaded in ' + path.basename(exe), ready);
    if (ready) {
      const features = JSON.parse(fs.readFileSync(path.join(__dirname, '.features.json'), 'utf8'));
      await page.evaluate('window.__features = ' + JSON.stringify(features) + ';');
      await page.evaluate(fs.readFileSync(path.join(__dirname, 'e2e', 'selftest.js'), 'utf8'));
      const t0 = Date.now();
      let finished = false;
      while (!finished && Date.now() - t0 < 600000) { await sleep(500); finished = await page.evaluate('window.__selftest && window.__selftest.done').catch(() => false); }
      check('Harness', 'the self-test finished (within 10 minutes)', finished);
      const out = await page.evaluate('JSON.stringify(window.__selftest)');
      const T = JSON.parse(out || '{"results":[]}');
      for (const x of T.results) check(x.feature, x.desc, x.ok, x.detail);
      console.log('e2e: ' + T.calls.length + ' tool calls (' + T.calls.filter(c => c.faked).length + ' faked laptop actions) in ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
  } catch (e) {
    check('Harness', 'e2e ran', false, e.stack);
  } finally {
    try { page && page.close(); } catch {}
    killBrowser(browser);
    killLeftoverTestBrowsers(profile);
    await S.stop();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  process.exit(done() ? 1 : 0);
})();
