'use strict';

const { randomBytes, createHash } = require('node:crypto');

function createAccounts({ port, env = process.env, fetchImpl = fetch, now = Date.now }) {
  const settings = {
    google: { base: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'],
      id: env.JARVIS_MARKS_GOOGLE_CLIENT_ID, secret: env.JARVIS_MARKS_GOOGLE_CLIENT_SECRET },
    microsoft: { base: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/Calendars.Read'],
      id: env.JARVIS_MARKS_MICROSOFT_CLIENT_ID, secret: env.JARVIS_MARKS_MICROSOFT_CLIENT_SECRET },
  };
  const attempts = new Map(), accounts = new Map(), active = new Map();
  const configured = provider => Object.hasOwn(settings, provider) && !!settings[provider].id && (provider !== 'google' || !!settings[provider].secret);
  const callback = `http://localhost:${port}/marks-oauth.html`;
  const random = () => randomBytes(32).toString('base64url');

  function begin(provider) {
    if (!configured(provider)) throw new Error('Configure this provider’s Marks OAuth client on the server.');
    const config = settings[provider], state = random(), verifier = random(), browser = random();
    if (attempts.size >= 10) attempts.delete(attempts.keys().next().value);
    attempts.set(state, { provider, verifier, browser, expires: now() + 5 * 60 * 1000 });
    const request = new URL(config.base);
    request.search = new URLSearchParams({ client_id: config.id, redirect_uri: callback, response_type: 'code',
      scope: config.scopes.join(' '), state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : { prompt: 'select_account' }),
    });
    return { url: request.href, browser };
  }

  async function exchange(provider, fields, signal) {
    const config = settings[provider];
    const controller = new AbortController();
    active.set(controller, provider);
    const body = new URLSearchParams({ client_id: config.id, ...(config.secret && { client_secret: config.secret }), ...fields });
    const requestSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(12000)]);
    try {
      const response = await fetchImpl(config.token, { method: 'POST', body, redirect: 'error', signal: requestSignal });
      if (!response.ok) throw new Error('The provider could not authorize this account.');
      const token = await response.json();
      requestSignal.throwIfAborted();
      if (String(token.token_type).toLowerCase() !== 'bearer' || typeof token.access_token !== 'string' || !Number.isFinite(Number(token.expires_in))) {
        throw new Error('The provider did not return usable credentials.');
      }
      return { access: token.access_token, refresh: token.refresh_token, expires: now() + Number(token.expires_in) * 1000 };
    } finally { active.delete(controller); }
  }

  async function finish({ state, code, cookie, signal }) {
    const attempt = attempts.get(state);
    if (!attempt || attempt.browser !== cookie || attempt.expires <= now() || typeof code !== 'string' || !code || code.length > 4096) {
      throw new Error('This authorization expired. Start again in Marks.');
    }
    attempts.delete(state);
    const token = await exchange(attempt.provider, { grant_type: 'authorization_code', code, code_verifier: attempt.verifier, redirect_uri: callback }, signal);
    signal.throwIfAborted();
    accounts.set(attempt.provider, token);
  }

  const refreshes = new Map();
  async function accessToken(provider, signal) {
    const previous = accounts.get(provider);
    if (!previous) return null;
    if (previous.expires > now() + 30000) return previous.access;
    if (!previous.refresh) return null;
    if (!refreshes.has(provider)) {
      const refresh = exchange(provider, { grant_type: 'refresh_token', refresh_token: previous.refresh }, AbortSignal.timeout(15000))
        .then(token => {
          if (accounts.get(provider) !== previous) return null;
          accounts.set(provider, { ...token, refresh: token.refresh || previous.refresh });
          return token.access;
        }).finally(() => refreshes.delete(provider));
      refreshes.set(provider, refresh);
    }
    const access = await refreshes.get(provider);
    signal.throwIfAborted();
    return access;
  }

  function disconnect(provider) {
    accounts.delete(provider);
    for (const [controller, owner] of active) if (provider === owner) controller.abort();
    for (const [id, attempt] of attempts) if (attempt.provider === provider) attempts.delete(id);
  }

  return { begin, finish, accessToken, disconnect,
    clear() { attempts.clear(); accounts.clear(); for (const controller of active.keys()) controller.abort(); },
    status() { return Object.keys(settings).map(provider => ({ provider, configured: configured(provider), connected: accounts.has(provider) })); },
  };
}

module.exports = { createAccounts };
