'use strict';
/* JARVIS natural-language layer: normalize → classify (rules + fuzzy) → args. */
const NLU = (() => {
  /* ---------- catalogues ---------- */
  const APPS = [
    { k: 'chrome', n: 'Google Chrome', names: ['chrome', 'google chrome'] },
    { k: 'firefox', n: 'Firefox', names: ['firefox', 'mozilla'] },
    { k: 'edge', n: 'Microsoft Edge', names: ['edge', 'microsoft edge'] },
    { k: 'brave', n: 'Brave', names: ['brave'] },
    { k: 'vscode', n: 'VS Code', names: ['vs code', 'vscode', 'visual studio code', 'code editor'] },
    { k: 'notepad', n: 'Notepad', names: ['notepad'] },
    { k: 'terminal', n: 'Terminal', names: ['terminal', 'windows terminal'] },
    { k: 'cmd', n: 'Command Prompt', names: ['command prompt', 'cmd'] },
    { k: 'powershell', n: 'PowerShell', names: ['powershell'] },
    { k: 'calculator', n: 'Calculator', names: ['calculator', 'calc'] },
    { k: 'explorer', n: 'File Explorer', names: ['file explorer', 'explorer', 'file manager', 'my computer', 'this pc'] },
    { k: 'calendar', n: 'Calendar', names: ['calendar'] },
    { k: 'outlook', n: 'Outlook', names: ['outlook', 'mail app', 'email app'] },
    { k: 'word', n: 'Word', names: ['ms word', 'microsoft word', 'word'] },
    { k: 'excel', n: 'Excel', names: ['excel', 'spreadsheet'] },
    { k: 'powerpoint', n: 'PowerPoint', names: ['powerpoint', 'ppt'] },
    { k: 'spotify', n: 'Spotify', names: ['spotify'] },
    { k: 'discord', n: 'Discord', names: ['discord'] },
    { k: 'whatsapp', n: 'WhatsApp', names: ['whatsapp', 'whats app'] },
    { k: 'slack', n: 'Slack', names: ['slack'] },
    { k: 'zoom', n: 'Zoom', names: ['zoom'] },
    { k: 'teams', n: 'Teams', names: ['teams', 'microsoft teams', 'ms teams'] },
    { k: 'steam', n: 'Steam', names: ['steam'] },
    { k: 'paint', n: 'Paint', names: ['paint', 'mspaint', 'ms paint'] },
    { k: 'task manager', n: 'Task Manager', names: ['task manager', 'taskmgr'] },
    { k: 'settings', n: 'Settings', names: ['settings', 'control panel', 'windows settings'] },
    { k: 'camera', n: 'Camera', names: ['camera', 'webcam'] },
    { k: 'snipping tool', n: 'Snipping Tool', names: ['snipping tool', 'snip'] },
    { k: 'intellij', n: 'IntelliJ IDEA', names: ['intellij', 'intellij idea', 'idea'] },
    { k: 'pycharm', n: 'PyCharm', names: ['pycharm'] },
    { k: 'android studio', n: 'Android Studio', names: ['android studio'] },
    { k: 'postman', n: 'Postman', names: ['postman'] },
    { k: 'obs', n: 'OBS Studio', names: ['obs', 'obs studio'] },
    { k: 'vlc', n: 'VLC', names: ['vlc', 'vlc player'] },
    { k: 'antigravity', n: 'Antigravity', names: ['antigravity', 'agy'] },
  ];
  const SITES = [
    { n: 'YouTube', url: 'https://www.youtube.com', names: ['youtube', 'yt'], q: 'https://www.youtube.com/results?search_query=' },
    { n: 'Google', url: 'https://www.google.com', names: ['google'], q: 'https://www.google.com/search?q=' },
    { n: 'Gmail', url: 'https://mail.google.com', names: ['gmail', 'my mail', 'my email', 'email', 'mail'] },
    { n: 'GitHub', url: 'https://github.com', names: ['github', 'git hub'], q: 'https://github.com/search?q=' },
    { n: 'LeetCode', url: 'https://leetcode.com/problemset/', names: ['leetcode', 'leet code'], q: 'https://leetcode.com/problemset/?search=' },
    { n: 'GeeksforGeeks', url: 'https://www.geeksforgeeks.org', names: ['geeksforgeeks', 'geeks for geeks', 'gfg'], q: 'https://www.geeksforgeeks.org/search/?gq=' },
    { n: 'Stack Overflow', url: 'https://stackoverflow.com', names: ['stack overflow', 'stackoverflow'], q: 'https://stackoverflow.com/search?q=' },
    { n: 'MDN', url: 'https://developer.mozilla.org', names: ['mdn', 'mozilla docs'], q: 'https://developer.mozilla.org/en-US/search?q=' },
    { n: 'Python docs', url: 'https://docs.python.org/3/', names: ['python docs', 'python documentation'], q: 'https://docs.python.org/3/search.html?q=' },
    { n: 'W3Schools', url: 'https://www.w3schools.com', names: ['w3schools', 'w3 schools'] },
    { n: 'HackerRank', url: 'https://www.hackerrank.com', names: ['hackerrank', 'hacker rank'] },
    { n: 'Codeforces', url: 'https://codeforces.com', names: ['codeforces', 'code forces'] },
    { n: 'CodeChef', url: 'https://www.codechef.com', names: ['codechef', 'code chef'] },
    { n: 'Kaggle', url: 'https://www.kaggle.com', names: ['kaggle'] },
    { n: 'Coursera', url: 'https://www.coursera.org', names: ['coursera'] },
    { n: 'Google Classroom', url: 'https://classroom.google.com', names: ['google classroom', 'classroom'] },
    { n: 'Google Drive', url: 'https://drive.google.com', names: ['google drive', 'drive'] },
    { n: 'Google Docs', url: 'https://docs.google.com', names: ['google docs', 'docs'] },
    { n: 'Google Maps', url: 'https://maps.google.com', names: ['google maps', 'maps'], q: 'https://www.google.com/maps/search/' },
    { n: 'ChatGPT', url: 'https://chatgpt.com', names: ['chatgpt', 'chat gpt'] },
    { n: 'Claude', url: 'https://claude.ai', names: ['claude'] },
    { n: 'Notion', url: 'https://www.notion.so', names: ['notion'] },
    { n: 'LinkedIn', url: 'https://www.linkedin.com', names: ['linkedin', 'linked in'] },
    { n: 'Instagram', url: 'https://www.instagram.com', names: ['instagram', 'insta'] },
    { n: 'X', url: 'https://x.com', names: ['twitter', 'x.com'] },
    { n: 'Reddit', url: 'https://www.reddit.com', names: ['reddit'], q: 'https://www.reddit.com/search/?q=' },
    { n: 'Wikipedia', url: 'https://en.wikipedia.org', names: ['wikipedia', 'wiki'], q: 'https://en.wikipedia.org/w/index.php?search=' },
    { n: 'Netflix', url: 'https://www.netflix.com', names: ['netflix'] },
    { n: 'Amazon', url: 'https://www.amazon.in', names: ['amazon'], q: 'https://www.amazon.in/s?k=' },
    { n: 'Flipkart', url: 'https://www.flipkart.com', names: ['flipkart'], q: 'https://www.flipkart.com/search?q=' },
    { n: 'WhatsApp Web', url: 'https://web.whatsapp.com', names: ['whatsapp web'] },
    { n: 'Figma', url: 'https://www.figma.com', names: ['figma'] },
    { n: 'Smart India Hackathon', url: 'https://www.sih.gov.in', names: ['sih', 'smart india hackathon', 'sih website', 'sih portal'] },
    { n: 'Unstop', url: 'https://unstop.com/hackathons', names: ['unstop', 'dare2compete'] },
    { n: 'Devfolio', url: 'https://devfolio.co/hackathons', names: ['devfolio'] },
    { n: 'Devpost', url: 'https://devpost.com/hackathons', names: ['devpost'] },
    { n: 'HackerEarth', url: 'https://www.hackerearth.com/challenges/', names: ['hackerearth', 'hacker earth'] },
    { n: 'Internshala', url: 'https://internshala.com', names: ['internshala'] },
    { n: 'NPTEL', url: 'https://nptel.ac.in', names: ['nptel'] },
    { n: 'SWAYAM', url: 'https://swayam.gov.in', names: ['swayam'] },
    { n: 'AtCoder', url: 'https://atcoder.jp', names: ['atcoder', 'at coder'] },
    { n: 'GitHub Education', url: 'https://education.github.com/pack', names: ['github student pack', 'student developer pack', 'github education'] },
    { n: 'Codolio', url: 'https://codolio.com', names: ['codolio'] },
  ];

  /* ---------- text utils ---------- */
  const TYPOS = {
    crome: 'chrome', chorme: 'chrome', chrom: 'chrome', gogle: 'google', googel: 'google', youtub: 'youtube', utube: 'youtube',
    yotube: 'youtube', youtbe: 'youtube', spotfy: 'spotify', spotifi: 'spotify', notpad: 'notepad', notepadd: 'notepad',
    calculater: 'calculator', calulator: 'calculator', whatsap: 'whatsapp', watsapp: 'whatsapp', discrod: 'discord',
    vscod: 'vscode', 'vs-code': 'vs code', 'v s code': 'vs code', 'visual code': 'vs code', 'screen shot': 'screenshot',
    screenshoot: 'screenshot', wether: 'weather', weathr: 'weather', temprature: 'temperature', remaind: 'remind', rimind: 'remind',
    remid: 'remind', tommorow: 'tomorrow', tomorow: 'tomorrow', tmrw: 'tomorrow', tmr: 'tomorrow', tonite: 'tonight',
    plz: 'please', pls: 'please', u: 'you', ur: 'your', r: 'are', wat: 'what', wats: "what's", whats: "what's", hw: 'how',
    thx: 'thanks', ty: 'thanks', thanku: 'thanks', 'thank u': 'thanks', abt: 'about', msg: 'message', lemme: 'let me',
    gimme: 'give me', wanna: 'want to', gonna: 'going to', vol: 'volume', volum: 'volume', batery: 'battery', battry: 'battery',
    asignment: 'assignment', assigment: 'assignment', assignmnt: 'assignment', deadine: 'deadline', todo: 'to-do', 'to do': 'to-do',
    pomodro: 'pomodoro', leetcod: 'leetcode', githb: 'github', explian: 'explain', expalin: 'explain', clipbaord: 'clipboard',
    'two-day list': 'to-do list', 'two day list': 'to-do list', 'two-do list': 'to-do list', 'two do list': 'to-do list',
    tel: 'tell', 'turn of': 'turn off', 'switch of': 'switch off', 'swich of': 'switch off', tym: 'time', lok: 'lock', strt: 'start', timr: 'timer',hru: 'how are you', 'how r u': 'how are you', 'dark mod': 'dark mode',
    'light mod': 'light mode', reed: 'read', remnd: 'remind', rmnd: 'remind', finsh: 'finish', stp: 'stop', opn: 'open', clos: 'close',
    cls: 'close', scrn: 'screen', ss: 'screenshot', brt: 'brightness', blutooth: 'bluetooth', wify: 'wifi', 'wi-fi': 'wifi',
    min: 'minute', mins: 'minutes', sec: 'second', secs: 'seconds', hr: 'hour', hrs: 'hours',
  };
  const NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function wordsToNumbers(s) {
    s = s.replace(/\bhalf an? hour\b/g, '30 minutes').replace(/\bhalf a minute\b/g, '30 seconds')
      .replace(/\b(a )?quarter of an hour\b/g, '15 minutes').replace(/\ban hour and a half\b/g, '90 minutes')
      .replace(/\ba couple( of)?\b/g, '2').replace(/\ba few\b/g, '3')
      .replace(/\b(a|an) (second|minute|hour|day|week)\b/g, '1 $2');
    const tensRe = Object.keys(TENS).join('|'), onesRe = Object.keys(NUMW).join('|');
    s = s.replace(new RegExp(`\\b(${tensRe})[\\s-](${onesRe})\\b`, 'g'), (_, t, o) => String(TENS[t] + NUMW[o]));
    s = s.replace(new RegExp(`\\b(${tensRe})\\b`, 'g'), (_, t) => String(TENS[t]));
    s = s.replace(new RegExp(`\\b(${onesRe})\\b(?!-)`, 'g'), (_, o) => String(NUMW[o]));
    s = s.replace(/\b(\d+) hundred\b/g, (_, n) => String(+n * 100));
    return s;
  }

  // "well" is filler in "well, open chrome" but the whole point of "well done".
  const LEAD_FILLER = /^(ok(ay)?|so|um+|uh+|hmm+|yo|hey|hi|well(?! done\b)|alright|right|listen|oh|buddy|bro|dude|sir|now|and)\b[\s,!.]*/;
  const LEAD_POLITE = /^(can|could|would|will) you( please| kindly| just)?|^(please|kindly|just)\b|^i (want|need) you to|^i('d| would) like (you )?to|^(go ahead and|help me( to)?|try to|be a dear and)\b|^(do me a favou?r( and)?)\b/;
  // "jarvis" at the end is dropped as an address ("open chrome, jarvis") — but kept when it names a folder ("… in jarvis").
  const TRAIL = /[\s,]*(please|for me|right now|real quick|quickly|thanks|thank you|asap|(?<!\b(?:in|on|for|inside|to|of|from|the|my))\s+jarvis|buddy|bro|sir|ok(ay)?)[\s.!?]*$/;

  function normalize(raw, wakeWord) {
    let s = String(raw || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim();
    const original = s;
    s = s.toLowerCase();
    if (wakeWord) s = s.replace(new RegExp(`^(hey |ok |okay |hi )?${esc(wakeWord.toLowerCase())}\\b[\\s,!.]*`), '');
    for (const [bad, good] of Object.entries(TYPOS)) s = s.replace(new RegExp(`(^|[^\\w'])${esc(bad)}(?=$|[^\\w'])`, 'g'), `$1${good}`);
    s = s.replace(/\b(bluetooth|wifi|mode|display|screen|lights?|sound|volume|notifications|it) of$/, '$1 off');
    s = wordsToNumbers(s);
    const isGreetingOnly = /^(hi|hello|hey|yo|hii+|helo|hola|namaste|good (morning|afternoon|evening|night))[\s!.]*$/.test(s);
    if (!isGreetingOnly) {
      for (let i = 0; i < 4; i++) {
        const before = s;
        s = s.replace(LEAD_FILLER, '').replace(LEAD_POLITE, '').trim();
        if (s === before) break;
      }
      for (let i = 0; i < 3; i++) { const b = s; s = s.replace(TRAIL, '').trim(); if (s === b) break; }
    }
    s = s.replace(/[?!]+$/, '').replace(/\.$/, '').replace(/\s+/g, ' ').trim();
    return { text: s || original.toLowerCase(), original, wake: (wakeWord || 'jarvis').toLowerCase() };
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  // Finds the best entry whose name appears in s — exact word match first, then typo-tolerant (unless exactOnly).
  function fuzzyFind(s, entries, exactOnly) {
    let best = null, bestScore = -1;
    for (const e of entries) for (const name of e.names) {
      const re = new RegExp(`(^|[^a-z])${esc(name)}($|[^a-z])`);
      if (re.test(s) && name.length > bestScore) { best = e; bestScore = name.length; }
    }
    if (best || exactOnly) return best;
    const words = s.split(/[^a-z0-9.]+/).filter(Boolean);
    const grams = [];
    for (let i = 0; i < words.length; i++) for (let k = 1; k <= 3 && i + k <= words.length; k++) grams.push(words.slice(i, i + k).join(' '));
    let bestD = 99;
    for (const e of entries) for (const name of e.names) {
      if (name.length < 4) continue;
      const tol = name.length <= 5 ? 1 : 2;
      for (const g of grams) {
        const d = lev(g, name);
        if (d <= tol && d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }
  // Apps installed on this laptop (the Start menu, discovered by the server): matched by exact name only — no typo
  // guessing, so a misspelt site can't launch a random app — and the fixed list and websites always win.
  let INSTALLED = [];
  const appName = s => String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
  function setInstalledApps(names) {
    const fixed = new Set(APPS.flatMap(a => a.names)), sites = new Set(SITES.flatMap(x => x.names));
    const taken = n => fixed.has(n) || sites.has(n);
    INSTALLED = (names || []).map(n => {
      const full = appName(n);
      const short = full.replace(/\b\d+( \d+)*\b/g, ' ').replace(/\b(desktop|app|launcher|workplace|client|community edition|ce|ide|64 bit|32 bit|x86)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const aliases = [full]; if (short && short !== full && short.length >= 3 && !taken(short)) aliases.push(short);
      return { k: 'app:' + String(n).toLowerCase(), n: String(n), names: aliases, installed: true };
    }).filter(e => e.names[0].length >= 3 && !e.names.some(taken));
  }
  const findApp = s => fuzzyFind(s, APPS) || fuzzyFind(s, INSTALLED, true);
  const appByKey = k => APPS.find(a => a.k === k) || INSTALLED.find(a => a.k === k) || null;
  const findSite = s => fuzzyFind(s, SITES);
  // "open vs code in X", "open vs code with X", "open vs code at the X folder", "open vs code and the directory should
  // be X folder", "launch vs code, folder X" → { folder: 'X' }. Needs a word that ties the folder to the editor
  // (in/with/at/inside…, or "and the folder/directory/project…"), so "open vs code and start a focus session" stays two
  // commands. A folder that starts like a command ("start…", "set…") is rejected for the same reason.
  const EDITOR = '(?:vs ?code|vscode|visual studio code|code editor|my editor|the editor|cursor)';
  function editorFolder(s) {
    s = String(s || '').toLowerCase().trim().replace(/[.!?]+$/, '');
    const m = new RegExp('^(?:please\\s+)?(?:open|launch|start|fire up|run|load)\\s+(?:up\\s+)?' + EDITOR + '\\b(?:\\s+(?:in|with|at|inside|on|for|using|to)\\s+|\\s*,\\s*(?:and\\s+)?(?:the\\s+|my\\s+)?(?=(?:directory|folder|project|workspace)\\b)|\\s+and\\s+(?:the\\s+|my\\s+)?(?=(?:directory|folder|project|workspace)\\b))(.+)$').exec(s);
    if (!m) return null;
    const folder = m[1].trim()
      .replace(/^(?:the\s+|my\s+)/, '')
      .replace(/^(?:directory|folder|project|workspace|path)\b\s*/, '')
      .replace(/^(?:should be|should be in|must be|to be|is|as|=|named|called|of)\s+/, '')
      .replace(/^(?:the\s+|my\s+)/, '')
      .replace(/\s+(?:folder|directory|project|workspace)$/, '').trim();
    if (!folder || folder.split(' ').length > 6 || /^(?:start|set|open|close|play|search|run|add|remind|tell|ask|create|make)\b/.test(folder)) return null;
    return { folder };
  }
  // Picks the search result that best matches what was asked: the EARLIEST result containing the MOST of your words.
  // The search engine's order stays in charge unless a lower result clearly matches more of what you said —
  // "atria university website": Bing ranks Atria Institute of Technology first (only "atria"), but
  // atriauniversity.edu.in has both words, so it wins. Review/aggregator and social sites (collegedunia, shiksha,
  // wikipedia, youtube…) count half a word less, so an official site beats a listing of it. null = nothing matches.
  const GENERIC_Q = /^(the|and|for|with|from|open|website|websites|site|page|webpage|official|portal|online|home|homepage|web|link|login|my|your|of|in|on|to)$/;
  const AGGREGATOR = /(^|\.)(collegedunia|shiksha|careers360|collegedekho|getmyuni|justdial|indiatoday|jagranjosh|wikipedia|quora|reddit|facebook|instagram|linkedin|youtube|twitter|x|glassdoor|ambitionbox|naukri|images\.google|google|bing)\.[a-z.]+$/;
  // Words many institutions and pages share. A result must contain the NAME ("reva", "nptel", "atria"), not just
  // these — "reva university website" once opened Lucknow University because "university" matched.
  const COMMON_Q = /^(university|universities|college|colleges|institute|institution|technology|engineering|school|academy|course|courses|class|results?|admissions?|exams?|india|indian|national|international|management|sciences?|research|centre|center|campus|department|bangalore|bengaluru|hyderabad|chennai|mumbai|delhi|pune|mysore|mysuru|karnataka|telangana|kerala)$/;
  function bestResult(results, query) {
    const words = String(query || '').toLowerCase().split(/[^a-z0-9+#]+/).filter(w => w.length >= 3 && !GENERIC_Q.test(w));
    if (!words.length) return (results || [])[0] || null;
    const names = words.filter(w => !COMMON_Q.test(w));
    let best = null, bestScore = 0;
    (results || []).slice(0, 8).forEach(r => {
      const hay = (String(r.title || '') + ' ' + String(r.url || '')).toLowerCase();
      let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
      if (names.length && !names.some(w => hay.includes(w))) return;     // doesn't mention the name at all
      const found = words.filter(w => hay.includes(w)).length;
      const score = found - (AGGREGATOR.test(host) ? 0.5 : 0);
      if (found && score > bestScore) { best = r; bestScore = score; }   // strictly greater: ties keep search order
    });
    return best;
  }
  // "the SIH official website" → "sih": the words people add after a site's name, never part of it.
  const bareSiteName = s => String(s || '').toLowerCase().trim().replace(/^(the|my)\s+/, '').replace(/^official\s+/, '')
    .replace(/(\s+(official|main))?\s+(website|web ?site|site|homepage|home ?page|portal|page|web ?page)$/, '').trim();

  /* ---------- coding-AI tools: "open X in Y and ask Z to …" ---------- */
  // Canonical keys match codetools.js's registry on the server. Longer/more specific aliases are tried first so
  // "claude code" doesn't get cut short by "code", and "antigravity ide" doesn't get cut short by "antigravity".
  const CODE_ASK_TOOLS = [
    { key: 'vscode', words: ['visual studio code', 'vs code', 'vscode', 'copilot'] },
    { key: 'kiro', words: ['kiro'] },
    { key: 'trae', words: ['trae'] },
    { key: 'antigravity', words: ['antigravity ide', 'antigravity'] },
    { key: 'devin', words: ['devin', 'windsurf'] },
    { key: 'opencode', words: ['opencode', 'open code'] },
    { key: 'claude', words: ['claude code', 'claude'] },
    { key: 'gemini', words: ['gemini'] },
    { key: 'codex', words: ['codex'] },
    { key: 'qwen', words: ['qwen'] },
    { key: 'codebuff', words: ['codebuff', 'free buff', 'freebuff'] },
  ];
  const resolveCodeTool = phrase => {
    const s = String(phrase || '').toLowerCase().trim();
    for (const t of CODE_ASK_TOOLS) for (const w of t.words) if (s === w || s.includes(w)) return t.key;
    return null;
  };
  const CODE_TOOL_ALT = CODE_ASK_TOOLS.flatMap(t => t.words).sort((a, b) => b.length - a.length).map(esc).join('|');
  const CODE_TOOL_RE = `(${CODE_TOOL_ALT})`;
  // Only ever run against the ORIGINAL, unlowercased, un-wake-word-stripped text, so the prompt keeps its casing
  // (findApp/findSite-style rules test the normalized text; this one is parsed straight from what the user typed).
  function parseCodeAsk(original) {
    const s = String(original || '').trim();
    const P = [
      // "open dsa sprint in vs code and ask copilot to add a test"
      [new RegExp(`\\b(?:open|launch)\\s+(.+?)\\s+in\\s+${CODE_TOOL_RE}\\b(?:\\s+and)?\\s+(?:ask|tell)\\s+(?:it|copilot|them|him|her|[a-z]+)?\\s*to\\s+(.+)$`, 'i'), ['folder', 'tool', 'prompt']],
      // "ask claude in dsa sprint to list the files"
      [new RegExp(`\\bask\\s+${CODE_TOOL_RE}\\s+in\\s+(.+?)\\s+to\\s+(.+)$`, 'i'), ['tool', 'folder', 'prompt']],
      // "in dsa sprint, ask copilot to fix the bug"
      [new RegExp(`\\bin\\s+(.+?),?\\s+ask\\s+${CODE_TOOL_RE}\\s+to\\s+(.+)$`, 'i'), ['folder', 'tool', 'prompt']],
      // "tell kiro to refactor this in dsa sprint"
      [new RegExp(`\\btell\\s+${CODE_TOOL_RE}\\s+to\\s+(.+?)\\s+in\\s+(.+)$`, 'i'), ['tool', 'prompt', 'folder']],
      // "ask claude to add tests" (no folder named — caller falls back to the last project)
      [new RegExp(`\\bask\\s+${CODE_TOOL_RE}\\s+to\\s+(.+)$`, 'i'), ['tool', 'prompt']],
    ];
    for (const [re, groups] of P) {
      const m = re.exec(s);
      if (!m) continue;
      const out = {};
      groups.forEach((g, i) => { out[g] = (m[i + 1] || '').trim(); });
      out.tool = resolveCodeTool(out.tool);
      if (!out.tool || !out.prompt) continue;
      let folder = out.folder || '', prompt = out.prompt;
      // "tell claude to fix the bug in main.py in dsa_sprint folder" → folder dsa_sprint, prompt keeps "in main.py"
      const nested = folder.match(/^(.+?)\s+in\s+(?:the\s+|my\s+)?(.+)$/i);
      if (nested) { prompt += ' in ' + nested[1]; folder = nested[2]; }
      folder = folder.replace(/\s+(?:folder|directory|dir|project|repo)$/i, '').trim();
      return { tool: out.tool, folder, prompt };
    }
    return looseCodeAsk(s);
  }
  // Free-form fallback: "Open vs code in dsa_sprint folder, create main.py and also to copilot tell to write an
  // addition function in main.py". Finds the tool, the folder and the request wherever they are in the sentence.
  function looseCodeAsk(s) {
    // speech often splits file names: "main. py" → "main.py"
    s = s.replace(/\b([\w-]+)\s*\.\s+(py|js|ts|jsx|tsx|cpp|cc|c|h|java|cs|go|rs|rb|php|html|css|json|md|txt|sql|sh|kt|swift|ipynb)\b/gi, '$1.$2');
    const toolRe = new RegExp(`\\b${CODE_TOOL_RE}\\b`, 'gi');
    const hits = [...s.matchAll(toolRe)];
    if (!hits.length || !/\b(ask|tell|have|make|get|let)\b/i.test(s)) return null;
    // the tool that is being asked wins ("open vs code … tell claude to …" → claude), else the first one named
    const asked = hits.find(h => /\b(ask|tell|have|make|get|let)\s+(?:to\s+)?$/i.test(s.slice(Math.max(0, h.index - 12), h.index)) || /^\s+(?:to\s+)?(?:tell|ask)\b/i.test(s.slice(h.index + h[0].length, h.index + h[0].length + 12)));
    if (!asked && !/\b(ask|tell)\b[\s\S]*\bto\b/i.test(s)) return null; // "have you opened vs code?" is not a request
    let tool = resolveCodeTool((asked || hits[0])[0]);
    // "open opencode in X … tell copilot to …": Copilot only lives in VS Code, so when another tool is the one being
    // opened, "copilot" just means "the AI" and the opened tool wins.
    const opened = hits.find(h => /\b(?:open|launch|start|use)\s+(?:up\s+)?(?:the\s+)?$/i.test(s.slice(Math.max(0, h.index - 12), h.index)));
    if (opened && /^copilot$/i.test((asked || hits[0])[0]) && resolveCodeTool(opened[0]) !== 'vscode') tool = resolveCodeTool(opened[0]);
    const T = CODE_TOOL_RE;
    const F = `["']?([\\w][\\w .()-]{0,60}?)["']?`;
    const folderRes = [
      new RegExp(`\\b(?:in|inside|into|at|on|from)\\s+(?:the\\s+|my\\s+)?${F}\\s+(?:folder|directory|dir|project|repo)\\b`, 'i'),
      new RegExp(`\\b(?:open|launch|start)\\s+${T}\\s+(?:in|at|on|for|with)\\s+(?:the\\s+|my\\s+)?${F}(?=\\s*(?:,|\\.|;|$|\\s+(?:and|then|also|to|&)\\b))`, 'i'),
      new RegExp(`\\b(?:open|launch)\\s+(?:the\\s+|my\\s+)?${F}\\s+(?:folder\\s+|project\\s+)?(?:in|with|using)\\s+${T}\\b`, 'i'),
    ];
    let folder = '', span = null;
    for (const re of folderRes) {
      const m = re.exec(s);
      if (!m) continue;
      const name = (m.slice(1).find((g, i) => g && !resolveCodeTool(g) && i >= 0 && !new RegExp(`^${T}$`, 'i').test(g)) || '').trim();
      if (!name || resolveCodeTool(name)) continue;
      folder = name; span = m; break;
    }
    // the request: the sentence minus the "open <tool> in <folder>" part and the "ask/tell <tool> to" connector
    let p = s;
    if (span) p = p.slice(0, span.index) + ' ' + p.slice(span.index + span[0].length);
    p = p.replace(new RegExp(`\\b(?:and\\s+)?(?:also\\s+)?(?:then\\s+)?(?:to\\s+)?(?:please\\s+)?(?:ask|tell|have|make|get|let)\\s+(?:to\\s+)?(?:the\\s+)?${T}\\s+(?:to\\s+)?`, 'gi'), ' and ')
      .replace(new RegExp(`\\b(?:and\\s+)?(?:also\\s+)?(?:then\\s+)?(?:to\\s+)?(?:the\\s+)?${T}\\s+(?:ask|tell)\\s+(?:it\\s+)?(?:to\\s+)?`, 'gi'), ' and ')
      .replace(/\b(?:and\s+)?(?:also\s+)?(?:then\s+)?(?:to\s+)?(?:ask|tell|have|make|get|let)\s+(?:to\s+)?(?:it|them|the\s+ai|ai|the\s+assistant|assistant|the\s+agent|agent|the\s+bot|bot|the\s+model|model)\s+(?:to\s+)?/gi, ' and ')
      .replace(/(?:\s*,?\s*\band\b){2,}/gi, ' and ')
      .replace(new RegExp(`^\\s*(?:please\\s+)?(?:open|launch|start)\\s+(?:up\\s+)?${T}\\b`, 'i'), ' ')
      .replace(/\b(\w+\.(?:py|js|ts|cpp|c|java|go|rs|html|css|md|txt))\s+folder\b/gi, '$1 file')
      .replace(/\s+/g, ' ').replace(/^[\s,.;:&-]*(?:and|also|then|so|,)*(?:\s+(?:and|also|then))*[\s,.;:-]*/i, '').replace(/[\s,;]+$/, '').trim();
    if (!tool || p.split(' ').length < 2) return null;
    return { tool, folder, prompt: p.charAt(0).toUpperCase() + p.slice(1) };
  }
  // The rule's own test only needs "s" (normalized text), so it can sit in the R array like the others.
  const CODE_ASK_RE = new RegExp(`\\b(?:${CODE_TOOL_ALT})\\b`, 'i');
  const ASKED_TOOL_RE = new RegExp(`\\b(?:ask|tell|have|make|get|let)\\s+(?:to\\s+)?(?:the\\s+)?(?:${CODE_TOOL_ALT})\\b|\\b(?:${CODE_TOOL_ALT})\\s+(?:to\\s+)?(?:tell|ask)\\b`, 'i');
  const looksLikeCodeAsk = s => CODE_ASK_RE.test(s) && (/\b(ask|tell)\b[\s\S]*\bto\b/.test(s) || ASKED_TOOL_RE.test(s));

  /* ---------- dates & times ---------- */
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|sday|nesday|rsday|urday)?';
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
  const dayIndex = w => { const p = w.slice(0, 3); return DAYS.findIndex(d => d.startsWith(p)); };

  function parseTimeOfDay(s) {
    if (/\bnoon\b|\bmidday\b/.test(s)) return { h: 12, m: 0, explicit: true };
    if (/\bmidnight\b/.test(s)) return { h: 23, m: 59, explicit: true };
    let m = s.match(/\b(?:at|by|@|around)?\s*(\d{1,2})(?::|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/);
    if (!m) m = s.match(/\b(?:at|by|@|around)\s*(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.|o'?clock)?\b/);
    if (!m) m = s.match(/\b(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.)/);
    if (m) {
      let h = +m[1]; const min = m[2] ? +m[2] : 0; const ap = (m[3] || '').replace(/\./g, '');
      if (h > 23 || min > 59) return null;
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      return { h, m: min, explicit: !!ap && ap !== "o'clock" && ap !== 'oclock' || h > 12 };
    }
    if (/\bmorning\b/.test(s)) return { h: 9, m: 0, explicit: true };
    if (/\bafternoon\b/.test(s)) return { h: 14, m: 0, explicit: true };
    if (/\bevening\b/.test(s)) return { h: 18, m: 0, explicit: true };
    if (/\btonight\b|\bnight\b/.test(s)) return { h: 20, m: 0, explicit: true };
    return null;
  }

  function parseDate(s, now = new Date()) {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    let m;
    if (/\bday after tomorrow\b/.test(s)) { d.setDate(d.getDate() + 2); return d; }
    if (/\btomorrow\b/.test(s)) { d.setDate(d.getDate() + 1); return d; }
    if (/\btoday\b|\btonight\b/.test(s)) return d;
    if ((m = s.match(/\bin (\d+) (day|week|month)s?\b/))) {
      if (m[2] === 'day') d.setDate(d.getDate() + +m[1]);
      else if (m[2] === 'week') d.setDate(d.getDate() + 7 * m[1]);
      else d.setMonth(d.getMonth() + +m[1]);
      return d;
    }
    if (/\bnext week\b/.test(s)) { d.setDate(d.getDate() + 7); return d; }
    if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return new Date(+m[1], m[2] - 1, +m[3]);
    if ((m = s.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : d.getFullYear();
      const r = new Date(y, m[2] - 1, +m[1]);
      if (!m[3] && r < d) r.setFullYear(y + 1);
      return r;
    }
    if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${MON_RE}\\b`))) || (m = s.match(new RegExp(`\\b${MON_RE} (\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
      const day = /^\d/.test(m[1]) ? +m[1] : +m[2];
      const mon = MONTHS.indexOf((/^\d/.test(m[1]) ? m[2] : m[1]).slice(0, 3));
      const r = new Date(d.getFullYear(), mon, day);
      if (r < d) r.setFullYear(r.getFullYear() + 1);
      return r;
    }
    if ((m = s.match(new RegExp(`\\b(next |this |coming )?${DAY_RE}\\b`)))) {
      const target = dayIndex(m[2]);
      let diff = (target - d.getDay() + 7) % 7;
      if (diff === 0 && !(m[1] && m[1].trim() === 'this')) diff = 7;
      else if (m[1] && m[1].trim() === 'next' && diff < 7 && /next week/.test(s)) diff += 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
    if ((m = s.match(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/))) {
      const r = new Date(d.getFullYear(), d.getMonth(), +m[1]);
      if (r < d) r.setMonth(r.getMonth() + 1);
      return r;
    }
    return null;
  }

  // Natural-language "when" → timestamp (ms) for reminders.
  function parseWhen(s, now = new Date()) {
    let m = s.match(/\bin (\d+(?:\.\d+)?) ?(seconds?|minutes?|hours?|days?|s|m|h)\b/);
    if (m) {
      const u = m[2][0];
      return now.getTime() + +m[1] * (u === 's' ? 1e3 : u === 'm' ? 6e4 : u === 'h' ? 36e5 : 864e5);
    }
    const date = parseDate(s, now);
    const t = parseTimeOfDay(s);
    if (!date && !t) return null;
    const r = new Date(date || now);
    if (t) r.setHours(t.h, t.m, 0, 0); else r.setHours(9, 0, 0, 0);
    if (!date && r <= now) {
      if (t && !t.explicit && t.h < 12 && new Date(r.getTime() + 12 * 36e5) > now) r.setHours(t.h + 12);
      else r.setDate(r.getDate() + 1);
    }
    return r.getTime();
  }
  const WHEN_PHRASES = [
    /\bin \d+(?:\.\d+)? ?(seconds?|minutes?|hours?|days?|weeks?|s|m|h)\b/g,
    /\b(at|by|@|around) \d{1,2}([:.]\d{2})? ?(am|pm|a\.m\.|p\.m\.|o'?clock)?/g,
    /\b\d{1,2}([:.]\d{2})? ?(am|pm)\b/g,
    /\b(on )?(the )?\d{1,2}(st|nd|rd|th)( of)?( [a-z]+)?\b/g,
    /\b(today|tonight|tomorrow|day after tomorrow)( (morning|afternoon|evening|night))?\b/g,
    /\bevery \d+ ?(seconds?|minutes?|hours?|s|m|h)\b/g,
    /\b(every|each) ?(day|weekday|morning|evening|night|hour|week|month|year)s?\b|\b(daily|weekdays|hourly|monthly|yearly|annually)\b|\bmonday to friday\b/g,
    new RegExp(`\\b(on |by |this |next |coming |every |each )?${DAY_RE}\\b`, 'g'),
    /\b(in the |this )?(morning|afternoon|evening)\b/g,
    /\b(at )?(noon|midnight)\b/g,
    /\bnext week\b/g,
    /\b(on |by )?\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g,
  ];
  // Recurrence for reminders: {type:'daily'|'weekdays'|'weekly'|'monthly'|'yearly'|'interval', day?, month?, ms?} or null.
  function parseRepeat(s) {
    let m;
    if ((m = s.match(/\bevery (\d+) ?(seconds?|minutes?|hours?|s|m|h)\b/))) {
      const u = m[2][0], ms = +m[1] * (u === 's' ? 1e3 : u === 'm' ? 6e4 : 36e5);
      return ms >= 6e4 ? { type: 'interval', ms } : null;
    }
    if (/\b(every hour|hourly)\b/.test(s)) return { type: 'interval', ms: 36e5 };
    if (/\b(every ?weekday|weekdays|monday to friday)\b/.test(s)) return { type: 'weekdays' };
    if (/\b(every ?day|daily|each day|every (morning|evening|night))\b/.test(s)) return { type: 'daily' };
    if ((m = s.match(new RegExp(`\\b(every|each) ${DAY_RE}\\b`)))) return { type: 'weekly', day: dayIndex(m[2]) };
    if (/\bevery week\b|\bweekly\b/.test(s)) return { type: 'weekly', day: new Date().getDay() };
    // "every month on the 5th" · "monthly" · "every month" · "every year on 12 feb" · "annually" — never a time like "at 9am"
    if ((m = s.match(/\b(?:every|each) month\b(?:\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?!\s*(?:am|pm))|\s+on\s+(\d{1,2})\b(?!\s*(?:am|pm)))?|\bmonthly\b(?:\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?!\s*(?:am|pm)))?/))) {
      // day is optional — "every month" repeats on the same day-of-month the reminder was first set.
      const d = m[1] || m[2] || m[3];
      const day = d ? Math.max(1, Math.min(31, +d)) : undefined;
      return { type: 'monthly', day };
    }
    if ((m = s.match(/\b(?:every|each) (?:year|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:annually|yearly)\b/))) {
      const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const mon = MONTHS.findIndex(mo => new RegExp('\\b' + mo + '\\b').test(s));
      const dm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:am|pm))/);
      return { type: 'yearly', month: mon >= 0 ? mon : undefined, day: dm ? Math.max(1, Math.min(31, +dm[1])) : undefined };
    }
    return null;
  }
  function stripWhen(s) {
    for (const re of WHEN_PHRASES) s = s.replace(re, ' ');
    return s.replace(/\s+/g, ' ').replace(/\s+(on|at|by|due|for)$/, '').trim();
  }

  /* ---------- unit conversion ---------- */
  // [aliases, dimension, factor to base unit] — temperature handled specially.
  const UNITS = [
    [['c', '°c', 'celsius', 'degrees celsius', 'centigrade'], 'temp', 'C'], [['f', '°f', 'fahrenheit', 'degrees fahrenheit'], 'temp', 'F'], [['k', 'kelvin'], 'temp', 'K'],
    [['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'], 'len', 1000], [['m', 'meter', 'meters', 'metre', 'metres'], 'len', 1],
    [['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'], 'len', .01], [['mm', 'millimeter', 'millimeters'], 'len', .001],
    [['mi', 'mile', 'miles'], 'len', 1609.344], [['ft', 'feet', 'foot'], 'len', .3048], [['inch', 'inches'], 'len', .0254], [['yd', 'yard', 'yards'], 'len', .9144],
    [['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'], 'mass', 1], [['g', 'gram', 'grams'], 'mass', .001], [['mg', 'milligram', 'milligrams'], 'mass', 1e-6],
    [['lb', 'lbs', 'pound', 'pounds'], 'mass', .45359237], [['oz', 'ounce', 'ounces'], 'mass', .028349523125],
    [['l', 'liter', 'liters', 'litre', 'litres'], 'vol', 1], [['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], 'vol', .001], [['gallon', 'gallons', 'gal'], 'vol', 3.785411784],
    [['second', 'seconds', 'sec', 'secs'], 'time', 1], [['minute', 'minutes'], 'time', 60], [['hour', 'hours', 'hr', 'hrs'], 'time', 3600],
    [['day', 'days'], 'time', 86400], [['week', 'weeks'], 'time', 604800], [['year', 'years'], 'time', 31557600],
    [['kmph', 'km/h', 'kph'], 'speed', 1 / 3.6], [['mph'], 'speed', .44704], [['m/s', 'mps'], 'speed', 1],
  ];
  const UNIT_ALIASES = UNITS.flatMap(u => u[0]).sort((a, b) => b.length - a.length);
  const UNIT_RE = UNIT_ALIASES.map(esc).join('|');
  function convertUnits(s) {
    const m = s.match(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\s+(?:to|in|into)\\s+(${UNIT_RE})\\b`));
    if (!m) return null;
    const find = a => UNITS.find(u => u[0].includes(a));
    const from = find(m[2]), to = find(m[3]), v = +m[1];
    if (!from || !to) return null;
    if (from[1] !== to[1]) return { error: `I can't convert ${from[1]} into ${to[1]}.` };
    let out;
    if (from[1] === 'temp') {
      const c = from[2] === 'C' ? v : from[2] === 'F' ? (v - 32) * 5 / 9 : v - 273.15;
      out = to[2] === 'C' ? c : to[2] === 'F' ? c * 9 / 5 + 32 : c + 273.15;
    } else out = v * from[2] / to[2];
    return { value: v, from: m[2], to: m[3], result: parseFloat(out.toPrecision(8)) };
  }

  /* ---------- rule classifier ---------- */
  const DAYS_ALT = DAYS.join('|');
  // Each rule: [intent, regex | fn(s), confidence, tool?]. First match wins, so order matters.
  const R = [
    ['GOODNIGHT', /^(good ?night|gn|going to (bed|sleep)|time (for bed|to sleep)|i'?m (going to sleep|off to bed))( jarvis)?$/, .96],
    ['GREETING', /^(hi|hello|hey|yo|hii+|helo|hola|namaste|sup|wassup|what'?s up|good (morning|afternoon|evening))( there)?$/, .97],
    ['HOME', /^(i'?m|i am) (home|back)( now| again)?$|^(back|home) (again|now)$|^honey,? i'?m home$|^guess who'?s back$/, .96],
    ['PRAISE', /^(good job|great job|nice work|great work|well done|nice one|brilliant|excellent|good boy|you'?re (awesome|amazing|the best|brilliant|a genius|great|smart)|you rock|love you)( jarvis)?$/, .96],
    ['INSULT', /^(you'?re|you are) (so )?(useless|dumb|stupid|an idiot|slow|annoying|terrible|bad|trash)|^(shut up|stupid (bot|ai)|you suck)( jarvis)?$/, .95],
    ['HOW_ARE_YOU', /^how('?s| is| are) (it going|you|things|your day)|^how (are|r) (you|u)( doing)?$|^you (ok|good|alright)$/, .95],
    ['IDENTITY', /^(who|what) are you\b|^(tell me )?about yourself|^what('?s| is) your name|^introduce yourself/, .96],
    ['JOKE', /\b(tell|say|crack|got) (me )?(a |another |some )?(joke|pun)|\bmake me (laugh|smile)|\bsomething funny\b|^joke$/, .95],
    ['AGENT_HISTORY', /^what (did|have) you (just )?(do|done)\b|^(show|list) (me )?(my |the )?(last|recent) (agent )?(runs?|plans?)$/, .95, 'agent'],
    // Execution inspector: one stored plan run as a readable card. "inspect agt-20260930-021" picks a specific run.
    ['AGENT_INSPECT', /^(?:inspect|examine)\s+(?:the\s+)?(?:(?:last|latest|previous)\s+)?(?:agent\s+)?(?:run|plan|execution|task)$|^inspect\s+(?:run\s+|execution\s+)?agt-\d{8}-\d{3}$|^(?:show|give)\s+(?:me\s+)?(?:the\s+)?(?:run|execution|task)\s+details$|^(?:details|breakdown) of (?:the )?(?:last|latest) (?:run|plan|task)$/, .96, 'agentInspect'],
    // Undo a whole multi-step plan at once, newest step first ("undo" alone still undoes one action).
    ['UNDO_TASK', /^(?:please\s+)?(?:undo|revert|reverse|roll ?back)\s+(?:that|this|the last|the whole|the entire|all of)?\s*(?:task|plan|run|workflow)$|^(?:undo|revert|roll ?back)\s+agt-\d{8}-\d{3}$|^(?:undo|revert|reverse|roll ?back)\s+everything\s+(?:you\s+)?(?:just\s+)?did$/, .96, 'undoTask'],
    ['THANKS', /^(thanks|thank you|thx|cheers|great job|good job|nice|awesome|perfect|cool)( so much| a lot| jarvis| ra| kano| andi| ri| boss)?$/, .97],
    ['GOODBYE', /^(bye|goodbye|good night|see (you|ya)|later|gotta go|that'?s all)( for now)?$/, .95],
    ['HELP', /^(help|what can you do|commands|what are your (features|abilities|commands)|how do i use you|show (me )?commands)\b/, .96],

    // routines
    ['ROUTINE_LIST', /\b(list|show|what are|see)( all)?( my| the)? routines\b|^routines$/, .96, 'routine'],
    ['ROUTINE_DELETE', /\b(delete|remove|forget)( the| my)? .+ routine\b|\b(delete|remove)( the| my)? routine (called |named )?.+/, .95, 'routine'],
    ['ROUTINE_CREATE', /^(create|make|add|new|set ?up|save|build)( a| an| new| my)? routine\b.+|^(create|make|save)( a)? .+ routine\s*(:|that|which|to)\s*.+/, .96, 'routine'],
    ['ROUTINE_SCHEDULE', /^(run|start|schedule|do)( my| the)? .+?( routine| mode| protocol)? (every|each|daily|on weekdays|weekdays)\b.+/, .95, 'routine'],
    ['ROUTINE_RUN', /^(run|start|activate|execute|launch|engage|initiate)( my| the)? .+ (routine|protocol)$/, .93, 'routine'],

    // HUD themes, persona, diagnostics
    ['PERSONA_SET', /\b(switch|change|swap|talk|bring|put|go)\b.*\b(to|back to|on|up|in)\s+(friday|jarvis)\b|^(friday|jarvis),? (mode|online|take over|you'?re up)$|\bactivate (friday|jarvis)\b|^(bring|call) (friday|jarvis)( back)?$/, .95, 'persona'],
    ['THEME_SET', /\b(switch|change|set|go|turn|make)\b.*\b(theme|colou?r scheme|hud colou?r|hud)\b|\b(gold|golden|mark ?85|crimson|red|violet|purple|arc|arc reactor|blue|cyan) (theme|hud|colou?rs?)\b|^red alert$|^(arc reactor|mark ?85|gold|crimson|violet) mode$|\b(stand down|cancel) (red )?alert\b/, .95, 'theme'],
    ['SYSTEM_STATE', /\b(system|computer|laptop|pc) (state|snapshot|status)\b|^status$|\b(state|status) of (my|the|this) (system|laptop|pc|computer)\b/, .94, 'systemState'],
    ['DIAGNOSTICS', /\b(run( a| full)?|full|start|do)( system| suit)? (diagnostics?|systems? check|health check)\b|^(diagnostics?|systems? check|suit (diagnostics|status|check))$|\bsuit (diagnostics|status|check)\b|\ball systems (check|report|status)\b/, .96, 'diagnostics'],

    // read my screen (built-in OCR)
    ['CLIPBOARD_IMAGE_READ', /\b(read|scan|ocr|extract( the)? text( from)?|what does|explain|describe|fix|solve|summari[sz]e|debug|translate|what'?s wrong with|what'?s in|what is in)\b.*\b(image|picture|screenshot|snip|photo)\b.*\b(copied|clipboard)\b|\b(copied|clipboard) (image|picture|screenshot|snip)\b/, .96, 'screen'],
    // A browser tab / page is read the same way: the user switches to it during the countdown, JARVIS captures the window.
    ['SCREEN_EXPLAIN', /\b(analy[sz]e|explain|describe|summari[sz]e|review|check|look at|read|what'?s (in|on)|what is (in|on))\b(?: (?:my|the|this|that))?(?: (?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|other|next|last|current|open|active))?(?: browser)? (tab|browser( window)?|web ?page|page (in|on) (my|the) browser)\b/, .95, 'screen'],
    ['SCREEN_EXPLAIN', /\b(explain|describe|fix|solve|summari[sz]e|translate|debug|help me with|what does|what'?s wrong with|answer)\b.*\b(on|in) (my|the) (screen|window|display)\b|\bdescribe (my|the) (screen|window|display)\b|\b(this|the) (error|question|problem|code|page|chart|graph|diagram|image) on (my|the) screen\b|\blook at my screen and\b|\bwhat am i looking at\b/, .96, 'screen'],
    ['SCREEN_READ', /\b(read|what'?s|what is|scan|capture the text|copy the text)( on| in| from| off)? (my|the) (screen|window|display)\b|^read (my )?screen$/, .96, 'screen'],

    // laptop controls
    ['DISPLAY_OFF', /\b(turn|switch|shut|put) (off )?(the |my )?(display|screen|monitor)( off| to sleep)\b|\b(turn|switch|shut) off (the |my )?(display|screen|monitor)\b|^(display|screen|monitor) off$/, .96, 'sys'],
    ['BRIGHTNESS', /\bbrightness\b|\b(brighter|dimmer)\b|\b(dim|brighten)( the| my)? (screen|display)\b|\bscreen (is )?(too )?(dark|bright)\b|\b(dim|brighten) (it|down|up)\b/, .95, 'sys'],
    ['DARK_MODE', /\b(dark|light|night) (mode|theme)\b|\b(windows|system) (to )?(dark|light)\b/, .95, 'sys'],
    ['RADIO', /\b(bluetooth|wi-?fi|wireless)\b.*\b(on|off|enable|enabled|disable|disabled|status|state)\b|\b(turn|switch|enable|disable|toggle)( on| off)?( the| my)? (bluetooth|wi-?fi|wireless)\b|\bis (my |the )?(bluetooth|wi-?fi) (on|off|enabled)\b/, .95, 'sys'],
    ['POWER_PLAN', /\b(power (plan|mode|scheme|profile)|battery saver|power saver|saver mode|performance mode|high performance|balanced mode|battery optimi[sz]er)\b/, .95, 'sys'],
    ['VOLUME_SET', /\b(set|put|change|make|turn|increase|raise|boost|crank|pump|decrease|lower|reduce|bring)( the)? (volume|sound)( level)? (to|at|up ?to|down ?to)? ?\d{1,3}\b|\b(turn|crank|pump) it (up ?to|down ?to|to)? ?\d{1,3}\b|\bvolume (to|at) \d{1,3}\b|^volume \d{1,3}( ?%| percent)?$|\b(set|put|change|make|turn)( the)? (volume|sound) (to |at )?(max(?:imum)?|full|half|min(?:imum)?|zero)\b|\b(what'?s|what is|current) (the )?volume( level)?\b/, .96, 'sys'],
    ['REGENERATE', /^(?:please\s+)?(?:regenerate|redo)(?:\s+(?:that|it|the (?:answer|response|reply)|your (?:answer|response)))?$|^(?:give (?:me )?|try )?(?:a |an )?(?:different|another|new|better) (?:answer|response|reply)$|^(?:answer|say) (?:that|it) (?:again|differently)$|^try again$/i, .96, 'regenerate'],
    ['DELETE_LAST_MSG', /^(?:please\s+)?(?:delete|remove|undo|unsend|erase|take back|clear|cancel)\s+(?:my\s+|the\s+)?(?:last|previous|that|above)\s+(?:message|msg|question|chat message|text|prompt)\b|^unsend(?:\s+(?:that|it|my last message))?$/i, .97, 'deleteMessage'],
    ['UNDO', /^(?:please\s+)?(?:undo|revert|reverse|take back)(?:\s+(?:it|that|this|the last (?:thing|action|change|one)|what you (?:just )?did|last))?(?:\s+please)?$|^(?:ctrl|control)\s*\+?\s*z$|^(?:oops|oh no)[, ]*(?:undo|go back)(?: that)?$/i, .97, 'undo'],
    ['BACKUP', /\b(back ?up|export|save a copy of|download a copy of)\b.*\b(my |all my |the )?(data|memory|everything|settings|chats?|jarvis)\b|^back ?up$|\bback ?up jarvis\b|\b(restore|import)\b.*\b(backup|my data)\b/, .95, 'backup'],
    ['WINDOW_LAYOUT', /\b(put|move|snap|place|dock|send|throw)\b .+ \b(to |on |at )?(the )?(left|right|top|bottom)( half| side)?\b|^(maximi[sz]e|minimi[sz]e|restore|full ?screen)\s+(?!everything\b|all\b|windows\b)\S+|\bminimi[sz]e (everything|all( windows)?|all other windows) (except|but|apart from) .+|\bside by side\b|\bsplit (the )?screen\b/, .95, 'window'],
    ['CLIP_HISTORY', /\bclipboard history\b|\bwhat (did|have) i (copy|copied)( earlier| before| today)?\b|\b(previous|earlier|older|last few) (copies|clipboard|things i copied)\b|\bcopy (the )?(\d+|first|second|third|fourth|fifth)(st|nd|rd|th)? (one|1|item|clip|thing)( from (my )?(clipboard )?history)?\b|\b(start|stop|turn (on|off)|enable|disable|clear) (the )?clipboard (history|tracking)\b/, .96, 'clip'],

    // contests, web research, study, planning (before generic reminder/briefing/open rules)
    ['CONTEST_REMIND', /\b(remind me|reminder|notify me|alert me)\b.*\b(contest|round|codeforces|leetcode|codechef|atcoder)\b/, .96, 'contests'],
    ['CONTESTS', /\b(upcoming|next|any|list|show|what are|when is|when'?s)( the| my)?( upcoming| next)? (coding |programming |competitive |cp )?(contests?|rounds?)\b|\b(codeforces|leetcode|codechef)\b.*\b(contests?|rounds?|this week|today|tomorrow|schedule)\b|\bcontests? (this week|today|tomorrow|coming up)\b|^contests$/, .95, 'contests'],
    ['HACKATHONS', /\b(upcoming|any|list|show|find|current|new|latest|open)( the)? hackathons?\b|^hackathons$|\bhackathons (in|near|this|for|happening)\b/, .94, 'research'],
    ['RESEARCH', /^(search|look up|check|google) (the )?(web|internet|online)( for| about)? .+|^(research|investigate)\b .+|\bwhat does the (web|internet) say\b|\bsearch (online|the web|the internet) (for|about) .+|\b(look it up|search it) (online|on the web)\b|\b(find out|look up) online\b/, .95, 'research'],
    // triggers: "when I plug in my charger, start study mode" (events: charger, battery, app opened/closed, Wi-Fi)
    ['TRIGGER_CREATE', /^(when|whenever|every time|each time|as soon as|once)\b.*\b(charger|plug(ged)?( in)?|unplug(ged)?|battery|wi-?fi|wifi|connect(ed|s)? to|open(s|ed)?|start(s|ed)?|launch(es|ed)?|close(s|d)?|quit(s)?|exit(s)?)\b.*(,|\bthen\b|\b(run|start|activate|block|play|turn on|switch|enable|open|do|mute|launch|begin)\b)/, .95, 'triggers'],
    ['TRIGGER_LIST', /\b(list|show|what|which|see)\b.*\btriggers?\b|^(my )?triggers$/, .95, 'triggers'],
    ['TRIGGER_DELETE', /\b(delete|remove|clear|cancel|turn off|disable|stop)\b.*\btriggers?\b/, .95, 'triggers'],
    // Charger announcements ("tell me when the charger is connected", "stop charger alerts"). After the
    // trigger rules so "when I plug in my charger, …" still builds a trigger routine, not this switch.
    ['CHARGER_ALERTS', /\b(announce|announcements?|tell me|notify me|let me know|alert( me)?|remind me)\b.{0,50}\b(charger|charging|plugged(\s+in)?|unplugged)\b|\b(charger|charging)\b.{0,50}\b(announce|announcements?|alerts?|notifications?|notify)\b|\b(stop|don't|dont|do not|disable[sd]?|turn off|switch off|mute[sd]?|silence[sd]?)\b.{0,50}\bcharger\b|\b(turn on|switch on|enable[sd]?)\b.{0,50}\bcharger\b.{0,30}\b(alerts?|announcements?)\b/, .94, 'chargerAlerts'],
    // study planner + weekly progress (before the one-day PLAN_DAY rules)
    ['STUDY_PLAN', /^(?!.*\b(today|tonight|this evening|the rest of the day)\b)(?=.*\b(plan|schedule|timetable)\b).*\b(exam|test|prep|preparation|revision|syllabus)\b|^(?!.*\b(today|tonight)\b).*\bstudy (plan|schedule|timetable) for\b|\bprepare( me)? for .+\b(exam|test)\b|^(?=.*\b(exam|test)\b.*\b(on|in|is)\b)(?=.*\btopics?\b).+/, .95, 'studyPlan'],
    ['STUDY_TODAY', /\b(what|which)( topic| subject| chapter)? (should|do) i (study|revise|read|cover|work on)( today| now| next)\b(?!.*\bplan (my|the) day\b)|^(show |see |open )?(me )?(my )?study (plan|schedule)$|\bwhat'?s (on )?(my )?study plan( for)? today\b|\bwhere am i (in|on|with) my (study )?plan\b/, .95, 'studyToday'],
    ['WEEK_REPORT', /\bhow (was|did|is|has) (my|the|this|last) (last |this )?week( go| been)?\b|\b(weekly|week'?s|this week'?s|last week'?s|last 7 days'?) (summary|report|stats|progress|review|recap)\b|\bweek(ly)? (summary|report|review|recap)\b|\bhow (productive|much did i (study|focus)) (was i |did i )?(this|last) week\b|\bmy (progress|streak)\b(?! today)/, .95, 'weekReport'],
    ['PLAN_DAY', /\bplan (my|the|out my) (day|evening|night|study|schedule|afternoon)\b|\b(make|create|build|give me|prepare) (a |my )?(schedule|timetable|plan|study plan|day plan) for (today|tonight|the day|this evening|the rest of the day)\b|^plan my day$|\bschedule my day\b|\bwhat should i (do|study) (now|today|next)\b/, .95, 'planDay'],
    ['FLASH_MAKE', /\b(make|create|generate|build|turn)( me)?( some| a set of)? (.+ )?(into )?flash ?cards?\b/, .95, 'flashcards'],
    ['FLASH_DELETE', /\b(delete|remove|clear)( the| my| all)?( \w+)? (flash ?cards?|deck)\b/, .94, 'flashcards'],
    ['FLASH_REVIEW', /\b(review|quiz me( on)?|test me( on)?|practice|study|revise|drill)( my| the)?( [\w-]+){0,3} flash ?cards?\b|\bflash ?cards? (review|quiz|time|session)\b|^flashcards review$/, .95, 'flashcards'],
    ['FLASH_LIST', /\b(list|show|what are|how many)( my| the)?( [\w-]+)? flash ?cards?\b|^(my )?flash ?cards$|\bmy decks\b/, .95, 'flashcards'],
    ['GIT_CLONE', /\b(git )?clone\b.*(https?:\/\/|github|gitlab|bitbucket|repo)/, .95, 'gitClone'],

    // snippets
    ['SNIPPET_LIST', /\b(list|show|what are|see|open)( all)?( my| the)? (code )?snippets\b|^snippets$/, .96, 'snippets'],
    ['SNIPPET_DELETE', /\b(delete|remove|forget|drop)( the| my)? snippet\b/, .95, 'snippets'],
    ['SNIPPET_SAVE', /\b(save|store|add|keep|remember)\b.*\bas (a |my )?snippet\b(?!\.\w)|^(save|add|new) (a )?snippet\b(?!\.\w)/, .96, 'snippets'],
    ['SNIPPET_COPY', /\b(copy|get|give me|use|grab|paste|insert)( me)?( my| the)? snippet\b|\bsnippet\b.*\bto (my |the )?clipboard\b/, .95, 'snippets'],

    // clipboard power tools (before generic clipboard rules)
    ['CLIP_TOOL', /\b(format|pretty ?print|prettify|beautify|minify|validate|fix)( the| my)? json\b.*\b(clipboard|copied)\b|\b(upper ?case|lower ?case|title ?case|capitali[sz]e)\b.*\bclipboard\b|\bclipboard\b.*\b(upper ?case|lower ?case|title ?case)\b|\b(count|how many) (words|characters|chars|lines)\b.*\bclipboard\b|\b(base ?64|url) ?(encode|decode)\b.*\bclipboard\b|\b(encode|decode)\b.*\bclipboard\b|\b(sort|dedupe|remove duplicate|reverse)( the)? lines\b.*\bclipboard\b|\b(trim|clean)( up)?( the)? (whitespace|spaces)\b.*\bclipboard\b/, .96, 'clipTool'],
    ['SUMMARISE_LINK', /\b(summari[sz]e|tl;?dr|read|explain|what'?s)\b.*\b(link|url|page|article|website|site)\b.*\b(clipboard|copied)\b|\b(summari[sz]e|tl;?dr)\b.*https?:\/\/|\b(summari[sz]e|tl;?dr) (this |that |the )?(link|url|page|article)\b/, .95, 'summariseLink'],
    ['CLIP_TRANSFORM', /\b(fix|convert|translate|port|optimi[sz]e|refactor|add comments( to)?|comment|clean up|rewrite|document|improve|indent|beautify|format|shorten|simplify)\b.*\b(clipboard|copied|the code i copied)\b/, .95, 'codeHelper'],
    ['SUMMARISE_FILE', /\b(summari[sz]e|tl;?dr|give me (a |the )?summary of|key points (of|from|in)|main points (of|from|in))\b.*([\w-]+\.(md|txt|pdf|py|js|c|cpp|java|html|css|json)\b|\b(file|note|notes|document|that file|my notes)\b)/, .95, 'summariseFile'],
    ['CLIPBOARD_TO_FILE', /\b(save|paste|put|write|dump|append|add|store)\b.*\b(clipboard|what i copied|copied (text|code))\b.*\b(to|in|into|as|inside)\b|\b(clipboard|what i copied)\b.*\b(to|into|in) (a |the |my )?(file|note)\b/, .95, 'writeFile'],

    // code → file → run
    ['WRITE_AND_SAVE', /^(write|create|make|generate|code|give me|build|implement)\b.+\b(and|then) (save|store|put) (it|that|them|the code)? ?(as|to|in|into|inside)\b/, .95, 'saveCode'],
    ['PASTE_TO_EDITOR', /\bpaste\b.*\b(editor|vs ?code|window|there|here|cursor|ide|notepad|active window)\b|\b(type|paste) (it|that|the code) (out|in|for me)\b/, .95, 'pasteToEditor'],
    ['SAVE_CODE', /\b(save|store|put|paste|write|dump|stick|move)\b (that |this |the |your |the last |last |above |above )?(code|program|snippet|answer|solution|script|function|class|output)\b.*\b(as|to|in|into|inside|called|named)\b|^(save|store) (it|that|this) (as|to|in|into) \S+/, .94, 'saveCode'],
    // "save this file by creating a new folder called calculator_website" / "save this page on my desktop" / "save it
    // in a new folder": the code JARVIS just wrote (the handler says so if there is none) — not a one-line note.
    ['SAVE_CODE', /^(?:save|store|keep|put)\s+(?:this|that|it|the above|the|this whole|that whole|the whole)(?:\s+(?:file|code|page|website|web ?page|html|program|script|project|calculator))?\b(?!\s+note).*\b(?:folder|directory|as|in|into|on|inside|called|named)\b|^(?:save|store) (?:this|that|it)(?: file| code| page| website)?$/, .93, 'saveCode'],
    ['COPY_CONTENT', /^copy (that|this|the|your|the last|last|above)( code| program| answer| snippet| script| output| reply| response| solution| function)?( to (my |the )?clipboard)?$|^copy (the )?(contents? of |code (in|from) )?[\w\-./\\ ]+\.[a-z]{1,5}( to (my |the )?clipboard)?$|^copy (the )?(last |that )?(code|answer)$/, .95, 'writeClipboard'],
    // coding AI tools (before OPEN_IN_EDITOR, whose looser "open … in vs code" pattern would otherwise win)
    ['CODE_ASK', looksLikeCodeAsk, .97, 'codeAsk'],
    // "open vs code in dsa sprint folder" / "open vs code and the directory should be dsa sprint folder": one command —
    // VS Code opened AT that folder (not Explorer, and never split into "open vs code" + a broken second step).
    ['OPEN_IN_EDITOR', s => !!editorFolder(s), .95, 'openInEditor'],
    ['OPEN_IN_EDITOR', /\b(open|edit|show|load)\b.*\b(in|with|using|on) (vs ?code|vscode|visual studio code|code editor|my editor|the editor|editor)\b|^edit [\w\-./\\ ]+\.[a-z]{1,5}$/, .95, 'openInEditor'],
    ['RUN_FILE', /^(run|execute|compile|test|compile and run)( it| that| this| the (file|code|program|script)| my (code|program|file)| [\w\-./\\]+\.(py|js|mjs|c|cpp|cc))( again| now)?( (with|using) input .+)?$|\b(run|execute) (that|the|this) (code|program|script|file)\b/, .95, 'runFile'],

    // dev projects: locate a project folder, start/stop its backend or frontend dev server
    // "find the login code in my project" / "find where we handle payments in the codebase": a search INSIDE your project's
    // files — not a project called "login code in my".
    ['ASK_FILES', /^(?:find|search for|look for|locate|where(?:'s| is| are)|show me)\s+(.{3,}?)\s+(?:in|inside|within|across|from)\s+(?:my|the|this|our|that)\s+(?:\w+\s+)?(?:projects?|code ?base|repo(?:sitory)?|source code)\b/, .93, 'askFiles'],
    // "find my calculator project" / "where is dsa_sprint folder": the name sits between "find" and "project/folder" — a
    // short name. A longer phrase with in / of / about / for … in it is a question about what's inside, not a name.
    ['LOCATE_PROJECT', s => { const m = /^(?:locate|find|where'?s|where is)\s+(?:my\s+|the\s+)?(.+?)\s+(?:project|folder)\b/.exec(s); return !!m && m[1].split(' ').length <= 3 && !/\b(?:in|of|about|for|with|from|that|which|inside|within|containing|regarding|related|on|at)\b/.test(m[1]); }, .93, 'locateProject'],
    ['START_PROCESS', /^start\s+(?:the\s+|my\s+)?.+?(?:'s)?\s+(?:backend|frontend|server|app)\b/, .95, 'startProcess'],
    ['STOP_PROCESS', /^stop\s+(?:the\s+|my\s+)?.+?(?:'s)?\s+(?:backend|frontend|server|app)\b/, .95, 'stopProcess'],

    // productivity
    ['BLOCK_DISTRACTIONS', /^concentrate$|\b(block|kill|close|remove|stop|no more|no)( all)?( the| my)? distract(?:ions?|ing)( apps?| programs?| stuff)?\b|\b(deep work|distraction[- ]free|do not disturb|dnd|monk|beast) mode\b|\bget me focused\b|\bhelp me (focus|concentrate)\b/, .95, 'distractions'],
    ['SHOW_DESKTOP', /\b(show (me )?(the |my )?desktop|minimi[sz]e (all|everything|all (the )?windows)|hide (all )?(the )?windows|go to (the )?desktop)\b/, .95, 'showDesktop'],
    ['OPEN_KNOWN_FOLDER', /\b(open|show|go to)\b\s+(?:up\s+)?(?:me\s+)?(?:my\s+|the\s+)?(downloads|desktop|pictures|photos|music|videos)(?:\s+folder)?$/, .94, 'openKnownFolder'],
    ['PRODUCTIVITY_REPORT', /\b(how productive|productivity (report|stats|score|summary)|what did i (do|get done|accomplish|finish|complete)|my (stats|progress)( for)? today|daily (report|stats)|how did i do today)\b/, .95, 'report'],
    // command learning (checked before the personal-memory rules below, whose "forget ..." pattern is broad)
    ['MISSES_LIST', /\bwhat (didn'?t|did not|couldn'?t|could not) you (understand|get)\b|\b(show|list)( me)?( the| my)? (missed|misunderstood|unknown|failed) (phrases|commands|requests)\b|\bphrases you (didn'?t|did not) understand\b/, .95, 'learnList'],
    ['LEARN_LIST', /\b(what|which)( commands| phrases)? (have|did) you (learn(?:ed|t)?|pick(ed)? up)\b|\blist (what|the) (you'?ve? )?(?:learned|learnt|taught)\b|\bshow( me)?( my)? (?:learned|learnt|taught) commands\b/, .95, 'learnList'],
    ['LEARN_FORGET_ALL', /\bforget (?:everything|all)(?: the)? you(?:'ve| have)? (?:learned|learnt|been taught)\b|\bclear (?:your |the )?(?:learned|learnt|taught) commands\b|\bforget (?:your |the )?(?:learned|learnt) (?:phrases|commands)\b/, .95, 'learnForget'],
    ['WHY_ACTION', /^why (?:did|do|would) you\b|^why (?:was|is) (?:that|this|it) (?:needed|required|necessary|confirmation|permission)\b/, .95, 'whyAction'],
    ['RECALL_NAME', /what('?s| is) my name|do you (know|remember) my name|who am i\b/, .98],
    ['SET_NAME', /^(my name is|call me|i am called|i'?m called) [a-z]/, .97],
    ['RECALL_ALL', /what do you (remember|know) about me|show (my )?memor(y|ies)|list (your )?memor(y|ies)/, .95],
    ['FORGET', /^forget (that |about )?(.+)|^delete (the )?memory (.+)/, .9],
    ['REMIND', new RegExp(`^(please )?remember to .+\\b(in \\d+|at \\d|tomorrow|tonight|today|this (morning|afternoon|evening)|(on |next )?${DAY_RE})\\b`), .93, 'remind'],
    ['SET_CITY', /^(?:remember (?:that )?)?(?:my (?:home )?city is|i live in|i stay in|i(?:'?m| am) (?:based|living|staying) in|set (?:my )?(?:home |weather )?city (?:to|as)|change (?:my )?city to) [a-z][a-z .'-]{1,38}$/, .95, 'weather'],
    ['REMEMBER', /^remember (that |this |my )?(.+)|^(note that|keep in mind) (.+)/, .94],

    // context follow-ups
    ['CONTEXT_CLOSE', /^(close|kill|quit|exit|shut) (it|that|this|the app)$/, .95, 'closeApplication'],
    ['CONTEXT_REOPEN', /^(open|launch|start) (it|that) again$|^reopen (it|that)$/, .95, 'openApplication'],

    // study & productivity
    ['FOCUS_STOP', /\b(stop|end|cancel|quit|finish) (the |my )?(focus|pomodoro|study)( session| timer| mode)?\b|^stop studying$|\b(i'?m|i am) done (with )?(the |my )?(focus|studying|study|pomodoro)\b/, .96, 'focus'],
    ['FOCUS_START', /\blet'?s do (a |an |some )?(focus|pomodoro|study)\b|^(focus|study|pomodoro|deep work) (mode|session) on$|\b(start|begin|let'?s|time to|enable|activate|turn on|switch on|go into|enter)( a| an| the| my)? (\d+[ -]?(?:minutes?|mins?|m)( long)? )?(focus|pomodoro|study|deep work)( session| timer| mode| time)?\b|\b(start|begin|do|run)( a| an| the| my)? \d+[ -]?(?:minutes?|mins?)( long)? session\b|^(pomodoro|focus mode|study mode)$|^i (want|need) to (focus|study)\b/, .95, 'focus'],
    ['REMIND', /\bremind me\b|\bset (a |an )?reminder\b|\bdon'?t let me forget\b/, .96, 'remind'],
    ['LIST_REMINDERS', /\b(what are|show|list|any) (my )?reminders\b|^reminders$/, .95, 'reminders'],
    // attendance & marks (before DONE_TODO — its "mark …" rule is broad)
    ['ATTENDANCE_TARGET', /\bhow many (?:more )?(?:classes|lectures)\b.*\b(?:reach|get to|hit|make|attend to|for|need)\b.*?\b(\d{2,3})\s*(?:%|percent)/, .94, 'attendance'],
    ['GPA_TARGET', /\bwhat (?:gpa|sgpa|grade|score|pointer)\b.*\bneed\b.*?(\d+(?:\.\d+)?)\s*(?:cgpa|pointer)|\bneed\b.*\b(\d+(?:\.\d+)?)\s*cgpa\b/, .94, 'marks'],
    ['ATTENDANCE_REPORT', /\b(attendance|bunk (meter|report)|how.s my attendance|attendance (report|percent|percentage))\b|^attendance$|\b(show|my) attendance\b/, .95, 'attendance'],
    ['BUNK_CHECK', /\bcan i (miss|skip|bunk|afford to miss|afford to skip)\b|\bshould i (go to|attend)\b.*\bclass\b|\bbunk\b/, .93, 'attendance'],
    ['ATTENDANCE_MARK', /\b(mark|record|log)\b.*\b(present|absent)\b/, .95, 'attendance'],
    ['ATTENDANCE_MARK', /^(present|absent) (in|for|at) [a-z]|\bi (was|am) (absent|present|missing)\b|\babsent (today|yesterday|in|for)\b|\b(missed|skipped|bunked)\b.*\b(class|lecture|period)\b/, .88, 'attendance'],
    ['ADD_MARKS', /\b(add|save|log|record)\b.*\b(marks?|result|sgpa|gpa)\b.*\d|\b\d+(?:\.\d+)?\s*(gpa|sgpa|pointer)s?\b|\b\d+\s*\/\s*\d+\s*(in|for)\b.*\b(marks|result|sem)\b/, .92, 'marks'],
    ['CGPA_REPORT', /\bwhat('s| is) my (cgpa|sgpa)\b|\b(my|show|current)\b.*\b(cgpa|sgpa)\b|^(cgpa|sgpa)$|\b(cgpa|sgpa)\?$/, .94, 'marks'],
    ['CHAT_MEMORY', /\bwhat (were|have) we (been )?(talking|talked|discussing|discussed|speaking)\b|\bwhat did we (talk|discuss) about\b|\bwhere were we\b|\bwhat.s our (current )?topic\b|^sumari[sz]e (our|the) conversation$/, .93, 'memory'],
    // both anchored: "take a note: stop everything" is a note, not a command. OFF before ON ("end panic mode").
    ['PANIC_OFF', /^(resume|carry on|go ahead)( now)?$|^unpanic$|^all clear$|^stand down$|^it'?s fine now$|^(end|turn off|disable|stop|cancel) (the )?panic( mode)?$/, .92, 'panic'],
    ['PANIC_ON', /^(panic|panic mode|stop everything|all stop|hold everything|pause everything|freeze all (automation|triggers)|emergency stop)$/, .95, 'panic'],

    // "add finish the assignment to my to-do list" is a to-do, even though it mentions an assignment.
    ['ADD_TODO', /^(add|put|note down|jot down|write down|include)\b.*\b(to|on|in|into) (my |the )?(to-?dos?|tasks?)( ?list)?$|^(add|include)\b.*\bmy to-?do list\b|\band add (it|that|this) to (my |the )?(to-?do|task)( ?list)?$/, .95, 'todo'],
    ['LIST_DEADLINES', /^(what|which|any|show|list|do i have|are there)\b.*\b(assignments?|homework|deadlines?|exams?|tests?|submissions?|projects?)\b.*\bdue\b(?!.*\b(on|by|at)\b)/, .94, 'deadline'],
    ['ADD_DEADLINE', /\b(add|new|save|note|i have|there'?s|got)( an?| my)?( [a-z0-9]+){0,2}? (assignment|homework|deadline|exam|test|quiz|project|lab|submission|viva|mid ?sem|end ?sem)\b.*|\b(assignment|homework|project|lab|exam|test|submission|report|record) .*\b(is )?due\b/, .93, 'deadline'],
    ['LIST_DEADLINES', /\b(what'?s|what is|anything|show|list|any|upcoming|my) (due|deadlines?|assignments?|exams?|homework|submissions?)\b|\bwhat do i have due\b|^deadlines$/, .94, 'deadline'],
    ['ADD_CLASS', new RegExp(`\\b(add|i have|there'?s|new)( an?| my)? (class|lecture|lab|tutorial|period)\\b.*\\b(${DAYS_ALT}|mon|tue|wed|thu|fri|sat|sun)`), .93, 'timetable'],
    ['NEXT_CLASS', /\b(next|upcoming) (class|lecture|lab|period)\b|\bwhen is my next\b/, .96, 'timetable'],
    ['LIST_CLASSES', /\b(my |today'?s |tomorrow'?s )(classes|lectures|timetable|schedule|time table)\b|\b(classes|lectures)( do i have)?( today| tomorrow| on \w+day)\b|\bwhat classes\b|^(timetable|time table|schedule|classes)$/, .92, 'timetable'],
    ['CLEAR_TODOS', /\b(clear|empty|wipe) (out )?(all )?(of )?(my |the )?(completed |done |finished )?(to-?dos?|tasks?)( list)?\b/, .95, 'todo'],
    // before DONE_TODO — its "check ___" pattern is broad enough to otherwise swallow "check whether X exists"
    ['CHECK_EXISTS', /\bcheck\s+(?:if|whether)\b.*\bexists?\b|\bdoes\b.+\bexist\b|^is there (?:a |an )?(?:file|folder|note|document)\b|^do i have (?:a |an )?(?:file|folder|note)\b/, .93, 'checkExists'],
    // A bare "check X" means look at X ("check battery", "check my task list"); only "check off X" / "check X (as) done" ticks one.
    ['DONE_TODO', /^(mark|tick|check off|complete|finish|finished|done with|cross off|strike)( task| to-?do| item| number)? ?#?(\d+|.+?)( as)?( done| complete| completed| off)?$|^check( task| to-?do| item)? #?(\d+|.+?)( as)? (done|complete|completed|off)$/, .9, 'todo'],
    ['ADD_TODO', /^(add|put|note down|jot down|write down) (.+?) (to|on|in) (my |the )?(to-?do|task|shopping)?( ?list)\b|^(add|new|create)( a)? (task|to-?do|item)\b|^(to-?do|task):? /, .95, 'todo'],
    ['LIST_TODOS', /\bwhat are (my |the )?(to-?dos|tasks)\b|\bwhat (do|should) i (have|need) to[ -]do\b|\b(what'?s|what is|show|read|list|see|check) (me )?(on )?(my |the )?(to-?do|task|shopping)s?( list)?\b|\bmy (to-?do|task|shopping) list\b|\bwhat (do i|should i) (have to |need to )?do( today)?\b|^(to-?dos?|tasks)$/, .94, 'todo'],

    // CS quick tools
    ['BASE_CONVERT', /\b(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\s*(in|to|into|as)\s*(binary|bin|hex(adecimal)?|octal|oct|decimal|dec)\b|\b(binary|hex|hexadecimal|octal|decimal)( value| form| representation)? of (0x[0-9a-f]+|0b[01]+|\d+)\b|\b(binary|hex|hexadecimal|octal) ([0-9a-f]+) (to|in|into) (decimal|binary|hex|octal)\b/, .96, 'csTool'],
    ['DATA_SIZE', /\b\d+(\.\d+)?\s*(bits?|bytes?|b|kb|mb|gb|tb|kib|mib|gib|tib)\s*(to|in|into)\s*(bits?|bytes?|b|kb|mb|gb|tb|kib|mib|gib|tib)\b/, .96, 'csTool'],
    ['UNIT_CONVERT', new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\s+(?:to|in|into)\\s+(${UNIT_RE})\\b`), .95, 'csTool'],
    ['ASCII', /\bascii (code |value )?(of|for) \S|\b(char(acter)?|ascii) (for|of) (code )?\d{1,3}\b/, .95, 'csTool'],
    ['BITWISE', /\b\d+\s*(xor|bitwise and|bitwise or|<<|>>|&|\|)\s*\d+\b/, .92, 'csTool'],
    ['CALCULATE', s => (/\d\s*[x×*\/÷+\-^%]\s*\(?\d/.test(s) || /\b(plus|minus|times|multiplied by|divided by|to the power of|squared|cubed|square root|sqrt|percent of|% of)\b/.test(s) || /^(calculate|compute|solve|evaluate)\b.*\d/.test(s)) && !/\b(binary|hex|octal|mb|gb|kb)\b/.test(s), .95, 'calculate'],
    ['SET_TIMER', /\b(set|start|put|create)( a| an| the)? (\d+ \w+ )?(timer|countdown|alarm)\b|^timer (for )?\d|\b\d+ (seconds?|minutes?|hours?) timer\b|\bcount ?down\b/, .96, 'setTimer'],
    ['CANCEL_TIMERS', /\b(cancel|stop|clear|delete|end|turn off|switch off|kill) (all |the |my )?(timers?|alarms?|countdowns?)\b/, .95, 'setTimer'],

    // clipboard + code helper (reads clipboard, then asks the LLM)
    ['EXPLAIN_CLIPBOARD', /\b(explain|debug|fix|review|analy[sz]e|summari[sz]e|translate|optimi[sz]e|improve|document|comment|convert|what does|what'?s wrong with|find (the )?(bug|error)s? in)\b.*\b(clipboard|copied|this code|this error|the code i copied|this snippet)\b/, .96, 'codeHelper'],
    ['WRITE_CLIPBOARD', /\b(copy|put|write|save) (.+?) (to|in|into|on) (the |my )?clipboard\b/, .93, 'writeClipboard'],
    ['READ_CLIPBOARD', /\b(what'?s|what is|read|show)( me)?( in| on)? (my |the )?clipboard\b|^clipboard$/, .95, 'readClipboard'],

    // weather / web
    ['WEATHER', /\b(weather|forecast|temperature (outside|today|in)|is it (going to )?(rain|snow|hot|cold|sunny)|will it rain|how (hot|cold) is it|need an umbrella|humidity|climate (like )?(in|at|here|outside|today|now|right now)|how('?s| is) it outside)\b/, .96, 'weather'],
    // distance / directions (checked before the generic OPEN_* rules; DIRECTIONS_OPEN before the plainer DIRECTIONS)
    ['DIRECTIONS_OPEN', /\bopen\b.*\bdirections?\b.*\b(to|for)\b|\bshow\b.*\bdirections?\b.*\bon\b.*\bmaps\b|\bopen\b.*\bmaps?\b.*\bdirections?\b/, .95, 'directionsOpen'],
    // "go to leetcode" / "take me to github" / "visit gfg": only when the rest is a known site (never "go to sleep").
    // A full address ("go to leetcode.com/problems/two-sum") is OPEN_URL's job — this would open only the home page.
    ['OPEN_APPLICATION', s => { const m = /^(?:go to|take me to|visit)\s+(?:the\s+)?(.+?)(?:\s+(?:website|site|page))?$/.exec(s); return !!(m && m[1].split(' ').length <= 3 && !/\.[a-z]{2,}\b/.test(m[1]) && findSite(m[1])); }, .93, 'openApplication'],
    ['DIRECTIONS', /\b(directions?|route)\s+(?:please\s+)?(to|from)\b|\bhow (?:do i|to) (?:get to|reach)\b(?!\s+out\b)|\bhow (?:can|do) i reach\b(?!\s+out\b)|\b(?:need|want|have) to reach\b(?!\s+out\b)|\bnavigate to\b|\b(?:need|want|have) to (?:go|travel|drive)\b.*\bto\b|\bhow do i go\b.*\bto\b|\btake me\b.*\bto\b|\bguide me to\b|\bwhich way to\b|\b(?:get|drive) me to\b|\bfastest way to (?:reach|get to)\b|\bplan(?:ning)? a (?:road trip|trip)\b.*\bto\b|\btravel(?:l)?ing to\b.*\bfrom\b/, .95, 'directions'],
    ['DISTANCE', /\bhow far (is|are)\b.*\bfrom\b|\bdistance (between|from)\b.*\b(and|to)\b|\bhow far\b.*\bfrom\b.*\bto\b|\bhow (?:many|much) (?:kms?|kilometers?|kilometres?)\b.*\b(from|between)\b|^km\s+from\b.*\bto\b|\bhow long (?:to|does it take to) drive\b.*\bfrom\b|\bis\b.+\bfar from\b|\btravel time\b.*\bfrom\b/, .95, 'distance'],
    ['YOUTUBE', /\b(play|search|find|watch|put on|show me|look up)\b (.+?) on (youtube|yt)\b|^(youtube|yt) (.+)$|\bon youtube\b/, .96, 'youtube'],
    // questions answered from the user's own files (local search, then the AI answers from the snippets)
    ['ASK_FILES', /\b(?:what|how|why|which|who|when|where|explain|does|do|is|are|tell me|find)\b.*\b[\w()-]+\.(?:pdf|md|txt)\b|\b(?:in|from|according to|inside)\s+(?:the\s+|my\s+)?[\w() -]+\.(?:pdf|md|txt)\b.*\b(?:what|how|why|explain|about|define|find)\b|\b(what|which|where|how|when)\b.*\b(my|the|our) (\w+ )?(notes?|files?|documents?|docs|project|code ?base|repo)\b.*\b(say|says|said|mention|mentions|mentioned|cover|covers|covered|state|states|explain|explains|contain|contains|about|on)\b|^(search|look|dig|grep|check) (through |in |into )?(my|the|all my) (\w+ )?(notes|files|documents|docs|code ?base|project|projects) (for|about|on) .+|\baccording to (my|the) (\w+ )?(notes|files|docs|documents)\b|^(in|from|using) (my|the) (\w+ )?(notes|files|documents|docs)[, ]+.{6,}|^ask (my|the) (\w+ )?(notes|files|documents|docs) .+/, .95, 'askFiles'],
    ['SITE_SEARCH', /\bsearch (on |in )?(google|youtube|github|leetcode|gfg|geeksforgeeks|stack ?overflow|mdn|python docs|wikipedia|wiki|amazon|flipkart|reddit|maps)( for)? .+|\b(search|look up|find) (for )?.+ on (google|github|leetcode|gfg|geeksforgeeks|stack ?overflow|mdn|python docs|wikipedia|wiki|amazon|flipkart|reddit|maps)$/, .95, 'siteSearch'],
    ['WEB_SEARCH', /^(google|search( the web| online| google| the internet)?( for)?|look up|search up|browse for) .+/, .92, 'searchWeb'],
    ['OPEN_URL', /\b(open|go to|visit|launch|browse|take me to|load)\b.*\b([a-z0-9-]+\.)+(com|org|net|io|dev|in|edu|co|ai|app|gov|me|tv|xyz)\b/, .96, 'openUrl'],

    // system power
    ['SYS_CANCEL_SHUTDOWN', /\b(cancel|abort|stop|don'?t)\b.*\b(shut ?down|restart|reboot)\b/, .97, 'cancelShutdown'],
    // "lock yourself" / "lock the app": JARVIS's own lock (applock.js) — not the Windows screen
    ['LOCK_JARVIS', /^(?:lock|secure)(?: up| down)? (?:yourself|the app|this app|the assistant|your app)(?: now)?$/, .97, 'lockJarvis'],
    ['SYS_LOCK', /\block\b.*\b(screen|system|computer|pc|laptop|it|workstation)\b|^lock( up)?$/, .96, 'lockSystem'],
    ['SYS_SLEEP', /\bput (the |my )?(computer|laptop|pc|system) to sleep\b|\b(sleep|hibernate|suspend)\b.*\b(computer|system|pc|laptop|mode)\b|^(go to sleep|sleep)$/, .94, 'sleepSystem'],
    ['SYS_SHUTDOWN', /\b(shut ?down|power off|turn off|switch off)\b.*\b(computer|system|pc|laptop|machine)\b|^shut ?down$/, .95, 'shutdownSystem'],
    ['SYS_RESTART', /\b(restart|reboot)\b.*\b(computer|system|pc|laptop|machine)\b|^(restart|reboot)$/, .95, 'restartSystem'],

    // volume & media
    ['VOLUME_MUTE', /\b(un)?mute\b|\b(turn|switch|shut) (the )?(sound|audio|volume) (off|on)\b|\bsilence\b|^no (sound|audio)$/, .96, 'setVolume'],
    ['VOLUME_UP', /\b(volume up|turn (it |the volume |the sound )?up|increase (the )?(volume|sound)|louder|raise (the )?volume|pump (it|the volume) up|crank (it|the volume) up|can'?t hear)\b/, .96, 'setVolume'],
    ['VOLUME_DOWN', /\b(volume down|turn (it |the volume |the sound )?down|decrease (the )?(volume|sound)|lower (the )?(volume|sound)|quieter|too loud|reduce (the )?(volume|sound))\b/, .96, 'setVolume'],
    ['MEDIA_NEXT', /\b(next|skip)( this)? (song|track|one)\b|^(skip|next)( it)?$/, .95, 'mediaKey'],
    ['MEDIA_PREV', /\b(previous|last|prev) (song|track)\b|\bgo back a (song|track)\b|\bplay (that|the) (song )?again\b/, .95, 'mediaKey'],
    ['MEDIA_STOP', /\bstop (the )?(music|playing|playback|song)\b/, .94, 'mediaKey'],
    ['MEDIA_PLAY', /^(play|pause|resume|unpause)( it| the music| music| the song| song| playback)?$|\b(pause|resume) (the )?(music|song|video|playback)\b/, .95, 'mediaKey'],
    ['YOUTUBE_PLAY', /^(play|put on|stream) (?!it$|music$|the music$)(.+)$/, .86, 'youtube'],

    // system info
    ['SCREENSHOT', /\bscreenshot\b|\bscreen ?grab\b|\bcapture (the |my )?screen\b|\bsnap (the |my )?screen\b/, .96, 'screenshot'],
    ['SYS_BATTERY', /\bbattery\b|\bcharge (left|level|remaining)\b|\bam i (charging|plugged in)\b|\bhow much charge\b/, .95, 'batteryStatus'],
    ['SYS_PROCESSES', /\b(running processes|what'?s running|what is running|top processes|task list|cpu hogs?|what'?s (using|eating|hogging) (my )?(ram|memory|cpu))\b/, .93, 'listProcesses'],
    ['SYS_CPU', /\b(cpu|processor)( usage| load| use| utili[sz]ation| temp(erature)?| status)\b|\b(how much|how busy|how hard)\b.*\b(cpu|processor)\b|^(cpu|processor)$|\bcpu usage\b/, .93, 'getSystemInfo'],
    ['SYS_RAM', /\b(ram|memory) (usage|used|left|free|available|status)\b|\bhow much (ram|memory)\b|\bfree (ram|memory)\b|^(ram|memory)( usage)?$/, .93, 'getSystemInfo'],
    ['SYS_DISK', /\b(disk|storage|drive|ssd) (space|usage|left|free|status)\b|\bhow much (storage|disk|space)\b|\b(free|remaining) (disk|storage|space)\b|\bspace left\b|^(disk|storage)( usage)?$/, .93, 'getSystemInfo'],
    ['SYS_OS', /\b(operating system|what os|which os|os version|windows version)\b/, .95, 'getSystemInfo'],
    ['SYS_ALL', /\b(system|computer|pc|laptop)('?s)? (status|info|health|stats|performance)\b|\bhow('?s| is) (my |the )?(system|computer|pc|laptop)( doing)?\b|^what('?s| is) (my |the )?(system|computer|pc|laptop)( like| doing)?$|\bdiagnostics?\b/, .93, 'getSystemInfo'],
    ['SYS_NETWORK', /\b(ip address|my ip|what'?s my ip|network (info|details|status)|hostname|which wi-?fi|connected to)\b/, .95, 'networkInfo'],

    // files (sandbox)
    ['DESTRUCTIVE', /\b(delete|remove|erase|wipe) (everything|all (the |my )?files)\b|\bformat (the |my )?(drive|disk|computer)\b|\bclear (the )?sandbox\b/, .99, 'deleteFiles'],
    ['DELETE_ITEM', /\b(delete|remove|trash|bin)\b (the |my |that )?(folder|file|note|directory)\b|^(delete|remove|trash) [\w\- ]+\.\w+$/, .93, 'deleteItem'],
    ['NOTE_APPEND', /^(take|make|write|jot|add) (a )?note(?! (called|named|titled)\b):? (.+)|^note( down)?:? (.+)/, .93, 'writeFile'],
    ['WRITE_FILE', /\b(create|make|write|save|new)( a| an)?( new)? (?:\w+ )?(file|note|document)\b/, .94, 'writeFile'],
    // "what version of node am I running" / "my python version" / "check git version": what's installed HERE —
    // never "what's the latest python version" (that's a fresh fact for the web)
    ['TOOL_VERSION', s => /\b(?:what|which)\s+(?:node(?:\.?js)?|python3?|npm|pip|git|java|gcc|g\+\+|ollama|docker|vs ?code)\s+version\s+(?:do i have|have i got|am i (?:running|using|on)|is installed|is on (?:my|this))|\b(?:what|which)\s+version\s+of\s+(?:node(?:\.?js)?|python3?|npm|pip|git|java|javac|gcc|g\+\+|c\+\+|ollama|docker|vs ?code|visual studio code)\b|\b(?:my|installed|local)\s+(?:node(?:\.?js)?|python3?|npm|pip|git|java|gcc|g\+\+|ollama|docker|vs ?code)\s+version\b|\b(?:check|show|tell me|get)\s+(?:my\s+|the\s+)?(?:node(?:\.?js)?|python3?|npm|pip|git|java|gcc|g\+\+|ollama|docker|vs ?code)\s+version\b|^(?:node(?:\.?js)?|python3?|npm|pip|git|java|gcc|g\+\+|ollama|docker)\s+(?:--)?version$/.test(s)
      && !/\b(?:latest|newest|new|released?|upcoming|stable|lts|current release)\b/.test(s), .95, 'toolVersion'],
    // "what's the latest file in my project" / "newest files in D:\x" / "which files did I change recently"
    ['RECENT_FILES', /\b(?:latest|newest|most recent(?:ly)?|recent(?:ly)?|last (?:modified|edited|changed|saved))\s+(?:\w+\s+)?files?\b|\bfiles? (?:i|that i) (?:changed|edited|modified|saved) (?:recently|last|today)\b|\bwhich files? (?:did i|have i) (?:change|edit|modif\w*|save)/, .93, 'recentFiles'],
    // "list number of folders in my laptop" / "how many folders are in D drive" / "count my directories"
    ['COUNT_FOLDERS', /\b(?:how many|number of|no\.? of|count(?: of)?|total(?: number of)?|amount of)\s+(?:all\s+)?(?:the\s+|my\s+)?(?:folders?|director(?:y|ies)|dirs|files)\b|\bcount\s+(?:all\s+)?(?:the\s+|my\s+)?(?:folders?|director(?:y|ies)|files)\b/, .95, 'countFolders'],
    ['CREATE_FOLDER', /\b(create|make|new|add|build|generate)( me)?( a| an| one| the)?( new)? (?:\w+ )?(folder|directory|dir)\b/, .96, 'createFolder'],
    ['RENAME_FILE', /\brename\b/, .92, 'renameFile'],
    ['COPY_FILE', /\b(copy|duplicate)\b .+ \bto\b/, .9, 'copyFile'],
    ['MOVE_FILE', /\bmove\b .+ \b(to|into)\b/, .9, 'moveFile'],
    ['SEARCH_FILES', /\b(find|search( for)?|locate|where is)( the| my)? (file|files|folder|document|note)s?\b/, .92, 'searchFiles'],
    // "where is pythonProject" / "locate calculator.html" / "find agriloop on my laptop": a name on this laptop. If
    // nothing on the laptop matches, the handler hands it to the AI ("where is delhi" is still answered).
    ['SEARCH_FILES', /^(?:where(?:'s| is)|locate|find)\s+(?:my\s+|the\s+)?[\w.\-()]+(?:\s+[\w.\-()]+){0,3}?(?:\s+(?:on|in) (?:my |the |this )?(?:laptop|computer|pc|system|drives?))?$/, .88, 'searchFiles'],
    ['LIST_FILES', /\b(list|show|display|what)( me)?( are)?( all)?( the| my)? (files|folders|documents|notes|directories|dirs)\b|\bwhat'?s in (the |my )?(sandbox|jarvis folder|[a-z] drive)\b|\b(?:list|show|display)\b.*\b(?:folders|directories|files)\s+(?:in|on|inside|of|from)\b/, .94, 'listFiles'],
    ['READ_FILE', /\b(read|open|show|display|what'?s in)( me)?( the| my)? ([\w\-.]+ )?(file|note|notes|document)\b|\b(?:read|open|show)(?: me)? [\w\-() ]+\.(txt|md|pdf)\b/, .9, 'readFile'],
    ['OPEN_FOLDER', /\bopen\b.*\b(folder|directory|sandbox|downloads|documents|projects)\b/, .93, 'openFolder'],

    // git / dev
    ['GIT_STATUS', /\bgit status\b|\brepo(sitory)? status\b|\bany (uncommitted|unstaged) changes\b/, .96, 'gitStatus'],
    ['GIT_LOG', /\bgit log\b|\b(recent|last|latest) commits?\b|\bcommit history\b/, .95, 'gitLog'],
    ['GIT_DIFF', /\bgit diff\b|\bwhat (has )?changed\b/, .93, 'gitDiff'],
    ['GIT_COMMIT', /\bgit commit\b|\bcommit (my |the |all )?(changes|work|code)\b/, .93, 'gitCommit'],
    ['CHECK_PORT', /\bport \d{2,5}\b|\bcheck (the )?port\b|\bis (the )?port\b/, .94, 'checkPort'],

    ['GET_TIME', /^(what('?s| is)? the time|what time is it|time( now)?|current time|tell me the time|do you know the time)( now| right now| please)?$|\btime is it\b/, .97],
    ['GET_DATE', /\bwhat('?s| is)? (the |today'?s )?(date|day)( today)?\b|\btoday'?s date\b|\bwhich day is (it|today)\b/, .96],
    ['BRIEFING', /\bbriefing\b|\bmorning (report|update|summary)\b|\bwhat'?s (the plan|my day|up today)\b|\bplan for today\b|\bdaily (update|summary)\b|\bstatus report\b/, .93, 'dailyBriefing'],
    ['WORKFLOW', /\b(productivity|coding|dev|developer) mode\b|\bprepare (my )?(coding |dev )?(environment|setup|workspace)\b|\b(start|let'?s start) coding\b|\bset ?up (my )?workspace\b/, .92, 'runWorkflow'],

    // generic open/close go last so specific rules win
    ['CLOSE_APPLICATION', /^(close|kill|quit|exit|shut|terminate|end)\b/, .9, 'closeApplication'],
    ['OPEN_APPLICATION', /^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me)\b|\bopen (up )?[a-z]/, .9, 'openApplication'],
  ];

  // Presence checks run on the raw text, because normalize() strips the wake word ("jarvis?" → "").
  function presence(norm) {
    const w = esc(norm.wake || 'jarvis');
    const raw = String(norm.original || '').toLowerCase().replace(/[’]/g, "'").replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hello = '(?:(?:hi|hey|hello|yo|ok|okay|oi|sup)\\s+)?';
    if (new RegExp(`^${hello}(?:${w}\\s*)?(?:are you (?:there|up|awake|online|around|listening|here|with me)|you (?:there|up|awake|around|listening|with me)|wake up(?: daddy'?s home)?|daddy'?s home|anyone (?:there|home))\\s*\\??$`).test(raw)) return true;
    return new RegExp(`^${hello}${w}\\s*\\??$`).test(raw) && !/^(hi|hey|hello|sup)\b/.test(raw) || new RegExp(`^${w}\\s*\\?$`).test(raw);
  }
  /* ---------- typo tolerance: a second pass that fixes near-miss command words ---------- */
  const VOCAB = new Set(('open close launch start stop cancel pause resume play next previous skip timer timers alarm remind reminder reminders '
    + 'lock unlock screen screenshot brightness brighter dimmer bluetooth wifi dark light mode theme focus pomodoro session read weather '
    + 'temperature volume mute unmute battery charge to-do list task tasks deadline deadlines assignment search google youtube briefing joke '
    + 'forecast system status memory disk network restart shutdown clipboard copy paste translate convert calculate minute minutes second '
    + 'seconds hour hours tomorrow tonight today morning evening schedule routine diagnostics display monitor window maximize minimize '
    + 'power saver performance balanced increase decrease lower raise louder quieter show clear finish complete delete remove notes '
    + 'flashcards quiz contest contests leetcode github explain summarize summarise downloads folder files spotify chrome notepad calculator '
    + 'explorer discord whatsapp telegram firefox settings terminal powershell tell joke time date').split(' '));
  for (const a of APPS) for (const n of a.names) for (const w of n.split(' ')) if (w.length >= 5) VOCAB.add(w);
  // Real words that sit one letter away from a command word ("clock" ≠ "lock").
  const REAL = new Set('lose star tier sore tore bore tart pase seat sear lear hour ours note mote rest tell time clock block black stock stack stark state store stops starts plays player lines times tiger tigers water later lighter night right might fight sight tight reads ready weight whether rather father mother other cloud world words story music video movie model modes codes nodes notes nose close closer closet screens scream stream dream cream clean clear clearly timely mouse house horse remote remove moved muted posts paste taste waste boost roast toast chart smart start party search reach teach beach lists least taste theme there these those three thread'.split(' '));
  // Edit distance where swapping two neighbouring letters ("cancle" → "cancel") costs 1.
  function osa(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }
  // Is w the candidate with one letter left out ("clse" → "close")?
  const dropped = (w, v) => v.length === w.length + 1 && [...v].some((_, i) => v.slice(0, i) + v.slice(i + 1) === w);
  function fuzzyFix(s) {
    let changed = false;
    const out = s.split(' ').map(w => {
      if (w.length < 4 || VOCAB.has(w) || REAL.has(w) || /\d/.test(w)) return w;
      // 4-letter words: only a single dropped letter, so real words like "look" never become "lock".
      if (w.length === 4) {
        const c = [...VOCAB].filter(v => dropped(w, v));
        if (c.length === 1) { changed = true; return c[0]; }
        return w;
      }
      const max = w.length >= 8 ? 2 : 1;
      let best = null, bestD = 99, tie = false;
      for (const v of VOCAB) {
        if (Math.abs(v.length - w.length) > max) continue;
        const d = osa(w, v);
        if (d < bestD) { best = v; bestD = d; tie = false; } else if (d === bestD) tie = true;
      }
      if (best && bestD <= max && !tie) { changed = true; return best; }
      return w;
    }).join(' ');
    return changed ? out : null;
  }
  function classify(norm, ctx) {
    const r = classifyRules(norm, ctx);
    // Strengthening: if the first pass returned CONVERSATION or a low-confidence rule match,
    // try fuzzyFix on the input and re-classify. The original code only re-checked on bare/
    // CONVERSATION results — meaning a confident-but-wrong match (e.g. "opn crome" → matched
    // OPEN_APPLICATION with the wrong app) was never re-examined. Now we re-check whenever
    // the result is unsure (confidence < 0.92) OR the bare fallback fired OR it's CONVERSATION.
    // The 0.92 threshold is chosen so high-confidence rules (.95+) skip the second pass entirely
    // (preserving speed), while genuinely uncertain matches get a second look.
    const unsure = r.intent === 'CONVERSATION' || r.bare || (r.confidence != null && r.confidence < 0.92);
    if (!unsure || norm.text.split(' ').length > 8) return r;
    const fixed = fuzzyFix(norm.text);
    if (!fixed) return r;
    const r2 = classifyRules(Object.assign({}, norm, { text: fixed }), ctx);
    // Only override the original result if the fuzzy-fix produced a meaningfully better match:
    // a non-CONVERSATION intent with confidence >= 0.85 AND higher than the original.
    if (r2.intent !== 'CONVERSATION' && !r2.bare && r2.confidence >= .85 && r2.confidence > (r.confidence || 0)) {
      return Object.assign(r2, { corrected: fixed });
    }
    return r;
  }

  function classifyRules(norm, ctx) {
    if (presence(norm)) return { intent: 'PRESENCE', confidence: .98, tool: null, args: {}, text: norm.text };
    // "hi jarvis" / "good morning jarvis": the wake word was stripped, so recover the greeting from the raw text.
    const rawGreet = String(norm.original || '').toLowerCase().replace(/[.!,?]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (new RegExp(`^(hi|hello|hey|yo|hii+|hola|namaste|sup|good (morning|afternoon|evening))( there)? ${esc(norm.wake || 'jarvis')}$`).test(rawGreet)) return { intent: 'GREETING', confidence: .97, tool: null, args: {}, text: rawGreet };
    // "lock jarvis": the wake word was stripped ("lock jarvis" → "lock" → lock the WINDOWS screen), so read the raw text.
    // Locks JARVIS itself (the app lock, Settings → Data); "lock the screen" / "lock my laptop" still lock Windows.
    if (new RegExp(`^(?:please )?(?:lock|secure)(?: up| down)? (?:${esc(norm.wake || 'jarvis')}|jarvis|friday|yourself|the app|this app|the assistant|your app)(?: now)?$`).test(rawGreet))
      return { intent: 'LOCK_JARVIS', confidence: .97, tool: 'lockJarvis', args: {}, text: 'lock jarvis' };
    let s = norm.text;
    ctx = ctx || {};
    // ---- Negation rewriting (Strengthening) ----
    // "don't open chrome" / "do not open chrome" / "never open chrome" → strip the negation,
    // remember the polarity, and rewrite the verb so the CLOSE rule picks it up. We only
    // rewrite OPEN→CLOSE here (the common case); other intents (volume/brightness/timer)
    // typically have "cancel" or "stop" as a separate command already, so this is a surgical
    // fix for the most common "I said open but meant don't open" confusion.
    // We attach a `_negated: true` flag so the inspector and downstream tools can see it.
    // The verb alternation handles -ing forms too: "stop opening discord" → "close discord".
    let negated = false;
    const negMatch = s.match(/^(?:please\s+)?(?:don['']?t|do\s+not|never|stop|quit)\s+(open|launch|start|run|fire\s+up|boot\s+up|boot|pull\s+up|bring\s+up|load)(?:ing)?\s+(.*)/i);
    if (negMatch) {
      s = 'close ' + negMatch[2].trim();
      negated = true;
    }
    // Run the original classifier on the (possibly rewritten) text.
    const result = classifyRulesInner(Object.assign({}, norm, { text: s }), ctx);
    if (negated) result._negated = true;
    return result;
  }
  function classifyRulesInner(norm, ctx) {
    if (presence(norm)) return { intent: 'PRESENCE', confidence: .98, tool: null, args: {}, text: norm.text };
    // "hi jarvis" / "good morning jarvis": the wake word was stripped, so recover the greeting from the raw text.
    const rawGreet = String(norm.original || '').toLowerCase().replace(/[.!,?]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (new RegExp(`^(hi|hello|hey|yo|hii+|hola|namaste|sup|good (morning|afternoon|evening))( there)? ${esc(norm.wake || 'jarvis')}$`).test(rawGreet)) return { intent: 'GREETING', confidence: .97, tool: null, args: {}, text: rawGreet };
    const s = norm.text;
    ctx = ctx || {};
    // Short follow-ups that only make sense with context.
    if (ctx.lastIntent && /^(and|also|what about|how about|now|then)\b/.test(s)) {
      const rest = s.replace(/^(and|also|what about|how about|now|then)\s+/, '').replace(/\btoo$|\bas well$/, '').trim();
      if (/^(ram|memory|cpu|disk|storage|battery|network|ip)\b/.test(rest)) return classify({ text: rest + ' usage', original: norm.original }, {});
      if (/^(OPEN_APPLICATION|CLOSE_APPLICATION)$/.test(ctx.lastIntent) && (findApp(rest) || findSite(rest))) {
        return { intent: ctx.lastIntent, confidence: .9, tool: ctx.lastIntent === 'OPEN_APPLICATION' ? 'openApplication' : 'closeApplication', args: {}, text: (ctx.lastIntent === 'OPEN_APPLICATION' ? 'open ' : 'close ') + rest };
      }
      if (ctx.lastIntent === 'WEATHER') return { intent: 'WEATHER', confidence: .9, tool: 'weather', args: {}, text: 'weather in ' + rest };
    }
    // "…and copy it": let the AI write it, then put the result on the clipboard.
    const copyTail = /[,\s]+(and|then)\s+copy\s+(it|that|this|the (result|answer|text|email|message|reply|code|output))(\s+to\s+(my\s+|the\s+)?clipboard)?$/;
    if (copyTail.test(s) && /^(write|draft|compose|create|generate|make|give me|translate|rewrite|summari[sz]e|convert|prepare)\b/.test(s)) {
      return { intent: 'DRAFT_COPY', confidence: .95, tool: 'copy', args: { prompt: norm.original.replace(/[,\s]+(and|then)\s+copy\s+.*$/i, '') }, text: s };
    }
    // Concept questions ("explain CPU scheduling", "time complexity of …") belong to the AI, not system tools.
    if (/^(explain|describe|define|teach me|how (does|do|can|to)|why|compare|difference between|what('?s| is| are) (a |an |the )?(difference|meaning|use|purpose|advantage|disadvantage)s?\b)|\b(time|space) complexity\b|\bbig[- ]?o\b/.test(s)
      && !/\b(clipboard|copied|screen|window|display|tab|browser|web ?page)\b|\.(pdf|md|txt)\b|\b(according to|in|from) (my|the) (\w+ )?(notes|files|docs|documents)\b/.test(s) && !/\bhow (?:do|can) i (?:get to|go|reach)\b|\bhow to (?:get to|reach)\b/.test(s)
      && !/^why (?:did|do|would) you\b|^why (?:was|is) (?:that|this|it) (?:needed|required|necessary|confirmation|permission)\b/.test(s)) {
      return { intent: 'CONVERSATION', confidence: .5, tool: null, args: {}, text: s };
    }
    // Weather somewhere no forecast service covers ("the weather on mars", "temperature of the sun") is a science question.
    if (/\b(weather|temperature|climate|rain|forecast|hot|cold)\b/.test(s) && /\b(?:on|of|in|at)\s+(?:the\s+)?(?:mars|venus|jupiter|saturn|mercury|neptune|uranus|pluto|moon|sun|titan|europa|space|other planets?)\b/.test(s))
      return { intent: 'CONVERSATION', confidence: .5, tool: null, args: {}, text: s };
    // Just the verb ("open", "launch") names nothing to open — ask, instead of searching the web for the word "open".
    if (/^(?:open|launch|start|run|load|close|quit)(?: it up| up)?$/.test(s)) return { intent: 'ASK_WHAT', confidence: .95, tool: null, args: { verb: s.split(' ')[0] }, text: s };
    for (const [intent, test, conf, tool] of R) {
      const ok = typeof test === 'function' ? test(s) : test.test(s);
      if (ok) {
        let c = conf;
        // Sanity check: "open the latest chrome documentation" / "open the vs code docs" is the PAGE about the app, not the app.
        if (intent === 'OPEN_APPLICATION' && /\b(?:documentation|docs|tutorials?|manual|changelog|release notes|api reference|official (?:site|website|page))\b/.test(s)
          && !/\b(?:folder|directory|files?|project|in|inside|into|with|and|then)\b/.test(s) && findApp(s)) {
          const target = s.replace(/^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me|go to|take me to|visit)\s+(up\s+)?(the\s+|my\s+)?/, '').trim();
          return { intent: 'OPEN_WEB', confidence: .92, tool: 'openWeb', args: { query: target }, text: s };
        }
        // Sanity check: "open calculator.html" / "open main.py" names a file — not the Calculator app or a website.
        // (node.js / vue.js / next.js are frameworks, not files: "open the latest node.js documentation" is a web page)
        if (intent === 'OPEN_APPLICATION' && /\b(?!(?:node|vue|next|nuxt|three|react|express|d3|chart|p5|angular|ember|backbone|socket)\.js\b)[\w\-]+\.(?:html?|py|js|ts|jsx|tsx|c|cpp|h|java|cs|go|rs|css|json|csv|txt|md|pdf|docx?|pptx?|xlsx?|png|jpe?g|gif|ipynb|sql)\b/.test(s))
          return { intent: 'READ_FILE', confidence: .92, tool: 'readFile', args: {}, text: s };
        // "open <something unknown>" = open the best web page for it (e.g. "open SIH 2026 problem statements").
        if (intent === 'OPEN_APPLICATION' && !findApp(s) && !/\b(folder|file|directory)\b/.test(s) && !/^(open|launch|start|run|load)\s+(it|that|this)\b/.test(s)) {
          const target = s.replace(/^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me|go to|take me to|visit)\s+(up\s+)?(the\s+|my\s+)?/, '').trim();
          const site = findSite(s);
          // "smart india hackathon website" is the Smart India Hackathon site — the trailing word isn't part of its name.
          const bare = bareSiteName(target);
          if (!site || (target.split(' ').length > 2 && !site.names.some(nm => nm === target || nm === bare))) {
            // Sanity check: a duration, session, mode, routine or timer is never a web page ("start a 45 minute
            // session", "run exam prep mode") — hand it to the AI instead of searching the web for it.
            const notAPage = /\b\d+[\s-]*(?:min(?:ute)?s?|hours?|hrs?|sec(?:ond)?s?)\b|\b(?:session|mode|routine|timer|pomodoro|focus|tab|window)\b/.test(target);
            if (target && !notAPage && !/^(app|application|program|something)$/.test(target)) return { intent: 'OPEN_WEB', confidence: .92, tool: 'openWeb', args: { query: target }, text: s };
            c = .6;
          }
        }
        if (intent === 'CLOSE_APPLICATION' && !findApp(s)) c = .7;
        // Sanity check: a device control inside a question or an opinion is talk, not a command — "what is volume in
        // physics", "my brightness is always low, why?", "i love the dark mode theme". A number or a command verb
        // keeps it a command ("why is volume at 100? set it to 30").
        if (/^(VOLUME_SET|VOLUME_UP|VOLUME_DOWN|VOLUME_MUTE|BRIGHTNESS|DARK_MODE|RADIO)$/.test(intent)
          && (/\?$|^(why|what is|what are|explain|define|describe|how does|how do)\b/.test(s) || /^(i|we) (love|like|hate|prefer|enjoy|think|feel)\b|^my \w+ is\b/.test(s))
          && !/\b(set|turn|switch|change|make|put|increase|decrease|raise|lower|reduce|mute|unmute|enable|disable)\b.*|\b(?:to|at) \d{1,3}\b/.test(s)) c = .6;
        // Sanity check: "search for my notes" means your files, not a Google search for the words "my notes".
        if (intent === 'WEB_SEARCH' && /^(search|look up|search up|find)( for)? (my|the) (\w+ )?(files?|notes?|documents?|folders?)$/.test(s)) return { intent: 'SEARCH_FILES', confidence: .92, tool: 'searchFiles', args: {}, text: s };
        // Sanity check: "show me notes.md" names one file — read it, don't list the folder.
        if (intent === 'LIST_FILES' && /\b[\w-]+\.[a-z0-9]{1,5}\b/.test(s)) return { intent: 'READ_FILE', confidence: .9, tool: 'readFile', args: {}, text: s };
        // Sanity check: "take me to github" is a website, not a trip — directions only for a real place.
        if (intent === 'DIRECTIONS' && !/\b(from|directions?|route|navigate|drive|travel|reach)\b/.test(s)) {
          const dest = s.replace(/^.*?\b(?:take me|go|get me)\s+to\s+(?:the\s+)?/, '').trim();
          if (findSite(dest) && dest.split(' ').length <= 3) return { intent: 'OPEN_APPLICATION', confidence: .92, tool: 'openApplication', args: { app: dest }, text: s };
        }
        // "open github desktop" is the app, not the Desktop folder: a multi-word installed app name beats the
        // folder word inside it (a plain "open photos" still opens the Pictures folder).
        if (intent === 'OPEN_KNOWN_FOLDER') {
          const inst = fuzzyFind(s, INSTALLED, true);
          if (inst && inst.names.some(nm => nm.includes(' ') && new RegExp(`(^|[^a-z])${esc(nm)}($|[^a-z])`).test(s)))
            return { intent: 'OPEN_APPLICATION', confidence: .92, tool: 'openApplication', args: {}, text: s };
        }
        if (intent === 'OPEN_IN_EDITOR') { const ef = editorFolder(s); if (ef) return { intent, confidence: c, tool: tool || null, args: { name: ef.folder }, text: s }; }
        return { intent, confidence: c, tool: tool || null, args: {}, text: s };
      }
    }
    // Bare app or site name ("chrome", "the spotify app") → open it. Only when nothing else is said:
    // "uninstall discord" or "delete chrome" must not launch the app.
    if (s.split(' ').length <= 3) {
      const app = findApp(s), site = !app && findSite(s);
      const names = app ? app.names : site ? site.names : [];
      const rest = names.reduce((t, n) => t.replace(new RegExp('\\b' + esc(n) + '\\b'), ' '), s)
        .replace(/\b(the|my|app|application|website|site|please|now|up)\b/g, ' ').trim();
      if ((app || site) && !rest) return { intent: 'OPEN_APPLICATION', confidence: .88, tool: 'openApplication', args: {}, text: 'open ' + s, bare: true };
    }
    return { intent: 'CONVERSATION', confidence: .5, tool: null, args: {}, text: s };
  }

  /* ---------- Telugu / Kannada typed in English letters ("volume penchu", "timer cancel maadu") ---------- */
  const words = s => s.split(/\s+/).filter(Boolean);
  const STRONG = {
    te: new Set('cheyyi cheyi chey cheyyandi cheyandi cheyyu cheppu cheppandi chepu penchu penchandi tagginchu thagginchu pettu pettandi teeyi tiyyi theeyi tiyi chupinchu choopinchu chupinchandi theruvu teruvu terichu mooseyyi moosey museyyi mooyi chaduvu chadavu vethuku vetuku vedaku gurthu gurtu ivvu ivvandi entha enta enti emiti ela undi vundi unnav unnavu unnaru aapu aapey aapandi raddu modalupettu cheyyamani ayyindi kavali kaavali nimishalu nimishallo gantalu gantallo ante'.split(' ')),
    kn: new Set('maadu maadi madu madi maadri helu heli haaku haku haako idu tegi tegey torisu thorisu tere muchu mucchu odu huduku hudukey nenapisu kodu kodi eshtu eshtide estu enu yenu hegide hegiddiya hegidira hegiddira jaasti jasti kammi kadime shuru nillisu nilsu serisu ivattu naale nimisha nimishakke nimishadalli gante maadoke maadalu beku beda andre'.split(' ')),
  };
  const WEAK = { te: new Set('lo ki ku naa oka ra andi ee roju repu paata paatalu ippudu'.split(' ')), kn: new Set('alli nalli ge kke nanna ondu kano ri haadu iga eega'.split(' ')) };
  // 'te' | 'kn' | null. Needs at least one Telugu/Kannada verb or question word, so English sentences are never caught.
  // minScore: 2 = one Telugu/Kannada word is enough (the caller then checks the result is a real command); 3+ = stricter.
  function romanLang(text, minScore) {
    const s = String(text || '').toLowerCase();
    if (/[^\x00-\x7F]/.test(s)) return null;
    const w = words(s.replace(/[^a-z0-9: ]/g, ' '));
    const sc = { te: 0, kn: 0 };
    for (const x of w) for (const l of ['te', 'kn']) if (STRONG[l].has(x)) sc[l] += 2;
    if (!sc.te && !sc.kn) return null;
    for (const x of w) for (const l of ['te', 'kn']) if (WEAK[l].has(x)) sc[l] += 1;
    if (Math.max(sc.te, sc.kn) < (minScore || 2)) return null;
    return sc.kn > sc.te ? 'kn' : 'te';
  }
  const HELPER = '(?:cheyyi|cheyyandi|cheyandi|cheyi|chey|cheyyu|maadu|maadi|madu|madi|maadri|maadona)';
  const NATIVE_VERBS = [
    [/\s*\b(?:gurthu|gurtu) (?:cheyyi|cheyyandi|pettu)$|\s*\b(?:nenapisu|nenapu maadu|nenapu madu)$/, 'remind me to'],
    [/\s*\b(?:penchu|penchandi|ekkuva cheyyi|jaasti maadu|jasti maadu|jaasti madu|hechchu maadu|hechisu|hecchu maadu)$/, 'increase'],
    [/\s*\b(?:tagginchu|thagginchu|takkuva cheyyi|kammi maadu|kammi madu|kadime maadu|kadimi maadu)$/, 'decrease'],
    [/\s*\b(?:chupinchu|choopinchu|chupinchandi|chupettu|torisu|thorisu)$/, 'show'],
    [/\s*\b(?:cheppu|cheppandi|chepu|helu|heli)$/, 'tell me'],
    [/\s*\b(?:teeyi|tiyyi|theeyi|tiyi|tegi|tegey|tegiri|tago)$/, 'take'],
    [/\s*\b(?:chaduvu|chadavu|chadivi|odu|odi)$/, 'read'],
    [/\s*\b(?:vethuku|vetuku|vedaku|huduku|hudukey|hudki)$/, 'search for'],
    [/\s*\b(?:cherchu|kalupu|serisu|seru)$/, 'add'],
    [/\s*\b(?:theruvu|teruvu|terichu|tere|teri)$/, 'open'],
    [/\s*\b(?:mooseyyi|moosey|museyyi|moosi|mooyi|muchu|mucchu|muchchu)$/, 'close'],
    [/\s*\b(?:raddu cheyyi|raddu maadu)$/, 'cancel'],
    [/\s*\b(?:aapu|aapey|aapandi|apu|nillisu|nilsu|nilsi)$/, 'stop'],
    [/\s*\b(?:modalupettu|modalu pettu|prarambhinchu|shuru maadu|shuru madu|shuru maadi|prarambhisu)$/, 'start'],
    [/\s*\b(?:ivvu|ivvandi|kodu|kodi|kodri)$/, 'give me'],
    [/\s*\b(?:pettu|pettandi|petu|haaku|haku|haako|idu|ittu)$/, 'put'],
  ];
  const ENG_VERB = 'open|close|play|start|stop|cancel|lock|unlock|mute|unmute|add|search|call|send|delete|remove|clear|pause|resume|restart|minimize|maximize|read|show|set|increase|decrease|check|refresh|install|download|save|copy|paste|explain|translate|shutdown|shut down|switch|turn|block|unblock|snap|skip';
  // Several commands in one sentence ("notepad open cheyyi and 1 nimisham timer pettu"): convert each clause, join with "and".
  const ROMAN_JOIN = /\s*(?:,|;|\b(?:and then|and|then|mattu|matte|haagu|inka|inkaa|tarvata|taruvata|tarvatha|aa tarvata|aamele|aamel|nantara|mele)\b)\s*/;
  function fromRoman(text, lang) {
    const clauses = String(text || '').split(ROMAN_JOIN).map(x => x.trim()).filter(Boolean);
    if (clauses.length < 2) return fromRomanOne(text, lang);
    const out = clauses.map(c => fromRomanOne(c, lang)).filter(Boolean);
    return out.join(' and ');
  }
  function fromRomanOne(text, lang) {
    let t = String(text || '').toLowerCase().replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(hey |ok |okay )?(jarvis|friday)\b\s*/, '');
    // Whole-sentence phrases.
    if (/^(ela unnav(u|ra)?|ela unnaru|ela unnavu|em chestunnav|hegiddiya|hegidira|hegiddira|hegiddya|hegidiya)$/.test(t)) return 'how are you';
    if (/^(thanks|thank you|thanku|dhanyavadalu|dhanyavaada|dhanyavadagalu)( ra| kano| andi| ri| boss| sir)*$/.test(t)) return 'thanks';
    if (/^(time|samayam|samaya|tym)( ippudu| iga| eega)? (entha|enta|eshtu|estu|enti|enu)( ayyindi| aaytu| aithu| agide| ide)?$/.test(t)) return 'what time is it';
    if (/^((ee roju|eeroju|ivattu|ivattina|indu) )?(date|tedi|tedhi|dinanka|dinaanka)( enti| entha| enu| yenu| eshtu)( ide)?$/.test(t)) return "what is today's date";
    // Words.
    const W = { nimishalu: 'minutes', nimishala: 'minutes', nimisham: 'minute', nimishaalu: 'minutes', nimisha: 'minutes', nimishakke: 'minutes', nimshalu: 'minutes',
      gantalu: 'hours', ganta: 'hour', gante: 'hour', gantey: 'hour', secondlu: 'seconds', paata: 'song', paatalu: 'songs', haadu: 'song', haadugalu: 'songs',
      amma: 'mom', naanna: 'dad', appa: 'dad', naa: 'my', oka: 'a', ondu: 'a', repu: 'tomorrow', naale: 'tomorrow', nale: 'tomorrow', ivattu: 'today', indu: 'today',
      okati: '1', rendu: '2', moodu: '3', naalugu: '4', aidu: '5', padi: '10', eradu: '2', mooru: '3', naalku: '4', hattu: '10',
      ippudu: 'now', iga: 'now', eega: 'now', saayantram: 'evening', sanje: 'evening', raatri: 'night', ratri: 'night', raatre: 'night', bayata: '', horage: '', antha: 'all', anni: 'all', ella: 'all', ellaa: 'all', into: 'times' };
    W.nanna = lang === 'kn' ? 'my' : 'dad';
    // "5 nimishallo" → "in 5 minutes"; "6 ki" → "at 6".
    t = t.replace(/\b(\d+) (nimishallo|nimishalalo|nimishadalli|nimishagalalli|nimishalli)\b/g, 'in $1 minutes')
      .replace(/\b(\d+) (gantallo|gantalalo|ganteyalli|gantegalalli)\b/g, 'in $1 hours')
      .replace(/\b(\d{1,2}(?::\d{2})?)\s*(ki|ku|ke|ge|kke|gantalaki|gantege)\b/g, 'at $1')
      .replace(/\b(\d{1,2}(?::\d{2})?) (pm|am)\b/g, '$1$2');
    t = words(t).map(x => W[x] !== undefined ? W[x] : x).filter(Boolean).join(' ');
    // Postpositions: "youtube lo X" → "X on youtube"; "2 lines lo" → "in 2 lines".
    t = t.replace(/\b(\d+) (lines?|sentences?|words?|points?|saalu|vaakyaalu) (lo|alli|nalli|loo)\b/, (m, n, u) => 'in ' + n + ' ' + (/^(saal|vaak)/.test(u) ? 'lines' : u))
      .replace(/\b(\d+) (saalinalli|saalugalalli|linesalli|linelli|lainlalli)\b/, 'in $1 lines');
    let where = '';
    t = t.replace(/\b(youtube|yt|google|spotify|chrome|screen|laptop|system) (lo|alli|nalli|loo)\b\s*/, (m, place) => { where = ' on ' + place; return ''; });
    let toList = /\b(to-?do|todo) list (lo|ki|ku|ge|kke|alli|nalli)\b/.test(t) || /\b(to-?do|todo) (lo|ki|ku|ge|kke)\b/.test(t);
    if (toList) t = t.replace(/\b(my )?(to-?do|todo)( list)? (lo|ki|ku|ge|kke|alli|nalli)\b\s*/, '');
    t = t.replace(/\b(\S+) (ki|ku|ge|kke)\b/g, '$1').replace(/\b(ante|andre|andare|endare|antha)\b/g, '').replace(/\s+/g, ' ').trim();
    // Questions.
    let m = t.match(/^(.+?) (entha|enta|eshtu|estu)( undi| vundi| ide| aaytu| ayyindi| aithu| agide| unnayi)?$/) || t.match(/^(.+?) (eshtide)$/);
    if (m) return /\b(battery|charge|charging)\b/.test(m[1]) ? 'how much battery is left' : 'what is ' + m[1];
    m = t.match(/^(.+?) (enti|emiti|emi|enu|yenu|enidu)$/);
    if (m) return 'what is ' + m[1];
    m = t.match(/^(.+?) (ela undi|ela vundi|ela unnayi|ela unnadi|hegide|hegidhe|hengide)$/);
    if (m) return 'how is ' + (/^(system|laptop|computer|pc)$/.test(m[1]) ? 'my ' + m[1] : m[1]);
    // Commands: the verb is last in Telugu/Kannada; move it to the front.
    let verb = '', obj = t;
    const onOff = t.match(new RegExp('^(.*?)\\s*\\b(on|off)\\s+' + HELPER + '$'));
    const eng = t.match(new RegExp('^(.*?)\\s*\\b(' + ENG_VERB + ')\\s+' + HELPER + '$'));
    if (onOff) { verb = 'turn ' + onOff[2]; obj = onOff[1]; }
    else if (eng) { verb = eng[2]; obj = eng[1]; }
    else {
      for (const [re, v] of NATIVE_VERBS) if (re.test(t)) { verb = v; obj = t.replace(re, ''); break; }
      if (!verb) { const h = t.match(new RegExp('^(.*?)\\s*' + HELPER + '$')); if (h) obj = h[1]; }
    }
    obj = obj.trim();
    if (verb === 'put') verb = /\b(songs?|music|video|youtube|spotify|playlist)\b/.test(obj + where) ? 'play' : /\b(timer|alarm|reminder)\b/.test(obj) ? 'set' : /\btheme\b/.test(obj) ? 'switch to' : 'put';
    if (verb === 'remind me to') {
      // "at 6 mom call cheyyamani" → "call mom at 6"
      let body = obj.replace(/\s*\b(cheyyamani|cheyyadaniki|cheyali|maadoke|maadalu|maadbeku|ani)\b/g, '').trim();
      const when = (body.match(/\b(at \d\S*|in \d+ (minutes|hours)|tomorrow|today|tonight|evening|night)\b/g) || []).join(' ');
      body = body.replace(/\b(at \d\S*|in \d+ (minutes|hours)|tomorrow|today|tonight|evening|night)\b/g, '').replace(/\s+/g, ' ').trim();
      const bw = words(body); const last = bw[bw.length - 1];
      if (last && /^(call|buy|drink|study|submit|send|pay|eat|check|take|finish|complete|read|message|text|meet|attend|book|charge|water)$/.test(last) && bw.length > 1) body = last + ' ' + bw.slice(0, -1).join(' ');
      return ('remind me to ' + body + ' ' + when).replace(/\s+/g, ' ').trim();
    }
    if (verb === 'set' && /\btimer\b/.test(obj)) { const d = obj.replace(/\b(a |the )?timer\b/, '').trim(); return d ? 'set a timer for ' + d : 'set a timer'; }
    if (verb === 'add' && toList) return 'add ' + obj + ' to my to-do list';
    if (!verb) return (obj + where).trim();
    return (verb + ' ' + obj + where + (toList ? ' to my to-do list' : '')).replace(/\s+/g, ' ').trim();
  }

  /* ---------- "did you mean" ---------- */
  const EXAMPLES = [
    'Open VS Code', 'Close Chrome', 'Play lofi beats on YouTube', 'Search Stack Overflow for null pointer exception',
    'What is the weather in Bangalore?', 'Remind me to submit the lab in 2 hours', 'Add revise DBMS to my to-do list',
    'What is on my to-do list?', 'Add assignment OS lab due Friday', 'What is due this week?', 'Add class DBMS on Monday at 10am',
    'When is my next class?', 'Start a focus session', 'Set a timer for 10 minutes', '255 to binary', '1.5 GB to MB',
    'Explain the code in my clipboard', 'Take a note: revise recursion', 'List my files', 'Create a folder called DSA',
    'How much RAM am I using?', 'What is my battery level?', 'Take a screenshot', 'Volume up', 'Mute', 'Next song',
    'Lock the screen', 'What is my IP address?', 'Git status', 'Is port 3000 free?', 'Give me my briefing', 'Tell me a joke',
    'Quiz me on operating systems', 'What is 25 times 40?',
  ];
  const tok = s => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^(the|a|an|my|me|to|is|on|in|for|of|what|and)$/.test(w)));
  function suggest(s, n = 3) {
    const a = tok(s);
    if (!a.size) return EXAMPLES.slice(0, n);
    return EXAMPLES.map(e => {
      const b = tok(e); let hit = 0;
      for (const w of a) for (const x of b) if (w === x || (w.length > 3 && x.length > 3 && lev(w, x) <= 1)) { hit++; break; }
      return { e, score: hit / Math.sqrt(b.size) };
    }).sort((x, y) => y.score - x.score).slice(0, n).map(x => x.e);
  }

  /* "Create a python file which includes all operations of calculator" — no name was given, but one is obvious.
     → candidate file names (most specific first), from what the file is for and the folder it goes in.
     One distinct candidate → use it; 2–3 → ask with them as choices; none → ask as before. */
  const NAME_FILLER = /\b(?:a|an|the|all|any|every|some|my|our|its|new|simple|basic|complete|full|small|python|py|java|javascript|js|c|cpp|html|css|code|program|script|file|files|that|which|it|this|for|of|to|in|on|with|and|includes?|including|contains?|containing|has|have|does|do|performs?|handles?|implements?|should|will|can|logic|functions?|methods?|operations?|features?|all the)\b/gi;
  function inferFileNames(original, ext, folderPath) {
    // the place isn't part of the name: "… there", "… in d drive", "… on my desktop", "… in that folder"
    const s = String(original || '').toLowerCase().replace(/[.!?]+$/, '')
      .replace(/\s+(?:over there|in there|there|here|in it|inside it)\s*$/, '')
      .replace(/\s+(?:in|on|inside|into|at)\s+(?:the\s+|my\s+)?(?:[a-z]\s+drive|[a-z]:\S*|desktop|documents|downloads|(?:that|this|the same|same)\s+(?:folder|directory|project))\s*$/, '');
    const out = [];
    const add = x => { const n = String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); if (n && n.length >= 3 && !out.includes(n)) out.push(n); };
    // what it is for: "for X", "which includes … of X", "that does X", "to X"
    const purpose = s.match(/\b(?:for|of|about|to|that (?:does|handles|performs|implements)|which (?:does|handles|performs|implements|includes|contains|has)|containing|including|with)\s+(?:all\s+(?:the\s+)?)?(.+?)(?:\s+(?:in|inside|into|on|at)\s+(?:the|my|this|that|same)\b.*)?[.!?]*$/);
    if (purpose) {
      const words = purpose[1].replace(NAME_FILLER, ' ').replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (words.length) add(words.slice(0, 3).join('_'));
    }
    // "a login function" / "a sorting program" (no "for")
    const thing = s.match(/\b(?:a|an)\s+([a-z]+)\s+(?:function|program|script|module|class|app)\b/);
    if (thing && !NAME_FILLER.test(thing[1])) add(thing[1]);
    NAME_FILLER.lastIndex = 0;
    // the folder it goes in: D:\calculator → calculator — only when the request itself doesn't say what it's for
    const base = out.length ? '' : String(folderPath || '').split(/[\\/]/).filter(Boolean).pop();
    if (base && !/^[a-z]:$/i.test(base) && !/^(?:desktop|documents|downloads|code|notes|projects|jarvis|src|test\d*)$/i.test(base)) add(base);
    // a short form of another candidate is the same idea ("calc" vs "calculator"): keep the one from what you asked for
    const distinct = out.filter((n, i) => !out.some((m, j) => j < i && (n.startsWith(m) || m.startsWith(n))));
    const e = ext ? (ext.startsWith('.') ? ext : '.' + ext) : '';
    return distinct.slice(0, 3).map(n => n + e);
  }

  const TOOL_COUNT = new Set(R.map(r => r[3]).filter(Boolean)).size;
  return { inferFileNames, APPS, SITES, TOOL_COUNT, normalize, classify, romanLang, fromRoman, findApp, findSite, bareSiteName, bestResult, editorFolder, setInstalledApps, appByKey, parseWhen, parseDate, parseTimeOfDay, parseRepeat, convertUnits, stripWhen, dayIndex, suggest, lev, DAYS, parseCodeAsk, resolveCodeTool, CODE_ASK_TOOLS };
})();
