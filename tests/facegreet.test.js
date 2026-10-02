// facegreet.test.js — tests for the face recognition greeting module.
// Verifies: server endpoints (status/enroll/delete), input validation,
// browser module loads cleanly, euclidean distance calculation.
// Run: node tests/facegreet.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { startServer, suite, ROOT } = require('./lib/server');
const { check, done } = suite('facegreet');

(async () => {
  const server = await startServer();
  try {
    // ---- status endpoint (default: not enrolled) ----
    {
      const r = await server.get('/api/facegreet/status');
      check('Status', 'GET /api/facegreet/status returns 200', r.status === 200, r.status);
      check('Status', 'response has success: true', r.json.success === true);
      check('Status', 'default enrolled is false', r.json.enrolled === false);
      check('Status', 'descriptor is null when not enrolled', r.json.descriptor === null);
    }

    // ---- enroll with valid 128-number descriptor ----
    {
      const desc = Array.from({ length: 128 }, () => Math.random());
      const r = await server.post('/api/facegreet/enroll', { descriptor: desc });
      check('Enroll', 'POST with valid 128-float descriptor returns 200', r.status === 200, r.status);
      check('Enroll', 'response has success: true', r.json.success === true);
      check('Enroll', 'response has enrolled: true', r.json.enrolled === true);
    }

    // ---- status after enroll ----
    {
      const r = await server.get('/api/facegreet/status');
      check('Enroll', 'after enroll, status reports enrolled: true', r.json.enrolled === true);
      check('Enroll', 'descriptor is "present" (not the actual array — privacy)', r.json.descriptor === 'present');
    }

    // ---- enroll with invalid descriptors ----
    {
      const r = await server.post('/api/facegreet/enroll', { descriptor: [0.1, 0.2] });
      check('Validation', 'POST with 2-element descriptor → 400', r.status === 400, r.status);
      check('Validation', 'error mentions "128 numbers"', /128 numbers/.test(r.json.error), r.json.error);
    }
    {
      const r = await server.post('/api/facegreet/enroll', { descriptor: 'not an array' });
      check('Validation', 'POST with string descriptor → 400', r.status === 400);
    }
    {
      const r = await server.post('/api/facegreet/enroll', { descriptor: Array(128).fill('not a number') });
      check('Validation', 'POST with 128 strings → 400 (non-numeric)', r.status === 400);
      check('Validation', 'error mentions "non-numeric"', /non-numeric/.test(r.json.error), r.json.error);
    }
    {
      const r = await server.post('/api/facegreet/enroll', { descriptor: Array(128).fill(NaN) });
      check('Validation', 'POST with 128 NaN → 400', r.status === 400);
    }
    {
      const r = await server.post('/api/facegreet/enroll', { descriptor: Array(128).fill(Infinity) });
      check('Validation', 'POST with 128 Infinity → 400', r.status === 400);
    }
    {
      const r = await server.post('/api/facegreet/enroll', {});
      check('Validation', 'POST with no descriptor → 400', r.status === 400);
    }

    // ---- DELETE enrollment ----
    {
      const r = await server.api('DELETE', '/api/facegreet/enroll');
      check('Delete', 'DELETE returns 200', r.status === 200, r.status);
      check('Delete', 'response has success: true', r.json.success === true);
      check('Delete', 'enrolled is false after delete', r.json.enrolled === false);
      const st = await server.get('/api/facegreet/status');
      check('Delete', 'status confirms not enrolled', st.json.enrolled === false);
    }

    // ---- re-enroll after delete (idempotent) ----
    {
      const desc = Array.from({ length: 128 }, () => Math.random() * 2 - 1);  // negative values too
      const r = await server.post('/api/facegreet/enroll', { descriptor: desc });
      check('Re-enroll', 'can re-enroll after delete with negative values', r.status === 200 && r.json.enrolled === true);
    }
    {
      const r = await server.api('DELETE', '/api/facegreet/enroll');
      check('Cleanup', 'final cleanup delete succeeds', r.status === 200);
    }

  } finally {
    await server.stop();
  }

  // ---- unit test: browser module loads cleanly ----
  {
    const fakeEl = () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }, style: {}, src: '', onload: null, onerror: null, appendChild: () => {}, remove: () => {}, play: () => Promise.resolve(), muted: true, dataset: {}, addEventListener: () => {} });
    const sandbox = {
      window: {}, document: {
        readyState: 'complete', body: { dataset: { state: 'idle' }, classList: { add: () => {}, remove: () => {} } },
        createElement: () => fakeEl(),
        getElementById: () => fakeEl(),
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener: () => {}, head: { appendChild: () => {} },
      },
      navigator: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('no camera')) } },
      performance: { now: () => 0 }, setTimeout, setInterval, clearTimeout, clearInterval, console,
      JSON, Math, Date, Array, Object, String, Number, Boolean, Float32Array,
      MutationObserver: class { observe() {} disconnect() {} },
      fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
      log: () => {}, toast: () => {}, jarvisSay: () => {}, speak: () => {}, memGet: () => null,
      settings: { tts: false }, Persona: { sir: () => 'sir' }, API: '',
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    let threw = false;
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'face-greet.js'), 'utf8'), sandbox, { filename: 'face-greet.js', timeout: 3000 }); }
    catch (e) { threw = true; console.log('  crashed:', e.message); }
    check('Module', 'face-greet.js loads cleanly', threw === false, threw);
    check('Module', 'FaceGreet exposed', typeof sandbox.FaceGreet === 'object');
    check('Module', 'exposes activate/deactivate/toggle', typeof sandbox.FaceGreet.activate === 'function' && typeof sandbox.FaceGreet.deactivate === 'function' && typeof sandbox.FaceGreet.toggle === 'function');
    check('Module', 'exposes _euclideanDistance', typeof sandbox.FaceGreet._euclideanDistance === 'function');
  }

  // ---- unit test: euclidean distance calculation ----
  {
    // Load just the distance function from the module
    const fakeEl = () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }, style: {}, dataset: {}, addEventListener: () => {} });
    const sandbox = {
      window: {}, console, JSON, Math, Date, Array, Object, String, Number, Boolean, Float32Array,
      setTimeout, setInterval, clearTimeout, clearInterval,
      MutationObserver: class { observe() {} disconnect() {} },
      document: {
        readyState: 'complete', body: { dataset: {} }, addEventListener: () => {},
        createElement: () => fakeEl(),
        getElementById: () => fakeEl(),
        querySelector: () => null, querySelectorAll: () => [],
        head: { appendChild: () => {} },
      },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'face-greet.js'), 'utf8'), sandbox, { filename: 'face-greet.js', timeout: 3000 });
    const dist = sandbox.FaceGreet._euclideanDistance;
    check('Distance', 'identical vectors → distance 0', dist([1, 2, 3], [1, 2, 3]) === 0);
    check('Distance', '(0,0)-(3,4) → distance 5', dist([0, 0], [3, 4]) === 5);
    check('Distance', '128-dim identical → 0', dist(new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)) === 0);
    // 128-dim with small diff → small positive distance
    const a = new Float32Array(128).fill(0.5), b = new Float32Array(128).fill(0.5);
    b[0] = 0.6;  // one element differs by 0.1
    const d = dist(a, b);
    check('Distance', '128-dim with one 0.1 diff → ~0.1', Math.abs(d - 0.1) < 0.001, d);
    // Match threshold check
    check('Threshold', 'MATCH_THRESHOLD is 0.5', sandbox.FaceGreet.MATCH_THRESHOLD === 0.5);
    check('Threshold', 'GREET_COOLDOWN_MS is 5 minutes', sandbox.FaceGreet.GREET_COOLDOWN_MS === 5 * 60 * 1000);
  }

  process.exit(done() ? 1 : 0);
})().catch(e => { console.error('facegreet.test.js crashed:', e); process.exit(2); });
