'use strict';
const AssistantTools = (() => {
  const minute = 60000;
  const day = 86400000;
  function localDay(d) {
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }
  function captures(name, text) {
    const date = /^inbox-(\d{4}-\d{2}-\d{2})\.md$/.exec(name)?.[1];
    if (!date) return [];
    return text.split(/\r?\n/).flatMap((line, index) => {
      const match = /^-\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s+—\s+(.+)$/i.exec(line);
      if (!match) return [];
      const hour = +match[1] % (match[3] ? 12 : 24) + (match[3]?.toLowerCase() === 'pm' ? 12 : 0);
      const at = Date.parse(date + 'T' + String(hour).padStart(2, '0') + ':' + match[2] + ':00');
      return Number.isFinite(at) ? [{ id: 'capture:' + date + ':' + index, at, text: match[4], source: 'Quick capture' }] : [];
    });
  }
  function inbox(memory, entries, query = '', date = '') {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return entries.concat(memory.filter(row => row.key === 'note').map(row => ({
      id: 'note:' + row.id, text: row.value, at: row.ts, source: 'Notes',
    }))).filter(row => (!date || (row.at && localDay(new Date(row.at)) === date)) &&
      words.every(word => row.text.toLocaleLowerCase().includes(word))).sort((a, b) => b.at - a.at);
  }
  function isQuiet(settings, until, now = Date.now()) {
    if (Number(until) > now) return true;
    if (!settings?.quietEnabled) return false;
    const clock = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? +value.slice(0, 2) * 60 + +value.slice(3) : NaN;
    const start = clock(settings.quietStart), end = clock(settings.quietEnd);
    const current = new Date(now), point = current.getHours() * 60 + current.getMinutes();
    if (!Number.isFinite(start + end) || start === end) return false;
    return start < end ? point >= start && point < end : point >= start || point < end;
  }
  const holdAlert = (state, kind, now) => kind !== 'timer' && kind !== 'battery_crit' &&
    !(kind === 'deadline' && state['jarvis.settings']?.quietPassDeadlines) &&
    isQuiet(state['jarvis.settings'], state['jarvis.quietUntil'], now);
  function addRecap(state, { id, kind, text, at = Date.now() }) {
    const old = Array.isArray(state['jarvis.quietRecap']) ? state['jarvis.quietRecap'] : [];
    if (old.some(item => item.id === id)) return;
    state['jarvis.quietRecap'] = [...old, { id, kind, text: String(text).slice(0, 400), at }].slice(-100);
  }
  function corrected(original, replacement) {
    const target = String(replacement || '').trim().replace(/[.!?]+$/, '');
    if (!target) return null;
    if (/^(?:remind|set|schedule|add)\b/i.test(original || '')) {
      const time = /^(?:make it |at )?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i.exec(target);
      const oldTime = /\bat\s+\d{1,2}(?::\d{2})?(?:\s*(am|pm))?\b/i;
      if (time) {
        const found = oldTime.exec(original || '');
        if (!found) return null;
        const value = time[1].trim();
        return original.replace(oldTime, 'at ' + value + (!/am|pm/i.test(value) && found[1] ? ' ' + found[1] : ''));
      }
      const days = /^(?:(?:on|next|this) )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)$/i;
      const oldDay = /\b(?:(?:on|next|this) )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i;
      if (days.test(target)) return oldDay.test(original) ? original.replace(oldDay, target) : null;
    }
    if (/^(?:open|close|delete|move|copy|rename|turn|start|stop|show|find|play|run|set)\s+/i.test(target)) return target;
    const match = /^(open|close|delete|show|find)\s+(?:(?:my|the)\s+)?(.+?)(?:\s+(notes?|folder|file|pdf))?[.!?]?$/i.exec(original || '');
    if (!match || /[;\n]|\b(?:and then|then)\b/i.test(target)) return null;
    const suffix = match[3] && !/\b(?:notes?|folder|file|pdf)$|\.[a-z0-9]+$/i.test(target) ? ' ' + match[3] : '';
    return match[1] + ' ' + target + suffix;
  }
  function slots({ from, to, minutes, busy, startHour = 8, endHour = 22 }) {
    const duration = minutes * minute, found = [];
    if (!Number.isFinite(from + to + duration) || to <= from || duration < minute) return found;
    const ordered = busy.filter(period => period.end > period.start).slice().sort((a, b) => a.start - b.start);
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    while (+d < Math.min(to, from + 31 * day) && found.length < 3) {
      const end = new Date(d); end.setHours(endHour);
      const start = new Date(d); start.setHours(startHour);
      let at = Math.max(+start, from), limit = Math.min(+end, to);
      const add = until => {
        const rounded = Math.ceil(at / (5 * minute)) * 5 * minute;
        if (rounded + duration <= until) found.push({ start: rounded, end: rounded + duration });
      };
      for (const item of ordered) {
        if (item.end <= at) continue;
        if (item.start >= limit || found.length >= 3) break;
        add(item.start);
        at = Math.max(at, item.end);
      }
      if (found.length < 3) add(limit);
      d.setDate(d.getDate() + 1);
    }
    return found;
  }
  return { localDay, captures, inbox, isQuiet, holdAlert, addRecap, corrected, slots };
})();
if (typeof module !== 'undefined') module.exports = AssistantTools;
