'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const P = require('../agent-platform');
let fail = 0, total = 0;
const check = (name, ok, details) => { total++; if (!ok) { fail++; console.log('FAIL ' + name + (details ? ' — ' + JSON.stringify(details) : '')); } };

// Workflow graph validation: no execution, no hidden permission elevation.
{
  const r = P.validateWorkflow({ steps: [
    { id: 'a', label: 'Read docs', tier: 'safe', readOnly: true },
    { id: 'b', label: 'Read tests', tier: 'safe', readOnly: true },
    { id: 'c', label: 'Write change', tier: 'confirm', dependsOn: ['a', 'b'] },
    { id: 'd', label: 'Verify', tier: 'safe', readOnly: true, dependsOn: ['c'] }
  ] });
  check('independent safe read-only steps share a parallel wave', r.ok && r.plan.waves[0].length === 2, r);
  check('side-effecting step remains serialized and approval-gated', r.ok && r.plan.waves[1].join() === 'c' && r.plan.approvalRequired.includes('c'));
  check('dependent verification follows the write', r.ok && r.plan.waves[2].join() === 'd');
  check('validation explicitly never executes tools', r.ok && /validation-only/.test(r.plan.policy));
  const noExecutor = await P.executeWorkflow({steps:[{id:'x'}]});
  check('executor is mandatory for execution', noExecutor.error === 'EXECUTOR_REQUIRED');

  check('rejects empty plans', P.validateWorkflow({ steps: [] }).error === 'WORKFLOW_EMPTY');
  check('rejects duplicate ids', P.validateWorkflow({ steps: [{id:'a'},{id:'a'}] }).error === 'DUPLICATE_STEP_ID');
  check('rejects missing dependency', P.validateWorkflow({ steps: [{id:'a',dependsOn:['missing']}] }).error === 'UNKNOWN_DEPENDENCY');
  check('rejects cycles', P.validateWorkflow({ steps: [{id:'a',dependsOn:['b']},{id:'b',dependsOn:['a']}] }).error === 'WORKFLOW_CYCLE');
  check('rejects path-like identifiers', P.validateWorkflow({ steps: [{id:'../x'}] }).error === 'INVALID_STEP_ID');
  check('does not parallelize unknown or side-effecting steps', (() => { const x=P.validateWorkflow({steps:[{id:'a'},{id:'b',tier:'confirm'}]}); return x.ok && x.plan.waves.every(w=>w.length===1); })());
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-platform-'));
(async () => {
try {
  const file = path.join(tmp, 'research.json');
  const book = P.createResearchNotebook({ file });
  check('requires a research question', book.add({ title: 'empty' }).error === 'QUESTION_REQUIRED');
  const added = book.add({ question: 'Compare battery papers', summary: 'Key findings', sources: [
    { url: 'https://example.com/paper?q=cell&access_token=secret#private', title: 'Paper' },
    { url: 'javascript:alert(1)', title: 'bad' },
    { url: 'https://user:pass@example.org/', title: 'credentials' }
  ] });
  check('saves a local research record with safe source URLs', !!added.item && added.item.sources.length === 1 && added.item.sources[0].url === 'https://example.com/paper?q=cell');
  check('research source has no secrets or fragments', !JSON.stringify(added).includes('secret') && !JSON.stringify(added).includes('private'));
  check('research notebook persists after reload', P.createResearchNotebook({ file }).get(added.item.id).question === 'Compare battery papers');
  check('research item can be removed', book.remove(added.item.id) && book.list().length === 0);
  const auditFile = path.join(tmp, 'audit.json'), audit = P.createAuditLog({ file: auditFile });
  const event = audit.append({ category: 'agent', action: 'run task', outcome: 'success', runId: 'AGT-123', prompt: 'private prompt', url: 'https://secret.test/?token=private' });
  check('audit records bounded metadata only', !!event.item && !JSON.stringify(event).includes('private') && event.item.runId === 'AGT-123');
  check('audit rejects unknown categories', audit.append({ category: 'whatever', action: 'x' }).error === 'INVALID_CATEGORY');
  check('audit persists across reload', P.createAuditLog({ file: auditFile }).list()[0].id === event.item.id);
  check('audit history is bounded on read', audit.list(1).length === 1);
  check('audit storage uses private permissions where supported', process.platform === 'win32' || (fs.statSync(auditFile).mode & 0o077) === 0);

  // Exercise the mounted API handlers with a tiny Express-compatible fake.
  const mounted = {};
  const app = { locals: {} };
  for (const method of ['get','post','delete']) app[method] = (route, handler) => { mounted[method.toUpperCase() + ' ' + route] = handler; };
  P(app, { SANDBOX: tmp });
  function request(method, route, req = {}) {
    const response = { code: 200, headers: {}, body: null,
      setHeader(k,v) { this.headers[k]=v; return this; },
      status(n) { this.code=n; return this; },
      json(v) { this.body=v; return this; } };
    const handler = mounted[method + ' ' + route];
    if (!handler) throw new Error('Missing route ' + method + ' ' + route);
    handler({ body: {}, query: {}, params: {}, ...req }, response);
    return response;
  }
  const status = request('GET','/api/platform/status');
  check('status API reports cross-phase foundations', status.code === 200 && status.body.success && status.body.phases.researchNotebook.available);
  const empty = request('POST','/api/research/sessions',{body:{question:'   '}});
  check('research API rejects blank questions', empty.code === 400);
  const saved = request('POST','/api/research/sessions',{body:{question:'API research question',sources:[{url:'https://example.net/?token=private'}]}});
  check('research API saves a session and redacts source secrets', saved.code === 201 && saved.body.session.sources[0].url === 'https://example.net/');
  const listed = request('GET','/api/research/sessions');
  check('research API lists saved sessions', listed.body.sessions.some(x=>x.id===saved.body.session.id));
  const invalidWorkflow = request('POST','/api/workflows/validate',{body:{steps:[{id:'x',dependsOn:['missing']}] }});
  check('workflow API returns a client error for invalid graphs', invalidWorkflow.code === 400 && invalidWorkflow.body.error === 'UNKNOWN_DEPENDENCY');
  const validWorkflow = request('POST','/api/workflows/validate',{body:{steps:[{id:'read',tier:'safe',readOnly:true}]}});
  check('workflow API returns validated plans without executing them', validWorkflow.code === 200 && validWorkflow.body.ok && /validation-only/.test(validWorkflow.body.plan.policy));
  const audit = request('GET','/api/audit/events',{query:{limit:'10'}});
  check('audit API exposes server-generated events only', audit.code === 200 && audit.body.events.some(x=>x.action==='save-research-session'));
  const removed = request('DELETE','/api/research/sessions/:id',{params:{id:saved.body.session.id}});
  check('research API deletes a saved session', removed.code === 200);

  let order = [], approvals = 0, concurrent = 0, maxConcurrent = 0;
  const execResult = await P.executeWorkflow({steps:[
    {id:'r1',tier:'safe',readOnly:true},{id:'r2',tier:'safe',readOnly:true},
    {id:'write',tier:'confirm',dependsOn:['r1','r2']},{id:'verify',tier:'safe',readOnly:true,dependsOn:['write']}
  ]},{authorize:async()=>{approvals++;return true;},execute:async step=>{
    order.push('start:'+step.id); concurrent++; maxConcurrent=Math.max(maxConcurrent,concurrent);
    await new Promise(resolve=>setTimeout(resolve,5)); concurrent--; order.push('end:'+step.id); return 'ok';
  }});
  check('executor runs independent read-only steps concurrently', execResult.completed===4 && maxConcurrent===2, {execResult,maxConcurrent});
  check('executor asks for approval before confirmed side effects', approvals===1 && order.indexOf('start:write')>order.indexOf('end:r1') && order.indexOf('start:write')>order.indexOf('end:r2'));
  const denied = await P.executeWorkflow({steps:[{id:'write',tier:'confirm'}]},{authorize:async()=>false,execute:async()=>{throw new Error('must not execute');}});
  check('denied side effects are blocked and never executed', denied.blocked===1 && denied.results[0].status==='blocked');
  const failed = await P.executeWorkflow({steps:[{id:'a',tier:'safe'},{id:'b',tier:'safe',dependsOn:['a']}]},{execute:async step=>{if(step.id==='a')throw new Error('simulated');return 'wrong';}});
  check('failed dependency blocks downstream work without replay', failed.failed===1 && failed.blocked===1);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('agent-platform: ' + (total - fail) + '/' + total);
process.exitCode = fail ? 1 : 0;
})();
