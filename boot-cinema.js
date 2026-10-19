'use strict';
/* ===========================================================================
 *  BootCinema — Cinematic Arc Reactor boot animation
 *  ---------------------------------------------------------------------------
 *  Purely additive: layers a Canvas 2D arc-reactor animation on top of the
 *  existing #bootOverlay. The original boot sequence (7 lines, progress bar,
 *  skip button, sfx.boot(), greeting voice) is untouched — this module only
 *  paints a glowing reactor behind it.
 *
 *  Design goals:
 *    - No external dependencies (no Three.js CDN — works fully offline).
 *    - Honors the active HUD theme by reading --cyan / --cyan-hi / --rgb
 *      CSS variables at runtime, so it matches whatever theme is selected.
 *    - Stops automatically when #bootOverlay is removed (MutationObserver).
 *    - Respects prefers-reduced-motion (renders a single static frame).
 *    - Default ON; user can disable in Settings → Behaviour → Boot cinema.
 * =========================================================================== */
window.BootCinema = (function () {

  let canvas = null, ctx = null, raf = 0;
  let started = false, stopped = false;
  let startT = 0;
  let captionEl = null;
  let lastThemeRGB = '63,217,255';

  // ---- theme color sampling (reads the active --rgb at runtime) ----
  function sampleTheme() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const rgb = cs.getPropertyValue('--rgb').trim();
      if (rgb) lastThemeRGB = rgb;
    } catch {}
    return lastThemeRGB;
  }
  function color(alpha) {
    const a = Math.max(0, Math.min(1, alpha == null ? 1 : alpha));
    return 'rgba(' + lastThemeRGB + ',' + a + ')';
  }

  // ---- resize handling ----
  function fit() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(2, Math.floor(w * dpr));
    canvas.height = Math.max(2, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- particle ring around the reactor ----
  const PARTICLES = 64;
  const particles = [];
  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < PARTICLES; i++) {
      particles.push({
        a: (i / PARTICLES) * Math.PI * 2,
        r: 0.6 + Math.random() * 0.35,      // ring-radius multiplier
        spd: 0.0006 + Math.random() * 0.0012,
        size: 1 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // ---- the reactor frame ----
  function frame(now) {
    if (stopped) return;
    const t = (now - startT) / 1000;          // seconds since start
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const cx = w / 2, cy = h / 2;
    // Power-up curve: reactor grows from 0.3 → 1.0 over the first ~1.5s, then breathes.
    const ramp = Math.min(1, t / 1.5);
    const breath = 0.96 + 0.04 * Math.sin(t * 1.6);
    const scale = ramp * breath;
    const baseR = Math.min(w, h) * 0.22;

    ctx.clearRect(0, 0, w, h);

    // 1. Outer rotating ring (dashed)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.18);
    ctx.scale(scale, scale);
    drawDashedRing(baseR * 1.55, 24, 0.45, 0.85);
    ctx.restore();

    // 2. Mid ring with thick arc segments (the "iron man" look)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.32);
    ctx.scale(scale, scale);
    drawArcSegments(baseR * 1.25, 6, 0.18, 0.9, 6);
    ctx.restore();

    // 3. Inner counter-rotating ring (thin)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.6);
    ctx.scale(scale, scale);
    drawDashedRing(baseR * 1.0, 60, 0.35, 0.6);
    ctx.restore();

    // 4. Triangular coil housing (the iconic reactor silhouette)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.08);
    ctx.scale(scale, scale);
    drawCoils(baseR * 0.78, 8);
    ctx.restore();

    // 5. Glowing core (radial gradient)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    drawCore(baseR);
    ctx.restore();

    // 6. Particle halo orbiting the whole thing
    ctx.save();
    ctx.translate(cx, cy);
    drawParticles(baseR * 1.85, t, scale);
    ctx.restore();

    // Show caption "JARVIS ONLINE" once the reactor is fully powered up.
    if (captionEl && t > 1.6 && !captionEl.classList.contains('show')) {
      captionEl.classList.add('show');
    }

    raf = requestAnimationFrame(frame);
  }

  function drawDashedRing(r, dashes, alpha, width) {
    ctx.strokeStyle = color(alpha);
    ctx.lineWidth = width;
    ctx.setLineDash([2 * Math.PI * r / dashes / 2, 2 * Math.PI * r / dashes / 2]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawArcSegments(r, count, frac, alpha, width) {
    ctx.strokeStyle = color(alpha);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    const step = (Math.PI * 2) / count;
    const arcLen = step * frac;
    for (let i = 0; i < count; i++) {
      const a0 = i * step;
      ctx.beginPath();
      ctx.arc(0, 0, r, a0, a0 + arcLen);
      ctx.stroke();
    }
  }

  function drawCoils(r, count) {
    ctx.strokeStyle = color(0.55);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const step = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      const a = i * step;
      const x1 = Math.cos(a) * r * 0.7, y1 = Math.sin(a) * r * 0.7;
      const x2 = Math.cos(a) * r, y2 = Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // tiny node at the outer end
      ctx.fillStyle = color(0.85);
      ctx.beginPath();
      ctx.arc(x2, y2, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCore(r) {
    // outer glow
    const g0 = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.2);
    g0.addColorStop(0, color(0.55));
    g0.addColorStop(0.5, color(0.18));
    g0.addColorStop(1, color(0));
    ctx.fillStyle = g0;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
    ctx.fill();
    // core
    const g1 = ctx.createRadialGradient(0, -r * 0.15, 0, 0, 0, r * 0.6);
    g1.addColorStop(0, '#ffffff');
    g1.addColorStop(0.4, color(0.95));
    g1.addColorStop(1, color(0.4));
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    // crisp inner ring
    ctx.strokeStyle = color(0.9);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawParticles(r, t, scale) {
    for (const p of particles) {
      const ang = p.a + t * p.spd * 1000;
      const wobble = 0.04 * Math.sin(t * 2 + p.phase);
      const pr = r * (p.r + wobble) * scale;
      const x = Math.cos(ang) * pr;
      const y = Math.sin(ang) * pr;
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + p.phase);
      ctx.fillStyle = color(0.6 * tw);
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- public start / stop ----
  function start() {
    if (started || stopped) return;
    // Respect the user setting (default ON, but disabled hides the reactor entirely).
    if (typeof settings !== 'undefined' && settings.bootCinema === false) return;
    // ?skipboot or click-to-skip should also skip the cinema.
    if (/[?&]skipboot\b/.test(location.search)) return;

    const overlay = document.getElementById('bootOverlay');
    if (!overlay) return;

    canvas = document.createElement('canvas');
    canvas.id = 'arcReactorCanvas';
    overlay.insertBefore(canvas, overlay.firstChild);

    captionEl = document.createElement('div');
    captionEl.id = 'arcCaption';
    captionEl.innerHTML = 'JARVIS<small>SYSTEM ONLINE</small>';
    overlay.insertBefore(captionEl, canvas.nextSibling);
    overlay.classList.add('hasReactor');

    ctx = canvas.getContext('2d');
    sampleTheme();
    fit();
    initParticles();
    started = true;
    startT = performance.now();
    raf = requestAnimationFrame(frame);

    // Re-sample the theme in case it changes during boot (very unlikely, but safe).
    setTimeout(sampleTheme, 200);

    // Stop when the overlay is removed (boot finished) or hidden.
    const obs = new MutationObserver(() => {
      if (!document.body.contains(overlay) || overlay.classList.contains('done')) stop();
    });
    obs.observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });

    // Stop after a hard 12s in case the boot sequence hangs (rare).
    setTimeout(() => stop(), 12000);

    // Resize handling
    window.addEventListener('resize', fit);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (captionEl && captionEl.parentNode) captionEl.parentNode.removeChild(captionEl);
    const overlay = document.getElementById('bootOverlay');
    if (overlay) overlay.classList.remove('hasReactor');
    window.removeEventListener('resize', fit);
  }

  // ---- auto-start when the DOM is ready ----
  function whenReady() {
    // The boot overlay already exists in the static HTML, so it's available
    // as soon as DOMContentLoaded fires. We defer slightly so the existing
    // script.js boot sequence can claim its slot first.
    setTimeout(start, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();

  // ---- settings toggle wiring ----
  function bindToggle() {
    const btn = document.getElementById('bootCinemaToggle');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    const on = (typeof settings !== 'undefined') ? (settings.bootCinema !== false) : true;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', String(on));
    btn.addEventListener('click', () => {
      const turnOn = !btn.classList.contains('on');
      btn.classList.toggle('on', turnOn);
      btn.setAttribute('aria-checked', String(turnOn));
      try { settings.bootCinema = turnOn; if (typeof saveSettings === 'function') saveSettings(); } catch (e) {}
      if (typeof log === 'function') log('info', 'Boot cinema ' + (turnOn ? 'enabled' : 'disabled') + ' — takes effect next boot');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else bindToggle();
  document.addEventListener('click', bindToggle, { passive: true });

  return { start, stop, bindToggle, get active() { return started && !stopped; } };
})();
