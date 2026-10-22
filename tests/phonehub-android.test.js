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
const phoneHubUi = fs.readFileSync(path.join(__dirname, '..', 'phonehub-ui.js'), 'utf8');
const phoneHubHtml = fs.readFileSync(path.join(__dirname, '..', 'phonehub.html'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'phonehub-android.yml'), 'utf8');
const worker = read('app/src/main/java/com/jarvis/phonehub/PhoneHubNotificationWorker.kt');
const networkSecurity = read('app/src/main/res/xml/network_security_config.xml');

const checks = [
  ['pairing QR uses local bundled generator and excludes device token', phoneHubHtml.includes('/qrcode.js') && /new QRCode/.test(phoneHubUi) && /pairingId: data\.pairingId, code: data\.code/.test(phoneHubUi) && !/token\s*:\s*response/.test(phoneHubUi)],
  ['Android manifest includes optional camera for QR scan', /android\.permission\.CAMERA/.test(manifest) && /android.hardware.camera.*required="false"/.test(manifest)],
  ['Android manifest denies cleartext HTTP', /usesCleartextTraffic="false"/.test(manifest)],
  ['Android app disables backup', /allowBackup="false"/.test(manifest)],
  ['client requires HTTPS', /uri\.scheme\.equals\("https", ignoreCase = true\)/.test(client)],
  ['client requires a literal private IP', /if \(!ipv4 && !ipv6\) return false/.test(client) && /b\[0\] == 10/.test(client) && /b\[0\] == 192 && b\[1\] == 168/.test(client)],
  ['client does not follow redirects', /instanceFollowRedirects = false/.test(client)],
  ['client generates a cryptographically random nonce', /SecureRandom\(\)\.nextBytes\(bytes\)/.test(client)],
  ['client sends bearer token and nonce on authenticated requests', /Authorization", "Bearer \$token"/.test(client) && /X-Jarvis-Nonce/.test(client)],
  ['token encryption uses Android Keystore AES-GCM', /AndroidKeyStore/.test(vault) && /AES\/GCM\/NoPadding/.test(vault)],
  ['token storage uses randomized encryption', /setRandomizedEncryptionRequired\(true\)/.test(vault)],
  ['app supports QR scanning and pairing payload validation', /IntentIntegrator/.test(activity) && /optString\("endpoint"\)/.test(activity) && /optInt\("version"\) == 1/.test(activity)],
  ['app surfaces pairing, status and notifications', /fun pair\(/.test(client) && /fun status\(/.test(client) && /fun notifications\(/.test(client) && /refreshNotifications/.test(activity) && /forgetPhone\(\)/.test(activity)],
  ['Android TLS trusts system and user-installed CA roots without disabling verification', manifest.includes('@xml/network_security_config') && /certificates src="system"/.test(networkSecurity) && /certificates src="user"/.test(networkSecurity) && /cleartextTrafficPermitted="false"/.test(networkSecurity)],
  ['UI state updates are marshalled to the Android main thread', activity.includes('private fun setUi(block: () -> Unit)') && activity.includes('runOnUiThread(block)')],
  ['background notifications use a network-constrained 15-minute worker', /PeriodicWorkRequestBuilder<PhoneHubNotificationWorker>\\(15, TimeUnit.MINUTES\\)/.test(worker) && /NetworkType.CONNECTED/.test(worker)],
  ['background worker suppresses initial historical notification spam', /if \\(previous == null\\)/.test(worker) && /if \\(!foundPrevious\\)/.test(worker)],
  ['notification permission is declared and requested on Android 13+', /POST_NOTIFICATIONS/.test(manifest) && /requestPermissions/.test(activity)],
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
