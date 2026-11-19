'use strict';
const { createController, windowsAdapter } = require('../desktop-automation');
const { check, done } = require('./lib/server').suite('desktop-automation');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  let now = 10000, actions = 0;
  const control = { runtimeId:'1.2', name:'Message', type:'ControlType.Edit', enabled:true, writable:true, invoke:false };
  const controller = createController({ now:() => now, adapter:async request => {
    if (request.operation === 'list') return {windows:[{handle:'101', pid:51, title:'Fixture window', app:'fixture'}]};
    if (request.operation === 'inspect') return {controls:[control,
      {...control,runtimeId:'1.3',name:'Password',password:true},
      {...control,runtimeId:'1.4',name:'Hidden',offscreen:true},
    ]};
    actions++;
    return {verified:true};
  }});
  const listed = await controller.list(), windowId = listed.windows[0].id;
  const snapshot = await controller.inspect(windowId);
  check('Inspection', 'returns opaque window and control references and omits hidden and password controls',
    listed.windows[0].title === 'Fixture window' && !Object.hasOwn(listed.windows[0], 'handle') &&
    snapshot.controls.length === 1 && snapshot.controls[0].name === 'Message' &&
    !JSON.stringify(snapshot).includes('runtimeId'));
  const request = {snapshotId:snapshot.snapshotId,controlId:snapshot.controls[0].id,action:'fill',value:'Meet at 5 PM, room 12.'};
  const offered = await controller.act(request);
  check('Approval', 'an action without approval returns an exact preview and makes no OS call',
    offered.status === 409 && offered.body.needsApproval && offered.body.approvalKind === 'desktop' &&
    offered.body.paths.join('|') === 'Fixture window|Message|Meet at 5 PM, room 12.' && actions === 0);
  await controller.act({...request,value:'Changed target text',approved:true,approvalToken:offered.body.approvalToken});
  check('Approval', 'altering the approved text cannot reuse the token', actions === 0);
  const allowed = {...request,approved:true,approvalToken:offered.body.approvalToken};
  const completed = await Promise.all([controller.act(allowed),controller.act(allowed)]);
  check('Approval', 'concurrent replay performs one fill and verifies its value',
    actions === 1 && completed.filter(result => result.status === 200 && result.body.verified).length === 1);
  const stale = await controller.inspect(windowId);
  const old = await controller.act({...request,snapshotId:stale.snapshotId});
  now += 120001;
  const expired = await controller.act({...request,snapshotId:stale.snapshotId,approved:true,approvalToken:old.body.approvalToken});
  check('Approval', 'expired inspections and tokens fail before the OS action', expired.status === 409 && actions === 1);
  check('Validation', 'unsupported actions and oversized field values are refused',
    (await controller.act({...request,action:'shell'})).status === 400 &&
    (await controller.act({...request,value:'a'.repeat(2001)})).status === 400);
  let failedCalls = 0;
  const failedController = createController({adapter:async request => {
    if(request.operation==='list') return {windows:[{handle:'202',pid:52,title:'Failing fixture'}]};
    if(request.operation==='inspect') return {controls:[control]};
    failedCalls++; throw new Error('The fixture window changed.');
  }});
  const failingWindow = (await failedController.list()).windows[0];
  const failingSnapshot = await failedController.inspect(failingWindow.id);
  const fail = {...request,snapshotId:failingSnapshot.snapshotId,controlId:failingSnapshot.controls[0].id};
  const grant = await failedController.act(fail);
  const approvedFail = {...fail,approved:true,approvalToken:grant.body.approvalToken};
  const failure = await failedController.act(approvedFail);
  await failedController.act(approvedFail);
  check('Recovery','a failed native action consumes its snapshot and cannot replay',failure.status===409&&failedCalls===1);

  if (process.platform === 'win32') {
    const title = 'JARVIS fixture ' + randomUUID();
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
      path.join(__dirname,'fixtures','desktop-window.ps1')], {
      windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,JARVIS_FIXTURE_TITLE:title},
    });
    let diagnostics = '';
    child.stdout.on('data', data => { diagnostics += data; });
    child.stderr.on('data', data => { diagnostics += data; });
    try {
      const native = createController({allowExtended:()=>true});
      let fixture;
      for (let i = 0; i < 25 && !fixture; i++) {
        fixture = (await native.list()).windows.find(window => window.title === title);
        if (!fixture) await wait(250);
      }
      if (!fixture) throw new Error('Native fixture did not appear. ' + diagnostics.slice(0,400));
      const observed = await native.inspect(fixture.id);
      const field = observed.controls.find(item => item.name === 'Message' && item.canFill);
      check('Windows UIA', 'inspects the dedicated form and identifies its editable field', !!field, observed);
      check('Windows UIA', 'the native password control and its value are omitted',
        !observed.controls.some(item=>item.name==='Secret fixture')&&!JSON.stringify(observed).includes('hidden-private-fixture'));
      if (!field) throw new Error('Native fixture field not found.');
      const fill = {snapshotId:observed.snapshotId,controlId:field.id,action:'fill',value:'Meet at 5 PM, room 12.'};
      const preview = await native.act(fill);
      const filled = await native.act({...fill,approved:true,approvalToken:preview.body.approvalToken});
      check('Windows UIA', 'fills and reads back normal capitals and digits in the fixture only',
        filled.status === 200 && filled.body.verified, filled);
      const after = await native.inspect(fixture.id);
      const click = after.controls.find(item => item.name === 'Apply' && item.canClick);
      if (!click) throw new Error('Native fixture button not found.');
      const press = {snapshotId:after.snapshotId,controlId:click.id,action:'click'};
      const approval = await native.act(press);
      const clicked = await native.act({...press,approved:true,approvalToken:approval.body.approvalToken});
      let final;
      for(let i=0;i<5;i++) {
        final = await native.inspect(fixture.id);
        if(final.controls.some(item=>item.name==='Applied: Meet at 5 PM, room 12.')) break;
        await wait(300);
      }
      check('Windows UIA', 'invokes the fixture button and observes the resulting label',
        clicked.status === 200 && !clicked.body.verified &&
        final.controls.some(item => item.name === 'Applied: Meet at 5 PM, room 12.'), {clicked,controls:final.controls});
      check('Windows UIA', 'a stale control identity cannot be used to act',
        await windowsAdapter({operation:'act',window:{handle:'0',pid:0,title:'missing'},target:{},action:'click'})
          .then(() => false, () => true));
      for(const [name,action,value]of [['Fixture option','toggle','on'],['DBMS fixture','select','']]) {
        const inspected=await native.inspect(fixture.id),target=inspected.controls.find(c=>c.name===name);
        if(!target)throw Error('Extended native fixture control is missing: '+name);
        const input={snapshotId:inspected.snapshotId,controlId:target.id,action,value};
        const offer=await native.act(input);
        check('Windows UIA','extended '+action+' requires exact one-time approval',offer.status===409&&offer.body.needsApproval);
        const result=await native.act({...input,approved:true,approvalToken:offer.body.approvalToken});
        check('Windows UIA','extended '+action+' is read back through the native pattern',result.status===200&&result.body.verified,result);
        check('Windows UIA','extended '+action+' cannot replay',(await native.act({...input,approved:true,approvalToken:offer.body.approvalToken})).status===409);
      }
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([new Promise(resolve => child.once('exit',resolve)),wait(2000)]);
      }
    }
    const executable = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ].find(file => fs.existsSync(file));
    if (executable) {
      const webTitle = 'JARVIS website fixture ' + randomUUID();
      const server = http.createServer((_request, response) => {
        response.setHeader('Content-Type','text/html;charset=utf-8');
        response.end('<!doctype html><html><head><title>' + webTitle + '</title></head><body>' +
          '<label>Message <input aria-label="Message" id="message"></label><button id="apply">Apply</button>' +
          '<p id="result" role="status">Waiting</p><script>document.getElementById("apply").onclick=()=>{' +
          'document.getElementById("result").textContent="Applied: "+document.getElementById("message").value;};</script></body></html>');
      });
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
      const profile = fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-uia-browser-'));
      const browser = spawn(executable, [
        '--user-data-dir=' + profile,'--no-first-run','--no-default-browser-check','--disable-extensions',
        '--disable-sync','--disable-background-networking','--disable-component-update',
        '--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion',
        '--force-renderer-accessibility=complete','--enable-features=UiaProvider','--app=http://127.0.0.1:' + server.address().port,
      ], { windowsHide:false,stdio:'ignore' });
      try {
        const native = createController();
        let window;
        for (let i=0;i<20&&!window;i++) {
          window = (await native.list()).windows.find(item => item.title.startsWith(webTitle));
          if (!window) await wait(300);
        }
        if (!window) throw new Error('The isolated browser fixture did not appear.');
        const ownWindow=(await windowsAdapter({operation:'list'})).windows.find(item=>item.title.startsWith(webTitle));
        if(!ownWindow)throw Error('The owned browser fixture window disappeared.');
        // UIA excludes background/occluded renderer content on some Chromium builds.
        // Restore only the uniquely titled disposable fixture, never the user's browser.
        require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
          'Add-Type \'using System;using System.Runtime.InteropServices;public class FixtureFocus{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}\'; $h=[IntPtr][long]$env:JARVIS_FIXTURE_HANDLE;[void][FixtureFocus]::ShowWindow($h,9);[void][FixtureFocus]::SetForegroundWindow($h)'],
          {windowsHide:true,timeout:10000,env:{...process.env,JARVIS_FIXTURE_HANDLE:String(ownWindow.handle)}});
        let observed, field;
        const accessibleBy = Date.now() + 25000;
        while(!field && Date.now() < accessibleBy) {
          observed = await native.inspect(window.id);
          field = observed.controls.find(item => item.name === 'Message' && item.canFill);
          if(!field) await wait(500);
        }
        check('Website UIA','finds the browser page input through Windows accessibility',!!field,observed);
        if (!field) throw new Error('The isolated fixture page did not expose its Message input. Fixture controls: ' +
          observed.controls.slice(0, 35).map(item => item.type + ':' + item.name.slice(0, 100)).join(' | '));
        const fill = {snapshotId:observed.snapshotId,controlId:field.id,action:'fill',value:'Browser task 42'};
        const offered = await native.act(fill);
        const filled = await native.act({...fill,approved:true,approvalToken:offered.body.approvalToken});
        check('Website UIA','fills the browser field and verifies its reported value',filled.status===200&&filled.body.verified,filled);
        const next = await native.inspect(window.id);
        const button = next.controls.find(item => item.name==='Apply'&&item.canClick);
        if (!button) throw new Error('Browser fixture button is unavailable.');
        const click = {snapshotId:next.snapshotId,controlId:button.id,action:'click'};
        const preview = await native.act(click);
        const clicked = await native.act({...click,approved:true,approvalToken:preview.body.approvalToken});
        let after;
        for(let i=0;i<5;i++) {
          after = await native.inspect(window.id);
          if(after.controls.some(item=>item.name==='Applied: Browser task 42')) break;
          await wait(300);
        }
        check('Website UIA','clicks the page button and observes the updated page text',
          clicked.status===200&&after.controls.some(item=>item.name==='Applied: Browser task 42'),
          {clicked,controls:after.controls.map(item=>item.type+':'+item.name),truncated:after.truncated});
        if(clicked.status!==200||!after.controls.some(item=>item.name==='Applied: Browser task 42'))
          throw Error('Browser click failed: '+JSON.stringify({clicked,controls:after.controls.map(item=>item.name),truncated:after.truncated}));
      } finally {
        if (browser.exitCode === null) {
          try { require('node:child_process').execFileSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); }
          catch(error) { if(error.status!==128)throw error; /* launcher already exited */ }
        }
        await new Promise(resolve=>server.close(resolve));
        if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected browser fixture profile path.');
        for(let i=0;i<5;i++) {
          try { fs.rmSync(profile,{recursive:true,force:true}); break; } catch { await wait(200); }
        }
      }
    } else console.log('SKIP website accessibility fixture: Edge and Chrome unavailable.');
  }
  process.exitCode = done() ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
