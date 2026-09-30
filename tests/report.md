# JARVIS feature report

_Generated 2026-09-30 06:12 by `npm run test:report`._

**Every suite passed.**

## Suites

| Suite | Result | Time |
|---|---|---|
| `coverage.test.js` | ✓ coverage: 355/355 · 176 intents | 0s |
| `agent.test.js` | ✓ routing: 70/70 (simple 26/26, multi 24/24, question 20/20) · safety: 114/114 | 1s |
| `api.test.js` | ✓ api: 137/137 · 94 of 131 routes called, 37 not testable | 21s |
| `apps.test.js` | ✓ apps: 17/17 | 0s |
| `backup.test.js` | ✓ backup: 44/44 | 0s |
| `codeask.test.js` | ✓ codeask: 58/58 | 0s |
| `doctext.test.js` | ✓ 26/26 — all passed | 0s |
| `e2e.test.js` | ✓ e2e: 232/232 | 134s |
| `hello.test.js` | ✓ hello: 31/31 | 0s |
| `hotkey.test.js` | ✓ hotkey: 12/12 | 0s |
| `llm.test.js` | ✓ llm: 66/66 | 0s |
| `nlu.test.js` | ✓ 261/261 passed | 0s |
| `palette.test.js` | ✓ 20/20 palette checks passed | 0s |
| `paraphrase.test.js` | ✓ paraphrase: 250/258 correct (97%) · 8 to AI planner · 0 to chat · 0 confident-wrong · chat-only: 7/7 left with chat | 0s |
| `phoneauth.test.js` | ✓ phoneauth: 15/15 | 0s |
| `plan.test.js` | ✓ plan: 40/40 | 6s |
| `rag.test.js` | ✓ rag: 28/28 | 0s |
| `scheduler.test.js` | ✓ scheduler: 21/21 | 0s |
| `skills-page.test.js` | ✓ skills-page: 50/50 | 0s |
| `skills.test.js` | ✓ skills: 38/38 | 0s |
| `student.test.js` | ✓ 60/60 — all passed | 0s |
| `study.test.js` | ✓ study: 25/25 | 0s |
| `triggers.test.js` | ✓ triggers: 31/31 | 0s |
| `undo.test.js` | ✓ undo: 14/14 | 0s |
| `update.test.js` | ✓ 14/14 update checks passed | 0s |

## Features

Understood = every test phrase reaches the right command. In the page = the example phrase, run through the real chat in a headless browser (laptop actions faked), answered without errors.
**176 of 176 commands pass.**


### Chat

| Command | Example | Understood | In the page |
|---|---|---|---|
| GREETING | “hello” | ✓ | ✓ |
| GOODNIGHT | “good night” | ✓ | ✓ |
| HOME | “i'm home” | ✓ | ✓ |
| PRAISE | “well done” | ✓ | ✓ |
| INSULT | “you're useless” | ✓ | ✓ |
| HOW_ARE_YOU | “how are you” | ✓ | ✓ |
| IDENTITY | “who are you” | ✓ | ✓ |
| JOKE | “tell me a joke” | ✓ | ✓ |
| THANKS | “thanks” | ✓ | ✓ |
| GOODBYE | “bye” | ✓ | ✓ |
| HELP | “what can you do” | ✓ | ✓ |
| PERSONA_SET | “switch to friday” | ✓ | ✓ |
| THEME_SET | “switch to gold theme” | ✓ | ✓ |
| CHAT_MEMORY | “what were we talking about” | ✓ | ✓ |
| REGENERATE | “regenerate” | ✓ | ✓ |
| DELETE_LAST_MSG | “delete my last message” | ✓ | ✓ |
| GET_TIME | “what time is it” | ✓ | ✓ |
| GET_DATE | “what's the date today” | ✓ | ✓ |
| BRIEFING | “give me my briefing” | ✓ | ✓ |

### Memory

| Command | Example | Understood | In the page |
|---|---|---|---|
| RECALL_NAME | “what's my name” | ✓ | ✓ |
| SET_NAME | “my name is tejas” | ✓ | ✓ |
| RECALL_ALL | “what do you remember about me” | ✓ | ✓ |
| FORGET | “forget that i like tea” | ✓ | ✓ |
| REMEMBER | “remember that my exam is in december” | ✓ | ✓ |
| SET_CITY | “my city is bengaluru” | ✓ | ✓ |
| LEARN_LIST | “what have you learned” | ✓ | ✓ |
| LEARN_FORGET_ALL | “forget everything you've learned” | ✓ | ✓ |
| MISSES_LIST | “what didn't you understand” | ✓ | ✓ |
| WHY_ACTION | “why did you do that” | ✓ | ✓ |
| AGENT_HISTORY | “what did you just do” | ✓ | ✓ |

### Laptop

| Command | Example | Understood | In the page |
|---|---|---|---|
| OPEN_APPLICATION | “open chrome” | ✓ | ✓ |
| CLOSE_APPLICATION | “close chrome” | ✓ | ✓ |
| CONTEXT_CLOSE | “close it” | ✓ | ✓ |
| VOLUME_SET | “set volume to 30” | ✓ | ✓ |
| VOLUME_UP | “volume up” | ✓ | ✓ |
| VOLUME_DOWN | “volume down” | ✓ | ✓ |
| VOLUME_MUTE | “mute” | ✓ | ✓ |
| BRIGHTNESS | “set brightness to 50” | ✓ | ✓ |
| DARK_MODE | “dark mode” | ✓ | ✓ |
| RADIO | “turn off bluetooth” | ✓ | ✓ |
| POWER_PLAN | “battery saver” | ✓ | ✓ |
| DISPLAY_OFF | “turn off the display” | ✓ | ✓ |
| WINDOW_LAYOUT | “snap chrome to the left” | ✓ | ✓ |
| SHOW_DESKTOP | “show desktop” | ✓ | ✓ |
| OPEN_KNOWN_FOLDER | “open downloads” | ✓ | ✓ |
| SCREENSHOT | “take a screenshot” | ✓ | ✓ |
| SCREEN_READ | “read my screen” | ✓ | ✓ |
| SCREEN_EXPLAIN | “explain the error on my screen” | ✓ | ✓ |
| SYS_LOCK | “lock the screen” | ✓ | ✓ |
| SYS_SLEEP | “sleep” | ✓ | ✓ |
| SYS_SHUTDOWN | “shut down” | ✓ | ✓ |
| SYS_RESTART | “restart” | ✓ | ✓ |
| SYS_CANCEL_SHUTDOWN | “cancel the shutdown” | ✓ | ✓ |
| SYS_BATTERY | “battery” | ✓ | ✓ |
| SYS_CPU | “cpu usage” | ✓ | ✓ |
| SYS_RAM | “ram usage” | ✓ | ✓ |
| SYS_DISK | “disk space” | ✓ | ✓ |
| SYS_OS | “what os am i on” | ✓ | ✓ |
| SYS_ALL | “system info” | ✓ | ✓ |
| SYS_NETWORK | “what's my ip” | ✓ | ✓ |
| SYS_PROCESSES | “what's running” | ✓ | ✓ |
| SYSTEM_STATE | “system status” | ✓ | ✓ |
| DIAGNOSTICS | “run diagnostics” | ✓ | ✓ |
| MEDIA_PLAY | “pause” | ✓ | ✓ |
| MEDIA_NEXT | “next song” | ✓ | ✓ |
| MEDIA_PREV | “previous song” | ✓ | ✓ |
| MEDIA_STOP | “stop the music” | ✓ | ✓ |
| PANIC_ON | “panic” | ✓ | ✓ |
| PANIC_OFF | “resume” | ✓ | ✓ |
| UNDO | “undo” | ✓ | ✓ |
| BACKUP | “back up my data” | ✓ | ✓ |

### Clipboard

| Command | Example | Understood | In the page |
|---|---|---|---|
| READ_CLIPBOARD | “what's in my clipboard” | ✓ | ✓ |
| WRITE_CLIPBOARD | “copy hello world to the clipboard” | ✓ | ✓ |
| CLIP_HISTORY | “clipboard history” | ✓ | ✓ |
| CLIP_TOOL | “format the json in my clipboard” | ✓ | ✓ |
| CLIP_TRANSFORM | “convert the copied code to python” | ✓ | ✓ |
| EXPLAIN_CLIPBOARD | “explain the code in my clipboard” | ✓ | ✓ |
| CLIPBOARD_IMAGE_READ | “read the text from the image in my clipboard” | ✓ | ✓ |
| CLIPBOARD_TO_FILE | “save my clipboard to notes.md” | ✓ | ✓ |
| SUMMARISE_LINK | “summarise the link in my clipboard” | ✓ | ✓ |
| COPY_CONTENT | “copy that” | ✓ | ✓ |
| PASTE_TO_EDITOR | “paste it in vs code” | ✓ | ✓ |

### Files

| Command | Example | Understood | In the page |
|---|---|---|---|
| WRITE_FILE | “create a file called ideas” | ✓ | ✓ |
| NOTE_APPEND | “take a note: buy pens” | ✓ | ✓ |
| READ_FILE | “read my notes” | ✓ | ✓ |
| LIST_FILES | “list my files” | ✓ | ✓ |
| SEARCH_FILES | “find the file about graphs” | ✓ | ✓ |
| CREATE_FOLDER | “create a folder called dsa” | ✓ | ✓ |
| RENAME_FILE | “rename notes.md to dbms.md” | ✓ | ✓ |
| COPY_FILE | “copy notes.md to backup” | ✓ | ✓ |
| MOVE_FILE | “move notes.md to archive” | ✓ | ✓ |
| DELETE_ITEM | “delete the file old.txt” | ✓ | ✓ |
| DESTRUCTIVE | “delete all my files” | ✓ | ✓ |
| CHECK_EXISTS | “check if notes.md exists” | ✓ | ✓ |
| OPEN_FOLDER | “open the projects folder” | ✓ | ✓ |
| ASK_FILES | “what does unit2.pdf say about 3NF?” | ✓ | ✓ |
| SUMMARISE_FILE | “summarise notes.md” | ✓ | ✓ |
| SAVE_CODE | “save that code as bfs.py” | ✓ | ✓ |
| WRITE_AND_SAVE | “write a bubble sort in python and save it as sort.py” | ✓ | ✓ |

### Study

| Command | Example | Understood | In the page |
|---|---|---|---|
| ADD_TODO | “add milk to my to-do list” | ✓ | ✓ |
| LIST_TODOS | “show my to-do list” | ✓ | ✓ |
| DONE_TODO | “mark 2 as done” | ✓ | ✓ |
| CLEAR_TODOS | “clear completed tasks” | ✓ | ✓ |
| REMIND | “remind me to call mom at 6pm” | ✓ | ✓ |
| LIST_REMINDERS | “what are my reminders” | ✓ | ✓ |
| SET_TIMER | “set a timer for 10 minutes” | ✓ | ✓ |
| CANCEL_TIMERS | “cancel all timers” | ✓ | ✓ |
| FOCUS_START | “start a focus session” | ✓ | ✓ |
| FOCUS_STOP | “stop the focus session” | ✓ | ✓ |
| BLOCK_DISTRACTIONS | “block distractions” | ✓ | ✓ |
| ADD_DEADLINE | “add assignment os lab record due friday” | ✓ | ✓ |
| LIST_DEADLINES | “what's due this week” | ✓ | ✓ |
| ADD_CLASS | “add class dbms on monday at 10am” | ✓ | ✓ |
| NEXT_CLASS | “next class” | ✓ | ✓ |
| LIST_CLASSES | “today's classes” | ✓ | ✓ |
| STUDY_PLAN | “plan my GATE prep, exam on 12 Feb, topics: OS, DBMS” | ✓ | ✓ |
| STUDY_TODAY | “what should i study today” | ✓ | ✓ |
| PLAN_DAY | “plan my day” | ✓ | ✓ |
| WEEK_REPORT | “how was my week” | ✓ | ✓ |
| PRODUCTIVITY_REPORT | “how productive was i today” | ✓ | ✓ |
| FLASH_MAKE | “make flashcards from lecture3.pdf” | ✓ | ✓ |
| FLASH_REVIEW | “review my flashcards” | ✓ | ✓ |
| FLASH_LIST | “show my flashcards” | ✓ | ✓ |
| FLASH_DELETE | “delete my os flashcards” | ✓ | ✓ |
| ATTENDANCE_MARK | “mark dbms present” | ✓ | ✓ |
| ATTENDANCE_REPORT | “attendance report” | ✓ | ✓ |
| ATTENDANCE_TARGET | “how many classes to reach 80%?” | ✓ | ✓ |
| BUNK_CHECK | “can i bunk tomorrow?” | ✓ | ✓ |
| ADD_MARKS | “add s3: 8.6 gpa, 24 credits” | ✓ | ✓ |
| CGPA_REPORT | “what is my cgpa?” | ✓ | ✓ |
| GPA_TARGET | “what gpa do i need for an 8.5 cgpa?” | ✓ | ✓ |
| CONTESTS | “upcoming contests” | ✓ | ✓ |
| CONTEST_REMIND | “remind me before the next leetcode contest” | ✓ | ✓ |
| HACKATHONS | “upcoming hackathons” | ✓ | ✓ |

### Web

| Command | Example | Understood | In the page |
|---|---|---|---|
| WEB_SEARCH | “google best laptops” | ✓ | ✓ |
| SITE_SEARCH | “search gfg for heap sort” | ✓ | ✓ |
| OPEN_URL | “open amazon.com” | ✓ | ✓ |
| YOUTUBE | “play lofi on youtube” | ✓ | ✓ |
| YOUTUBE_PLAY | “play believer” | ✓ | ✓ |
| RESEARCH | “search the web for rust vs go” | ✓ | ✓ |
| WEATHER | “weather in bengaluru” | ✓ | ✓ |
| DIRECTIONS | “directions to majestic” | ✓ | ✓ |
| DIRECTIONS_OPEN | “open directions to majestic in maps” | ✓ | ✓ |
| DISTANCE | “distance from hyderabad to bangalore” | ✓ | ✓ |

### Code

| Command | Example | Understood | In the page |
|---|---|---|---|
| RUN_FILE | “run bfs.py” | ✓ | ✓ |
| OPEN_IN_EDITOR | “open main.py in vs code” | ✓ | ✓ |
| CODE_ASK | “tell copilot to add tests” | ✓ | ✓ |
| LOCATE_PROJECT | “locate my agriloop project” | ✓ | ✓ |
| START_PROCESS | “start the agriloop backend” | ✓ | ✓ |
| STOP_PROCESS | “stop the agriloop backend” | ✓ | ✓ |
| CHECK_PORT | “check port 3000” | ✓ | ✓ |
| WORKFLOW | “coding mode” | ✓ | ✓ |
| GIT_STATUS | “git status” | ✓ | ✓ |
| GIT_LOG | “git log” | ✓ | ✓ |
| GIT_DIFF | “git diff” | ✓ | ✓ |
| GIT_COMMIT | “git commit” | ✓ | ✓ |
| GIT_CLONE | “clone https://github.com/user/repo” | ✓ | ✓ |
| SNIPPET_SAVE | “save that as snippet dfs” | ✓ | ✓ |
| SNIPPET_LIST | “show my snippets” | ✓ | ✓ |
| SNIPPET_COPY | “copy snippet dfs” | ✓ | ✓ |
| SNIPPET_DELETE | “delete snippet dfs” | ✓ | ✓ |
| BASE_CONVERT | “255 to binary” | ✓ | ✓ |
| DATA_SIZE | “5 gb to mb” | ✓ | ✓ |
| UNIT_CONVERT | “100 f to c” | ✓ | ✓ |
| ASCII | “ascii of A” | ✓ | ✓ |
| BITWISE | “5 xor 3” | ✓ | ✓ |
| CALCULATE | “what is 25 times 4” | ✓ | ✓ |

### Automation

| Command | Example | Understood | In the page |
|---|---|---|---|
| ROUTINE_CREATE | “create a routine called exam prep: open vs code, start a focus session” | ✓ | ✓ |
| ROUTINE_LIST | “list my routines” | ✓ | ✓ |
| ROUTINE_DELETE | “delete the gym routine” | ✓ | ✓ |
| ROUTINE_RUN | “run study mode” | ✓ | ✓ |
| ROUTINE_SCHEDULE | “run my morning routine every day at 7am” | ✓ | ✓ |
| TRIGGER_CREATE | “when i plug in my charger, start study mode” | ✓ | ✓ |
| TRIGGER_LIST | “list my triggers” | ✓ | ✓ |
| TRIGGER_DELETE | “delete trigger 2” | ✓ | ✓ |
| CONTEXT_REOPEN | “open it again” | ✓ | ✓ |

## End-to-end checks

Real flows in the page, checking the resulting state (to-do saved, reminder at the right time, app closed on the fake laptop, plan verified…).

- **Harness** — ✓ the page loaded in msedge.exe · ✓ the self-test finished (within 10 minutes) · ✓ the app booted
- **To-dos** — ✓ add a to-do · ✓ list to-dos · ✓ mark one done · ✓ clear completed to-dos
- **Undo** — ✓ undo brings the cleared to-do back
- **Reminders** — ✓ a reminder in 10 minutes · ✓ a yearly reminder in July · ✓ list reminders
- **Timers** — ✓ start a timer · ✓ cancel timers
- **Focus** — ✓ start a 45-minute focus session · ✓ a running session is not silently restarted (asks first) · ✓ stop the session
- **Laptop** — ✓ set volume (sent 30, read back) · ✓ open an app · ✓ close an app after permission · ✓ switch Bluetooth off · ✓ Windows dark mode · ✓ brightness · ✓ system status snapshot
- **Safety** — ✓ shutdown asks first — declined means it never runs · ✓ "delete all my files" is refused · ✓ no real laptop action escaped the fakes during the whole run
- **Look** — ✓ switch theme
- **Panic** — ✓ panic pauses automation and shows the pill · ✓ resume ends it and hides the pill
- **Memory** — ✓ remembers your name · ✓ remembers facts
- **Attendance** — ✓ marks attendance (3 of 4) · ✓ report shows 75% · ✓ classes needed for 80% · ✓ bunk check
- **Marks** — ✓ save a semester · ✓ CGPA · ✓ GPA needed for a target
- **Deadlines** — ✓ add a deadline · ✓ list deadlines
- **Timetable** — ✓ add a class
- **Files** — ✓ take a note (written to the sandbox) · ✓ create a folder
- **Notes search** — ✓ answers from your own file (AI offline: shows the passage)
- **Code** — ✓ run a program and show its output
- **Tools** — ✓ base conversion · ✓ unit conversion · ✓ calculator · ✓ time
- **Routines** — ✓ create a routine · ✓ run it (steps actually execute)
- **Triggers** — ✓ create a trigger · ✓ list triggers
- **Agent** — ✓ multi-step plan previews, runs and verifies · ✓ the distracting apps were really closed (fake laptop) · ✓ "no, that’s wrong" is logged for teaching

## Server API checks

Every route of a real server.js, isolated in a temp home (your ~/jarvis is never touched), AI offline.

- **Security** — ✓ a foreign Origin is refused · ✓ a foreign Host header is refused (DNS rebinding) · ✓ state.js needs same-origin (another site can’t <script> it) · ✓ the sandbox is the isolated temp home, not your ~/jarvis · ✓ malformed JSON gets a short JSON error, not a stack trace · ✓ JARVIS’s own config file can’t be read through file tools · ✓ the shared state file can’t be read through file tools
- **Status** — ✓ health answers · ✓ LLM status reports the AI as unreachable (dead port), without crashing · ✓ remote (Tailscale) status answers · ✓ hotkey status answers · ✓ update status answers (no network call) · ✓ Windows Hello status: off in a fresh install · ✓ setup status answers with Ollama offline
- **Laptop** — ✓ app list (allowlist + installed apps) loads · ✓ system info (CPU, RAM, disk) · ✓ battery status · ✓ which apps are running · ✓ network info · ✓ process list · ✓ Wi-Fi info · ✓ read the volume (no change) · ✓ read brightness (no change; 501 on desktops without it) · ✓ read the Windows theme (no change) · ✓ read the power plan (no change) · ✓ read the Bluetooth state (no change) · ✓ radio refuses an unknown kind · ✓ closeApplication refuses an app that isn’t allowed · ✓ setVolume refuses a bad level · ✓ deleting outside the sandbox is refused
- **Coding AI** — ✓ coding-AI tool list loads
- **State** — ✓ saving state works · ✓ state comes back to the page (state.js) · ✓ keys outside jarvis.* are refused · ✓ a malformed body is refused
- **Files** — ✓ write a note · ✓ read it back · ✓ "dbms" finds "DBMS Notes.md" (fuzzy name) · ✓ a missing file is a clean 404 · ✓ append to a note · ✓ writing over an existing file asks first (exists), without overwriting · ✓ invalid file names are refused · ✓ writing outside the sandbox is refused · ✓ reading outside the sandbox is refused · ✓ create a folder · ✓ creating it again says it existed · ✓ list the sandbox · ✓ copy a file · ✓ rename a file · ✓ move a file into a folder · ✓ search files by name · ✓ delete goes to the trash, not gone · ✓ restore refuses a bad trash name · ✓ upload a document (drag & drop / 📎) · ✓ upload refuses other file types
- **Agent** — ✓ agent/exists confirms the folder (used to verify steps) · ✓ agent/exists says no for a missing one · ✓ the tool registry loads with permission tiers · ✓ a valid tool call passes validation · ✓ an out-of-range argument is refused · ✓ an unknown tool is refused · ✓ a yearly reminder passes validation · ✓ permission tier: shutdown is explicit · ✓ planning with the AI offline fails cleanly (no crash)
- **Undo** — ✓ undo a rename · ✓ restore a deleted file from the trash · ✓ undo creating a file (moves it to the trash) · ✓ restoreVersion refuses a bad backup name
- **Notes search** — ✓ reindex your files · ✓ a question finds the right document · ✓ an empty question is refused · ✓ index status answers
- **Projects** — ✓ add a project folder · ✓ adding a system folder is refused · ✓ a relative path is refused · ✓ config lists the folder · ✓ locate a project by name · ✓ start the project’s backend · ✓ its status says running · ✓ a project with no frontend says so (not a crash) · ✓ stop the backend JARVIS started · ✓ invalid "which" is refused · ✓ checkPort validates the number · ✓ checkPort answers for a real port · ✓ portOwner answers · ✓ portOwner validates the number
- **Code** — ✓ run a JavaScript file and capture its output · ✓ a crashing program reports the error and exit code · ✓ checkCompiler for Python answers · ✓ checkCompiler refuses an unknown language · ✓ checkExtension answers
- **Git** — ✓ git status · ✓ git commit · ✓ git log shows it · ✓ git diff answers · ✓ commit needs a message
- **AI** — ✓ chat with the AI offline returns an error, not a hang · ✓ chat needs messages · ✓ summarize needs text · ✓ summarize with the AI offline errors cleanly
- **Language** — ✓ translate validates the language
- **Skills** — ✓ viva needs a subject · ✓ viva/grade: missing input gets a plain 4xx message · ✓ coach: missing input gets a plain 4xx message · ✓ fix: missing input gets a plain 4xx message · ✓ site: missing input gets a plain 4xx message · ✓ siteEdit: missing input gets a plain 4xx message · ✓ siteRevert: missing input gets a plain 4xx message · ✓ viva questions with the AI offline: a clean error, not a crash
- **AI providers** — ✓ provider list loads (keys never shown) · ✓ adding an empty key is refused · ✓ editing a provider that doesn’t exist is a 4xx · ✓ testing a provider that doesn’t exist is a 404 · ✓ deleting a provider that doesn’t exist is a harmless no-op
- **Web** — ✓ best-page search needs a query · ✓ YouTube top result needs a query
- **Online** — ✓ weather refuses when Online tools is off · ✓ contests refuses when Online tools is off · ✓ webAnswer refuses when Online tools is off · ✓ research refuses when Online tools is off · ✓ fetchPage refuses when Online tools is off · ✓ directions refuses when Online tools is off · ✓ distance refuses when Online tools is off
- **Backup** — ✓ export a backup · ✓ preview a backup before importing · ✓ a damaged backup is refused · ✓ import (merge) a backup · ✓ snapshots list includes the safety snapshot · ✓ restoring a snapshot that doesn’t exist is refused
- **Reminders** — ✓ a due reminder fires on the server, even with no page open
- **Phone** — ✓ phone auth status: not configured · ✓ create the authenticator key · ✓ a malformed code is rejected · ✓ a wrong code is rejected
- **Settings** — ✓ erase all data clears state (after a safety snapshot)
- **Coverage** — ✓ every API route is tested or listed as not testable (0 missing) · ✓ NOT_TESTABLE lists only routes that exist

## Live laptop checks

Not run. `npm run test:report -- --live` also sets volume/brightness and opens/closes Notepad on this laptop, restoring everything.

## Check by hand

These need your hardware, voice or phone — no automated test can prove them:

- [ ] **Microphone:** click 🎙, say “what time is it” — it answers.
- [ ] **Wake word:** turn on WAKE WORD, say “Jarvis, open notepad”.
- [ ] **Spoken replies:** Settings → Speak replies on; a reply is read aloud (try the FRIDAY voice too).
- [ ] **Telugu / Kannada:** switch to తె or ಕ and speak a command.
- [ ] **Windows Hello:** Settings → turn on Windows Hello; “shut down” asks for fingerprint/face/PIN (then cancel).
- [ ] **Phone:** Settings → Phone; a test notification arrives on ntfy, and an authenticator code unlocks a command.
- [ ] **Global hotkey:** select text in another app, press Ctrl+Shift+J — the JARVIS bar opens with it.
- [ ] **Screen reading:** open an error message, say “read my screen”.
- [ ] **AI answers:** with Ollama running, ask “explain deadlock” and “what does <your pdf> say about …”.

## Known limitations found while testing

- **Undo** reverses removals and changes (deleted/cleared to-dos, moved/renamed files, volume, brightness, dark mode), not additions — “undo” right after adding a to-do says there is nothing to undo.
- **Git with no project folder:** the git commands fall back to the JARVIS program folder itself. Add a project folder (Settings) before using git commands.
- **“Open the best page” / YouTube** search the web even when Online tools is off (they open the browser anyway).
- The **power, lock, display, clipboard, keyboard and window** routes are never called by the automated tests — they are exercised with fakes in the page; the Windows Hello guard only protects them once Hello is enrolled.
