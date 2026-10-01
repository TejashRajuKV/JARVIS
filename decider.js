'use strict';
/* Decider: for every request, which way to answer it —
     TOOL         a command JARVIS knows ("open chrome", "set volume to 50")
     LOCAL        your own things: files, folders, projects, what's in focus ("fix the previous python file")
     WEB_AI       needs current or outside information → search the web, then the local AI answers ONLY from the
                  pages it fetched, with sources ("what's the latest node.js version", "find the latest react docs
                  and explain hooks")
     WEB_LINKS    "search google for X" → open the search in your browser
     LOCAL_AI     understanding / reasoning that doesn't need fresh facts ("explain binary search simply")
     OFFER_ONLINE WEB_* was needed but Online tools is off → ask to turn it on (or answer from memory, flagged)
   Plain rules, no AI call: fast, predictable, testable — and the inspector shows the signals and the reason. */
const Decider = (() => {
  const FRESH = /\b(latest|newest|current(?:ly)?|today'?s?|tonight|right now|now|recent(?:ly)?|this (?:week|month|year|season)|20(?:2[4-9]|3\d)|news|headlines?|prices?|cost(?:s)?|stock(?: price)?|share price|exchange rate|score|scores|standings|weather|forecast|versions?|releases?|released|release date|updates?|drivers?|changelog|announced|who won|winner|results? of|schedule for|deadline for|last date|trending|live|upcoming|ceo|president|prime minister|chief minister|governor|captain|population|net worth)\b/i;
  // "search" only as a request ("search for…", "search the web"), not the noun ("binary search")
  const SOURCE = /\b(search (?:for|the web|online|google|the internet)|^search\b|google|look up|lookup|on the (?:web|internet)|online|internet|official(?:ly)?|documentation|docs|according to|references?|sources?|cite|wikipedia|website of|find (?:info|information|details|out|the official|articles?|a tutorial|tutorials)(?: (?:about|on|for))?)\b/i;
  const LOCAL = /\b(?:my|this|that|these|those|our|the same|same|current|previous|last)\s+(?:\w+\s+)?(?:files?|folders?|director(?:y|ies)|projects?|code|notes?|pdfs?|documents?|laptop|computer|pc|system|screen|clipboard|repo(?:sitory)?|app|program|script)\b|\b(?:there|in it|open it|the previous one|the last one|continue|carry on|same project)\b|\b(?!(?:node|vue|next|nuxt|three|react|express|d3|chart|p5|angular|ember|backbone|socket)\.js\b)[\w-]+\.(?:py|js|ts|java|cpp|c|html?|css|json|md|txt|pdf|docx?|pptx?|xlsx?)\b/i;
  const REASON = /\b(explain|why|how (?:does|do|to|can|is|are)|compare|comparison|difference|differences|summari[sz]e|teach|help me (?:understand|learn|debug|fix)|should i|is it worth|pros and cons|what does .* mean|walk me through)\b/i;
  // Places: a kind of place + where ("nearest restaurants to kodigehalli", "hotels near me", "cafes in indiranagar")
  // kinds of places live in places.js (data, not logic)
  const PLACE = (typeof Places !== 'undefined' ? Places : require('./places.js')).REGEX;
  const WHERE = /\b(near(?:est|by)?|near me|around (?:me|here)|close to|closest|in|at|to|around)\b/i;
  const NEAR = /\b(near(?:est|by)?|near me|around (?:me|here)|close to|closest|in my area|around my area)\b/i;
  const ASKING = /^(?:please\s+)?(?:any|show|find|search|list|suggest|recommend|best|top|good|cheap|famous|popular|tell me|give me|i need|i want|looking for|get me)\b/i;
  // about THIS laptop ("what version of node am I running", "my python") — freshness words don't mean the web here
  const MACHINE = /\b(?:am i (?:running|using|on)|(?:do|have) i (?:have|got)(?: installed)?|installed (?:on|in) (?:my|this)|on (?:my|this) (?:laptop|computer|pc|system|machine)|my (?:node(?:\.?js)?|python|npm|java|git|gcc|system|laptop|pc|computer|machine|gpu|cpu|ram|drivers?))\b/i;
  // "update my node.js", "install python": JARVIS never installs software
  const INSTALL = /^(?:please\s+)?(?:can you\s+|could you\s+|jarvis,?\s+)?(?:update|upgrade|install|uninstall|reinstall|downgrade)\s+(?:the\s+|my\s+|a\s+)?\w/i;
  // "find / show / open the (official) React docs": the page itself
  const SHOW_PAGE = /^(?:please\s+)?(?:find|show|open|get|give)(?: me)?\s+(?:the\s+)?(?:official\s+)?(?:[\w.+-]+\s+){0,4}?(?:documentation|docs|website|homepage|home page|site)\b(?:\s+(?:for|of)\s+[\w.+ -]+)?$/i;
  const QUESTION = /^(?:what|what's|whats|why|how|who|whom|whose|when|where|which|can|could|should|would|is|are|am|was|were|do|does|did|will|tell me|explain|define|describe|compare)\b|\?\s*$/i;
  const LINKS = /^(?:please\s+)?(?:google|search google for|search (?:the )?web for|search online for|open (?:the )?(?:google )?results for|show me (?:the )?(?:google )?results for)\b/i;
  const words = (re, s) => { const g = new RegExp(re.source, 'gi'), out = []; let m; while ((m = g.exec(s)) && out.length < 4) out.push(m[0].trim()); return out; };

  // ctx: { intent, confidence, implicitSearch } from the rules (implicitSearch = a "find X" file search with no file word)
  function signals(text, ctx) {
    const s = String(text || '').trim(), c = ctx || {};
    const local = LOCAL.test(s);
    // "my latest file", "the current folder": freshness words about YOUR things don't mean the web
    const machine = MACHINE.test(s);
    const freshWords = machine ? [] : words(FRESH, s).filter(w => !(local && /^(?:latest|current|recent|previous|last|now)$/i.test(w) && new RegExp('\\b' + w + '\\s+(?:\\w+\\s+)?(?:file|folder|project|code|notes?|version of my)', 'i').test(s)));
    const sourceWords = words(SOURCE, s);
    return {
      action: !!(c.intent && c.intent !== 'CONVERSATION' && (c.confidence || 0) >= 0.85 && !c.implicitSearch),
      fresh: freshWords.length > 0, source: sourceWords.length > 0, local, reasoning: REASON.test(s), question: QUESTION.test(s),
      // a kind of place + "near…" — or + "in/at/to <somewhere>" when it's a request ("best cafes in indiranagar"), not a
      // statement ("i am at the park")
      place: PLACE.test(s) && (NEAR.test(s) || (WHERE.test(s) && (QUESTION.test(s) || ASKING.test(s)))), links: LINKS.test(s), implicitSearch: !!c.implicitSearch, intent: c.intent || '',
      // "…and open it" after a place search is about the place, not one of your files
      localBeyondOpenIt: LOCAL.test(s.replace(/\b(?:and\s+)?open it\b/gi, '')),
      machine, install: INSTALL.test(s), showPage: SHOW_PAGE.test(s), text: s, ruleConfidence: c.confidence || 0,
      words: { fresh: freshWords, source: sourceWords }, placeWord: (s.match(PLACE) || [])[0] || '',
    };
  }

  // Intents a places request may take over: the generic "open the best web page" / "search" / "find a file" — not a
  // real command like "open chrome".
  const PLACE_OVERRIDES = new Set(['OPEN_WEB', 'OPEN_APPLICATION', 'WEB_SEARCH', 'SITE_SEARCH', 'SEARCH_FILES', 'RESEARCH']);
  const q = w => '“' + w + '”';
  // → { route, reason, confidence, payload, override? }
  //   payload: what the route needs, already worked out (so the code after it never re-reads the sentence)
  //   override: the decision replaces the rule engine's match (e.g. "open the nearest atm" → Maps, not a web page)
  function decide(sig, env) {
    const e = env || {};
    const text = sig.text || '';
    const conflict = (sig.local && (sig.fresh || sig.source)) || (sig.place && sig.action) || (sig.machine && sig.fresh);
    const conf = base => Math.round((conflict ? Math.min(base, 0.75) : base) * 100) / 100;
    const web = (route, reason, payload, c) => e.online === false
      ? { route: 'OFFER_ONLINE', want: route, reason: reason + ' — but Online tools is off', confidence: conf(c || 0.9), payload }
      : { route, reason, confidence: conf(c || 0.9), payload };
    // 1. you asked to search → the results in your browser
    // (opening a page in YOUR browser needs no Online tools — only JARVIS fetching pages does)
    if (sig.links) return { route: 'WEB_LINKS', reason: 'you asked to search the web → open the results in your browser', confidence: conf(0.95), payload: { query: stripLead(text) } };
    // 2. places — even when "open …" matched the generic "open the best web page" rule
    if (sig.place && !sig.localBeyondOpenIt && (!sig.action || PLACE_OVERRIDES.has(sig.intent))) {
      const pq = placeQuery(text);
      return { route: 'MAPS', reason: 'looking for places (' + (pq.category || 'places') + (pq.location !== 'your current location' ? ' near ' + pq.location : '') + ', ' + pq.sort + ') → Google Maps' + (sig.action ? ' — not a generic web page' : ''),
        confidence: conf(0.95), payload: pq, override: !!sig.action };
    }
    // 3. a command JARVIS knows
    if (sig.action) return { route: 'TOOL', reason: 'a command I know (' + String(sig.intent).toLowerCase().replace(/_/g, ' ') + ') → run it directly, no AI needed', confidence: conf(sig.ruleConfidence || 0.9), payload: { intent: sig.intent } };
    // 4. "update / install my node": JARVIS doesn't install software — the local AI explains how
    if (sig.install) return { route: 'GUIDE', reason: 'installing or updating software — I don’t do that myself, so the local AI explains the steps', confidence: conf(0.85), payload: { topic: text } };
    // 5. "find / show / open the React docs": you want the page itself, not an answer about it
    if (sig.showPage && !sig.reasoning && !sig.local) return { route: 'WEB_OPEN', reason: 'you want the page itself (' + q((text.match(/documentation|docs|website|homepage|site|page/i) || ['page'])[0]) + ') → open the best match in your browser', confidence: conf(0.85), payload: { query: stripLead(text) } };
    // 6. "find X" / "where is X" with nothing pointing at the web: a search of your laptop
    if (sig.implicitSearch && !sig.fresh && !sig.source) return { route: 'LOCAL', reason: 'looks like the name of something on your laptop → search your files and folders', confidence: conf(0.85), payload: {} };
    // 7. your own things — files, folders, projects, this laptop — unless you explicitly asked for the web
    if ((sig.local || sig.machine) && !sig.source) return { route: 'LOCAL', reason: 'about your own things (' + (sig.machine ? 'this laptop' : 'files, folders, projects, what we were working on') + ') → my tools and the local AI, not the web', confidence: conf(0.85), payload: {} };
    // 8. fresh or outside information → web, then the local AI answers from those pages
    if (sig.fresh || sig.source) {
      const why = sig.fresh ? 'needs current information (' + sig.words.fresh.slice(0, 2).map(q).join(', ') + ')' : 'asks for outside sources (' + sig.words.source.slice(0, 2).map(q).join(', ') + ')';
      return web('WEB_AI', why + ' → search the web, then the local AI answers from those pages' + (sig.reasoning ? ' and explains' : ''), { query: stripLead(text) }, sig.fresh && sig.source ? 0.95 : 0.85);
    }
    // 9. everything else
    return { route: 'LOCAL_AI', reason: sig.reasoning ? 'needs understanding, not fresh facts → the local AI' : 'conversation / general knowledge → the local AI', confidence: conf(sig.reasoning || sig.question ? 0.85 : 0.7), payload: {} };
  }
  // "search google for X" / "find the docs for X" → "X" (the part worth searching for)
  function stripLead(text) {
    return String(text || '').replace(/[?!.]+$/, '').replace(/^(?:please\s+)?(?:can you\s+)?(?:search(?: google| the web| online)?(?: for)?|google|look up|find(?: me)?(?: out)?|show(?: me)?|open|get(?: me)?|give me)\s+/i, '').trim();
  }
  const LABEL = { GUIDE: 'Local AI (how-to — I don’t install software)', WEB_OPEN: 'Open the page', MAPS: 'Google Maps', TOOL: 'Direct tool', LOCAL: 'Local (your files + tools)', WEB_AI: 'Web + local AI', WEB_LINKS: 'Web search (browser)', LOCAL_AI: 'Local AI', OFFER_ONLINE: 'Needs the web — Online tools is off' };
  // "what are the nearest restaurants to bengaluru(kodigehalli)" → "restaurants near bengaluru kodigehalli"
  function mapsQuery(text) {
    let s = String(text || '').toLowerCase().replace(/[()]/g, ' ').replace(/[?!.]+$/, '')
      .replace(/^(?:please\s+)?(?:what are|what is|which are|where are|where is|where can i (?:find|get)|show me|find(?: me)?|search(?: for)?|list|tell me|give me|suggest|recommend|any|are there)\s+/, '')
      .replace(/\b(?:the|some|good|best|top|a few|few)\s+/g, m => /best|top|good/.test(m) ? m : '')
      .replace(/\b(?:nearest|nearby|closest)\b/g, '').replace(/\b(?:close to|to|around)\b/g, 'near').replace(/\bnear\s+near\b/g, 'near');
    s = s.replace(/\b(?:in my area|around my area|around here|around me)\b/g, 'near me').replace(/\s+/g, ' ').trim();
    // no place named ("nearest hospital") → near me (Maps uses your location)
    return /\b(?:near|in|at)\s+\w/.test(s) ? s : s + ' near me';
  }
  /* A places request, understood: what kind of place, where, and how to rank it.
     "what are the nearest restaurants to bengaluru(kodigehalli)" →
       { category: 'restaurants', location: 'Kodigehalli, Bengaluru', sort: 'nearest', query: 'nearest restaurants near Kodigehalli, Bengaluru' }
     "X(Y)" / "Y in X" / "Y, X": Y is the more specific area, so it comes first. */
  const title = w => String(w || '').replace(/\b[a-z]/g, c => c.toUpperCase());
  function placeQuery(text) {
    const raw = String(text || '').replace(/[?!.]+$/, '').trim();
    const low = raw.toLowerCase();
    const cat = (low.match(PLACE) || [])[0] || '';
    const sort = /\b(nearest|closest|nearby|near me|around me|close to)\b/.test(low) ? 'nearest'
      : /\b(best|top|top rated|highest rated|good)\b/.test(low) ? 'best rated'
      : /\b(cheap|cheapest|budget|affordable)\b/.test(low) ? 'cheapest' : /\b(open now|open)\b/.test(low) ? 'open now' : '';
    // where: after near/to/in/at/around (the last one), or "me"
    let where = '';
    // the place starts at the first "near/to/in/at" AFTER the kind of place ("nearest" is a sort, not a place);
    // the rest ("yelahanka in bengaluru") is area + wider area
    const after = cat ? low.slice(low.indexOf(cat.toLowerCase()) + cat.length) : low;
    const m = after.match(/\b(?:near(?:\s+to)?|close to|closest to|to|in|at|around)\s+(.+)$/);
    if (m) where = m[1].replace(/^(?:the|my)\s+/, '').trim();
    if (/^(?:me|here|my area|my location)$/.test(where) || /\b(?:near me|around me|in my area|around here)\b/.test(low)) where = '';
    // "bengaluru(kodigehalli)" / "bengaluru (kodigehalli)" → Kodigehalli, Bengaluru; "kodigehalli in bengaluru" / "kodigehalli, bengaluru" stay in that order
    let location = '';
    if (where) {
      const paren = where.match(/^([^()]+?)\s*\(\s*([^()]+?)\s*\)\s*(.*)$/);
      if (paren) location = [paren[2], paren[1]].map(x => title(x.trim())).join(', ') + (paren[3] ? ' ' + paren[3] : '');
      else location = where.split(/\s*(?:,|\bin\b)\s*/).filter(Boolean).map(x => title(x.trim())).join(', ');
    }
    // fall back to the free-text form for anything unusual
    const category = cat ? cat.toLowerCase() : '';
    const query = category
      ? (sort === 'nearest' && location ? 'nearest ' : sort === 'best rated' ? 'best ' : sort === 'cheapest' ? 'cheap ' : '') + category + (sort === 'open now' ? ' open now' : '') + ' near ' + (location || 'me')
      : mapsQuery(raw);
    return { category, location: location || 'your current location', sort: sort || 'relevance', query };
  }
  return { signals, decide, mapsQuery, placeQuery, stripLead, LABEL, FRESH, SOURCE, LOCAL, PLACE, PLACE_OVERRIDES };
})();
if (typeof module !== 'undefined') module.exports = Decider;
