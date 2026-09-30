// Scheduler tests: server-side reminder firing, repeat scheduling, and the merge rule that stops a stale tab from
// un-firing or rewinding reminders. Run: node tests/scheduler.test.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'scheduler.js'));

let fail = 0, total = 0;
const check = (name, ok) => { total++; if (!ok) { fail++; console.log('FAIL  ' + name); } };
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

// nextOccurrence
{
  const base = at(2026, 9, 28, 9); // Monday
  check('daily → next day same time', S.nextOccurrence({ at: base, repeat: { type: 'daily' } }, base) === at(2026, 9, 29, 9));
  check('daily skips missed days', S.nextOccurrence({ at: base, repeat: { type: 'daily' } }, at(2026, 10, 1, 12)) === at(2026, 10, 2, 9));
  const fri = at(2026, 10, 2, 8);
  check('weekdays: Friday → Monday', S.nextOccurrence({ at: fri, repeat: { type: 'weekdays' } }, fri) === at(2026, 10, 5, 8));
  check('weekly → +7 days', S.nextOccurrence({ at: base, repeat: { type: 'weekly', day: 1 } }, base) === base + 7 * 864e5);
  check('interval → +ms, skipping missed', S.nextOccurrence({ at: base, repeat: { type: 'interval', ms: 36e5 } }, base + 2.5 * 36e5) === base + 3 * 36e5);
  check('interval floor is 1 minute (no tight loop)', S.nextOccurrence({ at: base, repeat: { type: 'interval', ms: 0 } }, base) === base + 6e4);
}

// fireDue
{
  const now = at(2026, 9, 29, 12);
  const list = [
    { id: 'a', text: 'one-off due', at: now - 1000, fired: false },
    { id: 'b', text: 'future', at: now + 60e3, fired: false },
    { id: 'c', text: 'repeat due', at: now - 1000, fired: false, repeat: { type: 'daily' } },
    { id: 'd', text: 'routine', at: now - 1000, fired: false, repeat: { type: 'daily' }, routineId: 'r-morning' },
    { id: 'e', text: 'old fired', at: now - 8 * 864e5, fired: true },
    { id: 'f', text: 'recent fired', at: now - 864e5, fired: true },
  ];
  const { list: out, events } = S.fireDue(list, now);
  const get = id => out.find(r => r.id === id);
  check('fires due one-off', get('a').fired === true && events.some(e => e.id === 'a' && e.fired));
  check('leaves future alone', !get('b').fired && !events.some(e => e.id === 'b'));
  check('repeat moves forward, not fired', !get('c').fired && get('c').at > now && events.some(e => e.id === 'c' && !e.fired));
  check('routine schedules are left to the page', get('d').at === list[3].at && !events.some(e => e.id === 'd'));
  check('prunes fired one-offs older than a week', !get('e'));
  check('keeps recently fired one-offs', !!get('f'));
  check('input list not mutated', list[0].fired === false);
  check('exactly 2 events', events.length === 2);
}

// mergeReminders: a stale tab writes back its old copy
{
  const server = [
    { id: 'a', text: 'x', at: 100, fired: true },
    { id: 'c', text: 'repeat', at: 900, fired: false, repeat: { type: 'daily' } },
  ];
  const staleTab = [
    { id: 'a', text: 'x', at: 100, fired: false },
    { id: 'c', text: 'repeat', at: 500, fired: false, repeat: { type: 'daily' } },
    { id: 'n', text: 'new from tab', at: 2000, fired: false },
  ];
  const m = S.mergeReminders(server, staleTab);
  const get = id => m.find(r => r.id === id);
  check('stale tab cannot un-fire', get('a').fired === true);
  check('stale tab cannot rewind a repeat', get('c').at === 900);
  check('tab additions are kept', !!get('n'));
  check('tab deletions are kept', S.mergeReminders(server, [staleTab[2]]).length === 1);
  check('fresh tab can move a repeat forward', S.mergeReminders(server, [{ id: 'c', at: 1200, repeat: { type: 'daily' } }])[0].at === 1200);
}

// dueDeadlines
{
  const now = at(2026, 9, 29, 12);
  const dl = [
    { id: 'x', title: 'soon', due: now + 2 * 36e5, done: false },
    { id: 'y', title: 'later', due: now + 5 * 36e5, done: false },
    { id: 'z', title: 'done', due: now + 36e5, done: true },
    { id: 'w', title: 'past', due: now - 36e5, done: false },
  ];
  const due = S.dueDeadlines(dl, [], now);
  check('deadline within 3h alerts', due.length === 1 && due[0].id === 'x');
  check('already alerted deadline is skipped', S.dueDeadlines(dl, ['x'], now).length === 0);
}

console.log(`scheduler: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
