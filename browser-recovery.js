'use strict';
/* Safe browser recovery for pages JARVIS itself opened. Does not inspect browser history or send global keypresses.
   URLs and timestamps stay on this laptop; sensitive query parameters are removed before persistence. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const MAX_ITEMS = 30;
const SECRET_PARAM = /^(?:token|access_token|refresh_token|api[_-]?key|key|auth|authorization|code|password|passwd|session|sid|secret|signature|sig|email|text|message|body|caption)$/i;
function safeUrl(input) {
  let u;
  try { u = new URL(String(input || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.href.slice(0, 1800);
}
function createBrowserRecovery({ file, launch }) {
  let rows = [];
  try { const v=JSON.parse(fs.readFileSync(file,'utf8')); if (Array.isArray(v)) rows=v.filter(x=>x&&typeof x.id==='string'&&/^[a-f0-9]{12}$/i.test(x.id)&&safeUrl(x.url)).map(x=>({id:x.id,url:safeUrl(x.url),title:String(x.title||new URL(safeUrl(x.url)).hostname).slice(0,120),openedAt:Number(x.openedAt)||Date.now()})).slice(0,MAX_ITEMS); } catch(e) { if(e.code!=='ENOENT') rows=[]; }
  const persist = () => { fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=file+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(rows,null,2),{mode:0o600}); fs.renameSync(tmp,file); };
  function record(input) {
    const url=safeUrl(input); if(!url) return null;
    const host=new URL(url).hostname;
    const row={id:require('crypto').randomBytes(6).toString('hex'),url,title:host,openedAt:Date.now()};
    rows=[row,...rows.filter(x=>x.url!==url)].slice(0,MAX_ITEMS);
    try { persist(); } catch { rows=rows.filter(x=>x.id!==row.id); return null; }
    return row;
  }
  function list() { return rows.map(x=>({...x})); }
  function clear() { const old=rows; rows=[]; try { persist(); return true; } catch { rows=old; return false; } }
  function open(id) { const row=rows.find(x=>x.id===id); if(!row) return {error:'PAGE_NOT_FOUND'}; const url=safeUrl(row.url); if(!url) return {error:'URL_NOT_ALLOWED'}; try { launch(url); return {success:true,url}; } catch { return {error:'COULD_NOT_OPEN_PAGE'}; } }
  return { record,list,clear,open };
}
module.exports = function setupBrowserRecovery(app,{SANDBOX,IS_WIN,IS_MAC}) {
  const launch = url => { const [cmd,args]=IS_WIN?['rundll32',['url.dll,FileProtocolHandler',url]]:IS_MAC?['open',[url]]:['xdg-open',[url]]; const p=spawn(cmd,args,{detached:true,stdio:'ignore'}); p.on('error',()=>{}); p.unref(); };
  const recovery=createBrowserRecovery({file:path.join(SANDBOX,'.browser-recovery.json'),launch});
  app.locals.jarvisBrowserRecovery=recovery;
  app.get('/api/browser-recovery',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({success:true,pages:recovery.list(),limit:MAX_ITEMS});});
  app.post('/api/browser-recovery/open/:id',(req,res)=>{const r=recovery.open(String(req.params.id||''));if(r.error)return res.status(r.error==='PAGE_NOT_FOUND'?404:400).json(r);res.json(r);});
  app.delete('/api/browser-recovery',(req,res)=>{if(!recovery.clear())return res.status(500).json({error:'Could not clear browser recovery history.'});res.json({success:true});});
};
Object.assign(module.exports,{createBrowserRecovery,safeUrl,MAX_ITEMS});
