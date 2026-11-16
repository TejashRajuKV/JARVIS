'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { startServer, suite } = require('./lib/server');
const { parseICS, pinLookup } = require('../calendar');
const { check, done } = suite('connected-services');
(async () => {
  const token = 'fixture-token-not-a-real-credential';
  const attempts = [];
  let statusCode = 200;
  const state = {'light.desk_lamp':'off', 'light.spare_lamp':'off', 'sensor.temperature':'23'};
  const entity = id => ({entity_id:id, state:state[id], attributes:{friendly_name:id.split('.')[1]}});
  const provider = http.createServer((req, res) => {
    function send(status, body) { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); }
    if (req.headers.authorization !== 'Bearer ' + token) return send(401, {});
    if (req.method === 'GET' && req.url === '/api/') return send(statusCode, {message:'Fixture API'});
    if (req.method === 'GET' && req.url === '/api/states') return send(200, Object.keys(state).map(entity));
    if (req.method === 'GET' && req.url.startsWith('/api/states/')) {
      const id = decodeURIComponent(req.url.slice('/api/states/'.length));
      return id in state ? send(200, entity(id)) : send(404, {});
    }
    if (req.method === 'POST' && /^\/api\/services\/light\/turn_(on|off)$/.test(req.url)) {
      const chunks = [];
      req.on('data', b => chunks.push(b));
      req.on('end', () => {
        const id = JSON.parse(Buffer.concat(chunks).toString()).entity_id;
        attempts.push([req.url, id]);
        state[id] = req.url.endsWith('_on') ? 'on' : 'off';
        send(200, [entity(id)]);
      });
      return;
    }
    send(404, {});
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  let S;
  try {
    S = await startServer();
    const url = 'http://127.0.0.1:' + provider.address().port;
    const config = (t = token) => S.api('PUT', '/api/homeassistant/config', { url, token:t });
    const wrong = await config('wrong-fixture-token');
    check('Home Assistant', 'a bad token reports HTTP 401 without echoing the supplied token', wrong.status === 400 && /401/.test(wrong.json.error) && !wrong.text.includes('wrong-fixture-token'), wrong.status);
    const connected = await config();
    const status = await S.get('/api/homeassistant/status');
    const devices = await S.get('/api/homeassistant/entities');
    check('Home Assistant', 'connects to a real fake HTTP provider and lists the lamp, spare and read-only sensor', connected.status === 200 && status.json.configured && status.json.connected === true && devices.json.entities?.length === 3, [status.json, devices.json]);
    for (const failure of [401, 503]) {
      statusCode = failure;
      const unavailable = await S.get('/api/homeassistant/status');
      check('Home Assistant', 'upstream ' + failure + ' reports a saved but disconnected integration', unavailable.status === 200 && unavailable.json.configured === true && unavailable.json.connected === false && unavailable.json.url === url && !unavailable.text.includes(token), unavailable.json);
    }
    statusCode = 200;
    check('Home Assistant', 'status detects recovery without saving credentials again', (await S.get('/api/homeassistant/status')).json.connected === true);
    check('Home Assistant', 'credential is kept on disk and absent from connect, status and entity responses',
      [connected, status, devices].every(r => !r.text.includes(token)) && fs.readFileSync(path.join(S.sandbox,'.config.json'),'utf8').includes(token));
    const act = (extra = {}) => S.post('/api/homeassistant/service', {domain:'light',service:'turn_on',entity_id:'light.desk_lamp',...extra});
    const first = await act({approved:true});
    check('Home Assistant', 'bare approved:true neither writes nor bypasses the server', first.status === 409 && first.json.needsApproval && attempts.length === 0, first.status);
    const approval = { approved:true, approvalToken:first.json.approvalToken };
    const swapDevice = await act({...approval,entity_id:'light.spare_lamp'});
    const swapService = await act({...approval,service:'turn_off'});
    check('Home Assistant', 'token cannot authorize a different device or service', swapDevice.status === 409 && swapService.status === 409 && attempts.length === 0);
    const applied = await act(approval);
    const readback = await S.get('/api/homeassistant/entity/light.desk_lamp');
    const replay = await act(approval);
    check('Home Assistant', 'one approved change writes exactly once; readback says on; replay is refused',
      applied.status === 200 && replay.status === 409 && attempts.length === 1 && readback.json.state === 'on', { applied:applied.status, replay:replay.status, state:readback.json.state, writes:attempts.length });
    const fresh = await act();
    await config();
    const stale = await act({approved:true,approvalToken:fresh.json.approvalToken});
    check('Home Assistant', 'reconnecting invalidates an outstanding device approval', stale.status === 409 && attempts.length === 1);
    const disabled = await S.api('DELETE','/api/homeassistant/config');
    const absent = await S.get('/api/homeassistant/status');
    check('Home Assistant', 'disconnect removes the credential and blocks subsequent changes',
      disabled.status === 200 && absent.json.configured === false && absent.json.connected === false && !fs.readFileSync(path.join(S.sandbox,'.config.json'),'utf8').includes(token) && (await act()).status === 400);
    const items = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261117T080000Z\r\nDTEND:20261117T090000Z\r\nSUMMARY:Review\\, Operating\r\n Systems\r\nLOCATION:Lab\\; 2\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR');
    check('Calendar', 'UTC timestamps, folded lines, escapes and no recurrence expansion',
      items.length === 1 && items[0].start === Date.UTC(2026,10,17,8) && items[0].end === Date.UTC(2026,10,17,9) &&
      items[0].title === 'Review, OperatingSystems' && items[0].location === 'Lab; 2', items);
    const address = {address:'93.184.216.34', family:4};
    const lookup = pinLookup(address), observed = [];
    lookup('calendar.fixture.test', {all:true}, (...args) => observed.push(args));
    lookup('calendar.fixture.test', {all:false}, (...args) => observed.push(args));
    check('Calendar', 'pinned resolver supports both Node lookup callback shapes without resolving again',
      JSON.stringify(observed) === JSON.stringify([[null,[address]],[null,address.address,address.family]]), observed);
    const localFeed = await S.api('PUT','/api/calendar/config',{url:'https://127.0.0.1/private.ics'});
    check('Calendar', 'a locally hosted HTTPS URL is refused by the public-feed policy', localFeed.status === 400 && /public address/i.test(localFeed.json.error), localFeed.json);
  } finally {
    if (S) await S.stop();
    await new Promise(resolve => provider.close(resolve));
  }
  process.exitCode = done() ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
