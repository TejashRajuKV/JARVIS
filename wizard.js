'use strict';
/* Guided setup for non-technical users: pick an AI (free online / on this computer / your own key) and set up the
   phone — one plain step per screen. Uses the page's own helpers (callTool, checkLLM, settings, ...). */
const Wizard = (() => {
  const $w = s => document.querySelector(s);
  let root = null, screen = 'welcome', busy = false;

  const LINKS = {
    gemini: 'https://aistudio.google.com/apikey',
    groq: 'https://console.groq.com/keys',
    ollama: 'https://ollama.com/download',
    ntfyAndroid: 'https://play.google.com/store/apps/details?id=io.heckel.ntfy',
    ntfyIos: 'https://apps.apple.com/app/ntfy/id1625396347',
    authAndroid: 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2',
    authIos: 'https://apps.apple.com/app/google-authenticator/id388497605',
  };
  const a = (href, text) => '<a class="wz-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  const qrSvg = text => {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); }
    catch (e) { return '<div class="wz-err">Couldn’t draw the code — type the details shown instead.</div>'; }
  };

  function ensure() {
    if (root) return;
    root = document.createElement('div'); root.id = 'wizard'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="wz-card"><button class="wz-x" aria-label="Close" title="Close">✕</button><div class="wz-body"></div></div>';
    document.body.appendChild(root);
    root.querySelector('.wz-x').onclick = () => close(true);
    root.addEventListener('mousedown', e => { if (e.target === root) close(true); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('open')) close(true); });
  }
  function open(which) { ensure(); root.classList.add('open'); go(which || 'welcome'); }
  function close(skipped) {
    if (!root) return;
    root.classList.remove('open');
    if (skipped && !settings.setupDone) { settings.setupDone = true; saveSettings(); }
  }
  const body = () => root.querySelector('.wz-body');
  const setBody = html => { body().innerHTML = html; };
  const back = to => '<button class="wz-back" data-go="' + to + '" type="button">← Back</button>';
  function bindGo() { body().querySelectorAll('[data-go]').forEach(b => { b.onclick = () => go(b.dataset.go); }); }

  function go(name) {
    screen = name; busy = false;
    ({ welcome, free, own, local, done, phone1, phone2, phone3, phone4 }[name] || welcome)();
    bindGo();
    const f = body().querySelector('input'); if (f) f.focus();
  }

  /* ---------- AI: choose ---------- */
  function welcome() {
    setBody('<h2>Let’s get JARVIS thinking</h2><p class="wz-sub">JARVIS needs an AI to answer questions. Pick the easiest option for you — you can change it any time in Settings.</p>' +
      '<button class="wz-choice" data-go="free"><span class="wz-ic">☁</span><span><b>Free online AI</b><small>Easiest · takes 2 minutes · needs a Google account · your questions go to Google</small></span></button>' +
      '<button class="wz-choice" data-go="local"><span class="wz-ic">🔒</span><span><b>Private, on this computer</b><small>Works offline · nothing leaves your laptop · one-time 3 GB download</small></span></button>' +
      '<button class="wz-choice" data-go="own"><span class="wz-ic">🔑</span><span><b>I already have an AI key</b><small>ChatGPT / OpenAI, Claude, Gemini, Groq, OpenRouter…</small></span></button>' +
      '<div class="wz-foot"><button class="wz-link-btn" data-go="phone1" type="button">📱 Set up my phone instead</button> <button class="wz-link-btn" id="wzSkip" type="button">Skip for now</button></div>');
    $w('#wzSkip').onclick = () => close(true);
  }

  /* ---------- AI: paste a key ---------- */
  function keyScreen(o) {
    setBody(back('welcome') + '<h2>' + o.title + '</h2><ol class="wz-steps">' + o.steps.map(s => '<li>' + s + '</li>').join('') + '</ol>' +
      '<input type="password" id="wzKey" class="wz-input" placeholder="Paste your key here" autocomplete="off" spellcheck="false">' +
      (o.other ? '<details class="wz-more"><summary>My key isn’t recognised / other provider</summary>' +
        '<select id="wzPreset" class="wz-input">' + providerPresets.filter(p => p.id !== 'auto').map(p => '<option value="' + p.id + '">' + escHtml(p.label) + '</option>').join('') + '</select>' +
        '<input type="text" id="wzUrl" class="wz-input" placeholder="Server address (Custom only), e.g. http://127.0.0.1:1234/v1" spellcheck="false"></details>' : '') +
      '<div class="wz-row"><button class="wz-primary" id="wzConnect" type="button">Connect</button><span id="wzMsg" class="wz-msg"></span></div>' +
      '<p class="wz-fine">Your key is saved only on this laptop and is never shown in full again.</p>');
    bindGo();
    const key = $w('#wzKey'); let t; key.focus();
    // Pasting is the whole task: connect automatically a moment after a full-looking key lands in the box.
    key.addEventListener('input', () => { clearTimeout(t); if (key.value.trim().length >= 20) t = setTimeout(connect, 500); });
    $w('#wzConnect').onclick = connect;
    key.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
    async function connect() {
      if (busy) return; const v = key.value.trim();
      const msg = $w('#wzMsg');
      if (!v) { msg.className = 'wz-msg err'; msg.textContent = 'Paste the key first.'; return; }
      busy = true; msg.className = 'wz-msg'; msg.textContent = 'Checking your key…';
      const sel = $w('#wzPreset'), det = sel && sel.closest('details');
      const useOther = det && det.open;
      const r = await callTool('/llm/providers', { preset: useOther ? sel.value : 'auto', apiKey: v, baseUrl: useOther ? $w('#wzUrl').value.trim() : '', model: '' });
      busy = false;
      if (r.error) { msg.className = 'wz-msg err'; msg.textContent = friendly(r.error); return; }
      key.value = '';
      if (r.defaultModel) { settings.model = r.defaultModel; saveSettings(); }
      llm.warm = false; await checkLLM(); if (typeof renderProviders === 'function') renderProviders();
      sfx.ok(); log('ok', 'AI provider added: ' + r.provider.label);
      done(r.provider.label, r.defaultModel);
    }
  }
  // Plain-English versions of the common failures.
  function friendly(e) {
    if (/rejected the API key|401/.test(e)) return 'That key was refused. Make sure you copied the whole key with nothing extra, then paste it again.';
    if (/recognise/.test(e)) return e;
    if (/429|credit|rate/.test(e)) return 'The key works, but the account is out of free credit or has hit its limit. Try again later or add billing on the provider’s site.';
    if (/unreachable|ENOTFOUND|fetch failed|timeout/i.test(e)) return 'Couldn’t reach the internet. Check your connection and try again.';
    return e;
  }
  function free() {
    keyScreen({ title: 'Free online AI (Google Gemini)', other: false, steps: [
      a(LINKS.gemini, 'Click here to open Google’s key page') + ' and sign in with your Google account.',
      'Click <b>Create API key</b>, then <b>Copy</b>.',
      'Come back and paste it below — that’s it.'] });
    const p = body().querySelector('.wz-fine'); if (p) p.insertAdjacentHTML('afterend', '<p class="wz-fine">Prefer very fast replies? ' + a(LINKS.groq, 'Groq also has a free key') + ' — paste it the same way.</p>');
  }
  async function own() {
    if (!providerPresets.length) { try { providerPresets = (await (await fetch(API + '/llm/providers')).json()).presets || []; } catch {} }
    if (screen !== 'own') return;
    keyScreen({ title: 'Paste your AI key', other: true, steps: [
      'Copy your API key from your provider (OpenAI, Claude, Gemini, Groq, OpenRouter, DeepSeek, Mistral…).',
      'Paste it below. JARVIS works out which provider it is, checks it, and picks a good model for you.'] });
  }

  /* ---------- AI: on this computer (Ollama) ---------- */
  async function local() {
    setBody(back('welcome') + '<h2>Private AI on this computer</h2><p class="wz-sub">Checking what’s already installed…</p>');
    bindGo();
    let s; try { s = await (await fetch(API + '/setup/status')).json(); } catch { s = { error: 'backend offline' }; }
    if (screen !== 'local') return;
    if (s.error) { setBody(back('welcome') + '<h2>Private AI on this computer</h2><p class="wz-err">' + escHtml(s.error) + '</p>'); bindGo(); return; }
    let html = back('welcome') + '<h2>Private AI on this computer</h2><ol class="wz-steps">';
    if (s.localModels.length) {
      settings.model = s.localModels.includes(settings.model) ? settings.model : s.localModels[0]; saveSettings();
      await checkLLM(); return done('your computer', settings.model);
    }
    if (!s.ollamaInstalled) {
      html += '<li class="cur"><b>Install Ollama</b> (free, one click). ' + a(LINKS.ollama, 'Download Ollama') + ' → run the installer → come back here.</li><li>Download the AI model (3 GB)</li></ol>' +
        '<div class="wz-row"><button class="wz-primary" id="wzRecheck" type="button">I’ve installed it — check again</button></div>';
    } else if (!s.ollamaRunning) {
      html += '<li>Install Ollama ✓</li><li class="cur"><b>Open the Ollama app</b> from the Start menu (a small llama icon appears near the clock).</li><li>Download the AI model (3 GB)</li></ol>' +
        '<div class="wz-row"><button class="wz-primary" id="wzRecheck" type="button">It’s open — check again</button></div>';
    } else {
      html += '<li>Install Ollama ✓</li><li>Ollama running ✓</li><li class="cur"><b>Download the AI model</b> — about 3 GB, one time. Keep this window open.</li></ol>' +
        '<div class="wz-row"><button class="wz-primary" id="wzPull" type="button">Download now</button><span id="wzMsg" class="wz-msg"></span></div>' +
        '<div class="wz-bar" hidden><i></i></div>';
    }
    setBody(html); bindGo();
    if ($w('#wzRecheck')) $w('#wzRecheck').onclick = local;
    if ($w('#wzPull')) $w('#wzPull').onclick = () => pull(s.recommended);
  }
  async function pull(model) {
    if (busy) return; busy = true;
    const msg = $w('#wzMsg'), bar = $w('.wz-bar'), fill = bar.querySelector('i'); $w('#wzPull').disabled = true; bar.hidden = false;
    msg.className = 'wz-msg'; msg.textContent = 'Starting download…';
    try {
      const res = await fetch(API + '/setup/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '', ok = false;
      for (;;) {
        const { value, done: fin } = await reader.read(); if (fin) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(j.error);
          if (j.pct != null) { fill.style.width = j.pct + '%'; msg.textContent = 'Downloading… ' + j.pct + '%'; } else if (j.status) msg.textContent = j.status.charAt(0).toUpperCase() + j.status.slice(1) + '…';
          if (j.done) ok = true;
        }
      }
      if (!ok) throw new Error('The download stopped early — click Download now to continue where it left off.');
      settings.model = model; saveSettings(); llm.warm = false; await checkLLM(); warmLLM();
      done('your computer', model);
    } catch (e) { busy = false; msg.className = 'wz-msg err'; msg.textContent = e.message; $w('#wzPull').disabled = false; $w('#wzPull').textContent = 'Try again'; }
  }

  /* ---------- AI: done ---------- */
  function done(where, model) {
    settings.setupDone = true; saveSettings();
    const nice = model ? String(model).split('::').pop() : '';
    setBody('<div class="wz-big">✓</div><h2>You’re all set!</h2><p class="wz-sub">JARVIS is now thinking with <b>' + escHtml(where) + '</b>' + (nice ? ' (' + escHtml(nice) + ')' : '') + '. Try typing “what can you do?” or “open notepad”.</p>' +
      '<div class="wz-row"><button class="wz-primary" id="wzFinish" type="button">Start using JARVIS</button></div>' +
      '<div class="wz-foot"><button class="wz-link-btn" data-go="phone1" type="button">📱 Also set up my phone (optional)</button></div>');
    $w('#wzFinish').onclick = () => close(false);
    bindGo();
  }

  /* ---------- phone ---------- */
  const dots = n => '<div class="wz-dots">' + [1, 2, 3, 4].map(i => '<i class="' + (i === n ? 'on' : i < n ? 'ok' : '') + '"></i>').join('') + '</div>';
  function phone1() {
    setBody(back('welcome') + dots(1) + '<h2>Step 1 · Install the ntfy app</h2><p class="wz-sub">ntfy is a free app that lets JARVIS send alerts to your phone and lets you send it commands.</p>' +
      '<div class="wz-row">' + a(LINKS.ntfyAndroid, '📱 Android — Google Play') + a(LINKS.ntfyIos, ' iPhone — App Store') + '</div>' +
      '<p class="wz-fine">Open the app once it’s installed, then continue.</p><div class="wz-row"><button class="wz-primary" data-go="phone2" type="button">I’ve installed it</button></div>');
  }
  function ensureTopic() {
    if (!/^jarvis-[0-9a-f]{16}$/.test(settings.phoneTopic || '')) {
      const b = new Uint8Array(8); crypto.getRandomValues(b);
      settings.phoneTopic = 'jarvis-' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    settings.phonePush = true; saveSettings();
    if (typeof bindSwitchState === 'function') bindSwitchState('#phonePushToggle', 'phonePush');
    if (typeof updatePhoneNote === 'function') updatePhoneNote();
    return settings.phoneTopic;
  }
  function phone2() {
    const topic = ensureTopic();
    setBody(back('phone1') + dots(2) + '<h2>Step 2 · Connect your phone</h2><p class="wz-sub">In the ntfy app tap <b>+</b>, then scan this code with your phone’s camera.</p>' +
      '<div class="wz-qr">' + qrSvg('ntfy://ntfy.sh/' + topic) + '</div>' +
      '<p class="wz-fine">Scanner not working? In the app tap <b>+</b> and type this name exactly: <code>' + escHtml(topic) + '</code></p>' +
      '<div class="wz-row"><button class="wz-primary" id="wzTest" type="button">Send a test alert</button><span id="wzMsg" class="wz-msg"></span></div>' +
      '<div class="wz-row"><button class="wz-primary ghost" data-go="phone3" type="button">Got it — next</button></div>');
    $w('#wzTest').onclick = async () => { const r = await callTool('/notify/test', { topic }); const m = $w('#wzMsg'); m.className = 'wz-msg' + (r.error ? ' err' : ''); m.textContent = r.error || 'Sent — check your phone.'; };
  }
  async function phone3() {
    setBody(back('phone2') + dots(3) + '<h2>Step 3 · Add the unlock code</h2><p class="wz-sub">Commands from your phone only work after you unlock with a 6-digit code — so nobody else can control your laptop.</p><p class="wz-fine">Loading…</p>');
    bindGo();
    const r = await callTool('/phone/auth/setup', {});
    if (screen !== 'phone3') return;
    if (r.error) { setBody(back('phone2') + dots(3) + '<h2>Step 3</h2><p class="wz-err">' + escHtml(r.error) + '</p>'); bindGo(); return; }
    setBody(back('phone2') + dots(3) + '<h2>Step 3 · Add the unlock code</h2>' +
      '<p class="wz-sub">Install <b>Google Authenticator</b> (' + a(LINKS.authAndroid, 'Android') + ' · ' + a(LINKS.authIos, 'iPhone') + '), tap <b>+</b> → <b>Scan a QR code</b>, and scan:</p>' +
      '<div class="wz-qr">' + qrSvg(r.uri) + '</div>' +
      '<details class="wz-more"><summary>Can’t scan? Type the key instead</summary><code class="wz-key">' + escHtml(r.secret.replace(/(.{4})/g, '$1 ').trim()) + '</code></details>' +
      '<p class="wz-fine">Keep this private — anyone with it can unlock your JARVIS.</p><div class="wz-row"><button class="wz-primary" data-go="phone4" type="button">It’s added — next</button></div>');
    bindGo();
  }
  function phone4() {
    setBody(back('phone3') + dots(4) + '<h2>Step 4 · Try it</h2><ol class="wz-steps"><li>Open the ntfy app and your JARVIS topic.</li>' +
      '<li>Send: <code>unlock 123456</code> — but use the current 6 digits from Google Authenticator.</li>' +
      '<li>JARVIS replies “Unlocked for 15 minutes”. Now send commands like <code>open chrome</code> or <code>volume 40</code>.</li></ol>' +
      '<p class="wz-fine">JARVIS needs to be open in a browser on the laptop for commands to run. Send <code>lock</code> when you’re finished.</p>' +
      '<p class="wz-sub" style="margin-top:14px">Test it here first — type the 6 digits Google Authenticator shows under JARVIS:</p>' +
      '<div class="wz-row"><input id="wzCode" class="wz-input" style="width:140px;margin:0" inputmode="numeric" maxlength="7" placeholder="123456"><button class="wz-primary ghost" id="wzCheck" type="button">Check code</button></div><div id="wzCodeOut" class="wz-msg" style="margin-top:8px"></div>' +
      '<div class="wz-row"><button class="wz-primary" id="wzFinish" type="button">Done</button></div>');
    $w('#wzCheck').onclick = () => checkPhoneCode($w('#wzCode').value, $w('#wzCodeOut'));
    $w('#wzCode').addEventListener('keydown', e => { if (e.key === 'Enter') $w('#wzCheck').click(); });
    $w('#wzFinish').onclick = () => close(false);
  }

  // First run: if there is no AI to talk to, offer the wizard once (not again after it's finished or skipped).
  function maybeOpen() { if (!settings.setupDone && !llm.models.length) open('welcome'); }
  return { open, close, maybeOpen };
})();
