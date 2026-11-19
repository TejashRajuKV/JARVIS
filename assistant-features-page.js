'use strict';
window.AssistantPage = (() => {
  let captureRows = [], recentInbox = [], inboxAt = 0, voicePending = null, approval = null;
  const quietState = () => ({ 'jarvis.settings': settings, 'jarvis.quietUntil': store.get('jarvis.quietUntil', 0) });
  let wasQuiet = AssistantTools.holdAlert(quietState(), 'reminder');
  for (const [id, fallback] of Object.entries({
    quietEnabled: false, quietStart: '22:00', quietEnd: '07:00', quietPassDeadlines: false, studyDayStart: 8, studyDayEnd: 22,
  })) {
    const input = $('#' + id);
    if (input.type === 'checkbox') input.checked = settings[id] ?? fallback;
    else input.value = settings[id] ?? fallback;
    input.addEventListener('change', () => {
      if (!input.reportValidity()) return;
      settings[id] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      saveSettings();
    });
  }
  async function refreshInbox() {
    const result = await getJSON('/inbox/captures');
    if (Array.isArray(result.entries)) captureRows = result.entries;
    else $('#voiceNoteStatus').textContent = result.error || 'Quick captures are unavailable.';
    renderVoiceNotes();
  }
  function inboxRows(memory) {
    recentInbox = AssistantTools.inbox(memory, captureRows, $('#voiceNoteSearch').value, $('#inboxDate').value);
    inboxAt = Date.now();
    return recentInbox;
  }
  $('#inboxDate').addEventListener('input', renderVoiceNotes);
  $('.tab[data-tab="notes"]').addEventListener('click', refreshInbox);

  async function convert(entry, kind, at) {
    const result = await callTool('/inbox/convert', { sourceId: entry.id, text: entry.text, kind, ...(at ? { at } : {}) });
    const status = result.error || (result.already ? 'This entry already has that ' + kind + '.' : 'Added ' + (kind === 'task' ? 'to Tasks.' : 'to Reminders.'));
    $('#voiceNoteStatus').textContent = status;
    if (!result.error && !result.already && kind === 'reminder') askNotify();
    return status;
  }
  function conversionPreview(entry, kind, at) {
    return {
      text: 'Create a ' + kind + (at ? ' for ' + new Date(at).toLocaleString() : '') + ' from this entry?\n\n' + entry.text,
      noTTS: true, noPersona: true, noLocalize: true,
      confirm: { yes: 'Create ' + kind, no: 'Cancel', onConfirm: async () => jarvisSay({ text: await convert(entry, kind, at), noTTS: true }) },
    };
  }
  function inboxActions(entry) {
    const actions = document.createElement('div'); actions.className = 'daily-actions';
    const task = document.createElement('button'); task.type = 'button'; task.className = 'btn'; task.textContent = 'Create task';
    const label = document.createElement('label'); label.textContent = 'Remind at ';
    const when = document.createElement('input'); when.type = 'datetime-local'; label.append(when);
    const reminder = document.createElement('button'); reminder.type = 'button'; reminder.className = 'btn'; reminder.textContent = 'Review reminder';
    const review = (kind, at) => {
      switchTab('chat');
      jarvisSay(conversionPreview(entry, kind, at));
    };
    task.onclick = () => review('task');
    reminder.onclick = () => {
      const at = new Date(when.value).getTime();
      if (!(at > Date.now())) { $('#voiceNoteStatus').textContent = 'Choose a future date and time.'; when.focus(); return; }
      review('reminder', at);
    };
    actions.append(task, label, reminder);
    return actions;
  }
  async function quietAlert(kind, text) {
    if (!AssistantTools.holdAlert(quietState(), kind)) return false;
    wasQuiet = true;
    const outcome = await callTool('/alerts/recap', { kind, id: kind + ':' + rid(), text });
    return !outcome.error;
  }
  async function recap(automatic = false) {
    const result = await getJSON('/alerts/recap');
    if (result.error) return result.error;
    if (!result.entries?.length) return 'No alerts were held during quiet hours.';
    const entries = result.entries.slice(-10);
    if (automatic) {
      const marker = entries.at(-1).at;
      if (marker <= Number(store.get('jarvis.recapSeenAt', 0)) || !await claimAlert('quiet-recap:' + marker, 86400)) return '';
      store.set('jarvis.recapSeenAt', marker);
    }
    return 'Held alerts' + (entries.length < result.entries.length ? ' (latest ' + entries.length + ')' : '') + ':\n' +
      entries.map(item => '- ' + new Date(item.at).toLocaleString() + ' · ' + item.text).join('\n');
  }
  let recapChecked = false;
  setInterval(async () => {
    const current = AssistantTools.holdAlert(quietState(), 'reminder');
    const justEnded = wasQuiet && !current;
    wasQuiet = current;
    if (!current && (justEnded || !recapChecked)) {
      const text = await recap(true);
      recapChecked = !text || text.startsWith('Held alerts') || text === 'No alerts were held during quiet hours.';
      if (text.startsWith('Held alerts')) jarvisSay({ text, intent: 'QUIET_RECAP', noTTS: !justEnded, noPersona: true });
    }
  }, 15000);

  async function availability(minutes, subject, before) {
    const cutoff = before.toLowerCase();
    const now = new Date(), until = NLU.parseWhen(cutoff, now);
    if (!until || minutes < 5 || minutes > 360) return 'Give me a duration from 5 to 360 minutes and a future day or time.';
    const boundary = new Date(until);
    if (!/\b(?:at|by|in|around|tonight|morning|afternoon|evening)\b|\d(?::\d\d|\s*[ap]\.?m\.?)/i.test(cutoff)) boundary.setHours(0, 0, 0, 0);
    const matchingDeadlines = deadlines.filter(item => !item.done && subject && item.due > +now && item.title.toLowerCase().includes(subject.toLowerCase()));
    const to = Math.min(+boundary, ...matchingDeadlines.map(item => +item.due), +now + 14 * 86400000);
    if (to <= +now) return 'That cutoff has passed.';
    let busy = [], coverage = '';
    const calendarStatus = await getJSON('/calendar/status');
    if (calendarStatus.configured) {
      const calendar = await getJSON('/calendar/events?availability=1&from=' + +now + '&to=' + to);
      busy = (calendar.events || []).map(event => ({ start: event.start, end: event.end, name: event.title }));
      if (calendar.error || calendar.incomplete) coverage = ' Calendar coverage is incomplete.';
    } else coverage = calendarStatus.error ? ' Calendar coverage is unavailable.' : ' Using the local timetable because no calendar is connected.';
    const date = new Date(now); date.setHours(0, 0, 0, 0);
    while (+date < to) {
      for (const item of classes.filter(item => item.day === date.getDay())) {
        const start = new Date(date); start.setHours(item.h, item.m, 0, 0);
        const end = Number(item.durationMin) > 0 ? Number(item.durationMin) : 60;
        busy.push({ start: +start, end: +start + end * 60000, name: item.name });
      }
      date.setDate(date.getDate() + 1);
    }
    const startHour = Number(settings.studyDayStart ?? 8), endHour = Number(settings.studyDayEnd ?? 22);
    if (startHour >= endHour) return 'Set the study-hours end after its start in Settings.';
    const found = AssistantTools.slots({ from: +now, to, minutes, busy, startHour, endHour });
    let clashes = 0;
    const relevant = busy.filter(item => item.end > +now && item.start < to).sort((a, b) => a.start - b.start);
    for (let i = 1; i < relevant.length; i++) {
      if (relevant.slice(0, i).some(item => item.end > relevant[i].start)) clashes++;
    }
    const note = coverage + (clashes ? ' I found ' + clashes + ' overlapping schedule entries.' : '') +
      (classes.length ? ' Classes without an end time are treated as one hour.' : '');
    if (!found.length) return 'No ' + minutes + '-minute block fits in your study hours before the cutoff.' + note;
    return 'Suggested study blocks' + (subject ? ' for ' + subject : '') + ':\n' + found.map(slot =>
      '- ' + new Date(slot.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' +
      fmtTime(slot.start) + '–' + fmtTime(slot.end)).join('\n') + '\n' + note;
  }

  const filePreview = /^(?:jarvis[, ]+)?open\s+.+(?:\b(?:notes?|file|pdf)\b|\.(?:txt|md|pdf|docx|csv))[\s.!?]*$/i;
  function prepareVoice(text, source, submit) {
    const inline = /^(.+?)[.,;!?]?\s+wait,?\s+i meant\s+(.+)$/i.exec(text);
    if (inline) {
      const updated = AssistantTools.corrected(inline[1], inline[2]);
      if (updated) submit(updated, source, true);
      else toast('Say the full corrected command.');
      return true;
    }
    const correction = /^(?:(?:no|wait),?\s*)?i meant\s+(.+)$|^actually,?\s+(.+)$/i.exec(text);
    if (correction) {
      const pending = voicePending || (approval && (!approval.valid || approval.valid()) ? approval : null);
      const replacement = pending && AssistantTools.corrected(pending.command, correction[1] || correction[2]);
      if (!replacement) { toast(pending ? 'Say the full corrected command.' : 'There is no action waiting to be corrected. Say a new command or use undo.'); return true; }
      pending.cancel();
      jarvisSay({ text: 'Corrected request: ' + replacement, noPersona: true });
      setTimeout(() => submit(replacement, source, true), 0);
      return true;
    }
    if (voicePending && /^(?:cancel|never mind|stop)[.!?]?$/i.test(text)) { voicePending.cancel(); toast('Open cancelled.'); return true; }
    if (voicePending) voicePending.cancel();
    if (!['voice', 'wake'].includes(source) || !filePreview.test(text)) return false;
    const cancel = () => { clearTimeout(timer); voicePending = null; };
    const timer = setTimeout(() => { voicePending = null; submit(text, source, true); }, 3000);
    voicePending = { command: text, cancel };
    toast('About to ' + text.replace(/^jarvis[, ]+/i, '') + '. Say “wait, I meant…” to correct it.');
    return true;
  }
  function trackApproval(command, cancel, valid) {
    const card = { command, cancel, valid };
    approval = card;
    return () => { if (approval === card) approval = null; };
  }
  async function command(text) {
    const input = text.replace(/^jarvis[, ]+/i, '').trim();
    if (/^keep it quiet until my break[.!?]?$/i.test(input)) {
      if (focus?.phase !== 'focus' || focus.end <= Date.now()) return { text: 'Start a focus session first.' };
      store.set('jarvis.quietUntil', focus.end); wasQuiet = true;
      return { text: 'Routine laptop alerts will wait until your break.' };
    }
    if (/^what did i miss[.!?]?$/i.test(input)) return { text: await recap(), noTTS: true };
    const block = /^where can i fit (\d+)[ -]*(?:minutes?|mins?) (?:of (.+?) )?before (.+?)[.!?]?$/i.exec(input);
    if (block) return { text: await availability(+block[1], block[2] || '', block[3]) };
    const pdf = /^find (.+?) in (?:this |the )?scanned pdf(?:\s+(.+?\.pdf))?[.!?]?$/i.exec(input);
    if (pdf) return { text: await findPdf(pdf[1], pdf[2]), noTTS: true };
    if (/^(?:show|list) (?:my inbox|what i captured)(?: (today|yesterday))?[.!?]?$/i.test(input)) {
      const date = new Date();
      if (/yesterday/i.test(input)) date.setDate(date.getDate() - 1);
      $('#inboxDate').value = /today|yesterday/i.test(input) ? AssistantTools.localDay(date) : '';
      $('#voiceNoteSearch').value = '';
      await refreshInbox(); openDailyPane('notes');
      const preview = recentInbox.slice(0, 8).map((entry, i) => (i + 1) + '. ' + entry.text.slice(0, 150));
      return { text: preview.length ? 'Your capture inbox:\n\n' + preview.join('\n') : 'No captures match this view.', noTTS: true };
    }
    const numbered = /^(remind me about|make a task from) (?:the )?(first|second|third|\d+)(?: one)?(?: (.+?))?[.!?]?$/i.exec(input);
    if (numbered) {
      const index = ({ first: 1, second: 2, third: 3 }[numbered[2].toLowerCase()] || +numbered[2]) - 1;
      if (Date.now() - inboxAt > 5 * 60000 || !recentInbox[index]) return { text: 'Show your inbox again so I can identify that entry.' };
      const kind = /^remind/i.test(input) ? 'reminder' : 'task';
      const at = kind === 'reminder' ? NLU.parseWhen((numbered[3] || '').toLowerCase()) : undefined;
      if (kind === 'reminder' && !(at > Date.now())) return { text: 'Include a future day or time for that reminder.' };
      switchTab('chat');
      return conversionPreview(recentInbox[index], kind, at);
    }
    return null;
  }
  let pdfJob, pdfFile = '';
  const pdfStatus = $('#ocrPdfStatus'), pdfCancel = $('#ocrPdfCancel'), pdfStart = $('#ocrPdfStart');
  async function indexPdf(file) {
    if (!file) return { error: 'Choose a PDF by name or path in Notes.' };
    pdfStart.disabled = true;
    pdfStatus.textContent = 'Reading the PDF…';
    try {
      let job = await callTool('/pdf/ocr/index', { file });
      if (job.error) return job;
      pdfJob = job.id; pdfFile = file;
      while (job.state === 'running') {
        pdfCancel.hidden = false;
        pdfStatus.textContent = 'Indexed ' + job.done + ' of ' + (job.total || '…') + ' pages.';
        await sleep(500);
        job = await getJSON('/pdf/ocr/jobs/' + pdfJob);
      }
      return job.state === 'completed' ? job : { error: job.error || 'Indexing cancelled.' };
    } finally { pdfCancel.hidden = true; pdfStart.disabled = false; }
  }
  pdfStart.onclick = async () => {
    const job = await indexPdf($('#ocrPdfPath').value.trim());
    pdfStatus.textContent = job.error || ('Indexed ' + job.done + ' pages.' + (job.unreadable ? ' Unreadable: ' + job.unreadable + '.' : ''));
  };
  pdfCancel.onclick = () => fetch('/api/pdf/ocr/jobs/' + pdfJob, { method: 'DELETE' }).catch(() => {});
  function citation(file, page) { return file + ', page ' + page; }
  async function findPdf(query, selected) {
    const file = selected || $('#ocrPdfPath').value.trim();
    if (pdfStart.disabled) return 'Wait for the current PDF to finish indexing.';
    if (!pdfJob || pdfFile !== file) {
      const job = await indexPdf(file);
      if (job.error) { pdfStatus.textContent = job.error; return job.error; }
    }
    const result = await callTool('/pdf/ocr/search', { id: pdfJob, query });
    if (result.error) { pdfJob = null; pdfStatus.textContent = result.error; return result.error; }
    pdfStatus.textContent = 'Found ' + result.matches.length + ' matching pages.' + (result.unreadable ? ' Unreadable pages: ' + result.unreadable + '.' : '');
    const host = $('#ocrPdfResults'); host.replaceChildren();
    for (const item of result.matches) {
      const article = document.createElement('article');
      const title = document.createElement('strong'); title.textContent = citation(result.file, item.page);
      const excerpt = document.createElement('p'); excerpt.textContent = item.excerpt;
      article.append(title, excerpt); host.append(article);
    }
    return result.matches.length ? 'Found OCR or text matches in ' + result.matches.map(item => citation(result.file, item.page)).join('; ') + '.' : 'No matching words in the indexed pages.';
  }
  $('#ocrPdfSearch').onsubmit = event => { event.preventDefault(); void findPdf($('#ocrPdfQuery').value); };
  setTimeout(renderVoiceNotes, 0);
  return { command, refreshInbox, inboxRows, inboxActions, quietAlert, prepareVoice, trackApproval, cancelVoice: () => voicePending?.cancel() };
})();
