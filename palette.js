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
    add('Battery status', 'battery', 'System');
    add('Top processes', 'top processes', 'System');
    add('Screenshot', 'take a screenshot', 'System');
    add('Read my screen', 'read my screen', 'System');
    add('What can you do?', 'what can you do', 'Help');
    add('Why did you do that?', 'why did you do that', 'Help');
    // Learned phrases (command learning)
    if (typeof Agent !== 'undefined' && Agent.learnedSummary) {
      for (const l of (Agent.learnedSummary() || '').split('\n')) {
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

  // expose for tests (jsdom-less: only the pure parts)
  if (typeof module !== 'undefined') module.exports = { fuzzy, buildItemsRef: buildItems };
})();
