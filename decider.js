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
  const QUESTION = /^(?:what|what's|whats|why|how|who|whom|whose|when|where|which|can|could|should|would|is|are|am|was|were|do|does|did|will|tell me|explain|define|describe|compare)\b|\?\s*$/i;
  const LINKS = /^(?:please\s+)?(?:google|search google for|search (?:the )?web for|search online for|open (?:the )?(?:google )?results for|show me (?:the )?(?:google )?results for)\b/i;
  const words = (re, s) => { const g = new RegExp(re.source, 'gi'), out = []; let m; while ((m = g.exec(s)) && out.length < 4) out.push(m[0].trim()); return out; };

  // ctx: { intent, confidence, implicitSearch } from the rules (implicitSearch = a "find X" file search with no file word)
  function signals(text, ctx) {
    const s = String(text || '').trim(), c = ctx || {};
    const local = LOCAL.test(s);
    // "my latest file", "the current folder": freshness words about YOUR things don't mean the web
    const freshWords = words(FRESH, s).filter(w => !(local && /^(?:latest|current|recent|previous|last|now)$/i.test(w) && new RegExp('\\b' + w + '\\s+(?:\\w+\\s+)?(?:file|folder|project|code|notes?|version of my)', 'i').test(s)));
    const sourceWords = words(SOURCE, s);
    return {
      action: !!(c.intent && c.intent !== 'CONVERSATION' && (c.confidence || 0) >= 0.85 && !c.implicitSearch),
      fresh: freshWords.length > 0, source: sourceWords.length > 0, local, reasoning: REASON.test(s), question: QUESTION.test(s),
      links: LINKS.test(s), implicitSearch: !!c.implicitSearch, intent: c.intent || '',
      words: { fresh: freshWords, source: sourceWords },
    };
  }

  const q = w => '“' + w + '”';
  function decide(sig, env) {
    const e = env || {};
    const web = (route, reason) => e.online === false ? { route: 'OFFER_ONLINE', want: route, reason: reason + ' — but Online tools is off' } : { route, reason };
    if (sig.links) return web('WEB_LINKS', 'you asked to search the web → open the results in your browser');
    if (sig.action) return { route: 'TOOL', reason: 'a command I know (' + String(sig.intent).toLowerCase().replace(/_/g, ' ') + ') → run it directly, no AI needed' };
    // "find X" / "where is X" with nothing pointing at the web: a search of your laptop
    if (sig.implicitSearch && !sig.fresh && !sig.source) return { route: 'LOCAL', reason: 'looks like the name of something on your laptop → search your files and folders' };
    // your own files / folders / projects / what's in focus — unless you explicitly asked for the web
    if (sig.local && !sig.source) return { route: 'LOCAL', reason: 'about your own things (files, folders, projects, what we were working on) → my tools and the local AI, not the web' };
    if (sig.fresh || sig.source) {
      const why = sig.fresh ? 'needs current information (' + sig.words.fresh.slice(0, 2).map(q).join(', ') + ')' : 'asks for outside sources (' + sig.words.source.slice(0, 2).map(q).join(', ') + ')';
      return web('WEB_AI', why + ' → search the web, then the local AI answers from those pages' + (sig.reasoning ? ' and explains' : ''));
    }
    return { route: 'LOCAL_AI', reason: sig.reasoning ? 'needs understanding, not fresh facts → the local AI' : 'conversation / general knowledge → the local AI' };
  }
  const LABEL = { TOOL: 'Direct tool', LOCAL: 'Local (your files + tools)', WEB_AI: 'Web + local AI', WEB_LINKS: 'Web search (browser)', LOCAL_AI: 'Local AI', OFFER_ONLINE: 'Needs the web — Online tools is off' };
  return { signals, decide, LABEL, FRESH, SOURCE, LOCAL };
})();
if (typeof module !== 'undefined') module.exports = Decider;
