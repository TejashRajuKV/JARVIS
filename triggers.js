'use strict';
/* Trigger-based routines: "when I plug in the charger, start study mode". Pure logic shared by the page (global
   `Triggers`), the server watcher (scheduler.js) and the tests. A trigger is
   { id, routineId, routineName, when:{type, n?|app?|ssid?}, cooldownMin, enabled }.
   Types: charger_plugged, charger_unplugged, battery_below, app_opened, app_closed, wifi_connected. */
const Triggers = (() => {
  const TYPES = ['charger_plugged', 'charger_unplugged', 'battery_below', 'app_opened', 'app_closed', 'wifi_connected'];

  // What the server has to measure for a set of triggers (so it only spawns PowerShell/netsh when someone needs it).
  function needs(triggers) {
    const n = { power: false, apps: false, wifi: false };
    for (const t of triggers || []) {
      const ty = t && t.when && t.when.type;
      if (ty === 'charger_plugged' || ty === 'charger_unplugged' || ty === 'battery_below') n.power = true;
      else if (ty === 'app_opened' || ty === 'app_closed') n.apps = true;
      else if (ty === 'wifi_connected') n.wifi = true;
    }
    return n;
  }

  // prev/cur: { charger: bool|null, battery: number|null, apps: string[]|null (lowercase process names), wifi: string|null }.
  // Only edges fire (a change between two looks), never the very first look, and never again inside the cooldown.
  function diffTriggers(prev, cur, triggers, now, lastFired, procOf) {
    const fired = [];
    if (!prev || !cur) return fired;
    for (const t of triggers || []) {
      if (!t || t.enabled === false || !t.when) continue;
      const w = t.when;
      let hit = false;
      if (w.type === 'charger_plugged') hit = prev.charger === false && cur.charger === true;
      else if (w.type === 'charger_unplugged') hit = prev.charger === true && cur.charger === false;
      else if (w.type === 'battery_below') hit = typeof cur.battery === 'number' && typeof prev.battery === 'number' && cur.battery < w.n && prev.battery >= w.n && cur.charger !== true;
      else if (w.type === 'app_opened' || w.type === 'app_closed') {
        const proc = String((procOf && procOf(w.app)) || '').toLowerCase();
        if (proc && prev.apps && cur.apps) {
          const was = prev.apps.includes(proc), is = cur.apps.includes(proc);
          hit = w.type === 'app_opened' ? !was && is : was && !is;
        }
      } else if (w.type === 'wifi_connected') hit = !!cur.wifi && cur.wifi.toLowerCase() === String(w.ssid || '').toLowerCase() && (prev.wifi || '').toLowerCase() !== cur.wifi.toLowerCase();
      if (!hit) continue;
      const cool = Math.max(1, +t.cooldownMin || 10) * 6e4;
      if (lastFired && lastFired.get(t.id) && now - lastFired.get(t.id) < cool) continue;
      if (lastFired) lastFired.set(t.id, now);
      fired.push(t.id);
    }
    return fired;
  }

  const describeWhen = (w, appName) => ({
    charger_plugged: 'the charger is plugged in', charger_unplugged: 'the charger is unplugged', battery_below: 'the battery drops below ' + (w && w.n) + '%',
    app_opened: (appName || (w && w.app)) + ' is opened', app_closed: (appName || (w && w.app)) + ' is closed', wifi_connected: 'you connect to Wi-Fi "' + (w && w.ssid) + '"',
  }[w && w.type] || 'something happens');

  /* ---------- parsing "when …, do …" ---------- */
  // → {type,…} or null. findApp(name) → {k,n} or null (the page's NLU.findApp).
  function parseEvent(text, findApp) {
    const orig = String(text || '').replace(/\s+/g, ' ').trim(), t = orig.toLowerCase();
    let m;
    if (/\b(unplug(ged|s)?|disconnect(ed|s)?|remove(d|s)?|pull(ed|s)? out)\b.*\b(charger|power|adapter|ac)\b|\b(charger|power|adapter)\b.*\b(unplug|disconnect|remove|pull)/.test(t)) return { type: 'charger_unplugged' };
    if (/\b(plug(ged|s)?( in)?|connect(ed|s)?|attach(ed)?)\b.*\b(charger|power|adapter|ac|charging)\b|\b(charger|power|adapter)\b.*\b(plug|connect|attach)|\bstart(s)? charging\b/.test(t)) return { type: 'charger_plugged' };
    if ((m = t.match(/\bbattery\b.*?\b(?:below|under|drops? (?:to|below)|falls? (?:to|below)|goes? (?:to|below)|is (?:below|under|at))\s*(\d{1,3})\s*(?:%|percent)?|\bbattery\b.*?\b(?:low)\b.*?(\d{1,3})\s*(?:%|percent)/))) {
      const n = +(m[1] || m[2]); if (n >= 1 && n <= 99) return { type: 'battery_below', n };
    }
    if ((m = orig.match(/\bconnect(?:s|ed)? to (?:the )?(?:wi-?fi|wifi|network)(?: network)?\s+["']?([^"',]+?)["']?$/i)) || (m = orig.match(/\bjoin(?:s|ed)? (?:the )?(?:wi-?fi|wifi)\s+["']?([^"',]+?)["']?$/i))) return { type: 'wifi_connected', ssid: m[1].trim() };
    if ((m = t.match(/\b(?:i |we )?(open|start|launch|run|fire up)s?(?: up)? (?:the )?(.+)$/)) || (m = t.match(/\b(?:i |we )?(close|quit|exit|kill|shut)s?(?: down)? (?:the )?(.+)$/))) {
      const app = findApp && findApp(m[2].trim());
      if (app) return { type: /^(open|start|launch|run|fire)/.test(m[1]) ? 'app_opened' : 'app_closed', app: app.k };
    }
    return null;
  }
  // "when I plug in my charger, start study mode" → { when, action:'start study mode' } or null.
  function parseTriggerText(original, findApp) {
    const t = String(original || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(?:hey |ok |okay )?(?:jarvis[,]? )?(?:when|whenever|every time|each time|as soon as|once)\s+(.+)$/i);
    if (!m) return null;
    const body = m[1];
    const comma = body.split(/\s*,\s*(?:then\s+)?|\s+then\s+/);
    if (comma.length >= 2) { const when = parseEvent(comma[0], findApp); const action = comma.slice(1).join(', ').trim(); if (when && action) return { when, action }; }
    // no comma: try each verb as the start of the action, left to right, until the part before it is a known event
    const verb = /\s+(?=(?:run|activate|trigger|turn on|switch on|enable|block|play|start|launch|open|close|mute|do|begin)\b)/g;
    let v;
    while ((v = verb.exec(body))) {
      const when = parseEvent(body.slice(0, v.index), findApp), action = body.slice(v.index).trim();
      if (when && action) return { when, action };
    }
    return null;
  }
  // "run study mode" / "start the study routine" / "study mode" → a routine name candidate
  function routineNameFrom(action) {
    return String(action || '').replace(/^(?:please\s+)?(?:run|start|activate|launch|do|trigger|begin|switch to|turn on|enable)\s+(?:my |the )?/i, '').replace(/\s+(?:routine|protocol)$/i, '').trim();
  }

  return { TYPES, needs, diffTriggers, describeWhen, parseEvent, parseTriggerText, routineNameFrom };
})();
if (typeof module !== 'undefined') module.exports = Triggers;
