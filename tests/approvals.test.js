// Approval tokens (approvals.js): one action on one set of paths, once, before they expire. Run: node tests/approvals.test.js
'use strict';
const path = require('path');
const { createApprovals } = require(path.join(__dirname, '..', 'approvals.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

let t = 1e6;
const A = createApprovals({ ttl: 5 * 60e3, max: 3, now: () => t });
const sig = 'rename|c:/users/me/desktop/a.txt';

let tok = A.issue(sig);
check('a token is a long random hex string', /^[0-9a-f]{32}$/.test(tok), tok);
check('a live token approves exactly the action and paths it was issued for', A.consume(tok, sig) === true);
check('it works once: the same token again is refused (no replay)', A.consume(tok, sig) === false);

tok = A.issue(sig);
check('a token for a rename cannot approve a delete', A.consume(tok, 'delete|c:/users/me/desktop/a.txt') === false);
check('…nor the same action on a different path', A.consume(tok, 'rename|c:/users/me/desktop/b.txt') === false);
check('…and a wrong guess does not use it up: the real request still goes through', A.consume(tok, sig) === true);

check('a made-up, empty or missing token approves nothing', !A.consume('deadbeef'.repeat(4), sig) && !A.consume('', sig) && !A.consume(undefined, sig) && !A.consume(null, sig));

tok = A.issue(sig); t += 5 * 60e3 - 1;
check('a token just inside 5 minutes still works', A.consume(tok, sig) === true);
tok = A.issue(sig); t += 5 * 60e3;
check('a token at exactly 5 minutes has expired and is refused', A.consume(tok, sig) === false);
check('…and stays refused (an expired token is dropped, not revived)', A.consume(tok, sig) === false && A.size() === 0);
tok = A.issue(sig); t += 60 * 60e3;
check('an approval left for an hour (pressed ALLOW much later) is refused', A.consume(tok, sig) === false);

const old = A.issue(sig); t += 6 * 60e3; A.issue('x|1');
check('issuing a new token clears out the expired ones', A.size() === 1 && A.consume(old, sig) === false);

const B = createApprovals({ max: 3, now: () => t });
const toks = [B.issue('a'), B.issue('b'), B.issue('c'), B.issue('d')];
check('the store is capped: the oldest token is dropped first', B.size() === 3 && !B.consume(toks[0], 'a') && B.consume(toks[3], 'd'));
check('every issued token is different', new Set(Array.from({ length: 50 }, () => B.issue('z'))).size === 50);

console.log('approvals: ' + (total - fail) + '/' + total);
process.exit(fail ? 1 : 0);
