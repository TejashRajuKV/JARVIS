// End-to-end browser scenario tests for:
// 1. Two real browser tabs open at once (routine claim race & state sync).
// 2. Server restart mid-task (task marked INTERRUPTED and surfaced to user).
// 3. Page reload, then ROLLBACK (server-backed undolog restores task run ID after reload).
// Run: node tests/browser-scenarios.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { startServer, suite } = require('./lib/server');
const { check, done } = suite('browser-scenarios');

const BROWSERS = [
  process.env.JARVIS_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function killBrowser(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { require('child_process').execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
  try { child.kill('SIGKILL'); } catch {}
}

function killLeftoverTestBrowsers(profile) {
  if (process.platform !== 'win32') return;
  const match = profile ? path.basename(profile) : 'jarvis-scenarios-';
  try {
    require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | Where-Object { $_.CommandLine -match '" + match + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { stdio: 'ignore', timeout: 20000 });
  } catch {}
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools connection failed')); });
  let id = 0; const waiting = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { send, evaluate, close: () => ws.close() };
}

(async () => {
  const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!exe) {
    console.log('browser-scenarios: skipped — no Edge or Chrome found');
    process.exit(0);
  }
  if (typeof WebSocket === 'undefined') {
    console.log('browser-scenarios: skipped — needs Node 22+');
    process.exit(0);
  }

  killLeftoverTestBrowsers();
  const S = await startServer({ env: { JARVIS_MARKS: 'preview' } });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-scenarios-'));
  let browser = null, tab1 = null, tab2 = null;

  try {
    // 0. Seed basic setup
    await S.post('/api/state', { set: { 'jarvis.settings': { tts: false, sound: false, setupDone: true, online: false, wakeWord: 'jarvis' }, 'jarvis.migrated': true } });

    // Spawn browser in headless mode with remote debugging port
    browser = spawn(exe, [
      '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
      '--disable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank'
    ], { stdio: 'ignore', windowsHide: true });

    let portFile = path.join(profile, 'DevToolsActivePort'), port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      try { port = +fs.readFileSync(portFile, 'utf8').split('\n')[0]; } catch {}
    }
    if (!port) throw new Error('browser did not open DevTools port');

    // Attach to Tab 1
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    tab1 = await cdp(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await tab1.send('Page.navigate', { url: S.base + '/?skipboot' });

    let ready1 = false;
    for (let i = 0; i < 200 && !ready1; i++) {
      await sleep(100);
      ready1 = await tab1.evaluate("typeof handleUser === 'function' && typeof claimAlert === 'function'").catch(() => false);
    }
    check('Tab 1', 'first tab loaded successfully', ready1);
    const marksCommand = await tab1.evaluate(`(async () => {
      const opened = [];
      const originalOpen = window.open;
      window.open = url => opened.push(url);
      try {
        await handleUser('enable mark 1', 'text');
        await handleUser('open mark controls', 'text');
        await handleUser('enable mark 999', 'text');
        const unavailable = () => document.body.textContent.includes('Mark 999 is unavailable');
        for (let i = 0; i < 100 && !unavailable(); i++) await new Promise(resolve => setTimeout(resolve, 50));
        return { opened, unavailable: unavailable(),
          fallback: [...document.querySelectorAll('.confirmRow button')].some(button => button.textContent === 'Open Mark 1 · Basic') };
      } finally { window.open = originalOpen; }
    })()`, true);
    check('Marks chat', 'chat opens the workspace and selects a known profile, with a clickable fallback',
      JSON.stringify(marksCommand.opened) === JSON.stringify(['/marks.html?profile=mark-1', '/marks.html']) &&
      marksCommand.unavailable && marksCommand.fallback, marksCommand);
    const ollamaAnswer = await tab1.evaluate(`(async () => {
      const originalFetch = window.fetch;
      let healthReads = 0, modelCalls = 0;
      window.fetch = (url, options) => {
        if (String(url) === '/api/ai/health') {
          healthReads++;
          return Promise.resolve(Response.json({ ollama: { reachable: true, installedKnown: true, loadedKnown: healthReads === 2,
            models: ['fixture-a:latest', 'fixture-b:latest'], loaded: healthReads === 2 ? [{ name: 'fixture-a:latest' }] : [] } }));
        }
        if (/\\/api\\/(?:chat|nlu\\/parse)$/.test(String(url))) modelCalls++;
        return originalFetch(url, options);
      };
      try {
        await handleUser('how many ollama models are there in laptop', 'text');
        await handleUser('which ones are running?', 'text');
        await handleUser('which ones are running?', 'text');
        const unknown = () => document.body.textContent.includes('couldn’t verify the Ollama models loaded');
        for (let i = 0; i < 120 && !unknown(); i++) await new Promise(resolve => setTimeout(resolve, 50));
        const text = document.body.textContent;
        return { healthReads, modelCalls, installed: text.includes('2 Ollama models installed on this laptop'),
          loaded: text.includes('1 Ollama model loaded in memory right now'), unknown: unknown() };
      } finally { window.fetch = originalFetch; }
    })()`, true);
    check('Local facts', 'Ollama count and contextual follow-ups use live data and distinguish an unavailable result',
      ollamaAnswer.healthReads === 3 && ollamaAnswer.modelCalls === 0 && ollamaAnswer.installed && ollamaAnswer.loaded && ollamaAnswer.unknown, ollamaAnswer);
    const marksTarget = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(S.base + '/marks.html'), { method: 'PUT' })).json();
    const marksTab = await cdp(marksTarget.webSocketDebuggerUrl);
    try {
      let marksReady = false;
      for (let i = 0; i < 100 && !marksReady; i++) {
        await sleep(30);
        marksReady = await marksTab.evaluate("document.querySelector('#profile')?.value === 'standard'").catch(() => false);
      }
      const ready = await marksTab.evaluate(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 30));
        for (let i = 0; i < 100 && !document.querySelector('#profile')?.value; i++) await pause();
        const profile = document.querySelector('#profile');
        if (profile?.value !== 'standard') return false;
        profile.value = 'mark-22';
        profile.dispatchEvent(new Event('change'));
        document.querySelector('#prompt').value = 'calculate 7 * 6';
        document.querySelector('#command').requestSubmit();
        for (let i = 0; i < 100 && !document.querySelector('#results article'); i++) await pause();
        return document.querySelector('#results').textContent.includes('= 42') && document.querySelector('#preview').hidden === false;
      })()`, true);
      check('Marks UI', 'the separate workspace loads Standard and runs a Hotrod command', marksReady && ready);
      await marksTab.send('Page.reload');
      let standard = false;
      for (let i = 0; i < 100 && !standard; i++) {
        await sleep(30);
        standard = await marksTab.evaluate("document.querySelector('#profile')?.value === 'standard'").catch(() => false);
      }
      check('Marks UI', 'reload returns to Standard', standard);
      check('Marks UI', 'Marks arithmetic does not reach normal chat', !(await S.get('/api/state.js')).text.includes('calculate 7 * 6'));
      await marksTab.send('Page.navigate', { url: S.base + marksCommand.opened[0] });
      let selectedMark = false;
      for (let i = 0; i < 100 && !selectedMark; i++) {
        await sleep(30);
        selectedMark = await marksTab.evaluate("document.querySelector('#profile')?.value === 'mark-1' && !location.search").catch(() => false);
      }
      check('Marks UI', 'the chat link preselects Mark 1 and consumes the profile parameter', selectedMark);
    } finally {
      marksTab.close();
      await fetch('http://127.0.0.1:' + port + '/json/close/' + marksTarget.id);
    }
    const integrations=await tab1.evaluate(`({accounts:typeof window.AccountPage?.command==='function',
      office:typeof document.querySelector('#officeExportForm')?.onsubmit==='function',
      browser:typeof document.querySelector('#managedBrowserOpen')?.onsubmit==='function',
      execution:typeof document.querySelector('#executionForm')?.onsubmit==='function',
      understanding:typeof Understanding?.understand==='function'})`);
    check('Workflow UI','new panels attach their handlers without script errors',Object.values(integrations).every(Boolean),integrations);

    // Open Tab 2 as a real second browser tab
    const newTabTarget = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(S.base + '/?skipboot'), { method: 'PUT' })).json();
    tab2 = await cdp(newTabTarget.webSocketDebuggerUrl);

    let ready2 = false;
    for (let i = 0; i < 200 && !ready2; i++) {
      await sleep(100);
      ready2 = await tab2.evaluate("typeof handleUser === 'function' && typeof claimAlert === 'function'").catch(() => false);
    }
    check('Tab 2', 'second tab loaded successfully', ready2);

    // Drive the new background command through the page and real isolated queue.
    // Only the planner is faked; execution, persistence and result rendering are real.
    fs.writeFileSync(path.join(S.sandbox, 'runtime-browser-fixture.md'), 'Browser background fixture.');
    const runtimeCheck = await tab2.evaluate(`(async () => {
      const original = callTool;
      let plannerCalls = 0;
      try {
        callTool = async (url, body) => { if(url === '/agent/plan') { plannerCalls++; return {ok:true,plan:{goal:'Read browser fixture',steps:[{id:'step_1',tool:'read_file',tier:'safe',args:{name:'runtime-browser-fixture.md'}}]}}; } return original(url,body); };
        const before = await getJSON('/agent/jobs');
        const result = await AgentRuntimePage.command('in background read runtime-browser-fixture.md');
        const previewOnly = !!result.confirm && (await getJSON('/agent/jobs')).jobs.length === before.jobs.length;
        await result.confirm.onConfirm();
        await result.confirm.onConfirm();
        let jobs;
        for(let i=0;i<50;i++) {
          jobs = await getJSON('/agent/jobs');
          if(jobs.jobs.some(j=>j.goal==='Read browser fixture' && j.status==='completed')) break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        await AgentRuntimePage.command('show background tasks');
        const rendered = document.querySelector('#jobList').textContent.includes('Read browser fixture');
        await AgentRuntimePage.command('show MCP tools');
        const direct = await AgentRuntimePage.command('in background list my tasks');
        return {previewOnly,completed:jobs.jobs.some(j=>j.status==='completed'),once:jobs.jobs.length===before.jobs.length+1,direct:!!direct.confirm && plannerCalls===1,rendered,mcp:document.querySelector('#mcpConnectForm')!==null && document.querySelector('#runtimeTools').open};
      } finally {callTool=original;}
    })()`, true);
    check('Background UI', 'the page previews the task before queueing it', runtimeCheck?.previewOnly, runtimeCheck);
    check('Background UI', 'the real queue finishes and the page renders its result', runtimeCheck?.completed && runtimeCheck?.rendered, runtimeCheck);
    check('Background UI', 'duplicate confirmation cannot queue twice and simple tasks need no planner', runtimeCheck?.once && runtimeCheck?.direct, runtimeCheck);
    check('MCP UI', 'the command opens the opt-in connection form', runtimeCheck?.mcp, runtimeCheck);

    const emergency = await tab2.evaluate(`(async () => {
      const oldBusy = busy; let rejected = false;
      busy = true; pendingApproval = ok => { rejected = !ok; };
      try {
        await handleUser('please emergency stop','text');
        const stopped = await getJSON('/safety/status');
        const timerCount=timers.length;
        await handleUser('set a timer for 10 minutes','text');
        const localBlocked=timers.length===timerCount;
        const blocked = await fetch(API+'/agent/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:{steps:[{tool:'list_todos',args:{}}]}})});
        await handleUser('resume','text');
        const state=await getJSON('/safety/status');
        const staleIgnored=applySafetyState({stopped:true,epoch:state.epoch-1})===false && !store.get('jarvis.emergencyStopped',false);
        return {stopped:stopped.stopped,rejected,localBlocked,staleIgnored,blocked:blocked.status,resumed:!state.stopped,hotkey:!!document.querySelector('#emergencyHotkey')};
      } finally {busy=oldBusy;pendingApproval=null;}
    })()`, true);
    check('Emergency UI', 'stop bypasses busy work and rejects a pending approval', emergency?.stopped && emergency?.rejected, emergency);
    check('Emergency UI', 'server blocks dispatch until an explicit resume', emergency?.blocked===409 && emergency?.resumed, emergency);
    check('Emergency UI', 'local commands cannot bypass the stopped server', emergency?.localBlocked, emergency);
    check('Emergency UI', 'a delayed stop event cannot undo a newer resume', emergency?.staleIgnored, emergency);
    check('Emergency UI', 'the opt-in global stop shortcut has a visible setting', emergency?.hotkey, emergency);

    /* ---------------- Scenario 1: Two Tabs & Scheduled Routine Claim Race ---------------- */
    const routineKey = 'routine:morning:' + Date.now();
    const claim1 = await tab1.evaluate(`claimAlert('${routineKey}', 60)`, true);
    const claim2 = await tab2.evaluate(`claimAlert('${routineKey}', 60)`, true);
    check('Two Tabs', 'Tab 1 claims routine and wins', claim1 === true);
    check('Two Tabs', 'Tab 2 claims same routine and loses (does not run twice)', claim2 === false);

    // State sync: Tab 1 writes state -> server broadcast -> Tab 2 picks up
    await tab1.send('Page.bringToFront');
    await tab1.evaluate(`(async () => {
      todos = [{ id: 'td-1', text: 'buy milk', done: false }];
      store.set('jarvis.todos', todos);
    })()`, true);
    await tab2.send('Page.bringToFront');

    let tab2Todos = '[]';
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      tab2Todos = await tab2.evaluate(`JSON.stringify(store.get('jarvis.todos') || [])`);
      if (tab2Todos.includes('buy milk')) break;
    }
    check('Two Tabs', 'state updated in Tab 1 syncs to Tab 2 via SSE', tab2Todos.includes('buy milk'), tab2Todos);

    // Today and History use shared server state rendered in a real second tab.
    const today = await tab2.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="today"]').click();
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('#todaySystem')?.textContent.includes('MEMORY')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { agenda: document.querySelector('#todayAgenda').textContent, system: document.querySelector('#todaySystem').textContent, automatic: document.querySelector('#dailyBriefingToggle').checked };
    })()`, true);
    check('Today', 'shows the shared task and live laptop telemetry while automatic briefing remains opt-in', /buy milk/.test(today?.agenda) && /CPU.*MEMORY/.test(today?.system) && today.automatic === false, today);
    await tab1.evaluate(`(async () => {
      const id = ActionReceipts.begin('QA verified fixture', 'QA', '', {repeatable:false});
      ActionReceipts.update(id, {status:'verified', note:'state observed'});
    })()`, true);
    await tab2.evaluate(`document.querySelector('.tab[data-tab="history"]').click()`);
    let history;
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      history = await tab2.evaluate(`document.querySelector('#historyList').textContent`);
      if (history.includes('state observed')) break;
    }
    check('History', 'a receipt written in one tab renders in the second with its status and no repeat button', /VERIFIED.*QA verified fixture.*state observed/.test(history) && !/REPEAT|RETRY/.test(history), history);
    const brief = await tab2.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="today"]').click();
      document.querySelector('#briefingBtn').click();
      for (let i = 0; i < 40; i++) {
        const t = document.querySelector('#messages').textContent;
        if (t.includes('Your top items today: buy milk')) return t.slice(-350);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return '';
    })()`, true);
    check('Today', 'BRIEF ME generates a real chat reply using the shared task with Online tools off', /Your top items today: buy milk/.test(brief) && !/Weather for |Calendar:/.test(brief), brief);

    const dailyFeatures = await tab2.evaluate(`(async () => {
      await handleUser('Remember that the DBMS demo moved to Friday.', 'text');
      await handleUser('Search my voice notes for DBMS Friday', 'text');
      const note = document.querySelector('[data-pane="notes"]').classList.contains('active') &&
        /DBMS demo moved to Friday/.test(document.querySelector('#voiceNoteList').textContent);
      document.querySelector('#savedWorkspaceName').value = 'DBMS';
      document.querySelector('#savedWorkspaceLinks').value = 'https://example.invalid/class';
      document.querySelector('#savedWorkspaceForm').requestSubmit();
      const links = [];
      const originalFetch = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).endsWith('/tool/openUrl')) {
          links.push(JSON.parse(opts.body).url);
          return Promise.resolve(Response.json({ success: true }));
        }
        return originalFetch(url, opts);
      };
      try { await handleUser('Resume my DBMS workspace', 'text'); }
      finally { window.fetch = originalFetch; }
      await handleUser('Start a 45-minute study session with rain sounds.', 'text');
      const focusWithAudio = focus?.min === 45 && focus.sound === 'rain' && !document.querySelector('#focusAudioControl').hidden;
      if (focusWithAudio) focusTick(focus.end);
      const stoppedAtBreak = focus?.phase === 'break' && !focusAudio.playing() && document.querySelector('#focusAudioControl').hidden;
      stopFocus(true);
      return { note, links, focusWithAudio, stoppedAtBreak };
    })()`, true);
    check('Voice notes', 'the normal remember command saves into the searchable inbox', dailyFeatures?.note === true, dailyFeatures);
    check('Saved workspace', 'the workspace form and named command open only the saved URL', dailyFeatures?.links.join() === 'https://example.invalid/class', dailyFeatures);
    check('Focus audio', 'a normal study command sets the sound and the timer stops it at break', dailyFeatures?.focusWithAudio && dailyFeatures?.stoppedAtBreak, dailyFeatures);

    const captureAndCorrection = await tab2.evaluate(`(async () => {
      await handleUser('Jarvis, pause DBMS here. Next, test the joins.', 'text');
      const checkpoint = savedWorkspaces.list().find(entry => entry.name === 'DBMS')?.checkpoint?.next;
      await handleUser('Show what I captured today.', 'text');
      await handleUser('Make a task from the first one.', 'text');
      let review;
      for (let i = 0; i < 50 && !review; i++) {
        review = [...document.querySelectorAll('.confirmRow .danger')].find(button => button.textContent === 'Create task');
        if (!review) await new Promise(resolve => setTimeout(resolve, 100));
      }
      const before = !(store.get('jarvis.todos', []).some(row => row.inboxSource));
      review?.click();
      for (let i = 0; i < 30 && !store.get('jarvis.todos', []).some(row => row.inboxSource); i++) await new Promise(resolve => setTimeout(resolve, 100));
      const after = store.get('jarvis.todos', []).some(row => row.inboxSource && row.text.includes('DBMS demo moved to Friday'));
      const sent = [];
      let oldCancelled = false;
      AssistantPage.trackApproval('Open my OS notes', () => { oldCancelled = true; }, () => !oldCancelled);
      AssistantPage.prepareVoice('Wait, I meant DBMS', 'voice', (...args) => sent.push(args));
      await new Promise(resolve => setTimeout(resolve, 50));
      AssistantPage.prepareVoice('Wait, I meant Math', 'voice', (...args) => sent.push(args));
      return { checkpoint, before, after, oldCancelled, sent, reviewed: !!review,
        status: document.querySelector('#voiceNoteStatus').textContent,
        detail: after ? '' : document.querySelector('#messages').textContent.slice(-500) };
    })()`, true);
    check('Checkpoint and inbox', 'a checkpoint saves the handoff and a conversion waits for review',
      captureAndCorrection?.checkpoint === 'test the joins.' && captureAndCorrection?.before && captureAndCorrection.after, captureAndCorrection);
    check('Voice correction', 'cancels the pending action, submits the corrected target once and ignores expired approvals',
      captureAndCorrection?.oldCancelled && captureAndCorrection?.sent.length === 1 &&
      captureAndCorrection.sent[0].join('|') === 'Open DBMS notes|voice|true', captureAndCorrection);

    const media = await tab2.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="media"]').click();
      const samples = 16000 * 6, bytes = new ArrayBuffer(44 + samples);
      const v = new DataView(bytes);
      const write = (index, value) => { for (const letter of value) v.setUint8(index++, letter.charCodeAt(0)); };
      write(0, 'RIFF'); v.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); write(36, 'data'); v.setUint32(40, samples, true);
      const picker = document.querySelector('#mediaFiles'), selection = new DataTransfer();
      window.__immersiveWav = new File([bytes], 'JARVIS test.wav', {type:'audio/wav'});
      selection.items.add(window.__immersiveWav);
      picker.files = selection.files; picker.dispatchEvent(new Event('change'));
      const audio = document.querySelector('#mediaAudio');
      for (let i = 0; i < 30 && !Number.isFinite(audio.duration); i++) await new Promise(resolve => setTimeout(resolve, 100));
      const loaded = audio.duration === 6 && audio.currentSrc.startsWith('blob:') && document.querySelector('#mediaNow').textContent === 'JARVIS test.wav';
      const compact = !document.querySelector('#compactMedia').hidden;
      await audio.play();
      const toggle = document.querySelector('#immersiveToggle');
      toggle.click();
      const docked = document.querySelector('#immersivePlayerDock').contains(document.querySelector('#compactMedia'));
      await new Promise(resolve => setTimeout(resolve, 150));
      const position = audio.currentTime;
      toggle.click();
      const playbackContinued = position > 0 && audio.currentTime >= position && !audio.paused &&
        document.querySelector('#mediaAudio') === audio && document.querySelector('.stage').contains(document.querySelector('#compactMedia'));
      document.querySelector('#mediaClear').click();
      return { loaded, compact, docked, playbackContinued, cleared: document.querySelector('#compactMedia').hidden };
    })()`, true);
    check('Media', 'a local WAV loads in the shared compact player and clearing the queue releases it',
      media?.loaded && media.compact && media.cleared, media);
    check('Immersive media', 'the compact player moves without resetting the audio element or playback',
      media?.docked && media.playbackContinued, media);

    await tab2.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    const immersive = await tab2.evaluate(`(async () => {
      const toggle = document.querySelector('#immersiveToggle'), panel = document.querySelector('#immersivePanel');
      const notes = document.querySelector('[data-pane="notes"]'), tasks = document.querySelector('[data-pane="tasks"]');
      document.querySelector('.tab[data-tab="chat"]').click();
      const normalParent = notes.parentElement, normalTab = document.querySelector('.tab.active');
      toggle.click();
      const emptyAtRest = panel.hidden && toggle.getAttribute('aria-pressed') === 'true';
      const input = document.querySelector('#chatInput');
      input.focus();
      await handleUser('Show my notes', 'voice');
      const opened = panel.contains(notes) && document.activeElement === input && getComputedStyle(notes).display === 'flex';
      await handleUser('Show my tasks', 'text');
      const replaced = panel.contains(tasks) && notes.parentElement === normalParent && panel.querySelectorAll('.tabpane').length === 1;
      const edge = panel.getBoundingClientRect().left >= document.querySelector('.stage').getBoundingClientRect().right - 1;
      JarvisCode.open(true);
      const answered = new Promise(resolve => jarvisSay({ text: 'Confirm test action', noTTS: true,
        confirm: { yes:'Test approval', no:'Cancel', onConfirm: () => resolve(true) } }));
      let approval;
      for (let i = 0; i < 50 && !approval; i++) {
        approval = [...document.querySelectorAll('#messages .confirmRow button')].find(button => button.textContent === 'Test approval');
        if (!approval) await new Promise(resolve => setTimeout(resolve, 100));
      }
      const visible = !!approval?.getClientRects().length && !panel.hidden && !JarvisCode.state.on;
      approval?.click();
      const approved = await Promise.race([answered, new Promise(resolve => setTimeout(() => resolve(false), 500))]);
      await handleUser('Close panel', 'voice');
      const closedByVoice = panel.hidden && document.activeElement === input;
      await handleUser('Show my workspaces', 'text');
      const activeReply = new AbortController();
      llmAbort = activeReply;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      llmAbort = null;
      const closedByEscape = panel.hidden && document.activeElement === input && !activeReply.signal.aborted;
      await handleUser('Show my media', 'text');
      toggle.click();
      return { emptyAtRest, opened, replaced, edge, visible, approved, closedByVoice, closedByEscape,
        restored: panel.hidden && notes.parentElement === normalParent && tasks.parentElement === normalParent && normalTab.classList.contains('active') };
    })()`, true);
    check('Immersive panels', 'one live view opens by voice or text and replaces its predecessor without shifting focus',
      immersive?.emptyAtRest && immersive.opened && immersive.replaced && immersive.edge, immersive);
    check('Immersive approvals', 'chat approvals remain reachable while a panel is open', immersive?.visible && immersive.approved, immersive);
    check('Immersive navigation', 'voice and Escape close the panel and returning to the dashboard restores tab placement',
      immersive?.closedByVoice && immersive.closedByEscape && immersive.restored, immersive);

    await tab2.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 690, deviceScaleFactor: 1, mobile: false });
    await tab2.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const calendar = await tab2.evaluate(`(async () => {
      const toggle = document.querySelector('#immersiveToggle'), panel = document.querySelector('#immersivePanel');
      const calendar = document.querySelector('#todayCalendar');
      const originalFetch = window.fetch;
      let respond, mode = 'loading';
      window.fetch = (url, options) => {
        if (String(url).endsWith('/api/calendar/status')) {
          if (mode === 'loading') return new Promise(resolve => { respond = resolve; });
          return Promise.resolve(Response.json({ configured: true }));
        }
        if (String(url).endsWith('/api/calendar/events')) return Promise.resolve(mode === 'error'
          ? Response.json({ error: 'Calendar fixture unavailable.' }, { status: 502 })
          : Response.json({ events: mode === 'empty' ? [] : [{ title: 'DBMS lab', start: Date.now() + 3600000 }] }));
        return originalFetch(url, options);
      };
      toggle.click();
      try {
        await handleUser('Show my media', 'text');
        const picker = document.querySelector('#mediaFiles'), selection = new DataTransfer();
        selection.items.add(window.__immersiveWav);
        picker.files = selection.files; picker.dispatchEvent(new Event('change'));
        await handleUser('Show my calendar', 'text');
        const loading = panel.contains(calendar) && calendar.textContent === 'Loading calendar…' && !!respond;
        const mic = document.querySelector('#micBtn').getBoundingClientRect(), rect = panel.getBoundingClientRect();
        const player = document.querySelector('#compactMedia').getBoundingClientRect();
        const smallLayout = rect.right <= innerWidth && player.height > 0 && rect.bottom <= player.top &&
          player.bottom <= mic.top && mic.bottom <= innerHeight &&
          getComputedStyle(panel).animationName === 'none' && getComputedStyle(document.querySelector('#immersivePanelContent')).overflowY === 'auto';
        respond?.(Response.json({ configured: false }));
        await new Promise(resolve => setTimeout(resolve, 50));
        const disconnected = calendar.textContent.includes('Connect one in Settings');
        const samples = {};
        for (mode of ['empty', 'error', 'events']) {
          document.querySelector('#immersivePanelClose').click();
          await handleUser('Show my calendar', 'text');
          for (let i = 0; i < 20 && calendar.textContent.includes('Loading calendar'); i++) await new Promise(resolve => setTimeout(resolve, 50));
          samples[mode] = calendar.textContent;
        }
        return { loading, smallLayout, disconnected, samples };
      } finally {
        document.querySelector('#mediaClear').click();
        delete window.__immersiveWav;
        toggle.click();
        window.fetch = originalFetch;
      }
    })()`, true);
    await tab2.send('Emulation.clearDeviceMetricsOverride');
    await tab2.send('Emulation.setEmulatedMedia', { features: [] });
    check('Immersive calendar', 'renders loading, disconnected, empty, error and event results using the real calendar view',
      calendar?.loading && calendar.disconnected && /No upcoming/.test(calendar.samples.empty) &&
      /fixture unavailable/.test(calendar.samples.error) && /DBMS lab/.test(calendar.samples.events), calendar);
    check('Immersive small screen', 'the panel scrolls above the mic and respects reduced motion', calendar?.smallLayout, calendar);

    await S.post('/api/tool/writeFile', {name:'task-result.md', content:'Database joins fixture: finish the inner join examples before Friday.'});
    const taskAnswers = await tab2.evaluate(`(async () => {
      await handleUser('Read task-result.md and show my to-do list', 'text');
      for (let i = 0; i < 150 && (busy || pumping || replyQ.length); i++) await new Promise(resolve => setTimeout(resolve, 100));
      return [...document.querySelectorAll('#messages .msg.jarvis .mbody')].at(-1)?.textContent || '';
    })()`, true);
    check('Multi-step answers', 'the normal command path returns both the document contents and the current tasks',
      /Database joins fixture: finish the inner join examples before Friday/.test(taskAnswers) && /buy milk/.test(taskAnswers), taskAnswers);

    const desktop = await tab2.evaluate(`(async () => {
      const oldFetch = window.fetch, calls = [];
      let inspected = 0;
      window.fetch = async (url, options) => {
        const route = String(url);
        if (route.endsWith('/api/desktop/windows')) return Response.json({windows:[{id:'fixture',title:'Fixture app',app:'fixture'}]});
        if (route.endsWith('/api/desktop/inspect')) return Response.json({
          snapshotId:'snapshot-' + (++inspected),title:'Fixture app',expiresAt:Date.now()+120000,
          controls:[{id:'field',name:'Message',type:'ControlType.Edit',enabled:true,canFill:true},
            {id:'button',name:'Apply',type:'ControlType.Button',enabled:true,canClick:true}],
        });
        if (route.endsWith('/api/desktop/action')) {
          const body = JSON.parse(options.body); calls.push(body);
          if (!body.approved) return Response.json({needsApproval:true,approvalKind:'desktop',approvalToken:'fixture-token',
            action:body.action==='fill'?'fill the field':'click the control',
            paths:['Fixture app',body.controlId==='field'?'Message':'Apply',body.value||'']},{status:409});
          return Response.json({success:true,verified:body.action==='fill',note:'Fixture action observed.'});
        }
        return oldFetch(url, options);
      };
      const approvalButton = async () => {
        for(let i=0;i<60;i++) {
          const card = [...document.querySelectorAll('#messages .msg.jarvis')].findLast(message =>
            message.textContent.includes('selected application window') && message.querySelector('.confirmRow:not(.done)'));
          if (card) return card.querySelector('.confirmRow .danger');
          await new Promise(resolve=>setTimeout(resolve,50));
        }
      };
      try {
        await handleUser('Inspect Fixture app', 'text');
        const listed = document.querySelector('#desktopControls').textContent.includes('Message');
        const fill = handleUser('Fill field Message with Hello 42', 'text');
        const allow = await approvalButton();
        if (!allow) throw new Error('The desktop fill approval card did not appear.');
        const guarded = !!allow && calls.length===1 && !calls[0].approved;
        allow?.click(); await fill;
        const approved = calls.length===2 && calls[1].approved===true && calls[1].approvalToken==='fixture-token' && calls[1].value==='Hello 42';
        await handleUser('Click Apply', 'text');
        const staleBlocked = calls.length===2;
        await handleUser('Inspect Fixture app', 'text');
        const click = handleUser('Click Apply', 'text');
        const cancel = await approvalButton();
        if (!cancel) throw new Error('The desktop click approval card did not appear: ' + JSON.stringify({
          calls, busy, pending:!!pendingApproval, status:document.querySelector('#desktopStatus').textContent,
          controls:document.querySelector('#desktopControls').textContent,
          reply:document.querySelector('#messages').textContent.slice(-900),
        }));
        cancel?.parentElement.querySelector('button:not(.danger)').click();
        await click;
        return {listed,guarded,approved,staleBlocked,declined:calls.length===3&&!calls.at(-1).approved};
      } finally { window.fetch=oldFetch; }
    })()`, true);
    check('Desktop commands','inspection and approved fill use the normal voice/text path with exact target and text',
      desktop?.listed&&desktop.guarded&&desktop.approved,desktop);
    check('Desktop approvals','a used inspection and a declined click make no further application calls',
      desktop?.staleBlocked&&desktop.declined,desktop);

    /* ---------------- Scenario 2: Closing & Reopening JARVIS During a Task ---------------- */
    // Plant an interrupted task in server state ('jarvis.agentRuns')
    const runId = 'AGT-20261021-999';
    const oldStarted = Date.now() - 4 * 60 * 1000; // 4 minutes ago (> 3 min STALE_RUN_MS)
    const plantedTasks = [{
      id: runId,
      goal: 'compile test project and backup',
      source: 'planner',
      running: true,
      at: oldStarted,
      updated: oldStarted,
      steps: [
        { id: 's1', label: 'compile', status: 'verified', tier: 'safe' },
        { id: 's2', label: 'backup', status: null, tier: 'safe' }
      ]
    }];
    await S.post('/api/state', { set: { 'jarvis.agentRuns': plantedTasks } });

    // Reload tab1 to simulate opening JARVIS after a restart
    await tab1.send('Page.navigate', { url: S.base + '/?skipboot' });
    let readyAfterRestart = false;
    for (let i = 0; i < 200 && !readyAfterRestart; i++) {
      await sleep(100);
      readyAfterRestart = await tab1.evaluate("typeof Agent === 'object' && typeof Agent.sweepInterrupted === 'function'").catch(() => false);
    }
    check('Restart Mid-Task', 'page reloaded after simulated restart', readyAfterRestart);

    // Run sweepInterrupted in browser
    const interrupted = await tab1.evaluate(`Agent.sweepInterrupted()`);
    check('Restart Mid-Task', 'stale running task is detected and swept as interrupted', Array.isArray(interrupted) && interrupted.some(r => r.id === runId && r.interrupted === true), interrupted);

    const inspected = await tab1.evaluate(`Agent.inspect('${runId}')`);
    check('Restart Mid-Task', 'interrupted task inspect output shows INTERRUPTED status', inspected && /STATUS: INTERRUPTED/.test(inspected.text), inspected);

    /* ---------------- Scenario 3: Reloading the Page, Then Pressing ROLLBACK ---------------- */
    // Set up a task and an undo record for a file change on the server
    const rollbackRunId = 'AGT-20261021-123';
    const testFile = 'test-rollback.txt';
    const testFilePath = path.join(S.sandbox, testFile);
    fs.writeFileSync(testFilePath, 'initial content');

    // Plant undo record in server .undo-log.json
    const undoItem = {
      id: 'und-test-1',
      t: Date.now(),
      label: 'created ' + testFile,
      endpoint: '/tool/undoCreate',
      body: { name: testFilePath },
      key: '/tool/undoCreate|' + testFilePath.replace(/\//g, '\\').toLowerCase(),
      run: rollbackRunId
    };
    fs.writeFileSync(path.join(S.sandbox, '.undo-log.json'), JSON.stringify([undoItem]));

    // Navigate Tab 1 again (full page reload)
    await tab1.send('Page.navigate', { url: S.base + '/?skipboot' });
    let readyAfterReload = false;
    for (let i = 0; i < 200 && !readyAfterReload; i++) {
      await sleep(100);
      readyAfterReload = await tab1.evaluate("typeof Undo === 'object' && typeof Undo.undoRun === 'function' && typeof restoreUndoFromServer === 'function'").catch(() => false);
    }
    check('Rollback After Reload', 'page reloaded successfully', readyAfterReload);

    // Restore undo from server
    await tab1.evaluate(`restoreUndoFromServer()`, true);
    await sleep(200);

    const countForRun = await tab1.evaluate(`Undo.countRun('${rollbackRunId}')`);
    check('Rollback After Reload', 'Undo restored task undo records matching the task run ID', countForRun >= 1, countForRun);

    // Trigger ROLLBACK on that task run
    const rollbackResult = await tab1.evaluate(`Undo.undoRun('${rollbackRunId}')`, true);
    check('Rollback After Reload', 'undoRun executes rollback for the whole task', rollbackResult && Array.isArray(rollbackResult.done) && rollbackResult.done.length >= 1 && rollbackResult.failed.length === 0, rollbackResult);
    await sleep(300);
    check('Rollback After Reload', 'file was removed by rollback after reload', !fs.existsSync(testFilePath));

  } catch (e) {
    check('Scenarios', 'browser scenarios ran without crash', false, e.stack);
  } finally {
    try { tab1 && tab1.close(); } catch {}
    try { tab2 && tab2.close(); } catch {}
    killBrowser(browser);
    killLeftoverTestBrowsers(profile);
    await S.stop();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  process.exit(done() ? 1 : 0);
})();
