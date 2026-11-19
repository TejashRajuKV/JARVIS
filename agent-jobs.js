'use strict';
// Durable, bounded execution for explicitly supported existing read-only tools.
// No browser, shell, GUI input, external tools, or approval-bearing actions run here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const context = require('./agent-context');

function createQueue({ file, registry, executors, notify = async () => {}, getHistory = () => [], now = Date.now, control,
  maxRuntimeLimit = 3600000, modelTools = new Set(['summarise_file']), reviewOnFailure = false, acceptProfile } = {}) {
  let jobs = [], active = false, scheduled = false, wakeTimer;
  const controllers = new Map();
  if (fs.existsSync(file)) {
    jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(jobs)) throw new Error('Invalid task checkpoint file; it has been preserved.');
    for (const job of jobs) if (job.status === 'running') {
      job.status = 'interrupted'; job.note = 'JARVIS restarted during this task. Review before submitting it again.';
    }
  }
  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(jobs)); fs.renameSync(temp, file);
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  function validate(plan) {
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 32) throw new Error('Use a plan of 1–32 supported steps.');
    return plan.steps.map((raw, i) => {
      const checked = registry.validateStep(raw, i, { inPlan: true });
      if (!checked.ok) throw new Error(checked.reason);
      const s = checked.step;
      if (s.tier !== 'safe' || !Object.hasOwn(executors, s.tool)) throw new Error(s.tool + ' requires the interactive executor; it cannot run in the background.');
      return { ...s, id: 'step_' + (i + 1), status: 'notrun' };
    });
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => { scheduled = false; void drain().catch(() => { active = false; }); });
  }
  function arm() {
    clearTimeout(wakeTimer);
    const next=jobs.filter(j=>j.status==='queued').reduce((min,j)=>Math.min(min,j.notBefore||0),Infinity);
    if(Number.isFinite(next)) {wakeTimer=setTimeout(schedule,Math.max(10,Math.min(30000,next-now())));wakeTimer.unref?.();}
  }
  async function drain() {
    if (active) return;
    if (control?.status().stopped) return;
    active = true;
    try {
      for (const job of jobs.filter(j => j.status === 'queued' && (j.notBefore||0)<=now())) {
        if (job.status !== 'queued') continue;
        const controller = new AbortController(); controllers.set(job.id, controller);
        job.status = 'running'; job.updated = now(); job.started=now(); job.modelCalls=0; persist();
        try {
          if (acceptProfile && !acceptProfile(job.profileId)) throw new Error('The selected profile is unavailable. Review the saved task.');
          // Revalidate persisted plans on every start, so a changed registry cannot
          // grandfather an old permission or an unsupported tool into execution.
          const validated = validate({ steps: job.steps });
          for (let i = 0; i < validated.length; i++) {
            if (controller.signal.aborted) break;
            control?.assertRunning();
            const budget=job.budget||{maxRuntimeMs:120000,maxModelCalls:5};
            if(now()-job.started>=budget.maxRuntimeMs || (modelTools.has(validated[i].tool) && job.modelCalls>=budget.maxModelCalls)) {
              const error=new Error('Task budget exhausted; review the checkpoint before starting more work.');error.code='BUDGET_EXCEEDED';throw error;
            }
            const step = job.steps[i];
            const history = [...getHistory(), ...jobs.filter(j => j.id !== job.id)].sort((a, b) => (a.updated || a.at || a.created || 0) - (b.updated || b.at || b.created || 0));
            if (context.priorFailure(validated[i], history)) throw new Error('This exact step failed before. Review it interactively before retrying.');
            step.status = 'running'; persist();
            try {
              const remaining=Math.max(1,budget.maxRuntimeMs-(now()-job.started));
              const timed=new AbortController();
              const timer=setTimeout(()=>timed.abort(),remaining);
              if(modelTools.has(validated[i].tool))job.modelCalls++;
              let result, cancelListener;
              try {
                const deadline=new Promise((_,reject)=>timed.signal.addEventListener('abort',()=>{const error=new Error('Task runtime budget exhausted.');error.code='BUDGET_EXCEEDED';reject(error);},{once:true}));
                const cancelled=new Promise((_,reject)=>{cancelListener=()=>reject(new Error('Cancelled'));if(controller.signal.aborted)cancelListener();else controller.signal.addEventListener('abort',cancelListener,{once:true});});
                result = await Promise.race([executors[validated[i].tool](validated[i].args, { signal: AbortSignal.any([controller.signal,timed.signal]),
                  summary: context.compact(job.steps.slice(0, i)) }),deadline,cancelled]);
              } finally {clearTimeout(timer);if(cancelListener)controller.signal.removeEventListener('abort',cancelListener);}
              if (controller.signal.aborted) { step.status = 'cancelled'; break; }
              if (result?.error || result?.ok === false) throw new Error(result.error || 'Tool failed');
              step.status = 'verified';
              const output = String(typeof result === 'string' ? result : JSON.stringify(result));
              step.output = output.slice(0, 6000); step.outputTruncated = output.length > 6000;
              step.note = 'Read-only tool completed.';
            } catch (error) {
              step.status = controller.signal.aborted ? 'cancelled' : 'failed';
              step.note = String(error.message || error).slice(0, 500); throw error;
            } finally {
              job.summary = context.compact(job.steps); job.updated = now(); persist();
            }
          }
          job.status = controller.signal.aborted ? 'cancelled' : 'completed';
        } catch (error) {
          job.status = controller.signal.aborted ? 'cancelled' : error.code === 'BUDGET_EXCEEDED' ? 'budget_exceeded' : reviewOnFailure ? 'needs_review' : 'failed';
          job.note = String(error.message || error).slice(0, 500);
        } finally {
          controllers.delete(job.id); job.updated = now(); persist();
        }
        try { await notify({ id: job.id, status: job.status, goal: job.goal }); } catch { /* results stay durable even if notification delivery fails */ }
      }
    } finally { active = false; arm(); }
  }
  function submit(plan) {
    control?.assertRunning();
    if (acceptProfile && !acceptProfile(plan.profileId)) throw new Error('The selected profile is unavailable.');
    const steps = validate(plan);
    const notBefore=plan.notBefore==null?now():Number(plan.notBefore);
    if(!Number.isFinite(notBefore)||notBefore<now()-60000||notBefore>now()+31*86400000)throw new Error('Schedule the job within the next 31 days.');
    const maxRuntimeMs=plan.budget?.maxRuntimeMs??120000, maxModelCalls=plan.budget?.maxModelCalls??5;
    if(!Number.isInteger(maxRuntimeMs)||maxRuntimeMs<100||maxRuntimeMs>maxRuntimeLimit||!Number.isInteger(maxModelCalls)||maxModelCalls<0||maxModelCalls>32)throw new Error(`Use a runtime budget of 100–${maxRuntimeLimit}ms and 0–32 model calls.`);
    if (jobs.filter(j => ['queued', 'running'].includes(j.status)).length >= 10) throw new Error('The background queue is full (10 tasks).');
    const job = { id: crypto.randomUUID(), goal: String(plan.goal || 'Background task').slice(0, 160),
      status: 'queued', created: now(), updated: now(), steps, summary: '', ...(acceptProfile && { profileId: plan.profileId }) };
    job.notBefore=notBefore;job.budget={maxRuntimeMs,maxModelCalls};
    const previous = jobs;
    jobs = jobs.length >= 50 ? jobs.filter(j => ['queued', 'running'].includes(j.status)).concat(jobs.filter(j => !['queued', 'running'].includes(j.status)).slice(-39), job) : [...jobs, job];
    try { persist(); } catch (error) { jobs = previous; throw error; }
    schedule(); return copy(job);
  }
  function cancel(id) {
    const job = jobs.find(j => j.id === id);
    if (!job || !['queued', 'running'].includes(job.status)) return false;
    controllers.get(id)?.abort();
    if (job.status === 'queued') job.status = 'cancelled';
    job.updated = now(); persist(); arm(); return true;
  }
  function cancelAll() {
    let cancelled = 0;
    for (const job of jobs) if (cancel(job.id)) cancelled++;
    return cancelled;
  }
  function shareReport(id, report) {
    const job = jobs.find(candidate => candidate.id === id);
    if (!job || job.status !== 'completed' || typeof report !== 'string' || report.length > 8000) return false;
    const previous = job.phoneShared;
    job.phoneShared = report;
    try { persist(); } catch (error) { job.phoneShared = previous; throw error; }
    return true;
  }
  control?.onStop(() => ({ backgroundTasksCancelled: cancelAll() }));
  persist(); schedule();
  return { submit, cancel, cancelAll, shareReport, get: id => copy(jobs.find(j => j.id === id) || null),
    list: () => jobs.slice().reverse().map(({ id, goal, status, summary, created, updated, note, notBefore, budget, modelCalls, phoneShared }) =>
      ({ id, goal, status, summary, created, updated, note, notBefore, budget, modelCalls, ...(phoneShared && { phoneShared: true }) })) };
}

function register(app, options) {
  const queue = createQueue(options);
  app.get('/api/agent/jobs', (_req, res) => res.set('Cache-Control', 'no-store').json({ jobs: queue.list(), tools: Object.keys(options.executors) }));
  app.get('/api/agent/jobs/:id', (req, res) => { const job = queue.get(req.params.id); res.status(job ? 200 : 404).set('Cache-Control', 'no-store').json(job || { error: 'Task not found' }); });
  app.post('/api/agent/jobs', (req, res) => { try { res.status(202).json({ job: queue.submit(req.body.plan) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  app.post('/api/agent/jobs/:id/cancel', (req, res) => res.status(queue.cancel(req.params.id) ? 200 : 409).json({ job: queue.get(req.params.id) }));
  return queue;
}
module.exports = { createQueue, register };
