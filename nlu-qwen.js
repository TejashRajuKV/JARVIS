'use strict';
/* ===========================================================================
 *  NLUQ — Natural-Language Command Parser (Qwen + rules)
 *  ---------------------------------------------------------------------------
 *  Additive module: supplements — never replaces — the existing rule engine.
 *
 *  When the rule engine returns CONVERSATION or confidence < 0.85, the page can
 *  ask the local Qwen model (via Ollama) to extract a structured intent. Qwen is
 *  constrained to a strict JSON schema and a known intent whitelist, so it can
 *  never invent a tool the rest of JARVIS doesn't know about.
 *
 *  Activation:
 *    - NLUQ.enabled (boolean) — read from settings.jarvis.qwenNlu, default false.
 *    - The pipeline in script.js calls NLUQ.parse() only when enabled AND the
 *      rule result was low-confidence. The call is fully awaited but if Qwen
 *      fails or returns garbage, the rule result is returned unchanged.
 *
 *  No existing function is overwritten. The only intrusion is one tiny guarded
 *  block added to script.js's handleUser() — see NEW-FEATURES.md.
 * =========================================================================== */
window.NLUQ = (function () {

  // ---- state ----
  let enabled = false;
  let lastResult = null;       // for the inspector ("how did you understand that?")
  let lastLatencyMs = 0;
  let callCount = 0;
  let failCount = 0;

  // Read initial enabled flag from the shared settings object (script.js).
  // settings is global; we read it lazily so this file can be loaded before
  // settings exists.
  function refreshEnabled() {
    try { enabled = !!(window.settings && settings.qwenNlu); }
    catch { enabled = false; }
    return enabled;
  }

  // ---- Qwen → JARVIS intent mapping ----
  // Qwen returns a whitelisted intent; we map it onto the existing NLU's
  // intent + tool + args schema so the rest of the pipeline is untouched.
  const TOOL_BY_INTENT = {
    OPEN_APPLICATION: { tool: 'openApplication',  args: a => ({ app: a.app || a.name || '' }) },
    CLOSE_APPLICATION: { tool: 'closeApplication', args: a => ({ app: a.app || a.name || '' }) },
    OPEN_WEB:        { tool: 'openWeb',           args: a => ({ query: a.query || a.target || '' }) },
    WEB_SEARCH:      { tool: 'webSearch',         args: a => ({ query: a.query || a.target || '' }) },
    SITE_SEARCH:     { tool: 'openWeb',           args: a => ({ query: a.query || a.target || '' }) },
    BRIGHTNESS:      { tool: 'brightness',        args: a => ({ level: clampLvl(a.level || a.value) }) },
    VOLUME:          { tool: 'volume',            args: a => ({ level: clampLvl(a.level || a.value) }) },
    MUTE:            { tool: 'mute',              args: () => ({}) },
    DARK_MODE:       { tool: 'darkMode',          args: () => ({}) },
    BATTERY:         { tool: 'battery',           args: () => ({}) },
    WEATHER:         { tool: 'weather',           args: a => ({ city: a.city || '' }) },
    TIME:            { tool: 'time',              args: () => ({}) },
    DATE:            { tool: 'date',               args: () => ({}) },
    TIMER:           { tool: 'timer',             args: a => ({ minutes: a.minutes || a.mins || a.duration || 5 }) },
    REMINDER:        { tool: 'reminder',          args: a => ({ text: a.text || a.note || a.message || 'reminder', when: a.when || a.time || '' }) },
    TASK_ADD:        { tool: 'addTask',           args: a => ({ text: a.text || a.task || a.title || 'task' }) },
    TASK_LIST:       { tool: 'listTasks',          args: () => ({}) },
    TASK_DONE:       { tool: 'completeTask',      args: a => ({ text: a.text || a.task || '' }) },
    TASK_DELETE:     { tool: 'deleteTask',        args: a => ({ text: a.text || a.task || '' }) },
    READ_FILE:       { tool: 'readFile',          args: () => ({}) },
    LIST_FILES:      { tool: 'listFiles',         args: () => ({}) },
    SEARCH_FILES:    { tool: 'searchFiles',       args: a => ({ query: a.query || a.name || '' }) },
    CREATE_FOLDER:   { tool: 'createFolder',      args: a => ({ name: a.name || a.folder || 'New Folder' }) },
    CREATE_FILE:     { tool: 'createFile',        args: a => ({ name: a.name || a.file || 'untitled.txt' }) },
    SCREENSHOT:      { tool: 'screenshot',        args: () => ({}) },
    READ_SCREEN:     { tool: 'readScreen',        args: () => ({}) },
    LOCK:            { tool: 'lock',              args: () => ({}) },
    SLEEP:           { tool: 'sleep',             args: () => ({}) },
    SHUTDOWN:        { tool: 'shutdown',          args: () => ({}) },
    RESTART:         { tool: 'restart',           args: () => ({}) },
    PLAY_MUSIC:      { tool: 'playMusic',         args: a => ({ query: a.query || a.song || a.artist || '' }) },
    PAUSE:           { tool: 'pause',             args: () => ({}) },
    NEXT_TRACK:      { tool: 'nextTrack',         args: () => ({}) },
    PREV_TRACK:      { tool: 'prevTrack',         args: () => ({}) },
    MAPS:            { tool: 'maps',              args: a => ({ query: a.query || a.place || '' }) },
    CONVERT:         { tool: 'convert',            args: a => ({ from: a.from || '', to: a.to || '', value: a.value }) },
    CALCULATE:       { tool: 'calc',              args: a => ({ expr: a.expr || a.expression || a.equation || '' }) },
  };

  function clampLvl(v) { const n = Number(v); if (!isFinite(n)) return undefined; return Math.max(0, Math.min(100, Math.round(n))); }

  // ---- main entry: parse(text, ctx, ruleResult) ----
  // Returns a JARVIS-style { intent, confidence, tool, args, text, source } object,
  // or null if Qwen could not produce a usable result (caller falls back to ruleResult).
  async function parse(norm, ctx, ruleResult) {
    refreshEnabled();
    if (!enabled) return null;
    if (!window.llmReady || !llmReady()) return null;

    const text = (norm && (norm.text || norm.original)) || (ruleResult && ruleResult.text) || '';
    if (!text || text.length < 2) return null;

    // Skip the Qwen round-trip for very short utterances (greetings, "yes", "no")
    // — the rule engine already handles these perfectly and we save latency.
    if (/^(hi|hey|hello|yo|yes|no|ok|sure|cancel|stop|thanks?|bye)\b/i.test(text.trim()) && text.split(/\s+/).length <= 2) return null;

    const t0 = performance.now();
    let qwen = null;
    try {
      const r = await fetch((window.API || '') + '/nlu/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model: (window.llm && llm.model) || '' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      qwen = await r.json();
    } catch (e) {
      failCount++; lastLatencyMs = Math.round(performance.now() - t0);
      lastResult = { ok: false, reason: 'fetch_error', error: e.message, ms: lastLatencyMs };
      return null;
    }
    lastLatencyMs = Math.round(performance.now() - t0);
    callCount++;

    if (!qwen || !qwen.success) {
      failCount++;
      lastResult = { ok: false, reason: (qwen && qwen.reason) || 'no_success', ms: lastLatencyMs };
      return null;
    }

    // Threshold: Qwen must be at least 0.7 confident AND beat the rule engine's confidence.
    // Otherwise the rule result stands (and CONVERSATION routes to the local AI as usual).
    if (qwen.confidence < 0.7) {
      lastResult = { ok: false, reason: 'low_confidence', qwen, ms: lastLatencyMs };
      return null;
    }
    if (qwen.intent === 'CONVERSATION') {
      lastResult = { ok: true, kept: 'conversation', qwen, ms: lastLatencyMs };
      return null; // rule engine already classified this as CONVERSATION; nothing to override
    }
    if (ruleResult && ruleResult.confidence && qwen.confidence <= ruleResult.confidence + 0.05) {
      // Qwen is barely better than rules; keep rules for speed and determinism.
      lastResult = { ok: false, reason: 'not_better', qwen, rule: ruleResult.confidence, ms: lastLatencyMs };
      return null;
    }

    const mapper = TOOL_BY_INTENT[qwen.intent];
    if (!mapper) {
      lastResult = { ok: false, reason: 'no_mapper', qwen, ms: lastLatencyMs };
      return null;
    }

    const out = {
      intent: qwen.intent,
      confidence: qwen.confidence,
      tool: mapper.tool,
      args: mapper.args(qwen.args || {}),
      text: text,
      original: (norm && norm.original) || text,
      source: 'qwen',
      _qwen: qwen,
    };
    lastResult = { ok: true, override: true, qwen, ms: lastLatencyMs };
    return out;
  }

  // ---- inspector / debugging ----
  function describe() {
    return {
      enabled: enabled,
      calls: callCount,
      failures: failCount,
      last: lastResult,
      latencyMs: lastLatencyMs,
    };
  }

  // ---- settings toggle wiring ----
  // The toggle row lives in index.html's settings drawer as #qwenNluToggle.
  // We bind click handlers once we can find it. We don't rewrite the existing
  // settings renderer — we just listen for clicks and reflect the saved state.
  function bindToggle() {
    const btn = document.getElementById('qwenNluToggle');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    refreshEnabled();
    btn.classList.toggle('on', enabled);
    btn.setAttribute('aria-checked', String(enabled));
    btn.addEventListener('click', () => setEnabled(!enabled));
  }

  function setEnabled(on) {
    enabled = !!on;
    try { settings.qwenNlu = enabled; if (typeof saveSettings === 'function') saveSettings(); } catch (e) {}
    const btn = document.getElementById('qwenNluToggle');
    if (btn) { btn.classList.toggle('on', enabled); btn.setAttribute('aria-checked', String(enabled)); }
    if (typeof log === 'function') log(enabled ? 'ok' : 'info', 'Qwen NLU assist ' + (enabled ? 'enabled' : 'disabled'));
  }

  // Bind on first paint and re-check on every settings-drawer open.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else bindToggle();
  document.addEventListener('click', bindToggle, { passive: true });

  // Public API
  return {
    parse,
    describe,
    setEnabled,
    refreshEnabled,
    bindToggle,
    get enabled() { refreshEnabled(); return enabled; },
    INTENT_WHITELIST: Object.keys(TOOL_BY_INTENT).concat(['CONVERSATION']),
  };
})();
