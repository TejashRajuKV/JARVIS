'use strict';
window.AgentRuntimePage = (() => {
  const status = $('#runtimeStatus'), select = $('#mcpTool');
  let tools = [], pending = false;
  const show = message => { status.textContent = message; };
  function open() { openDailyPane('desktop'); $('#runtimeTools').open = true; }
  async function refreshJobs() {
    const result = await getJSON('/agent/jobs');
    const host = $('#jobList'); host.replaceChildren();
    if (result.error) { show(result.error); return result; }
    for (const job of result.jobs) {
      const row = document.createElement('article'), title = document.createElement('p');
      title.textContent = job.goal + ' · ' + job.status + ' · ' + job.id;
      const inspect = document.createElement('button'); inspect.className = 'btn'; inspect.textContent = 'View result';
      inspect.onclick = () => void getJSON('/agent/jobs/' + job.id).then(detail => {
        const output = (detail.steps || []).map(s => (s.tool || '') + ' [' + s.status + ']\n' + (s.output || s.note || '') + (s.outputTruncated ? '\n[Saved result shortened to 6,000 characters.]' : '')).join('\n\n');
        switchTab('chat'); jarvisSay({ text: detail.error || '**' + detail.goal + '** · ' + detail.status + '\n\n' + (detail.note || '') + '\n\n' + output, noTTS: true, noPersona: true });
      });
      row.append(title, inspect);
      if (['running', 'queued'].includes(job.status)) {
        const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
        cancel.onclick = () => void callTool('/agent/jobs/' + job.id + '/cancel').then(refreshJobs); row.append(cancel);
      }
      host.append(row);
    }
    if (!result.jobs.length) host.textContent = 'No background tasks yet.';
    return result;
  }
  async function refreshMcp() {
    const result = await getJSON('/mcp/servers');
    if (result.error) { show(result.error); return; }
    const host = $('#mcpServers'); host.replaceChildren(); select.replaceChildren(); tools = [];
    for (const server of result.servers) {
      const row = document.createElement('article'), title = document.createElement('p');
      title.textContent = server.name + ' · ' + server.url + ' · ' + (server.connected ? 'connected' : 'disconnected'); row.append(title);
      const reconnect = document.createElement('button'); reconnect.className = 'btn'; reconnect.textContent = server.connected ? 'Disconnect' : 'Review connection';
      reconnect.onclick = () => void perform(async () => {
        const r = server.connected ? await callTool('/mcp/disconnect', { serverId: server.id }) : await callTool('/mcp/connect', { name: server.name, url: server.url });
        show(r.error || (r.cancelled ? 'Cancelled.' : 'Connection updated.')); await refreshMcp();
      });
      const remove = document.createElement('button'); remove.className = 'btn'; remove.textContent = 'Remove';
      remove.onclick = () => void perform(async () => { await callTool('/mcp/remove', { serverId: server.id }); await refreshMcp(); });
      row.append(reconnect, remove); host.append(row);
      for (const tool of server.tools || []) {
        tools.push({ serverId: server.id, ...tool });
        select.add(new Option(server.name + ' / ' + tool.name, String(tools.length - 1)));
      }
    }
    schema();
  }
  function schema() { $('#mcpSchema').textContent = tools[Number(select.value)] ? JSON.stringify(tools[Number(select.value)].inputSchema, null, 2) : 'Connect a server to see its tools.'; }
  async function perform(fn) {
    if (pending) { show('Wait for the current request.'); return; }
    pending = true;
    try { await fn(); } catch (error) { show(error.message); }
    finally { pending = false; }
  }
  async function command(text) {
    if (/^(?:show|list|open) (?:my )?background tasks[.!?]?$/i.test(text)) { open(); await refreshJobs(); return { text: 'Opened background tasks.', noTTS: true }; }
    if (/^(?:show|open|list) (?:my )?mcp (?:tools|servers|connections)[.!?]?$/i.test(text)) { open(); await refreshMcp(); return { text: 'Opened MCP connections. External calls need one-time approval.', noTTS: true }; }
    const match = /^(?:in (?:the )?background[, :]?\s+|background task[: ]+)(.+)$/i.exec(text);
    if (!match) return null;
    const parsed = NLU.classify(NLU.normalize(match[1], settings.wakeWord), ctx);
    const direct = { LIST_TODOS: 'list_todos', LIST_DEADLINES: 'list_deadlines' }[parsed.intent];
    const result = direct && parsed.confidence >= .85 ? { ok: true, plan: { goal: match[1], steps: [{ tool: direct, args: {}, tier: 'safe' }] } }
      : await callTool('/agent/plan', { text: match[1], model: llm.model || undefined });
    if (!result.ok) return { text: result.reason || 'I could not plan that background task.', error: 'BACKGROUND_PLAN_FAILED' };
    const supported = await getJSON('/agent/jobs');
    if (supported.error) return { text: supported.error, error: 'BACKGROUND_UNAVAILABLE' };
    if (result.plan.steps.some(s => s.tier !== 'safe' || !(supported.tools || []).includes(s.tool))) return {
      text: 'That task needs the interactive executor. Background tasks currently support reading or summarizing text files, listing tasks, and listing deadlines. Use the normal command for other work.', error: 'INTERACTIVE_REQUIRED'
    };
    result.plan.budget={maxRuntimeMs:Number($('#jobRuntime').value)*1000,maxModelCalls:Number($('#jobModelCalls').value)};
    if($('#jobNotBefore').value)result.plan.notBefore=new Date($('#jobNotBefore').value).getTime();
    let submitted = false;
    return { text: '**Background plan:** ' + result.plan.goal + '\n' + result.plan.steps.map((s,i) => (i+1) + '. ' + s.tool + ' ' + JSON.stringify(s.args)).join('\n') + '\nBudget: '+result.plan.budget.maxRuntimeMs/1000+' seconds; '+result.plan.budget.maxModelCalls+' AI calls. Start: '+(result.plan.notBefore?new Date(result.plan.notBefore).toLocaleString():'now')+'.',
      noPersona: true, confirm: { yes: 'START IN BACKGROUND', no: 'CANCEL', onConfirm: async () => {
        if (submitted) return; submitted = true;
        const queued = await callTool('/agent/jobs', { plan: result.plan });
        jarvisSay({ text: queued.error || 'Task queued: `' + queued.job.id + '`. You can keep working; I’ll notify you when it finishes. Say “show background tasks” to review it.', noPersona: true });
      } } };
  }
  $('#jobRefresh').onclick = () => void perform(refreshJobs);
  $('#emergencyStop').onclick = () => void handleUser('emergency stop', 'chip');
  $('#emergencyResume').onclick = () => void handleUser('resume', 'chip');
  async function refreshSafety() {
    let result;
    try { result = await getJSON('/safety/hotkey'); } catch { $('#emergencyStatus').textContent = 'Could not check the global stop shortcut. Use the emergency-stop button.'; return; }
    $('#emergencyHotkey').checked = result.enabled === true;
    $('#emergencyHotkey').disabled = result.supported === false;
    $('#emergencyStatus').textContent = result.error || (result.running ? 'Ctrl+Alt+Pause is ready.' : result.enabled ? 'Waiting for the Windows shortcut listener. Refresh to check its status.' : 'Global shortcut is off. Emergency stop remains available here and by command.');
  }
  $('#emergencyHotkey').onchange = () => void perform(async () => {
    const result = await callTool('/safety/hotkey', { enabled: $('#emergencyHotkey').checked });
    if (result.error) show(result.error); await refreshSafety();
    if (result.enabled && !result.running) setTimeout(() => void refreshSafety(), 2000);
  });
  $('#runtimeTools').addEventListener('toggle', () => { if ($('#runtimeTools').open) void refreshSafety(); });
  $('#mcpRefresh').onclick = () => void perform(refreshMcp);
  select.onchange = schema;
  $('#mcpConnectForm').onsubmit = event => { event.preventDefault(); void perform(async () => {
    switchTab('chat'); const result = await callTool('/mcp/connect', { name: $('#mcpName').value, url: $('#mcpUrl').value });
    show(result.error || (result.cancelled ? 'Cancelled.' : 'Connected. Review available tools in Apps.')); await refreshMcp();
  }); };
  $('#mcpCallForm').onsubmit = event => { event.preventDefault(); void perform(async () => {
    const tool = tools[Number(select.value)]; if (!tool) throw new Error('Choose a connected tool.');
    const args = JSON.parse($('#mcpArguments').value);
    switchTab('chat'); const result = await callTool('/mcp/call', { serverId: tool.serverId, tool: tool.name, arguments: args });
    jarvisSay({ text: result.error || (result.cancelled ? 'Cancelled.' : (result.isError ? 'External tool reported a failure:\n' : 'External tool response (unverified):\n') + (result.content || []).map(c => c.text).join('\n')), noPersona: true, noTTS: true });
  }); };
  return { command, refreshJobs };
})();
