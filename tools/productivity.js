'use strict';
/* executeTool, productivity: productivity tools, the briefing, chat memory.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('productivity', async function (p, raw, s, a) {
  switch (p.intent) {
    /* ---- productivity ---- */
    case 'BLOCK_DISTRACTIONS': {
      const DISTRACTORS = Agent.DISTRACTORS;
      toolStep('runningApps');
      const r = await callTool('/tool/runningApps', { apps: DISTRACTORS });
      // An unreadable process list is "can't tell", never "nothing is open".
      if (r.error || (Array.isArray(r.checked) && !r.checked.length)) return { text: 'I couldn’t check which apps are open, so I didn’t close anything or start a focus session' + (r.error ? ': ' + r.error : '') + '.', error: r.error || 'could not read the process list' };
      const running = r.running || [];
      const min = settings.focusMin || 25;
      // Inside a plan that has its own focus-session step, this step only closes the apps (no second session).
      const withFocus = !a.noFocus;
      if (!running.length) {
        if (withFocus) startFocus(min);
        return { text: withFocus ? 'No distracting apps are open — nice. Started a **' + min + '-minute** focus session. Put your phone on Do Not Disturb.' : 'No distracting apps are open — nice.', tool: 'focus', op: { kind: 'distractions', closed: [], all: DISTRACTORS } };
      }
      const names = running.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n);
      return { text: 'Deep work mode: I will close **' + names.join(', ') + '**' + (withFocus ? ' and start a ' + min + '-minute focus session' : '') + '. Unsaved chats/music will stop.', op: { kind: 'distractions', closed: running, all: DISTRACTORS }, confirm: { yes: withFocus ? 'CLOSE & FOCUS' : 'CLOSE THEM', no: 'CANCEL', onConfirm: async () => {
        const shut = [];
        for (const k of running) { toolStep('closeApplication → ' + k); const c = await callTool('/tool/closeApplication', { app: k }); if (c && c.success) shut.push(k); }
        if (shut.length) Undo.push('closed ' + shut.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n).join(', '), async () => {
          for (const k of shut) { const x = await callTool('/tool/openApplication', { app: k }); if (x.error) throw new Error(x.error); }
          return 'Opened ' + shut.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n).join(', ') + ' again (unsaved work in them can’t come back).';
        });
        if (withFocus) { startFocus(min); Undo.push('started a ' + min + '-minute focus session', () => stopFocus(true) ? 'Focus session stopped.' : 'That focus session had already ended.'); }
        const nm = ks => ks.map(k => (NLU.APPS.find(x => x.k === k) || { n: k }).n).join(', ');
        const left = running.filter(k => !shut.includes(k));
        jarvisSay({ text: (shut.length ? 'Closed ' + nm(shut) + '.' : 'I couldn’t close any of them.') + (left.length ? ' **' + nm(left) + '** didn’t close — please close ' + (left.length > 1 ? 'them' : 'it') + ' yourself.' : '') + (withFocus ? ' Focus session running for **' + min + ' minutes** — you have got this.' : ''), intent: 'BLOCK_DISTRACTIONS' });
      } } };
    }
    case 'SHOW_DESKTOP': { toolStep('showDesktop'); const r = await callTool('/tool/showDesktop'); return r.error ? { text: 'I couldn’t minimise the windows: ' + r.error, error: r.error } : { text: 'Minimised everything.', noTTS: true, tool: 'showDesktop' }; }
    case 'OPEN_KNOWN_FOLDER': {
      const m = s.match(/\b(downloads|desktop|pictures|photos|music|videos)\b/);
      toolStep('openKnownFolder → ' + (m ? m[1] : '?'));
      const r = await callTool('/tool/openKnownFolder', { name: m ? m[1] : '' });
      return r.error ? { text: r.error } : { text: 'Opening your **' + r.name + '** folder.', tool: 'openKnownFolder' };
    }
    case 'BACKUP': {
      if (/\b(restore|import)\b/i.test(p.original)) return { text: 'To restore a backup: **Settings → Backup & restore → IMPORT…**, choose the file, and pick Merge or Replace. Windows Hello approves it if you turned that on.', tool: 'backup', actions: [{ label: 'OPEN SETTINGS', fn: () => { $('#settingsBtn').click(); } }] };
      return { text: 'I can save your chat, to-dos, flashcards, routines, study plans and settings to one file (no API keys). To include your API keys or to restore, use **Settings → Backup & restore**.', tool: 'backup', intent: 'BACKUP',
        actions: [{ label: 'EXPORT NOW', fn: async () => { const r = await bkExport(false, ''); jarvisSay({ text: r.error ? 'Could not export: ' + r.error : '✓ Saved **' + r.filename + '** to your Downloads. Keep it somewhere safe.', intent: 'BACKUP' }); } }] };
    }
    case 'UNDO': return { text: await runUndo(false), tool: 'undo' };
    case 'UNDO_TASK': { const m = String(p.original || '').match(/agt-\d{8}-\d{3}/i); return { text: await runUndoTask(m ? m[0].toUpperCase() : '', false), tool: 'undo', noPersona: true }; }
    case 'AGENT_INSPECT': { const m = String(p.original || '').match(/agt-\d{8}-\d{3}/i); return Agent.inspect(m ? m[0] : ''); }
    case 'REGENERATE': {
      let me = -1; for (let k = chatLog.length - 1; k >= 0; k--) if (chatLog[k].role === 'user') { me = k; break; }
      let prev = -1; for (let k = me - 1; k >= 0; k--) if (chatLog[k].role === 'user') { prev = k; break; }
      if (prev < 0) return { text: 'There’s no earlier question to answer again.' };
      const q = chatLog[prev].text;
      chatLog.splice(me, 1); deleteExchange(prev, true);
      setTimeout(() => handleUser(q, 'text'), 50);
      return { text: '🔄 Asking again: “' + (q.length > 60 ? q.slice(0, 60) + '…' : q) + '”', tool: 'regenerate', noTTS: true, noLog: true };
    }
    case 'DELETE_LAST_MSG': {
      // chatLog ends with this very command; delete the exchange before it, then this command too.
      let me = -1; for (let k = chatLog.length - 1; k >= 0; k--) if (chatLog[k].role === 'user') { me = k; break; }
      let prev = -1; for (let k = me - 1; k >= 0; k--) if (chatLog[k].role === 'user') { prev = k; break; }
      if (prev < 0) return { text: 'There’s no earlier message of yours to delete.' };
      const gone = chatLog[prev].text;
      if (me >= 0) chatLog.splice(me, 1);
      deleteExchange(prev, true);
      return { text: 'Deleted your message “' + (gone.length > 60 ? gone.slice(0, 60) + '…' : gone) + '” and my reply. Say **undo** to bring it back.', tool: 'deleteMessage', noTTS: true };
    }
    case 'TRIGGER_CREATE': {
      const t = Triggers.parseTriggerText(p.original, q => NLU.findApp(q.toLowerCase()));
      const eg = 'e.g. "when I plug in my charger, start study mode", "when I open VS Code, block distractions", "when the battery drops below 20%, run leaving" or "when I connect to Wi-Fi HomeNet, start study mode"';
      if (!t) return { text: 'I couldn’t tell what should start it, ' + Persona.sir() + ' — ' + eg + '.' };
      const nm = Triggers.routineNameFrom(t.action);
      const existing = Routines.find(nm) || Routines.find(nm + ' mode') || Routines.find(t.action);
      const steps = existing ? null : expandSteps(Routines.parseSteps(t.action));
      const known = steps && steps.length && steps.every(st => { const q = NLU.classify(NLU.normalize(st, settings.wakeWord), {}); return !(q.intent === 'CONVERSATION' || q.confidence < 0.85); });
      if (!existing && !known) return { text: 'I don’t know how to "' + t.action + '" yet. Name one of your routines (' + Routines.list().map(r => '**' + r.name + '**').join(', ') + ') or a command I understand.' };
      const app = t.when.app ? NLU.appByKey(t.when.app) : null;
      const when = Triggers.describeWhen(t.when, app && app.n);
      const doText = existing ? 'run **' + existing.name + '**' : 'do: ' + steps.join(' → ');
      return { text: 'When ' + when + ', I will ' + doText + '. Only steps that need no permission run on their own. Create this trigger?', intent: 'TRIGGER_CREATE',
        confirm: { yes: 'CREATE TRIGGER', no: 'CANCEL', onConfirm: () => {
          const r = existing || Routines.create(cap(t.action).slice(0, 40), steps);
          if (!r) return jarvisSay({ text: 'Couldn’t save that routine.', intent: 'TRIGGER_CREATE' });
          triggers.push({ id: rid(), routineId: r.id, routineName: r.name, when: t.when, label: cap(when), cooldownMin: 10, enabled: true }); saveTriggers();
          jarvisSay({ text: '✓ Trigger saved: when ' + when + ' → **' + r.name + '**. It works while JARVIS is running; if no tab is open you get a notification to open it.', intent: 'TRIGGER_CREATE', suggestions: ['List my triggers'] });
        } } };
    }
    case 'TRIGGER_LIST': {
      if (!triggers.length) return { text: 'No triggers yet. Try "when I plug in my charger, start study mode".' };
      return { text: '**Your triggers**\n' + triggers.map((t, i) => (i + 1) + '. ' + t.label + ' → **' + t.routineName + '**' + (t.enabled === false ? ' _(off)_' : '')).join('\n'), tool: 'triggers' };
    }
    case 'TRIGGER_DELETE': {
      const low = p.original.toLowerCase();
      if (!triggers.length) return { text: 'You have no triggers.' };
      if (/\ball\b|\bevery\b/.test(low)) return { text: 'Delete all ' + plural(triggers.length, 'trigger') + '?', confirm: { yes: 'DELETE ALL', no: 'KEEP', onConfirm: () => { const n = triggers.length; triggers = []; saveTriggers(); jarvisSay({ text: 'Deleted ' + plural(n, 'trigger') + '.', intent: 'TRIGGER_DELETE' }); } } };
      const num = low.match(/\b(\d{1,2})\b/);
      let hits = num ? [triggers[+num[1] - 1]].filter(Boolean) : triggers.filter(t => (t.label + ' ' + t.routineName).toLowerCase().split(/\W+/).some(w => w.length > 3 && low.includes(w)));
      if (hits.length !== 1) return { text: (hits.length ? 'Which one? ' : 'Which trigger should I delete? ') + '\n' + triggers.map((t, i) => (i + 1) + '. ' + t.label + ' → ' + t.routineName).join('\n') + '\nSay "delete trigger 2".' };
      undoRemoved('deleted trigger', () => triggers, v => { triggers = v; }, saveTriggers, removedFrom(triggers, t => t !== hits[0]));
      triggers = triggers.filter(t => t !== hits[0]); saveTriggers();
      return { text: 'Deleted the trigger: ' + hits[0].label + ' → ' + hits[0].routineName + '.', tool: 'triggers' };
    }
    case 'STUDY_PLAN': {
      const raw = p.original;
      const low = raw.toLowerCase();
      const head = low.split(/topics?\b|:/)[0];
      const when = NLU.parseDate(head.replace(/\bexam\b|\btest\b/g, ' '));
      const tm = raw.match(/topics?\s*(?:are|is|:|-)?\s*(.+)$/i) || raw.match(/:\s*(.+)$/);
      const topics = Study.parseTopics(tm ? tm[1] : '');
      const nm = (raw.match(/\b(?:for|my)\s+(?:the\s+|my\s+)?([A-Za-z][\w+#. -]{1,30}?)\s+(?:exam|test|prep|preparation|revision)\b/i) || raw.match(/\bplan\s+(?:my\s+|the\s+)?([A-Za-z][\w+#. -]{1,30}?)\s+(?:prep|preparation|exam|revision)\b/i) || [])[1];
      const name = cap((nm || 'Exam').replace(/^(a|an|the|my)\s+/i, '').trim());
      const eg = 'e.g. "plan my GATE prep, exam on 12 Feb, topics: OS, DBMS, CN" (add ":3" after a topic that needs 3× the time)';
      if (!when) return { text: 'When is the exam? Tell me the date and your topics — ' + eg + '.' };
      if (!topics.length) return { text: 'Which topics should I plan for? ' + eg + '.' };
      const plan = Study.buildStudyPlan({ topics, examDate: when });
      if (!plan.days.length) return { text: cap(plan.warnings[0] || 'I couldn’t build a plan from that') + '. ' + eg + '.' };
      toolStep('studyPlan → ' + name + ' · ' + plan.days.length + ' days');
      const rec = { id: rid(), name, examDate: Study.ymd(when), days: plan.days.map(d => ({ ...d, done: false })) };
      studyPlans = studyPlans.filter(x => x.name.toLowerCase() !== name.toLowerCase()); studyPlans.push(rec); saveStudyPlans();
      const dl = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const shown = plan.days.slice(0, 10).map(d => '- **' + dl(d.date) + '** — ' + d.topic).join('\n');
      const more = plan.days.length > 10 ? '\n- …and ' + (plan.days.length - 10) + ' more days (see **Tasks → Progress**)' : '';
      const future = plan.days.filter(d => new Date(d.date + 'T08:00:00').getTime() > Date.now() + 6e4);
      return { text: '**Study plan — ' + name + '** · exam ' + dl(rec.examDate) + ' · ' + plural(plan.days.length, 'day') + ' to prepare\n' + shown + more + (plan.warnings.length ? '\n\n⚠ ' + plan.warnings.join(' ') : '') + '\n\nSaved. Want a reminder each morning at 8?',
        speak: 'I planned ' + plural(plan.days.length, 'day') + ' of study for ' + name + '.', tool: 'studyPlan', intent: 'STUDY_PLAN',
        suggestions: ['Make flashcards on ' + topics[0].name, 'What should I study today?'],
        actions: future.length ? [{ label: 'ADD ' + Math.min(future.length, 90) + ' REMINDERS', fn: () => {
          let n = 0; for (const d of future.slice(0, 90)) { reminders.push({ id: rid(), text: '📚 Study: ' + d.topic + ' (' + name + ')', at: new Date(d.date + 'T08:00:00').getTime(), fired: false }); n++; }
          saveTasks(); askNotify();
          jarvisSay({ text: '✓ Added ' + plural(n, 'reminder') + ' — one each morning at 8. They reach your phone too if Phone alerts are on.', intent: 'STUDY_PLAN' });
        } }] : undefined };
    }
    case 'STUDY_TODAY': {
      const plan = studyPlans.filter(x => x.examDate >= Study.ymd(new Date())).sort((x, y) => x.examDate < y.examDate ? -1 : 1)[0];
      if (!plan) return executeTool({ ...p, intent: 'PLAN_DAY' }, raw);
      const t = Study.ymd(new Date()), day = plan.days.find(d => d.date === t);
      const done = plan.days.filter(d => d.done).length, dleft = Study.daysBetween(new Date(), new Date(plan.examDate + 'T00:00:00'));
      const next = plan.days.find(d => d.date > t);
      return { text: '**' + plan.name + '** — exam in ' + plural(dleft, 'day') + ' · ' + done + '/' + plan.days.length + ' days done\n' + (day ? '- **Today:** ' + day.topic + (day.done ? ' ✓' : '') : '- Nothing planned for today.') + (next ? '\n- **Next:** ' + next.topic : ''),
        speak: day ? 'Today: ' + day.topic + '. Your exam is in ' + plural(dleft, 'day') + '.' : 'Nothing is planned for today.', tool: 'studyToday', intent: 'STUDY_TODAY',
        suggestions: day && !day.done ? ['Start a focus session on ' + day.topic.replace(/ \(\d+\/\d+\)$/, '').split(/[:+,]/)[0].trim()] : undefined,
        actions: day && !day.done ? [{ label: 'MARK TODAY DONE', fn: () => { day.done = true; saveStudyPlans(); sfx.ok(); jarvisSay({ text: '✓ Marked today done. ' + (done + 1) + '/' + plan.days.length + ' days complete.', intent: 'STUDY_TODAY' }); } }] : undefined };
    }
    case 'WEEK_REPORT': {
      const w = Study.weekSummary(stats, sessions, todayKey());
      if (!w.any) return { text: 'Nothing logged in the last 7 days yet. Start a focus session or tick off a to-do, and I’ll track it here.', suggestions: ['Start a focus session'] };
      return { text: '**Your week**\n' + w.lines.map(l => '- ' + l).join('\n') + '\n\nThe chart is under **Tasks → Progress**.', card: [['STREAK', w.totals.streak + ' days'], ['FOCUS', Study.fmtMin(w.totals.focusMin)]], tool: 'weekReport', intent: 'WEEK_REPORT',
        speak: 'This week you focused for ' + Study.fmtMin(w.totals.focusMin) + ' and finished ' + plural(w.totals.todos, 'task') + '. Your streak is ' + plural(w.totals.streak, 'day') + '.' };
    }
    case 'PRODUCTIVITY_REPORT': {
      const st = stats[todayKey()] || {};
      const pend = todos.filter(t => !t.done).length;
      const due = deadlines.filter(d => !d.done && d.due > Date.now() && d.due - Date.now() < 3 * 864e5);
      const fm = st.focusMin || 0;
      const score = Math.min(100, Math.round(fm * 0.8 + (st.todosDone || 0) * 8 + (st.deadlinesDone || 0) * 15 + (st.codeRuns || 0) * 2 + (st.filesSaved || 0) * 2));
      const verdict = score >= 70 ? 'Excellent day. 🔥' : score >= 35 ? 'Solid progress.' : score > 0 ? 'A start — one focus session would make a big difference.' : 'Nothing logged yet today. Want to start a focus session?';
      return {
        text: '**Today so far** — ' + verdict + '\n- Focused for **' + (fm >= 60 ? Math.floor(fm / 60) + 'h ' + fm % 60 + 'm' : fm + ' min') + '** (' + plural(st.focusSessions || 0, 'session') + ')\n- Completed **' + plural(st.todosDone || 0, 'to-do') + '** and **' + plural(st.deadlinesDone || 0, 'deadline') + '**\n- Asked the AI **' + plural(st.aiQuestions || 0, 'question') + '**, saved **' + plural(st.filesSaved || 0, 'file') + '**, ran code **' + plural(st.codeRuns || 0, 'time') + '**\n' + (pend ? '- Still on your list: ' + pend + '\n' : '') + (due.length ? '- ⚠ Due soon: ' + due.map(d => d.title + ' (' + dueLabel(d.due) + ')').join(', ') : ''),
        card: [['SCORE', score + ' / 100']], suggestions: score < 35 ? ['Block distractions', 'Start a focus session'] : null, tool: 'report',
        speak: verdict.replace('🔥', '') + ' You focused for ' + fm + ' minutes and finished ' + plural(st.todosDone || 0, 'task') + '.'
      };
    }
    case 'UNIT_CONVERT': {
      const r = NLU.convertUnits(s);
      if (!r) return { askLLM: true };
      if (r.error) return { text: r.error };
      toolStep('convert');
      const U = { c: '°C', '°c': '°C', celsius: '°C', 'degrees celsius': '°C', centigrade: '°C', f: '°F', '°f': '°F', fahrenheit: '°F', 'degrees fahrenheit': '°F', k: 'K', kelvin: 'K' };
      const from = U[r.from] || r.from, to = U[r.to] || r.to;
      return { text: '**' + r.value + ' ' + from + ' = ' + r.result.toLocaleString() + ' ' + to + '**', speak: r.value + ' ' + r.from + ' is ' + r.result + ' ' + r.to, tool: 'convert' };
    }
    case 'CREATE_FOLDER': {
      // Where: "in that directory" / "there" (the folder in focus), "in D drive", "on my desktop", "in C:\x\y",
      // "inside calculator" (a folder by name). What: "called X" / "named X" / "folder X".
      const sc = a.base ? { scope: a.base, rest: p.original } : scopeFrom(p.original, true);
      if (a.base && /^(?:it|that|there|that folder|that directory)$/i.test(a.base)) { const f = focusOf('folder') || focusOf('created'); sc.scope = ''; sc.path = f ? f.path : ''; sc.ref = true; }
      if (sc.ref && !sc.path) return { text: 'Which folder do you mean, ' + Persona.sir() + '? Say a place like **D drive**, **desktop** or a full path — or open the folder first and say "create a folder there".' };
      const where = sc.path || sc.scope || '';
      const orig = sc.rest || p.original;
      const m = orig.match(/(?:called|named|titled)\s+["']?([\w\- .()]+?)["']?\s*$/i) || orig.match(/(?:folder|directory|dir)\s+["']?([\w\- .()]+?)["']?\s*$/i);
      let name = (a.name && !sc.scope && !sc.path ? a.name : '') || (m ? m[1].trim() : '') || (a.base ? a.name : '');
      if (/^(?:in|on|inside|there|here|it|that|this|for|please)$/i.test(name)) name = '';
      if (!name) { ctx.pending = { intent: 'CREATE_FOLDER', base: where }; return { text: 'What should I name the folder' + (where ? ' in **' + where + '**' : '') + '?', speak: 'What should I name the folder?' }; }
      toolStep('createFolder → ' + (where ? where + ' → ' : '') + name);
      const r = await callTool('/tool/createFolder', where ? { name, where } : { name });
      if (r.error) return { text: 'Could not create it: ' + r.error + (r.choices ? '\n' + r.choices.map(x => '- `' + x + '`').join('\n') : '') };
      if (r.path) { setFocus('created', r.path); if (where) setFocus('folder', r.path.replace(/[\\/][^\\/]+$/, '')); }
      if (!r.existed) Undo.push('created folder ' + name, async () => { const x = await callTool('/tool/undoCreate', { name: r.path || r.name }); if (x.error) throw new Error(x.error); return 'Removed the folder `' + name + '` (it’s in the trash).'; });
      const shown = where ? '`' + (r.path || r.name) + '`' : '`~/jarvis/' + r.name + '`';
      return { text: r.existed ? 'The folder ' + shown + ' already exists.' : 'Created folder **' + name + '** → ' + shown + '.', speak: r.existed ? 'That folder already exists.' : 'Created the folder ' + name + '.',
        suggestions: ['Open it'], tool: 'createFolder', op: where ? null : { kind: 'file', name: r.name, existed: !!r.existed } };
    }
    case 'COUNT_FOLDERS': {
      // "list number of folders in my laptop" / "how many folders are in D drive" / "count directories there"
      const sc = a.scope ? { scope: a.scope } : scopeFrom(p.original);
      if (sc.ref && !sc.path) return { text: 'Which folder should I count, ' + Persona.sir() + '? Say **my laptop**, **D drive**, **desktop** or a full path.' };
      const scope = sc.path || sc.scope || 'laptop';
      toolStep('folderStats → ' + scope);
      const shown = r => {
        if (r.error) return { text: cap(r.error) + '.' };
        if (r.indexing) return { text: 'I’m still building the list of everything on this laptop (it takes a few seconds after I start). Ask me again in a moment, ' + Persona.sir() + '.' };
        const n = x => x.toLocaleString();
        const note = '\n\n_Not counting hidden, system and build folders (Windows, Program Files, AppData, node_modules, .git…)._';
        if (!r.path) {
          const drives = Object.entries(r.perDrive || {}).sort().map(([d, c]) => '- **' + d + '** — ' + n(c.folders) + ' folders, ' + n(c.files) + ' files').join('\n');
          return { text: 'This laptop has **' + n(r.folders) + ' folders** and **' + n(r.files) + ' files**.\n' + drives + note, speak: 'This laptop has ' + r.folders + ' folders and ' + r.files + ' files.', tool: 'folderStats' };
        }
        setFocus('folder', r.path);
        const d = r.direct || { folders: [], folderCount: 0, files: 0 };
        if (d.folders.length) setResults(d.folders.map(x => joinPath(r.path, x)));
        const list = d.folders.length ? '\n\nFolders directly inside:\n' + d.folders.slice(0, 15).map((x, i) => (i + 1) + '. 📁 ' + x).join('\n') + (d.folderCount > 15 ? '\n…and ' + (d.folderCount - 15) + ' more' : '') : '';
        return { text: '**' + r.path + '** has **' + n(r.folders) + ' folders** and **' + n(r.files) + ' files** in total (' + d.folderCount + ' folders and ' + d.files + ' files directly inside).' + (r.partial ? ' _(It’s a big folder — I stopped counting after a few seconds, so the real total is higher.)_' : '') + list + note,
          speak: r.path + ' has ' + r.folders + ' folders and ' + r.files + ' files.', suggestions: ['Create a folder there', 'Open it'], tool: 'folderStats' };
      };
      const r = await callTool('/tool/folderStats', { scope });
      if (r.error && scope && !/[\\/:]/.test(scope) && /can.t find|not found/i.test(r.error)) {
        const sims = await similarTo(scope, 'folder');
        if (sims.length) return didYouMeanReply(scope, sims, 'I can’t find a folder called **' + scope + '**.', 'count');
      }
      return pickPlace(r, scope, async x => shown(await callTool('/tool/folderStats', { scope: x }))) || shown(r);
    }
    case 'RENAME_FILE': {
      const m = p.original.match(/rename\s+(?:the\s+)?(?:file\s+|folder\s+)?["']?(.+?)["']?\s+(?:to|as)\s+["']?(.+?)["']?$/i);
      if (!m) return { text: 'Say it like: "rename notes.md to dsa-notes.md".' };
      toolStep('renameFile');
      const r = await callTool('/tool/renameFile', { oldName: m[1], newName: m[2] });
      if (!r.error) Undo.push('renamed ' + r.from, async () => { const x = await callTool('/tool/undoMove', { from: r.from, to: r.to }); if (x.error) throw new Error(x.error); return 'Renamed it back to `' + x.name + '`.'; });
      return r.error ? { text: 'Rename failed: ' + r.error } : { text: 'Renamed `' + r.from + '` → `' + r.to + '`.', tool: 'renameFile' };
    }
    case 'COPY_FILE':
    case 'MOVE_FILE': {
      const verb = p.intent === 'COPY_FILE' ? 'copy' : 'move';
      const m = p.original.match(/(?:copy|duplicate|move)\s+(?:the\s+)?(?:file\s+)?["']?(.+?)["']?\s+(?:to|into)\s+(?:the\s+|my\s+)?["']?(.+?)["']?(?:\s+folder)?$/i);
      if (!m) return { text: 'Say it like: "' + verb + ' notes.md to Projects".' };
      toolStep(verb + 'File');
      const r = await callTool('/tool/' + verb + 'File', { src: m[1], dest: m[2] });
      if (!r.error) Undo.push((verb === 'copy' ? 'copied ' : 'moved ') + r.from, async () => {
        const x = verb === 'copy' ? await callTool('/tool/undoCreate', { name: r.to }) : await callTool('/tool/undoMove', { from: r.from, to: r.to });
        if (x.error) throw new Error(x.error);
        return verb === 'copy' ? 'Removed the copy `' + r.to + '` (it’s in the trash).' : 'Moved it back to `' + x.name + '`.';
      });
      return r.error ? { text: cap(verb) + ' failed: ' + r.error } : { text: (verb === 'copy' ? 'Copied' : 'Moved') + ' `' + r.from + '` → `' + r.to + '`.', tool: verb + 'File' };
    }
    case 'ASK_FILES': {
      const q = (a.query || p.original || s).trim();
      setState('PROCESSING', 'Searching your files…'); toolStep('ragSearch → ' + q.slice(0, 60));
      // the file being asked about: a quoted name ("10. Numpy.pdf") or a name without spaces (numpy-notes.pdf)
      const fileM = q.match(/["“']([^"”']+?\.(?:pdf|md|txt|markdown|csv|py|js|c|cpp|java))["”']/i) || q.match(/(?:^|[\s(])([\w().-]+\.(?:pdf|md|txt|markdown|csv|py|js|c|cpp|java))\b/i);
      const oneFile = fileM ? fileM[1].trim() : '';
      const r = await callTool('/rag/search', { query: q, k: 5, file: oneFile || undefined });
      if (r.error) return { text: cap(r.error) + '.' };
      if (!r.results.length && oneFile) return { text: 'I couldn’t find **' + oneFile + '** in ~/jarvis or your project folders. Drop it into JARVIS (or 📎) and ask again.', tool: 'ragSearch' };
      if (!r.results.length) return { text: 'I couldn’t find anything about that in your files (I searched ' + plural(r.files, 'file') + ' in ~/jarvis and your project folders). Try different words, or add the folder in Settings → Project folders.', tool: 'ragSearch' };
      ctx.lastFile = r.results[0].file; // so "open it in VS Code" follows up
      const where = x => x.page ? 'page ' + x.page : 'lines ' + x.start + '–' + x.end;
      const ref = r.results.map((x, i) => (i + 1) + '. ' + x.file + ' (' + where(x) + ')');
      const sources = '\n\n**Sources**\n' + ref.join('\n');
      if (!llmReady()) return { text: 'The best matches in your files for **' + q.slice(0, 80) + '**:\n\n' + r.results.map((x, i) => '**' + ref[i] + '**\n```\n' + x.text.slice(0, 500) + '\n```').join('\n\n'), tool: 'ragSearch' };
      const snippets = r.results.map((x, i) => '[' + (i + 1) + '] ' + x.file + ' (' + where(x) + ')\n' + x.text).join('\n\n---\n\n');
      const cloudNote = isCloudModel(llm.model) ? '\n\n⚠ These snippets from your files were sent to ' + modelInfo(llm.model).providerLabel + ' to write this answer.' : '';
      return { askLLM: 'Question: ' + q + '\n\nAnswer using ONLY these excerpts from the user’s own files. List EVERY relevant item the excerpts contain, with its specific detail (e.g. each method with what it does, each definition, each step) — if several excerpts are relevant, use all of them; never answer with just one item or a vague one-line summary. Cite them inline like [1] or [2]. If they do not contain the answer, say so plainly. Use short bullet points.' + (Lang.aiInEnglish() ? '' : { te: ' Write the answer in Telugu (keep technical terms, names and numbers in English).', kn: ' Write the answer in Kannada (keep technical terms, names and numbers in English).' }[Lang.replyLang()] || '') + '\n\n' + snippets,
        noHistory: true,
        after: { sources: sources + cloudNote, suggestions: /.pdf$/i.test(r.results[0].file) ? ['Open ' + r.results[0].file.split('/').pop(), 'Make flashcards from ' + r.results[0].file.split('/').pop()] : ['Open it in VS Code'] } };
    }
    case 'SEARCH_FILES': {
      // "where is pythonProject" (no "file"/"folder" word): might not be a file at all ("where is delhi").
      const implicit = !/\b(files?|folders?|documents?|notes?|directory)\b/.test(s);
      const q = s.replace(/\s+(?:on|in) (?:my |the |this )?(?:laptop|computer|pc|system|drives?)$/, '')
        .replace(/\b(find|search( for)?|locate|where is|where's|the|my|file|files|folder|document|note|named|called|in|sandbox)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (!q) return { text: 'What file name should I look for?' };
      toolStep('searchFiles → ' + q);
      const r = await callTool('/tool/searchFiles', { query: q });
      if (r.error) return { text: r.error };
      if (!r.results.length && implicit && llmReady()) return { askLLM: raw };
      if (!r.results.length) return { text: 'Nothing named "' + q + '" anywhere on this laptop.' };
      setResults(r.paths || []);
      if (r.paths && r.paths.length === 1) setFocus(/[\\/]$/.test(r.results[0]) ? 'folder' : 'file', r.paths[0]);
      return { text: 'Found ' + r.results.length + (r.results.length === 1 ? ' match' : ' matches') + ':\n' + r.results.slice(0, 10).map((x, i) => (i + 1) + '. `' + x + '`').join('\n') + (r.results.length > 1 ? '\n\n_Say "open the first one" or "open number 2"._' : ''), speak: 'I found ' + r.results.length + ' matches.', tool: 'searchFiles' };
    }
    case 'LIST_FILES': {
      // "list folders in D drive" / "show folders on my desktop" / "list files there" / "list folders in my laptop"
      const sc = a.dir ? { scope: a.dir } : scopeFrom(p.original);
      if (sc.ref && !sc.path) return { text: 'Which folder should I list, ' + Persona.sir() + '? Say **D drive**, **desktop** or a full path.' };
      const dir = sc.path || (sc.scope && !/^(?:sandbox|jarvis|jarvis sandbox)$/i.test(sc.scope) ? sc.scope : '');
      toolStep('listFiles' + (dir ? ' → ' + dir : ''));
      const onlyFolders = /\b(folders?|director(?:y|ies)|dirs?)\b/.test(s) && !/\bfiles?\b/.test(s);
      const shown = r => {
        if (r.error) return { text: cap(r.error) + '.' };
        if (r.path) setFocus('folder', r.path);
        const files = onlyFolders ? [] : r.files;
        const base = r.path || backend.sandbox;
        setResults(r.folders.map(f => r.laptop ? f : joinPath(base, f)).concat(files.map(f => joinPath(base, f))));
        const lines = r.folders.map((f, i) => (i + 1) + '. 📁 ' + f).concat(files.map((f, i) => (r.folders.length + i + 1) + '. 📄 ' + f));
        const head = '**' + (r.laptop ? 'This laptop' : r.path || (r.dir === '~/jarvis' ? backend.sandbox : r.dir)) + '** — ' + plural(r.folders.length, 'folder') + (onlyFolders ? '' : ', ' + plural(r.files.length, 'file'));
        return { text: head + '\n' + (lines.slice(0, 60).join('\n') || '_(empty)_') + (lines.length > 60 ? '\n…and ' + (lines.length - 60) + ' more' : '')
          + (r.projects && r.projects.length ? '\n\n**Project folders:** ' + r.projects.map(x => '`' + x + '`').join(', ') + ' — say "list files in ' + r.projects[0] + '"' : '')
          + (lines.length ? '\n\n_Say "open the 2nd one", "how many folders are there" or "create a folder there"._' : ''),
          speak: plural(r.folders.length, 'folder') + (onlyFolders ? '' : ' and ' + plural(r.files.length, 'file')) + '.', tool: 'listFiles' };
      };
      const r = await callTool('/tool/listFiles', { dir });
      if (r.error && dir && !/[\\/:]/.test(dir) && /can.t find|not found/i.test(r.error)) {   // "list files in calculater" → Did you mean…?
        const sims = await similarTo(dir, 'folder');
        if (sims.length) return didYouMeanReply(dir, sims, 'I can’t find a folder called **' + dir + '**.', 'list');
      }
      return pickPlace(r, dir, async x => shown(await callTool('/tool/listFiles', { dir: x }))) || shown(r);
    }
    case 'READ_FILE': {
      const m = s.match(/(?:read|open|show|display|what'?s in)(?: me)?(?: the| my)?\s+(.+?)(?:\s+(?:file|note|notes|document))?$/);
      let name = a.name || (m ? m[1].trim() : '');
      // "the calculator.html (that you just created)": just the file name, without the extra words
      const fn = !a.name && name.match(/(?:^|[\s"'(])([\w\-. ]*?[\w\-]+\.[a-z0-9]{1,5})(?=$|[\s"'),.!?])/i);
      if (fn) name = fn[1].trim();
      if (/^(it|that|this)$/.test(name) || !name) name = ctx.lastFile || 'notes';
      if (/^(notes?|my notes)$/.test(name)) name = 'notes.md';
      // "open lecture3.pdf" / "open calculator.html" opens the file itself (PDF viewer, browser, Office…); "read …" shows its text
      if (/\.(pdf|html?|docx?|pptx?|xlsx?|png|jpe?g|gif)$/i.test(name) && /^(?:open|show|launch|run|load)\b/.test(s)) {
        toolStep('openFile → ' + name);
        const opened = o => {
          if (o.error) return { text: cap(o.error) + '.', suggestions: ['List my files'] };
          ctx.lastFile = o.name; if (o.path) setFocus('file', o.path);
          return { text: 'Opening **' + o.name + '**.', suggestions: !/\.pdf$/i.test(o.name) ? null : ['Summarise ' + o.name.split(/[\\/]/).pop(), 'Make flashcards from ' + o.name.split(/[\\/]/).pop()], tool: 'openFile' };
        };
        const o = await callTool('/tool/openFile', { name });
        return pickPlace(o, name, async x => opened(await callTool('/tool/openFile', { name: x }))) || opened(o);
      }
      toolStep('readFile → ' + name);
      const shown = r => {
        if (r.error) return { text: /not found|can.t find|couldn.t find/i.test(r.error) ? 'I could not find "' + name + '" in ~/jarvis, your project folders or the usual places on this laptop.' : cap(r.error) + '.', suggestions: ['List my files'] };
        ctx.lastFile = r.name; if (r.path) setFocus('file', r.path);
        const ext = (r.name.split('.').pop() || '').toLowerCase();
        const body = ext === 'md' ? r.content : '```' + ext + '\n' + r.content + '\n```';
        return { op: { kind: 'file', name: r.name }, text: '**' + r.name + '**\n\n' + (r.content.trim() ? body.slice(0, 6000) : '_(empty file)_'), speak: 'Here is ' + r.name.split(/[\\/]/).pop() + '.', suggestions: llmReady() && r.content.length > 200 ? ['Summarise that file'] : null, tool: 'readFile' };
      };
      const r = await callTool('/tool/readFile', { name });
      return pickPlace(r, name, async x => shown(await callTool('/tool/readFile', { name: x }))) || shown(r);
    }
    case 'OPEN_FOLDER': {
      // "… in desktop" / "on my desktop": the place, not part of the folder name.
      const OLOC = /\s+(?:in|on|inside|at)\s+(?:the\s+|my\s+)?(desktop|documents|downloads|pictures|music|videos)(?:\s+folder)?\s*$/i;
      const clean = p.original.replace(OLOC, '');
      const m = clean.match(/open\s+(?:up\s+)?(?:my\s+|the\s+)?(.+?)\s*(?:folder|directory)?$/i) || s.match(/open\s+(?:up\s+)?(?:my\s+|the\s+)?(.+?)\s*(?:folder|directory)?$/);
      const raw = (a.name || (m ? m[1].trim() : '')).replace(/\s+(?:in|on|inside|at)\s+(?:the\s+|my\s+)?(desktop|documents|downloads|pictures|music|videos)(?:\s+folder)?\s*$/i, '').trim();
      const stripped = raw.replace(/\b(folder|directory)\b/g, '').trim();
      // try the full phrase first ("test folder"), then without the kind word ("test")
      const candidates = [...new Set([raw, stripped].filter(Boolean))];
      let name = candidates[0] || '';
      if (/^(sandbox|jarvis|jarvis sandbox|files)$/i.test(name)) name = '';
      if (/^(sandbox|jarvis|jarvis sandbox|files)$/i.test(stripped)) name = '';
      toolStep('openFolder → ' + (name || '~/jarvis'));
      const shown = r => { if (!r.error && r.path) setFocus('folder', r.path); return r.error ? { text: cap(r.error) + '.', suggestions: name ? ['Create a folder called ' + name] : ['Create a folder called Projects'] } : { text: 'Opening `' + (r.path || r.name) + '` in your file explorer.', tool: 'openFolder' }; };
      let r = await callTool('/tool/openFolder', { name });
      if (r.error && candidates.length > 1) {
        const r2 = await callTool('/tool/openFolder', { name: candidates[1] });
        if (!r2.error) return pickPlace(r2, candidates[1], async x => shown(await callTool('/tool/openFolder', { name: x }))) || shown(r2);
      }
      if (r.error && name && /can.t find|not found/i.test(r.error)) {   // "open the calculater folder" → Did you mean calculator?
        const sims = await similarTo(stripped || name, 'folder');
        if (sims.length) return didYouMeanReply(name, sims, 'I can’t find a folder called **' + name + '**.', 'open');
      }
      return pickPlace(r, name, async x => shown(await callTool('/tool/openFolder', { name: x }))) || shown(r);
    }

    /* ---- briefing ---- */
    case 'BRIEFING': {
      toolStep('dailyBriefing');
      const d = new Date(), nm = memGet('name');
      const parts = [Persona.greeting(d.getHours()).replace(/[.?!]$/, '') + '. It is **' + fmtTime(d) + '** on ' + d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + '. Here is where things stand:'];
      if (settings.online) { const w = await fetchWeather(''); if (!w.error) parts.push('**Weather** — ' + w.tempC + '°C, ' + w.desc.toLowerCase() + ' in ' + w.place + '.' + (w.rainChance >= 50 ? ' Take an umbrella.' : '')); }
      const today = classes.filter(c => c.day === d.getDay()).map(c => ({ c, at: new Date(new Date().setHours(c.h, c.m, 0, 0)) })).filter(x => x.at > d).sort((x, y) => x.at - y.at);
      if (classes.length) parts.push('**Classes** — ' + (today.length ? today.map(x => x.c.name + ' at ' + fmtTime(x.at)).join(', ') : 'none left today') + '.');
      const due = deadlines.filter(x => !x.done && x.due > Date.now() && x.due - Date.now() < 7 * 864e5).sort((x, y) => x.due - y.due);
      if (due.length) parts.push('**Due soon** — ' + due.map(x => x.title + ' (' + dueLabel(x.due) + ')').join(', ') + '.');
      const pend = todos.filter(t => !t.done);
      parts.push(pend.length ? '**To-do** — ' + plural(pend.length, 'item') + '; first up: "' + pend[0].text + '".' : '**To-do** — list is clear.');
      const rs = reminders.filter(r => !r.fired && !r.timerId && r.at - Date.now() < 864e5);
      if (rs.length) parts.push('**Reminders** — ' + rs.map(r => r.text + ' at ' + fmtTime(r.at)).join(', ') + '.');
      await refreshSystem();
      parts.push('**System** — CPU ' + sys.cpu + '%, RAM ' + sys.ram + '%, ' + sys.diskFree + ' GB free.');
      return { text: parts.join('\n'), tool: 'dailyBriefing' };
    }

    /* ---- rolling conversation memory ---- */
    case 'CHAT_MEMORY': return chatMemoryReply();

    default: return ToolHandlers.NONE;
  }
});
