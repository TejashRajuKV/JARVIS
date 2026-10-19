'use strict';
/* ===========================================================================
 *  dashboard.js — Animated diagnostics dashboard overlay
 *  ---------------------------------------------------------------------------
 *  Purely additive: injects a fullscreen overlay showing live telemetry with
 *  sparklines (custom Canvas 2D — no Chart.js dependency, matches the existing
 *  "no CDN" discipline).
 *
 *  Activation:
 *    - A "DIAG" button is injected into the header next to SETTINGS.
 *    - Clicking toggles <body class="dash-on">, which shows the overlay.
 *    - ESC closes the overlay.
 *    - The overlay polls /api/sys/dashboard every 2s for enriched telemetry
 *      (CPU temp, GPU, network throughput, top processes, battery cycle count).
 *
 *  Sparklines:
 *    - Each metric keeps a rolling history buffer (last 60 samples = 2 minutes).
 *    - Rendered as a smooth line on a transparent canvas.
 *    - Color follows the Thresholds barClass() (cyan → amber → red).
 *
 *  No existing function is overwritten. The dashboard is purely observational —
 *  it doesn't fire tools or change settings.
 * =========================================================================== */
window.Dashboard = (function () {

  let active = false;
  let headerBtn = null;
  let pollTimer = null;
  let overlayEl = null;
  let canvases = {};        // id → { canvas, ctx, history: [], max }
  let procSortBy = 'cpu';   // 'cpu' | 'mem'

  // ---- history buffers (rolling, last 60 samples = 2 min at 2s poll) ----
  const HISTORY_LEN = 60;
  const history = {
    cpu: [], ram: [], disk: [], cpuTemp: [], netRx: [], netTx: [],
  };
  function pushHistory(arr, v) { arr.push(v); while (arr.length > HISTORY_LEN) arr.shift(); }

  // ---- header button ----
  function ensureHeaderButton() {
    if (headerBtn && document.body.contains(headerBtn)) return;
    const header = document.querySelector('header');
    if (!header) return;
    const settingsBtn = document.getElementById('settingsBtn');
    headerBtn = document.createElement('button');
    headerBtn.id = 'dashBtn';
    headerBtn.className = 'btn';
    headerBtn.type = 'button';
    headerBtn.title = 'Open the animated diagnostics dashboard';
    headerBtn.textContent = 'DIAG';
    headerBtn.style.cssText = 'font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:5px 12px;background:rgba(9,26,40,.55);transition:.2s';
    if (settingsBtn && settingsBtn.parentNode === header) header.insertBefore(headerBtn, settingsBtn);
    else header.appendChild(headerBtn);
    headerBtn.addEventListener('click', toggle);
  }

  // ---- build the overlay once (hidden until .dash-on) ----
  function buildOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'dashOverlay';
    overlayEl.innerHTML = `
      <div id="dashHeader">
        <h2>DIAGNOSTICS</h2>
        <div class="dash-meta">
          <span>UPTIME <b id="dashUp">—</b></span>
          <span>BATTERY <b id="dashBat">—</b></span>
          <span class="gpu" id="dashGpu">GPU —</span>
          <span>POLL <b id="dashPoll">—</b></span>
        </div>
        <button id="dashClose" type="button">✕ CLOSE · ESC</button>
      </div>
      <div id="dashGrid">
        <div class="dash-panel" id="dashCpuPanel">
          <div class="dash-title">PROCESSOR<span class="aux" id="dashCpuModel">—</span></div>
          <div class="dash-big"><span class="num" id="dashCpuNum">—</span><span class="unit">% LOAD</span></div>
          <canvas class="dash-spark" id="sparkCpu"></canvas>
          <div class="dash-cores" id="dashCores"></div>
          <div style="margin-top:8px;font-size:10px;color:var(--faint);letter-spacing:.1em">TEMP <b id="dashCpuTemp" style="color:var(--cyan-hi)">—</b> °C</div>
        </div>
        <div class="dash-panel">
          <div class="dash-title">MEMORY &amp; STORAGE</div>
          <div class="dash-dual">
            <div class="col">
              <div class="dash-big"><span class="num" id="dashRamNum">—</span><span class="unit">%</span></div>
              <div style="font-size:10px;color:var(--dim)" id="dashRamDetail">— / — GB</div>
              <canvas class="dash-spark" id="sparkRam"></canvas>
            </div>
            <div class="col">
              <div class="dash-big"><span class="num" id="dashDiskNum">—</span><span class="unit">%</span></div>
              <div style="font-size:10px;color:var(--dim)" id="dashDiskDetail">— GB free</div>
              <canvas class="dash-spark" id="sparkDisk"></canvas>
            </div>
          </div>
        </div>
        <div class="dash-panel">
          <div class="dash-title">NETWORK<span class="aux" id="dashNetIfaces">—</span></div>
          <div class="dash-net-rows" id="dashNetRows"><div class="dash-loading">awaiting data…</div></div>
        </div>
        <div class="dash-panel">
          <div class="dash-title">TOP PROCESSES</div>
          <div class="dash-proc-tabs">
            <button class="dash-proc-tab active" data-sort="cpu" type="button">BY CPU</button>
            <button class="dash-proc-tab" data-sort="mem" type="button">BY RAM</button>
          </div>
          <div class="dash-proc-list" id="dashProcList"><div class="dash-loading">awaiting data…</div></div>
        </div>
      </div>
      <div class="dash-footer">
        <span>OS <b id="dashOs">—</b></span>
        <span>BOOT <b id="dashBootTime">—</b></span>
        <span style="margin-left:auto;font-size:10px;color:var(--faint);letter-spacing:.15em">2s POLL · 60-SAMPLE HISTORY</span>
      </div>
    `;
    document.body.appendChild(overlayEl);
    document.getElementById('dashClose').addEventListener('click', deactivate);
    overlayEl.querySelectorAll('.dash-proc-tab').forEach(t => {
      t.addEventListener('click', () => {
        procSortBy = t.dataset.sort;
        overlayEl.querySelectorAll('.dash-proc-tab').forEach(x => x.classList.toggle('active', x === t));
        renderProcs();
      });
    });
  }

  // ---- canvas setup with DPR scaling ----
  function setupCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return null;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = c.clientWidth || 200, h = c.clientHeight || 60;
      c.width = Math.max(2, Math.floor(w * dpr));
      c.height = Math.max(2, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    return { canvas: c, ctx, resize, w: () => c.clientWidth, h: () => c.clientHeight };
  }

  function ensureCanvas(id) {
    if (canvases[id]) return canvases[id];
    const obj = setupCanvas(id);
    if (obj) canvases[id] = obj;
    return obj;
  }

  // ---- sparkline renderer ----
  function drawSpark(id, data, color, max) {
    const obj = ensureCanvas(id);
    if (!obj) return;
    const { ctx, w, h } = obj;
    const W = w(), H = h();
    ctx.clearRect(0, 0, W, H);
    if (data.length < 2) return;
    const maxV = max || Math.max(...data, 1);
    const step = W / (HISTORY_LEN - 1);
    // Glow underlay
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = H - (data[i] / maxV) * H * 0.9;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Fill area under the line
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color.replace(')', ',0.25)').replace('rgb', 'rgba'));
    grad.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));
    ctx.fillStyle = grad;
    ctx.fill();
    // Current value dot at the right edge
    const lastY = H - (data[data.length - 1] / maxV) * H * 0.9;
    ctx.beginPath();
    ctx.arc((data.length - 1) * step, lastY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---- data fetch + render cycle ----
  async function tick() {
    if (!active) return;
    const t0 = performance.now();
    let d, sysOk;
    try {
      d = await getJSON('/sys/dashboard');
    } catch { d = null; }
    // Also pull the basic systemInfo for CPU/RAM/Disk (cheaper endpoint, already polled).
    sysOk = await refreshSystem();
    if (!d || !d.pro) {
      // Fallback: render basic telemetry from the existing sys object only.
      renderBasic();
      $('#dashPoll').textContent = '—';
      return;
    }

    // CPU
    if (sysOk) {
      pushHistory(history.cpu, sys.cpu);
      const cls = Thresholds.barClass(sys.cpu);
      const numEl = $('#dashCpuNum');
      numEl.textContent = sys.cpu + '%';
      numEl.className = 'num ' + cls;
      drawSpark('sparkCpu', history.cpu, colorFor(cls), 100);
      $('#dashCpuModel').textContent = sys.cpuModel.slice(0, 40);
      renderCores(d.cpuTempCores);
    }
    if (d.cpuTemp != null) {
      $('#dashCpuTemp').textContent = Math.round(d.cpuTemp);
      pushHistory(history.cpuTemp, d.cpuTemp);
      // Overlay temp on the CPU sparkline? Keep separate for clarity.
    } else {
      $('#dashCpuTemp').textContent = '—';
    }

    // RAM + Disk
    if (sysOk) {
      pushHistory(history.ram, sys.ram);
      pushHistory(history.disk, sys.diskUsed);
      const ramCls = Thresholds.barClass(sys.ram);
      const diskCls = Thresholds.barClass(sys.diskUsed);
      $('#dashRamNum').textContent = sys.ram + '%';
      $('#dashRamNum').className = 'num ' + ramCls;
      $('#dashRamDetail').textContent = sys.ramUsed + ' / ' + sys.ramTotal + ' GB';
      $('#dashDiskNum').textContent = sys.diskUsed + '%';
      $('#dashDiskNum').className = 'num ' + diskCls;
      $('#dashDiskDetail').textContent = sys.diskFree + ' GB free';
      drawSpark('sparkRam', history.ram, colorFor(ramCls), 100);
      drawSpark('sparkDisk', history.disk, colorFor(diskCls), 100);
    }

    // Network
    renderNet(d.networks);

    // Processes
    if (d.procs) { lastProcs = d.procs; renderProcs(); }

    // Battery + GPU + uptime footer
    if (d.battery) $('#dashBat').textContent = Math.round(d.battery.percent) + '% ' + (d.battery.isCharging ? '⚡' : '');
    else $('#dashBat').textContent = '—';
    if (d.gpus && d.gpus.length) $('#dashGpu').textContent = 'GPU ' + d.gpus.map(g => g.model.split(' ').slice(0, 3).join(' ')).join(', ').slice(0, 40);
    else $('#dashGpu').textContent = 'GPU —';
    $('#dashUp').textContent = sys.uptime ? (Math.floor(sys.uptime / 60) + 'h ' + (sys.uptime % 60) + 'm') : '—';
    $('#dashOs').textContent = sys.osName || '—';
    $('#dashPoll').textContent = Math.round(performance.now() - t0) + 'ms';
    $('#dashBootTime').textContent = new Date(Date.now() - sys.uptime * 60000).toLocaleString();
  }

  let lastProcs = { cpu: [], mem: [] };

  function renderProcs() {
    const list = lastProcs[procSortBy] || [];
    const el = $('#dashProcList');
    if (!list.length) { el.innerHTML = '<div class="dash-loading">no process data (Linux/Mac may need permissions)</div>'; return; }
    el.innerHTML = list.map(p => `<div class="dash-proc-row"><span class="name" title="${esc(p.name)} pid ${p.pid}">${esc(p.name)}</span><span class="cpu">${p.cpu.toFixed(1)}%</span><span class="mem">${p.mem.toFixed(1)}%</span></div>`).join('');
  }

  function renderNet(nets) {
    const el = $('#dashNetRows');
    if (!nets || !nets.length) { el.innerHTML = '<div class="dash-loading">no active interfaces</div>'; return; }
    // Track history per interface (simplified: aggregate rx_sec + tx_sec across all ifaces).
    const totalRx = nets.reduce((s, n) => s + (n.rx_sec || 0), 0);
    const totalTx = nets.reduce((s, n) => s + (n.tx_sec || 0), 0);
    pushHistory(history.netRx, totalRx);
    pushHistory(history.netTx, totalTx);
    el.innerHTML = nets.map(n => {
      const rxKb = ((n.rx_sec || 0) / 1024).toFixed(1);
      const txKb = ((n.tx_sec || 0) / 1024).toFixed(1);
      return `<div class="dash-net-row"><span class="iface">${esc(n.iface)}</span><canvas class="spark" data-iface="${esc(n.iface)}"></canvas><span class="vals"><b>↓${rxKb}K</b> <i>↑${txKb}K</i></span></div>`;
    }).join('');
    // Render the sparkline for each row (using the aggregate history for simplicity)
    nets.forEach(n => {
      const c = el.querySelector(`canvas[data-iface="${n.iface}"]`);
      if (c) {
        const id = 'net_' + n.iface.replace(/[^a-z0-9]/gi, '');
        c.id = id;
        // Use a simple inline draw
        const ctx = c.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = (c.clientWidth || 100) * dpr; c.height = (c.clientHeight || 28) * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const W = c.clientWidth || 100, H = c.clientHeight || 28;
        ctx.clearRect(0, 0, W, H);
        // Combined rx+tx sparkline
        const data = history.netRx.slice(-30);
        if (data.length > 1) {
          const maxV = Math.max(...data, ...history.netTx.slice(-30), 1);
          ctx.beginPath();
          for (let i = 0; i < data.length; i++) {
            const x = (i / (data.length - 1)) * W;
            const y = H - (data[i] / maxV) * H * 0.9;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = 'rgb(84, 255, 168)'; ctx.lineWidth = 1; ctx.stroke();
          // tx line
          const txData = history.netTx.slice(-30);
          ctx.beginPath();
          for (let i = 0; i < txData.length; i++) {
            const x = (i / (txData.length - 1)) * W;
            const y = H - (txData[i] / maxV) * H * 0.9;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = 'rgb(255, 184, 77)'; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    });
    $('#dashNetIfaces').textContent = nets.length + ' IFACE' + (nets.length === 1 ? '' : 'S');
  }

  function renderCores(cores) {
    const el = $('#dashCores');
    if (!cores || !cores.length) { el.innerHTML = ''; return; }
    el.innerHTML = cores.slice(0, 16).map(t => {
      const pct = Math.min(100, Math.max(0, t || 0));
      const cls = pct >= 90 ? 'crit' : pct >= 75 ? 'hot' : '';
      return `<i class="${cls}" style="height:${pct}%"></i>`;
    }).join('');
  }

  function renderBasic() {
    // Fallback when /sys/dashboard is unavailable: still render CPU/RAM/Disk from sys.
    pushHistory(history.cpu, sys.cpu);
    pushHistory(history.ram, sys.ram);
    pushHistory(history.disk, sys.diskUsed);
    const cpuCls = Thresholds.barClass(sys.cpu);
    const ramCls = Thresholds.barClass(sys.ram);
    const diskCls = Thresholds.barClass(sys.diskUsed);
    $('#dashCpuNum').textContent = sys.cpu + '%'; $('#dashCpuNum').className = 'num ' + cpuCls;
    $('#dashRamNum').textContent = sys.ram + '%'; $('#dashRamNum').className = 'num ' + ramCls;
    $('#dashDiskNum').textContent = sys.diskUsed + '%'; $('#dashDiskNum').className = 'num ' + diskCls;
    drawSpark('sparkCpu', history.cpu, colorFor(cpuCls), 100);
    drawSpark('sparkRam', history.ram, colorFor(ramCls), 100);
    drawSpark('sparkDisk', history.disk, colorFor(diskCls), 100);
  }

  function colorFor(cls) {
    return cls === 'crit' ? 'rgb(255, 95, 107)' : cls === 'hot' ? 'rgb(255, 184, 77)' : 'rgb(63, 217, 255)';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  // Local $ for brevity (matches script.js convention)
  const $ = s => document.querySelector(s);

  // ---- activation ----
  function activate() {
    if (active) return;
    buildOverlay();
    document.body.classList.add('dash-on');
    active = true;
    if (typeof log === 'function') log('ok', 'Diagnostics dashboard open');
    // Immediate first tick, then poll every 2s.
    tick();
    pollTimer = setInterval(tick, 2000);
    // Resize handling — re-fit canvases on window resize.
    window.addEventListener('resize', onResize);
  }
  function deactivate() {
    if (!active) return;
    document.body.classList.remove('dash-on');
    active = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    window.removeEventListener('resize', onResize);
    if (typeof log === 'function') log('info', 'Diagnostics dashboard closed');
  }
  function toggle() { active ? deactivate() : activate(); }
  function onResize() { canvases = {}; } // force re-setup on next tick

  // ---- ESC closes ----
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && active && !e.target.matches('input, textarea, select')) {
      // Don't steal ESC from chat input or approvals.
      if (typeof pendingApproval === 'function' && pendingApproval) return;
      deactivate();
    }
  });

  // ---- init ----
  function init() { ensureHeaderButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('click', () => { if (!document.getElementById('dashBtn')) ensureHeaderButton(); }, { passive: true });

  return {
    activate, deactivate, toggle,
    get active() { return active; },
    refresh: tick,
  };
})();
