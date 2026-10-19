// Command palette (palette.js): the pure parts — fuzzy() scoring and buildItems() groups.
// palette.js is a browser IIFE that registers a keydown listener at load, so load it in a vm
// sandbox with a stub addEventListener (same trick as the nlu tests).
const vm = require('vm'), fs = require('fs'), path = require('path');
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const src = fs.readFileSync(path.join(__dirname, '..', 'palette.js'), 'utf8');
const sandbox = { module: { exports: {} }, addEventListener: () => {}, console };
vm.createContext(sandbox);
vm.runInNewContext(src, sandbox);
const { fuzzy, buildItemsRef } = sandbox.module.exports;
check('exports fuzzy + buildItems', typeof fuzzy === 'function' && typeof buildItemsRef === 'function');

// --- fuzzy() ---
check('empty query matches everything (score 1)', fuzzy('', 'anything') === 1 && fuzzy('   ', 'anything') === 1);
check('missing char → null', fuzzy('zzz', 'Attendance report') === null && fuzzy('xyz', 'Run diagnostics') === null);
check('case-insensitive subsequence', fuzzy('ATTN', 'Attendance') !== null && fuzzy('atten', 'ATTENDANCE report') !== null);
check('word-start match beats mid-word scatter', fuzzy('atten', 'Attendance report') > fuzzy('atten', 'xa t t e n d a'));
check('prefix scores higher than scattered', fuzzy('pl', 'Plan my day') > fuzzy('pl', 'Help plan'));
check('spaces are free (phrase queries work)', fuzzy('my day', 'Plan my day') !== null);
check('full phrase beats partial', fuzzy('plan my day', 'Plan my day') > fuzzy('plan my day', 'Plan my gate prep'));

// --- buildItems() (with CHIP_GROUPS/Agent absent, as when loaded standalone) ---
const items = buildItemsRef();
check('every entry has label + cmd + group', items.length > 20 && items.every(it => it.label && it.cmd && it.group));
check('no duplicate labels', new Set(items.map(it => it.label)).size === items.length);
const groups = new Set(items.map(it => it.group));
for (const g of ['Study', 'Attendance', 'Focus', 'Automation', 'System', 'Help']) check('has group ' + g, groups.has(g));
check('attendance & marks entries present', items.some(i => /attendance report/i.test(i.label)) && items.some(i => /cgpa/i.test(i.label)));
check('panic + resume present', items.some(i => /panic/i.test(i.label)) && items.some(i => /resume/i.test(i.label)));
check('learned phrases only when Agent exists', !items.some(i => i.group === 'Learned'));

// skill packs: loaded SKILL.md skills get a "/name…" entry in the Skills group (label ends in … so "/" fills the box)
check('no skill-pack entries when none are loaded', !items.some(i => i.group === 'Skills' && /^\//.test(i.label)));
{
  const sb2 = { module: { exports: {} }, addEventListener: () => {}, console, Skills: { packs: [{ name: 'quick', hint: 'Short answers.' }, { name: 'research', hint: 'Web answer with sources.' }] } };
  vm.createContext(sb2); vm.runInNewContext(src, sb2);
  const its = sb2.module.exports.buildItemsRef();
  const q = its.find(i => i.label === '/quick…');
  check('skill pack entry: label, command, group, hint', q && q.cmd === '/quick' && q.group === 'Skills' && q.hint === 'Short answers.', q);
  check('skill pack entries: one per skill, labels still unique', its.filter(i => /^\/.+…$/.test(i.label)).length === 2 && new Set(its.map(i => i.label)).size === its.length);
  check('skill pack entries are found by fuzzy search on the hint', fuzzy('sources', q.label + ' ' + q.group + ' ' + q.hint) === null && sb2.module.exports.fuzzy('sources', '/research… Skills Web answer with sources.') !== null);
}

// fuzzy finds entries by label or group text (what render() searches)
const hit = items.filter(it => fuzzy('bunk', it.label + ' ' + it.group + ' ' + it.hint) !== null);
check('searching "bunk" finds the bunk checker', hit.some(i => /bunk/i.test(i.label)));

console.log(total + '/' + total + ' palette checks passed');
process.exitCode = fail ? 1 : 0;
