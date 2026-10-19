'use strict';
/* executeTool, study: maths and CS helpers, attendance and marks, studying from notes.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('study', async function (p, raw, s, a) {
  switch (p.intent) {
    /* ---- math & CS ---- */
    case 'CALCULATE': {
      const c = tryCalc(a.expression || s);
      if (!c) return { askLLM: true };
      toolStep('calculate → ' + c.expr);
      return { text: '`' + c.expr.replace(/\*\*/g, '^').replace(/\*/g, '×').replace(/\//g, '÷') + '` = **' + c.val.toLocaleString() + '**', speak: 'That is ' + c.val, tool: 'calculate' };
    }
    case 'BASE_CONVERT': { toolStep('baseConvert'); return baseConvert(s) || { askLLM: true }; }
    case 'DATA_SIZE': { toolStep('dataSize'); return dataSize(s) || { askLLM: true }; }
    case 'ASCII': { toolStep('ascii'); return asciiTool(p.original) || { askLLM: true }; }
    case 'BITWISE': { toolStep('bitwise'); return bitwise(s) || { askLLM: true }; }

    /* ---- attendance & marks ---- */
    case 'ATTENDANCE_MARK': {
      // The subject is what's left after the attendance words ("mark dbms present", "i was absent for os today",
      // "i missed the dbms class"); an existing subject is reused whatever its case, and short names are acronyms (DBMS).
      const said = String(a.subject || s).toLowerCase()
        .replace(/\b(?:today|yesterday|tonight|this morning|this afternoon|this evening)\b/g, ' ')
        .replace(/\b(?:please|mark|marked|record|log|me|as|i|was|am|were|have|had|present|absent|missed|skipped|bunked|bunk|attended|for|in|at|the|my|class|classes|lecture|period)\b/g, ' ')
        .replace(/[^\w\s+#&-]/g, ' ').replace(/\s+/g, ' ').trim();
      const subject = Object.keys(attendance).find(k => Study.subjectKey(k) === Study.subjectKey(said)) || (said.length <= 4 ? said.toUpperCase() : cap(said)) || 'Class';
      const present = a.status ? a.status === 'present' : !/\babsent|missed|skipped|bunk(ed)?\b/i.test(s);
      const e = attendance[subject] || (attendance[subject] = { held: 0, attended: 0, log: [] });
      const ymd = Study.ymd(new Date());
      e.log.push({ d: ymd, s: present ? 'p' : 'a' }); if (e.log.length > 400) e.log.shift();
      e.held++; if (present) e.attended++;
      saveTasks(); sfx.ok();
      const pct = Study.attendancePct(e.held, e.attended);
      toolStep('attendance → ' + subject + ' ' + pct + '%');
      return { text: 'Marked **' + subject + '** ' + (present ? 'present' : 'absent') + ' — now at **' + pct + '%** (' + e.attended + '/' + e.held + ')' + (pct < attMin() ? ', ⚠️ below the ' + attMin() + '% line. Attend ' + plural(Study.neededToReach(e.held, e.attended, attMin()), 'class') + ' in a row to get back.' : ', ' + plural(Study.bunkable(e.held, e.attended, attMin()), 'bunk') + ' still safe.'), tool: 'attendance', op: { kind: 'attendance', subject } };
    }
    case 'ATTENDANCE_REPORT': {
      switchTab('tasks');
      const names = Object.keys(attendance);
      if (!names.length) return { text: 'No attendance recorded yet — try "mark DBMS present" after a class.' };
      const rows = names.map(n => {
        const e = attendance[n], pct = Study.attendancePct(e.held, e.attended);
        return { n, pct, bunk: Study.bunkable(e.held, e.attended, attMin()), need: Study.neededToReach(e.held, e.attended, attMin()), e };
      }).sort((x, y) => x.pct - y.pct);
      const line = r => '- **' + r.n + '**: ' + r.pct + '% (' + r.e.attended + '/' + r.e.held + ')' + (r.pct < attMin() ? ' ⚠️ attend ' + plural(r.need, 'class') + ' in a row to recover' : ' · ' + plural(r.bunk, 'bunk') + ' safe');
      const danger = rows.filter(r => r.pct < attMin());
      return { text: (danger.length ? '⚠️ **' + danger[0].n + '** is below ' + attMin() + '% (' + danger[0].pct + '%).\n\n' : '') + 'Attendance:\n' + rows.map(line).join('\n'), tool: 'attendance' };
    }
    case 'BUNK_CHECK': {
      // "I attended 30 of 36 classes, how many can I bunk": the numbers are given, so answer from them directly.
      const given = s.match(/(\d+)\s*(?:of|out of|\/)\s*(\d+)/);
      if (given && +given[1] <= +given[2] && +given[2] > 0) {
        const att = +given[1], held = +given[2], pct = Study.attendancePct(held, att);
        return pct >= attMin()
          ? { text: 'You’re at **' + pct + '%** (' + att + '/' + held + '). You can miss **' + plural(Study.bunkable(held, att, attMin()), 'class') + '** in a row and stay at ' + attMin() + '% or above.', tool: 'attendance' }
          : { text: 'You’re at **' + pct + '%** (' + att + '/' + held + ') — below ' + attMin() + '%, so no bunks. Attend **' + plural(Study.neededToReach(held, att, attMin()), 'class') + '** in a row to get back to ' + attMin() + '%.', tool: 'attendance' };
      }
      const name =String(a.subject || s.replace(/^.*?\b(can i (miss|skip|bunk)|should i (go to|attend))\b\s*(the\s+|my\s+|tomorrow'?s?\s+|next\s+)?/i, '').replace(/\s+\b(class|classes|tomorrow|today|lecture)\b.*$/i, '').trim());
      const key = Object.keys(attendance).find(k => Study.subjectKey(k) === Study.subjectKey(name)) || (!name || name.length < 2 ? null : Object.keys(attendance).find(k => NLU.lev(k.toLowerCase(), name.toLowerCase()) <= 2));
      if (!key) return attendance && Object.keys(attendance).length ? { text: 'Which subject? You track: ' + Object.keys(attendance).join(', ') + '.' } : { text: 'No attendance recorded yet — try "mark DBMS present" after a class.' };
      const e = attendance[key];
      if (Study.attendancePct(e.held, e.attended) >= attMin()) return { text: '**' + key + '** is at ' + Study.attendancePct(e.held, e.attended) + '% (' + e.attended + '/' + e.held + ') — you can still miss ' + plural(Study.bunkable(e.held, e.attended, attMin()), 'class') + ' and stay above ' + attMin() + '%.', tool: 'attendance' };
      const need = Study.neededToReach(e.held, e.attended, attMin());
      return { text: '**' + key + '** is at **' + Study.attendancePct(e.held, e.attended) + '%** (' + e.attended + '/' + e.held + ') — below ' + attMin() + '%. No bunks: attend ' + plural(need, 'class') + ' in a row to get back.', tool: 'attendance' }; }    case 'ADD_MARKS': {
      // "add my S3 marks, 8.6 gpa, 24 credits" · "add S3: 430/500" · title can also come from the AI as a.title.
      let title = String(a.title || '').trim();
      if (!title) {
        const t = s.replace(/\b(add|save|log|record|i got|i scored)\b/g, ' ').replace(/\b(my |semester |sem |result|marks?|gpa|sgpa|cgpa|with|scored?|got)\b/g, ' ').replace(/\b\d+(?:\.\d+)?\s*(?:\/|out of)\s*\d+(?:\.\d+)?\b/g, ' ').replace(/[\d.:]+\s*(?:gpa|sgpa|cgpa|credits?)\b/gi, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
        title = cap(t.split(' ').filter(Boolean).slice(0, 4).join(' '));
      }
      if (!title) return { text: 'What is the semester called — S3, 5th sem?' };
      const score = s.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/);
      const gpaWord = s.match(/(\d+(?:\.\d+)?)\s*(?:gpa|sgpa|cgpa|pointer|point|cg)\b/i);
      const gpa = a.gpa !== undefined ? +a.gpa : score ? Math.round(1000 * (+score[1] / +score[2]) * 10) / 100 : gpaWord ? +gpaWord[1] : NaN;
      if (!(gpa >= 0 && gpa <= 10)) return { text: 'What did you score in **' + title + '**? Say it like "8.6 gpa" or "430 out of 500".' };
      const crWord = s.match(/(\d{1,2})\s*(?:credits?|crd|cr)\b/i);
      const credits = a.credits !== undefined ? +a.credits : crWord ? +crWord[1] : 0;
      if (!(credits >= 1 && credits <= 60)) return { text: 'How many credits was **' + title + '**? Add it like "24 credits" so I can weight your CGPA correctly.' };
      const snapshot = marks.slice();
      marks.push({ id: rid(), title, gpa: Math.round(100 * gpa) / 100, credits, ts: Date.now() });
      saveTasks(); sfx.ok();
      if (typeof Undo !== 'undefined') Undo.push('added ' + title + ' marks', () => { marks = snapshot; saveTasks(); return 'Removed the ' + title + ' result.'; });
      const g = Study.cgpa(marks);
      toolStep('marks → ' + title + ' ' + gpa);
      return { text: 'Saved **' + title + '**: ' + gpa + ' GPA · ' + credits + ' credits.' + (marks.length > 1 ? ' Your CGPA is now **' + g + '** across ' + plural(marks.length, 'semester') + '.' : ' Your SGPA is **' + g + '**.'), tool: 'marks', op: { kind: 'marks', title } };
    }
    case 'ATTENDANCE_TARGET': {
      const target = Math.min(99, +((/(\d{2,3})\s*(?:%|percent)/.exec(s) || [])[1]) || 75);
      const names = Object.keys(attendance).filter(k => attendance[k].held);
      if (!names.length) return { text: 'No attendance recorded yet — try "mark DBMS present" after a class.' };
      const one = names.find(k => s.includes(k.toLowerCase()));
      const rows = (one ? [one] : names).map(k => { const e = attendance[k], pct = Study.attendancePct(e.held, e.attended), need = Study.neededToReach(e.held, e.attended, target);
        return '- **' + k + '** ' + pct + '% (' + e.attended + '/' + e.held + ') — ' + (need ? 'attend ' + plural(need, 'class') + ' in a row to reach ' + target + '%' : 'already above ' + target + '%'); });
      switchTab('tasks');
      return { text: 'To reach **' + target + '%**:\n' + rows.join('\n'), tool: 'attendance' };
    }
    case 'GPA_TARGET': {
      const target = +((/(\d+(?:\.\d+)?)\s*(?:cgpa|pointer)/.exec(s) || /\bneed\b.*?(\d+(?:\.\d+)?)/.exec(s) || [])[1]);
      if (!(target > 0 && target <= 10)) return { text: 'Which CGPA are you aiming for — say it like "an 8.5 cgpa".' };
      if (!marks.length) return { text: 'No results saved yet — add a semester first, e.g. "add S1: 8.2 gpa, 24 credits".' };
      const done = marks.reduce((x, m) => x + m.credits, 0), pts = marks.reduce((x, m) => x + m.gpa * m.credits, 0);
      const cr = +((/(\d{1,2})\s*credits?/.exec(s) || [])[1]) || Math.round(done / marks.length);
      const now = Study.cgpa(marks), need = Study.gradeNeeded(done, pts, target, cr);
      const base = 'Your CGPA is **' + now + '** over ' + plural(done, 'credit') + '. ';
      if (now >= target && need !== null && need <= 0) return { text: base + 'You are already above ' + target + '.', tool: 'marks' };
      return { text: base + (need === null ? 'Reaching **' + target + '** in the next ' + cr + ' credits would need more than a 10 SGPA — it takes more than one semester.' : 'For **' + target + '**, score about **' + need + ' SGPA** in your next ' + cr + ' credits' + (/credits?/.test(s) ? '.' : ' (assuming a semester like your average — say "in 22 credits" to change that).')), tool: 'marks' };
    }
    case 'CGPA_REPORT': {
      switchTab('tasks');
      if (!marks.length) return { text: 'No results saved yet — try "add S3: 8.6 gpa, 24 credits".' };
      const g = Study.cgpa(marks);
      return { text: marks.map(m => '- **' + m.title + '**: ' + m.gpa + ' GPA · ' + m.credits + ' credits').join('\n') + '\n\n**CGPA: ' + g + '** over ' + plural(marks.reduce((x, m) => x + m.credits, 0), 'credit') + '.', tool: 'marks' };
    }

    /* ---- study from notes ---- */
    case 'SUMMARISE_FILE': {
      let name = a.name || extractFileName(p.original);
      if (!name || /^(it|that|this|file|notes)$/i.test(name)) name = /\b(that file|it|this file)\b/.test(s) && ctx.lastFile ? ctx.lastFile : /\bnotes\b/.test(s) ? 'notes.md' : '';
      if (!name) return { text: 'Which file should I summarise?', suggestions: ['List my files'] };
      toolStep('readFile → ' + name);
      const r = await callTool('/tool/readFile', { name });
      if (r.error) return { text: /not found/i.test(r.error) ? 'I could not find "' + name + '" in ~/jarvis or your project folders.' : cap(r.error) + '.', suggestions: ['List my files'] };
      ctx.lastFile = r.name;
      if (!r.content.trim()) return { text: '`' + r.name + '` is empty.' };
      if (!llmReady()) return { text: 'Summaries need my AI brain. Here is the start of `' + r.name + '`:\n```\n' + r.content.slice(0, 800) + '\n```' };
      return { noHistory: true, askLLM: 'Summarise my file "' + r.name + '" for a student: one-line overview, then the key points as bullets, then "Remember for exams:" with 2-4 items if relevant. Only use what is in the file.\n\n```\n' + r.content.slice(0, 12000) + '\n```',
        after: { suggestions: ['Make flashcards from ' + r.name.split('/').pop()] } };
    }
    case 'FLASH_MAKE': {
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) to write flashcards.' };
      // Only treat it as a file when it looks like one ("x.md") or follows "from" ("from os-notes").
      const fname = a.name || (/\.[a-z0-9]{1,5}\b/i.test(p.original) ? extractFileName(p.original) : '')
        || ((p.original.match(/\bfrom\s+(?:my\s+|the\s+)?["']?([\w\-]+)["']?\s*$/i) || [])[1] || '').replace(/^(that|this|it|answer)$/i, '');
      let source = '', deck = '';
      if (fname && !/^(that|this|it|flashcards?)$/i.test(fname)) {
        toolStep('readFile → ' + fname);
        const r = await callTool('/tool/readFile', { name: fname });
        if (r.error) return { text: 'I could not find "' + fname + '".', suggestions: ['List my files'] };
        source = r.content; deck = r.name.split('/').pop().replace(/\.[^.]+$/, '');
      } else if (/\b(from|of) (that|this|it|the (last )?answer)\b/.test(s)) {
        source = lastAnswer(); deck = 'Chat ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      } else {
        const t = (s.match(/flash ?cards? (?:on|about|for|of) (.+)$/) || s.match(/(?:make|create|generate|build) (?:me )?(?:some )?(.+?) flash ?cards?/) || [])[1];
        if (t && !/^(some|a set of|my)$/.test(t)) deck = cap(keepCase(p, t));
      }
      if (!source && !deck) return { text: 'What should the flashcards cover? e.g. "make flashcards from os-notes.md" or "make flashcards on deadlocks".' };
      if (source && !source.trim()) return { text: 'That file is empty.' };
      return { askLLM: (source ? 'Create 8-12 study flashcards from the material below.' : 'Create 10 study flashcards on: ' + deck + '.')
        + ' Output ONLY lines in exactly this format, one card per line, and nothing else:\nQ: <question> || A: <short answer>' + (source ? '\n\nMaterial:\n' + source.slice(0, 10000) : ''), after: { flashDeck: deck } };
    }
    case 'FLASH_REVIEW': {
      const m = s.match(/\b(?:review|quiz me(?: on)?|test me(?: on)?|practice|study|revise|drill)(?: my| the)?\s+([\w-]+(?:\s[\w-]+){0,2}?)\s+flash ?cards?/);
      return startFlashReview(a.deck || (m ? m[1] : ''));
    }
    case 'FLASH_ANSWER': return flashAnswer(a.id, a.answer || '');
    case 'FLASH_LIST': {
      switchTab('memory');
      const decks = flashDecks();
      if (!decks.length) return { text: 'You have no flashcards yet. Try "make flashcards from os-notes.md" or "make flashcards on normalization".' };
      return { text: 'Your decks:\n' + decks.map(d => '- **' + d.name + '** — ' + plural(d.count, 'card') + (d.due ? ', **' + d.due + ' due**' : '')).join('\n'), suggestions: decks.some(d => d.due) ? ['Review my flashcards'] : null };
    }
    case 'FLASH_DELETE': {
      const m = s.match(/(?:delete|remove|clear)(?: the| my| all)?\s+([\w-]+(?:\s[\w-]+){0,2}?)\s+(?:flash ?cards?|deck)/);
      const q = m && !/^(my|all|the)$/.test(m[1]) ? m[1] : '';
      const decks = flashDecks();
      const d = q ? decks.find(x => x.name.toLowerCase().includes(q)) : null;
      if (!d && q) return { text: 'No deck matches "' + q + '".' };
      const target = d ? d.name : null;
      const n = target ? flashcards.filter(c => c.deck === target).length : flashcards.length;
      if (!n) return { text: 'There are no flashcards to delete.' };
      return { text: 'Delete ' + plural(n, 'flashcard') + (target ? ' in **' + target + '**' : ' (all decks)') + '?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => withHello('data', () => {
        undoRemoved('deleted flashcards', () => flashcards, v => { flashcards = v; }, saveFlash, removedFrom(flashcards, c => target && c.deck !== target));
        flashcards = target ? flashcards.filter(c => c.deck !== target) : []; saveFlash();
        jarvisSay({ text: 'Deleted.', intent: 'FLASH_DELETE' });
      }) } };
    }

    default: return ToolHandlers.NONE;
  }
});
