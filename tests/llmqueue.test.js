// The local-model queue (llm.js): one job at a time on the GPU, chat before background work, nothing cut off, slots always given back; online providers are not queued.
// Against a fake Ollama whose replies are held until the test lets them go. Run: node tests/llmqueue.test.js
'use strict';
const http = require('http'), path = require('path');
const createLLM = require(path.join(__dirname, '..', 'llm.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // fake Ollama: each request is recorded (by the text it was asked) and answered only when released
  const started = [], waiters = new Map(); let inFlight = 0, maxInFlight = 0, mode = 'hold';
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body), tag = j.messages[j.messages.length - 1].content;
      started.push(tag); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const finish = () => {
        inFlight--;
        if (j.stream) { res.write(JSON.stringify({ message: { content: 'ans-' + tag }, done: false }) + '\n'); res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n'); }
        else res.end(JSON.stringify({ message: { content: 'ans-' + tag }, done: true }));
      };
      if (mode === 'fail') { inFlight--; res.statusCode = 400; return res.end('{"error":"bad"}'); }
      if (mode === 'instant') return finish();
      waiters.set(tag, finish);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const OLLAMA = 'http://127.0.0.1:' + server.address().port;
  const mk = (cfg = {}) => createLLM({ getConfig: () => cfg, saveConfig() {}, OLLAMA, DEFAULT_MODEL: 'm' });
  const llm = mk();
  const release = tag => { const f = waiters.get(tag); if (f) { waiters.delete(tag); f(); } };
  const ask = (tag, o = {}) => llm.complete({ model: 'm', messages: [{ role: 'user', content: tag }], ...o });
  const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); } return false; };

  // 1. one at a time; the waiting ones start in priority order, then arrival order
  const results = {};
  const run = (tag, o) => ask(tag, o).then(v => { results[tag] = v; });
  const pA = run('A-bg-running', { priority: 2 });
  await until(() => started.includes('A-bg-running'));
  const pB = run('B-bg-waiting', { priority: 2 }), pC = run('C-tool-waiting', { priority: 1 }), pD = run('D-chat-waiting', { priority: 0 }), pE = run('E-tool-waiting', {});
  await sleep(150);
  check('only one job runs on the local model at a time (the others wait)', started.length === 1 && maxInFlight === 1, started);
  check('queueStatus says one running and four waiting', llm.queueStatus().running === 1 && llm.queueStatus().waiting === 4, llm.queueStatus());
  release('A-bg-running'); await pA;
  await until(() => started.length === 2); release(started[1]);
  await until(() => started.length === 3); release(started[2]);
  await until(() => started.length === 4); release(started[3]);
  await until(() => started.length === 5); release(started[4]);
  await Promise.all([pB, pC, pD, pE]);
  check('a job already running is never cut off: A finished with its own answer', results['A-bg-running'] === 'ans-A-bg-running');
  check('the next jobs start chat first, then ordinary, then background (D, then C and E in the order asked, then B)', started.slice(1).join() === 'D-chat-waiting,C-tool-waiting,E-tool-waiting,B-bg-waiting', started);
  check('every job got its own answer back', ['B-bg-waiting', 'C-tool-waiting', 'D-chat-waiting', 'E-tool-waiting'].every(t => results[t] === 'ans-' + t));
  check('never more than one at once, start to finish', maxInFlight === 1);
  check('the queue is empty again', llm.queueStatus().running === 0 && llm.queueStatus().waiting === 0, llm.queueStatus());

  // 2. a stream holds the slot until it has been read to the end
  started.length = 0;
  const sP = llm.openStream({ model: 'm', priority: 0, messages: [{ role: 'user', content: 'S-chat' }] });      // (the fake sends headers only when it answers, so do not await yet)
  await until(() => started.includes('S-chat'));
  let done2 = false; const pF = ask('F-bg', { priority: 2 }).then(() => { done2 = true; });
  release('S-chat'); const s = await sP; await sleep(150);
  check('a background job waits while a chat stream is still open (even if the model has finished, until the reader is done)', !started.includes('F-bg') && llm.queueStatus().running === 1, started);
  let text = ''; for await (const d of s.deltas) text += d;
  check('the stream delivered its text', text === 'ans-S-chat', text);
  await until(() => started.includes('F-bg')); release('F-bg'); await pF;
  check('…and the background job ran right after the stream ended', done2 && llm.queueStatus().running === 0);

  // 3. a reader that stops early gives the slot back
  started.length = 0; mode = 'instant';
  const s2 = await llm.openStream({ model: 'm', messages: [{ role: 'user', content: 'EARLY' }] });
  for await (const d of s2.deltas) { break; }
  await sleep(50);
  check('a stream the reader abandons gives its slot back', llm.queueStatus().running === 0, llm.queueStatus());

  // 4. failures and cancels give the slot back
  mode = 'fail'; let err = null; try { await ask('BAD'); } catch (e) { err = e; }
  check('a failed request gives its slot back', !!err && llm.queueStatus().running === 0, llm.queueStatus());
  mode = 'hold';
  const ac = new AbortController(); started.length = 0;
  const pH = ask('H-holds'); await until(() => started.includes('H-holds'));
  const pI = ask('I-cancelled', { signal: ac.signal }).catch(e => e);
  await sleep(100); ac.abort();
  const ei = await pI;
  check('a request cancelled while it waits leaves the queue (and never reaches the model)', ei && ei.name === 'AbortError' && !started.includes('I-cancelled') && llm.queueStatus().waiting === 0, [ei && ei.name, started, llm.queueStatus()]);
  release('H-holds'); await pH;
  check('the slot is free again afterwards', llm.queueStatus().running === 0);

  // 5. the waiting callback tells the caller how many are ahead
  const aheads = []; const pJ = ask('J-holds'); await until(() => started.includes('J-holds'));
  const pK = ask('K-waits', { onWait: w => aheads.push(w.ahead) }); await sleep(100);
  check('onWait reports how many jobs are ahead (the one running)', aheads.length === 1 && aheads[0] === 1, aheads);
  release('J-holds'); await until(() => started.includes('K-waits')); release('K-waits'); await Promise.all([pJ, pK]);

  // 6. more lanes when asked for; online providers are not queued
  const llm2 = mk({ llmParallel: 2 }); started.length = 0; inFlight = 0; maxInFlight = 0;
  const q1 = llm2.complete({ model: 'm', messages: [{ role: 'user', content: 'P1' }] }), q2 = llm2.complete({ model: 'm', messages: [{ role: 'user', content: 'P2' }] }), q3 = llm2.complete({ model: 'm', messages: [{ role: 'user', content: 'P3' }] });
  await sleep(200);
  check('with llmParallel: 2 two jobs run at once and the third waits', maxInFlight === 2 && started.length === 2 && llm2.queueStatus().waiting === 1, [maxInFlight, started]);
  release('P1'); release('P2'); await until(() => started.includes('P3')); release('P3'); await Promise.all([q1, q2, q3]);
  const noq = llm.complete; // noQueue escape hatch for internal probes
  started.length = 0; const pL = ask('L-holds'); await until(() => started.includes('L-holds'));
  const pM = ask('M-probe', { noQueue: true }); await until(() => started.includes('M-probe'));
  check('a call marked noQueue (health probes) goes straight through', started.includes('M-probe') && llm.queueStatus().waiting === 0);
  release('L-holds'); release('M-probe'); await Promise.all([pL, pM]);

  // 7. Ollama not running at all: everything fails together and fast, instead of one failure after another through the queue
  {
    const dead = require('net').createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise(r => dead.close(r));      // a port nobody listens on
    const llmD = createLLM({ getConfig: () => ({}), saveConfig() {}, OLLAMA: 'http://127.0.0.1:' + deadPort, DEFAULT_MODEL: 'm' });
    const t0 = Date.now(); const errs = await Promise.all(Array.from({ length: 8 }, (_, i) => llmD.complete({ model: 'm', messages: [{ role: 'user', content: 'x' + i }] }).then(() => null, e => e)));
    const took = Date.now() - t0;
    check('a dead Ollama: eight calls at once all fail with the plain message, together and fast (no retry pauses one after another)', errs.every(e => e && /Ollama running/.test(e.message)) && took < 1500, [took, errs.map(e => e && e.message.slice(0, 30))]);
    const t1 = Date.now(); const e2 = await llmD.complete({ model: 'm', messages: [{ role: 'user', content: 'again' }] }).then(() => null, e => e);
    check('…and a call made right after fails at once, without even trying (it is not queued behind a server that is not there)', e2 && /Ollama running/.test(e2.message) && Date.now() - t1 < 100 && llmD.queueStatus().running === 0 && llmD.queueStatus().waiting === 0, [Date.now() - t1, llmD.queueStatus()]);
    await sleep(3200);
    const t2 = Date.now(); const e3 = await llmD.complete({ model: 'm', messages: [{ role: 'user', content: 'later' }] }).then(() => null, e => e);
    check('after a few seconds it tries again (Ollama may have been started meanwhile)', e3 && /Ollama running/.test(e3.message) && Date.now() - t2 >= 0 && llmD.queueStatus().running === 0);
  }
  server.close();
  console.log(`llmqueue: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exitCode = 1; });
