'use strict';
/* Server-side reminders and deadline alerts, so they fire even when no JARVIS tab is open.
   The server owns firing; open tabs are told over Server-Sent Events (/api/events) and only display/speak it.
   With no tab open, a Windows toast is shown instead; optionally every alert is also pushed to the user's phone
   through ntfy.sh. Scheduled routines ("routineId") stay in the browser — their step executor lives in the page. */
const { execFile } = require('child_process');
const Study = require('./study');

const DEADLINE_WINDOW = 3 * 36e5;
const KEEP_FIRED = 7 * 864e5;

// Same rules as the page's original nextOccurrence(): missed occurrences are skipped, not replayed.
function nextOccurrence(r, now) {
  let at = r.at;
  const rep = r.repeat;
  // With no explicit day/month in the repeat, keep the reminder's own day-of-month (and month), clamped to month length.
  const dom = rep.day || new Date(r.at).getDate();
  do {
    if (rep.type === 'interval') at += Math.max(6e4, rep.ms || 0);
    else if (rep.type === 'weekly') at += 7 * 864e5;
    else if (rep.type === 'monthly') { // same day-of-month & time; Jan 31 → Feb 28, never a skipped month
      const d = new Date(at); d.setMonth(d.getMonth() + 1, 1);
      d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      at = d.getTime();
    }
    else if (rep.type === 'yearly') {
      const d = new Date(at); d.setFullYear(d.getFullYear() + 1, rep.month === undefined ? d.getMonth() : rep.month, 1);
      d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      at = d.getTime();
    }
    else {
      const d = new Date(at); d.setDate(d.getDate() + 1);
      if (rep.type === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      at = d.getTime();
    }
  } while (at <= now);
  return at;
}

// Fires what's due; returns the updated list (fired one-offs older than a week dropped) and the events.
function fireDue(list, now) {
  const events = [];
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== 'object') continue;
    if (!r.fired && typeof r.at === 'number' && r.at <= now && !r.routineId) {
      const next = Object.assign({}, r);
      if (r.repeat && r.repeat.type) next.at = nextOccurrence(r, now); else next.fired = true;
      events.push({ type: 'reminder', id: r.id, text: String(r.text || 'Reminder'), at: next.at, fired: !!next.fired });
      out.push(next);
    } else if (r.fired && !r.repeat && typeof r.at === 'number' && r.at < now - KEEP_FIRED) {
      continue;
    } else out.push(r);
  }
  return { list: out, events };
}

// A tab writes back its whole reminders array from when it loaded. It may add or delete reminders (kept), but
// it must never un-fire one the server already fired, or move a repeating reminder back in time.
function mergeReminders(serverList, incoming) {
  if (!Array.isArray(incoming)) return incoming;
  const byId = new Map((Array.isArray(serverList) ? serverList : []).filter(r => r && r.id).map(r => [r.id, r]));
  return incoming.map(r => {
    const s = r && byId.get(r.id);
    if (!s) return r;
    const m = Object.assign({}, r);
    if (s.fired) m.fired = true;
    if (r.repeat && typeof s.at === 'number' && typeof r.at === 'number') m.at = Math.max(s.at, r.at);
    return m;
  });
}

function dueDeadlines(deadlines, alerted, now) {
  const seen = new Set(Array.isArray(alerted) ? alerted : []);
  return (Array.isArray(deadlines) ? deadlines : []).filter(d => d && !d.done && typeof d.due === 'number' &&
    d.due > now && d.due - now <= DEADLINE_WINDOW && !seen.has(d.id));
}

// Windows toast via WinRT. Text travels in environment variables and is XML-escaped inside PowerShell.
const TOAST = `$ErrorActionPreference = 'Stop'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$e = [System.Security.SecurityElement]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast activationType='protocol' launch='" + $e::Escape($env:J_URL) + "'><visual><binding template='ToastGeneric'><text>" + $e::Escape($env:J_TITLE) + "</text><text>" + $e::Escape($env:J_BODY) + "</text></binding></visual><audio src='ms-winsoundevent:Notification.Reminder'/></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show((New-Object Windows.UI.Notifications.ToastNotification $x))
'ok'`;

const phoneauth = require('./phoneauth');

module.exports = function setupScheduler(app, { getState, saveState, PORT, IS_WIN, llm, DEFAULT_MODEL, getConfig, saveConfig, procOf = () => null }) {
  const clients = new Set();
  const onLaptop = new Map(); // SSE client → opened on the laptop itself (vs. the phone over Tailscale)
  // The tab that announces (speaks) an alert: the most recent laptop tab, else the most recent tab anywhere.
  const leader = () => { const all = [...clients]; return all.slice().reverse().find(c => onLaptop.get(c)) || all[all.length - 1] || null; };
  const log = (...a) => console.log('[scheduler]', ...a);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Same command parser the page uses, to tell questions from commands when no JARVIS tab is open.
  const nluBox = {};
  require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, 'nlu.js'), 'utf8') + ';this.NLU = NLU;', nluBox);
  const NLU = nluBox.NLU;

  function toast(title, body) {
    if (!IS_WIN) return Promise.resolve(false);
    return new Promise(done => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', TOAST],
      { windowsHide: true, timeout: 15000, env: { ...process.env, J_TITLE: title, J_BODY: body, J_URL: `http://localhost:${PORT}/` } },
      (err, out) => { const ok = !err && /ok/.test(String(out)); if (!ok) log('toast failed:', err ? err.message.split('\n')[0] : String(out).trim()); done(ok); }));
  }

  // Everything JARVIS publishes carries the "jarvis" tag, so the listener below never answers itself.
  async function publish(topic, title, message, tags = [], priority = 3) {
    try {
      const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, title, message, tags: ['jarvis', ...tags], priority }) });
      if (!r.ok) log('phone push failed: HTTP', r.status);
      return r.ok;
    } catch (e) { log('phone push failed:', e.message); return false; }
  }
  async function phonePush(settings, title, body) {
    const topic = String(settings.phoneTopic || '');
    if (!settings.phonePush || !/^[\w-]{8,64}$/.test(topic)) return false;
    return publish(topic, title, body, ['alarm_clock'], 4);
  }

  /* ---- messages FROM the phone: JARVIS listens to the same ntfy topic ---- */
  const wantedTopic = () => {
    const s = getState()['jarvis.settings'] || {};
    return s.phonePush && /^[\w-]{8,64}$/.test(String(s.phoneTopic || '')) ? String(s.phoneTopic) : null;
  };
  const recentPhone = [];
  const unlockFails = [];
  const usedSteps = new Set(); // authenticator time-steps already used, so a code seen on the topic can't be replayed
  const UNLOCK_MS = 15 * 6e4;
  let unlockedUntil = 0;
  let stream = null;
  const lastIds = {};
  async function askLocalAI(text) {
    try {
      // The model picked in Settings (local or cloud), else the default local one.
      const model = (getState()['jarvis.settings'] || {}).model || DEFAULT_MODEL;
      const out = await llm.complete({ model, temperature: 0.5, maxTokens: 300, timeoutMs: 90000,
        system: 'You are J.A.R.V.I.S., replying to a message from your user\'s phone. Answer in at most 4 short sentences. You cannot perform actions on the laptop right now.',
        messages: [{ role: 'user', content: text }] });
      return out || null;
    } catch { return null; }
  }
  async function onPhoneMessage(text, id, topic) {
    const now = Date.now();
    while (recentPhone.length && recentPhone[0] < now - 10 * 6e4) recentPhone.shift();
    // Tight while locked (stops spam and code guessing), roomier once unlocked with the authenticator.
    const limit = now < unlockedUntil ? 60 : 15;
    if (recentPhone.length >= limit) { if (recentPhone.length === limit) { recentPhone.push(now); await publish(topic, 'JARVIS', 'Too many messages — I’m ignoring new ones for a few minutes.'); } return; }
    recentPhone.push(now);
    // Security before execution: the topic is public, so commands only run after "unlock <6-digit code>" from
    // the user's authenticator app, for 15 minutes (or until "lock"). The code itself never reaches the page.
    const auth = getConfig().phoneAuth;
    const say = msg => publish(topic, 'JARVIS', msg);
    // Accepts "unlock 482913", just "482913", or the code as Google Authenticator shows it ("482 913"), also "code: 482-913".
    const m6 = /^(?:(?:unlock|code|otp|pin)\s*[:\-]?\s*)?(\d{3})[\s-]?(\d{3})[.!]?$/i.exec(text.replace(/\s+/g, ' ').trim());
    const unlock = m6 ? [m6[0], m6[1] + m6[2]] : null;
    if (unlock) {
      if (!auth || !auth.secret) return say('Set up the authenticator first: JARVIS Settings → Phone alerts → SET UP PHONE COMMANDS.');
      while (unlockFails.length && unlockFails[0] < now - 10 * 6e4) unlockFails.shift();
      if (unlockFails.length >= 5) return say('Too many wrong codes — try again in 10 minutes.');
      if (!phoneauth.verifyCode(auth.secret, unlock[1], now, usedSteps)) { unlockFails.push(now); log('phone unlock: wrong code'); return say('❌ That code didn’t match. Use the NEWEST 6 digits under "JARVIS" in Google Authenticator (they change every 30 seconds). If JARVIS isn’t in the app, add it first: laptop → JARVIS → Settings → Guided setup → PHONE → step 3.'); }
      unlockedUntil = now + UNLOCK_MS; unlockFails.length = 0;
      log('phone unlocked for 15 min');
      return say('🔓 Unlocked for 15 minutes. Send your commands — "lock" to lock again.');
    }
    if (/^lock$/i.test(text.trim())) { unlockedUntil = 0; log('phone locked'); return say('🔒 Locked.'); }
    if (!auth || !auth.secret) return say('Phone commands aren’t set up yet: JARVIS Settings → Phone alerts → SET UP PHONE COMMANDS.');
    if (now > unlockedUntil) return say('🔒 Locked, so nobody else can control your laptop. Open Google Authenticator on this phone, find "JARVIS", and send the 6 digits it shows (e.g. 482913). Not added JARVIS to Google Authenticator yet? On the laptop: JARVIS → Settings → Guided setup → PHONE → step 3.');
    log('phone message:', text.slice(0, 80), clients.size ? '→ tab' : '→ answered by the server (no tab open)');
    if (clients.size) return broadcast({ type: 'phone', id, text });
    // No JARVIS tab open: actions live in the page, so only questions can be answered from here.
    const p = NLU.classify(NLU.normalize(text, (getState()['jarvis.settings'] || {}).wakeWord || 'jarvis'), {});
    if (p.intent !== 'CONVERSATION' && p.confidence >= 0.85)
      return publish(topic, 'JARVIS', `JARVIS isn't open on your laptop, so I can't do "${text.slice(0, 80)}" right now. Open JARVIS and send it again — questions still work without it.`);
    await publish(topic, 'JARVIS', (await askLocalAI(text)) || 'The local AI isn’t available right now.');
  }
  async function listenToPhone() {
    let delay = 2000;
    for (;;) {
      const topic = wantedTopic();
      if (!topic) { await wait(10000); continue; }
      const ctrl = new AbortController(); stream = { topic, ctrl };
      try {
        const r = await fetch(`https://ntfy.sh/${topic}/json` + (lastIds[topic] ? `?since=${lastIds[topic]}` : ''), { signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        log('listening for phone messages'); delay = 2000;
        const dec = new TextDecoder(); let buf = '';
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            let ev; try { ev = JSON.parse(line); } catch { continue; }
            if (ev.event !== 'message') continue;
            lastIds[topic] = ev.id;
            if ((ev.tags || []).includes('jarvis')) continue;
            const text = String(ev.message || '').trim().slice(0, 500);
            if (text) onPhoneMessage(text, ev.id, topic).catch(e => log('phone message error:', e.message));
          }
        }
      } catch (e) { if (!ctrl.signal.aborted) log('phone listener:', e.message); }
      stream = null;
      await wait(delay); delay = Math.min(60000, delay * 2);
    }
  }
  // Reconnect when phone alerts are switched off/on or the topic changes.
  setInterval(() => { if (stream && stream.topic !== wantedTopic()) stream.ctrl.abort(); }, 10000);
  listenToPhone();
  // Authenticator setup — only from the JARVIS page on the laptop itself (never over Tailscale or another site).
  const fromLaptopPage = req => req.headers['sec-fetch-site'] === 'same-origin' && /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || ''));
  app.get('/api/phone/auth', (req, res) => {
    const a = getConfig().phoneAuth;
    res.json({ configured: !!(a && a.secret), unlockedUntil: unlockedUntil > Date.now() ? unlockedUntil : 0 });
  });
  app.post('/api/phone/auth/setup', (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Set this up from JARVIS on the laptop.' });
    const cfg = getConfig();
    if (!cfg.phoneAuth || !cfg.phoneAuth.secret || (req.body && req.body.reset === true)) {
      cfg.phoneAuth = { secret: phoneauth.newSecret(), createdAt: Date.now() }; saveConfig();
      unlockedUntil = 0; usedSteps.clear(); log('phone authenticator key ' + (req.body && req.body.reset ? 'reset' : 'created'));
    }
    res.json({ secret: cfg.phoneAuth.secret, uri: phoneauth.otpauthUri(cfg.phoneAuth.secret) });
  });
  // "Why is my code wrong?" — typed on the laptop. Says whether the code belongs to this key, and if the laptop clock
  // is off (codes are time-based). Doesn't unlock anything and doesn't use the code up.
  app.post('/api/phone/auth/check', async (req, res) => {
    if (!fromLaptopPage(req)) return res.status(403).json({ error: 'Check this on the laptop.' });
    const a = getConfig().phoneAuth;
    if (!a || !a.secret) return res.json({ result: 'no-key' });
    const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
    if (code.length !== 6) return res.json({ result: 'bad-format' });
    let skew = null; // seconds the laptop clock is off, from an internet time source
    try { const r = await fetch('https://ntfy.sh/', { method: 'HEAD', signal: AbortSignal.timeout(5000) }); const d = Date.parse(r.headers.get('date')); if (d) skew = Math.round((Date.now() - d) / 1000); } catch {}
    const now = Date.now();
    let offset = null;
    for (let s = -20; s <= 20 && offset === null; s++) if (phoneauth.totpAt(a.secret, now + s * 30000) === code) offset = s * 30;
    res.json({ result: offset === null ? 'other-key' : Math.abs(offset) <= 60 ? 'ok' : 'clock', offset, skew });
  });

  // The page's answer to a phone message goes back to the phone.
  app.post('/api/phone/reply', async (req, res) => {
    const topic = wantedTopic();
    const text = String((req.body && req.body.text) || '').trim().slice(0, 1500);
    if (!topic || !text) return res.status(400).json({ error: 'phone alerts are off' });
    res.status((await publish(topic, 'JARVIS', text)) ? 200 : 502).json({ success: true });
  });

  function broadcast(ev) {
    const lead = leader();
    for (const c of clients) {
      try { c.write(`event: ${ev.type}\ndata: ${JSON.stringify(Object.assign({}, ev, { lead: c === lead }))}\n\n`); } catch {}
    }
  }

  async function deliver(ev, title, body) {
    const settings = getState()['jarvis.settings'] || {};
    const tabs = clients.size;
    if (tabs) broadcast(ev); else await toast(title, body);
    await phonePush(settings, title, body);
    log(`${ev.type} fired: ${body} → ${tabs ? tabs + ' tab(s)' : 'Windows toast'}${settings.phonePush ? ' + phone' : ''}`);
  }

  async function tick() {
    const state = getState();
    const now = Date.now();
    let changed = false;
    const panic = state['jarvis.panic'] === true;
    const { list, events } = fireDue(state['jarvis.reminders'], now);
    if (events.length || (Array.isArray(state['jarvis.reminders']) && list.length !== state['jarvis.reminders'].length)) {
      state['jarvis.reminders'] = list; changed = true;
    }
    const settings = state['jarvis.settings'] || {};
    // Panic mode: deadlines/weekly digests/triggers hold; reminders still record as fired (never lost) but say so.
    const due = settings.alerts === false || panic ? [] : dueDeadlines(state['jarvis.deadlines'], state['jarvis.serverAlerted'], now);
    if (due.length) {
      const live = new Set((state['jarvis.deadlines'] || []).map(d => d && d.id));
      state['jarvis.serverAlerted'] = (state['jarvis.serverAlerted'] || []).filter(id => live.has(id)).concat(due.map(d => d.id));
      changed = true;
    }
    // Sunday evening: a short summary of the week (once per week; only if something was logged; part of Smart alerts).
    const nowD = new Date(now);
    let weekly = null;
    if (!panic && settings.alerts !== false && nowD.getDay() === 0 && nowD.getHours() >= 19 && state['jarvis.weeklySent'] !== Study.weekId(nowD)) {
      const w = Study.weekSummary(state['jarvis.stats'], state['jarvis.sessions'], nowD.toISOString().slice(0, 10), now);
      state['jarvis.weeklySent'] = Study.weekId(nowD); changed = true;
      if (w.any) weekly = w.lines.join(' · ');
    }
    if (changed) saveState();
    if (weekly) await deliver({ type: 'reminder', digest: true, id: 'weekly-' + Study.weekId(nowD), text: '📊 Your week: ' + weekly }, 'JARVIS — your week', weekly);
    for (const ev of events) await deliver(panic ? { ...ev, panic: true } : ev, 'JARVIS reminder', ev.text);
    for (const d of due) {
      const hrs = Math.max(1, Math.round((d.due - now) / 36e5));
      const time = new Date(d.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      await deliver({ type: 'deadline', id: d.id, title: String(d.title || 'Deadline'), due: d.due }, 'JARVIS — deadline soon', `${d.title} is due at ${time} (about ${hrs}h left).`);
    }
  }
  let running = false;
  setInterval(() => { if (running) return; running = true; tick().catch(e => log('tick error:', e.message)).finally(() => { running = false; }); }, 15000);

  /* ---- triggers: "when the charger is plugged in / an app opens / Wi-Fi connects, run a routine" ---- */
  // Watches only what the enabled triggers need (so no PowerShell/netsh runs when there are none), and announces an
  // edge to the open tab, which runs the routine (routine steps live in the page and only ever run safe-tier steps).
  // With no tab open it shows a toast and holds the trigger for 10 minutes, to run when a tab connects.
  const Triggers = require('./triggers');
  let prevSnap = null, watching = false, pendingTriggers = [];
  const lastFired = new Map();
  // Other modules (the global hotkey) reuse the same channel to reach the open tab, or hold an event until one connects.
  app.locals.broadcast = broadcast; app.locals.tabCount = () => clients.size; app.locals.hold = ev => pendingTriggers.push({ ev, at: Date.now() });
  const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 15000, maxBuffer: 4e6 }, (e, o) => res(e ? null : String(o))));
  async function sampleSensors(need) {
    const s = {};
    if (!IS_WIN) return s;
    if (need.power) {
      const o = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress']);
      try { const j = JSON.parse(o); s.battery = +j.EstimatedChargeRemaining; s.charger = [2, 6, 7, 8, 9].includes(+j.BatteryStatus); } catch { s.battery = null; s.charger = null; }
    }
    if (need.apps) {
      const o = await run('tasklist', ['/FO', 'CSV', '/NH']);
      if (o) s.apps = [...new Set(o.split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map(n => n.replace(/\.exe$/i, '').toLowerCase()))];
    }
    if (need.wifi) {
      const o = await run('netsh', ['wlan', 'show', 'interfaces']);
      const m = o && o.match(/^\s*SSID\s*:\s*(.+)$/m);
      s.wifi = m ? m[1].trim() : null;
    }
    return s;
  }
  async function fireTrigger(t) {
    const r = (getState()['jarvis.routines'] || []).find(x => x && x.id === t.routineId);
    const name = t.routineName || (r && r.name) || 'a routine';
    const label = t.label || Triggers.describeWhen(t.when);
    const ev = { type: 'trigger', triggerId: t.id, routineId: t.routineId, text: '⚡ ' + label + ' — running "' + name + '"' };
    if (clients.size) broadcast(ev);
    else { pendingTriggers.push({ ev, at: Date.now() }); await toast('JARVIS trigger', label + ' — open JARVIS to run "' + name + '"'); }
    log('trigger fired:', label, '→', name, clients.size ? '(' + clients.size + ' tab(s))' : '(no tab — toast, held 10 min)');
  }
  async function watchTick() {
    if (getState()['jarvis.panic'] === true) { prevSnap = null; return; } // panic: no triggers, no sensor polling
    const list = (getState()['jarvis.triggers'] || []).filter(t => t && t.enabled !== false && t.when && t.routineId);
    if (!list.length) { prevSnap = null; return; }
    const cur = { ...(prevSnap || {}), ...(await sampleSensors(Triggers.needs(list))) };
    for (const id of Triggers.diffTriggers(prevSnap, cur, list, Date.now(), lastFired, procOf)) { const t = list.find(x => x.id === id); if (t) await fireTrigger(t); }
    prevSnap = cur;
  }
  setInterval(() => { if (watching) return; watching = true; watchTick().catch(e => log('trigger watch error:', e.message)).finally(() => { watching = false; }); }, 20000);

  // Server-Sent Events for open tabs. Same-origin only (EventSource from another site is refused).
  app.get('/api/events', (req, res) => {
    if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).end();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    clients.add(res); onLaptop.set(res, /^(localhost|127\.0\.0\.1):/.test(String(req.headers.host || '')));
    // Triggers that fired while no tab was open (< 10 min ago) run now that one is here.
    const held = pendingTriggers.filter(p => Date.now() - p.at < 10 * 6e4); pendingTriggers = [];
    held.forEach((p, i) => setTimeout(() => broadcast(p.ev), 2500 + i * 1500));
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(beat); clients.delete(res); onLaptop.delete(res); });
  });

  app.post('/api/notify/test', async (req, res) => {
    const settings = Object.assign({}, getState()['jarvis.settings'] || {}, { phonePush: true, phoneTopic: req.body && req.body.topic });
    if (!/^[\w-]{8,64}$/.test(String(settings.phoneTopic || ''))) return res.status(400).json({ error: 'invalid topic' });
    const ok = await phonePush(settings, 'JARVIS test', 'Phone alerts are working. Reminders will show up here.');
    res.status(ok ? 200 : 502).json(ok ? { success: true } : { error: 'Could not reach ntfy.sh — are you online?' });
  });
};
module.exports.nextOccurrence = nextOccurrence;
module.exports.fireDue = fireDue;
module.exports.mergeReminders = mergeReminders;
module.exports.dueDeadlines = dueDeadlines;
