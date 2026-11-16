'use strict';
const dns = require('dns').promises;
const net = require('net');
const https = require('https');

const unfold = text => String(text || '').replace(/\r?\n[ \t]/g, '');
function dateValue(line) {
  if (!line) return null;
  const [, raw] = line.split(':', 2); if (!raw) return null;
  const value = raw.trim();
  if (/^\d{8}$/.test(value)) return new Date(+value.slice(0,4), +value.slice(4,6)-1, +value.slice(6,8)).getTime();
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  return m[7] ? Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]) : new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime();
}
function parseICS(text) {
  const lines = unfold(text).split(/\r?\n/), events = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.start && cur.title) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase(), val = line.slice(i + 1).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    if (key === 'SUMMARY') cur.title = val.slice(0, 180);
    if (key === 'DTSTART') cur.start = dateValue(line);
    if (key === 'DTEND') cur.end = dateValue(line);
    if (key === 'LOCATION') cur.location = val.slice(0, 180);
  }
  return events;
}
const privateIp = ip => {
  if (net.isIPv4(ip)) { const p = ip.split('.').map(Number); return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && [0,2,168].includes(p[1])) || (p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51)) || (p[0] === 203 && p[1] === 0); }
  const s = ip.toLowerCase(); if (s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('::ffff:')) return true;
  const first=parseInt(s.split(':')[0]||'0',16); return first<0x2000||first>0x3fff||s.startsWith('2001:db8:');
};
async function validateFeed(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Enter a valid calendar feed URL.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || u.hostname === 'localhost' || u.hostname.endsWith('.local')) throw new Error('Use a public HTTPS calendar feed URL without an embedded username or password.');
  const ips = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!ips.length || ips.some(x => privateIp(x.address))) throw new Error('That calendar host does not resolve to a public address.');
  return u;
}
// Node 22+ may ask a custom lookup for all answers. Both forms still return only the validated address.
const pinLookup = pinned => (host, opts, callback) => {
  if (opts?.all) callback(null, [pinned]);
  else callback(null, pinned.address, pinned.family);
};
async function fetchFeed(u) {
  const ips = net.isIP(u.hostname) ? [{ address:u.hostname, family:net.isIP(u.hostname) }] : await dns.lookup(u.hostname,{all:true,verbatim:true});
  if (!ips.length || ips.some(x=>privateIp(x.address))) throw new Error('That calendar host does not resolve to a public address.');
  const pinned=ips[0]; // Pin the validated DNS answer so a later re-resolution cannot reach a local service.
  return new Promise((resolve,reject)=>{
    const req=https.get(u,{headers:{Accept:'text/calendar, text/plain;q=0.8'},timeout:9000,lookup:pinLookup(pinned)},res=>{
      if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error('Calendar feed returned HTTP '+res.statusCode+'. Redirects are not followed.'));}
      const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>2*1024*1024){req.destroy(new Error('Calendar feed is larger than 2 MB.'));return;}chunks.push(b);});
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout',()=>req.destroy(new Error('Calendar feed did not respond within 9 seconds.')));req.on('error',reject);
  });
}
module.exports = function setupCalendar(app, { getConfig, saveConfig }) {
  let cache = { at: 0, events: [] };
  const feed = () => String((getConfig().integrations || {}).calendarFeed || '');
  app.get('/api/calendar/status', (req,res) => { let host = ''; try { host = new URL(feed()).hostname; } catch {} res.setHeader('Cache-Control','no-store'); res.json({ configured: !!feed(), host }); });
  app.put('/api/calendar/config', async (req,res) => {
    try { const u = await validateFeed(req.body && req.body.url), text=await fetchFeed(u); if(!/BEGIN:VCALENDAR/.test(text))throw new Error('The URL did not return an iCalendar feed.'); const c = getConfig(); c.integrations = { ...(c.integrations || {}), calendarFeed: u.href }; saveConfig(); cache = { at: Date.now(), events: parseICS(text) }; res.json({ success: true, host: u.hostname }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/calendar/config', (req,res) => { const c = getConfig(); if (c.integrations) { delete c.integrations.calendarFeed; saveConfig(); } cache = { at: 0, events: [] }; res.json({ success: true }); });
  app.get('/api/calendar/events', async (req,res) => {
    const url = feed(); if (!url) return res.status(404).json({ error: 'Connect an HTTPS calendar feed in Settings first.' });
    try {
      if (Date.now() - cache.at > 180000) {
        const u = await validateFeed(url), text = await fetchFeed(u); if (!/BEGIN:VCALENDAR/.test(text)) return res.status(502).json({ error: 'The feed did not contain an iCalendar calendar.' });
        cache = { at: Date.now(), events: parseICS(text) };
      }
      const from = Number(req.query.from) || Date.now() - 86400000, to = Number(req.query.to) || Date.now() + 14 * 86400000;
      const events = cache.events.filter(e => e.start >= from && e.start < to).sort((a,b)=>a.start-b.start).slice(0,100);
      res.setHeader('Cache-Control','no-store'); res.json({ success:true, events, updated:cache.at });
    } catch (e) { res.status(502).json({ error: 'Could not read the calendar feed: ' + String(e.message || e).slice(0,160) }); }
  });
};
Object.assign(module.exports, { parseICS, validateFeed, pinLookup });
