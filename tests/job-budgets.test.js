'use strict';
const a=require('./lib/assertions')('job-budgets'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createQueue}=require('../agent-jobs');
const tick=()=>new Promise(r=>setImmediate(r));
async function done(queue,id){for(let i=0;i<500;i++){const j=queue.get(id);if(!['queued','running'].includes(j.status))return j;await new Promise(r=>setTimeout(r,5));}throw Error('Job did not settle');}
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-budget-'));try{
 let n=0;const registry={validateStep:s=>({ok:true,step:{...s,tier:'safe'}})};
 const make=executors=>createQueue({file:path.join(root,'q'+(++n)+'.json'),registry,executors});
 let calls=0;const q=make({read:async()=>{calls++;return 'fixture';}});
 const later=q.submit({notBefore:Date.now()+60000,steps:[{tool:'read',args:{}}]});await tick();
 a.equal(calls,0,'future jobs cannot run immediately');a.equal(q.get(later.id).status,'queued');a.equal(q.cancel(later.id),true);
 a.throws(()=>q.submit({budget:{maxRuntimeMs:99},steps:[{tool:'read'}]}),/budget/);
 a.throws(()=>q.submit({notBefore:Date.now()+32*86400000,steps:[{tool:'read'}]}),/31 days/);
 const hung=make({read:async()=>new Promise(()=>{})});const timeout=hung.submit({budget:{maxRuntimeMs:100,maxModelCalls:0},steps:[{tool:'read'}]});
 a.equal((await done(hung,timeout.id)).status,'budget_exceeded','a stuck executor must not bypass a deadline');
 let models=0;const model=make({summarise_file:async()=>{models++;return 'summary';}});
 const job=model.submit({budget:{maxRuntimeMs:1000,maxModelCalls:1},steps:[{tool:'summarise_file',args:{name:'a'}},{tool:'summarise_file',args:{name:'b'}}]});
 const result=await done(model,job.id);a.equal(models,1);a.equal(result.modelCalls,1);a.equal(result.status,'budget_exceeded');a.equal(result.steps[1].status,'notrun');
 const cancel=make({read:async()=>new Promise(()=>{})});const stuck=cancel.submit({steps:[{tool:'read'}]});await tick();cancel.cancel(stuck.id);a.equal((await done(cancel,stuck.id)).status,'cancelled');
 a.report();
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
