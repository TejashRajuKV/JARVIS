'use strict';
/* ===========================================================================
 *  face-greet.js — Face recognition greeting
 *  ---------------------------------------------------------------------------
 *  Purely additive: when enabled (Settings → Behaviour → "Face recognition
 *  greeting"), JARVIS does a single-shot face detection on each IDLE state
 *  transition. If the detected face matches an enrolled descriptor (Euclidean
 *  distance < threshold), JARVIS greets the user by name.
 *
 *  Privacy model (mirrors hello.js):
 *    - The webcam stream stays in-memory only. The image is never sent to
 *      the backend, never saved to disk, never leaves the browser.
 *    - Only the 128-dimensional face descriptor (a Float32Array of 128
 *      numbers = 512 bytes) is stored in config.json on enrollment.
 *    - Feature is OFF by default, per-device (not synced via backup).
 *    - Detection runs only on IDLE transitions (not continuously), so the
 *      webcam indicator light pulses briefly rather than staying on.
 *
 *  Activation:
 *    - Toggle in Settings → Behaviour → "Face recognition greeting".
 *    - First activation triggers the enrollment flow (5-second countdown
 *      + 3 descriptor captures averaged together).
 *    - Subsequent activations just turn detection on/off.
 *
 *  Dependencies:
 *    - face-api.js (lazy-loaded from CDN on first use — matches the existing
 *      @fontsource CDN pattern). If offline, the feature is unavailable.
 *    - Models (SSD MobileNetV1 + face landmarks = ~6MB) cached by the service
 *      worker on first successful fetch.
 *
 *  No existing function is overwritten. The module hooks into setState('IDLE')
 *  via the same MutationObserver pattern used by transitions.js.
 * =========================================================================== */
window.FaceGreet = (function () {

  let enabled = false;
  let enrolled = false;
  let detecting = false;
  let lastGreetTs = 0;
  const GREET_COOLDOWN_MS = 5 * 60 * 1000;  // 5 min — don't re-greet constantly
  const MATCH_THRESHOLD = 0.5;               // Euclidean distance below this = same person
  const FACEAPI_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  let faceapi = null;
  let loading = null;
  let loadFailed = false;
  let videoEl = null;

  // ---- lazy-load face-api.js ----
  function loadFaceAPI() {
    if (faceapi) return Promise.resolve(faceapi);
    if (loadFailed) return Promise.reject(new Error('face-api.js previously failed to load'));
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = FACEAPI_URL;
      script.onload = async () => {
        try {
          faceapi = window.faceapi;
          if (!faceapi) throw new Error('face-api.js loaded but window.faceapi not set');
          // Load the models (SSD MobileNetV1 + face landmarks)
          await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
          await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
          await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
          if (typeof log === 'function') log('ok', 'face-api.js loaded (models ready)');
          resolve(faceapi);
        } catch (e) {
          loadFailed = true;
          if (typeof log === 'function') log('warn', 'face-api.js model load failed: ' + e.message);
          reject(e);
        }
      };
      script.onerror = () => {
        loadFailed = true;
        loading = null;
        if (typeof log === 'function') log('warn', 'face-api.js failed to load (offline?) — face greeting disabled');
        reject(new Error('face-api.js script load failed'));
      };
      document.head.appendChild(script);
    });
    return loading;
  }

  // ---- webcam access ----
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
      if (typeof log === 'function') log('warn', 'webcam access denied: ' + e.message);
      throw e;
    }
  }
  function stopVideo() {
    if (!videoEl) return;
    try {
      if (videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
      }
      videoEl.remove();
    } catch {}
    videoEl = null;
  }

  // ---- single-shot detection ----
  async function detectOnce() {
    if (detecting) return null;
    detecting = true;
    try {
      const api = await loadFaceAPI();
      const video = await startVideo();
      // Wait a brief moment for the camera to settle
      await new Promise(r => setTimeout(r, 400));
      const detection = await api.detectSingleFace(video, new api.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
      stopVideo();
      return detection;
    } catch (e) {
      stopVideo();
      return null;
    } finally {
      detecting = false;
    }
  }

  // ---- descriptor storage (in config.json via /api/hello — mirrors hello.js) ----
  async function loadEnrolled() {
    try {
      const r = await fetch((window.API || '') + '/facegreet/status');
      const d = await r.json();
      return d.enrolled ? d.descriptor : null;
    } catch { return null; }
  }
  async function saveEnrolled(descriptor) {
    try {
      const r = await fetch((window.API || '') + '/facegreet/enroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor: Array.from(descriptor) }),
      });
      const d = await r.json();
      return d.success;
    } catch { return false; }
  }

  // ---- distance calculation ----
  function euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
    return Math.sqrt(sum);
  }

  // ---- greeting ----
  function greet() {
    const now = Date.now();
    if (now - lastGreetTs < GREET_COOLDOWN_MS) return;  // 5-min cooldown
    lastGreetTs = now;
    const name = (typeof memGet === 'function') ? memGet('name') : null;
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const greeting = name
      ? 'Welcome back, ' + name + '. Good ' + part + '.'
      : 'Welcome back, ' + (typeof Persona === 'undefined' ? 'sir' : Persona.sir()) + '. Good ' + part + '.';
    if (typeof jarvisSay === 'function') {
      jarvisSay({ text: greeting, intent: 'FACE_GREET', noLog: false });
      if (typeof speak === 'function' && typeof settings !== 'undefined' && settings.tts) speak(greeting);
    }
    if (typeof log === 'function') log('ok', 'face recognition: greeted user');
  }

  // ---- main detection flow (called on IDLE transition) ----
  async function onIdle() {
    if (!enabled || !enrolled || detecting) return;
    try {
      const enrolledDesc = await loadEnrolled();
      if (!enrolledDesc) return;
      const detection = await detectOnce();
      if (!detection) return;  // no face found — no greeting
      const dist = euclideanDistance(detection.descriptor, new Float32Array(enrolledDesc));
      if (typeof log === 'function') log('info', 'face match distance: ' + dist.toFixed(3));
      if (dist < MATCH_THRESHOLD) {
        greet();
      }
    } catch (e) {
      // Silent — don't bother the user with detection failures
    }
  }

  // ---- enrollment flow ----
  async function enroll() {
    if (typeof log === 'function') log('ok', 'face enrollment: starting 5-second capture…');
    if (typeof toast === 'function') toast('Look at the camera — capturing in 3 seconds…');
    await new Promise(r => setTimeout(r, 3000));
    // Capture 3 samples and average them for robustness
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const d = await detectOnce();
      if (d && d.descriptor) samples.push(d.descriptor);
      if (i < 2) await new Promise(r => setTimeout(r, 500));
    }
    if (samples.length < 2) {
      if (typeof toast === 'function') toast('Could not capture enough face samples. Try again in better lighting.');
      return false;
    }
    // Average the descriptors
    const avg = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      avg[i] = samples.reduce((s, d) => s + d[i], 0) / samples.length;
    }
    const ok = await saveEnrolled(avg);
    if (ok) {
      enrolled = true;
      if (typeof log === 'function') log('ok', 'face enrollment complete');
      if (typeof toast === 'function') toast('✓ Face enrolled. I will greet you next time you wake me.');
    } else {
      if (typeof toast === 'function') toast('Face enrollment failed — check the activity log.');
    }
    return ok;
  }

  // ---- activation ----
  async function activate() {
    if (enabled) return;
    enabled = true;
    // Check if already enrolled
    const existing = await loadEnrolled();
    if (existing) {
      enrolled = true;
      if (typeof log === 'function') log('ok', 'face recognition enabled (already enrolled)');
    } else {
      // Trigger enrollment
      if (typeof log === 'function') log('info', 'face recognition enabled — starting enrollment');
      await enroll();
    }
  }
  function deactivate() {
    enabled = false;
    enrolled = false;
    stopVideo();
    if (typeof log === 'function') log('info', 'face recognition disabled');
  }
  async function toggle() {
    if (enabled) deactivate();
    else await activate();
  }

  // ---- hook into setState('IDLE') via MutationObserver ----
  function startObserving() {
    if (!window.MutationObserver) return;
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes' && m.attributeName === 'data-state') {
          if (document.body.dataset.state === 'idle') {
            onIdle();  // fire-and-forget — detection is async
          }
        }
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserving);
  else startObserving();

  // ---- settings toggle ----
  function bindToggle() {
    const btn = document.getElementById('faceGreetToggle');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', toggle);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else bindToggle();
  document.addEventListener('click', bindToggle, { passive: true });

  return {
    activate, deactivate, toggle,
    get enabled() { return enabled; },
    get enrolled() { return enrolled; },
    enroll, detectOnce, onIdle,
    _euclideanDistance: euclideanDistance,
    _loadFaceAPI: loadFaceAPI,
    MATCH_THRESHOLD, GREET_COOLDOWN_MS,
  };
})();
