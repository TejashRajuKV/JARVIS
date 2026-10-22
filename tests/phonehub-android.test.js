'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android', 'phonehub');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = read('app/src/main/AndroidManifest.xml');
const client = read('app/src/main/java/com/jarvis/phonehub/PhoneHubClient.kt');
const vault = read('app/src/main/java/com/jarvis/phonehub/TokenVault.kt');
const activity = read('app/src/main/java/com/jarvis/phonehub/MainActivity.kt');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'phonehub-android.yml'), 'utf8');

const checks = [
  ['Android manifest denies cleartext HTTP', /usesCleartextTraffic="false"/.test(manifest)],
  ['Android app disables backup', /allowBackup="false"/.test(manifest)],
  ['client requires HTTPS', /uri\.scheme\.equals\("https", ignoreCase = true\)/.test(client)],
  ['client requires a literal private IP', /if \(!ipv4 && !ipv6\) return false/.test(client) && /b\[0\] == 10/.test(client) && /b\[0\] == 192 && b\[1\] == 168/.test(client)],
  ['client does not follow redirects', /instanceFollowRedirects = false/.test(client)],
  ['client generates a cryptographically random nonce', /SecureRandom\(\)\.nextBytes\(bytes\)/.test(client)],
  ['client sends bearer token and nonce on authenticated requests', /Authorization", "Bearer \$token"/.test(client) && /X-Jarvis-Nonce/.test(client)],
  ['token encryption uses Android Keystore AES-GCM', /AndroidKeyStore/.test(vault) && /AES\/GCM\/NoPadding/.test(vault)],
  ['token storage uses randomized encryption', /setRandomizedEncryptionRequired\(true\)/.test(vault)],
  ['app surfaces pairing, status and notifications', /fun pair\(/.test(client) && /fun status\(/.test(client) && /fun notifications\(/.test(client) && /refreshNotifications/.test(activity) && /forgetPhone\(\)/.test(activity)],
  ['UI state updates are marshalled to the Android main thread', activity.includes('private fun setUi(block: () -> Unit)') && activity.includes('runOnUiThread(block)')],
  ['CI workflow builds and uploads a debug APK', workflow.includes('assembleDebug') && workflow.includes('upload-artifact@v4')],
  ['no trust-all TLS manager or hostname-verifier override', !/TrustAll|X509TrustManager|HostnameVerifier|hostnameVerifier\s*=/.test(client)]
];

for (const [name, ok] of checks) {
  if (!ok) {
    console.error('FAIL [' + name + ']');
    process.exitCode = 1;
  }
}
console.log('phonehub-android source checks: ' + checks.filter(x => x[1]).length + '/' + checks.length);
