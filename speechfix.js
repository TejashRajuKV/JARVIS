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
    [/\b(?:v\.?\s?s\.?|bs|vs\.|vee\s+es|we\s+s|be\s+as|b\s+s|plot|blot|pro|fs)\s+(?:code|core|cold|kode|court|coat|good)\b/gi, 'vs code'],
    [/\b(?:the|de|dee|di)\s+drive\b/gi, 'd drive'],
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
    // "open agriloop holder" — in a folder command, "holder" / "polder" / "fowler" was "folder"
    if (/^(?:please\s+)?(?:open|create|make|find|locate|list|show|check|delete|rename|count|go to)\b/i.test(s)) s = s.replace(/\b(?:holder|polder|fowler|foldr|folda)\b/gi, 'folder');
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
  /* ---------- your own names, matched by SOUND ----------
     The recogniser only knows dictionary words, so a folder called "agriloop" comes back as "ugly loop", "agree look"
     or "agri Roop". sound() keeps how a word sounds — similar consonants merged (r/l, b/p, d/t, g/k, m/n, v/w),
     vowels dropped after the first letter — so "ugly loop", "agri Roop" and "agriloop" all become "aklp". */
  function sound(s) {
    let t = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!t) return '';
    const first = /^[aeiouy]/.test(t) ? 'a' : '';
    t = t.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
      .replace(/[wg]h/g, m => m[0]).replace(/th/g, 't').replace(/dh/g, 'd').replace(/v/g, 'w').replace(/r/g, 'l')
      .replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k').replace(/m/g, 'n').replace(/[aeiouyh]/g, '').replace(/(.)\1+/g, '$1');
    return first + t;
  }
  function jw(a, b) {   // Jaro-Winkler, 0..1
    if (a === b) return 1;
    if (!a || !b) return 0;
    const md = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1), am = [], bm = [];
    let m = 0;
    for (let i = 0; i < a.length; i++) for (let j = Math.max(0, i - md); j < Math.min(b.length, i + md + 1); j++) if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    if (!m) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < a.length; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
    const j = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
    let l = 0; while (l < 4 && a[l] && a[l] === b[l]) l++;
    return j + l * 0.1 * (1 - j);
  }
  const letters = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // ignore version endings when comparing ("AGRILOOP-1" sounds like "agriloop")
  const core = s => String(s || '').replace(/(?:[\s_-]*(?:\(\d+\)|copy|v?\d+(?:\.\d+)*))+$/i, '');
  function closeness(heard, name) {
    const n = core(name), sh = sound(heard), sn = sound(n), lh = letters(heard), ln = letters(n);
    if (!lh || !ln) return 0;
    if (lh === ln) return 1;
    // by sound only for longer names — short words sound alike too often ("pics"/"books", "nodes"/"notes")
    const longEnough = lh.length >= 6 && ln.length >= 6;
    let bySound = longEnough && sh.length >= 3 && sn.length >= 3 ? jw(sh, sn) - (Math.abs(sh.length - sn.length) > 1 ? 0.08 : 0) : 0;
    // same sounds except the very last one ("agree look" ~ agriloop: the mic swaps k/p/t at the end of a word)
    if (longEnough && sh.length >= 4 && sh.length === sn.length && sh.slice(0, -1) === sn.slice(0, -1)) bySound = Math.max(bySound, 0.92);
    const bySpelling = jw(lh, ln);
    // a short word is not a much longer name ("python" is not "pythonProject")
    const ratio = Math.min(lh.length, ln.length) / Math.max(lh.length, ln.length);
    return Math.max(bySound * 0.98, bySpelling) * (ratio < 0.7 ? 0.85 : 1);
  }
  // Words that are never a folder name on their own ("open the new folder", "this project").
  const NOT_A_NAME = /^(?:a|an|the|my|this|that|new|same|current|one|another|any|that one|this one|your|our|which|what|it|its|there|here|some|empty)$/i;
  const LEAD = /^(?:open|find|locate|where|is|where's|show|list|files|folders|in|inside|into|of|for|from|called|named|the|my|a|start|stop|prepare|run|launch|check|whether|if|does|do|create|make|go|to|up|me|please|and|then)$/i;
  // "open ugly loop folder" / "start agree look backend" / "open dss print in vs code" → your real folder name.
  // Only in the place a name goes (just before folder/project/…, or before "in vs code"), and only when it is
  // clearly closest to one of your names.
  function fixNames(text, names) {
    if (!Array.isArray(names) || !names.length) return text;
    const SLOT = /((?:[\w'-]+\s+){0,3}?[\w'-]+)(\s+(?:folder|project|directory|repo|repository|backend|frontend|workspace|app)\b|\s+in\s+(?:vs code|visual studio code)\b)/gi;
    return String(text || '').replace(SLOT, (whole, words, tail) => {
      const ws = words.split(/\s+/);
      while (ws.length && LEAD.test(ws[0])) ws.shift();
      if (!ws.length) return whole;
      const lead = words.slice(0, words.length - ws.join(' ').length);
      let best = null;
      for (let k = Math.min(3, ws.length); k >= 1; k--) {      // the last 1-3 words before "folder"
        const heard = ws.slice(-k).join(' ');
        if (NOT_A_NAME.test(heard) || letters(heard).length < 4) continue;
        for (const n of names) {
          const s = closeness(heard, n);
          if (!best || s > best.s) best = { s, n, k };
        }
      }
      if (!best || best.s < 0.88 || letters(ws.slice(-best.k).join(' ')) === letters(best.n)) return whole;
      const heard = ws.slice(-best.k).join(' ');
      // "python project folder": the word after it is part of the name → it already says the name
      const nextWord = tail.trim().split(/\s+/)[0];
      if (closeness(heard + ' ' + nextWord, best.n) >= best.s) return whole;
      // a different-sounding name almost as close → leave it (the "did you mean" question will ask).
      // Names that sound the same (AGRILOOP-1, AGRRILOOP, AGRILOOP61) are one family, not rivals.
      const rival = names.find(n => sound(core(n)) !== sound(core(best.n)) && closeness(heard, n) > best.s - 0.02);
      if (rival) return whole;
      return lead + ws.slice(0, ws.length - best.k).concat(best.n).join(' ') + tail;
    });
  }
  // "list folders in b drive" when there is no B: drive but there is a D: drive → D drive (b/p/t/e/g/v sound like d).
  function fixDrives(text, drives) {
    if (!Array.isArray(drives) || !drives.length) return text;
    const have = drives.map(d => String(d).toUpperCase()[0]);
    return String(text || '').replace(/\b([a-z])(\s+drive\b|:(?=\s|$|\\))/gi, (m, l, rest) => {
      const L = l.toUpperCase();
      if (have.includes(L)) return m;
      const like = { B: 'D', P: 'D', T: 'D', E: 'D', G: 'D', V: 'D', Z: 'C', S: 'C' }[L];
      return like && have.includes(like) ? like + rest : m;
    });
  }
  return { fix, pickAlternative, score, sound, closeness, fixNames, fixDrives };
})();
if (typeof module !== 'undefined') module.exports = SpeechFix;
