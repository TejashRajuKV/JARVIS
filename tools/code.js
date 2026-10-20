'use strict';
/* executeTool, code: code to file to run, snippets, git, clipboard helpers.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('code', async function (p, raw, s, a) {
  switch (p.intent) {
    /* ---- code → file → run ---- */
    case 'WRITE_AND_SAVE': {
      const name = a.name || extractFileName(p.original);
      const run = /\b(and|then) (run|execute|compile)\b/i.test(p.original);
      const ask = p.original.replace(/[,\s]*\b(and|then)\s+(save|store|put)\b[\s\S]*$/i, '').trim();
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) to write code. Start Ollama and try again.' };
      return { askLLM: ask + '\n\nReply with the complete, runnable code in ONE fenced code block (with a language tag), then at most two short sentences.', after: { save: name, run } };
    }
    case 'SAVE_CODE': {
      const code = a.code || lastCode();
      if (!code) return { text: 'I do not see any code in our chat yet. Ask me to write some — or say "paste my clipboard into main.py".', suggestions: ['Paste my clipboard into main.py'] };
      const o = p.original;
      // "by creating a new folder called X" / "in a new folder named X" / "into the X folder": a folder to make for it
      const fm = o.match(/\b(?:by\s+)?(?:creat(?:e|ing)|mak(?:e|ing)|in|into|inside|under)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:folder|directory|dir)\s+(?:called\s+|named\s+)?["']?([\w\-.()]+(?:\s+[\w\-.()]+){0,3}?)["']?(?=\s+(?:on|in|at|inside|under|to)\b|\s+and\b|[\s.!]*$)/i)
        || o.match(/\b(?:in|into|inside)\s+(?:the\s+|a\s+|new\s+)*["']?([\w\-]+)["']?\s+(?:folder|directory)\b/i);
      const folder = a.folder !== undefined ? a.folder : (fm ? fm[1].trim() : '');
      const rest = (fm ? o.replace(fm[0], ' ') : o).replace(/\s+/g, ' ').trim();
      // where: "on my desktop", "in D drive", "in C:\x", "there"; from the follow-up question; or not said
      let where = a.where;
      if (where === undefined) {
        const sc = scopeFrom(rest, true);
        if (sc.ref) { if (!sc.path) return { text: 'Which folder do you mean, ' + Persona.sir() + '? Say **desktop**, **D drive** or a full path.' }; where = sc.path; }
        else if (sc.scope && !/^(?:it|that|this|file|a file)$/i.test(sc.scope)) where = sc.scope;
      }
      let name = a.name || extractFileName(rest);
      if (!name || /^(it|that|this)$/i.test(name)) name = ctx.lastFile && !a.name && !folder && /\b(it|that file|the file)\b/.test(s) && !/\bas\b/.test(s) ? ctx.lastFile : '';
      const ext = LANG_EXT[code.lang] || '.txt', web = /^(html?|htm)$/i.test(code.lang || '') || /<!doctype html|<html[\s>]/i.test(code.code);
      if (!name && (folder || web)) name = (web ? 'index' : 'main') + ext;
      // A new folder or a web page: ask where it should go, instead of silently picking a place.
      if (where === undefined && (folder || web)) {
        ctx.pending = { intent: 'SAVE_CODE', code, name, folder, askWhere: true };
        return { text: 'Where should I save **' + (folder ? folder + '/' : '') + name + '**, ' + Persona.sir() + '? Say **desktop**, **D drive**, a full path like `D:\\Projects`, or **jarvis** for your ~/jarvis folder.',
          speak: 'Where should I save it?', suggestions: ['Desktop', 'D drive', 'Jarvis folder'] };
      }
      if (!name) { ctx.pending = { intent: 'SAVE_CODE', code, name, folder, where }; return { text: 'What should I name the file?', suggestions: ['main' + ext, 'solution' + ext] }; }
      const target = (folder ? folder + '/' : '') + withExt(name, code.lang);
      const r = await saveToFile(target, code.code + '\n', { what: code.lang || 'code', run: !!(a.run), where: where || undefined });
      if (web && /✓/.test(r.text || '')) r.suggestions = ['Open it', 'Open it in VS Code'];
      return r;
    }
    case 'CLIPBOARD_TO_FILE': {
      toolStep('readClipboard');
      const content = await readClip();
      if (!content) return { text: 'Your clipboard is empty — copy something first.' };
      const name = a.name || extractFileName(p.original);
      if (!name) { ctx.pending = { intent: 'SAVE_CODE', code: { lang: guessLang(content), code: content } }; return { text: 'Which file should I put your clipboard into?' }; }
      const append = /\b(append|add)\b/.test(s);
      return saveToFile(withExt(name, guessLang(content) || 'text'), content + '\n', { append, what: 'clipboard' });
    }
    case 'COPY_CONTENT': {
      const file = (s.match(/([\w\-.\/\\:]+\.[a-z0-9+]{1,6})\b/i) || [])[1];
      if (file && !/^(e\.g|i\.e)$/i.test(file)) {
        toolStep('readFile → clipboard');
        const r = await callTool('/tool/readFile', { name: extractFileName(p.original) || file });
        if (r.error) return { text: 'I could not find "' + file + '".' };
        await copyText(r.content); ctx.lastFile = r.name;
        return { text: '✓ Copied `' + r.name + '` (' + plural(lines(r.content), 'line') + ') to your clipboard.', speak: 'Copied ' + r.name.split('/').pop(), tool: 'writeClipboard', suggestions: ['Paste that code into my editor'] };
      }
      const code = /\b(answer|reply|response)\b/.test(s) ? null : lastCode();
      const text = code ? code.code : lastAnswer();
      if (!text) return { text: 'There is nothing to copy yet.' };
      toolStep('copy → clipboard');
      await copyText(text);
      return { text: '✓ Copied ' + (code ? plural(lines(text), 'line') + ' of ' + (code.lang || 'code') : 'my last answer') + ' to your clipboard.', speak: 'Copied.', tool: 'writeClipboard', suggestions: code ? ['Paste that code into my editor', 'Save that code as main' + (LANG_EXT[code.lang] || '.txt')] : null };
    }
    case 'PASTE_TO_EDITOR': {
      const fromClip = /\bclipboard\b/.test(s);
      if (fromClip) { const r = await callTool('/tool/pasteKeys', { delayMs: 3000 }); [3, 2, 1].forEach((n, i) => setTimeout(() => toast('Click into your editor… pasting in ' + n, true), i * 1000)); return r.error ? { text: r.error } : { text: '**Click into your editor now** — pasting your clipboard in 3 seconds.' }; }
      const code = a.code || lastCode();
      if (!code) return { text: 'There is no code in our chat to paste. Ask me to write some first.' };
      toolStep('pasteToEditor');
      return pasteToActiveWindow(code.code, plural(lines(code.code), 'line') + ' of ' + (code.lang || 'code'));
    }
    case 'OPEN_IN_EDITOR': {
      const m = p.original.match(/(?:open|edit|show|load)\s+(?:up\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:in|with|using|on)\s+(?:vs ?code|vscode|visual studio code|code editor|my editor|the editor|editor)\b/i) || p.original.match(/^edit\s+(.+)$/i);
      let name = a.name || (m ? m[1].trim() : '');
      if (!name || /^(it|that|this|that file|the file)$/i.test(name)) name = ctx.lastFile || '';
      if (/^(project|projects|my project|code)$/i.test(name)) name = projectRoots[0] || '';
      if (/^(sandbox|jarvis sandbox|files)$/i.test(name)) name = '';
      // "open agriloop folder in vs code" → "agriloop": the kind of thing isn't part of its name.
      name = name.replace(/^(?:the|my)\s+/i, '').replace(/\s+(?:folder|directory|project|workspace|repo)$/i, '').trim();
      toolStep('openInEditor → ' + (name || '~/jarvis'));
      // Anywhere on the laptop (no setup). Several places match (AGRILOOP-1, AGRILOOP61): ask which one.
      const r = await callTool('/tool/openInEditor', { name });
      const pick = pickPlace(r, name, async x => { const o = await callTool('/tool/openInEditor', { name: x }); return o.error ? { text: cap(o.error) + '.' } : { text: 'Opening `' + o.path + '` in **VS Code**.', tool: 'openInEditor' }; });
      if (pick) return pick;
      if (r.error) return { text: cap(r.error) + '.', suggestions: ['List my files'] };
      if (/\.[a-z0-9]+$/i.test(r.name)) ctx.lastFile = r.name;
      return { text: 'Opening `' + (r.path || r.name) + '` in **VS Code**.', speak: 'Opening it in VS Code.', tool: 'openInEditor' };
    }
    case 'CODE_ASK': {
      const parsed = NLU.parseCodeAsk(p.original) || {};
      const tool = a.tool || parsed.tool;
      let prompt = (a.prompt || parsed.prompt || '').trim();
      let folder = (a.folder || parsed.folder || '').trim();
      // "ask claude code to add unit tests in demoshop": a trailing "in <project>" names the folder — only when such a
      // project exists, so "fix the bug in the login page" keeps its words.
      const tail = !folder && prompt.match(/^(.+?)\s+(?:in|for|inside)\s+(?:the\s+|my\s+)?([\w .-]{2,40}?)(?:\s+(?:project|folder|repo))?[.!?]?$/i);
      if (tail && !(await callTool('/tool/locateProject', { name: tail[2] })).error) { folder = tail[2].trim(); prompt = tail[1].trim(); }
      if (!tool) return { text: 'Which coding tool — VS Code/Copilot, Kiro, Trae, Antigravity, Devin, OpenCode, Claude, Gemini, Codex, Qwen or Codebuff?' };
      if (!prompt) return { text: 'What should I ask it to do?' };
      if (!folder) folder = ctx.lastProject || '';
      // A folder JARVIS isn't allowed to use yet (e.g. on the Desktop): find it and offer to allow it, then carry on.
      if (folder && (await callTool('/tool/locateProject', { name: folder })).error) {
        const f = await callTool('/tool/findFolderAnywhere', { name: folder });
        if (f.error && f.error !== 'Invalid folder name') return { text: 'I couldn’t look for the folder **' + folder + '**: ' + f.error, error: f.error };
        const paths = (f.paths || []);
        if (!paths.length) return { text: 'I can’t find a folder called **' + folder + '**. Add it in **Settings → Project folders** (paste its full path, e.g. `C:\\Users\\you\\Desktop\\' + folder + '`), then ask again.' };
        return { text: 'I found **' + folder + '** at `' + paths[0] + '`' + (paths.length > 1 ? ' (and ' + (paths.length - 1) + ' other place' + (paths.length > 2 ? 's' : '') + ')' : '') + ', but JARVIS isn’t allowed to use that folder yet. Allow it? (It’s added to Settings → Project folders; you can remove it there any time.)', intent: 'CODE_ASK',
          actions: paths.slice(0, 3).map((pth, i) => ({ label: paths.length > 1 ? 'ALLOW ' + (i + 1) + ': …' + pth.slice(-38) : 'ALLOW & CONTINUE', fn: async () => {
            const r = await callTool('/config', { action: 'add', path: pth });
            if (r.error) return jarvisSay({ text: 'Couldn’t add it: ' + r.error, intent: 'CODE_ASK' });
            if (r.roots) renderRoots(r.roots);
            log('ok', 'project folder added: ' + pth);
            await deliver(await executeTool({ ...p, args: { tool, folder: pth.split(/[\\/]/).pop(), prompt } }, raw), p);
          } })) };
      }
      const label = CODE_TOOL_LABELS[tool] || tool;
      const folderLabel = folder || '~/jarvis';
      return { text: 'Ask **' + label + '** in `' + folderLabel + '` to: ' + prompt + '?', confirm: { yes: 'SEND', no: 'CANCEL', onConfirm: async () => {
        toolStep('codeAsk → ' + tool + ' ' + folderLabel);
        const r = await callTool('/tool/codeAsk', { tool, folder, prompt });
        if (r.error) { jarvisSay({ text: 'Could not reach ' + label + ': ' + r.error + '.', intent: 'CODE_ASK' }); return; }
        ctx.lastProject = r.folder;
        const how = r.kind !== 'open' ? '.' : r.pasted ? ' — pasted your request into its chat and pressed Enter.'
          : r.pasteNote === 'front' ? '. Your request is copied — **click OpenCode’s chat box, press Ctrl+V, then Enter.** (If it opened a different project, pick **' + r.folder.split('/').pop() + '** in OpenCode first.)'
          : ' — I couldn’t type into its window' + (r.pasteNote === 'skipped:not-in-front' ? ' (another window was in front)' : r.pasteNote === 'skipped:no-window' ? ' (it took too long to open)' : '') + ', so your request is on the clipboard: click in its chat box and press **Ctrl+V**, then Enter.';
        jarvisSay({ text: 'Sent to **' + r.tool + '** in `' + r.folder + '`' + how, intent: 'CODE_ASK', tool: 'codeAsk' });
      } } };
    }
    case 'RUN_FILE': {
      let name = a.name || (p.original.match(/([\w\-.\/\\:]+\.(?:py|js|mjs|c|cpp|cc))\b/i) || [])[1] || '';
      if (!name) {
        if (/\b(the|that|this) (code|program|script)\b/.test(s) && lastCode() && RUNNABLE.test(LANG_EXT[lastCode().lang] || '')) {
          const c = lastCode();
          const r0 = await callTool('/tool/writeFile', { name: 'Code/scratch' + LANG_EXT[c.lang], content: c.code + '\n', overwrite: true });
          if (r0.error) return { text: 'Could not prepare the code: ' + r0.error };
          name = r0.name;
        } else name = ctx.lastFile || '';
      }
      if (!name) return { text: 'Which file should I run? e.g. "run bfs.py".', suggestions: ['List my files'] };
      if (!RUNNABLE.test(name)) return { text: 'I can run .py, .js, .c and .cpp files — `' + name + '` is not one of those.' };
      const im = p.original.match(/\b(?:with|using) input\s+["']?(.+?)["']?$/i);
      const stdin = im ? im[1].split(/\s*(?:;|\\n|\|)\s*/).join('\n') + '\n' : '';
      setState('EXECUTING', 'Running ' + name.split('/').pop() + '…'); toolStep('runFile → ' + name);
      let r = await callTool('/tool/runFile', { name, stdin });
      if (r.choices) return { text: 'I found ' + r.choices.length + ' files called **' + name + '** — say which one, e.g. “run ' + r.choices[0] + '”:\n\n' + r.choices.map((x, i) => (i + 1) + '. `' + x + '`').join('\n'), noPersona: true };
      if (r.error) return { text: cap(r.error) + '.' };
      ctx.lastFile = r.name; bumpStat('codeRuns');
      const meta = 'RUN_FILE · ' + r.lang + ' · exit ' + r.exitCode + ' · ' + r.ms + 'ms';
      const fixAct = llmReady() ? [{ label: '🛠 EXPLAIN & FIX', fn: () => fixCode(r, im ? im[1] : '') }] : undefined;
      if (r.compileError) return { actions: fixAct, text: '❌ **Compilation failed** for `' + r.name + '`:\n```text\n' + (r.stderr || r.stdout).trim() + '\n```', speak: 'Compilation failed. The errors are on screen.', meta, suggestions: llmReady() ? ['Explain this error and fix the code'] : null };
      let out = '**Ran `' + r.name + '`** ' + (r.timedOut ? '⏱ stopped after 10s' : r.exitCode === 0 ? '✓' : '✗ exit ' + r.exitCode) + '\n';
      if (r.stdout.trim()) out += '```text\n' + r.stdout.replace(/\s+$/, '') + '\n```\n';
      if (r.stderr.trim()) out += 'stderr:\n```text\n' + r.stderr.replace(/\s+$/, '') + '\n```';
      if (!r.stdout.trim() && !r.stderr.trim()) out += '_(no output)_';
      const needsInput = /EOFError|input\(\)|Scanner|NoSuchElement/.test(r.stderr) || r.timedOut;
      const sugg = [];
      if (r.exitCode !== 0 && llmReady()) sugg.push('Explain this error and fix the code');
      if (needsInput) sugg.push('Run it with input 5');
      sugg.push('Open it in VS Code');
      const short = r.stdout.trim().split('\n');
      return { text: out, meta, suggestions: sugg, actions: r.exitCode !== 0 && !r.timedOut ? fixAct : undefined, speak: r.exitCode !== 0 ? 'It exited with an error. Details are on screen.' : short.length === 1 && short[0].length < 80 ? 'Output: ' + short[0] : 'Done. The output is on screen.' };
    }
    case 'LOCATE_PROJECT': {
      const m = p.original.match(/^(?:locate|find|where'?s|where is)\s+(?:my\s+|the\s+)?(.+?)\s+(?:project|folder)\b/i);
      const name = (a.name || (m ? m[1].trim() : '')).trim();
      if (!name) return { text: 'Which project?' };
      toolStep('locateProject → ' + name);
      const r = await callTool('/tool/locateProject', { name });
      if (r.error) return { text: cap(r.error) + '.' };
      ctx.lastProject = r.name; if (r.path) { setFocus('folder', r.path); setFocus('project', r.path); }
      return { text: '✓ Found `' + r.name + '`.', op: { kind: 'project', name: r.name }, tool: 'locateProject' };
    }
    case 'START_PROCESS': {
      const m = p.original.match(/^start\s+(?:the\s+|my\s+)?(.+?)(?:'s)?\s+(backend|frontend|server|app)\b/i);
      const name = (a.name || (m ? m[1].trim() : '')).trim();
      const which = a.which || (m ? ({ server: 'backend' }[m[2].toLowerCase()] || m[2].toLowerCase()) : '');
      if (!name || !which) return { text: 'Which project, and backend or frontend?' };
      toolStep('startProcess → ' + name + ' ' + which);
      const r = await callTool('/tool/startProcess', { name, which });
      if (!r.success) {
        // The project simply has no backend/frontend: not a failure, just nothing to start.
        if (/^No (backend|frontend|app) found/.test(r.error || '')) return { text: 'no ' + which + ' in this project', absent: true, tool: 'startProcess' };
        if (r.portInUse) return { text: 'Port ' + (r.port || '?') + ' is already in use, so the ' + which + ' for "' + name + '" did not start.', portInUse: true, port: r.port, project: name, which, tool: 'startProcess' };
        return { text: 'Could not start the ' + which + ' for "' + name + '"' + (r.error ? ': ' + r.error : (r.tail ? ':\n```text\n' + r.tail.trim().slice(-400) + '\n```' : '.')),
          // project/which/tail let a multi-step plan diagnose the crash (and, for missing dependencies, offer to install them).
          startFailed: !r.error, missingDeps: r.missingDeps || null, project: name, which, tail: r.tail || '', tool: 'startProcess' };
      }
      ctx.lastProject = name;
      // A server JARVIS just started can be stopped again ("undo", or ROLLBACK on a failed plan); one that was already running is left alone.
      if (!r.existed) Undo.push('started the ' + which + ' for ' + name, async () => { const x = await callTool('/tool/stopProcess', { name, which }); if (x.error) throw new Error(x.error); return 'Stopped the ' + which + ' for `' + name + '`.'; });
      return { text: (r.existed ? '✓ The ' + which + ' for `' + name + '` is already running' : '✓ Started the ' + which + ' for `' + name + '`') + (r.port ? ' on port ' + r.port : '') + '.', op: { kind: 'process', name, which, id: r.id, port: r.port }, tool: 'startProcess' };
    }
    case 'STOP_PROCESS': {
      const m = p.original.match(/^stop\s+(?:the\s+|my\s+)?(.+?)(?:'s)?\s+(backend|frontend|server|app)\b/i);
      const name = (a.name || (m ? m[1].trim() : '')).trim();
      const which = a.which || (m ? ({ server: 'backend' }[m[2].toLowerCase()] || m[2].toLowerCase()) : '');
      if (!name || !which) return { text: 'Which project, and backend or frontend?' };
      toolStep('stopProcess → ' + name + ' ' + which);
      const r = await callTool('/tool/stopProcess', { name, which });
      if (r.error) return { text: cap(r.error) + '.' };
      return { text: '✓ Stopped the ' + which + ' for `' + name + '`.', op: { kind: 'process_stopped', name, which }, tool: 'stopProcess' };
    }
    case 'CHECK_COMPILER': {
      const r = await callTool('/tool/checkCompiler', { language: a.language });
      if (r.error) return { text: cap(r.error) + '.' };
      return { text: r.found ? '✓ ' + r.label + ' is installed' + (r.path ? ' (`' + r.path + '`)' : '') + '.' : '✗ ' + r.label + ' was not found on your PATH.', op: { kind: 'toolchain_check', found: r.found, label: r.label }, tool: 'checkCompiler' };
    }
    case 'TOOL_VERSION': {   // what's installed on THIS laptop — not the latest release (that's a web question)
      const tool = a.tool || (s.match(/\b(node(?:\.?js)?|python3?|npm|pip|git|javac|java|g\+\+|c\+\+|gcc|ollama|docker|vs ?code|visual studio code)\b/) || [])[1] || '';
      if (!tool) return { text: 'Which one — Node, Python, npm, Git, Java, gcc, Ollama, Docker or VS Code?' };
      toolStep('toolVersion → ' + tool);
      const r = await callTool('/tool/toolVersion', { tool: tool.replace(/\.?js$/, '').replace(/^visual studio code$/, 'vscode') });
      if (r.error) return { text: cap(r.error) + '.' };
      noteTrace('checked', r.label + ' on this laptop');
      return r.found ? { text: 'You’re running **' + r.label + ' ' + r.version + '** on this laptop.', speak: r.label + ' ' + r.version + '.', tool: 'toolVersion', suggestions: settings.online ? ['What is the latest ' + r.label + ' version?'] : null }
        : { text: '**' + r.label + '** isn’t installed on this laptop (or isn’t on your PATH).', tool: 'toolVersion' };
    }
    case 'RECENT_FILES': {   // "what's the latest file in my project": newest-modified files, in the project / folder meant
      const proj = await resolveProject(p.original);
      if (proj && proj.ask) return proj.ask;
      const sc = proj && proj.path ? null : scopeFrom(p.original);
      const dir = (proj && proj.path) || (sc && (sc.path || sc.scope)) || (focusOf('project') || focusOf('folder') || {}).path || '';
      if (/\bproject\b/.test(s) && !dir) return { text: 'Which project, ' + Persona.sir() + '? Say its name — e.g. "the latest file in the calculator project".' };
      toolStep('recentFiles → ' + (dir || '~/jarvis'));
      const r = await callTool('/tool/recentFiles', { dir, n: 5 });
      if (r.error) return pickPlace(r, dir, async x => executeTool({ ...p, args: { ...a } }, raw)) || { text: cap(r.error) + '.' };
      if (!r.files.length) return { text: 'There are no files in `' + r.dir + '`.' };
      setFocus('folder', r.dir); setResults(r.files.map(f => f.path)); setFocus('file', r.files[0].path);
      const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
      return { text: 'The newest file in `' + r.dir + '` is **' + r.files[0].name + '** (changed ' + ago(r.files[0].modified) + ').' + (r.files.length > 1 ? '\n\nRecently changed:\n' + r.files.map((f, i) => (i + 1) + '. `' + f.name + '` — ' + ago(f.modified)).join('\n') : '') + '\n\n_Say "open it" or "open the second one"._',
        speak: 'The newest file is ' + r.files[0].name.split(/[\\/]/).pop() + '.', tool: 'recentFiles' };
    }
    case 'CHECK_EXTENSION': {
      const r = await callTool('/tool/checkExtension', { language: a.language });
      if (r.error) return { text: cap(r.error) + '.' };
      if (!r.applicable) return { text: 'No specific VS Code extension needed for this.', tool: 'checkExtension' };
      return { text: r.found ? '✓ The recommended VS Code extension (`' + r.extension + '`) is installed.' : '○ The recommended VS Code extension (`' + r.extension + '`) is not installed — you can add it from the Extensions panel.', op: { kind: 'extension_check', found: r.found }, tool: 'checkExtension' };
    }
    case 'CHECK_EXISTS': {
      const m = p.original.match(/\bcheck\s+(?:if|whether)\s+(.+?)\s+exists?\b/i) || p.original.match(/\bdoes\s+(.+?)\s+exist\b/i)
        || p.original.match(/^is there (?:a |an )?(?:file|folder|note|document)\s+(?:called|named)\s+(.+?)[.?!]*$/i)
        || p.original.match(/^do i have (?:a |an )?(?:file|folder|note)\s+(?:called|named)\s+(.+?)[.?!]*$/i);
      const name = (a.name || (m ? m[1] : '')).trim().replace(/^(?:a|an|the|my)\s+/i, '').replace(/\s+(?:folder|file|note|document)$/i, '').trim();
      if (!name) return { text: 'Check whether what exists?' };
      toolStep('exists → ' + name);
      // Where it looks, in order: ~/jarvis (exact), your project folders (forgiving: "dsa sprint" and even a misheard
      // "dss print" find dsa_sprint), then — for folders — the rest of the laptop (Desktop, Documents, Downloads, drives).
      const r = await callTool('/agent/exists', { name });
      if (r.exists) return { text: '✓ Yes — `' + name + '` exists' + (r.dir ? ' (a folder)' : ' (a file)') + ' in `~/jarvis`.', tool: 'checkExists' };
      const wantsFile = /\.[a-z0-9]{1,5}$/i.test(name) || /\b(file|note|document)\b/i.test(p.original);
      const shown = x => x.split(/[\\/]/).pop();
      const tookAs = x => shown(x).toLowerCase().replace(/[\s_-]+/g, ' ') !== name.toLowerCase().replace(/[\s_-]+/g, ' ') ? ' (I took “' + name + '” to mean that)' : '';
      if (!wantsFile) {
        // Found under a DIFFERENT name ("calculater" → calculator): ask, don't assume.
        const askIfClose = (paths, how) => {
          const close = paths.filter(x => tookAs(x));
          if (!close.length || close.length < paths.length) return null;
          return didYouMeanReply(name, close.slice(0, 5).map(x => ({ path: x, name: shown(x), dir: true })), 'I don’t see a folder named exactly **' + name + '**' + (how || '') + '.', 'show');
        };
        const l = await callTool('/tool/locateProject', { name });
        if (l.success && askIfClose([l.path], ' in your projects')) return askIfClose([l.path], ' in your projects');
        if (l.success) { if (l.path) setFocus('folder', l.path); return { text: '✓ Yes — the folder **' + shown(l.path) + '** is at `' + l.path + '`' + tookAs(l.path) + '.', tool: 'checkExists',
          suggestions: ['Open vs code in ' + shown(l.path), 'Open the ' + shown(l.path) + ' folder'] }; }
        toolStep('findFolderAnywhere → ' + name);
        const f = await callTool('/tool/findFolderAnywhere', { name });
        if (f.error && f.error !== 'Invalid folder name') return { text: 'I couldn’t search the laptop for **' + name + '**: ' + f.error, error: f.error };
        const paths = f.paths || [];
        if (paths.length && askIfClose(paths, ' on this laptop')) return askIfClose(paths, ' on this laptop');
        if (paths.length) { setFocus('folder', paths[0]); setResults(paths.slice(0, 30)); return { text: '✓ Yes — found **' + shown(paths[0]) + '** at `' + paths[0] + '`' + tookAs(paths[0]) + (paths.length > 1 ? ' (and ' + plural(paths.length - 1, 'other place') + ')' : '') +
          (paths.length > 1 ? ':\n' + paths.map((x, i) => (i + 1) + '. `' + x + '`').join('\n') : '.'), tool: 'checkExists',
          actions: paths.slice(0, 3).flatMap((pth, i) => {
            const n = paths.length > 1 ? ' ' + (i + 1) : '';
            return [{ label: 'OPEN IN VS CODE' + n, fn: async () => { const o = await callTool('/tool/openInEditor', { name: pth }); jarvisSay({ text: o.error ? cap(o.error) + '.' : 'Opening `' + pth + '` in **VS Code**.', intent: 'CHECK_EXISTS' }); } },
                    { label: 'OPEN FOLDER' + n, fn: async () => { const o = await callTool('/tool/openFolder', { name: pth }); jarvisSay({ text: o.error ? cap(o.error) + '.' : 'Opening `' + pth + '` in your file explorer.', intent: 'CHECK_EXISTS' }); } }];
          }) }; }
      } else {
        const sf = await callTool('/tool/searchFiles', { query: name.replace(/\.[a-z0-9]{1,5}$/i, '') });
        if (sf.error) return { text: 'I couldn’t search for **' + name + '**: ' + sf.error, error: sf.error };
        const hits = (sf.results || []).filter(x => !String(x).endsWith('/'));   // paths; folders end in "/"
        if (hits.length) return { text: '✓ Yes — ' + hits.slice(0, 3).map(x => '`' + x + '`').join(', ') + '.', tool: 'checkExists' };
      }
      // Not found: say what was really searched, and show near misses ("calculator" → calculator.html, Calculator.lnk…)
      // so the answer is useful, not just "no".
      const idx = await fetch(API + '/fileIndex/status').then(x => x.json()).catch(() => ({}));
      const kind = wantsFile ? 'file' : 'folder';
      const scope = idx && idx.ready ? 'anywhere on this laptop (I checked all ' + Number(idx.count).toLocaleString() + ' files and folders on every drive, apart from system, hidden and build folders)'
        : 'in ~/jarvis, your project folders or the usual places (the full laptop list is still being built — ask again in a moment)';
      // Close names first ("calculater", "calc_app", "my-calculator"): ask "Did you mean…?" instead of a flat no.
      const sims = await similarTo(name, kind);
      if (sims.length) return didYouMeanReply(name, sims, '✗ No ' + kind + ' named exactly **' + name + '** ' + scope + '.', 'show');
      const near = await callTool('/tool/searchFiles', { query: name.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 40) }).catch(() => ({}));
      const nearPaths = (near.paths || []).slice(0, 30), nearShown = (near.results || []).slice(0, 30);
      const order = nearShown.map((x, i) => ({ x, p: nearPaths[i] || x, dir: /[\\/]$/.test(x) })).sort((u, v) => v.dir - u.dir).slice(0, 6);
      if (order.length) setResults(order.map(o => o.p));
      return { text: '✗ No ' + kind + ' named **' + name + '** ' + scope + '.' + (order.length
          ? '\n\nThese have “' + name + '” in their name:\n' + order.map((o, i) => (i + 1) + '. ' + (o.dir ? '📁 ' : '📄 ') + '`' + o.x + '`').join('\n') + '\n\n_Say "open the first one", or "create a folder called ' + name + ' on my desktop"._'
          : '\n\nWant me to make it? Say **"create a folder called ' + name + ' on my desktop"** (or in D drive).'),
        speak: 'No, there is no ' + kind + ' called ' + name + ' on this laptop.', tool: 'checkExists',
        suggestions: wantsFile ? null : ['Create a folder called ' + name + ' on my desktop'] };
    }
    case 'SHOW_PICK': {   // the answer to "Did you mean…?"
      const pth = a.path, nm = String(pth).split(/[\\/]/).filter(Boolean).pop();
      setFocus(a.dir ? 'folder' : 'file', pth);
      if (a.open) return openFocusPath(pth);
      return { text: '✓ **' + nm + '** is at `' + pth + '`.', speak: 'Got it — ' + nm + '.', tool: 'checkExists',
        suggestions: a.dir ? ['Open it', 'List files there', 'How many folders are there'] : ['Open it'] };
    }
    case 'WHY_ACTION': return Agent.explainLastAction(p.original);
    case 'LEARN_LIST': return Agent.learnedSummary();
    case 'MISSES_LIST': {
      const list = Agent.missList().slice(0, 6);
      if (!list.length) return { text: 'Nothing lately — every recent request matched a command, ' + Persona.sir() + '.', noPersona: true };
      const how = { planner: 'guessed by the AI', corrected: 'you corrected me', 'not understood': 'not understood (AI offline)' };
      const teachAsk = m => () => { ctx.pending = { intent: 'TEACH', phrase: m.original }; jarvisSay({ text: 'What should I do when you say **“' + m.original + '”**? Type the command, e.g. "set volume to 30" or "open vs code and start a focus session". ("cancel" to skip.)', intent: 'LEARN_TEACH', noPersona: true }); };
      return { text: 'Phrases I didn’t understand recently:\n' + list.map((m, i) => (i + 1) + '. “' + m.original + '” — ' + (how[m.how] || m.how)).join('\n') + '\n\nTap **TEACH** to tell me what one should do.',
        noPersona: true, actions: list.slice(0, 4).map((m, i) => ({ label: 'TEACH ' + (i + 1), fn: teachAsk(m) })).concat([{ label: 'CLEAR LIST', fn: () => { Agent.missList().forEach(m => Agent.forgetMiss(m.phrase)); toast('Cleared'); } }]) };
    }
    case 'LEARN_FORGET_ALL': {
      const n = Agent.learnedCount();
      if (!n) return { text: 'I hadn’t learned anything yet.', tool: 'forgetLearned' };
      return { text: 'Forget all ' + plural(n, 'learned phrase') + '?', confirm: { yes: 'FORGET', no: 'KEEP', onConfirm: () => {
        Agent.forgetAllLearned(); jarvisSay({ text: '✓ Forgot ' + plural(n, 'learned phrase') + '.', intent: 'LEARN_FORGET_ALL' });
      } } };
    }
    case 'OPEN_PROJECT_URL': {
      const name = a.name; const which = a.which || 'frontend';
      if (!name) return { text: 'Which project?' };
      const st = await callTool('/tool/processStatus', { name, which });
      const port = st.found && st.port ? st.port : (which === 'frontend' ? 3000 : 8000);
      const guessed = !(st.found && st.port);
      toolStep('openUrl → localhost:' + port);
      const r = await callTool('/tool/openUrl', { url: 'http://localhost:' + port });
      if (r.error) return { text: 'Could not open the browser: ' + r.error };
      return { text: '✓ Opening `http://localhost:' + port + '`' + (guessed ? ' (its port wasn’t detected yet, so this is a guess)' : '') + '.', op: { kind: 'browser_url', url: 'http://localhost:' + port, guessed }, tool: 'openUrl' };
    }

    /* ---- snippets ---- */
    case 'SNIPPET_SAVE': {
      const m = p.original.match(/as (?:a |my )?snippet(?:\s+(?:called|named))?\s+["']?(.+?)["']?\s*$/i) || p.original.match(/snippet\s+(?:called|named)\s+["']?(.+?)["']?(?:\s+from.*)?$/i) || p.original.match(/^(?:save|add|new) (?:a )?snippet\s+["']?(.+?)["']?(?:\s+from.*)?$/i);
      const name = a.name || (m ? m[1].trim() : '');
      let code = null;
      if (/\b(clipboard|copied)\b/.test(s)) { const c = await readClip(); if (c) code = { lang: guessLang(c), code: c }; }
      else code = lastCode();
      if (!code) return { text: /clipboard/.test(s) ? 'Your clipboard is empty.' : 'There is no code in our chat to save. Copy some code and say "save my clipboard as snippet …".' };
      if (!name) return { text: 'What should I call this snippet? e.g. "save that code as snippet binary search".' };
      snippets = snippets.filter(x => x.name.toLowerCase() !== name.toLowerCase());
      snippets.unshift({ id: rid(), name, lang: code.lang || '', code: code.code, ts: Date.now() }); saveSnippets();
      toolStep('saveSnippet → ' + name);
      return { text: '✓ Saved snippet **' + name + '** (' + plural(lines(code.code), 'line') + (code.lang ? ' of ' + code.lang : '') + '). Say "copy snippet ' + name + '" anytime.', speak: 'Snippet saved.', tool: 'snippets' };
    }
    case 'SNIPPET_COPY': {
      const m = p.original.match(/snippet\s+(?:called\s+|named\s+)?["']?(.+?)["']?(?:\s+(?:to|into|in|on)\s+(?:my\s+|the\s+)?(?:clipboard|editor|vs ?code|window|active window))?\s*$/i);
      const sn = findSnippet(a.name || (m ? m[1] : ''));
      if (!sn) return { text: snippets.length ? 'I could not find that snippet. You have: ' + snippets.map(x => '**' + x.name + '**').join(', ') + '.' : 'You have no snippets yet.' };
      if (/\b(paste|insert)\b|\b(editor|vs ?code|window)\b/.test(s)) return pasteToActiveWindow(sn.code, 'snippet **' + sn.name + '**');
      await copyText(sn.code);
      return { text: '✓ Copied snippet **' + sn.name + '** to your clipboard.\n```' + (sn.lang || '') + '\n' + sn.code.slice(0, 1500) + '\n```', speak: 'Copied ' + sn.name + '.', tool: 'snippets' };
    }
    case 'SNIPPET_LIST': {
      switchTab('memory');
      if (!snippets.length) return { text: 'No snippets yet. Copy some code and say "save my clipboard as snippet binary search".' };
      return { text: 'Your snippets:\n' + snippets.map(x => '- **' + x.name + '**' + (x.lang ? ' · ' + x.lang : '') + ' · ' + plural(lines(x.code), 'line')).join('\n'), speak: 'You have ' + plural(snippets.length, 'snippet') + '.' };
    }
    case 'SNIPPET_DELETE': {
      const m = p.original.match(/snippet\s+(?:called\s+|named\s+)?["']?(.+?)["']?\s*$/i);
      const sn = findSnippet(m ? m[1] : '');
      if (!sn) return { text: 'I could not find that snippet.' };
      return { text: 'Delete snippet **' + sn.name + '**?', confirm: { yes: 'DELETE', no: 'KEEP', onConfirm: () => withHello('data', () => {
        undoRemoved('deleted snippet ' + sn.name, () => snippets, v => { snippets = v; }, saveSnippets, removedFrom(snippets, x => x !== sn));
        snippets = snippets.filter(x => x !== sn); saveSnippets();
        jarvisSay({ text: 'Deleted snippet **' + sn.name + '**.', intent: 'SNIPPET_DELETE' });
      }) } };
    }

    /* ---- git / dev ---- */
    case 'GIT_STATUS': { toolStep('gitStatus'); const r = await callTool('/tool/gitStatus'); return r.error ? { text: 'Git: ' + r.error + '.' } : { text: '```text\n' + r.output + '\n```', speak: r.output === 'Working tree clean' ? 'Working tree is clean.' : 'Here is the git status.', tool: 'gitStatus' }; }
    case 'GIT_LOG': { toolStep('gitLog'); const r = await callTool('/tool/gitLog'); return r.error ? { text: 'Git: ' + r.error + '.' } : { text: 'Recent commits:\n```text\n' + r.output + '\n```', speak: 'Here are the recent commits.', tool: 'gitLog' }; }
    case 'GIT_DIFF': { toolStep('gitDiff'); const r = await callTool('/tool/gitDiff'); return r.error ? { text: 'Git: ' + r.error + '.' } : { text: '```text\n' + r.output + '\n```', speak: 'Here is what changed.', tool: 'gitDiff' }; }
    case 'GIT_COMMIT': {
      const m = p.original.match(/(?:message|saying|:)\s+["']?(.+?)["']?$/i) || p.original.match(/\bwith\s+["']?(.+?)["']?$/i);
      if (!m) { ctx.pending = { intent: 'GIT_COMMIT' }; return { text: 'What commit message should I use?' }; }
      // Which project, and exactly which files, is decided here and shown BEFORE anything is staged; secrets stop it (gitsafe.js on the server).
      const rm = p.original.match(/\b(?:in|for|on)\s+(?:the\s+)?([\w.-]+)\s+(?:project|repo|repository)\b|\b(?:project|repo|repository)\s+([\w.-]+)\b|\bin\s+([\w.-]+)\s+(?:with|saying|message|:)/i);
      const repo = rm ? (rm[1] || rm[2] || rm[3]) : '';
      const pend = await callTool('/tool/gitPending', { repo });
      if (pend.error) return { text: cap(pend.error.replace(/\.$/, '')) + '.' + (pend.choices && pend.choices.length ? '\nYour git projects: ' + pend.choices.map(c => '**' + c + '**').join(', ') + '.' : '') };
      if (pend.secrets && pend.secrets.length) return { text: '⚠ I won’t commit **' + pend.repo + '**: ' + pend.secrets.slice(0, 4).map(x => '`' + x.path + '` (' + x.why + ')').join('; ') + '.\nAdd ' + (pend.secrets.length > 1 ? 'them' : 'it') + ' to `.gitignore`, or commit by hand if you are sure.' };
      if (!pend.count) return { text: 'There is nothing to commit in **' + pend.repo + '**.' };
      const list = pend.files.slice(0, 12).map(f => '- `' + f.code + '` ' + f.path).join('\n') + (pend.count > 12 ? '\n- …and ' + (pend.count - 12) + ' more' : '');
      return { text: 'Commit **' + plural(pend.count, 'file') + '** in **' + pend.repo + '** with message "' + m[1] + '"?\n' + list, confirm: { yes: 'COMMIT', no: 'CANCEL', onConfirm: async () => {
        toolStep('gitCommit'); const r = await callTool('/tool/gitCommit', { message: m[1], repo: pend.repo });
        jarvisSay({ text: r.error ? 'Commit failed: ' + r.error : 'Committed ' + plural(r.files, 'file') + ' in **' + r.repo + '**.\n```text\n' + r.output + '\n```', intent: 'GIT_COMMIT' });
      } } };
    }
    case 'CHECK_PORT': {
      const m = s.match(/\b(\d{2,5})\b/);
      if (!m) return { text: 'Which port should I check?' };
      toolStep('checkPort → ' + m[1]);
      const r = await callTool('/tool/checkPort', { port: +m[1] });
      return r.error ? { text: r.error } : { text: 'Port **' + m[1] + '** is ' + (r.inUse ? 'in use.' : 'free.'), tool: 'checkPort' };
    }

    /* ---- git clone / drafting ---- */
    case 'GIT_CLONE': {
      let url = a.url || (p.original.match(/https?:\/\/\S+/) || [])[0];
      if (!url) { const m = p.original.match(/\b([\w.-]+)\/([\w.-]+)\b/); if (m && /github/i.test(p.original)) url = 'https://github.com/' + m[1] + '/' + m[2]; }
      if (!url) return { text: 'Give me the repo URL, e.g. "clone https://github.com/user/repo".' };
      setState('EXECUTING', 'Cloning repository…'); toolStep('gitClone → ' + url);
      const r = await callTool('/tool/gitClone', { url: url.replace(/[.,)]+$/, '') });
      if (r.error) return { text: 'Clone failed: ' + r.error + '.', suggestions: r.name ? ['Open ' + r.name.split('/').pop() + ' in VS Code'] : null };
      ctx.lastFile = r.name;
      return { text: '✓ Cloned into `' + r.name + '` (' + plural(r.files, 'item') + ').', speak: 'Cloned the repository.', suggestions: ['Open it in VS Code', 'List files in ' + r.name.split('/').pop()], tool: 'gitClone' };
    }
    case 'DRAFT_COPY': {
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) to write that.' };
      return { askLLM: (a.prompt || p.original) + '\n\n(Reply with just the requested text, ready to paste — no preamble.)', after: { copyAnswer: true } };
    }

    /* ---- clipboard & code helper ---- */
    case 'EXPLAIN_CLIPBOARD': {
      toolStep('readClipboard → llm');
      const r = await callTool('/tool/readClipboard', {});
      if (!r.content) return { text: 'Your clipboard is empty — copy the code or error first, then ask again.' };
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) for that. Here is what is on your clipboard:\n```\n' + r.content.slice(0, 3000) + '\n```' };
      return { askLLM: raw + '\n\nHere is the content from my clipboard:\n```\n' + r.content.slice(0, 8000) + '\n```' };
    }
    case 'READ_CLIPBOARD': {
      toolStep('readClipboard');
      const r = await callTool('/tool/readClipboard', {});
      if (!r.content) return { text: 'Your clipboard is empty.' };
      const code = r.content.includes('\n') || r.content.length > 120;
      return { text: code ? 'Your clipboard contains:\n```\n' + r.content.slice(0, 4000) + '\n```' : 'Your clipboard says: "' + r.content + '"', suggestions: code ? ['Explain the code in my clipboard'] : null, tool: 'readClipboard' };
    }
    case 'WRITE_CLIPBOARD': {
      const m = p.original.match(/(?:copy|put|write|save)\s+["']?(.+?)["']?\s+(?:to|in|into|on)\s+(?:the\s+|my\s+)?clipboard/i);
      if (!m) return { text: 'What should I copy?' };
      toolStep('writeClipboard');
      const r = await callTool('/tool/writeClipboard', { text: m[1] });
      return r.error ? { text: 'Clipboard write failed: ' + r.error } : { text: 'Copied "' + m[1] + '" to your clipboard.', tool: 'writeClipboard' };
    }

    /* ---- clipboard power tools ---- */
    case 'CLIP_TOOL': {
      toolStep('clipTool');
      const c = await readClip();
      if (!c) return { text: 'Your clipboard is empty.' };
      let out = null, label = '';
      try {
        if (/json/.test(s)) {
          const v = JSON.parse(c);
          if (/\bvalidate\b/.test(s)) return { text: '✓ Valid JSON (' + (Array.isArray(v) ? 'array of ' + v.length : typeof v === 'object' && v ? Object.keys(v).length + ' keys' : typeof v) + ').' };
          out = /\bminify\b/.test(s) ? JSON.stringify(v) : JSON.stringify(v, null, 2); label = /\bminify\b/.test(s) ? 'minified JSON' : 'formatted JSON';
        } else if (/\b(count|how many)\b/.test(s)) {
          const words = (c.match(/\S+/g) || []).length;
          return { text: 'Your clipboard has **' + words.toLocaleString() + ' words**, ' + c.length.toLocaleString() + ' characters and ' + plural(lines(c), 'line') + '.' };
        } else if (/upper ?case/.test(s)) { out = c.toUpperCase(); label = 'UPPERCASE text'; }
        else if (/lower ?case/.test(s)) { out = c.toLowerCase(); label = 'lowercase text'; }
        else if (/title ?case|capitali[sz]e/.test(s)) { out = c.toLowerCase().replace(/\b\w/g, x => x.toUpperCase()); label = 'Title Case text'; }
        else if (/base ?64/.test(s) && /decode/.test(s)) { out = decodeURIComponent(escape(atob(c.trim()))); label = 'decoded text'; }
        else if (/base ?64/.test(s) || (/encode/.test(s) && !/url/.test(s))) { out = btoa(unescape(encodeURIComponent(c))); label = 'Base64'; }
        else if (/url/.test(s) && /decode/.test(s)) { out = decodeURIComponent(c); label = 'URL-decoded text'; }
        else if (/url/.test(s)) { out = encodeURIComponent(c); label = 'URL-encoded text'; }
        else if (/\bsort\b/.test(s)) { out = c.split('\n').sort((x, y) => x.localeCompare(y)).join('\n'); label = 'sorted lines'; }
        else if (/dedupe|duplicate/.test(s)) { out = [...new Set(c.split('\n'))].join('\n'); label = 'unique lines'; }
        else if (/reverse/.test(s)) { out = c.split('\n').reverse().join('\n'); label = 'reversed lines'; }
        else if (/trim|clean|whitespace|spaces/.test(s)) { out = c.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim(); label = 'cleaned text'; }
      } catch (e) { return { text: '❌ That did not work: ' + e.message + '.' }; }
      if (out === null) return { askLLM: true };
      await copyText(out);
      return { text: '✓ Your clipboard now holds the **' + label + '**.\n```' + (/json/i.test(label) ? 'json' : 'text') + '\n' + out.slice(0, 2000) + (out.length > 2000 ? '\n…' : '') + '\n```', speak: 'Done. Your clipboard now holds the ' + label + '.', tool: 'clipTool' };
    }
    case 'CLIP_TRANSFORM': {
      toolStep('readClipboard → llm');
      const c = await readClip();
      if (!c) return { text: 'Your clipboard is empty — copy the code first.' };
      if (!llmReady()) return { text: 'I need my AI brain (Ollama) for that.' };
      return { askLLM: raw + '\n\nHere is the code from my clipboard:\n```\n' + c.slice(0, 8000) + '\n```\n\nReply with ONLY the complete resulting code in one fenced code block, then at most two short sentences on what changed.', after: { copyBack: true } };
    }
    case 'SUMMARISE_LINK': {
      if (!settings.online) return { text: 'Reading web pages needs Online tools, which are off. Enable them?', actions: enableOnlineAction() };
      let url = (p.original.match(/https?:\/\/\S+/) || [])[0];
      if (!url) { const c = await readClip(); url = (c.match(/https?:\/\/\S+/) || [])[0]; }
      if (!url) return { text: 'I could not find a link — copy a URL first, then ask again.' };
      toolStep('fetchPage → ' + url);
      const r = await callTool('/tool/fetchPage', { url, online: true });
      if (r.error) return { text: r.error + '.' };
      if (!llmReady()) return { text: '**' + (r.title || url) + '**\n\n' + r.text.slice(0, 700) + '…' };
      return { askLLM: 'Summarise this web page for me in 4-6 bullet points, then one line on why it matters.\nTitle: ' + r.title + '\nURL: ' + r.url + '\n\n' + r.text };
    }

    default: return ToolHandlers.NONE;
  }
});
