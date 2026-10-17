'use strict';
/* Karnataka tenders (KPPP), the pure parts: reading a results table you copied from kppp.karnataka.gov.in, understanding questions about tenders,
   filtering and wording the list. No page, no network: tested directly by tests/tenderparse.test.js and used by tenders-page.js.

   Why copied text: KPPP shows the tender list only after a CAPTCHA, which JARVIS does not solve or get around. You open the live search, type the
   CAPTCHA, select the results (Ctrl+A, Ctrl+C) and say "read these tenders"; everything after that is here. KPPP has no address per tender, so the
   "link" is the search page plus the tender number to look up there. */
const TenderParse = (() => {
  const DAY = 864e5;
  const KPPP_URL = 'https://kppp.karnataka.gov.in/#/portal/searchTender/live';

  /* ---------- columns ---------- */
  // KPPP's own headings (its en.json): S.No, Location, Tender Number, Tender Name, Type, Procuring Entity, Category, Sub Category, Estimated Value,
  // NIT Published Date, Last Date & Time for Bid Closure, Actions. Matched by meaning, so the order (and small wording changes) do not matter.
  function fieldOf(h) {
    const s = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (/^(s\.?\s?no\.?|sl\.?\s?no\.?|#)$/.test(s)) return 'sno';
    if (/action/.test(s)) return 'actions';
    if (/tender (number|no\.?|id)|reference (number|no)|^ref/.test(s)) return 'no';
    if (/closure|closing|last date|bid submission|due date/.test(s)) return 'closes';
    if (/publish/.test(s)) return 'published';
    if (/estimated|ecv|value|amount/.test(s)) return 'value';
    if (/sub[\s-]?category/.test(s)) return 'subCategory';
    if (/categor/.test(s)) return 'category';
    if (/procuring|department|entity|organi[sz]ation/.test(s)) return 'entity';
    if (/location|district|place/.test(s)) return 'location';
    if (/tender name|^name$|title|work name|description/.test(s)) return 'name';
    if (/type/.test(s)) return 'type';
    return null;
  }
  const splitCells = line => (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map(c => c.trim());
  const isHeader = line => { const f = splitCells(line).map(fieldOf); return f.includes('no') && f.includes('name'); };
  const NOISE = /^(showing\s+\d|page\s+\d|previous|next|first|last|search tenders|security check|please enter captcha|view tender details|no records? found)/i;
  const looksLikeNo = s => /\d/.test(s) && /^[A-Za-z0-9][A-Za-z0-9\/_\-.() ]{2,100}$/.test(s) && !/^\d{1,4}$/.test(s);

  /* ---------- values and dates ---------- */
  // "₹ 1,23,45,678.00", "12345678", "1.2 Cr", "45 Lakh", "Rs. 9,50,000/-" → rupees (a number), or null
  function parseValue(t) {
    const s = String(t || '').toLowerCase().replace(/,/g, '').replace(/₹|rs\.?|inr|\/-/g, ' ').trim();
    const m = s.match(/(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|k|thousand)?\b/);
    if (!m) return null;
    let n = parseFloat(m[1]); const u = m[2] || '';
    if (/^cr/.test(u)) n *= 1e7; else if (/^la|^l$/.test(u)) n *= 1e5; else if (u === 'k' || u === 'thousand') n *= 1e3;
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const hm = (h, m, ap) => { h = +h; m = +(m || 0); if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } return [h, m]; };
  // KPPP dates are day first: "21-10-2026 15:00", "21/10/2026 03:00 PM", "21-Oct-2026 17:30", "2026-10-21T15:00". Local time.
  // A date with no time is the END of that day for a closing date (it is open all day), the START of it for anything else.
  function parseDate(t, { endOfDay = false } = {}) {
    const s = String(t || '').trim(); let m, y, mo, d, h = null, mi = 0;
    if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/))) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; if (m[4] !== undefined) [h, mi] = hm(m[4], m[5]); }
    else if ((m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?/i))) { d = +m[1]; mo = +m[2] - 1; y = +m[3]; if (m[4] !== undefined) [h, mi] = hm(m[4], m[5], m[6]); }
    else if ((m = s.match(/(\d{1,2})[\s\-]+([a-z]{3,9})[\s\-,]+(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?/i)) && MON[m[2].slice(0, 3).toLowerCase()] !== undefined) { d = +m[1]; mo = MON[m[2].slice(0, 3).toLowerCase()]; y = +m[3]; if (m[4] !== undefined) [h, mi] = hm(m[4], m[5], m[6]); }
    else return null;
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    const dt = h === null ? new Date(y, mo, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0) : new Date(y, mo, d, h, mi);
    return dt.getMonth() === mo && dt.getDate() === d ? dt.getTime() : null;
  }

  /* ---------- places ---------- */
  // canonical name ← the spellings people use (old names too). Karnataka's districts and its bigger towns.
  const PLACES = {
    'Mysuru': ['mysuru', 'mysore'], 'Bengaluru': ['bengaluru', 'bangalore', 'bengaluru urban', 'bangalore urban', 'bbmp'], 'Bengaluru Rural': ['bengaluru rural', 'bangalore rural'],
    'Belagavi': ['belagavi', 'belgaum'], 'Kalaburagi': ['kalaburagi', 'gulbarga'], 'Mangaluru': ['mangaluru', 'mangalore'], 'Dakshina Kannada': ['dakshina kannada', 'south canara'],
    'Hubballi-Dharwad': ['hubballi', 'hubli', 'dharwad', 'hubli-dharwad', 'hubballi-dharwad'], 'Shivamogga': ['shivamogga', 'shimoga'], 'Tumakuru': ['tumakuru', 'tumkur'],
    'Ballari': ['ballari', 'bellary'], 'Vijayapura': ['vijayapura', 'bijapur'], 'Davanagere': ['davanagere', 'davangere'], 'Chikkamagaluru': ['chikkamagaluru', 'chikmagalur'],
    'Chitradurga': ['chitradurga'], 'Hassan': ['hassan'], 'Mandya': ['mandya'], 'Udupi': ['udupi'], 'Kodagu': ['kodagu', 'coorg', 'madikeri'], 'Raichur': ['raichur'],
    'Bidar': ['bidar'], 'Koppal': ['koppal'], 'Gadag': ['gadag'], 'Haveri': ['haveri'], 'Bagalkot': ['bagalkot', 'bagalkote'], 'Uttara Kannada': ['uttara kannada', 'karwar', 'north canara'],
    'Chamarajanagar': ['chamarajanagar', 'chamarajanagara'], 'Chikkaballapur': ['chikkaballapur', 'chikkaballapura'], 'Kolar': ['kolar'], 'Ramanagara': ['ramanagara', 'ramanagar'],
    'Yadgir': ['yadgir', 'yadagiri'], 'Vijayanagara': ['vijayanagara', 'hosapete', 'hospet'],
  };
  const PLACE_LIST = Object.entries(PLACES).flatMap(([canon, names]) => names.map(n => [n, canon])).sort((a, b) => b[0].length - a[0].length);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // → the canonical place named in the text, or null
  function placeOf(text) {
    const s = ' ' + String(text || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
    for (const [n, canon] of PLACE_LIST) if (new RegExp('[\\s-]' + esc(n) + '[\\s-]').test(s)) return canon;
    return null;
  }
  const aliasesOf = canon => PLACES[canon] || [String(canon || '').toLowerCase()];

  /* ---------- categories ---------- */
  function normCategory(c) {
    const s = String(c || '').toLowerCase();
    if (/work|civil/.test(s)) return 'Works'; if (/good|supply|purchase/.test(s)) return 'Goods'; if (/consult/.test(s)) return 'Consultancy'; if (/service/.test(s)) return 'Services';
    return String(c || '').trim();
  }
  // A building tender: KPPP says so in its sub-category, or it is a works tender whose name is clearly about a building (not a road, drain or pipe).
  const BUILD_WORDS = /\b(buildings?|hostels?|schools?|anganwadi|compound walls?|class ?rooms?|quarters|community halls?|halls?|bhavan|bhavana|toilet blocks?|office complex|auditorium|hospital|health (?:centre|center)|library|godown|warehouse|staff quarters|kitchen)\b/i;
  const NOT_BUILD = /\b(roads?|highways?|bridges?|culverts?|drains?|drainage|pipelines?|canals?|bore ?wells?|footpaths?)\b/i;
  function isBuilding(r) {
    if (/build/i.test(r.subCategory || '') || /build/i.test(r.category || '')) return true;
    const works = normCategory(r.category) === 'Works' || !r.category;
    return works && BUILD_WORDS.test(r.name || '') && !(NOT_BUILD.test(r.name || '') && !/\bbuildings?\b/i.test(r.name || ''));
  }
  const CAT_TEST = {
    building: isBuilding,
    road: r => /\b(roads?|highways?|bridges?|culverts?|footpaths?|pavements?|asphalt|bituminous)\b/i.test((r.name || '') + ' ' + (r.subCategory || '')),
    water: r => /\b(water|pipelines?|bore ?wells?|tanks?|sewer(?:age)?|drains?|drainage|canals?|irrigation|lakes?)\b/i.test((r.name || '') + ' ' + (r.subCategory || '')),
    electrical: r => /\b(electric(?:al)?|street ?lights?|transformers?|power|solar|lighting|wiring)\b/i.test((r.name || '') + ' ' + (r.subCategory || '')),
    goods: r => normCategory(r.category) === 'Goods', services: r => normCategory(r.category) === 'Services', works: r => normCategory(r.category) === 'Works',
    consultancy: r => normCategory(r.category) === 'Consultancy',
  };
  const matchesCat = (r, cats) => !cats || !cats.length || cats.some(c => CAT_TEST[c] && CAT_TEST[c](r));

  /* ---------- reading a copied table ---------- */
  // → { rows, skipped, reason }. Never throws: a clipboard holding something else gives no rows and a reason.
  function parsePasted(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' ').trimEnd()).filter(l => l.trim());
    const hi = lines.findIndex(isHeader);
    if (hi < 0) return { rows: [], skipped: 0, reason: lines.length ? 'no tender table (the heading row with "Tender Number" and "Tender Name" was not in what you copied)' : 'the clipboard is empty' };
    const fields = splitCells(lines[hi]).map(fieldOf);
    const rows = [], seen = new Set(); let skipped = 0;
    for (const line of lines.slice(hi + 1)) {
      if (isHeader(line) || NOISE.test(line.trim())) continue;
      const cells = splitCells(line);
      if (cells.length < 4) { skipped++; continue; }
      const r = {};
      fields.forEach((f, i) => { if (f && f !== 'actions' && f !== 'sno' && cells[i] !== undefined && cells[i] !== '') r[f] = cells[i]; });
      if (!r.no || !looksLikeNo(r.no) || !r.name) { skipped++; continue; }
      if (seen.has(r.no)) { skipped++; continue; }
      seen.add(r.no);
      const row = { no: r.no, name: r.name.replace(/\s+/g, ' ').slice(0, 300), location: r.location || '', entity: r.entity || '', type: r.type || '',
        category: normCategory(r.category), subCategory: r.subCategory || '', valueText: r.value || '', value: parseValue(r.value),
        publishedText: r.published || '', published: parseDate(r.published), closesText: r.closes || '', closes: parseDate(r.closes, { endOfDay: true }) };
      row.place = placeOf(row.location) || placeOf(row.entity) || placeOf(row.name);
      rows.push(row);
    }
    return { rows, skipped, reason: rows.length ? '' : 'the table had a heading but no tender rows' };
  }

  /* ---------- understanding a question ---------- */
  const NOT_TENDER = /\blegal tender\b|\btender[\s-]+(?:heart(?:ed)?|age|years?|coconuts?|loving|love|care|meat|chicken|steak|feelings?|moments?|touch|skin|spot|hearts?|gums?|lips?|voice)\b|\btenderness\b|\btenderly\b|\btenderi[sz]e/i;
  // "tenders" (plural) is the subject; a single "tender" only with words around it that make it a tender notice ("a tender for…", "tender number",
  // "e-tender") — "the meat is tender" is not one.
  const IS_TENDER = /\b(?:e-?)?tenders\b|\be-?tender\b|\b(?:a|any|the|new|this|that|building|road|works|kppp|govt|government)\s+tender\b|\btender\s+(?:notice|number|no|id|list|digest|document|details|alerts?|updates?|messages?|reminders?|notifications?|report|site|website|portal|search|deadline|for|in|at|closing)\b|\bnits?\b|\be-?procurement\b|\beproc\b|\bkppp\b/i;
  const STOP_PLACES = /^(?:this|next|the|today|tomorrow|karnataka|kppp|the portal|my list|clipboard|it|them|these|that|which|week|month)\b/;
  // → { op, cats, place, placeRaw, closing, isNew, minValue, time } or null when the sentence is not about tenders
  function parseQuery(text) {
    let t = String(text || '').toLowerCase().replace(/[“”"’']/g, "'").replace(/\s+/g, ' ').trim()
      .replace(/^(?:(?:hey|hi|ok|okay)\s+)?(?:jarvis|friday)[,\s]+/, '').replace(/^(?:please|can you|could you|would you|kindly)\s+/, '').replace(/[?.!]+$/, '');
    if (!IS_TENDER.test(t) || NOT_TENDER.test(t)) return null;
    const q = { op: 'list', cats: [], place: null, placeRaw: '', closing: null, isNew: false, minValue: null, time: null };
    if (/\b(?:open|show me|go to|launch|take me to)\b.*\b(?:kppp|(?:tenders?|e-?procurement)\s+(?:site|website|portal|page))\b|^(?:open\s+)?kppp$/.test(t)) q.op = 'open';
    else if (/\b(?:read|import|load|take|save|parse|use|check)\b.*\b(?:these|this|those|copied|clipboard|pasted)\b|\bi\s+(?:have\s+)?copied\b|\bfrom (?:the |my )?clipboard\b/.test(t)) q.op = 'import';
    else if (/\b(?:stop|cancel|turn off|disable|no more|remove|delete|don't send|do not send)\b/.test(t) && /\b(?:digest|daily|every ?day|alerts?|updates?|messages?|reminders?|notifications?)\b/.test(t)) q.op = 'digest-stop';
    else if (/\b(?:every ?day|daily|each day|every evening|every night)\b/.test(t) || (/\b(?:send|tell|remind|notify|message|alert)\b/.test(t) && /\bat\s+\d/.test(t))) {
      q.op = 'digest';
      const m = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
      if (m) { let h = +m[1]; const mi = +(m[2] || 0); if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; if (!m[3] && h < 8) h += 12; if (h < 24 && mi < 60) q.time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); }
      if (!q.time) q.time = '18:00';
    } else if (/\bhow many\b|\bcount\b|\bnumber of\b|\btotal\b/.test(t)) q.op = 'count';
    // what kind
    if (/\bbuildings?\b|\bconstruction\b|\bcivil\b|\bhostels?\b|\bschools?\b/.test(t)) q.cats.push('building');
    if (/\broads?\b|\bbridges?\b|\bhighways?\b/.test(t)) q.cats.push('road');
    if (/\bwater\b|\bpipelines?\b|\bdrainage\b|\birrigation\b/.test(t)) q.cats.push('water');
    if (/\belectric(?:al)?\b|\bstreet ?lights?\b|\bsolar\b/.test(t)) q.cats.push('electrical');
    if (/\bgoods\b|\bsupply of\b|\bsupplies\b/.test(t)) q.cats.push('goods');      // ("water supply" is water, not goods)
    if (/\bservices?\b/.test(t)) q.cats.push('services');
    if (/\bconsultancy\b/.test(t)) q.cats.push('consultancy');
    if (!q.cats.length && /\bworks\b/.test(t)) q.cats.push('works');
    // where
    const known = placeOf(t.replace(IS_TENDER, ' '));
    if (known) q.place = known;
    else {
      const m = t.match(/\b(?:in|at|near|for|from|around|of)\s+([a-z][a-z .-]{2,30}?)(?:\s+(?:district|city|taluk|taluka|division|region|area|zone))?(?=$|\s+(?:closing|which|that|above|over|worth|today|tomorrow|this|with|due|and|every|daily|at)\b|[,])/);
      if (m && !STOP_PLACES.test(m[1].trim()) && !/\b(?:tenders?|kppp|clipboard|water|supply|supplies|buildings?|roads?|electrical|goods|services|works|construction|civil)\b/.test(m[1])) q.placeRaw = m[1].trim();   // a kind of work is not a place
    }
    // when
    if (/\b(?:closing|ending|due|last date)\b[^.]*\btoday\b|\btoday'?s?\s+(?:closing|deadline)/.test(t) || /\bclos(?:e|es|ing) today\b/.test(t)) q.closing = 'today';
    else if (/\btomorrow\b/.test(t) && /\b(?:clos|end|due|deadline|last date)/.test(t)) q.closing = 'tomorrow';
    else if (/\bthis week\b|\bnext 7 days\b|\bwithin a week\b/.test(t) && /\b(?:clos|end|due|deadline|last date)/.test(t)) q.closing = 'week';
    if (/\b(?:new|latest|fresh|recent)\b/.test(t)) q.isNew = true;
    const v = t.match(/\b(?:above|over|more than|greater than|at least|worth more than|minimum)\s*(?:rs\.?|₹|inr)?\s*(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|k|thousand)?\b/);
    if (v) q.minValue = parseValue(v[1] + ' ' + (v[2] || ''));
    return q;
  }

  /* ---------- choosing and wording ---------- */
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  // end of this week = Sunday 23:59 (on a Sunday that is tonight)
  const endOfWeek = t => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(23, 59, 59, 999); return d.getTime(); };
  // → { rows (open ones that match, soonest deadline first), closed (how many matched but already closed) }
  function filter(rows, q = {}, { now = Date.now(), freshNos = null } = {}) {
    let out = (rows || []).filter(r => matchesCat(r, q.cats));
    if (q.place) { const al = aliasesOf(q.place); out = out.filter(r => r.place === q.place || al.some(a => (r.location + ' ' + r.entity).toLowerCase().includes(a))); }
    else if (q.placeRaw) out = out.filter(r => (r.location + ' ' + r.entity + ' ' + r.name).toLowerCase().includes(q.placeRaw));
    if (q.minValue) out = out.filter(r => r.value !== null && r.value >= q.minValue);
    if (q.isNew && freshNos) { const f = new Set(freshNos); out = out.filter(r => f.has(r.no)); }
    const closed = out.filter(r => r.closes !== null && r.closes < now).length;
    out = out.filter(r => r.closes === null || r.closes >= now);
    if (q.closing === 'today') out = out.filter(r => r.closes !== null && r.closes < startOfDay(now) + DAY);
    else if (q.closing === 'tomorrow') out = out.filter(r => r.closes !== null && r.closes >= startOfDay(now) + DAY && r.closes < startOfDay(now) + 2 * DAY);
    else if (q.closing === 'week') out = out.filter(r => r.closes !== null && r.closes <= endOfWeek(now));
    out.sort((a, b) => (a.closes === null) - (b.closes === null) || (a.closes || 0) - (b.closes || 0));
    return { rows: out, closed };
  }
  // the numbers in `rows` that `known` (number → first seen) has not had before
  const diffKnown = (rows, known) => (rows || []).filter(r => !(known && Object.prototype.hasOwnProperty.call(known, r.no))).map(r => r.no);

  function money(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '';
    if (n >= 1e7) return '₹' + (Math.round(n / 1e5) / 100) + ' Cr';
    if (n >= 1e5) return '₹' + (Math.round(n / 1e3) / 100) + ' lakh';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
  const pad = n => String(n).padStart(2, '0');
  const clock = t => { const d = new Date(t); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + pad(d.getMinutes()) + ' ' + ap; };
  const dayName = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  // a closing date given without a time was stored as 23:59:59: say just the day, not a made-up time
  const at = t => { const d = new Date(t); return d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59 ? '' : ' ' + clock(t); };
  // "closes today 5:30 pm", "closes tomorrow 3:00 pm", "closes 21 Oct, 3:00 pm (in 4 days)", "closed 19 Oct", "closing date not given"
  function relDeadline(closes, now = Date.now()) {
    if (closes === null || closes === undefined) return 'closing date not given';
    if (closes < now) return 'closed ' + dayName(closes);
    const d = Math.round((startOfDay(closes) - startOfDay(now)) / DAY);
    if (d === 0) return 'closes **today' + at(closes) + '**';
    if (d === 1) return 'closes **tomorrow' + at(closes) + '**';
    return 'closes ' + dayName(closes) + (at(closes) ? ',' + at(closes) : '') + ' (in ' + d + ' days)';
  }
  function formatLine(r, now = Date.now(), isFresh = false) {
    const bits = [r.place || r.location, money(r.value)].filter(Boolean);
    return '- ' + (isFresh ? '🆕 ' : '') + '**' + r.no + '** — ' + (r.name.length > 110 ? r.name.slice(0, 107) + '…' : r.name) + (bits.length ? ' · ' + bits.join(' · ') : '') + ' · ' + relDeadline(r.closes, now);
  }
  // "building tenders in Mysuru closing this week above ₹50 lakh"
  function describe(q = {}) {
    const what = (q.cats && q.cats.length ? q.cats.join(' and ') + ' ' : '') + 'tenders';
    return (q.isNew ? 'new ' : '') + what + (q.place ? ' in ' + q.place : q.placeRaw ? ' in ' + q.placeRaw.replace(/\b[a-z]/g, c => c.toUpperCase()) : '')
      + (q.closing === 'today' ? ' closing today' : q.closing === 'tomorrow' ? ' closing tomorrow' : q.closing === 'week' ? ' closing this week' : '') + (q.minValue ? ' above ' + money(q.minValue) : '');
  }

  return { KPPP_URL, fieldOf, parsePasted, parseValue, parseDate, placeOf, aliasesOf, normCategory, isBuilding, matchesCat, parseQuery, filter, diffKnown, money, relDeadline, formatLine, describe, endOfWeek };
})();
if (typeof module !== 'undefined') module.exports = TenderParse;
