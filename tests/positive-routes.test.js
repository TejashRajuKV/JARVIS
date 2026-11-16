'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {crc32} = require('node:zlib');
const {startServer, suite} = require('./lib/server');
const {createPhoneHubAuth} = require('../phonehub-auth');

const {check, done} = suite('positive-routes');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function imageMatches(S, endpoint, bytes, type) {
  const r = await fetch(S.base + endpoint, {headers: {Origin: S.base, 'Sec-Fetch-Site': 'same-origin'}});
  const contents = Buffer.from(await r.arrayBuffer());
  return r.status === 200 && r.headers.get('Content-Type') === type && contents.equals(bytes);
}

async function run() {
  const preload = path.join(__dirname, 'lib', 'public-provider-fixtures.js').split(path.sep).join('/');
  const env = {
    NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --require "' + preload + '"',
    JARVIS_PHONEHUB_HOST: '', JARVIS_PHONEHUB_STATE_FILE: '',
    JARVIS_CALLING_ENABLED: 'true', JARVIS_TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32),
    JARVIS_TWILIO_AUTH_TOKEN: 'fixture-twilio-token', JARVIS_TWILIO_FROM_NUMBER: '+14155550100',
    JARVIS_CALL_TO_NUMBER: '+14155550101', JARVIS_CALL_ON_REMINDERS: 'false'
  };
  let S = await startServer({env, keepHome: true, recordRoutes: true});
  const isolatedHome = S.home;
  try {
    const calling = await S.get('/api/calling/status');
    check('Calling', 'enabled status describes the provider without publishing credentials', calling.status === 200 &&
      calling.json.configured === true && calling.json.enabled === true && calling.json.provider === 'twilio' &&
      !calling.text.includes(env.JARVIS_TWILIO_AUTH_TOKEN));
    const call = await S.post('/api/calling/call', {message: 'Fixture announcement'});
    check('Calling', 'a correctly encoded request queues a call through the fake provider', call.status === 202 &&
      call.json.ok === true && call.json.status === 'queued' && call.json.callSid === 'CA' + '2'.repeat(32) &&
      call.json.to.endsWith('0101') && call.json.to !== env.JARVIS_CALL_TO_NUMBER, call.json);

    check('Commerce', 'Express registers exactly one comparison handler',
      S.routes.filter(([method, route]) => method === 'POST' && route === '/api/commerce/compare').length === 1);
    const comparison = await S.post('/api/commerce/compare', {type: 'product', query: 'desk lamp'});
    check('Commerce', 'ranks readable listing prices across real provider domains and provides a price-free fallback',
      comparison.status === 200 && comparison.json.success === true && comparison.json.verifiedCheapest === null &&
      comparison.json.lowestObserved?.value === 999 && comparison.json.lowestObserved.verifiedCheckout === false &&
      comparison.json.providers?.find(p => p.id === 'amazon')?.results[0]?.priceSource === 'readable public page' &&
      comparison.json.providers?.find(p => p.id === 'shopping')?.results[0]?.fallback === true, comparison.json);
    const single = await S.post('/api/commerce/compare', {query: 'desk lamp', provider: 'amazon'});
    check('Commerce', 'one provider supplies observed prices but cannot establish the lowest among providers',
      single.status === 200 && single.json.lowestObserved === null &&
      single.json.providers?.[0]?.results[0]?.priceCandidates?.[0]?.amount === 1299);
    for (const alias of ['shopping', 'googleshopping']) {
      const result = await S.post('/api/commerce/compare', {type: 'product', query: 'desk lamp', provider: alias});
      check('Commerce', alias + ' resolves to Shopping and has a fallback search URL', result.status === 200 &&
        result.json.providers?.length === 1 && result.json.providers[0].id === 'shopping' &&
        result.json.providers[0].results[0].url.startsWith('https://www.google.com/search?tbm=shop&'));
    }

    const room = await fetch(S.base + '/api/room/snapshot', {method: 'POST', headers: {
      Origin: S.base, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'image/jpeg'
    }, body: jpeg});
    const snapshot = await room.json();
    const roomList = await S.get('/api/room/images');
    const roomName = path.basename(snapshot.file || '');
    check('Images', 'room listing includes the new fake camera snapshot', room.status === 200 && roomList.status === 200 &&
      roomList.json.images?.some(image => image.name === roomName));
    check('Images', 'room image returns the exact uploaded JPEG',
      await imageMatches(S, '/api/room/image?name=' + encodeURIComponent(roomName), jpeg, 'image/jpeg'));

    const screenshotName = 'JARVIS_screenshot_audit.png';
    const screenshotPath = path.join(S.sandbox, screenshotName);
    fs.writeFileSync(screenshotPath, png);
    const screenshotList = await S.get('/api/tool/screenshots');
    const screenshot = screenshotList.json.screenshots?.find(item => item.name === screenshotName);
    check('Images', 'tool screenshot listing returns an identifier for the PNG fixture', screenshotList.status === 200 && screenshot?.bytes === png.length);
    check('Images', 'tool screenshot identifier returns the exact fixture PNG',
      !!screenshot && await imageMatches(S, '/api/tool/screenshots/' + encodeURIComponent(screenshot.id), png, 'image/png'));
    // Keep the indexed image above the gallery's 1,000-byte floor with a valid PNG text chunk.
    const chunk = Buffer.from('tEXtDescription\0' + 'Audit image. '.repeat(90));
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(chunk.length - 4);
    checksum.writeUInt32BE(crc32(chunk));
    const indexedPng = Buffer.concat([png.subarray(0, -12), size, chunk, checksum, png.subarray(-12)]);
    const indexedName = 'JARVIS_screenshot_indexed.png';
    fs.writeFileSync(path.join(S.sandbox, indexedName), indexedPng);
    const recent = await S.get('/api/shots/recent');
    const recentShot = recent.json.images?.find(item => item.name === indexedName);
    check('Images', 'indexed screenshot gallery lists the fixture and provides an image URL', recent.status === 200 && recentShot?.url?.startsWith('/api/shots/image?'));
    check('Images', 'indexed screenshot image returns the exact fixture PNG',
      !!recentShot && await imageMatches(S, recentShot.url, indexedPng, 'image/png'));
    const vision = await S.post('/api/vision/saved-image', {path: screenshotPath, model: 'fixture-vision', question: 'What is in this fixture?'});
    check('Images', 'vision reads the saved PNG and sends its pixels and question to the fake model', vision.status === 200 &&
      vision.json.answer === 'A fixture pixel.' && vision.json.file === screenshotName && vision.json.cloud === false, vision.json);

    const pairing = await S.post('/api/phonehub/pairing');
    check('Phone Hub', 'local pairing issues a six-digit code with an expiry',
      pairing.status === 201 && /^\d{6}$/.test(pairing.json.code || '') && pairing.json.expiresAt > pairing.json.createdAt);
    const file = path.join(S.sandbox, '.phonehub-state.json');
    await S.stop();
    // Complete pairing against the real auth store without binding the phone gateway to the LAN.
    const auth = createPhoneHubAuth({stateFile: file});
    const pair = auth.completePairing({...pairing.json, deviceName: 'Audit fixture'});
    if (!pair.ok) throw new Error('Fixture pairing failed: ' + pair.error);
    S = await startServer({env, home: isolatedHome, keepHome: true});
    const status = await S.get('/api/phonehub/status');
    check('Phone Hub', 'status reads the paired device but keeps its bearer token private', status.status === 200 &&
      status.json.persistence === true && status.json.devices?.some(d => d.id === pair.device.id && d.name === 'Audit fixture') &&
      !status.text.includes(pair.token), status.json);
    const deviceEndpoint = '/api/phonehub/devices/' + pair.device.id;
    const grant = await S.post(deviceEndpoint + '/grant', {capabilities: ['status', 'voice']});
    const granted = (await S.get('/api/phonehub/status')).json.devices?.find(d => d.id === pair.device.id);
    check('Phone Hub', 'grant updates an existing device and leaves calls disabled', grant.status === 200 &&
      granted?.capabilities?.join(',') === 'status,voice', grant.json);
    const revoke = await S.api('DELETE', deviceEndpoint);
    const revoked = (await S.get('/api/phonehub/status')).json.devices?.find(d => d.id === pair.device.id);
    const restored = createPhoneHubAuth({stateFile: file});
    check('Phone Hub', 'DELETE revokes the device and rejects its old bearer token', revoke.status === 200 &&
      revoked?.revoked === true && !restored.authorize({token: pair.token, nonce: 'audit_fixture_nonce_123'}, 'status').ok);
  } finally {
    await S.stop();
    fs.rmSync(isolatedHome, {recursive: true, force: true, maxRetries: 4, retryDelay: 150});
  }
}

run().then(() => { process.exitCode = done() ? 1 : 0; })
  .catch(error => { console.error(error); process.exitCode = 1; });
