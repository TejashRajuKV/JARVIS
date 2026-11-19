'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createApprovals}=require('./approvals');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const binaries=()=>[process.env.JARVIS_BROWSER,'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
function webUrl(value) {
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>2000)throw new Error('Use an HTTP(S) URL without embedded credentials.');
 return url.href;
}
async function connectCdp(url) {
 const ws=new WebSocket(url);let id=0;const waiting=new Map();
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.close();reject(Error('Browser connection timed out.'));},10000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('Browser connection failed.'));};});
 ws.onmessage=event=>{const value=JSON.parse(event.data);const pending=waiting.get(value.id);if(!pending)return;waiting.delete(value.id);clearTimeout(pending.timer);value.error?pending.reject(Error(value.error.message)):pending.resolve(value.result);};
 ws.onclose=()=>{for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(Error('Managed browser closed.'));}waiting.clear();};
 return {send(method,params={}){return new Promise((resolve,reject)=>{const seq=++id,timer=setTimeout(()=>{waiting.delete(seq);reject(Error('Browser command timed out; it was not retried.'));},15000);waiting.set(seq,{resolve,reject,timer});ws.send(JSON.stringify({id:seq,method,params}));});},close:()=>ws.close()};
}
async function launchBrowser({root,headless=false,ownedProcesses}) {
 const executable=binaries().find(file=>fs.existsSync(file));if(!executable)throw new Error('Install Edge or Chrome to use the isolated browser.');
 fs.mkdirSync(root,{recursive:true});const profile=fs.mkdtempSync(path.join(root,'session-'));
 const child=spawn(executable,['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-sync','--disable-extensions','--disable-background-networking',...(headless?['--headless=new']:[]),'about:blank'],{windowsHide:headless,stdio:'ignore'});
 ownedProcesses?.track(child);
 let failure;child.on('error',()=>failure=Error('Could not launch the isolated browser.'));
 try {
  let port;
  for(let i=0;i<100&&!port;i++){if(failure)throw failure;if(child.exitCode!==null)throw Error('The isolated browser exited.');try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{}if(!port)await pause(100);}
  if(!port)throw Error('The isolated browser did not expose its local debugging endpoint.');
  const response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(10000)}),targets=await response.json();
  const target=targets.find(item=>item.type==='page');if(!target)throw Error('No managed browser page was created.');
  const cdp=await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Browser.setDownloadBehavior',{behavior:'deny'});
  return {cdp,profile,close(){cdp.close();if(child.exitCode===null)child.kill();}};
 }catch(error){if(child.exitCode===null)child.kill();throw error;}
}
function observeDom(token) {
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const label=e=>(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>{const copy=l.cloneNode(true);copy.querySelectorAll('input,textarea,select,button').forEach(n=>n.remove());return copy.textContent;}).join(' ')||e.innerText||e.getAttribute('title')||e.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim().slice(0,200);
 const sensitive=e=>e.type==='password'||/password|one-time-code|cc-number|cc-csc/i.test(e.autocomplete||'');
 const nodes=[...document.querySelectorAll('button,input,textarea,select,a[href],[role="button"],[role="checkbox"],[role="tab"],[contenteditable="true"]')].filter(e=>visible(e)&&!sensitive(e)).slice(0,200);
 const controls=nodes.map((e,i)=>({id:'control-'+(i+1),name:label(e),type:e.tagName.toLowerCase(),inputType:e.type||'',enabled:!e.disabled,value:['INPUT','TEXTAREA','SELECT'].includes(e.tagName)?String(e.value).slice(0,2000):undefined,options:e.tagName==='SELECT'?[...e.options].slice(0,100).map(o=>({value:o.value,label:o.label})):undefined}));
 const text=(document.body?.innerText||'').slice(0,20000);
 globalThis.__jarvisObserved={token,nodes,controls,text,url:location.href,scrollX,scrollY,values:nodes.map(e=>({value:e.value,checked:e.checked}))};
 return {token,url:location.href,title:document.title,text,controls,ready:document.readyState,
  handoff:/captcha|verify you are human|two.factor|sign in to continue/i.test(text)||!!document.querySelector('input[type="password"],input[autocomplete="cc-number"],input[autocomplete="one-time-code"]'),frames:document.querySelectorAll('iframe').length};
}
async function actDom(request) {
 const snapshot=globalThis.__jarvisObserved;if(!snapshot||snapshot.token!==request.token)throw Error('Inspection expired. Inspect again.');
 if(location.href!==snapshot.url||(document.body?.innerText||'').slice(0,20000)!==snapshot.text)throw Error('Page content changed. Inspect and approve again.');
 if(snapshot.nodes.some((e,i)=>!e.isConnected||e.value!==snapshot.values[i].value||e.checked!==snapshot.values[i].checked))throw Error('Form values changed. Inspect and approve again.');
 const index=snapshot.controls.findIndex(c=>c.id===request.controlId),element=snapshot.nodes[index],control=snapshot.controls[index];
 if(!element||!element.isConnected||element.disabled||element.type==='password')throw Error('The selected control is unavailable.');
 const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)throw Error('The selected control is hidden.');
 const name=(element.getAttribute('aria-label')||[...(element.labels||[])].map(l=>{const copy=l.cloneNode(true);copy.querySelectorAll('input,textarea,select,button').forEach(n=>n.remove());return copy.textContent;}).join(' ')||element.innerText||element.getAttribute('title')||element.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim().slice(0,200);
 if(name!==control.name)throw Error('The control label changed. Inspect again.');
 globalThis.__jarvisObserved=null;
 if(request.action==='click')element.click();
 else if(request.action==='fill'){
  if(!['INPUT','TEXTAREA'].includes(element.tagName)||['file','password','hidden'].includes(element.type))throw Error('This field cannot be filled.');
  const setter=Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;
  setter.call(element,request.value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
 }else if(request.action==='select'){
  if(element.tagName!=='SELECT'||![...element.options].some(o=>o.value===request.value))throw Error('Choose a listed option.');
  element.value=request.value;element.dispatchEvent(new Event('change',{bubbles:true}));
 }else if(request.action==='scroll'){
  if(!request.value)element.scrollIntoView({block:'center',behavior:'instant'});
  else window.scrollBy({left:request.value==='right'?innerWidth*.8:request.value==='left'?-innerWidth*.8:0,top:request.value==='down'?innerHeight*.8:request.value==='up'?-innerHeight*.8:0,behavior:'instant'});
 }
 else if(request.action==='focus')element.focus();
 else throw Error('Unsupported browser action.');
 await new Promise(resolve=>setTimeout(resolve,100));
 return {accepted:true,verified:request.action==='fill'||request.action==='select'?element.value===request.value:
  request.action==='focus'?document.activeElement===element:request.action==='scroll'?(scrollX!==snapshot.scrollX||scrollY!==snapshot.scrollY):
  request.expected?(!snapshot.text.includes(request.expected)&&(document.body?.innerText||'').includes(request.expected)):false,
  note:'The browser accepted the action; verify its effect before continuing.'};
}
function createBrowser({root,control,getConfig=()=>({}),saveConfig=()=>{},launch=launchBrowser,ownedProcesses,headless=false,now=Date.now}) {
 let session=null,snapshot=null,contextId=null,acting=false,generation=0;const approvals=createApprovals({ttl:120000,now});
 function close(){generation++;snapshot=null;contextId=null;approvals.clear();const previous=session;session=null;previous?.close();return {success:true};}
 control?.onStop(close);
 const enabled=()=>getConfig().managedBrowserEnabled===true;
 function check(){control?.assertRunning();if(!enabled())throw Error('Enable the isolated browser first.');}
 function offer(action,paths,value,body){const sig=crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');if(body.approved===true&&approvals.consume(body.approvalToken,sig))return null;return {status:409,body:{needsApproval:true,approvalKind:'browser',action,paths,approvalToken:approvals.issue(sig)}};}
 async function evaluate(fn,arg){const result=await session.cdp.send('Runtime.evaluate',{expression:'('+fn.toString()+')('+JSON.stringify(arg)+')',contextId,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
 async function configure(body){if(typeof body.enabled!=='boolean')throw Error('Use a boolean enabled value.');if(body.enabled){const preview=offer('Enable an isolated browser controlled by JARVIS',['Separate browser profile','Every action requires approval','Downloads disabled'],['enable'],body);if(preview)return preview;}else close();getConfig().managedBrowserEnabled=body.enabled;saveConfig();return {status:200,body:status()};}
 async function open(body){check();const url=webUrl(body.url);const preview=offer('Open this page in the isolated browser',[url],['open',url],body);if(preview)return preview;
  const operation=control?.operation(),started=generation;try{if(!session){const created=await launch({root,ownedProcesses,headless});if(started!==generation){created.close();throw Error('Browser opening was cancelled.');}session=created;}operation?.check();snapshot=null;await session.cdp.send('Page.navigate',{url});
   let state;for(let i=0;i<60;i++){const tree=await session.cdp.send('Page.getFrameTree');const world=await session.cdp.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'jarvis-private'});contextId=world.executionContextId;
    try{state=await evaluate(()=>({url:location.href,ready:document.readyState}));if(state.ready==='complete'&&state.url!=='about:blank')break;}catch{}await pause(100);}
   operation?.check();return {status:200,body:{success:true,url:state?.url,verified:state?.ready==='complete'&&state.url===url,note:'Inspect the page before any action.'}};
  }finally{operation?.release();}}
 async function inspect(){check();if(!session)throw Error('Open a page first.');const tree=await session.cdp.send('Page.getFrameTree');const world=await session.cdp.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'jarvis-private'});contextId=world.executionContextId;
  const token=crypto.randomUUID(),data=await evaluate(observeDom,token);snapshot={...data,expires:now()+120000};return {...data,expiresAt:snapshot.expires};}
 async function action(body){check();if(acting)throw Error('Wait for the current browser action.');const selected=snapshot;
  if(!selected||selected.token!==body.token||selected.expires<=now())throw Error('Inspect the page again.');
  if(selected.handoff)throw Error('This page requires manual login, verification or CAPTCHA handling. Complete it yourself, then inspect again.');
  const target=selected.controls.find(c=>c.id===body.controlId);if(!target?.enabled)throw Error('Choose an enabled control from the latest inspection.');
  const action=String(body.action),value=String(body.value||''),expected=String(body.expected||'');
  if(action==='click'&&/\b(pay|purchase|checkout|transfer|send|delete account|confirm booking)\b/i.test(target.name))throw Error('Sending, payment and destructive account actions require manual takeover or a dedicated reviewed provider tool.');
  if(!['click','fill','select','scroll','focus'].includes(action)||value.length>2000||expected.length>200)throw Error('Unsupported action or oversized input.');
  if(action==='scroll'&&!['','up','down','left','right'].includes(value))throw Error('Choose into-view, up, down, left or right.');
  const preview=offer('Perform one browser action',[selected.url,action,target.name||target.id,...(value?[value]:[]),...(expected?['Expected: '+expected]:[])],[selected.token,target.id,action,value,expected],body);if(preview)return preview;
  acting=true;snapshot=null;const operation=control?.operation();try{const result=await evaluate(actDom,{token:selected.token,controlId:target.id,action,value,expected});operation?.check();return {status:200,body:{success:true,...result}};}finally{acting=false;operation?.release();}}
 function status(){return {enabled:enabled(),running:!!session,isolated:true,url:snapshot?.url||null,supported:binaries().some(file=>fs.existsSync(file))};}
 return {configure,open,inspect,action,close,status};
}
function register(app,options){const browser=createBrowser(options);process.on('exit',browser.close);
 app.get('/api/browser/status',(_req,res)=>res.set('Cache-Control','no-store').json(browser.status()));
 for(const operation of ['configure','open','inspect','action','close'])app.post('/api/browser/'+operation,async(req,res)=>{try{const result=await browser[operation](req.body);res.status(result.status||200).set('Cache-Control','no-store').json(result.body||result);}catch(error){res.status(400).json({error:String(error.message).slice(0,600)});}});
 return browser;
}
module.exports={createBrowser,register,launchBrowser,webUrl,binaries,observeDom,actDom};
