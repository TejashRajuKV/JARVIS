'use strict';
/* ===========================================================================
 *  learn.js — Pattern learning & anomaly detection
 *  ---------------------------------------------------------------------------
 *  Tracks user behavior over time and surfaces proactive suggestions, e.g.
 *  "You opened VS Code 4 mornings in a row — run it automatically?"
 *
 *  What it tracks (all stored in jarvis.patterns, shared across tabs via /api/state):
 *    1. App-open frequency per hour-of-day (24 × N apps)
 *    2. Command frequency per hour-of-day (24 × N commands)
 *    3. Battery drain rate baseline (avg %/h per hour-of-day)
 *    4. RAM baseline per hour-of-day (for anomaly detection)
 *
 *  What it does NOT track:
 *    - File contents, chat text, or anything personally identifiable
 *    - Specific window titles (only the app name)
 *    - Anything cross-device (patterns are per-machine, in jarvis.patterns)
 *
 *  Privacy:
 *    - All data stays in the local store (jarvis.patterns key)
 *    - Never sent to any server (the /api/state sync is localhost-only)
 *    - User can wipe via "forget everything you've learned" (clears the key)
 *
 *  Public API:
 *    - Learn.event(kind, label)        — record an event (kind: 'app' | 'cmd' | 'focus')
 *    - Learn.sample(metric, value)     — record a numeric sample (metric: 'battery' | 'ram' | 'cpu')
 *    - Learn.suggest()                  — returns the strongest pattern detected, or null
 *    - Learn.anomaly(metric, value, hour) — returns {anomaly: bool, expected: number, z: number} or null
 *    - Learn.snapshot()                 — returns the full patterns object (for debugging / Settings UI)
 *    - Learn.forgetAll()                — clears all learned patterns
 *
 *  The suggest() function is called by the page every 5 minutes (idle timer).
 *  If it returns a pattern and the user hasn't seen it in 24h, it surfaces a
 *  toast + chat message offering to act on it.
 * =========================================================================== */
window.Learn = (function () {

  const STORE_KEY = 'jarvis.patterns';
  const MIN_SAMPLES_FOR_SUGGESTION = 3;     // need 3+ same-hour events before suggesting
  const SUGGESTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 24h between repeats of same suggestion
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---- patterns schema ----
  // patterns = {
  //   apps:  { 'chrome': { 0: 0, 1: 0, ..., 23: 0, _lastSuggest: 0 }, ... },   // hour-of-day → count
  //   cmds:  { 'openApplication': { 0: 0, ... }, ... },
  //   focus: { 'subject': { 0: 0, ... }, ... },
  //   samples: {
  //     battery: { 0: { sum: 0, count: 0, drainRate: 0 }, ... },   // hourly baseline
  //     ram:     { 0: { sum: 0, count: 0 }, ... },
  //     cpu:     { 0: { sum: 0, count: 0 }, ... },
  //   },
  //   lastEvent: 0,   // timestamp of most recent event (for "stale" detection)
  // }
  function loadPatterns() {
    try {
      const v = (typeof store !== 'undefined') ? store.get(STORE_KEY, null) : null;
      if (v && typeof v === 'object') return normalize(v);
    } catch {}
    return normalize({});
  }
  function normalize(p) {
    p = p || {};
    return {
      apps: p.apps || {},
      cmds: p.cmds || {},
      focus: p.focus || {},
      samples: p.samples || { battery: {}, ram: {}, cpu: {} },
      lastEvent: p.lastEvent || 0,
      suggested: p.suggested || {},  // key → last-shown timestamp (for cooldown)
    };
  }
  function savePatterns(p) {
    try { if (typeof store !== 'undefined') store.set(STORE_KEY, p); } catch (e) {}
  }

  let patterns = loadPatterns();

  // ---- event recording ----
  function bucket(label) {
    // Returns the hour-of-day bucket object for a given label.
    // Used for app/cmd/focus events. Creates the bucket if missing.
    const h = new Date().getHours();
    if (!patterns.apps[label]) patterns.apps[label] = {};
    if (typeof patterns.apps[label][h] !== 'number') patterns.apps[label][h] = 0;
    return patterns.apps[label];
  }
  function event(kind, label) {
    if (!kind || !label) return;
    label = String(label).toLowerCase().slice(0, 40);
    const h = new Date().getHours();
    const store = kind === 'app' ? patterns.apps : kind === 'cmd' ? patterns.cmds : kind === 'focus' ? patterns.focus : null;
    if (!store) return;
    if (!store[label]) store[label] = {};
    if (typeof store[label][h] !== 'number') store[label][h] = 0;
    store[label][h]++;
    patterns.lastEvent = Date.now();
    savePatterns(patterns);
  }

  // ---- numeric sample recording (for baselines) ----
  function sample(metric, value) {
    if (!metric || typeof value !== 'number' || !isFinite(value)) return;
    const h = new Date().getHours();
    if (!patterns.samples[metric]) patterns.samples[metric] = {};
    if (!patterns.samples[metric][h]) patterns.samples[metric][h] = { sum: 0, count: 0 };
    const b = patterns.samples[metric][h];
    b.sum += value; b.count++;
    // Cap each hour's bucket at 1000 samples to avoid unbounded growth.
    if (b.count > 1000) { b.sum = b.sum * 0.5 + value * 500; b.count = 500; }
    savePatterns(patterns);
  }

  function mean(bucket) { return bucket && bucket.count > 0 ? bucket.sum / bucket.count : null; }

  // ---- anomaly detection ----
  // Returns { anomaly: bool, expected: number, z: number } or null if no baseline.
  // Uses a simple z-score: |value - mean| / stddev. stddev is approximated from
  // the spread of means across all hours (a rough but cheap proxy).
  function anomaly(metric, value, hour) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    if (hour == null) hour = new Date().getHours();
    const buckets = patterns.samples[metric] || {};
    const b = buckets[hour];
    if (!b || b.count < 5) return null;  // need at least 5 samples for a baseline
    const m = mean(b);
    if (m == null) return null;
    // Approximate stddev from the spread of hourly means.
    const allMeans = Object.values(buckets).map(mean).filter(x => x != null);
    if (allMeans.length < 2) return null;
    const avg = allMeans.reduce((a, b) => a + b, 0) / allMeans.length;
    const variance = allMeans.reduce((s, v) => s + (v - avg) ** 2, 0) / allMeans.length;
    const sd = Math.sqrt(variance) || 1;
    const z = Math.abs(value - m) / sd;
    return { anomaly: z > 2.5, expected: +m.toFixed(1), z: +z.toFixed(2) };
  }

  // ---- suggestion engine ----
  // Returns the strongest pattern detected, or null.
  // Strategy: walk apps/cmds/focus, find any (label, hour) pair where the count
  // >= MIN_SAMPLES_FOR_SUGGESTION AND it's the current hour AND we haven't
  // suggested it in the last 24h.
  function suggest() {
    const h = new Date().getHours();
    const now = Date.now();
    const candidates = [];
    for (const kind of ['apps', 'cmds', 'focus']) {
      const store = patterns[kind] || {};
      for (const [label, hours] of Object.entries(store)) {
        const count = hours[h] || 0;
        if (count < MIN_SAMPLES_FOR_SUGGESTION) continue;
        const key = kind + ':' + label + ':' + h;
        const last = patterns.suggested[key] || 0;
        if (now - last < SUGGESTION_COOLDOWN_MS) continue;
        // Score: count × recency-weighted
        const score = count;
        candidates.push({ kind, label, hour: h, count, score, key });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // ---- mark a suggestion as shown (so it doesn't fire again for 24h) ----
  function markSuggested(key) {
    patterns.suggested[key] = Date.now();
    // Prune old suggestions (older than 7 days)
    const cutoff = Date.now() - 7 * DAY_MS;
    for (const [k, t] of Object.entries(patterns.suggested)) {
      if (t < cutoff) delete patterns.suggested[k];
    }
    savePatterns(patterns);
  }

  // ---- "run automatically?" handler ----
  // When the user accepts a suggestion, JARVIS creates a routine for it.
  // (The actual routine creation is handled by the existing Routines module —
  //  Learn just records the acceptance.)
  function acceptSuggestion(suggestion) {
    if (!suggestion) return;
    markSuggested(suggestion.key);
  }
  function dismissSuggestion(suggestion) {
    if (!suggestion) return;
    markSuggested(suggestion.key);  // same cooldown — dismissed suggestions don't reappear
  }

  // ---- snapshot for debugging / Settings UI ----
  function snapshot() {
    return JSON.parse(JSON.stringify(patterns));
  }

  function forgetAll() {
    patterns = normalize({});
    savePatterns(patterns);
  }

  // ---- public API ----
  return {
    event, sample, suggest, anomaly, snapshot, forgetAll, acceptSuggestion, dismissSuggestion,
    get patterns() { return patterns; },
    MIN_SAMPLES_FOR_SUGGESTION,
  };
})();
