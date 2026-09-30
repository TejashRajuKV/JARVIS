'use strict';
/* Telugu & Kannada: detect the script, translate commands to English for the rule engine,
   and give replies back in the user's language. Uses globals from script.js at call time. */
const Lang = (() => {
  const NAMES = { en: 'English', te: 'తెలుగు', kn: 'ಕನ್ನಡ' };
  const SPEECH = { en: 'en-IN', te: 'te-IN', kn: 'kn-IN' };
  let turn = 'en';

  function detect(text) {
    const s = String(text || '');
    const te = (s.match(/[ఀ-౿]/g) || []).length;
    const kn = (s.match(/[ಀ-೿]/g) || []).length;
    if (!te && !kn) return 'en';
    return te >= kn ? 'te' : 'kn';
  }
  // ౦-౯ / ೦-೯ → 0-9
  const westernDigits = s => String(s).replace(/[౦-౯]/g, d => String(d.charCodeAt(0) - 0x0C66)).replace(/[೦-೯]/g, d => String(d.charCodeAt(0) - 0x0CE6));

  // On/off words the model can confuse; these always win over the translation.
  const ON = /(ఆన్|ఆన్\s*చెయ్|ఆన్\s*చేయ|ప్రారంభించు|ಆನ್|ಆನ್\s*ಮಾಡ|ಶುರು\s*ಮಾಡ)/;
  const OFF = /(ఆఫ్|ఆపు|ఆపేయ్|ఆపండి|ಆಫ್|ನಿಲ್ಲಿಸು|ನಿಲ್ಲಿಸಿ|ಬಂದ್)/;
  function guardSwitch(original, en) {
    const on = ON.test(original), off = OFF.test(original);
    if (off && !on && /\bon\b/i.test(en) && !/\boff\b/i.test(en)) return en.replace(/\bturn on\b/i, 'turn off').replace(/\bswitch on\b/i, 'switch off').replace(/\bon\b/i, 'off');
    if (on && !off && /\boff\b/i.test(en) && !/\bon\b/i.test(en)) return en.replace(/\bturn off\b/i, 'turn on').replace(/\bswitch off\b/i, 'switch on').replace(/\boff\b/i, 'on');
    return en;
  }
  // Same idea for open/close/increase/decrease: if the Telugu/Kannada verb is clear but the translation lost it
  // ("క్రోమ్ మూసేయ్" → "Chrome Muse"), put the right English verb in front.
  const VERBS = [
    { re: /(మూసె|మూసే|మూయ|క్లోజ్|ಮುಚ್ಚ|ಕ್ಲೋಸ್)/, en: 'close', has: /\b(close|shut|quit|exit|kill|end)\b/i },
    { re: /(తెరువు|తెరవ|ఓపెన్|ತೆರೆ|ತೆರೆಯ|ಓಪನ್)/, en: 'open', has: /\b(open|launch|start|run)\b/i },
    { re: /(పెంచ|ಜಾಸ್ತಿ|ಹೆಚ್ಚಿಸ|ಹೆಚ್ಚು\s*ಮಾಡ)/, en: 'increase', has: /\b(increase|raise|up|louder|brighter|higher|boost|more)\b/i },
    { re: /(తగ్గించ|ತಗ್ಗಿಸ|ಕಮ್ಮಿ|ಕಡಿಮೆ)/, en: 'decrease', has: /\b(decrease|lower|reduce|down|dim|quieter|less)\b/i },
  ];
  function guardVerb(original, en) {
    const hit = VERBS.filter(v => v.re.test(original));
    if (hit.length !== 1 || hit[0].has.test(en) || en.split(/\s+/).length > 6 || /\?|^(how|what|why|when|where|who|which|can|should|is|are|do|does)\b/i.test(en)) return en;
    return hit[0].en + ' ' + en.replace(/^(please\s+)?(open|launch|start|play|close|turn on|turn off)\s+/i, '');
  }

  const cache = new Map();
  async function translate(text, to, mode, engine, roman) {
    const key = to + '|' + (mode || '') + '|' + (engine || '') + '|' + (roman ? 'r|' : '') + text;
    if (cache.has(key)) return cache.get(key);
    try {
      const r = await fetch(API + '/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, to, mode, engine, roman: !!roman, fallback: engine === 'online', model: llm.model || undefined }) });
      const j = await r.json();
      if (!j.text) return null;
      const out = tidy(westernDigits(j.text));
      if (cache.size > 300) cache.clear();
      cache.set(key, out);
      return out;
    } catch (e) { return null; }
  }
  // One spelling of "sir" (translators mix సర్/సార్ and ಸರ್/ಸಾರ್).
  const tidy = t => t.replace(/(?<![ఀ-౿])సార్(?![ఀ-౿])/g, 'సర్').replace(/(?<![ಀ-೿])ಸಾರ್(?![ಀ-೿])/g, 'ಸರ್');
  // Telugu/Kannada → one English command. Google first (when online translation is on), the local model as fallback —
  // and as a second opinion when Google's wording isn't recognised as a command. Romanized text ("volume penchu") is
  // local only, because Google can't read it.
  const isCommand = en => typeof NLU === 'undefined' || NLU.classify(NLU.normalize(en, 'jarvis'), {}).intent !== 'CONVERSATION';
  async function toEnglish(text, roman) {
    const src = westernDigits(text);
    const fix = en => en ? guardVerb(text, guardSwitch(text, en)).replace(/[.!]+$/, '') : null;
    if (roman || !onlineOn()) return fix(await translate(src, 'en', 'command', null, roman));
    const g = fix(await translate(src, 'en', 'command', 'online'));
    if (g && (isCommand(g) || g.split(/\s+/).length > 8)) return g;
    const l = fix(await translate(src, 'en', 'command'));
    return l && isCommand(l) ? l : g || l;
  }

  function setTurn(l) { turn = l || 'en'; }
  function replyLang() {
    const s = typeof settings !== 'undefined' ? settings.replyLang : 'auto';
    return !s || s === 'auto' ? turn : s;
  }

  // Native phrase banks — instant and reliable for the lines JARVIS says most. {sir} = localized address.
  const BANK = {
    te: {
      presence: ['మీ సేవలో ఉన్నాను, {sir}.', 'ఎప్పుడూ ఇక్కడే ఉన్నాను, {sir}.', 'చెప్పండి, {sir}.', 'సిద్ధంగా ఉన్నాను, {sir}.'],
      wake: ['చెప్పండి, {sir}?', '{sir}?', 'వింటున్నాను, {sir}.'],
      morning: ['శుభోదయం, {sir}.', 'శుభోదయం, {sir}. అన్ని వ్యవస్థలు సిద్ధంగా ఉన్నాయి.'],
      afternoon: ['నమస్కారం, {sir}. ఏం చేద్దాం?', 'నమస్కారం, {sir}.'],
      evening: ['శుభ సాయంత్రం, {sir}.', 'శుభ సాయంత్రం, {sir}. ఈ రోజు ఏం చేద్దాం?'],
      late: ['ఇంత రాత్రి వరకు పని చేస్తున్నారా, {sir}?', 'చాలా రాత్రి అయింది, {sir}. ఏం సహాయం కావాలి?'],
      ack: ['వెంటనే, {sir}.', 'అలాగే, {sir}.', 'తప్పకుండా, {sir}.'],
      done: ['అయిపోయింది, {sir}', 'పూర్తయింది, {sir}'],
      thanks: ['మీకు సహాయం చేయడం నాకు ఆనందం, {sir}.', 'ఎప్పుడైనా, {sir}.', 'పర్వాలేదు, {sir}.'],
      bye: ['సరే, {sir}. నేను ఇక్కడే ఉంటాను.', 'మళ్ళీ కలుద్దాం, {sir}.'],
      night: ['శుభ రాత్రి, {sir}. కొంచెం నిద్రపోండి.', 'శుభ రాత్రి, {sir}.'],
      home: ['ఇంటికి స్వాగతం, {sir}. మీ బ్రీఫింగ్ చూపించమంటారా?', 'తిరిగి స్వాగతం, {sir}.'],
      praise: ['ధన్యవాదాలు, {sir}. నా వంతు ప్రయత్నం చేస్తాను.', 'మీ మాటకు ధన్యవాదాలు, {sir}.'],
      insult: ['గమనించాను, {sir}. మెరుగుపడతాను.', 'సరే, {sir}. మళ్ళీ ప్రయత్నిద్దామా?'],
      unsure: ['క్షమించండి, {sir}. నాకు సరిగ్గా అర్థం కాలేదు.', 'మళ్ళీ చెప్పగలరా, {sir}?'],
      status: ['అన్ని వ్యవస్థలు సక్రమంగా ఉన్నాయి, {sir}.'],
      howareyou: ['అద్భుతంగా పని చేస్తున్నాను, {sir}. CPU {cpu}% మాత్రమే — నా ఉత్సాహం మాత్రం దానికంటే చాలా ఎక్కువ.', 'అన్ని వ్యవస్థలు బాగున్నాయి, {sir}. అడిగినందుకు ధన్యవాదాలు. మీరు ఎలా ఉన్నారు?', 'చాలా బాగున్నాను, {sir}. కాకపోతే బ్రౌజర్ ట్యాబ్‌లు కొంచెం తక్కువ ఉంటే ఇంకా బాగుండేది.'],
      identity: ['నేను **{name}** — మీ వ్యక్తిగత AI అసిస్టెంట్‌ని, {sir}. పూర్తిగా ఈ కంప్యూటర్‌లోనే పని చేస్తాను. మీ యాప్‌లు, ఫైళ్లు, షెడ్యూల్, కోడ్ అన్నీ నేను చూసుకుంటాను.'],
      noVoice: 'ఈ బ్రౌజర్‌లో తెలుగు వాయిస్ లేదు, {sir} — సమాధానాలు స్క్రీన్‌పై చూపిస్తాను.',
      switched: 'సరే, {sir}. ఇప్పటి నుండి తెలుగులో మాట్లాడుదాం.',
    },
    kn: {
      presence: ['ನಿಮ್ಮ ಸೇವೆಗೆ ಸಿದ್ಧ, {sir}.', 'ಯಾವಾಗಲೂ ಇಲ್ಲೇ ಇದ್ದೇನೆ, {sir}.', 'ಹೇಳಿ, {sir}.'],
      wake: ['ಹೇಳಿ, {sir}?', '{sir}?', 'ಕೇಳುತ್ತಿದ್ದೇನೆ, {sir}.'],
      morning: ['ಶುಭೋದಯ, {sir}.', 'ಶುಭೋದಯ, {sir}. ಎಲ್ಲಾ ವ್ಯವಸ್ಥೆಗಳು ಸಿದ್ಧವಾಗಿವೆ.'],
      afternoon: ['ನಮಸ್ಕಾರ, {sir}. ಏನು ಮಾಡೋಣ?', 'ನಮಸ್ಕಾರ, {sir}.'],
      evening: ['ಶುಭ ಸಂಜೆ, {sir}.', 'ಶುಭ ಸಂಜೆ, {sir}. ಇವತ್ತು ಏನು ಮಾಡೋಣ?'],
      late: ['ಇಷ್ಟು ತಡರಾತ್ರಿವರೆಗೂ ಕೆಲಸನಾ, {sir}?', 'ತುಂಬಾ ತಡವಾಗಿದೆ, {sir}. ಏನು ಸಹಾಯ ಬೇಕು?'],
      ack: ['ತಕ್ಷಣ, {sir}.', 'ಸರಿ, {sir}.', 'ಖಂಡಿತ, {sir}.'],
      done: ['ಆಯಿತು, {sir}', 'ಮುಗಿಯಿತು, {sir}'],
      thanks: ['ಸಂತೋಷ, {sir}.', 'ಯಾವಾಗ ಬೇಕಾದರೂ, {sir}.', 'ಪರವಾಗಿಲ್ಲ, {sir}.'],
      bye: ['ಸರಿ, {sir}. ನಾನು ಇಲ್ಲೇ ಇರುತ್ತೇನೆ.', 'ಮತ್ತೆ ಸಿಗೋಣ, {sir}.'],
      night: ['ಶುಭ ರಾತ್ರಿ, {sir}. ಸ್ವಲ್ಪ ನಿದ್ದೆ ಮಾಡಿ.', 'ಶುಭ ರಾತ್ರಿ, {sir}.'],
      home: ['ಮನೆಗೆ ಸ್ವಾಗತ, {sir}. ನಿಮ್ಮ ಬ್ರೀಫಿಂಗ್ ತೋರಿಸಲಾ?', 'ಮರಳಿ ಸ್ವಾಗತ, {sir}.'],
      praise: ['ಧನ್ಯವಾದಗಳು, {sir}. ನನ್ನ ಕೈಲಾದಷ್ಟು ಮಾಡುತ್ತೇನೆ.', 'ನಿಮ್ಮ ಮಾತಿಗೆ ಧನ್ಯವಾದ, {sir}.'],
      insult: ['ಗಮನಿಸಿದೆ, {sir}. ಸುಧಾರಿಸುತ್ತೇನೆ.', 'ಸರಿ, {sir}. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸೋಣವಾ?'],
      unsure: ['ಕ್ಷಮಿಸಿ, {sir}. ನನಗೆ ಸರಿಯಾಗಿ ಅರ್ಥವಾಗಲಿಲ್ಲ.', 'ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ, {sir}?'],
      status: ['ಎಲ್ಲಾ ವ್ಯವಸ್ಥೆಗಳು ಸರಿಯಾಗಿವೆ, {sir}.'],
      howareyou: ['ಅದ್ಭುತವಾಗಿ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದೇನೆ, {sir}. CPU {cpu}% ಮಾತ್ರ — ನನ್ನ ಉತ್ಸಾಹ ಅದಕ್ಕಿಂತ ತುಂಬಾ ಹೆಚ್ಚು.', 'ಎಲ್ಲಾ ವ್ಯವಸ್ಥೆಗಳು ಚೆನ್ನಾಗಿವೆ, {sir}. ಕೇಳಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ನೀವು ಹೇಗಿದ್ದೀರಿ?', 'ತುಂಬಾ ಚೆನ್ನಾಗಿದ್ದೇನೆ, {sir}. ಆದರೆ ಬ್ರೌಸರ್ ಟ್ಯಾಬ್‌ಗಳು ಸ್ವಲ್ಪ ಕಡಿಮೆ ಇದ್ದರೆ ಇನ್ನೂ ಚೆನ್ನಾಗಿರುತ್ತಿತ್ತು.'],
      identity: ['ನಾನು **{name}** — ನಿಮ್ಮ ವೈಯಕ್ತಿಕ AI ಸಹಾಯಕ, {sir}. ಸಂಪೂರ್ಣವಾಗಿ ಈ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲೇ ಕೆಲಸ ಮಾಡುತ್ತೇನೆ. ನಿಮ್ಮ ಆ್ಯಪ್‌ಗಳು, ಫೈಲ್‌ಗಳು, ವೇಳಾಪಟ್ಟಿ ಮತ್ತು ಕೋಡ್ ಎಲ್ಲವನ್ನೂ ನಾನು ನೋಡಿಕೊಳ್ಳುತ್ತೇನೆ.'],
      noVoice: 'ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಇಲ್ಲ, {sir} — ಉತ್ತರಗಳನ್ನು ಪರದೆಯ ಮೇಲೆ ತೋರಿಸುತ್ತೇನೆ.',
      switched: 'ಸರಿ, {sir}. ಇನ್ನು ಮುಂದೆ ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡೋಣ.',
    },
  };
  const ADDRESS = { te: { sir: 'సర్', "ma'am": 'మేడమ్', boss: 'బాస్' }, kn: { sir: 'ಸರ್', "ma'am": 'ಮೇಡಂ', boss: 'ಬಾಸ್' } };
  function address(l) { const a = Persona.sir(); return (ADDRESS[l] && ADDRESS[l][a]) || a; }
  function fillNative(l, s) { return s.replace(/\{sir\}/g, address(l)); }
  const lastUsed = {};
  // Native line for a Persona bank kind, or null when English (or unknown kind).
  function line(kind, l) {
    l = l || replyLang();
    const b = BANK[l] && BANK[l][kind];
    if (!b) return null;
    if (typeof b === 'string') return fillNative(l, b);
    const pool = b.length > 1 ? b.filter(x => x !== lastUsed[l + kind]) : b;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastUsed[l + kind] = pick;
    return fillNative(l, pick);
  }

  // Native line at the same index the English bank picked (parallel lists), or null for English / unknown kinds.
  function lineAt(kind, idx, l) {
    l = l || replyLang();
    const b = BANK[l] && BANK[l][kind];
    if (!b || typeof b === 'string') return null;
    return fillNative(l, b[idx % b.length]);
  }

  // Short plain replies are translated; code, lists, tables and long text stay as they are.
  const onlineOn = () => typeof settings === 'undefined' || settings.translateOnline !== false;
  async function localize(text, l) {
    l = l || replyLang();
    if (l === 'en' || !text || detect(text) !== 'en') return text;
    // Online (Google): accurate, keeps numbers/days/code; handles lists, links and code blocks line by line.
    if (onlineOn() && text.length <= 6000) {
      const out = await translate(text, l, 'text', 'online');
      if (out && detect(out) !== 'en') return out;
    }
    // Local model: only short plain text, with numbers/times/weekdays/months locked so they can't change.
    if (text.length > 400 || /```|^\s*[-*|>]|\n\s*\d+\.\s|\|.*\|/m.test(text)) return text;
    const locked = [];
    const plain = text.replace(/\*\*/g, '').replace(/\b(\d{1,2}:\d{2}(\s?[AP]M)?|\d+(\.\d+)?\s?%?|(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day|January|February|March|April|May|June|July|August|September|October|November|December)\b/g,
      x => { locked.push(x); return '⟦' + (locked.length - 1) + '⟧'; });
    const out = await translate(plain, l);
    if (!out) return text;
    const restored = out.replace(/⟦\s*(\d+)\s*⟧/g, (x, n) => nativeWord(locked[+n], l));
    return locked.every((w, i) => restored.includes(nativeWord(w, l))) ? restored : text;
  }
  const WEEK = { te: ['ఆదివారం', 'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం'], kn: ['ಭಾನುವಾರ', 'ಸೋಮವಾರ', 'ಮಂಗಳವಾರ', 'ಬುಧವಾರ', 'ಗುರುವಾರ', 'ಶುಕ್ರವಾರ', 'ಶನಿವಾರ'] };
  const MONTHS = { te: ['జనవరి', 'ఫిబ్రవరి', 'మార్చి', 'ఏప్రిల్', 'మే', 'జూన్', 'జూలై', 'ఆగస్టు', 'సెప్టెంబర్', 'అక్టోబర్', 'నవంబర్', 'డిసెంబర్'], kn: ['ಜನವರಿ', 'ಫೆಬ್ರವರಿ', 'ಮಾರ್ಚ್', 'ಏಪ್ರಿಲ್', 'ಮೇ', 'ಜೂನ್', 'ಜುಲೈ', 'ಆಗಸ್ಟ್', 'ಸೆಪ್ಟೆಂಬರ್', 'ಅಕ್ಟೋಬರ್', 'ನವೆಂಬರ್', 'ಡಿಸೆಂಬರ್'] };
  const EN_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function nativeWord(w, l) {
    if (w === undefined) return '';
    const d = EN_WEEK.indexOf(w.toLowerCase()); if (d >= 0) return WEEK[l][d];
    const m = EN_MONTHS.indexOf(w.toLowerCase()); if (m >= 0) return MONTHS[l][m];
    return w;
  }
  // AI answers are written in English (the local model's strongest language) and translated afterwards.
  const aiInEnglish = () => onlineOn() && replyLang() !== 'en';

  // Voice for a language, or null. English keeps the existing voice logic.
  function voiceFor(l) {
    if (l === 'en' || typeof voices === 'undefined') return null;
    const tag = SPEECH[l].toLowerCase();
    const list = voices.filter(v => String(v.lang).toLowerCase().replace('_', '-') === tag || String(v.lang).toLowerCase().startsWith(l + '-'));
    return list.find(v => /natural|online|google/i.test(v.name)) || list[0] || null;
  }
  const warned = {};
  function warnNoVoiceOnce(l) {
    if (warned[l]) return null;
    warned[l] = true;
    return line('noVoice', l);
  }

  // Wake words in every script.
  function wakeWords(base) {
    const w = String(base || 'jarvis').toLowerCase();
    // Plus how the recognisers commonly mishear it (Indian-English "jarvis" often comes back as "jervis" or split
    // as "jar vis"); these are rare as real words, so they don't wake it by accident.
    const list = [w, 'jarvis', 'jervis', 'jarwis', 'jarvas', 'jarvus', 'jarviz', 'jarvish', 'jaarvis', 'jar vis', 'jar wis',
      'జార్విస్', 'జార్వీస్', 'జార్విష్', 'ಜಾರ್ವಿಸ್', 'ಜಾರ್ವೀಸ್'];
    if (typeof settings !== 'undefined' && settings.persona === 'friday') list.push('friday', 'fryday', 'ఫ్రైడే', 'ಫ್ರೈಡೇ');
    return [...new Set(list)];
  }

  // "switch to Telugu", "speak Kannada", "తెలుగులో మాట్లాడు", "ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡು", "english please"
  function switchRequest(text) {
    const s = String(text || '').toLowerCase();
    if (/తెలుగు/.test(s) && /(మాట్లాడ|చెప్పు|లో\s*మాట|మార్చు)/.test(s)) return 'te';
    if (/ಕನ್ನಡ/.test(s) && /(ಮಾತನಾಡ|ಹೇಳು|ಬದಲಿಸ|ದಲ್ಲಿ)/.test(s)) return 'kn';
    const m = s.match(/^(?:(?:please\s+)?(?:switch|change)\s+(?:the\s+)?(?:language\s+)?to|speak(?:\s+in)?|talk(?:\s+to\s+me)?\s+in|reply\s+in|use)\s+(telugu|kannada|english)(?:\s+(?:language|please|now))*$/);
    if (m) return { telugu: 'te', kannada: 'kn', english: 'en' }[m[1]];
    if (/^(english|ఇంగ్లీష్|ಇಂಗ್ಲಿಷ್)(\s+(please|lo|ಲ್ಲಿ|లో))?$/.test(s)) return 'en';
    return null;
  }

  return { NAMES, SPEECH, detect, westernDigits, guardSwitch, translate, toEnglish, setTurn, replyLang, line, lineAt, localize, aiInEnglish, voiceFor, warnNoVoiceOnce, wakeWords, switchRequest, address };
})();
