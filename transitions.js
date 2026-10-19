'use strict';
/* ===========================================================================
 *  transitions.js — Cinematic state-change effect trigger
 *  ---------------------------------------------------------------------------
 *  Purely additive: observes state changes via MutationObserver on
 *  <body data-state> and fires one-shot CSS animations (defined in
 *  transitions.css) at the right moments. Does NOT modify the existing
 *  setState() function — it just watches the DOM.
 *
 *  Effects fired:
 *    - IDLE → LISTENING:  .orb-wake (scale pulse — "JARVIS opening eyes")
 *    - * → EXECUTING:     .exec-sweep (light sweep across orb)
 *    - * → ERROR:         .orb-shake (subtle horizontal shake)
 *    - stateMsg text change: .state-msg-fade (retrigger fadeUp keyframe)
 *
 *  The @property declarations in transitions.css handle the smooth color
 *  morph (cyan → amber → green) automatically — no JS needed for that.
 *
 *  All effects respect prefers-reduced-motion via the CSS kill-switch.
 * =========================================================================== */
window.Transitions = (function () {

  let observing = false;
  let lastState = 'idle';
  let lastStateMsg = '';
  let sweepEl = null;

  // ---- create the sweep overlay element (added once, reused) ----
  function ensureSweepEl() {
    if (sweepEl && document.body.contains(sweepEl)) return sweepEl;
    const orbWrap = document.querySelector('.orb-wrap');
    if (!orbWrap) return null;
    sweepEl = document.createElement('div');
    sweepEl.className = 'exec-sweep';
    orbWrap.appendChild(sweepEl);
    return sweepEl;
  }

  // ---- fire a one-shot animation by toggling a class ----
  // The class is added, then removed after the animation duration so it can
  // be re-triggered next time. We use a forced reflow (void el.offsetWidth)
  // to ensure the browser restarts the animation if the class was just removed.
  function fireOneShot(el, className, durationMs) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;  // force reflow — restarts the CSS animation
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), durationMs + 50);
  }

  // ---- state-change handler ----
  function onStateChanged(newState) {
    const orbWrap = document.querySelector('.orb-wrap');
    if (!orbWrap) return;

    // IDLE → LISTENING: wake-up pulse
    if (lastState === 'idle' && newState === 'listen') {
      fireOneShot(orbWrap, 'orb-wake', 700);
    }

    // * → EXECUTING: power-up sweep (re-create the sweep element each time
    // so the CSS animation restarts cleanly)
    if (newState === 'exec') {
      const orbWrap = document.querySelector('.orb-wrap');
      if (orbWrap) {
        // Remove any existing sweep, then add a fresh one
        const old = orbWrap.querySelector('.exec-sweep');
        if (old) old.remove();
        const sweep = document.createElement('div');
        sweep.className = 'exec-sweep';
        orbWrap.appendChild(sweep);
        // Auto-remove after the animation completes
        setTimeout(() => sweep.remove(), 900);
      }
    }

    // * → ERROR: shake
    if (newState === 'err') {
      fireOneShot(orbWrap, 'orb-shake', 400);
    }

    lastState = newState;
  }

  // ---- state-message text-change handler ----
  function onStateMsgChange(newText) {
    if (newText === lastStateMsg) return;
    lastStateMsg = newText;
    const el = document.getElementById('stateMsg');
    if (!el) return;
    fireOneShot(el, 'state-msg-fade', 350);
  }

  // ---- start observing ----
  function start() {
    if (observing) return;
    observing = true;

    // Observe body[data-state] attribute changes
    const body = document.body;
    if (body && window.MutationObserver) {
      const obs = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.attributeName === 'data-state') {
            onStateChanged(body.dataset.state);
          }
        }
      });
      obs.observe(body, { attributes: true, attributeFilter: ['data-state'] });
      // Fire once for the initial state
      onStateChanged(body.dataset.state || 'idle');
    }

    // Observe #stateMsg text changes
    const stateMsg = document.getElementById('stateMsg');
    if (stateMsg && window.MutationObserver) {
      const obs2 = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'characterData' || m.type === 'childList') {
            onStateMsgChange(stateMsg.textContent);
            break;
          }
        }
      });
      obs2.observe(stateMsg, { characterData: true, childList: true, subtree: true });
      lastStateMsg = stateMsg.textContent || '';
    }
  }

  // ---- auto-start when DOM is ready ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return {
    start,
    get active() { return observing; },
    _fireOneShot: fireOneShot,  // exposed for testing
  };
})();
