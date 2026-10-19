// The Node.js version check (nodecheck.js) and that package.json, the README and the check agree. Run: node tests/nodecheck.test.js
'use strict';
const fs = require('fs'), path = require('path');
const N = require(path.join(__dirname, '..', 'nodecheck.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
for (const v of ['16.20.2', '18.19.0', '18.20.4', '20.0.0', '20.2.9', '20.3.0', '20.9.1', '21.7.3', 'v19.9.0']) { const r = N.check(v); check('too old: ' + v, !r.ok && /needs Node\\.js 22 or newer/.test(r.fatal) && r.fatal.includes(v.replace(/^v/, '')) && /nodejs\\.org/.test(r.fatal), r); }
for (const v of ['22.0.0', '22.12.0', '24.1.0', 'v24.16.0', '30.0.0']) { const r = N.check(v); check('fine: ' + v, r.ok && r.fatal === null && r.warn === null, r); }
for (const v of ['', null, 'banana', 'v']) { const r = N.check(v); check('unreadable version is a clear refusal: ' + String(v), !r.ok && /could not tell/.test(r.fatal)); }
check('the running Node passes (the tests need it)', N.check().ok);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
check('package.json \"engines.node\" is the real minimum', pkg.engines && pkg.engines.node === '>=22', pkg.engines);
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
check('the README names the same minimum (not the old Node 18)', /Node\\.js 22 or newer/.test(readme) && !/Node\\.js 18 or newer/.test(readme));
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('server.js runs the check before it requires anything heavy and exits on a fatal', server.indexOf("require('./nodecheck')") > -1 && server.indexOf("require('./nodecheck')") < server.indexOf("require('./instance')") && /process\.exit\(1\)/.test(server.slice(server.indexOf("require('./nodecheck')"), server.indexOf("require('./instance')"))));
const tts = fs.readFileSync(path.join(__dirname, '..', 'tts.js'), 'utf8');
check('tts.js refuses cleanly when there is no built-in WebSocket', /typeof WebSocket === 'undefined'/.test(tts));
console.log(`nodecheck: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;