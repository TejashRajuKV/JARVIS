'use strict';
/* "Is there a skill for this?" — keyword ranking, used only when a message is going to ordinary chat (no command, no tool, no rule matched).
   Each skill (a SKILL.md folder) is described by words: its name and trigger phrases count most, its keywords next, its description least.
   A message needs at least two of those words (or one of the skill's own trigger phrases) before a skill is suggested, so most chats never
   see a suggestion. The page shows a button ("USE THE RESEARCH SKILL"); a skill whose header says `auto: true` is used straight away.
   This is plain word matching, not understanding: no embeddings, no model call, nothing is sent anywhere. Pure, so it is tested in Node. */
const SkillRouter = (() => {
  const STOP = new Set(('the and for you your with that this what how are was were can could would should will shall have has had not but all any from into about when where which who why also than then them they there their been being does did doing out one two get got make made give tell show want need please jarvis just some more most very much many such like only over under after before again once here our ours its let lets use using used yes okay hey hello thanks thank able know think see say said says going gonna wanna kind sort lot lots way ways thing things stuff really actually maybe sure still even ever never always often already yet too now today').split(' '));
  // a crude stemmer: plural and -ing/-ed endings, so "reviewing / reviews / reviewed" meet "review"
  const stem = w => {
    if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 5 && /(?:ing|ers)$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /(?:ches|shes|xes|sses|zzes)$/.test(w)) return w.slice(0, -2);        // watches → watch, boxes → box
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && /es$/.test(w)) return w.slice(0, -1);                                   // databases → database, cases → case
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  };
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9+#.\- ]/g, ' ').replace(/(^|\s)[.\-]+|[.\-]+(?=\s|$)/g, ' ').split(/[\s]+/).filter(Boolean);
  const content = s => [...new Set(words(s).flatMap(w => w.split('-')).filter(w => w.length >= 3 && !STOP.has(w)).map(stem))];
  const W_NAME = 3, W_TRIGGER = 3, W_KEYWORD = 2.5, W_DESC = 1;

  // The words that describe one skill → Map(word → best weight)
  function vocabulary(skill) {
    const v = new Map();
    const put = (list, w) => { for (const t of list) if (!v.has(t) || v.get(t) < w) v.set(t, w); };
    put(content(String(skill.name || '').replace(/-/g, ' ')), W_NAME);
    for (const tr of skill.triggers || []) put(content(tr), W_TRIGGER);
    for (const k of skill.keywords || []) put(content(k), W_KEYWORD);
    put(content(skill.description), W_DESC);
    return v;
  }
  const cache = new WeakMap();
  const vocab = skill => { let v = cache.get(skill); if (!v) { v = vocabulary(skill); cache.set(skill, v); } return v; };

  const MIN_WORDS = 4;                  // shorter messages are commands or small talk, not requests for a skill
  // → [{ skill, score, matched:[…], phrase:boolean }] best first. Never throws.
  function rank(text, skills, { max = 3 } = {}) {
    const t = String(text || '').trim();
    if (!t || /^\//.test(t) || words(t).length < MIN_WORDS || !Array.isArray(skills)) return [];
    const low = ' ' + words(t).join(' ') + ' ';
    const msg = content(t);
    if (!msg.length) return [];
    const out = [];
    for (const skill of skills) {
      if (!skill || skill.suggest === false || !skill.name) continue;
      const v = vocab(skill), matched = [];
      let score = 0;
      for (const w of msg) { const wt = v.get(w); if (wt) { matched.push(w); score += wt; } }
      // one of the skill's own phrases ("quick answer", "look into") written out: a much stronger signal than loose words
      const phrase = (skill.triggers || []).some(tr => tr.length >= 4 && low.includes(' ' + words(tr).join(' ') + ' '));
      if (phrase) score += 6;
      if (!phrase && matched.length < 2) continue;
      if (score < 4.5) continue;
      out.push({ skill, score: Math.round(score * 10) / 10, matched, phrase });
    }
    out.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    return out.slice(0, max);
  }

  // The one skill worth mentioning, or null. The same skill is not offered again within `cooldownMs` unless one of its own phrases was used.
  const offered = new Map();
  function pick(text, skills, { now = Date.now(), cooldownMs = 10 * 60000 } = {}) {
    const r = rank(text, skills, { max: 2 });
    if (!r.length) return null;
    const best = r[0];
    if (r[1] && best.score - r[1].score < 1 && !best.phrase) return null;                 // two skills fit about equally: say nothing rather than guess
    const last = offered.get(best.skill.name);
    if (last && now - last < cooldownMs && !best.phrase && !best.skill.auto) return null;
    offered.set(best.skill.name, now);
    return { name: best.skill.name, label: best.skill.label || best.skill.name, hint: best.skill.hint || best.skill.description || '', auto: !!best.skill.auto, score: best.score, matched: best.matched, phrase: best.phrase };
  }
  const reset = () => offered.clear();
  return { rank, pick, reset, content, stem, vocabulary, MIN_WORDS };
})();
if (typeof module !== 'undefined') module.exports = SkillRouter;
