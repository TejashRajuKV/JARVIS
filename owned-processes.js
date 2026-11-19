'use strict';
const { execFile } = require('node:child_process');
function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode || !Number.isInteger(child.pid) || child.pid <= 0) return;
  if (process.platform === 'win32') {
    // Only a still-live child registered by JARVIS. Never search by name.
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => {});
  } else child.kill('SIGTERM');
}
function createRegistry({ control, kill = stopTree } = {}) {
  const children = new Set();
  function track(child) {
    children.add(child);
    const remove = () => children.delete(child);
    child.once('exit', remove); child.once('error', remove);
    if (control?.status().stopped) kill(child);
    return child;
  }
  function stop() {
    let requested = 0;
    for (const child of children) if (child.exitCode === null && !child.signalCode) {
      try { kill(child); requested++; } catch { /* never claim process exit */ }
    }
    return { ownedProcessStopRequests: requested, note: 'Process termination requested; already completed changes are not rolled back.' };
  }
  control?.onStop(stop);
  return { track, stop, size: () => children.size };
}
module.exports = { createRegistry };
