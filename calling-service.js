'use strict';

const https = require('node:https');
const crypto = require('node:crypto');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS_PER_WINDOW = 3;
const MAX_MESSAGE_LENGTH = 600;

function cleanMessage(value) {
  return String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

function createCallingService(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const request = options.request || requestTwilio;
  const attempts = [];
  const callOnReminders = () => String(env.JARVIS_CALL_ON_REMINDERS || '').toLowerCase() === 'true';
  const configured = () => Boolean(env.JARVIS_TWILIO_ACCOUNT_SID && env.JARVIS_TWILIO_AUTH_TOKEN &&
    env.JARVIS_TWILIO_FROM_NUMBER && env.JARVIS_CALL_TO_NUMBER);

  function status() {
    return {
      configured: configured(),
      enabled: String(env.JARVIS_CALLING_ENABLED || '').toLowerCase() === 'true' && configured(),
      reminderCallsEnabled: callOnReminders(),
      provider: 'twilio',
      mode: 'outbound-announcement',
      rateLimit: { maxCalls: MAX_CALLS_PER_WINDOW, windowMinutes: 10 },
      required: ['JARVIS_CALLING_ENABLED=true', 'JARVIS_TWILIO_ACCOUNT_SID', 'JARVIS_TWILIO_AUTH_TOKEN',
        'JARVIS_TWILIO_FROM_NUMBER', 'JARVIS_CALL_TO_NUMBER']
    };
  }

  async function call(input = {}, metadata = {}) {
    const config = status();
    if (!config.enabled) throw Object.assign(new Error('CALLING_NOT_CONFIGURED'), { code: 'CALLING_NOT_CONFIGURED' });
    const to = String(env.JARVIS_CALL_TO_NUMBER || '').trim();
    const from = String(env.JARVIS_TWILIO_FROM_NUMBER || '').trim();
    if (!/^\\+[1-9]\\d{7,14}$/.test(to) || !/^\\+[1-9]\\d{7,14}$/.test(from)) {
      throw Object.assign(new Error('PHONE_NUMBER_MUST_BE_E164'), { code: 'PHONE_NUMBER_MUST_BE_E164' });
    }
    const message = cleanMessage(input.message || input.body || input.title);
    if (!message) throw Object.assign(new Error('CALL_MESSAGE_REQUIRED'), { code: 'CALL_MESSAGE_REQUIRED' });
    const current = now();
    while (attempts.length && current - attempts[0] >= WINDOW_MS) attempts.shift();
    if (attempts.length >= MAX_CALLS_PER_WINDOW) {
      throw Object.assign(new Error('CALL_RATE_LIMITED'), { code: 'CALL_RATE_LIMITED', retryAfterMs: WINDOW_MS - (current - attempts[0]) });
    }
    if (metadata.source === 'reminder' && !callOnReminders()) {
      throw Object.assign(new Error('REMINDER_CALLS_DISABLED'), { code: 'REMINDER_CALLS_DISABLED' });
    }
    attempts.push(current);
    const sid = String(env.JARVIS_TWILIO_ACCOUNT_SID);
    const text = escapeXml(message);
    // Inline TwiML means Twilio does not need to call back into a private laptop address.
    const twiml = '<Response><Say>' + text + '</Say><Pause length="1"/></Response>';
    const form = new URLSearchParams({ To: to, From: from, Twiml: twiml }).toString();
    try {
      const result = await request({
        sid, token: String(env.JARVIS_TWILIO_AUTH_TOKEN), form,
        idempotencyKey: crypto.randomUUID()
      });
      return { ok: true, callSid: result.sid, status: result.status || 'queued', to: maskNumber(to), createdAt: current };
    } catch (error) {
      // Count attempted calls too, including provider errors, to prevent rapid retry loops.
      throw Object.assign(new Error(error.code || 'CALL_PROVIDER_FAILED'), { code: error.code || 'CALL_PROVIDER_FAILED' });
    }
  }

  return Object.freeze({ status, call, callOnReminders });
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function maskNumber(value) { return String(value).replace(/.(?=.{4})/g, '•'); }

function requestTwilio({ sid, token, form }) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(form);
    const req = https.request({
      hostname: 'api.twilio.com', port: 443, method: 'POST',
      path: '/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Calls.json',
      auth: sid + ':' + token,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length, 'Accept': 'application/json' },
      timeout: 10000
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size <= 64 * 1024) chunks.push(chunk); else req.destroy(new Error('CALL_PROVIDER_RESPONSE_TOO_LARGE')); });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new Error('CALL_PROVIDER_INVALID_RESPONSE')); }
        if (res.statusCode < 200 || res.statusCode >= 300 || !data.sid) {
          return reject(Object.assign(new Error('CALL_PROVIDER_REJECTED'), { code: 'CALL_PROVIDER_REJECTED' }));
        }
        resolve({ sid: data.sid, status: data.status });
      });
    });
    req.on('timeout', () => req.destroy(new Error('CALL_PROVIDER_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}

module.exports = { createCallingService, cleanMessage, escapeXml, MAX_CALLS_PER_WINDOW, WINDOW_MS };
