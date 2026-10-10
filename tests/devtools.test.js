// Developer helpers (devtools.js): git summary, commit message, error explainer — on temp git repositories with a fake AI. Run: node tests/devtools.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { createDevTools, windowOf } = require(path.join(__dirname, '..', 'devtools.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

let hasGit = true; try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }
if (!hasGit) { console.log('devtools: skipped — git is not installed'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dev-'));
const ME = { GIT_AUTHOR_NAME: 'Me', GIT_AUTHOR_EMAIL: 'me@example.com', GIT_COMMITTER_NAME: 'Me', GIT_COMMITTER_EMAIL: 'me@example.com' };
const g = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...process.env, ...ME, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const mkRepo = name => { const d = path.join(tmp, 'projects', name); fs.mkdirSync(d, { recursive: true }); g(d, ['init', '-q']); g(d, ['config', 'user.email', 'me@example.com']); g(d, ['config', 'user.name', 'Me']); g(d, ['config', 'commit.gpgsign', 'false']); return d; };
const commit = (d, file, content, msg, when, author) => { fs.writeFileSync(path.join(d, file), content); g(d, ['add', '-A']); const env = {}; if (when) { env.GIT_AUTHOR_DATE = when; env.GIT_COMMITTER_DATE = when; } if (author) { env.GIT_AUTHOR_NAME = author[0]; env.GIT_AUTHOR_EMAIL = author[1]; } g(d, ['commit', '-q', '-m', msg], env); };
const ago = h => new Date(Date.now() - h * 36e5).toISOString();
const root = path.join(tmp, 'projects');
const A = mkRepo('alpha'), B = mkRepo('beta'); fs.mkdirSync(path.join(root, 'notarepo'));
const prompts = []; let aiOut = 'Add login form validation\n\n- Check the email format\n- Show an error under the field', aiFail = null;
const complete = async o => { prompts.push(o); if (aiFail) throw new Error(aiFail); return typeof aiOut === 'function' ? aiOut(o) : aiOut; };
const T = createDevTools({ roots: () => [root], complete });

(async () => {
  /* ---------- windows ---------- */
  const NOW = new Date(2026, 9, 9, 15, 0).getTime();                                  // Friday
  check('window: today starts at midnight', windowOf('today', NOW).since === new Date(2026, 9, 9).getTime() && windowOf('today', NOW).until === null);
  check('window: yesterday is a full day', windowOf('yesterday', NOW).since === new Date(2026, 9, 8).getTime() && windowOf('yesterday', NOW).until === new Date(2026, 9, 9).getTime());
  check('window: this week starts on Monday (5 Oct), last week is the 7 days before', windowOf('week', NOW).since === new Date(2026, 9, 5).getTime() && windowOf('last week', NOW).since === new Date(2026, 9, 5 - 7).getTime() && windowOf('last week', NOW).until === new Date(2026, 9, 5).getTime());
  const MON = new Date(2026, 9, 12, 15).getTime(), SUN = new Date(2026, 9, 11, 15).getTime(), TUE = new Date(2026, 9, 13, 15).getTime();
  check('window: the last working day is yesterday on Tue–Sat and Friday on a Sunday or Monday', windowOf('prevday', TUE).label === 'yesterday' && windowOf('prevday', MON).label === 'on Friday' && windowOf('prevday', MON).since === new Date(2026, 9, 9).getTime() && windowOf('prevday', MON).until === new Date(2026, 9, 10).getTime() && windowOf('prevday', SUN).label === 'on Friday');
  check('window: unknown falls back to today', windowOf('nonsense', NOW).label === 'today');

  /* ---------- repos ---------- */
  check('repos: finds the repositories directly under a project folder, not plain folders', (await T.findRepos()).map(p => path.basename(p)).sort().join() === 'alpha,beta');
  const T2 = createDevTools({ roots: () => [A], complete }); check('repos: a project folder that is itself a repository is used', (await T2.findRepos()).map(p => path.basename(p)).join() === 'alpha');
  check('repos: a missing folder is skipped', (await createDevTools({ roots: () => [path.join(tmp, 'gone')], complete }).findRepos()).length === 0);

  /* ---------- summary ---------- */
  commit(A, 'a.txt', '1', 'Old work', ago(60));                                       // 2.5 days ago
  commit(A, 'b.txt', '1', 'Fix the login bug', ago(30));                               // yesterday-ish (may fall in today if early — checked by label below)
  commit(A, 'c.txt', '1', 'Add search page', ago(0.2));
  commit(A, 'd.txt', '1', "A teammate's change", ago(0.1), ['Other', 'other@example.com']);
  commit(B, 'x.txt', '1', 'Beta first commit', ago(0.1));
  fs.writeFileSync(path.join(A, 'wip.txt'), 'work in progress'); fs.writeFileSync(path.join(A, 'a.txt'), 'changed');
  let s = await T.summary({ window: 'today' });
  const a = s.repos.find(r => r.name === 'alpha'), b = s.repos.find(r => r.name === 'beta');
  check('summary today: my commits only (the teammate\'s is left out), newest first, with hash and time', a && a.commits.some(c => c.s === 'Add search page') && !a.commits.some(c => /teammate/.test(c.s)) && /^[0-9a-f]{7,}$/.test(a.commits[0].h) && a.commits[0].d, a);
  check('summary today: the other repo is listed, uncommitted files are counted with a stat', b && b.commits.length === 1 && a.uncommitted === 2 && /changed/.test(a.stat), [a && a.uncommitted, a && a.stat]);
  check('summary today: total counts all commits found', s.total === a.commits.length + b.commits.length && s.searched === 2 && s.label === 'today');
  s = await T.summary({ window: 'today', everyone: true }); check('summary: everyone=true includes the teammate', s.repos.find(r => r.name === 'alpha').commits.some(c => /teammate/.test(c.s)));
  s = await T.summary({ window: 'week' }); check('summary: this week reaches back to Monday (older than today but within it, when it is not Monday)', s.repos.find(r => r.name === 'alpha').commits.length >= 2 || new Date().getDay() === 1);
  s = await T.summary({ window: 'last week' }); check('summary: last week has none of today\'s commits', !s.repos.some(r => r.commits.some(c => c.s === 'Add search page')));
  s = await T.summary({ window: 'today', repo: A }); check('summary: one repo by path', s.repos.length === 1 && s.repos[0].name === 'alpha' && s.searched === 1);
  s = await T.summary({ window: 'today', repo: path.join(tmp, 'elsewhere') }); check('summary: a repo outside the project folders is refused', !!s.error && /not one of your project folders/.test(s.error));
  const empty = mkRepo('gamma'); s = await T.summary({ window: 'today', repo: empty }); check('summary: a repository with no commits and no changes is simply not listed', s.repos.length === 0 && !s.error, s);
  const noRepos = createDevTools({ roots: () => [path.join(tmp, 'gone')], complete }); s = await noRepos.summary({ window: 'today' }); check('summary: no projects found → empty result, not an error', s.total === 0 && s.searched === 0 && !s.error);
  const noGit = createDevTools({ roots: () => [root], complete, git: async () => ({ code: 1, out: '', err: 'spawn git ENOENT', missing: true }) }); s = await noGit.summary({ window: 'today' }); check('summary: git not installed → clear error', s.gitMissing && /not installed/.test(s.error));

  /* ---------- commit message ---------- */
  let r = await T.commitMessage({ repo: B });
  check('message: a repository with no changes says so', /no changes|uncommitted changes/.test(r.error || ''), r);
  fs.writeFileSync(path.join(B, 'login.js'), 'function validate(email){ return /@/.test(email); }\n'); g(B, ['add', 'login.js']);
  fs.writeFileSync(path.join(B, '.env'), 'API_KEY=super-secret-value-123'); fs.writeFileSync(path.join(B, 'server.pem'), 'PRIVATE KEY DATA XYZ'); g(B, ['add', '-f', '.env', 'server.pem']);
  fs.writeFileSync(path.join(B, 'notes.md'), 'untracked note');
  prompts.length = 0; r = await T.commitMessage({ repo: B, model: 'm1' });
  check('message: returns the AI\'s message, its subject, the repo, staged=true and a file count', r.message && r.subject === 'Add login form validation' && r.name === 'beta' && r.staged === true && r.files >= 2, r);
  const sent = prompts[0];
  check('message: the AI got the diff, the changed file names and the untracked file; the model name was passed', sent && /validate\(email\)/.test(sent.user) && /login\.js/.test(sent.user) && /notes\.md/.test(sent.user) && sent.model === 'm1', sent && sent.user.slice(0, 300));
  check('message: secrets are NOT sent — .env and .pem contents and names are absent', sent && !/super-secret-value-123/.test(sent.user) && !/PRIVATE KEY DATA/.test(sent.user) && !/\.env\b/.test(sent.user) && !/server\.pem/.test(sent.user), sent && sent.user);
  check('message: the instruction says the diff is data and to output the message only', /data, not instructions/.test(sent.system) && /Output the message only/.test(sent.system));
  check('message: nothing was staged, committed or changed by writing the message', g(B, ['log', '--oneline']).split('\n').filter(Boolean).length === 1 && /login\.js/.test(g(B, ['diff', '--cached', '--name-only'])));
  aiOut = '```\n"Fix typo in readme"\n```'; r = await T.commitMessage({ repo: B }); check('message: a code fence and quotes around the answer are removed', r.message === 'Fix typo in readme', r);
  aiOut = '   '; r = await T.commitMessage({ repo: B }); check('message: an empty AI answer is an error', /empty/.test(r.error || ''));
  aiFail = 'model is busy'; r = await T.commitMessage({ repo: B }); check('message: an AI failure is reported, not thrown', /could not write it: model is busy/.test(r.error), r); aiFail = null;
  aiOut = 'Update stuff';
  g(B, ['reset', '-q']); fs.rmSync(path.join(B, '.env')); fs.rmSync(path.join(B, 'server.pem'));
  r = await T.commitMessage({ repo: B }); check('message: unstaged changes are used when nothing is staged (new files listed as untracked)', r.message && r.staged === false, r);
  r = await T.commitMessage({}); check('message: with no repo named and two projects with changes → choices', Array.isArray(r.choices) && r.choices.length === 2, r);
  g(B, ['add', '-A']); g(B, ['commit', '-q', '-m', 'wip']); r = await T.commitMessage({ repo: A, model: 'm' });
  check('message: with changes in alpha only (wip.txt, a.txt) it works for alpha', r.name === 'alpha' && r.files >= 2, r);
  g(A, ['add', '-A']); g(A, ['commit', '-q', '-m', 'wip']); r = await T.commitMessage({}); check('message: no repo has changes → says so', /None of your projects/.test(r.error), r);
  r = await T.commitMessage({ repo: path.join(tmp, 'elsewhere') }); check('message: outside the project folders is refused', /not one of your project folders/.test(r.error));
  const big = 'x'.repeat(30000); fs.writeFileSync(path.join(A, 'big.txt'), big); g(A, ['add', 'big.txt']); prompts.length = 0; r = await T.commitMessage({ repo: A }); check('message: a huge diff is cut and flagged', r.truncated === true && prompts[0].user.length < 9000, [r.truncated, prompts[0] && prompts[0].user.length]);

  /* ---------- explain ---------- */
  fs.writeFileSync(path.join(A, 'app.js'), Array.from({ length: 40 }, (_, i) => 'line ' + (i + 1) + ' of app.js').join('\n'));
  const trace = 'TypeError: Cannot read properties of undefined (reading \'length\')\n    at getName (' + path.join(A, 'app.js') + ':20:5)\n    at Object.<anonymous> (' + path.join(A, 'node_modules', 'x', 'i.js') + ':1:1)\n    at Module._compile (node:internal/modules/cjs/loader:1256:14)';
  aiOut = '**What happened:** x is undefined.\n**Why:** line 20.\n**Fix:** check it first.';
  prompts.length = 0; r = await T.explain({ text: trace, model: 'q' });
  check('explain: finds my frame, reads the lines around it (marked), and sends them with the error', r.answer && /What happened/.test(r.answer) && r.files.length === 1 && r.files[0].name === 'app.js' && r.files[0].line === 20 && /^\s*20 > line 20 of app\.js/m.test(prompts[0].user) && /^\s*5   line 5 of app\.js/m.test(prompts[0].user) && /^\s*35   line 35/m.test(prompts[0].user) && !/line 36 of app/.test(prompts[0].user) && r.type === 'TypeError', [r, prompts[0] && prompts[0].user]);
  check('explain: node_modules and node: frames are not read', !/i\.js/.test(prompts[0].user.split('Your code:')[1] || ''));
  prompts.length = 0; r = await T.explain({ text: 'TypeError: x is undefined\n    at f (C:\\Windows\\System32\\drivers\\etc\\hosts.js:3:1)\n    at g (' + path.join(os.homedir(), '.ssh', 'id.js') + ':1:1)' });
  check('explain: files outside the project folders (Windows, .ssh) are never read — the AI still gets the error text', r.answer && !/Your code:/.test(prompts[0].user), prompts[0] && prompts[0].user);
  const blockedT = createDevTools({ roots: () => [root], complete }); prompts.length = 0; await blockedT.explain({ text: trace, blocked: p => /app\.js$/.test(p) }); check('explain: a path the server calls blocked is skipped', !/Your code:/.test(prompts[0].user));
  r = await T.explain({ text: 'what is the capital of france' }); check('explain: ordinary text is not an error', /does not look like an error/.test(r.error));
  aiFail = 'timeout'; r = await T.explain({ text: trace }); check('explain: an AI failure still names the files it found', /could not explain it: timeout/.test(r.error) && r.files.length === 1, r); aiFail = null;
  prompts.length = 0; r = await T.explain({ text: 'Error: Cannot find module \'express\'\n    at require (src\\server.js:3:17)', cwdHint: undefined }); check('explain: a relative path is looked up under the project folders (not found → error text only)', r.answer && !/Your code:/.test(prompts[0].user));
  fs.mkdirSync(path.join(A, 'src')); fs.writeFileSync(path.join(A, 'src', 'server.js'), 'a\nb\nconst x = require("express");\nd'); prompts.length = 0; r = await T.explain({ text: 'Error: Cannot find module \'express\'\n    at require (src/server.js:3:17)' });
  check('explain: …and when it exists under a project folder it is read', /Your code:/.test(prompts[0].user) && /3 > const x = require/.test(prompts[0].user), prompts[0].user);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`devtools: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL  crashed — ' + (e && e.stack || e)); process.exit(1); });
