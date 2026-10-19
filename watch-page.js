'use strict';
/* Two camera watchers, both off until you switch them on and both showing the camera indicator (camera-page.js) with a Stop button:
     Presence lock ("lock when I leave"): every 2 seconds a small face detector looks at a webcam frame. When nobody has been seen for
        the chosen time, JARVIS locks itself (the app lock; Windows too only if you also switched that on). "Could not tell" (camera
        blocked, tab asleep, detector error) never counts as "gone". It can only LOCK, never unlock, and it never counts as activity
        for the idle timer. It needs the app lock to be set up (Settings → Security) and will not switch that on for you.
     Room watch ("watch my room"): looks for movement, saves still pictures to ~/jarvis/Watch on the laptop, and (if phone alerts are on)
        sends a TEXT-ONLY alert to your phone. No picture ever leaves the laptop. Stops after 8 hours and on reload.
   The maths (is that movement, did they leave) is in scanmath.js; this file runs the camera and the timers. Picture frames never leave this
   tab except the snapshot sent to your own laptop's server. Uses the page's globals (callTool, getJSON, settings, saveSettings, jarvisSay, toast). */
const Watch = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'WATCH' }, extra || {});
  const FACEAPI_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  const PRESENCE_MS = 2000, ROOM_MS = 1000, ROOM_MAX_MS = 8 * 3600 * 1000, ASLEEP_MS = 15000;
  const clockStr = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const secs = () => Math.max(20, Math.min(900, parseInt(typeof settings !== 'undefined' && settings.presenceSecs, 10) || 60));
  // things the tests replace: how a face is looked for, how the page is locked, what time it is
  const deps = {
    detect: null,                                                        // async (video) → true | false | null
    lock: null,                                                          // async () → locks JARVIS (and reloads)
    now: () => Date.now(),
  };

  /* ---------- the face detector (face-api, tiny model, loaded from the CDN on first use) ---------- */
  let faceReady = null;
  function loadFace() {
    if (faceReady) return faceReady;
    faceReady = (async () => {
      if (!window.faceapi) await Camera.loadScript(FACEAPI_URL, 60000);
      if (!window.faceapi) throw new Error('the face detector did not load');
      await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      return window.faceapi;
    })();
    faceReady.catch(() => { faceReady = null; });
    return faceReady;
  }
  async function defaultDetect(video) {
    const api = await loadFace();
    const hit = await api.detectSingleFace(video, new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }));
    return !!hit;
  }
  const detect = v => (deps.detect || defaultDetect)(v);

  async function hiddenVideo(stream) {
    const v = document.createElement('video'); v.playsInline = true; v.muted = true; v.srcObject = stream;
    v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:-99px;top:-99px';
    document.body.appendChild(v); await v.play(); return v;
  }
  const syncSwitch = () => { try { if (typeof bindSwitchState === 'function') { const el = document.querySelector('#presenceToggle'); if (el) bindSwitchState('#presenceToggle', 'presenceLock'); } } catch {} };

  /* ================= presence lock ================= */
  let P = null;
  const presenceOn = () => !!P;
  async function lockNow() {
    stopPresence();
    if (deps.lock) return deps.lock();
    if (typeof settings !== 'undefined' && settings.presenceLockWindows) { try { callTool('/tool/lockSystem', {}); } catch {} }
    try { await callTool('/lock/lock', {}); } catch {}
    location.reload();
  }
  async function presenceStep() {
    if (!P || P.busy) return;
    P.busy = true;
    try {
      const now = deps.now();
      if (now - P.lastTick > ASLEEP_MS) P.tracker.reset();               // the tab was asleep: whatever was seen before is stale
      P.lastTick = now;
      let present = null;
      try { present = await detect(P.video); } catch { present = null; }
      if (!P) return;
      const r = P.tracker.feed(present, deps.now());
      P.state = r.state; P.absentFor = r.absentFor;
      if (r.shouldLock) await lockNow();
    } finally { if (P) P.busy = false; }
  }
  async function startPresence(opts) {
    opts = opts || {};
    if (P) return say('Presence lock is already on. I lock JARVIS after **' + secs() + ' seconds** without seeing a face.');
    const st = await getJSON('/lock/status');
    if (!st || st.error || !st.enabled) {
      if (typeof settings !== 'undefined') { settings.presenceLock = false; if (typeof saveSettings === 'function') saveSettings(); syncSwitch(); }
      return say('Presence lock needs the **app lock** first, because it locks JARVIS the same way. Turn on **Lock JARVIS** in Settings → Security (it uses Windows Hello), then try again. I will not switch the lock on for you.');
    }
    let stream, video;
    try {
      stream = await Camera.getStream({ facing: 'user', width: 320, height: 240 });
      video = await hiddenVideo(stream);
      if (!deps.detect) await loadFace();
    } catch (e) {
      Camera.stopStream(stream); if (video && video.remove) video.remove();
      if (typeof settings !== 'undefined') { settings.presenceLock = false; if (typeof saveSettings === 'function') saveSettings(); syncSwitch(); }
      return say('I could not start the presence lock: ' + (e && e.name ? Camera.camError(e) : 'the face detector could not be downloaded (' + String((e && e.message) || e).slice(0, 60) + '). It needs the internet the first time.'));
    }
    P = { stream, video, tracker: ScanMath.PresenceTracker({ absentMs: secs() * 1000 }), lastTick: deps.now(), state: 'unknown', absentFor: 0, busy: false, since: deps.now() };
    P.timer = setInterval(presenceStep, PRESENCE_MS);
    P.untrack = Camera.track('presence', 'PRESENCE LOCK ON · locks after ' + secs() + ' s', () => { setSetting(false); stopPresence(); });
    if (typeof settings !== 'undefined' && !settings.presenceLock) { settings.presenceLock = true; if (typeof saveSettings === 'function') saveSettings(); syncSwitch(); }
    if (opts.auto) return null;
    return say('✓ Presence lock is **on**. The camera looks for a face every 2 seconds; if nobody is seen for **' + secs() + ' seconds**, JARVIS locks (you open it again with Windows Hello). A picture is never saved or sent anywhere.' +
      (settings && settings.presenceLockWindows ? ' Windows will lock too.' : ' Windows itself is not locked.') + '\n\n*If you read a book with your face turned away, it may lock. Say **“turn off presence lock”** to stop.*', { speak: 'Presence lock is on.' });
  }
  function setSetting(v) { if (typeof settings !== 'undefined') { settings.presenceLock = !!v; if (typeof saveSettings === 'function') saveSettings(); syncSwitch(); } }
  function stopPresence() {
    if (!P) return false;
    const p = P; P = null;
    clearInterval(p.timer); Camera.stopStream(p.stream); if (p.video && p.video.remove) p.video.remove(); if (p.untrack) p.untrack();
    return true;
  }
  const presenceStatus = () => {
    if (!P) return say('Presence lock is **off**. Say **“lock when I leave”** to turn it on (needs the app lock set up in Settings).');
    const how = P.state === 'present' ? 'I can see you.' : P.state === 'away' ? 'I cannot see you (' + Math.round(P.absentFor / 1000) + ' s so far).' : 'I am still getting started.';
    return say('Presence lock is **on**: locks after **' + secs() + ' seconds** with nobody in view. ' + how);
  };
  // The Settings switch and the seconds box call this.
  async function setPresence(on) {
    if (on) { const r = await startPresence({ auto: false }); if (r) jarvisSay(r); }
    else if (stopPresence()) jarvisSay(say('Presence lock is **off**.'));
  }
  function applySeconds() { if (P) { P.tracker = ScanMath.PresenceTracker({ absentMs: secs() * 1000 }); } }

  /* ================= room watch (movement) ================= */
  let R = null;
  const roomOn = () => !!R;
  async function roomStep() {
    if (!R || R.busy) return;
    R.busy = true;
    try {
      const now = deps.now();
      if (now - R.lastTick > 5000) R.det.reset();                        // frames while the tab slept are not comparable
      R.lastTick = now;
      const v = R.video; if (!v.videoWidth) return;
      const r = R.det.feed(Camera.smallGray(v, 80, 60, R.ctx), now);
      R.frames++; R.last = r;
      if (r.alert) await onMotion(now);
      if (now - R.start >= ROOM_MAX_MS) { stopRoom(); jarvisSay(say('I stopped watching the room after 8 hours.')); }
    } finally { if (R) R.busy = false; }
  }
  async function onMotion(now) {
    let saved = '';
    try {
      const canvas = Camera.videoToCanvas(R.video, 1280), blob = await Camera.canvasToBlob(canvas, 0.8);
      const r = await fetch(API + '/room/snapshot', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const j = await r.json().catch(() => ({})); if (j && j.file) saved = j.file;
    } catch {}
    R.alerts++;
    const t = clockStr(now);
    jarvisSay(say('👁 **Movement seen in the room** at ' + t + '.' + (saved ? ' I saved a picture: `' + saved + '`.' : ''), { alert: true, speak: 'Movement seen in the room.' }));
    if (typeof settings !== 'undefined' && settings.phonePush) { try { await callTool('/phone/alert', { text: 'Movement seen in your room at ' + t + '.', kind: 'room' }); } catch {} }
  }
  async function startRoom(source) {
    if (source === 'phone') return say(Camera.PHONE_NO);
    if (R) return say('I am already watching the room (' + R.alerts + ' alert' + (R.alerts === 1 ? '' : 's') + ' so far). Say **“stop watching the room”** to stop.');
    const go = await new Promise(resolve => jarvisSay(say('This turns on the **camera** and watches for movement until you stop it (or 8 hours pass). I save still pictures into `~/jarvis/Watch` (the last 50) and, if phone alerts are on, send your phone a **text-only** alert. No picture leaves this laptop. Keep this JARVIS window open and visible, because browsers slow down hidden tabs. Start?',
      { confirm: { yes: 'START WATCHING', no: 'NO', onConfirm: () => resolve(true), onCancel: () => resolve(false) } })));
    if (!go) return say('Okay, I will not watch the room.');
    let stream, video;
    try { stream = await Camera.getStream({ facing: 'user', width: 640, height: 480 }); video = await hiddenVideo(stream); }
    catch (e) { Camera.stopStream(stream); if (video && video.remove) video.remove(); return say('I could not start the camera: ' + Camera.camError(e)); }
    const c = document.createElement('canvas'); c.width = 80; c.height = 60;
    R = { stream, video, ctx: c.getContext('2d', { willReadFrequently: true }), det: ScanMath.MotionDetector({ warmupMs: 10000, needFrames: 3, cooldownMs: 300000 }), lastTick: deps.now(), start: deps.now(), alerts: 0, frames: 0, busy: false, last: null };
    R.timer = setInterval(roomStep, ROOM_MS);
    R.untrack = Camera.track('room', 'WATCHING THE ROOM', () => stopRoom());
    return say('✓ Watching the room. The first 10 seconds are only for the camera to settle. I will tell you here' + (settings && settings.phonePush ? ' and on your phone (text only)' : '') + ' if something moves. Say **“stop watching the room”** when you are done.', { speak: 'Watching the room.' });
  }
  function stopRoom() {
    if (!R) return false;
    const r = R; R = null;
    clearInterval(r.timer); Camera.stopStream(r.stream); if (r.video && r.video.remove) r.video.remove(); if (r.untrack) r.untrack();
    return true;
  }
  const roomStatus = () => (R ? say('I am **watching the room**: ' + R.alerts + ' alert' + (R.alerts === 1 ? '' : 's') + ' so far, since ' + clockStr(R.start) + '.') : say('I am **not** watching the room. Say **“watch my room”** to start.'));

  /* ================= chat wording (explicit only) ================= */
  const PRES_ON = /^(?:please\s+)?(?:(?:turn|switch)\s+on\s+(?:the\s+)?presence\s+lock|(?:start|enable)\s+(?:the\s+)?presence\s+lock|lock\s+(?:jarvis\s+)?when\s+i\s+(?:leave|walk away|go away|step away|am away))\s*[.!?]*$/i;
  const PRES_OFF = /^(?:please\s+)?(?:(?:turn|switch)\s+off\s+(?:the\s+)?presence\s+lock|(?:stop|disable)\s+(?:the\s+)?presence\s+lock|(?:don'?t|do not|stop)\s+lock\s+(?:jarvis\s+)?when\s+i\s+(?:leave|walk away|go away|step away))\s*[.!?]*$/i;
  const PRES_STATUS = /^(?:presence\s+lock(?:\s+status)?|is\s+(?:the\s+)?presence\s+lock\s+on)\s*[?.!]*$/i;
  const ROOM_ON = /^(?:please\s+)?(?:(?:watch|guard|monitor)\s+(?:my|the)\s+room|(?:start|begin)\s+(?:the\s+)?room\s+(?:watch|guard)|room\s+watch\s+on)\s*[.!?]*$/i;
  const ROOM_OFF = /^(?:please\s+)?(?:(?:stop|end|cancel)\s+(?:watching|guarding|monitoring)\s+(?:my|the)\s+room|(?:stop|end)\s+(?:the\s+)?room\s+(?:watch|guard)|room\s+watch\s+off)\s*[.!?]*$/i;
  const ROOM_STATUS = /^(?:room\s+watch(?:\s+status)?|(?:are|is)\s+(?:you|jarvis)\s+watching\s+(?:my|the)\s+room)\s*[?.!]*$/i;
  function match(t) {
    t = String(t || '').trim();
    if (PRES_ON.test(t)) return { kind: 'presence-on' };
    if (PRES_OFF.test(t)) return { kind: 'presence-off' };
    if (PRES_STATUS.test(t)) return { kind: 'presence-status' };
    if (ROOM_ON.test(t)) return { kind: 'room-on' };
    if (ROOM_OFF.test(t)) return { kind: 'room-off' };
    if (ROOM_STATUS.test(t)) return { kind: 'room-status' };
    return null;
  }
  async function intercept(text, source) {
    const m = match(text); if (!m) return null;
    switch (m.kind) {
      case 'presence-on': return source === 'phone' ? say(Camera.PHONE_NO) : startPresence();
      case 'presence-off': { const was = stopPresence(); setSetting(false); return say(was ? '✓ Presence lock is **off**.' : 'Presence lock was already off.'); }   // stopping is always safe, also from the phone
      case 'presence-status': return presenceStatus();
      case 'room-on': return startRoom(source);
      case 'room-off': return say(stopRoom() ? '✓ I stopped watching the room.' : 'I was not watching the room.');
      case 'room-status': return roomStatus();
    }
    return null;
  }
  // after a page load: start again only if the switch was left on
  function resume() { if (typeof settings !== 'undefined' && settings.presenceLock && !P) startPresence({ auto: true }).catch(() => {}); }

  return { intercept, match, startPresence, stopPresence, setPresence, applySeconds, presenceOn, presenceStep, startRoom, stopRoom, roomOn, roomStep, resume, deps, _state: () => ({ presence: P, room: R }) };
})();
if (typeof module !== 'undefined') module.exports = Watch;
