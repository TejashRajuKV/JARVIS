'use strict';
const assert = require('node:assert/strict');
const { createCallingService, escapeXml, cleanMessage, isQuietHours } = require('../calling-service');

(async () => {
  assert.equal(escapeXml('<JARVIS & "me">'), '&lt;JARVIS &amp; &quot;me&quot;&gt;');
  assert.equal(cleanMessage(' hello\\n  world '), 'hello world');
  assert.equal(isQuietHours('22:00-07:00', new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(isQuietHours('22:00-07:00', new Date(2026, 0, 1, 6, 59)), true);
  assert.equal(isQuietHours('22:00-07:00', new Date(2026, 0, 1, 12, 0)), false);
  assert.equal(isQuietHours('bad-window', new Date(2026, 0, 1, 23, 0)), false);

  const env = {
    JARVIS_CALLING_ENABLED: 'true', JARVIS_TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32),
    JARVIS_TWILIO_AUTH_TOKEN: 'secret-never-return-this', JARVIS_TWILIO_FROM_NUMBER: '+14155550100',
    JARVIS_CALL_TO_NUMBER: '+14155550101', JARVIS_CALL_ON_REMINDERS: 'true',
    JARVIS_CALL_QUIET_HOURS: '22:00-07:00'
  };
  let current = new Date(2026, 0, 1, 12, 0).getTime();
  const requests = [];
  const service = createCallingService({
    env, now: () => current,
    request: async input => {
      requests.push(input);
      return { sid: 'CA' + '2'.repeat(32), status: 'queued' };
    }
  });
  assert.equal(service.status().enabled, true);
  assert.equal(JSON.stringify(service.status()).includes('secret-never-return-this'), false);
  const result = await service.call({ message: 'Assignment due <tomorrow> & check.' }, { source: 'owner' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.to.endsWith('0101'), true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].form, /Twiml=/);
  assert.match(decodeURIComponent(requests[0].form), /Assignment due &lt;tomorrow&gt; &amp; check/);
  await assert.rejects(() => service.call({ message: '   ' }), e => e.code === 'CALL_MESSAGE_REQUIRED');

  const disabled = createCallingService({ env: { ...env, JARVIS_CALL_ON_REMINDERS: 'false' }, request: async () => { throw new Error('must not call'); } });
  await assert.rejects(() => disabled.call({ message: 'Reminder' }, { source: 'reminder' }), e => e.code === 'REMINDER_CALLS_DISABLED');
  const quiet = createCallingService({ env, now: () => new Date(2026, 0, 1, 23, 0).getTime(), request: async () => { throw new Error('must not call'); } });
  await assert.rejects(() => quiet.call({ message: 'Reminder' }, { source: 'reminder' }), e => e.code === 'CALL_QUIET_HOURS');

  let attempts = 0;
  const limited = createCallingService({ env, now: () => current, request: async () => { attempts++; return { sid: 'CA' + '3'.repeat(32), status: 'queued' }; } });
  for (let i = 0; i < 3; i++) await limited.call({ message: 'Hello' });
  await assert.rejects(() => limited.call({ message: 'Fourth' }), e => e.code === 'CALL_RATE_LIMITED');
  assert.equal(attempts, 3);
  current += 10 * 60 * 1000;
  await limited.call({ message: 'Window reset' });
  assert.equal(attempts, 4);

  const missing = createCallingService({ env: {} });
  assert.equal(missing.status().enabled, false);
  await assert.rejects(() => missing.call({ message: 'Hello' }), e => e.code === 'CALLING_NOT_CONFIGURED');
  console.log('calling-service: configuration, safe TwiML, opt-in, quiet hours and rate-limit cases defined');
})().catch(error => { console.error(error); process.exitCode = 1; });
