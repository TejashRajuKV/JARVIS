# Phone Hub — integration contract

## Current implementation stage

phonehub-auth.js contains dependency-free pairing/session primitives. `phonehub-gateway.js` now contains a separate HTTPS-only, allowlisted route handler and explicit-private-IP server factory. The modules are now wired into `server.js` behind an explicit opt-in environment configuration; no gateway starts automatically unless `JARVIS_PHONEHUB_HOST` is set. That boundary is deliberate: JARVIS's existing HTTP server binds to loopback and has strict host/origin checks. The Android feature must not weaken those protections by exposing the full laptop-control API on the LAN.

## Security contract for the gateway

The future Phone Gateway must:

1. Run separately from the existing UI/API listener and bind only to the selected private LAN interface.
2. Require HTTPS. Do not start the gateway if a certificate/key pair is absent or invalid; never fall back to plaintext HTTP.
3. Display a short-lived one-time pairing code on the laptop and require the Android app to enter/scan it. Pairing expires after five minutes and locks after five failed attempts.
4. Issue a high-entropy device token once. Only its SHA-256 hash is retained in the auth module's device record; the token must be stored by Android in encrypted app storage and never sent to an LLM.
5. Require a fresh request nonce for every authenticated request. Reject replayed nonces and prune expired nonce entries. The in-memory replay cache is capped at 10,000 entries by default; when full, new authenticated requests fail closed with `NONCE_CAPACITY` until expired entries are swept.
6. Start with only status and notifications capabilities. Every sensitive capability (sms.send, contacts.read, calls, photos.read, clipboard.read, app.launch) must be separately granted by the laptop owner and checked at the gateway for every operation.
7. Support immediate device revocation and session expiry. Do not trust a capability list supplied by the phone after pairing.
8. Validate request size, method, path, origin, host and local-network peer policy before calling this module. Never expose existing /api/tool/*, state, file, screenshot, clipboard or arbitrary command endpoints through the phone gateway.
9. Keep a visible laptop-side activity log and require an explicit confirmation for consequential operations such as sending SMS or initiating calls. Phone-originated commands must not be allowed to turn on the laptop camera/microphone or bypass existing permission tiers.

## Gateway module

`phonehub-gateway.js` exports `createPhoneHubRequestHandler()` and `createPhoneHubHttpsServer()`. The HTTPS factory requires a private IPv4 RFC1918 or IPv6 ULA bind address and both TLS key and certificate; it refuses wildcard, loopback, public, or plaintext binds. The handler accepts only `/health`, `POST /v1/pair`, `GET /v1/status`, and `GET /v1/notifications`. It independently rejects plaintext requests (even if accidentally mounted on an HTTP server), public peers, unexpected Host/Origin values, non-JSON pairing bodies, oversized bodies, unknown paths, and replayed or unauthorized requests. It never proxies to existing JARVIS API routes. Defaults use a 4 KiB request-body cap and TLS 1.2 minimum.

Configure the optional listener with `JARVIS_PHONEHUB_HOST` (an explicit private LAN IP), `JARVIS_PHONEHUB_PORT` (optional, default 18443), `JARVIS_PHONEHUB_TLS_KEY` and `JARVIS_PHONEHUB_TLS_CERT` (file paths), and optionally `JARVIS_PHONEHUB_ALLOWED_ORIGINS` (comma-separated exact origins). Without a host, the gateway remains off. If TLS material is missing or invalid, startup logs the failure and leaves the gateway disabled; it never falls back to HTTP. The local-only owner API currently provides `/api/phonehub/status`, `POST /api/phonehub/pairing`, `POST /api/phonehub/devices/:id/grant`, and `DELETE /api/phonehub/devices/:id`. These APIs do not yet have a dedicated laptop UI.

Run the focused test cases with `npm run test:phonehub-gateway` (not executed as part of this implementation pass). The gateway factory does not generate certificates or select a LAN interface automatically. Current status output is intentionally minimal, and notifications return an empty list until a notification provider is integrated. Device records and nonce replay state remain in memory and are lost on restart; do not treat this stage as production-ready. A future opt-in startup integration must present a trusted certificate to the Android client and must not weaken the existing loopback-only web server.

## Module API

- beginPairing() → one-time pairing id/code and expiry; show the code only in the local laptop UI.
- completePairing({ pairingId, code, deviceName, capabilities }) → one-time token plus a public device record. Unknown capabilities are discarded.
- authenticate({ token, nonce }) → validates token, expiry, revocation and nonce uniqueness.
- authorize({ token, nonce }, capability) → authentication plus capability enforcement.
- grant(deviceId, capabilities) / revoke(deviceId) → laptop-owner management actions.
- listDevices() → public records only; never includes the bearer token.
- sweep() → removes expired pairing/nonces and marks expired sessions revoked.

The caller must generate a cryptographically random nonce (at least 16 URL-safe characters) per request. Nonce tracking is in-memory and capped in this first stage, so a gateway restart clears replay history; the long-lived token still remains revocable only while its device record persists. Before production use, persist device records securely and either persist nonce history or use a short-lived signed-request protocol that makes restart replay harmless.

## Integration checkpoints

- [x] Add isolated pairing/session primitives and deterministic unit tests.
- [x] Add isolated HTTPS gateway factory and strict request handler (not yet started by the application).
- [ ] Wire gateway startup into a dedicated opt-in process/configuration with explicit TLS material and selected private IP.
- [ ] Add laptop UI for QR/code pairing, capability grants, active devices and revoke.
- [ ] Add Android companion app with encrypted token storage and pinned certificate fingerprint.
- [ ] Add phone-side notification, status and permission-aware command flows.
- [ ] Add end-to-end tests against the actual gateway; test on a physical Android device.
- [ ] Consider iOS only after Android pairing, revocation and permission behavior are verified.

**Verification note:** A passing unit suite only proves this module's logic. It does not prove HTTPS setup, LAN isolation, Android storage, or physical-device behavior.
