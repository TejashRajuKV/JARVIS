'use strict';
/* The tools JARVIS runs for an understood command (executeTool in script.js), split by area into tools/<area>.js. Each area file registers ONE handler:
     ToolHandlers.add('apps', async function (p, raw, s, a) { switch (p.intent) { case 'OPEN_APPLICATION': …; default: return ToolHandlers.NONE; } });
   executeTool asks the areas in turn; the one that knows the intent answers. Every intent belongs to exactly one area (tests/toolregistry.test.js).
   normalize() gives every result the same two extra facts, without changing what it already says:
     ok        — true when the tool did what was asked (no error, not cancelled, not handed to the AI)
     errorCode — null, or 'failed' (it tried and could not), 'cancelled' (you said no), 'not_found' (nothing by that name / nothing to do), 'needs_ai'
   They are not enumerable, so saved chats, traces and anything that prints a result look exactly as before. */
const ToolHandlers = (() => {
  const NONE = Symbol('not this area');
  const list = [];
  function add(area, fn) {
    if (typeof fn !== 'function') throw new Error('ToolHandlers.add: a handler function is needed for ' + area);
    if (list.some(h => h.area === area)) throw new Error('ToolHandlers.add: area "' + area + '" is registered twice');
    list.push({ area, fn });
  }
  function codeOf(r) {
    if (r.cancelled) return 'cancelled';
    if (r.error) return 'failed';
    if (r.absent || r.notFound) return 'not_found';
    if (r.askLLM) return 'needs_ai';
    return null;
  }
  function normalize(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
    const code = codeOf(r);
    try {
      if (!Object.prototype.hasOwnProperty.call(r, 'errorCode')) Object.defineProperty(r, 'errorCode', { value: code, enumerable: false, writable: true, configurable: true });
      if (!Object.prototype.hasOwnProperty.call(r, 'ok')) Object.defineProperty(r, 'ok', { value: code === null, enumerable: false, writable: true, configurable: true });
    } catch (e) { /* a frozen result stays as it is */ }
    return r;
  }
  return { NONE, list, add, normalize, codeOf, areas: () => list.map(h => h.area) };
})();
if (typeof module !== 'undefined') module.exports = ToolHandlers;
