'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createApprovals}=require('./approvals');
function dpapi(mode,input) {
  if(process.platform!=='win32')throw new Error('Windows DPAPI is required.');
  const code=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${mode==='protect'?'Protect':'Unprotect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  try{return Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input:Buffer.from(input).toString('base64'),windowsHide:true,timeout:15000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}).toString().trim(),'base64');}
  catch{throw new Error('Windows could not access this vault. It is bound to the Windows user who created it.');}
}
function createVault({file,protect=input=>dpapi('protect',input),unprotect=input=>dpapi('unprotect',input),supported=process.platform==='win32'}={}) {
  let values=Object.create(null);
  if(fs.existsSync(file)) {
    if(!supported)throw new Error('The encrypted vault requires Windows.');
    const stored=JSON.parse(fs.readFileSync(file,'utf8'));
    if(stored.version!==1||typeof stored.ciphertext!=='string')throw new Error('Invalid vault; the original file was preserved.');
    values=JSON.parse(unprotect(Buffer.from(stored.ciphertext,'base64')).toString('utf8'));
  }
  function write(next) {
    if(!supported)throw new Error('The encrypted vault is unavailable on this platform.');
    const plain=Buffer.from(JSON.stringify(next));
    if(plain.length>256*1024)throw new Error('Vault exceeds 256KB.');
    try {
      const encrypted=protect(plain);
      // Verify before replacing any previous encrypted data.
      if(!unprotect(encrypted).equals(plain))throw new Error('Vault encryption verification failed.');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,ciphertext:encrypted.toString('base64')}),{mode:0o600});
      fs.renameSync(file+'.tmp',file);values=next;
    } finally {plain.fill(0);}
  }
  function set(key,value) {
    if(!/^[\w/.-]{1,160}$/.test(key)||['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid secret reference.');
    if(typeof value!=='string'||value.length>32000)throw new Error('Secret must be a string under 32KB.');
    write({...values,[key]:value});
  }
  return {set,get:key=>Object.hasOwn(values,key)?values[key]:null,
    remove(key){if(!Object.hasOwn(values,key))return;const next={...values};delete next[key];write(next);},
    status:()=>({supported,encrypted:true,keys:Object.keys(values),configured:fs.existsSync(file)})};
}
function register(app,{vault,getConfig,saveConfig,control}) {
  const approvals=createApprovals();control?.onStop(approvals.clear);
  const candidates=()=> (getConfig().providers||[]).filter(p=>p.apiKey&&!p.apiKeyRef);
  app.get('/api/vault/status',(_req,res)=>res.set('Cache-Control','no-store').json({...vault.status(),migrationCandidates:candidates().map(p=>({id:p.id,label:p.label||p.id}))}));
  app.post('/api/vault/migrate',(req,res)=>{
    try {
      control?.assertRunning();const rows=candidates();
      if(!vault.status().supported)throw new Error('Windows DPAPI is unavailable.');
      if(!rows.length)return res.json({success:true,migrated:0});
      const signature=crypto.createHash('sha256').update(JSON.stringify(rows.map(p=>[p.id,p.apiKey]))).digest('hex');
      if(req.body.approved!==true||!approvals.consume(req.body.approvalToken,signature))return res.status(409).json({needsApproval:true,approvalKind:'vault',approvalToken:approvals.issue(signature),action:'Encrypt provider credentials for this Windows user and remove verified plaintext values from the configuration file',paths:rows.map(p=>p.label||p.id)});
      for(const provider of rows) {const ref='llm/'+provider.id;vault.set(ref,provider.apiKey);if(vault.get(ref)!==provider.apiKey)throw new Error('Vault verification failed; plaintext configuration is unchanged.');}
      const old=rows.map(p=>[p,p.apiKeyRef]);
      for(const p of rows)p.apiKeyRef='llm/'+p.id;
      try{saveConfig();}catch(error){for(const [p,ref]of old){if(ref)p.apiKeyRef=ref;else delete p.apiKeyRef;}throw error;}
      res.json({success:true,migrated:rows.length});
    }catch{res.status(400).json({error:'Credential migration did not complete. Existing credentials were preserved; inspect vault availability and configuration write access.'});}
  });
}
module.exports={dpapi,createVault,register};
