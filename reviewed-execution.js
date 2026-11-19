'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {createApprovals}=require('./approvals');
function createExecution({SANDBOX,safePath,getConfig,saveConfig,control,ownedProcesses,run=execFile}) {
 const approvals=createApprovals();control?.onStop(approvals.clear);
 const status=()=>({enabled:getConfig().reviewedExecution===true,programs:['node','python'],isolated:false,note:'Native execution uses your Windows account. Working-folder checks are not an OS sandbox. Only standalone scripts are supported here.'});
 function offer(value,body,action,paths){const sig=crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');if(body.approved===true&&approvals.consume(body.approvalToken,sig))return null;return {status:409,body:{needsApproval:true,approvalKind:'execution',approvalToken:approvals.issue(sig),action,paths}};}
 function configure(body){control?.assertRunning();if(typeof body.enabled!=='boolean')throw Error('Use a boolean enabled value.');if(body.enabled){const preview=offer(['enable-native'],body,'Enable reviewed native script execution',['Runs as your Windows user','No OS isolation','Every script requires one-time approval','Standalone Node.js or Python scripts only']);if(preview)return preview;}getConfig().reviewedExecution=body.enabled;saveConfig();return {status:200,body:status()};}
 async function execute(body){
  control?.assertRunning();if(!status().enabled)throw Error('Enable reviewed execution first.');
  const program=String(body.program),code=String(body.code||''),args=body.args||[],timeoutMs=body.timeoutMs??30000;
  if(!['node','python'].includes(program)||!code.trim()||code.length>20000||!Array.isArray(args)||args.length>20||args.some(v=>typeof v!=='string'||v.length>500||/[\u0000-\u001f]/.test(v))||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw Error('Use Node/Python code under 20KB, bounded string arguments, and a 100–60000ms timeout.');
  const cwd=body.cwd?safePath(String(body.cwd)):SANDBOX;if(!cwd||!fs.statSync(cwd).isDirectory())throw Error('Choose an approved working folder.');
  const preview=offer([program,code,args,cwd,timeoutMs],body,'Run exactly this standalone script as your Windows user',[program,cwd,JSON.stringify(args),'Timeout: '+timeoutMs+'ms','No OS sandbox',code]);if(preview)return preview;
  const operation=control?.operation(),root=path.join(SANDBOX,'.execution');
  let file;
  try {
   fs.mkdirSync(root,{recursive:true});
   file=path.join(root,crypto.randomUUID()+(program==='node'?'.cjs':'.py'));fs.writeFileSync(file,code,{flag:'wx',mode:0o600});
   const result=await new Promise(resolve=>{
    const child=run(program==='node'?process.execPath:'python',[file,...args],{cwd,windowsHide:true,timeout:timeoutMs,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONPATH:cwd,NODE_PATH:path.join(cwd,'node_modules')}},(error,stdout,stderr)=>resolve({success:!error,exitCode:error?(typeof error.code==='number'?error.code:1):0,stdout:String(stdout||'').slice(0,15000),stderr:String(stderr||'').slice(0,5000),timedOut:!!error?.killed,verified:'process exit only; inspect generated results separately'}));
    ownedProcesses?.track(child);operation?.signal.addEventListener('abort',()=>child.kill(),{once:true});
   });operation?.check();return {status:200,body:result};
  }finally{operation?.release();if(file&&fs.existsSync(file))fs.unlinkSync(file);}
 }
 return {status,configure,execute};
}
function register(app,options){const execution=createExecution(options);app.get('/api/execution/status',(_req,res)=>res.set('Cache-Control','no-store').json(execution.status()));for(const method of ['configure','execute'])app.post('/api/execution/'+method,async(req,res)=>{try{const result=await execution[method](req.body);res.status(result.status).set('Cache-Control','no-store').json(result.body);}catch(error){res.status(400).json({error:error.message});}});return execution;}
module.exports={createExecution,register};
