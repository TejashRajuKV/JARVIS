'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { email } = require('./marks-account-readers');

function createSentry({ control, readers, downloads, getDeadlines, notify, online, now = Date.now, pollMs = 60000 }) {
  const watches = new Map(), alerts = [];
  let timer, scanning = null;

  function record(watch, identity, detail) {
    if (watch.seen.has(identity)) return;
    if (watch.seen.size >= 300) watch.seen.delete(watch.seen.values().next().value);
    watch.seen.add(identity);
    alerts.push({ text: detail, at: now() });
    if (alerts.length > 50) alerts.shift();
    if (watch.started) Promise.resolve(notify('JARVIS Sentry', 'An enabled watch has a new result. Open Marks to review.')).catch(() => {});
  }

  async function poll() {
    if (scanning || control.status().stopped) return;
    const scan = new AbortController();
    scanning = scan;
    let operation;
    try {
      operation = control.operation();
      const signal = AbortSignal.any([scan.signal, operation.signal]);
      for (const watch of watches.values()) {
        if (signal.aborted) break;
        try {
          if (watch.kind === 'mail') {
            if (!online()) throw new Error('Online tools are disabled.');
            const data = await readers.messages(watch.provider, { sender: watch.value, since: watch.since, signal });
            if (!watches.has(watch.id) || signal.aborted) continue;
            const rows = data.rows.sort((a, b) => a.at - b.at);
            for (const row of rows) record(watch, row.id, `${watch.provider} mail from ${row.from} — ${row.subject}`);
            if (!data.limited && rows.length) watch.since = rows.at(-1).at;
            if (data.limited) throw new Error('Result limit reached. Review recent messages in the provider app.');
          } else if (watch.kind === 'download') {
            const folder = downloads();
            const file = folder && path.join(folder, watch.value);
            const stat = file && await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
            if (!watches.has(watch.id) || signal.aborted) continue;
            const identity = stat?.isFile() && !stat.isSymbolicLink() ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : null;
            if (identity && watch.stable === identity) {
              if (stat.mtimeMs >= watch.since) record(watch, identity, `Download ready: ${watch.value}`);
            }
            watch.stable = identity;
          } else {
            for (const item of getDeadlines()) {
              if (!item || item.done || item.title !== watch.value || !Number.isFinite(Number(item.due))) continue;
              const due = Number(item.due);
              if (due >= watch.since && due - now() <= 3600000) record(watch, `${item.id}:${due}`, `Deadline within one hour: ${item.title}`);
            }
          }
          watch.error = '';
        } catch (error) { watch.error = error.message; }
      }
    } finally { operation?.release(); scanning = null; }
  }

  function clear() {
    scanning?.abort();
    watches.clear();
    alerts.length = 0;
    clearInterval(timer);
    timer = null;
  }
  control.onStop(clear);

  function command({ text }) {
    if (/^alerts$/i.test(text)) return { text: alerts.toReversed().map(alert => `${new Date(alert.at).toLocaleString()} · ${alert.text}`).join('\n') || 'No alerts.' };
    if (/^(?:watches|status)$/i.test(text)) return { text: [...watches.values()].map(watch =>
      `${watch.id} · ${watch.provider || watch.kind} · ${watch.value}${watch.error ? ' · ' + watch.error : ''}`).join('\n') || 'No active watches.' };
    const stop = /^stop watch ([0-9a-f-]{36})$/i.exec(text);
    if (stop) {
      const found = watches.delete(stop[1]);
      if (!watches.size) { clearInterval(timer); timer = null; }
      return { text: found ? 'Watch stopped.' : 'Watch not found.' };
    }
    const mail = /^watch (google|microsoft) mail from (\S+)$/i.exec(text);
    const local = /^watch (download|deadline) "([^"\r\n]{1,200})"$/i.exec(text);
    if ((!mail && !local) || (mail && !email.test(mail[2]))) throw new Error('Use watch google mail from ADDRESS, watch microsoft mail from ADDRESS, watch download "file name", watch deadline "title", watches, alerts, or stop watch ID.');
    const [kind, provider, value] = mail ? ['mail', mail[1].toLowerCase(), mail[2].toLowerCase()] : [local[1].toLowerCase(), null, local[2]];
    if (kind === 'download' && (/[<>:"/\\|?*\x00-\x1f]/.test(value) || /^[.$]/.test(value) || /\.(?:part|tmp|crdownload)$/i.test(value))) throw new Error('Choose the final filename in Downloads.');
    if (watches.size >= 20) throw new Error('Up to 20 watches can run at once.');
    if ([...watches.values()].some(watch => watch.kind === kind && watch.provider === provider && watch.value === value)) throw new Error('That watch is already active.');
    const id = randomUUID();
    watches.set(id, { id, kind, provider, value, since: now(), started: true, seen: new Set() });
    if (!timer) { timer = setInterval(() => void poll().catch(() => {}), pollMs); timer.unref?.(); }
    void poll().catch(() => {});
    return { text: `Watch started: ${id}. Use “alerts” to see results or “stop watch ${id}” to end it.` };
  }

  return { command, clear, poll };
}

module.exports = { createSentry };
