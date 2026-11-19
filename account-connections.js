'use strict';
const crypto=require('node:crypto');
const {createApprovals}=require('./approvals');
const PROVIDERS={
  google:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/drive.readonly']},
  microsoft:{authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',scopes:['offline_access','https://graph.microsoft.com/Mail.Read','https://graph.microsoft.com/Calendars.Read','https://graph.microsoft.com/Files.Read']}
};
function createConnections({vault,getConfig,saveConfig,port=3002,fetchImpl=fetch,control,now=Date.now}) {
  const pending=new Map(),approvals=createApprovals(),redirect='http://localhost:'+port+'/api/accounts/callback';
  const configured=()=>getConfig().accounts||{};
  const definition=provider=>{if(!Object.hasOwn(PROVIDERS,provider))throw new Error('Choose Google or Microsoft.');return PROVIDERS[provider];};
  control?.onStop(()=>{pending.clear();approvals.clear();});
  async function json(url,options={}) {
    const operation=control?.operation();
    try {
      const response=await fetchImpl(url,{...options,redirect:'error',signal:operation?AbortSignal.any([operation.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('The account provider returned HTTP '+response.status+'. The request was not retried.');
      const reader=response.body.getReader();let size=0,chunks=[];
      try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw new Error('Provider response exceeds 1MB.');chunks.push(Buffer.from(value));}}
      finally{await reader.cancel().catch(()=>{});}
      operation?.check();return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }finally{operation?.release();}
  }
  function approval(action,paths,value,body) {
    const sig=crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    if(body.approved===true&&approvals.consume(body.approvalToken,sig))return null;
    return {status:409,body:{needsApproval:true,approvalKind:'account',approvalToken:approvals.issue(sig),action,paths}};
  }
  function configure(body) {
    control?.assertRunning();const provider=String(body.provider),def=definition(provider);
    if(!vault.status().supported)throw new Error('Encrypted credential storage is required before connecting accounts.');
    const clientId=String(body.clientId||'').trim(),secret=String(body.clientSecret||'');
    if(!/^[\w.-]{8,250}$/.test(clientId)||secret.length>2000||/[\u0000-\u001f]/.test(secret))throw new Error('Enter the registered desktop OAuth client ID.');
    const offer=approval('Configure a read-only '+provider+' account connection',[provider,clientId,redirect,...def.scopes],[provider,clientId,secret],body);if(offer)return offer;
    for(const [state,item]of pending)if(item.provider===provider)pending.delete(state);
    if(secret)vault.set('account/'+provider+'/clientSecret',secret);
    if(vault.get('account/'+provider+'/token'))vault.remove('account/'+provider+'/token');
    getConfig().accounts={...configured(),[provider]:{clientId,secretRef:secret?'account/'+provider+'/clientSecret':null}};saveConfig();
    return {status:200,body:{success:true}};
  }
  function begin(body) {
    control?.assertRunning();const provider=String(body.provider),def=definition(provider),config=configured()[provider];
    if(!config)throw new Error('Configure this provider first.');
    const offered=approval('Start a read-only '+provider+' sign-in',[provider,config.clientId,redirect,...def.scopes],['begin',provider,config.clientId],body);if(offered)return offered;
    for(const [key,value]of pending)if(value.expires<=now())pending.delete(key);
    if(pending.size>=8)throw new Error('Too many pending sign-ins; finish or wait for an earlier one to expire.');
    const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
    const url=new URL(def.authorize);
    const params={client_id:config.clientId,redirect_uri:redirect,response_type:'code',scope:def.scopes.join(' '),state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(provider==='google'?{access_type:'offline',prompt:'consent'}:{})};
    for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
    pending.set(state,{provider,verifier,clientId:config.clientId,expires:now()+10*60000});
    return {url:url.href,scopes:def.scopes,redirect};
  }
  async function callback({state,code,error}) {
    control?.assertRunning();const item=pending.get(state);pending.delete(state);
    if(!item||item.expires<=now())throw new Error('Sign-in expired or its state was invalid. Start again.');
    if(error||typeof code!=='string'||!code||code.length>4096)throw new Error('Provider sign-in was not completed.');
    const config=configured()[item.provider];if(config?.clientId!==item.clientId)throw new Error('Connection settings changed; sign in again.');
    const body=new URLSearchParams({client_id:item.clientId,grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:item.verifier});
    if(config.secretRef)body.set('client_secret',vault.get(config.secretRef));
    const token=await json(definition(item.provider).token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
    storeToken(item.provider,token);return {success:true,provider:item.provider};
  }
  function storeToken(provider,token,previous) {
    if(typeof token.access_token!=='string'||!Number.isFinite(+token.expires_in)||+token.expires_in<=0)throw new Error('Provider did not return a usable access token.');
    if(!token.refresh_token&&!previous?.refresh_token)throw new Error('Provider did not grant offline access. Reconnect with the requested consent.');
    const value={...token,refresh_token:token.refresh_token||previous?.refresh_token,expires:now()+Math.min(+token.expires_in,86400)*1000};
    vault.set('account/'+provider+'/token',JSON.stringify(value));
  }
  async function access(provider) {
    const config=configured()[provider],raw=vault.get('account/'+provider+'/token');
    if(!config||!raw)throw new Error('Connect this account first.');
    let token=JSON.parse(raw);
    if(token.expires<=now()+30000) {
      const body=new URLSearchParams({client_id:config.clientId,grant_type:'refresh_token',refresh_token:token.refresh_token});
      if(config.secretRef)body.set('client_secret',vault.get(config.secretRef));
      const next=await json(definition(provider).token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
      storeToken(provider,next,token);token=JSON.parse(vault.get('account/'+provider+'/token'));
    }
    return token.access_token;
  }
  async function read(body) {
    control?.assertRunning();const provider=String(body.provider);definition(provider);
    const kind=String(body.kind),query=String(body.query||'').trim().slice(0,200),id=String(body.id||'');
    if(id&&!/^[\w.-]{1,250}$/.test(id))throw new Error('Invalid provider item ID.');
    if(!['mail','calendar','files'].includes(kind))throw new Error('Choose mail, calendar or files.');
    const ref='account/'+provider+'/token',stored=vault.get(ref);if(!stored)throw new Error('Connect this account first.');
    const offer=approval('Read '+kind+' from '+provider,[provider,kind,id||query||'(recent items)'],[provider,kind,query,id,crypto.createHash('sha256').update(stored).digest('hex')],body);if(offer)return offer;
    const token=await access(provider);let url;
    if(provider==='google') {
      url=new URL({mail:'https://gmail.googleapis.com/gmail/v1/users/me/messages',calendar:'https://www.googleapis.com/calendar/v3/calendars/primary/events',files:'https://www.googleapis.com/drive/v3/files'}[kind]);
      url.searchParams.set(kind==='mail'?'maxResults':kind==='calendar'?'maxResults':'pageSize','20');
      if(kind==='mail'&&query)url.searchParams.set('q',query);
      if(kind==='calendar'){url.searchParams.set('timeMin',new Date(now()).toISOString());url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');if(query)url.searchParams.set('q',query);}
      if(kind==='files'){url.searchParams.set('fields','files(id,name,mimeType,webViewLink,modifiedTime)');if(query)url.searchParams.set('q',"trashed = false and name contains '"+query.replace(/['\\]/g,'\\$&')+"'");else url.searchParams.set('q','trashed = false');}
      if(id){url.pathname+='/'+encodeURIComponent(id);url.search='';if(kind==='mail')url.searchParams.set('format','full');}
    } else {
      url=new URL({mail:'https://graph.microsoft.com/v1.0/me/messages',calendar:'https://graph.microsoft.com/v1.0/me/calendarView',files:'https://graph.microsoft.com/v1.0/me/drive/root/children'}[kind]);url.searchParams.set('$top','20');
      if(kind==='mail'){url.searchParams.set('$select','id,subject,from,receivedDateTime,bodyPreview,isRead');if(query)url.searchParams.set('$search','"'+query.replace(/["\\]/g,'')+'"');}
      if(kind==='calendar'){url.searchParams.set('startDateTime',new Date(now()).toISOString());url.searchParams.set('endDateTime',new Date(now()+7*86400000).toISOString());}
      if(kind==='files')url.searchParams.set('$select','id,name,webUrl,lastModifiedDateTime');
      if(id){url=new URL('https://graph.microsoft.com/v1.0/me/'+{mail:'messages',calendar:'events',files:'drive/items'}[kind]+'/'+encodeURIComponent(id));}
    }
    const result=await json(url.href,{headers:{Authorization:'Bearer '+token}});
    if(provider==='microsoft'&&kind==='files'&&query&&!id&&Array.isArray(result.value)) {
      result.value=result.value.filter(file=>String(file.name||'').toLowerCase().includes(query.toLowerCase()));
      result.jarvisNote='Filtered the first 20 items; this is not an exhaustive drive search.';
    }
    if(provider==='microsoft'&&kind==='calendar'&&query&&!id&&Array.isArray(result.value)) {
      result.value=result.value.filter(event=>[event.subject,event.bodyPreview,event.location?.displayName].some(value=>String(value||'').toLowerCase().includes(query.toLowerCase())));
      result.jarvisNote='Filtered the first 20 events in the next seven days; this is not an exhaustive calendar search.';
    }
    // Return bounded provider data. It is evidence, not permission for follow-up calls.
    return {status:200,body:{success:true,provider,kind,data:result,untrusted:true,updated:now()}};
  }
  function disconnect(provider) {definition(provider);vault.remove('account/'+provider+'/token');pending.clear();approvals.clear();return {success:true,note:'Local tokens removed. You can also revoke JARVIS access in your provider account settings.'};}
  function status(){return {storage:vault.status().supported,redirect,providers:Object.entries(PROVIDERS).map(([provider,def])=>({provider,configured:!!configured()[provider],connected:!!vault.get('account/'+provider+'/token'),scopes:def.scopes,clientId:configured()[provider]?.clientId||''}))};}
  return {configure,begin,callback,read,disconnect,status};
}
function register(app,options) {
  const client=createConnections(options);
  app.get('/api/accounts/status',(_req,res)=>res.set('Cache-Control','no-store').json(client.status()));
  for(const operation of ['configure','begin','read'])app.post('/api/accounts/'+operation,async(req,res)=>{try{const result=await client[operation](req.body);res.status(result.status||200).set('Cache-Control','no-store').json(result.body||result);}catch(error){res.status(400).json({error:error.message});}});
  app.get('/api/accounts/callback',async(req,res)=>{try{await client.callback(req.query);res.set('Cache-Control','no-store').type('text').send('Account connected. Return to JARVIS and refresh Connections.');}catch{res.status(400).set('Cache-Control','no-store').type('text').send('Account sign-in failed, expired, or was cancelled. Start again from JARVIS.');}});
  app.post('/api/accounts/disconnect',(req,res)=>{try{res.json(client.disconnect(req.body.provider));}catch(error){res.status(400).json({error:error.message});}});
  return client;
}
module.exports={createConnections,register,PROVIDERS};
