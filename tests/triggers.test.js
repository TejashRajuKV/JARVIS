// Trigger logic (triggers.js): edge detection, cooldown, what to measure, and parsing "when …, do …".
// Run: node tests/triggers.test.js
const path = require('path');
const T = require(path.join(__dirname, '..', 'triggers.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const findApp = s => ({ 'vs code': { k: 'vscode' }, vscode: { k: 'vscode' }, notepad: { k: 'notepad' }, chrome: { k: 'chrome' } }[s.trim().toLowerCase()] || null);
const procOf = k => ({ vscode: 'Code', notepad: 'notepad', chrome: 'chrome' }[k]);
const snap = o => ({ charger: null, battery: null, apps: null, wifi: null, ...o });

/* ---------- parsing ---------- */
const P = t => T.parseTriggerText(t, findApp);
check('plug in charger, comma', JSON.stringify(P('when I plug in my charger, start study mode')) === '{"when":{"type":"charger_plugged"},"action":"start study mode"}', P('when I plug in my charger, start study mode'));
check('plug in charger, no comma', P('when i plug in the charger run study mode').action === 'run study mode');
check('unplug wins over plug', P('whenever I unplug my charger, block distractions').when.type === 'charger_unplugged');
check('battery below', JSON.stringify(P('when the battery drops below 20%, run saver mode').when) === '{"type":"battery_below","n":20}');
check('battery below, no percent sign', P('when battery goes below 15 then turn on battery saver').when.n === 15);
check('app opened, comma', JSON.stringify(P('when I open vs code, block distractions')) === '{"when":{"type":"app_opened","app":"vscode"},"action":"block distractions"}', P('when I open vs code, block distractions'));
check('app opened, no comma', P('when i open vs code block distractions') && P('when i open vs code block distractions').when.app === 'vscode' && P('when i open vs code block distractions').action === 'block distractions', P('when i open vs code block distractions'));
check('app closed', P('when I close chrome, play lofi').when.type === 'app_closed');
check('wifi', JSON.stringify(P('when I connect to wifi HomeNet, start study mode').when) === '{"type":"wifi_connected","ssid":"HomeNet"}', P('when I connect to wifi HomeNet, start study mode'));
check('unknown app → not a trigger', P('when I open blorptron, run study mode') === null);
check('no event → null', P('when it rains, run study mode') === null);
check('not a "when" sentence → null', P('open vs code') === null && P('what time is it') === null);
check('routineNameFrom', T.routineNameFrom('run study mode') === 'study mode' && T.routineNameFrom('start the morning routine') === 'morning');

/* ---------- what to measure ---------- */
const trig = [{ id: 'a', when: { type: 'charger_plugged' } }, { id: 'b', when: { type: 'app_opened', app: 'notepad' } }];
check('needs: power+apps only', JSON.stringify(T.needs(trig)) === '{"power":true,"apps":true,"wifi":false}');
check('needs: nothing', JSON.stringify(T.needs([])) === '{"power":false,"apps":false,"wifi":false}');

/* ---------- edges ---------- */
const fire = (prev, cur, triggers, lf = new Map(), now = 1e6) => T.diffTriggers(prev, cur, triggers, now, lf, procOf);
check('first look never fires', fire(null, snap({ charger: true }), [{ id: 'a', when: { type: 'charger_plugged' } }]).length === 0);
check('plugged in fires on the edge', fire(snap({ charger: false }), snap({ charger: true }), [{ id: 'a', when: { type: 'charger_plugged' } }]).join() === 'a');
check('already plugged in → no fire', fire(snap({ charger: true }), snap({ charger: true }), [{ id: 'a', when: { type: 'charger_plugged' } }]).length === 0);
check('unplugged fires', fire(snap({ charger: true }), snap({ charger: false }), [{ id: 'u', when: { type: 'charger_unplugged' } }]).join() === 'u');
check('battery below fires once when crossing', fire(snap({ battery: 21, charger: false }), snap({ battery: 19, charger: false }), [{ id: 'b', when: { type: 'battery_below', n: 20 } }]).join() === 'b');
check('battery already below → no fire', fire(snap({ battery: 15, charger: false }), snap({ battery: 14, charger: false }), [{ id: 'b', when: { type: 'battery_below', n: 20 } }]).length === 0);
check('battery below while charging → no fire', fire(snap({ battery: 21, charger: true }), snap({ battery: 19, charger: true }), [{ id: 'b', when: { type: 'battery_below', n: 20 } }]).length === 0);
check('app opened', fire(snap({ apps: ['chrome'] }), snap({ apps: ['chrome', 'notepad'] }), [{ id: 'n', when: { type: 'app_opened', app: 'notepad' } }]).join() === 'n');
check('app process match ignores case', fire(snap({ apps: [] }), snap({ apps: ['code'] }), [{ id: 'v', when: { type: 'app_opened', app: 'vscode' } }]).join() === 'v');
check('app closed', fire(snap({ apps: ['notepad'] }), snap({ apps: [] }), [{ id: 'n', when: { type: 'app_closed', app: 'notepad' } }]).join() === 'n');
check('app still running → not "opened"', fire(snap({ apps: ['notepad'] }), snap({ apps: ['notepad'] }), [{ id: 'n', when: { type: 'app_opened', app: 'notepad' } }]).length === 0);
check('wifi connected (case-insensitive) on change only', fire(snap({ wifi: 'Other' }), snap({ wifi: 'homenet' }), [{ id: 'w', when: { type: 'wifi_connected', ssid: 'HomeNet' } }]).join() === 'w' && fire(snap({ wifi: 'HomeNet' }), snap({ wifi: 'HomeNet' }), [{ id: 'w', when: { type: 'wifi_connected', ssid: 'HomeNet' } }]).length === 0);
check('disabled trigger never fires', fire(snap({ charger: false }), snap({ charger: true }), [{ id: 'a', enabled: false, when: { type: 'charger_plugged' } }]).length === 0);
{
  const lf = new Map(), t = [{ id: 'a', cooldownMin: 10, when: { type: 'charger_plugged' } }];
  const a = fire(snap({ charger: false }), snap({ charger: true }), t, lf, 1e6);
  const b = fire(snap({ charger: false }), snap({ charger: true }), t, lf, 1e6 + 5 * 6e4);
  const c = fire(snap({ charger: false }), snap({ charger: true }), t, lf, 1e6 + 11 * 6e4);
  check('cooldown: fires, blocked inside 10 min, fires after', a.length === 1 && b.length === 0 && c.length === 1, [a, b, c]);
}
check('missing sensor data → no fire, no crash', fire(snap({ apps: null }), snap({ apps: null }), [{ id: 'n', when: { type: 'app_opened', app: 'notepad' } }]).length === 0);
check('describeWhen reads naturally', T.describeWhen({ type: 'battery_below', n: 20 }) === 'the battery drops below 20%' && T.describeWhen({ type: 'app_opened', app: 'vscode' }, 'VS Code') === 'VS Code is opened');

console.log(`triggers: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
