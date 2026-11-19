'use strict';
// Opt-in MCP Streamable HTTP client (2025-11-25 protocol family).
// Only explicitly configured local servers; no subprocesses, redirects, DNS,
// automatic tool execution, or trust in a server's "readOnly" annotation.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createApprovals } = require('./approvals');
const { signature } = require('./agent-context');
const VERSION = '2025-11-25';
const VERSIONS = new Set([VERSION, '2025-06-18', '2025-03-26']);
const MAX = 1024 * 1024;
function endpoint(input, ownPort = 3002) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash ||
      !url.port || Number(url.port) === Number(ownPort) || url.search) throw new Error('Use an explicit local MCP endpoint such as http://127.0.0.1:8080/mcp, on a port other than JARVIS.');
  return url.href;
}
async function responseMessage(response, id) {
  if (!response.ok) throw new Error('MCP HTTP ' + response.status + '; the call was not retried.');
  if (id == null) { await response.body?.cancel(); return null; }
  const isSSE = /text\/event-stream/i.test(response.headers.get('content-type') || '');
  if (!isSSE && !/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('Unsupported MCP response type.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX) throw new Error('MCP response exceeds 1MB.');
      text += decoder.decode(value, { stream: true });
      if (isSSE) {
        let boundary;
        text = text.replace(/\r\n/g, '\n');
        while ((boundary = text.indexOf('\n\n')) !== -1) {
          const event = text.slice(0, boundary); text = text.slice(boundary + 2);
          const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const message = JSON.parse(data);
          if (message.id === id) return message;
          if (message.method && message.id != null) throw new Error('MCP server requested an unsupported client capability.');
        }
      }
    }
    if (isSSE) throw new Error('MCP stream ended without a result. The call was not retried.');
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}
function createClient({ file, ownPort = 3002, fetchImpl = fetch, now = Date.now, control }) {
  const approvals = createApprovals({ now, ttl: 120000 }), connections = new Map();
  let counter = 0;
  control?.onStop(() => {
    approvals.clear(); for (const server of connections.values()) { server.connected = false; delete server.session; delete server.tools; }
    return { mcpConnectionsRevoked: true, note: 'External side effects already accepted by a server may still complete.' };
  });
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (!Array.isArray(saved)) throw new Error('Invalid MCP configuration; it has been preserved.');
  for (const s of saved.slice(0, 8)) connections.set(s.id, { id: s.id, name: s.name, url: endpoint(s.url, ownPort), connected: false });
  function persist() {
    fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify([...connections.values()].map(({ id, name, url }) => ({ id, name, url }))));
    fs.renameSync(file + '.tmp', file);
  }
  async function rpc(server, method, params, notification = false) {
    control?.assertRunning();
    const operation = control?.operation();
    try {
    const id = notification ? undefined : ++counter;
    const response = await fetchImpl(server.url, { method: 'POST', redirect: 'error', signal: operation
      ? AbortSignal.any([operation.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(server.version ? { 'MCP-Protocol-Version': server.version } : {}),
        ...(server.session ? { 'Mcp-Session-Id': server.session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id == null ? {} : { id }), method, ...(params ? { params } : {}) }) });
    if (method === 'initialize') {
      const session = response.headers.get('mcp-session-id');
      if (session && !/^[\x21-\x7e]{1,512}$/.test(session)) throw new Error('Invalid MCP session id.');
      server.session = session;
    }
    const message = await responseMessage(response, id);
    operation?.check();
    if (id == null) return;
    if (message?.jsonrpc !== '2.0' || message.id !== id) throw new Error('Invalid MCP response identity.');
    if (message.error) throw new Error(String(message.error.message || 'MCP request failed').slice(0, 500));
    if (!message.result || typeof message.result !== 'object') throw new Error('Invalid MCP result.');
    return message.result;
    } finally { operation?.release(); }
  }
  function preview(key, action, paths, body) {
    if (body.approved === true && approvals.consume(body.approvalToken, key)) return null;
    return { status: 409, body: { needsApproval: true, approvalKind: 'mcp', approvalToken: approvals.issue(key), action, paths } };
  }
  async function tools(server) {
    const rows = []; let cursor;
    for (let page = 0; page < 5; page++) {
      const result = await rpc(server, 'tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(result.tools)) throw new Error('Invalid MCP tool catalogue.');
      rows.push(...result.tools);
      if (rows.length > 200) throw new Error('MCP catalogue exceeds 200 tools.');
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw new Error('MCP catalogue has too many pages.');
    const seen = new Set();
    for (const tool of rows) {
      if (!/^[\w.-]{1,128}$/.test(tool.name) || seen.has(tool.name) || tool.inputSchema?.type !== 'object') throw new Error('Invalid or duplicate MCP tool.');
      seen.add(tool.name);
    }
    return rows;
  }
  async function connect(body) {
    control?.assertRunning();
    const url = endpoint(body.url, ownPort), name = String(body.name || '').trim().slice(0, 80);
    if (!name || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Give the server a name.');
    const key = signature({ tool: 'mcp-connect', args: { url, name } });
    const offered = preview(key, 'Connect to this MCP server and read its tool catalogue', [name, url], body);
    if (offered) return offered;
    const existing = [...connections.values()].find(s => s.url === url);
    if (!existing && connections.size >= 8) throw new Error('At most eight MCP servers can be configured.');
    const server = { id: existing?.id || crypto.randomUUID(), epoch: crypto.randomUUID(), name, url, connected: false };
    const init = await rpc(server, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'jarvis', version: '1.0.0' } });
    if (!VERSIONS.has(init.protocolVersion) || !init.capabilities?.tools) throw new Error('MCP server does not support a compatible tools protocol.');
    server.version = init.protocolVersion;
    await rpc(server, 'notifications/initialized', null, true);
    server.tools = await tools(server); server.connected = true;
    connections.set(server.id, server); persist();
    return { status: 200, body: { success: true, id: server.id, tools: server.tools } };
  }
  async function call(body) {
    control?.assertRunning();
    const server = connections.get(body.serverId);
    if (!server?.connected) throw new Error('Connect the configured MCP server first.');
    const args = body.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 16000) throw new Error('Tool arguments must be a JSON object under 16KB.');
    const tool = server.tools.find(t => t.name === body.tool);
    if (!tool) throw new Error('Tool is not in this server’s catalogue.');
    const key = signature({ tool: 'mcp-call', args: { serverId: server.id, url: server.url, epoch: server.epoch, session: server.session || '', definition: tool, arguments: args } });
    const offered = preview(key, 'Call external MCP tool once', [server.name, server.url, tool.name, JSON.stringify(args)], body);
    if (offered) return offered;
    // Approval is consumed before network I/O. Changed definitions require another review;
    // a timeout/disconnect never triggers replay of a potentially completed side effect.
    const current = await tools(server);
    if (!server.connected || connections.get(server.id) !== server) throw new Error('The MCP connection was revoked. Connect and approve again.');
    if (signature({ tool: 'schema', args: current.find(t => t.name === body.tool) || {} }) !== signature({ tool: 'schema', args: tool })) {
      server.tools = current; throw new Error('The external tool changed. Review and approve it again.');
    }
    const result = await rpc(server, 'tools/call', { name: tool.name, arguments: args });
    return { status: 200, body: { success: !result.isError, isError: !!result.isError,
      content: (result.content || []).filter(c => c.type === 'text').map(c => ({ type: 'text', text: String(c.text).slice(0, 12000) })),
      note: 'External server response; independently verify any claimed side effects.' } };
  }
  return { connect, call, list: () => [...connections.values()].map(({ id, name, url, connected, tools }) => ({ id, name, url, connected, tools: connected ? tools : [] })),
    disconnect(id) { const s = connections.get(id); if (s) { s.connected = false; delete s.session; delete s.tools; } },
    remove(id) { connections.delete(id); persist(); } };
}
function register(app, options) {
  const client = createClient(options);
  app.get('/api/mcp/servers', (_req, res) => res.set('Cache-Control', 'no-store').json({ servers: client.list() }));
  for (const operation of ['connect', 'call']) app.post('/api/mcp/' + operation, async (req, res) => {
    try { const result = await client[operation](req.body); res.status(result.status).set('Cache-Control', 'no-store').json(result.body); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/mcp/disconnect', (req, res) => { client.disconnect(req.body.serverId); res.json({ success: true }); });
  app.post('/api/mcp/remove', (req, res) => { client.remove(req.body.serverId); res.json({ success: true }); });
  return client;
}
module.exports = { endpoint, responseMessage, createClient, register };
