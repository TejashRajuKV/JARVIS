'use strict';
/* Reading everyday sentences: expenses ("spent 120 on lunch"), habits ("track habit water", "done water") and quick capture ("jot down …"), plus the
   small calculations behind them (spending windows and totals, habit streaks). Pure: the page stores the data, this file only reads text and counts.
   Money is rupees (₹); amounts may be written 120, 1,250, ₹120, rs 120, 120 rupees, 1.5k. */
const LifeParse = (() => {
  const DAY = 864e5;
  const startOfDay = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
  const weekStart = t => addDays(startOfDay(t), -((new Date(t).getDay() + 6) % 7));            // Monday
  const ymd = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  /* ---------- money ---------- */
  const AMT = '(?:(?:rs\\.?|inr|₹)\\s*)?(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)\\s*(k\\b)?\\s*(?:rs\\.?|rupees?|inr|₹|/-)?';
  const toNumber = (n, k) => { const v = parseFloat(String(n).replace(/,/g, '')) * (k ? 1000 : 1); return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
  const CATS = [
    ['Food', /\b(lunch|dinner|breakfast|snacks?|tea|chai|coffee|biryani|dosa|idli|meals?|food|canteen|mess|pizza|burger|juice|samosa|maggi|restaurant|cafe|café|swiggy|zomato|ice ?cream|groceries|grocery|milk|fruits?|vegetables?|water bottle)\b/i],
    ['Transport', /\b(auto|bus|metro|train|cab|uber|ola|rapido|petrol|fuel|diesel|taxi|ticket|bike|parking|fare|commute|flight)\b/i],
    ['Study', /\b(books?|notebooks?|stationery|pens?|xerox|photocopy|printout|print|course|exam fee|fees?|tuition|lab record|record book|calculator|udemy|coursera|textbook)\b/i],
    ['Phone & net', /\b(recharge|data pack|wifi|wi-fi|internet|broadband|sim|mobile bill|phone bill)\b/i],
    ['Fun', /\b(movie|cinema|game|games|netflix|spotify|party|outing|trip|concert|gaming|steam|hotstar|prime)\b/i],
    ['Shopping', /\b(shirt|jeans|shoes|clothes|dress|bag|watch|headphones?|earphones?|charger|amazon|flipkart|myntra|gift)\b/i],
    ['Health', /\b(medicine|medicines|doctor|pharmacy|hospital|tablet|clinic|gym|checkup)\b/i],
    ['Rent & bills', /\b(rent|electricity|bill|hostel|deposit)\b/i],
  ];
  const categorize = note => { for (const [c, re] of CATS) if (re.test(note)) return c; return 'Other'; };

  // When was it? "yesterday", "today", "2 days ago", "on monday". → ms (noon of that day), default now.
  function whenOf(text, now) {
    const t = ' ' + String(text).toLowerCase() + ' ';
    let m;
    if (/\byesterday\b/.test(t)) return { at: addDays(startOfDay(now), -1) + 12 * 3600e3, rest: text.replace(/\byesterday\b/i, '') };
    if ((m = t.match(/\b(\d{1,2}) days? ago\b/))) return { at: addDays(startOfDay(now), -+m[1]) + 12 * 3600e3, rest: text.replace(/\b\d{1,2} days? ago\b/i, '') };
    if ((m = t.match(/\b(?:on |last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
      const wd = WEEKDAYS.indexOf(m[1]); let d = startOfDay(now);
      for (let i = 0; i < 7 && new Date(d).getDay() !== wd; i++) d = addDays(d, -1);
      return { at: d + 12 * 3600e3, rest: text.replace(/\b(?:on |last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, '') };
    }
    return { at: now, rest: String(text).replace(/\b(today|just now|earlier)\b/i, '') };
  }
  // "spent 120 on lunch", "paid ₹450 for books yesterday", "add expense 200 groceries", "expense: 80 auto"
  const EXP_A = new RegExp('^(?:please\\s+)?(?:i\\s+)?(?:just\\s+)?(?:spent|spend|paid|pay|bought|gave|gave away|lost)\\s+' + AMT + '\\s*(?:(?:on|for|to|at|in)\\s+)?(.*)$', 'i');
  const EXP_B = new RegExp('^(?:please\\s+)?(?:add|log|record|note|save)\\s+(?:an?\\s+|my\\s+)?expense\\s*[:\\-]?\\s*(?:of\\s+)?' + AMT + '\\s*(?:(?:on|for|to|at)\\s+)?(.*)$', 'i');
  const EXP_C = new RegExp('^(?:please\\s+)?expense\\s*[:\\-]\\s*' + AMT + '\\s*(?:(?:on|for)\\s+)?(.*)$', 'i');
  const EXP_D = new RegExp('^(?:please\\s+)?(?:i\\s+)?(?:bought|got|ordered)\\s+(.+?)\\s+(?:for|at)\\s+' + AMT + '\\s*(.*)$', 'i');
  function parseExpense(text, now = Date.now()) {
    const t = String(text || '').trim().replace(/[.!]+$/, '');
    let m, amount, note, extra = '';
    if ((m = t.match(EXP_A)) || (m = t.match(EXP_B)) || (m = t.match(EXP_C))) { amount = toNumber(m[1], m[2]); note = m[3]; }
    else if ((m = t.match(EXP_D))) { amount = toNumber(m[2], m[3]); note = m[1]; extra = m[4] || ''; }
    else return null;
    if (!(amount > 0) || amount > 10000000) return null;
    const w = whenOf((note + ' ' + extra).trim(), now);
    note = w.rest.replace(/\s+/g, ' ').replace(/^(?:the|a|an|some|my)\s+/i, '').replace(/[,;:\-–\s]+$/, '').trim();
    // "bought books for 450" and "spent 100 on (nothing)": a note is optional
    return { amount, note: note.slice(0, 60), cat: categorize(note), t: w.at };
  }
  // "expenses this month", "how much did I spend on food this week", "spending summary", "what did I spend yesterday"
  const WIN = '(today|yesterday|this week|last week|this month|last month|this year)';
  const EXP_Q = [
    new RegExp('^(?:please\\s+)?(?:how much|what)\\s+(?:did|have|do)\\s+i\\s+(?:spent|spend)\\s*(?:on\\s+(.+?))?\\s*(?:' + WIN + ')?\\s*[?.!]*$', 'i'),
    new RegExp('^(?:please\\s+)?(?:show|list|what(?:\'s| is| are))?\\s*(?:me\\s+)?(?:my\\s+)?(?:expenses|spending|spends)(?:\\s+(?:summary|report|so far))?(?:\\s+on\\s+(.+?))?\\s*(?:' + WIN + ')?\\s*[?.!]*$', 'i'),
    /^(?:please\s+)?(?:expense|spending)\s+(?:summary|report)\s*(?:(today|yesterday|this week|last week|this month|last month|this year))?\s*[?.!]*$/i,
  ];
  function parseExpenseQuery(text) {
    const t = String(text || '').trim();
    for (const re of EXP_Q) { const m = t.match(re); if (m) { const win = (m[2] || m[1] && WIN_RE.test(m[1]) && m[1] || 'this month').toLowerCase(); const about = m[2] !== undefined ? m[1] : (m[1] && !WIN_RE.test(m[1]) ? m[1] : ''); return { window: re === EXP_Q[2] ? (m[1] || 'this month').toLowerCase() : win, about: String(about || '').trim().toLowerCase().replace(/^my\s+/, '') }; } }
    return null;
  }
  const WIN_RE = /^(today|yesterday|this week|last week|this month|last month|this year)$/i;
  function windowRange(win, now = Date.now()) {
    const today = startOfDay(now), d = new Date(now);
    switch (win) {
      case 'today': return { from: today, to: today + DAY, label: 'today' };
      case 'yesterday': return { from: addDays(today, -1), to: today, label: 'yesterday' };
      case 'this week': return { from: weekStart(now), to: today + DAY, label: 'this week' };
      case 'last week': { const s = addDays(weekStart(now), -7); return { from: s, to: addDays(s, 7), label: 'last week' }; }
      case 'last month': return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), label: 'last month' };
      case 'this year': return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: today + DAY, label: 'this year' };
      default: return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: today + DAY, label: 'this month' };
    }
  }
  // → { total, count, byCat:[[cat, sum]] biggest first, byDay: Map, items, perDay }
  function summarize(expenses, win, now = Date.now(), about = '') {
    const r = windowRange(win, now), q = String(about || '').toLowerCase();
    const items = (expenses || []).filter(e => e && e.t >= r.from && e.t < r.to && e.amount > 0 && (!q || String(e.cat).toLowerCase().includes(q) || String(e.note).toLowerCase().includes(q))).sort((a, b) => b.t - a.t);
    const by = new Map(); let total = 0;
    for (const e of items) { total += e.amount; by.set(e.cat, (by.get(e.cat) || 0) + e.amount); }
    const days = Math.max(1, Math.round((Math.min(r.to, startOfDay(now) + DAY) - r.from) / DAY));
    return { range: r, total: Math.round(total * 100) / 100, count: items.length, byCat: [...by.entries()].map(([c, v]) => [c, Math.round(v * 100) / 100]).sort((a, b) => b[1] - a[1]), items, perDay: Math.round(total / days), days };
  }
  const money = n => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const csv = expenses => 'date,amount,category,note\n' + [...expenses].sort((a, b) => a.t - b.t).map(e => [ymd(e.t), e.amount, e.cat, '"' + String(e.note || '').replace(/"/g, '""') + '"'].join(',')).join('\n') + '\n';

  /* ---------- habits ---------- */
  const habitName = s => String(s || '').toLowerCase().replace(/^(?:a|an|the|my|to|for)\s+/, '').replace(/[^a-z0-9 +&'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  const HAB_ADD = /^(?:please\s+)?(?:(?:start|begin)\s+tracking|track|add|create|new)\s+(?:a\s+|my\s+)?(?:new\s+)?habit\s*(?:called|named|of|:)?\s*(.+?)\s*[.!]*$|^(?:please\s+)?(?:start|begin)\s+tracking\s+(.+?)\s+(?:daily|every\s+day|each\s+day)\s*[.!]*$/i;
  const HAB_DEL = /^(?:please\s+)?(?:stop\s+tracking|delete|remove)\s+(?:my\s+)?(?:habit\s+)?(.+?)(?:\s+habit)?\s*[.!]*$/i;
  const HAB_LIST = /^(?:please\s+)?(?:show\s+|list\s+)?(?:me\s+)?(?:my\s+)?(?:habits?(?:\s+(?:streaks?|report|summary|list|chart|this week))?|streaks?|habit\s+tracker)\s*[?.!]*$/i;
  const HAB_DONE = [/^(?:please\s+)?(?:i\s+)?(?:did|done|completed|finished|logged|checked in|ticked|had|drank|exercised|studied|read|slept)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:today|yesterday))?\s*[.!]*$/i, /^(?:please\s+)?(?:log|check in|check off|tick|mark)\s+(?:my\s+)?(?:habit\s+)?(.+?)(?:\s+(?:as\s+)?done)?(?:\s+(?:today|yesterday))?\s*[.!]*$/i];
  const HAB_STREAK = /^(?:how\s+(?:many\s+days|long)\s+(?:in\s+a\s+row\s+)?(?:have\s+i|is\s+my)\s+(.+?)|(?:what(?:'s| is)\s+)?my\s+(.+?)\s+streak)\s*[?.!]*$/i;
  function matchHabit(t, known) {
    t = String(t || '').trim(); let m;
    const names = (known || []).map(h => h.name);
    const isKnown = n => { const h = habitName(n); return h ? names.find(k => k === h || h.split(' ').includes(k) || (h.length >= 4 && k.split(' ').includes(h))) : undefined; };   // whole words only: "gymnastics" is not "gym"
    if ((m = t.match(HAB_ADD))) { const n = habitName(m[1] || m[2]); return n ? { op: 'add', name: n } : null; }
    if (HAB_LIST.test(t)) return { op: 'list' };
    if ((m = t.match(HAB_STREAK)) && isKnown(m[1] || m[2])) return { op: 'streak', name: isKnown(m[1] || m[2]) };
    if ((m = t.match(HAB_DEL)) && isKnown(m[1]) && /track|habit|delete|remove/i.test(t) && (/^(?:please\s+)?stop\s+tracking/i.test(t) || /habit/i.test(t))) return { op: 'del', name: isKnown(m[1]) };
    if ((m = t.match(/^(?:please\s+)?(?:i\s+)?(read|exercised|studied|slept|meditated|walked|ran|journaled)(?:\s+(today|yesterday))?\s*[.!]*$/i)) && isKnown(m[1])) return { op: 'done', name: isKnown(m[1]), day: /yesterday/i.test(m[2] || '') ? -1 : 0 };
    for (const re of HAB_DONE) if ((m = t.match(re)) && isKnown(m[1])) return { op: 'done', name: isKnown(m[1]), day: /\byesterday\b/i.test(t) ? -1 : 0 };
    return null;
  }
  // days: array/Set of 'YYYY-MM-DD'. Current streak counts back from today, or from yesterday when today is not ticked yet (the day is not over).
  function streakOf(days, nowMs = Date.now()) {
    const set = days instanceof Set ? days : new Set(days || []);
    let d = startOfDay(nowMs), cur = 0;
    if (!set.has(ymd(d))) d = addDays(d, -1);
    while (set.has(ymd(d))) { cur++; d = addDays(d, -1); }
    const sorted = [...set].sort(); let best = 0, run = 0, prev = null;
    for (const k of sorted) { const t = new Date(k + 'T12:00:00').getTime(); run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; }
    return { current: cur, best, total: set.size };
  }
  const weekGrid = (days, nowMs = Date.now()) => { const set = days instanceof Set ? days : new Set(days || []); return Array.from({ length: 7 }, (_, i) => { const t = addDays(startOfDay(nowMs), i - 6); return { key: ymd(t), on: set.has(ymd(t)), dow: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][new Date(t).getDay()] }; }); };

  /* ---------- quick capture ---------- */
  const CAP = /^(?:please\s+)?(?:(?:jot\s+down|jot|quick\s+note|note\s+to\s+self)\s*[:,\-]?\s*|(?:capture|inbox)\s*[:,\-]\s*|capture\s+(?=(?:the\s+|this\s+)?(?:idea|thought|note|reminder)\b))(?:that\s+)?(.+)$/i;   // "capture" and "inbox" alone are ordinary words (capture the flag, inbox zero): they need a colon
  const CAP_SHOW = /^(?:please\s+)?(?:show|open|what(?:'s| is| did i (?:jot|capture|note) (?:down )?in))\s*(?:me\s+)?(?:my\s+)?(?:(today'?s|yesterday'?s|the)\s+)?(?:inbox|quick\s+notes?|captures?)(?:\s+(today|yesterday))?\s*[?.!]*$|^(?:inbox|my inbox)\s*[?.!]*$/i;
  function parseCapture(text) { const m = String(text || '').trim().match(CAP); const t = m ? m[1].trim().slice(0, 1000) : ''; return t ? { text: t } : null; }
  function parseCaptureShow(text) { const m = String(text || '').trim().match(CAP_SHOW); return m ? { day: /yesterday/i.test(text) ? -1 : 0 } : null; }

  return { parseExpense, parseExpenseQuery, summarize, windowRange, categorize, money, csv, toNumber, matchHabit, habitName, streakOf, weekGrid, parseCapture, parseCaptureShow, ymd, CATS };
})();
if (typeof module !== 'undefined') module.exports = LifeParse;
