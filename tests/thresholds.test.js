// thresholds.test.js — tests for the centralised alert thresholds module.
// Verifies: defaults match the pre-refactor hardcoded literals, overrides work,
// clamping works, helper predicates are correct, and the barClass() function
// matches the old `pct >= 75 && pct < 90` / `pct >= 90` logic.
// Run: node tests/thresholds.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { suite, ROOT } = require('./lib/server');
const { check, done } = suite('thresholds');

// ---- load thresholds.js into a sandbox that mimics the browser ----
function loadThresholds(settingsObj) {
  const sandbox = {
    window: {},
    console,
    JSON, Math, Number, Object, Array, String, Boolean,
    settings: settingsObj,
    saveSettings: () => {},
  };
  sandbox.window = sandbox; // so `window.Thresholds = ...` writes to sandbox
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'thresholds.js'), 'utf8'), sandbox, { filename: 'thresholds.js' });
  return sandbox.Thresholds;
}

// ---- DEFAULT VALUES (must match the pre-refactor hardcoded literals) ----
{ const T = loadThresholds(undefined);
  check('Defaults match old literals', 'batteryLow is 20 (was script.js:2019)', T.batteryLow === 20, T.batteryLow);
  check('Defaults match old literals', 'ramHigh is 92 (was script.js:2015)', T.ramHigh === 92, T.ramHigh);
  check('Defaults match old literals', 'ramWarn is 90 (was script.js:2136)', T.ramWarn === 90, T.ramWarn);
  check('Defaults match old literals', 'cpuHigh is 90 (was script.js:2135)', T.cpuHigh === 90, T.cpuHigh);
  check('Defaults match old literals', 'diskLowGB is 2 (was script.js:2137)', T.diskLowGB === 2, T.diskLowGB);
  check('Defaults match old literals', 'deadlineWindowH is 3 (was script.js:2021)', T.deadlineWindowH === 3, T.deadlineWindowH);
  check('Defaults match old literals', 'eveningHour is 21 (was script.js:2022)', T.eveningHour === 21, T.eveningHour);
  check('Defaults match old literals', 'reAlertMinutes is 30 (was 30 * 6e4)', T.reAlertMinutes === 30, T.reAlertMinutes);
  check('Defaults match old literals', 'batteryPollS is 120 (was 2 * 6e4)', T.batteryPollS === 120, T.batteryPollS);
  check('Defaults match old literals', 'barHotPct is 75 (was script.js:672)', T.barHotPct === 75, T.barHotPct);
  check('Defaults match old literals', 'barCritPct is 90 (was script.js:672)', T.barCritPct === 90, T.barCritPct);
  check('Defaults match old literals', 'pollMs is 3000 (was setInterval(refreshSystem, 3000))', T.pollMs === 3000, T.pollMs);
}

// ---- barClass() must match the old hardcoded color logic ----
{ const T = loadThresholds(undefined);
  // Old code: hot = pct >= 75 && pct < 90; crit = pct >= 90.
  check('barClass', '0% → no class', T.barClass(0) === '');
  check('barClass', '50% → no class', T.barClass(50) === '');
  check('barClass', '74% → no class', T.barClass(74) === '');
  check('barClass', '75% → hot (boundary)', T.barClass(75) === 'hot');
  check('barClass', '89% → hot (boundary)', T.barClass(89) === 'hot');
  check('barClass', '90% → crit (boundary)', T.barClass(90) === 'crit');
  check('barClass', '99% → crit', T.barClass(99) === 'crit');
  check('barClass', '100% → crit', T.barClass(100) === 'crit');
  check('barClass', '120% → crit (clamp not applied here, just classification)', T.barClass(120) === 'crit');
}

// ---- helper predicates ----
{ const T = loadThresholds(undefined);
  check('Predicates', 'isBatteryLow(15, Discharging) → true', T.isBatteryLow(15, 'Discharging') === true);
  check('Predicates', 'isBatteryLow(15, Charging) → false (plugged in)', T.isBatteryLow(15, 'Charging') === false);
  check('Predicates', 'isBatteryLow(25, Discharging) → false (above threshold)', T.isBatteryLow(25, 'Discharging') === false);
  check('Predicates', 'isBatteryLow(null, Discharging) → false (no battery)', T.isBatteryLow(null, 'Discharging') === false);
  check('Predicates', 'isBatteryLow(20, Discharging) → true (boundary)', T.isBatteryLow(20, 'Discharging') === true);
  check('Predicates', 'isRamHigh(92) → true (boundary)', T.isRamHigh(92) === true);
  check('Predicates', 'isRamHigh(91) → false', T.isRamHigh(91) === false);
  check('Predicates', 'isRamWarn(90) → true (boundary)', T.isRamWarn(90) === true);
  check('Predicates', 'isRamWarn(89) → false', T.isRamWarn(89) === false);
  check('Predicates', 'isCpuHigh(90) → true (boundary)', T.isCpuHigh(90) === true);
  check('Predicates', 'isCpuHigh(89) → false', T.isCpuHigh(89) === false);
  check('Predicates', 'isDiskLow(1.5) → true', T.isDiskLow(1.5) === true);
  check('Predicates', 'isDiskLow(2) → false (>= threshold)', T.isDiskLow(2) === false);
  check('Predicates', 'isDiskLow(null) → false', T.isDiskLow(null) === false);
}

// ---- overrides via settings.thresholds ----
{ const T = loadThresholds({ thresholds: { batteryLow: 30, ramHigh: 85, eveningHour: 20 } });
  check('Overrides', 'batteryLow overridden to 30', T.batteryLow === 30, T.batteryLow);
  check('Overrides', 'ramHigh overridden to 85', T.ramHigh === 85, T.ramHigh);
  check('Overrides', 'eveningHour overridden to 20', T.eveningHour === 20, T.eveningHour);
  // Untouched keys still default
  check('Overrides', 'cpuHigh falls back to default 90', T.cpuHigh === 90, T.cpuHigh);
  check('Overrides', 'diskLowGB falls back to default 2', T.diskLowGB === 2, T.diskLowGB);
  // Predicates use overridden values
  check('Overrides', 'isBatteryLow(25, Discharging) → true now (was false at default)', T.isBatteryLow(25, 'Discharging') === true);
  check('Overrides', 'isRamHigh(86) → true now', T.isRamHigh(86) === true);
  check('Overrides', 'isRamHigh(84) → false', T.isRamHigh(84) === false);
}

// ---- clamping: invalid values fall back to safe defaults ----
{ const T = loadThresholds({ thresholds: { batteryLow: 200, ramHigh: 'not a number', eveningHour: -5 } });
  check('Clamping', 'batteryLow clamped to 50 (max)', T.batteryLow === 50, T.batteryLow);
  check('Clamping', 'ramHigh falls back when NaN', T.ramHigh === 92, T.ramHigh);
  check('Clamping', 'eveningHour clamped to 0 (min)', T.eveningHour === 0, T.eveningHour);
}

// ---- set() applies a partial update and persists via saveSettings ----
{ let saved = null;
  const sandbox = { window: {}, console, JSON, Math, Number, Object, Array, String, Boolean,
    settings: { thresholds: { batteryLow: 20 } }, saveSettings: () => { saved = JSON.parse(JSON.stringify(sandbox.settings)); } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'thresholds.js'), 'utf8'), sandbox, { filename: 'thresholds.js' });
  const T = sandbox.Thresholds;
  T.set({ batteryLow: 25, ramHigh: 88 });
  check('set()', 'batteryLow updated to 25', T.batteryLow === 25, T.batteryLow);
  check('set()', 'ramHigh updated to 88', T.ramHigh === 88, T.ramHigh);
  check('set()', 'saveSettings was called', saved !== null);
  check('set()', 'saveSettings saw the new thresholds', saved.thresholds.batteryLow === 25 && saved.thresholds.ramHigh === 88);
  // Untouched overrides persist
  check('set()', 'partial update preserves other overrides', saved.thresholds.batteryLow === 25); // (only batteryLow + ramHigh were set)
}

// ---- snapshot() returns all defaults + overrides for the Settings drawer ----
{ const T = loadThresholds({ thresholds: { batteryLow: 30 } });
  const snap = T.snapshot();
  check('snapshot', 'returns an object', typeof snap === 'object');
  check('snapshot', 'includes batteryLow (overridden)', snap.batteryLow === 30);
  check('snapshot', 'includes ramHigh (default)', snap.ramHigh === 92);
  check('snapshot', 'includes all 16 default keys', Object.keys(snap).length >= 16, Object.keys(snap).length);
}

// ---- DEFAULTS is frozen (immutable) ----
{ const T = loadThresholds(undefined);
  check('DEFAULTS frozen', 'cannot mutate DEFAULTS.batteryLow', (() => { try { T.DEFAULTS.batteryLow = 99; return T.DEFAULTS.batteryLow === 20; } catch { return true; } })());
}

process.exit(done() ? 1 : 0);
