'use strict';
/* ===========================================================================
 *  portwatch.js — Proactive port-scan / suspicious-connection detection
 *  ---------------------------------------------------------------------------
 *  PROBLEM: The existing /api/tool/portOwner endpoint (server.js) only checks
 *  ports on demand — when the user asks "is port 3000 free?". Nothing watches
 *  for NEW listening sockets appearing over time, which is the signature of:
 *    - A background process opening a backdoor
 *    - A compromised npm package phoning home
 *    - A dev server the user forgot about
 *    - An attacker doing reconnaissance (port scan)
 *
 *  SOLUTION: This module runs a background watcher that snapshots the set of
 *  listening TCP ports every WATCH_INTERVAL_MS (default 60s). When a NEW port
 *  appears that wasn't in the previous snapshot, it broadcasts an event to all
 *  connected JARVIS tabs via app.locals.broadcast() — same channel the
 *  scheduler uses for reminders. The page (script.js) can then surface a toast
 *  + chat message: "Sir, a new process is listening on port 4567."
 *
 *  Cross-platform: uses `netstat` on Windows, `ss` on Linux, `lsof` on Mac.
 *  Gracefully degrades if none of those are available (status returns
 *  `unavailable: true`).
 *
 *  Privacy: only the port numbers and the owning process name are sent to the
 *  page — never the remote IP, never the full netstat output.
 *
 *  Additive: wired in server.js with a single require() line. The watcher is
 *  OFF by default — the user must enable it via /api/portwatch/enable (called
 *  from Settings → Behaviour → "Port scan watch"). This matches the existing
 *  pattern for opt-in features (e.g. hotkey, autostart).
 * =========================================================================== */
const { execFile } = require('child_process');

const WATCH_INTERVAL_MS = 60 * 1000; // 1 minute
const SUSPICIOUS_THRESHOLD = 5;      // 5+ new ports in one tick = "port scan" alert

module.exports = function setupPortWatch(app, { IS_WIN, IS_MAC }) {
  let enabled = false;
  let timer = null;
  let lastPorts = new Set();        // ports seen in the previous snapshot
  let firstRun = true;              // skip the first snapshot (no baseline)
  let unavailable = false;
  let lastNewCount = 0;
  let totalNewSinceStart = 0;

  // ---- cross-platform port lister ----
  // Returns a Map<port, processName>. Returns null if the platform tool failed.
  function listPorts() {
    return new Promise(resolve => {
      const cmd = IS_WIN ? { cmd: 'netstat', args: ['-ano'] }
        : IS_MAC ? { cmd: 'lsof', args: ['-iTCP', '-sTCP:LISTEN', '-n', '-P'] }
        : { cmd: 'ss', args: ['-tlnp'] }; // Linux
      execFile(cmd.cmd, cmd.args, { windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
        if (err) { unavailable = true; resolve(null); return; }
        const ports = new Map();
        const lines = String(stdout).split(/\r?\n/);
        for (const line of lines) {
          // Extract port from lines like:
          //   TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234
          //   LISTEN  0  0  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=1234))
          const m = line.match(/[:\s](\d{2,5})\s.*(?:LISTEN|LISTENING)/i);
          if (!m) continue;
          const port = parseInt(m[1]);
          if (port < 1024 || port > 65535) continue; // skip privileged ports (system services)
          // Try to extract process name (Linux: "users:(("node",pid=1234))")
          const pm = line.match(/users:\(\("([^"]+)"/);
          if (pm) ports.set(port, pm[1]);
          else if (IS_WIN) {
            // netstat gives PID; we don't resolve to name here (would need tasklist)
            ports.set(port, 'pid:' + (line.trim().split(/\s+/).pop() || '?'));
          } else {
            ports.set(port, 'unknown');
          }
        }
        resolve(ports);
      });
    });
  }

  // ---- single tick: snapshot ports, detect new ones, broadcast if needed ----
  async function tick() {
    if (!enabled) return;
    const current = await listPorts();
    if (!current) return; // platform tool failed

    if (firstRun) {
      // First run: just record the baseline, don't alert.
      lastPorts = new Set(current.keys());
      firstRun = false;
      return;
    }

    const currentSet = new Set(current.keys());
    const newPorts = [...currentSet].filter(p => !lastPorts.has(p));
    const gonePorts = [...lastPorts].filter(p => !currentSet.has(p));

    lastNewCount = newPorts.length;
    totalNewSinceStart += newPorts.length;

    if (newPorts.length > 0) {
      const payload = {
        type: 'ports',
        newPorts: newPorts.slice(0, 20).map(p => ({ port: p, process: current.get(p) })),
        goneCount: gonePorts.length,
        total: currentSet.size,
        suspicious: newPorts.length >= SUSPICIOUS_THRESHOLD,
      };
      if (app.locals.broadcast) app.locals.broadcast(payload);
    }

    lastPorts = currentSet;
  }

  // ---- public API ----
  function start() {
    if (enabled || unavailable) return;
    enabled = true;
    firstRun = true;
    lastPorts = new Set();
    tick(); // immediate first snapshot
    timer = setInterval(tick, WATCH_INTERVAL_MS);
  }
  function stop() {
    enabled = false;
    if (timer) { clearInterval(timer); timer = null; }
  }
  function status() {
    return {
      enabled,
      unavailable,
      lastNewCount,
      totalNewSinceStart,
      currentCount: lastPorts.size,
      intervalMs: WATCH_INTERVAL_MS,
      suspiciousThreshold: SUSPICIOUS_THRESHOLD,
    };
  }

  // ---- routes ----
  app.get('/api/portwatch/status', (req, res) => res.json(status()));
  app.post('/api/portwatch/enable', (req, res) => {
    if (req.body && req.body.on) start(); else stop();
    res.json(status());
  });
  app.post('/api/portwatch/check', async (req, res) => {
    // On-demand check: returns the current port set without waiting for the next tick.
    const current = await listPorts();
    if (!current) return res.status(501).json({ error: 'Port listing unavailable on this platform', status: status() });
    res.json({ success: true, ports: [...current.entries()].map(([port, proc]) => ({ port, process: proc })), status: status() });
  });

  process.on('exit', () => stop());

  return { start, stop, status, tick, listPorts };
};
