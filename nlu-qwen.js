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
  // The model may only name intents that JARVIS really runs. `intent` is the real executeTool intent (omitted when the names are the same); `args` reshapes what the
  // model sent into what that handler reads. Left out on purpose — a model's guess must never power the laptop off, lock it, delete or send anything, or make a reminder:
  // SHUTDOWN, RESTART, SLEEP, LOCK, TASK_DELETE, TASK_DONE, REMINDER, CREATE_FILE, READ_SCREEN, MAPS, CONVERT (the rules and the planner handle those, with their checks).
  const TOOL_BY_INTENT = {
    OPEN_APPLICATION:  { tool: 'openApplication',  args: a => ({ app: pickText(a, ['app', 'name'], 100) }) },
    CLOSE_APPLICATION: { tool: 'closeApplication', args: a => ({ app: a.app || a.name || '' }) },       // JARVIS still asks YES first (confirmGate)
    OPEN_WEB:          { tool: 'openWeb',           args: a => ({ query: pickText(a, ['query', 'target'], 240) }) },
    WEB_SEARCH:        { tool: 'webSearch',         args: a => ({ query: a.query || a.target || '' }) },
    SITE_SEARCH:       { tool: 'openWeb',           args: a => ({ query: a.query || a.target || '' }) },
    BRIGHTNESS:        { tool: 'brightness',        args: a => ({ level: clampLvl(a.level ?? a.value) }) },
    DARK_MODE:         { tool: 'darkMode',          args: () => ({}) },
    WEATHER:           { tool: 'weather',           args: a => ({ city: pickText(a, ['city'], 100) }) },
    READ_FILE:         { tool: 'readFile',          args: a => ({ name: pickText(a, ['name', 'file'], 240) }) },
    LIST_FILES:        { tool: 'listFiles',         args: () => ({}) },
    SEARCH_FILES:      { tool: 'searchFiles',       args: a => ({ query: pickText(a, ['query', 'name'], 240) }) },
    CREATE_FOLDER:     { tool: 'createFolder',      args: a => ({ name: pickText(a, ['name', 'folder'], 100) }) },
    SCREENSHOT:        { tool: 'screenshot',        args: () => ({}) },
    CALCULATE:         { tool: 'calc',              args: a => ({ expression: pickText(a, ['expression', 'expr', 'equation'], 240) }) },
    VOLUME:            { tool: 'volume',     intent: 'VOLUME_SET',  args: a => ({ level: clampLvl(a.level ?? a.value) }) },
    MUTE:              { tool: 'mute',       intent: 'VOLUME_MUTE', args: () => ({}) },
    BATTERY:           { tool: 'battery',    intent: 'SYS_BATTERY', args: () => ({}) },
    TIME:              { tool: 'time',       intent: 'GET_TIME',    args: () => ({}) },
    DATE:              { tool: 'date',       intent: 'GET_DATE',    args: () => ({}) },
    TIMER:             { tool: 'timer',      intent: 'SET_TIMER',   args: a => { const m = Number(a.minutes || a.mins || a.duration || 5); return { seconds: Math.max(1, Math.min(86400, Math.round((isFinite(m) ? m : 5) * 60))) }; } },
    TASK_ADD:          { tool: 'addTask',    intent: 'ADD_TODO',    args: a => ({ text: pickText(a, ['text', 'task', 'title'], 140) }) },
    TASK_LIST:         { tool: 'listTasks',  intent: 'LIST_TODOS',  args: () => ({}) },
    PLAY_MUSIC:        { tool: 'playMusic',  intent: 'YOUTUBE_PLAY', args: a => ({ query: pickText(a, ['query', 'song', 'artist'], 200) }) },
    PAUSE:             { tool: 'pause',      intent: 'MEDIA_PLAY',  args: () => ({}) },
    NEXT_TRACK:        { tool: 'nextTrack',  intent: 'MEDIA_NEXT',  args: () => ({}) },
    PREV_TRACK:        { tool: 'prevTrack',  intent: 'MEDIA_PREV',  args: () => ({}) },
  };

  // Model output is untrusted even when its intent is whitelisted. Keep every
  // string argument primitive, bounded, and free of control characters.
  function safeText(v, max = 160) {
    if (typeof v !== 'string' && typeof v !== 'number') return '';
    return String(v).replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, max);
  }
  function pickText(a, keys, max = 160) {
    for (const key of keys) { const value = safeText(a && a[key], max); if (value) return value; }
    return '';
  }
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
    // A stalled local model must not freeze the user's command pipeline indefinitely.
    // Abort the request after 8 seconds; the rule engine/planner can then continue.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const r = await fetch((window.API || '') + '/nlu/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model: (window.llm && llm.model) || '' }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      qwen = await r.json();
    } catch (e) {
      failCount++; lastLatencyMs = Math.round(performance.now() - t0);
      lastResult = { ok: false, reason: controller && controller.signal.aborted ? 'timeout' : 'fetch_error', error: e.message, ms: lastLatencyMs };
      return null;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
    lastLatencyMs = Math.round(performance.now() - t0);
    callCount++;

    if (!qwen || !qwen.success) {
      failCount++;
      lastResult = { ok: false, reason: (qwen && qwen.reason) || 'no_success', ms: lastLatencyMs };
      return null;
    }

    // Treat the local model response as untrusted input. JSON parsing alone does
    // not guarantee a usable schema: confidence may be a string/NaN/out of range,
    // and args may be an array or primitive. Never let malformed output override
    // the deterministic rule result.
    if (typeof qwen.intent !== 'string' ||
        typeof qwen.confidence !== 'number' ||
        !Number.isFinite(qwen.confidence) || qwen.confidence < 0 || qwen.confidence > 1 ||
        (qwen.args != null && (typeof qwen.args !== 'object' || Array.isArray(qwen.args)))) {
      failCount++;
      lastResult = { ok: false, reason: 'invalid_response', ms: lastLatencyMs };
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

    const mappedArgs = mapper.args(qwen.args || {});
    // Never execute an intent whose target-bearing arguments were missing or
    // malformed. Let the normal rule/planner path ask the user instead.
    const requiredText = {
      OPEN_APPLICATION: 'app', CLOSE_APPLICATION: 'app', OPEN_WEB: 'query',
      WEB_SEARCH: 'query', SITE_SEARCH: 'query', READ_FILE: 'name',
      SEARCH_FILES: 'query', CREATE_FOLDER: 'name', CALCULATE: 'expression',
      TASK_ADD: 'text', PLAY_MUSIC: 'query',
    };
    const required = requiredText[qwen.intent];
    if (required && !safeText(mappedArgs[required])) {
      lastResult = { ok: false, reason: 'missing_argument', qwen, field: required, ms: lastLatencyMs };
      return null;
    }
    const out = {
      intent: mapper.intent || qwen.intent,
      confidence: qwen.confidence,
      tool: mapper.tool,
      args: mappedArgs,
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
