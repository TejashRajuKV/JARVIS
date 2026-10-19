// Speak while writing (speech-stream.js): sentence splitting however the text arrives, what is worth saying aloud, the 320-character rule,
// code blocks, the queue (order, prefetch, Stop), and the words that mean "stop". No voice needed. Run: node tests/speechstream.test.js
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'speech-stream.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const keep = setInterval(() => {}, 1000);

// split `text` arriving in chunks of `size` characters (0 = all at once, -1 = uneven pieces)
function sentences(text, size) {
  const sp = S.createSplitter(), out = [];
  if (size === 0) out.push(...sp.push(text));
  else if (size > 0) for (let i = 0; i < text.length; i += size) out.push(...sp.push(text.slice(i, i + size)));
  else { let i = 0, k = 0; const sizes = [1, 7, 2, 13, 3, 5, 1, 21]; while (i < text.length) { const n = sizes[k++ % sizes.length]; out.push(...sp.push(text.slice(i, i + n))); i += n; } }
  out.push(...sp.flush());
  return out;
}
const same = (text, want, label) => { for (const size of [0, 1, 3, 10, -1]) { const got = sentences(text, size); check(label + ' (chunks of ' + (size || 'all') + ')', JSON.stringify(got) === JSON.stringify(want), got); } };

/* ---------- splitting ---------- */
same('Hello there. How are you? I am fine! Thanks.', ['Hello there.', 'How are you?', 'I am fine!', 'Thanks.'], 'plain sentences');
same('Use e.g. Python for this. It is simple.', ['Use e.g. Python for this.', 'It is simple.'], 'e.g. does not end a sentence');
same('Ask Dr. Rao about it. She knows.', ['Ask Dr. Rao about it.', 'She knows.'], 'Dr. does not end a sentence');
same('Pi is about 3.14 and e is 2.718. Both are irrational.', ['Pi is about 3.14 and e is 2.718.', 'Both are irrational.'], 'decimals');
same('Open main.py and run it. Then check output.txt for results.', ['Open main.py and run it.', 'Then check output.txt for results.'], 'file names');
same('The U.S. team won. Everyone cheered.', ['The U.S. team won.', 'Everyone cheered.'], 'U.S.');
same('J. K. Rowling wrote it. It sold well.', ['J. K. Rowling wrote it.', 'It sold well.'], 'initials');
same('He said "stop." Then he left. She said (quietly.) Nothing else.', ['He said "stop."', 'Then he left.', 'She said (quietly.)', 'Nothing else.'], 'quotes and brackets after the full stop');
same('Wait... what? Really?! Yes.', ['Wait... what?', 'Really?!', 'Yes.'], 'ellipsis, ?! and !');
same('Version 3. then more text follows here. Next One.', ['Version 3. then more text follows here.', 'Next One.'], 'a full stop followed by a lowercase word continues the sentence');
same('Steps:\n1. First do this.\n2. Then do that.\nDone.', ['Steps:', '1. First do this.', '2. Then do that.', 'Done.'], 'numbered list');
same('Here are the points:\n- one thing\n- another thing\n\nThat is all.', ['Here are the points:', '- one thing', '- another thing', 'That is all.'], 'bullets and blank lines');
same('**Title**\nSome text here. More text.', ['**Title**', 'Some text here.', 'More text.'], 'a heading line');
same('తెలుగు వాక్యం ఇది. రెండవ వాక్యం ఇది.', ['తెలుగు వాక్యం ఇది.', 'రెండవ వాక్యం ఇది.'], 'Telugu full stops');
same('No. I will not do that. Yes. I will.', ['No.', 'I will not do that.', 'Yes.', 'I will.'], '"No." and "Yes." can be whole sentences');
same('No ending here', ['No ending here'], 'text with no full stop is still said at the end');
same('', [], 'nothing');
same('   \n  ', [], 'only spaces');
same('One. Two. Three.', ['One.', 'Two.', 'Three.'], 'short ones');
// a sentence is only released once the next one has begun, so half a sentence is never spoken
{ const sp = S.createSplitter(); const a = sp.push('The first sentence is done. The seco'), b = sp.push('nd is not.'), c = sp.flush();
  check('a sentence is released only when it is complete; the half-written one waits', JSON.stringify(a) === JSON.stringify(['The first sentence is done.']) && b.length === 0 && JSON.stringify(c) === JSON.stringify(['The second is not.']), { a, b, c }); }
{ const sp = S.createSplitter(); const a = sp.push('Done. '), b = sp.push('Next'); check('"Done. " alone is not enough (the next sentence has to start), "Next" completes it', a.length === 0 && JSON.stringify(b) === JSON.stringify(['Done.']), { a, b }); }

/* ---------- code blocks ---------- */
{
  const text = 'Here is the code:\n```python\nprint("hi. there")\nx = 1. 2\n```\nThat prints a greeting. Done.';
  for (const size of [0, 1, 4, -1]) {
    const got = sentences(text, size);
    check('code: the sentence before it, then a code marker; nothing inside the block is a sentence (chunks of ' + (size || 'all') + ')', got[0] === 'Here is the code:' && got[1] === S.CODE && !got.some(g => /print[(]|x = 1/.test(g)), got);
    check('code: the text after the block is split normally (chunks of ' + (size || 'all') + ')', got.includes('That prints a greeting.') && got.includes('Done.'), got);
  }
  const unclosed = sentences('Look:\n```js\nlet a = 1;\nlet b = 2;', 3);
  check('code: a block that never closes still ends with the marker, and none of it is a sentence', unclosed[0] === 'Look:' && unclosed.includes(S.CODE) && !unclosed.some(g => /let/.test(g)), unclosed);
  check('code: the three backticks arriving one at a time are still found', JSON.stringify(sentences('A.\n``` x ``` B.', 1)).includes('\\u0000CODE') || sentences('A.\n``` x ``` B.', 1).includes(S.CODE));
}

/* ---------- what is worth saying ---------- */
check('clean: markdown goes, words stay', S.clean('**Bold** and `code` and [a link](https://x.test/a) here.') === 'Bold and code and a link here.');
check('clean: bullets, numbers and heading marks are dropped', S.clean('- one thing') === 'one thing' && S.clean('3. third') === 'third' && S.clean('## Heading') === 'Heading');
check('clean: a bare URL becomes "the link"', S.clean('See https://example.com/very/long/path?x=1 for more.') === 'See the link for more.');
check('clean: lines with no letters or digits are not spoken', S.clean('---') === '' && S.clean('***') === '' && S.clean('| |') === '' && S.clean('') === '' && S.clean(null) === '' && S.clean(S.CODE) === '');
check('clean: Telugu and numbers count as words', S.clean('తెలుగు') === 'తెలుగు' && S.clean('42') === '42');

/* ---------- early speech: the rule for how much is said ---------- */
function early(text, opts = {}, size = 7) {
  const said = []; const e = S.createEarly({ enqueue: t => said.push(t), ...opts });
  for (let i = 0; i < text.length; i += size) e.feed(text.slice(i, i + size));
  const r = e.finish();
  return { said, ...r, e };
}
{
  const short = 'The capital of France is Paris. It is on the Seine. It has about two million people.';
  const r = early(short);
  check('early: a short answer (under 320 characters) is spoken in full, a sentence at a time, with no "on screen" note', r.said.length === 3 && r.said[0] === 'The capital of France is Paris.' && r.suffix === '' && r.truncated === false && r.spoke === true, r);
  const long = Array.from({ length: 12 }, (_, i) => 'This is sentence number ' + (i + 1) + ' of a rather long answer about the topic.').join(' ');
  const l = early(long);
  check('early: a long answer: the first two sentences always, more only while the total stays under 320 characters, then the note', l.sentences >= 2 && l.spokenChars <= 320 + 80 && l.sentences < 12 && l.truncated === true && l.suffix === S.SUFFIX, { sentences: l.sentences, chars: l.spokenChars });
  check('early: the spoken text never goes over 320 characters unless the first two sentences themselves are longer', l.said.slice(2).reduce((n, s, i, a) => n + s.length, l.said.slice(0, 2).join('').length) <= 320 || l.sentences === 2, l.said);
  const huge = ['A' + 'x'.repeat(250) + '.', 'B' + 'y'.repeat(250) + '.', 'Third sentence is here.'].join(' ');
  const h = early(huge, {}, 50);
  check('early: the first two sentences are always spoken even when they are long; the third is not', h.sentences === 2 && h.truncated && h.suffix === S.SUFFIX, { s: h.sentences, said: h.said.map(x => x.length) });
  const one = early('Just one sentence');
  check('early: an answer with no full stop is spoken once the stream ends', one.said.length === 1 && one.said[0] === 'Just one sentence' && one.suffix === '');
  const empty = early('');
  check('early: an empty answer says nothing', empty.said.length === 0 && empty.spoke === false && empty.suffix === '');
  const md = early('**Note:** use `ls -la` to list files.\n- first point here\n- second point here\nThat is all.');
  check('early: markdown is cleaned before speaking; list items are separate sentences', md.said[0] === 'Note: use ls -la to list files.' && md.said[1] === 'first point here' && md.said[2] === 'second point here' && md.said[3] === 'That is all.', md.said);
  const code = early('Here is a loop:\n```js\nfor (let i = 0; i < 3; i++) console.log(i);\n```\nIt prints three numbers.');
  check('early: code is never read out: the intro, then "The code is on screen.", then nothing more', code.said.length === 2 && code.said[0] === 'Here is a loop:' && code.said[1] === S.CODE_NOTE && code.code === true && code.suffix === '', code.said);
  const onlyCode = early('```js\nlet x = 1;\n```\nDone.');
  check('early: an answer that starts with code says nothing at all (the whole reply is spoken normally by the page, as "(code on screen)")', onlyCode.said.length === 0 && onlyCode.spoke === false, onlyCode.said);
  const tel = early('Hello there. తెలుగు వాక్యం ఇది. Another one.', { isEnglish: t => !/[ఀ-౿]/.test(t) });
  check('early: when a sentence is not English the early speech stops (the page translates those replies afterwards)', tel.said.length === 1 && tel.said[0] === 'Hello there.' && tel.e.dead === true, tel.said);
  const e2 = S.createEarly({ enqueue: () => {} }); e2.feed('A tool call follows. << tool >>'); e2.cancel(); e2.feed('More text. And more text.');
  check('early: cancel stops everything that comes after', e2.finish().sentences <= 1);
  // chunk size must not change what is said
  const text = 'First point. Second point is longer than the first. Third point. Fourth point wraps up the whole answer nicely.';
  const base = early(text, {}, 1).said.join('|');
  check('early: the same words are spoken however the text arrives', [2, 5, 11, 50, 500].every(n => early(text, {}, n).said.join('|') === base), base);
}

/* ---------- the queue ---------- */
(async () => {
  const log = [];
  let release = null; const gate = () => new Promise(r => { release = r; });
  const q = S.createQueue({ play: async (t, prep) => { log.push('start ' + t + (prep ? ' (' + prep + ')' : '')); await (t === 'two' ? gate() : new Promise(r => setTimeout(r, 5))); log.push('end ' + t); }, prefetch: t => 'clip-' + t });
  q.add('one'); q.add('two'); q.add('three');
  await new Promise(r => setTimeout(r, 40));
  check('queue: sentences are played one at a time, in order, each with the clip fetched for it when it was queued', log.join() === 'start one (clip-one),end one,start two (clip-two)', log);
  check('queue: while one is playing, the others wait and the queue says it is busy', q.active === true && q.waiting === 1);
  release(); await q.idle();
  check('queue: after the gate opens the rest play in order and idle() resolves when everything is said', log.join() === 'start one (clip-one),end one,start two (clip-two),end two,start three (clip-three),end three' && q.active === false, log);
  // Stop: clear drops what is waiting and releases idle()
  log.length = 0; const q2 = S.createQueue({ play: async t => { log.push('start ' + t); await gate(); log.push('end ' + t); } });
  q2.add('a'); q2.add('b'); q2.add('c'); await new Promise(r => setTimeout(r, 10));
  let idleDone = false; q2.idle().then(() => { idleDone = true; });
  q2.clear(); await new Promise(r => setTimeout(r, 10));
  check('queue: Stop (clear) drops everything waiting and wakes anyone waiting for the end', idleDone === true && q2.waiting === 0 && q2.active === false, { idleDone, active: q2.active });
  release(); await new Promise(r => setTimeout(r, 20));
  check('queue: after Stop, the sentence that was playing ending does not start the next one', log.join() === 'start a,end a', log);
  q2.add('d'); release && setTimeout(() => release(), 5); await q2.idle();
  check('queue: after Stop it can be used again', log.includes('start d') && log.includes('end d'), log);
  const q3 = S.createQueue({ play: async t => { if (t === 'bad') throw new Error('voice failed'); log.push('ok ' + t); } });
  log.length = 0; q3.add('bad'); q3.add('good'); await q3.idle();
  check('queue: a sentence that cannot be spoken is skipped, the next one still plays', log.join() === 'ok good', log);
  const q4 = S.createQueue({ play: async () => {}, prefetch: () => Promise.reject(new Error('fetch failed')) });
  q4.add('x'); await q4.idle(); check('queue: a failing prefetch never causes an unhandled error', true);
  check('queue: an empty queue is idle at once', (await S.createQueue({ play: async () => {} }).idle()) === undefined);

  /* ---------- the words that mean stop ---------- */
  for (const t of ['stop', 'Stop.', 'stop it', 'stop talking', 'stop speaking', 'please stop', 'jarvis stop', 'okay stop', 'stop now', 'stop the voice', 'be quiet', 'quiet', 'shut up', 'shush', 'hush', 'enough', "that's enough", 'enough already', 'stop reading', 'stop that please', 'ok jarvis stop talking', 'jarvis be quiet please', 'STOP!']) check('stop word: "' + t + '"', S.STOP_TALKING.test(t), t);
  for (const t of ['stop the timer', 'stop the music', 'stop watching the room', 'stop coaching', 'stop my focus session', 'stop the exam', 'stop lecture mode', 'do not stop', 'unstoppable', 'silence', 'mute', 'quiet hours', 'enough money to buy a laptop', 'stop at the next station', 'bus stop near me', 'stop and go', 'stopwatch', 'how do I stop a process in linux']) check('not a stop word: "' + t + '"', !S.STOP_TALKING.test(t), t);

  clearInterval(keep);
  console.log(`speechstream: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
