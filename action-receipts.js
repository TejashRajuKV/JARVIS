'use strict';
/* Local, user-visible command receipts. This keeps a small, bounded history and never stores tool arguments or secrets. */
const ActionReceipts = (() => {
  const KEY = 'jarvis.actionReceipts', LIMIT = 120;
  let entries = store.get(KEY, []);
  const safeCommand = value => String(value || '').slice(0, 500)
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/ig, '$1[redacted]')
    .replace(/((?:api[_ -]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/ig, '$1[redacted]');
  const save = () => { entries = entries.slice(-LIMIT); store.set(KEY, entries); render(); };
  const list = () => entries.slice().reverse();
  function begin(command, intent, answer, options = {}) {
    const r = { id: 'rcpt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), at: Date.now(), command: safeCommand(command), intent: String(intent || '').slice(0, 80), answer: String(answer || '').slice(0, 240), status: 'pending', note: 'Checking the result…', undoable: false, repeatable: options.repeatable !== false };
    entries.push(r); save(); return r.id;
  }
  function update(id, value) {
    const r = entries.find(x => x.id === id); if (!r) return;
    r.status = ['verified', 'failed', 'unverified'].includes(value.status) ? value.status : 'unverified';
    r.note = String(value.note || 'I could not check the result directly.').slice(0, 240);
    r.undoable = !!value.undoable; r.undoLabel = String(value.undoLabel || '').slice(0,160); r.checkedAt = Date.now(); save();
    document.dispatchEvent(new CustomEvent('jarvis:receipt', { detail: { ...r } }));
  }
  function remove(id) { entries = entries.filter(x => x.id !== id); save(); }
  function adopt(value) { if (!Array.isArray(value)) return; entries = value.slice(-LIMIT); render(); }
  function render() {
    const host = document.getElementById('historyList'); if (!host) return;
    host.replaceChildren();
    if (!entries.length) { host.innerHTML = '<div class="home-empty">Your command history will appear here.</div>'; return; }
    for (const r of list()) {
      const card = document.createElement('article'); card.className = 'history-card';
      const head = document.createElement('div'); head.className = 'receipt-head';
      const status = document.createElement('span'); status.className = 'receipt-status ' + r.status; status.textContent = ({ pending: 'CHECKING', verified: 'VERIFIED', failed: 'FAILED', unverified: 'NOT CHECKED' })[r.status] || r.status.toUpperCase();
      const time = document.createElement('time'); time.textContent = new Date(r.at).toLocaleString(); head.append(status, time);
      const cmd = document.createElement('div'); cmd.className = 'history-command'; cmd.textContent = r.command || r.intent;
      const note = document.createElement('div'); note.className = 'history-note'; note.textContent = r.note;
      const actions = document.createElement('div'); actions.className = 'history-actions';
      if (r.status !== 'pending' && r.repeatable !== false) { const retry = document.createElement('button'); retry.className = 'cbtn'; retry.textContent = r.status === 'failed' ? 'RETRY' : 'REPEAT'; retry.onclick = () => { if (/\b(shut\s*down|restart|delete|erase|wipe|send|pay|purchase|commit|push|lock|call)\b/i.test(r.command) && !confirm('Repeat this command? It may cause the same change again.')) return; handleUser(r.command, 'text'); }; actions.appendChild(retry); }
      if (r.undoable && list()[0].id === r.id && r.undoLabel && typeof Undo !== 'undefined' && Undo.peek() === r.undoLabel) { const undo = document.createElement('button'); undo.className = 'cbtn'; undo.textContent = 'UNDO'; undo.onclick = () => handleUser('undo', 'text'); actions.appendChild(undo); }
      const dismiss = document.createElement('button'); dismiss.className = 'cbtn'; dismiss.textContent = 'REMOVE'; dismiss.onclick = () => remove(r.id); actions.appendChild(dismiss);
      card.append(head, cmd, note, actions); host.appendChild(card);
    }
  }
  return { begin, update, list, remove, adopt, render };
})();
document.addEventListener('jarvis:receipt', ev => {
  const r = ev.detail, el = document.querySelector('.action-receipt[data-receipt-id="' + CSS.escape(r.id) + '"]');
  if (el) { const badge = el.querySelector('.receipt-status'), note = el.querySelector('.receipt-note'); badge.className = 'receipt-status ' + r.status; badge.textContent = ({ verified: 'VERIFIED', failed: 'FAILED', unverified: 'NOT CHECKED' })[r.status] || 'CHECKING'; if(note)note.textContent = r.note; }
});
