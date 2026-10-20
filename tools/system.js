'use strict';
/* executeTool, system: power, volume and media, system info, laptop controls, panic mode, themes and persona, reading the screen.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('system', async function (p, raw, s, a) {
  // A call that failed is reported as a failure (ok = false), never as the success line.
  const failed = (what, r) => ({ text: 'I couldn’t ' + what + ': ' + r.error, error: r.error });
  switch (p.intent) {
    /* ---- power ---- */
    case 'LOCK_JARVIS': {   // "lock jarvis" / "lock yourself": JARVIS's own lock (not the Windows screen)
      const st = await getJSON('/lock/status');
      if (!st.active) return { text: st.enabled ? 'The lock needs Windows Hello, ' + Persona.sir() + ' — turn on **Settings → Data → Require Windows Hello** first.'
        : 'The app lock is off, ' + Persona.sir() + '. Turn on **Settings → Data → Lock JARVIS** and JARVIS will open only after Windows Hello.', tool: 'lockJarvis' };
      toolStep('lockJarvis');
      await callTool('/lock/lock');
      setTimeout(() => location.reload(), 900);   // the server now serves the lock page
      return { text: 'Locking JARVIS. Windows Hello will open it again.', speak: 'Locked.', tool: 'lockJarvis' };
    }
    case 'SYS_LOCK': { toolStep('lockSystem'); const r = await callTool('/tool/lockSystem'); return r.error ? failed('lock the screen', r) : { text: 'Locking your screen.', tool: 'lockSystem' }; }
    case 'SYS_SLEEP':
      return confirmPower('Put the computer to sleep now?', 'YES — SLEEP', () => withHello('power', async tok => { toolStep('sleepSystem'); const r = await callTool('/tool/sleepSystem', {}, tok); jarvisSay(r.error ? { text: cap(r.error) + '.', intent: 'SYS_SLEEP' } : { text: 'Goodnight.', intent: 'SYS_SLEEP' }); }));
    case 'SYS_SHUTDOWN':
      log('warn', 'shutdown requested — awaiting confirmation');
      return confirmPower('Shut down the computer? Unsaved work in other apps will be lost.', 'YES — SHUT DOWN', () => withHello('power', async tok => { toolStep('shutdownSystem'); const r = await callTool('/tool/shutdownSystem', {}, tok); jarvisSay(r.error ? { text: cap(r.error) + '.', intent: 'SYS_SHUTDOWN' } : { text: 'Shutting down in ' + (r.seconds || 30) + ' seconds. Say "cancel shutdown" to abort.', intent: 'SYS_SHUTDOWN', suggestions: ['Cancel shutdown'] }); }));
    case 'SYS_RESTART':
      return confirmPower('Restart the computer?', 'YES — RESTART', () => withHello('power', async tok => { toolStep('restartSystem'); const r = await callTool('/tool/restartSystem', {}, tok); jarvisSay(r.error ? { text: cap(r.error) + '.', intent: 'SYS_RESTART' } : { text: 'Restarting in ' + (r.seconds || 30) + ' seconds. Say "cancel shutdown" to abort.', intent: 'SYS_RESTART', suggestions: ['Cancel shutdown'] }); }));
    case 'SYS_CANCEL_SHUTDOWN': {
      toolStep('cancelShutdown'); const r = await callTool('/tool/cancelShutdown');
      if (r.error) return failed('cancel the shutdown', r);
      return { text: r.nothingPending ? 'There was no shutdown or restart pending — your system stays on.' : 'Cancelled. Your system stays on.', tool: 'cancelShutdown' };
    }

    /* ---- volume & media ---- */
    case 'VOLUME_MUTE': {
      const action = a.action || (/\bunmute\b|\b(sound|audio|volume) on\b/.test(s) ? 'unmute' : 'mute');
      toolStep('setVolume → ' + action); const r = await callTool('/tool/setVolume', { action });
      if (r.error) return failed(action === 'mute' ? 'mute the sound' : 'turn the sound back on', r);
      Undo.push(action === 'mute' ? 'muted' : 'unmuted', async () => { await callTool('/tool/setVolume', { action: action === 'mute' ? 'unmute' : 'mute' }); return action === 'mute' ? 'Sound is back on.' : 'Muted again.'; });
      return { text: action === 'mute' ? 'Muted.' : 'Sound back on.', noTTS: action === 'mute', tool: 'setVolume' };
    }
    case 'VOLUME_UP':
    case 'VOLUME_DOWN': {
      const up = p.intent === 'VOLUME_UP';
      const steps = /\b(a lot|way|max|much|full)\b/.test(s) ? 20 : /\b(a (little|bit)|slightly|tad)\b/.test(s) ? 2 : 5;
      toolStep('setVolume → ' + (up ? 'up' : 'down')); const r = await callTool('/tool/setVolume', { action: up ? 'up' : 'down', steps });
      if (r.error) return failed('turn the volume ' + (up ? 'up' : 'down'), r);
      Undo.push(up ? 'volume up' : 'volume down', async () => { await callTool('/tool/setVolume', { action: up ? 'down' : 'up', steps }); return 'Volume put back (' + (up ? 'down' : 'up') + ').'; });
      return { text: up ? 'Volume up.' : 'Volume down.', tool: 'setVolume' };
    }
    case 'MEDIA_PLAY': { toolStep('mediaKey → play'); const r = await callTool('/tool/mediaKey', { key: 'play' }); return r.error ? failed('send the media key', r) : { text: 'Toggled play/pause.', noTTS: true, tool: 'mediaKey' }; }
    case 'MEDIA_NEXT': { toolStep('mediaKey → next'); const r = await callTool('/tool/mediaKey', { key: 'next' }); return r.error ? failed('send the media key', r) : { text: 'Next track.', noTTS: true, tool: 'mediaKey' }; }
    case 'MEDIA_PREV': { toolStep('mediaKey → prev'); const r = await callTool('/tool/mediaKey', { key: 'prev' }); return r.error ? failed('send the media key', r) : { text: 'Previous track.', noTTS: true, tool: 'mediaKey' }; }
    case 'MEDIA_STOP': { toolStep('mediaKey → stop'); const r = await callTool('/tool/mediaKey', { key: 'stop' }); return r.error ? failed('send the media key', r) : { text: 'Stopped playback.', noTTS: true, tool: 'mediaKey' }; }

    /* ---- system info ---- */
    case 'SCREENSHOT': {
      toolStep('screenshot'); setState('EXECUTING', 'Capturing screen…');
      const r = await callTool('/tool/screenshot');
      return r.error ? { text: 'Screenshot failed: ' + r.error } : { text: 'Screenshot saved: `' + r.path + '`', speak: 'Screenshot saved to your desktop.', tool: 'screenshot' };
    }
    case 'SYS_BATTERY': {
      toolStep('batteryStatus');
      const r = await callTool('/tool/batteryStatus');
      if (r.error) return { text: 'I couldn’t read the battery: ' + r.error, error: r.error };
      if (r.level === null || r.level === undefined) return { text: 'No battery detected — looks like a desktop or it is not reporting.' };
      const low = Thresholds.isBatteryLow(r.level, r.status) ? ' That is low — plug in soon.' : '';
      return { text: 'Battery is at **' + r.level + '%** and ' + r.status.toLowerCase() + '.' + low, tool: 'batteryStatus' };
    }
    case 'SYS_PROCESSES': {
      toolStep('listProcesses');
      const r = await callTool('/tool/listProcesses');
      if (!r.processes || !r.processes.length) return { text: 'I could not read the process list.' };
      return { text: 'Top processes by memory:\n' + r.processes.slice(0, 6).map(x => '- **' + x.Name + '** — ' + x.RAM_MB + ' MB').join('\n'), speak: 'The biggest memory users are ' + r.processes.slice(0, 3).map(x => x.Name).join(', ') + '.', tool: 'listProcesses' };
    }
    case 'SYS_CPU': case 'SYS_RAM': case 'SYS_DISK': case 'SYS_OS': case 'SYS_ALL': {
      toolStep('getSystemInfo');
      if (!(await refreshSystem())) return { text: 'I cannot read system stats — the backend is offline.' };
      ctx.lastIntent = p.intent;
      if (p.intent === 'SYS_CPU') return { text: 'CPU usage is **' + sys.cpu + '%** across ' + sys.cpus + ' threads (' + sys.cpuModel.trim() + ').', speak: 'CPU usage is ' + sys.cpu + ' percent.' };
      if (p.intent === 'SYS_RAM') return { text: 'You are using **' + sys.ramUsed + ' GB of ' + sys.ramTotal + ' GB** RAM (' + sys.ram + '%).' + (sys.ram > 85 ? ' That is high — want to see the top processes?' : ''), suggestions: sys.ram > 85 ? ['What are the top processes?'] : null };
      if (p.intent === 'SYS_DISK') return { text: 'Your home drive has **' + sys.diskFree + ' GB free** (' + sys.diskUsed + '% used).' };
      if (p.intent === 'SYS_OS') return { text: 'You are running **' + sys.osName + '** on ' + sys.cpuModel.trim() + '.' };
      const verdict = sys.cpu > 85 || sys.ram > 90 ? 'Under heavy load.' : sys.cpu > 60 || sys.ram > 80 ? 'Working fairly hard.' : 'Running smoothly.';
      return { text: verdict + ' CPU **' + sys.cpu + '%**, RAM **' + sys.ram + '%** (' + sys.ramUsed + '/' + sys.ramTotal + ' GB), disk **' + sys.diskFree + ' GB** free.', card: [['OS', sys.osName], ['CPU', sys.cpuModel.trim()], ['UPTIME', Math.floor(sys.uptime / 60) + 'h ' + sys.uptime % 60 + 'm']] };
    }
    case 'SYS_NETWORK': {
      toolStep('networkInfo');
      const r = await callTool('/tool/networkInfo');
      return r.error ? { text: r.error } : { text: 'Local IP **' + r.ip + '** on ' + r.interface + '. Hostname: `' + r.hostname + '`.', speak: 'Your local IP is ' + r.ip, tool: 'networkInfo' };
    }

    /* ---- laptop controls ---- */
    case 'BRIGHTNESS': {
      const num = s.match(/\b(\d{1,3})\s*(%|percent)?\b/);
      let body = {};
      if (a.level !== undefined) body.level = +a.level;
      else if (num) body.level = +num[1];
      else if (/\b(max|maximum|full|highest)\b/.test(s)) body.level = 100;
      else if (/\b(min|minimum|lowest)\b/.test(s)) body.level = 10;
      else if (/\b(brighter|brighten|up|increase|raise|more|too dark)\b/.test(s)) body.delta = 20;
      else if (/\b(dim|dimmer|darker|down|decrease|lower|less|too bright)\b/.test(s)) body.delta = -20;
      toolStep('brightness');
      const r = await callTool('/sys/brightness', body);
      if (r.error) return { text: cap(r.error) + '.' };
      if (typeof r.previous === 'number' && r.previous !== r.level) Undo.push('brightness ' + r.level + '%', async () => { const x = await callTool('/sys/brightness', { level: r.previous }); if (x.error) throw new Error(x.error); return 'Brightness is back to ' + x.level + '%.'; });
      return body.level === undefined && body.delta === undefined
        ? { text: 'Screen brightness is at **' + r.level + '%**.' }
        : { text: 'Brightness set to **' + r.level + '%**.', tool: 'brightness' };
    }
    case 'DARK_MODE': {
      const mode = a.on === false || a.on === 'false' || /\blight\b/.test(s) ? 'light' : 'dark';
      toolStep('theme → ' + mode);
      const was = await callTool('/sys/theme', {});
      const r = await callTool('/sys/theme', { mode });
      if (r.error) return { text: 'Could not change the Windows theme: ' + r.error };
      if (was && was.mode && was.mode !== r.mode) Undo.push(r.mode + ' mode', async () => { const x = await callTool('/sys/theme', { mode: was.mode }); if (x.error) throw new Error(x.error); return 'Windows is back in ' + x.mode + ' mode.'; });
      return { text: 'Windows is now in **' + r.mode + ' mode**.', tool: 'darkMode' };
    }
    case 'RADIO': {
      const kind = /\bbluetooth\b/.test(s) ? 'bluetooth' : 'wifi';
      const label = kind === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
      const state = /\b(off|disable|disabled)\b/.test(s) ? 'off' : /\b(on|enable|enabled)\b/.test(s) && !/^is\b/.test(s) ? 'on' : '';
      const doIt = async () => { toolStep('radio → ' + kind + ' ' + (state || 'status')); return callTool('/sys/radio', { kind, state }); };
      if (kind === 'wifi' && state === 'off') {
        return { text: 'Turn **Wi-Fi off**? Online tools, weather and web search will stop until it is back on.', confirm: { yes: 'TURN OFF', no: 'CANCEL', onConfirm: async () => { const r = await doIt(); jarvisSay({ text: r.error ? 'Could not: ' + r.error : 'Wi-Fi is off. Say "turn on wifi" to reconnect.', intent: 'RADIO' }); } } };
      }
      const r = await doIt();
      if (r.error) return { text: 'Could not control ' + label + ': ' + r.error };
      return { text: label + ' is **' + r.state + '**.', tool: 'radio' };
    }
    case 'POWER_PLAN': {
      const want = /\b(saver|battery|eco|optimi[sz]er)\b/.test(s) ? 'saver' : /\bbalanced\b/.test(s) ? 'balanced' : /\b(performance|high|turbo|ultimate)\b/.test(s) ? 'performance' : '';
      toolStep('powerPlan ' + (want || 'list'));
      const r = await callTool('/sys/powerPlan', { plan: want });
      if (r.error) return { text: r.error + '.' };
      const names = [...new Set((r.plans || []).map(x => x.name))];
      return want ? { text: 'Power plan switched to **' + r.active + '**.', tool: 'powerPlan' }
        : { text: 'You are on the **' + r.active + '** power plan. Available: ' + names.join(', ') + '.', suggestions: names.filter(n => n !== r.active).map(n => 'Switch to ' + n.toLowerCase() + ' power plan') };
    }
    case 'VOLUME_SET': {
      const num = s.match(/\b(\d{1,3})\b/);
      const WORD_LEVEL = { max: 100, maximum: 100, full: 100, half: 50, min: 0, minimum: 0, zero: 0 };
      const wordMatch = !num && s.match(/\b(max(?:imum)?|full|half|min(?:imum)?|zero)\b/);
      const level = a.level !== undefined ? +a.level : num ? +num[1] : wordMatch ? WORD_LEVEL[wordMatch[1]] : undefined;
      toolStep('volume ' + (level === undefined ? 'read' : level));
      const before = level === undefined ? null : await callTool('/sys/volume', {});
      const r = await callTool('/sys/volume', level === undefined ? {} : { level });
      if (!r.error && before && typeof before.level === 'number') Undo.push('set volume to ' + r.level + '%', async () => { const x = await callTool('/sys/volume', { level: before.level }); if (x.error) throw new Error(x.error); return 'Volume is back to ' + x.level + '%.'; });
      if (r.error) return { text: 'Could not reach the audio device: ' + r.error };
      return level === undefined ? { text: 'Volume is at **' + r.level + '%**.' } : { text: 'Volume set to **' + r.level + '%**.', noTTS: r.level === 0, tool: 'volume' };
    }
    case 'DISPLAY_OFF':
      return { text: 'Turn the display off? Move the mouse or press a key to wake it.', confirm: { yes: 'TURN OFF', no: 'CANCEL', onConfirm: () => {
        toolStep('displayOff'); setTimeout(() => callTool('/sys/displayOff', {}), 1500);
        jarvisSay({ text: 'Display off.', intent: 'DISPLAY_OFF', tool: 'display' });
      } } };
    case 'WINDOW_LAYOUT': return arrangeWindows(s, a);
    case 'CLIP_HISTORY': return clipHistory(s);
    case 'CHARGER_ALERTS': {
      const off = /\b(stop|don't|dont|do not|disable[sd]?|turn off|switch off|mute[sd]?|silence[sd]?|off|no)\b/i.test(s);
      settings.chargerAlerts = !off; saveSettings(); bindSwitchState('#chargerAlertsToggle', 'chargerAlerts');
      log('info', 'charger alerts ' + (off ? 'off' : 'on'));
      return off ? { text: 'Charger announcements off, ' + Persona.sir() + ' — I’ll stay quiet when you plug or unplug.', speak: 'Charger announcements off.', tool: 'chargerAlerts' }
        : { text: 'Done, ' + Persona.sir() + ' — I’ll say when the charger is connected or disconnected.', speak: 'I will announce charger changes.', tool: 'chargerAlerts' };
    }
    /* ---- panic mode ---- */
    case 'PANIC_ON': {
      if (store.get('jarvis.panic', false)) return { text: 'Panic mode is already on, ' + Persona.sir() + '. Nothing is running.' };
      store.set('jarvis.panic', true); renderPanic();
      return { text: '⚠️ **Panic mode on.** All automation is paused — triggers, scheduled routines, deadline and smart alerts. Your reminders still fire, silently. Say "resume" (or click the ⚠ PANIC pill) when it is over.', tool: 'panic' };
    }
    case 'PANIC_OFF': {
      if (!store.get('jarvis.panic', false)) return { text: 'Nothing is paused, ' + Persona.sir() + ' — automation is already running normally.' };
      store.set('jarvis.panic', false); renderPanic();
      return { text: 'Resumed. Triggers, alerts and scheduled routines are live again, ' + Persona.sir() + '.', tool: 'panic' };
    }

    /* ---- themes, persona, diagnostics ---- */
    case 'THEME_SET': {
      if (/\b(stand down|cancel)\b/.test(s)) { await switchTheme(settings.prevTheme && settings.prevTheme !== 'crimson' ? settings.prevTheme : 'arc'); return { text: 'Standing down, ' + Persona.sir() + '. Back to normal.', tool: 'theme' }; }
      const t = a.theme || (/\bred alert\b|\b(red|crimson)\b/.test(s) ? 'crimson' : /\b(gold|golden|mark ?85)\b/.test(s) ? 'gold' : /\b(violet|purple)\b/.test(s) ? 'violet' : /\b(arc|blue|cyan|default|normal)\b/.test(s) ? 'arc' : null);
      if (!THEMES[t]) return { text: 'Which theme, ' + Persona.sir() + '? Arc reactor blue, Mark 85 gold, crimson or violet.', suggestions: ['Gold theme', 'Crimson theme', 'Violet theme', 'Arc reactor blue theme'] };
      if (t === 'crimson' && settings.theme !== 'crimson') settings.prevTheme = settings.theme;
      await switchTheme(t);
      // The alarm/block-distractions action itself is now generic (THEME_ACTIONS.crimson, fires for "crimson
      // theme" and the dropdown too) — this branch only controls the distinct spoken wording for the literal phrase.
      if (/\bred alert\b/.test(s)) { return { text: 'Red alert, ' + Persona.sir() + '. All systems on standby.', speak: 'Red alert. All systems on standby.', suggestions: ['Stand down alert'], tool: 'theme' }; }
      return { text: THEMES[t].label + ' theme engaged, ' + Persona.sir() + '.', tool: 'theme' };
    }
    case 'PERSONA_SET': {
      const who = a.persona || (/\bfriday\b/.test(s) ? 'friday' : 'jarvis');
      if (settings.persona === who) return { text: (who === 'friday' ? 'FRIDAY' : 'JARVIS') + ' is already at your service, ' + Persona.sir() + '.' };
      applyPersona(who);
      return who === 'friday'
        ? { text: 'FRIDAY here, ' + Persona.sir() + '. JARVIS is taking five — what do you need?', tool: 'persona', noPersona: true }
        : { text: 'JARVIS back online, ' + Persona.sir() + '. I trust FRIDAY kept things tidy.', tool: 'persona', noPersona: true };
    }
    case 'DIAGNOSTICS': return runDiagnostics();
    case 'SYSTEM_STATE': return systemState();
    case 'AGENT_HISTORY': return Agent.history();

    /* ---- read my screen ---- */
    case 'SCREEN_READ':
    case 'SCREEN_EXPLAIN':
    case 'CLIPBOARD_IMAGE_READ': {
      const clip = p.intent === 'CLIPBOARD_IMAGE_READ';
      const explain = p.intent === 'SCREEN_EXPLAIN' || a.explain === true || a.explain === 'true' || (clip && /\b(explain|describe|fix|solve|summari[sz]e|debug|translate|what does|what'?s wrong|what'?s in|what is in)\b/.test(s));
      const whole = /\b(whole|entire|full|all of (my|the)) screen\b/.test(s);
      // "analyse my second tab": a numbered tab is opened by JARVIS itself (Ctrl+<n> in this browser), read, and then
      // JARVIS's tab is brought back. If that can't be done (browser not in front, e.g. asked from the phone), you
      // switch during a countdown instead.
      const tab = /\b(tab|browser|web ?page)\b/.test(s);
      const nth = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8 }[(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th)\b(?: browser)? tab\b/.exec(s) || [])[1]]
        || +((/\btab\s*(?:no\.?|number|#)?\s*([1-8])\b/.exec(s) || [])[1] || 0) || 0;
      let auto = false;
      if (!clip && nth && document.title) {
        const g = await callTool('/sys/browserTab', { mode: 'go', n: nth, expect: document.title });
        if (g.ok && g.title && g.title.includes(document.title)) return { text: 'Tab ' + nth + ' is JARVIS itself, ' + Persona.sir() + '. Which other tab should I read?' };
        auto = !!g.ok;
      }
      const wait = auto ? 0 : tab ? 8 : 3;
      if (!clip && !auto) {
        jarvisSay({ text: (tab ? 'Bring your browser forward and open that tab' + (nth ? ' (**Ctrl+' + nth + '** jumps to tab ' + nth + ')' : '') : 'Switch to the window you want me to read') + ', ' + Persona.sir() + ' — capturing in ' + wait + ' seconds.',
          speak: 'Capturing in ' + wait + ' seconds.', intent: 'SCREEN_READ', noLog: true });
        Array.from({ length: wait }, (_, i) => wait - i).forEach((n, i) => setTimeout(() => toast('Reading your screen in ' + n + '…', true), i * 1000));
      }
      toolStep('screenRead');
      const wantVision = explain && llmReady();
      const r = await callTool('/sys/screenRead', { source: clip ? 'clipboard' : whole ? 'screen' : 'window', delay: clip ? 0 : wait, vision: wantVision });
      if (auto) await callTool('/sys/browserTab', { mode: 'back', expect: document.title }); // bring JARVIS's tab back
      if (r.error) return { text: cap(r.error) + '.' };
      // Still on JARVIS's own window when the capture fired: reading it would only describe JARVIS (and guess from tab names).
      if (!clip && !whole && r.title && document.title && r.title.includes(document.title)) return { text: 'I captured my own window, ' + Persona.sir() + ' — you were still on JARVIS. Say it again, then switch to ' + (tab ? 'that tab' : 'the window') + ' within ' + wait + ' seconds.', speak: 'I captured my own window. Try again and switch within ' + wait + ' seconds.', suggestions: [raw] };
      const text = (r.text || '').trim();
      const where = clip ? 'copied image' : 'screen';
      const titleNote = r.title ? ' The captured window is titled "' + r.title + '".' : '';
      const honest = '\nDescribe only what is actually visible. If you do not know what a site or app is, say so instead of guessing, and do not offer actions you cannot do.';
      // With vision, the local model sees the screenshot itself (charts, UI, images), and the OCR text is added
      // as a hint for exact wording. Without vision (or text-only models), it's the OCR text alone, as before.
      if (wantVision && r.imageToken) return { askLLM: raw + '\n\nThe attached image is a screenshot of my ' + where + '.' + titleNote +
        (text ? ' Text read from it by OCR (may contain small errors):\n```\n' + text.slice(0, 6000) + '\n```' : '') + honest + '\nAnswer my request about it.', imageToken: r.imageToken };
      if (!text) return { text: 'I could not find any readable text there, ' + Persona.sir() + '. (I read English text only.)' };
      ctx.lastOcr = text;
      if (wantVision) return { askLLM: raw + '\n\nHere is the text captured from my ' + where + ' (via OCR, so it may contain small errors).' + titleNote + '\n```\n' + text.slice(0, 8000) + '\n```' + honest + '\nAnswer my request about it.' };
      return { text: 'Read ' + plural(r.lines, 'line') + ' from your ' + (clip ? 'copied image' : whole ? 'screen' : 'window') + ':\n```text\n' + text.slice(0, 4000) + (text.length > 4000 ? '\n…' : '') + '\n```\n_Read locally with Windows OCR — the capture was deleted straight away._',
        speak: 'I read ' + plural(r.lines, 'line') + ' of text. It is on screen.', tool: 'screenRead',
        actions: [{ label: 'COPY TEXT', fn: async () => { await copyText(text); toast('Copied'); } }, { label: 'EXPLAIN IT', fn: () => handleUser('explain the text you just read from my screen', 'chip') }] };
    }

    default: return ToolHandlers.NONE;
  }
});
