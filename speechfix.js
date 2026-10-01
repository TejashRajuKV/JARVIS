'use strict';
/* SpeechFix: repairs words the browser's speech recogniser regularly mishears in commands ("front and" → frontend,
   "v s code" → vs code, "java script" → javascript), and picks the best of the recogniser's alternative transcripts.
   Runs only on spoken input, before the rule engine. Every rule is guarded by its neighbours so ordinary sentences
   are left alone ("front and back of the page" stays as it is). Plain logic, no browser APIs (tests/reliability.test.js). */
const SpeechFix = (() => {
  // What may follow a misheard "frontend"/"backend": the rest of a request about building one.
  const AFTER = '(?=\\s+(?:for|of|design|designs|page|pages|ui|code|part|developer|development|project|app|application|in|using|with|framework)\\b|\\s*[.!?]?$)';
  const RULES = [
    // "create a frontend …" heard as "creative front …"
    [/\bcreative\s+(?=(?:a\s+|the\s+)?(?:front|back)\s*(?:end|and|an|in)?\b|(?:a\s+)?(?:ui|website|web\s?page|folder|file|project)\b)/gi, 'create '],
    [/\bfront[\s-]+ends?\b/gi, 'frontend'],
    [new RegExp('\\bfront\\s+(?:and|an|in|end)' + AFTER, 'gi'), 'frontend'],
    [/\bback[\s-]+ends?\b/gi, 'backend'],
    [new RegExp('\\bback\\s+(?:and|an)' + AFTER, 'gi'), 'backend'],
    [/\b(?:v\.?\s?s\.?|bs|vs\.|vee\s+es)\s+(?:code|core|cold|kode)\b/gi, 'vs code'],
    [/\bvisual\s+studio\s+core\b/gi, 'visual studio code'],
    [/\bjava\s+script\b/gi, 'javascript'],
    [/\btype\s+script\b/gi, 'typescript'],
    [/\bnode\s+js\b/gi, 'nodejs'],
    [/\breact\s+js\b/gi, 'react'],
    [/\b(?:pie\s?thon|pyth?on's|pyton)\b/gi, 'python'],
    [/\bh\s?t\s?m\s?l\b/gi, 'html'],
    [/\bc\s+s\s+s\b/gi, 'css'],
    [/\bu\s+i\b/gi, 'ui'],
    [/\b(?:calculate\s+(?:her|or|ur)|calculater|calculaters|calcu\s+later)\b/gi, 'calculator'],
    [/\b(?:direct\s+tree|directry|dir\s+ectory|directory's)\b/gi, 'directory'],
    [/\b(?:fold\s+her|folders?'s)\b/gi, 'folder'],
    [/\b(?:crome|chrom|krome)\b/gi, 'chrome'],
    [/\bbright\s+(?:ness|nest)\b/gi, 'brightness'],
    [/\bscreen\s+shot\b/gi, 'screenshot'],
    [/\bto\s+do\s+list\b/gi, 'to-do list'],
  ];
  function fix(text) {
    let s = String(text || '');
    for (const [re, to] of RULES) s = s.replace(re, to);
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }
  // Words JARVIS commands are made of: an alternative containing more of them is more likely what was meant.
  const VOCAB = /\b(frontend|backend|folder|folders|directory|file|files|calculator|project|website|ui|vs code|javascript|typescript|react|python|html|css|chrome|brightness|volume|create|open|close|make|build|design|list|count|show|find|remind|timer|screenshot|desktop|downloads|documents|drive)\b/gi;
  const score = t => (String(t || '').match(VOCAB) || []).length;
  // alts: transcripts of one result, best first (as the recogniser ranks them). Keep the first unless another
  // one, once fixed, clearly matches more JARVIS words.
  function pickAlternative(alts) {
    const list = (alts || []).filter(a => typeof a === 'string' && a.trim());
    if (list.length < 2) return list[0] || '';
    let best = list[0], bestScore = score(fix(list[0]));
    for (const a of list.slice(1)) { const sc = score(fix(a)); if (sc > bestScore) { best = a; bestScore = sc; } }
    return best;
  }
  return { fix, pickAlternative, score };
})();
if (typeof module !== 'undefined') module.exports = SpeechFix;
