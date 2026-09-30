// Starts a real JARVIS server (server.js) that is fully isolated from your own data: its home directory is a fresh
// temp folder, so ~/jarvis (sandbox, settings, state, trash, backups) all live there and are deleted afterwards.
// The AI brain points at a dead port, so nothing talks to Ollama. Used by api.test.js, e2e.test.js and live.test.js.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');

const ROOT = path.join(__dirname, '..', '..');
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer({ env = {}, keepHome = false, home: reuseHome } = {}) {
  const home = reuseHome || fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { PORT: String(port), USERPROFILE: home, HOME: home, HOMEDRIVE: '', HOMEPATH: '',
      OLLAMA_URL: 'http://127.0.0.1:9', JARVIS_TEST: '1' }, env),
  });
  let log = '';
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  const base = 'http://localhost:' + port;
  // Same headers a JARVIS page on this origin sends — the server refuses anything else (server.js security block).
  const headers = { 'Content-Type': 'application/json', Origin: base, 'Sec-Fetch-Site': 'same-origin' };
  async function api(method, p, body, extra = {}) {
    const r = await fetch(base + p, { method, headers: Object.assign({}, headers, extra.headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json: json || {}, text };
  }
  const post = (p, body = {}, extra) => api('POST', p, body, extra);
  const get = (p, extra) => api('GET', p, undefined, extra);
  // Wait until it answers (first start can take a few seconds on Windows).
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error('server exited early:\n' + log);
    try { const r = await get('/api/health'); if (r.status === 200) break; } catch {}
    if (Date.now() - t0 > 20000) { child.kill(); throw new Error('server did not start in 20s:\n' + log); }
    await new Promise(r => setTimeout(r, 150));
  }
  const sandbox = path.join(home, 'jarvis');
  async function stop() {
    if (child.exitCode === null) {
      const done = new Promise(r => child.once('exit', r));
      child.kill(); await Promise.race([done, new Promise(r => setTimeout(r, 3000))]);
    }
    if (!keepHome) for (let i = 0; i < 5; i++) { try { fs.rmSync(home, { recursive: true, force: true }); break; } catch { await new Promise(r => setTimeout(r, 300)); } }
  }
  return { port, base, home, sandbox, api, post, get, stop, log: () => log };
}

// A tiny check/report helper shared by the suites: prints FAIL lines and a "name: passed/total" summary.
function suite(name) {
  const results = [];
  const check = (feature, desc, ok, detail) => {
    results.push({ feature, desc, ok: !!ok });
    if (!ok) console.log('FAIL  [' + feature + '] ' + desc + (detail !== undefined ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''));
    return !!ok;
  };
  const done = extra => {
    const bad = results.filter(r => !r.ok).length;
    console.log(name + ': ' + (results.length - bad) + '/' + results.length + (extra ? ' · ' + extra : ''));
    // Machine-readable results for tests/report.js
    if (process.env.JARVIS_REPORT_DIR) fs.writeFileSync(path.join(process.env.JARVIS_REPORT_DIR, name + '.json'), JSON.stringify(results));
    return bad;
  };
  return { check, done, results };
}

module.exports = { startServer, suite, freePort, ROOT };
