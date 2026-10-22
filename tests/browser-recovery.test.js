'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const B=require('../browser-recovery');
let fail=0,total=0;const check=(n,ok,x)=>{total++;if(!ok){fail++;console.log('FAIL '+n+(x?' — '+JSON.stringify(x):''));}};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-browser-')),file=path.join(tmp,'history.json');let opened=[];
try{
 check('rejects non-http schemes',B.safeUrl('javascript:alert(1)')===null&&B.safeUrl('file:///secret')===null);
 check('rejects embedded credentials',B.safeUrl('https://user:pass@example.com/')===null);
 const clean=B.safeUrl('https://example.com/search?q=jarvis&token=secret&api_key=abc#private');
 check('redacts secret query parameters and fragments',clean==='https://example.com/search?q=jarvis',clean);
 check('redacts prefilled WhatsApp message text from saved browser history',B.safeUrl('https://wa.me/919876543210?text=private%20message')==='https://wa.me/919876543210');
 const b=B.createBrowserRecovery({file,launch:u=>opened.push(u)});
 const first=b.record('https://example.com/docs?q=hello&access_token=private');
 check('records a sanitized URL',!!first&&first.url==='https://example.com/docs?q=hello');
 b.record('https://developer.mozilla.org/en-US/');
 check('keeps bounded most-recent-first history',b.list().length===2&&b.list()[0].title==='developer.mozilla.org');
 check('only recorded IDs can be reopened',!!b.open('missing').error&&opened.length===0);
 check('reopens a known URL only after explicit request',b.open(first.id).success&&opened[0]===first.url);
 const restarted=B.createBrowserRecovery({file,launch:u=>opened.push(u)});
 check('history persists across restart',restarted.list().length===2);
 check('clear removes recovery records',restarted.clear()&&restarted.list().length===0);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('browser-recovery: '+(total-fail)+'/'+total);process.exitCode=fail?1:0;
