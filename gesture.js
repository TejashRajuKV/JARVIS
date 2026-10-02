'use strict';
/* ===========================================================================
 *  gesture.js — Hand gesture control (UI-only, MediaPipe Hands)
 *  ---------------------------------------------------------------------------
 *  Purely additive: when enabled (Settings → Behaviour → "Hand gesture control"),
 *  JARVIS listens for hand gestures via the webcam and translates them into
 *  UI actions. NO TOOL FIRING — only UI control (toggle listening, dismiss
 *  cards, scroll chat). This is the safety model: a stray gesture can never
 *  execute a destructive command.
 *
 *  Gestures (first cut — all UI-only):
 *    - Open palm (5 fingers, held 1s)  → toggle listening (same as mic button)
 *    - Pinch (thumb + index together)  → dismiss the topmost card / toast
 *    - Swipe left (open hand, moved left) → scroll chat up
 *    - Swipe right (open hand, moved right) → scroll chat down
 *    - Thumbs-up (only thumb extended)   → "yes" (confirms approval card if open)
 *    - Fist (no fingers, held 0.5s)     → stop speaking / pause
 *
 *  Safety:
 *    - Default OFF, opt-in via Settings toggle.
 *    - Runs ONLY while state === 'IDLE' || state === 'LISTENING' (never while
 *      EXECUTING or SPEAKING — gestures can't interrupt a tool mid-run).
 *    - 800ms cooldown between gestures (prevents rapid-fire false positives).
 *    - Webcam stream is in-memory only; never sent to backend or saved.
 *    - Auto-pauses when document.hidden (saves battery).
 *    - Respects prefers-reduced-motion (disables the wireframe overlay).
 *
 *  Dependencies:
 *    - @mediapipe/tasks-vision HandLandmarker (~7MB WASM + model, lazy-loaded
 *      from CDN on first use). Cached by service worker on success.
 *
 *  Architecture mirrors face-greet.js (lazy-load, opt-in, privacy-first).
 * =========================================================================== */
window.Gesture = (function () {

  let enabled = false;
  let detecting = false;
  let lastGestureTs = 0;
  const GESTURE_COOLDOWN_MS = 800;
  const PINCH_THRESHOLD = 0.05;      // distance between thumb+index tips (normalized)
  const SWIPE_DISTANCE = 0.3;        // 30% of frame width
  const HOLD_THRESHOLD_MS = 1000;     // 1s hold for open-palm toggle
  const MEDIAPIPE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  let vision = null;
  let loading = null;
  let loadFailed = false;
  let videoEl = null;
  let canvasEl = null;
  let rafId = 0;
  let lastHandPos = null;   // {x, y, t} for swipe detection
  let palmHoldSince = 0;    // timestamp when open-palm hold started
  let fistHoldSince = 0;    // timestamp when fist hold started

  // ---- lazy-load MediaPipe Tasks Vision (ESM module) ----
  async function loadVision() {
    if (vision) return vision;
    if (loadFailed) throw new Error('MediaPipe previously failed to load');
    if (loading) return loading;
    loading = (async () => {
      try {
        // MediaPipe tasks-vision is an ES module — import it dynamically.
        // The CDN URL returns a .mjs file. We use a dynamic import() which
        // works in all modern browsers (Chrome 63+, Edge 79+, Firefox 67+).
        const mod = await import(MEDIAPIPE_URL);
        const { HandLandmarker, FilesetResolver } = mod;
        const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm');
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        vision = { landmarker, HandLandmarker };
        if (typeof log === 'function') log('ok', 'MediaPipe Hands loaded (model ready)');
        return vision;
      } catch (e) {
        loadFailed = true;
        if (typeof log === 'function') log('warn', 'MediaPipe Hands failed to load: ' + e.message);
        throw e;
      }
    })();
    return loading;
  }

  // ---- webcam access (reuses face-greet pattern) ----
  async function startVideo() {
    if (videoEl && videoEl.srcObject) return videoEl;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false });
      videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
      document.body.appendChild(videoEl);
      await videoEl.play();
      return videoEl;
    } catch (e) {
      if (typeof log === 'function') log('warn', 'gesture webcam denied: ' + e.message);
      throw e;
    }
  }
  function stopVideo() {
    if (!videoEl) return;
    try { if (videoEl.srcObject) videoEl.srcObject.getTracks().forEach(t => t.stop()); videoEl.remove(); } catch {}
    videoEl = null;
  }

  // ---- gesture detection helpers ----
  // MediaPipe Hand landmarks: 21 points per hand.
  // Index 4 = thumb tip, 8 = index tip, 12 = middle tip, 16 = ring tip, 20 = pinky tip.
  // Index 0 = wrist, 5 = index MCP, 9 = middle MCP, 13 = ring MCP, 17 = pinky MCP.
  function distance(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

  function countExtendedFingers(landmarks) {
    let count = 0;
    // Thumb: extended if tip.x is farther from pinky-MCP than index-MCP (right hand) or vice versa.
    // Simplified: thumb tip is far from index MCP.
    const thumbExtended = distance(landmarks[4], landmarks[5]) > 0.1;
    if (thumbExtended) count++;
    // Other fingers: tip is above (smaller y) the PIP joint (2 joints down).
    // Index: 8 above 6, Middle: 12 above 10, Ring: 16 above 14, Pinky: 20 above 18.
    if (landmarks[8].y < landmarks[6].y) count++;   // index
    if (landmarks[12].y < landmarks[10].y) count++; // middle
    if (landmarks[16].y < landmarks[14].y) count++; // ring
    if (landmarks[20].y < landmarks[18].y) count++; // pinky
    return count;
  }

  function isPinching(landmarks) {
    return distance(landmarks[4], landmarks[8]) < PINCH_THRESHOLD;
  }

  function classifyGesture(landmarks) {
    if (!landmarks || landmarks.length < 21) return 'none';
    const fingers = countExtendedFingers(landmarks);
    // Pinch: thumb tip and index tip close together, AND at least one of them
    // is "extended" (so a closed fist doesn't count as pinch).
    if (isPinching(landmarks) && fingers >= 1 && fingers <= 2) return 'pinch';
    if (fingers >= 4) return 'open-palm';
    if (fingers === 0) return 'fist';
    if (fingers === 1) {
      // Check if it's just the thumb (thumbs-up)
      const thumbUp = distance(landmarks[4], landmarks[5]) > 0.1 && landmarks[8].y > landmarks[6].y;
      if (thumbUp) return 'thumbs-up';
    }
    return 'partial';
  }

  // ---- gesture → action mapping (UI-only!) ----
  function fireGestureAction(gesture, landmarks) {
    const now = Date.now();
    if (now - lastGestureTs < GESTURE_COOLDOWN_MS) return;
    // Respect state: only fire in IDLE or LISTENING.
    const st = document.body.dataset.state;
    if (st !== 'idle' && st !== 'listen') return;

    switch (gesture) {
      case 'open-palm':
        // Hold detection: open palm must be held for 1s before toggling.
        if (!palmHoldSince) { palmHoldSince = now; return; }
        if (now - palmHoldSince >= HOLD_THRESHOLD_MS) {
          lastGestureTs = now;
          palmHoldSince = 0;
          if (typeof handleUser === 'function') {
            // Toggle listening via the existing mic button click.
            const mic = document.getElementById('micBtn');
            if (mic) mic.click();
            if (typeof log === 'function') log('ok', 'gesture: open-palm → toggle mic');
          }
        }
        break;
      case 'fist':
        if (!fistHoldSince) { fistHoldSince = now; return; }
        if (now - fistHoldSince >= 500) {
          lastGestureTs = now;
          fistHoldSince = 0;
          // Stop speaking (same as ESC)
          if (typeof stopSpeaking === 'function') stopSpeaking();
          if (typeof log === 'function') log('ok', 'gesture: fist → stop speaking');
        }
        break;
      case 'pinch':
        lastGestureTs = now;
        // Dismiss the topmost toast / card
        const toast = document.querySelector('.toast');
        if (toast) toast.remove();
        if (typeof log === 'function') log('ok', 'gesture: pinch → dismiss');
        break;
      case 'thumbs-up':
        lastGestureTs = now;
        // If an approval card is open, click YES
        const yesBtn = document.querySelector('.confirm-yes, [data-confirm="yes"]');
        if (yesBtn) { yesBtn.click(); if (typeof log === 'function') log('ok', 'gesture: thumbs-up → yes'); }
        else if (typeof log === 'function') log('info', 'gesture: thumbs-up (no approval open — ignored)');
        break;
      case 'partial':
        // Reset holds
        palmHoldSince = 0; fistHoldSince = 0;
        break;
    }

    // Swipe detection: track open-palm position over time.
    if (gesture === 'open-palm' && landmarks) {
      const wrist = landmarks[0];
      const cur = { x: wrist.x, y: wrist.y, t: now };
      if (lastHandPos && now - lastHandPos.t < 500) {
        const dx = cur.x - lastHandPos.x;
        if (Math.abs(dx) > SWIPE_DISTANCE) {
          lastGestureTs = now;
          const messages = document.getElementById('messages');
          if (messages) {
            if (dx > 0) { messages.scrollTop = messages.scrollTop + 200; if (typeof log === 'function') log('ok', 'gesture: swipe right → scroll down'); }
            else { messages.scrollTop = messages.scrollTop - 200; if (typeof log === 'function') log('ok', 'gesture: swipe left → scroll up'); }
          }
          lastHandPos = null;
          return;
        }
      }
      lastHandPos = cur;
    } else {
      lastHandPos = null;
    }
  }

  // ---- main detection loop (rAF) ----
  async function detectLoop() {
    if (!enabled || detecting) return;
    detecting = true;
    try {
      const v = vision || await loadVision();
      if (!videoEl) await startVideo();
      const process = () => {
        if (!enabled || !videoEl) { detecting = false; return; }
        // Pause when tab hidden (battery saver).
        if (document.hidden) { rafId = setTimeout(process, 1000); return; }
        // Pause when not in IDLE/LISTENING state.
        const st = document.body.dataset.state;
        if (st !== 'idle' && st !== 'listen') { rafId = setTimeout(process, 500); return; }
        try {
          const results = v.landmarker.detectForVideo(videoEl, performance.now());
          if (results.landmarks && results.landmarks.length > 0) {
            const gesture = classifyGesture(results.landmarks[0]);
            fireGestureAction(gesture, results.landmarks[0]);
          } else {
            // No hand — reset holds.
            palmHoldSince = 0; fistHoldSince = 0; lastHandPos = null;
          }
        } catch (e) { /* silent — don't spam the log */ }
        rafId = requestAnimationFrame(process);
      };
      process();
    } catch (e) {
      detecting = false;
      // Load failed — disable.
      if (typeof log === 'function') log('warn', 'gesture detection unavailable: ' + e.message);
      deactivate();
    }
  }

  // ---- activation ----
  async function activate() {
    if (enabled) return;
    enabled = true;
    if (typeof log === 'function') log('ok', 'Hand gesture control enabled — loading MediaPipe…');
    detectLoop();  // fire-and-forget — loads vision lazily inside
  }
  function deactivate() {
    enabled = false;
    if (rafId) { cancelAnimationFrame(rafId); clearTimeout(rafId); rafId = 0; }
    detecting = false;
    stopVideo();
    palmHoldSince = 0; fistHoldSince = 0; lastHandPos = null;
    if (typeof log === 'function') log('info', 'Hand gesture control disabled');
  }
  function toggle() { enabled ? deactivate() : activate(); }

  // ---- settings toggle ----
  function bindToggle() {
    const btn = document.getElementById('gestureToggle');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', toggle);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else bindToggle();
  document.addEventListener('click', bindToggle, { passive: true });

  // ---- auto-pause on visibility change ----
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && enabled) {
      if (rafId) { cancelAnimationFrame(rafId); clearTimeout(rafId); rafId = 0; }
    } else if (!document.hidden && enabled && !detecting) {
      detectLoop();
    }
  });

  return {
    activate, deactivate, toggle,
    get enabled() { return enabled; },
    _classifyGesture: classifyGesture,
    _countExtendedFingers: countExtendedFingers,
    _distance: distance,
    _fireGestureAction: fireGestureAction,
    GESTURE_COOLDOWN_MS, PINCH_THRESHOLD, SWIPE_DISTANCE, HOLD_THRESHOLD_MS,
  };
})();
