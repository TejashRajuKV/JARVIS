'use strict';
/* ===========================================================================
 *  HUDOverlay — Holographic floating HUD overlay
 *  ---------------------------------------------------------------------------
 *  Purely additive: injects floating translucent panels over the JARVIS page.
 *  The existing UI is untouched — panels are positioned absolutely over it
 *  with `position: fixed; pointer-events: auto` on the panels themselves.
 *
 *  Activation:
 *    - A new "HUD" button is injected into the header next to SETTINGS.
 *    - Clicking toggles <body class="hud-on">, which shows/hides all panels
 *      via CSS (see hud-overlay.css).
 *    - The state is persisted to settings.hudOverlay (default false).
 *
 *  Panels:
 *    1. Top-left:    clock + date + tiny weather (weather is best-effort;
 *                    hidden if Online tools is off).
 *    2. Top-right:   CPU / RAM / Disk mini-bars (reads from existing refreshSystem()
 *                    state — never makes its own calls).
 *    3. Bottom-left: mini activity log (mirrors the existing #logStream, last 3).
 *    4. Bottom-right: quick command palette (chips that fire handleUser()).
 *
 *  Interaction:
 *    - Drag any panel by its grip strip; position is persisted per-panel.
 *    - ESC closes the overlay.
 *    - Click outside a panel does nothing (panels are non-modal).
 * =========================================================================== */
window.HUDOverlay = (function () {

  let active = false;
  let headerBtn = null;
  let escHint = null;
  let reticleEl = null;
  const panels = {};   // id → element
  const positions = {   // persisted positions per panel id
    hudClockTopLeft:   { x: 18,  y: 76  },
    hudStatsTopRight:  { x: 18,  y: 76  },   // right-anchored: x is offset from right edge
    hudLogBottomLeft:  { x: 18,  y: 70  },   // y is offset from bottom
    hudQuickBottomRt:  { x: 18,  y: 70  },
  };
  let logObserver = null;
  let clockTimer = null;
  let statsTimer = null;

  // ---- position persistence ----
  function loadPositions() {
    try {
      const saved = localStorage.getItem('jarvis.hudPositions');
      if (saved) Object.assign(positions, JSON.parse(saved));
    } catch {}
  }
  function savePositions() {
    try { localStorage.setItem('jarvis.hudPositions', JSON.stringify(positions)); } catch {}
  }

  // ---- create the HUD on/off button in the header ----
  function ensureHeaderButton() {
    if (headerBtn && document.body.contains(headerBtn)) return;
    const header = document.querySelector('header');
    if (!header) return;
    const settingsBtn = document.getElementById('settingsBtn');
    headerBtn = document.createElement('button');
    headerBtn.id = 'hudHudToggle';
    headerBtn.className = 'btn';
    headerBtn.type = 'button';
    headerBtn.title = 'Toggle the holographic HUD overlay';
    headerBtn.textContent = 'HUD';
    // Insert right before the SETTINGS button so it appears just to its left.
    if (settingsBtn && settingsBtn.parentNode === header) header.insertBefore(headerBtn, settingsBtn);
    else header.appendChild(headerBtn);
    headerBtn.addEventListener('click', toggle);
  }

  // ---- build all panels once (hidden until .hud-on) ----
  function buildPanels() {
    if (panels.clock) return; // already built

    // 1. Clock panel
    const clock = document.createElement('div');
    clock.id = 'hudClockTopLeft';
    clock.className = 'hud-panel';
    clock.innerHTML =
      '<span class="hud-grip" title="Drag"></span>' +
      '<div class="hud-title">CHRONO<span class="hud-aux" id="hudClockAux">LOCAL</span></div>' +
      '<div class="hud-time" id="hudClockTime">--:--:--</div>' +
      '<div class="hud-date" id="hudClockDate">— — —</div>' +
      '<div class="hud-weather" id="hudWeather" hidden>—</div>';
    document.body.appendChild(clock);

    // 2. Stats panel
    const stats = document.createElement('div');
    stats.id = 'hudStatsTopRight';
    stats.className = 'hud-panel';
    stats.innerHTML =
      '<span class="hud-grip" title="Drag"></span>' +
      '<div class="hud-title">SYSTEMS<span class="hud-aux" id="hudStatsAux">LIVE</span></div>' +
      '<div class="hud-stat-row"><label>CPU</label><div class="hud-stat-bar"><i id="hudCpuBar"></i></div><output id="hudCpuVal">—</output></div>' +
      '<div class="hud-stat-row"><label>MEM</label><div class="hud-stat-bar"><i id="hudRamBar"></i></div><output id="hudRamVal">—</output></div>' +
      '<div class="hud-stat-row"><label>DISK</label><div class="hud-stat-bar"><i id="hudDskBar"></i></div><output id="hudDskVal">—</output></div>' +
      '<div class="hud-stat-row"><label>UPTIME</label><div class="hud-stat-bar"><i id="hudUpBar" style="width:100%"></i></div><output id="hudUpVal">—</output></div>';
    document.body.appendChild(stats);

    // 3. Activity log panel
    const log = document.createElement('div');
    log.id = 'hudLogBottomLeft';
    log.className = 'hud-panel';
    log.innerHTML =
      '<span class="hud-grip" title="Drag"></span>' +
      '<div class="hud-title">ACTIVITY<span class="hud-aux" id="hudLogAux">LAST 3</span></div>' +
      '<div class="hud-log-list" id="hudLogList"></div>';
    document.body.appendChild(log);

    // 4. Quick commands panel
    const quick = document.createElement('div');
    quick.id = 'hudQuickBottomRt';
    quick.className = 'hud-panel';
    quick.innerHTML =
      '<span class="hud-grip" title="Drag"></span>' +
      '<div class="hud-title">QUICK<span class="hud-aux">CMD</span></div>' +
      '<div class="hud-chips" id="hudQuickChips"></div>';
    document.body.appendChild(quick);

    // Center reticle (decorative)
    reticleEl = document.createElement('div');
    reticleEl.className = 'hud-reticle';
    document.body.appendChild(reticleEl);

    // ESC hint
    escHint = document.createElement('div');
    escHint.id = 'hudEscHint';
    escHint.textContent = 'ESC TO CLOSE · DRAG PANELS BY THE GRIP';
    document.body.appendChild(escHint);

    // Register all panels
    panels.clock = clock; panels.stats = stats; panels.log = log; panels.quick = quick;

    // Apply saved positions
    applyPositions();
    // Wire dragging
    [clock, stats, log, quick].forEach(p => wireDrag(p));
    // Wire quick-command chips
    buildQuickChips();
  }

  // ---- positioning ----
  function applyPositions() {
    for (const [id, p] of Object.entries(panels)) {
      const pos = positions[id] || { x: 18, y: 70 };
      const isRight = id === 'hudStatsTopRight' || id === 'hudQuickBottomRt';
      const isBottom = id === 'hudLogBottomLeft' || id === 'hudQuickBottomRt';
      p.style.left = isRight ? 'auto' : pos.x + 'px';
      p.style.right = isRight ? pos.x + 'px' : 'auto';
      p.style.top = isBottom ? 'auto' : pos.y + 'px';
      p.style.bottom = isBottom ? pos.y + 'px' : 'auto';
    }
  }

  // ---- drag-by-grip ----
  function wireDrag(panel) {
    const grip = panel.querySelector('.hud-grip');
    if (!grip) return;
    let sx = 0, sy = 0, startLeft = 0, startTop = 0, dragging = false;
    const onMove = e => {
      if (!dragging) return;
      const dx = (e.touches ? e.touches[0].clientX : e.clientX) - sx;
      const dy = (e.touches ? e.touches[0].clientY : e.clientY) - sy;
      const nx = Math.max(4, startLeft + dx);
      const ny = Math.max(4, startTop + dy);
      // Convert to top/left for simplicity while dragging (overrides right/bottom anchoring)
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      // Persist new position (as left/top, even for right-anchored panels)
      const id = panel.id;
      positions[id] = positions[id] || {};
      const r = panel.getBoundingClientRect();
      const isRight = id === 'hudStatsTopRight' || id === 'hudQuickBottomRt';
      const isBottom = id === 'hudLogBottomLeft' || id === 'hudQuickBottomRt';
      positions[id] = {
        x: isRight ? Math.max(4, window.innerWidth - r.right) : r.left,
        y: isBottom ? Math.max(4, window.innerHeight - r.bottom) : r.top,
      };
      // Re-apply so right/bottom anchoring is restored
      applyPositions();
      savePositions();
    };
    const onDown = e => {
      dragging = true;
      sx = e.touches ? e.touches[0].clientX : e.clientX;
      sy = e.touches ? e.touches[0].clientY : e.clientY;
      const r = panel.getBoundingClientRect();
      startLeft = r.left; startTop = r.top;
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    grip.addEventListener('mousedown', onDown);
    grip.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  // ---- quick command chips ----
  const QUICK_CMDS = [
    { label: 'TIME',     cmd: 'what time is it' },
    { label: 'WEATHER',  cmd: 'weather' },
    { label: 'BATTERY',  cmd: 'battery' },
    { label: 'SCREEN',   cmd: 'screenshot' },
    { label: 'VOL ↓',    cmd: 'volume down' },
    { label: 'VOL ↑',    cmd: 'volume up' },
    { label: 'MUTE',     cmd: 'mute' },
    { label: 'FOCUS',    cmd: 'start a focus session' },
    { label: 'BRIEFING', cmd: 'give me my briefing' },
  ];
  function buildQuickChips() {
    const wrap = document.getElementById('hudQuickChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const c of QUICK_CMDS) {
      const btn = document.createElement('button');
      btn.className = 'hud-chip';
      btn.type = 'button';
      btn.textContent = c.label;
      btn.title = 'Say: ' + c.cmd;
      btn.addEventListener('click', () => {
        if (typeof handleUser === 'function') handleUser(c.cmd, 'hud');
        else if (typeof window.handleUser === 'function') window.handleUser(c.cmd, 'hud');
      });
      wrap.appendChild(btn);
    }
  }

  // ---- live data refreshers ----
  function tickClock() {
    const t = document.getElementById('hudClockTime');
    const d = document.getElementById('hudClockDate');
    if (!t || !d) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    t.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    d.textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }

  function tickStats() {
    // Read from the existing telemetry DOM (#cpuBar / #cpuVal etc.) so we never
    // make our own server calls. If those elements don't exist yet, hide rows.
    const map = [
      ['hudCpuBar', 'hudCpuVal', 'cpuBar', 'cpuVal'],
      ['hudRamBar', 'hudRamVal', 'ramBar', 'ramVal'],
      ['hudDskBar', 'hudDskVal', 'dskBar', 'dskVal'],
      ['hudUpBar',  'hudUpVal',  'upBar',  'upVal'],
    ];
    for (const [hudBar, hudVal, srcBar, srcVal] of map) {
      const hb = document.getElementById(hudBar);
      const hv = document.getElementById(hudVal);
      const sb = document.getElementById(srcBar);
      const sv = document.getElementById(srcVal);
      if (!hb || !hv) continue;
      if (sb && sb.style && sb.style.width) {
        hb.style.width = sb.style.width;
        // Apply warn/crit coloring if the source bar uses it
        const cls = sb.parentElement && sb.parentElement.classList;
        if (cls) {
          hb.parentElement.classList.toggle('warn', cls.contains('warn'));
          hb.parentElement.classList.toggle('crit', cls.contains('crit'));
        }
      }
      if (sv && sv.textContent) hv.textContent = sv.textContent;
    }
  }

  function tickLog() {
    const list = document.getElementById('hudLogList');
    if (!list) return;
    const srcStream = document.getElementById('logStream');
    if (!srcStream) { list.innerHTML = '<div class="hud-log-row"><span class="hud-ts">--:--</span><span class="hud-msg">activity stream unavailable</span></div>'; return; }
    const rows = Array.from(srcStream.querySelectorAll(':scope > *')).slice(-3).reverse();
    list.innerHTML = '';
    for (const r of rows) {
      const cls = r.className || '';
      const ts = r.querySelector('.ts') ? r.querySelector('.ts').textContent : '';
      const msg = r.querySelector('.msg') ? r.querySelector('.msg').textContent : r.textContent;
      const row = document.createElement('div');
      row.className = 'hud-log-row ' + cls;
      row.innerHTML = '<span class="hud-ts">' + esc(ts) + '</span><span class="hud-msg">' + esc(msg) + '</span>';
      list.appendChild(row);
    }
    if (!rows.length) list.innerHTML = '<div class="hud-log-row"><span class="hud-ts">--:--</span><span class="hud-msg">no activity yet</span></div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ---- activation ----
  function activate() {
    if (active) return;
    buildPanels();
    document.body.classList.add('hud-on');
    active = true;
    if (typeof settings !== 'undefined') { settings.hudOverlay = true; if (typeof saveSettings === 'function') saveSettings(); }
    if (typeof log === 'function') log('ok', 'HUD overlay activated');
    // Start refreshers
    tickClock(); tickStats(); tickLog();
    clockTimer = setInterval(tickClock, 1000);
    statsTimer = setInterval(tickStats, 1500);
    // Observe the activity log for changes
    const srcStream = document.getElementById('logStream');
    if (srcStream && window.MutationObserver) {
      logObserver = new MutationObserver(() => tickLog());
      logObserver.observe(srcStream, { childList: true });
    }
  }

  function deactivate() {
    if (!active) return;
    document.body.classList.remove('hud-on');
    active = false;
    if (typeof settings !== 'undefined') { settings.hudOverlay = false; if (typeof saveSettings === 'function') saveSettings(); }
    if (typeof log === 'function') log('info', 'HUD overlay deactivated');
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    if (logObserver) { logObserver.disconnect(); logObserver = null; }
  }

  function toggle() { active ? deactivate() : activate(); }

  // ---- ESC closes overlay ----
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && active && !e.target.matches('input, textarea, select')) {
      // Don't steal ESC from the chat input or other panels that handle it themselves.
      if (typeof pendingApproval === 'function' && pendingApproval) return;
      if (document.querySelector('[hidden=""]') === null && document.querySelector('.modal.open')) return;
      deactivate();
    }
  });

  // ---- init: load positions, wait for header, restore saved state ----
  loadPositions();
  function init() {
    ensureHeaderButton();
    bindSettingsToggle();
    if (typeof settings !== 'undefined' && settings.hudOverlay) activate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // The header might be re-rendered lazily; keep checking.
  document.addEventListener('click', () => {
    if (!document.getElementById('hudHudToggle')) ensureHeaderButton();
    bindSettingsToggle();
  }, { passive: true });

  // ---- settings-drawer toggle (kept in sync with the header HUD button) ----
  function bindSettingsToggle() {
    const btn = document.getElementById('hudOverlayToggle');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    const on = !!(typeof settings !== 'undefined' && settings.hudOverlay);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', String(on));
    btn.addEventListener('click', () => { active ? deactivate() : activate(); });
  }

  // Keep the settings toggle visually in sync when the header button is clicked.
  function syncSettingsToggle() {
    const btn = document.getElementById('hudOverlayToggle');
    if (btn) { btn.classList.toggle('on', active); btn.setAttribute('aria-checked', String(active)); }
  }
  // Wrap activate/deactivate so sync happens.
  const _activate = activate, _deactivate = deactivate;
  activate = function () { _activate(); syncSettingsToggle(); };
  deactivate = function () { _deactivate(); syncSettingsToggle(); };

  return {
    activate, deactivate, toggle,
    get active() { return active; },
    refreshStats: tickStats,
    refreshLog: tickLog,
    refreshClock: tickClock,
  };
})();
