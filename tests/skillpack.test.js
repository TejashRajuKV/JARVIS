// Skill packs (skillpack.js): SKILL.md parsing, scanning folders, bundled vs yours, and the routes with a fake model.
// Run: node tests/skillpack.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const P = require(path.join(__dirname, '..', 'skillpack.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* ---------- parsing ---------- */
const ok = (t, folder) => P.parseSkill(t, folder);
{
  const r = ok('---\nname: quick\ndescription: Short answers.\ntriggers: [quick answer, "be brief"]\nuses: research\nmax_tokens: 160\n---\nAnswer in three sentences.', 'quick');
  check('parse: a normal skill', r.skill && r.skill.name === 'quick' && r.skill.description === 'Short answers.' && r.skill.body === 'Answer in three sentences.', r);
  check('parse: inline list, quotes removed', JSON.stringify(r.skill.triggers) === '["quick answer","be brief"]', r.skill.triggers);
  check('parse: uses + max_tokens', r.skill.uses === 'research' && r.skill.maxTokens === 160);
}
check('parse: dash-list triggers', JSON.stringify(ok('---\nname: a1\ndescription: d\ntriggers:\n  - first thing\n  - second thing\n---\nbody', 'a1').skill.triggers) === '["first thing","second thing"]');
{
  // many real skills write the description as a block ("description: >-") or wrap it over several lines
  const folded = ok('---\nname: wide\ndescription: >-\n  Use this when the user wants a summary\n  of a long document.\ntriggers: [summarise this]\n---\nbody', 'wide');
  check('parse: folded block description', folded.skill && folded.skill.description === 'Use this when the user wants a summary of a long document.' && folded.skill.triggers[0] === 'summarise this', folded);
  check('parse: literal block description', ok('---\nname: lit\ndescription: |\n  line one\n  line two\n---\nbody', 'lit').skill.description === 'line one line two');
  check('parse: description wrapped over indented lines', ok('---\nname: wrapped\ndescription: Use when asked to\n  review a pull request.\n---\nbody', 'wrapped').skill.description === 'Use when asked to review a pull request.');
  check('parse: a wrapped value does not swallow the next key', ok('---\nname: nk\ndescription: first\n  second\nuses: files\n---\nbody', 'nk').skill.uses === 'files');
  check('parse: quoted description', ok('---\nname: q\ndescription: "Use: for things"\n---\nbody', 'q').skill.description === 'Use: for things');
}
check('parse: name falls back to the folder name', ok('---\ndescription: d\n---\nbody', 'my-folder').skill.name === 'my-folder');
check('parse: Windows line endings + BOM', ok('﻿---\r\nname: win\r\ndescription: d\r\n---\r\nbody line\r\n', 'win').skill.body === 'body line');
check('parse: no header → error', /no header/.test(ok('just text', 'x').error));
check('parse: no description → error', /no description/.test(ok('---\nname: x\n---\nbody', 'x').error));
check('parse: no body → error', /no instructions/.test(ok('---\nname: x\ndescription: d\n---\n', 'x').error));
for (const bad of ['Has Caps', '../escape', 'a/b', '-lead', 'x'.repeat(41), 'has space', 'dot.name']) {
  check('parse: bad name refused: ' + bad, /must be lowercase/.test(ok('---\nname: ' + bad + '\ndescription: d\n---\nbody', 'folder').error || ''));
}
check('parse: unknown uses ignored (not an error)', ok('---\nname: x\ndescription: d\nuses: shell\n---\nbody', 'x').skill.uses === '');
check('parse: max_tokens clamped', ok('---\nname: x\ndescription: d\nmax_tokens: 999999\n---\nb', 'x').skill.maxTokens === 2000 && ok('---\nname: x\ndescription: d\nmax_tokens: 3\n---\nb', 'x').skill.maxTokens === 64);
{
  const long = ok('---\nname: x\ndescription: d\n---\n' + 'a'.repeat(P.MAX_BODY + 500), 'x').skill;
  check('parse: long instructions cut, and flagged', long.truncated && long.body.length < P.MAX_BODY + 60 && /cut to fit/.test(long.body));
}
check('parse: oversize file refused', /too big/.test(ok('---\nname: x\ndescription: d\n---\n' + 'a'.repeat(P.MAX_FILE + 1), 'x').error));
check('parse: description kept to one short line', ok('---\nname: x\ndescription: one\n---\nb', 'x').skill.description === 'one');

/* ---------- other tools' skills load unchanged ---------- */
{
  // Codex-style: name + description only, plus an agents/openai.yaml next to it that we ignore
  const codex = '---\nname: pdf-helper\ndescription: Use when the user asks to read or edit PDF files.\n---\n\n# PDF helper\n\n1. Open the file.\n2. Extract text.\n';
  const c = ok(codex, 'pdf-helper');
  check('codex-style skill loads', c.skill && c.skill.name === 'pdf-helper' && /Extract text/.test(c.skill.body), c);
  // Hermes-style: extra fields (version, platforms, metadata) are ignored
  const hermes = '---\nname: git-workflow\ndescription: Branch, commit and open a pull request.\nversion: 1.2.0\nplatforms: [macos, linux]\nmetadata:\n  hermes:\n    tags: [git]\n---\n\n# Git workflow\n\nUse short branches.\n';
  const h = ok(hermes, 'git-workflow');
  check('hermes-style skill loads (extra fields ignored)', h.skill && h.skill.name === 'git-workflow' && h.skill.uses === '' && /short branches/.test(h.skill.body), h);
}

/* ---------- scanning folders ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skp-'));
const mk = (dir, name, content, extra) => { const d = path.join(dir, name); fs.mkdirSync(d, { recursive: true }); if (content !== null) fs.writeFileSync(path.join(d, 'SKILL.md'), content); for (const [f, c] of Object.entries(extra || {})) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };
const sk = (name, desc, body) => '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n' + (body || 'Do the thing.');
const bundled = path.join(tmp, 'bundled'), mine = path.join(tmp, 'sandbox', 'Skills');
mk(bundled, 'alpha', sk('alpha', 'shipped alpha', 'SHIPPED'));
mk(bundled, 'beta', sk('beta', 'shipped beta'));
mk(mine, 'alpha', sk('alpha', 'my alpha', 'MINE'));
mk(mine, 'gamma', sk('gamma', 'my gamma'), { 'scripts/run.sh': 'echo should-never-run', 'references/big.md': 'x'.repeat(100) });
mk(mine, 'broken', 'no header here');
mk(mine, 'no-skill-file', null);
fs.writeFileSync(path.join(mine, 'stray.txt'), 'not a folder');
let linked = false;
try { fs.symlinkSync(path.join(bundled, 'beta'), path.join(mine, 'linked'), 'junction'); linked = true; } catch {}
const all = P.loadAll(bundled, mine);
const names = all.skills.map(s => s.name);
check('scan: bundled + yours, sorted', JSON.stringify(names) === '["alpha","beta","gamma"]', names);
check('scan: yours replaces the bundled one of the same name', all.skills.find(s => s.name === 'alpha').body === 'MINE' && all.skills.find(s => s.name === 'alpha').source === 'yours');
check('scan: bundled-only skill is marked bundled', all.skills.find(s => s.name === 'beta').source === 'bundled');
check('scan: a broken skill is skipped and reported, others still load', all.skipped.some(s => s.folder === 'broken' && /no header/.test(s.reason)));
check('scan: a folder without SKILL.md is ignored silently', !all.skipped.some(s => s.folder === 'no-skill-file'));
if (linked) check('scan: symlinked folders are not followed', !names.includes('linked') && all.skipped.some(s => s.folder === 'linked'), all.skipped);
check('scan: scripts/ and references/ never leak into the skill', !JSON.stringify(all.skills.find(s => s.name === 'gamma')).includes('should-never-run'));
check('scan: a missing folder is fine', P.loadAll(path.join(tmp, 'nope'), path.join(tmp, 'nope2')).skills.length === 0);
{
  const pv = P.publicView(all.skills.find(s => s.name === 'alpha'));
  check('publicView never sends the instructions', !('body' in pv) && !JSON.stringify(pv).includes('MINE') && pv.hint === 'my alpha' && pv.label === 'alpha', pv);
}

/* ---------- the shipped skills ---------- */
{
  const real = P.scanDir(path.join(__dirname, '..', 'skills-bundled'), 'bundled');
  const got = real.skills.map(s => s.name).sort();
  check('bundled: research, plan-then-act, quick, code-review, csv-insights and image-prompt all load', JSON.stringify(got) === '["code-review","csv-insights","image-prompt","plan-then-act","quick","research"]' && !real.skipped.length, { got, skipped: real.skipped });
  const by = n => real.skills.find(s => s.name === n) || {};
  check('bundled: uses wired up', by('research').uses === 'research' && by('plan-then-act').uses === 'plan' && by('code-review').uses === 'files' && by('quick').uses === '' && by('csv-insights').uses === '' && by('image-prompt').uses === '');
  check('bundled: none is cut or empty; the user-facing ones have trigger phrases (csv-insights is called by the CSV tool, not by words)', real.skills.every(s => !s.truncated && s.body.length > 80 && (s.triggers.length || ['csv-insights', 'image-prompt'].includes(s.name))));
  check('bundled: image-prompt keeps the subject and outputs only the prompt', /Keep the subject/.test(by('image-prompt').body) && /Output ONLY the prompt/.test(by('image-prompt').body) && by('image-prompt').maxTokens <= 200);
  check('bundled: csv-insights tells the AI it only sees statistics and must not invent numbers', /never see the rows/.test(by('csv-insights').body) && /ONLY the numbers in the digest/.test(by('csv-insights').body));
  check('bundled: quick is cheap on tokens', by('quick').maxTokens <= 200);
}

/* ---------- routes with a fake model ---------- */
const routes = {}, gets = {};
const app = { post: (p, h) => { routes[p] = h; }, get: (p, h) => { gets[p] = h; } };
let reply = 'ok', lastCall = null;
const llm = { complete: async o => { lastCall = o; if (reply instanceof Error) throw reply; return reply; } };
const sandbox = path.join(tmp, 'sandbox');
P(app, { llm, DEFAULT_MODEL: 'm0', SANDBOX: sandbox, bundledDir: bundled });
const call = async (table, p, body) => { let out, code = 200; await table[p]({ body }, { json: o => { out = o; }, status: c => ({ json: o => { code = c; out = o; } }) }); return { code, ...out }; };
(async () => {
  const list = await call(gets, '/api/skills');
  check('GET /api/skills: names + hints, no instructions', list.success && list.skills.length === 3 && !JSON.stringify(list).includes('MINE') && list.folder === mine, list);
  check('GET /api/skills: reports the skipped ones', list.skipped.some(s => s.folder === 'broken'));

  reply = '  The answer.  ';
  const r = await call(routes, '/api/skill/run', { skill: 'alpha', input: 'what is x', model: 'qwen' });
  check('run: reply returned, trimmed', r.success && r.text === 'The answer.' && r.skill === 'alpha', r);
  check('run: the skill\'s instructions are the system prompt', lastCall.system === 'MINE' && lastCall.messages[0].content === 'what is x' && lastCall.model === 'qwen');
  check('run: token limit + room for long input are set', lastCall.maxTokens === 700 && lastCall.numCtx === 8192);
  await call(routes, '/api/skill/run', { skill: 'alpha', input: 'x' });
  check('run: default model when none is sent', lastCall.model === 'm0');
  await call(routes, '/api/skill/run', { skill: 'ALPHA', input: 'x'.repeat(P.MAX_INPUT + 5000) });
  check('run: skill name is case-insensitive, input is capped', lastCall.messages[0].content.length === P.MAX_INPUT);
  check('run: unknown skill → 404', (await call(routes, '/api/skill/run', { skill: 'nope', input: 'x' })).code === 404);
  check('run: no skill name → 404', (await call(routes, '/api/skill/run', { input: 'x' })).code === 404);
  check('run: empty input → 400', (await call(routes, '/api/skill/run', { skill: 'alpha', input: '   ' })).code === 400);
  check('run: path-like names are just unknown', (await call(routes, '/api/skill/run', { skill: '../alpha', input: 'x' })).code === 404);
  reply = new Error('Local LLM unavailable');
  const e = await call(routes, '/api/skill/run', { skill: 'alpha', input: 'x' });
  check('run: model errors are reported (502)', e.code === 502 && /unavailable/.test(e.error));

  // a skill dropped in later shows up after reload, and a fixed one stops being skipped
  mk(mine, 'delta', sk('delta', 'added later'));
  check('reload: not visible until reloaded', (await call(gets, '/api/skills')).skills.length === 3);
  const rl = await call(routes, '/api/skills/reload', {});
  check('reload: picks up the new skill', rl.success && rl.count === 4, rl);
  fs.writeFileSync(path.join(mine, 'broken', 'SKILL.md'), sk('broken', 'fixed now'));
  await call(routes, '/api/skills/reload', {});
  const l2 = await call(gets, '/api/skills');
  check('reload: a repaired skill is no longer skipped', l2.skills.some(s => s.name === 'broken') && !l2.skipped.some(s => s.folder === 'broken'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`skillpack: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
