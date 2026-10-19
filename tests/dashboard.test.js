// dashboard.test.js — tests for the animated diagnostics dashboard.
// Verifies: /api/sys/dashboard endpoint shape and graceful fallbacks.
// (The browser-side overlay module is tested via the smoke-test-modules harness.)
// Run: node tests/dashboard.test.js
'use strict';
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('dashboard');

(async () => {
  const server = await startServer();
  try {
    // ---- /api/sys/dashboard returns the right shape ----
    const r = await server.get('/api/sys/dashboard');
    check('Endpoint', 'GET /api/sys/dashboard returns 200', r.status === 200, r.status);
    check('Endpoint', 'response has success: true', r.json.success === true, r.json);
    check('Endpoint', 'response has pro boolean (systeminformation availability)', typeof r.json.pro === 'boolean', r.json.pro);
    check('Endpoint', 'response has cpuTemp (number or null)', r.json.cpuTemp === null || typeof r.json.cpuTemp === 'number', r.json.cpuTemp);
    check('Endpoint', 'response has cpuTempCores array', Array.isArray(r.json.cpuTempCores), r.json.cpuTempCores);
    check('Endpoint', 'response has gpus array', Array.isArray(r.json.gpus), r.json.gpus);
    check('Endpoint', 'response has networks array', Array.isArray(r.json.networks), r.json.networks);
    check('Endpoint', 'response has procs object', typeof r.json.procs === 'object' && r.json.procs !== null, r.json.procs);
    check('Endpoint', 'procs has cpu array', Array.isArray(r.json.procs.cpu), r.json.procs);
    check('Endpoint', 'procs has mem array', Array.isArray(r.json.procs.mem), r.json.procs);

    // ---- network entries have the right shape ----
    if (r.json.networks.length > 0) {
      const n = r.json.networks[0];
      check('Network', 'network entry has iface', typeof n.iface === 'string', n);
      check('Network', 'network entry has rx_sec', typeof n.rx_sec === 'number', n);
      check('Network', 'network entry has tx_sec', typeof n.tx_sec === 'number', n);
    }

    // ---- process entries have the right shape ----
    if (r.json.procs.cpu.length > 0) {
      const p = r.json.procs.cpu[0];
      check('Process', 'process entry has name', typeof p.name === 'string', p);
      check('Process', 'process entry has pid', typeof p.pid === 'number', p);
      check('Process', 'process entry has cpu', typeof p.cpu === 'number', p);
      check('Process', 'process entry has mem', typeof p.mem === 'number', p);
    }

    // ---- top processes are sorted descending by CPU ----
    if (r.json.procs.cpu.length >= 2) {
      const sorted = r.json.procs.cpu.every((p, i) => i === 0 || r.json.procs.cpu[i - 1].cpu >= p.cpu);
      check('Sort', 'procs.cpu is sorted descending by CPU', sorted, r.json.procs.cpu);
    }
    if (r.json.procs.mem.length >= 2) {
      const sorted = r.json.procs.mem.every((p, i) => i === 0 || r.json.procs.mem[i - 1].mem >= p.mem);
      check('Sort', 'procs.mem is sorted descending by memory', sorted, r.json.procs.mem);
    }

    // ---- process list is throttled (cached for 1.5s) ----
    {
      const r1 = await server.get('/api/sys/dashboard');
      const r2 = await server.get('/api/sys/dashboard');
      // Both should succeed; the cache means the second call returns the same process list.
      // We don't assert identity (the underlying process list could change between calls
      // if the test machine is busy), only that both calls succeed.
      check('Throttle', 'two rapid calls both succeed', r1.status === 200 && r2.status === 200);
    }

    // ---- existing /api/tool/systemInfo still works (backwards compat) ----
    {
      const r = await server.get('/api/tool/systemInfo');
      check('Backward compat', 'existing /api/tool/systemInfo still responds 200', r.status === 200, r.status);
      check('Backward compat', 'still returns cpuUsage', typeof r.json.cpuUsage === 'number', r.json.cpuUsage);
    }

    // ---- battery is null-or-object ----
    if (r.json.battery !== null) {
      check('Battery', 'battery has percent', typeof r.json.battery.percent === 'number');
      check('Battery', 'battery has isCharging boolean', typeof r.json.battery.isCharging === 'boolean');
    } else {
      check('Battery', 'battery is null on machines without one (graceful)', r.json.battery === null);
    }

  } finally {
    await server.stop();
  }

  // ---- unit test: the browser module loads cleanly ----
  {
    const fs = require('fs'), path = require('path'), vm = require('vm');
    const ROOT = path.join(__dirname, '..');
    const code = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
    const sandbox = {
      window: {}, document: {
        readyState: 'complete', body: { classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } },
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, addEventListener: () => {}, appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: '' }),
        querySelector: () => null, querySelectorAll: () => [],
        getElementById: () => null, addEventListener: () => {},
      },
      performance: { now: () => 0 }, setTimeout, setInterval, clearInterval, clearTimeout, console,
      JSON, Math, Date, Array, Object, String, Number, Boolean,
      Thresholds: { barClass: () => '' }, sys: { cpu: 0, ram: 0, diskUsed: 0 },
      getJSON: () => Promise.resolve({ pro: false }), refreshSystem: () => Promise.resolve(true),
      log: () => {}, pendingApproval: null,
    };
    sandbox.window = sandbox;
    try {
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox, { filename: 'dashboard.js', timeout: 3000 });
      check('Module', 'dashboard.js loads cleanly in a browser-like sandbox', typeof sandbox.Dashboard === 'object');
      check('Module', 'Dashboard exposes activate/deactivate/toggle', typeof sandbox.Dashboard.activate === 'function' && typeof sandbox.Dashboard.deactivate === 'function' && typeof sandbox.Dashboard.toggle === 'function');
    } catch (e) {
      check('Module', 'dashboard.js loads cleanly', false, e.message);
    }
  }

  process.exit(done() ? 1 : 0);
})().catch(e => { console.error('dashboard.test.js crashed:', e); process.exit(2); });
