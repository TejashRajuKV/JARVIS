# Notes for AI coding tools working in this folder

JARVIS is a personal assistant that runs on this laptop. **There must only ever be one running copy**, at
**http://localhost:3002**. Its chat, settings, phone (ntfy) connection and wake-word listener all belong to that one copy.

- **Do not start JARVIS on another port** (no `PORT=3001 node server.js`, no dev-server preview on a new port).
- Starting it again is safe: `npm start` or `node server.js` finds the running copy, prints its address and exits.
- To look at the app, open http://localhost:3002 (attach to it; don't launch a second server).
- To restart it after changing server code, use **Stop JARVIS** then the desktop **JARVIS** icon (or `Stop JARVIS.bat`, then
  `Start JARVIS.bat`). Never kill `node` processes by name: other Node programs may be running.
- Tests (`npm test`) start their own isolated servers with a temporary home folder and never touch this one.
- The running copy records itself in `~/jarvis/.jarvis.lock` (pid and port). `JARVIS_ALLOW_MULTI=1` disables the guard; only tests should use it.
