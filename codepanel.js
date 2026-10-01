'use strict';
/* JARVIS Code — a coding mode with its OWN conversation (server: jarviscode.js).
   Opening it (the JARVIS CODE button or tab) switches to the "JARVIS CODE" tab: its own messages, saved separately
   from the normal chat (jarvis.codeChat), and swaps the chat box for the coding composer — what to build, the project
   folder (＋ opens the Windows folder picker), the mode (Build writes the files · Plan · Ask) and the AI model.
   Build asks the AI for the files, then writes them itself — nothing to copy and paste. Outside ~/jarvis it asks
   permission first, right here in the JARVIS Code chat. CHAT (or Esc) goes back to the normal JARVIS chat. */
(function CodePanel() {
  const $ = s => document.querySelector(s);
  const panel = $('#codePanel'), controls = panel && panel.closest('.controls'), box = $('#codeMessages');
  if (!panel || !controls || !box) return;
  const input = $('#codeInput'), sendBtn = $('#codeSendBtn'), modeSel = $('#codeMode'), modelSel = $('#codeModel'), folderLabel = $('#codeFolderLabel');
  const KEY = 'jarvis.code', LOG = 'jarvis.codeChat';
  const get = (k, d) => { try { return store.get(k, d) || d; } catch (e) { return d; } };
  const saved = get(KEY, {});
  const st = { folder: saved.folder || '', recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 6) : [], mode: saved.mode || 'build', model: saved.model || '', busy: false, on: false };
  let log = get(LOG, []); if (!Array.isArray(log)) log = [];
  const save = () => { try { store.set(KEY, { folder: st.folder, recent: st.recent, mode: st.mode, model: st.model }); } catch (e) {} };
  const saveLog = () => { log = log.slice(-60); try { store.set(LOG, log); } catch (e) {} $('#codeCount').textContent = log.filter(m => m.role === 'user').length; };
  const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  const pad2 = n => String(n).padStart(2, '0');
  const hhmm = t => { const d = new Date(t || Date.now()); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

  /* ---------- the JARVIS Code conversation ---------- */
  function emptyNote() {
    if (log.length || box.querySelector('.code-empty')) return;
    box.innerHTML = '<div class="code-empty"><b>JARVIS Code</b><br>Describe what to build or change — e.g. <b>“a calculator website with a dark theme”</b>.<br>'
      + 'Pick the project folder with <b>＋</b>. <b>Build</b> writes the files for you, <b>Plan</b> only lists the steps, <b>Ask</b> answers questions about the code.</div>';
  }
  // Actions are rebuilt from plain data, so they still work after a reload.
  const ACTS = {
    page: x => ({ label: 'OPEN PAGE', fn: () => callTool('/tool/openFile', { name: x }) }),
    folder: x => ({ label: 'OPEN FOLDER', fn: () => callTool('/tool/openFolder', { name: x }) }),
    vscode: x => ({ label: 'OPEN IN VS CODE', fn: () => callTool('/tool/openInEditor', { name: x }) }),
  };
  function render(m) {
    const empty = box.querySelector('.code-empty'); if (empty) empty.remove();
    const wrap = document.createElement('div'); wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'jarvis');
    if (m.role === 'user') {
      wrap.innerHTML = '<div class="mhead"><span>' + hhmm(m.t) + '</span><span>' + escHtml((m.tag || 'BUILD').toUpperCase()) + (m.folder ? ' · ' + escHtml(base(m.folder)) : '') + '</span><span class="who">YOU</span></div><div class="mbody"></div>';
      wrap.querySelector('.mbody').textContent = m.text;
    } else {
      wrap.innerHTML = '<div class="avatar">' + (typeof AVATAR !== 'undefined' ? AVATAR : '') + '</div><div class="mcontent"><div class="mhead"><span class="who">JARVIS CODE</span><span>' + hhmm(m.t) + '</span><span class="meta"></span></div><div class="mbody"></div><div class="mextra"></div></div>';
      wrap.querySelector('.mbody').innerHTML = typeof renderMD === 'function' ? renderMD(m.text) : escHtml(m.text);
      if (m.meta) wrap.querySelector('.meta').textContent = m.meta;
      const acts = (m.acts || []).map(([k, x]) => ACTS[k] && ACTS[k](x)).filter(Boolean).concat(m.live || []);
      if (acts.length) {
        const row = document.createElement('div'); row.className = 'confirmRow';
        acts.forEach(a => { const b = document.createElement('button'); b.className = 'cbtn' + (a.danger ? ' danger' : ''); b.textContent = a.label; b.addEventListener('click', () => { if (a.once) row.classList.add('done'); a.fn(); }); row.appendChild(b); });
        wrap.querySelector('.mextra').appendChild(row);
      }
    }
    box.appendChild(wrap); box.scrollTop = box.scrollHeight;
    return wrap;
  }
  function say(role, text, extra) {
    const m = Object.assign({ role, text, t: Date.now() }, extra || {});
    const el = render(m);
    if (!m.temp) { const { live, ...keep } = m; log.push(keep); saveLog(); }
    if (role !== 'user' && m.speak && typeof speak === 'function' && typeof settings !== 'undefined' && settings.tts) speak(m.speak);
    return el;
  }
  function restore() { box.innerHTML = ''; log.forEach(render); emptyNote(); saveLog(); }

  /* ---------- open / close: the JARVIS Code tab + composer ---------- */
  const showFolder = () => {
    folderLabel.textContent = st.folder ? base(st.folder) : 'New project';
    $('#codeFolderBtn').title = 'Project folder: ' + (st.folder || 'a new folder in ~/jarvis/Projects') + ' — click to choose a folder';
    $('#codeFolderClear').hidden = !st.folder;
    $('#codeFootLabel').textContent = 'JARVIS CODE · ' + (st.folder || 'new project in ~/jarvis/Projects');
  };
  function useFolder(p) {
    st.folder = p || '';
    if (p) { st.recent = [p, ...st.recent.filter(x => x !== p)].slice(0, 6); if (typeof setFocus === 'function') setFocus('folder', p); }
    showFolder(); save();
  }
  function fillModels() {
    const list = (typeof llm !== 'undefined' && llm.models) || [];
    const cur = st.model && list.includes(st.model) ? st.model : (llm && llm.model) || list[0] || '';
    modelSel.innerHTML = list.length ? list.map(m => '<option value="' + escHtml(m) + '"' + (m === cur ? ' selected' : '') + '>' + escHtml(m.replace(/^[\w-]+::/, '')) + '</option>').join('') : '<option value="">AI offline</option>';
  }
  function open(on) {
    st.on = on;
    controls.classList.toggle('coding', on);
    $('#codeModeBtn').classList.toggle('active', on);
    if (typeof switchTab === 'function') switchTab(on ? 'code' : 'chat');
    if (on) { fillModels(); showFolder(); modeSel.value = st.mode; box.scrollTop = box.scrollHeight; setTimeout(() => input.focus(), 0); }
    else if (typeof chatInput !== 'undefined') chatInput.focus();
  }

  /* ---------- ＋ : the project folder (Windows "Select Folder" dialog) ---------- */
  async function pickFolder() {
    const btn = $('#codeFolderBtn'); if (btn.disabled) return;
    btn.disabled = true; folderLabel.textContent = 'Choose a folder…';
    toast('Choose a folder in the window that just opened', true);
    try {
      const r = await callTool('/sys/pickFolder', { title: 'JARVIS Code — choose the project folder', start: st.folder || (typeof focusOf === 'function' && focusOf('folder') ? focusOf('folder').path : '') });
      if (r && r.path) return checkFolder(r.path);
      if (r && r.cancelled) return;
      return pickFolderTyped();   // no dialog on this machine (not Windows, or it failed): type it instead
    } finally { btn.disabled = false; showFolder(); }
  }
  function pickFolderTyped() {
    const f = typeof focusOf === 'function' && focusOf('folder');
    const opts = [['', 'New project (in ~/jarvis/Projects)']];
    if (f && !st.recent.includes(f.path)) opts.push([f.path, base(f.path) + ' — the folder you just looked at']);
    st.recent.forEach(p => opts.push([p, base(p) + ' — ' + p]));
    const ans = window.prompt('Where should JARVIS Code work?\n\n' + opts.map((o, i) => (i + 1) + '. ' + o[1]).join('\n') + '\n\nType a number, or a folder: a full path (D:\\Projects\\calculator), "desktop", "D drive"…', '');
    if (ans === null) return;
    const t = ans.trim();
    if (/^\d+$/.test(t) && opts[+t - 1]) return useFolder(opts[+t - 1][0]);
    if (t) checkFolder(t);
  }
  async function checkFolder(t) {
    const r = await callTool('/tool/listFiles', { dir: t });
    if (r && r.path) { useFolder(r.path); say('jarvis', '📁 Working in `' + r.path + '` now — ' + r.folders.length + ' folders and ' + r.files.length + ' files.', { meta: 'FOLDER' }); }
    else if (r && r.choices) { useFolder(r.choices[0]); toast('Using ' + r.choices[0] + ' (several matched)'); }
    else toast((r && r.error) || 'Couldn’t find that folder');
  }

  // Writing outside ~/jarvis: the permission card, shown here in the JARVIS Code chat (not in the hidden normal chat).
  function askHere(paths, n) {
    return new Promise(resolve => {
      say('jarvis', '⚠ JARVIS Code wants to **write ' + n + ' file' + (n === 1 ? '' : 's') + '** in `' + String(paths[0] || '').replace(/[\\/][^\\/]*$/, '').replace(/`/g, '') + '`:\n' + paths.slice(0, 8).map(p => '- `' + p + '`').join('\n') + '\n\nThat is outside `~/jarvis`, so I need your permission.',
        { meta: 'APPROVAL', temp: true, live: [{ label: 'ALLOW', danger: true, once: true, fn: () => resolve(true) }, { label: 'CANCEL', once: true, fn: () => resolve(false) }] });
    });
  }

  /* ---------- send ---------- */
  async function send() {
    const prompt = input.value.trim();
    if (!prompt || st.busy) return;
    if (/^(?:clear|clear (?:the )?chat|new chat)$/i.test(prompt)) { input.value = ''; return clearLog(); }
    if (/^undo$/i.test(prompt)) { input.value = ''; const r = typeof Undo !== 'undefined' ? await Undo.undo() : null; return say('jarvis', r ? (r.error ? 'Couldn’t undo: ' + r.error : '↶ ' + (r.msg || 'Undone.')) : 'Nothing to undo.', { meta: 'UNDO' }); }
    if (typeof llmReady === 'function' && !llmReady()) { toast('JARVIS Code needs the AI brain — turn it on in Settings → AI BRAIN'); return; }
    let mode = modeSel.value; const model = modelSel.value || undefined;
    // The conversation so far goes along, so follow-ups make sense ("make the buttons bigger", "now add dark mode") —
    // without JARVIS's own labels ("Plan for …", "Happy with it?", "Keep going…"), which the AI would copy.
    const prev = log.filter(m => m.text && !/^⏳|^⚠/.test(m.text));
    const bare = t => String(t || '').replace(/^(?:\*\*Plan\*\* for `[^`]*`\s*)+/, '').replace(/\n*_Happy with it\?[^\n]*_\s*/g, '').replace(/\n*_Keep going[\s\S]*$/, '').trim();
    const history = prev.slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: bare(m.text) })).filter(h => h.text);
    // "yes" / "okay build it" / "proceed" / "go ahead" right after a plan = build THAT request, following THAT plan
    // (even if the mode was still on Plan). The request is your last real one — not an earlier "yes".
    const GO = /^(?:ok(?:ay)?|yes|yeah|yep|yup|sure|great|cool|good|fine|alright|perfect|looks good|sounds good|correct)?[\s,!.]*(?:now\s+|please\s+|then\s+|just\s+)*(?:build|built|make|do|implement|create|code|write|go ahead|proceed|start|go|continue|carry on|execute|apply)?(?:\s+(?:it|that|this|the plan|them|the code|the files|the app|with (?:it|that|the plan)))?(?:\s+(?:now|please))?[\s.!]*$/i;
    const isGo = t => GO.test(t) && /\w/.test(t);
    let request = prompt;
    const lastJarvis = [...prev].reverse().find(m => m.role !== 'user');
    const plan = lastJarvis && /^\*\*Plan\*\*/.test(lastJarvis.text) ? lastJarvis : null;
    if (isGo(prompt) && (mode === 'build' || plan)) {
      const req = [...prev].reverse().find(m => m.role === 'user' && !isGo(m.text));
      if (req) {
        if (mode !== 'build') { mode = 'build'; modeSel.value = 'build'; st.mode = 'build'; save(); }
        request = 'Build this: ' + req.text + (plan ? '\n\nFollow this plan:\n' + bare(plan.text) : '');
      }
    }
    st.busy = true; sendBtn.disabled = true; input.value = ''; input.style.height = '';
    const tag = { build: 'Build', plan: 'Plan', ask: 'Ask' }[mode];
    // New project folder name: the thing being built ("create a todolist using html…" → todolist-using-html)
    const name = request.replace(/^Build this:\s*/i, '').split('\n')[0].replace(/^(?:please\s+)?(?:create|make|build|write|code|design|develop|generate)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|my\s+)?/i, '').split(/\s+/).slice(0, 3).join(' ');
    say('user', prompt, { tag, folder: st.folder });
    const wait = say('jarvis', '⏳ ' + (mode === 'build' ? 'Writing the code' : mode === 'plan' ? 'Planning' : 'Looking at the project') + ' with **' + (model || 'the AI').replace(/^[\w-]+::/, '') + '** — this can take a minute or two on a local model…', { meta: tag.toUpperCase(), temp: true });
    if (typeof setState === 'function') setState('PROCESSING', mode === 'build' ? 'JARVIS Code is writing the files…' : 'JARVIS Code is thinking…');
    const t0 = Date.now(), took = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
    try {
      const g = await callTool('/code/generate', { prompt: request, name, mode, model, folder: st.folder || undefined, history });
      wait.remove();
      if (g.error) return say('jarvis', 'I couldn’t do that: ' + g.error, { meta: tag.toUpperCase() });
      if (mode !== 'build') { if (st.folder) useFolder(g.folder); return say('jarvis', (mode === 'plan' ? '**Plan** for `' + g.folder + '`\n\n' : '') + g.text + (mode === 'plan' ? '\n\n_Happy with it? Switch to **Build** and send it again._' : ''), { meta: tag.toUpperCase() + ' · ' + took() }); }
      // Build: write the files.
      const body = { folder: st.folder || undefined, prompt: request, name, files: g.files };
      let a = await callToolRaw('/code/apply', body);
      if (a && a.needsApproval) {
        if (!(await askHere(a.paths || [], g.files.length))) return say('jarvis', 'Cancelled — nothing was written.', { meta: 'BUILD' });
        a = await callToolRaw('/code/apply', Object.assign({}, body, { approved: true }));
      }
      if (a.error) return say('jarvis', 'I wrote the code but couldn’t save it: ' + a.error, { meta: 'BUILD' });
      useFolder(a.folder);
      const w = a.written || [];
      if (typeof Undo !== 'undefined') Undo.push('JARVIS Code changes in ' + base(a.folder), async () => {
        for (const f of w) { const x = f.created ? await callTool('/tool/undoCreate', { name: f.full }) : f.backup ? await callTool('/tool/restoreVersion', { backup: f.backup, name: f.full }) : {}; if (x && x.error) throw new Error(x.error); }
        return 'Undid JARVIS Code’s changes in `' + base(a.folder) + '`.';
      });
      const page = w.find(f => /(^|\/)index\.html?$/i.test(f.path)) || w.find(f => /\.html?$/i.test(f.path));
      if (page) { if (typeof setFocus === 'function') setFocus('file', page.full); callTool('/tool/openFile', { name: page.full }); }
      say('jarvis', '✓ ' + (w.some(f => !f.created) ? 'Updated' : 'Created') + ' **' + w.length + ' file' + (w.length === 1 ? '' : 's') + '** in `' + a.folder + '`:\n'
          + w.map(f => '- ' + (f.created ? '🆕 ' : '✏️ ') + '`' + f.path + '` (' + f.lines + ' lines)').join('\n')
          + (g.note ? '\n\n' + g.note : '') + (page ? '\n\nOpened **' + page.path + '** in your browser.' : '')
          + '\n\n_Keep going — e.g. “make the buttons bigger” — it works in the same folder. Type **undo** to take it back._',
        { meta: 'BUILD · ' + took(), speak: 'Done. I wrote ' + w.length + ' file' + (w.length === 1 ? '' : 's') + (page ? ' and opened the page.' : '.'),
          acts: [page && ['page', page.full], ['folder', a.folder], ['vscode', a.folder]].filter(Boolean) });
    } catch (e) {
      if (wait.isConnected) wait.remove();
      say('jarvis', 'I ran into a problem: ' + e.message, { meta: 'ERROR' });
    } finally { st.busy = false; sendBtn.disabled = false; if (typeof idleState === 'function') setTimeout(idleState, 400); }
  }
  function clearLog() {
    const old = log.slice(); log = []; saveLog(); restore();
    if (typeof Undo !== 'undefined' && old.length) Undo.push('cleared the JARVIS Code chat', async () => { log = old; saveLog(); restore(); return 'The JARVIS Code chat is back.'; });
    toast('JARVIS Code chat cleared');
  }

  $('#codeModeBtn').addEventListener('click', () => open(!st.on));
  $('#codeExitBtn').addEventListener('click', () => open(false));
  $('#codeFolderBtn').addEventListener('click', pickFolder);
  $('#codeFolderClear').addEventListener('click', () => { useFolder(''); toast('JARVIS Code → a new project'); });
  $('#clearCodeBtn').addEventListener('click', clearLog);
  // The tabs: JARVIS CODE opens the coding mode; CHAT / TASKS / MEMORY leave it.
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.tab === 'code' && !st.on) open(true);
    else if (t.dataset.tab !== 'code' && st.on) { st.on = false; controls.classList.remove('coding'); $('#codeModeBtn').classList.remove('active'); }
  }));
  sendBtn.addEventListener('click', send);
  modeSel.addEventListener('change', () => { st.mode = modeSel.value; save(); });
  modelSel.addEventListener('change', () => { st.model = modelSel.value; save(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { e.preventDefault(); open(false); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(220, input.scrollHeight) + 'px'; });
  restore(); showFolder();
  window.JarvisCode = { open, useFolder, state: st, say, get log() { return log; } };
})();
