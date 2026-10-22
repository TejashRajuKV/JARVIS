'use strict';
/* Read-only local self-diagnostics. Reports capability presence and optional Ollama reachability; never executes repair commands. */
const fs = require('fs');
const path = require('path');
const os = require('os');
async function runDiagnostics({ root, sandbox, ollamaUrl, defaultModel, fetchImpl=fetch, now=Date.now() }) {
  const checkFile=(name, rel, group)=>({name,group,ok:fs.existsSync(path.join(root,rel)),detail:fs.existsSync(path.join(root,rel))?'File present':'File missing'});
  const checks=[
    {name:'Node.js runtime',group:'runtime',ok:process.versions.node.split('.')[0] >= 22,detail:'Node '+process.versions.node+' (JARVIS requires Node 22+)'},
    checkFile('Skill loader','skillpack.js','skills'),
    checkFile('Skill router','skillrouter.js','skills'),
    checkFile('Skill instructions directory','skills-bundled','skills'),
    checkFile('Voice recognition client','voice.js','voice'),
    checkFile('Speech repair','speechfix.js','voice'),
    checkFile('Streaming speech pipeline','speech-stream.js','voice'),
    checkFile('Wake-word service','wakeword.js','voice'),
    checkFile('Routine engine','routines.js','automation'),
    checkFile('Scheduler','scheduler.js','automation'),
    checkFile('Trigger engine','triggers.js','automation'),
    {name:'JARVIS data folder',group:'storage',ok:fs.existsSync(sandbox),detail:fs.existsSync(sandbox)?'Data folder exists':'Data folder will be created when needed'},
    {name:'Memory availability',group:'runtime',ok:os.freemem()>256*1024*1024,detail:Math.round(os.freemem()/1024/1024)+' MB free RAM reported by the OS'}
  ];
  try {
    const skillpack = require(path.join(root, 'skillpack.js'));
    const loaded = skillpack.loadAll(path.join(root, 'skills-bundled'), path.join(sandbox, 'Skills'));
    checks.push({name:'Skill loader discovery',group:'skills',ok:loaded.skills.length>0,detail:loaded.skills.length+' skill(s) discovered; '+loaded.skipped.length+' invalid/unreadable skill folder(s) skipped'});
    for (const skipped of loaded.skipped.slice(0,8)) recommendations.push({name:'Skill '+skipped.folder,action:'Fix the skill metadata or file: '+skipped.reason+'. Then rescan skills in the Skill Hub.'});
  } catch (e) {
    checks.push({name:'Skill loader discovery',group:'skills',ok:false,detail:'Could not scan skill packs: '+String(e.message||e).slice(0,140)});
  }
  let ai={checked:false,ok:null,detail:'Not probed (optional)'}; 
  try {
    const r=await fetchImpl(String(ollamaUrl).replace(/\/+$/,'')+'/api/tags',{signal:AbortSignal.timeout(1800)});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json(); const models=(j.models||[]).map(x=>x.name);
    ai={checked:true,ok:true,detail:models.length?models.length+' local model(s) installed':'Ollama reachable, but no local models are installed',models,defaultModelInstalled:models.some(n=>n===defaultModel||(!String(defaultModel).includes(':')&&n.split(':')[0]===defaultModel))};
  } catch(e) { ai={checked:true,ok:false,detail:'Ollama is not reachable at the configured local endpoint'}; }
  checks.push({name:'Local AI provider',group:'ai',ok:ai.ok!==false,detail:ai.detail});
  const failed=checks.filter(x=>!x.ok);
  const recommendations=failed.map(x=>({
    name:x.name,
    action:x.group==='runtime'?'Check the installed Node.js version or available system memory.':
      x.group==='skills'?'Restore the missing JARVIS skill file from the repository, then reload skills.':
      x.group==='voice'?'Check that the repository file exists and that microphone permission is enabled in the browser.':
      x.group==='automation'?'Restore the missing automation module and run the relevant automated tests.':
      x.group==='storage'?'Restart JARVIS and check the configured local data directory.':'Review this diagnostic finding.'
  }));
  if(ai.ok===false) recommendations.push({name:'Local AI provider',action:'Start Ollama and confirm the configured model is installed; rerun diagnostics.'});
  if(ai.ok===true && ai.models && !ai.defaultModelInstalled) recommendations.push({name:'Default model',action:'Install '+defaultModel+' or select an installed model in JARVIS Settings.'});
  return {success:true,checkedAt:now,checks,summary:{total:checks.length,passed:checks.length-failed.length,failed:failed.length},recommendations};
}
module.exports=function setupDiagnostics(app,opts){
  app.get('/api/diagnostics',async(req,res)=>{
    try { const result=await runDiagnostics(opts); res.setHeader('Cache-Control','no-store'); res.json(result); }
    catch(e) { res.status(500).json({success:false,error:'Diagnostics could not complete.'}); }
  });
};
Object.assign(module.exports,{runDiagnostics});
