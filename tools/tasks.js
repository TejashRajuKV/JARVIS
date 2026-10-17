'use strict';
/* executeTool, tasks: timers, focus sessions, to-dos, reminders, deadlines, timetable, plans and routines.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('tasks', async function (p, raw, s, a) {
  switch (p.intent) {
    /* ---- timers & focus ---- */
    case 'SET_TIMER': {
      let sec = +a.seconds;
      if (!sec) {
        const m = s.match(/(\d+(?:\.\d+)?)\s*(seconds?|s|minutes?|m|hours?|h)\b/g);
        if (m) sec = m.reduce((acc, part) => { const [, n, u] = part.match(/(\d+(?:\.\d+)?)\s*(\w)/); return acc + +n * (u === 'h' ? 3600 : u === 'm' ? 60 : 1); }, 0);
      }
      if (!sec) { ctx.pending = { intent: 'SET_TIMER' }; return { text: 'For how long?', suggestions: ['5 minutes', '10 minutes', '25 minutes'] }; }
      const label = a.label || (sec >= 3600 ? +(sec / 3600).toFixed(2) + ' h' : sec >= 60 ? +(sec / 60).toFixed(1) + ' min' : sec + ' s');
      const tmr = addTimer(label, sec * 1000); toolStep('setTimer → ' + label);
      return { text: 'Timer set for **' + label + '**.', tool: 'setTimer', op: { kind: 'timer', id: tmr.id } };
    }
    case 'CANCEL_TIMERS': {
      const n = timers.length; [...timers].forEach(cancelTimer);
      return { text: n ? 'Cancelled ' + plural(n, 'timer') + '.' : 'No timers are running.' };
    }
    case 'FOCUS_START': {
      const m = s.match(/(\d+)[\s-]*(minute|min|m)\b/);
      const want = +a.minutes || (m ? +m[1] : 0);
      // A session is already running: never restart it silently. Inside a plan/routine, keep it when the length
      // matches (or none was asked for) and replace it only for a different requested length; typed directly, ask.
      if (focus && focus.phase === 'focus' && !a.restart) {
        const left = Math.max(1, Math.round((focus.end - Date.now()) / 6e4)), running = focus.min;
        if (p.viaAgent && (!want || want === running)) return { text: 'A ' + running + '-minute session is already running — kept it.', op: { kind: 'focus_kept', min: running, left }, tool: 'focus' };
        if (!p.viaAgent) return { text: 'A **' + running + '-minute** focus session is already running (' + left + ' min left). Start a new ' + (want || settings.focusMin || 25) + '-minute one instead?',
          confirm: { yes: 'RESTART', no: 'KEEP IT', onConfirm: async () => deliver(await executeTool(Object.assign({}, p, { args: Object.assign({}, a, { restart: true }) }), raw), { intent: 'FOCUS_START', confidence: 1 }) } };
      }
      const min = startFocus(want);
      Undo.push('started a ' + min + '-minute focus session', () => stopFocus(true) ? 'Focus session stopped.' : 'That focus session had already ended.');
      // "focus on DBMS for 25 minutes" → the session is logged under DBMS (shown per subject in Progress)
      const sm = p.original.match(/\b(?:on|for)\s+(?!\d|a\b|an\b|the\b|my\b|me\b)([A-Za-z][\w+#. -]{1,28}?)(?=\s+(?:for|session|timer|mode|\d)|[.,!?]?$)/i);
      const subject = sm ? sm[1].trim().replace(/\s+/g, ' ') : '';
      if (subject && focus) { focus.subject = subject; saveFocus(); }
      toolStep('focus → ' + min + 'm' + (subject ? ' · ' + subject : ''));
      const top = todos.find(t => !t.done);
      return { text: 'Focus session started: **' + min + ' minutes**' + (subject ? ' on **' + subject + '**' : '') + '. I will call a break after that. Phone away, notifications off.' + (top ? ' Suggested task: "' + top.text + '".' : ''), speak: 'Focus session started for ' + min + ' minutes. Good luck.', tool: 'focus' };
    }
    case 'FOCUS_STOP': return stopFocus() ? { text: 'Focus session stopped.' } : { text: 'No focus session is running.' };

    /* ---- to-dos ---- */
    case 'ADD_TODO': {
      let text = a.text;
      for (const src of [p.original, p.text]) {
        if (text || !src) break;
        const m = src.match(/^(.+?)\s+and\s+add\s+(?:it|that|this)\s+(?:to|on|in|into)\b/i)
          || src.match(/^(?:.*?\b)?(?:add|put|note down|jot down|write down|include)\s+(.+?)\s+(?:to|on|in|into)\s+(?:my\s+|the\s+)?(?:(?:to-?do|todo|task|shopping)\s*(?:list\b)?|list\b)/i)
          || src.match(/(?:add|new|create)(?: a)? (?:task|to-?do|todo|item):?\s+(.+)$/i) || src.match(/^(?:to-?do|todo|task):?\s+(.+)$/i);
        text = m ? m[1] : '';
        // Translations sometimes scramble the order: "Add completing my to-do list assignment".
        if (!text && /^(?:add|include)\b.*\bto-?do list\b/i.test(src)) text = src.replace(/^(?:add|include)\s+/i, '').replace(/\b(?:to |in |into |on )?(?:my |the )?to-?do list\b/i, '').replace(/\s+/g, ' ').trim();
      }
      text = addTodoText(text);
      if (!text) return { text: 'What should I add to your list?' };
      toolStep('addTodo');
      // op: the exact item created, so the agent can verify this operation (not just a count).
      return { text: 'Added "**' + text + '**" to your to-do list. You have ' + plural(todos.filter(t => !t.done).length, 'item') + ' pending.', tool: 'todo', op: { kind: 'todo', id: todos[todos.length - 1].id } };
    }
    case 'LIST_TODOS': {
      const pend = todos.filter(t => !t.done);
      switchTab('tasks');
      if (!pend.length) return { text: todos.length ? 'Everything on your list is done. 🎉' : 'Your to-do list is empty.' };
      return { text: 'You have ' + plural(pend.length, 'thing') + ' to do:\n' + todos.map((t, i) => t.done ? null : (i + 1) + '. ' + t.text).filter(Boolean).join('\n'), speak: 'You have ' + plural(pend.length, 'thing') + ' to do. ' + pend.slice(0, 3).map(t => t.text).join('. ') + '.', tool: 'todo' };
    }
    case 'DONE_TODO': {
      // "mark 2 as done", "tick item #3": a number on its own is a position. A digit inside a word ("q2 segmentation", "lab3") is part of the name.
      const m = s.match(/(?:^|\s)#?(\d{1,3})(?=\s|$)/);
      let t = m ? todos[+m[1] - 1] : null;
      if (!t) {
        const q = s.replace(/^(mark|tick|check( off)?|complete|finish|finished|done with|cross off|strike)\s+(task |to-?do |item )?/, '').replace(/\s*(as )?(done|complete|completed|off)$/, '');
        t = todos.find(x => !x.done && x.text.toLowerCase().includes(q)) || todos.find(x => !x.done && NLU.lev(x.text.toLowerCase(), q) <= 3);
      }
      if (!t) return todos.length && m ? { text: 'There is no item ' + m[1] + ' on your list.' } : { askLLM: true };
      t.done = true; saveTasks(); sfx.ok(); bumpStat('todosDone');
      const left = todos.filter(x => !x.done).length;
      return { text: 'Marked "**' + t.text + '**" as done. ' + (left ? left + ' to go.' : 'List cleared — nice work!'), tool: 'todo' };
    }
    case 'CLEAR_TODOS': {
      const all = /\ball\b/.test(s) && !/\b(completed|done|finished)\b/.test(s);
      const n = all ? todos.length : todos.filter(t => t.done).length;
      if (!n) return { text: all ? 'Your to-do list is already empty.' : 'There are no completed items to clear.' };
      // Explicit tier: its own card every time (and Windows Hello when required — enforced in the page, since
      // to-dos are ordinary shared-state writes the server can't tell apart from a normal save).
      return { text: 'Remove ' + plural(n, all ? 'item' : 'completed item') + ' from your to-do list?', confirm: { yes: 'YES — CLEAR', no: 'KEEP', onConfirm: () => withHello('data', () => {
        undoRemoved('cleared to-dos', () => todos, v => { todos = v; }, saveTasks, removedFrom(todos, t => !all && !t.done));
        todos = all ? [] : todos.filter(t => !t.done); saveTasks();
        jarvisSay({ text: 'Cleared ' + plural(n, all ? 'item' : 'completed item') + '.', intent: 'CLEAR_TODOS' });
      }) } };
    }

    /* ---- reminders ---- */
    case 'REMIND': {
      const whenText = a.when || s;
      const repeat = NLU.parseRepeat(whenText);
      let at = NLU.parseWhen(whenText);
      if (repeat) {
        if (repeat.type === 'interval') at = Date.now() + repeat.ms;
        else {
          if (!at) { const d = new Date(); d.setHours(9, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); at = d.getTime(); }
          if (repeat.type === 'weekdays') { const d = new Date(at); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); at = d.getTime(); }
          // "every month on the 5th": the first occurrence is the next such day (this month if still ahead).
          if (repeat.type === 'monthly' && repeat.day) {
            const d = new Date(at); d.setDate(1);
            d.setDate(Math.min(repeat.day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
            if (d <= new Date()) { d.setMonth(d.getMonth() + 1, 1); d.setDate(Math.min(repeat.day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
            at = d.getTime();
          }
          if (repeat.type === 'yearly') {
            const d = new Date(at);
            if (repeat.month !== undefined) d.setMonth(repeat.month, 1);
            d.setDate(Math.min(repeat.day || d.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
            if (d <= new Date()) d.setFullYear(d.getFullYear() + 1);
            at = d.getTime();
          }
        }
      }
      let text = a.text || cap(keepCase(p, NLU.stripWhen(s.replace(/^.*?\b(remind me|set (a |an )?reminder|don'?t let me forget|remember)\b\s*/, '')).replace(/^(to|about|that|for)\s+/, '').replace(/\s+(to|about)$/, '').trim()));
      if (!text) text = 'Reminder';
      if (!at) { ctx.pending = { intent: 'REMIND', text }; return { text: 'When should I remind you to ' + text.toLowerCase() + '?', suggestions: ['in 10 minutes', 'in 1 hour', 'tomorrow at 9am'] }; }
      if (at <= Date.now()) return { text: 'That time has already passed. When should I remind you?' };
      const remId = rid();
      reminders.push({ id: remId, text: cap(text), at, fired: false, repeat: repeat || undefined }); saveTasks(); askNotify();
      toolStep('remind → ' + new Date(at).toLocaleString() + (repeat ? ' ↻ ' + repeat.type : ''));
      const op = { kind: 'reminder', id: remId };
      if (repeat) return { text: 'Done — I will remind you to **' + text.toLowerCase() + '** ' + describeRepeat(repeat, at) + '. First one: ' + fmtDay(at) + ' at ' + fmtTime(at) + '.', tool: 'remind', op };
      return { text: 'Okay — I will remind you to **' + text.toLowerCase() + '** ' + fmtDay(at) + ' at **' + fmtTime(at) + '**.', tool: 'remind', op };
    }
    case 'LIST_REMINDERS': {
      const rs = reminders.filter(r => !r.fired && !r.routineId && !r.timerId).sort((x, y) => x.at - y.at);
      switchTab('tasks');
      if (!rs.length) return { text: 'You have no pending reminders.' };
      return { text: 'Upcoming reminders:\n' + rs.map(r => '- ' + r.text + ' — ' + fmtDay(r.at) + ' ' + fmtTime(r.at)).join('\n') };
    }

    /* ---- deadlines ---- */
    case 'ADD_DEADLINE': {
      // "add assignment DBMS record due every Monday" / "weekly lab report due Friday": a weekly deadline — when you mark it submitted, next week's is added
      const WEEKLY = /\s*\b(?:every|each)\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\s*\bweekly\b|\s*\bevery\s+week\b/i;
      const weekly = WEEKLY.test(s);
      const dueText = (a.due || s).replace(/\b(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i, '$1').replace(/\s*\bweekly\b|\s*\b(?:every|each)\s+week\b/i, '');
      const date = NLU.parseDate(dueText) || (weekly && !/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|\d)/i.test(dueText) ? (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; })() : null);
      let title = a.title || cap(keepCase(p, NLU.stripWhen(s.replace(WEEKLY, ' ').replace(/^(add|new|save|note|i have|there'?s|got)( an?| my)?\s+/, '').replace(/\s*\b(is |which is |that is )?due\b.*$/, '')).replace(/\s+(on|by|for)$/, '')));
      if (!title) return { text: 'What is the assignment called?' };
      if (!date) { ctx.pending = { intent: 'ADD_DEADLINE', title }; return { text: 'When is **' + title + '** due?', suggestions: ['tomorrow', 'Friday', 'next Monday'] }; }
      const t = NLU.parseTimeOfDay(dueText);
      if (t) date.setHours(t.h, t.m, 0, 0); else date.setHours(23, 59, 0, 0);
      deadlines.push({ id: rid(), title, due: date.getTime(), done: false, ...(weekly ? { repeat: 'weekly' } : {}) }); saveTasks();
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const due0 = new Date(date); due0.setHours(0, 0, 0, 0);
      const days = Math.round((due0 - today0) / 864e5);
      toolStep('addDeadline → ' + date.toDateString());
      return { text: 'Saved: **' + title + '** due ' + fmtDay(date) + (t ? ' at ' + fmtTime(date) : '') + (weekly ? ', **every week** (when you mark it submitted, next week’s is added)' : '') + ' (' + (days <= 1 ? 'that is soon!' : 'in ' + days + ' days') + ').' + (days <= 2 ? ' Want me to start a focus session?' : ''), tool: 'deadline', suggestions: days <= 2 ? ['Start a focus session'] : null };
    }
    case 'LIST_DEADLINES': {
      const ds = deadlines.filter(d => !d.done && d.due > Date.now() - 864e5).sort((x, y) => x.due - y.due);
      switchTab('tasks');
      // "When is my exam?" asks about one thing. With no deadline for it, what you told me to remember
      // ("remember that my exam is on 12 december") answers it.
      const about = (s.match(/\b(exams?|tests?|quiz(?:zes)?|viva|interview|assignments?|projects?|submissions?|presentations?|labs?|internals?|mid-?sems?|end-?sems?|practicals?|hackathon|contest)\b/g) || []).map(w => w.replace(/s$/, ''));
      if (about.length && !ds.some(d => about.some(w => d.title.toLowerCase().includes(w)))) {
        const facts = memory.filter(m => about.some(w => (m.key + ' ' + m.value).toLowerCase().includes(w)));
        if (facts.length) return { text: 'You told me: ' + facts.slice(-3).map(m => '“' + String(m.value || m.key).replace(/^my /i, 'your ') + '”').join(', ') + '.' + (ds.length ? '' : ' It isn’t on your deadlines list — say "add ' + about[0] + ' due …" to get a reminder before it.'), tool: 'memory' };
      }
      if (!ds.length) return { text: 'Nothing due. Enjoy it while it lasts.' };
      const week = /\bweek\b/.test(s) ? ds.filter(d => d.due - Date.now() < 7 * 864e5) : ds;
      if (!week.length) return { text: 'Nothing due this week. Next up: **' + ds[0].title + '** ' + fmtDay(ds[0].due) + '.' };
      return { text: 'Coming up:\n' + week.map(d => '- **' + d.title + '** — ' + dueLabel(d.due) + (d.due < Date.now() ? ' ⚠' : '')).join('\n'), speak: week.slice(0, 3).map(d => d.title + ' is due ' + dueLabel(d.due)).join('. ') + '.', tool: 'deadline' };
    }

    /* ---- timetable ---- */
    case 'ADD_CLASS': {
      const dayRe = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|sday|nesday|rsday|urday)?s?\b/g;
      const days = a.day ? [NLU.dayIndex(String(a.day).toLowerCase())] : [...new Set((s.match(dayRe) || []).map(NLU.dayIndex))].filter(d => d >= 0);
      const t = NLU.parseTimeOfDay(a.time || s);
      let name = a.name || cap(keepCase(p, NLU.stripWhen(s.replace(/^(add|i have|there'?s|new)( an?| my)?\s+(class|lecture|lab|tutorial|period)\s*(called|named|for|of)?\s*/, '')).replace(/\b(every|and|at|on)\b/g, ' ').replace(/\s+/g, ' ').trim()));
      if (!name) return { text: 'Which class is it?' };
      if (!days.length || !t) return { text: 'Tell me the day and time, e.g. "add class ' + name + ' on Monday at 10am".' };
      let h = t.h; if (!t.explicit && h < 8) h += 12;
      days.forEach(d => classes.push({ id: rid(), name, day: d, h, m: t.m }));
      saveTasks(); toolStep('addClass');
      const tt = new Date(); tt.setHours(h, t.m);
      return { text: 'Added **' + name + '** to your timetable: ' + days.map(d => cap(NLU.DAYS[d])).join(', ') + ' at ' + fmtTime(tt) + '. I will ping you 10 minutes before.', tool: 'timetable' };
    }
    case 'NEXT_CLASS': {
      if (!classes.length) return { text: 'Your timetable is empty. Add one: "add class DBMS on Monday at 10am".' };
      const n = upcomingClasses(new Date())[0];
      const mins = Math.round((n.at - Date.now()) / 6e4);
      return { text: 'Next up: **' + n.c.name + '** ' + fmtDay(n.at) + ' at ' + fmtTime(n.at) + (mins < 180 ? ' — in ' + (mins < 60 ? plural(mins, 'minute') : Math.floor(mins / 60) + 'h ' + mins % 60 + 'm') : '') + '.', tool: 'timetable' };
    }
    case 'LIST_CLASSES': {
      if (!classes.length) return { askLLM: true };
      const d = new Date(); if (/tomorrow/.test(s)) d.setDate(d.getDate() + 1);
      const dm = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
      const day = dm ? NLU.dayIndex(dm[1]) : d.getDay();
      const list = classes.filter(c => c.day === day).sort((x, y) => x.h - y.h || x.m - y.m);
      const label = dm ? cap(NLU.DAYS[day]) : /tomorrow/.test(s) ? 'tomorrow' : 'today';
      switchTab('tasks');
      if (!list.length) return { text: 'No classes ' + (dm ? 'on ' : '') + label + '.' };
      return { text: 'Classes ' + (dm ? 'on ' : '') + label + ':\n' + list.map(c => { const t = new Date(); t.setHours(c.h, c.m); return '- ' + fmtTime(t) + ' — **' + c.name + '**'; }).join('\n'), tool: 'timetable' };
    }

    /* ---- planning ---- */
    case 'PLAN_DAY': return planDay();

    /* ---- routines ---- */
    case 'ROUTINE_LIST': {
      const list = Routines.list();
      switchTab('tasks');
      if (!list.length) return { text: 'You have no routines yet, ' + Persona.sir() + '.' };
      return { text: 'Your routines:\n' + list.map(r => '- **' + r.name + '** — ' + r.steps.join(' → ')).join('\n'), speak: 'You have ' + plural(list.length, 'routine') + ': ' + list.map(r => r.name).join(', ') + '.' };
    }
    case 'ROUTINE_CREATE': {
      const m = p.original.match(/routine\s+(?:called|named)\s+["']?(.+?)["']?\s*(?::|—|–|\s-\s|\bthat\b|\bwhich\b|\bto\b|\bwith\b)\s*([\s\S]+)$/i)
        || p.original.match(/^(?:create|make|save|build)(?:\s+a)?\s+(.+?)\s+routine\s*(?::|—|–|\bthat\b|\bwhich\b|\bto\b|\bwith\b)\s*([\s\S]+)$/i);
      if (!m) return { text: 'Tell me the name and the steps, ' + Persona.sir() + ' — e.g. "create a routine called exam prep: open VS Code, open LeetCode, start a focus session".' };
      const steps = expandSteps(Routines.parseSteps(m[2]));
      const known = [], unknown = [];
      for (const st of steps) {
        const q = NLU.classify(NLU.normalize(st, settings.wakeWord), {});
        (q.intent === 'CONVERSATION' || q.confidence < 0.85 ? unknown : known).push(st);
      }
      if (!known.length) return { text: 'I could not recognise any of those steps as commands: ' + unknown.join('; ') + '.' };
      const r = Routines.create(m[1], known);
      switchTab('tasks');
      return { text: '✓ Routine **' + r.name + '** saved: ' + known.join(' → ') + '.' + (unknown.length ? '\n\nSkipped (not commands I know): ' + unknown.join('; ') + '.' : ''), speak: 'Routine ' + r.name + ' saved with ' + plural(known.length, 'step') + '.', suggestions: ['Run ' + r.name, 'Run ' + r.name + ' every day at 7am'] };
    }
    case 'ROUTINE_RUN': {
      const m = s.match(/^(?:run|start|activate|execute|launch|engage|initiate)\s+(?:my\s+|the\s+)?(.+?)\s+(?:routine|protocol)$/);
      const r = Routines.find(a.name || (m ? m[1] : ''));
      if (!r) return { text: 'I have no routine called "' + (a.name || (m ? m[1] : '')) + '". Your routines: ' + Routines.list().map(x => '**' + x.name + '**').join(', ') + '.' };
      return Routines.run(r);
    }
    case 'ROUTINE_SCHEDULE': {
      const m = s.match(/^(?:run|start|schedule|do)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:routine|protocol))?\s+((?:every|each|daily|on weekdays|weekdays)\b.+)$/);
      const r = m && (Routines.find(m[1]) || Routines.find(m[1] + ' mode'));
      if (!r) return { text: 'Which routine should I schedule? Your routines: ' + Routines.list().map(x => '**' + x.name + '**').join(', ') + '.' };
      const repeat = NLU.parseRepeat(m[2]);
      if (!repeat) return { text: 'How often? e.g. "every day at 7am" or "every weekday at 8am".' };
      const at = repeatStart(repeat, m[2]);
      reminders = reminders.filter(x => x.routineId !== r.id);
      reminders.push({ id: rid(), text: 'routine: ' + r.name, at, fired: false, repeat, routineId: r.id }); saveTasks();
      return { text: '✓ I will run **' + r.name + '** ' + describeRepeat(repeat, at) + '. First run: ' + fmtDay(at) + ' at ' + fmtTime(at) + '. (JARVIS needs to be open in a browser at that time.)', tool: 'routine' };
    }
    case 'ROUTINE_DELETE': {
      const m = s.match(/(?:delete|remove|forget)\s+(?:the\s+|my\s+)?(?:routine\s+(?:called|named)\s+)?(.+?)(?:\s+routine)?$/);
      const r = Routines.find(m ? m[1] : '');
      if (!r) return { text: 'I could not find that routine.' };
      return { text: 'Delete the routine **' + r.name + '**?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => { Routines.remove(r); jarvisSay({ text: 'Deleted the ' + r.name + ' routine.', intent: 'ROUTINE_DELETE' }); } } };
    }

    default: return ToolHandlers.NONE;
  }
});
