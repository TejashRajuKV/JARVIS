// Tool results are reported honestly: when the call behind a command fails (backend offline, timeout, unreadable process
// list) the reply says so and is marked failed, instead of turning the failure into an answer ("no battery", "nothing is
// open", "no such folder"). Runs the real tools/<area>.js files with a fake callTool. Run: node tests/toolresults.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const root = f => path.join(__dirname, '..', f);
const OFFLINE = { error: 'the backend is offline (press START JARVIS above, or the desktop icon)' };

function sandbox(replies) {
  const calls = [], said = [], focus = [], undo = [];
  const ctx = vm.createContext({
    console, calls, said, focus, undo, API: '/api',
    callTool: async (ep, data) => { calls.push([ep, data]); const r = replies[ep]; return typeof r === 'function' ? r(data) : JSON.parse(JSON.stringify(r || OFFLINE)); },
    fetch: async () => ({ json: async () => ({}) }),
    toolStep: () => {}, setFocus: () => {}, setResults: () => {}, log: () => {},
    jarvisSay: m => said.push(m), startFocus: m => { focus.push(m); return m; }, stopFocus: () => true,
    Undo: { push: l => undo.push(l) }, settings: { focusMin: 25 }, ctx: {},
    saveFocus: () => {}, Persona: { sir: () => 'sir' },
    Agent: { DISTRACTORS: ['discord', 'steam', 'whatsapp', 'spotify'] },
    NLU: { APPS: [{ k: 'discord', n: 'Discord' }, { k: 'steam', n: 'Steam' }, { k: 'whatsapp', n: 'WhatsApp' }, { k: 'spotify', n: 'Spotify' }] },
    Thresholds: { isBatteryLow: l => l < 20 },
    similarTo: async () => [], didYouMeanReply: () => ({ text: 'did you mean' }),
  });
  vm.runInContext(fs.readFileSync(root('tools/registry.js'), 'utf8') + ';this.ToolHandlers = ToolHandlers;', ctx);
  for (const f of ['system.js', 'productivity.js', 'code.js']) vm.runInContext(fs.readFileSync(root('tools/' + f), 'utf8'), ctx);
  ctx.run = async (intent, original, args) => {
    const p = { intent, text: original, original, args: args || {} };
    for (const h of ctx.ToolHandlers.list) { const r = await h.fn(p, original, original, p.args); if (r !== ctx.ToolHandlers.NONE) return ctx.ToolHandlers.normalize(r); }
  };
  return ctx;
}

(async () => {
  // ---- battery
  let s = sandbox({}), r = await s.run('SYS_BATTERY', 'battery');
  check('battery: backend offline → says it could not read the battery (not "no battery detected"), marked failed', /couldn’t read the battery/.test(r.text) && !/No battery/.test(r.text) && r.ok === false, r);
  s = sandbox({ '/tool/batteryStatus': { success: true, level: 55, status: 'Charging' } }); r = await s.run('SYS_BATTERY', 'battery');
  check('battery: a real reading is reported and ok', /55%/.test(r.text) && r.ok === true, r);
  s = sandbox({ '/tool/batteryStatus': { success: true, level: null, status: 'No battery detected' } }); r = await s.run('SYS_BATTERY', 'battery');
  check('battery: a desktop with no battery still says so', /No battery detected/.test(r.text), r);

  // ---- deep work mode
  s = sandbox({ '/tool/runningApps': { success: true, checked: [], running: [], error: 'could not read the process list' } }); r = await s.run('BLOCK_DISTRACTIONS', 'block distractions');
  check('distractions: unreadable process list → "couldn’t check", no "none open", no focus session, marked failed', /couldn’t check/.test(r.text) && !/No distracting apps/.test(r.text) && s.focus.length === 0 && r.ok === false, r);
  s = sandbox({}); r = await s.run('BLOCK_DISTRACTIONS', 'block distractions');
  check('distractions: backend offline → same honest failure', /couldn’t check/.test(r.text) && s.focus.length === 0 && r.ok === false, r);
  s = sandbox({ '/tool/runningApps': { success: true, checked: ['discord', 'steam', 'whatsapp', 'spotify'], running: [] } }); r = await s.run('BLOCK_DISTRACTIONS', 'block distractions');
  check('distractions: a real "nothing open" still starts the focus session', /No distracting apps/.test(r.text) && s.focus.length === 1 && r.ok === true, r);
  s = sandbox({ '/tool/runningApps': { success: true, checked: ['discord', 'steam', 'whatsapp', 'spotify'], running: ['discord', 'steam'] },
    '/tool/closeApplication': d => (d.app === 'discord' ? { success: true } : { error: 'access denied' }) });
  r = await s.run('BLOCK_DISTRACTIONS', 'block distractions'); await r.confirm.onConfirm();
  const msg = (s.said[0] || {}).text || '';
  check('distractions: a partial close names what closed and what did not (never "Closed Discord, Steam")', /Closed Discord\./.test(msg) && /\*\*Steam\*\* didn’t close/.test(msg) && !/Closed Discord, Steam/.test(msg), msg);

  // ---- does X exist?
  s = sandbox({ '/agent/exists': { exists: false, error: 'outside the allowed folders' }, '/tool/locateProject': { error: 'not found' } });
  r = await s.run('CHECK_EXISTS', 'does calcproj exist');
  check('exists: the laptop search failing → "couldn’t search", never "✗ No folder named …", marked failed', /couldn’t search/.test(r.text) && !/✗ No/.test(r.text) && r.ok === false, r);
  s = sandbox({ '/agent/exists': { exists: false }, '/tool/searchFiles': OFFLINE });
  r = await s.run('CHECK_EXISTS', 'does notes.txt exist');
  check('exists: the file search failing → "couldn’t search", never "✗ No file named …"', /couldn’t search/.test(r.text) && !/✗ No/.test(r.text) && r.ok === false, r);
  s = sandbox({ '/agent/exists': { exists: false }, '/tool/locateProject': { error: 'not found' }, '/tool/findFolderAnywhere': { success: true, paths: [] }, '/tool/searchFiles': { success: true, results: [], paths: [] } });
  r = await s.run('CHECK_EXISTS', 'does calcproj exist');
  check('exists: a search that worked and found nothing still answers "✗ No folder named …"', /✗ No folder named \*\*calcproj\*\*/.test(r.text), r);

  // ---- laptop actions that used to ignore their result
  for (const [intent, said, good] of [['SYS_LOCK', 'lock my screen', /Locking your screen/], ['SYS_CANCEL_SHUTDOWN', 'cancel shutdown', /Cancelled\. Your system stays on/],
    ['VOLUME_MUTE', 'mute', /^Muted/], ['VOLUME_UP', 'volume up', /Volume up/], ['VOLUME_DOWN', 'volume down', /Volume down/],
    ['MEDIA_PLAY', 'pause music', /play\/pause/], ['MEDIA_NEXT', 'next song', /Next track/], ['MEDIA_PREV', 'previous song', /Previous track/], ['MEDIA_STOP', 'stop music', /Stopped playback/], ['SHOW_DESKTOP', 'show desktop', /Minimised everything/]]) {
    s = sandbox({}); r = await s.run(intent, said);
    check(intent + ': a failed call says "I couldn’t …", not the success line, adds no undo step, and is marked failed', /couldn’t/.test(r.text) && !good.test(r.text) && s.undo.length === 0 && r.ok === false, r);
    s = sandbox({ '/tool/lockSystem': { success: true }, '/tool/cancelShutdown': { success: true }, '/tool/setVolume': { success: true }, '/tool/mediaKey': { success: true }, '/tool/showDesktop': { success: true } });
    r = await s.run(intent, said); check(intent + ': a call that worked still gives the success line', good.test(r.text) && r.ok === true, r);
  }
  s = sandbox({ '/tool/cancelShutdown': { success: true, nothingPending: true } }); r = await s.run('SYS_CANCEL_SHUTDOWN', 'cancel shutdown');
  check('cancel shutdown: nothing pending is said plainly (not "Cancelled")', /no shutdown or restart pending/.test(r.text) && !/^Cancelled/.test(r.text), r);

  // ---- suit up (the whole study scene)
  const suitHarness = s => ({
    applyTheme: t => { s.appliedTheme.push(t); },
    HUDOverlay: { active: false, activate: () => { s.HUDOverlay.active = true; s.hudOn.push(true); }, deactivate: () => { s.HUDOverlay.active = false; } },
    executeTool: async p => ({ text: '▶ Playing **Lofi study beats** on YouTube.', ok: true }),
    _reset: () => { s.appliedTheme = []; s.hudOn = []; delete s.startCalled; },
  });
  // nothing open → the whole scene runs straight away: theme, HUD, volume, focus, one composite undo entry
  s = sandbox({ '/tool/runningApps': { success: true, checked: ['discord', 'steam', 'whatsapp', 'spotify'], running: [] }, '/sys/volume': d => (d.level === undefined ? { level: 40 } : { level: d.level }) });
  Object.assign(s, suitHarness(s)); s._reset();
  r = await s.run('SUIT_UP', 'suit up for 45 minutes');
  check('suit up: nothing open → the scene runs now: theme applied, HUD started, focus started, volume set to 30, one composite undo', /Suit up/.test(r.text) && /45 minutes/.test(r.text) && s.appliedTheme.includes('arc') && s.focus.length === 1 && s.hudOn.length === 1 && s.calls.some(c => c[0] === '/sys/volume' && c[1] && c[1].level === 30) && s.undo.length === 1, r);
  check('suit up: nothing open → the reply names the scene, never pretends apps were closed', !/Closed \*\*/.test(r.text) && !/I will close/.test(r.text), r.text);
  // unreadable process list → honest note, the quiet parts of the scene still run, nothing closed
  s = sandbox({ '/tool/runningApps': { success: true, checked: [], running: [], error: 'could not read the process list' }, '/sys/volume': d => (d.level === undefined ? { level: 40 } : { level: d.level }) });
  Object.assign(s, suitHarness(s)); s._reset();
  r = await s.run('SUIT_UP', 'suit up');
  check('suit up: unreadable process list → says "couldn’t check" and still runs the quiet parts of the scene', /couldn’t check/.test(r.text) && s.focus.length === 1 && r.ok === true, r);
  // something open → asks first; the confirm closes what it can, starts the scene, and reports a partial close honestly
  s = sandbox({
    '/tool/runningApps': { success: true, checked: ['discord', 'steam', 'whatsapp', 'spotify'], running: ['discord', 'steam'] },
    '/tool/closeApplication': d => (d.app === 'discord' ? { success: true } : { error: 'access denied' }),
    '/sys/volume': d => (d.level === undefined ? { level: 40 } : { level: d.level }),
  });
  Object.assign(s, suitHarness(s)); s._reset();
  r = await s.run('SUIT_UP', 'suit up on dbms with music');
  check('suit up: distracting apps open → tells what it will do and asks first, nothing applied before the OK', /I will close \*\*Discord, Steam\*\*/.test(r.text) && !!r.confirm && s.focus.length === 0 && s.appliedTheme.length === 0, r);
  await r.confirm.onConfirm();
  const suitMsg = (s.said[0] || {}).text || '';
  check('suit up: after the OK — Discord closed, Steam refused (named honestly), subject kept, music played, theme + HUD + volume + focus ran, one composite undo', /Closed Discord\./.test(suitMsg) && /\*\*Steam\*\* didn’t close/.test(suitMsg) && /dbms/.test(suitMsg) && /lofi study beats/.test(suitMsg) && s.appliedTheme.includes('arc') && s.hudOn.length === 1 && s.focus.length === 1 && s.undo.length === 1, suitMsg);
  // a session already running is kept, never silently restarted (the FOCUS_START rule)
  s = sandbox({ '/tool/runningApps': { success: true, checked: ['discord'], running: [] }, '/sys/volume': d => (d.level === undefined ? { level: 40 } : { level: d.level }) });
  Object.assign(s, suitHarness(s)); s._reset();
  s.focus = { phase: 'focus', min: 25, end: Date.now() + 12 * 6e4, subject: undefined };   // a session already running
  s.startFocus = () => { s.startCalled = true; };
  r = await s.run('SUIT_UP', 'suit up');
  check('suit up: a running focus session is kept and named, and startFocus is not called again', /Kept your running \*\*25-minute\*\*/.test(r.text) && !s.startCalled && s.appliedTheme.includes('arc') && s.hudOn.length === 1, r);

  console.log(`toolresults: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exitCode = 1; });
