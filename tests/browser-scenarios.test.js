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
  const S = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-scenarios-'));
  let browser = null, tab1 = null, tab2 = null;

  try {
    // 0. Seed basic setup
    await S.post('/api/state', { set: { 'jarvis.settings': { tts: false, sound: false, setupDone: true, online: false, wakeWord: 'jarvis' }, 'jarvis.migrated': true } });

    // Spawn browser in headless mode with remote debugging port
    browser = spawn(exe, [
      '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
      '--disable-gpu', 'about:blank'
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

    // Open Tab 2 as a real second browser tab
    const newTabTarget = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(S.base + '/?skipboot'), { method: 'PUT' })).json();
    tab2 = await cdp(newTabTarget.webSocketDebuggerUrl);

    let ready2 = false;
    for (let i = 0; i < 200 && !ready2; i++) {
      await sleep(100);
      ready2 = await tab2.evaluate("typeof handleUser === 'function' && typeof claimAlert === 'function'").catch(() => false);
    }
    check('Tab 2', 'second tab loaded successfully', ready2);

    /* ---------------- Scenario 1: Two Tabs & Scheduled Routine Claim Race ---------------- */
    const routineKey = 'routine:morning:' + Date.now();
    const claim1 = await tab1.evaluate(`claimAlert('${routineKey}', 60)`, true);
    const claim2 = await tab2.evaluate(`claimAlert('${routineKey}', 60)`, true);
    check('Two Tabs', 'Tab 1 claims routine and wins', claim1 === true);
    check('Two Tabs', 'Tab 2 claims same routine and loses (does not run twice)', claim2 === false);

    // State sync: Tab 1 writes state -> server broadcast -> Tab 2 picks up
    await tab1.evaluate(`(async () => {
      todos = [{ id: 'td-1', text: 'buy milk', done: false }];
      store.set('jarvis.todos', todos);
    })()`, true);

    let tab2Todos = '[]';
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      tab2Todos = await tab2.evaluate(`JSON.stringify(store.get('jarvis.todos') || [])`);
      if (tab2Todos.includes('buy milk')) break;
    }
    check('Two Tabs', 'state updated in Tab 1 syncs to Tab 2 via SSE', tab2Todos.includes('buy milk'), tab2Todos);

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
