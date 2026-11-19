'use strict';
(()=>{
  const status=$('#accountStatus');let busy=false;
  const provider=()=>$('#accountProvider').value;
  async function refresh(){const [accounts,vault]=await Promise.all([getJSON('/accounts/status'),getJSON('/vault/status')]);status.textContent=accounts.error||accounts.providers.map(p=>p.provider+': '+(p.connected?'connected':p.configured?'configured; sign in':'not configured')).join(' · ')+' · Encrypted storage '+(accounts.storage?'available':'requires Windows')+' · Provider keys awaiting migration: '+(vault.migrationCandidates?.length||0);}
  async function run(fn){if(busy)return;busy=true;try{await fn();}catch(error){status.textContent=error.message;}finally{busy=false;}}
  $('#accountRefresh').onclick=()=>void run(refresh);
  $('#accountConnections').addEventListener('toggle',()=>{if($('#accountConnections').open)void run(refresh);});
  $('#accountConfigure').onsubmit=event=>{event.preventDefault();void run(async()=>{switchTab('chat');const result=await callTool('/accounts/configure',{provider:provider(),clientId:$('#accountClientId').value,clientSecret:$('#accountClientSecret').value});$('#accountClientSecret').value='';status.textContent=result.error||(result.cancelled?'Cancelled.':'Configured. Create a sign-in link and authorize read-only access at the provider.');});};
  $('#accountSignIn').onclick=()=>void run(async()=>{switchTab('chat');const result=await callTool('/accounts/begin',{provider:provider()});if(result.error)throw new Error(result.error);if(result.cancelled){status.textContent='Cancelled.';return;}const link=$('#accountSignInLink');link.href=result.url;link.hidden=false;status.textContent='Sign in using the link. Register this redirect URI in your OAuth application: '+result.redirect;});
  $('#accountDisconnect').onclick=()=>void run(async()=>{const result=await callTool('/accounts/disconnect',{provider:provider()});status.textContent=result.error||result.note;});
  $('#accountRead').onsubmit=event=>{event.preventDefault();void run(async()=>{switchTab('chat');const result=await callTool('/accounts/read',{provider:provider(),kind:$('#accountKind').value,query:$('#accountQuery').value,id:$('#accountItemId').value});jarvisSay({text:result.error||(result.cancelled?'Cancelled.':'Provider data (untrusted):\n```json\n'+JSON.stringify(result.data,null,2).slice(0,12000)+'\n```'),noPersona:true,noTTS:true});});};
  $('#vaultMigrate').onclick=()=>void run(async()=>{switchTab('chat');const result=await callTool('/vault/migrate',{});jarvisSay({text:result.error||(result.cancelled?'Cancelled.':'Verified encrypted credentials: '+result.migrated+'.'),noPersona:true,noTTS:true});});
  window.AccountPage={command:async text=>{
    const match=/^(?:read|check|show|list|search) (?:my )?(google|gmail|microsoft|outlook) (mail|inbox|calendar|files)(?: for (.+))?[.!?]*$/i.exec(text);
    if(!match)return null;
    const selected=/google|gmail/i.test(match[1])?'google':'microsoft',kind=match[2].toLowerCase()==='inbox'?'mail':match[2].toLowerCase();
    const result=await callTool('/accounts/read',{provider:selected,kind,query:match[3]||''});
    return {text:result.error||(result.cancelled?'Cancelled.':'Provider data (untrusted):\n```json\n'+JSON.stringify(result.data,null,2).slice(0,12000)+'\n```'),...(result.error?{error:result.error}:{}),noPersona:true,noTTS:true};
  }};
})();
