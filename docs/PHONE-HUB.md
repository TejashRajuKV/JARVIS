# Phone Hub — integration contract

## Current implementation stage

phonehub-auth.js contains dependency-free pairing/session primitives. `phonehub-gateway.js` now contains a separate HTTPS-only, allowlisted route handler and explicit-private-IP server factory. The modules are now wired into `server.js` behind an explicit opt-in environment configuration; no gateway starts automatically unless `JARVIS_PHONEHUB_HOST` is set. That boundary is deliberate: JARVIS's existing HTTP server binds to loopback and has strict host/origin checks. The Android feature must not weaken those protections by exposing the full laptop-control API on the LAN.

## Security contract for the gateway

The Phone Hub gateway and companion app must:

1. Run separately from the existing UI/API listener and bind only to the selected private LAN interface.
2. Require HTTPS. Do not start the gateway if a certificate/key pair is absent or invalid; never fall back to plaintext HTTP.
3. Display a short-lived one-time pairing code on the laptop and require the Android app to enter/scan it. Pairing expires after five minutes and locks after five failed attempts.
4. Issue a high-entropy device token once. Only its SHA-256 hash is retained in the auth module's device record; the token must be stored by Android in encrypted app storage and never sent to an LLM.
5. Require a fresh request nonce for every authenticated request. Reject replayed nonces and prune expired nonce entries. The persisted replay cache is capped at 10,000 entries by default; when full, new authenticated requests fail closed with `NONCE_CAPACITY` until expired entries are swept. The registry permits at most 50 active devices by default; revoked devices free an active slot.
6. Start with only status and notifications capabilities. Every sensitive capability (sms.send, contacts.read, calls, photos.read, clipboard.read, app.launch) must be separately granted by the laptop owner and checked at the gateway for every operation.
7. Support immediate device revocation and session expiry. Do not trust a capability list supplied by the phone after pairing.
8. Validate request size, method, path, origin, host and local-network peer policy before calling this module. Never expose existing /api/tool/*, state, file, screenshot, clipboard or arbitrary command endpoints through the phone gateway.
9. Keep a visible laptop-side activity log and require an explicit confirmation for consequential operations such as sending SMS or initiating calls. Phone-originated commands must not be allowed to turn on the laptop camera/microphone or bypass existing permission tiers.

## Gateway module

`phonehub-gateway.js` exports `createPhoneHubRequestHandler()` and `createPhoneHubHttpsServer()`. The HTTPS factory requires a private IPv4 RFC1918 or IPv6 ULA bind address and both TLS key and certificate; it refuses wildcard, loopback, public, or plaintext binds. The handler accepts only `/health`, `POST /v1/pair`, `GET /v1/status`, and `GET /v1/notifications`. It independently rejects plaintext requests (even if accidentally mounted on an HTTP server), public peers, unexpected Host/Origin values, non-JSON pairing bodies, oversized bodies, unknown paths, and replayed or unauthorized requests. It never proxies to existing JARVIS API routes. Defaults use a 4 KiB request-body cap and TLS 1.2 minimum.

Configure the optional listener with `JARVIS_PHONEHUB_HOST` (an explicit private LAN IP), `JARVIS_PHONEHUB_PORT` (optional, default 18443), `JARVIS_PHONEHUB_TLS_KEY` and `JARVIS_PHONEHUB_TLS_CERT` (file paths), and optionally `JARVIS_PHONEHUB_ALLOWED_ORIGINS` (comma-separated exact origins). Without a host, the gateway remains off. If TLS material is missing or invalid, startup logs the failure and leaves the gateway disabled; it never falls back to HTTP. The local-only owner API currently provides `/api/phonehub/status`, `POST /api/phonehub/pairing`, `POST /api/phonehub/devices/:id/grant`, and `DELETE /api/phonehub/devices/:id`. The laptop management page is available at `/phonehub.html`. The pairing screen shows both the six-digit code and pairing ID because the current pairing API requires both.

Run the focused test cases with `npm run test:phonehub`, `npm run test:phonehub-gateway`, `npm run test:phonehub-android`, and `npm run test:phonehub-notifications` (not executed as part of this implementation pass). The auth suite now includes restart-persistence, replay-after-restart, capability persistence, revocation persistence, file permissions and corrupt-state fail-closed cases. The gateway factory does not generate certificates or select a LAN interface automatically. Current status output is intentionally minimal. `phonehub-notifications.js` now maintains a bounded recent-event feed; the scheduler publishes fired reminders, deadline alerts, charger alerts, and trigger events into it, and the HTTPS gateway returns up to 50 recent items. The feed is in-memory (up to 100 items / seven days) and clears on restart. The Android app currently refreshes it on demand; background push delivery is not implemented. Device records (up to 50 active devices by default), pairing challenges and the nonce replay cache are persisted to `~/jarvis/.phonehub-state.json` by default (override with `JARVIS_PHONEHUB_STATE_FILE`). The file is written atomically with owner-only permissions where the platform supports them. Device bearer tokens are not persisted, only their SHA-256 hashes. If the state file is corrupt or cannot be loaded, the network gateway fails closed instead of silently creating a new empty registry. Persistence is still local-file based, not encrypted-at-rest; protect the JARVIS user account and disk accordingly. The phone companion app and real notification provider are still unfinished; do not treat this stage as production-ready. A future opt-in startup integration must present a trusted certificate to the Android client and must not weaken the existing loopback-only web server.

## Module API

- beginPairing() → one-time pairing id/code and expiry; show the code only in the local laptop UI.
- completePairing({ pairingId, code, deviceName, capabilities }) → one-time token plus a public device record. Unknown capabilities are discarded.
- authenticate({ token, nonce }) → validates token, expiry, revocation and nonce uniqueness.
- authorize({ token, nonce }, capability) → authentication plus capability enforcement.
- grant(deviceId, capabilities) / revoke(deviceId) → laptop-owner management actions.
- listDevices() → public records only; never includes the bearer token.
- sweep() → removes expired pairing/nonces and marks expired sessions revoked.

The caller must generate a cryptographically random nonce (at least 16 URL-safe characters) per request. The nonce cache is persisted with device state and capped at 10,000 active entries. The default device registry allows 50 active devices; revoked devices free a slot. The state file defaults to `~/jarvis/.phonehub-state.json` and can be overridden with `JARVIS_PHONEHUB_STATE_FILE`. Writes are atomic and use owner-only file permissions where supported. Device bearer tokens are not stored, only SHA-256 token hashes. If the state file is corrupt, startup of the network gateway fails closed. The state file is not encrypted at rest, so the operating-system account and disk must be protected.

## Integration checkpoints

- [x] Add pairing/session primitives, persistent device records, permissions, revocation and replay protection.
- [x] Add an isolated HTTPS gateway with strict host/origin, LAN peer, body-size and capability checks.
- [x] Wire opt-in gateway startup into the main server using explicit private-IP and TLS configuration; the default remains disabled.
- [x] Add laptop pairing/device management UI at `/phonehub.html`.
- [x] Add an initial native Android app at `android/phonehub/` with manual pairing, Android Keystore token encryption, status/notification fetch, and local token removal.
- [x] Connect scheduler reminders, deadline alerts, charger alerts and trigger events to a bounded Phone Hub notification feed.
- [x] Add regression test files and a GitHub Actions Android debug-build workflow.
- [ ] Run the Android build in GitHub Actions and resolve any build errors reported by CI.
- [ ] Configure and verify a trusted TLS certificate on a real Android phone and exercise pairing/revocation end to end.
- [ ] Add QR scanning, automated certificate onboarding, background push delivery and biometric re-authentication.
- [ ] Add persistent notification history if notifications must survive JARVIS restarts.
- [ ] Consider iOS only after Android pairing, revocation and permission behavior are verified.

**Verification note:** A passing unit suite only proves this module's logic. It does not prove HTTPS setup, LAN isolation, Android storage, or physical-device behavior.
