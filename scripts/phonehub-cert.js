'use strict';

// Generate a private local CA and a server certificate for the Phone Hub gateway.
// Requires OpenSSL on PATH. Never sends keys or certificate material anywhere.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

function isPrivateLanAddress(value) {
  const address = String(value || '').split('%')[0];
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return net.isIP(address) === 6 && /^f[cd][0-9a-f]{2}:/i.test(address);
}

function runOpenSSL(args) {
  const result = spawnSync(process.env.OPENSSL || 'openssl', args, {
    encoding: 'utf8', windowsHide: true, timeout: 30_000
  });
  if (result.error) throw new Error('OpenSSL is required and must be available on PATH: ' + result.error.message);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'OpenSSL failed').trim());
}

function generate({ host, outDir, force = false }) {
  if (!isPrivateLanAddress(host)) throw new Error('Provide the laptop private LAN IP (RFC1918 IPv4 or IPv6 ULA).');
  const output = path.resolve(outDir || path.join(process.cwd(), 'phonehub-certs'));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const files = ['phonehub-ca.key', 'phonehub-ca.crt', 'phonehub-server.key', 'phonehub-server.crt', 'phonehub-server.cnf'];
  const existing = files.filter(file => fs.existsSync(path.join(output, file)));
  if (existing.length && !force) throw new Error('Refusing to overwrite existing certificate files: ' + existing.join(', ') + '. Choose another output directory or pass --force.');
  try { fs.chmodSync(output, 0o700); } catch {}

  const caKey = path.join(output, 'phonehub-ca.key');
  const caCert = path.join(output, 'phonehub-ca.crt');
  const serverKey = path.join(output, 'phonehub-server.key');
  const serverCsr = path.join(output, 'phonehub-server.csr');
  const serverCert = path.join(output, 'phonehub-server.crt');
  const config = path.join(output, 'phonehub-server.cnf');
  const san = net.isIP(host) === 6 ? 'IP.1 = ' + host : 'IP.1 = ' + host;
  fs.writeFileSync(config, [
    '[req]', 'prompt = no', 'distinguished_name = dn', 'req_extensions = v3_req',
    '[dn]', 'CN = JARVIS Phone Hub ' + host,
    '[v3_req]', 'subjectAltName = @alt_names', 'keyUsage = digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth', '[alt_names]', san, ''
  ].join('\n'), { mode: 0o600 });
  try {
    runOpenSSL(['genrsa', '-out', caKey, '3072']);
    runOpenSSL(['req', '-x509', '-new', '-nodes', '-key', caKey, '-sha256', '-days', '3650',
      '-subj', '/CN=JARVIS Phone Hub Local CA', '-out', caCert]);
    runOpenSSL(['genrsa', '-out', serverKey, '2048']);
    runOpenSSL(['req', '-new', '-key', serverKey, '-out', serverCsr, '-config', config]);
    runOpenSSL(['x509', '-req', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey,
      '-CAcreateserial', '-out', serverCert, '-days', '397', '-sha256',
      '-extfile', config, '-extensions', 'v3_req']);
    for (const file of [caKey, caCert, serverKey, serverCert]) {
      try { fs.chmodSync(path.join(output, file), file.endsWith('.key') ? 0o600 : 0o644); } catch {}
    }
    fs.unlinkSync(serverCsr);
    try { fs.unlinkSync(path.join(output, 'phonehub-ca.srl')); } catch {}
    return { output, caCert, serverKey, serverCert, host };
  } catch (error) {
    // Leave any generated private key in place rather than silently deleting evidence
    // after a partial failure; the operator can inspect and remove the output directory.
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hostIndex = args.indexOf('--host');
  const outIndex = args.indexOf('--out');
  const host = hostIndex >= 0 ? args[hostIndex + 1] : '';
  const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined;
  try {
    const result = generate({ host, outDir, force: args.includes('--force') });
    console.log('Phone Hub TLS material created in: ' + result.output);
    console.log('Gateway host: ' + result.host);
    console.log('Set JARVIS_PHONEHUB_HOST=' + result.host);
    console.log('Set JARVIS_PHONEHUB_TLS_KEY=' + result.serverKey);
    console.log('Set JARVIS_PHONEHUB_TLS_CERT=' + result.serverCert);
    console.log('Install phonehub-ca.crt on the Android device as a user CA; do not copy phonehub-ca.key to the phone.');
  } catch (error) {
    console.error('Phone Hub certificate setup failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { generate, isPrivateLanAddress };
