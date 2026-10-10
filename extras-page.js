'use strict';
/* Chat side of the extra tools (AI health, service watchdog, nearby places, CSV analysis, project wiki, images, PDFs).
   Skills.intercept calls Extras.intercept(text) right after the skill packs: it answers only EXPLICIT wording ("/health",
   "analyze marks.csv", "list cafes near …"), so ordinary commands still go to the normal rules. The work itself is on the
   server (one module per tool); this file only recognises the request, calls the route and words the answer.
   Uses the page's globals (callTool, API, setState, llmReady, llm, settings…). */
const Extras = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'EXTRAS' }, extra || {});
  const plain = s => String(s || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  // GET routes (callTool only POSTs)
  const getJSON = async path => { try { return await fetch(API + path).then(r => r.json()); } catch (e) { return { error: 'I couldn’t reach my own server (' + e.message + ').' }; } };
  const need = (what, why) => say('The **' + what + '** needs **Online tools**, and it is off. ' + why, { actions: typeof enableOnlineAction === 'function' ? enableOnlineAction() : undefined });
  const onlineOn = () => typeof settings === 'undefined' || !!settings.online;

  /* ================= AI health ================= */
  const HEALTH = /^(?:\/health(?:\s+(?:deep|full|test))?|(?:please\s+)?(?:check|test)\s+(?:my\s+|the\s+)?(?:ai|brain|ollama|llm)(?:\s+(?:health|status|properly|fully|deeply))?|is\s+(?:my\s+|the\s+)?(?:ai|ollama|llm)\s+(?:working|ok(?:ay)?|up|running|alive)|(?:any\s+)?(?:ai|api|llm)\s+errors?(?:\s+(?:today|lately|recently))?|(?:ai|api|llm)\s+(?:health|status)(?:\s+report)?)\s*[?.!]*$/i;
  const HEALTH_CLEAR = /^(?:clear|reset)\s+(?:the\s+|my\s+)?ai\s+(?:call\s+|health\s+)?history[.!]?$/i;
  async function health(t) {
    const deep = /\b(deep|full|properly|fully|deeply)\b/i.test(t) || /^test\b/i.test(t);
    setState('PROCESSING', deep ? 'Asking the AI a test question…' : 'Checking the AI…');
    const model = typeof llm !== 'undefined' && llm.model ? '&model=' + encodeURIComponent(llm.model) : '';
    const r = await getJSON('/ai/health' + (deep ? '?deep=1' + model : ''));
    if (r.error || !r.text) return say('I couldn’t check: ' + (r.error || 'no answer') + '.');
    return say(r.text, { speak: plain(r.headline), suggestions: deep ? ['Run diagnostics'] : ['Check my AI properly', 'Run diagnostics'] });
  }

  /* ================= service watchdog ================= */
  // "watch" is also a normal word ("watch youtube"), so plain wording only counts when what follows is a real address or host:port.
  const ADDR = '(?:https?:\\/\\/\\S+|\\[::1\\]:\\d{1,5}|[\\w.-]+:\\d{1,5}|port\\s+\\d{1,5})';
  const WATCH_ADD = new RegExp('^(?:please\\s+)?(?:watch|monitor|keep (?:an eye on|watching))\\s+(?:the\\s+)?(?:server\\s+(?:on|at)\\s+)?(' + ADDR + ')(?:\\s+(?:as|called|named)\\s+(.{1,40}))?\\s*[.!]*$', 'i');
  const WATCH_SLASH = /^\/watch\s+(?!status\b)(.+?)\s*$/i;
  const WATCH_STATUS = /^(?:\/watch(?:\s+status)?|watchdog(?:\s+status)?|what(?:'s| is) down|what am i watching|what are you watching|(?:is|are)\s+(?:everything|anything)\s+(?:up|down)|list (?:my\s+)?(?:watched|watching)(?:\s+services)?)\s*[?.!]*$/i;
  const WATCH_REMOVE = /^(?:\/unwatch|stop (?:watching|monitoring)|unwatch)\s+(?:the\s+)?(.+?)\s*[.!]*$/i;
  const WATCH_SWITCH = /^(?:(start|enable|turn on)|(stop|disable|turn off))\s+(?:the\s+)?watchdog\s*[.!]*$/i;
  const clock = ms => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  function watchLines(r) {
    const lines = r.targets.map(x => {
      const mark = x.up === true ? '✓' : x.up === false ? '✗' : '•';
      const how = x.up === true ? 'up' + (x.uptime !== null && x.checks > 1 ? ', ' + x.uptime + '% of the last ' + x.checks + ' checks' : '') + ', ' + x.ms + ' ms'
        : x.up === false ? 'not answering since ' + clock(x.since) + (x.error ? ' (' + x.error + ')' : '') : 'not checked yet';
      return '- ' + mark + ' **' + x.label + '** — ' + how;
    });
    const every = r.intervalMs >= 60000 ? plural(Math.round(r.intervalMs / 60000), 'minute') : Math.round(r.intervalMs / 1000) + ' seconds';
    return lines.join('\n') + '\n\n' + (r.enabled ? 'Watchdog is **on**, checking every ' + every + '. I’ll tell you when something goes down or comes back.' : 'Watchdog is **off**, so nothing is checked on its own. Say **“watch localhost:5000”** to start.');
  }
  async function watchStatus() {
    setState('PROCESSING', 'Checking what I watch…');
    const r = await callTool('/watch/check', {});
    if (r.error) return say('I couldn’t check: ' + r.error);
    const down = r.targets.filter(x => x.up === false);
    return say(watchLines(r), { speak: down.length ? down.map(x => x.label).join(' and ').replace(/[:.]/g, ' ') + (down.length === 1 ? ' is' : ' are') + ' not answering.' : 'Everything I watch is up.', suggestions: down.length ? [] : ['Watch localhost:3000'] });
  }
  async function watchAdd(target, label) {
    const arg = /^port\s+(\d+)$/i.test(target) ? 'localhost:' + target.match(/(\d+)/)[1] : target;
    const r = await callTool('/watch/add', { target: arg, label: label || undefined });
    if (r.error) return say('I can’t watch that: ' + r.error);
    const w = r.watching;
    return say((r.existed ? 'I was already watching' : '✓ Now watching') + ' **' + w.label + '** — it is ' + (w.up ? '**up** (' + w.ms + ' ms)' : '**not answering** right now' + (w.error ? ' (' + w.error + ')' : '')) + '. I check every ' + plural(Math.round(r.intervalMs / 60000), 'minute') + ' and will tell you if that changes. Say **“stop watching ' + w.label + '”** to stop.',
      { speak: 'Now watching ' + w.label.replace(/[:.]/g, ' ') + '. It is ' + (w.up ? 'up.' : 'not answering.'), suggestions: ['What is down?'] });
  }

  /* ================= nearby places ================= */
  // Only "list / show … near …", "what's near …" and /nearby. "nearest X to Y" keeps opening Google Maps (the decider's job).
  const NEAR_LIST = /^(?:please\s+)?(?:list|show(?:\s+me)?)\s+(?:the\s+)?(?:(?:nearest|nearby|closest|best|good)\s+)?(.+?)\s+(?:near(?:by|est)?(?:\s+to)?|around|close to|next to)\s+(.+?)\s*[.!?]*$/i;
  const NEAR_LIST_HERE = /^(?:please\s+)?(?:list|show(?:\s+me)?)\s+(?:the\s+)?(?:nearest|nearby|closest)\s+(.+?)\s*[.!?]*$/i;
  const NEAR_WHATS = /^what(?:'s| is| are)?\s+(?:the\s+)?(?:(?:places|things|shops|stuff)\s+)?(?:near|nearby|around|close to)\s+(.+?)\s*[.!?]*$/i;
  const NEAR_WHATS_HERE = /^what(?:'s| is)\s+(?:near|nearby|around)(?:\s+(?:me|here))?\s*[?.!]*$/i;
  const NEAR_SLASH = /^\/nearby(?:\s+(.+?))?\s*$/i;
  // Only words that really mean "where I am"; "my college" is a name to look up on the map, not something JARVIS knows.
  const HERE = /^(?:me|here|my (?:current )?(?:location|area)|this (?:place|area)|where i am)$/i;
  const KM = /\s*\b(?:within|in a radius of|inside)\s+(\d+(?:\.\d+)?)\s*(km|kms|kilometers?|kilometres?|m|meters?|metres?)\b\.?\s*$/i;
  const NEARBY_KINDS = 'restaurants, cafés, bars, bakeries, hotels, hostels, hospitals, clinics, pharmacies, dentists, ATMs, banks, petrol stations, EV chargers, supermarkets, malls, markets, electronics and stationery shops, laundries, salons, cinemas, parks, gyms, bus stops, stations, airports, police stations, post offices, temples, churches, mosques, schools, colleges and libraries';
  const isPlaceKind = c => typeof Places !== 'undefined' && Places.REGEX.test(c);
  const metres = m => (m < 1000 ? m + ' m' : (Math.round(m / 100) / 10) + ' km');
  function nearLine(x, i) {
    const bits = [metres(x.meters), x.address, x.cuisine, x.hours && '🕒 ' + x.hours, x.phone && '☎ ' + x.phone, '[map](' + x.mapsUrl + ')'].filter(Boolean);
    return (i + 1) + '. **' + x.name + '** — ' + bits.join(' · ');
  }
  // soft: the wording could also be an ordinary question ("what is near field communication"). Then, if the map can't make sense
  // of it (offline, place not found, nothing known), give it back to normal handling (null) instead of answering with a map error.
  async function nearby(catText, placeText, soft) {
    if (!onlineOn()) return soft ? null : need('nearby search', 'It asks OpenStreetMap what is around a place.');
    let place = String(placeText || '').trim(), radius;
    const km = place.match(KM);
    if (km) { radius = Math.round(+km[1] * (/^k/i.test(km[2]) ? 1000 : 1)); place = place.slice(0, km.index).trim(); }
    const city = (typeof settings !== 'undefined' && settings.city) || '';
    const here = !place || HERE.test(place);
    if (here && !city) return say('I don’t know where you are, and no city is set. Tell me a place — e.g. **“list cafés near Majestic”** — or set your city in Settings.');
    const overview = !catText;
    setState('PROCESSING', 'Looking at the map…');
    const r = await callTool('/tool/nearby', { online: true, category: overview ? 'any' : catText, place: here ? city : place, city: here ? '' : city, radius });
    if (r.error) return soft ? null : say(/^offline$/.test(r.error) ? 'Online tools is off.' : r.error);
    const where =here ? 'your city (' + city + ')' : place;
    const head = '**' + (overview ? 'Around ' + where : cap(r.category.label) + ' near ' + where) + '** — within ' + metres(r.radius) + (overview ? '' : ', nearest first');
    const note = here ? '\n\n*I can’t see your location, so I used the middle of ' + city + '. Say “near <place>” for somewhere specific.*' : '';
    const credit = '\n\n*From OpenStreetMap. Hours and phone numbers are entered by volunteers and may be out of date.*';
    if (!r.results.length) return say(head + '\n\nI found nothing in the map data' + (r.radius < 5000 ? ' — try a wider search: **“list ' + (overview ? 'cafés' : r.category.label) + ' near ' + (here ? 'majestic' : place) + ' within ' + (r.radius < 3000 ? '3' : '5') + ' km”**' : '') + '. OpenStreetMap coverage varies from area to area.' + note + credit, { speak: 'I found nothing there.' });
    let body;
    if (overview) {
      const groups = {};
      for (const x of r.results) (groups[x.key] = groups[x.key] || []).push(x);
      body = Object.entries(groups).map(([k, xs]) => '**' + cap((r.labels && r.labels[k]) || k) + '**\n' + xs.map(nearLine).join('\n')).join('\n\n');
    } else body = r.results.map(nearLine).join('\n') + (r.total > r.results.length ? '\n\n*' + (r.total - r.results.length) + ' more in this area.*' : '');
    const first = r.results[0];
    return say(head + '\n\n' + body + note + credit, {
      speak: overview ? 'Here is what is around ' + where + '.' : 'I found ' + r.total + ' ' + r.category.label + ' near ' + where + '. The nearest is ' + first.name + ', ' + metres(first.meters).replace(' m', ' metres').replace(' km', ' kilometres') + ' away.',
      actions: [{ label: 'OPEN ' + first.name.toUpperCase().slice(0, 24) + ' ON THE MAP', fn: () => callTool('/tool/openUrl', { url: first.mapsUrl }) }],
      suggestions: overview ? [] : ['Directions to ' + first.name] });
  }
  // The "LIST THEM HERE" button on the Google Maps reply: same lookup, answer shown in the chat.
  async function listNearby(category, place) { const r = await nearby(category, place === 'your current location' ? '' : place); jarvisSay(r); }
  function matchNearby(t) {
    let m;
    if ((m = t.match(NEAR_SLASH))) {
      const arg = (m[1] || '').trim();
      if (!arg) return { help: true };
      const n = arg.match(/^(.+?)\s+(?:near(?:by|est)?(?:\s+to)?|around|close to|next to)\s+(.+)$/i);
      return n ? { cat: n[1].replace(/^(?:the\s+)?(?:nearest|nearby|closest)\s+/i, ''), place: n[2] } : { cat: arg, place: '' };
    }
    if ((m = t.match(NEAR_LIST)) && isPlaceKind(m[1])) return { cat: m[1], place: m[2] };
    if ((m = t.match(NEAR_LIST_HERE)) && isPlaceKind(m[1]) && !/\b(?:near|around|close to|next to)\b/i.test(m[1])) return { cat: m[1].replace(KM, ''), place: (m[1].match(KM) || [''])[0] };
    if (NEAR_WHATS_HERE.test(t)) return { cat: '', place: '' };
    if ((m = t.match(NEAR_WHATS))) return { cat: '', place: m[1], soft: !/^what(?:'s|s)\b|\b(?:places|things|shops|stuff)\b|\b(?:nearby|around)\b/i.test(t) };
    return null;
  }

  /* ================= CSV analysis ================= */
  // The file name is lifted out of the sentence first (quoted or not, spaces allowed when quoted) and replaced by @FILE.
  function pullFile(t) {
    const m = t.match(/["“'‘]([^"”'’]+\.(?:csv|tsv))["”'’]/i) || t.match(/(?:^|\s)((?:[a-z]:)?[\w.()\\/~-]+\.(?:csv|tsv))(?=[\s.,!?]|$)/i);
    if (!m) return null;
    return { file: m[1].trim(), text: t.replace(m[0], (/^\s/.test(m[0]) ? ' ' : '') + '@FILE').replace(/\s+/g, ' ').trim() };
  }
  const CSV_ANALYZE = /^(?:please\s+)?(?:(?:analy[sz]e|summari[sz]e|profile|describe|explore|inspect|look at)\s+(?:(?:the|my)\s+)?(?:(?:data|file|csv|spreadsheet)\s+(?:in|from|of)?\s*)?|what(?:'s| is) in\s+)@FILE\s*[.!?]*$/i;
  const CSV_COUNT = /^how many (?:rows|records|entries|lines)\s+(?:are\s+|does\s+|is\s+)?(?:there\s+)?(?:in\s+)?@FILE(?:\s+have)?(?:\s+where\s+(.+?))?\s*[.!?]*$/i;
  const CSV_STAT = /^(?:(?:what(?:'s| is)|show(?: me)?|give me|find|calculate|get)\s+)?(?:the\s+)?(average|mean|median|sum|total|max(?:imum)?|min(?:imum)?|highest|lowest|count(?: of)?|number of|unique|distinct)\s+(?:of\s+|values\s+of\s+)?(.+?)(?:\s+by\s+(.+?))?\s+(?:in|from|of)\s+@FILE(?:\s+(?:where|when)\s+(.+?))?\s*[.!?]*$/i;
  const CSV_ROWS_A = /^(?:show|list|find|get|filter)(?:\s+me)?\s+(?:the\s+)?(?:(?:rows|records|entries|students|people)\s+)?(?:(?:in|from)\s+)?@FILE\s+where\s+(.+?)\s*[.!?]*$/i;
  const CSV_ROWS_B = /^(?:show|list|find|get)(?:\s+me)?\s+(?:the\s+)?(?:rows|records|entries|students|people)\s+where\s+(.+?)\s+(?:in|from)\s+@FILE\s*[.!?]*$/i;
  const CSV_CHART = /^(?:(?:make|draw|plot|show|create|give)(?:\s+me)?\s+)?(?:an?\s+|the\s+)?(?:bar\s+chart|bar\s+graph|chart|histogram|graph|plot|distribution)\s+(?:of\s+)?(.+?)(?:\s+by\s+(.+?))?\s+(?:in|from|of|for)\s+@FILE(?:\s+(?:where|when)\s+(.+?))?\s*[.!?]*$/i;
  const AGG_WORD = { average: 'mean', mean: 'mean', median: 'median', sum: 'sum', total: 'sum', max: 'max', maximum: 'max', highest: 'max', min: 'min', minimum: 'min', lowest: 'min', count: 'count', 'count of': 'count', 'number of': 'count', unique: 'unique', distinct: 'unique' };
  const AGG_NAME = { mean: 'Average', median: 'Median', sum: 'Total', max: 'Highest', min: 'Lowest', count: 'Count', unique: 'Distinct values' };
  const ROWNOUN = /^(?:rows|records|entries|lines|students|people|items)$/i;
  const num = x => (typeof x === 'number' ? (Math.abs(x) >= 1000 ? x.toLocaleString('en-US') : String(Math.round(x * 100) / 100)) : String(x));
  function matchCsv(t0) {
    let m;
    const s = t0.match(/^\/csv(?:\s+([\s\S]*))?$/i);
    const body = s ? (s[1] || '').trim() : t0;
    if (s && !body) return { help: true };
    const pf = pullFile(body);
    if (!pf) return s ? { help: true } : null;
    const t = pf.text, file = pf.file;
    if (s && t === '@FILE') return { op: 'analyze', file };
    if (CSV_ANALYZE.test(t)) return { op: 'analyze', file };
    if ((m = t.match(CSV_COUNT))) return { op: 'count', file, filter: m[1] };
    if ((m = t.match(CSV_CHART))) {
      const am = m[1].match(/^(average|mean|median|sum|total|max(?:imum)?|min(?:imum)?|count)\s+(?:of\s+)?(.+)$/i);
      return { op: 'chart', file, column: am ? am[2] : m[1], by: m[2], agg: am ? AGG_WORD[am[1].toLowerCase()] : undefined, filter: m[3] };
    }
    if ((m = t.match(CSV_STAT))) {
      const agg = AGG_WORD[m[1].toLowerCase()];
      if (agg === 'count' && ROWNOUN.test(m[2].trim()) && !m[3]) return { op: 'count', file, filter: m[4] };
      return { op: 'stat', file, agg, column: m[2].trim(), by: m[3] && m[3].trim(), filter: m[4] };
    }
    if ((m = t.match(CSV_ROWS_A)) || (m = t.match(CSV_ROWS_B))) return { op: 'rows', file, filter: m[1] };
    return s ? { help: true } : null;
  }
  const csvHelp = () => say('**CSV analysis** — put a `.csv` file in ~/jarvis or a project folder (or give its full path), then try:\n- “analyze **marks.csv**”\n- “average of marks by dept in marks.csv”\n- “show rows in marks.csv where marks > 60 and dept = CSE”\n- “how many rows are in marks.csv”\n- “chart attendance in marks.csv”, “bar chart of marks by dept in marks.csv”\n\nI do the sums myself, so the numbers are exact. Only the statistics (never your rows) go to the AI when I explain what stands out.');
  const cell = v => { const s = String(v).replace(/\s+/g, ' ').trim(); return s.length > 28 ? s.slice(0, 27) + '…' : s; };
  function colLine(p) {
    let d;
    if (p.type === 'number') d = p.min + ' to ' + p.max + ' · mean ' + p.mean + ' · median ' + p.median + (p.outliers ? ' · ' + p.outliers + ' unusual' : '');
    else if (p.type === 'date') d = p.min + ' → ' + p.max;
    else d = p.categorical ? p.top.map(t => cell(t.value) + ' (' + t.count + ')').join(', ') : p.unique + ' different values';
    return '- **' + p.name + '** (' + p.type + ') — ' + p.count + ' filled' + (p.missing ? ', ' + p.missing + ' empty' : '') + (d ? ' · ' + d : '');
  }
  async function csvAnalyze(file) {
    setState('PROCESSING', 'Reading ' + file + '…');
    const r = await callTool('/csv/analyze', { name: file });
    if (r.error) return say(r.error);
    const lines = ['**' + r.name + '** — ' + plural(r.rows, 'row') + ' × ' + plural(r.cols, 'column') + (r.delimiter !== ',' ? ' (' + ({ ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[r.delimiter] || 'custom') + '-separated)' : ''), '', ...r.columns.slice(0, 30).map(colLine)];
    if (r.columns.length > 30) lines.push('- …and ' + (r.columns.length - 30) + ' more columns');
    if (r.correlations.length) lines.push('', '**Move together:** ' + r.correlations.map(c => c.a + ' & ' + c.b + ' (r = ' + c.r + ', ' + c.strength + ')').join(' · '));
    if (r.notes.length) lines.push('', '**Worth checking:** ' + r.notes.join(' '));
    let out = lines.join('\n');
    if (typeof llmReady === 'function' && llmReady()) {                      // the AI gets the digest of statistics only, never a row
      const ai = await callTool('/skill/run', { skill: 'csv-insights', input: r.digest, model: llm.model });
      if (ai && ai.text) out += '\n\n**What stands out**\n' + ai.text + (typeof isCloudModel === 'function' && isCloudModel(llm.model) ? '\n\n⚠ The column names and statistics above (not your rows) were sent to ' + modelInfo(llm.model).providerLabel + ' to write this.' : '');
    }
    const firstNum = r.columns.find(c => c.type === 'number'), firstCat = r.columns.find(c => c.categorical);
    return say(out, { speak: r.name + ' has ' + plural(r.rows, 'row') + ' and ' + plural(r.cols, 'column') + '.',
      suggestions: [firstNum && 'Chart ' + firstNum.name + ' in ' + r.name, firstNum && firstCat && 'Average ' + firstNum.name + ' by ' + firstCat.name + ' in ' + r.name].filter(Boolean) });
  }
  async function csvQuery(o) {
    const wh = o.filter ? ' where ' + o.filter : '';
    const r = await callTool('/csv/query', { name: o.file, filter: o.filter, groupBy: o.by, agg: o.agg, column: o.column, limit: o.op === 'rows' ? 15 : 1 });
    if (r.error) return say(r.error);
    const sub = o.filter ? ' (' + r.matched + ' of ' + r.total + ' rows match “' + o.filter + '”)' : '';
    if (r.kind === 'stat') return say('**' + AGG_NAME[r.agg] + ' of ' + r.column + '** in ' + r.file + (o.filter ? wh : '') + ': **' + (r.value === null ? 'no value (nothing to calculate)' : num(r.value)) + '**' + (r.used !== r.matched ? ' — from ' + r.used + ' filled values' : '') + sub + '.', { speak: r.value === null ? 'There is nothing to calculate.' : 'The ' + AGG_NAME[r.agg].toLowerCase() + ' of ' + r.column + ' is ' + num(r.value) + '.' });
    if (r.kind === 'groups') {
      const head = (r.agg === 'count' ? 'Rows' : AGG_NAME[r.agg] + ' of ' + r.column) + ' by ' + r.groupBy;
      return say('**' + head + '** in ' + r.file + sub + '\n' + r.groups.map(g => '- **' + cell(g.group) + '** — ' + num(g.value) + (r.agg !== 'count' ? ' (' + plural(g.n, 'row') + ')' : '')).join('\n') + (r.groupCount > r.groups.length ? '\n\n*' + (r.groupCount - r.groups.length) + ' more groups not shown.*' : ''),
        { speak: r.groups.length ? 'The top one is ' + r.groups[0].group + ' with ' + num(r.groups[0].value) + '.' : 'No rows match.', suggestions: ['Chart ' + (r.column || r.groupBy) + ' by ' + r.groupBy + ' in ' + r.file] });
    }
    if (o.op === 'count') return say('**' + num(r.matched) + '** row' + (r.matched === 1 ? '' : 's') + (o.filter ? ' match “' + o.filter + '” (of ' + num(r.total) + ')' : ' in ' + r.file) + '.', { speak: r.matched + ' rows.' });
    if (!r.matched) return say('No rows in ' + r.file + ' match “' + o.filter + '” (0 of ' + r.total + ').');
    return say('**' + r.matched + ' of ' + r.total + ' rows** in ' + r.file + ' match “' + o.filter + '”\n' + r.rows.map(row => '- ' + r.columns.map((c, i) => c + ': ' + cell(row[i])).filter((x, i) => String(row[i]).trim() !== '').slice(0, 8).join(' · ')).join('\n') + (r.more ? '\n\n*' + r.more + ' more not shown.*' : ''), { speak: r.matched + ' rows match.' });
  }
  async function csvChart(o) {
    setState('PROCESSING', 'Drawing the chart…');
    const r = await callTool('/csv/chart', { name: o.file, column: o.column.trim(), groupBy: o.by && o.by.trim(), agg: o.agg, filter: o.filter });
    if (r.error) return say(r.error);
    return say('✓ **' + r.title + '** — saved as `' + r.file + '` and opened.', { speak: 'The chart is open.', actions: [{ label: 'OPEN AGAIN', fn: () => callTool('/tool/openFile', { name: r.path }) }] });
  }
  async function csv(t) {
    const m = matchCsv(t);
    if (!m) return null;
    if (m.help) return csvHelp();
    if (m.op === 'analyze') return csvAnalyze(m.file);
    if (m.op === 'chart') return csvChart(m);
    return csvQuery(m);
  }

  /* ================= project wiki ================= */
  // "document" is a common word, so plain wording needs a project-ish noun ("document my shop project"); "wiki / documentation for X" is explicit.
  const WIKI_FOR = /^(?:please\s+)?(?:(?:generate|create|make|write|build)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:wiki|documentation|docs|code wiki|project wiki|project documentation)\s+(?:for|of|about)\s+(.+?))\s*[.!?]*$/i;
  const WIKI_DOC = /^(?:please\s+)?document\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(project|folder|repo|repository|codebase|code base|app|application)(\s+(?:and\s+)?(?:save|put|write)\s+(?:it\s+)?(?:in|into|inside|to)\s+(?:the|its|my)\s+(?:project|repo|repository|folder)(?:\s+(?:folder|directory))?)?\s*[.!?]*$/i;
  const WIKI_SLASH = /^\/wiki(?:\s+(.+?))?\s*$/i;
  const INTO_PROJECT = /\s+(?:and\s+)?(?:save|put|write)\s+(?:it\s+)?(?:in|into|inside|to)\s+(?:the|its|my)\s+(?:project|repo|repository|folder)(?:\s+(?:folder|directory))?$/i;
  const wikiName = s => String(s).replace(INTO_PROJECT, '').replace(/^(?:the|my|our)\s+/i, '').replace(/\s+(?:project|folder|repo|repository|codebase|code base|app|application)$/i, '').replace(/^["']|["']$/g, '').trim();
  function matchWiki(t) {
    let m;
    if ((m = t.match(WIKI_SLASH))) return m[1] ? { name: wikiName(m[1]), into: INTO_PROJECT.test(m[1]) } : { help: true };
    if ((m = t.match(WIKI_FOR))) return { name: wikiName(m[1]), into: INTO_PROJECT.test(m[1]) };
    if ((m = t.match(WIKI_DOC))) return { name: wikiName(m[1]), into: !!m[3] };
    return null;
  }
  const wikiHelp = () => say('**Project wiki** — say **“document my calculator project”**, **“generate a wiki for dsa_sprint”** or `/wiki <folder>`. I read the code in that folder (up to 400 files; I skip node_modules, build folders and the like) and write:\n- an overview with languages, entry points and a module list,\n- an architecture page with a diagram of which module imports which,\n- one page per module with its classes, functions and connections,\n- a class diagram, if the code has classes.\n\nEverything named in it is read from the code. If the AI is on it adds one short sentence per module, marked **AI summary**. It goes to `~/jarvis/Wikis/<project>`; add “and save it in the project folder” to put it in `docs/wiki` there (I’ll ask first).');
  async function wiki(name, into) {
    if (!name) return wikiHelp();
    const useAi = typeof llmReady === 'function' && llmReady();
    setState('PROCESSING', 'Reading the project…');
    jarvisSay({ text: '⏳ Reading **' + name + '** and writing its wiki' + (useAi ? ' — about a minute while the AI adds a sentence per module…' : '…'), intent: 'WIKI', noTTS: true, noPersona: true });
    const r = await callTool('/project/wiki', { name, into: into ? 'project' : undefined, ai: useAi, model: typeof llm !== 'undefined' ? llm.model : undefined });
    if (r.error) return say(r.error);
    const langs = Object.entries(r.languages).sort((a, b) => b[1].lines - a[1].lines).slice(0, 4).map(([l, v]) => l + ' ' + v.files).join(', ');
    const where = r.relDir && !/^[a-z]:/i.test(r.relDir) ? r.relDir : r.dir;
    return say('✓ Wrote the wiki for **' + r.name + '** → `' + where + '` (' + plural(r.files.length, 'page') + ').\n- ' + plural(r.modules, 'module') + ' from ' + plural(r.sourceFiles, 'source file') + ' (' + langs + ')\n- Start with `README.md`; `architecture.md` has the diagram of which module imports which.\n- ' + (r.aiSummaries ? 'The AI wrote ' + (r.aiSummaries === 1 ? 'one one-line summary' : r.aiSummaries + ' one-line summaries') + ', each marked “AI summary”.' : 'No AI summaries (the AI is off or had nothing to say), so descriptions come from the code’s own comments.') + (r.truncated ? '\n- The folder is bigger than I read, so the wiki covers the first part of it.' : ''),
      { speak: 'The wiki for ' + r.name + ' is ready. It has ' + plural(r.modules, 'module') + '.', suggestions: ['Document another project'], actions: [{ label: 'OPEN THE WIKI FOLDER', fn: () => callTool('/tool/openFolder', { name: r.dir }) }, { label: 'OPEN README', fn: () => callTool('/tool/openFile', { name: r.dir + '\\README.md' }) }] });
  }

  /* ================= images ================= */
  // Needs an image noun ("generate an image of …"); a bare "draw a graph" or "make a picture frame" is not taken.
  const IMG_NOUN = '(?:images?|pictures?|photos?|illustrations?|drawings?|paintings?|artworks?|pics?|variations?)';
  const IMG_MAKE = new RegExp('^(?:please\\s+)?(?:generate|create|make|draw|paint|render|imagine)\\s+(?:me\\s+)?(?:(\\d|one|two|three|four)\\s+|an?\\s+)?(?:different\\s+)?' + IMG_NOUN + '\\s+(?:of|showing|with|about)\\s+(.+?)\\s*[.!?]*$', 'i');
  const IMG_DRAW_ME = /^(?:please\s+)?(?:draw|paint|sketch)\s+me\s+(?:an?\s+|the\s+)?(.{3,}?)\s*[.!?]*$/i;
  const IMG_SLASH = /^\/image(?:\s+(.+?))?\s*$/i;
  const STYLE_WORDS = 'anime|photo(?:realistic)?|watercolou?r|pixel(?:\\s+art)?|sketch|3d(?:\\s+render)?|logo|cartoon|oil(?:\\s+painting)?';
  const STYLE_RE = new RegExp('\\b(?:in\\s+(?:an?\\s+)?(' + STYLE_WORDS + ')(?:\\s+style)?|(' + STYLE_WORDS + ')\\s+style)\\b', 'i');
  const SHAPE_RE = /\b(?:in\s+(portrait|landscape|square)(?:\s+(?:format|orientation|shape|mode))?|(portrait|landscape|square)\s+(?:format|orientation|shape))\b/i;
  const NUMS = { one: 1, two: 2, three: 3, four: 4 };
  const STYLE_KEY = w => { const s = w.toLowerCase().replace(/\s+/g, ' '); return /^photo/.test(s) ? 'photo' : /^pixel/.test(s) ? 'pixel' : /^oil/.test(s) ? 'oil' : /^3d/.test(s) ? '3d' : /^water/.test(s) ? 'watercolor' : s; };
  function matchImage(t) {
    let m, n = 1, rest;
    if ((m = t.match(IMG_SLASH))) { if (!m[1]) return { help: true }; rest = m[1]; }
    else if ((m = t.match(IMG_MAKE))) { if (m[1]) n = NUMS[m[1].toLowerCase()] || +m[1] || 1; rest = m[2]; }
    else if ((m = t.match(IMG_DRAW_ME))) rest = m[1];
    else return null;
    const nm = rest.match(/^(\d|two|three|four)\s+(?:different\s+)?(?:images?|pictures?|variations?|versions?)\s+(?:of\s+)?/i);
    if (nm) { n = NUMS[nm[1].toLowerCase()] || +nm[1] || 1; rest = rest.slice(nm[0].length); }
    let style, shape;
    const sm = rest.match(STYLE_RE); if (sm) { style = STYLE_KEY(sm[1] || sm[2]); rest = rest.replace(sm[0], ' '); }
    const hm = rest.match(SHAPE_RE); if (hm) { shape = (hm[1] || hm[2]).toLowerCase(); rest = rest.replace(hm[0], ' '); }
    rest = rest.replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
    return { prompt: rest, n: Math.max(1, Math.min(4, n)), style, shape };
  }
  const imageHelp = () => say('**Pictures** — say **“generate an image of a cat astronaut on the moon”**, **“draw me a castle in watercolor style”**, **“make 3 pictures of a red fox in portrait”** or `/image <description>`.\n\n- Shapes: square, portrait, landscape. Styles: anime, photo, watercolor, pixel art, sketch, 3d render, logo, cartoon, oil painting.\n- Up to 4 at a time. If the AI is on, I first turn your idea into a more detailed prompt and show it to you.\n- They are made by an online service (Pollinations), which may need a free key: **Settings → IMAGE SERVICE**. If you run Stable Diffusion (Automatic1111) on this PC I use that instead and nothing leaves the laptop.\n- Each picture is saved in `~/jarvis/Images` with a small `.json` note beside it (prompt, seed, size).');
  // A yes/no card that waits for the answer (the turn is released while it waits, as the planner does).
  async function confirmCard(text, yes) {
    if (typeof busy !== 'undefined') { busy = false; if (typeof idleState === 'function') idleState(); }
    const ok = await new Promise(resolve => jarvisSay({ text, intent: 'IMAGE', noPersona: true, confirm: { yes, no: 'NO', onConfirm: () => resolve(true), onCancel: () => resolve(false) } }));
    if (typeof busy !== 'undefined') { if (busy) await new Promise(r => { const iv = setInterval(() => { if (!busy) { clearInterval(iv); r(); } }, 50); }); busy = true; }
    return ok;
  }
  const IMG_OK_KEY = 'jarvis.imageServiceOk';
  const cleanExpanded = s => String(s || '').replace(/^["'“”\s]+|["'“”\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 380);
  async function image(o) {
    if (!o.prompt) return imageHelp();
    const st = await getJSON('/image/status');
    const local = !!(st && st.local);
    if (!local && !onlineOn()) return need('image service', 'Your description is sent to an online image service (Pollinations).');
    if (!local) {                                                       // the first time: say plainly what leaves the laptop
      let known = false; try { known = typeof store !== 'undefined' && store.get(IMG_OK_KEY, false); } catch {}
      if (!known) {
        const go = await confirmCard('To make pictures I send your description to **Pollinations** (pollinations.ai), an online image service. Only the description leaves your laptop' + ((st && st.hasKey) ? ', together with the key you saved' : '') + '. Go ahead?', 'YES, SEND IT');
        if (!go) return say('Okay, I won’t send anything. If you run Stable Diffusion (Automatic1111) on this PC, I can use that without sending anything out.');
        try { if (typeof store !== 'undefined') store.set(IMG_OK_KEY, true); } catch {}
      }
    }
    let expanded = '';
    if (typeof llmReady === 'function' && llmReady()) {
      setState('PROCESSING', 'Adding detail to your idea…');
      const e = await callTool('/skill/run', { skill: 'image-prompt', input: o.prompt, model: typeof llm !== 'undefined' ? llm.model : undefined });
      if (e && e.text) expanded = cleanExpanded(e.text);
    }
    setState('PROCESSING', 'Drawing…');
    jarvisSay({ text: '⏳ Drawing ' + (o.n > 1 ? o.n + ' pictures' : 'your picture') + (local ? ' on your PC' : ' with Pollinations') + ' — usually 10–60 seconds each.' + (expanded ? '\n\n*Prompt I’m using:* ' + expanded : ''), intent: 'IMAGE', noTTS: true, noPersona: true });
    const r = await callTool('/image/generate', { online: true, prompt: o.prompt, expanded: expanded || undefined, shape: o.shape, style: o.style, n: o.n });
    if (r.error) {
      if (r.needsKey) return say(r.error + '\n\nAfter saving the key, say it again.', { speak: 'The image service needs a key.' });
      return say(/^offline$/.test(r.error) ? 'Online tools is off.' : r.error);
    }
    const lines = r.images.map((i, k) => (k + 1) + '. `' + i.file + '` — ' + Math.round(i.bytes / 1024) + ' KB, seed ' + i.seed);
    const again = () => handleUser(o.text || ('generate an image of ' + o.prompt), 'chip');
    return say('✓ Made ' + (r.images.length === 1 ? 'your picture' : r.images.length + ' pictures') + ' with ' + r.serviceLabel + ' (' + r.width + '×' + r.height + ')' + (o.style ? ', ' + o.style + ' style' : '') + ' and opened ' + (r.images.length === 1 ? 'it' : 'the first') + '.\n' + lines.join('\n') + (expanded ? '\n\n*Prompt sent:* ' + r.sentPrompt : '') + '\n\nEach has a `.json` note beside it with the prompt, seed and size.' + (r.partial ? '\n\n⚠ I stopped early: ' + r.errors[0].error : ''),
      { speak: r.images.length === 1 ? 'Your picture is ready.' : 'I made ' + r.images.length + ' pictures.', suggestions: [], actions: [{ label: 'OPEN FOLDER', fn: () => callTool('/tool/openFolder', { name: r.folder }) }, { label: 'MAKE ANOTHER', fn: again }] });
  }

  /* ================= PDFs ================= */
  // PDF names are lifted out of the sentence first (quoted names may have spaces) and replaced by @PDF, like the CSV handler.
  const PDF_RE = /"([^"]+\.pdf)"|'([^']+\.pdf)'|([^\s"',;]+\.pdf)/gi;
  function pullPdfs(t) {
    const names = [];
    const rest = t.replace(PDF_RE, (m, a, b, c) => { names.push(a || b || c); return ' @PDF '; }).replace(/\s+/g, ' ').trim();
    return { names, rest };
  }
  const PAGES = '(\\d[\\d,\\s\\-]*(?:\\s+and\\s+\\d[\\d,\\s\\-]*)*|(?:first|last)\\s+\\d+|first|last|odd|even|all)';
  const BESIDE = /\s+(?:and\s+)?(?:save|put|keep)\s+(?:it|them|the new one)?\s*(?:next to|beside|in the same folder as)\s+(?:the\s+)?(?:original|originals|it|them)\s*$/i;
  const PDF_SPLIT_A = new RegExp('^(?:please\\s+)?(?:split|extract|take|get|pull out|cut out|keep)\\s+(?:only\\s+)?pages?\\s+' + PAGES + '\\s+(?:from|of|out of|in)\\s+@PDF\\s*[.!?]*$', 'i');
  const PDF_SPLIT_B = new RegExp('^(?:please\\s+)?(?:split|extract)\\s+@PDF\\s+(?:at\\s+|into\\s+|by\\s+|to\\s+)?pages?\\s+' + PAGES + '\\s*[.!?]*$', 'i');
  const PDF_SPLIT_C = /^(?:please\s+)?(?:keep|take|extract|get)\s+(?:only\s+)?(?:the\s+)?((?:first|last)\s+\d+)\s+pages?\s+(?:of|from)\s+@PDF\s*[.!?]*$/i;
  const DEG = '(\\d+|left|right|clockwise|counter-?clockwise|anti-?clockwise)';
  const PDF_ROT_A = new RegExp('^(?:please\\s+)?(?:rotate|turn)\\s+@PDF\\s+(?:by\\s+)?' + DEG + '(?:\\s+degrees?)?(?:\\s+(?:on\\s+|for\\s+)?pages?\\s+' + PAGES + ')?\\s*[.!?]*$', 'i');
  const PDF_ROT_B = new RegExp('^(?:please\\s+)?(?:rotate|turn)\\s+pages?\\s+' + PAGES + '\\s+(?:of|in)\\s+@PDF\\s+(?:by\\s+)?' + DEG + '(?:\\s+degrees?)?\\s*[.!?]*$', 'i');
  const PDF_MARK = /^(?:please\s+)?watermark\s+@PDF\s+(?:with|as|saying|using)?\s*["“']?(.{1,40}?)["”']?\s*[.!?]*$/i;
  const PDF_MAKE = /^(?:please\s+)?(?:make|create|save|turn|convert|export|write|put)\s+(?:that|this|it|the (?:last )?(?:answer|reply|response))\s+(?:(?:into|as|to|in)\s+)?(?:a\s+)?pdf(?:\s+(?:called|named|titled)\s+(.{1,60}?))?\s*[.!?]*$|^(?:please\s+)?(?:make|create)\s+(?:a\s+)?pdf\s+(?:of|from)\s+(?:that|this|the (?:last )?(?:answer|reply|response))(?:\s+(?:called|named|titled)\s+(.{1,60}?))?\s*[.!?]*$/i;
  function matchMerge(rest, names) {
    const m = rest.match(/^(?:please\s+)?(?:merge|combine|join|put together|stitch)\s+(.+?)\s*[.!?]*$/i);
    if (!m || names.length < 2) return null;
    let body = m[1], out;
    const into = body.match(/\s+(?:into|as|to make|called|named)\s+(?:an?\s+|one\s+|single\s+)*(?:pdf\s+|file\s+)?(?:called\s+|named\s+)?@PDF\s*$/i);
    if (into) { body = body.slice(0, into.index); out = names[names.length - 1]; names = names.slice(0, -1); }
    const leftover = body.replace(/@PDF/g, ' ').replace(/\b(?:and|with|plus|then|together|all|these|the|files?|pdfs?|into|one|a|single)\b/gi, ' ').replace(/[,&+]/g, ' ').trim();
    return leftover || names.length < 2 ? null : { op: 'merge', files: names, name: out ? out.replace(/\.pdf$/i, '') : undefined };
  }
  function matchPdf(t0) {
    const sl = t0.match(/^\/pdf(?:\s+([\s\S]*))?$/i);
    const body = sl ? (sl[1] || '').trim() : t0;
    if (sl && !body) return { help: true };
    let beside = false, text = body;
    if (BESIDE.test(text)) { beside = true; text = text.replace(BESIDE, ''); }
    const { names, rest } = pullPdfs(text);
    let m, o = null;
    if (names.length >= 2 && (o = matchMerge(rest, names))) return { ...o, beside };
    if (names.length === 1) {
      if ((m = rest.match(PDF_SPLIT_A))) o = { op: 'pages', file: names[0], pages: m[1] };
      else if ((m = rest.match(PDF_SPLIT_B))) o = { op: 'pages', file: names[0], pages: m[1] };
      else if ((m = rest.match(PDF_SPLIT_C))) o = { op: 'pages', file: names[0], pages: m[1] };
      else if ((m = rest.match(PDF_ROT_A))) o = { op: 'rotate', file: names[0], degrees: m[1], pages: m[2] };
      else if ((m = rest.match(PDF_ROT_B))) o = { op: 'rotate', file: names[0], degrees: m[2], pages: m[1] };
      else if ((m = rest.match(PDF_MARK))) o = { op: 'watermark', file: names[0], text: m[1] };
    }
    if (!o && !names.length && (m = text.match(PDF_MAKE))) o = { op: 'make', title: (m[1] || m[2] || '').trim() };
    if (o) return { ...o, beside };
    return sl ? { help: true } : null;
  }
  const pdfHelp = () => say('**PDF tools** — put your PDFs in ~/jarvis or a project folder, then say:\n- “**merge** a.pdf and b.pdf” (or “merge a.pdf, b.pdf and c.pdf into all.pdf”)\n- “**split** notes.pdf pages 1-3” or “extract pages 2,5-7 from notes.pdf” or “keep the first 5 pages of notes.pdf”\n- “**rotate** scan.pdf right” (or “rotate scan.pdf 90 pages 2-3”)\n- “**watermark** report.pdf with DRAFT”\n- “**make that into a PDF**” (the last answer) — or “make that a pdf called Notes”\n\nEvery result is a **new** file in `~/jarvis/PDFs`; your original is never changed. Add “and save it next to the original” to put it beside the PDF (I’ll ask first). Password-protected PDFs can’t be changed. Text goes in with the standard Latin letters only (Telugu / Kannada and emoji show as “?”).');
  async function pdf(o) {
    const open = async kind => {
      setState('PROCESSING', 'Working on the PDF…');
      return callTool('/pdf/' + kind, o.body);
    };
    let r, what;
    if (o.op === 'merge') { o.body = { files: o.files, name: o.name, beside: o.beside || undefined }; r = await open('merge'); }
    else if (o.op === 'pages') { o.body = { file: o.file, pages: o.pages, beside: o.beside || undefined }; r = await open('pages'); }
    else if (o.op === 'rotate') { o.body = { file: o.file, degrees: o.degrees, pages: o.pages, beside: o.beside || undefined }; r = await open('rotate'); }
    else if (o.op === 'watermark') { o.body = { file: o.file, text: o.text, beside: o.beside || undefined }; r = await open('watermark'); }
    else {
      const src = typeof lastAnswer === 'function' ? lastAnswer() : '';
      if (!src) return say('I don’t have an earlier answer to put in a PDF. Ask me something first, or say **“make a pdf of: <your text>”**… or use `/pdf`.');
      o.body = { title: o.title || undefined, text: src };
      r = await open('make');
    }
    if (r.error) return say(r.error);
    if (r.needsApproval) return say('I need your OK to save beside the original.');
    const where = '`' + r.file + '`';
    if (o.op === 'merge') what = 'Put ' + plural(r.parts, 'PDF') + ' together → ' + where + ' (' + plural(r.pages, 'page') + ')';
    else if (o.op === 'pages') what = 'Took pages ' + r.selected + ' of ' + r.total + ' → ' + where + ' (' + plural(r.pages, 'page') + ')';
    else if (o.op === 'rotate') what = 'Turned ' + (r.pages === r.total ? 'all ' + plural(r.total, 'page') : plural(r.pages, 'page') + ' of ' + r.total) + ' by ' + r.degrees + '° → ' + where;
    else if (o.op === 'watermark') what = 'Stamped “' + String(o.text).slice(0, 40) + '” across ' + (r.pages === r.total ? 'all ' + plural(r.total, 'page') : plural(r.pages, 'page') + ' of ' + r.total) + ' → ' + where;
    else what = 'Made a PDF from my last answer → ' + where + ' (' + plural(r.pages, 'page') + ')';
    if (typeof Undo !== 'undefined' && !o.beside) Undo.push('made the PDF ' + r.file, async () => { const x = await callTool('/tool/undoCreate', { name: r.file }); if (x.error) throw new Error(x.error); return 'Moved ' + r.file + ' to the trash.'; });
    return say('✓ ' + what + ' and opened it.' + (o.op === 'make' ? '' : ' Your original is unchanged.') + (r.replaced ? '\n\n⚠ ' + plural(r.replaced, 'character') + ' (letters the PDF font doesn’t have, like Telugu, Kannada or emoji) became “?”.' : '') + (o.op === 'make' ? '' : '\n\nSay **“undo”** to move it to the trash.'),
      { speak: 'Done. The new PDF is open.', actions: [{ label: 'OPEN PDF FOLDER', fn: () => callTool('/tool/openFolder', { name: String(r.path).replace(/[\\/][^\\/]*$/, '') }) }] });
  }

  /* ================= disk care ================= */
  // What is using the drive, tidy a folder, large and duplicate files, old temp files, empty JARVIS's trash.
  // Every change is shown first and confirmed; reversible ones get ONE undo; permanent ones say so and ask Windows Hello.
  const FOLDER_WORD = '(downloads?|desktop|documents|pictures|videos|music|[a-z]:[\\\\/]\\S*|\\S*[\\\\/]\\S+)';
  const DISK_USAGE = /^(?:what(?:'s| is| are)?\s+(?:using|taking up|eating|filling(?: up)?|hogging|using up)\s+(?:up\s+)?(?:all\s+)?(?:my\s+|the\s+)?(?:c:?\s*(?:drive)?|disk|drive|storage|space|hard\s*(?:disk|drive)|laptop(?:'s)? storage)(?:\s+space)?|why\s+is\s+my\s+(?:c:?\s*)?(?:drive|disk|storage)\s+(?:so\s+)?full|disk\s+usage|storage\s+(?:usage|report)|space\s+(?:usage|report)|\/disk(?:\s+(?:usage|report))?|(?:clean\s*up|free\s+up)\s+(?:some\s+)?(?:my\s+)?(?:disk|c:?\s*drive|storage)(?:\s+space)?|free\s+up\s+(?:some\s+)?space)\s*[?.!]*$/i;
  const DISK_TEMP = /^(?:please\s+)?(?:(?:clean|clear|empty|delete|remove)\s+(?:out\s+)?(?:my\s+|the\s+)?(?:old\s+)?(?:temp|temporary)\s+files?|\/clean(?:\s+temp)?)\s*[.!?]*$/i;
  const DISK_TIDY = new RegExp('^(?:please\\s+)?(?:(?:tidy(?:\\s+up)?|organi[sz]e|sort(?:\\s+out)?|clean\\s+up|declutter)\\s+(?:my\\s+|the\\s+)?' + FOLDER_WORD + '(?:\\s+folder)?|\\/tidy(?:\\s+' + FOLDER_WORD + ')?)(?:\\s+by\\s+(month|date))?\\s*[.!?]*$', 'i');
  const DISK_LARGE = /^(?:please\s+)?(?:(?:find|show|list|what(?:'s| are| is))(?:\s+me)?(?:\s+the)?(?:\s+my)?\s+(?:large|big|biggest|largest|huge)\s+files?|(?:find|show|list)(?:\s+me)?\s+files?\s+(?:over|above|bigger than|larger than)|\/large)(?:\s+(?:over|above|bigger than|larger than)\s+(\d+(?:\.\d+)?)\s*(mb|gb|megabytes?|gigabytes?))?(?:\s+(?:on|in)\s+(?:my\s+|the\s+)?(.+?))?\s*[.!?]*$/i;
  const DISK_LARGE2 = /^(?:please\s+)?(?:find|show|list)(?:\s+me)?\s+files?\s+(?:over|above|bigger than|larger than)\s+(\d+(?:\.\d+)?)\s*(mb|gb|megabytes?|gigabytes?)(?:\s+(?:on|in)\s+(?:my\s+|the\s+)?(.+?))?\s*[.!?]*$/i;
  const DISK_DUPES = /^(?:please\s+)?(?:(?:find|show|list|look for|scan for)\s+(?:me\s+)?(?:my\s+|the\s+)?duplicate(?:d)?\s+(?:files?|photos?|pictures?|videos?)|(?:find|show|list)\s+(?:my\s+|the\s+)?duplicates|\/duplicates)(?:\s+(?:on|in)\s+(?:my\s+|the\s+)?(.+?))?\s*[.!?]*$/i;
  const DISK_CLEAN_DUPES = /^(?:please\s+)?(?:clean\s*up|remove|trash|get rid of|delete|deal with)\s+(?:the\s+|those\s+|all\s+(?:the\s+)?)?duplicates?(?:\s+files?)?\s*[.!?]*$/i;
  const DISK_PICK = /^(?:please\s+)?(?:(?:move|send|put)\s+)?(?:numbers?\s+|files?\s+|items?\s+)?(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s+(?:to|into|in)\s+(?:the\s+)?(?:jarvis\s+)?trash\s*[.!?]*$|^(?:please\s+)?trash\s+(?:numbers?\s+|files?\s+|items?\s+)?(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*[.!?]*$/i;
  const SIM_WORD = '(?:similar|near[- ]?duplicate|look[- ]?alike|almost identical|alike)';
  const DISK_SIMILAR = new RegExp('^(?:please\\s+)?(?:(?:find|show|list|look for|scan for)\\s+(?:me\\s+)?(?:my\\s+|the\\s+)?' + SIM_WORD + '\\s+(?:photos?|pictures?|images?)|\\/similar)(?:\\s+(?:on|in)\\s+(?:my\\s+|the\\s+)?(.+?))?\\s*[.!?]*$', 'i');
  const DISK_CLEAN_SIMILAR = new RegExp('^(?:please\\s+)?(?:(?:clean\\s*up|remove|trash|get rid of|deal with)\\s+(?:the\\s+|those\\s+|all\\s+(?:the\\s+)?)?' + SIM_WORD + '\\s+(?:photos?|pictures?|images?)|move\\s+(?:all\\s+)?(?:the\\s+)?smaller\\s+(?:copies|ones))\\s*[.!?]*$', 'i');
  const DISK_PICK_SETS = /^(?:please\s+)?(?:clean(?:\s*up)?|trash|remove|move)\s+(?:the\s+)?sets?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*[.!?]*$/i;
  const DISK_SHRINK = /^(?:please\s+)?(?:(?:shrink|compress|reduce|make smaller)\s+(?:my\s+|the\s+)?(?:big\s+|large\s+|huge\s+|old\s+)?(?:photos?|pictures?|images?|jpe?gs?)(?:\s+(?:in|on|from)\s+(?:my\s+|the\s+)?(.+?))?|\/shrink(?:\s+(.+?))?)\s*[.!?]*$/i;
  const DISK_REGEN = /^(?:please\s+)?(?:(?:find|show|list|clean(?:\s*up)?|clear|free(?:\s+up)?)\s+(?:my\s+|the\s+|all\s+|old\s+|unused\s+)*(?:node_?modules|project\s+caches?|build\s+caches?|virtual\s+environments?|venvs?|pycache|old\s+project\s+(?:folders|dependencies)|regenerable\s+(?:folders|files))|free\s+up\s+(?:some\s+)?space\s+(?:from|in|on)\s+(?:my\s+)?(?:projects|code\s+folders)|\/regen)(?:\s+(?:in|on|from)\s+(?:my\s+|the\s+)?(.+?))?(\s+(?:of\s+)?any\s+age|\s+even\s+(?:the\s+)?recent(?:\s+ones)?)?\s*[.!?]*$/i;
  const DISK_REGEN_PICK = /^(?:please\s+)?(?:clear|clean(?:\s*up)?|move)\s+(?:numbers?\s+|folders?\s+|items?\s+)?(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*[.!?]*$/i;
  const DISK_REGEN_ALL = /^(?:please\s+)?(?:clear|clean(?:\s*up)?|remove|move|trash)\s+(?:(?:them|those|these)(?:\s+all)?|all(?:\s+of\s+them)?|all\s+(?:the\s+)?(?:old\s+)?folders|everything(?:\s+in\s+the\s+list)?)\s*[.!?]*$/i;
  const DISK_EMPTY_TRASH = /^(?:please\s+)?empty\s+(?:my\s+|the\s+)?jarvis(?:'s)?\s+trash\s*[.!?]*$/i;
  const GB = 1073741824;
  const fmt = b => (b >= GB ? Math.round(b / GB * 10) / 10 + ' GB' : b >= 1048576 ? Math.round(b / 1048576 * 10) / 10 + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  const fresh = s => s && Date.now() - s.at < 14 * 60000;
  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const disk = { large: null, dupes: null, photos: null, regen: null };
  const diskHelp = () => say('**Disk care** — say:\n- **“what’s using my C: drive?”** — where the space went, and what to do about it\n- **“tidy my downloads”** (or desktop, documents, a folder path; add “by month”) — sorts files into folders, shows you first, **undo** puts it all back\n- **“find large files”** (“over 500 MB on D drive”) — then **“trash 1, 3 and 5”**\n- **“find duplicate files”** — then **“clean up the duplicates”** (keeps one copy of each)\n- **“find old node_modules”** (or “clear project caches”) — folders your projects can make again, in projects untouched for 30 days; then **“clear 1 and 3”** or **“clear them all”**\n- **“find similar photos”** (“in my Pictures”) — look-alikes, even resized ones; then **“clean sets 1 and 3”** or **“clean up the similar photos”** (keeps the biggest of each set)\n- **“shrink my big photos”** — re-saves JPEGs over 3 MB (older than 90 days) smaller; the original stays in the JARVIS trash\n- **“clean my temp files”** — deletes temp files older than 3 days (permanent)\n- **“empty my JARVIS trash”** — frees the space of everything I set aside (permanent)\n\nMoving to the **JARVIS trash** can be undone but doesn’t free space until the trash is emptied. Scans only read. OneDrive folders are skipped.');
  const ask = (text, yes) => confirmCard(text, yes);
  function matchDisk(t) {
    let m;
    if (/^\/(?:disk|tidy|large|duplicates|clean)\s+(?:help|\?)$/i.test(t)) return { op: 'help' };
    if (DISK_USAGE.test(t)) return { op: 'usage' };
    if (DISK_EMPTY_TRASH.test(t)) return { op: 'emptyTrash' };
    if (DISK_TEMP.test(t)) return { op: 'temp' };
    if ((m = t.match(DISK_TIDY))) { const f = m[1] || m[2] || 'downloads'; return { op: 'tidy', folder: /^downloads?$/i.test(f) ? 'downloads' : f, by: m[3] ? 'month' : '' }; }
    if ((m = t.match(DISK_LARGE2))) return { op: 'large', minMB: /^g/i.test(m[2]) ? +m[1] * 1024 : +m[1], where: m[3] };
    if ((m = t.match(DISK_LARGE))) return { op: 'large', minMB: m[1] ? (/^g/i.test(m[2]) ? +m[1] * 1024 : +m[1]) : undefined, where: m[3] };
    if ((m = t.match(DISK_REGEN))) return { op: 'regen', where: m[1], anyAge: !!m[2] };
    if (DISK_REGEN_ALL.test(t) && fresh(disk.regen)) return { op: 'regenAll' };
    if ((m = t.match(DISK_REGEN_PICK)) && fresh(disk.regen)) return { op: 'regenPick', nums: m[1].split(/\D+/).filter(Boolean).map(Number) };
    if ((m = t.match(DISK_SIMILAR))) return { op: 'similar', where: m[1] };
    if (DISK_CLEAN_SIMILAR.test(t) && fresh(disk.photos)) return { op: 'cleanSimilar' };
    if ((m = t.match(DISK_PICK_SETS)) && fresh(disk.photos)) return { op: 'pickSets', nums: m[1].split(/\D+/).filter(Boolean).map(Number) };
    if ((m = t.match(DISK_SHRINK))) return { op: 'shrink', where: m[1] || m[2] };
    if ((m = t.match(DISK_DUPES))) return { op: 'dupes', where: m[1] };
    if (DISK_CLEAN_DUPES.test(t) && fresh(disk.dupes)) return { op: 'cleanDupes' };
    if ((m = t.match(DISK_PICK)) && fresh(disk.large)) return { op: 'pick', nums: (m[1] || m[2]).split(/\D+/).filter(Boolean).map(Number) };
    return null;
  }
  async function diskUsage() {
    setState('PROCESSING', 'Measuring your folders…');
    jarvisSay({ text: '⏳ Measuring your drives and the biggest folders — about 10–20 seconds…', intent: 'DISK', noTTS: true, noPersona: true });
    const r = await callTool('/disk/usage', {});
    if (r.error) return say(r.error);
    const L = ['**Where your space is**', ''];
    for (const d of r.drives) { const pct = Math.round(100 * (d.totalBytes - d.freeBytes) / d.totalBytes); L.push('- **' + d.drive + '** — ' + fmt(d.freeBytes) + ' free of ' + fmt(d.totalBytes) + ' (' + pct + '% full)' + (d.freeBytes < 5 * GB ? ' ⚠ low' : '')); }
    L.push('', '**Biggest places I can see**');
    for (const p of r.places.filter(x => x.bytes > 0).slice(0, 8)) L.push('- **' + p.name + '** — ' + (p.partial ? 'at least ' : '') + fmt(p.bytes) + ' (' + plural(p.files, 'file') + ')');
    if (r.temp && r.temp.bytes) L.push('- **Temp files** — ' + (r.temp.partial ? 'at least ' : '') + fmt(r.temp.bytes));
    if (r.notes && r.notes.length) L.push('', '*' + r.notes.join(' ') + '*');
    const tips = [];
    if (r.temp && r.temp.bytes > 200 * 1048576) tips.push('**“clean my temp files”** (' + fmt(r.temp.bytes) + ' of temp)');
    if (r.trashBytes > 50 * 1048576) tips.push('**“empty my JARVIS trash”** (' + fmt(r.trashBytes) + ')');
    tips.push('**“find large files”**', '**“find duplicate files”**', '**“tidy my downloads”**');
    L.push('', 'Next: ' + tips.join(' · '));
    const low = r.drives.find(d => d.freeBytes < 5 * GB);
    return say(L.join('\n'), { speak: low ? 'Drive ' + low.drive[0] + ' has only ' + fmt(low.freeBytes).replace('.', ' point ') + ' free.' : 'Here is where your space is.', suggestions: ['Find large files', 'Clean my temp files', 'Tidy my downloads'] });
  }
  async function diskTemp() {
    const p = await callTool('/disk/plan', { kind: 'temp' });
    if (p.error) return say(p.error);
    if (!p.count) return say('Your temp folder has nothing older than ' + p.olderThanDays + ' days, so there is nothing to clean.');
    const go = await ask('I found **' + plural(p.count, 'old temp file') + '** (' + fmt(p.bytes) + (p.partial ? ' so far' : '') + ') in `' + p.root + '`, all untouched for over ' + p.olderThanDays + ' days. Windows and your apps make new ones when they need them.\n\n**Deleting them is permanent: they do not go to the trash, so “undo” cannot bring them back.** Delete them?', 'YES, DELETE THEM');
    if (!go) return say('Okay, I left your temp files alone.');
    const run = tok => callTool('/disk/applyPermanent', { planId: p.planId }, tok);
    const r = typeof withHello === 'function' ? await withHello('files', run) : await run();
    if (!r) return say('Nothing was deleted.');
    if (r.error) return say(r.error);
    return say('✓ Deleted ' + plural(r.removed, 'temp file') + ' and freed **' + fmt(r.bytes) + '**.' + (r.inUse ? ' ' + plural(r.inUse, 'file') + ' were in use, so I left ' + (r.inUse === 1 ? 'it' : 'them') + '.' : '') + (r.changed ? ' ' + plural(r.changed, 'file') + ' had changed since I looked, so I skipped ' + (r.changed === 1 ? 'it' : 'them') + '.' : ''), { speak: 'Done. I freed ' + fmt(r.bytes).replace('.', ' point ') + '.', suggestions: ['What is using my C: drive?'] });
  }
  const pushUndo = (label, runId, ok) => { if (typeof Undo !== 'undefined' && runId) Undo.push(label, async () => { const x = await callTool('/disk/undo', { runId }); if (x.error) throw new Error(x.error); return ok(x) + (x.problems && x.problems.length ? ' (' + plural(x.problems.length, 'file') + ' could not go back: ' + x.problems[0].why + '.)' : ''); }); };
  async function diskTidy(o) {
    const p = await callTool('/disk/plan', { kind: 'tidy', folder: o.folder, by: o.by });
    if (p.error) return say(p.error);
    const name = String(p.folder).split(/[\\/]/).pop() || p.folder;
    const sk = p.skipped, left = [sk.inProgress && plural(sk.inProgress, 'download') + ' still in progress', sk.recent && plural(sk.recent, 'file') + ' changed in the last 10 minutes', sk.folders && plural(sk.folders, 'folder') + ' (not touched)', sk.system + sk.links + sk.blocked ? plural(sk.system + sk.links + sk.blocked, 'other file') : ''].filter(Boolean);
    if (!p.count) return say('There is nothing to tidy in **' + name + '**: no loose files that are ready to sort.' + (left.length ? ' (Left alone: ' + left.join(', ') + '.)' : ''));
    const cats = Object.entries(p.byCategory).sort((a, b) => b[1].count - a[1].count).map(([c, v]) => '- **' + c + '** — ' + plural(v.count, 'file') + ' (' + fmt(v.bytes) + '): ' + v.examples.join(', ') + (v.count > v.examples.length ? ', …' : '')).join('\n');
    const go = await ask('Tidy **' + name + '**? I would move **' + plural(p.count, 'file') + '** (' + fmt(p.bytes) + ') into folders' + (p.by === 'month' ? ' by type and month' : ' by type') + ':\n' + cats + (left.length ? '\n\nLeft alone: ' + left.join(', ') + '.' : '') + (p.truncated ? '\n\n(That is the first part; ask again for the rest.)' : '') + '\n\nNothing is deleted or renamed, and **“undo”** puts every file back.', 'YES, TIDY');
    if (!go) return say('Okay, I left **' + name + '** as it was.');
    setState('PROCESSING', 'Tidying…');
    const r = await callTool('/disk/apply', { planId: p.planId });
    if (r.error) return say(r.error);
    pushUndo('tidied ' + name, r.runId, x => 'Put ' + plural(x.restored, 'file') + ' back in ' + name + '.');
    return say('✓ Moved **' + plural(r.moved, 'file') + '** into folders in **' + name + '**.' + (r.skipped.length ? ' ' + plural(r.skipped.length, 'file') + ' changed while I worked, so I skipped ' + (r.skipped.length === 1 ? 'it' : 'them') + '.' : '') + (r.failed.length ? ' ' + plural(r.failed.length, 'file') + ' could not be moved (' + r.failed[0].why + ').' : '') + '\n\nSay **“undo”** to put everything back.', { speak: 'Done. I tidied ' + name + '.' });
  }
  async function diskLarge(o) {
    setState('PROCESSING', 'Looking for big files…');
    jarvisSay({ text: '⏳ Looking for large files (up to 15 seconds)…', intent: 'DISK', noTTS: true, noPersona: true });
    const r = await callTool('/disk/plan', { kind: 'large', minMB: o.minMB, where: o.where });
    if (r.error) return say(r.error);
    if (!r.items.length) return say('I found no files over ' + fmt(r.minMB * 1048576) + (r.partial ? ' in the time I had' : '') + ' in ' + (o.where ? o.where : 'your folders and projects') + '.' + (o.minMB ? '' : ' Try a smaller size: “find files over 50 MB”.'));
    disk.large = { planId: r.planId, items: r.items, at: Date.now() };
    const lines = r.items.slice(0, 15).map(i => i.n + '. **' + i.path.split(/[\\/]/).pop() + '** — ' + fmt(i.size) + ' · ' + (i.ageDays >= 60 ? Math.round(i.ageDays / 30) + ' months old' : i.ageDays + ' days old') + ' · `' + i.path + '`');
    return say('**Largest files** (over ' + fmt(r.minMB * 1048576) + ')' + (o.where ? ' in ' + o.where : '') + ' — together ' + fmt(r.bytes) + (r.partial ? ' *(I ran out of time, so there may be bigger ones)*' : '') + '\n' + lines.join('\n') + (r.items.length > 15 ? '\n…and ' + (r.items.length - 15) + ' more.' : '') + '\n\nSay **“trash 1, 3 and 5”** to move some to the JARVIS trash (you can undo, but space is only freed once the trash is emptied).',
      { speak: 'I found ' + plural(r.items.length, 'large file') + '. The biggest is ' + fmt(r.items[0].size).replace('.', ' point ') + '.' });
  }
  async function diskPick(nums) {
    const s = disk.large, items = s.items;
    const bad = nums.filter(n => n < 1 || n > items.length);
    if (bad.length) return say('I only have numbers 1 to ' + items.length + ' in that list.');
    const chosen = [...new Set(nums)].map(n => items[n - 1]);
    const bytes = chosen.reduce((a, b) => a + b.size, 0);
    const go = await ask('Move **' + plural(chosen.length, 'file') + '** (' + fmt(bytes) + ') to the JARVIS trash?\n' + chosen.map(c => '- **' + c.path.split(/[\\/]/).pop() + '** (' + fmt(c.size) + ')').join('\n') + '\n\nThey stay recoverable (**“undo”**), but the space is only freed when you say **“empty my JARVIS trash”**.', 'YES, MOVE THEM');
    if (!go) return say('Okay, I left them where they are.');
    const r = await callTool('/disk/apply', { planId: s.planId, pick: [...new Set(nums)] });
    if (r.error) return say(r.error);
    disk.large = null;
    pushUndo('moved large files to the trash', r.runId, x => 'Put ' + plural(x.restored, 'file') + ' back.');
    return say('✓ Moved **' + plural(r.moved, 'file') + '** (' + fmt(r.bytes) + ') to the JARVIS trash.' + (r.skipped.length ? ' ' + plural(r.skipped.length, 'file') + ' changed, so I skipped ' + (r.skipped.length === 1 ? 'it' : 'them') + '.' : '') + (r.failed.length ? ' ' + plural(r.failed.length, 'file') + ' could not be moved (' + r.failed[0].why + ').' : '') + '\n\nSay **“undo”** to bring them back, or **“empty my JARVIS trash”** to free the space for good.', { speak: 'Moved to the trash.' });
  }
  async function diskDupes(o) {
    setState('PROCESSING', 'Comparing files…');
    jarvisSay({ text: '⏳ Looking for identical files. This reads file contents, so it can take up to 30 seconds…', intent: 'DISK', noTTS: true, noPersona: true });
    const r = await callTool('/disk/plan', { kind: 'duplicates', where: o.where });
    if (r.error) return say(r.error);
    const guarded = r.protectedCopies ? '\n\n' + pl(r.protectedCopies, 'copy', 'copies') + ' inside project folders ' + (r.protectedCopies === 1 ? 'was' : 'were') + ' left alone, because a project may use ' + (r.protectedCopies === 1 ? 'it' : 'them') + '.' : '';
    if (!r.groupCount) return say('I found no identical files over 1 MB that are safe to move' + (o.where ? ' in ' + o.where : ' in your folders and projects') + (r.partial ? ' in the time I had' : '') + ' (I looked at ' + plural(r.scanned, 'file') + ').' + guarded);
    disk.dupes = { planId: r.planId, at: Date.now(), extra: r.extraCopies, wasted: r.wasted };
    const lines = r.groups.slice(0, 6).map(g => '- **' + g.keep.split(/[\\/]/).pop() + '** (' + fmt(g.size) + ') × ' + (g.copies.length + 1) + ' — keeping `' + g.keep + '`; extra: ' + g.copies.slice(0, 2).map(c => '`' + c + '`').join(', ') + (g.copies.length > 2 ? ', …' : ''));
    return say('Found **' + plural(r.groupCount, 'set') + '** of identical files — **' + pl(r.extraCopies, 'extra copy', 'extra copies') + '** wasting **' + fmt(r.wasted) + '**' + (r.partial ? ' *(I ran out of time, so there may be more)*' : '') + ':\n' + lines.join('\n') + (r.groupCount > 6 ? '\n…and ' + (r.groupCount - 6) + ' more sets.' : '') + '\n\nI would keep one copy of each (the oldest, outside Downloads if possible).' + guarded + ' Say **“clean up the duplicates”** to move the extras to the JARVIS trash.',
      { speak: 'I found ' + r.extraCopies + ' extra copies, wasting ' + fmt(r.wasted).replace('.', ' point ') + '.' });
  }
  async function diskCleanDupes() {
    const s = disk.dupes;
    const go = await ask('Move **' + s.extra + ' extra ' + (s.extra === 1 ? 'copy' : 'copies') + '** (' + fmt(s.wasted) + ') of duplicate files to the JARVIS trash? I keep one copy of each set.\n\nThey stay recoverable (**“undo”**); the space is freed once you empty the JARVIS trash.', 'YES, MOVE THEM');
    if (!go) return say('Okay, I left the duplicates alone.');
    const r = await callTool('/disk/apply', { planId: s.planId });
    if (r.error) return say(r.error);
    disk.dupes = null;
    pushUndo('moved duplicates to the trash', r.runId, x => 'Put ' + plural(x.restored, 'file') + ' back.');
    return say('✓ Moved **' + pl(r.moved, 'extra copy', 'extra copies') + '** (' + fmt(r.bytes) + ') to the JARVIS trash.' + (r.skipped.length ? ' ' + plural(r.skipped.length, 'file') + ' changed, so I skipped ' + (r.skipped.length === 1 ? 'it' : 'them') + '.' : '') + '\n\nSay **“undo”** to bring them back, or **“empty my JARVIS trash”** to free the space.', { speak: 'Done.' });
  }
  const dim = x => (x && x.w && x.h ? x.w + '×' + x.h + ' · ' : '');
  async function diskSimilar(o) {
    setState('PROCESSING', 'Comparing pictures…');
    jarvisSay({ text: '⏳ Looking at your pictures to find look-alikes. The first time this can take a minute or two (I remember what I have seen, so the next time is quick)…', intent: 'DISK', noTTS: true, noPersona: true });
    const r = await callTool('/disk/plan', { kind: 'photos', where: o.where });
    if (r.error) return say(r.error);
    const guarded = r.protectedCopies ? '\n\n' + pl(r.protectedCopies, 'picture', 'pictures') + ' inside project folders ' + (r.protectedCopies === 1 ? 'was' : 'were') + ' left alone.' : '';
    const more = r.partial ? '\n\n*I ran out of time' + (r.remaining ? ' with about ' + plural(r.remaining, 'picture') + ' still to look at' : '') + '. Ask again and I will carry on from where I stopped.*' : '';
    const bad = r.unreadable ? ' (' + plural(r.unreadable, 'picture') + ' could not be read)' : '';
    if (!r.groupCount) return say('I found **no look-alike pictures**' + (o.where ? ' in ' + o.where : ' in your folders') + ' among the ' + plural(r.scanned, 'picture') + ' I looked at' + bad + '.' + guarded + more);
    disk.photos = { planId: r.planId, at: Date.now(), sets: r.groups.length, extra: r.extraCopies, wasted: r.wasted };
    const fn = p => String(p).split(/[\\/]/).pop();
    const lines = r.groups.slice(0, 8).map(g => g.n + '. **' + fn(g.keep.path) + '** (' + dim(g.keep) + fmt(g.keep.size) + ') *kept* — similar: ' + g.copies.slice(0, 3).map(c => fn(c.path) + ' (' + dim(c) + fmt(c.size) + (c.distance ? ', not identical' : ', same picture') + ')').join(', ') + (g.copies.length > 3 ? ', …' : ''));
    return say('Found **' + plural(r.groupCount, 'set') + '** of similar pictures — **' + pl(r.extraCopies, 'extra copy', 'extra copies') + '** using **' + fmt(r.wasted) + '**' + bad + ':\n' + lines.join('\n') + (r.groupCount > 8 ? '\n…and ' + (r.groupCount - 8) + ' more sets.' : '') + '\n\n**Similar is not always the same:** burst shots or edits may be pictures you want. In each set I would keep the biggest picture.' + guarded + more + '\n\n' + (r.groupCount > 1 ? 'Say **“clean sets 1 and 2”** for some of them, or **“clean up the similar photos”** for all.' : 'Say **“clean up the similar photos”** to move the extra copies.') + ' They go to the JARVIS trash, so you can undo.',
      { speak: 'I found ' + r.groupCount + ' sets of similar pictures, using ' + fmt(r.wasted).replace('.', ' point ') + '.', suggestions: ['Clean up the similar photos'] });
  }
  async function diskCleanSimilar(nums) {
    const s = disk.photos;
    const sets = nums ? [...new Set(nums)] : null;
    if (sets && sets.some(n => n < 1 || n > s.sets)) return say('I only have sets 1 to ' + s.sets + ' in that list.');
    const go = await ask('Move the **extra copies' + (sets ? ' in ' + (sets.length === 1 ? 'set ' : 'sets ') + sets.join(', ') : ' from all ' + plural(s.sets, 'set')) + '** to the JARVIS trash? I keep the biggest picture of each set.\n\nThey stay recoverable (**“undo”**); the space is freed once you empty the JARVIS trash.', 'YES, MOVE THEM');
    if (!go) return say('Okay, I left the pictures alone.');
    const r = await callTool('/disk/apply', { planId: s.planId, pick: sets || undefined });
    if (r.error) return say(r.error);
    disk.photos = null;
    pushUndo('moved similar photos to the trash', r.runId, x => 'Put ' + plural(x.restored, 'picture') + ' back.');
    return say('✓ Moved **' + pl(r.moved, 'extra picture', 'extra pictures') + '** (' + fmt(r.bytes) + ') to the JARVIS trash.' + (r.skipped.length ? ' ' + plural(r.skipped.length, 'picture') + ' changed, so I skipped ' + (r.skipped.length === 1 ? 'it' : 'them') + '.' : '') + '\n\nSay **“undo”** to bring them back, or **“empty my JARVIS trash”** to free the space.', { speak: 'Done.' });
  }
  async function diskShrink(o) {
    setState('PROCESSING', 'Looking for big photos…');
    jarvisSay({ text: '⏳ Looking for big photos (up to 20 seconds)…', intent: 'DISK', noTTS: true, noPersona: true });
    const p = await callTool('/disk/plan', { kind: 'shrink', where: o.where });
    if (p.error) return say(p.error);
    const guarded = p.protectedFiles ? ' (' + plural(p.protectedFiles, 'photo') + ' inside project folders ' + (p.protectedFiles === 1 ? 'was' : 'were') + ' left alone.)' : '';
    if (!p.count) return say('I found no JPEG photos over ' + fmt(p.minMB * 1048576) + ' that are older than ' + p.olderDays + ' days' + (o.where ? ' in ' + o.where : ' in your folders') + (p.partial ? ' in the time I had' : '') + '.' + guarded);
    const fn = x => String(x).split(/[\\/]/).pop();
    const list = p.items.slice(0, 8).map(i => '- **' + fn(i.from) + '** — ' + fmt(i.size)).join('\n');
    const go = await ask('Make **' + plural(p.count, 'photo') + '** smaller (' + fmt(p.bytes) + ' now' + (p.totalFound > p.count ? '; ' + (p.totalFound - p.count) + ' more after this batch' : '') + ')?\n' + list + (p.count > 8 ? '\n…and ' + (p.count - 8) + ' more' : '') + '\n\nEach is re-saved at quality ' + p.quality + ' with the longest side at most ' + p.maxSide + ' pixels. Date, camera and location details are kept, and the name and date stay. **The original goes to the JARVIS trash**, so **“undo”** puts it back; the space is only freed once you empty the trash. Phone photos usually shrink by half or more. This can take a minute or two.' + guarded, 'YES, SHRINK THEM');
    if (!go) return say('Okay, I left your photos as they are.');
    setState('PROCESSING', 'Making photos smaller…');
    jarvisSay({ text: '⏳ Shrinking ' + plural(p.count, 'photo') + '… (about a second each)', intent: 'DISK', noTTS: true, noPersona: true });
    const r = await callTool('/disk/apply', { planId: p.planId });
    if (r.error) return say(r.error);
    pushUndo('made photos smaller', r.runId, x => 'Put ' + plural(x.restored, 'original photo') + ' back.');
    const why = [...(r.skipped || []), ...(r.failed || [])];
    return say(r.moved ? '✓ Made **' + plural(r.moved, 'photo') + '** smaller — **' + fmt(r.saved) + ' saved** once the originals are gone from the JARVIS trash.' + (why.length ? ' ' + plural(why.length, 'photo') + ' left as they were (' + why[0].why + ').' : '') + '\n\nSay **“undo”** to put the originals back, or **“empty my JARVIS trash”** to free the space.' + (p.totalFound > p.count ? ' Ask again for the next batch.' : '') : 'I did not change any photo' + (why.length ? ': ' + why[0].why + '.' : '.'),
      { speak: r.moved ? 'Done. I saved ' + fmt(r.saved).replace('.', ' point ') + '.' : 'Nothing was changed.' });
  }
  async function diskRegen(o) {
    setState('PROCESSING', 'Looking at your projects…');
    jarvisSay({ text: '⏳ Looking through your project folders for things that can be made again (up to 40 seconds)…', intent: 'DISK', noTTS: true, noPersona: true });
    const r = await callTool('/disk/plan', { kind: 'regen', where: o.where, olderDays: o.anyAge ? 0 : undefined });
    if (r.error) return say(r.error);
    if (!r.count) return say('I found **nothing to clear**' + (o.where ? ' in ' + o.where : ' in your project folders') + (r.partial ? ' in the time I had' : '') + ': no ' + (r.olderDays ? 'untouched-for-' + r.olderDays + '-days ' : '') + '`node_modules`, virtual environments or caches that a project can rebuild.' + (r.olderDays ? ' Say **“find node_modules of any age”** to include projects you used recently.' : ''));
    disk.regen = { planId: r.planId, items: r.items, at: Date.now(), count: r.count, bytes: r.bytes };
    const nm = p => String(p).split(/[\\/]/).slice(-2).join('/');
    const lines = r.items.slice(0, 12).map(i => i.n + '. **' + i.project + '** — `' + i.kind + '` · **' + fmt(i.size) + '** · ' + i.how);
    return say('Found **' + plural(r.count, 'folder') + '** that your projects can make again — **' + fmt(r.bytes) + '** in all' + (r.totalFound > r.count ? ' *(the biggest ' + r.count + ' of ' + r.totalFound + ')*' : '') + (r.partial ? ' *(I ran out of time, so there may be more)*' : '') + (r.olderDays ? ', each in a project untouched for ' + r.olderDays + '+ days' : ', **including projects you used recently**') + ':\n' + lines.join('\n') + (r.count > 12 ? '\n…and ' + (r.count - 12) + ' more.' : '') + '\n\nSay **“clear 1 and 3”** for some, or **“clear them all”**. They go to the JARVIS trash (**“undo”** puts them back); the space is freed when you empty the trash. Code, `package.json` and `dist` folders are never touched.',
      { speak: 'I found ' + fmt(r.bytes).replace('.', ' point ') + ' of folders your projects can rebuild.', suggestions: ['Clear them all'] });
  }
  async function diskRegenDo(nums) {
    const s = disk.regen, items = s.items;
    const chosen = nums ? [...new Set(nums)] : null;
    if (chosen && chosen.some(n => n < 1 || n > items.length)) return say('I only have numbers 1 to ' + items.length + ' in that list.');
    const pick = chosen ? chosen.map(n => items[n - 1]) : items;
    const bytes = pick.reduce((a, b) => a + b.size, 0);
    const go = await ask('Move **' + plural(pick.length, 'folder') + '** (' + fmt(bytes) + ') to the JARVIS trash?\n' + pick.slice(0, 8).map(i => '- **' + i.project + '** — `' + i.kind + '` (' + fmt(i.size) + ')').join('\n') + (pick.length > 8 ? '\n…and ' + (pick.length - 8) + ' more' : '') + '\n\nA project that is **open in an editor or running a dev server** may not let go of its folder; I will say so. Getting one back: **“undo”**, or just run the install command again (`npm install` and so on).', 'YES, MOVE THEM');
    if (!go) return say('Okay, I left your project folders as they are.');
    setState('PROCESSING', 'Moving folders…');
    const r = await callTool('/disk/apply', { planId: s.planId, pick: chosen || undefined });
    if (r.error) return say(r.error);
    disk.regen = null;
    pushUndo('cleared project folders', r.runId, x => 'Put ' + plural(x.restored, 'folder') + ' back.');
    const why = [...(r.skipped || []), ...(r.failed || [])];
    return say(r.moved ? '✓ Moved **' + plural(r.moved, 'folder') + '** (' + fmt(r.bytes) + ') to the JARVIS trash.' + (why.length ? ' ' + plural(why.length, 'folder') + ' left (' + why[0].why + ').' : '') + '\n\nSay **“undo”** to bring them back, or **“empty my JARVIS trash”** to free the space on your drive.' : 'I did not move anything' + (why.length ? ': ' + why[0].why + '.' : '.'), { speak: r.moved ? 'Done.' : 'Nothing was moved.', suggestions: r.moved ? ['Empty my JARVIS trash'] : [] });
  }
  async function diskEmptyTrash() {
    const p = await callTool('/disk/plan', { kind: 'trash' });
    if (p.error) return say(p.error);
    if (!p.count) return say('The JARVIS trash is already empty.');
    const go = await ask('Empty the JARVIS trash? That is **' + plural(p.count, 'item') + '** (' + fmt(p.bytes) + '): everything I set aside, **including things you could still “undo”**.\n\n**This is permanent and cannot be undone.**', 'YES, EMPTY IT');
    if (!go) return say('Okay, the JARVIS trash is untouched.');
    const run = tok => callTool('/disk/applyPermanent', { planId: p.planId }, tok);
    const r = typeof withHello === 'function' ? await withHello('files', run) : await run();
    if (!r) return say('Nothing was deleted.');
    if (r.error) return say(r.error);
    return say('✓ Emptied the JARVIS trash and freed **' + fmt(r.bytes) + '**.' + (r.failed ? ' ' + plural(r.failed, 'item') + ' could not be removed.' : ''), { speak: 'Done. I freed ' + fmt(r.bytes).replace('.', ' point ') + '.' });
  }
  async function disk_(m) {
    switch (m.op) {
      case 'help': return diskHelp();
      case 'usage': return diskUsage();
      case 'temp': return diskTemp();
      case 'tidy': return diskTidy(m);
      case 'large': return diskLarge(m);
      case 'pick': return diskPick(m.nums);
      case 'dupes': return diskDupes(m);
      case 'cleanDupes': return diskCleanDupes();
      case 'regen': return diskRegen(m);
      case 'regenAll': return diskRegenDo(null);
      case 'regenPick': return diskRegenDo(m.nums);
      case 'similar': return diskSimilar(m);
      case 'cleanSimilar': return diskCleanSimilar();
      case 'pickSets': return diskCleanSimilar(m.nums);
      case 'shrink': return diskShrink(m);
      case 'emptyTrash': return diskEmptyTrash();
    }
    return null;
  }

  /* ================= chat archive ================= */
  // Every message is also saved (by the server, on this laptop) so old chats can be searched. Commands: "what did I decide about X last week",
  // "search my chats for X", /history, "forget my chat archive", "chat archive status", "turn off the chat archive".
  const archiveBuf = []; let archiveTimer = 0;
  const archiveOn = () => typeof settings === 'undefined' || settings.chatArchive !== false;
  async function archiveFlush() {
    clearTimeout(archiveTimer); archiveTimer = 0;
    if (!archiveBuf.length) return;
    const items = archiveBuf.splice(0, 300);
    try { const r = await fetch(API + '/chatarchive/append', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }), keepalive: true }); if (!r.ok) throw new Error('HTTP ' + r.status); }
    catch (e) { archiveBuf.unshift(...items.slice(0, 200)); }                       // the server is not there right now: try again with the next message
  }
  function archiveLog(e) {
    if (!archiveOn() || !e || !e.text) return;
    archiveBuf.push({ role: e.role, text: String(e.text).slice(0, 4000), t: e.t || Date.now(), source: e.source });
    if (archiveBuf.length >= 20) archiveFlush(); else if (!archiveTimer) archiveTimer = setTimeout(archiveFlush, 5000);
  }
  // once, when archiving starts: the messages still in the chat window go in too
  async function archiveBackfill(chat) {
    try { if (!archiveOn() || settings.chatArchiveBackfilled || !Array.isArray(chat) || !chat.length) return;
      const r = await fetch(API + '/chatarchive/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: chat.slice(-80).map(m => ({ role: m.role, text: m.text, t: m.t, source: m.source })) }) });
      if (r.ok) { settings.chatArchiveBackfilled = true; if (typeof saveSettings === 'function') saveSettings(); }
    } catch (e) { /* next time */ }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (document.hidden && archiveBuf.length && navigator.sendBeacon) { const items = archiveBuf.splice(0, 300); try { if (!navigator.sendBeacon(API + '/chatarchive/append', new Blob([JSON.stringify({ items })], { type: 'application/json' }))) archiveBuf.unshift(...items.slice(0, 200)); } catch (e) { archiveBuf.unshift(...items.slice(0, 200)); } } });
  }
  const ARCH_ASK = [
    /^(?:please\s+)?what\s+(?:did|have)\s+(?:i|we)\s+(?:decide[d]?|say|said|ask(?:ed)?|discuss(?:ed)?|talk(?:ed)?|tell\s+you|told\s+you|mention(?:ed)?|plan(?:ned)?|conclude[d]?)\s+(?:about|regarding|on|for|with|re)\s+(.+?)\s*[?.!]*$/i,
    /^(?:please\s+)?(?:when\s+did|did)\s+(?:i|we)\s+(?:ever\s+)?(?:ask(?:ed)?|talk(?:ed)?|discuss(?:ed)?|mention(?:ed)?|say|said)\s+(?:you\s+)?(?:about|regarding)\s+(.+?)\s*[?.!]*$/i,
    /^(?:please\s+)?(?:search|find|look)\s+(?:through\s+|in\s+)?(?:my\s+|our\s+)?(?:old\s+|past\s+|previous\s+|earlier\s+)?(?:chat\s+(?:history|archive)|chats?|conversations?)(?:\s+(?:for|about))?\s*(.*?)\s*[?.!]*$/i,
    /^\/history(?:\s+(.+?))?\s*$/i,
  ];
  const ARCH_FORGET = /^(?:please\s+)?(?:forget|delete|erase|clear|wipe)\s+(?:all\s+)?(?:of\s+)?(?:my\s+|the\s+)?(?:chat\s+archive|archived\s+chats?|old\s+chats?\s+archive)\s*[.!?]*$/i;
  const ARCH_STATUS = /^(?:chat\s+archive(?:\s+status)?|how\s+(?:much|many)\s+(?:chat\s+)?(?:history|chats|messages)\s+do\s+you\s+(?:have|keep|remember|save)(?:\s+(?:saved|archived|stored))?)\s*[?.!]*$/i;
  const ARCH_SWITCH = /^(?:please\s+)?(?:(?:turn|switch)\s+(on|off)\s+(?:the\s+|my\s+)?chat\s+archive|(start|stop)\s+(?:saving|archiving)\s+(?:my\s+)?chats?(?:\s+for\s+search)?)\s*[.!?]*$/i;
  function matchArchive(t) {
    let m;
    if (ARCH_FORGET.test(t)) return { op: 'forget' };
    if (ARCH_STATUS.test(t)) return { op: 'status' };
    if ((m = t.match(ARCH_SWITCH))) return { op: 'switch', on: (m[1] || m[2] || '').toLowerCase() === 'on' || (m[2] || '').toLowerCase() === 'start' };
    for (const re of ARCH_ASK) if ((m = t.match(re))) { const q = (m[1] || '').trim(); return q ? { op: 'ask', text: q } : { op: 'help' }; }
    return null;
  }
  const when = ms => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const snip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const archiveHelp = () => say('**Your old chats** — ask things like:\n- **“what did I decide about the database last week?”**\n- **“search my chats for pandas”** (add “in September”, “yesterday”, “3 days ago”, “last 10 days”)\n- **/history recursion**\n- **“chat archive status”**, **“forget my chat archive”**, **“turn off the chat archive”**\n\nEvery message is saved on this laptop, one file per month, from the day archiving started. Nothing is sent anywhere unless you ask for an AI summary.');
  async function archiveAsk(q) {
    if (!archiveOn()) return say('The chat archive is **off**, so nothing new is being saved (older chats are still searchable). Say **“turn on the chat archive”** to start again.');
    let summarize = typeof llmReady === 'function' && llmReady();
    if (summarize && typeof isCloudModel === 'function' && isCloudModel(llm.model)) {
      const provider = typeof modelInfo === 'function' ? modelInfo(llm.model).providerLabel : 'an online provider';
      const go = await confirmCard('To write a short summary I would send the matching parts of your old chats to **' + provider + '** (your AI is an online one). Send them? If you say no, I will just show the matches.', 'YES, SEND THEM');
      summarize = !!go;
    }
    setState('PROCESSING', 'Searching your old chats…');
    const r = await callTool('/chatarchive/search', { text: q, summarize, model: typeof llm !== 'undefined' ? llm.model : undefined });
    if (r.error) return say('I could not search your chats: ' + r.error);
    if (!r.total) {
      const st = await getJSON('/chatarchive/status');
      const since = st && st.oldest ? ' My archive starts on ' + new Date(st.oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' (' + plural(st.messages, 'message') + ' so far).' : ' The archive is empty so far: messages are saved from now on.';
      return say('I found **nothing** in your old chats' + (r.terms.length ? ' about **' + r.terms.join(' ') + '**' : '') + (r.window.label ? ' in ' + r.window.label : '') + '.' + since + '\n\nTry other words, or a wider time: “…last month”, “…in September”.');
    }
    const lines = r.exchanges.slice(0, 6).map(e => '- **' + when(e.t) + '** — ' + (e.user ? 'You: “' + snip(e.user, 120) + '”' : '') + (e.assistant ? (e.user ? ' → ' : '') + 'JARVIS: “' + snip(e.assistant, 150) + '”' : ''));
    const head = '**' + (r.total === 1 ? '1 conversation' : r.total + ' conversations') + '**' + (r.terms.length ? ' about **' + r.terms.join(' ') + '**' : '') + (r.window.label ? ' in ' + r.window.label : '') + (r.total > 6 ? ' — the 6 best' : '') + ':';
    const sum = r.summary ? '**In short:** ' + r.summary + '\n*(written by the AI from the chats below; check them)*' + (r.cloud ? ' *(the excerpts were sent to your online AI provider)*' : '') + '\n\n' : '';
    return say(sum + head + '\n' + lines.join('\n'), { speak: r.summary ? plain(r.summary) : 'I found ' + (r.total === 1 ? 'one conversation' : r.total + ' conversations') + '.' });
  }
  async function archiveStatus() {
    const st = await getJSON('/chatarchive/status');
    if (st.error) return say('I could not read the archive: ' + st.error);
    if (!st.messages) return say('The chat archive is **' + (archiveOn() ? 'on, but empty' : 'off') + '**. ' + (archiveOn() ? 'Messages are saved from now on.' : 'Say “turn on the chat archive” to start saving.'));
    return say('The chat archive is **' + (archiveOn() ? 'on' : 'off') + '**: **' + plural(st.messages, 'message') + '** from ' + new Date(st.oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' to ' + new Date(st.newest).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + fmt(st.bytes) + ' in ' + plural(st.files.length, 'monthly file') + ' (the limit is ' + fmt(st.capBytes) + '; the oldest month goes first). It lives on this laptop in `~/jarvis/.chat-archive` and is never sent anywhere.');
  }
  async function archiveForget() {
    const st = await getJSON('/chatarchive/status');
    if (st.error) return say('I could not read the archive: ' + st.error);
    if (!st.messages) return say('The chat archive is already empty.');
    const go = await confirmCard('Erase your whole chat archive: **' + plural(st.messages, 'message') + '** (' + fmt(st.bytes) + ')? Your current chat on screen is not touched, but old chats become unsearchable.\n\n**This is permanent and cannot be undone.**', 'YES, ERASE IT');
    if (!go) return say('Okay, I kept your chat archive.');
    archiveBuf.length = 0;
    const run = tok => callTool('/chatarchive/forget', { confirm: true }, tok);
    const r = typeof withHello === 'function' ? await withHello('files', run) : await run();
    if (!r) return say('Nothing was erased.');
    if (r.error) return say(r.error);
    return say('✓ Erased the chat archive (' + fmt(r.bytes) + ').' + (archiveOn() ? ' New messages are still being saved; say **“turn off the chat archive”** to stop that too.' : ''), { speak: 'Done. The archive is erased.' });
  }
  function archiveSwitch(on) {
    if (typeof settings === 'undefined') return say('I cannot change that here.');
    settings.chatArchive = !!on; if (typeof saveSettings === 'function') saveSettings();
    try { if (typeof bindSwitchState === 'function' && document.querySelector('#chatArchiveToggle')) bindSwitchState('#chatArchiveToggle', 'chatArchive'); } catch (e) {}
    if (!on) archiveBuf.length = 0;
    return say(on ? '✓ The chat archive is **on**: new messages are saved on this laptop so you can search them later.' : '✓ The chat archive is **off**. Nothing new is saved; what is already there stays until you say **“forget my chat archive”**.');
  }
  async function archive_(m) {
    switch (m.op) {
      case 'help': return archiveHelp();
      case 'ask': return archiveAsk(m.text);
      case 'status': return archiveStatus();
      case 'forget': return archiveForget();
      case 'switch': return archiveSwitch(m.on);
    }
    return null;
  }

  /* ================= router ================= */
  // `source` is 'phone' for messages that arrived over ntfy; anything that switches on the camera or the microphone
  // must refuse those (see CAMERA_REFUSAL), because whoever sent it is not at the laptop.
  async function intercept(text, source) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (HEALTH_CLEAR.test(t)) { const r = await callTool('/ai/health/clear', {}); return say(r.error ? 'Couldn’t clear it: ' + r.error : '✓ Cleared the AI call history.'); }
    if (HEALTH.test(t)) return health(t);
    // camera, watchers and student tools live in their own files (camera-page.js, watch-page.js, student-page.js); each answers only explicit wording
    for (const mod of [typeof Student !== 'undefined' && Student, typeof Life !== 'undefined' && Life, typeof Dev !== 'undefined' && Dev, typeof Camera !== 'undefined' && Camera, typeof Watch !== 'undefined' && Watch]) {      // Student first: during an exam every message is an answer
      if (!mod) continue;
      const r = await mod.intercept(t, source);
      if (r) return r;
    }
    const ar = matchArchive(t);
    if (ar) return archive_(ar);
    const nm = matchNearby(t);
    if (nm) return nm.help ? say('**Nearby places** — say “list **cafés near Majestic**”, “show **pharmacies** near MG Road within 2 km”, “what’s near Indiranagar”, or `/nearby atms`. I can find: ' + NEARBY_KINDS + '.\n\nThis uses OpenStreetMap, so **Online tools** must be on.') : nearby(nm.cat, nm.place, nm.soft);
    const cv = await csv(t);
    if (cv) return cv;
    const wk = matchWiki(t);
    if (wk) return wk.help ? wikiHelp() : wiki(wk.name, wk.into);
    const im = matchImage(t);
    if (im) return im.help ? imageHelp() : image({ ...im, text: t });
    const pf = matchPdf(t);
    if (pf) return pf.help ? pdfHelp() : pdf(pf);
    const dk = matchDisk(t);
    if (dk) return disk_(dk);
    let m;
    if ((m = t.match(WATCH_ADD))) return watchAdd(m[1], m[2] && m[2].trim());
    if ((m = t.match(WATCH_SLASH))) return watchAdd(m[1], '');
    if (WATCH_STATUS.test(t)) return watchStatus();
    if ((m = t.match(WATCH_REMOVE))) {
      const r = await callTool('/watch/remove', { target: m[1].replace(/^port\s+(\d+)$/i, 'localhost:$1') });
      if (r.error && /not watching/i.test(r.error)) return null;   // "stop watching cricket" is just talk: normal handling carries on
      return say(r.error ? r.error : '✓ Stopped watching **' + r.removed + '**.');
    }
    if ((m = t.match(WATCH_SWITCH))) {
      const on = !!m[1], r = await callTool('/watch/enable', { on });
      return say(r.error ? 'Couldn’t change that: ' + r.error : on ? '✓ Watchdog is **on**.' : '✓ Watchdog is **off**. Nothing is checked until you turn it on again.');
    }
    return null;
  }
  return { intercept, say, plain, getJSON, need, onlineOn, HEALTH, listNearby, archiveLog, archiveBackfill, archiveFlush, matchArchive, confirmCard };
})();
