'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const certTool = require('../scripts/phonehub-cert');

assert.equal(certTool.isPrivateLanAddress('192.168.1.12'), true);
assert.equal(certTool.isPrivateLanAddress('10.0.0.4'), true);
assert.equal(certTool.isPrivateLanAddress('172.20.0.2'), true);
assert.equal(certTool.isPrivateLanAddress('fd12:3456::1'), true);
for (const host of ['127.0.0.1', '0.0.0.0', '8.8.8.8', 'example.com', '172.32.0.1']) {
  assert.equal(certTool.isPrivateLanAddress(host), false, host + ' must not be accepted');
}
const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'phonehub-cert.js'), 'utf8');
assert.match(source, /Refusing to overwrite existing certificate files/);
assert.match(source, /subjectAltName = @alt_names/);
assert.match(source, /extendedKeyUsage = serverAuth/);
assert.match(source, /Install phonehub-ca\.crt on the Android device/);
console.log('phonehub-cert: private address validation and safe onboarding guardrails defined');
