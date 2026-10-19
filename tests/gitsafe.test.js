// What "commit all changes" would stage, and what looks like a secret (gitsafe.js), on a real temp git repository. Run: node tests/gitsafe.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, execFile } = require('child_process');
const G = require(path.join(__dirname, '..', 'gitsafe.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { console.log('gitsafe: skipped — git is not installed'); process.exit(0); }
const git = (args, cwd) => new Promise(r => execFile('git', args, { cwd, windowsHide: true, env: { ...process.env, GIT_CEILING_DIRECTORIES: os.tmpdir() } }, (err, out, serr) => r({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || ''), err: String(serr || '') })));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-gitsafe-'));
const sh = (a) => execFileSync('git', a, { cwd: tmp, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.invalid' }, stdio: 'pipe' });
sh(['init', '-q']); sh(['config', 'commit.gpgsign', 'false']);

(async () => {
  /* ---------- names ---------- */
  for (const f of ['.env', '.env.local', 'config/.env.production', 'server.pem', 'keys/id_rsa', 'id_ed25519.pub', 'aws-credentials.json', 'my_secret_notes.txt', 'cert.pfx', 'release.keystore', '.npmrc', 'a/b/private.key']) check('name is secret: ' + f, G.isSecretName(f), f);
  for (const f of ['README.md', 'index.js', 'environment.js', 'src/keyboard.js', 'secretary.md'.replace('secretary', 'notes'), '.env.example', '.env.sample', 'package.json', 'monkey.png']) check('name is fine: ' + f, !G.isSecretName(f), f);

  /* ---------- pending ---------- */
  let p = await G.pending(git, tmp); check('pending: an empty repository has nothing', !p.error && p.files.length === 0, p);
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'one'); fs.writeFileSync(path.join(tmp, 'keep me.txt'), 'two'); fs.mkdirSync(path.join(tmp, 'sub')); fs.writeFileSync(path.join(tmp, 'sub', 'c.js'), 'three');
  p = await G.pending(git, tmp);
  check('pending: new files are listed one by one (also inside folders, and names with spaces), as "?"', p.files.length === 3 && p.files.every(f => f.code === '?') && p.files.map(f => f.path).sort().join('|') === 'a.txt|keep me.txt|sub/c.js', p);
  sh(['add', '-A']); sh(['commit', '-q', '-m', 'first']);
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'changed'); fs.rmSync(path.join(tmp, 'keep me.txt')); fs.writeFileSync(path.join(tmp, 'new.txt'), 'n');
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'ignored.log\n'); fs.writeFileSync(path.join(tmp, 'ignored.log'), 'noise');
  p = await G.pending(git, tmp); const by = Object.fromEntries(p.files.map(f => [f.path, f.code]));
  check('pending: modified M, deleted D, new ?; an ignored file is not listed (git add -A would skip it)', by['a.txt'] === 'M' && by['keep me.txt'] === 'D' && by['new.txt'] === '?' && !('ignored.log' in by) && by['.gitignore'] === '?', by);
  sh(['add', '-A']); sh(['commit', '-q', '-m', 'second']); sh(['mv', 'sub/c.js', 'sub/renamed.js']);
  p = await G.pending(git, tmp); check('pending: a rename is one entry (the new name), not two', p.files.length === 1 && p.files[0].code === 'R' && p.files[0].path === 'sub/renamed.js', p);
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-nogit-')); p = await G.pending(git, notRepo); check('pending: a folder that is not a repository is a clear error', /not a git repository/.test(p.error || '') && p.files.length === 0, p); fs.rmSync(notRepo, { recursive: true, force: true });

  /* ---------- secrets by content ---------- */
  const w = (name, text) => { fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true }); fs.writeFileSync(path.join(tmp, name), text); return { path: name, code: '?' }; };
  const cases = [
    ['key.txt.js', '-----BEGIN RSA PRIVATE KEY-----\nMIIE', 'private key'], ['aws.js', 'const k = "AKIAIOSFODNN7EXAMPLE";', 'AWS access key'], ['gh.js', 'token: ghp_' + 'a'.repeat(36), 'GitHub token'],
    ['slack.js', 'x = "xoxb-1234567890-abcdefghij"', 'Slack token'], ['openai.js', 'const k = "sk-' + 'A1b2'.repeat(8) + '"', 'API key'], ['google.js', 'key=AIza' + 'x'.repeat(35), 'Google API key'],
    ['stripe.js', 'const s = "' + 'sk_' + 'live_' + 'Ab12'.repeat(6) + '"', 'Stripe secret key'], ['npmtok.yml', 'token: ' + 'npm_' + 'a1B2c3'.repeat(6), 'npm token'],
    ['hf.py', 'HF = ' + 'hf_' + 'Zy9'.repeat(11), 'Hugging Face token'],
    ['pw.py', 'password = "correct-horse-battery"', 'hard-coded password'], ['conf.json', '{"api_key": "abcdefghijklmnop1234"}', 'hard-coded password'],
  ];
  for (const [name, text, why] of cases) { const r = G.findSecrets([w(name, text)], tmp); check('content secret found: ' + name, r.length === 1 && r[0].path === name && r[0].why.includes(why), r); }
  const clean = [w('ok1.js', 'const password = process.env.PASSWORD;'), w('ok2.js', 'const password = "";'), w('ok3.md', 'Use your API key from the dashboard.'), w('ok4.js', 'function token() { return 1 }'), w('ok5.js', 'const apiKey = "${KEY}";'), w('.env.example', 'API_KEY=')];
  check('ordinary code and docs are NOT flagged (env lookups, empty strings, prose, a .env.example)', G.findSecrets(clean, tmp).length === 0, G.findSecrets(clean, tmp));
  check('by name: .env and a .pem are flagged without being opened (even when the file does not exist)', G.findSecrets([{ path: '.env', code: '?' }, { path: 'x/server.pem', code: 'A' }], tmp).map(s => s.why).every(x => /name/.test(x)));
  check('a deleted file is not scanned, an unreadable/missing one does not throw', G.findSecrets([{ path: 'gone.js', code: 'D' }, { path: 'missing.js', code: '?' }], tmp).length === 0);
  const bin = path.join(tmp, 'blob.bin'); fs.writeFileSync(bin, Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from('AKIAIOSFODNN7EXAMPLE')])); check('a binary file is skipped (no false alarm from its bytes)', G.findSecrets([{ path: 'blob.bin', code: '?' }], tmp).length === 0);
  const big = path.join(tmp, 'big.txt'); fs.writeFileSync(big, 'x'.repeat(300 * 1024) + '\npassword = "correct-horse-battery"'); check('only the first 200 KB of a big file is read (it finishes quickly)', G.findSecrets([{ path: 'big.txt', code: '?' }], tmp).length === 0);
  check('several files: each problem is reported once, in order', (() => { const r = G.findSecrets([w('m1.js', 'AKIAIOSFODNN7EXAMPLE'), { path: '.env', code: '?' }, w('m2.js', 'fine')], tmp); return r.length === 2 && r[0].path === 'm1.js' && r[1].path === '.env'; })());

  /* ---------- redact ---------- */
  const red = G.redact('const k = "AKIAIOSFODNN7EXAMPLE";\nghp_' + 'a'.repeat(36) + '\npassword = "correct-horse-battery"\n-----BEGIN PRIVATE KEY-----\nnormal line here');
  check('redact: tokens, keys and password lines are blanked, the rest stays', !/AKIAIOSFODNN7EXAMPLE/.test(red) && !/ghp_a{36}/.test(red) && !/correct-horse-battery/.test(red) && !/BEGIN PRIVATE KEY/.test(red) && /normal line here/.test(red) && (red.match(/\[REDACTED\]/g) || []).length >= 4, red);
  check('redact: text with no secrets is returned unchanged; junk never throws', G.redact('hello world 123') === 'hello world 123' && G.redact('') === '' && G.redact(null) === '' && G.redact(undefined) === '');
  check('redact: can be called twice in a row (global regexes keep no state between calls)', G.redact('AKIAIOSFODNN7EXAMPLE') === G.redact('AKIAIOSFODNN7EXAMPLE'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`gitsafe: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
