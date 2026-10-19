// gesture.test.js — tests for the hand gesture control module.
// Verifies: gesture classification (open-palm, fist, pinch, thumbs-up),
// distance calculation, finger counting, module loads cleanly.
// Run: node tests/gesture.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { suite, ROOT } = require('./lib/server');
const { check, done } = suite('gesture');

// ---- load gesture.js into a sandbox ----
function makeSandbox() {
  const fakeEl = () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }, style: {}, dataset: {}, addEventListener: () => {}, click: () => {}, remove: () => {} });
  const sandbox = {
    window: {}, console, JSON, Math, Date, Array, Object, String, Number, Boolean,
    setTimeout, setInterval, clearTimeout, clearInterval, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
    MutationObserver: class { observe() {} disconnect() {} },
    document: {
      readyState: 'complete', body: { dataset: { state: 'idle' }, classList: { add: () => {}, remove: () => {} } },
      createElement: () => fakeEl(),
      getElementById: () => fakeEl(),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: () => {},
      hidden: false,
    },
    navigator: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('no camera')) } },
    handleUser: () => {}, stopSpeaking: () => {}, log: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gesture.js'), 'utf8'), sandbox, { filename: 'gesture.js', timeout: 3000 });
  return { sandbox, Gesture: sandbox.Gesture };
}

// ---- module loads cleanly ----
{ const { Gesture } = makeSandbox();
  check('Module', 'gesture.js loads cleanly', typeof Gesture === 'object');
  check('Module', 'exposes activate/deactivate/toggle', typeof Gesture.activate === 'function' && typeof Gesture.deactivate === 'function' && typeof Gesture.toggle === 'function');
  check('Module', 'exposes _classifyGesture', typeof Gesture._classifyGesture === 'function');
  check('Module', 'exposes _countExtendedFingers', typeof Gesture._countExtendedFingers === 'function');
  check('Module', 'exposes _distance', typeof Gesture._distance === 'function');
  check('Module', 'default enabled is false', Gesture.enabled === false);
}

// ---- distance calculation ----
{ const { Gesture } = makeSandbox();
  const dist = Gesture._distance;
  check('Distance', '(0,0)-(3,4) → 5', dist({x:0,y:0}, {x:3,y:4}) === 5);
  check('Distance', '(0,0)-(0,0) → 0', dist({x:0,y:0}, {x:0,y:0}) === 0);
  check('Distance', '(1,1)-(4,5) → 5', dist({x:1,y:1}, {x:4,y:5}) === 5);
}

// ---- finger counting ----
{ const { Gesture } = makeSandbox();
  // Open hand: all 5 fingers extended (tips above PIP joints)
  const openHand = [
    {x:0.5, y:0.9},  // 0 wrist
    {x:0.4, y:0.8},  // 1 thumb CMC
    {x:0.3, y:0.6},  // 2 thumb MCP
    {x:0.25,y:0.5},  // 3 thumb IP
    {x:0.2, y:0.4},  // 4 thumb TIP (extended — far from index MCP)
    {x:0.45,y:0.6},  // 5 index MCP
    {x:0.45,y:0.5},  // 6 index PIP
    {x:0.45,y:0.4},  // 7 index DIP
    {x:0.45,y:0.3},  // 8 index TIP (above PIP → extended)
    {x:0.5, y:0.6},  // 9 middle MCP
    {x:0.5, y:0.5},  // 10 middle PIP
    {x:0.5, y:0.4},  // 11 middle DIP
    {x:0.5, y:0.3},  // 12 middle TIP (above PIP → extended)
    {x:0.55,y:0.6},  // 13 ring MCP
    {x:0.55,y:0.5},  // 14 ring PIP
    {x:0.55,y:0.4},  // 15 ring DIP
    {x:0.55,y:0.3},  // 16 ring TIP (above PIP → extended)
    {x:0.6, y:0.6},  // 17 pinky MCP
    {x:0.6, y:0.5},  // 18 pinky PIP
    {x:0.6, y:0.4},  // 19 pinky DIP
    {x:0.6, y:0.3},  // 20 pinky TIP (above PIP → extended)
  ];
  const count = Gesture._countExtendedFingers(openHand);
  check('Fingers', 'open hand → 5 fingers', count === 5, count);
  const gesture = Gesture._classifyGesture(openHand);
  check('Classify', 'open hand → open-palm', gesture === 'open-palm', gesture);
}

{ const { Gesture } = makeSandbox();
  // Fist: no fingers extended (all tips below PIP joints)
  const fist = [
    {x:0.5, y:0.9},  // 0 wrist
    {x:0.4, y:0.8},  // 1 thumb CMC
    {x:0.3, y:0.6},  // 2 thumb MCP
    {x:0.25,y:0.5},  // 3 thumb IP
    {x:0.2, y:0.4},  // 4 thumb TIP (not extended — close to index MCP)
    {x:0.45,y:0.6},  // 5 index MCP
    {x:0.45,y:0.5},  // 6 index PIP
    {x:0.45,y:0.4},  // 7 index DIP
    {x:0.45,y:0.55}, // 8 index TIP (below PIP → not extended)
    {x:0.5, y:0.6},  // 9 middle MCP
    {x:0.5, y:0.5},  // 10 middle PIP
    {x:0.5, y:0.4},  // 11 middle DIP
    {x:0.5, y:0.55}, // 12 middle TIP (below PIP → not extended)
    {x:0.55,y:0.6},  // 13 ring MCP
    {x:0.55,y:0.5},  // 14 ring PIP
    {x:0.55,y:0.4},  // 15 ring DIP
    {x:0.55,y:0.55}, // 16 ring TIP (below PIP → not extended)
    {x:0.6, y:0.6},  // 17 pinky MCP
    {x:0.6, y:0.5},  // 18 pinky PIP
    {x:0.6, y:0.4},  // 19 pinky DIP
    {x:0.6, y:0.55}, // 20 pinky TIP (below PIP → not extended)
  ];
  // Thumb should be close to index MCP so it's "not extended"
  // dist(landmarks[4], landmarks[5]) = dist((0.2,0.4),(0.45,0.6)) = ~0.3 > 0.1 → thumb counted as extended!
  // Let me fix the fist so thumb is retracted
  fist[4] = { x: 0.42, y: 0.55 };  // thumb tip close to index MCP
  const count = Gesture._countExtendedFingers(fist);
  check('Fingers', 'fist → 0 fingers', count === 0, count);
  const gesture = Gesture._classifyGesture(fist);
  check('Classify', 'fist → fist', gesture === 'fist', gesture);
}

{ const { Gesture } = makeSandbox();
  // Pinch: thumb tip and index tip very close
  const pinch = [
    {x:0.5, y:0.9},  // 0 wrist
    {x:0.4, y:0.8},  // 1
    {x:0.3, y:0.6},  // 2
    {x:0.25,y:0.5},  // 3
    {x:0.3, y:0.4},  // 4 thumb TIP
    {x:0.45,y:0.6},  // 5 index MCP
    {x:0.45,y:0.5},  // 6
    {x:0.4, y:0.4},  // 7
    {x:0.31,y:0.4},  // 8 index TIP (close to thumb tip → pinching)
    {x:0.5, y:0.6},  // 9-20: rest retracted
    {x:0.5, y:0.5}, {x:0.5, y:0.55}, {x:0.5, y:0.55},
    {x:0.55,y:0.6}, {x:0.55,y:0.5}, {x:0.55,y:0.55}, {x:0.55,y:0.55},
    {x:0.6, y:0.6}, {x:0.6, y:0.5}, {x:0.6, y:0.55}, {x:0.6, y:0.55},
  ];
  const gesture = Gesture._classifyGesture(pinch);
  check('Classify', 'pinch → pinch', gesture === 'pinch', gesture);
}

{ const { Gesture } = makeSandbox();
  // Thumbs-up: only thumb extended (tip far from index MCP), index curled
  const thumbsUp = [
    {x:0.5, y:0.9},  // 0 wrist
    {x:0.4, y:0.8},  // 1
    {x:0.3, y:0.6},  // 2 thumb MCP
    {x:0.2, y:0.4},  // 3 thumb IP
    {x:0.15,y:0.2},  // 4 thumb TIP (way up — extended)
    {x:0.45,y:0.6},  // 5 index MCP
    {x:0.45,y:0.5},  // 6 index PIP
    {x:0.45,y:0.4},  // 7
    {x:0.45,y:0.55}, // 8 index TIP (below PIP → not extended)
    {x:0.5, y:0.6},  // 9-20: retracted
    {x:0.5, y:0.5}, {x:0.5, y:0.55}, {x:0.5, y:0.55},
    {x:0.55,y:0.6}, {x:0.55,y:0.5}, {x:0.55,y:0.55}, {x:0.55,y:0.55},
    {x:0.6, y:0.6}, {x:0.6, y:0.5}, {x:0.6, y:0.55}, {x:0.6, y:0.55},
  ];
  const count = Gesture._countExtendedFingers(thumbsUp);
  check('Fingers', 'thumbs-up → 1 finger (thumb)', count === 1, count);
  const gesture = Gesture._classifyGesture(thumbsUp);
  check('Classify', 'thumbs-up → thumbs-up', gesture === 'thumbs-up', gesture);
}

// ---- thresholds are sane ----
{ const { Gesture } = makeSandbox();
  check('Threshold', 'GESTURE_COOLDOWN_MS is 800ms', Gesture.GESTURE_COOLDOWN_MS === 800);
  check('Threshold', 'PINCH_THRESHOLD is 0.05', Gesture.PINCH_THRESHOLD === 0.05);
  check('Threshold', 'SWIPE_DISTANCE is 0.3', Gesture.SWIPE_DISTANCE === 0.3);
  check('Threshold', 'HOLD_THRESHOLD_MS is 1000', Gesture.HOLD_THRESHOLD_MS === 1000);
}

// ---- classifyGesture returns 'none' for null input ----
{ const { Gesture } = makeSandbox();
  check('Classify', 'null landmarks → none', Gesture._classifyGesture(null) === 'none');
  check('Classify', 'short landmarks → none', Gesture._classifyGesture([{x:0,y:0}]) === 'none');
}

process.exit(done() ? 1 : 0);
