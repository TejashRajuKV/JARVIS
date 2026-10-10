'use strict';
/* Speak while writing. The AI's answer arrives a few words at a time; instead of waiting for the whole thing, the first sentence is spoken
   as soon as it is finished and the rest follow, one after the other. Pieces, all pure so they can be tested without a voice:
     createSplitter()  cuts the growing text into sentences, and copes with "e.g.", "Dr.", "3.14", "main.py", "1. list items", quotes, code blocks;
     clean(sentence)   turns one sentence of markdown into what is worth saying aloud;
     createEarly()     decides what to say: the first two sentences always, more only while the spoken total stays under 320 characters,
                       then "The full answer is on screen." (the same rule as speaking a finished answer), and never code;
     createQueue()     plays sentences one at a time, fetching the next voice clip while the current one plays; clear() drops everything
                       waiting, which is what Stop does.
   Nothing here talks to a speaker: script.js hands in the functions that do. */
const SpeechStream = (() => {
  // Words after which a full stop is NOT the end of a sentence ("Dr. Rao", "e.g. Python"). Words that can really end a sentence (no, etc, st) are not here.
  const ABBR = new Set(['e.g', 'eg', 'i.e', 'ie', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'fig', 'inc', 'ltd', 'approx', 'cf', 'ph.d']);
  const NEW_SENTENCE = /[A-Z0-9"'“‘(\[*#•ऀ-෿-]/;       // what a new sentence may start with after a full stop: capital, digit, quote, bracket, bullet, Indic letter
  const CODE = '\u0000CODE';

  function createSplitter() {
    let buf = '', inFence = false;
    const out = [];
    const emit = s => { const t = s.trim(); if (t) out.push(t); };
    // Is the "." that ends buf[0..end) really the end of a sentence?
    function fullStopEnds(before) {
      const tok = (before.match(/([A-Za-z.]+)$/) || [])[1] || '';
      const low = tok.toLowerCase().replace(/^\.+/, '');
      if (ABBR.has(low)) return false;
      if (/^[A-Za-z]$/.test(tok)) return false;                           // an initial: "J. K. Rowling"
      if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(tok)) return false;            // "U.S" or "a.m"
      if (/(?:^|\n)[ \t]*\d{1,3}$/.test(before)) return false;            // "1. First item": a list number, not a full stop
      return true;
    }
    function scan() {
      for (;;) {
        if (inFence) {
          const k = buf.indexOf('```');
          if (k < 0) { buf = buf.slice(Math.max(0, buf.length - 2)); return; }       // keep two characters in case the closing ``` is split across chunks
          buf = buf.slice(k + 3); inFence = false;
          continue;
        }
        const f = buf.indexOf('```'), nl = buf.indexOf('\n');
        let cut = -1;
        const re = /([.!?…।])([.!?…।"”’)\]]*)(\s+)(?=\S)/g;
        let m;
        while ((m = re.exec(buf))) {
          if (f >= 0 && m.index >= f) break;                                // the text after a code fence is dealt with once the fence is
          const run = m[1] + m[2], next = buf[m.index + m[0].length];
          if (/[!?…।]/.test(run)) { cut = m.index + run.length; break; }
          if (!NEW_SENTENCE.test(next)) continue;                           // "version 3. then" or "e.g. python": the sentence goes on
          if (!fullStopEnds(buf.slice(0, m.index))) continue;
          cut = m.index + run.length; break;
        }
        if (nl >= 0 && (cut < 0 || nl < cut) && (f < 0 || nl < f)) cut = nl + 1;      // a line break ends a sentence (list items, headings, paragraphs)
        if (cut >= 0) { emit(buf.slice(0, cut)); buf = buf.slice(cut); continue; }
        if (f >= 0) {
          emit(buf.slice(0, f));
          out.push(CODE);                                                   // code starts here: it is never read out
          buf = buf.slice(f + 3); inFence = true; continue;
        }
        return;
      }
    }
    return {
      push(delta) { buf += String(delta || ''); scan(); return out.splice(0); },
      flush() { scan(); if (!inFence && buf.trim()) { emit(buf); } buf = ''; return out.splice(0); },
      get pending() { return buf; },
    };
  }

  // One sentence of markdown → plain words to say. '' when there is nothing worth saying.
  function clean(sentence) {
    let s = String(sentence || '');
    if (s === CODE) return '';
    s = s.replace(/`([^`]+)`/g, '$1').replace(/\*\*|__|[*_#>|~]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*(?:[-•]\s+|\d{1,3}[.)]\s+)/, '').replace(/https?:\/\/\S+/g, 'the link').replace(/\s+/g, ' ').trim();
    return /[\p{L}\p{N}]/u.test(s) ? s : '';
  }

  const SUFFIX = 'The full answer is on screen.', CODE_NOTE = 'The code is on screen.';
  // enqueue(text) speaks one sentence. isEnglish(text) can stop it for another language (those replies are translated after the stream).
  function createEarly({ enqueue, maxChars = 320, firstFree = 2, isEnglish = () => true } = {}) {
    const split = createSplitter();
    let count = 0, chars = 0, truncated = false, code = false, dead = false;
    function handle(items) {
      for (const raw of items) {
        if (dead) return;
        if (raw === CODE) { code = true; dead = true; if (count) enqueue(CODE_NOTE); return; }
        const t = clean(raw);
        if (!t) continue;
        if (!isEnglish(t)) { dead = true; return; }
        if (truncated) continue;
        if (count >= firstFree && chars + t.length > maxChars) { truncated = true; continue; }
        count++; chars += t.length; enqueue(t);
      }
    }
    return {
      feed(delta) { if (dead) return; handle(split.push(delta)); },
      // the stream is over: say the last piece, then report what happened
      finish() {
        if (!dead) handle(split.flush());
        const spoke = count > 0;
        return { spoke, spokenChars: chars, sentences: count, truncated, code, suffix: spoke && truncated ? SUFFIX : '' };
      },
      cancel() { dead = true; },
      get spoke() { return count > 0; },
      get dead() { return dead; },
    };
  }

  // play(text, prepared) → Promise: say it. prefetch(text) → Promise|any: start getting the voice clip as soon as the sentence is queued.
  function createQueue({ play, prefetch } = {}) {
    let items = [], running = false, epoch = 0, waiters = [];
    const settle = () => { if (!running && !items.length) { const w = waiters.splice(0); w.forEach(r => r()); } };
    async function run() {
      if (running) return;
      running = true; const mine = epoch;
      try {
        while (items.length && mine === epoch) {
          const it = items.shift();
          try { await play(it.text, it.prep); } catch { /* a sentence that cannot be spoken is skipped */ }
        }
      } finally { if (mine === epoch) running = false; settle(); }
    }
    return {
      add(text) { let prep; try { prep = prefetch ? prefetch(text) : undefined; if (prep && prep.catch) prep.catch(() => {}); } catch { prep = undefined; } items.push({ text, prep }); run(); },
      clear() { epoch++; items = []; running = false; settle(); },
      idle() { return running || items.length ? new Promise(r => waiters.push(r)) : Promise.resolve(); },
      get active() { return running || items.length > 0; },
      get waiting() { return items.length; },
    };
  }

  // "stop", "be quiet" and friends. "silence" is deliberately not here: it already means "mute the volume".
  const STOP_TALKING = /^(?:(?:please|ok|okay|hey|jarvis)[,\s]+)*(?:stop(?:\s+(?:it|that|talking|speaking|reading|now|there|the\s+(?:voice|reading|talking)))?|be\s+quiet|quiet|shush|hush|shut\s+up|enough(?:\s+(?:now|already))?|that(?:'s|s|\s+is)\s+enough)(?:[,\s]+(?:please|jarvis|sir|now|thanks))*\s*[.!]*$/i;

  return { createSplitter, clean, createEarly, createQueue, STOP_TALKING, SUFFIX, CODE_NOTE, CODE };
})();
if (typeof module !== 'undefined') module.exports = SpeechStream;
