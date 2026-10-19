'use strict';
/* executeTool, files: files and folders in ~/jarvis.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('files', async function (p, raw, s, a) {
  switch (p.intent) {
    /* ---- files (~/jarvis) ---- */
    case 'DESTRUCTIVE':
      log('warn', 'destructive request intercepted');
      return { text: 'That would move **everything** in ' + backend.sandbox + ' to the trash folder. Nothing outside the sandbox can be touched. Proceed?',
        confirm: { yes: 'YES — CLEAR SANDBOX', no: 'CANCEL', onConfirm: () => withHello('files', async tok => { toolStep('clearSandbox'); const r = await callTool('/tool/clearSandbox', {}, tok); if (!r.error && r.items && r.items.length) Undo.push('cleared the sandbox', async () => { let n = 0; for (const it of r.items) { const x = await callTool('/tool/restoreItem', it); if (!x.error) n++; } return 'Restored ' + plural(n, 'item') + ' from the trash.'; }); jarvisSay({ text: r.error ? 'Failed: ' + r.error : 'Moved ' + plural(r.count, 'item') + ' to ~/jarvis/.trash. Recoverable if you change your mind.', intent: 'DESTRUCTIVE' }); }) } };
    case 'DELETE_ITEM': {
      const m = p.original.match(/(folder|file|note|directory)\s+(?:called|named)?\s*["']?(.+?)["']?\s*$/i) || p.original.match(/^(?:delete|remove|trash)\s+()(.+\.\w+)$/i);
      const kindWord = m && m[1] ? m[1].toLowerCase() : 'file';
      let name = a.name || (m ? m[2].trim() : '');
      if (/^(it|that|this)$/i.test(name) || (!name && ctx.lastFile)) name = ctx.lastFile || '';
      if (!name) return { text: 'Which file or folder should I delete?' };
      const kind = /folder|directory/.test(kindWord) ? 'folder' : 'file';
      return { text: 'Move ' + kind + ' "**' + name + '**" to the sandbox trash?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => withHello('files', async tok => {
        toolStep('deleteItem → ' + name); const r = await callTool('/tool/deleteItem', { name, kind }, tok);
        if (!r.error && r.trashName) Undo.push('deleted ' + r.name, async () => { const x = await callTool('/tool/restoreItem', { trashName: r.trashName, original: r.original }); if (x.error) throw new Error(x.error); return 'Restored `' + x.name + '` from the trash.'; });
        jarvisSay({ text: r.error ? cap(r.error) + '.' : 'Deleted `' + r.name + '` (moved to .trash).', intent: 'DELETE_ITEM' });
      }) } };
    }
    case 'NOTE_APPEND': {
      const m = p.original.match(/(?:take|make|write|jot|add)\s+(?:a\s+)?note:?\s*(.+)$/i) || p.original.match(/note(?:\s+down)?:?\s*(.+)$/i);
      const content = a.content || (m ? m[1].trim() : '');
      if (!content) return { text: 'What should the note say?' };
      toolStep('writeFile → notes.md');
      const r = await callTool('/tool/writeFile', { name: 'Notes/notes.md', content: '- ' + new Date().toLocaleString() + ' — ' + content, append: true });
      if (r.error) return { text: 'Could not save the note: ' + r.error };
      if (r.backup) Undo.push('added a note', async () => { const x = await callTool('/tool/restoreVersion', { backup: r.backup, name: r.name }); if (x.error) throw new Error(x.error); return 'Removed that note from `' + x.name + '`.'; });
      else if (r.created) Undo.push('added a note', async () => { const x = await callTool('/tool/undoCreate', { name: r.name }); if (x.error) throw new Error(x.error); return 'Removed `' + r.name + '`.'; });
      ctx.lastFile = 'notes.md';
      return { text: 'Noted in `~/jarvis/' + r.name + '`: "' + content + '"', speak: 'Noted.', tool: 'writeFile' };
    }
    case 'WRITE_FILE': {
      // Project: "in the same project calculator" / "in my calculator project" → that project's folder.
      const proj = a.folder === undefined ? await resolveProject(p.original) : null;
      if (proj && proj.ask) return proj.ask;
      if (proj && proj.missing) return { text: proj.missing === 'that project' ? 'Which project, ' + Persona.sir() + '? Name it — e.g. "in the calculator project" — or open its folder first.' : 'I can’t find a project called **' + proj.missing + '** on this laptop. Say its folder, or "create a folder called ' + proj.missing + '" first.' };
      if (proj && proj.path) { setFocus('project', proj.path); noteTrace('project', proj.path + ' (' + proj.how + ')'); }
      // Folder: "in that folder" / "there" (the folder in focus), "on my desktop", "in D:\work".
      const sc = proj && proj.path ? { rest: p.original } : scopeFrom(p.original, true);
      let folder = proj && proj.path ? proj.path : '';   // resolved path (project / conversation focus) — preferred over a named place
      let wscope = '';
      if (sc.ref) {
        if (!sc.path) return { text: 'Which folder do you mean, ' + Persona.sir() + '? Open the folder first and say "create a file there", or name a place like **desktop** or **D drive**.' };
        folder = sc.path;
      } else if (sc.scope) {
        if (sc.scope.split(/\s+/).length > 4 || /\bwhich\b|\bincludes?\b/i.test(sc.scope)) {
          // "...in that which includes..." — not a place; fall back to the folder in focus, if any.
          const f = focusOf('created') || focusOf('folder');
          if (f) folder = f.path;
        } else wscope = sc.scope;
      }
      // Pending answers ("calculator_py") and AI tool calls carry these directly.
      if (a.folder !== undefined) folder = a.folder;
      if (a.where !== undefined) wscope = a.where;
      const langWord = (a.lang || (p.original.match(/\b(python|py|c\+\+|cpp|javascript|js|java|html|css)\b/i) || [])[1] || '').toLowerCase();
      const CODE_LANGS = { python: 'python', py: 'python', 'c++': 'cpp', cpp: 'cpp', javascript: 'javascript', js: 'javascript', java: 'java', html: 'html', css: 'css' };
      const lang = CODE_LANGS[langWord] || '';
      const worig = ((sc.ref || sc.scope) && sc.rest) || p.original;
      const nm = worig.match(/(?:called|named|titled)\s+["']?([\w\- .]+?)["']?(?=\s+(?:with|saying|containing|that says)\b|:|$)/i) || worig.match(/((?:[a-z]:)?[\w\-.\/\\]*[\w\-]\.[a-z0-9+]{1,6})\b/i);
      const cm = worig.match(/(?:with|saying|containing|that says|:)\s+["']?([\s\S]+?)["']?$/i);
      let name = a.name || (nm ? (nm[1] || nm[0]).trim().replace(/^(?:a\s+|the\s+|my\s+)/i, '') : '');
      // a location qualifier caught inside the name ("calculator.html in desktop") is not part of it
      name = name.replace(/\s+(?:in|on|inside|at)\s+(?:the\s+|my\s+)?(desktop|documents|downloads|pictures|music|videos)(?:\s+folder)?\s*$/i, '').trim();
      const content = a.content || (cm ? cm[1] : '');
      if (name && !/\.[a-z0-9+]{1,6}$/i.test(name) && lang && LANG_EXT[lang]) name = name + LANG_EXT[lang];
      // Code generation (not an empty file): the request must actually ask for code — "which includes all
      // operations", "a login function" — plus a code language or extension. A bare "create calc.py" stays an empty file.
      const CODE_HINT = /\b(code|program|script|logic|operations?|function)\b/i.test(p.original);
      const needsCode = !content && (a.needsCode || (CODE_HINT && (/\.(py|cpp|c|js|java|html|css)$/i.test(name) || lang)));
      const where = wscope;
      // No name, but an obvious one ("…all operations of calculator" in D:\calculator → calculator.py): use it.
      // Two or three plausible names → ask with them as choices. None → ask as before.
      let inferred = false;
      if (!name && (needsCode || CODE_HINT) && lang && LANG_EXT[lang]) {
        const guesses = NLU.inferFileNames(p.original, LANG_EXT[lang], folder);
        if (guesses.length === 1) { name = guesses[0]; inferred = true; noteTrace('file name', name + ' (inferred from your request)'); }
        else if (guesses.length > 1) {
          ctx.pending = { intent: 'WRITE_FILE', folder, where: wscope, lang, hint: p.original, needsCode: true };
          return { text: 'What should I call it' + (folder ? ' in `' + folder + '`' : '') + ', ' + Persona.sir() + '?', suggestions: guesses };
        }
      }
      if (needsCode && !llmReady() && inferred) return { text: 'Writing the code for **' + name + '** needs my AI brain, ' + Persona.sir() + ' — it’s off or unreachable (Settings → AI BRAIN). I can create it empty for now.', suggestions: ['Create an empty file called ' + name + (folder ? ' there' : '')] };
      if (needsCode && llmReady()) {
        const target = folder && !/^[a-z]:[\\/]/i.test(name) ? joinPath(folder, name) : name;
        if (inferred) toast('Naming it ' + name + ' — from your request');
        if (!name) {
          ctx.pending = { intent: 'WRITE_FILE', folder, where, lang, hint: p.original, needsCode: true };
          return { text: 'What should I call the ' + (lang ? ({ python: 'Python', cpp: 'C++', javascript: 'JavaScript', java: 'Java', html: 'HTML', css: 'CSS' }[lang] || lang) : 'code') + ' file' + (folder ? ' in `' + folder + '`' : where ? ' in **' + where + '**' : '') + '?' };
        }
        const langLabel = { python: 'Python', cpp: 'C++', javascript: 'JavaScript', java: 'Java', html: 'HTML', css: 'CSS' }[lang] || 'code';
        return { askLLM: 'Write ' + langLabel + ' code for this request. Reply with the complete, runnable code in ONE fenced code block (with a language tag), then at most two short sentences.\n\nRequest: ' + p.original,
          after: folder ? { save: target } : { save: name, where: where || undefined }, noHistory: true };
      }
      if (!name) {
        ctx.pending = { intent: 'WRITE_FILE', folder, where, lang, hint: p.original };
        return { text: 'What should I call the file' + (folder ? ' in `' + folder + '`' : where ? ' in **' + where + '**' : '') + '? e.g. "create a note called dsa-tips saying …"' };
      }
      if (folder) return saveToFile(name, content ? content + '\n' : '', { folder });
      return saveToFile(name, content ? content + '\n' : '', where ? { where } : undefined);
    }

    default: return ToolHandlers.NONE;
  }
});
