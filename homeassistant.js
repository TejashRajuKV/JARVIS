'use strict';
const http = require('http');
const https = require('https');
const { createApprovals } = require('./approvals');
const ALLOWED = new Set(['light.turn_on','light.turn_off','light.toggle','switch.turn_on','switch.turn_off','switch.toggle','scene.turn_on','fan.turn_on','fan.turn_off','fan.toggle','cover.open_cover','cover.close_cover']);
module.exports = function setupHomeAssistant(app, { getConfig, saveConfig }) {
  const approvals = createApprovals();
  let connectionVersion = 0;
  const conf = () => (getConfig().integrations || {}).homeAssistant || {};
  const request = (method, route, body, c = conf()) => new Promise((resolve,reject) => {
    let base; try { base = new URL(c.url); } catch { return reject(new Error('Set the Home Assistant URL in Settings first.')); }
    const url = new URL('/api/' + route.replace(/^\/+/, ''), base), client = url.protocol === 'https:' ? https : http;
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = client.request(url, { method, headers: { Authorization: 'Bearer ' + c.token, Accept:'application/json', ...(data ? {'Content-Type':'application/json','Content-Length':data.length}: {}) }, timeout:8000 }, res => {
      const chunks=[]; let size=0; res.on('data', b => { size += b.length; if (size <= 2*1024*1024) chunks.push(b); else req.destroy(new Error('Home Assistant response is too large.')); });
      res.on('end', () => { const text=Buffer.concat(chunks).toString('utf8'); if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Home Assistant returned HTTP ' + res.statusCode + (res.statusCode === 401 ? ' — check the long-lived access token.' : '.'))); try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('Home Assistant returned invalid JSON.')); } });
    });
    req.on('timeout',()=>req.destroy(new Error('Home Assistant did not respond within 8 seconds.'))); req.on('error',reject); if(data)req.write(data); req.end();
  });
  const validConfig = b => {
    let u; try { u = new URL(String(b.url || '').trim()); } catch { throw new Error('Enter the Home Assistant URL, for example http://homeassistant.local:8123.'); }
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/' || !String(b.token || '').trim() || String(b.token).length > 4096) throw new Error('Use a base HTTP(S) URL and a long-lived access token.');
    return { url:u.origin, token:String(b.token).trim() };
  };
  app.get('/api/homeassistant/status', (req,res) => { const c=conf(); res.setHeader('Cache-Control','no-store'); res.json({configured:!!(c.url&&c.token),url:c.url||'',connected:false}); });
  app.put('/api/homeassistant/config', async (req,res) => {
    try {
      const v = validConfig(req.body || {}), version = connectionVersion;
      await request('GET', '', undefined, v);
      if (version !== connectionVersion) return res.status(409).json({ error: 'The connection changed while testing. Please try again.' });
      const config = getConfig(), previous = config.integrations;
      config.integrations = { ...previous, homeAssistant: v };
      try { saveConfig(); } catch (e) { config.integrations = previous; throw e; }
      connectionVersion++;
      res.json({success:true,url:v.url,connected:true});
    } catch(e) { res.status(400).json({error:String(e.message||e).slice(0,200)}); }
  });
  app.delete('/api/homeassistant/config', (req,res) => { const c=getConfig(); if(c.integrations){delete c.integrations.homeAssistant;connectionVersion++;saveConfig();} res.json({success:true}); });
  app.get('/api/homeassistant/entities', async (req,res) => { try { const all=await request('GET','states'); const entities=(Array.isArray(all)?all:[]).filter(x=>/^(light|switch|scene|fan|cover|sensor)\./.test(x.entity_id||'')).slice(0,300).map(x=>({id:x.entity_id,name:String(x.attributes&&x.attributes.friendly_name||x.entity_id).slice(0,100),domain:x.entity_id.split('.')[0],state:String(x.state||'unknown').slice(0,40),attributes:{unit:x.attributes&&x.attributes.unit_of_measurement,deviceClass:x.attributes&&x.attributes.device_class}})); res.setHeader('Cache-Control','no-store'); res.json({success:true,entities}); } catch(e){res.status(502).json({error:String(e.message||e).slice(0,200)});} });
  app.post('/api/homeassistant/service', async (req,res) => {
    const b = req.body || {}, domain = String(b.domain || ''), service = String(b.service || '');
    const key = domain + '.' + service, entity = String(b.entity_id || '');
    if (!ALLOWED.has(key) || !entity.startsWith(domain + '.') || !/^[a-z]+\.[a-z0-9_]+$/.test(entity)) {
      return res.status(400).json({error:'That Home Assistant action is not supported.'});
    }
    const c = conf(), version = connectionVersion;
    if (!c.url || !c.token) return res.status(400).json({ error: 'Connect Home Assistant in Settings first.' });
    const signature = JSON.stringify([version, key, entity]);
    if (b.approved !== true || !approvals.consume(b.approvalToken, signature)) {
      return res.status(409).json({ needsApproval: true, approvalToken: approvals.issue(signature),
        approvalKind: 'homeAssistant', action: service.replace(/_/g, ' '), paths: [entity], error: 'This Home Assistant action needs your permission.' });
    }
    try {
      const current = await request('GET', 'states/' + encodeURIComponent(entity), undefined, c);
      if (version !== connectionVersion) return res.status(409).json({ error: 'The connection changed. Request the action again.' });
      if (current.entity_id !== entity) return res.status(404).json({error:'That Home Assistant device no longer exists.'});
      const result = await request('POST', 'services/' + domain + '/' + service, {entity_id:entity}, c);
      res.json({success:true,entity_id:entity,service:key,result:Array.isArray(result)?result.length:0});
    } catch(e){res.status(502).json({error:String(e.message||e).slice(0,200)});}
  });
  app.get('/api/homeassistant/entity/:id', async (req,res) => { const id=String(req.params.id||''); if(!/^(light|switch|scene|fan|cover|sensor)\.[a-z0-9_]+$/.test(id)) return res.status(400).json({error:'Invalid entity id.'}); try { const r=await request('GET','states/'+encodeURIComponent(id)); res.json({success:true,state:r.state,name:r.attributes&&r.attributes.friendly_name||id}); } catch(e){res.status(502).json({error:String(e.message||e).slice(0,200)});} });
};
