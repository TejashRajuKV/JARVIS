// Everyday sentences (lifeparse.js): expenses, spending summaries, habits and streaks, quick capture — what is read, and what must be left alone.
// Fixed "now": Friday 9 October 2026, 15:00. Run: node tests/lifeparse.test.js
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'lifeparse.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const NOW = new Date(2026, 9, 9, 15, 0).getTime();
const day = t => L.ymd(t);

/* ---------- expenses ---------- */
const ex = t => L.parseExpense(t, NOW);
const eq = (t, amount, note, cat, d) => { const r = ex(t); check('expense: "' + t + '"', r && r.amount === amount && r.note === note && r.cat === cat && (!d || day(r.t) === d), r); };
eq('spent 120 on lunch', 120, 'lunch', 'Food');
eq('I spent ₹450 on books', 450, 'books', 'Study');
eq('paid 80 for auto', 80, 'auto', 'Transport');
eq('spent rs. 1,250 on a shirt', 1250, 'shirt', 'Shopping');
eq('I spent 1.5k on recharge', 1500, 'recharge', 'Phone & net');
eq('spent 2k for hostel rent', 2000, 'hostel rent', 'Rent & bills');
eq('paid 60 rupees for tea', 60, 'tea', 'Food');
eq('spent 90 on snacks yesterday', 90, 'snacks', 'Food', '2026-10-08');
eq('spent 40 on chai 2 days ago', 40, 'chai', 'Food', '2026-10-07');
eq('add expense 200 groceries', 200, 'groceries', 'Food');
eq('add an expense of 350 for movie', 350, 'movie', 'Fun');
eq('log expense: 75 bus', 75, 'bus', 'Transport');
eq('expense: 30 xerox', 30, 'xerox', 'Study');
eq('bought a calculator for 650', 650, 'calculator', 'Study');
eq('spent 100', 100, '', 'Other');
eq('Spent 55 on coffee.', 55, 'coffee', 'Food');
eq('spent 300 on medicine on monday', 300, 'medicine', 'Health', '2026-10-05');
eq('paid 15 for parking', 15, 'parking', 'Transport');
check('expense: the time of day is noon of that day, and "now" for today', day(ex('spent 10 on tea').t) === '2026-10-09' && ex('spent 10 on tea').t === NOW && new Date(ex('spent 10 on tea yesterday').t).getHours() === 12);
for (const t of ['spent time with friends', 'I spent the whole day studying', 'paid attention in class', 'spent 0 on nothing', 'spent -5 on tea', 'bought milk', 'I will spend 100 tomorrow', 'expenses', 'add expense', 'expense report', 'how much did I spend', 'pay my fees', 'gave a presentation', 'spend less', 'spent 99999999999 on a car', 'what is 5 times 6']) check('expense: not taken: "' + t + '"', ex(t) === null, ex(t));
check('expense: junk input never throws', ex('') === null && L.parseExpense(null) === null && ex('spent ' + '9'.repeat(5000) + ' on x') === null);

/* ---------- questions ---------- */
const q = t => L.parseExpenseQuery(t);
for (const [t, win, about] of [['how much did I spend this month', 'this month', ''], ['how much did I spend on food this week', 'this week', 'food'], ['what did I spend yesterday', 'yesterday', ''], ['expenses this month', 'this month', ''], ['show my expenses', 'this month', ''], ['my spending last month', 'last month', ''], ['expense summary', 'this month', ''], ['expense report this week', 'this week', ''], ['how much have I spent on transport', 'this month', 'transport'], ['spending summary today', 'today', '']]) {
  const r = q(t); check('expense question: "' + t + '"', r && r.window === win && r.about === about, r);
}
for (const t of ['spent 120 on lunch', 'how much does a laptop cost', 'what is my gpa', 'show my todos', 'expense', 'how much time did I spend studying']) check('expense question: not taken: "' + t + '"', q(t) === null, q(t));
const E = [{ t: new Date(2026, 9, 9, 13).getTime(), amount: 120, cat: 'Food', note: 'lunch' }, { t: new Date(2026, 9, 8, 13).getTime(), amount: 80, cat: 'Transport', note: 'auto' }, { t: new Date(2026, 9, 7, 13).getTime(), amount: 450, cat: 'Study', note: 'books' }, { t: new Date(2026, 9, 5, 13).getTime(), amount: 60, cat: 'Food', note: 'tea' }, { t: new Date(2026, 8, 20, 13).getTime(), amount: 999, cat: 'Fun', note: 'old' }];
let sm = L.summarize(E, 'this month', NOW);
check('summary: this month = October only; total, count, biggest category first, per-day average over the days so far', sm.total === 710 && sm.count === 4 && sm.byCat[0][0] === 'Study' && sm.byCat.find(c => c[0] === 'Food')[1] === 180 && sm.perDay === Math.round(710 / 9), sm);
sm = L.summarize(E, 'this week', NOW); check('summary: this week starts on Monday (5 Oct)', sm.total === 710 && sm.count === 4 && sm.range.from === new Date(2026, 9, 5).getTime());
sm = L.summarize(E, 'last week', NOW); check('summary: last week is empty here', sm.total === 0 && sm.count === 0);
sm = L.summarize(E, 'last month', NOW); check('summary: last month is September', sm.total === 999);
sm = L.summarize(E, 'today', NOW); check('summary: today', sm.total === 120 && sm.count === 1);
sm = L.summarize(E, 'yesterday', NOW); check('summary: yesterday', sm.total === 80);
sm = L.summarize(E, 'this month', NOW, 'food'); check('summary: about a category (or a word in the note)', sm.total === 180 && L.summarize(E, 'this month', NOW, 'books').total === 450);
check('summary: bad entries (no amount, no time, null) are ignored', L.summarize([null, { t: NOW }, { amount: 5 }, ...E], 'today', NOW).total === 120 && L.summarize(null, 'today', NOW).total === 0);
check('money and the CSV: rupees with Indian grouping; commas and quotes in a note are safe', L.money(1234567.5) === '₹12,34,567.5' && L.money(80) === '₹80' && /^date,amount,category,note\n2026-09-20,999,Fun,"old"\n/.test(L.csv(E)) && L.csv([{ t: NOW, amount: 5, cat: 'Food', note: 'a "b", c' }]).includes('"a ""b"", c"'));

/* ---------- habits ---------- */
const H = [{ name: 'water' }, { name: 'gym' }, { name: 'read' }, { name: 'dsa practice' }];
const h = t => L.matchHabit(t, H);
for (const [t, want] of [['track habit water', { op: 'add', name: 'water' }], ['track a new habit called meditation', { op: 'add', name: 'meditation' }], ['start tracking gym daily', { op: 'add', name: 'gym' }], ['add habit: sleep by 11', { op: 'add', name: 'sleep by 11' }],
  ['habits', { op: 'list' }], ['my habits', { op: 'list' }], ['habit streaks', { op: 'list' }], ['show my streaks', { op: 'list' }], ['habit report', { op: 'list' }],
  ['done water', { op: 'done', name: 'water', day: 0 }], ['I did gym', { op: 'done', name: 'gym', day: 0 }], ['I drank water today', { op: 'done', name: 'water', day: 0 }], ['log gym', { op: 'done', name: 'gym', day: 0 }], ['check in dsa practice', { op: 'done', name: 'dsa practice', day: 0 }], ['I read yesterday', { op: 'done', name: 'read', day: -1 }], ['completed my gym', { op: 'done', name: 'gym', day: 0 }],
  ['how many days in a row have I gym', { op: 'streak', name: 'gym' }], ['my water streak', { op: 'streak', name: 'water' }], ['stop tracking gym', { op: 'del', name: 'gym' }], ['delete habit water', { op: 'del', name: 'water' }]]) {
  const r = h(t); check('habit: "' + t + '"', r && r.op === want.op && (!want.name || r.name === want.name) && (want.day === undefined || r.day === want.day), r);
}
for (const t of ['done homework', 'I did the dishes', 'I finished my assignment', 'log in', 'log the error', 'check in with mom', 'I read the news', 'stop tracking my package', 'delete my files', 'water', 'what is a habit', 'I studied for 2 hours', 'mark 1 as done', 'track my order', 'I did gymnastics']) check('habit: not taken: "' + t + '"', h(t) === null, h(t));
check('habit: with no habits yet, only "add" and "list" are taken (nothing else can be a habit)', L.matchHabit('done water', []) === null && L.matchHabit('track habit water', []).op === 'add' && L.matchHabit('habits', []).op === 'list');
// streaks
const key = off => L.ymd(new Date(2026, 9, 9 + off).getTime());
let st = L.streakOf([key(0), key(-1), key(-2)], NOW); check('streak: today and the days before', st.current === 3 && st.best === 3 && st.total === 3);
st = L.streakOf([key(-1), key(-2), key(-3)], NOW); check('streak: today not ticked yet does not break it (the day is not over)', st.current === 3);
st = L.streakOf([key(-2), key(-3)], NOW); check('streak: a missed whole day breaks it', st.current === 0 && st.best === 2);
st = L.streakOf([key(0), key(-1), key(-3), key(-4), key(-5), key(-6)], NOW); check('streak: the best run is remembered even when the current one is shorter', st.current === 2 && st.best === 4 && st.total === 6);
check('streak: empty, a Set, duplicates', L.streakOf([], NOW).current === 0 && L.streakOf(new Set([key(0)]), NOW).current === 1 && L.streakOf([key(0), key(0)], NOW).total === 1 && L.streakOf(null, NOW).best === 0);
const g = L.weekGrid([key(0), key(-2), key(-6)], NOW); check('week grid: the last 7 days, oldest first, with weekday letters', g.length === 7 && g[6].key === key(0) && g[6].on && !g[5].on && g[4].on && g[0].on && g[6].dow === 'Fr' && g[0].dow === 'Sa', g);

/* ---------- quick capture ---------- */
for (const [t, text] of [['jot down buy a charger tomorrow', 'buy a charger tomorrow'], ['capture: idea for the fest app', 'idea for the fest app'], ['quick note call the librarian', 'call the librarian'], ['note to self: renew the bus pass', 'renew the bus pass'], ['inbox: check hostel mess menu', 'check hostel mess menu'], ['Jot down that the lab record is due Monday', 'the lab record is due Monday'], ['capture the idea about caching', 'the idea about caching']]) { const r = L.parseCapture(t); check('capture: "' + t + '"', r && r.text === text, r); }
for (const t of ['note that my exam is on 12 december', 'remember that I like tea', 'capture the flag', 'inbox zero tips', 'capture a screenshot', 'capturing moments', 'jot', 'capture', 'inbox', 'write a note', 'quick note', 'take a note']) check('capture: not taken: "' + t + '"', L.parseCapture(t) === null, L.parseCapture(t));
for (const [t, d] of [['show my inbox', 0], ['inbox', 0], ['my inbox', 0], ['show my inbox yesterday', -1], ['open my quick notes', 0], ['show me my captures today', 0]]) { const r = L.parseCaptureShow(t); check('capture show: "' + t + '"', r && r.day === d, r); }
check('capture show: not taken', L.parseCaptureShow('inbox zero tips') === null && L.parseCaptureShow('check my email inbox') === null);
check('capture: long text is cut to 1000 characters', L.parseCapture('jot down ' + 'x'.repeat(5000)).text.length === 1000);

console.log(`lifeparse: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
