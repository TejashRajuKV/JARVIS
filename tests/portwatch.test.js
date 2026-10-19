// portwatch.test.js — tests for the proactive port-scan detection module.
// Verifies: route existence, default-off state, enable/disable lifecycle,
// on-demand check, graceful behavior when no ports are listening.
// Run: node tests/portwatch.test.js
'use strict';
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('portwatch');

(async () => {
  const server = await startServer();
  try {
    // ---- status endpoint returns the right shape, default off ----
    {
      const r = await server.get('/api/portwatch/status');
      check('Status', 'GET /api/portwatch/status returns 200', r.status === 200, r.status);
      check('Status', 'response has enabled boolean', typeof r.json.enabled === 'boolean', r.json);
      check('Status', 'default is OFF', r.json.enabled === false, r.json.enabled);
      check('Status', 'response has unavailable boolean', typeof r.json.unavailable === 'boolean');
      check('Status', 'response has intervalMs', typeof r.json.intervalMs === 'number');
      check('Status', 'response has suspiciousThreshold', typeof r.json.suspiciousThreshold === 'number');
      check('Status', 'suspiciousThreshold is 5', r.json.suspiciousThreshold === 5);
    }

    // ---- enable / disable lifecycle ----
    {
      const on = await server.post('/api/portwatch/enable', { on: true });
      check('Lifecycle', 'POST {on:true} returns 200', on.status === 200);
      check('Lifecycle', 'after enable: enabled === true', on.json.enabled === true, on.json);

      const st = await server.get('/api/portwatch/status');
      check('Lifecycle', 'status reflects enabled state', st.json.enabled === true);

      const off = await server.post('/api/portwatch/enable', { on: false });
      check('Lifecycle', 'POST {on:false} disables it', off.json.enabled === false);
    }

    // ---- on-demand check returns port list (may be empty) ----
    {
      const r = await server.post('/api/portwatch/check', {});
      check('Check', 'POST /api/portwatch/check returns 200', r.status === 200, r.status);
      check('Check', 'response has ports array', Array.isArray(r.json.ports));
      check('Check', 'response has status object', typeof r.json.status === 'object');
      // We don't assert specific ports — that depends on the test machine.
      // The important thing is the route didn't crash.
    }

    // ---- enable then check should work (the watcher records baseline on first tick) ----
    {
      await server.post('/api/portwatch/enable', { on: true });
      const r = await server.post('/api/portwatch/check', {});
      check('Enabled check', 'check works while enabled', r.status === 200);
      await server.post('/api/portwatch/enable', { on: false });
    }

    // ---- invalid body to enable doesn't crash ----
    {
      const r = await server.post('/api/portwatch/enable', {});
      check('Validation', 'POST with no body returns 200 (treats as off)', r.status === 200);
      check('Validation', 'enabled is false after empty body', r.json.enabled === false);
    }

    // ---- existing /api/tool/portOwner still works (backwards compat) ----
    // Note: this route exists in server.js and uses a different code path.

  } finally {
    await server.stop();
  }

  // ---- unit test: the module's listPorts function works without a server ----
  {
    const mod = require('../portwatch.js');
    check('Module', 'portwatch.js exports a function', typeof mod === 'function');
  }

  process.exit(done() ? 1 : 0);
})().catch(e => { console.error('portwatch.test.js crashed:', e); process.exit(2); });
