# JARVIS Phone Hub for Android (early companion app)

This is the initial native Android companion source for the Phone Hub gateway. It supports manual pairing, encrypted token storage, checking JARVIS status, and requesting notifications.

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

Open the laptop management page at `http://localhost:<JARVIS_PORT>/phonehub.html`, create a pairing code, then enter the gateway HTTPS origin, pairing ID, and six-digit code in the app. The gateway address must use the laptop's LAN IP, not localhost.

## Security behavior

- Android rejects non-HTTPS URLs, hostnames, and non-private IP addresses before connecting.
- The app uses Android's normal TLS certificate and hostname verification; redirects are disabled.
- Each authenticated request gets a fresh cryptographically random nonce.
- The bearer token is encrypted with an AES-GCM key held by Android Keystore. The plaintext token is not logged or stored in ordinary preferences.
- The Android manifest disables cleartext traffic and backup.
- Pairing grants only the gateway's default status and notification scopes. Sensitive scopes remain owner-granted on the laptop.

## Current limitations

This is a starter companion app, not a release build. The gateway exposes a bounded recent-event feed for reminders, deadline alerts, charger alerts, and trigger events. The feed is in-memory and clears when JARVIS restarts; the Android app refreshes it on demand, not via background push. QR scanning, push notifications, offline queueing, biometric re-authentication, and automated certificate onboarding are not implemented. The Android app has not been built or run as part of this code-writing pass.
