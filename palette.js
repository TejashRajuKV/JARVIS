'use strict';
/* Ctrl+K command palette: one fuzzy-searchable list of everything JARVIS can do —
   quick-action chips, study/skills, attendance & marks, tools from the server registry,
   and the phrases you've taught it. Arrow keys + Enter, Esc closes, Ctrl+K toggles. */
(function Palette() {
  const $ = s => document.querySelector(s);
  let box = null, input = null, list = null, open = false, items = [], sel = 0;

  // Every entry: { label, hint, run } — run() sends the command through the normal turn pipeline.
  function buildItems() {
    const out = [];
    const add = (label, cmd, group, hint) => out.push({ label, hint: hint || '', group, cmd });
    // Quick actions (the chips under the message box, all groups)
    if (typeof CHIP_GROUPS !== 'undefined') for (const g of Object.keys(CHIP_GROUPS)) for (const c of CHIP_GROUPS[g]) add(c, c.replace('Play / pause', 'pause'), 'Quick actions', g.toLowerCase());
    // Skills & study
    add('UI design prompt', 'ui design prompt', 'Skills', 'TCREI: 4 questions, then the prompt');
    // Skill packs (SKILL.md folders): "/name…" fills the box so you can add what it should work on
    if (typeof Skills !== 'undefined' && Skills.packs) for (const p of Skills.packs) add('/' + p.name + '…', '/' + p.name, 'Skills', p.hint);
    add('Plan my day', 'plan my day', 'Study');
    add('Plan my GATE prep…', 'plan my gate prep, exam on', 'Study', 'then: exam date + topics');
    add('Take my DBMS viva', 'take my dbms viva', 'Study');
    add('Coach me on two sum', 'coach me on two sum', 'Study');
    add('Quiz me on operating systems', 'quiz me on operating systems', 'Study');
    add('Review my flashcards', 'review my flashcards', 'Study');
    add('Weekly summary — how was my week?', 'how was my week', 'Study');
    add('Mark a class present…', 'mark dbms present', 'Attendance');
    add('Mark a class absent…', 'mark dbms absent', 'Attendance');
    add('Attendance report', 'attendance report', 'Attendance');
    add('Can I bunk tomorrow?', 'can i bunk tomorrow dbms class', 'Attendance');
    add('Add semester result…', 'add s3: 8.6 gpa, 24 credits', 'Attendance', 'edit the numbers');
    add('What is my CGPA?', 'what is my cgpa', 'Attendance');
    add('Start a focus session', 'start a focus session', 'Focus');
    add('Block distractions', 'block distractions', 'Focus');
    add('Productivity report', 'how productive was i today', 'Focus');
    add('Panic mode — pause all automation', 'panic', 'Automation');
    add('Resume automation', 'resume', 'Automation');
    add('List my routines', 'list my routines', 'Automation');
    add('List my triggers', 'list my triggers', 'Automation');
    add('Daily briefing', 'give me my briefing', 'Automation');
    add('Run diagnostics', 'run diagnostics', 'System');
    add('Check my AI', 'check my ai', 'System', 'Ollama, recent AI errors, disk space');
    add('What is down? (watchdog)', 'what is down', 'System', 'Ollama and anything you watch');
    add('Places near me…', 'list cafes near', 'Skills', 'cafés, pharmacies, ATMs… from the map');
    add('Analyze a CSV file…', '/csv', 'Skills', 'statistics, questions, charts');
    add('Document a project…', '/wiki', 'Skills', 'overview, architecture diagram, module pages');
    add('Draw a picture…', '/image', 'Skills', 'text to image (online service or your own)');
    add('PDF tools…', '/pdf', 'Skills', 'merge, split, rotate, watermark, make');
    add('What is using my disk?', "what's using my C: drive", 'System', 'biggest folders, temp files, free space');
    add('Tidy my Downloads', 'tidy my downloads', 'System', 'sort into folders — undo puts it back');
    add('Find large files', 'find large files', 'System', 'then “trash 1, 3”');
    add('Find duplicate files', 'find duplicate files', 'System', 'keeps one copy of each');
    add('Clean my temp files', 'clean my temp files', 'System', 'old temp files; permanent');
    add('Find similar photos', 'find similar photos', 'System', 'look-alikes, even resized; undo puts them back');
    add('Shrink my big photos', 'shrink my big photos', 'System', 'original stays in the JARVIS trash');
    add('Scan a document', 'scan a document', 'Camera', 'camera → straightened page → searchable PDF');
    add('Scan a QR code', 'scan a qr code', 'Camera', 'shows the link; never opens it by itself');
    add('Make a QR code…', 'make a qr for ', 'Camera', 'link or text → picture');
    add('Solve from a photo', 'solve this from a photo', 'Camera', 'the local AI looks at the picture');
    add('Lock when I leave (on/off)', 'lock when I leave', 'Camera', 'webcam looks for a face; locks JARVIS');
    add('Watch my room', 'watch my room', 'Camera', 'movement alert; pictures stay on this laptop');
    add('Search my old chats…', 'what did I decide about ', 'Study', 'every message is kept on this laptop');
    add('Import my timetable', 'import my timetable', 'Study', 'photo, calendar file or pasted lines');
    add('Start lecture mode…', 'start lecture mode for ', 'Study', 'listens, saves a transcript, writes notes');
    add('Start an exam…', 'start an exam on ', 'Study', 'timed questions from a note; mistakes become flashcards');
    add('How did my exams go?', 'how did my exams go', 'Study');
    add('Watch a port or site…', 'watch localhost:5000', 'System', 'tell me if it goes down');
    add('Battery status', 'battery', 'System');
    add('Top processes', 'top processes', 'System');
    add('Screenshot', 'take a screenshot', 'System');
    add('Read my screen', 'read my screen', 'System');
    add('What can you do?', 'what can you do', 'Help');
    add('Why did you do that?', 'why did you do that', 'Help');
    // Learned phrases (command learning)
    if (typeof Agent !== 'undefined' && Agent.learnedSummary) {
      const ls = Agent.learnedSummary();
      for (const l of String((ls && ls.text) || '').split('\n')) {
        const m = l.match(/"(.+?)"\s*→/);
        if (m) add('⭐ ' + m[1], m[1], 'Learned', 'taught by you');
      }
    }
    return out.slice(0, 300);
  }

  // Fuzzy subsequence match: score by contiguity and word starts; null = no match.
  function fuzzy(query, text) {
    const q = query.toLowerCase().trim(), t = text.toLowerCase();
    if (!q) return 1;
    let ti = 0, score = 0, streak = 0;
    for (const ch of q) {
      if (ch === ' ') { streak = 0; continue; }
      const at = t.indexOf(ch, ti);
      if (at < 0) return null;
      streak = at === ti ? streak + 1 : 1;
      score += 2 + Math.min(streak, 4) + (at === 0 || /[\s(·—-]/.test(t[at - 1] || ' ') ? 2 : 0);
      ti = at + 1;
    }
    return score;
  }

  function ensureDom() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'palette';
    box.innerHTML = '<div class="pal-box"><input id="palInput" type="text" placeholder="Type a command…" autocomplete="off" spellcheck="false"><div id="palList" role="listbox"></div><div class="pal-foot">↑↓ navigate · Enter run · Esc close</div></div>';
    document.body.appendChild(box);
    input = $('#palInput'); list = $('#palList');
    box.addEventListener('mousedown', e => { if (e.target === box) close(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }

  function render() {
    items = buildItems()
      .map(it => { const s = fuzzy(input.value, it.label + ' ' + it.group + ' ' + it.hint); return s === null ? null : { ...it, s }; })
      .filter(Boolean)
      .sort((a, b) => b.s - a.s)
      .slice(0, 24);
    sel = 0;
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<div class="pal-empty">Nothing matches — Enter asks the AI anyway.</div>'; return; }
    let group = '';
    items.forEach((it, i) => {
      if (it.group !== group) { group = it.group; const h = document.createElement('div'); h.className = 'pal-group'; h.textContent = group.toUpperCase(); list.appendChild(h); }
      const d = document.createElement('div');
      d.className = 'pal-item' + (i === 0 ? ' sel' : '');
      d.innerHTML = '<span class="pl"></span><span class="pl-label"></span>' + (it.hint ? '<span class="pl-hint"></span>' : '');
      d.querySelector('.pl-label').textContent = it.label;
      if (it.hint) d.querySelector('.pl-hint').textContent = it.hint;
      d.addEventListener('click', () => run(it));
      list.appendChild(d);
    });
  }

  function move(n) {
    if (!items.length) return;
    sel = (sel + n + items.length) % items.length;
    [...list.querySelectorAll('.pal-item')].forEach((el, i) => el.classList.toggle('sel', i === sel));
    const el = list.querySelectorAll('.pal-item')[sel];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function run(it) {
    close();
    if (typeof handleUser === 'function') handleUser(it.cmd, 'palette');
  }

  function openPal() { ensureDom(); open = true; box.classList.add('open'); input.value = ''; render(); setTimeout(() => input.focus(), 0); }
  function close() { open = false; if (box) box.classList.remove('open'); input && input.blur(); }

  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open ? close() : openPal(); }
    else if (open && e.key === 'Escape') close();
  }, true);

  // "/" in the chat box: a small skills menu right above the input (type to filter, ↑↓ Tab/Enter, Esc).
  let sbox = null, sitems = [], ssel = 0;
  function slashQuery(inp) { const v = inp.value; return v.startsWith('/') && !/\s{2,}/.test(v) ? v.slice(1) : null; }
  function slashClose() { if (sbox) sbox.classList.remove('open'); sitems = []; }
  function slashRender(inp) {
    const q = slashQuery(inp);
    if (q === null) return slashClose();
    if (!sbox) { sbox = document.createElement('div'); sbox.id = 'slashMenu'; sbox.setAttribute('role', 'listbox'); document.body.appendChild(sbox); }
    const r = (inp.closest('.input-row') || inp).getBoundingClientRect(); // fixed: the composer panel clips anything above it
    sbox.style.left = r.left + 'px'; sbox.style.width = r.width + 'px'; sbox.style.bottom = (innerHeight - r.top + 6) + 'px';
    const ql = q.toLowerCase().trim();
    sitems = buildItems().filter(it => it.group !== 'Quick actions' || ql) // bare "/" lists the skills, not every chip
      .map(it => { const lab = it.label.toLowerCase(), t = lab + ' ' + it.group.toLowerCase() + ' ' + (it.hint || '').toLowerCase();
        const starts = lab.startsWith(ql), word = ql && (' ' + t).includes(' ' + ql); // word-start matches only, so "ui" doesn't hit "quiz"
        if (ql && !word) return null;
        return { ...it, s: (starts ? 4 : 0) + (it.group === 'Skills' ? 2 : 0) + (word ? 1 : 0) }; })
      .filter(Boolean).sort((a, b) => b.s - a.s);
    ssel = 0; sbox.innerHTML = '';
    if (!sitems.length) { sbox.innerHTML = '<div class="pal-empty">No skill matches. Delete the / to just ask.</div>'; sbox.classList.add('open'); return; }
    sitems.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'pal-item' + (i === 0 ? ' sel' : '');
      d.innerHTML = '<span class="pl-label"></span><span class="pl-hint"></span>';
      d.querySelector('.pl-label').textContent = it.label;
      d.querySelector('.pl-hint').textContent = it.hint || it.group;
      d.addEventListener('mousedown', e => { e.preventDefault(); slashPick(inp, it); });
      sbox.appendChild(d);
    });
    sbox.classList.add('open');
  }
  function slashPick(inp, it) {
    slashClose();
    if (/…$/.test(it.label)) { inp.value = it.cmd + ' '; inp.focus(); return; } // needs details: fill, let the user finish
    inp.value = '';
    if (typeof handleUser === 'function') handleUser(it.cmd, 'slash');
  }
  function slashInit() {
    const inp = $('#chatInput'); if (!inp) return;
    inp.addEventListener('input', () => slashRender(inp));
    inp.addEventListener('blur', () => setTimeout(slashClose, 120));
    inp.addEventListener('keydown', e => {
      if (!sitems.length || !sbox || !sbox.classList.contains('open')) return;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      const mv = n => { ssel = (ssel + n + sitems.length) % sitems.length; [...sbox.querySelectorAll('.pal-item')].forEach((el, i) => el.classList.toggle('sel', i === ssel)); };
      if (e.key === 'ArrowDown') { stop(); mv(1); }
      else if (e.key === 'ArrowUp') { stop(); mv(-1); }
      else if (e.key === 'Enter' || e.key === 'Tab') { stop(); slashPick(inp, sitems[ssel]); }
      else if (e.key === 'Escape') { stop(); slashClose(); }
    }, true);
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', slashInit); else slashInit(); }

  // expose for tests (jsdom-less: only the pure parts)
  if (typeof module !== 'undefined') module.exports = { fuzzy, buildItemsRef: buildItems };
})();
