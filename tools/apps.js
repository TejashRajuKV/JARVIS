'use strict';
/* executeTool, apps: opening and closing apps.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('apps', async function (p, raw, s, a) {
  switch (p.intent) {
    /* ---- apps ---- */
    case 'OPEN_APPLICATION': {
      const q = a.app || s;
      const app = NLU.findApp(q);
      if (app) {
        toolStep('openApplication → ' + app.k);
        const r = await callTool('/tool/openApplication', { app: app.k });
        if (r.error) return { text: 'I could not open ' + app.n + ' — ' + r.error + '.' };
        ctx.lastApp = app.k; ctx.lastAppT = Date.now();
        { const at = Date.now(); Undo.push('opened ' + app.n, async () => { if (Date.now() - at > 5 * 6e4) throw new Error('it was opened more than 5 minutes ago, so I won’t close it (you may have work in it)'); const x = await callTool('/tool/closeApplication', { app: app.k }); if (!x.success) throw new Error(x.error || 'it isn’t running'); return 'Closed ' + app.n + ' again.'; }); }
        return { text: pick(['Opening ', 'Launching ', 'Starting ']) + '**' + app.n + '**.', speak: 'Opening ' + app.n, tool: 'openApplication' };
      }
      const site = NLU.findSite(q);
      if (site) return openSite(site);
      if (/\b(folder|directory)\b/.test(s)) return executeTool({ ...p, intent: 'OPEN_FOLDER' }, raw);
      const what = s.replace(/^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me)\s+(up\s+)?(the\s+|my\s+)?/, '');
      return { text: 'I couldn’t find an app called "' + what + '" on this laptop. I can open anything in your Start menu by its name — or any website.', suggestions: ['Open ' + what + '.com', 'Search Google for ' + what] };
    }
    case 'ASK_WHAT': {
      const v = a.verb || 'open';
      const recent = ctx.lastApp ? [cap(v) + ' ' + ((NLU.appByKey(ctx.lastApp) || {}).n || ctx.lastApp)] : [];
      return { text: cap(v) + ' what? Name an app, a website or a file — e.g. "' + v + ' chrome", "' + v + ' leetcode".', suggestions: recent.concat([cap(v) + ' Chrome', cap(v) + ' VS Code']), tool: null };
    }
    case 'CONTEXT_REOPEN':
    case 'CONTEXT_CLOSE':
    case 'CLOSE_APPLICATION': {
      const app = (p.intent === 'CLOSE_APPLICATION' && NLU.findApp(a.app || s)) || NLU.appByKey(ctx.lastApp);
      if (!app) return { text: 'Which app should I ' + (p.intent === 'CONTEXT_REOPEN' ? 'open' : 'close') + '?' };
      if (p.intent === 'CONTEXT_REOPEN') return executeTool({ ...p, intent: 'OPEN_APPLICATION', args: { app: app.names[0] } }, raw);
      toolStep('closeApplication → ' + app.k);
      const r = await callTool('/tool/closeApplication', { app: app.k });
      if (!r.success) return { text: r.error ? cap(r.error) + '.' : app.n + ' does not seem to be running.' };
      Undo.push('closed ' + app.n, async () => { const x = await callTool('/tool/openApplication', { app: app.k }); if (x.error) throw new Error(x.error); return 'Opened ' + app.n + ' again (unsaved work in it can’t come back).'; });
      return { text: 'Closed **' + app.n + '**.', tool: 'closeApplication' };
    }
    case 'WORKFLOW': {
      toolStep('workflow → vscode + projects');
      await callTool('/tool/openApplication', { app: 'vscode' }); ctx.lastApp = 'vscode'; ctx.lastAppT = Date.now();
      await callTool('/tool/openFolder', { name: 'Projects' });
      const pend = todos.filter(t => !t.done);
      return { text: 'Coding environment ready: **VS Code** is launching and your **Projects** folder is open.' + (pend.length ? ' Top of your list: "' + pend[0].text + '".' : '') + ' Want a focus session too?', suggestions: ['Start a focus session', 'Git status'] };
    }

    default: return ToolHandlers.NONE;
  }
});
