'use strict';
const assert = require('./lib/assertions')('mcp-client');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { endpoint, createClient, responseMessage } = require('../mcp-client');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-'));
  try {
    for (const url of ['https://example.com/mcp', 'http://localhost:8080/mcp', 'http://127.0.0.1:3002/api/tool/readFile', 'http://user:pass@127.0.0.1:8080/mcp', 'http://169.254.169.254:8080/mcp', 'http://127.0.0.1:8080/mcp?token=secret']) assert.throws(() => endpoint(url), /local MCP/);
    assert.equal(endpoint('http://127.0.0.1:8080/mcp'), 'http://127.0.0.1:8080/mcp');
    let calls = 0, requests = 0, changed = false, now = 1000, timeout = false, stopOnCall = false;
    const control = require('../task-control').createControl();
    const file = path.join(tmp, 'servers.json');
    const fetchImpl = async (_url, options) => {
      requests++;
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      let result;
      if (body.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} } };
      else {
        assert.equal(options.headers['Mcp-Session-Id'], 'fixture-session');
        assert.equal(options.headers['MCP-Protocol-Version'], '2025-11-25');
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
        if (body.method === 'tools/list') result = { tools: [{ name: 'echo', description: changed ? 'changed' : 'fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
        if (body.method === 'tools/call') { calls++; if (timeout) throw Error('simulated timeout'); if (stopOnCall) control.stop(); result = { content: [{ type: 'text', text: body.params.arguments.text }] }; }
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' } });
    };
    const client = createClient({ file, fetchImpl, now: () => now, control });
    const connection = { name: 'Fixture', url: 'http://127.0.0.1:8080/mcp' };
    const offered = await client.connect(connection);
    assert.equal(offered.status, 409);
    assert.equal(requests, 0, 'no network contact before connection approval');
    const connected = await client.connect({ ...connection, approved: true, approvalToken: offered.body.approvalToken });
    assert.equal(connected.status, 200);
    const request = { serverId: connected.body.id, tool: 'echo', arguments: { text: 'Meet at 5 PM' } };
    const preview = await client.call(request);
    assert.equal(preview.body.approvalKind, 'mcp');
    assert.ok(preview.body.paths.includes(JSON.stringify(request.arguments)), 'preview contains all exact arguments');
    assert.equal(calls, 0, 'listing never executes a tool');
    const mismatched = await client.call({ ...request, arguments: { text: 'Changed' }, approved: true, approvalToken: preview.body.approvalToken });
    assert.equal(mismatched.status, 409);
    assert.equal(calls, 0, 'approval cannot authorize different arguments');
    const result = await client.call({ ...request, approved: true, approvalToken: preview.body.approvalToken });
    assert.equal(result.body.content[0].text, 'Meet at 5 PM');
    assert.equal(calls, 1);
    assert.equal((await client.call({ ...request, approved: true, approvalToken: preview.body.approvalToken })).status, 409, 'token cannot replay');
    const expiring = await client.call(request); now += 121000;
    assert.equal((await client.call({ ...request, approved: true, approvalToken: expiring.body.approvalToken })).status, 409);
    const beforeChange = await client.call(request); changed = true;
    await assert.rejects(() => client.call({ ...request, approved: true, approvalToken: beforeChange.body.approvalToken }), /tool changed/);
    assert.equal(calls, 1, 'changed definitions never execute with old approval');
    const beforeTimeout = await client.call(request); timeout = true;
    await assert.rejects(() => client.call({ ...request, approved: true, approvalToken: beforeTimeout.body.approvalToken }), /timeout/);
    assert.equal(calls, 2, 'a timeout is never automatically retried');
    assert.equal((await client.call({ ...request, approved: true, approvalToken: beforeTimeout.body.approvalToken })).status, 409);
    timeout = false;
    const beforeStop = await client.call(request); stopOnCall = true;
    await assert.rejects(() => client.call({ ...request, approved: true, approvalToken: beforeStop.body.approvalToken }), /Emergency stop/);
    assert.equal(client.list()[0].connected, false, 'emergency stop revokes the external connection');
    control.resume();
    await assert.rejects(() => client.call({ ...request, approved: true, approvalToken: beforeStop.body.approvalToken }), /Connect/);
    const restored = createClient({ file, fetchImpl });
    assert.equal(restored.list()[0].connected, false, 'restart never automatically reconnects');
    await assert.rejects(() => restored.call(request), /Connect/);
    client.disconnect(request.serverId);
    await assert.rejects(() => client.call(request), /Connect/);
    client.remove(request.serverId); assert.equal(client.list().length, 0);
    const sse = 'data: {"jsonrpc":"2.0","id":7,"result":{"content":[]}}\n\n';
    assert.deepEqual(await responseMessage(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }), 7), { jsonrpc: '2.0', id: 7, result: { content: [] } });
    await assert.rejects(() => responseMessage(new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }), 1), /exceeds/);
    assert.report();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
