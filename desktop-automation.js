'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { createApprovals } = require('./approvals');

function windowsAdapter(request) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-Mta', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'desktop-automation.ps1')], {
      windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, JARVIS_DESKTOP_REQUEST: JSON.stringify(request) },
    }, (error, stdout) => {
      if (error) return reject(new Error(error.killed ? 'The application did not respond in time. Inspect it again before another action.' : 'Windows accessibility is unavailable for this application.'));
      try {
        const result = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
        if (result.error) return reject(new Error(result.error));
        resolve(result);
      } catch (failure) { reject(failure); }
    });
  });
}

function createController({ adapter = windowsAdapter, now = Date.now, ttl = 120000, control, strict = false, allowExtended = () => false } = {}) {
  const windows = new Map(), observations = new Map(), approvals = createApprovals({ now, ttl });
  control?.onStop(() => { windows.clear(); observations.clear(); approvals.clear(); return { desktopApprovalsRevoked: true }; });
  const text = (value, limit = 200) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
  const purge = () => {
    for (const map of [windows, observations]) for (const [id, value] of map)
      if (value.expires <= now()) map.delete(id);
  };
  async function list() {
    purge();
    const result = await adapter({ operation: 'list' });
    const rows = [];
    for (const window of (result.windows || []).slice(0, 40)) {
      if (!window.handle || !window.pid || !window.title) continue;
      const id = crypto.randomUUID();
      if (windows.size >= 80) windows.delete(windows.keys().next().value);
      windows.set(id, { handle: String(window.handle), pid: Number(window.pid), title: String(window.title), expires: now() + ttl });
      rows.push({ id, title: text(window.title), app: text(window.app, 80) });
    }
    return { windows: rows };
  }
  async function inspect(windowId) {
    purge();
    const window = windows.get(windowId);
    if (!window) throw new Error('Refresh the window list and select the application again.');
    const result = await adapter({ operation: 'inspect', window });
    if (!Array.isArray(result.controls)) throw new Error('The application did not return accessible controls.');
    const id = crypto.randomUUID(), controls = [];
    const targets = new Map();
    for (const [index, control] of result.controls.slice(0, 250).entries()) {
      if (control.password || !control.runtimeId || control.offscreen) continue;
      const controlId = 'control-' + (index + 1);
      targets.set(controlId, control);
      controls.push({ id: controlId, name: text(control.name), type: text(control.type, 60),
        enabled: control.enabled === true, canClick: control.enabled === true && control.invoke === true,
        canFill: control.enabled === true && control.writable === true,
        canSelect:control.enabled===true&&control.select===true,canToggle:control.enabled===true&&control.toggle===true,
        canExpand:control.enabled===true&&control.expand===true,canScroll:control.enabled===true&&control.scroll===true });
    }
    if (observations.size >= 20) observations.delete(observations.keys().next().value);
    const truncated = !!result.truncated || result.controls.length > 250;
    observations.set(id, { window, targets, truncated, expires: now() + ttl });
    return { snapshotId: id, title: text(window.title), controls, truncated, expiresAt: now() + ttl };
  }
  async function act(body) {
    if (control?.status().stopped) return { status: 409, body: { error: 'Emergency stop is active.' } };
    purge();
    const { snapshotId, controlId, action } = body || {};
    if (!['click', 'fill','select','toggle','expand','collapse','scroll'].includes(action) || typeof snapshotId !== 'string' || typeof controlId !== 'string')
      return { status: 400, body: { error: 'Choose a control from a recent window inspection.' } };
    if(!['click','fill'].includes(action)&&!allowExtended())return {status:403,body:{error:'Enable extended accessibility actions first.'}};
    if(action==='toggle'&&!['on','off'].includes(body.value)||action==='scroll'&&!['up','down','left','right'].includes(body.value))return {status:400,body:{error:'Choose an exact toggle state or scroll direction.'}};
    if (action === 'fill' && (typeof body.value !== 'string' || body.value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.value)))
      return { status: 400, body: { error: 'Enter up to 2000 characters for the field.' } };
    const snapshot = observations.get(snapshotId), target = snapshot?.targets.get(controlId);
    if (!target) return { status: 409, body: { error: 'This inspection expired or was already used. Inspect the window again.' } };
    const pattern={click:'invoke',fill:'writable',select:'select',toggle:'toggle',expand:'expand',collapse:'expand',scroll:'scroll'}[action];
    if (!target.enabled || target.password || target.offscreen || !target[pattern])
      return { status: 400, body: { error: 'That action is unavailable for this control.' } };
    const expected = strict && action === 'click' ? body.expected : null;
    if (strict && (snapshot.truncated || !target.name || [...snapshot.targets.values()].filter(item => item.name === target.name).length !== 1))
      return { status: 409, body: { error: 'The inspection could not establish a unique exact control.' } };
    if (strict && action === 'click' && (typeof expected !== 'string' || !expected.trim() || expected.length > 200 ||
        [...snapshot.targets.values()].some(item => item.name === expected)))
      return { status: 400, body: { error: 'Specify an exact result label that is currently absent.' } };
    const value = ['fill','toggle','scroll'].includes(action) ? body.value : '';
    const signature = crypto.createHash('sha256').update(JSON.stringify([snapshotId, controlId, action, value, expected])).digest('hex');
    if (body.approved !== true || !approvals.consume(body.approvalToken, signature)) return {
      status: 409,
      body: { needsApproval: true, approvalKind: 'desktop', approvalToken: approvals.issue(signature),
        action: action+' the selected control',
        paths: [text(snapshot.window.title), text(target.name || target.type), ...(value ? [value] : []), ...(expected ? ['Expected: ' + expected] : [])],
        error: 'Approve this action on the laptop.' },
    };
    // A snapshot permits one action. Consume it before calling the OS, including when an OS call times out.
    observations.delete(snapshotId);
    try {
      const result = await adapter({ operation: 'act', window: snapshot.window, target, action, value, ...(strict && { strictTarget: true, expected }) });
      if(!['click','fill'].includes(action))return {status:200,body:{success:true,verified:result.verified===true,note:result.verified?'The application reports the requested control state.':'Action accepted; inspect the application to verify the result.'}};
      if (strict && action === 'click') {
        return { status: 200, body: { success: true, verified: result.verified === true,
          note: result.verified ? 'The exact expected result appeared.' : 'The click was sent, but the expected result could not be verified. Inspect before trying again.' } };
      }
      if (action === 'fill' && result.verified !== true)
        return { status:409, body:{ error:'The application did not confirm the requested field value. Inspect the window before continuing.' } };
      return { status: 200, body: { success: true, verified: action === 'fill' && result.verified === true,
        note: action === 'fill' && result.verified ? 'The field reports the requested value.' : 'The application accepted the action. Inspect the window to check its result.' } };
    } catch (error) { return { status: 409, body: { error: error.message } }; }
  }
  return { list, inspect, act };
}

function register(app, { enabled = process.platform === 'win32' && !process.env.JARVIS_TEST, control, getConfig=()=>({}), saveConfig=()=>{}, controller = createController({ control,allowExtended:()=>getConfig().desktopExtended===true }) } = {}) {
  const configurationApprovals=createApprovals();control?.onStop(configurationApprovals.clear);
  const available = res => {
    res.setHeader('Cache-Control', 'no-store');
    if (enabled) return true;
    res.status(501).json({ error: 'Desktop control is available on Windows. Isolated tests use a fixture adapter.' });
    return false;
  };
  app.get('/api/desktop/windows', async (_req, res) => {
    if (!available(res)) return;
    try { res.json(await controller.list()); }
    catch (error) { res.status(502).json({ error: error.message }); }
  });
  app.get('/api/desktop/extended',(_req,res)=>res.set('Cache-Control','no-store').json({supported:enabled,enabled:getConfig().desktopExtended===true}));
  app.post('/api/desktop/extended',(req,res)=>{
    if(!available(res))return;
    if(typeof req.body.enabled!=='boolean')return res.status(400).json({error:'Use a boolean enabled value.'});
    if(req.body.enabled&&(req.body.approved!==true||!configurationApprovals.consume(req.body.approvalToken,'enable-extended')))return res.status(409).json({needsApproval:true,approvalKind:'desktop',approvalToken:configurationApprovals.issue('enable-extended'),action:'Enable additional Windows accessibility actions',paths:['Selection','Toggle on/off','Expand/collapse','Scroll','Each action still requires a one-time approval']});
    getConfig().desktopExtended=req.body.enabled;saveConfig();res.json({success:true,enabled:req.body.enabled});
  });
  app.post('/api/desktop/inspect', async (req, res) => {
    if (!available(res)) return;
    try { res.json(await controller.inspect(req.body?.windowId)); }
    catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post('/api/desktop/action', async (req, res) => {
    if (!available(res)) return;
    const result = await controller.act(req.body);
    res.status(result.status).json(result.body);
  });
}
module.exports = { register, createController, windowsAdapter };
