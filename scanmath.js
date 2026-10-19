'use strict';
/* Pure maths for the camera and image tools, shared by the page and by the tests (no DOM, no OpenCV here):
   finding the corners of a page, sizing the flattened result, a 64-bit picture fingerprint (difference hash) and
   how far apart two are, a motion detector for "watch my room", and a presence tracker for "lock when I leave".
   The camera code only feeds these numbers; every decision about "is that a page / is that movement / did they leave"
   is made here, so it can be tested without a camera. */
const ScanMath = (() => {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- page corners ---------- */
  // Four unordered points → { tl, tr, br, bl }. Throws on anything that is not four distinct points.
  function orderCorners(pts) {
    if (!Array.isArray(pts) || pts.length !== 4 || pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('I need exactly four corner points.');
    const bySum = pts.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const byDiff = pts.slice().sort((a, b) => (a.y - a.x) - (b.y - b.x));
    const out = { tl: bySum[0], br: bySum[3], tr: byDiff[0], bl: byDiff[3] };
    const set = new Set([out.tl, out.tr, out.br, out.bl]);
    if (set.size !== 4) throw new Error('Those corners overlap, so they cannot be a page.');
    return out;
  }
  const polygonArea = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; };
  function isConvex(pts) {
    let sign = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9) return false;
      const s = cross > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  }
  const angleAt = (a, b, c) => { const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y }; const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y); return d ? Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d))) * 180 / Math.PI : 0; };
  // Is this quadrilateral plausibly a sheet of paper in a photo of imgW × imgH? (large enough, convex, sensible angles and sides)
  function isGoodQuad(pts, imgW, imgH, { minFrac = 0.2, maxFrac = 0.995, minAngle = 40, maxSideRatio = 4 } = {}) {
    let c; try { c = orderCorners(pts); } catch { return false; }
    const poly = [c.tl, c.tr, c.br, c.bl];
    const frac = polygonArea(poly) / (imgW * imgH);
    if (!(frac >= minFrac && frac <= maxFrac) || !isConvex(poly)) return false;
    for (let i = 0; i < 4; i++) if (angleAt(poly[(i + 3) % 4], poly[i], poly[(i + 1) % 4]) < minAngle) return false;
    const top = dist(c.tl, c.tr), bottom = dist(c.bl, c.br), left = dist(c.tl, c.bl), right = dist(c.tr, c.br);
    if (Math.min(top, bottom, left, right) < 10) return false;
    return Math.max(top, bottom) / Math.min(top, bottom) <= maxSideRatio && Math.max(left, right) / Math.min(left, right) <= maxSideRatio;
  }
  // Size of the flattened page: the longer of each pair of opposite sides, scaled so the longest side is at most maxSide.
  function targetSize(corners, maxSide = 2000) {
    const c = corners.tl ? corners : orderCorners(corners);
    let w = Math.max(dist(c.tl, c.tr), dist(c.bl, c.br)), h = Math.max(dist(c.tl, c.bl), dist(c.tr, c.br));
    const k = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(100, Math.round(w * k)); h = Math.max(100, Math.round(h * k));
    return { w, h };
  }
  // The largest size ≤ maxSide on the long edge, keeping the shape (for downscaling photos before they are sent anywhere).
  function fitSize(w, h, maxSide) { const k = Math.min(1, maxSide / Math.max(w, h)); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; }

  /* ---------- picture fingerprint ---------- */
  // 9 × 8 grey values (72 numbers, row by row) → 64 bits as 16 hex digits: bit = "this pixel is brighter than the one to its right".
  function dHash(gray) {
    if (!gray || gray.length !== 72) throw new Error('dHash needs a 9×8 grey picture (72 values).');
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }
  const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  function hamming(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/.test(a + b)) throw new Error('Fingerprints must be hex strings of the same length.');
    let d = 0;
    for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
    return d;
  }
  // Groups of fingerprints that are within `maxDist` bits of each other (single linkage; `items` = [{id, hash}]). Singletons are left out.
  function groupSimilar(items, maxDist = 6) {
    const parent = items.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hamming(items[i].hash, items[j].hash) <= maxDist) parent[find(i)] = find(j);
    const groups = new Map();
    items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
    return [...groups.values()].filter(g => g.length > 1);
  }

  /* ---------- motion ---------- */
  // Two grey frames of the same size → { mean (0..1), changed (share of pixels that moved a lot, 0..1) }.
  function frameDiff(prev, cur, pixelThreshold = 25) {
    if (!prev || !cur || prev.length !== cur.length || !cur.length) return { mean: 0, changed: 0 };
    let sum = 0, big = 0;
    for (let i = 0; i < cur.length; i++) { const d = Math.abs(cur[i] - prev[i]); sum += d; if (d > pixelThreshold) big++; }
    return { mean: sum / cur.length / 255, changed: big / cur.length };
  }
  // Feeds small grey frames; says when something has really moved. Ignores the first seconds (camera auto-exposure),
  // whole-picture jumps (a light switched on), and needs several moving frames in a row. One alert per cooldown.
  function MotionDetector({ warmupMs = 10000, minChanged = 0.012, maxChanged = 0.85, needFrames = 3, cooldownMs = 300000 } = {}) {
    let prev = null, start = null, streak = 0, lastAlert = -Infinity;
    return {
      feed(gray, t) {
        if (start === null) start = t;
        const d = frameDiff(prev, gray);
        const had = prev !== null;
        prev = gray;
        if (!had) return { motion: false, alert: false, ...d, warming: true };
        if (t - start < warmupMs) return { motion: false, alert: false, ...d, warming: true };
        if (d.changed > maxChanged) { streak = 0; return { motion: false, alert: false, ...d, globalChange: true }; }     // lighting changed, not movement
        const motion = d.changed >= minChanged;
        streak = motion ? streak + 1 : 0;
        let alert = false;
        if (streak >= needFrames && t - lastAlert >= cooldownMs) { alert = true; lastAlert = t; streak = 0; }
        return { motion, alert, ...d };
      },
      reset() { prev = null; start = null; streak = 0; },
    };
  }

  /* ---------- presence ---------- */
  // feed(true | false | null, t). null = "could not tell" (camera blocked, detector error, tab asleep) and it RESETS the
  // timer, so a problem can never be mistaken for "you left". Says shouldLock once when absent for absentMs; after that
  // it stays quiet until someone is seen again.
  function PresenceTracker({ absentMs = 60000 } = {}) {
    let since = null, fired = false;
    return {
      feed(present, t) {
        if (present !== false) { since = null; if (present === true) fired = false; return { state: present === true ? 'present' : 'unknown', absentFor: 0, shouldLock: false }; }
        if (since === null) since = t;
        const absentFor = t - since;
        const shouldLock = absentFor >= absentMs && !fired;
        if (shouldLock) fired = true;
        return { state: 'away', absentFor, shouldLock };
      },
      reset() { since = null; fired = false; },
    };
  }

  /* ---------- clean-up of a flattened page ---------- */
  // rgba: Uint8ClampedArray of an ImageData (w × h). Returns a NEW Uint8ClampedArray of the same size.
  // The paper's lighting is estimated (the brightest thing in each small block, smoothed), and every pixel is divided by it:
  // shadows and uneven light disappear, ink and marker stay. Then the mode decides how much contrast to apply.
  //   'document' black and white · 'grey' soft greyscale · 'whiteboard' keeps marker colours on a white board · 'colour' gentle
  function backgroundMap(luma, w, h) {
    const b = Math.max(8, Math.round(Math.max(w, h) / 40));
    const gw = Math.ceil(w / b), gh = Math.ceil(h / b);
    let grid = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let max = 0;
      for (let y = gy * b; y < Math.min(h, gy * b + b); y++) for (let x = gx * b; x < Math.min(w, gx * b + b); x++) { const v = luma[y * w + x]; if (v > max) max = v; }
      grid[gy * gw + gx] = max;
    }
    for (let pass = 0; pass < 2; pass++) {                               // smooth the grid (3 × 3 average), twice
      const next = new Float32Array(grid.length);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, y = gy + dy; if (x >= 0 && y >= 0 && x < gw && y < gh) { s += grid[y * gw + x]; n++; } }
        next[gy * gw + gx] = s / n;
      }
      grid = next;
    }
    const bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {                                        // bilinear back up to full size
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / b - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / b - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx, bot = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
        bg[y * w + x] = Math.max(40, top * (1 - ty) + bot * ty);         // never divide by (nearly) black
      }
    }
    return bg;
  }
  const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);
  const ENHANCE_MODES = ['document', 'grey', 'whiteboard', 'colour'];
  function enhance(rgba, w, h, mode = 'document') {
    if (!rgba || rgba.length !== w * h * 4) throw new Error('The picture data does not match its size.');
    if (!ENHANCE_MODES.includes(mode)) throw new Error('Unknown clean-up mode.');
    const out = new Uint8ClampedArray(rgba.length);
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) luma[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    const bg = backgroundMap(luma, w, h);
    for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
      const k = 255 / bg[p];
      if (mode === 'document' || mode === 'grey') {
        const n = clamp255(luma[p] * k);                                 // 255 = paper, lower = ink
        const v = mode === 'document' ? (n < 170 ? 0 : 255) : clamp255((n - 60) * (255 / 175));
        out[i] = out[i + 1] = out[i + 2] = v;
      } else {
        const lo = mode === 'whiteboard' ? 70 : 30, hi = mode === 'whiteboard' ? 225 : 245, g = 255 / (hi - lo);
        out[i] = clamp255((rgba[i] * k - lo) * g); out[i + 1] = clamp255((rgba[i + 1] * k - lo) * g); out[i + 2] = clamp255((rgba[i + 2] * k - lo) * g);
      }
      out[i + 3] = 255;
    }
    return out;
  }

  /* ---------- what a QR code says ---------- */
  // Wi-Fi codes look like WIFI:T:WPA;S:MyNet;P:secret;H:false;;  — ; , : \ " are escaped with a backslash.
  function parseWifi(s) {
    const body = s.slice(5), fields = {};
    let key = '', val = '', inVal = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '\\' && i + 1 < body.length) { (inVal ? (val += body[i + 1]) : (key += body[i + 1])); i++; continue; }
      if (!inVal && c === ':') { inVal = true; continue; }
      if (inVal && c === ';') { fields[key] = val; key = ''; val = ''; inVal = false; continue; }
      if (!inVal && c === ';') { key = ''; continue; }
      (inVal ? (val += c) : (key += c));
    }
    if (key && inVal) fields[key] = val;
    return { ssid: fields.S || '', security: (fields.T || 'nopass').toUpperCase(), hasPassword: !!fields.P, password: fields.P || '', hidden: /^true$/i.test(fields.H || '') };
  }
  const unesc = s => String(s || '').replace(/\\([,;:\\nN])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c));
  function parseVcard(s) {
    const get = re => { const m = s.match(re); return m ? unesc(m[1]).trim() : ''; };
    const all = re => [...s.matchAll(re)].map(m => unesc(m[1]).trim()).filter(Boolean);
    return { name: get(/^FN[^:\r\n]*:(.+)$/im) || get(/^N[^:\r\n]*:(.+)$/im).replace(/;+/g, ' ').trim(), phones: all(/^TEL[^:\r\n]*:(.+)$/gim), emails: all(/^EMAIL[^:\r\n]*:(.+)$/gim), org: get(/^ORG[^:\r\n]*:(.+)$/im) };
  }
  // → { kind, ... }. Links are described, never opened: `openable` is true only for plain http(s) links, and `warn` says why a link looks odd.
  function parseQr(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { kind: 'empty', text: '' };
    if (/^WIFI:/i.test(text)) return { kind: 'wifi', text, ...parseWifi(text) };
    if (/^BEGIN:VCARD/i.test(text)) return { kind: 'contact', text, ...parseVcard(text) };
    if (/^mailto:/i.test(text)) return { kind: 'email', text, address: decodeURIComponent(text.slice(7).split('?')[0]) };
    if (/^tel:/i.test(text)) return { kind: 'phone', text, number: text.slice(4) };
    if (/^smsto?:/i.test(text)) { const m = text.match(/^smsto?:([^:]*)(?::([\s\S]*))?$/i); return { kind: 'sms', text, number: m ? m[1] : '', body: m && m[2] || '' }; }
    if (/^geo:/i.test(text)) return { kind: 'location', text, coords: text.slice(4).split('?')[0] };
    if (/^upi:\/\//i.test(text)) return { kind: 'payment', text };      // a payment request: shown, never acted on
    const m = text.match(/^([a-z][a-z0-9+.-]*):\/\/([^\s/?#]*)/i) || (/^www\./i.test(text) ? [text, 'http', text.split(/[/?#]/)[0]] : null);
    if (m) {
      const scheme = m[1].toLowerCase(), authority = m[2];
      const host = authority.replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
      const warn = [];
      if (/@/.test(authority)) warn.push('the address contains an “@”, which can hide the real site');
      if (/^xn--|\.xn--/.test(host) || /[^\x00-\x7f]/.test(host)) warn.push('the site name uses look-alike letters');
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) warn.push('it points at a number, not a website name');
      if (/^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|rb\.gy|cutt\.ly|shorturl\.at)$/.test(host)) warn.push('it is a shortened link, so the real site is hidden');
      const url = scheme === 'http' || scheme === 'https' || /^www\./i.test(text);
      return { kind: 'link', text, url: /^www\./i.test(text) ? 'http://' + text : text, scheme: /^www\./i.test(text) ? 'http' : scheme, host, openable: url, warn };
    }
    return { kind: 'text', text };
  }

  return { dist, orderCorners, polygonArea, isConvex, isGoodQuad, targetSize, fitSize, dHash, hamming, groupSimilar, frameDiff, MotionDetector, PresenceTracker, enhance, ENHANCE_MODES, parseQr, parseWifi };
})();
if (typeof module !== 'undefined') module.exports = ScanMath;
