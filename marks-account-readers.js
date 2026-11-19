'use strict';

const GOOGLE = 'https://www.googleapis.com';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const text = (value, cap = 300) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, cap);
const email = /^[\w.+%-]+@[\w.-]+\.[a-z]{2,}$/i;

function createAccountReaders({ accessToken, fetchImpl = fetch, now = Date.now }) {
  async function get(provider, route, params, token, signal) {
    const target = new URL(route);
    for (const [key, values] of Object.entries(params)) for (const value of [].concat(values)) target.searchParams.append(key, value);
    const response = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), redirect: 'error',
    });
    if (!response.ok) throw new Error(`${provider} could not read account data (HTTP ${response.status}).`);
    return response.json();
  }

  async function credentials(provider, signal) {
    if (!['google', 'microsoft'].includes(provider)) throw new Error('Choose Google or Microsoft.');
    const token = await accessToken(provider, signal);
    if (typeof token !== 'string' || !token || /\s/.test(token)) throw new Error(`${provider} is not connected.`);
    return token;
  }

  async function messages(provider, { sender, since = now() - 86400000, signal }) {
    if (sender && !email.test(sender)) throw new Error('Enter a complete email address.');
    const token = await credentials(provider, signal);
    if (provider === 'google') {
      const q = `after:${Math.floor(since / 1000)}` + (sender ? ` from:${sender}` : '');
      const list = await get(provider, GMAIL + '/messages', { labelIds: 'INBOX', maxResults: 20, q }, token, signal);
      const results = [];
      for (const item of (list.messages || []).slice(0, 20)) {
        if (!/^[a-z0-9-]{1,120}$/i.test(item.id)) continue;
        const data = await get(provider, GMAIL + '/messages/' + item.id, { format: 'metadata', metadataHeaders: ['From', 'Subject'] }, token, signal);
        const find = name => (data.payload?.headers || []).find(header => header.name.toLowerCase() === name)?.value;
        const from = text(find('from'), 250);
        results.push({ id: item.id, from, subject: text(find('subject') || data.snippet), at: Number(data.internalDate) });
      }
      return { rows: filterMessages(results, sender, since), limited: !!list.nextPageToken };
    }
    const filter = `receivedDateTime ge ${new Date(since).toISOString()}` + (sender ? ` and from/emailAddress/address eq '${sender}'` : '');
    const list = await get(provider, GRAPH + '/mailFolders/inbox/messages', { '$top': 20,
      '$select': 'id,from,subject,receivedDateTime', '$filter': filter }, token, signal);
    const rows = (list.value || []).slice(0, 20).map(item => ({ id: text(item.id), from: text(item.from?.emailAddress?.address, 250),
      subject: text(item.subject), at: Date.parse(item.receivedDateTime) }));
    return { rows: filterMessages(rows, sender, since), limited: !!list['@odata.nextLink'] };
  }

  function filterMessages(rows, sender, since) {
    return rows.filter(row => row.id && Number.isFinite(row.at) && row.at >= since && (!sender ||
      (/<([^<>]+)>\s*$/.exec(row.from)?.[1] || row.from).toLowerCase() === sender.toLowerCase()));
  }

  async function calendar(provider, { days = 7, signal }) {
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Choose 1–30 days.');
    const token = await credentials(provider, signal);
    const start = new Date(now()).toISOString(), end = new Date(now() + days * 86400000).toISOString();
    if (provider === 'google') {
      const data = await get(provider, GOOGLE + '/calendar/v3/calendars/primary/events', {
        timeMin: start, timeMax: end, maxResults: 20, singleEvents: true, orderBy: 'startTime',
      }, token, signal);
      return { rows: (data.items || []).slice(0, 20).map(item => ({ title: text(item.summary), start: text(item.start?.dateTime || item.start?.date) })), limited: !!data.nextPageToken };
    }
    const data = await get(provider, GRAPH + '/calendar/calendarView', { startDateTime: start, endDateTime: end,
      '$top': 20, '$select': 'subject,start', '$orderby': 'start/dateTime' }, token, signal);
    return { rows: (data.value || []).slice(0, 20).map(item => ({ title: text(item.subject), start: text(item.start?.dateTime) + 'Z' })), limited: !!data['@odata.nextLink'] };
  }

  return { messages, calendar };
}

module.exports = { createAccountReaders, email };
