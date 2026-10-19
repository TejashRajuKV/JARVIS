// Camera maths (scanmath.js): page corners, flattened size, picture fingerprints, motion and presence logic. No camera needed.
// Run: node tests/scanmath.test.js
const path = require('path');
const M = require(path.join(__dirname, '..', 'scanmath.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return !re || re.test(e.message); } };
const P = (x, y) => ({ x, y });

/* ---------- corners ---------- */
{
  const tl = P(100, 80), tr = P(900, 120), br = P(860, 700), bl = P(60, 640);
  const all = [[tl, tr, br, bl], [br, bl, tl, tr], [bl, tl, tr, br], [tr, br, bl, tl]];
  check('corners: any starting order gives tl, tr, br, bl', all.every(pts => { const c = M.orderCorners(pts); return c.tl === tl && c.tr === tr && c.br === br && c.bl === bl; }));
  const tilted = [P(300, 20), P(780, 300), P(500, 780), P(20, 500)];                           // a page turned about 45°
  const c = M.orderCorners(tilted);
  check('corners: a page turned 45° still gets four distinct corners in the right sense', new Set([c.tl, c.tr, c.br, c.bl]).size === 4 && c.tl.y < c.bl.y && c.tr.x > c.tl.x && c.br.y > c.tr.y, c);
  check('corners: refuses anything that is not four finite, distinct points', throws(() => M.orderCorners([tl, tr, br]), /exactly four/) && throws(() => M.orderCorners(null), /exactly four/) && throws(() => M.orderCorners([tl, tr, br, P(NaN, 1)]), /exactly four/) && throws(() => M.orderCorners([tl, tl, tr, br]), /overlap/) && throws(() => M.orderCorners([tl, tr, br, undefined]), /exactly four/));
  check('area and convexity', M.polygonArea([P(0, 0), P(10, 0), P(10, 5), P(0, 5)]) === 50 && M.isConvex([P(0, 0), P(10, 0), P(10, 5), P(0, 5)]) && !M.isConvex([P(0, 0), P(10, 0), P(2, 2), P(0, 10)]) && !M.isConvex([P(0, 0), P(5, 0), P(10, 0), P(0, 5)]));
  const W = 1000, H = 800;
  check('good page: a big, slightly skewed quad in a 1000×800 photo is accepted', M.isGoodQuad([tl, tr, br, bl], W, H));
  check('good page: too small (a coaster), too thin, a bow-tie and nearly-the-whole-frame-plus are all refused', !M.isGoodQuad([P(400, 300), P(500, 300), P(500, 380), P(400, 380)], W, H) && !M.isGoodQuad([P(0, 0), P(1000, 0), P(1000, 40), P(0, 40)], W, H) && !M.isGoodQuad([P(0, 0), P(1000, 800), P(1000, 0), P(0, 800)], W, H) && !M.isGoodQuad([P(-5, -5), P(1005, -5), P(1005, 805), P(-5, 805)], W, H));
  check('good page: a sharp sliver (angle under 40°) is refused; junk input is refused, not thrown', !M.isGoodQuad([P(0, 0), P(1000, 0), P(950, 60), P(0, 8)], W, H) && M.isGoodQuad([P(10, 10), P(990, 10), P(990, 790), P(10, 790)], W, H) && M.isGoodQuad([tl, tr, br], W, H) === false && M.isGoodQuad(null, W, H) === false);
  const ts = M.targetSize(M.orderCorners([tl, tr, br, bl]));
  check('flattened size: the longer of each pair of opposite sides', ts.w === Math.round(Math.max(M.dist(tl, tr), M.dist(bl, br))) && ts.h === Math.round(Math.max(M.dist(tl, bl), M.dist(tr, br))), ts);
  check('flattened size: capped to the maximum, shape kept; never tiny; accepts unordered points', (() => { const big = M.targetSize([P(0, 0), P(6000, 0), P(6000, 3000), P(0, 3000)], 2000); return big.w === 2000 && big.h === 1000; })() && M.targetSize([P(0, 0), P(3, 0), P(3, 2), P(0, 2)]).w === 100 && M.fitSize(4000, 3000, 1600).w === 1600 && M.fitSize(4000, 3000, 1600).h === 1200 && M.fitSize(800, 600, 1600).w === 800);
}

/* ---------- fingerprints ---------- */
{
  const ramp = Array.from({ length: 72 }, (_, i) => (i % 9) * 20);                 // brightness rises left → right: every comparison is "not brighter"
  const down = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20);           // falls left → right: every comparison is "brighter"
  check('dHash: a rising ramp is all zeros, a falling ramp all ones (16 hex digits)', M.dHash(ramp) === '0000000000000000' && M.dHash(down) === 'ffffffffffffffff');
  check('dHash: ignores overall brightness and contrast (the same picture, lighter or darker, has the same fingerprint)', (() => { const base = Array.from({ length: 72 }, (_, i) => (i * 37) % 200); const lighter = base.map(v => v + 40), dimmer = base.map(v => Math.round(v * 0.6)); return M.dHash(base) === M.dHash(lighter) && M.dHash(base) === M.dHash(dimmer); })());
  check('dHash: refuses a wrong-sized picture', throws(() => M.dHash([1, 2, 3]), /9×8/) && throws(() => M.dHash(null), /9×8/));
  check('hamming: bit distance between fingerprints', M.hamming('0000000000000000', 'ffffffffffffffff') === 64 && M.hamming('0000000000000000', '0000000000000001') === 1 && M.hamming('abcdef0123456789', 'abcdef0123456789') === 0 && M.hamming('00000000000000f0', '0000000000000000') === 4);
  check('hamming: refuses mismatched or non-hex input', throws(() => M.hamming('00', '000'), /hex/) && throws(() => M.hamming('zz', '00'), /hex/) && throws(() => M.hamming(1, 2), /hex/));
  const items = [{ id: 'a', hash: '0000000000000000' }, { id: 'b', hash: '0000000000000003' }, { id: 'c', hash: '0000000000000007' }, { id: 'far', hash: 'ffffffffffffffff' }, { id: 'lonely', hash: 'f0f0f0f0f0f0f0f0' }, { id: 'far2', hash: 'fffffffffffffff0' }];
  const g = M.groupSimilar(items, 6);
  check('similar groups: close fingerprints are linked (a–b–c, far–far2); singletons are dropped', g.length === 2 && g.some(x => x.map(i => i.id).sort().join() === 'a,b,c') && g.some(x => x.map(i => i.id).sort().join() === 'far,far2'), g.map(x => x.map(i => i.id)));
  check('similar groups: a tighter limit splits the chain; none → empty', M.groupSimilar(items, 1).length === 1 && M.groupSimilar([items[0], items[3]], 6).length === 0 && M.groupSimilar([], 6).length === 0);
}

/* ---------- motion ---------- */
{
  const still = () => new Uint8Array(1000).fill(100);
  const moved = (n = 60) => { const f = still(); for (let i = 0; i < n; i++) f[i] = 220; return f; };            // n of 1000 pixels changed a lot
  check('frame diff: identical frames are zero; moved pixels are counted; different sizes are safe', M.frameDiff(still(), still()).changed === 0 && M.frameDiff(still(), moved(100)).changed === 0.1 && M.frameDiff(still(), new Uint8Array(5)).mean === 0 && M.frameDiff(null, still()).changed === 0);
  const blob = k => { const f = still(); for (let i = 0; i < 40; i++) f[(k * 50 + i) % 1000] = 220; return f; };     // a different 4% patch each time = something moving
  const d = M.MotionDetector({ warmupMs: 10000, needFrames: 3, cooldownMs: 300000 });
  let t = 0, k = 0, last = still(); const step = f => { last = f; return d.feed(f, (t += 1000)); };
  const mv = () => step(blob(k++)), hold = () => step(last);
  check('motion: nothing during the 10 s warm-up, even with big changes', (() => { for (let i = 0; i < 9; i++) { const r = i % 2 ? mv() : step(still()); if (r.alert || !r.warming) return false; } return true; })());
  hold(); hold();
  const quiet = [hold(), hold(), hold()];
  check('motion: a still room never alerts', quiet.every(r => !r.alert && !r.motion));
  const r1 = mv(), r2 = hold(), r3 = mv();
  check('motion: movement that stops and starts does not alert (needs several frames in a row)', !r1.alert && !r3.alert && r1.motion === true && r2.motion === false);
  hold();
  const run = [mv(), mv(), mv()];
  check('motion: three moving frames in a row → exactly one alert, on the third', run.map(r => r.alert).join() === 'false,false,true', run);
  const more = [mv(), mv(), mv(), mv()];
  check('motion: more movement inside the cooldown does not alert again', more.every(r => !r.alert));
  t += 301000; hold();
  const after = [mv(), mv(), mv()];
  check('motion: after the cooldown it can alert again', after[2].alert === true, after);
  const g2 = M.MotionDetector({ warmupMs: 0, needFrames: 2 });
  g2.feed(still(), 1); const lights = new Uint8Array(1000).fill(230);
  check('motion: a light switched on (the whole picture changes) is not movement', (() => { const r = g2.feed(lights, 2); return !r.alert && !r.motion && r.globalChange === true; })());
  const g3 = M.MotionDetector({ warmupMs: 0, needFrames: 2, cooldownMs: 0 });
  g3.feed(still(), 1); g3.feed(moved(60), 2);
  g3.reset();
  check('motion: reset forgets the past (the first frame after it only sets the baseline)', g3.feed(moved(60), 3).warming === true);
}

/* ---------- presence ---------- */
{
  const p = M.PresenceTracker({ absentMs: 60000 });
  check('presence: someone there → present, never locks', p.feed(true, 0).state === 'present' && !p.feed(true, 5000).shouldLock);
  check('presence: gone for 59 s → not yet', p.feed(false, 10000).state === 'away' && !p.feed(false, 40000).shouldLock && !p.feed(false, 69000).shouldLock);
  const r = p.feed(false, 70000);
  check('presence: gone for 60 s → lock, once', r.shouldLock === true && r.absentFor === 60000 && !p.feed(false, 90000).shouldLock && !p.feed(false, 200000).shouldLock);
  check('presence: seeing you again re-arms it', p.feed(true, 210000).state === 'present' && !p.feed(false, 215000).shouldLock && p.feed(false, 275000).shouldLock === true);
  const q = M.PresenceTracker({ absentMs: 30000 });
  q.feed(false, 0); q.feed(false, 20000);
  check('presence: "could not tell" resets the clock, so a camera problem can never lock you out', q.feed(null, 25000).state === 'unknown' && !q.feed(false, 26000).shouldLock && !q.feed(false, 55000).shouldLock && q.feed(false, 56000).shouldLock === true);
  check('presence: a detector that never answers never locks', (() => { const z = M.PresenceTracker({ absentMs: 1000 }); for (let i = 0; i < 20; i++) if (z.feed(null, i * 5000).shouldLock) return false; return true; })());
  check('presence: reset clears everything', (() => { const z = M.PresenceTracker({ absentMs: 1000 }); z.feed(false, 0); z.feed(false, 1500); z.reset(); return !z.feed(false, 2000).shouldLock; })());
}

/* ---------- clean-up of a flattened page ---------- */
{
  const W = 160, H = 100;
  // paper that gets darker from left (255) to right (150), a shadow; dark ink strokes (2 px wide) every 24 px, plus a red one
  const img = new Uint8ClampedArray(W * H * 4);
  const ink = x => x % 24 < 2 && x > 10, red = x => x >= 100 && x < 103;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const paper = 255 - (105 * x) / W, i = (y * W + x) * 4;
    let r = paper, g = paper, b = paper;
    if (y > 20 && y < 80 && red(x)) { r = paper * 0.85; g = paper * 0.15; b = paper * 0.15; }
    else if (y > 20 && y < 80 && ink(x)) { r = g = b = paper * 0.2; }
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
  }
  const copy = Uint8ClampedArray.from(img);
  const at = (o, x, y) => o[(y * W + x) * 4];
  const doc = M.enhance(img, W, H, 'document');
  check('enhance: the input picture is not changed', img.every((v, i) => v === copy[i]));
  check('enhance: same size, fully opaque', doc.length === img.length && doc.every((v, i) => i % 4 !== 3 || v === 255));
  check('enhance document: paper is white everywhere, even in the shadow on the right', [5, 60, 120, 155].every(x => at(doc, x, 5) === 255 && at(doc, x, 95) === 255), [at(doc, 5, 5), at(doc, 155, 5)]);
  check('enhance document: ink is black, also in the shadow', at(doc, 48, 50) === 0 && at(doc, 145, 50) === 0 && at(doc, 35, 50) === 255 && at(doc, 130, 50) === 255, [at(doc, 48, 50), at(doc, 145, 50), at(doc, 35, 50), at(doc, 130, 50)]);
  check('enhance document: only black and white', [...doc].every((v, i) => i % 4 === 3 || v === 0 || v === 255));
  const grey = M.enhance(img, W, H, 'grey');
  check('enhance grey: paper near white, ink dark, colourless', at(grey, 155, 5) >= 245 && at(grey, 48, 50) < 40 && grey[(50 * W + 100) * 4] === grey[(50 * W + 100) * 4 + 1]);
  const wb = M.enhance(img, W, H, 'whiteboard');
  const px = (o, x, y) => [o[(y * W + x) * 4], o[(y * W + x) * 4 + 1], o[(y * W + x) * 4 + 2]];
  check('enhance whiteboard: the board turns white and a red marker stays red', px(wb, 155, 5).every(v => v >= 250) && px(wb, 101, 50)[0] > 150 && px(wb, 101, 50)[1] < 60 && px(wb, 101, 50)[2] < 60, [px(wb, 155, 5), px(wb, 101, 50)]);
  const col = M.enhance(img, W, H, 'colour');
  check('enhance colour: lighter than the original shadow, red still red', px(col, 155, 5).every(v => v >= 240) && px(col, 101, 50)[0] > px(col, 101, 50)[1] + 80);
  check('enhance: refuses a wrong size or an unknown mode', throws(() => M.enhance(new Uint8ClampedArray(10), 4, 4), /size/) && throws(() => M.enhance(img, W, H, 'sepia'), /mode/) && throws(() => M.enhance(null, 1, 1), /size/));
  check('enhance: a plain white page stays white and a plain black page does not crash', M.enhance(new Uint8ClampedArray(40 * 40 * 4).fill(255), 40, 40)[0] === 255 && M.enhance(new Uint8ClampedArray(40 * 40 * 4), 40, 40).length === 6400);
  const big = new Uint8ClampedArray(1200 * 900 * 4).fill(200); const t0 = Date.now(); M.enhance(big, 1200, 900, 'document');
  check('enhance: a 1200 × 900 page takes under 1.5 seconds', Date.now() - t0 < 1500, Date.now() - t0);
}

/* ---------- what a QR code says ---------- */
{
  const q = M.parseQr;
  const w = q('WIFI:T:WPA;S:Hostel 3F;P:pa\\;ss\\:word;H:false;;');
  check('qr wifi: name, security and password, with escaped ; and : handled', w.kind === 'wifi' && w.ssid === 'Hostel 3F' && w.security === 'WPA' && w.password === 'pa;ss:word' && w.hasPassword === true && w.hidden === false, w);
  check('qr wifi: an open network and a hidden one', q('WIFI:T:nopass;S:Cafe;;').hasPassword === false && q('WIFI:T:WPA;S:x;P:y;H:true;;').hidden === true && q('WIFI:S:Plain;;').security === 'NOPASS');
  const l = q('https://college.edu/timetable?id=7');
  check('qr link: an ordinary https link is openable, with no warnings', l.kind === 'link' && l.openable === true && l.host === 'college.edu' && l.warn.length === 0, l);
  check('qr link: www. without a scheme becomes an http link', q('www.example.com/a').url === 'http://www.example.com/a' && q('www.example.com/a').openable === true);
  check('qr link: other schemes (javascript, file, intent, ftp) are shown but never openable', ['javascript:alert(1)', 'file:///C:/Windows/system32', 'intent://scan/#Intent;scheme=zxing;end', 'ftp://files.example.com/x'].every(s => q(s).openable !== true), ['javascript:alert(1)', 'ftp://files.example.com/x'].map(s => q(s)));
  check('qr link: shortened links, an @ trick, a number address and look-alike letters each carry a warning', q('https://bit.ly/3xyz').warn.length === 1 && q('http://google.com@evil.example/login').warn.some(x => /@/.test(x)) && q('http://192.168.1.5/admin').warn.some(x => /number/.test(x)) && q('https://xn--pple-43d.com/').warn.some(x => /look-alike/.test(x)) && q('https://аpple.com/').warn.some(x => /look-alike/.test(x)));
  check('qr link: the real host is shown (not the part before the @)', q('http://google.com@evil.example/login').host === 'evil.example');
  check('qr other kinds: email, phone, sms, location, payment, plain text, empty', q('mailto:a@b.co?subject=hi').address === 'a@b.co' && q('tel:+919876543210').number === '+919876543210' && q('SMSTO:12345:hello there').body === 'hello there' && q('geo:12.97,77.59').coords === '12.97,77.59' && q('upi://pay?pa=x@y&am=5').kind === 'payment' && q('just some words').kind === 'text' && q('   ').kind === 'empty' && q(null).kind === 'empty');
  const vc = q('BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nTEL;TYPE=CELL:+91 98765 43210\nEMAIL:asha@example.com\nEND:VCARD');
  check('qr contact: name, phone and email', vc.kind === 'contact' && vc.name === 'Asha Rao' && vc.phones[0] === '+91 98765 43210' && vc.emails[0] === 'asha@example.com', vc);
}

console.log(`scanmath: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
