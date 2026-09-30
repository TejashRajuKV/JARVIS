// Update checker (update.js). Run: node tests/update.test.js
const path = require('path');
const { isNewer, parseVersion, REPO } = require(path.join(__dirname, '..', 'update.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

check('repo constant is a sane owner/name', /^[^/]+\/[^/]+$/.test(REPO), REPO);

// parseVersion
check('plain version', JSON.stringify(parseVersion('1.0.0')) === '[1,0,0]');
check('leading v + prerelease suffix ignored', JSON.stringify(parseVersion('v2.3.0-beta.1')) === '[2,3,0]');
check('two-part version', JSON.stringify(parseVersion('1.4')) === '[1,4]');
check('garbage → null', parseVersion('hello world') === null && parseVersion('') === null && parseVersion(null) === null);

// isNewer
check('patch bump', isNewer('1.0.1', '1.0.0') === true);
check('minor bump', isNewer('1.1.0', '1.0.9') === true);
check('major bump', isNewer('2.0.0', '1.9.9') === true);
check('same version → no update', isNewer('1.0.0', '1.0.0') === false);
check('older release → no update', isNewer('0.9.0', '1.0.0') === false);
check('v-prefix and suffix tolerated on both sides', isNewer('v1.2.0-rc.1', '1.1.5') === true && isNewer('v1.0.0', 'v1.0.0') === false);
check('numeric, not lexicographic (9 > 10 is false)', isNewer('1.10.0', '1.9.0') === true && isNewer('1.9.0', '1.10.0') === false);
check('missing parts default to zero', isNewer('1.1', '1.0.5') === true && isNewer('1.0', '1.0.0') === false);
check('garbage never reports an update', isNewer('oops', '1.0.0') === false && isNewer('1.0.1', '') === false);

console.log(total + '/' + total + ' update checks passed');
process.exitCode = fail ? 1 : 0;
