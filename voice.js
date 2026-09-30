'use strict';
/* Voice: turns the browser's speech-recognition results into whole sentences. Chrome/Edge mark speech "final" at
   every short pause, so acting on the first final piece cut people off mid-sentence. This collects everything you
   say — across pauses and even across recogniser restarts — and hands it over only once you have actually gone
   quiet for `silenceMs` (or at `maxMs`). Used for both the wake word and tap-to-talk. Plain logic, no browser APIs:
   the page feeds it results and calls tick(); tests drive it with a fake clock (tests/voice.test.js).

   Results are fed as the recogniser's full list for the current session: [{ text, isFinal }]. In continuous mode
   final results never change, so pieces are consumed by index after a command is handed over. */
const Voice = (() => {
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  // End position (in `text`) of the first wake word, or -1. Exact spellings anywhere; near-misses (one letter off)
  // as whole words of 4+ letters in any script — the Telugu/Kannada recognisers spell "జార్విస్" several ways.
  function wakeEnd(text, words) {
    const lower = text.toLowerCase();
    let best = -1;
    for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (best < 0 || i + w.length < best)) best = i + w.length; }
    if (best >= 0) return best;
    const re = /[^\s,.!?;:]+/g; let m;
    while ((m = re.exec(lower))) {
      const tok = m[0];
      if (tok.length >= 4 && words.some(w => w.length >= 4 && Math.abs(w.length - tok.length) <= 1 && lev(tok, w) <= 1)) return m.index + tok.length;
    }
    return -1;
  }

  function createUtterance(opts) {
    const o = Object.assign({ now: () => Date.now(), silenceMs: 1600, maxMs: 30000, idleMs: 8000, promptMs: 700, wakeWords: null, isEcho: () => false,
      onWake() {}, onPrompt() {}, onProgress() {}, onCommit() {}, onIdle() {}, onDrop() {} }, opts || {});
    const wake = Array.isArray(o.wakeWords) && o.wakeWords.length ? o.wakeWords.map(w => String(w).toLowerCase()) : null;
    let mode = wake ? 'wait' : 'capture';          // wait = listening for the wake word; capture = collecting a command
    let carry = '', from = 0, pieces = [], muted = false;
    let text = '', spoke = false, startedAt = o.now(), lastHeard = 0, prompted = false;

    const sessionText = () => pieces.slice(from).map(p => p.text).join(' ');
    function reset(toMode) { mode = toMode; carry = ''; from = pieces.length; text = ''; spoke = false; prompted = false; startedAt = o.now(); }

    function update(list) {
      pieces = Array.isArray(list) ? list : [];
      if (muted || mode === 'done') return;
      const full = clean(carry + ' ' + sessionText());
      if (mode === 'wait') {
        const end = wakeEnd(full, wake);
        if (end < 0) return;
        mode = 'capture'; startedAt = o.now();
        const after = clean(full.slice(end).replace(/^[\s,.!?;:-]+/, ''));
        o.onWake(!!after);
      }
      let now = full;
      if (wake) { const end = wakeEnd(full, wake); now = end >= 0 ? clean(full.slice(end).replace(/^[\s,.!?;:-]+/, '')) : full; }
      if (now !== text) {
        text = now;
        if (text) { spoke = true; lastHeard = o.now(); }
        o.onProgress(text);
      }
    }
    // The recogniser stopped (Chrome restarts continuous recognition now and then): keep what was said.
    function sessionEnded() {
      if (mode === 'capture') carry = clean(carry + ' ' + sessionText());
      else if (wake) carry = '';                   // nothing to keep while only listening for the wake word
      pieces = []; from = 0;
    }
    function commit() {
      const t = text;
      reset(wake ? 'wait' : 'done');
      if (!t) return o.onIdle();
      if (o.isEcho(t)) return o.onDrop(t);
      o.onCommit(t);
    }
    function tick() {
      if (mode !== 'capture') return;
      const now = o.now();
      if (!spoke) {
        if (wake && !prompted && now - startedAt >= o.promptMs) { prompted = true; o.onPrompt(); }
        if (now - startedAt >= o.idleMs) { reset(wake ? 'wait' : 'done'); o.onIdle(); }
        return;
      }
      if (now - lastHeard >= o.silenceMs || now - startedAt >= o.maxMs) commit();
    }
    // Tap again / release the mic: send what was said now (or give up quietly if nothing was).
    function flush() { if (mode === 'capture') commit(); }
    // While JARVIS itself is talking, what the mic hears is JARVIS — ignore it, and skip it afterwards.
    function setMuted(m) {
      if (muted === !!m) return;
      muted = !!m;
      if (!muted) { from = pieces.length; if (mode === 'capture' && !spoke) startedAt = o.now(); }
    }
    return { update, sessionEnded, tick, flush, setMuted, get mode() { return mode; }, get text() { return text; } };
  }
  return { createUtterance, wakeEnd, lev };
})();
if (typeof module !== 'undefined') module.exports = Voice;
