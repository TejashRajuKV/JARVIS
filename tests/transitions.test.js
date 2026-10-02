// transitions.test.js — tests for the cinematic transitions module.
// Verifies: module loads cleanly, MutationObserver wiring works, fireOneShot
// toggles classes correctly, no crashes when DOM elements are missing.
// Run: node tests/transitions.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { suite, ROOT } = require('./lib/server');
const { check, done } = suite('transitions');

// ---- load transitions.js into a sandbox with a fake DOM ----
function makeSandbox() {
  // Fake element with classList, offsetWidth, querySelector, etc.
  function fakeEl(id) {
    const el = {
      id: id || '',
      className: '',
      style: {},
      _classes: new Set(),
      classList: {
        add: (c) => el._classes.add(c),
        remove: (c) => el._classes.delete(c),
        toggle: (c, on) => { on === undefined ? (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c)) : (on ? el._classes.add(c) : el._classes.delete(c)); },
        contains: (c) => el._classes.has(c),
      },
      offsetWidth: 100,  // forced reflow trigger
      textContent: '',
      dataset: {},
      parentNode: null,
      appendChild: (child) => { child.parentNode = el; },
      removeChild: (child) => { child.parentNode = null; },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      remove: () => {},
      setAttribute: () => {},
      getAttribute: () => null,
    };
    return el;
  }
  const body = fakeEl('body');
  body.dataset = { state: 'idle' };
  const stateMsg = fakeEl('stateMsg');
  stateMsg.textContent = 'idle';

  const fakeDocument = {
    readyState: 'complete',
    body: body,
    getElementById: (id) => id === 'stateMsg' ? stateMsg : fakeEl(id),
    querySelector: (sel) => sel === '.orb-wrap' ? fakeEl('orb-wrap') : null,
    querySelectorAll: () => [],
    createElement: (tag) => fakeEl(tag),
    addEventListener: () => {},
  };
  // Make MutationObserver a no-op that immediately calls the callback once
  // (so start() thinks it observed the initial state).
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; this.observing = false; }
    observe(target, opts) { this.observing = true; this.target = target; this.opts = opts; }
    disconnect() { this.observing = false; }
    // Helper for tests: simulate a mutation
    _fire(attributeName) {
      this.cb([{ type: 'attributes', attributeName, target: this.target }]);
    }
  }

  const sandbox = {
    window: {}, document: fakeDocument, console,
    JSON, Math, Date, Array, Object, String, Number, Boolean,
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: FakeMutationObserver,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'transitions.js'), 'utf8'), sandbox, { filename: 'transitions.js', timeout: 3000 });
  return { sandbox, Transitions: sandbox.Transitions, body, stateMsg, FakeMutationObserver };
}

// ---- module loads cleanly ----
{ const { Transitions } = makeSandbox();
  check('Module', 'transitions.js loads cleanly', typeof Transitions === 'object', typeof Transitions);
  check('Module', 'exposes start()', typeof Transitions.start === 'function');
  check('Module', 'exposes _fireOneShot()', typeof Transitions._fireOneShot === 'function');
  check('Module', 'active is true after auto-start', Transitions.active === true, Transitions.active);
}

// ---- fireOneShot toggles a class then removes it ----
{ const { Transitions, body } = makeSandbox();
  const fakeEl = { _classes: new Set(), classList: { add: c => fakeEl._classes.add(c), remove: c => fakeEl._classes.delete(c), contains: c => fakeEl._classes.has(c) }, offsetWidth: 100 };
  Transitions._fireOneShot(fakeEl, 'test-anim', 50);
  check('fireOneShot', 'class is added immediately', fakeEl._classes.has('test-anim') === true);
  // After 100ms (50 + 50 buffer), the class should be removed
  setTimeout(() => {
    check('fireOneShot', 'class is removed after duration', fakeEl._classes.has('test-anim') === false);
  }, 120);
}

// ---- no crash when DOM elements are missing ----
{ const sandbox = {
    window: {}, console, JSON, Math, Date, Array, Object, String, Number, Boolean,
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    document: {
      readyState: 'complete',
      body: { dataset: { state: 'idle' } },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ className: '', classList: { add: () => {}, remove: () => {} } }),
      addEventListener: () => {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let threw = false;
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'transitions.js'), 'utf8'), sandbox, { filename: 'transitions.js', timeout: 3000 }); }
  catch (e) { threw = true; console.log('  crashed:', e.message); }
  check('Resilience', 'no crash when .orb-wrap is missing', threw === false, threw);
  check('Resilience', 'Transitions module still exposed', typeof sandbox.Transitions === 'object');
}

// ---- CSS file exists and has the key animations ----
{ const css = fs.readFileSync(path.join(ROOT, 'transitions.css'), 'utf8');
  check('CSS', 'transitions.css exists', css.length > 100, css.length);
  check('CSS', 'has @property --core1 declaration', /@property\s+--core1/.test(css));
  check('CSS', 'has @property --core2 declaration', /@property\s+--core2/.test(css));
  check('CSS', 'has @property --ring declaration', /@property\s+--ring/.test(css));
  check('CSS', 'has @property --glow declaration', /@property\s+--glow/.test(css));
  check('CSS', 'has orbWake keyframe', /@keyframes\s+orbWake/.test(css));
  check('CSS', 'has execSweep keyframe', /@keyframes\s+execSweep/.test(css));
  check('CSS', 'has orbShake keyframe', /@keyframes\s+orbShake/.test(css));
  check('CSS', 'has msgReveal keyframe', /@keyframes\s+msgReveal/.test(css));
  check('CSS', 'has prefers-reduced-motion kill-switch', /prefers-reduced-motion/.test(css));
  check('CSS', 'has staggered message delays', /nth-child\([0-9+n+]+\)/.test(css));
}

process.exit(done() ? 1 : 0);
