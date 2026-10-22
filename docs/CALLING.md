# JARVIS Calling

## Stage 1: real outbound phone announcements

The calling service is opt-in and uses Twilio's Calls REST API with inline TwiML. The provider speaks the submitted text; it does not need to call back into the laptop for this one-way announcement mode.

Configure these **server-side environment variables** before starting JARVIS:

- `JARVIS_CALLING_ENABLED=true`
- `JARVIS_TWILIO_ACCOUNT_SID=AC...`
- `JARVIS_TWILIO_AUTH_TOKEN=...`
- `JARVIS_TWILIO_FROM_NUMBER=+1...` — a Twilio voice-capable number you control
- `JARVIS_CALL_TO_NUMBER=+...` — your verified destination number in E.164 format

Never put the account token in a web page, Android resource, Git repository, or QR code. Twilio account/number availability and destination verification depend on your account and region. A failed provider request does not mean a call was placed.

Open `http://localhost:<JARVIS_PORT>/calling.html`, confirm the status, enter a short message and explicitly press **Call my configured number**. Calls are limited to three attempts per ten minutes per server process.

## Optional reminder calls

Set `JARVIS_CALL_ON_REMINDERS=true` only after manual calls work and you explicitly want configured reminder/deadline alerts to call you. Reminder calls respect the JARVIS Alerts and panic switches, and are suppressed during `JARVIS_CALL_QUIET_HOURS` (default `22:00-07:00`, local machine time). A reminder call must not be enabled merely by installing the feature.

## Android companion

The Phone Hub Android app has a basic in-app speech flow: Android speech recognition captures your utterance, the paired JARVIS gateway asks the configured LLM for a text-only reply, and Android text-to-speech speaks the answer. Grant the `voice` capability explicitly. The app also exposes an explicit outbound call action; grant `calls` separately. These routes use the existing HTTPS gateway, one-time nonce, and per-device capability checks.

## Current limitations / next stage

- Outbound cellular calling is a spoken announcement, not yet a live two-way conversation on the cellular call.
- In-app voice sessions currently require the Phone Hub gateway to be reachable; the private-LAN listener alone is not reachable from arbitrary networks.
- Remote in-app voice needs an authenticated remote relay (or a Twilio Voice SDK + public TwiML app/callback and media path). Do not expose JARVIS's general laptop-control API or disable TLS to solve this.
- Real-device testing and a successful build of the latest Android source are still required.
