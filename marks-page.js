'use strict';

(() => {
  const get = id => document.getElementById(id);
  const select = get('profile');
  const prompt = get('prompt');
  const status = get('status');
  const results = get('results');
  const voiceButton = get('voice');
  const profiles = new Map();
  let active = null;
  let privateTurns = [];
  let voiceStream = null;
  let recognition = null;
  let speaking = false;
  let compact = false;
  function dismissCompact() {
    window.close();
    setTimeout(() => location.replace('/'), 150);
  }

  async function api(route, body, signal) {
    const response = await fetch('/api/marks/' + route, {
      cache: 'no-store', signal,
      ...(body !== undefined && { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'JARVIS could not complete the request.');
    return data;
  }

  function element(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function display(container, heading, result) {
    const row = document.createElement('article');
    row.append(element('h2', heading), element('p', result.text));
    if (result.sources?.length) {
      const list = document.createElement('ol');
      for (const source of result.sources) {
        let url;
        try { url = new URL(source.url); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
        const anchor = element('a', source.title);
        anchor.href = url.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        const item = document.createElement('li');
        item.append(anchor);
        list.append(item);
      }
      row.append(list);
    }
    if (result.checks?.length) {
      const list = document.createElement('ul');
      for (const check of result.checks) list.append(element('li', `${check.name} — ${check.detail}`));
      row.append(list);
    }
    container.append(row);
    if (container.childElementCount > 50) container.firstElementChild.remove();
  }

  function renderProfile() {
    const profile = profiles.get(select.value);
    disarmVoice();
    voiceButton.hidden = profile.id !== 'mark-2';
    get('description').textContent = profile.description;
    get('history').hidden = profile.history === 'none';
    get('jobs-button').hidden = profile.execution !== 'background' && profile.id !== 'mark-85';
    get('accounts').hidden = !['mark-40', 'sentry', 'mark-85'].includes(profile.id);
    if (!get('accounts').hidden) void loadAccounts().catch(error => { status.textContent = error.message; });
    get('job-results').replaceChildren();
    get('jobs').hidden = true;
    privateTurns = [];
    results.replaceChildren();
    get('saved-results').replaceChildren();
    get('saved').hidden = true;
    status.textContent = active ? `Running ${active.profile.name}. New requests will use ${profile.name}.` : '';
    prompt.value = profile.id === 'damage-report' ? 'Run diagnostics' : '';
  }

  async function microphoneCheck() {
    try {
      const permission = await navigator.permissions.query({ name: 'microphone' });
      return { name: 'Microphone permission', detail: { granted: 'Granted', denied: 'Denied', prompt: 'Browser will ask for permission' }[permission.state] };
    } catch { return { name: 'Microphone permission', detail: 'Could not check in this browser' }; }
  }

  function disarmVoice() {
    const wasArmed = !!voiceStream;
    voiceStream?.close();
    voiceStream = null;
    recognition?.abort();
    recognition = null;
    if (speaking) window.speechSynthesis?.cancel();
    speaking = false;
    voiceButton.textContent = 'Arm voice';
    voiceButton.setAttribute('aria-pressed', 'false');
    return wasArmed;
  }

  function captureSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      status.textContent = 'Say “Hey Jarvis” and the command together, or type the command.';
      return;
    }
    const listener = new SpeechRecognition();
    recognition = listener;
    listener.lang = navigator.language || 'en-IN';
    listener.onresult = event => {
      if (recognition === listener && voiceStream) void run(event.results[0][0].transcript, true);
    };
    listener.onerror = () => {
      if (recognition === listener) status.textContent = 'Speech recognition could not take the command. Try saying it with the wake word.';
    };
    listener.onend = () => { if (recognition === listener) recognition = null; };
    try { listener.start(); status.textContent = 'Listening for your command…'; }
    catch { recognition = null; status.textContent = 'The browser could not start speech recognition.'; }
  }

  voiceButton.addEventListener('click', () => {
    if (disarmVoice()) { status.textContent = 'Voice disarmed.'; return; }
    if (!('EventSource' in window)) { status.textContent = 'This browser cannot connect to the wake listener.'; return; }
    const stream = new EventSource('/api/marks/voice');
    voiceStream = stream;
    voiceButton.textContent = 'Disarm voice';
    status.textContent = 'Connecting to the existing Windows wake listener…';
    stream.addEventListener('armed', () => {
      if (voiceStream !== stream) return;
      voiceButton.setAttribute('aria-pressed', 'true');
      status.textContent = 'Voice armed. Say “Hey Jarvis” and your command. A separate follow-up may use the browser’s speech service.';
    });
    stream.addEventListener('wake', event => {
      if (voiceStream !== stream || document.hidden || active || recognition || speaking) return;
      const { text } = JSON.parse(event.data);
      if (text) void run(text, true);
      else captureSpeech();
    });
    stream.onerror = () => {
      if (voiceStream !== stream) return;
      disarmVoice();
      status.textContent = 'Voice connection ended. Make sure the existing Windows wake listener is on before arming again.';
    };
  });

  function speak(text) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 600));
    utterance.voice = speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith('en')) || null;
    utterance.onend = utterance.onerror = () => { speaking = false; };
    speaking = true;
    speechSynthesis.speak(utterance);
  }

  async function loadJobs() {
    const selected = select.value;
    const host = get('job-results');
    const data = await api('jobs');
    if (select.value !== selected) return;
    host.replaceChildren();
    get('jobs').hidden = false;
    if (!data.jobs.length) host.append(element('p', 'No background work yet.'));
    for (const job of data.jobs) {
      const row = document.createElement('article');
      const detail = element('p', job.note || job.summary || 'Waiting for a checkpoint.');
      const inspect = element('button', 'View checkpoint');
      inspect.type = 'button';
      inspect.onclick = async () => {
        try {
          const current = await api('jobs/' + encodeURIComponent(job.id));
          detail.textContent = [current.status, current.note, ...current.steps.map(step =>
            `${step.tool} · ${step.status}\n${step.output || step.note || ''}`)].filter(Boolean).join('\n\n');
        } catch (error) { status.textContent = error.message; }
      };
      row.append(element('h2', `${job.goal} · ${job.status}`), detail, inspect);
      if (['running', 'queued'].includes(job.status)) {
        const cancel = element('button', 'Cancel task');
        cancel.type = 'button';
        cancel.onclick = async () => {
          try { await api('jobs/' + encodeURIComponent(job.id) + '/cancel', {}); await loadJobs(); }
          catch (error) { status.textContent = error.message; }
        };
        row.append(' ', cancel);
      }
      if (job.status === 'completed') {
        const share = element('button', job.phoneShared ? 'Edit phone report' : 'Review for Phone Hub');
        share.type = 'button';
        share.onclick = async () => {
          try {
            const current = await api('jobs/' + encodeURIComponent(job.id));
            const input = document.createElement('textarea');
            input.setAttribute('aria-label', 'Report to share with paired phones');
            input.rows = 5;
            input.maxLength = 8000;
            input.value = (current.phoneShared || current.steps.map(step => step.output || step.note || '').join('\n\n')).slice(0, 8000);
            const publish = element('button', 'Share with authorized phones');
            const unshare = element('button', 'Remove phone access');
            publish.type = unshare.type = 'button';
            async function update(text) {
              try {
                const data = await api('jobs/' + encodeURIComponent(job.id) + '/phone', { report: text });
                status.textContent = data.shared ? 'The reviewed report is available to phones granted Marks access.' : 'Phone access removed.';
                await loadJobs();
              } catch (error) { status.textContent = error.message; }
            }
            publish.onclick = () => void update(input.value);
            unshare.onclick = () => void update('');
            share.disabled = true;
            row.append(element('p', 'Review the text before sharing it with paired phones.'), input, publish, ' ', unshare);
          } catch (error) { status.textContent = error.message; }
        };
        row.append(' ', share);
      }
      host.append(row);
    }
  }

  get('jobs-button').addEventListener('click', () => void loadJobs().catch(error => { status.textContent = error.message; }));

  async function loadAccounts() {
    const data = await api('accounts');
    const host = get('account-results');
    host.replaceChildren();
    for (const account of data.providers) {
      const name = account.provider === 'google' ? 'Google' : 'Microsoft';
      const row = document.createElement('p');
      if (!account.configured) row.textContent = `${name} OAuth is not configured.`;
      else {
        const button = element('button', account.connected ? `Disconnect ${name}` : `Connect ${name}`);
        button.type = 'button';
        button.onclick = async () => {
          button.disabled = true;
          try {
            const data = await api(account.connected ? 'accounts/disconnect' : 'accounts/connect', { provider: account.provider });
            if (data.url) location.assign(data.url);
            else await loadAccounts();
          } catch (error) { status.textContent = error.message; button.disabled = false; }
        };
        row.append(button);
      }
      host.append(row);
    }
  }

  function showReview(review, name, text) {
    const article = document.createElement('article');
    const actions = { precision: ['precision/approve', 'Approve desktop action'], 'desktop-plan': ['desktop/start', 'Review first action'],
      jobs: ['jobs/start', 'Start background work'], batch: ['batch/approve', 'Apply reviewed batch'],
      toolbox: ['toolbox/approve', 'Run reviewed toolbox steps'], library: ['library/approve', 'Approve'] };
    const [route, label] = actions[review.kind];
    const profileId = select.value;
    article.append(element('h2', text), element('p', review.kind === 'precision' ? 'Review the exact desktop action.' : 'Review the proposed work.'));
    const list = document.createElement('ul');
    const descriptions = review.details || review.plans.map(plan =>
      plan.steps.map(step => `${step.tool} ${Object.values(step.args).join(' ')}`).join('\n'));
    for (const description of descriptions) list.append(element('li', description));
    const approve = element('button', label);
    approve.type = 'button';
    approve.onclick = async () => {
      if (active) return;
      const task = { profile: profiles.get(profileId), controller: new AbortController() };
      active = task;
      approve.disabled = true;
      get('run').disabled = true;
      get('cancel').hidden = false;
      status.textContent = `Running ${name}…`;
      try {
        const data = await api(route, { id: review.id, token: review.token }, task.controller.signal);
        status.textContent = data.result?.text || data.error || `${name} queued ${data.jobs.length} ${data.jobs.length === 1 ? 'task' : 'tasks'}.`;
        article.remove();
        if (select.value !== profileId) return;
        if (review.kind === 'jobs') await loadJobs();
        if (data.result?.review) showReview(data.result.review, name, text);
        else if (data.result) display(results, name, data.result);
      } catch (error) {
        status.textContent = task.controller.signal.aborted
          ? 'Stopped waiting. Check for changes already completed before trying the action again.' : error.message;
      } finally {
        active = null;
        get('run').disabled = false;
        get('cancel').hidden = true;
      }
    };
    const dismiss = element('button', 'Dismiss');
    dismiss.type = 'button';
    dismiss.onclick = () => article.remove();
    article.append(list, approve, ' ', dismiss);
    results.append(article);
  }

  get('command').addEventListener('submit', event => {
    event.preventDefault();
    void run(prompt.value);
  });

  async function run(input, spoken = false) {
    const text = input.trim().slice(0, 4000);
    if (!text || active) return;
    const profile = profiles.get(select.value);
    const task = { id: crypto.randomUUID(), profile, controller: new AbortController() };
    active = task;
    const context = profile.id === 'mark-33' ? privateTurns : undefined;
    prompt.value = '';
    get('run').disabled = true;
    get('cancel').hidden = false;
    status.textContent = `Running ${profile.name}…`;
    try {
      const data = await api('run', { id: task.id, profileId: profile.id, text, context }, task.controller.signal);
      if (profile.id === 'damage-report') data.result.checks.push(await microphoneCheck());
      if (select.value === profile.id && (profile.id !== 'mark-33' || context === privateTurns)) {
        if (data.result.review) showReview(data.result.review, profile.name, text);
        else display(results, text, data.result);
        if (profile.id === 'mark-33') privateTurns = [...context, { role: 'user', content: text },
          { role: 'assistant', content: data.result.text.slice(0, 4000) }].slice(-8);
        if (spoken && voiceStream && profile.id === 'mark-2') speak(data.result.text);
      }
      status.textContent = data.result.review ? 'Plan ready for review.' : `${profile.name} finished.`;
      if (data.historyExpected && !data.historySaved) status.textContent += ' The result could not be saved.';
      if (compact) {
        status.textContent += ' Closing compact commands in 8 seconds.';
        setTimeout(dismissCompact, 8000);
      }
    } catch (error) {
      status.textContent = task.controller.signal.aborted ? 'Request cancelled.' : error.message;
    } finally {
      active = null;
      get('run').disabled = false;
      get('cancel').hidden = true;
      if (select.value === 'damage-report') prompt.value = 'Run diagnostics';
    }
  }

  get('cancel').addEventListener('click', () => {
    active?.controller.abort();
    if (compact) dismissCompact();
  });
  get('disable').addEventListener('click', async () => {
    if (!confirm('Disable Marks for this JARVIS session and stop its active work?')) return;
    try { await api('disable', {}); location.replace('/'); }
    catch (error) { status.textContent = error.message; }
  });
  get('emergency').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/safety/stop', { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok || !result.stopped) throw new Error(result.error || 'Emergency stop did not complete.');
      disarmVoice();
      status.textContent = 'Emergency stop is active. Resume explicitly from the JARVIS dashboard.';
    } catch (error) { status.textContent = error.message; }
  });
  document.addEventListener('keydown', event => {
    if (compact && event.key === 'Escape') { active?.controller.abort(); dismissCompact(); }
  });
  select.addEventListener('change', renderProfile);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && disarmVoice()) status.textContent = 'Voice disarmed when this tab went into the background.';
  });
  get('history').addEventListener('click', async () => {
    if (!get('saved').hidden) { get('saved').hidden = true; return; }
    const profile = profiles.get(select.value);
    try {
      const data = await api('history');
      if (select.value !== profile.id) return;
      const saved = get('saved-results');
      saved.replaceChildren();
      const records = data.records.filter(record => record.profileId === profile.id);
      for (const record of records) display(saved, record.text, record.result);
      if (!records.length) saved.append(element('p', 'No saved results for this profile.'));
      get('saved').hidden = false;
    } catch (error) { status.textContent = error.message; }
  });

  window.addEventListener('pagehide', () => {
    disarmVoice();
    active?.controller.abort();
    privateTurns = [];
    prompt.value = '';
    results.replaceChildren();
  });

  async function start() {
    try {
      const data = await api('profiles');
      if (!data.enabled) { get('availability').textContent = 'Marks is disabled.'; return; }
      get('preview').hidden = !data.preview;
      get('disable').hidden = compact;
      get('emergency').hidden = compact;
      for (const profile of data.profiles) {
        profiles.set(profile.id, profile);
        if (profile.available) {
          const option = element('option', profile.name);
          option.value = profile.id;
          select.append(option);
        }
        get('catalog').append(element('li', `${profile.name} — ${profile.available ? 'Available' : 'In development'}`));
      }
      const entry = new URL(location.href);
      const requested = entry.searchParams.get('profile');
      const tray = entry.searchParams.get('entry') === 'offline-tray';
      const account = entry.searchParams.get('entry');
      compact = entry.searchParams.get('entry') === 'hotkey' && profiles.get('mark-7')?.available === true;
      if (tray || compact || account?.startsWith('account-')) history.replaceState(null, '', entry.pathname);
      if (compact) document.body.classList.add('compact');
      select.value = compact ? 'mark-7' : profiles.get(requested)?.available ? requested : tray && profiles.get('mark-5')?.available ? 'mark-5' :
        account?.startsWith('account-') && profiles.get('mark-40')?.available ? 'mark-40' : 'standard';
      if (requested !== null) history.replaceState(null, '', entry.pathname);
      renderProfile();
      if (account === 'account-connected') status.textContent = 'Read-only account connected.';
      else if (account === 'account-failed') status.textContent = 'Account authorization did not complete.';
      get('availability').hidden = true;
      get('workspace').hidden = false;
    } catch { get('availability').textContent = 'Could not reach the Marks workspace.'; }
  }

  void start();
})();
