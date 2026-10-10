'use strict';
/* Camera tools on the page: document scanner, QR reader and maker, "solve this from a photo", and the shared camera panel.
   Everything here needs you at the laptop: a message from the phone is refused (see refusePhone), the camera light is mirrored by an
   on-screen indicator with a Stop button, and nothing is kept unless you save it. Pictures are processed in this browser tab
   (opencv.js is loaded from a CDN the first time the scanner is used; the QR reader uses jsQR, also from a CDN). The only picture that
   leaves the page is the one you send to the AI model with "solve this from a photo", and the card says where it goes.
   Chat wording is explicit on purpose: "scan a document", "scan a QR", "make a QR for …", "solve this from a photo". Uses the page's
   globals (callTool, API, settings, llm, jarvisSay, toast, setState) and ScanMath (scanmath.js). */
const Camera = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'CAMERA' }, extra || {});
  const plain = s => String(s || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
  const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  const PHONE_NO = 'I only use the camera for requests made at the laptop, so I won’t do that from a phone message. Ask me again from JARVIS on the laptop.';
  const refusePhone = source => (source === 'phone' ? say(PHONE_NO) : null);

  /* ================= matching (explicit wording only) ================= */
  const DOC_WORDS = '(?:documents?|docs?|pages?|papers?|sheets?|notes|notebook|worksheets?|assignments?|whiteboard|white board|blackboard|board|slides?|receipts?|textbook|book pages?)';
  const SCAN_DOC = new RegExp('^(?:please\\s+)?(?:\\/scan|(?:scan|digiti[sz]e)\\s+(?:in\\s+)?(?:a|an|the|this|that|my|some|these)?\\s*(?:new\\s+|paper\\s+|handwritten\\s+|printed\\s+|class\\s+|lecture\\s+)*' + DOC_WORDS + '(?:\\s+(?:to|into|as)\\s+(?:a\\s+)?pdf)?(?:\\s+(?:with|using|from)\\s+(?:the\\s+|my\\s+)?(?:camera|webcam))?|scan\\s+(?:it\\s+)?to\\s+pdf|(?:use|open)\\s+(?:the\\s+|my\\s+)?(?:document\\s+)?scanner)\\s*[.!?]*$', 'i');
  const QR_READ = /^(?:please\s+)?(?:\/qr|(?:scan|read|decode)\s+(?:a|an|the|this|that|my)?\s*(?:qr|qr-?code|qr\s*code)(?:\s+code)?(?:\s+(?:with|using|from)\s+(?:the\s+|my\s+)?(?:camera|webcam|photo|picture|image))?|what(?:'s| does| is)\s+(?:this\s+|that\s+)?(?:the\s+)?qr(?:\s*code)?\s+(?:say|says|mean|means|of)|qr\s+(?:scan|scanner|reader))\s*[.!?]*$/i;
  const QR_MAKE = /^(?:please\s+)?(?:\/qr\s+(.+)|(?:make|create|generate|build|give me|draw)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?qr(?:\s*code)?\s+(?:for|of|with|from|to|containing)\s+(.+)|qr(?:\s*code)?\s+(?:for|of)\s+(.+))$/i;
  const PHOTO_ASK = /^(?:please\s+)?(?:\/photo(?:\s+(.+))?|(?:solve|answer|explain|work out|do|check)\s+(?:this|that|the|my)?\s*(?:problem|question|equation|sum|exercise|homework|diagram|circuit|figure|expression)?\s*(?:from|in|on|using|with)\s+(?:a|the|this|my)?\s*(?:photo|picture|image|pic|camera)|(?:look at|read|describe|identify|what(?:'s| is) in|what(?:'s| is) on)\s+(?:this|that|a|the|my)?\s*(?:photo|picture|image|pic)|(?:take|snap)\s+a\s+(?:photo|picture|pic)\s+(?:and|to)\s+(?:solve|read|ask|explain|describe|identify|check)(?:\s+(?:it|this|that))?)\s*[.!?]*$/i;

  // → { kind: 'scan' } | { kind: 'qr' } | { kind: 'qrmake', text } | { kind: 'photo', question } | null
  function match(t) {
    t = String(t || '').trim();
    let m;
    if (SCAN_DOC.test(t)) return { kind: 'scan' };
    if ((m = t.match(QR_MAKE))) { const text = (m[1] || m[2] || m[3] || '').trim().replace(/^["“']|["”']$/g, ''); return text ? { kind: 'qrmake', text } : null; }
    if (QR_READ.test(t)) return { kind: 'qr' };
    if ((m = t.match(PHOTO_ASK))) return { kind: 'photo', question: (m[1] || '').trim() };
    return null;
  }

  /* ================= loading the helper libraries (CDN, on first use) ================= */
  const scripts = new Map();
  function loadScript(url, ms = 90000) {
    if (scripts.has(url)) return scripts.get(url);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const timer = setTimeout(() => { s.remove(); reject(new Error('timed out')); }, ms);
      s.src = url; s.async = true;
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('could not be downloaded')); };
      document.head.appendChild(s);
    });
    scripts.set(url, p);
    p.catch(() => scripts.delete(url));                                  // a failure is not remembered: the next try downloads again
    return p;
  }
  let cvPromise = null;
  function loadOpenCV(onStatus) {
    if (typeof window !== 'undefined' && window.__cv && window.__cv.Mat) return Promise.resolve(window.__cv);
    if (cvPromise) return cvPromise;
    cvPromise = (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You are offline');
      if (onStatus) onStatus('Loading the scanner engine (about 10 MB, only the first time)…');
      await loadScript(OPENCV_URL);
      let c = window.cv;
      if (!c) throw new Error('the scanner engine did not start');
      if (c.Mat) return (window.__cv = c);
      // newer builds hand back a Promise-like module; older ones call onRuntimeInitialized
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the scanner engine took too long to start')), 60000);
        const done = m => { clearTimeout(timer); resolve(m && m.Mat ? m : window.cv); };
        if (typeof c.then === 'function') c.then(m => { if (m && typeof m.then === 'function') delete m.then; done(m); }, reject);
        else c.onRuntimeInitialized = () => done(window.cv);
      });
      if (!ready || !ready.Mat) throw new Error('the scanner engine did not start');
      return (window.__cv = ready);
    })();
    cvPromise.catch(() => { cvPromise = null; });
    return cvPromise;
  }
  const loadJsQR = () => (typeof window !== 'undefined' && typeof window.jsQR === 'function' ? Promise.resolve(window.jsQR) : loadScript(JSQR_URL, 30000).then(() => window.jsQR));

  /* ================= camera access, indicator, panel ================= */
  const camError = e => {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser did not let me use the camera. Click the camera icon in the address bar and allow it, or choose a photo from your files instead.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'I could not find a camera on this computer. You can choose a photo from your files instead.';
    if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy (another program may be using it). Close that program and try again, or choose a photo from your files.';
    return 'I could not start the camera (' + String((e && e.message) || e).slice(0, 80) + ').';
  };
  async function getStream(opts) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no camera API'), { name: 'NotFoundError' });
    const o = Object.assign({ facing: 'environment', width: 1920, height: 1080 }, opts || {});
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: o.facing, width: { ideal: o.width }, height: { ideal: o.height } }, audio: false });
  }
  const stopStream = s => { try { s && s.getTracks().forEach(t => t.stop()); } catch {} };

  // Every live camera shows here, with a way to stop it. Features register with track(name, label, stop) and call the returned function when done.
  const active = new Map();
  function renderPill() {
    let pill = document.getElementById('camPill');
    if (!active.size) { if (pill) pill.remove(); return; }
    ensureStyles();
    if (!pill) { pill = document.createElement('div'); pill.id = 'camPill'; pill.className = 'cam-pill'; pill.setAttribute('role', 'status'); document.body.appendChild(pill); }
    pill.innerHTML = '';
    for (const [name, a] of active) {
      const row = document.createElement('div'); row.className = 'cam-pill-row';
      const dot = document.createElement('span'); dot.className = 'cam-dot'; dot.setAttribute('aria-hidden', 'true');
      const lab = document.createElement('span'); lab.textContent = a.label;
      const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'cbtn danger'; stop.textContent = 'STOP'; stop.setAttribute('aria-label', 'Stop: ' + a.label);
      stop.onclick = () => { try { a.stop(); } catch {} untrack(name); };
      row.append(dot, lab, stop); pill.appendChild(row);
    }
  }
  function track(name, label, stop) { active.set(name, { label, stop }); renderPill(); return () => untrack(name); }
  function untrack(name) { if (active.delete(name)) renderPill(); }
  const isActive = name => active.has(name);

  let styled = false;
  function ensureStyles() {
    if (styled || typeof document === 'undefined') return; styled = true;
    const css = `
.cam-panel{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(2,7,12,.84);backdrop-filter:blur(4px)}
.cam-card{width:min(940px,96vw);max-height:95vh;display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--line-hi);border-radius:var(--r);background:var(--panel);box-shadow:0 0 40px var(--glow);overflow:auto}
.cam-head{display:flex;align-items:center;gap:10px}.cam-title{font-family:var(--disp);letter-spacing:.14em;font-size:13px;color:var(--cyan);flex:1}
.cam-x{font-size:16px;color:var(--dim);padding:2px 8px}.cam-x:hover{color:var(--red)}
.cam-hint{font-family:var(--mono);font-size:12px;color:var(--dim);line-height:1.5}
.cam-stage{position:relative;display:flex;justify-content:center;align-items:center;min-height:200px;border:1px dashed var(--line-hi);border-radius:8px;background:rgba(0,0,0,.35);overflow:hidden}
.cam-stage video,.cam-stage canvas{max-width:100%;max-height:62vh;display:block}
.cam-stage canvas.cam-edit{touch-action:none;cursor:crosshair}
.cam-drop{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(var(--rgb),.18);font-family:var(--mono);color:var(--cyan-hi);pointer-events:none}
.cam-stage.over .cam-drop{display:flex}
.cam-status{font-family:var(--mono);font-size:12px;color:var(--amber);min-height:16px}
.cam-row{display:flex;flex-wrap:wrap;gap:8px}.cam-row .cbtn.primary{background:rgba(var(--rgb),.22);border-color:var(--cyan)}
.cam-row .cbtn.on{background:rgba(var(--rgb),.3);color:var(--cyan-hi)}
.cam-pill{position:fixed;left:14px;bottom:14px;z-index:9100;display:flex;flex-direction:column;gap:6px}
.cam-pill-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(255,95,107,.55);border-radius:20px;background:rgba(20,6,9,.88);font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:#ffd6d9}
.cam-dot{width:9px;height:9px;border-radius:50%;background:var(--red);animation:camPulse 1.2s infinite}
@keyframes camPulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.cam-dot{animation:none}}`;
    const st = document.createElement('style'); st.id = 'camStyles'; st.textContent = css; document.head.appendChild(st);
  }

  // A modal panel: openPanel({title, hint}) → { body(node), buttons([{label, fn, primary, on}]), status(text), close(), stage, onCancel(fn) }
  function openPanel(o) {
    ensureStyles();
    const root = document.createElement('div'); root.className = 'cam-panel'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', o.title || 'Camera');
    root.innerHTML = '<div class="cam-card"><div class="cam-head"><b class="cam-title"></b><button type="button" class="cam-x cbtn" aria-label="Close">✕</button></div><div class="cam-hint"></div><div class="cam-stage"><div class="cam-drop">DROP A PHOTO HERE</div></div><div class="cam-status" role="status"></div><div class="cam-row"></div></div>';
    const $q = s => root.querySelector(s);
    $q('.cam-title').textContent = o.title || 'Camera'; $q('.cam-hint').textContent = o.hint || '';
    const stage = $q('.cam-stage'), row = $q('.cam-row');
    let cancelFn = null, closed = false;
    const prevFocus = document.activeElement;
    const api = {
      root, stage,
      body(node) { for (const c of [...stage.children]) if (!c.classList.contains('cam-drop')) c.remove(); if (node) stage.insertBefore(node, stage.firstChild); },
      hint(t) { $q('.cam-hint').textContent = t || ''; },
      title(t) { $q('.cam-title').textContent = t; },
      status(t) { $q('.cam-status').textContent = t || ''; },
      buttons(list) {
        row.innerHTML = '';
        for (const b of list || []) {
          const el = document.createElement('button'); el.type = 'button'; el.className = 'cbtn' + (b.primary ? ' primary' : '') + (b.on ? ' on' : '') + (b.danger ? ' danger' : ''); el.textContent = b.label;
          if (b.disabled) el.disabled = true;
          el.onclick = () => b.fn(el); row.appendChild(el);
        }
        const first = row.querySelector('.primary') || row.querySelector('button'); if (first) first.focus();
      },
      onCancel(fn) { cancelFn = fn; },
      onDrop(fn) {
        stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('over'); });
        stage.addEventListener('dragleave', () => stage.classList.remove('over'));
        stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) fn(f); });
      },
      close() { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); root.remove(); try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {} },
    };
    const cancel = () => { if (closed) return; if (cancelFn) cancelFn(); api.close(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (e.key === 'Tab') {                                        // keep focus inside the dialog
        const f = [...root.querySelectorAll('button:not([disabled]), input, [tabindex]')]; if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    $q('.cam-x').onclick = cancel;
    document.body.appendChild(root);
    return api;
  }

  /* ================= pictures ================= */
  async function fileToCanvas(file, maxSide = 2400) {
    if (!file || !/^image\//.test(file.type || '') ) throw new Error('That is not a picture file.');
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { throw new Error('This browser cannot open that kind of picture (' + (file.type || 'unknown') + '). Save or export it as a JPEG or PNG and try again.'); }
    const { w, h } = ScanMath.fitSize(bmp.width, bmp.height, maxSide);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h); if (bmp.close) bmp.close();
    return c;
  }
  function videoToCanvas(video, maxSide = 2400) {
    const { w, h } = ScanMath.fitSize(video.videoWidth || 640, video.videoHeight || 480, maxSide);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    return c;
  }
  const canvasToBlob = (c, q = 0.88) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not make the picture file.'))), 'image/jpeg', q));
  const blobToBase64 = async b => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
  // The grey 9×8-style small frames used by the watchers
  function smallGray(video, w, h, ctx) {
    ctx.drawImage(video, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    return g;
  }

  // Take a photo with the camera, or choose / drop a picture file. → { canvas, source } or null (cancelled).
  async function capture(o) {
    o = o || {};
    const panel = openPanel({ title: o.title || 'TAKE A PHOTO', hint: o.hint || 'Point the camera, then press TAKE PHOTO. Or choose a picture from your files, or drop one here.' });
    let stream = null, video = null, done = false;
    const untrackCam = () => untrack('capture');
    const finish = (val) => { if (done) return; done = true; stopStream(stream); untrackCam(); panel.close(); resolve(val); };
    let resolve; const result = new Promise(r => { resolve = r; });
    panel.onCancel(() => { if (!done) { done = true; stopStream(stream); untrackCam(); resolve(null); } });
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; panel.root.appendChild(file);
    const fromFile = async f => { panel.status('Opening the picture…'); try { finish({ canvas: await fileToCanvas(f, o.maxSide || 2400), source: 'file' }); } catch (e) { panel.status(e.message); } };
    file.onchange = () => { if (file.files[0]) fromFile(file.files[0]); };
    panel.onDrop(fromFile);
    const buttons = cam => [
      cam ? { label: '📷 TAKE PHOTO', primary: true, fn: () => { if (video && video.videoWidth) finish({ canvas: videoToCanvas(video, o.maxSide || 2400), source: 'camera' }); else panel.status('The camera is still starting…'); } } : null,
      { label: '📁 CHOOSE A PHOTO', primary: !cam, fn: () => file.click() },
      { label: 'CANCEL', danger: true, fn: () => finish(null) },
    ].filter(Boolean);
    panel.buttons(buttons(false));
    try {
      stream = await getStream({ facing: o.facing || 'environment' });
      if (done) { stopStream(stream); return result; }
      video = document.createElement('video'); video.playsInline = true; video.muted = true; video.srcObject = stream;
      panel.body(video); await video.play();
      track('capture', 'CAMERA ON · ' + (o.title || 'photo').toLowerCase(), () => finish(null));
      panel.buttons(buttons(true)); panel.status('');
    } catch (e) { panel.status(camError(e)); }
    return result;
  }

  /* ================= document scanner ================= */
  async function detectQuad(canvas, onStatus) {
    const cv = await loadOpenCV(onStatus);
    const k = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
    const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(canvas.width * k)); small.height = Math.max(1, Math.round(canvas.height * k));
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    const mats = []; const keep = m => (mats.push(m), m);
    try {
      const src = keep(cv.imread(small)), gray = keep(new cv.Mat()), blur = keep(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      const edges = keep(new cv.Mat()); cv.Canny(blur, edges, 50, 150);
      cv.dilate(edges, edges, keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))));
      const th = keep(new cv.Mat()); cv.threshold(blur, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      for (const bin of [edges, th]) {
        const contours = keep(new cv.MatVector()), hier = keep(new cv.Mat());
        cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        const list = [];
        for (let i = 0; i < contours.size(); i++) { const c = keep(contours.get(i)); list.push({ c, area: cv.contourArea(c) }); }
        list.sort((a, b) => b.area - a.area);
        for (const { c } of list.slice(0, 8)) {
          const approx = keep(new cv.Mat()); cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
          if (approx.rows !== 4) continue;
          const pts = [0, 1, 2, 3].map(i => ({ x: approx.data32S[i * 2] / k, y: approx.data32S[i * 2 + 1] / k }));
          if (ScanMath.isGoodQuad(pts, canvas.width, canvas.height)) return ScanMath.orderCorners(pts);
        }
      }
      return null;
    } finally { for (const m of mats) { try { m.delete(); } catch {} } }
  }
  async function flatten(canvas, corners, onStatus) {
    const cv = await loadOpenCV(onStatus);
    const { w, h } = ScanMath.targetSize(corners);
    const mats = []; const keep = m => (mats.push(m), m);
    try {
      const src = keep(cv.imread(canvas));
      const s = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [corners.tl.x, corners.tl.y, corners.tr.x, corners.tr.y, corners.br.x, corners.br.y, corners.bl.x, corners.bl.y]));
      const d = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]));
      const M = keep(cv.getPerspectiveTransform(s, d)), dst = keep(new cv.Mat());
      cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
      const out = document.createElement('canvas'); out.width = w; out.height = h; cv.imshow(out, dst);
      return out;
    } finally { for (const m of mats) { try { m.delete(); } catch {} } }
  }
  // Without the scanner engine (offline): crop to the box around the corners. Not flattened, but usable.
  function cropOnly(canvas, corners) {
    const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x], ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
    const x = Math.max(0, Math.floor(Math.min(...xs))), y = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.max(1, Math.min(canvas.width, Math.ceil(Math.max(...xs))) - x), h = Math.max(1, Math.min(canvas.height, Math.ceil(Math.max(...ys))) - y);
    const out = document.createElement('canvas'); out.width = w; out.height = h; out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return out;
  }
  function cleanCanvas(canvas, mode) {
    const ctx = canvas.getContext('2d'), img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    out.getContext('2d').putImageData(new ImageData(ScanMath.enhance(img.data, canvas.width, canvas.height, mode), canvas.width, canvas.height), 0, 0);
    return out;
  }
  const MODES = [['document', 'DOCUMENT'], ['grey', 'GREY'], ['whiteboard', 'WHITEBOARD'], ['colour', 'COLOUR']];
  const tick = () => new Promise(r => setTimeout(r, 20));

  // Drag the four corners over the photo. → corners ({tl,tr,br,bl}, in photo pixels) or null (back / cancel)
  function editCorners(panel, photo, corners, detected) {
    return new Promise(resolve => {
      const cv2 = document.createElement('canvas'); cv2.className = 'cam-edit'; cv2.width = photo.width; cv2.height = photo.height;
      const ctx = cv2.getContext('2d');
      const pts = { tl: { ...corners.tl }, tr: { ...corners.tr }, br: { ...corners.br }, bl: { ...corners.bl } };
      const names = ['tl', 'tr', 'br', 'bl'];
      const draw = () => {
        ctx.clearRect(0, 0, cv2.width, cv2.height); ctx.drawImage(photo, 0, 0);
        const r = Math.max(10, cv2.width / 70);
        ctx.lineWidth = Math.max(2, cv2.width / 400); ctx.strokeStyle = '#3fd9ff'; ctx.fillStyle = 'rgba(63,217,255,.12)';
        ctx.beginPath(); names.forEach((n, i) => (i ? ctx.lineTo(pts[n].x, pts[n].y) : ctx.moveTo(pts[n].x, pts[n].y))); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3fd9ff'; for (const n of names) { ctx.beginPath(); ctx.arc(pts[n].x, pts[n].y, r, 0, Math.PI * 2); ctx.fill(); }
      };
      let drag = null;
      const pos = e => { const b = cv2.getBoundingClientRect(); return { x: (e.clientX - b.left) * cv2.width / b.width, y: (e.clientY - b.top) * cv2.height / b.height }; };
      cv2.onpointerdown = e => {
        const p = pos(e), reach = Math.max(30, cv2.width / 25);
        let best = null, bd = reach; for (const n of names) { const d = Math.hypot(pts[n].x - p.x, pts[n].y - p.y); if (d < bd) { bd = d; best = n; } }
        if (best) { drag = best; cv2.setPointerCapture(e.pointerId); e.preventDefault(); }
      };
      cv2.onpointermove = e => { if (!drag) return; const p = pos(e); pts[drag] = { x: Math.max(0, Math.min(cv2.width, p.x)), y: Math.max(0, Math.min(cv2.height, p.y)) }; draw(); };
      cv2.onpointerup = () => { drag = null; };
      panel.body(cv2); draw();
      panel.hint(detected ? 'I found the page. Drag the blue dots if an edge is off, then press FLATTEN.' : 'I could not find the page edges by myself. Drag the four dots onto the corners of the page, then press FLATTEN.');
      panel.status('');
      panel.buttons([
        { label: 'FLATTEN & CLEAN', primary: true, fn: () => {
          if (!ScanMath.isGoodQuad([pts.tl, pts.tr, pts.br, pts.bl], photo.width, photo.height, { minFrac: 0.02, maxFrac: 1.2, minAngle: 15, maxSideRatio: 12 })) return panel.status('Those four dots do not make a sensible page shape. Move them onto the corners.');
          resolve({ tl: { ...pts.tl }, tr: { ...pts.tr }, br: { ...pts.br }, bl: { ...pts.bl } });
        } },
        { label: 'USE THE WHOLE PHOTO', fn: () => resolve({ tl: { x: 0, y: 0 }, tr: { x: photo.width, y: 0 }, br: { x: photo.width, y: photo.height }, bl: { x: 0, y: photo.height }, whole: true }) },
        { label: 'RETAKE', fn: () => resolve('retake') },
        { label: 'CANCEL', danger: true, fn: () => resolve(null) },
      ]);
      panel.onCancel(() => resolve(null));
    });
  }

  async function scanDocument(source) {
    const no = refusePhone(source); if (no) return no;
    let scanId = null, count = 0, whiteboardHint = false;
    const discard = async () => { if (scanId) { await callTool('/scan/discard', { scan: scanId }); scanId = null; } };
    const upload = async canvas => {
      const blob = await canvasToBlob(canvas, 0.88);
      const r = await fetch(API + '/scan/page' + (scanId ? '?scan=' + scanId : ''), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const j = await r.json().catch(() => ({ error: 'Bad answer from the server (' + r.status + ')' }));
      if (!r.ok || j.error) throw new Error(j.error || 'Could not keep that page.');
      scanId = j.scan; count = j.pages;
    };
    let panel = null;
    try {
      for (;;) {
        // 1. take or choose the photo
        const shot = await capture({ title: 'SCAN · PAGE ' + (count + 1), hint: 'Lay the page flat with some contrast behind it (a dark desk for white paper) and good light. Then press TAKE PHOTO.' });
        if (!shot) { await discard(); return say(count ? 'Okay. I discarded the ' + plural(count, 'page') + ' you had scanned.' : 'Okay, cancelled the scan.'); }
        panel = openPanel({ title: 'SCAN · PAGE ' + (count + 1), hint: 'Looking for the page…' });
        let cancelled = false; panel.onCancel(() => { cancelled = true; });
        panel.buttons([{ label: 'CANCEL', danger: true, fn: () => { cancelled = true; panel.close(); } }]);
        // 2. find the corners (the scanner engine is downloaded the first time)
        let corners = null, engine = true;
        panel.body(shot.canvas); panel.status('Looking for the page edges…');
        try { corners = await detectQuad(shot.canvas, t => panel.status(t)); }
        catch (e) { engine = false; panel.status('The scanner engine is not available (' + plain(e.message) + '), so I can crop but not straighten.'); await new Promise(r => setTimeout(r, 1200)); }
        if (cancelled) { await discard(); return say('Okay, cancelled the scan.'); }
        const whole = { tl: { x: 0, y: 0 }, tr: { x: shot.canvas.width, y: 0 }, br: { x: shot.canvas.width, y: shot.canvas.height }, bl: { x: 0, y: shot.canvas.height } };
        // 3. let the person adjust them
        let page = null, start = corners || whole;
        for (;;) {
          const picked = await editCorners(panel, shot.canvas, start, !!corners);
          if (picked === 'retake') { panel.close(); page = 'retake'; break; }
          if (!picked) { panel.close(); await discard(); return say('Okay, cancelled the scan.'); }
          if (!picked.whole) start = picked;                              // "back" returns to where the dots were left
          panel.status('Straightening the page…'); await tick();
          let flat;
          try { flat = picked.whole ? shot.canvas : (engine ? await flatten(shot.canvas, picked, t => panel.status(t)) : cropOnly(shot.canvas, picked)); }
          catch (e) { flat = cropOnly(shot.canvas, picked); panel.status('Could not straighten it (' + plain(e.message) + '); cropped instead.'); await new Promise(r => setTimeout(r, 1000)); }
          // 4. choose the look and decide what to do with the page
          const cache = {}; let mode = whiteboardHint ? 'whiteboard' : 'document';
          const show = async m => {
            panel.status('Cleaning the page…'); await tick();
            if (!cache[m]) cache[m] = cleanCanvas(flat, m);
            mode = m; panel.body(cache[m]); panel.status(plural(count + 1, 'page') + ' so far, including this one if you add it.');
            panel.buttons(actions());
          };
          const actions = () => [
            ...MODES.map(([m, label]) => ({ label, on: m === mode, fn: () => show(m) })),
            { label: 'ADD ANOTHER PAGE', primary: true, fn: () => resolveStage('more') },
            { label: 'SAVE AS PDF', primary: true, fn: () => resolveStage('save') },
            { label: '← CORNERS', fn: () => resolveStage('back') },
            { label: 'CANCEL', danger: true, fn: () => resolveStage('cancel') },
          ];
          let resolveStage; const stage = new Promise(r => { resolveStage = r; });
          panel.hint('Pick the look that reads best. DOCUMENT is black and white, GREY keeps shading, WHITEBOARD keeps marker colours.');
          panel.onCancel(() => resolveStage('cancel'));
          await show(mode);
          const choice = await stage;
          if (choice === 'back') { continue; }
          if (choice === 'cancel') { panel.close(); await discard(); return say('Okay, cancelled the scan.'); }
          panel.status('Keeping the page…');
          try { await upload(cache[mode]); } catch (e) { panel.close(); await discard(); return say('I could not keep that page: ' + e.message); }
          page = choice; panel.close(); break;
        }
        if (page === 'retake') continue;
        if (page === 'more') continue;
        break;                                                           // 'save'
      }
      setState && setState('PROCESSING', 'Reading the text and making the PDF…');
      const r = await callTool('/scan/finish', { scan: scanId });
      scanId = null;
      if (r.error) return say('I could not save the scan: ' + r.error);
      const lines = ['✓ Saved a **' + r.pages + '-page PDF**: `' + r.file + '`'];
      if (r.searchable) lines.push('I read about **' + r.words + ' words** and put them behind the pictures, so you can search the PDF (Ctrl+F in the PDF viewer).' + (r.skipped ? ' ' + plural(r.skipped, 'word') + ' with non-Latin letters could not be added to the search layer.' : ''));
      else lines.push('I could not read any text from it' + (r.problems && r.problems.length ? ' (' + plain(r.problems[0]) + ')' : '') + ', so the PDF is pictures only. Better light and a flatter page help.');
      if (r.textFile) lines.push('The text is also saved as `' + r.textFile + '`.');
      lines.push('*Handwriting is usually not read well, and the text may have mistakes.*');
      const actions = [{ label: 'OPEN THE PDF', fn: () => callTool('/tool/openFile', { name: r.file }) }];
      const sug = r.textFile ? ['Summarise ' + r.textFile.split('/').pop(), 'Make flashcards from ' + r.textFile.split('/').pop()] : [];
      return say(lines.join('\n\n'), { speak: 'Saved your scan as a ' + plural(r.pages, 'page') + ' PDF.', actions, suggestions: sug });
    } catch (e) {
      try { await discard(); } catch {}
      if (panel) panel.close();
      return say('The scan stopped: ' + plain(e.message));
    }
  }

  /* ================= QR reader and maker ================= */
  const copyText = async t => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  function describeQr(q) {
    const e = s => String(s || '');
    const quote = s => '`' + e(s).replace(/`/g, "'").slice(0, 600) + '`';
    switch (q.kind) {
      case 'link': {
        const lines = ['**A link** to **' + q.host + '**', quote(q.text)];
        if (q.warn.length) lines.push('⚠ Be careful: ' + q.warn.join('; ') + '.');
        if (!q.openable) lines.push('*This is not a normal web link (' + q.scheme + '), so I will not open it.*');
        lines.push('*I did not open it. Check that you trust it first.*');
        return { text: lines.join('\n\n'), speak: 'It is a link to ' + q.host.replace(/\./g, ' dot ') + '. I did not open it.', actions: q.openable ? [{ label: 'OPEN THE LINK', fn: () => callTool('/tool/openUrl', { url: q.url }) }] : [] };
      }
      case 'wifi': {
        const lines = ['**A Wi-Fi network:** ' + e(q.ssid) + ' (' + (q.security === 'NOPASS' ? 'open, no password' : q.security) + (q.hidden ? ', hidden' : '') + ')'];
        if (q.hasPassword) lines.push('It has a password. I am keeping it out of the chat; use COPY PASSWORD and paste it into the Wi-Fi box.');
        lines.push('*I did not connect to anything.*');
        return { text: lines.join('\n\n'), speak: 'It is the Wi-Fi network ' + e(q.ssid) + '.', actions: q.hasPassword ? [{ label: 'COPY PASSWORD', fn: async () => { toast((await copyText(q.password)) ? 'Password copied' : 'Could not copy it', false); } }] : [] };
      }
      case 'contact': return { text: ['**A contact card:** ' + (q.name || 'no name'), q.org && 'Organisation: ' + q.org, q.phones.length && 'Phone: ' + q.phones.join(', '), q.emails.length && 'Email: ' + q.emails.join(', ')].filter(Boolean).join('\n\n'), speak: 'It is a contact card for ' + (q.name || 'someone') + '.' };
      case 'email': return { text: '**An email address:** ' + quote(q.address), speak: 'It is an email address.' };
      case 'phone': return { text: '**A phone number:** ' + quote(q.number), speak: 'It is a phone number.' };
      case 'sms': return { text: '**A text message** to ' + quote(q.number) + (q.body ? ' saying ' + quote(q.body) : ''), speak: 'It is a text message draft.' };
      case 'location': return { text: '**A map location:** ' + quote(q.coords), speak: 'It is a map location.', actions: [{ label: 'OPEN ON THE MAP', fn: () => callTool('/tool/openUrl', { url: 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(q.coords.split(',')[0]) + '&mlon=' + encodeURIComponent((q.coords.split(',')[1] || '')) + '#map=17/' + encodeURIComponent(q.coords.split(',')[0]) + '/' + encodeURIComponent(q.coords.split(',')[1] || '') }) }] };
      case 'payment': return { text: '**A payment request** (UPI):\n\n' + quote(q.text) + '\n\n⚠ I will never pay for you. Check the name and the amount in your payment app before you do anything.', speak: 'It is a payment request. I will not act on it.' };
      case 'empty': return { text: 'The code was empty.' };
      default: return { text: '**It says:**\n\n' + quote(q.text), speak: q.text.length < 120 ? 'It says: ' + q.text : 'It is some text. It is on screen.' };
    }
  }
  async function decodeCanvas(canvas) {
    const jsQR = await loadJsQR();
    const k = Math.min(1, 1000 / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas'); c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const hit = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    return hit ? hit.data : null;
  }
  async function readQr(source) {
    const no = refusePhone(source); if (no) return no;
    try { await loadJsQR(); } catch (e) { return say('The QR reader could not be downloaded (' + plain(e.message) + '). It needs the internet the first time.'); }
    const panel = openPanel({ title: 'READ A QR CODE', hint: 'Hold the code in front of the camera. It reads by itself. Or choose a picture that has a QR code, or drop one here.' });
    return new Promise(async resolve => {
      let stream = null, timer = 0, done = false, forgetCam = () => {};
      const finish = v => { if (done) return; done = true; clearInterval(timer); stopStream(stream); forgetCam(); panel.close(); resolve(v); };
      panel.onCancel(() => { if (!done) { done = true; clearInterval(timer); stopStream(stream); forgetCam(); resolve(say('Okay, stopped.')); } });
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; panel.root.appendChild(file);
      const fromFile = async f => {
        panel.status('Reading the picture…');
        try { const text = await decodeCanvas(await fileToCanvas(f, 1600)); if (text == null) return panel.status('I could not find a QR code in that picture. Try a closer, sharper one.'); finish(show(text)); }
        catch (e) { panel.status(e.message); }
      };
      file.onchange = () => { if (file.files[0]) fromFile(file.files[0]); };
      panel.onDrop(fromFile);
      panel.buttons([{ label: '📁 CHOOSE A PICTURE', fn: () => file.click() }, { label: 'CANCEL', danger: true, fn: () => finish(say('Okay, stopped.')) }]);
      const show = text => { const q = ScanMath.parseQr(text), d = describeQr(q); return say(d.text, { speak: d.speak, actions: d.actions }); };
      try {
        stream = await getStream({ facing: 'environment', width: 1280, height: 720 });
        if (done) { stopStream(stream); return; }
        const video = document.createElement('video'); video.playsInline = true; video.muted = true; video.srcObject = stream; panel.body(video); await video.play();
        forgetCam = track('qr', 'CAMERA ON · reading a QR code', () => finish(say('Okay, stopped.')));
        panel.status('Looking for a QR code…');
        const jsQR = await loadJsQR(); const work = document.createElement('canvas'), ctx = work.getContext('2d', { willReadFrequently: true });
        timer = setInterval(() => {
          if (done || !video.videoWidth) return;
          const { w, h } = ScanMath.fitSize(video.videoWidth, video.videoHeight, 720); work.width = w; work.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h), hit = jsQR(d.data, w, h, { inversionAttempts: 'dontInvert' });
          if (hit && hit.data) finish(show(hit.data));
        }, 200);
        setTimeout(() => { if (!done) panel.status('Still looking… move closer, or hold it steadier and in better light.'); }, 20000);
      } catch (e) { panel.status(camError(e)); }
    });
  }
  const slug = s => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'code';
  async function makeQr(text) {
    text = String(text || '').trim();
    if (!text) return say('Tell me what the QR code should say, e.g. **“make a QR for https://example.com”**.');
    if (text.length > 900) return say('That is too long for a QR code that phones read easily (' + text.length + ' characters; the limit here is 900). Use a shorter link.');
    if (typeof qrcode === 'undefined') return say('The QR maker is not loaded. Reload JARVIS and try again.');
    let svg;
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); svg = q.createSvgTag({ cellSize: 8, margin: 4, scalable: true }); }
    catch (e) { return say('I could not make a QR code from that (' + plain(e.message) + ').'); }
    let name = 'QR/qr-' + slug(text) + '.svg', r, n = 1;
    for (;;) {
      r = await callTool('/tool/writeFile', { name, content: svg });
      if (!(r && r.exists) || n >= 9) break;
      name = 'QR/qr-' + slug(text) + '-' + (++n) + '.svg';
    }
    if (r.error) return say('I made the code but could not save it: ' + r.error);
    if (r.exists) return say('There are already several QR files with that name. Delete some in `~/jarvis/QR` and try again.');
    const holder = document.createElement('div'); holder.style.cssText = 'max-width:200px;background:#fff;padding:8px;border-radius:8px;margin-top:8px'; holder.innerHTML = svg;
    return say('✓ Made a QR code for ' + (/^https?:/i.test(text) ? '**' + text.slice(0, 80) + '**' : '“' + text.slice(0, 80) + '”') + ' and saved it as `' + r.name + '`.\n\n*Test it with your phone before you print it.*',
      { speak: 'Your QR code is ready.', extraNode: holder, actions: [{ label: 'OPEN THE PICTURE', fn: () => callTool('/tool/openFile', { name: r.name }) }] });
  }

  /* ================= solve / describe from a photo ================= */
  async function askPhoto(question, source) {
    const no = refusePhone(source); if (no) return no;
    if (typeof llmReady === 'function' && !llmReady()) return say('The AI brain is off or not reachable, and it is the part that looks at pictures. Turn it on in Settings first.');
    const cloud = typeof isCloudModel === 'function' && isCloudModel(llm.model);
    if (cloud) {
      const provider = typeof modelInfo === 'function' ? modelInfo(llm.model).providerLabel : 'an online provider';
      const go = await new Promise(resolve => jarvisSay({ text: 'The AI model you picked runs online (**' + provider + '**). If I look at a photo, **the photo is sent to them**. Go ahead?', noPersona: true, intent: 'CAMERA', confirm: { yes: 'YES, SEND THE PHOTO', no: 'NO', onConfirm: () => resolve(true), onCancel: () => resolve(false) } }));
      if (!go) return say('Okay, nothing was sent.');
    }
    const shot = await capture({ title: 'PHOTO · ASK ABOUT IT', hint: 'Point the camera at the problem, close enough to read it, in good light. Then press TAKE PHOTO.', maxSide: 1280 });
    if (!shot) return say('Okay, cancelled.');
    let blob = await canvasToBlob(shot.canvas, 0.85);
    for (let q = 0.75; blob.size > 1.8 * 1024 * 1024 && q > 0.35; q -= 0.15) blob = await canvasToBlob(shot.canvas, q);
    setState && setState('PROCESSING', 'Looking at the photo…');
    const q = question || 'What is in this picture? If it shows a problem or an equation, solve it step by step.';
    const r = await callTool('/vision/ask', { image: await blobToBase64(blob), question: q, model: llm.model || undefined });
    if (r.error) return say('I could not look at it: ' + r.error);
    const warn = '\n\n*A small local model can make mistakes, especially in maths and with handwriting. Check the answer' + (r.usedOcr ? '. I also read the text in the picture to help.' : '.') + '*' + (r.cloud ? ' *The photo was sent to your online AI provider.*' : '');
    return say(r.answer + warn, { speak: r.answer.length < 300 ? plain(r.answer) : 'I looked at it. The answer is on screen.', suggestions: ['Solve another photo'] });
  }

  /* ================= router ================= */
  async function intercept(text, source) {
    const m = match(text); if (!m) return null;
    switch (m.kind) {
      case 'scan': return scanDocument(source);
      case 'qr': return readQr(source);
      case 'qrmake': return makeQr(m.text);                              // no camera involved, so a phone may ask for this
      case 'photo': return askPhoto(m.question, source);
    }
    return null;
  }

  const plural = (n, w) => (typeof globalThis.plural === 'function' ? globalThis.plural(n, w) : n + ' ' + w + (n === 1 ? '' : 's'));
  return { intercept, match, refusePhone, PHONE_NO, say, loadOpenCV, loadJsQR, loadScript, getStream, stopStream, camError, track, untrack, isActive, openPanel, capture, smallGray, videoToCanvas, canvasToBlob, blobToBase64, describeQr, makeQr, detectQuad, flatten, cropOnly, cleanCanvas, decodeCanvas };
})();
if (typeof module !== 'undefined') module.exports = Camera;
