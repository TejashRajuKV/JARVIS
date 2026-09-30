// Authenticator (TOTP) tests, including the official RFC 6238 test vectors. Run: node tests/phoneauth.test.js
const path = require('path');
const A = require(path.join(__dirname, '..', 'phoneauth.js'));

let fail = 0, total = 0;
const check = (name, ok) => { total++; if (!ok) { fail++; console.log('FAIL  ' + name); } };

// RFC 6238 Appendix B (SHA-1, 8 digits, secret "12345678901234567890")
const rfcSecret = A.base32Encode(Buffer.from('12345678901234567890'));
for (const [t, want] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]) {
  check(`RFC 6238 vector t=${t}`, A.totpAt(rfcSecret, t * 1000, 8) === want);
}
check('base32 round-trip', A.base32Decode(A.base32Encode(Buffer.from('hello world'))).toString() === 'hello world');
check('new secret is 32 base32 chars (160 bits)', /^[A-Z2-7]{32}$/.test(A.newSecret()));

const secret = A.newSecret();
const now = 1759132800000; // fixed moment
const code = A.totpAt(secret, now);
const used = new Set();
check('current code accepted', A.verifyCode(secret, code, now, used));
check('same code rejected the second time (single use)', !A.verifyCode(secret, code, now, used));
check('previous 30 s code still accepted (clock drift)', A.verifyCode(secret, A.totpAt(secret, now - 30000), now, new Set()));
check('code from 2 minutes ago rejected', !A.verifyCode(secret, A.totpAt(secret, now - 120000), now, new Set()));
check('wrong code rejected', !A.verifyCode(secret, code === '000000' ? '111111' : '000000', now, new Set()));
check('non-numeric rejected', !A.verifyCode(secret, 'abcdef', now, new Set()));
check('code for a different secret rejected', !A.verifyCode(A.newSecret(), code, now, new Set()));
check('otpauth URI shape', /^otpauth:\/\/totp\/JARVIS\?secret=[A-Z2-7]+&issuer=JARVIS/.test(A.otpauthUri(secret)));

console.log(`phoneauth: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
