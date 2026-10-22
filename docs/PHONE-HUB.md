# Phone Hub — integration contract

## Current implementation stage

phonehub-auth.js contains dependency-free pairing/session primitives. It is intentionally **not a network listener and is not wired into server.js yet**. That boundary is deliberate: JARVIS's existing HTTP server binds to loopback and has strict host/origin checks. The Android feature must not weaken those protections by exposing the full laptop-control API on the LAN.

## Security contract for the gateway

The future Phone Gateway must:

1. Run separately from the existing UI/API listener and bind only to the selected private LAN interface.
2. Require HTTPS. Do not start the gateway if a certificate/key pair is absent or invalid; never fall back to plaintext HTTP.
3. Display a short-lived one-time pairing code on the laptop and require the Android app to enter/scan it. Pairing expires after five minutes and locks after five failed attempts.
4. Issue a high-entropy device token once. Only its SHA-256 hash is retained in the auth module's device record; the token must be stored by Android in encrypted app storage and never sent to an LLM.
5. Require a fresh request nonce for every authenticated request. Reject replayed nonces and prune expired nonce entries.
6. Start with only status and notifications capabilities. Every sensitive capability (sms.send, contacts.read, calls, photos.read, clipboard.read, app.launch) must be separately granted by the laptop owner and checked at the gateway for every operation.
7. Support immediate device revocation and session expiry. Do not trust a capability list supplied by the phone after pairing.
8. Validate request size, method, path, origin, host and local-network peer policy before calling this module. Never expose existing /api/tool/*, state, file, screenshot, clipboard or arbitrary command endpoints through the phone gateway.
9. Keep a visible laptop-side activity log and require an explicit confirmation for consequential operations such as sending SMS or initiating calls. Phone-originated commands must not be allowed to turn on the laptop camera/microphone or bypass existing permission tiers.

## Module API

- beginPairing() → one-time pairing id/code and expiry; show the code only in the local laptop UI.
- completePairing({ pairingId, code, deviceName, capabilities }) → one-time token plus a public device record. Unknown capabilities are discarded.
- authenticate({ token, nonce }) → validates token, expiry, revocation and nonce uniqueness.
- authorize({ token, nonce }, capability) → authentication plus capability enforcement.
- grant(deviceId, capabilities) / revoke(deviceId) → laptop-owner management actions.
- listDevices() → public records only; never includes the bearer token.
- sweep() → removes expired pairing/nonces and marks expired sessions revoked.

The caller must generate a cryptographically random nonce (at least 16 URL-safe characters) per request. Nonce tracking is in-memory in this first stage, so a gateway restart clears replay history; the long-lived token still remains revocable only while its device record persists. Before production use, persist device records securely and either persist nonce history or use a short-lived signed-request protocol that makes restart replay harmless.

## Integration checkpoints

- [x] Add isolated pairing/session primitives and deterministic unit tests.
- [ ] Add HTTPS gateway listener with strict network binding and health checks.
- [ ] Add laptop UI for QR/code pairing, capability grants, active devices and revoke.
- [ ] Add Android companion app with encrypted token storage and pinned certificate fingerprint.
- [ ] Add phone-side notification, status and permission-aware command flows.
- [ ] Add end-to-end tests against the actual gateway; test on a physical Android device.
- [ ] Consider iOS only after Android pairing, revocation and permission behavior are verified.

**Verification note:** A passing unit suite only proves this module's logic. It does not prove HTTPS setup, LAN isolation, Android storage, or physical-device behavior.
