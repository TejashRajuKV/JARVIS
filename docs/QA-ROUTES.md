# Registered API routes

Observed on the isolated app via its mounted Express stack. Static files and the separate Phone Hub HTTPS gateway are not in this inventory. A call may verify validation or refusal rather than a successful effect.

| Method and path | Baseline | Final API gate |
|---|---|---|
| `DELETE /api/browser-recovery` | Called | Called |
| `DELETE /api/calendar/config` | Omitted from scanner | Called |
| `DELETE /api/facegreet/enroll` | Called | Called |
| `DELETE /api/homeassistant/config` | Omitted from scanner | Called |
| `DELETE /api/llm/providers/:id` | Called | Called |
| `DELETE /api/phonehub/devices/:id` | Unexplained | Called |
| `DELETE /api/research/sessions/:id` | Omitted from scanner | Called |
| `DELETE /api/state` | Called | Called |
| `DELETE /api/workflows` | Called | Called |
| `DELETE /api/workflows/:id` | Called | Called |
| `GET /api/agent/tools` | Called | Called |
| `GET /api/ai/health` | Called | Called |
| `GET /api/apps` | Called | Called |
| `GET /api/audit/events` | Omitted from scanner | Called |
| `GET /api/autostart` | Called | Called |
| `GET /api/backup/snapshots` | Called | Called |
| `GET /api/browser-recovery` | Called | Called |
| `GET /api/calendar/events` | Omitted from scanner | Called |
| `GET /api/calendar/status` | Omitted from scanner | Called |
| `GET /api/calling/status` | Unexplained | Called |
| `GET /api/chatarchive/status` | Called | Called |
| `GET /api/codeTools` | Called | Called |
| `GET /api/config` | Called | Called |
| `GET /api/diagnostics` | Called | Called |
| `GET /api/events` | Documented exemption | Exempt: server-sent event stream (the page self-test listens to it) |
| `GET /api/facegreet/status` | Called | Called |
| `GET /api/fileIndex/status` | Called | Called |
| `GET /api/health` | Called | Called |
| `GET /api/hello/status` | Called | Called |
| `GET /api/homeassistant/entities` | Omitted from scanner | Called |
| `GET /api/homeassistant/entity/:id` | Omitted from scanner | Called |
| `GET /api/homeassistant/status` | Omitted from scanner | Called |
| `GET /api/hotkey/status` | Called | Called |
| `GET /api/image/status` | Called | Called |
| `GET /api/keepalive/status` | Called | Called |
| `GET /api/llm/providers` | Called | Called |
| `GET /api/llm/status` | Called | Called |
| `GET /api/lock/status` | Called | Called |
| `GET /api/mirror/status` | Called | Called |
| `GET /api/ocr/status` | Called | Called |
| `GET /api/phone/auth` | Called | Called |
| `GET /api/phonehub/status` | Unexplained | Called |
| `GET /api/platform/status` | Omitted from scanner | Called |
| `GET /api/portwatch/status` | Omitted from scanner | Called |
| `GET /api/rag/status` | Called | Called |
| `GET /api/remote/status` | Called | Called |
| `GET /api/research/sessions` | Omitted from scanner | Called |
| `GET /api/research/sessions/:id` | Omitted from scanner | Called |
| `GET /api/room/image` | Unexplained | Called |
| `GET /api/room/images` | Unexplained | Called |
| `GET /api/scan/status` | Called | Called |
| `GET /api/setup/status` | Called | Called |
| `GET /api/shots/image` | Unexplained | Called |
| `GET /api/shots/recent` | Unexplained | Called |
| `GET /api/shots/status` | Called | Called |
| `GET /api/skills` | Called | Called |
| `GET /api/state.js` | Called | Called |
| `GET /api/sys/dashboard` | Called | Called |
| `GET /api/sys/wifi` | Called | Called |
| `GET /api/tool/sandboxInfo` | Called | Called |
| `GET /api/tool/screenshots` | Unexplained | Called |
| `GET /api/tool/screenshots/:id` | Unexplained | Called |
| `GET /api/tool/systemInfo` | Called | Called |
| `GET /api/undo/pending` | Omitted from scanner | Called |
| `GET /api/update/check` | Documented exemption | Exempt: contacts GitHub |
| `GET /api/update/status` | Called | Called |
| `GET /api/voice/vocab` | Called | Called |
| `GET /api/wake/native` | Called | Called |
| `GET /api/watch/status` | Called | Called |
| `GET /api/whisper/status` | Called | Called |
| `GET /api/workflows` | Called | Called |
| `POST /api/agent/exists` | Called | Called |
| `POST /api/agent/plan` | Called | Called |
| `POST /api/agent/tier` | Called | Called |
| `POST /api/agent/validate` | Called | Called |
| `POST /api/ai/health/clear` | Called | Called |
| `POST /api/autostart` | Called | Called |
| `POST /api/backup/export` | Called | Called |
| `POST /api/backup/import` | Called | Called |
| `POST /api/backup/preview` | Called | Called |
| `POST /api/backup/restore` | Called | Called |
| `POST /api/browser-recovery/open/:id` | Called | Called |
| `POST /api/calling/call` | Unexplained | Called |
| `POST /api/chat` | Called | Called |
| `POST /api/chatarchive/append` | Called | Called |
| `POST /api/chatarchive/backfill` | Called | Called |
| `POST /api/chatarchive/forget` | Called | Called |
| `POST /api/chatarchive/search` | Called | Called |
| `POST /api/claim` | Called | Called |
| `POST /api/code/apply` | Omitted from scanner | Called |
| `POST /api/code/generate` | Omitted from scanner | Called |
| `POST /api/commerce/compare` | Unexplained | Called |
| `POST /api/config` | Called | Called |
| `POST /api/csv/analyze` | Called | Called |
| `POST /api/csv/chart` | Called | Called |
| `POST /api/csv/query` | Called | Called |
| `POST /api/dev/explain` | Called | Called |
| `POST /api/dev/git/message` | Called | Called |
| `POST /api/dev/git/summary` | Called | Called |
| `POST /api/disk/apply` | Called | Called |
| `POST /api/disk/applyPermanent` | Called | Called |
| `POST /api/disk/plan` | Called | Called |
| `POST /api/disk/undo` | Called | Called |
| `POST /api/disk/usage` | Called | Called |
| `POST /api/exam/questions` | Called | Called |
| `POST /api/facegreet/enroll` | Called | Called |
| `POST /api/facegreet/match` | Called | Called |
| `POST /api/hello/challenge` | Documented exemption | Exempt: Windows Hello ceremony (hello.test.js) |
| `POST /api/hello/disable` | Documented exemption | Exempt: Windows Hello ceremony (hello.test.js) |
| `POST /api/hello/enroll` | Documented exemption | Exempt: Windows Hello ceremony (hello.test.js) |
| `POST /api/hello/verify` | Documented exemption | Exempt: Windows Hello ceremony (hello.test.js) |
| `POST /api/homeassistant/service` | Omitted from scanner | Called |
| `POST /api/image/generate` | Called | Called |
| `POST /api/image/key` | Called | Called |
| `POST /api/keepalive/ack` | Called | Called |
| `POST /api/keepalive/set` | Called | Called |
| `POST /api/lecture/notes` | Called | Called |
| `POST /api/llm/providers` | Called | Called |
| `POST /api/llm/providers/:id/test` | Called | Called |
| `POST /api/llm/warm` | Documented exemption | Exempt: loads the AI model |
| `POST /api/lock/disable` | Called | Called |
| `POST /api/lock/enable` | Called | Called |
| `POST /api/lock/lock` | Called | Called |
| `POST /api/lock/ping` | Called | Called |
| `POST /api/lock/unlock` | Called | Called |
| `POST /api/mirror/config` | Called | Called |
| `POST /api/mirror/run` | Called | Called |
| `POST /api/mirror/setdest` | Called | Called |
| `POST /api/mirror/verify` | Called | Called |
| `POST /api/nlu/parse` | Called | Called |
| `POST /api/notify/test` | Documented exemption | Exempt: sends a phone notification |
| `POST /api/ocr/image` | Called | Called |
| `POST /api/ocr/screen` | Documented exemption | Exempt: captures your screen |
| `POST /api/ocr/words` | Called | Called |
| `POST /api/pdf/make` | Called | Called |
| `POST /api/pdf/merge` | Called | Called |
| `POST /api/pdf/pages` | Called | Called |
| `POST /api/pdf/rotate` | Called | Called |
| `POST /api/pdf/watermark` | Called | Called |
| `POST /api/phone/alert` | Called | Called |
| `POST /api/phone/auth/check` | Called | Called |
| `POST /api/phone/auth/setup` | Called | Called |
| `POST /api/phone/reply` | Documented exemption | Exempt: sends a phone notification |
| `POST /api/phonehub/devices/:id/grant` | Unexplained | Called |
| `POST /api/phonehub/pairing` | Unexplained | Called |
| `POST /api/portwatch/check` | Omitted from scanner | Called |
| `POST /api/portwatch/enable` | Omitted from scanner | Called |
| `POST /api/project/wiki` | Called | Called |
| `POST /api/quit` | Documented exemption | Exempt: stops the JARVIS server itself (would kill the test server mid-run) |
| `POST /api/rag/reindex` | Called | Called |
| `POST /api/rag/search` | Called | Called |
| `POST /api/research/sessions` | Omitted from scanner | Called |
| `POST /api/room/snapshot` | Called | Called |
| `POST /api/scan/discard` | Called | Called |
| `POST /api/scan/finish` | Called | Called |
| `POST /api/scan/page` | Called | Called |
| `POST /api/services/prepare` | Omitted from scanner | Called |
| `POST /api/setup/pull` | Documented exemption | Exempt: downloads an AI model (GBs) |
| `POST /api/shots/folders` | Called | Called |
| `POST /api/shots/forget` | Called | Called |
| `POST /api/shots/open` | Called | Called |
| `POST /api/shots/search` | Called | Called |
| `POST /api/shots/update` | Called | Called |
| `POST /api/skill/coach` | Called | Called |
| `POST /api/skill/fix` | Called | Called |
| `POST /api/skill/run` | Called | Called |
| `POST /api/skill/site` | Called | Called |
| `POST /api/skill/siteEdit` | Called | Called |
| `POST /api/skill/siteOpen` | Documented exemption | Exempt: opens the browser |
| `POST /api/skill/siteRevert` | Called | Called |
| `POST /api/skill/uiprompt` | Called | Called |
| `POST /api/skill/viva/grade` | Called | Called |
| `POST /api/skill/viva/questions` | Called | Called |
| `POST /api/skills/:name/enabled` | Called | Called |
| `POST /api/skills/reload` | Called | Called |
| `POST /api/state` | Called | Called |
| `POST /api/summarize` | Called | Called |
| `POST /api/sys/brightness` | Called | Called |
| `POST /api/sys/browserTab` | Documented exemption | Exempt: presses Ctrl+<n> / Ctrl+Tab in your browser |
| `POST /api/sys/clipHistory` | Documented exemption | Exempt: reads your clipboard history |
| `POST /api/sys/displayOff` | Documented exemption | Exempt: turns the display off |
| `POST /api/sys/pickFolder` | Documented exemption | Exempt: opens the Windows folder picker on your screen |
| `POST /api/sys/powerPlan` | Called | Called |
| `POST /api/sys/radio` | Called | Called |
| `POST /api/sys/screenRead` | Documented exemption | Exempt: OCRs your screen |
| `POST /api/sys/theme` | Called | Called |
| `POST /api/sys/volume` | Called | Called |
| `POST /api/sys/window` | Documented exemption | Exempt: moves your windows |
| `POST /api/tenders/count` | Called | Called |
| `POST /api/tool/batteryStatus` | Called | Called |
| `POST /api/tool/cancelShutdown` | Documented exemption | Exempt: power command |
| `POST /api/tool/checkCompiler` | Called | Called |
| `POST /api/tool/checkExtension` | Called | Called |
| `POST /api/tool/checkPort` | Called | Called |
| `POST /api/tool/clearSandbox` | Documented exemption | Exempt: guarded bulk delete; deleteItem covers the same path |
| `POST /api/tool/closeApplication` | Called | Called |
| `POST /api/tool/codeAsk` | Documented exemption | Exempt: drives your editor’s coding AI |
| `POST /api/tool/contests` | Called | Called |
| `POST /api/tool/copyFile` | Called | Called |
| `POST /api/tool/createFolder` | Called | Called |
| `POST /api/tool/deleteItem` | Called | Called |
| `POST /api/tool/directions` | Called | Called |
| `POST /api/tool/distance` | Called | Called |
| `POST /api/tool/fetchPage` | Called | Called |
| `POST /api/tool/findFolderAnywhere` | Documented exemption | Exempt: walks every drive (slow); covered by the page self-test |
| `POST /api/tool/folderStats` | Called | Called |
| `POST /api/tool/gitClone` | Documented exemption | Exempt: downloads from the internet |
| `POST /api/tool/gitCommit` | Called | Called |
| `POST /api/tool/gitDiff` | Called | Called |
| `POST /api/tool/gitLog` | Called | Called |
| `POST /api/tool/gitPending` | Called | Called |
| `POST /api/tool/gitStatus` | Called | Called |
| `POST /api/tool/installDeps` | Called | Called |
| `POST /api/tool/listFiles` | Called | Called |
| `POST /api/tool/listProcesses` | Called | Called |
| `POST /api/tool/locateProject` | Called | Called |
| `POST /api/tool/lockSystem` | Documented exemption | Exempt: locks the screen |
| `POST /api/tool/mediaKey` | Documented exemption | Exempt: presses media keys |
| `POST /api/tool/moveFile` | Called | Called |
| `POST /api/tool/nearby` | Called | Called |
| `POST /api/tool/networkInfo` | Called | Called |
| `POST /api/tool/openApplication` | Documented exemption | Exempt: launches apps |
| `POST /api/tool/openFile` | Documented exemption | Exempt: opens a viewer window |
| `POST /api/tool/openFolder` | Documented exemption | Exempt: opens Explorer |
| `POST /api/tool/openInEditor` | Documented exemption | Exempt: opens VS Code |
| `POST /api/tool/openKnownFolder` | Documented exemption | Exempt: opens Explorer |
| `POST /api/tool/openUrl` | Documented exemption | Exempt: opens the browser |
| `POST /api/tool/pasteKeys` | Documented exemption | Exempt: types into the focused app |
| `POST /api/tool/portOwner` | Called | Called |
| `POST /api/tool/processStatus` | Called | Called |
| `POST /api/tool/readClipboard` | Documented exemption | Exempt: reads your clipboard |
| `POST /api/tool/readFile` | Called | Called |
| `POST /api/tool/recentFiles` | Called | Called |
| `POST /api/tool/renameFile` | Called | Called |
| `POST /api/tool/research` | Called | Called |
| `POST /api/tool/restartSystem` | Documented exemption | Exempt: restarts the laptop |
| `POST /api/tool/restoreItem` | Called | Called |
| `POST /api/tool/restoreVersion` | Called | Called |
| `POST /api/tool/runFile` | Called | Called |
| `POST /api/tool/runningApps` | Called | Called |
| `POST /api/tool/screenshot` | Documented exemption | Exempt: captures your screen |
| `POST /api/tool/searchFiles` | Called | Called |
| `POST /api/tool/setVolume` | Called | Called |
| `POST /api/tool/showDesktop` | Documented exemption | Exempt: minimises your windows |
| `POST /api/tool/shutdownSystem` | Documented exemption | Exempt: turns the laptop off (the Windows Hello guard is a no-op until Hello is enrolled) |
| `POST /api/tool/similar` | Called | Called |
| `POST /api/tool/sleepSystem` | Documented exemption | Exempt: puts the laptop to sleep |
| `POST /api/tool/startProcess` | Called | Called |
| `POST /api/tool/stopProcess` | Called | Called |
| `POST /api/tool/toolVersion` | Called | Called |
| `POST /api/tool/undoCreate` | Called | Called |
| `POST /api/tool/undoMove` | Called | Called |
| `POST /api/tool/upload` | Called | Called |
| `POST /api/tool/weather` | Called | Called |
| `POST /api/tool/webAnswer` | Called | Called |
| `POST /api/tool/webSearch` | Called | Called |
| `POST /api/tool/writeClipboard` | Documented exemption | Exempt: overwrites your clipboard |
| `POST /api/tool/writeFile` | Called | Called |
| `POST /api/tool/youtubeTop` | Called | Called |
| `POST /api/translate` | Called | Called |
| `POST /api/tts` | Documented exemption | Exempt: network text-to-speech voice |
| `POST /api/vision/ask` | Called | Called |
| `POST /api/vision/saved-image` | Unexplained | Called |
| `POST /api/wake/front` | Documented exemption | Exempt: moves the JARVIS window in front of your apps |
| `POST /api/wake/native` | Called | Called |
| `POST /api/watch/add` | Called | Called |
| `POST /api/watch/check` | Called | Called |
| `POST /api/watch/enable` | Called | Called |
| `POST /api/watch/remove` | Called | Called |
| `POST /api/whisper/transcribe` | Called | Called |
| `POST /api/workflows` | Called | Called |
| `POST /api/workflows/validate` | Omitted from scanner | Called |
| `PUT /api/calendar/config` | Omitted from scanner | Called |
| `PUT /api/homeassistant/config` | Omitted from scanner | Called |

Express also registers explicit pages at `GET /home` and `GET /welcome`. One observed duplicate declaration for `POST /api/commerce/compare` is counted once.
