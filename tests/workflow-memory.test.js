'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const W=require('../workflow-memory');
let fail=0,total=0;const check=(n,ok,x)=>{total++;if(!ok){fail++;console.log('FAIL '+n+(x?' — '+JSON.stringify(x):''));}};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-workflow-')),file=path.join(tmp,'state.json');
try{
 const w=W.createWorkflowMemory({file});
 check('starts empty',w.list().length===0);
 const a=w.save({name:'Release review',prompt:'Check tests, security, and changelog.'});
 check('saves a named prompt',!!a.item&&a.item.name==='Release review'&&w.list().length===1,a);
 check('same name updates instead of duplicating',w.save({name:'release REVIEW',prompt:'Check tests and migration safety.'}).item.id===a.item.id&&w.list().length===1);
 check('rejects empty name',!!w.save({name:' ',prompt:'do work'}).error);
 check('rejects empty prompt',!!w.save({name:'x',prompt:' '}).error);
 check('rejects overlong prompt',!!w.save({name:'x',prompt:'a'.repeat(W.MAX_PROMPT+1)}).error);
 const reopened=W.createWorkflowMemory({file});
 check('persists across restart',reopened.list()[0].prompt==='Check tests and migration safety.');
 check('unknown id cannot be deleted',!reopened.remove('unknown'));
 check('known workflow can be deleted',reopened.remove(a.item.id)&&reopened.list().length===0);
 check('clearing empty state remains valid',reopened.clear()===true);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('workflow-memory: '+(total-fail)+'/'+total);process.exitCode=fail?1:0;
