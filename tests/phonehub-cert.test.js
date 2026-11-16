'use strict';

const assert = require('./lib/assertions')('phonehub-cert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const certTool = require('../scripts/phonehub-cert');

assert.equal(certTool.isPrivateLanAddress('192.168.1.12'), true);
assert.equal(certTool.isPrivateLanAddress('10.0.0.4'), true);
assert.equal(certTool.isPrivateLanAddress('172.20.0.2'), true);
assert.equal(certTool.isPrivateLanAddress('fd12:3456::1'), true);
assert.equal(certTool.isPrivateLanAddress('100.100.10.2'), false);
assert.equal(certTool.isPrivateLanAddress('100.100.10.2', true), true);
assert.equal(certTool.isPrivateLanAddress('100.128.10.2', true), false);
for (const host of ['127.0.0.1', '0.0.0.0', '8.8.8.8', 'example.com', '172.32.0.1']) {
  assert.equal(certTool.isPrivateLanAddress(host), false, host + ' must not be accepted');
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cert-test-'));
try {
  const file = path.join(__dirname, '..', 'scripts', 'phonehub-cert.js');
  const opensslCalls = [];
  const logs = [];
  const cliModule = { exports: {} };
  const load = id => id === 'node:child_process' ? {
    spawnSync: (cmd, args) => {
      opensslCalls.push([cmd, ...args]);
      fs.writeFileSync(args[args.indexOf('-out') + 1], 'OpenSSL fixture');
      return {status: 0};
    }
  } : require(id);
  load.main = cliModule;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: cliModule, require: load, console: {log: message => logs.push(message)},
    process: {argv: ['node', file, '--host', '192.168.1.12', '--out', tmp], env: {}}
  }, {filename: file});
  const configPath = path.join(tmp, 'phonehub-server.cnf');
  const config = fs.readFileSync(configPath, 'utf8');
  assert.match(config, /^subjectAltName = @alt_names$/m);
  assert.match(config, /^IP\.1 = 192\.168\.1\.12$/m);
  assert.match(config, /^extendedKeyUsage = serverAuth$/m);
  assert.equal(opensslCalls.length, 5);
  assert.ok(opensslCalls[4].includes(configPath) && opensslCalls[4].includes('v3_req'));
  assert.ok(logs.some(line => /Install phonehub-ca\.crt on the Android device/.test(line)));
  fs.writeFileSync(path.join(tmp, 'phonehub-server.key'), 'existing key');
  assert.throws(() => certTool.generate({host: '192.168.1.12', outDir: tmp}), /Refusing to overwrite existing certificate files/);
  assert.equal(fs.readFileSync(path.join(tmp, 'phonehub-server.key'), 'utf8'), 'existing key');
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
assert.report();
