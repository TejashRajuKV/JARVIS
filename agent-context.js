'use strict';
(function (root) {
  const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
  }
  const signature = step => JSON.stringify([step.tool || step.intent, canonical(step.args || {})]);
  function failures(runs) {
    const latest = new Map();
    for (const run of (runs || []).slice(-50)) for (const step of run.steps || []) {
      if (step.status === 'failed' || step.status === 'verified') latest.set(signature(step), step);
    }
    return [...latest.values()].filter(s => s.status === 'failed').slice(-20);
  }
  function priorFailure(step, runs) { return failures(runs).find(s => signature(s) === signature(step)); }
  function failureAdvice(runs) {
    return failures(runs).map(s => clean(s.tool || s.intent, 60) + ': ' + clean(s.label, 100) + ' — ' + clean(s.note, 180)).join('\n').slice(0, 2200);
  }
  function compact(steps, limit = 2400) {
    // Store observations as bounded text, never image data or approval tokens.
    const observation = s => typeof s.output === 'string' && !/(?:data:image|base64|imageToken|approvalToken)/i.test(s.output)
      ? clean(s.output, 100) : '';
    const rows = (steps || []).map((s, i) => (i + 1) + '. ' + clean(s.label || s.tool || s.intent, 80) +
      ' [' + clean(s.status || 'pending', 20) + '] ' + clean(s.note, 100) + (observation(s) ? ' Result: ' + observation(s) : ''));
    if (rows.join('\n').length <= limit) return rows.join('\n');
    const totals = {};
    for (const s of steps) totals[s.status || 'pending'] = (totals[s.status || 'pending'] || 0) + 1;
    const head = 'Earlier steps: ' + Object.entries(totals).map(([k, v]) => v + ' ' + k).join(', ') + '.\n';
    const problems = rows.filter((_, i) => ['failed','blocked'].includes(steps[i].status)).slice(-3).join('\n').slice(0, 600);
    return (head + (problems ? 'Unresolved problems:\n' + problems + '\nRecent steps:\n' : '') + rows.slice(-6).map(r => r.slice(0, 240)).join('\n')).slice(0, limit);
  }
  const api = { signature, failures, priorFailure, failureAdvice, compact };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgentContext = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
