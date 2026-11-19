'use strict';
const assert=require('./lib/assertions')('managed-browser');
const {createBrowser,webUrl,binaries}=require('../managed-browser');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
(async()=>{
 for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.com'])assert.throws(()=>webUrl(url),/HTTP/);
 let launches=0;const config={},control=require('../task-control').createControl();
 const unused=createBrowser({root:'unused',getConfig:()=>config,control,launch:async()=>{launches++;throw Error('Must not launch');}});
 await assert.rejects(()=>unused.open({url:'https://example.com'}),/Enable/);
 const offered=await unused.configure({enabled:true});assert.equal(offered.status,409);assert.equal(launches,0);
 await unused.configure({enabled:true,approved:true,approvalToken:offered.body.approvalToken});
 assert.equal((await unused.open({url:'https://example.com'})).status,409);assert.equal(launches,0);
 let release,closed=0;const delayed=createBrowser({root:'unused',getConfig:()=>config,control,launch:()=>new Promise(r=>release=r)});
 const pending=await delayed.open({url:'https://example.com'});
 const opening=delayed.open({url:'https://example.com',approved:true,approvalToken:pending.body.approvalToken});
 delayed.close();release({close(){closed++;}});await assert.rejects(()=>opening,/cancelled/);
 assert.equal(closed,1);assert.equal(delayed.status().running,false,'a late browser launch cannot survive stop/close');
 if(!binaries().some(p=>fs.existsSync(p))){console.log('SKIP managed browser native fixture: Edge/Chrome is unavailable');assert.report();return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-managed-'));
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Managed fixture</title><label>Message<input id="message"></label><label>Choice<select id="choice"><option value="a">A</option><option value="b">B</option></select></label><input type="password" aria-label="Secret"><button id="apply">Apply</button><p id="result">Waiting</p><script>document.querySelector("#apply").onclick=()=>document.querySelector("#result").textContent="Applied: "+document.querySelector("#message").value;</script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const settings={managedBrowserEnabled:true};
 const browser=createBrowser({root,getConfig:()=>settings,control,headless:true});
 try {
  const preview=await browser.open({url});assert.equal(preview.status,409);
  const opened=await browser.open({url,approved:true,approvalToken:preview.body.approvalToken});assert.equal(opened.status,200);
  let observed=await browser.inspect();assert.ok(observed.controls.some(c=>c.name==='Message'));
  assert.ok(!observed.controls.some(c=>c.name==='Secret'));
  assert.equal(observed.handoff,true,'password entry requires a manual handoff');
  // This fixture intentionally tests the handoff before using a page without credentials.
  await assert.rejects(()=>browser.action({token:observed.token,controlId:observed.controls[0].id,action:'click'}),/manual/);
  server.removeAllListeners('request');server.on('request',(_req,res)=>res.end('<!doctype html><title>Managed fixture</title><label>Message<input id="message"></label><button id="apply">Apply</button><p id="result">Waiting</p><script>document.querySelector("#apply").onclick=()=>document.querySelector("#result").textContent="Applied: "+document.querySelector("#message").value;</script>'));
  const reload=await browser.open({url:url+'/?clean=1'});await browser.open({url:url+'/?clean=1',approved:true,approvalToken:reload.body.approvalToken});
  observed=await browser.inspect();
  const field=observed.controls.find(c=>c.name==='Message');const fill={token:observed.token,controlId:field.id,action:'fill',value:'Task 42'};
  const offer=await browser.action(fill);assert.equal(offer.status,409);
  const filled=await browser.action({...fill,approved:true,approvalToken:offer.body.approvalToken});assert.equal(filled.body.verified,true);
  await assert.rejects(()=>browser.action({...fill,approved:true,approvalToken:offer.body.approvalToken}),/Inspect/);
  observed=await browser.inspect();const button=observed.controls.find(c=>c.name==='Apply');
  const click={token:observed.token,controlId:button.id,action:'click',expected:'Applied: Task 42'};
  const clicked=await browser.action(click);const result=await browser.action({...click,approved:true,approvalToken:clicked.body.approvalToken});
  assert.equal(result.body.verified,true);
  server.removeAllListeners('request');server.on('request',(_req,res)=>res.end('<!doctype html><label>Choice<select><option value="a">A</option><option value="b">B</option></select></label><div style="height:3000px">Scrollable fixture</div>'));
  const selectPage=await browser.open({url:url+'/?select=1'});await browser.open({url:url+'/?select=1',approved:true,approvalToken:selectPage.body.approvalToken});
  observed=await browser.inspect();const choice=observed.controls.find(c=>c.name==='Choice');
  const select={token:observed.token,controlId:choice.id,action:'select',value:'b'},selectOffer=await browser.action(select);
  assert.equal(selectOffer.status,409);assert.equal((await browser.action({...select,approved:true,approvalToken:selectOffer.body.approvalToken})).body.verified,true);
  observed=await browser.inspect();assert.equal(observed.controls[0].value,'b');
  const scroll={token:observed.token,controlId:observed.controls[0].id,action:'scroll',value:'down'},scrollOffer=await browser.action(scroll);
  assert.equal(scrollOffer.status,409);assert.equal((await browser.action({...scroll,approved:true,approvalToken:scrollOffer.body.approvalToken})).body.verified,true);
  const before=await browser.inspect();control.stop();control.resume();
  await assert.rejects(()=>browser.action({token:before.token,controlId:before.controls[0].id,action:'click'}),/Inspect/);
  assert.equal(browser.status().running,false);
  assert.report();
 }finally{browser.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>setTimeout(resolve,1000));for(let i=0;i<5;i++){try{fs.rmSync(root,{recursive:true,force:true});break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}}
})().catch(error=>{console.error(error);process.exitCode=1;});
