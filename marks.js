'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { randomUUID } = require('node:crypto');

const tools = new Set([
  'clock', 'calculator', 'open_app', 'web_search', 'answer', 'desktop_plan', 'power_control', 'precision_action',
  'batch', 'research', 'toolbox', 'helper_jobs', 'reviewed_cleanup', 'mission', 'tutor', 'tool_draft', 'endgame',
  'watch', 'diagnostics',
]);
const releasedTools = new Set(['clock', 'calculator', 'open_app', 'web_search', 'answer', 'research', 'tutor', 'diagnostics', 'helper_jobs', 'mission', 'precision_action', 'power_control', 'desktop_plan', 'batch', 'reviewed_cleanup', 'toolbox', 'watch', 'tool_draft', 'endgame']);
const jobTools = new Set(['helper_jobs', 'mission']);
const requiredProfiles = ['standard', ...[1, 2, 3, 5, 6, 7, 17, 22, 33, 38, 39, 40, 42, 44, 46, 47, 50, 85].map(mark => `mark-${mark}`),
  'house-party', 'friday', 'sentry', 'damage-report'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function loadProfiles(file = path.join(__dirname, 'marks-profiles.json')) {
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(input)) throw new Error('Marks profiles must be an array.');
  const profiles = new Map();
  for (const profile of input) {
    if (!profile || typeof profile.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.id) || profiles.has(profile.id) ||
        ![profile.name, profile.description].every(value => typeof value === 'string' && value.trim()) ||
        !['planned', 'preview', 'verified'].includes(profile.status) ||
        !['default', 'local', 'none'].includes(profile.model) || !['standard', 'strict'].includes(profile.verification) ||
        !['none', 'local'].includes(profile.history) || !['foreground', 'background'].includes(profile.execution) ||
        !Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 1 || profile.timeoutMs > 14400000 ||
        !Array.isArray(profile.tools) || !profile.tools.length || new Set(profile.tools).size !== profile.tools.length ||
        profile.tools.some(tool => !tools.has(tool)) ||
        (profile.status !== 'planned' && profile.tools.some(tool => !releasedTools.has(tool) ||
          jobTools.has(tool) !== (profile.execution === 'background')))) {
      throw new Error('Invalid Marks profile.');
    }
    if (profile.model === 'local' && profile.tools.some(tool =>
      !['clock', 'calculator', 'answer'].includes(tool))) throw new Error('Inconsistent local profile.');
    if (profile.model === 'none' && profile.tools.some(tool => ['answer', 'research', 'tutor'].includes(tool))) {
      throw new Error('A model tool requires a model policy.');
    }
    profiles.set(profile.id, Object.freeze({ ...profile, tools: Object.freeze(profile.tools) }));
  }
  if (requiredProfiles.some(id => !profiles.has(id))) throw new Error('Missing required Marks profiles.');
  const privateProfile = profiles.get('mark-33');
  if (privateProfile.model !== 'local' || privateProfile.history !== 'none' || privateProfile.tools.some(tool =>
    !['clock', 'calculator', 'answer'].includes(tool))) throw new Error('Invalid private profile.');
  return profiles;
}

function localEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Set Marks Ollama to a numeric loopback URL.');
  }
  return url.origin;
}

// Numeric loopback and a direct socket keep private requests outside proxy configuration.
function directRequest(url, options) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.request(url, { method: options.method || 'GET', headers: options.headers,
      signal: options.signal, agent: false }, response => {
      if (response.statusCode !== 200) {
        response.destroy();
        resolve({ ok: false });
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) response.destroy(new Error('Local model response exceeded its limit.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ ok: true, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

function localAnswer({ url, model, maxBytes = Infinity, fetchImpl = directRequest }) {
  return async (messages, signal) => {
    const origin = localEndpoint(url);
    if (!/^[\w.-]+(?::[\w.-]+)?$/.test(model) || /cloud/i.test(model)) throw new Error('Select an installed local model for Marks.');
    async function request(route, body) {
      const response = await fetchImpl(origin + route, {
        redirect: 'error', signal,
        ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error('Local Ollama is unavailable.');
      return response.json();
    }
    const tags = await request('/api/tags');
    const name = model.includes(':') ? model : model + ':latest';
    const installed = tags.models?.find(row => row.name === name);
    if (!installed || installed.size < 1024 * 1024 || installed.size > maxBytes || !Number.isFinite(installed.size) || installed.remote_model || installed.remote_host) {
      throw new Error('The configured model is not installed locally.');
    }
    const details = await request('/api/show', { model: name });
    if (!details.model_info || !details.details?.format || details.remote_model || details.remote_host || details.details.remote_model || details.details.remote_host ||
        /^\s*FROM\s+.*(?:https?:\/\/|:cloud\b)/im.test(details.modelfile || '')) throw new Error('Could not confirm a local model.');
    const result = await request('/api/chat', { model: name, messages, stream: false, options: { num_predict: 1200 } });
    return typeof result.message?.content === 'string' ? result.message.content.trim() : '';
  };
}

function historyStore(file) {
  function load() {
    if (!fs.existsSync(file)) return [];
    const records = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Invalid Marks history.');
    return records;
  }
  return {
    load,
    append(record) {
      const records = [record, ...load()].slice(0, 50);
      const temp = file + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temp, JSON.stringify(records), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, file);
      } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      }
    },
  };
}

function selectTool(profile, text, nlu) {
  if (profile.execution === 'background') return { tool: profile.tools[0] };
  if (profile.tools.includes('diagnostics')) return { tool: 'diagnostics' };
  if (profile.tools.includes('research')) return { tool: 'research' };
  if (profile.tools.includes('tutor')) return { tool: 'tutor' };
  if (profile.tools.includes('precision_action')) return { tool: 'precision_action' };
  if (profile.tools.includes('desktop_plan')) return { tool: 'desktop_plan' };
  if (profile.tools.includes('power_control')) return { tool: 'power_control' };
  if (profile.tools.includes('batch')) return { tool: 'batch' };
  if (profile.tools.includes('reviewed_cleanup')) return { tool: 'reviewed_cleanup' };
  if (profile.tools.includes('toolbox')) return { tool: 'toolbox' };
  if (profile.tools.includes('watch')) return { tool: 'watch' };
  if (profile.tools.includes('tool_draft')) return { tool: 'tool_draft' };
  if (profile.tools.includes('endgame')) return { tool: 'endgame' };
  const parsed = nlu.classify(nlu.normalize(text, 'jarvis'));
  if (['GET_TIME', 'GET_DATE'].includes(parsed?.intent)) return { tool: 'clock', intent: parsed.intent };
  if (parsed?.intent === 'CALCULATE') return { tool: 'calculator' };
  // Require an explicit, standalone command for actions. Never dispatch from an AI reply.
  const app = text.match(/^(?:please\s+)?open\s+([\w .+-]{1,80})[.!]?$/i);
  if (app && parsed?.intent === 'OPEN_APPLICATION' && !/\b(?:and|then)\b/i.test(app[1])) {
    return { tool: 'open_app', args: { app: app[1].trim().toLowerCase() } };
  }
  const search = text.match(/^(?:search(?: the web)? for|google)\s+(.{1,200})$/i);
  if (search) return { tool: 'web_search', args: { query: search[1] } };
  if (parsed?.intent && !['CONVERSATION', 'UNKNOWN', 'GREETING', 'PRESENCE'].includes(parsed.intent)) return { tool: 'unsupported' };
  return { tool: 'answer' };
}

function register(app, { control, registry, adapters, file, mode, profilesFile, createJobs, createPrecision, createBatch, createConnected, createLibrary,
  disablePower, wakeReady = () => false, hasAccess = () => false }) {
  let profiles;
  try { profiles = loadProfiles(profilesFile); }
  catch { console.warn('[Marks] Profile validation failed. The workspace is disabled.'); }
  const preview = mode === 'preview';
  let enabled = !!profiles && (preview || (mode === 'enabled' && [...profiles.values()].every(profile => profile.status === 'verified')));
  const active = new Map();
  const history = historyStore(file);
  const available = profile => !!profile && (profile.status === 'verified' || (preview && profile.status === 'preview'));
  let jobs, precision, batch, connected, library;
  if (enabled && createLibrary) {
    try { library = createLibrary(); }
    catch { console.warn('[Marks] The local library could not initialize.'); }
  }
  if (enabled && createConnected) {
    try { connected = createConnected(); }
    catch { console.warn('[Marks] Connected tools could not initialize.'); }
  }
  if (enabled && createBatch) {
    try { batch = createBatch(); }
    catch { console.warn('[Marks] Batch controls could not initialize.'); }
  }
  if (enabled && createPrecision) {
    try { precision = createPrecision(); }
    catch { console.warn('[Marks] Precision controls could not initialize.'); }
  }
  if (enabled && createJobs) {
    try {
      // Queue timers may already be scheduled if opening the other lane fails.
      jobs = createJobs(id => !!jobs && enabled && available(profiles.get(id)) && profiles.get(id).execution === 'background');
    } catch { console.warn('[Marks] Could not open background checkpoints. Background profiles are unavailable.'); }
  }
  if (enabled && !preview && (!jobs || !precision || !batch || !connected || !library)) enabled = false;
  let voice = null;
  const disarm = () => {
    if (!voice) return;
    const { res, timer } = voice;
    voice = null;
    clearInterval(timer);
    res.end();
  };

  app.use('/api/marks', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (req.get('Sec-Fetch-Site') !== 'same-origin') return res.status(403).json({ error: 'Open Marks from JARVIS on this laptop.' });
    next();
  });
  app.get('/api/marks/profiles', (_req, res) => res.json({ enabled, preview: enabled && preview,
    profiles: enabled ? [...profiles.values()].map(profile => ({ ...profile,
      available: available(profile) && (profile.execution !== 'background' || !!jobs) &&
        (!profile.tools.some(tool => ['precision_action', 'desktop_plan'].includes(tool)) || !!precision) &&
        (!profile.tools.some(tool => ['batch', 'reviewed_cleanup'].includes(tool)) || !!batch) &&
        (!profile.tools.some(tool => ['toolbox', 'watch'].includes(tool)) || !!connected) &&
        (!profile.tools.some(tool => ['tool_draft', 'endgame'].includes(tool)) || !!library) })) : [],
  }));
  app.use('/api/marks', (_req, res, next) => {
    if (!enabled) return res.status(404).json({ error: 'Marks is disabled.' });
    next();
  });
  app.get('/api/marks/voice', (req, res) => {
    const profile = profiles.get('mark-2');
    if (!profile || !available(profile) || !hasAccess(req) || !wakeReady() || control.status().stopped) {
      return res.status(409).json({ error: 'Turn on JARVIS wake word and wait for its Windows listener.' });
    }
    if (voice) return res.status(409).json({ error: 'Voice is armed in another Marks tab.' });
    const expires = Date.now() + 15 * 60 * 1000;
    const timer = setInterval(() => {
      if (!hasAccess(req) || !wakeReady() || Date.now() >= expires) disarm();
      else res.write(': keepalive\n\n');
    }, 5000);
    voice = { req, res, timer, expires };
    res.once('close', () => { if (voice?.res === res) disarm(); });
    res.type('text/event-stream').write('event: armed\ndata: {}\n\n');
  });
  if (enabled) control.onStop(disarm);
  app.get('/api/marks/history', (_req, res) => {
    try { res.json({ records: history.load() }); }
    catch { res.status(503).json({ error: 'Marks history could not be read.' }); }
  });
  app.get('/api/marks/jobs', (_req, res) => res.json({ jobs: jobs?.list() || [] }));
  app.get('/api/marks/jobs/:id', (req, res) => {
    const job = jobs?.get(req.params.id);
    res.status(job ? 200 : 404).json(job || { error: 'Task not found.' });
  });
  app.post('/api/marks/jobs/start', (req, res) => {
    if (!jobs) return res.status(503).json({ error: 'Marks background work is unavailable.' });
    try {
      const result = jobs.start(req.body?.id, req.body?.token);
      res.status(202).json(result);
    } catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post('/api/marks/jobs/:id/cancel', (req, res) => {
    try { res.json({ cancelled: !!jobs?.cancel(req.params.id) }); }
    catch { res.status(503).json({ error: 'Could not update the task checkpoint.' }); }
  });
  app.post('/api/marks/jobs/:id/phone', (req, res) => {
    const report = req.body?.report;
    if (typeof report !== 'string' || report.length > 8000) return res.status(400).json({ error: 'Review up to 8,000 characters to share.' });
    try {
      if (!jobs?.shareReport(req.params.id, report.trim())) return res.status(409).json({ error: 'Only a completed Marks task can be shared.' });
      res.json({ shared: !!report.trim() });
    } catch { res.status(503).json({ error: 'Could not update the task checkpoint.' }); }
  });
  app.post('/api/marks/precision/approve', async (req, res) => {
    if (!precision) return res.status(404).json({ error: 'Desktop control is unavailable.' });
    try { res.json({ result: await precision.approve(req.body?.id, req.body?.token) }); }
    catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post('/api/marks/desktop/start', async (req, res) => {
    if (!precision || !available(profiles.get('mark-3'))) return res.status(404).json({ error: 'Desktop planning is unavailable.' });
    try { res.json({ result: await precision.startPlan(req.body?.id, req.body?.token) }); }
    catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post('/api/marks/batch/approve', async (req, res) => {
    if (!batch) return res.status(404).json({ error: 'Batch work is unavailable.' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const result = await batch.apply(req.body?.id, req.body?.token, controller.signal);
      if (!res.destroyed) res.json({ result });
    } catch (error) { if (!res.destroyed) res.status(409).json({ error: error.message }); }
  });
  app.get('/api/marks/accounts', (_req, res) => res.json({ providers: connected?.accounts.status() || [] }));
  app.post('/api/marks/accounts/connect', (req, res) => {
    if (!connected) return res.status(404).json({ error: 'Connected accounts are unavailable.' });
    try {
      const result = connected.accounts.begin(req.body?.provider);
      res.cookie('jarvis_marks_oauth', result.browser, { httpOnly: true, sameSite: 'lax', path: '/api/marks/accounts', maxAge: 300000 });
      res.json({ url: result.url });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/marks/accounts/callback', async (req, res) => {
    const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/api/marks/accounts' };
    const cookie = /(?:^|;\s*)jarvis_marks_oauth=([\w-]+)(?:;|$)/.exec(req.get('cookie') || '')?.[1];
    res.clearCookie('jarvis_marks_oauth', cookieOptions);
    let operation;
    try {
      if (!connected || !cookie || !hasAccess(req)) throw new Error('Unavailable');
      operation = control.operation();
      await connected.accounts.finish({ state: req.body?.state, code: req.body?.code, cookie, signal: operation.signal });
      if (!enabled) connected.accounts.clear();
      res.json({ connected: enabled });
    } catch { res.status(400).json({ error: 'Authorization did not complete.' }); }
    finally { operation?.release(); }
  });
  app.post('/api/marks/accounts/disconnect', (req, res) => {
    connected?.accounts.disconnect(req.body?.provider);
    res.json({ disconnected: true });
  });
  app.post('/api/marks/toolbox/approve', async (req, res) => {
    if (!connected) return res.status(404).json({ error: 'The toolbox is unavailable.' });
    try { res.json({ result: await connected.toolbox.approve(req.body?.id, req.body?.token) }); }
    catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post('/api/marks/library/approve', async (req, res) => {
    if (!library) return res.status(404).json({ error: 'The Marks library is unavailable.' });
    try { res.json({ result: await library.approve(req.body?.id, req.body?.token) }); }
    catch (error) { res.status(409).json({ error: error.message }); }
  });
  app.post('/api/marks/disable', (_req, res) => {
    enabled = false;
    disablePower?.();
    disarm();
    for (const controller of active.values()) controller.abort();
    precision?.clear();
    batch?.clear();
    connected?.accounts.clear();
    connected?.sentry.clear();
    connected?.toolbox.clear();
    library?.clear();
    jobs?.disable();
    res.json({ enabled });
  });
  app.post('/api/marks/cancel', (req, res) => {
    const controller = active.get(req.body?.id);
    controller?.abort();
    res.json({ cancelled: !!controller });
  });
  app.post('/api/marks/run', async (req, res) => {
    const { id, profileId, text, context } = req.body || {};
    let profile = profiles.get(profileId);
    if (!profile || !available(profile)) return res.status(400).json({ error: 'Select an available Mark.' });
    let prompt = typeof text === 'string' ? text.trim() : '';
    if (profile.id === 'mark-85') {
      const select = /^use ([a-z0-9-]+)\s+(.+)$/is.exec(prompt);
      if (select) {
        const delegated = profiles.get(select[1].toLowerCase());
        if (!delegated || ['mark-85', 'mark-33'].includes(delegated.id) || !available(delegated)) return res.status(400).json({ error: 'Choose an available profile ID. Open Mark 33 directly for a private session.' });
        profile = delegated;
        prompt = select[2];
      }
    }
    if (typeof id !== 'string' || !uuid.test(id) || !prompt || prompt.length > 4000 ||
        (context !== undefined && (profile.id !== 'mark-33' || !Array.isArray(context) || context.length > 8 ||
          context.some(message => !message || !['user', 'assistant'].includes(message.role) ||
            typeof message.content !== 'string' || message.content.length > 4000)))) {
      return res.status(400).json({ error: 'Enter a command of up to 4,000 characters.' });
    }
    if (active.has(id) || active.size >= 4 || (profile.history === 'local' && active.size >= 3)) {
      return res.status(409).json({ error: 'Marks is busy. Wait for a request to finish or cancel it.' });
    }
    let operation;
    try { operation = control.operation(); }
    catch { return res.status(409).json({ error: 'Emergency stop is active.' }); }
    const controller = new AbortController();
    active.set(id, controller);
    const signal = AbortSignal.any([controller.signal, operation.signal, AbortSignal.timeout(profile.timeoutMs)]);
    res.once('close', () => controller.abort());
    try {
      const { tool, args, intent } = selectTool(profile, prompt, adapters.nlu);
      if (!profile.tools.includes(tool)) return res.status(400).json({ error: profile.id === 'mark-22'
        ? 'Hotrod supports time, date, and arithmetic.' : 'This command is outside the selected Mark’s tools.' });
      let input = { text: prompt, intent, profile, signal, context: context || [] };
      if (args) {
        const checked = registry.validateStep({ tool, args }, 0);
        if (!checked.ok || checked.step.tier !== 'safe' || checked.step.serverApproval) {
          return res.status(400).json({ error: 'This action did not pass JARVIS tool validation.' });
        }
        input = { ...input, ...checked.step.args };
      }
      operation.check();
      signal.throwIfAborted();
      let result;
      if (jobTools.has(tool)) {
        if (!jobs) return res.status(503).json({ error: 'Marks background work is unavailable.' });
        try { result = { text: 'Review this plan before starting background work.', review: { kind: 'jobs', ...await jobs.prepare(profile, prompt, signal) } }; }
        catch (error) { if (signal.aborted) throw error; return res.status(400).json({ error: error.message }); }
      } else if (tool === 'precision_action' || tool === 'desktop_plan') {
        if (!precision) return res.status(503).json({ error: 'Precision mode is unavailable.' });
        try { result = await (tool === 'desktop_plan' ? precision.preparePlan(input) : precision.prepare(input)); }
        catch (error) { if (signal.aborted) throw error; return res.status(409).json({ error: error.message }); }
      } else if (tool === 'batch' || tool === 'reviewed_cleanup') {
        if (!batch) return res.status(503).json({ error: 'Batch work is unavailable.' });
        try { result = await batch.prepare(input); }
        catch (error) { if (signal.aborted) throw error; return res.status(409).json({ error: error.message }); }
      } else if (['toolbox', 'watch'].includes(tool)) {
        if (!connected) return res.status(503).json({ error: 'Connected tools are unavailable.' });
        try { result = tool === 'toolbox' ? connected.toolbox.prepare(input) : connected.sentry.command(input); }
        catch (error) { return res.status(400).json({ error: error.message }); }
      } else if (['tool_draft', 'endgame'].includes(tool)) {
        if (!library) return res.status(503).json({ error: 'The Marks library is unavailable.' });
        try { result = await (tool === 'tool_draft' ? library.toolCommand(input) : library.memoryCommand(input)); }
        catch (error) { if (signal.aborted) throw error; return res.status(400).json({ error: error.message }); }
      } else result = await adapters[tool](input);
      signal.throwIfAborted();
      operation.check();
      let historySaved = false;
      if (profile.history === 'local' && !result.review && !result.ephemeral) {
        try {
          history.append({ id, profileId: profile.id, at: Date.now(), text: prompt, result });
          historySaved = true;
        } catch { /* Return the actual action outcome even when history storage fails. */ }
      }
      res.json({ result, historySaved, historyExpected: profile.history === 'local' && !result.review && !result.ephemeral });
    } catch {
      if (!res.destroyed) res.status(signal.aborted ? 409 : 502).json({ error: signal.aborted ? 'The request expired or was cancelled.' :
        profile.model === 'local' ? 'The local model could not answer. Check the Marks Ollama endpoint and the model configured for this profile.' : 'The Marks tool could not complete the request.' });
    } finally {
      active.delete(id);
      operation.release();
    }
  });
  return {
    enabled: () => enabled,
    phoneStatus: () => enabled && jobs ? { available: true, tasks: jobs.list().slice(0, 20).map(({ id, status, updated, phoneShared }) =>
      ({ id, status, updated, shared: phoneShared === true })) } : { available: false, tasks: [] },
    phoneReport(id) {
      if (!enabled || !uuid.test(id)) return null;
      const job = jobs?.get(id);
      if (!job?.phoneShared) return null;
      return { id, status: job.status, title: 'Shared Marks report', report: job.phoneShared };
    },
    routeWake(event) {
      if (!enabled || !voice) return false;
      if (!hasAccess(voice.req) || !wakeReady() || Date.now() >= voice.expires) { disarm(); return false; }
      const text = typeof event.cmd === 'string' ? event.cmd.slice(0, 4000) : '';
      voice.res.write(`event: wake\ndata: ${JSON.stringify({ text })}\n\n`);
      return true;
    },
  };
}

module.exports = { register, loadProfiles, localAnswer, localEndpoint, selectTool };
