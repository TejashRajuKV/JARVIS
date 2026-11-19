# JARVIS Marks developer preview

Marks uses the existing JARVIS server at `http://localhost:3002`. The normal dashboard hides the Marks button by default. Each profile is defined in `marks-profiles.json`. Every profile currently has preview status, so the production release gate stays closed.

## Local preview

Use an isolated test run for development. To try the developer preview on the installed copy later, set `JARVIS_MARKS=preview` in the environment used by the launcher. Stop and start JARVIS with its existing launchers, then select **Marks** on the dashboard. **Disable Marks** cancels its work for that JARVIS session and keeps saved results. Remove the preview environment variable before returning to normal startup. Each Marks tab starts with Standard.

- For Mark 33 set `JARVIS_MARKS_OLLAMA_URL` to a numeric loopback address such as `http://127.0.0.1:11434` and `JARVIS_MARKS_LOCAL_MODEL` to an installed model tag. This workspace sends text only to the loopback Ollama service and keeps the conversation in memory. Use an Ollama instance you control, with cloud proxying and prompt debugging disabled. There is no fallback to the normal cloud provider.
- Set `JARVIS_MARKS_PORTABLE_MODEL` to an installed local tag up to 2 GiB for Mark 5. **Start Marks Tray.bat** opens the existing workspace. **Start Marks Hotkey.bat** opts into `Ctrl+Alt+J`, which opens compact commands. Each launcher has an icon menu to exit its helper. The helpers attach to JARVIS and never start a server.
- Turn on the existing Windows wake listener before arming Mark 2. Voice disarms when changing profile, leaving the foreground tab, or invoking emergency stop. A command following a bare wake phrase can use the browser’s speech service. A same-breath command uses Windows recognition when available.

## Example commands

From the main chat, say `open mark controls` to open Marks or `enable Mark 1` to open it with Mark 1 selected. The main chat keeps its current mode.

| Profile | Example |
|---|---|
| Mark 1, Mark 2, Friday | `open notepad` or `search the web for local plants` |
| Mark 3 | `read screen`, `windows`, `inspect "Exact Window Title"`, or `plan in "Exact Window Title" to fill the Name field with Alex`. Screen OCR is local and stays out of saved results. |
| Mark 6 | `on`, `off`, or `status`. Pauses new heavy steps at the configured battery threshold. A step already sent to a model can finish. |
| Mark 17 | `find file "Documents/example.txt"` or `click "Save" in "Exact Title" expect "Saved"` |
| Mark 22 | `what time is it?`, `what is today's date?`, or `calculate 24 * (8 - 3)` |
| Mark 38 | `prefix files in "Documents/Batch" with "reviewed-"`, `convert documents in "Documents/Batch" to text`, or `clean CSV in "Documents/Batch"` |
| Mark 39 | A research question. Enable Online tools for web retrieval. |
| Mark 40 | Enter separate lines for `web search QUERY`, `read code "FILE"`, `read office "FILE"`, `terminal info`, `google mail`, `microsoft calendar`, or `draft INSTRUCTION`. Account data stays out of the draft model. |
| Mark 42 and House Party | Submit `list my to-dos`, `deadlines`, `read file PATH`, `research TOPIC`, or `draft INSTRUCTION`, one task per line. |
| Mark 44 | `quarantine files in "Documents/Batch" with extension ".tmp"`, `batches`, or `undo batch ID`. Check the exact list before applying. Quarantine stays within JARVIS data folders. |
| Mark 46 | Enter a read-and-draft goal. Review the proposed steps, then inspect outputs and any unresolved step in Background work. |
| Mark 47 | `Quiz me on normalization. Ask one question at a time.` Include any class rules alongside assignment requests. |
| Mark 50 | `draft tool Turn my notes into a checklist`, `tools`, `run tool NAME on TEXT`, or `remove tool NAME`. Supported line transforms run a fixture in an isolated worker before registration. Other text tools use the selected model. |
| Mark 85 | `remember I prefer short answers`, `memories`, `forget memory ID`, or `use mark-22 what time is it?`. Use `answer using memory QUESTION` to include approved notes in the selected model request. |
| Sentry | `watch google mail from name@example.com`, `watch microsoft mail from name@example.com`, `watch download "report.pdf"`, `watch deadline "Submit report"`, `watches`, `alerts`, or `stop watch ID`. Watches live for the current server session. |

The Marks background lanes limit execution to read and draft tools. Plans are checkpointed separately from standard JARVIS, and interrupted jobs require review. Batch outputs and recovery data also have their own storage. CSV cleanup trims fields and drops empty and duplicate rows in new CSV copies. Office conversion extracts text to new files. Batch recovery verifies the saved content before restoring and will stop at a conflict.

## Connected accounts and paired phones

Use `http://localhost:3002/marks-oauth.html` as the OAuth redirect URI for the developer preview. Configure `JARVIS_MARKS_GOOGLE_CLIENT_ID` and `JARVIS_MARKS_GOOGLE_CLIENT_SECRET`, and configure `JARVIS_MARKS_MICROSOFT_CLIENT_ID` plus `JARVIS_MARKS_MICROSOFT_CLIENT_SECRET` if the Microsoft app registration requires it. Enable the Gmail and Google Calendar APIs on the Google project. In Marks, connect each provider explicitly from Mark 40. Tokens stay in server memory until disconnected or restarted. The toolbox reads mailbox metadata and calendar events. It prepares local text drafts for the user to review and use in the provider app. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) · [Microsoft OAuth](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) · [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)

Paired Android devices must be granted **Marks task status and shared reports** in Phone Hub before they can read Marks status. Refresh status on the phone to show the **Marks tasks** button. A completed job offers **Review for Phone Hub** under Background work. Only the reviewed text is shared. The owner can remove report access or revoke the device grant. This uses the existing optional HTTPS gateway.

## Release checks

Run `npm test` with JARVIS’s isolated test setup. Run `tests/marks.test.js` with `JARVIS_MARKS_STRESS=1` for the 10,000-file rename and restore fixture. Before promoting the profiles from preview, verify the Windows shortcut, tray, microphone, desktop actions, and battery behavior on the laptop. Verify the actual local Ollama privacy configuration, Google and Microsoft sign-in and watches, and Android TLS pairing with permission grant and revocation. Keep the release gate closed until these checks and the full compatibility suite pass.
