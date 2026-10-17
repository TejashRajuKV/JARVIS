// The public KPPP total (POST /api/tenders/count): only when Online is on, from one fixed address (a local fake here — no real network), cached,
// and never an error page: { available: false, why } when it cannot tell. Run: node tests/tendercount.test.js
'use strict';
const http = require('http');
const { startServer } = require('./lib/server');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

(async () => {
  let mode = 'ok', hits = 0;
  const fake = http.createServer((req, res) => {
    hits++;
    if (mode === 'down') { res.statusCode = 503; return res.end('busy'); }
    if (mode === 'junk') return res.end('<html>not json</html>');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ liveTenders: 2925, tendersClosingToday: 12, liveAuction: 0 }));
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const s = await startServer({ env: { JARVIS_KPPP_COUNT_URL: 'http://127.0.0.1:' + fake.address().port + '/count' } });
  try {
    let r = await s.post('/api/tenders/count', {});
    check('offline (Online tools off): KPPP is not asked, the answer says so', r.status === 200 && r.json.available === false && r.json.why === 'offline' && hits === 0, r.json);
    mode = 'down'; r = await s.post('/api/tenders/count', { online: true });
    check('KPPP answering an error: a plain "not available", not a server error', r.status === 200 && r.json.available === false && /503/.test(r.json.why) && hits === 1, r.json);
    mode = 'junk'; r = await s.post('/api/tenders/count', { online: true });
    check('KPPP answering something that is not the total: not available', r.json.available === false, r.json);
    mode = 'ok'; r = await s.post('/api/tenders/count', { online: true });
    check('Online on: the live total and how many close today', r.json.available === true && r.json.live === 2925 && r.json.closingToday === 12, r.json);
    const n = hits; r = await s.post('/api/tenders/count', { online: true, url: 'http://evil.example/' });
    check('asked again within 10 minutes: from the cache (KPPP is not asked again); a url in the request is ignored', r.json.cached === true && r.json.live === 2925 && hits === n, [r.json, hits, n]);
    const x = await s.post('/api/tenders/count', { online: true }, { headers: { Origin: 'http://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
    check('another website cannot ask', x.status === 403, x.status);
  } finally { await s.stop(); fake.close(); }
  console.log(`tendercount: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exitCode = 1; });
