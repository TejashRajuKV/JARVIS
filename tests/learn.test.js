// learn.test.js — tests for the pattern learning module (learn.js).
// Verifies: event recording, hour-bucketing, suggestion engine (3+ samples,
// cooldown), anomaly detection, forgetAll, snapshot, privacy (no PII).
// Run: node tests/learn.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { suite, ROOT } = require('./lib/server');
const { check, done } = suite('learn');

// ---- load learn.js into a sandbox with a fake store + clock ----
function makeSandbox(nowHour = 9) {
  const storeData = {};
  const sandbox = {
    window: {}, console, JSON, Math, Date, Array, Object, String, Number, Boolean,
    store: {
      get: (k, def) => (k in storeData ? storeData[k] : def),
      set: (k, v) => { storeData[k] = v; },
      _data: storeData,
    },
  };
  sandbox.window = sandbox;
  // Override Date to control the hour-of-day
  const RealDate = Date;
  function MockDate() { return new RealDate(arguments.length ? RealDate.now() : RealDate.now()); }
  MockDate.now = () => RealDate.now();
  MockDate.prototype = RealDate.prototype;
  // Override getHours() to return our fixed hour
  const origGetHours = RealDate.prototype.getHours;
  RealDate.prototype.getHours = function () { return nowHour; };
  sandbox.Date = MockDate;
  sandbox.Date.prototype.getHours = () => nowHour;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8'), sandbox, { filename: 'learn.js' });
  return { sandbox, Learn: sandbox.Learn, store: storeData };
}

// ---- event recording ----
{ const { Learn } = makeSandbox(9);
  Learn.event('app', 'chrome');
  Learn.event('app', 'chrome');
  Learn.event('app', 'chrome');
  const snap = Learn.snapshot();
  check('Event', '3 events at hour 9 recorded', snap.apps.chrome && snap.apps.chrome[9] === 3, snap.apps.chrome);
  check('Event', 'other hours stay at 0', !snap.apps.chrome[10] || snap.apps.chrome[10] === 0);
}
{ const { Learn } = makeSandbox(14);
  Learn.event('app', 'firefox');
  Learn.event('app', 'Firefox'); // case-insensitive
  Learn.event('app', 'FIREFOX');
  const snap = Learn.snapshot();
  check('Event', 'labels are lowercased', snap.apps.firefox && snap.apps.firefox[14] === 3, snap.apps.firefox);
}
{ const { Learn } = makeSandbox(9);
  Learn.event('cmd', 'OPEN_APPLICATION');
  Learn.event('cmd', 'OPEN_APPLICATION');
  const snap = Learn.snapshot();
  check('Event', 'cmd events recorded', snap.cmds.open_application && snap.cmds.open_application[9] === 2);
}

// ---- numeric samples ----
{ const { Learn } = makeSandbox(9);
  for (let i = 0; i < 10; i++) Learn.sample('cpu', 30 + i); // 30-39%
  const snap = Learn.snapshot();
  check('Sample', '10 CPU samples recorded at hour 9', snap.samples.cpu[9] && snap.samples.cpu[9].count === 10);
  const mean = snap.samples.cpu[9].sum / snap.samples.cpu[9].count;
  check('Sample', 'mean CPU is ~34.5', Math.abs(mean - 34.5) < 0.1, mean);
}

// ---- suggestion engine: needs 3+ samples ----
{ const { Learn } = makeSandbox(9);
  Learn.event('app', 'chrome'); Learn.event('app', 'chrome'); // only 2 — not enough
  check('Suggest', '2 events → no suggestion', Learn.suggest() === null);
  Learn.event('app', 'chrome'); // now 3
  const s = Learn.suggest();
  check('Suggest', '3 events → suggestion fired', s !== null && s.label === 'chrome', s);
  check('Suggest', 'suggestion has count', s.count === 3);
  check('Suggest', 'suggestion has kind', s.kind === 'apps');
  check('Suggest', 'suggestion has hour', s.hour === 9);
}
{ const { Learn } = makeSandbox(10); // different hour — should not find hour-9 events
  Learn.event('app', 'chrome'); Learn.event('app', 'chrome'); Learn.event('app', 'chrome');
  // All 3 events are at hour 10, but the sandbox hour is 10 too — so suggestion should fire.
  const s = Learn.suggest();
  check('Suggest', 'suggestion respects current hour', s !== null && s.hour === 10);
}

// ---- suggestion cooldown (24h) ----
{ const { Learn } = makeSandbox(9);
  Learn.event('app', 'chrome'); Learn.event('app', 'chrome'); Learn.event('app', 'chrome');
  const s1 = Learn.suggest();
  check('Cooldown', 'first suggestion fires', s1 !== null);
  Learn.acceptSuggestion(s1);
  const s2 = Learn.suggest();
  check('Cooldown', 'after accept, suggestion suppressed for 24h', s2 === null, s2);
}

// ---- dismiss also suppresses ----
{ const { Learn } = makeSandbox(9);
  Learn.event('app', 'vscode'); Learn.event('app', 'vscode'); Learn.event('app', 'vscode');
  const s = Learn.suggest();
  check('Dismiss', 'suggestion fires', s !== null);
  Learn.dismissSuggestion(s);
  check('Dismiss', 'after dismiss, suppressed', Learn.suggest() === null);
}

// ---- anomaly detection: no baseline → null ----
{ const { Learn } = makeSandbox(9);
  const a = Learn.anomaly('cpu', 99);
  check('Anomaly', 'no baseline → null', a === null);
}

// For anomaly tests we need samples spread across multiple hours. Temporarily
// restore the real getHours so we can populate hour buckets, then re-mock.
const RealDate = Date;
function makeAnomalySandbox(targetHour = 9) {
  // Don't mock getHours — let samples fall into whatever hour they're called at.
  // Instead we manually call Learn.sample with different hour values by waiting...
  // Actually, Learn.sample reads the hour from Date. We can't wait 24h.
  // Solution: directly manipulate the patterns object.
  const storeData = {};
  const sandbox = {
    window: {}, console, JSON, Math, Date, Array, Object, String, Number, Boolean,
    store: { get: (k, def) => (k in storeData ? storeData[k] : def), set: (k, v) => { storeData[k] = v; }, _data: storeData },
  };
  sandbox.window = sandbox;
  sandbox.Date.prototype.getHours = () => targetHour;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8'), sandbox, { filename: 'learn.js' });
  // Manually populate multiple hour buckets
  for (let h = 0; h < 24; h++) {
    for (let i = 0; i < 5; i++) {
      // Bypass the hour-of-day by directly writing to the patterns object
      const p = sandbox.Learn.patterns;
      if (!p.samples.cpu[h]) p.samples.cpu[h] = { sum: 0, count: 0 };
      p.samples.cpu[h].sum += 30 + (h % 5);
      p.samples.cpu[h].count++;
    }
  }
  return { Learn: sandbox.Learn };
}

{ const { Learn } = makeAnomalySandbox(9);
  const a = Learn.anomaly('cpu', 95); // way above baseline
  check('Anomaly', 'value far above baseline is anomaly', a !== null && a.anomaly === true, a);
  check('Anomaly', 'anomaly has expected value', typeof a.expected === 'number');
  check('Anomaly', 'anomaly has z-score', typeof a.z === 'number' && a.z > 2.5, a.z);
}
{ const { Learn } = makeAnomalySandbox(9);
  const a = Learn.anomaly('cpu', 31); // close to baseline
  check('Anomaly', 'value near baseline is NOT anomaly', a !== null && a.anomaly === false, a);
}

// ---- forgetAll clears everything ----
{ const { Learn, store } = makeSandbox(9);
  Learn.event('app', 'chrome'); Learn.event('app', 'chrome'); Learn.event('app', 'chrome');
  Learn.sample('cpu', 50);
  check('Forget', 'patterns stored before forgetAll', store['jarvis.patterns'] != null);
  Learn.forgetAll();
  const snap = Learn.snapshot();
  check('Forget', 'apps cleared', Object.keys(snap.apps).length === 0);
  check('Forget', 'samples cleared', Object.keys(snap.samples.cpu).length === 0);
}

// ---- snapshot returns a copy (not the live object) ----
{ const { Learn } = makeSandbox(9);
  Learn.event('app', 'chrome');
  const snap = Learn.snapshot();
  snap.apps.chrome[9] = 999;
  const snap2 = Learn.snapshot();
  check('Snapshot', 'snapshot is a deep copy (mutation does not affect live data)', snap2.apps.chrome[9] === 1, snap2.apps.chrome[9]);
}

// ---- privacy: labels are truncated (no PII) ----
{ const { Learn } = makeSandbox(9);
  const longLabel = 'a'.repeat(200);
  Learn.event('app', longLabel);
  const snap = Learn.snapshot();
  const keys = Object.keys(snap.apps);
  check('Privacy', 'labels are truncated to 40 chars', keys[0].length <= 40, keys[0].length);
}

process.exit(done() ? 1 : 0);
