'use strict';
/* ===========================================================================
 *  thresholds.js — Centralised alert thresholds for JARVIS
 *  ---------------------------------------------------------------------------
 *  BEFORE: Battery-low was hardcoded as `20` in three places (script.js:2019,
 *    2132, 2820). RAM alert was `92` (script.js:2015) but the diagnostics warn
 *    used `90` (script.js:2136) — inconsistent. CPU alert didn't exist at all.
 *    Deadline window was `3 * 36e5` in two places. Evening hour was `21`.
 *
 *  AFTER: every threshold lives here as a property of `Thresholds`, with a
 *    fallback default AND a way to read user overrides from `settings`. The
 *    page reads `Thresholds.batteryLow()` etc; the value is either the user's
 *    override (from settings, configurable in the Settings drawer) or the
 *    safe default. The server can also import this module — no more literals.
 *
 *  This file is loaded BEFORE script.js (see index.html) so the global
 *  `Thresholds` object is available everywhere. Settings overrides are
 *  applied lazily on each call so a user changing "low battery at 30%" in
 *  Settings takes effect immediately without a reload.
 * =========================================================================== */
window.Thresholds = (function () {

  // ---- defaults (the values JARVIS shipped with before this refactor) ----
  // These match the hardcoded literals that were scattered across script.js,
  // so behaviour is identical to upstream when the user hasn't overridden.
  const DEFAULTS = Object.freeze({
    batteryLow:      20,    // %  — smart-alert fires below this when not charging
    batteryCritical: 10,   // %  — escalation tier (NEW — not yet wired in alerts, just exposed)
    ramHigh:         92,   // %  — smart-alert fires at or above this
    ramWarn:         90,   // %  — diagnostics warn threshold (was inconsistent at 90 vs 92)
    cpuHigh:         90,   // %  — diagnostics warn threshold (no proactive alert exists yet)
    cpuSustained:    95,   // %  — proactive CPU alert (NEW — not yet wired, exposed for future)
    cpuSustainedSec: 60,   // s  — how long CPU must stay above cpuSustained before alerting (NEW)
    diskLowGB:       2,    // GB — diagnostics warn threshold (no proactive alert exists yet)
    deadlineWindowH: 3,    // hours before a deadline that the alert fires
    eveningHour:     21,   // 24h — when the "pending todos" nudge fires
    reAlertMinutes:  30,   // min — same alert won't fire again within this window
    chargerDebounceS: 60,  // s  — charger plug/unplug announcement debounce
    batteryPollS:    120,  // s  — how often smartAlerts fetches battery
    barHotPct:       75,   // %  — telemetry bar turns amber
    barCritPct:      90,   // %  — telemetry bar turns red
    pollMs:          3000, // ms — telemetry refresh interval
  });

  // ---- override reader ----
  // Reads from `settings.thresholds` if present (so the user's overrides
  // survive a reload — they're persisted in the same `jarvis.settings` blob
  // as everything else). Falls back to DEFAULTS for any missing key.
  function overrides() {
    try {
      if (typeof settings !== 'undefined' && settings && settings.thresholds && typeof settings.thresholds === 'object') {
        return settings.thresholds;
      }
    } catch (e) {}
    return {};
  }

  // ---- public API: each accessor returns a clamped, sane number ----
  function num(key, min, max) {
    const o = overrides();
    let v = (o && o[key] != null) ? o[key] : DEFAULTS[key];
    v = Number(v);
    if (!isFinite(v)) v = DEFAULTS[key];
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  }

  return {
    DEFAULTS,
    // Smart alerts
    get batteryLow()        { return num('batteryLow', 5, 50); },         // 5–50% — sensible range
    get batteryCritical()   { return num('batteryCritical', 1, 30); },    // must be < batteryLow
    get ramHigh()           { return num('ramHigh', 50, 99); },
    get cpuSustained()      { return num('cpuSustained', 50, 99); },
    get cpuSustainedSec()   { return num('cpuSustainedSec', 10, 600); },
    get deadlineWindowH()   { return num('deadlineWindowH', 1, 72); },
    get eveningHour()       { return num('eveningHour', 0, 23); },
    get reAlertMinutes()    { return num('reAlertMinutes', 5, 1440); },
    get batteryPollS()      { return num('batteryPollS', 30, 3600); },
    // Diagnostics
    get ramWarn()           { return num('ramWarn', 50, 99); },
    get cpuHigh()           { return num('cpuHigh', 50, 99); },
    get diskLowGB()         { return num('diskLowGB', 0.1, 100); },
    // Charger
    get chargerDebounceS()  { return num('chargerDebounceS', 10, 600); },
    // Telemetry UI
    get barHotPct()         { return num('barHotPct', 50, 99); },
    get barCritPct()        { return num('barCritPct', 50, 100); },
    get pollMs()            { return num('pollMs', 500, 60000); },

    // Convenience helpers
    isBatteryLow(level, status) { return level != null && level <= this.batteryLow && status !== 'Charging'; },
    isBatteryCritical(level, status) { return level != null && level <= this.batteryCritical && status !== 'Charging'; },
    isRamHigh(pct) { return pct >= this.ramHigh; },
    isRamWarn(pct) { return pct >= this.ramWarn; },
    isCpuHigh(pct) { return pct >= this.cpuHigh; },
    isDiskLow(gb) { return gb != null && gb < this.diskLowGB; },

    // Mirror the existing bar() color logic so renderTele() can use the same source
    barClass(pct) {
      const hot = this.barHotPct, crit = this.barCritPct;
      if (pct >= crit) return 'crit';
      if (pct >= hot) return 'hot';
      return '';
    },

    // Snapshot for the Settings drawer to render current values
    snapshot() {
      const o = overrides();
      const out = {};
      for (const k of Object.keys(DEFAULTS)) out[k] = (o && o[k] != null) ? o[k] : DEFAULTS[k];
      return out;
    },

    // Apply a partial update (called from the Settings drawer)
    set(partial) {
      try {
        if (typeof settings === 'undefined') return;
        settings.thresholds = Object.assign({}, settings.thresholds || {}, partial);
        if (typeof saveSettings === 'function') saveSettings();
      } catch (e) {}
    },
  };
})();
