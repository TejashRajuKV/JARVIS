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
  check('rejects empty plans', P.validateWorkflow({ steps: [] }).error === 'WORKFLOW_EMPTY');
  check('rejects duplicate ids', P.validateWorkflow({ steps: [{id:'a'},{id:'a'}] }).error === 'DUPLICATE_STEP_ID');
  check('rejects missing dependency', P.validateWorkflow({ steps: [{id:'a',dependsOn:['missing']}] }).error === 'UNKNOWN_DEPENDENCY');
  check('rejects cycles', P.validateWorkflow({ steps: [{id:'a',dependsOn:['b']},{id:'b',dependsOn:['a']}] }).error === 'WORKFLOW_CYCLE');
  check('rejects path-like identifiers', P.validateWorkflow({ steps: [{id:'../x'}] }).error === 'INVALID_STEP_ID');
  check('does not parallelize unknown or side-effecting steps', (() => { const x=P.validateWorkflow({steps:[{id:'a'},{id:'b',tier:'confirm'}]}); return x.ok && x.plan.waves.every(w=>w.length===1); })());
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-platform-'));
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
  check('audit storage uses private permissions where supported', (fs.statSync(auditFile).mode & 0o077) === 0);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('agent-platform: ' + (total - fail) + '/' + total);
process.exitCode = fail ? 1 : 0;
