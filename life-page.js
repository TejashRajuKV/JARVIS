'use strict';
/* Everyday life tools, chat side: keep JARVIS running, back up to another drive, expenses, habit streaks and quick capture. Explicit wording only (the
   sentence shapes live in lifeparse.js and in the patterns below); anything that changes the system (the scheduled task, the backup folder) asks first,
   and the page's own data (expenses, habits) changes with one Undo. Uses the page's globals (callTool, getJSON, store, rid, Undo, jarvisSay…).
     Keep alive  "keep JARVIS running": a Windows scheduled task that starts JARVIS again if it stopped (never after you stopped it yourself).
     Backup      "back up my files to D:": a plain second copy in a folder you choose (mirror.js), weekly if you switch that on.
     Expenses    "spent 120 on lunch" · "how much did I spend this month" · "export my expenses"
     Habits      "track habit gym" · "I did gym" · "my gym streak" · "habits"
     Capture     "jot down buy a charger" → Notes/inbox-<date>.md · "show my inbox" · Ctrl+Shift+N on the page */
const Life = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'LIFE' }, extra || {});
  const plain = s => String(s || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const ask = (text, yes) => (typeof Extras !== 'undefined' && Extras.confirmCard ? Extras.confirmCard(text, yes) : Promise.resolve(false));
  const PHONE_NO = 'That changes things on the laptop, so I only do it for requests made there. Ask me again from JARVIS on the laptop.';
  const J = typeof LifeParse !== 'undefined' ? LifeParse : null;
  const st = (k, f) => { try { return store.get(k, f); } catch (e) { return f; } };
  const put = (k, v) => { try { store.set(k, v); } catch (e) { /* the page keeps working; it just forgets */ } };
  const dayMs = 864e5;
  const dateLabel = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const undo = (label, fn) => { if (typeof Undo !== 'undefined') Undo.push(label, fn); };

  /* ================= keep JARVIS running ================= */
  const KA_ON = /^(?:please\s+)?(?:keep|make\s+sure)\s+jarvis\s+(?:running|alive|on|up)(?:\s+(?:all\s+the\s+time|always|in\s+the\s+background|for\s+me))?\s*[.!]*$|^(?:please\s+)?(?:turn\s+on|enable|switch\s+on)\s+keep[\s-]?alive\s*[.!]*$/i;
  const KA_OFF = /^(?:please\s+)?(?:stop\s+keeping\s+jarvis\s+(?:running|alive|on|up)|(?:don'?t|do\s+not)\s+keep\s+jarvis\s+(?:running|alive)(?:\s+anymore)?|(?:turn\s+off|disable|switch\s+off)\s+keep[\s-]?alive)\s*[.!]*$/i;
  const KA_STATUS = /^(?:is\s+jarvis\s+(?:being\s+)?kept\s+(?:running|alive)\??|keep[\s-]?alive\s+status|(?:is\s+)?keep[\s-]?alive\s+(?:on|off)\??)\s*[?.!]*$/i;
  async function keepalive(op, source) {
    const cur = await getJSON('/keepalive/status');
    if (cur.error) return say('I could not check that: ' + cur.error);
    if (cur.supported === false) return say('Keeping JARVIS running uses Windows’ task scheduler, so it only works on Windows.');
    if (op === 'status') {
      return say(cur.on ? '✓ **Keep-alive is on.** Every ' + cur.minutes + ' minutes Windows checks that JARVIS is running and starts it again if it is not. If you stop JARVIS yourself (the Stop JARVIS icon, or “quit”), it stays stopped.' + (cur.note ? '\n\n' + cur.note : '') : 'Keep-alive is **off**. Say **“keep JARVIS running”** to have Windows restart it if it ever crashes.' + (cur.note ? '\n\n' + cur.note : ''));
    }
    if (source === 'phone') return say(PHONE_NO);
    if (op === 'on') {
      if (cur.on) return say('Keep-alive is already on.');
      const go = await ask('Keep JARVIS running? I will add a Windows scheduled task named **JARVIS Keepalive** that runs every **5 minutes** and starts JARVIS again only if it is not running.\n\n- It never restarts JARVIS after **you** stopped it (Stop JARVIS, or “quit”).\n- It runs as you, hidden, with no extra permissions. **“Stop keeping JARVIS alive”** removes it.', 'YES, KEEP IT RUNNING');
      if (!go) return say('Okay, I did not change anything.');
      const r = await callTool('/keepalive/set', { on: true });
      if (r.error) return say('I could not set that up: ' + r.error);
      return say('✓ **Keep-alive is on.** Windows will start JARVIS again within 5 minutes if it stops by itself. Say **“stop keeping JARVIS alive”** to remove it.', { speak: 'Keep alive is on.' });
    }
    if (!cur.on && !cur.note) return say('Keep-alive is already off.');
    const r = await callTool('/keepalive/set', { on: false });
    if (r.error) return say('I could not remove it: ' + r.error);
    return say('✓ **Keep-alive is off.** The scheduled task is removed; JARVIS only runs when you start it.', { speak: 'Keep alive is off.' });
  }

  /* ================= back up to another drive ================= */
  const DEST = String.raw`((?:[A-Za-z]:(?:[\\/][^\n]*)?)|(?:the\s+)?[A-Za-z]\s*(?:drive|:)|\\\\[^\n]+|"[^"\n]+"|'[^'\n]+')`;
  const BK_SET = new RegExp('^(?:please\\s+)?(?:set|change|use|make)\\s+(?:my\\s+|the\\s+)?(?:backup|mirror)\\s+(?:folder|drive|location|destination|path)\\s+(?:to|as|=)\\s+' + DEST + '\\s*[.!]*$', 'i');
  const BK_TO = new RegExp('^(?:please\\s+)?(?:back\\s?up|mirror|copy)\\s+(?:all\\s+)?(?:my\\s+)?(?:jarvis\\s+)?(?:files|data|notes|documents|everything|stuff)\\s+(?:to|onto|on|into)\\s+' + DEST + '\\s*[.!]*$', 'i');
  const BK_RUN = /^(?:please\s+)?(?:(?:run|start|do|make|take)\s+(?:a\s+|the\s+|my\s+)?(?:file\s+|drive\s+)?(?:backup|mirror)(?:\s+now)?|back\s?up\s+(?:all\s+)?(?:my\s+)?(?:jarvis\s+)?files(?:\s+now)?)\s*[.!]*$/i;
  const BK_STATUS = /^(?:(?:file\s+|drive\s+)?(?:backup|mirror)\s+(?:status|info|folder)|when\s+(?:was|did)\s+(?:my\s+|the\s+)?(?:last\s+)?(?:file\s+|drive\s+)?backup(?:\s+(?:run|happen))?|is\s+my\s+(?:file\s+|drive\s+)?backup\s+(?:up\s+to\s+date|working|on)|where\s+(?:is|are)\s+my\s+(?:file\s+|drive\s+)?backups?)\s*[?.!]*$/i;
  const BK_WEEKLY = /^(?:please\s+)?(?:(?:turn|switch)\s+(on|off)\s+(?:the\s+|my\s+)?weekly\s+(?:file\s+|drive\s+)?backup|(enable|disable)\s+(?:the\s+|my\s+)?weekly\s+(?:file\s+|drive\s+)?backup|weekly\s+(?:file\s+|drive\s+)?backup\s+(on|off))\s*[.!]*$/i;
  const BK_PROJECTS = /^(?:please\s+)?(?:(include|add|back\s?up)\s+(?:my\s+)?projects?\s+(?:in|to|too|as well)(?:\s+(?:the\s+|my\s+)?(?:file\s+)?backup)?|(exclude|skip|leave\s+out|don'?t\s+(?:include|back\s?up))\s+(?:my\s+)?projects?(?:\s+(?:from|in)\s+(?:the\s+|my\s+)?(?:file\s+)?backup)?)\s*[.!]*$/i;
  function normDest(raw) {
    let d = String(raw || '').trim().replace(/^["']|["']$/g, '').trim();
    const dr = d.match(/^(?:the\s+)?([A-Za-z])\s*(?:drive|:)?$/i);                    // "D:", "the D drive", "D"
    if (dr) return dr[1].toUpperCase() + ':\\JARVIS-Backup';
    if (/^[A-Za-z]:[\\/]?$/.test(d)) return d[0].toUpperCase() + ':\\JARVIS-Backup';
    return d.replace(/\//g, '\\').replace(/\\+$/, '');
  }
  function mirrorLine(s) {
    const l = s.last;
    if (!s.lastRun || !l) return 'No backup has run yet.';
    return 'Last backup **' + new Date(s.lastRun).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '**: ' + pl(l.files, 'file') + ' looked at, **' + pl(l.copied, 'file') + ' copied**' + (l.replaced ? ' (' + l.replaced + ' older versions kept in _previous)' : '') + (l.partial ? ' — *it stopped early; run it again to finish*' : '') + (l.errors && l.errors.length ? ' — ' + pl(l.errors.length, 'file') + ' could not be copied (' + [...new Set(l.errors.slice(0, 3).map(e => e.why))].join('; ') + ')' : '') + '.';
  }
  async function mirrorStatus() {
    const s = await getJSON('/mirror/status');
    if (s.error) return say('I could not check the backup: ' + s.error);
    if (!s.dest) return say('No backup folder is set. Say **“back up my files to D:”** (or a folder like `D:\\JARVIS-Backup`) and I will copy your JARVIS notes, documents, scans and more there.');
    return say('**Backup folder:** `' + s.dest + '`' + (s.approved === s.dest ? '' : ' *(not approved yet — set it again from here)*') + '\n' + (s.running ? '⏳ A backup is **running now**' + (s.progress ? ' (' + s.progress.files + ' files looked at)' : '') + '.\n' : '') + mirrorLine(s) + '\n- Weekly automatic backup: **' + (s.enabled ? 'on' : 'off') + '**' + (s.enabled && s.dueIn !== null ? ' (next in about ' + Math.max(1, Math.round(s.dueIn / dayMs)) + ' days)' : '') + '\n- Projects included: **' + (s.includeProjects ? 'yes' : 'no') + '**\n\nSay **“run a backup”** to back up now.', { speak: s.lastRun ? 'Your last backup was on ' + dateLabel(s.lastRun) + '.' : 'No backup has run yet.' });
  }
  let pollMs = 3000;
  function watchRun() {                               // the backup runs on the server; tell the person when it ends
    let n = 0;
    const tick = async () => {
      const s = await getJSON('/mirror/status');
      if (s && !s.error && !s.running) {
        if (s.lastError) jarvisSay(say('⚠ The backup stopped: ' + s.lastError));
        else jarvisSay(say('✓ **Backup finished.** ' + mirrorLine(s), { speak: 'Your backup is done.' }));
        return;
      }
      if (++n < 400 && !(s && s.error)) setTimeout(tick, pollMs);
    };
    setTimeout(tick, pollMs);
  }
  async function mirrorRun(source) {
    if (source === 'phone') return say(PHONE_NO);
    const s = await getJSON('/mirror/status');
    if (s.error) return say('I could not start the backup: ' + s.error);
    if (!s.dest) return say('No backup folder is set yet. Say **“back up my files to D:”** first.');
    if (s.running) return say('A backup is already running.');
    const r = await callTool('/mirror/run', {});
    if (r.error) return say(r.error);
    watchRun();
    return say('⏳ **Backup started** into `' + s.dest + '`. It runs in the background and I will tell you when it is done. Only new and changed files are copied, and nothing already in the backup is deleted.', { speak: 'Backup started.' });
  }
  async function mirrorSet(rawDest, thenRun, source) {
    if (source === 'phone') return say(PHONE_NO);
    const dest = normDest(rawDest);
    const s = await getJSON('/mirror/status');
    const go = await ask('Back up your JARVIS files into **`' + dest + '`**?\n\n- I copy your Notes, Documents, Code, Scans, PDFs, journal, skills and chat archive. **Never** your API keys, the trash or log files.\n- It is a **plain folder of plain files**: open or copy them yourself. Only new and changed files are copied; an older version of a changed file is kept 30 days, and **nothing is ever deleted** from the backup.\n- The folder is marked so I never mix it with other things' + (s && s.dest && s.dest !== dest ? '. *This replaces your current backup folder (`' + s.dest + '`), which is left as it is.*' : '.'), thenRun ? 'YES, BACK UP NOW' : 'YES, USE THIS FOLDER');
    if (!go) return say('Okay, I did not set a backup folder.');
    const r = await callTool('/mirror/setdest', { dest });
    if (r.error) return say('I could not use that folder: ' + r.error);
    if (!thenRun) return say('✓ Backup folder set to `' + r.dest + '`. Say **“run a backup”** to copy now, or **“turn on weekly backup”**.', { speak: 'The backup folder is set.' });
    return mirrorRun(source);
  }
  async function mirrorConfig(enabled, includeProjects, source) {
    if (source === 'phone') return say(PHONE_NO);
    const s = await getJSON('/mirror/status');
    if (s.error) return say('I could not change that: ' + s.error);
    if (enabled !== undefined && !s.dest) return say('Set a backup folder first: **“back up my files to D:”**.');
    const body = {}; if (enabled !== undefined) body.enabled = enabled; if (includeProjects !== undefined) body.includeProjects = includeProjects;
    const r = await callTool('/mirror/config', body);
    if (r.error) return say('I could not change that: ' + r.error);
    if (enabled !== undefined) return say(enabled ? '✓ **Weekly backup is on.** Once a week, JARVIS copies new and changed files into `' + r.dest + '` while it is running.' : '✓ **Weekly backup is off.** Backups only run when you ask.');
    return say(includeProjects ? '✓ Your **project folders** will be included (without node_modules, build folders and the like) from the next backup.' : '✓ Project folders are **left out** of the backup.');
  }
  async function backup(m, source) {
    switch (m.op) {
      case 'status': return mirrorStatus();
      case 'run': return mirrorRun(source);
      case 'set': return mirrorSet(m.dest, false, source);
      case 'to': return mirrorSet(m.dest, true, source);
      case 'weekly': return mirrorConfig(m.on, undefined, source);
      case 'projects': return mirrorConfig(undefined, m.on, source);
    }
    return null;
  }
  function matchBackup(t) {
    let m;
    if (BK_STATUS.test(t)) return { op: 'status' };
    if ((m = t.match(BK_SET))) return { op: 'set', dest: m[1] };
    if ((m = t.match(BK_TO))) return { op: 'to', dest: m[1] };
    if (BK_RUN.test(t)) return { op: 'run' };
    if ((m = t.match(BK_WEEKLY))) return { op: 'weekly', on: /^(on|enable)$/i.test(m[1] || m[2] || m[3]) };
    if ((m = t.match(BK_PROJECTS))) return { op: 'projects', on: /^(include|add|back)/i.test(m[1] || '') };
    return null;
  }

  /* ================= expenses ================= */
  const expenses = () => st('jarvis.expenses', []);
  const saveExpenses = list => put('jarvis.expenses', list.slice(-5000));
  function chart(sm) {
    if (typeof document === 'undefined' || !document.createElementNS || !sm.byCat.length) return null;
    const rows = sm.byCat.slice(0, 6), max = rows[0][1] || 1, NS = 'http://www.w3.org/2000/svg', W = 320, H = rows.length * 24 + 6;
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Spending by category');
    svg.style.cssText = 'max-width:360px;display:block;margin-top:8px';
    rows.forEach(([cat, v], i) => {
      const y = 4 + i * 24, w = Math.max(3, Math.round(150 * v / max));
      const mk = (tag, attrs, txt) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt !== undefined) e.textContent = txt; svg.appendChild(e); return e; };
      mk('text', { x: 0, y: y + 13, fill: 'currentColor', 'font-size': 11 }, cat.slice(0, 13));
      mk('rect', { x: 90, y, width: w, height: 16, rx: 3, fill: 'var(--cyan-hi, #5ee)' , opacity: 0.85 });
      mk('text', { x: 94 + w, y: y + 13, fill: 'currentColor', 'font-size': 11 }, J.money(v));
    });
    return svg;
  }
  function logExpense(e) {
    const list = expenses(), item = { id: rid(), t: e.t, amount: e.amount, cat: e.cat, note: e.note };
    list.push(item); saveExpenses(list);
    undo('logged an expense', () => { const cur = expenses(), n = cur.length; saveExpenses(cur.filter(x => x.id !== item.id)); return n === expenses().length ? 'That expense was already gone.' : 'Removed ' + J.money(item.amount) + (item.note ? ' for ' + item.note : '') + '.'; });
    const today = J.summarize(list, 'today'), month = J.summarize(list, 'this month');
    return say('✓ Logged **' + J.money(e.amount) + '**' + (e.note ? ' for **' + e.note + '**' : '') + ' (' + e.cat + (Math.abs(e.t - Date.now()) > 6 * 36e5 ? ', ' + dateLabel(e.t) : '') + '). Today **' + J.money(today.total) + '**, this month **' + J.money(month.total) + '**. Say **“undo”** to take it back.', { speak: 'Logged ' + Math.round(e.amount) + ' rupees.', suggestions: ['How much did I spend this month?'] });
  }
  function expenseSummary(q) {
    const list = expenses();
    if (!list.length) return say('You have not logged any expenses yet. Say something like **“spent 120 on lunch”**.');
    const sm = J.summarize(list, q.window, Date.now(), q.about);
    const what = q.about ? ' on **' + q.about + '**' : '';
    if (!sm.count) return say('Nothing logged' + what + ' ' + sm.range.label + '.');
    const cats = sm.byCat.slice(0, 5).map(([c, v]) => '- **' + c + '** ' + J.money(v) + ' (' + Math.round(100 * v / sm.total) + '%)').join('\n');
    const recent = sm.items.slice(0, 5).map(e => '- ' + dateLabel(e.t) + ' — ' + J.money(e.amount) + (e.note ? ' ' + e.note : '') + ' *(' + e.cat + ')*').join('\n');
    return say('**You spent ' + J.money(sm.total) + what + ' ' + sm.range.label + '** (' + pl(sm.count, 'entry', 'entries') + (sm.days > 1 ? ', about ' + J.money(sm.perDay) + ' a day' : '') + ').\n\n' + cats + '\n\n*Latest:*\n' + recent, { speak: 'You spent ' + Math.round(sm.total) + ' rupees ' + sm.range.label + '.', extraNode: chart(sm) || undefined, actions: [{ label: 'EXPORT AS CSV', fn: () => exportExpenses().then(r => jarvisSay(r)) }] });
  }
  async function exportExpenses() {
    const list = expenses();
    if (!list.length) return say('There are no expenses to export yet.');
    const name = 'Notes/expenses-' + J.ymd(Date.now()) + '.csv';
    const r = await callTool('/tool/writeFile', { name, content: J.csv(list), overwrite: true });
    if (r.error) return say('I could not save the file: ' + r.error);
    return say('✓ Saved **' + pl(list.length, 'expense') + '** to `' + (r.name || name) + '` (opens in Excel).', { actions: [{ label: 'OPEN IT', fn: () => callTool('/tool/openFile', { name: r.name || name }) }] });
  }
  const EXP_EXPORT = /^(?:please\s+)?(?:export|download|save)\s+(?:all\s+)?(?:my\s+)?(?:expenses|spending)(?:\s+(?:as|to|into)\s+(?:a\s+)?(?:csv|excel|spreadsheet|file))?\s*[.!]*$/i;
  const EXP_FORGET = /^(?:please\s+)?(?:delete|clear|erase|forget|reset)\s+(?:all\s+)?(?:my\s+)?(?:expenses|expense\s+(?:log|history))\s*[.!]*$/i;
  async function expensesForget() {
    const list = expenses();
    if (!list.length) return say('There are no expenses logged.');
    const go = await ask('Delete all **' + pl(list.length, 'logged expense') + '**? **“undo”** brings them back right after.', 'YES, DELETE THEM');
    if (!go) return say('Okay, I kept them.');
    saveExpenses([]);
    undo('deleted all expenses', () => { saveExpenses(list); return 'Brought back ' + pl(list.length, 'expense') + '.'; });
    return say('✓ Deleted ' + pl(list.length, 'expense') + '. Say **“undo”** to bring them back.');
  }

  /* ================= habits ================= */
  const habits = () => st('jarvis.habits', []);
  const saveHabits = l => put('jarvis.habits', l.slice(0, 50));
  const keyFor = off => J.ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + off).getTime());
  const gridLine = h => J.weekGrid(Object.keys(h.days || {})).map(d => d.on ? '🟩' : '⬜').join('');
  function habitsList() {
    const hs = habits();
    if (!hs.length) return say('You are not tracking any habits yet. Try **“track habit gym”**, then say **“I did gym”** each day.');
    const days = J.weekGrid([]).map(d => d.dow).join(' ');
    const rows = hs.map(h => { const s = J.streakOf(Object.keys(h.days || {})); return '- **' + h.name + '** — 🔥 **' + s.current + '** day' + (s.current === 1 ? '' : 's') + ' (best ' + s.best + ', total ' + s.total + ')\n  ' + gridLine(h); }).join('\n');
    return say('**Your habits** *(last 7 days, oldest first: ' + days + ')*\n' + rows + '\n\nSay **“I did <habit>”** to tick today.', { speak: 'You are tracking ' + pl(hs.length, 'habit') + '.' });
  }
  function habitAdd(name) {
    const hs = habits();
    if (hs.some(h => h.name === name)) return say('You are already tracking **' + name + '**.');
    if (hs.length >= 50) return say('That is a lot of habits (50). Remove one first with **“stop tracking <habit>”**.');
    const h = { id: rid(), name, created: Date.now(), days: {} }; hs.push(h); saveHabits(hs);
    undo('started tracking a habit', () => { saveHabits(habits().filter(x => x.id !== h.id)); return 'Stopped tracking **' + name + '**.'; });
    return say('✓ Now tracking **' + name + '**. Say **“I did ' + name + '”** each day to build a streak, or **“habits”** to see them all.', { speak: 'Now tracking ' + name + '.' });
  }
  function habitDone(name, off) {
    const hs = habits(), h = hs.find(x => x.name === name);
    if (!h) return null;
    const key = keyFor(off || 0);
    if (h.days[key]) return say('You already ticked **' + h.name + '** ' + (off ? 'yesterday' : 'today') + '. 🔥 ' + J.streakOf(Object.keys(h.days)).current + '-day streak.');
    h.days[key] = 1; saveHabits(hs);
    undo('ticked a habit', () => { const cur = habits(), x = cur.find(y => y.id === h.id); if (x) { delete x.days[key]; saveHabits(cur); } return 'Un-ticked **' + h.name + '**.'; });
    const s = J.streakOf(Object.keys(h.days));
    return say('✓ **' + h.name + '** ticked ' + (off ? 'for yesterday' : 'for today') + '. 🔥 **' + s.current + '-day streak**' + (s.current > 1 && s.current === s.best ? ' — your best so far!' : s.best > s.current ? ' (best ' + s.best + ')' : '') + '.\n' + gridLine(h), { speak: h.name + ' done. ' + s.current + ' day streak.' });
  }
  function habitStreak(name) {
    const h = habits().find(x => x.name === name); if (!h) return null;
    const s = J.streakOf(Object.keys(h.days));
    return say('**' + h.name + '**: 🔥 **' + s.current + '** day' + (s.current === 1 ? '' : 's') + ' in a row, best **' + s.best + '**, **' + s.total + '** ticked in all.\n' + gridLine(h), { speak: 'Your ' + h.name + ' streak is ' + s.current + ' days.' });
  }
  async function habitDel(name) {
    const hs = habits(), h = hs.find(x => x.name === name); if (!h) return null;
    const total = Object.keys(h.days || {}).length;
    if (total > 3) { const go = await ask('Stop tracking **' + h.name + '**? Its ' + pl(total, 'ticked day') + ' will be deleted (**“undo”** brings it back).', 'YES, STOP TRACKING'); if (!go) return say('Okay, I kept it.'); }
    saveHabits(hs.filter(x => x.id !== h.id));
    undo('stopped tracking a habit', () => { const cur = habits(); cur.push(h); saveHabits(cur); return 'Brought back **' + h.name + '**.'; });
    return say('✓ Stopped tracking **' + h.name + '**. Say **“undo”** to bring it back.');
  }

  /* ================= quick capture ================= */
  const inboxFile = off => 'Notes/inbox-' + J.ymd(Date.now() + off * dayMs) + '.md';
  async function capture(text) {
    const line = '- ' + clock(Date.now()) + ' — ' + String(text).replace(/\s*\n\s*/g, ' ').trim() + '\n';
    const name = inboxFile(0);
    const r = await callTool('/tool/writeFile', { name, content: line, append: true });
    if (r.error) return say('I could not save that: ' + r.error);
    return say('✓ Captured in `' + (r.name || name) + '`: “' + plain(text).slice(0, 120) + '”', { speak: 'Captured.' });
  }
  async function inbox(off) {
    const name = inboxFile(off);
    const r = await callTool('/tool/readFile', { name });
    if (r.error || !String(r.content || '').trim()) return say('Your inbox for ' + (off ? 'yesterday' : 'today') + ' is empty. Say **“jot down <anything>”** to add to it.');
    const lines = String(r.content).split('\n').filter(Boolean);
    return say('**Inbox ' + (off ? '(yesterday)' : '(today)') + '** — ' + pl(lines.length, 'item') + '\n\n' + lines.slice(-25).join('\n') + (lines.length > 25 ? '\n…' : ''), { speak: 'You have ' + pl(lines.length, 'item') + ' in your inbox.', actions: [{ label: 'OPEN THE FILE', fn: () => callTool('/tool/openFile', { name }) }] });
  }
  // Ctrl+Shift+N on the page: a one-box panel (a global key would need the desktop hook, so this only works while JARVIS is the active window)
  async function openCapture() {
    if (typeof Camera === 'undefined' || !Camera.openPanel) return null;
    return new Promise(resolve => {
      const panel = Camera.openPanel({ title: 'QUICK CAPTURE', hint: 'Type anything and press SAVE. It goes to today’s inbox note.' });
      const ta = document.createElement('textarea'); ta.rows = 4; ta.setAttribute('aria-label', 'Quick capture');
      ta.style.cssText = 'width:100%;max-width:100%;background:rgba(0,0,0,.4);color:var(--ink);border:1px solid var(--line-hi);border-radius:8px;padding:10px;font-size:14px';
      panel.body(ta); ta.focus();
      let done = false; const fin = async v => { if (done) return; done = true; panel.close(); if (v && v.trim()) { const r = await capture(v); jarvisSay(r); } resolve(!!(v && v.trim())); };
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fin(ta.value); } });
      panel.buttons([{ label: 'SAVE', primary: true, fn: () => fin(ta.value) }, { label: 'CANCEL', danger: true, fn: () => fin(null) }]);
      panel.onCancel(() => { done = true; resolve(false); });
    });
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', e => { if (e && e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) { e.preventDefault(); openCapture(); } });

  /* ================= screenshot search ================= */
  const SHOT_FIND = [
    /^(?:please\s+)?(?:find|search|look\s+for|show|get)\s+(?:me\s+)?(?:the\s+|a\s+|my\s+|that\s+)?screenshots?\s+(?:of|with|about|where|that|containing|showing|having|which|for)\s+(.+?)\s*[.!?]*$/i,
    /^(?:please\s+)?(?:search|look)\s+(?:in\s+|through\s+)?(?:my\s+)?screenshots?\s+(?:for|about)\s+(.+?)\s*[.!?]*$/i,
    /^(?:which|what)\s+screenshot\s+(?:has|had|shows?|showed|mentions?|contains?)\s+(.+?)\s*[?.!]*$/i,
    /^where(?:'s|\s+is|\s+was)\s+(?:the\s+|that\s+|my\s+)screenshot\s+(?:of|with|about|where)\s+(.+?)\s*[?.!]*$/i,
  ];
  const SHOT_INDEX = /^(?:please\s+)?(?:(?:index|update|refresh|rebuild)\s+(?:all\s+)?(?:my\s+|the\s+)?screenshots?(?:\s+index)?|make\s+(?:my\s+)?screenshots\s+searchable)\s*[.!]*$/i;
  const SHOT_STATUS = /^(?:screenshot\s+(?:index|search)\s+(?:status|info)|how\s+many\s+screenshots\s+(?:are\s+)?(?:indexed|searchable))\s*[?.!]*$/i;
  const SHOT_FORGET = /^(?:please\s+)?(?:forget|clear|delete|erase|reset)\s+(?:my\s+|the\s+)?screenshot\s+(?:index|search|text)\s*[.!]*$/i;
  const SHOT_ADD = /^(?:please\s+)?(add|remove)\s+(.+?)\s+(?:to|from)\s+(?:my\s+)?screenshot\s+folders?\s*[.!]*$/i;
  const SHOT_WIN = /\s+(?:from\s+|in\s+|during\s+|taken\s+)?(today|yesterday|this week|last week|this month|last month)$/i;
  function matchShot(t) {
    let m;
    if (SHOT_STATUS.test(t)) return { op: 'status' };
    if (SHOT_INDEX.test(t)) return { op: 'index' };
    if (SHOT_FORGET.test(t)) return { op: 'forget' };
    if ((m = t.match(SHOT_ADD))) return { op: m[1].toLowerCase() === 'add' ? 'add' : 'remove', folder: m[2].replace(/^["']|["']$/g, '').replace(/^(?:the\s+)?folder\s+/i, '') };
    for (const re of SHOT_FIND) if ((m = t.match(re))) {
      let q = m[1], win = ''; const w = q.match(SHOT_WIN); if (w) { win = w[1].toLowerCase(); q = q.slice(0, w.index); }
      q = q.replace(/^(?:the\s+word\s+|the\s+text\s+|text\s+)/i, '').replace(/^["“']|["”']$/g, '').trim();
      return q ? { op: 'find', q, win } : null;
    }
    return null;
  }
  const shotWhen = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function watchShots(done) {
    let n = 0;
    const tick = async () => {
      const s = await getJSON('/shots/status');
      if (s && !s.error && !s.running) { done(s); return; }
      if (++n < 600 && !(s && s.error)) setTimeout(tick, pollMs * 2);
    };
    setTimeout(tick, pollMs);
  }
  async function shotFind(m, source) {
    const st = await getJSON('/shots/status');
    if (st.error) return say('I could not check the screenshots: ' + st.error);
    if (!st.total) return say('I found no screenshots to search. I look in `Pictures\\Screenshots`. Say **“add D:\\Shots to my screenshot folders”** to add another folder.');
    if (!st.indexed) {
      if (source === 'phone') return say('I have not read your screenshots yet. Ask me again at the laptop.');
      const mins = Math.max(1, Math.round(Math.min(st.total, 150) * 2.5 / 60));
      const go = await ask('To search inside screenshots I have to read each one first. You have **' + pl(st.total, 'screenshot') + '**; I will read the newest ' + Math.min(st.total, 150) + ' now, about **' + mins + ' minute' + (mins === 1 ? '' : 's') + '**, in the background.\n\n- It uses Windows’ own text reader **on this laptop**: nothing is sent anywhere.\n- The words are kept in a private file in your JARVIS folder (the drive backup skips it). **“Forget my screenshot index”** deletes it.\n- Screenshots can show passwords: anyone who can use JARVIS on this laptop can search them.\n- I never change, move or delete a screenshot.', 'YES, READ THEM');
      if (!go) return say('Okay, I did not read your screenshots.');
      const r = await callTool('/shots/update', { max: 150 });
      if (r.error) return say(r.error);
      watchShots(async s => jarvisSay(await shotSearch(m, s)));
      return say('⏳ Reading your screenshots in the background. I will search for “' + m.q + '” as soon as it is done.', { speak: 'Reading your screenshots.' });
    }
    return shotSearch(m, st);
  }
  async function shotSearch(m, st) {
    const body = { q: m.q, limit: 6 };
    if (m.win && J) { const r = J.windowRange(m.win); body.from = r.from; body.to = r.to - 1; }
    const r = await callTool('/shots/search', body);
    if (r.error) return say(/word|picture/i.test(r.error) ? 'Tell me a word or two that is in the picture, like **“find the screenshot with the wifi password”**.' : 'The search failed: ' + r.error);
    const s2 = r.status || st || {};
    const tail = s2.pending ? '\n\n*' + pl(s2.pending, 'newer or changed screenshot') + (s2.pending === 1 ? ' is' : ' are') + ' not read yet — say **“index my screenshots”** to include ' + (s2.pending === 1 ? 'it' : 'them') + '.*' : '';
    if (!r.results.length) return say('I found no screenshot with “' + m.q + '”' + (m.win ? ' ' + m.win : '') + ' among the **' + pl(s2.indexed || 0, 'screenshot') + '** I have read. Text in pictures is read by Windows OCR, so handwriting and small text can be missed.' + tail);
    const lines = r.results.map((x, i) => (i + 1) + '. **' + shotWhen(x.mtime) + '** — ' + x.name + '\n   “' + plain(x.snippet).slice(0, 150) + '”');
    return say('**' + pl(r.total, 'screenshot') + '** with “' + m.q + '”' + (r.total > r.results.length ? ' (the best ' + r.results.length + ')' : '') + ':\n\n' + lines.join('\n') + tail, { speak: 'I found ' + pl(r.total, 'screenshot') + '.', actions: r.results.slice(0, 3).map((x, i) => ({ label: 'OPEN ' + (i + 1), fn: async () => { const o = await callTool('/shots/open', { path: x.path }); if (o.error) jarvisSay(say(o.error)); } })) });
  }
  async function shots(m, source) {
    switch (m.op) {
      case 'find': return shotFind(m, source);
      case 'status': {
        const s = await getJSON('/shots/status'); if (s.error) return say('I could not check: ' + s.error);
        return say('**Screenshot search**\n- Folders: ' + (s.folders.length ? s.folders.map(f => '`' + f + '`').join(', ') : '*none found*') + '\n- Screenshots: **' + s.total + '**, read: **' + s.indexed + '**' + (s.pending ? ', waiting: ' + s.pending : '') + (s.running ? ' — ⏳ reading now' + (s.progress ? ' (' + s.progress.done + '/' + s.progress.of + ')' : '') : '') + '\n\nSay **“index my screenshots”** to read new ones, or **“find the screenshot with …”**.');
      }
      case 'index': {
        if (source === 'phone') return say(PHONE_NO);
        const s = await getJSON('/shots/status'); if (s.error) return say('I could not check: ' + s.error);
        if (s.running) return say('Already reading your screenshots.');
        if (!s.total) return say('I found no screenshots. I look in `Pictures\\Screenshots`; say **“add D:\\Shots to my screenshot folders”** to add another.');
        if (!s.pending) return say('All **' + pl(s.total, 'screenshot') + '** are already read.');
        const r = await callTool('/shots/update', { max: 150 }); if (r.error) return say(r.error);
        watchShots(s2 => jarvisSay(say('✓ Screenshots read: **' + s2.indexed + '** of ' + s2.total + (s2.pending ? ' (' + s2.pending + ' left — say “index my screenshots” again)' : '') + '. Try **“find the screenshot with …”**.', { speak: 'Your screenshots are read.' })));
        return say('⏳ Reading **' + Math.min(s.pending, 150) + '** screenshots in the background (about 2 seconds each). I will tell you when it is done.', { speak: 'Reading your screenshots.' });
      }
      case 'forget': {
        const go = await ask('Delete the screenshot search index? The words I read from your screenshots are erased. **Your screenshots themselves are not touched.**', 'YES, FORGET IT');
        if (!go) return say('Okay, I kept it.');
        const r = await callTool('/shots/forget', {});
        return say(r.error ? r.error : '✓ Forgot the text from ' + pl(r.forgotten, 'screenshot') + '.');
      }
      case 'add': case 'remove': {
        if (source === 'phone') return say(PHONE_NO);
        const r = await callTool('/shots/folders', m.op === 'add' ? { add: m.folder } : { remove: m.folder });
        return say(r.error ? r.error : m.op === 'add' ? '✓ I will look in `' + r.folder + '` for screenshots too. Say **“index my screenshots”** to read them.' : r.removed ? '✓ Removed that folder from the screenshot search.' : 'That folder was not one I had added.');
      }
    }
    return null;
  }

  /* ================= help ================= */
  const HELP = /^(?:\/life|(?:life|everyday)\s+tools|(?:what\s+can\s+you\s+do\s+(?:with|for)\s+)?(?:my\s+)?(?:expenses|habits)\s+help)\s*$/i;
  const help = () => say('**Everyday tools**\n- **Expenses:** “spent 120 on lunch”, “how much did I spend this month”, “export my expenses”\n- **Habits:** “track habit gym”, “I did gym”, “my gym streak”, “habits”\n- **Quick capture:** “jot down buy a charger”, “show my inbox”, or press **Ctrl+Shift+N**\n- **Keep JARVIS running:** “keep JARVIS running”, “stop keeping JARVIS alive”\n- **Backup to another drive:** “back up my files to D:”, “run a backup”, “backup status”, “turn on weekly backup”\n- **Screenshot search:** “find the screenshot with the wifi password”, “index my screenshots”');

  /* ================= router ================= */
  async function intercept(text, source) {
    const t = String(text || '').trim();
    if (!t || !J) return null;
    if (HELP.test(t)) return help();
    if (KA_STATUS.test(t)) return keepalive('status', source);
    if (KA_ON.test(t)) return keepalive('on', source);
    if (KA_OFF.test(t)) return keepalive('off', source);
    const bk = matchBackup(t); if (bk) return backup(bk, source);
    const sh = matchShot(t); if (sh) return shots(sh, source);
    if (EXP_EXPORT.test(t)) return exportExpenses();
    if (EXP_FORGET.test(t)) return expensesForget();
    const eq = J.parseExpenseQuery(t); if (eq) return expenseSummary(eq);
    const ex = J.parseExpense(t); if (ex) return logExpense(ex);
    const hb = J.matchHabit(t, habits());
    if (hb) {
      let r = null;
      switch (hb.op) {
        case 'add': r = habitAdd(hb.name); break;
        case 'list': r = habitsList(); break;
        case 'done': r = habitDone(hb.name, hb.day); break;
        case 'streak': r = habitStreak(hb.name); break;
        case 'del': r = await habitDel(hb.name); break;
      }
      if (r) return r;
    }
    const cs = J.parseCaptureShow(t); if (cs) return inbox(cs.day);
    const cp = J.parseCapture(t); if (cp) return capture(cp.text);
    return null;
  }
  return { intercept, matchBackup, matchShot, normDest, openCapture, help, set pollMs(v) { pollMs = v; }, expenses, habits };
})();
if (typeof module !== 'undefined') module.exports = Life;
