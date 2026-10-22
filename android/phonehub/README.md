# JARVIS Phone Hub for Android (early companion app)

This is the initial native Android companion source for the Phone Hub gateway. It supports QR or manual pairing, encrypted token storage, checking JARVIS status, and requesting notifications.

## Requirements

- Android Studio with JDK 17 and Android SDK 35.
- JARVIS running on the laptop.
- The optional Phone Hub gateway configured with an explicit private LAN IP, a port, and a valid TLS certificate/key.
- The Android device and laptop connected to the same trusted LAN.

## Configure the laptop

Set these environment variables before starting JARVIS:

- `JARVIS_PHONEHUB_HOST`: the laptop's private LAN IP, such as `192.168.1.10`.
- `JARVIS_PHONEHUB_PORT`: optional; defaults to `18443`.
- `JARVIS_PHONEHUB_TLS_KEY` and `JARVIS_PHONEHUB_TLS_CERT`: TLS private-key and certificate file paths.
- `JARVIS_PHONEHUB_STATE_FILE`: optional persistent state path; defaults to `~/jarvis/.phonehub-state.json`.

The gateway accepts only HTTPS. Use a certificate whose trust chain is trusted by Android (for example, a certificate issued by a private CA installed on the phone). Do not work around certificate errors by disabling TLS validation. Keep the private key private. The gateway only binds to an explicit private LAN address.

Open the laptop management page at `http://localhost:<JARVIS_PORT>/phonehub.html`, create a pairing code, then scan the displayed QR in the app or enter the gateway HTTPS origin, pairing ID, and six-digit code manually. The gateway address must use the laptop's LAN IP, not localhost.

## Security behavior

- Android rejects non-HTTPS URLs, hostnames, and non-private IP addresses before connecting.
- The app uses Android's normal TLS certificate and hostname verification; redirects are disabled.
- Each authenticated request gets a fresh cryptographically random nonce.
- The bearer token is encrypted with an AES-GCM key held by Android Keystore. The plaintext token is not logged or stored in ordinary preferences.
- The Android manifest disables cleartext traffic and backup.
- Pairing grants only the gateway's default status and notification scopes. Sensitive scopes remain owner-granted on the laptop.

## Current limitations

This is a starter companion app, not a release build. The gateway exposes a bounded recent-event feed for reminders, deadline alerts, charger alerts, and trigger events. The feed is in-memory and clears when JARVIS restarts; the Android app refreshes it on demand and also polls in the background through WorkManager (Android may defer the 15-minute minimum interval to preserve battery). This is periodic polling, not instant push. The laptop can generate a QR locally and the Android app can scan it. The gateway has an authenticated SSE stream, but the Android client still relies on WorkManager polling for background alerts. Offline queueing and biometric re-authentication are not implemented.

## Automated local TLS material

From the JARVIS repository root, run `node scripts/phonehub-cert.js --host <private-laptop-ip> --out <directory>` (requires OpenSSL). This creates a local CA and an IP-SAN gateway certificate. Install only `phonehub-ca.crt` on the Android device through Android settings; never copy the CA private key. See [the certificate onboarding guide](../../docs/PHONE-HUB.md#certificate-onboarding-helper).

True instant background delivery and physical-device end-to-end verification remain release gates. Manual pairing remains available if QR scanning is unavailable. A successful CI build does not imply physical-device validation.


The gateway has an authenticated server-sent events endpoint for low-latency notifications, but the current Android client does not yet maintain a live stream; background alerts still use periodic WorkManager polling. QR pairing and physical-device end-to-end checks remain outstanding.


## Voice and calling

The app includes a basic speech-to-text / JARVIS text-response / text-to-speech session over the authenticated Phone Hub gateway and an explicit button to request an outbound Twilio announcement call. Grant `voice` and `calls` separately from the laptop owner UI. The gateway must be reachable for in-app voice; the current private-LAN listener does not provide remote access by itself. Real phone calls require server-side Twilio credentials and a verified caller number.
