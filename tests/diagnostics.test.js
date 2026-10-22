'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const D=require('../diagnostics');
let fail=0,total=0;const check=(n,ok,x)=>{total++;if(!ok){fail++;console.log('FAIL '+n+(x?' — '+JSON.stringify(x):''));}};
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-diag-')),sandbox=path.join(tmp,'data');
 try{
  for(const f of ['skillpack.js','skillrouter.js','voice.js','speechfix.js','speech-stream.js','wakeword.js','routines.js','scheduler.js','triggers.js'])fs.writeFileSync(path.join(tmp,f),'');
  fs.mkdirSync(path.join(tmp,'skills-bundled'));fs.mkdirSync(sandbox);
  const result=await D.runDiagnostics({root:tmp,sandbox,ollamaUrl:'http://127.0.0.1:1',defaultModel:'model-x',fetchImpl:async()=>{throw new Error('offline')},now:123});
  check('returns a structured report',result.success&&result.checkedAt===123&&result.checks.length>=10,result.summary);
  check('missing local AI is reported without crashing',result.checks.some(x=>x.name==='Local AI provider'&&!x.ok));
  check('all required mock modules pass',result.checks.filter(x=>['Skill loader','Skill router','Voice recognition client','Scheduler'].includes(x.name)).every(x=>x.ok));
  check('actionable recommendations are returned for failures',result.recommendations.some(x=>/Ollama/.test(x.name)));
  check('does not execute repair actions',!('repaired' in result)&&!('commandsRun' in result));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 console.log('diagnostics: '+(total-fail)+'/'+total);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
