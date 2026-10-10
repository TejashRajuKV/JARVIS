// In-page self-test. tests/e2e.test.js loads the real JARVIS page (isolated server, headless Edge/Chrome) and
// evaluates this file inside it. Anything that would act on the laptop — apps, volume, brightness, radios, power,
// lock, clipboard, keyboard, screen, browser windows, coding AIs — goes to a recording FAKE; everything else goes to
// the real (isolated) server. Then each feature runs through handleUser() exactly as if you had typed it.
// Results: window.__selftest = { done, results:[{feature, desc, ok, detail}], calls }.
(async () => {
  const T = window.__selftest = { done: false, results: [], errors: [] };
  const sleepMs = ms => new Promise(r => setTimeout(r, ms));
  const check = (feature, desc, ok, detail) => { T.results.push({ feature, desc, ok: !!ok, detail: ok ? undefined : String(detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) }); return !!ok; };
  addEventListener('error', e => T.errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => T.errors.push(String(e.reason && e.reason.message || e.reason)));

  /* ---------- fake laptop ---------- */
  const PC = { volume: 50, brightness: 70, theme: 'dark', bt: 'on', wifi: 'on', running: new Set(['chrome', 'discord']), clip: 'console.log("hi")' };
  const calls = T.calls = [];
  const FAKE = {
    '/tool/openApplication': b => { PC.running.add(b.app); return { success: true, name: b.app }; },
    '/tool/closeApplication': b => { PC.running.delete(b.app); return { success: true }; },
    '/tool/runningApps': b => ({ success: true, checked: b.apps || [], running: (b.apps || []).filter(a => PC.running.has(a)) }),
    '/sys/volume': b => { if (b.level !== undefined) PC.volume = +b.level; return { success: true, level: PC.volume }; },
    '/tool/setVolume': b => { if (b.action === 'up') PC.volume = Math.min(100, PC.volume + 10); if (b.action === 'down') PC.volume = Math.max(0, PC.volume - 10); return { success: true }; },
    '/sys/brightness': b => { if (b.level !== undefined) PC.brightness = +b.level; return { success: true, level: PC.brightness }; },
    '/sys/theme': b => { if (b.mode) PC.theme = b.mode; return { success: true, mode: PC.theme }; },
    '/sys/radio': b => { const k = b.kind === 'wifi' ? 'wifi' : 'bt'; if (b.state) PC[k] = b.state; return { success: true, kind: b.kind, state: PC[k] }; },
    '/sys/powerPlan': b => ({ success: true, active: b.plan ? 'Power saver' : 'Balanced', plans: [{ name: 'Balanced', active: true }, { name: 'Power saver' }] }),
    '/sys/displayOff': () => ({ success: true }), '/sys/window': () => ({ success: true, done: 1 }),
    '/sys/screenRead': () => ({ success: true, text: 'TypeError: cannot read properties of undefined (reading "map")' }),
    '/sys/clipHistory': () => ({ success: true, items: [PC.clip, 'older copied text'] }),
    '/tool/readClipboard': () => ({ success: true, content: PC.clip }),   // same shape as server.js
    '/tool/writeClipboard': b => { PC.clip = String(b.text || ''); return { success: true }; },
    '/tool/pasteKeys': () => ({ success: true }), '/tool/mediaKey': () => ({ success: true }), '/tool/showDesktop': () => ({ success: true }),
    '/tool/lockSystem': () => ({ success: true }), '/tool/sleepSystem': () => ({ success: true }), '/tool/shutdownSystem': () => ({ success: true }),
    '/tool/restartSystem': () => ({ success: true }), '/tool/cancelShutdown': () => ({ success: true }),
    '/tool/screenshot': () => ({ success: true, file: 'shot.png', path: 'C:/Users/you/Desktop/shot.png' }),   // same shape as server.js
    '/tool/openUrl': b => ({ success: true, url: b.url }), '/tool/openFile': b => ({ success: true, name: b.name }),
    // like the real server: a folder that isn't anywhere ("calculater") is "can't find"
    '/tool/openFolder': b => /^calculater$/i.test(b.name || '') ? { error: 'I can\'t find "' + b.name + '" on this laptop' } : { success: true, name: b.name || '~/jarvis' }, '/tool/openKnownFolder': b => ({ success: true, name: b.name }),
    // Like the real server: a name found in several places on the laptop ("agriloop") comes back as choices; a full path opens.
    '/tool/openInEditor': b => /^agriloop$/i.test(b.name || '') ? { choices: ['C:\\Users\\you\\Downloads\\Documents - Copy\\AGRILOOP-1', 'C:\\Users\\you\\Downloads\\Documents - Copy\\AGRILOOP61'], error: 'Several places match' } : { success: true, name: b.name || 'project', path: b.name || 'project', editor: 'VS Code' },
    '/tool/codeAsk': () => ({ success: true, sent: true }), '/tool/gitClone': () => ({ error: 'cloning is faked in tests' }),
    // "zzqx" queries get the kind of results that once opened Wix for "smart india hackathon website".
    '/tool/webSearch': b => ({ success: true, results: /zzqx/.test(b.q)
      ? [{ title: 'Website Builder - Create a Free Website | Wix.com', url: 'https://www.wix.com/' }, { title: 'Website Builder | Canva', url: 'https://www.canva.com/website-builder/' }]
      : [{ title: b.q, url: 'https://example.com/' + encodeURIComponent(b.q) }] }),
    '/tool/youtubeTop': b => ({ success: true, url: 'https://www.youtube.com/watch?v=test', title: b.query }),
    // Weather service (same shape as /api/tool/weather): "nowhereville" is a place it doesn't know; no city → only the country.
    '/tool/weather': b => /nowhereville/i.test(b.city) ? { error: 'Weather service unreachable: HTTP 404' }
      : !b.city ? { success: true, approximate: true, place: 'India' }
      : { success: true, place: b.city.replace(/\b[a-z]/g, x => x.toUpperCase()) + ', Karnataka', approximate: false, tempC: 28, feelsC: 31, desc: 'Partly cloudy', humidity: 70, windKmph: 12, minC: 21, maxC: 29, rainChance: 70, tomorrow: { minC: 20, maxC: 27, desc: 'Light rain' } },
    '/tool/research': b => ({ success: true, results: [{ title: 'Weather: ' + b.q, url: 'https://example.com/weather', snippet: '24°C, sunny' }], pages: [] }),
    // "Did you mean…?" (the real one reads the laptop file index): "calculater" is close to a calculator folder.
    '/tool/similar': b => ({ success: true, suggestions: /calcul|calc/i.test(b.name || '') ? [{ path: 'C:\\Users\\you\\Projects\\calculator', name: 'calculator', dir: true, score: 0.96 }, { path: 'C:\\Users\\you\\Desktop\\calc_app', name: 'calc_app', dir: true, score: 0.86 }] : [] }),
    '/tool/findFolderAnywhere': b => ({ success: true, paths: /agriloop/i.test(b.name) ? ['C:\\Users\\you\\Downloads\\Documents - Copy\\AGRILOOP-1', 'C:\\Users\\you\\Downloads\\Documents - Copy\\AGRILOOP61'] : [] }),
    '/wake/native': b => ({ supported: true, on: !!b.on, listening: !!b.on }), '/wake/front': () => ({ result: 'front' }), '/notify/test': () => ({ success: true }), '/phone/reply': () => ({ success: true }),
  };
  const realCallTool = window.callTool;
  window.callTool = async (endpoint, data, token) => {
    calls.push({ endpoint, data: data || {}, faked: !!FAKE[endpoint] });
    return FAKE[endpoint] ? FAKE[endpoint](data || {}) : realCallTool(endpoint, data, token);
  };
  const called = (ep, pred) => calls.some(c => c.endpoint === ep && (!pred || pred(c.data)));

  /* ---------- driving the page (reads replies from the chat, like you would) ---------- */
  const jarvisMsgs = () => [...document.querySelectorAll('#messages .msg.jarvis')];
  const idle = async (limit) => { const t0 = Date.now(); while ((busy || pumping || replyQ.length) && Date.now() - t0 < limit) await sleepMs(40); return Date.now() - t0 < limit; };
  // Permission / preview cards in new replies are answered the way the step asks (default: decline — nothing risky runs).
  // New replies = messages not yet marked as seen (indexes shift when "delete my last message" removes old ones).
  const freshMsgs = () => jarvisMsgs().filter(m => !m.dataset.seen);
  const answerCards = policy => {
    for (const m of freshMsgs()) for (const row of m.querySelectorAll('.confirmRow:not(.done)')) {
      // Only permission/preview cards (their yes-button is .danger) — not choice buttons like "OPEN 1 / OPEN 2".
      if (row.dataset.answered || !row.querySelector('button.danger')) continue;
      const btns = row.querySelectorAll('button');
      row.dataset.answered = '1';
      (policy === 'yes' ? btns[0] : btns[1] || btns[0]).click();
    }
  };
  // Runs one phrase; returns { text (new replies + their button labels), n (reply count), ms, ok (finished in time), errors }.
  async function say(phrase, { confirm = 'no', limit = 15000 } = {}) {
    await idle(limit);
    ctx.pending = null; ctx.answerOnly = false;
    jarvisMsgs().forEach(m => { m.dataset.seen = '1'; });
    const e0 = T.errors.length, t0 = Date.now();
    let finished = false;
    Promise.resolve(handleUser(phrase, 'text')).then(() => { finished = true; });
    while (Date.now() - t0 < limit) {
      answerCards(confirm);
      if (finished && !busy && !pumping && !replyQ.length) break;
      await sleepMs(40);
    }
    await sleepMs(80); answerCards(confirm);
    const fresh = freshMsgs();
    // The whole message: body, info cards and button labels (e.g. converters reply with a card).
    const text = fresh.map(m => (m.querySelector('.mcontent') || m).innerText).join('\n');
    return { text, n: fresh.length, ms: Date.now() - t0, ok: finished, errors: T.errors.slice(e0) };
  }
  const has = (r, re) => re.test(r.text);

  // Wait for boot to finish.
  for (let i = 0; i < 200 && (state === 'BOOT' || !document.querySelector('#bootOverlay.done')); i++) await sleepMs(50);
  check('Harness', 'the app booted', state !== 'BOOT', state);
  settings.tts = false; settings.sound = false;

  /* =========================== deep flows =========================== */
  let r;
  // ---- to-dos
  r = await say('add revise dbms to my to-do list');
  check('To-dos', 'add a to-do', todos.some(t => /revise dbms/i.test(t.text)), r.text);
  r = await say('show my to-do list');
  check('To-dos', 'list to-dos', has(r, /revise dbms/i), r.text);
  r = await say('mark 1 as done');
  check('To-dos', 'mark one done', todos.some(t => /revise dbms/i.test(t.text) && t.done), r.text);
  // Undo covers removals (a deleted/cleared to-do, moved files, volume…) — adding isn't on its undo list.
  r = await say('clear completed tasks', { confirm: 'yes' });
  check('To-dos', 'clear completed to-dos', !todos.some(t => /revise dbms/i.test(t.text)), r.text);
  r = await say('undo');
  check('Undo', 'undo brings the cleared to-do back', todos.some(t => /revise dbms/i.test(t.text)), r.text);
  // ---- reminders & timers
  r = await say('remind me to call mom in 10 minutes');
  const rm = reminders.find(x => /call mom/i.test(x.text));
  check('Reminders', 'a reminder in 10 minutes', rm && Math.abs(rm.at - Date.now() - 10 * 6e4) < 9e4, r.text);
  r = await say('remind me to pay fees every year in july');
  const ry = reminders.find(x => /pay fees/i.test(x.text));
  check('Reminders', 'a yearly reminder in July', ry && ry.repeat && ry.repeat.type === 'yearly' && new Date(ry.at).getMonth() === 6, ry || r.text);
  r = await say('what are my reminders');
  check('Reminders', 'list reminders', has(r, /call mom/i), r.text);
  r = await say('set a timer for 10 minutes');
  check('Timers', 'start a timer', timers.length >= 1, r.text);
  r = await say('cancel all timers');
  check('Timers', 'cancel timers', timers.length === 0, r.text);
  // ---- focus
  r = await say('start a 45 minute focus session');
  check('Focus', 'start a 45-minute focus session', focus && focus.min === 45, r.text);
  r = await say('start a focus session');
  check('Focus', 'a running session is not silently restarted (asks first)', has(r, /already running/i) && focus && focus.min === 45, r.text);
  r = await say('stop the focus session');
  check('Focus', 'stop the session', !focus, r.text);
  // ---- context: "there" / "that directory" / "open it" mean the folder just shown or made (presentation failures)
  r = await say('create a folder called ctxtest');
  r = await say('list folders in ctxtest');
  check('Context', 'listing a folder puts it in focus', ctx.focus.folder && /ctxtest$/i.test(ctx.focus.folder.path), JSON.stringify(ctx.focus.folder) + ' ' + r.text);
  r = await say('create a folder called inner in that directory');
  check('Context', '"in that directory" = the folder just listed (not a folder named "inner in that directory")',
    called('/tool/createFolder', d => d.name === 'inner' && /ctxtest$/i.test(d.where || '')) && /Created folder/.test(r.text), r.text);
  r = await say('open it');
  check('Context', '"open it" opens the folder just created', called('/tool/openFolder', d => /ctxtest[\\/]inner$/i.test(d.name || '')), r.text);
  r = await say('make me a directory called second there');
  check('Context', '"make me a directory … there" (other words, same intent)', called('/tool/createFolder', d => d.name === 'second' && /ctxtest/i.test(d.where || '')), r.text);
  r = await say('list folders in ctxtest');
  r = await say('open the second one');
  check('Context', '"open the second one" opens item 2 of the list just shown', called('/tool/openFolder', d => /ctxtest[\\/](inner|second)$/i.test(d.name || '')), r.text);
  ctx.focus = { folder: null, file: null, created: null, results: [] };
  r = await say('create a folder called lost in that directory');
  check('Context', 'with nothing in focus, "that directory" is asked about — never guessed', /Which folder do you mean/i.test(r.text) && !called('/tool/createFolder', d => d.name === 'lost'), r.text);
  r = await say('list number of folders in my laptop');
  check('Folders', '"list number of folders in my laptop" counts folders (laptop-wide)', called('/tool/folderStats', d => /laptop/i.test(d.scope || '')) && /folders|building the list/i.test(r.text), r.text);
  r = await say('how many folders are in ctxtest');
  check('Folders', '"how many folders are in X" counts in that folder', called('/tool/folderStats', d => /ctxtest/i.test(d.scope || '')), r.text);
  r = await say('create a frontend design for project zzcalc');
  check('Frontend', '"create a frontend design for project X" starts the builder for that project (no AI chat)', (/frontend for \*?\*?zzcalc|Anything specific/i.test(r.text) && called('/tool/findFolderAnywhere', d => /zzcalc/i.test(d.name || ''))) || (!llmReady() && /AI brain/.test(r.text)), r.text);
  r = await say('cancel');
  // ---- "Did you mean…?": a name you half-remember is matched to the closest real ones, and you pick
  r = await say('check whether calculater folder exists in my laptop or not');
  check('Did you mean', 'a near-miss name gets "Did you mean…?" with the close folders, not a flat no', /Did you mean/.test(r.text) && /calculator/.test(r.text) && /calc_app/.test(r.text), r.text);
  await handleUser('yes', 'text'); await idle(15000);
  check('Did you mean', '"yes" picks the first and remembers it ("open it" works next)', ctx.focus.folder && /Projects\\calculator$/.test(ctx.focus.folder.path), JSON.stringify(ctx.focus.folder));
  r = await say('open the calculater folder');
  check('Did you mean', 'opening a near-miss folder asks which one', /Did you mean/.test(r.text), r.text);
  await handleUser('2', 'text'); await idle(15000);
  check('Did you mean', '"2" opens the second suggestion', called('/tool/openFolder', d => /calc_app$/.test(d.name || '')), JSON.stringify(calls.filter(c => c.endpoint === '/tool/openFolder').slice(-1)));
  r = await say('check whether calculater folder exists'); await handleUser('no', 'text'); await idle(15000);
  check('Did you mean', '"no" ends it without acting', !ctx.pending, JSON.stringify(ctx.pending));
  // ---- smart file creation + continuations: the name comes from the request, the folder from the context
  r = await say('create a folder called calcproj');
  r = await say('and create a python file for calculator operations there');
  check('Smart files', '"and … there" keeps the context, and the file name comes from the request (no "what should I call it?")',
    /calculator\.py/.test(r.text) && !/What should I call/i.test(r.text), r.text);
  // ---- medium confidence on a SPOKEN command: asked first
  ctx.pending = null;
  { const before = jarvisMsgs().length; await handleUser('close zzqx player', 'voice'); await idle(15000);
    const t = jarvisMsgs().slice(before).map(m => m.innerText).join(' ');
    check('Confidence', 'a half-understood spoken command is asked about ("did you mean …?"), not guessed', /Did you mean/i.test(t) && ctx.pending && ctx.pending.intent === 'CONFIRM_INTENT', t);
    await handleUser('no', 'text'); await idle(15000); }
  // ---- the intent inspector
  settings.inspect = true;
  r = await say('battery');
  check('Inspector', 'with the switch on, replies show "How I understood this" (intent, confidence, route, permission)',
    !!jarvisMsgs().slice(-1)[0].querySelector('details.trace') && /SYS_BATTERY/.test(jarvisMsgs().slice(-1)[0].querySelector('details.trace').innerText), jarvisMsgs().slice(-1)[0].innerHTML.slice(0, 300));
  settings.inspect = false;
  r = await say('how did you understand that');
  check('Inspector', '"how did you understand that" shows the last trace even with the switch off', /battery/i.test(r.text) && !!jarvisMsgs().slice(-1)[0].querySelector('details.trace'), r.text);
  // ---- the decider: web for fresh facts (or an offer to go online), local AI for understanding, local for your files
  { const was = settings.online;
    settings.online = true;
    r = await say('what is the latest python version');
    check('Decider', 'fresh facts ("latest … version") → web research', called('/tool/research', d => /latest python version/i.test(d.q || '')), r.text);
    r = await say('find latest information about react');
    check('Decider', '"find latest information about react" → the web, not a file search', called('/tool/research', d => /react/i.test(d.q || '')), r.text);
    r = await say('what are the nearest restaurants to bengaluru(kodigehalli)');
    check('Decider', 'places near somewhere → Google Maps (not the AI, not a broken tool call)', called('/tool/openUrl', d => /google\.com\/maps\/search\/nearest%20restaurants%20near%20Kodigehalli%2C%20Bengaluru/.test(d.url || '')) && /near Kodigehalli, Bengaluru, nearest first/.test(r.text), r.text);
    r = await say('open the nearest restaurant to kodigehalli');
    check('Decider', 'conflict "open" + place → Maps takes over from "open the best web page"', called('/tool/openUrl', d => /google\.com\/maps\/search\/nearest%20restaurant/.test(d.url || '')), r.text);
    r = await say('what version of node am i running');
    check('Decider', '"what version of node am I running" → the version on THIS laptop (not a web search)', called('/tool/toolVersion', d => /node/i.test(d.tool || '')) && /You’re running \*?\*?Node\.js/.test(r.text), r.text);
    r = await say('what is the latest file in my project');
    check('Decider', '"the latest file in my project" → newest files, never the web', !called('/tool/research', d => /latest file/i.test(d.q || '')), r.text);
    settings.online = false;
    r = await say('what is the latest node.js version');
    check('Decider', 'Online tools off + fresh facts → asks to turn it on (never stale memory silently)', /Online tools/.test(r.text) && /ENABLE ONLINE TOOLS/.test(r.text) && /ANSWER FROM MEMORY/.test(r.text), r.text);
    settings.online = was; }
  // ---- greetings answer in kind: "good evening" gets an evening reply whatever the clock says
  r = await say('good evening jarvis');
  check('Greetings', '"good evening" gets an evening reply (not "Morning")', /\bevening\b/i.test(r.text) && !/\bmorning\b/i.test(r.text), r.text);
  r = await say('good morning');
  check('Greetings', '"good morning" gets a morning reply', /\bmorning\b/i.test(r.text), r.text);
  r = await say('good afternoon');
  check('Greetings', '"good afternoon" gets an afternoon reply', /\bafternoon\b/i.test(r.text), r.text);
  check('Greetings', 'window.API is set (face greeting, Qwen assist and the port-watch switch build their addresses from it)', window.API === '/api', window.API);
  // ---- "save this file by creating a new folder called X": the code just written, as a real file — asked where first
  chatLog.push({ role: 'assistant', text: 'Here it is:\n```html\n<!DOCTYPE html>\n<html><body><h1>Calc</h1></body></html>\n```', t: Date.now() });
  r = await say('okay save this file by creating new folder called calc_site');
  check('Save code', 'saving code into a new folder asks WHERE first (not a one-line note)', /Where should I save/.test(r.text) && !called('/tool/writeFile', d => /calc_site/.test(d.name || '')), r.text);
  await handleUser('jarvis', 'text'); await idle(15000);
  check('Save code', '"jarvis" → calc_site/index.html written with the whole page', called('/tool/writeFile', d => d.name === 'calc_site/index.html' && /DOCTYPE html/.test(d.content || '')),
    JSON.stringify(calls.filter(c => c.endpoint === '/tool/writeFile').slice(-1)));
  // ---- weather (service faked): answered from the weather service, never by the AI
  {
    const was = { online: settings.online, city: settings.city };
    settings.online = true; settings.city = '';
    try {
      r = await say('weather in bengaluru');
      check('Weather', 'weather comes from the weather service', called('/tool/weather', d => /bengaluru/i.test(d.city)) && has(r, /Bengaluru, Karnataka.*28°C and partly cloudy.*feels like 31°C/i), r.text);
      check('Weather', 'a high chance of rain suggests an umbrella', has(r, /70% .*umbrella/i), r.text);
      r = await say('will it rain tomorrow in bengaluru');
      check('Weather', 'tomorrow’s forecast', has(r, /Tomorrow in .*Bengaluru.*light rain, 20–27°C/i), r.text);
      r = await say('how is the climate in mysore today');
      check('Weather', '"climate in <city>" is a weather request, not a chat question', called('/tool/weather', d => /mysore/i.test(d.city)) && has(r, /Mysore/i), r.text);
      r = await say('weather in nowhereville');
      check('Weather', 'a place the service doesn’t know falls back to a web search, never a guess', called('/tool/research', d => /current weather in nowhereville/i.test(d.q)) && has(r, /nowhereville/i), r.text);
      r = await say("what's the weather");
      check('Weather', 'no city and only the country known → asks for your city instead of guessing', has(r, /my city is/i), r.text);
    } finally { settings.online = was.online; settings.city = was.city; }
  }
  // ---- laptop controls (faked)
  r = await say('set volume to 30');
  check('Laptop', 'set volume (sent 30, read back)', called('/sys/volume', d => +d.level === 30) && has(r, /30/), r.text);
  r = await say('open chrome');
  check('Laptop', 'open an app', called('/tool/openApplication', d => d.app === 'chrome'), r.text);
  r = await say('close discord', { confirm: 'yes' });
  check('Laptop', 'close an app after permission', called('/tool/closeApplication', d => d.app === 'discord'), r.text);
  r = await say('turn off bluetooth');
  check('Laptop', 'switch Bluetooth off', called('/sys/radio', d => d.kind === 'bluetooth' && d.state === 'off'), r.text);
  r = await say('dark mode');
  check('Laptop', 'Windows dark mode', called('/sys/theme', d => d.mode === 'dark'), r.text);
  r = await say('set brightness to 40');
  check('Laptop', 'brightness', called('/sys/brightness', d => +d.level === 40), r.text);
  r = await say('system status');
  check('Laptop', 'system status snapshot', has(r, /SYSTEM STATE/) && has(r, /Volume/), r.text);
  const before = calls.length;
  r = await say('shut down');
  check('Safety', 'shutdown asks first — declined means it never runs', has(r, /YES — SHUT DOWN/) && has(r, /cancelled/i) && !calls.slice(before).some(c => c.endpoint === '/tool/shutdownSystem'), r.text);
  r = await say('delete all my files');
  check('Safety', '"delete all my files" is refused', !called('/tool/deleteItem') && !called('/tool/clearSandbox'), r.text);
  // ---- theme / persona / panic
  r = await say('switch to violet theme');
  check('Look', 'switch theme', document.documentElement.dataset.theme === 'violet', r.text);
  await say('switch to gold theme');
  r = await say('panic');
  check('Panic', 'panic pauses automation and shows the pill', store.get('jarvis.panic', false) === true && !document.getElementById('panicPill').hidden, r.text);
  r = await say('resume');
  check('Panic', 'resume ends it and hides the pill', store.get('jarvis.panic', false) === false && document.getElementById('panicPill').hidden, r.text);
  // ---- memory
  r = await say('my name is tejas'); r = await say("what's my name");
  check('Memory', 'remembers your name', has(r, /tejas/i), r.text);
  r = await say('remember that my exam is in december'); r = await say('what do you remember about me');
  check('Memory', 'remembers facts', has(r, /december/i), r.text);
  // ---- student
  for (const t of ['mark dbms present', 'mark dbms present', 'mark dbms present', 'mark dbms absent']) await say(t);
  const dbms = attendance[Object.keys(attendance).find(k => /dbms/i.test(k))];
  check('Attendance', 'marks attendance (3 of 4)', dbms && dbms.held === 4 && dbms.attended === 3, dbms);
  r = await say('attendance report');
  check('Attendance', 'report shows 75%', has(r, /75/), r.text);
  r = await say('how many classes to reach 80%?');
  check('Attendance', 'classes needed for 80%', has(r, /80%/) && has(r, /attend \d+ class/i), r.text);
  r = await say('can i skip dbms');
  check('Attendance', 'bunk check', has(r, /dbms/i), r.text);
  r = await say('add s3: 8.6 gpa, 24 credits');
  check('Marks', 'save a semester', marks.some(m => m.gpa === 8.6 && m.credits === 24), r.text);
  r = await say('what is my cgpa?');
  check('Marks', 'CGPA', has(r, /8\.6/), r.text);
  r = await say('what gpa do i need for an 9 cgpa?');
  check('Marks', 'GPA needed for a target', has(r, /SGPA|more than a 10/i), r.text);
  r = await say('add assignment os lab record due friday');
  check('Deadlines', 'add a deadline', deadlines.some(d => /os lab record/i.test(d.title)), r.text);
  r = await say("what's due this week");
  check('Deadlines', 'list deadlines', has(r, /lab record|nothing due/i), r.text);
  r = await say('add class dbms on monday at 10am');
  check('Timetable', 'add a class', classes.some(c => /dbms/i.test(c.name)), r.text);
  // ---- files (real, isolated server)
  r = await say('take a note: buy pens');
  check('Files', 'take a note (written to the sandbox)', (await realCallTool('/tool/readFile', { name: 'notes.md' })).content?.includes('buy pens'), r.text);
  r = await say('create a folder called dsa');
  check('Files', 'create a folder', (await realCallTool('/agent/exists', { name: 'dsa' })).exists, r.text);
  await realCallTool('/tool/writeFile', { name: 'lecture.txt', content: 'Deadlock needs four conditions: mutual exclusion, hold and wait, no preemption and circular wait.' });
  r = await say('what does lecture.txt say about deadlock');
  check('Notes search', 'answers from your own file (AI offline: shows the passage)', has(r, /lecture\.txt|mutual exclusion|circular wait/i), r.text);
  await realCallTool('/tool/writeFile', { name: 'hello.js', content: 'console.log("selftest " + 6 * 7)' });
  r = await say('run hello.js', { confirm: 'yes', limit: 25000 });
  check('Code', 'run a program and show its output', has(r, /selftest 42/), r.text);
  // ---- websites: known sites open directly; a search never opens an unrelated page
  { // your Telugu sentence — translation faked to what Google and qwen really return for it
    // llmReady() is a const — make it true through the state it reads, only for this step.
    const realTo = Lang.toEnglish, was = { online: llm.online, model: llm.model, on: settings.llm };
    Lang.toEnglish = async () => 'Open the Smart India hackathon website'; llm.online = true; llm.model = llm.model || 'test-model'; settings.llm = true;
    const n0 = calls.length;
    try { r = await say('స్మార్ట్ ఇండియా  hackathon  వెhబ్సైట్ ఓపెన్ చెయ్యి'); } finally { Lang.toEnglish = realTo; llm.online = was.online; llm.model = was.model; settings.llm = was.on; }
    check('Telugu/Kannada', 'Telugu "open the Smart India hackathon website" opens sih.gov.in', calls.slice(n0).some(c => c.endpoint === '/tool/openUrl' && /sih\.gov\.in/.test(c.data.url)), calls.slice(n0).map(c => c.endpoint + ' ' + JSON.stringify(c.data)).join(' | ') + ' → ' + r.text);
  }
  { const n0 = calls.length;
    r = await say('open zzqx portal');
    check('Web', 'irrelevant search results are not opened — JARVIS asks which one', !calls.slice(n0).some(c => c.endpoint === '/tool/openUrl') && has(r, /Which one did you mean/), calls.slice(n0).map(c => c.endpoint + ' ' + JSON.stringify(c.data)).join(' | ')); }
  // ---- wake word, with the fake Chrome recogniser (e2e.test.js): stability first, then real commands
  if (window.__sr) {
    const SRS = window.__sr, counts = () => JSON.stringify({ made: SRS.made, starts: SRS.starts, aborted: SRS.aborted, active: !!SRS.active });
    const lastReply = () => { const m = jarvisMsgs().slice(-1)[0]; return m ? m.innerText : ''; };
    const waitIdle = async ms => { await sleepMs(ms); for (let i = 0; i < 100 && (busy || pumping); i++) await sleepMs(100); };
    settings.micBoost = 'high';     // as installed: boosted audio (opening the mic makes starting slower, like real use)
    startWake();
    await sleepMs(3500);
    check('Wake word', 'switching it on runs one recogniser — not a churn of them aborting each other', SRS.starts <= 1 && SRS.aborted === 0 && SRS.active, counts());
    const s0 = SRS.starts;
    await sleepMs(3000);
    check('Wake word', 'it stays up while idle (no restarts)', SRS.starts === s0 && SRS.active, counts());
    window.__srSay('jarvis what time is it', true);
    await waitIdle(pauseMs() + 800);
    check('Wake word', '"Jarvis, what time is it" in one breath is answered', /\d{1,2}:\d{2}/.test(lastReply()), lastReply());
    window.__srSay('jarvis', true); await sleepMs(900);
    window.__srSay('what is 25 times', false); await sleepMs(500); window.__srSay('what is 25 times 4', true);
    await waitIdle(pauseMs() + 800);
    check('Wake word', '"Jarvis" … pause … a command → answered', /100/.test(lastReply()), lastReply());
    const s1 = SRS.starts, a = SRS.active; a.stop();   // Chrome ends the session by itself now and then
    await sleepMs(1500);
    check('Wake word', 'when Chrome ends the session, it restarts once — and keeps working', SRS.starts === s1 + 1 && SRS.active && SRS.active !== a, counts());
    window.__srSay('jarvis what is 6 times 7', true);
    await waitIdle(pauseMs() + 800);
    check('Wake word', '…and hears the next command', /42/.test(lastReply()), lastReply());
    window.__srSay('so what did you eat today', true); await waitIdle(pauseMs() + 800);
    check('Wake word', 'speech without the wake word is ignored', !/eat today/.test([...document.querySelectorAll('#messages .msg.user')].slice(-1)[0].innerText));
    // Tap the mic while the wake word is on: tap-to-talk takes the microphone, then hands it back.
    startDictation(); await sleepMs(1200);
    window.__srSay('what is 9 times 9', true);
    await waitIdle(pauseMs() + 800);
    check('Wake word', 'tapping the mic while the wake word is on is answered', /81/.test(lastReply()), lastReply());
    await sleepMs(1500);
    const before2 = SRS.aborted;
    window.__srSay('jarvis what is 5 times 5', true);
    await waitIdle(pauseMs() + 800);
    check('Wake word', '…then the wake word listens again (still one recogniser)', /25/.test(lastReply()) && SRS.aborted === before2, lastReply() + ' ' + counts());
    stopWake(); await sleepMs(300);
    check('Wake word', 'switching it off stops listening', !SRS.active, counts());
  }
  // ---- mic sensitivity: a boosted track for the speech recogniser (fake microphone in the test browser)
  { const saved = settings.micBoost;
    settings.micBoost = 'high'; const t = await boostedTrack();
    check('Voice', 'High sensitivity gives the recogniser a live, boosted audio track', t && t.readyState === 'live' && boost && boost.level === 'high', t ? t.readyState : 'no track');
    settings.micBoost = 'normal'; const n = await boostedTrack();
    check('Voice', 'Normal sensitivity uses the plain microphone (no boost)', n === null && !boost);
    dropBoost(); settings.micBoost = saved; }
  // ---- "open <folder> in vs code" for a folder anywhere on the laptop (no setup), found in two places
  { const n0 = calls.length;
    r = await say('open agriloop folder in vs code');
    const asked = calls.slice(n0).filter(c => c.endpoint === '/tool/openInEditor').map(c => c.data.name);
    check('Code', '"open agriloop folder in vs code" looks for "agriloop" (the word "folder" isn’t part of the name)', asked[0] === 'agriloop', asked);
    check('Code', 'a folder found in two places on the laptop asks which one (no ALLOW step)', has(r, /AGRILOOP-1/) && has(r, /AGRILOOP61/) && has(r, /OPEN 2/) && !has(r, /ALLOW/), r.text);
    const btn = [...jarvisMsgs().pop().querySelectorAll('button')].find(b => /OPEN 2/.test(b.textContent));
    if (btn) { btn.click(); await sleepMs(300); await idle(5000); }
    check('Code', 'OPEN 2 opens that exact folder in VS Code', called('/tool/openInEditor', d => /AGRILOOP61$/.test(d.name || '')), calls.slice(n0).map(c => c.endpoint + ' ' + JSON.stringify(c.data))); }
  // ---- changes outside ~/jarvis ask first (the server answers needsApproval; the page asks, then retries approved)
  { const origRaw = window.callToolRaw, done = [];
    window.callToolRaw = async (ep, d, t) => ep !== '/tool/renameFile' ? origRaw(ep, d, t)
      : d && d.approved ? (done.push(d), { success: true, from: 'C:\\Users\\you\\Desktop\\' + d.oldName, to: 'C:\\Users\\you\\Desktop\\' + d.newName })
      : { needsApproval: true, action: 'rename', paths: ['C:\\Users\\you\\Desktop\\' + d.oldName], error: 'needs your permission' };
    try {
      r = await say('rename report.md to final.md', { confirm: 'no' });
      check('Files', 'a change outside ~/jarvis shows an ALLOW / CANCEL card', has(r, /outside `?~\/jarvis/i) && has(r, /ALLOW/), r.text);
      check('Files', 'CANCEL on the card changes nothing', done.length === 0 && has(r, /nothing was changed/i), r.text);
      r = await say('rename report.md to final.md', { confirm: 'yes' });
      check('Files', 'ALLOW on the card makes the change (retried with approval)', done.length === 1 && done[0].approved === true, r.text);
      const n0 = calls.length;
      await handlePhone('rename report.md to final.md'); await idle(5000);
      const reply = calls.slice(n0).filter(c => c.endpoint === '/phone/reply').map(c => c.data.text).join(' ');
      check('Phone', 'a phone command can’t approve a change outside ~/jarvis', done.length === 1 && /at the laptop|not from the phone/i.test(reply), reply);
      // Routines and phone commands run with approvals blocked: the card never appears and nothing changes.
      approvalsBlocked++;
      let x; try { x = await callTool('/tool/renameFile', { oldName: 'report.md', newName: 'final.md' }); } finally { approvalsBlocked--; }
      check('Files', 'with nobody at the laptop (routine / phone), changes outside ~/jarvis are refused', done.length === 1 && x.cancelled && /at the laptop/.test(x.error), x);
    } finally { window.callToolRaw = origRaw; } }
  // ---- calculators
  for (const [desc, phrase, re] of [['base conversion', '255 to binary', /0b1111_1111/], ['unit conversion', '100 f to c', /37\.7|37\.8/], ['calculator', 'what is 25 times 4', /100/], ['time', 'what time is it', /\d{1,2}:\d{2}/]]) {
    r = await say(phrase);
    check('Tools', desc, has(r, re), r.text);
  }
  // ---- automation
  r = await say('create a routine called exam prep: open notepad, set a timer for 1 minute');
  check('Routines', 'create a routine', Routines.list().some(x => /exam prep/i.test(x.name)), r.text);
  const n0 = calls.length;
  r = await say('run exam prep routine', { limit: 25000 });
  check('Routines', 'run it (steps actually execute)', calls.slice(n0).some(c => c.endpoint === '/tool/openApplication' && c.data.app === 'notepad') && timers.length >= 1, r.text);
  await say('cancel all timers');
  r = await say('when i plug in my charger, start study mode', { confirm: 'yes' });
  check('Triggers', 'create a trigger', triggers.length >= 1, r.text);
  r = await say('list my triggers');
  check('Triggers', 'list triggers', has(r, /charger/i), r.text);
  // ---- the agent: goal sentence → preview → run → verify
  PC.running.add('discord'); PC.running.add('spotify'); const vol0 = PC.volume;
  r = await say("I'm going to study. Set the volume to 25, close distracting apps and start a 25 minute session", { confirm: 'yes', limit: 30000 });
  const run = Agent.lastRuns(1)[0];
  check('Agent', 'multi-step plan previews, runs and verifies', run && run.goal === 'Study' && run.steps.length === 3 && run.steps.every(s => s.status === 'verified'), run || r.text);
  check('Agent', 'the distracting apps were really closed (fake laptop)', !PC.running.has('discord') && !PC.running.has('spotify'));
  check('Agent', 'the run record notes how many steps can be undone', run && run.steps.some(s => s.undoable > 0), run && run.steps.map(s => s.undoable));
  // ---- execution inspector + undo the whole task
  r = await say('inspect the last run');
  check('Inspector', '"inspect the last run" shows goal, steps, verification and status', has(r, /EXECUTION AGT-/) && has(r, /Study/) && has(r, /Verification/) && has(r, /STATUS: COMPLETED/), r.text);
  check('Inspector', 'the card shows the timings and how many actions can be undone', has(r, /Route\s+\d+/) && has(r, /Total\s+[\d.]+ (ms|s)/) && has(r, /reversible action/), r.text);
  r = await say('inspect ' + run.id.toLowerCase());
  check('Inspector', 'a run can be inspected by its id', has(r, new RegExp('EXECUTION ' + run.id)), r.text);
  r = await say('undo that task');
  check('Undo', '"undo that task" reverses the whole plan: volume back, closed apps open again', PC.volume === vol0 && PC.running.has('discord') && PC.running.has('spotify'), { vol: PC.volume, vol0, running: [...PC.running] });
  check('Undo', 'it says what it undid and what had nothing to reverse', has(r, /Undid \d+ steps? of/) && has(r, new RegExp(run.id)), r.text);
  r = await say('undo that task');
  check('Undo', 'asking again says there is nothing left, instead of undoing something else', has(r, /no whole plan I can undo/i), r.text);
  await say('stop the focus session');
  r = await say('no, that’s wrong'); r = await say("what didn't you understand?");
  check('Agent', '"no, that’s wrong" is logged for teaching', has(r, /stop the focus session|TEACH|Nothing lately/i), r.text);

  /* ========== sweep: every feature responds, without crashing ========== */
  const FEATURES = window.__features || [];
  const SLOW_OK = /^(ROUTINE_RUN|WORKFLOW|RUN_FILE|ASK_FILES|SUMMARISE_FILE|FLASH_MAKE|RESEARCH|CODE_ASK)$/;
  for (const f of FEATURES) {
    const x = await say(f.example, { limit: SLOW_OK.test(f.intent) ? 20000 : 10000 });
    const answered = x.n > 0;
    check('Sweep · ' + f.area, f.intent + ' — “' + f.example + '” responds', x.ok && answered && !x.errors.length,
      (!x.ok ? 'did not finish in time. ' : '') + (!answered ? 'no reply. ' : '') + (x.errors.length ? 'errors: ' + x.errors.join(' | ') : ''));
  }
  check('Safety', 'no real laptop action escaped the fakes during the whole run', calls.every(c => FAKE[c.endpoint] || !/^\/(sys\/(volume|brightness|theme|radio|displayOff|window|powerPlan)|tool\/(open|close|lock|sleep|shutdown|restart|screenshot|paste|media|showDesktop|writeClipboard|readClipboard|codeAsk|gitClone))/.test(c.endpoint)));
  // ---- a second tab of the same JARVIS changes the chat: this tab shows it (server push), and ignores its own writes
  { await idle(8000);
    const post = (src, text) => fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src, set: { 'jarvis.chat': [{ role: 'user', text, source: 'text', t: Date.now() }] } }) });
    const shows = async text => { for (let i = 0; i < 30; i++) { if ([...document.querySelectorAll('#messages .msg')].some(m => m.innerText.includes(text))) return true; await sleepMs(100); } return false; };
    await post('another-tab', 'typed in the other tab');
    check('Tabs', 'a chat message written by another tab appears here without a reload', await shows('typed in the other tab') && chatLog.some(m => m.text === 'typed in the other tab'));
    await post(TAB_ID, 'my own echo');
    await sleepMs(1500);
    check('Tabs', 'a change this tab made itself is not applied again (no ping-pong)', !chatLog.some(m => m.text === 'my own echo')); }
  /* ========== camera tools, watchers, speak-while-writing, chat archive, student tools (fake camera + fake recogniser) ========== */
  { const click = (sel, re) => { const b = [...document.querySelectorAll(sel)].find(x => re.test(x.textContent)); if (b) b.click(); return !!b; };
    // ---- the capture panel with the browser's fake camera
    const pcap = Camera.capture({ title: 'E2E PHOTO' });
    await sleepMs(1800);
    const vid = document.querySelector('.cam-panel video'), pill = document.getElementById('camPill');
    check('Camera', 'the capture panel opens a live camera and the on-screen indicator says so', !!vid && vid.videoWidth > 0 && !!pill && /CAMERA ON/.test(pill.innerText), { w: vid && vid.videoWidth, pill: pill && pill.innerText });
    click('.cam-row button', /TAKE PHOTO/);
    const shot = await pcap;
    check('Camera', 'TAKE PHOTO returns a real picture; the panel and the indicator are gone afterwards', !!shot && shot.canvas.width > 0 && shot.canvas.height > 0 && !document.querySelector('.cam-panel') && !document.getElementById('camPill'));
    const pc2 = Camera.capture({ title: 'E2E 2' }); await sleepMs(1200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Camera', 'Esc closes the panel, returns nothing, and switches the camera off', (await pc2) === null && !document.querySelector('.cam-panel') && !document.getElementById('camPill'));
    r = await say('scan a qr code', { limit: 4000 }).catch(() => null);
    // (the QR panel is open now: cancel it with its button)
    await sleepMs(500); click('.cam-row button', /CANCEL/); await sleepMs(300);
    check('Camera', 'the QR reader opens a panel with the camera and can be cancelled', !document.querySelector('.cam-panel') && !document.getElementById('camPill'));
    // ---- presence lock: real camera, mocked face detector and clock, mocked lock
    const realGetJSON = window.getJSON; window.getJSON = async ep => (ep === '/lock/status' ? { enabled: true, active: true } : realGetJSON(ep));
    let clock = Date.now(), locks = 0, present = true;
    Watch.deps.now = () => clock; Watch.deps.detect = async () => present; Watch.deps.lock = async () => { locks++; };
    settings.presenceSecs = 60;
    await Watch.intercept('lock when I leave', 'text'); await sleepMs(500);
    check('Presence', 'it switches on, shows the camera indicator with the seconds, and the setting follows', Watch.presenceOn() && /PRESENCE LOCK ON/.test((document.getElementById('camPill') || {}).innerText || '') && settings.presenceLock === true);
    for (let i = 0; i < 10; i++) { clock += 2000; await Watch.presenceStep(); }
    present = false; for (let i = 0; i < 28; i++) { clock += 2000; await Watch.presenceStep(); }
    check('Presence', 'someone leaving for 56 seconds does not lock', locks === 0 && Watch.presenceOn());
    for (let i = 0; i < 3; i++) { clock += 2000; await Watch.presenceStep(); }
    check('Presence', 'after 60 seconds it locks once, and the camera and indicator are switched off', locks === 1 && !Watch.presenceOn() && !document.getElementById('camPill'));
    present = true; await Watch.intercept('lock when I leave', 'text'); await sleepMs(300);
    click('#camPill button', /STOP/);
    check('Presence', 'the STOP button on the indicator turns it off and the settings switch with it', !Watch.presenceOn() && settings.presenceLock === false && !document.getElementById('camPill'));
    Watch.deps.now = () => Date.now(); Watch.deps.detect = null; Watch.deps.lock = null; window.getJSON = realGetJSON;
    // ---- room watch: real camera and real snapshot upload, scripted movement
    const origSG = Camera.smallGray; let moving = false, kk = 0; const still = new Uint8Array(4800).fill(100);
    Camera.smallGray = () => { if (!moving) return still; const f = still.slice(); for (let i = 0; i < 400; i++) f[(kk * 450 + i) % 4800] = 230; kk++; return f; };
    let clock2 = Date.now(); Watch.deps.now = () => clock2;
    r = await say('watch my room', { confirm: 'yes', limit: 12000 });
    await sleepMs(800);
    check('Room watch', 'after the confirmation it starts, with the indicator on', Watch.roomOn() && /WATCHING THE ROOM/.test((document.getElementById('camPill') || {}).innerText || ''), r.text);
    for (let i = 0; i < 14; i++) { clock2 += 1000; await Watch.roomStep(); }
    moving = true; for (let i = 0; i < 3; i++) { clock2 += 1000; await Watch.roomStep(); }
    await sleepMs(1500);
    const alerts = [...document.querySelectorAll('#messages .msg.jarvis')].filter(m => /Movement seen in the room/.test(m.innerText));
    check('Room watch', 'three moving frames raise one alert in the chat with the name of the picture saved on this laptop', alerts.length === 1 && /Watch\/watch-\d{8}-\d{6}\.jpg/.test(alerts[0].innerText), alerts.map(m => m.innerText));
    check('Room watch', 'the picture went to the laptop\'s own server only (a snapshot upload; no phone call, since phone alerts are off)', calls.every(c => c.endpoint !== '/phone/alert'));
    r = await say('stop watching the room');
    check('Room watch', 'stopping it switches the camera and indicator off', !Watch.roomOn() && !document.getElementById('camPill') && has(r, /stopped watching/i), r.text);
    Camera.smallGray = origSG; Watch.deps.now = () => Date.now();
    // ---- speak while writing, Stop, the skill button, the archive (the chat model is a fake stream; the voice is a recorder)
    const realFetch = window.fetch.bind(window), spoken = []; let aborted = false, streamEnd = 0, t00 = 0;
    const realSpeak = speechSynthesis.speak.bind(speechSynthesis), realCancel = speechSynthesis.cancel.bind(speechSynthesis);
    speechSynthesis.speak = u => { spoken.push({ t: u.text, at: Math.round(performance.now() - t00) }); setTimeout(() => u.onend && u.onend(), 150); };
    speechSynthesis.cancel = () => {};
    let script = [];
    window.fetch = async (url, opts) => {
      if (String(url).endsWith('/chat') && opts && opts.method === 'POST') {
        aborted = false; if (opts.signal) opts.signal.addEventListener('abort', () => { aborted = true; });
        const enc = new TextEncoder();
        const body = new ReadableStream({ async start(c) { for (const p of script) { await sleepMs(350); if (aborted) { c.error(new DOMException('aborted', 'AbortError')); return; } c.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: p }, done: false }) + '\n')); } streamEnd = Math.round(performance.now() - t00); c.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n')); c.close(); } });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      return realFetch(url, opts);
    };
    settings.persona = 'jarvis'; settings.voice = '';   // FRIDAY speaks through the online neural voice (a network clip), which this recorder does not see
    settings.tts = true; settings.llm = true; llm.online = true; llm.warm = true; llm.model = llm.model || 'qwen3.5:4b';   // llmReady() needs a model name; the chat answers below come from a fake stream
    script = ['The moon is Earth’s only natural satellite. ', 'It orbits us roughly every 27 days. ', 'Its gravity causes the ocean tides. ', 'Astronauts last walked on it in 1972.'];
    t00 = performance.now(); spoken.length = 0;
    await idle(8000); ctx.pending = null;
    await handleUser('tell me something interesting about the moon', 'text'); await sleepMs(600);
    check('Speak while writing', 'the first sentence is spoken while the answer is still being written, then the rest in order', spoken.length >= 3 && spoken[0].t.startsWith('The moon is Earth') && spoken[0].at < streamEnd && spoken.map(s => s.at).every((a, i, arr) => !i || a >= arr[i - 1]), { spoken, streamEnd, lang: Lang.replyLang(), tts: settings.tts, sww: settings.speakWhileWriting, persona: settings.persona, voice: settings.voice, synth: 'speechSynthesis' in window, q: speechQueue.active });
    script = Array.from({ length: 12 }, (_, i) => 'This is sentence number ' + (i + 1) + ' of a long story. ');
    spoken.length = 0; t00 = performance.now();
    const longTurn = handleUser('tell me a very long story about a dragon', 'text');
    await sleepMs(1900);
    const during = { busy, stopShown: !document.getElementById('stopBtn').hidden };
    await handleUser('stop', 'text'); await longTurn.catch(() => {}); await sleepMs(900);
    const nAfter = spoken.length; await sleepMs(900);
    check('Stop', 'while JARVIS is writing and speaking the STOP button is visible; saying "stop" aborts the answer, silences the voice, and the button goes away', during.busy && during.stopShown && aborted && spoken.length === nAfter && !busy && document.getElementById('stopBtn').hidden, { during, aborted, nAfter, now: spoken.length });
    r = await say('stop');
    check('Stop', 'when nothing is happening, "stop" is an ordinary word again (nothing to cancel)', has(r, /nothing to cancel/i), r.text);
    await Skills.loadPacks(); SkillRouter.reset(); script = ['Sure. Paste the function and I will look for bugs.'];
    r = await say('please review my code and point out any bugs in the function', { limit: 12000 });
    check('Skills', 'a message that fits a skill gets a "USE THE CODE-REVIEW SKILL" button under the answer, and the answer itself is not delayed', has(r, /USE THE CODE-REVIEW SKILL/) && has(r, /look for bugs/), r.text);
    settings.tts = false; speechSynthesis.speak = realSpeak; speechSynthesis.cancel = realCancel;
    // archive: what was said above is saved, searchable, and can be erased
    await Extras.archiveFlush();
    let st = await (await realFetch('api/chatarchive/status')).json();
    check('Chat archive', 'the messages of this session were saved by the server (one monthly file)', st.success && st.messages >= 4 && st.files.length >= 1, st);
    r = await say('what did I ask about the dragon story', { limit: 15000 });
    check('Chat archive', 'a question about an old chat finds it, with the date', has(r, /1 conversation|conversations/) && has(r, /dragon/i), r.text);
    r = await say('forget my chat archive', { confirm: 'yes', limit: 15000 });
    st = await (await realFetch('api/chatarchive/status')).json();
    check('Chat archive', 'forgetting it (after a confirmation) erases everything', st.messages === 0 && has(r, /Erased the chat archive/), r.text);
    window.fetch = realFetch;
    // ---- timetable import from text, bunking, undo
    const before = classes.length;
    r = await say('import my timetable: Mon 9-10 DBMS; Tue 10-11 OS', { confirm: 'yes', limit: 12000 });
    check('Timetable', 'importing from text shows what it read, asks, and adds the two classes', has(r, /2 classes/) && classes.length === before + 2 && classes.filter(c => c.batch).length === 2 && classes.some(c => c.name === 'DBMS' && c.day === 1 && c.h === 9), r.text);
    r = await say('undo');
    check('Timetable', 'one "undo" removes exactly the imported classes', classes.length === before && has(r, /Removed the 2 classes/), r.text);
    // ---- exam mode and lecture mode (the AI parts are fakes)
    FAKE['/exam/questions'] = b => ({ success: true, questions: [1, 2, 3].map(i => ({ q: 'E2E question ' + i + '?', a: 'E2E model answer ' + i + '.' })), topic: '', file: 'Notes/e2e_notes.md', fromNotes: true });
    FAKE['/skill/viva/grade'] = b => ({ success: true, score: /question 1/.test(b.question) ? 9 : 3, feedback: 'ok', missed: ['a point'], model: 'x' });
    llm.online = true; settings.llm = true; llm.model = llm.model || 'qwen3.5:4b';
    r = await say('start an exam on e2e_notes.md with 3 questions', { limit: 12000 });
    check('Exam', 'it starts from a note: question 1 is shown with the rules', has(r, /Exam on e2e_notes\.md/) && has(r, /Question 1 of 3/) && Student.active(), r.text);
    await say('first answer text here', { limit: 8000 }); await say('second answer text here', { limit: 8000 });
    r = await say('third answer text here', { limit: 30000 });
    check('Exam', 'after the last answer it is marked, the result is shown, weak answers go to the Mistakes deck, and it is kept in history', has(r, /Exam result: 5\d%/) && !Student.active() && flashcards.filter(c => c.deck === 'Mistakes').length === 2 && store.get('jarvis.exams', []).length === 1, r.text);
    r = await say('how did my exams go?'); check('Exam', 'the history lists it', has(r, /Your exams/) && has(r, /e2e_notes\.md/), r.text);
    delete FAKE['/exam/questions']; delete FAKE['/skill/viva/grade'];
    FAKE['/lecture/notes'] = b => ({ success: true, file: 'Notes/lecture-e2e-notes.md', name: 'lecture-e2e-notes.md', preview: '# E2E\n\n## Notes\n- a point', chunks: 1, truncated: 0, seconds: 1 });
    r = await say('start lecture mode for E2E', { confirm: 'yes', limit: 12000 });
    await sleepMs(1200);
    check('Lecture', 'it starts listening (the fake recogniser is running) and shows the microphone indicator', has(r, /Lecture mode is on/) && !!(window.__sr && window.__sr.active) && /MIC ON/.test((document.getElementById('camPill') || {}).innerText || ''), { r: r.text, active: !!(window.__sr && window.__sr.active) });
    window.__srSay('Normalization reduces redundancy in relational tables and improves integrity of the data.', true);
    window.__srSay('Boyce Codd normal form is a stricter version of third normal form used in database design.', true);
    await sleepMs(300);
    const w0 = calls.length;
    r = await say('stop the lecture', { limit: 20000 });
    check('Lecture', 'stopping saves the transcript (appended, in the notes folder on the isolated server), asks for notes, and shows them', calls.slice(w0).some(c => c.endpoint === '/tool/writeFile' && c.data.append === true && /Normalization reduces/.test(c.data.content)) && calls.slice(w0).some(c => c.endpoint === '/lecture/notes' && /Boyce Codd/.test(c.data.transcript)) && has(r, /Notes saved to/) && !document.getElementById('camPill'), r.text);
    delete FAKE['/lecture/notes'];
  }
  T.done = true;
})().catch(e => { window.__selftest.results.push({ feature: 'Harness', desc: 'self-test ran to the end', ok: false, detail: String(e && e.stack || e) }); window.__selftest.done = true; });
