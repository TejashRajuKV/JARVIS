<div align="center">

# J.A.R.V.I.S. — your own AI assistant, on your laptop

**Talk or type. JARVIS opens your apps, plans your study, reads your notes and PDFs, fixes your code and automates your day — running on your own computer, privately, for free.**

Voice & chat · English / తెలుగు / ಕನ್ನಡ · Local AI (Ollama) or your own API key · Windows

</div>

---

## Contents

1. [What is JARVIS?](#1-what-is-jarvis)
2. [Highlights](#2-highlights)
3. [Requirements](#3-requirements)
4. [Install & run](#4-install--run)
5. [First-time setup (choose an AI)](#5-first-time-setup-choose-an-ai)
6. [Using JARVIS — the interface](#6-using-jarvis--the-interface)
7. [Features](#7-features) — everything JARVIS can do, with examples
8. [Command cheat sheet](#8-command-cheat-sheet)
9. [Settings reference](#9-settings-reference)
10. [Privacy & security](#10-privacy--security)
11. [How it works (architecture)](#11-how-it-works-architecture)
12. [Project structure](#12-project-structure)
13. [Testing](#13-testing)
14. [Troubleshooting & FAQ](#14-troubleshooting--faq)
15. [Known limitations](#15-known-limitations)
16. [License](#16-license)

---

## 1. What is JARVIS?

JARVIS is a **voice and text AI assistant that runs on your own Windows laptop**, inspired by Tony Stark's J.A.R.V.I.S. It is a small Node.js server plus a web page you open in Chrome or Edge.

- A **fast rule engine** understands clear commands instantly ("open chrome", "set a timer for 10 minutes") — no AI needed, works offline.
- Anything casual, misspelled or open-ended goes to an **AI brain**: a free local model through **[Ollama](https://ollama.com)** (nothing leaves your laptop), or a cloud model with **your own API key** (OpenAI, Claude, Gemini, Groq, …).
- It can **act on your computer**: open any installed app, control volume/brightness/Wi-Fi/windows, read your screen, open and read files anywhere on the laptop (it asks before changing anything outside ~/jarvis), run code, start your dev servers, and hand tasks to coding AIs like Copilot or Claude Code.
- It is built for **students and developers**: study planner, flashcards, viva practice, DSA coach, answers from your own notes and PDFs, and a one-click "explain & fix" for crashing programs.
- **Safety first:** a server-side permission list decides what's allowed (never the AI), risky actions ask first, the most dangerous ones can require **Windows Hello**, and **"undo"** reverses almost everything.

There is also a **cinematic landing page** that introduces JARVIS: open `http://localhost:PORT/welcome` (or `/landing.html`) — PORT is the address JARVIS prints (3002 on the author's laptop) while JARVIS is running.

---

## 2. Highlights

| | |
|---|---|
| 🎙 **Voice & chat** | Hold the mic or say the wake word. English, Telugu, Kannada — even typed in English letters ("volume penchu"). Natural neural voices. Two personalities: **JARVIS** and **FRIDAY**. |
| 🧠 **Context & control** | A rolling summary carries the conversation forward — "what were we talking about?" picks the thread back up. **Ctrl+K** puts every command one keystroke away. Say **"panic"** to pause all automation, **"resume"** to continue. |
| 💻 **Controls your laptop** | Opens **any Start-menu app**, volume, brightness, dark mode, Bluetooth/Wi-Fi, power plans, window layouts, screenshots, clipboard tools, screen reading & vision. |
| 📚 **Study** | Tasks, deadlines, timetable, reminders, focus sessions, **multi-day study planner**, progress dashboard, flashcards with spaced repetition, **viva practice** by voice, contests and web research. **Attendance with a 75% bunk-o-meter**, marks → SGPA/CGPA. |
| 📄 **Your files & notes** | Drop in PDFs, notes, **.docx / .pptx / .xlsx** and ask questions — **hybrid keyword + semantic search**, answers with **page numbers**. Summaries and flashcards from any file. |
| 🛠 **Coding** | Write → save → run code, **EXPLAIN & FIX** crashes in one click, **DSA coach** (hints before solutions), **website generator**, "open VS Code in *folder* and tell Copilot to…", and **dev environments that recover from failures** (missing dependencies → install → restart → verify). |
| ⚡ **Automation** | Multi-step commands, **routines**, **triggers** ("when I plug in my charger…"), a **global hotkey** for any selected text, reminders that fire even with the tab closed. |
| 📱 **Phone** | Reminders on your phone (ntfy), and phone commands locked behind a 6-digit **authenticator code**. |
| 🔐 **Safe & private** | Local-only server, permission tiers, Windows Hello approvals, **undo**, encrypted backups, keys that never leave the laptop. |

---

## 3. Requirements

| Needed | Why |
|---|---|
| **Windows 10 or 11** | Most laptop controls (apps, volume, screen OCR, notifications, hotkey) use Windows features. The chat, study tools and AI also run elsewhere, but Windows is the supported platform. |
| **Node.js 18 or newer** | Runs the JARVIS server. The launcher offers to install it for you. (Developed and tested on Node 24.) |
| **Google Chrome or Microsoft Edge** | Voice input uses the browser's Web Speech API. Edge has the best built-in "JARVIS" voice. |
| **An AI brain** (pick one) | **Ollama** (free, private, offline) with a model such as `qwen3.5:4b`, **or** any API key (Gemini has a free tier), **or** a local OpenAI-compatible server (LM Studio). JARVIS still works for direct commands with no AI. |

Optional extras: **Python / Node / gcc & g++** (to run your code), **VS Code** and other editors or coding agents, **Windows Terminal**, the **ntfy** and **Google Authenticator** phone apps, **Tailscale** (full JARVIS page on your phone), **Windows Hello** (fingerprint/face/PIN approvals).

A laptop GPU helps the local model (e.g. an RTX 3050 6 GB runs `qwen3.5:4b` comfortably; bigger local models get slow — use a cloud key for those).

---

## 4. Install & run

### The easy way (no technical knowledge needed)

1. Put the `jarvis` folder anywhere on your PC (e.g. `D:\jarvis`).
2. Double-click **`Start JARVIS.bat`**. The first time it:
   - checks for Node.js and offers to install it if missing (then asks you to start it again),
   - installs JARVIS's parts (`npm install`, about a minute),
   - opens the JARVIS that is already running if there is one, otherwise finds a free port (3000–3010) and adds a **JARVIS shortcut to your desktop**,
   - starts JARVIS and opens it in your browser.
3. That's it. From the second time on, **double-click the JARVIS icon on your desktop** — it starts the server quietly in the background (no terminal window) and opens JARVIS when it's ready.

### Starting and stopping

| | |
|---|---|
| **Start** | Double-click the desktop **JARVIS** icon (or `Start JARVIS.bat`). No terminal window appears — the server runs hidden in the background and your browser opens automatically. |
| **Start from the page itself** | If you open JARVIS while the server is down, the page shows a **▶ START JARVIS** button — one click and Windows launches the server, then the page reconnects by itself. |
| **Stop** | Double-click **`Stop JARVIS.bat`**, or use **Settings → Data → Stop JARVIS** inside the app. |
| **Start automatically at every sign-in** | Settings → Data → **Start with Windows**. JARVIS then runs quietly in the background after every reboot, so the desktop icon (or the installed app) opens instantly. |
| **First-time setup** | The very first launch shows its progress in a window; every later launch is silent. |

If JARVIS is already running, double-clicking the icon simply opens it. JARVIS remembers its port, so the same address works every time.

**Only one JARVIS runs at a time.** However it is started (desktop icon, `npm start`, an AI tool, a VS Code terminal), a second start finds the running copy through `~/jarvis/.jarvis.lock`, prints its address and exits. So there is one chat, one phone (ntfy) connection and one wake-word listener, whatever launched it. Your address is the one JARVIS remembers (`~/jarvis/.jarvis-port`).

### The command-line way

```bash
npm install
npm start
```

Then open the address it prints (**http://localhost:3000** the first time; after that, the remembered one). If JARVIS is already running, `npm start` just tells you where. To choose the port on a first start (PowerShell):

```bash
$env:PORT=3002; npm start
```

> Open JARVIS through `http://localhost:PORT` — **not** by double-clicking `index.html`. The server only accepts requests from its own page.
>
> Running `npm start` in a terminal keeps the server tied to that window; close it and JARVIS stops. The desktop icon instead runs it in the background — that's what "Stop JARVIS" is for.

### Optional: local AI with Ollama

```bash
ollama pull qwen3.5:4b
```

Any Ollama chat model works — pick it in **Settings → Model**. The first reply after starting is slow (~1 minute) while Ollama loads the model; JARVIS warms it up in the background. `qwen3.5:4b` also understands images, which powers screen vision.

### Useful addresses

| Address | What |
|---|---|
| `http://localhost:PORT/` | The JARVIS app |
| `http://localhost:PORT/welcome` | The cinematic landing page |
| `http://localhost:PORT/?skipboot` | The app without the boot animation |

---

## 5. First-time setup (choose an AI)

On first run, JARVIS shows a **guided setup** (re-open it any time: **Settings → AI BRAIN → Guided setup → AI**):

- **Free online AI** — click the link, *Create API key* on Google's page, paste it. JARVIS checks the key and picks a good model.
- **Private, on this computer** — install Ollama; one button downloads the AI with a progress bar.
- **I already have an AI key** — paste it; JARVIS recognises the provider from the key itself (OpenAI, Claude, Gemini, Groq, OpenRouter, DeepSeek…) and picks a sensible model.

**Phone setup** (optional): **Settings → Guided setup → PHONE** walks you through installing ntfy, scanning a QR code to connect, adding the unlock code to Google Authenticator, and testing it. See [Phone](#phone--alerts-and-commands).

---

## 6. Using JARVIS — the interface

```
┌──────────────────────────────────────────────────────────────────┐
│ ☰  ◉ JARVIS   ● backend ● AI brain ● online      12:04   SETTINGS │
├──────────────┬───────────────────────────────────────────────────┤
│              │  CHAT · TASKS · MEMORY                            │
│    ◎  orb    │                                                   │
│              │   You: what's due this week?                      │
│   ◈ READY    │   JARVIS: 2 deadlines — OS lab (Fri) …   🔄       │
│  status line │                                                   │
│              │ ┌───────────────────────────────────────────────┐ │
│  ~ waveform  │ │ 🎤 📎  Ask anything or give a command…  SEND ▸ │ │
│              │ └───────────────────────────────────────────────┘ │
│              │  CODE WEB CONTROL STUDY …  [chip] [chip] [chip]   │
└──────────────┴───────────────────────────────────────────────────┘
```

- **Chat** (centre) — your conversation. Hover your message for **✕ delete** and **✏️ edit**; hover JARVIS's reply for **🔄 regenerate**. Code blocks have **COPY**.
- **Tasks** tab — progress dashboard (7-day focus chart, streak, study plan), to-dos, deadlines, reminders, timetable, routines, triggers.
- **Memory** tab — flashcard decks, code snippets, and what JARVIS remembers about you.
- **Orb** (left) — shows what JARVIS is doing (ready / listening / thinking / working / speaking).
- **☰** — the Systems panel: engines, CPU/RAM/disk, and the activity log.
- **Message box** — 🎤 hold-to-talk, 📎 attach a PDF or notes file (or drag files anywhere onto JARVIS), language switch **EN | తె | ಕ**, and **WAKE WORD** for hands-free.
- **Quick actions** — one row of suggestion chips by category, under the message box.
- **Ctrl+K palette** — every command, skill, attendance action and taught phrase in one fuzzy-searchable list; arrow keys + Enter to run, Esc to close.
- **⤓ INSTALL** pill (header) — appears when the browser can install JARVIS as an app: its own window, a Start-menu icon, and the page itself loads offline (installable web app).
- Works on phones and small screens (the layout stacks).

**Keyboard shortcuts:** `/` focus the message box · `Ctrl+K` command palette · hold `Space` to talk · `↑` previous command · `Esc` stop speaking / generating · `Ctrl+Shift+J` global hotkey (when enabled).

---

## 7. Features

### Conversation & personality

- JARVIS speaks like Tony Stark's JARVIS — calm, polite, dry British wit, calls you **sir** (or ma'am / boss / your name: **Settings → Address me as**).
- "Hi Jarvis, are you there?" → "At your service, sir." · "I'm home" → "Welcome home, sir." Actions are acknowledged ("Right away, sir. Launching Notepad.").
- **FRIDAY:** "switch to FRIDAY" / "switch to JARVIS" — different personality, voice and wake word.
- **Answers** stream in with Markdown and code blocks. **Answer length** is set in Settings, or ask "explain recursion in 2 lines".
- **Remembers you:** "my name is Tejas", "remember that my exam is on Friday", "what do you know about me?", "forget …".
- **Remembers the conversation:** a rolling summary carries earlier chat into new questions, so long sessions never lose the plot. "What were we talking about?" recalls the thread.
- **Edit / regenerate / delete:** ✏️, 🔄 and ✕ on messages; also "regenerate", "try again", "delete my last message".
- **Command learning:** when JARVIS guesses an unfamiliar phrase correctly, it offers to remember it, so next time it runs instantly. "What have you learned?" / "forget everything you've learned".
- **"Why did you do that?"** explains the last action from what actually happened, not a fresh guess.
- Voice persona lines live in `persona.js` — edit them to taste.

### Voice & languages

- **Hold the mic** (or `Space`) to talk, or turn on **WAKE WORD** and say "Jarvis …" hands-free. The wake word survives brief network blips (it retries before giving up, and tells you if it stops).
- **JARVIS lets you finish.** It keeps listening through pauses mid-sentence and answers once you've been quiet for a moment — "Jarvis, open VS Code … and start a focus session" runs both. Say just "Jarvis" and it waits for your command (and says "Yes, sir?" if you pause). Tap the mic again to send straight away. **Settings → Pause before I answer**: Short (1 s), Normal (1.6 s) or Long (2.5 s — handy if you think mid-sentence). Works the same in Telugu and Kannada, including the recogniser's different spellings of "జార్విస్ / ಜಾರ್ವಿಸ್".
- **Telugu & Kannada:** speak or type in తెలుగు / ಕನ್ನಡ, or say "switch to Telugu". Typing in English letters works too — "volume penchu", "5 nimishalu timer pettu", "timer cancel maadu", "recursion ante enti". Replies come back in your language.
- **Typos are fixed**: "set timr 5 min", "clse chrome", "cancle the timer" (real words are never "corrected" into commands).
- **Neural voices** for FRIDAY, Telugu and Kannada (Microsoft's neural voices, work in any browser). **Online translation** makes Telugu/Kannada answers as good as English ones. Both send the *reply text* online and can be turned off in Settings.

### Laptop control

- **Apps:** "open chrome", "fire up VS Code", "close it" — plus **anything in your Start menu** by name ("open canva", "open telegram", "open docker", "open mysql workbench"). Closing works for regular desktop apps; for Microsoft Store apps JARVIS won't guess which process to close and says so.
- **System:** "set volume to 30", "mute", "next song", "set brightness to 60", "dark mode", "is my Bluetooth on", "turn off wifi" (asks first), "switch to balanced power plan", "turn off the display", "lock the screen", "battery", "how's my system?", "top processes", "is port 3000 free?", "run diagnostics".
- **Windows:** "put VS Code on the left and Chrome on the right", "minimize everything except VS Code", "show desktop".
- **Screen:** "read my screen", "explain the error on my screen" (Windows OCR, local). **Screen vision** — "describe my screen", "explain the chart on my screen", "describe the image I copied" — the AI *sees* the screenshot (needs an image-capable model; the capture is kept in memory only, single use, ≤2 minutes).
- **Clipboard:** "paste my clipboard into notes.md", "format the JSON in my clipboard", "fix the code in my clipboard and copy it back", "count words in my clipboard", "summarise the link in my clipboard". **Clipboard history** is off by default ("start clipboard history", "copy the 2nd one"; memory only, never on disk).
- **Themes:** "gold theme", "violet theme", "red alert" / "stand down alert", "arc reactor blue theme" — each also does something real (brightness, dark mode, or red alert blocks distractions).

### Tasks, reminders & study

- **To-dos:** "add revise graphs to my list", "mark 2 done", "clear completed to-dos".
- **Reminders:** "remind me to submit the form at 5pm", "remember to call mom tomorrow evening", "remind me every weekday at 8am to review notes". Reminders are fired by the **server**, so they go off even if no JARVIS tab is open (a Windows notification, and your phone if Phone alerts are on).
- **Deadlines & timetable:** "add assignment OS lab due Friday", "what's due this week?", "add class DBMS on Monday and Wednesday at 10am", "when's my next class?". Deadline alerts 3 hours before.
- **Timers & focus:** "set a timer for 10 minutes", "start a focus session", "focus on DBMS for 25 minutes" (logged per subject), "block distractions" (closes Discord/Steam/WhatsApp/Spotify and starts a focus session), "how productive was I today?".
- **Plan my day:** "plan my day" builds a timetable for the rest of today with one-click reminders.
- **Study planner:** "plan my GATE prep, exam on 12 Feb, topics: OS, DBMS, CN" (add `:3` after a topic that needs 3× the time). Topics are spread over the days left, every 7th study day is a review day, and the plan ends with revision and a full mock test. **ADD REMINDERS** puts one at 8 am each day. "What should I study today?", **MARK TODAY DONE**.
- **Progress dashboard** (Tasks tab): 7-day focus chart, streak, time per subject, study-plan progress. "How was my week?" — and a weekly summary every Sunday evening.
- **Attendance:** "mark dbms present", "mark dbms absent yesterday", "attendance report" (with a per-subject bar in the Tasks tab), "can I bunk tomorrow?" (checks the 75% safety line using tomorrow's timetable), "how many classes to reach 80%?".
- **Marks & CGPA:** "add s3: 8.6 gpa, 24 credits", "what is my cgpa?", "what gpa do I need for an 8.5 cgpa?". Semesters, credits and grades stay on this PC.
- **Flashcards:** "make flashcards on normalization", "make flashcards from os-notes.md", "review my flashcards" (spaced repetition), "quiz me on DBMS".
- **Viva / interview practice:** "take my DBMS viva", "viva on operating systems", "mock interview for SDE placement". Five spoken questions (easy → hard); after each answer a score out of 10, what you missed and a model answer. "repeat", "skip", "stop viva". At the end: your average, what to revise, and **MAKE FLASHCARDS** from the hard ones.
- **Contests & research:** "upcoming contests", "any codeforces contest this week", "remind me about the next LeetCode contest", "search the web for SIH 2026 themes", "upcoming hackathons" (answers with [1][2] sources; needs **Online tools**).
- **Guided templates:** "design a prompt for a landing page for my project" (TCREI prompt for v0/ChatGPT/Cursor), "write a commit message", "write a bug report", "write a resume bullet", "write my standup update", "generate interview prep for X", "draft a linkedin post about X", "create a study plan for my X exam", "log my weekly reflection". Say "skip" for optional questions, "cancel" to stop.

### Your notes, files & PDFs

- **Files.** JARVIS's own workspace is `~/jarvis` (Notes, Code, Documents, Projects). It can **open and read files and folders anywhere on the laptop** — "open the agriloop folder in vs code", "read notes.txt" — searching Desktop, Documents, Downloads, your home folder and your other drives by name. If a name matches several places it lists them (**OPEN 1 / OPEN 2**). **Changing** anything outside `~/jarvis` (write, rename, move, copy into, delete) shows an **ALLOW / CANCEL** card first; from the phone or a routine it is refused. Windows, Program Files, AppData and key folders are never touched. Examples: "take a note: revise recursion", "read my notes", "list my files", "create a folder called DSA", "rename a.md to b.md", "copy notes.md to Projects", "delete old.txt" (goes to `~/jarvis/.trash`).
- **Drop in PDFs and notes:** drag files onto JARVIS or click **📎**. They're saved to `~/jarvis/Documents`.
- **Ask your files:** "what did my OS notes say about deadlocks?", "what does lecture3.pdf say about paging?", "search my notes for normalization", "according to my notes, what is a semaphore?". Answers come from your files with a **Sources** list (file + page number or lines). A name with spaces needs quotes: `what does "10. Numpy.pdf" say about arrays`.
- **Summarise / flashcards / read / open:** "summarise lecture3.pdf", "make flashcards from lecture3.pdf", "read lecture3.pdf" (shows the text), "open lecture3.pdf" (opens your PDF viewer).
- The search is a local **hybrid index** over text, code, PDF **and Office files (.docx/.pptx/.xlsx)** (skips `node_modules`, hidden folders, the trash and JARVIS's own data). PDF text is extracted locally with Mozilla's pdf.js; Office files are unzipped and read directly. Scanned PDFs (pictures of pages) can't be read as text — JARVIS says so. Up to 40 MB / 400 pages for PDFs, 30 MB for Office files.
- **Search is hybrid:** keyword ranking fused with optional **semantic search** — turn it on in Settings and "no internet at my place" also finds "wifi problem" notes. Needs a small Ollama embedding model (`ollama pull nomic-embed-text`); without it the keyword index alone still works. New and changed files are picked up automatically.

### Coding

- **Write → save → run:** "write fizzbuzz in python and save it as fizz.py and run it", "save that code as bfs.py", "run it", "run sort.cpp with input 5 3 1", "open it in VS Code", "paste that code into my editor" (3-second countdown, then Ctrl+V). Runs `.py`, `.js`, `.c`, `.cpp` with a 10-second limit, in `~/jarvis` and your project folders.
- **🛠 EXPLAIN & FIX:** when a run fails, JARVIS explains the error in plain English (what, which line, why) and shows the fixed file. **APPLY FIX & RUN** saves and re-runs it; **"undo"** gets your original back.
- **DSA coach:** "coach me on two sum", "help me with leetcode 15 3sum", "I'm stuck on longest palindromic substring". Hints first ("next hint" — they build on each other, never code), "my approach is …" gets checked without spoilers, "show solution in C++", "save it" (to your `dsa_sprint` folder or `~/jarvis/Code`), "stop coaching".
- **Website generator:** "create a website for my college fest", "build me a landing page for my startup", "make a portfolio website". Three quick questions, then a complete one-file page in `~/jarvis/Projects/<name>/` opens in your browser (≈1–3 min with a local model). Change it by talking: "make the header bigger", "add a contact section" — "undo" goes back. Pages load no outside scripts and forms never send data anywhere.
- **Ask a coding AI in a folder:** "open vs code in dsa_sprint and tell copilot to write binary search in main.py", "ask claude in dsa_sprint to list the files", "in dsa_sprint, ask kiro to fix the bug". Free-form wording works. Just opening a folder in VS Code ("open agriloop in vs code") works anywhere; if a coding AI has to work in a folder that isn't one of your project folders yet (e.g. on your Desktop), JARVIS finds it and asks **ALLOW & CONTINUE**.

  | Tool | How your request is delivered |
  |---|---|
  | VS Code (Copilot), Kiro, Trae, Antigravity IDE | Opens the folder and sends the prompt straight into the editor's AI chat. |
  | Devin (Windsurf) | Opens the folder and pastes the prompt into its AI panel. |
  | OpenCode (desktop) | Opens OpenCode with the request copied — click its chat box, **Ctrl+V**, Enter. |
  | Claude Code, Codex, Gemini, Qwen, Codebuff | Opens a Windows Terminal tab at the folder with the agent already working on your prompt. |

- **Dev projects:** "prepare my development environment for AgriLoop" (locate, open in VS Code, start backend + frontend, open the browser — previewed first), "start the AgriLoop backend", "stop the AgriLoop frontend". Commands come only from the project's own `package.json` scripts or known entry files — never invented. Ports are read from the server's own output.
  - **Knows what's already running:** the preview says "backend already running on port 5000 → keep" or "VS Code is already open → reuse it", and a server JARVIS already started is kept — no second copy, no permission prompt.
  - **Verifies the server:** a started backend/frontend counts as ✓ only if it is still alive *and* answers on its port; one that dies right after starting is a failure, one that hasn't answered yet shows ○ *not checked*.
  - **Recovers from failures:** plan → run → fail → understand → propose → ask → retry → verify. If a server crashes because its dependencies aren't installed (no `node_modules`, "Cannot find module 'express'", "'vite' is not recognized", Python's "No module named flask"), JARVIS explains the cause, asks once, runs the project's **own** install command (`npm install` or `pip install -r requirements.txt`), restarts the server and checks it answers. If the port is held by a leftover copy JARVIS started earlier, it offers to close that and restart. One attempt each — a second failure is diagnosed and reported, never retried in a loop. A missing *relative* file (`./routes/x`) is treated as a code bug, not a dependency.
  - **Explains other crashes in one line** instead of a bare ✗: database not reachable ("is MongoDB running?"), a missing `.env` setting, a syntax error, permission denied, no start script — anything else gets a one-sentence likely cause from the AI (shown, never acted on).
- **Learn / create:** "I want to learn Python" (checks the toolchain, creates a real Hello-World, runs it, opens VS Code), "create a C++ project called SmartCalc that adds two numbers, compile it and run it" (real code, shown first, with bounded self-repair on failure). JARVIS never installs software (compilers, runtimes, extensions) itself — the only thing it installs is a project's own dependencies, and only after you approve.
- **Snippets & git:** "save that code as snippet dfs", "copy snippet dfs", "git status", "clone https://github.com/user/repo", "write a commit message".
- **CS tools:** "255 to binary", "0x1F in decimal", "1.5 GB to MB", "12 xor 7", "sqrt 144", "15% of 240", "time complexity of merge sort".

### Web & everyday

- "play lofi on youtube", "search GFG for heap sort", "open amazon.com", "open GATE 2027 CSE syllabus" (unknown names open the best matching page), "weather in Bengaluru", "who invented Linux?", "100 F to C", "5 km in miles".
- **Distance & directions:** "distance from Hyderabad to Bangalore", "directions from X to Y" (turn-by-turn in the chat), "open directions to X in maps". Uses OpenStreetMap services; needs **Online tools**.
- **Drafts:** "write a leave email to my professor and copy it".

### Multi-step commands (the agent)

"open VS Code, create a folder DSA and start a 25 minute focus", "set volume to 30 and tell me a joke".

- Commands JARVIS already knows run in order instantly; unknown parts are planned by the AI, **validated by the server**, and shown as a preview ("No changes have been made yet — EXECUTE / CANCEL").
- Each step is **checked for real** (the to-do exists, the app started, the volume reads back) — steps that can't be checked show ○ *not checked* rather than a fake ✓.
- **Say the goal, not just the commands:** "I'm going to study. Set the volume to 30, enable focus mode, close distracting apps, open my DBMS notes and start a 45-minute session." JARVIS takes "study" as the plan's goal, merges overlapping steps (one 45-minute session, not two), closes distractions *before* the session starts, and shows the whole plan once — with ⚠ on anything that needs permission — so **one EXECUTE** approves it.
- Steps that depend on an earlier one ("create a folder DSA and open it in VS Code") are skipped if that earlier step fails, instead of running on a broken result. The run ends with a tally: "4 of 4 verified".
- **When JARVIS doesn't understand:** a request no rule matches goes to the AI planner (its guess is shown before anything runs), and questions or remarks that merely mention a setting ("what is volume in physics?") are never treated as commands. Say **"no, that's wrong"** right after a mistake, or **"what didn't you understand?"** to see recent misses — **TEACH** maps a phrase to a command you type ("lecture time" → "mute and block distractions"), which then runs through the normal checks every time.
- **When a plan fails part-way**, its card offers the honest ways out: **RETRY** (only what didn't complete — what already worked isn't repeated), **CONTINUE** (only the remaining steps that don't depend on the failed one, directly or indirectly) and **ROLLBACK (n)** (reverses the *n* changes this plan made that can be reversed, newest first — see [Undo](#undo-backup--your-data)). This is transaction-*like*, not a full transaction: things that can't be undone (a sent message, an opened editor) are listed, not pretended away.
- Long plans can be **cancelled** and then **resumed**. Every run has an id (e.g. `AGT-20260928-004`); ask "what did you just do?". **"Inspect the last run"** (or the **INSPECT** button under a plan, or "inspect AGT-20260928-004") opens an **execution inspector** card: goal, route and planner time, how many tools were valid, permissions asked and answered, every step with its timing and verification note, how many actions can be undone, total time and a final status (COMPLETED / PARTIAL / FAILED / CANCELLED). It is built only from what was recorded when the plan ran.

### Automation

- **Routines:** built-in "study mode", "morning", "bedtime", "leaving". Make your own: "create a routine called exam prep: open VS Code, open LeetCode, start a 45 minute focus session". Schedule: "run my morning routine every day at 7am".
- **Triggers:** "when I plug in my charger, start study mode", "when I open VS Code, block distractions", "when the battery drops below 20%, run leaving", "when I connect to Wi-Fi HomeNet, start study mode". Fire on a change, at most once per 10 minutes; manage with "list my triggers", "delete trigger 2" or the Tasks tab.
- **Panic mode:** say **"panic"** (or "stop everything") — deadline alerts, the weekly digest, reminder alerts and triggers all pause until you say **"resume"**, and a ⚠ PANIC pill glows in the header. Alerts that fire while paused are remembered, not lost.
- Routines and triggers run **unattended**, so only steps that need no permission run (never shutdown, delete, closing apps, …).
- **Global hotkey (Ctrl+Shift+J):** turn it on in Settings, select text in *any* app and press the hotkey — **Explain / Summarise / Rewrite / Translate / Fix code** or ask your own question. Your previous clipboard text is restored.
- **Smart alerts:** low battery, very high RAM, deadline within 3 hours, leftover to-dos at 9 pm.

### Phone — alerts and commands

- **Phone alerts:** Settings → **Phone alerts** pushes reminders and deadline alerts to the free **ntfy** app on your phone. Messages to ntfy go out one at a time, an identical reply is sent only once within 30 seconds, and after a "too many requests" answer from ntfy.sh JARVIS pauses instead of retrying, so the phone app stays responsive.
- **Phone commands:** send commands from ntfy — they only run after you **unlock with the 6-digit code** from Google Authenticator (just send the digits, e.g. `482913`). Unlocked for 15 minutes; send `lock` to lock. Each code works once; 5 wrong codes pause unlocking for 10 minutes.
- Works from the phone: open apps, volume, media, to-dos, reminders, focus, routines, questions, asking a coding AI. **Never from the phone:** shutdown/restart/sleep/delete, any change to files outside `~/jarvis`, and anything that would send your screen, clipboard or files over ntfy.
- If a code is refused: **Settings → Phone alerts → Check** tells you whether the code is right, from an old key, or if a clock is off.
- **Full JARVIS page on your phone:** via **Tailscale** (private network of your own devices) — see **Settings → Phone access** for the steps.

### Undo, backup & your data

- **Undo:** say **"undo"** (or click **↶ Undo**, shown for 30 seconds) — deleted to-dos/deadlines/reminders/snippets/flashcards/memories/routines/triggers, a cleared chat, deleted or clear-sandbox files (from the trash), rename/move/copy/new/overwritten files, volume/mute/brightness/dark mode, opened/closed apps (including the distracting apps a study plan closed), a focus session you started, website changes, applied code fixes. The last 40 actions within 30 minutes. **"Undo that task"** (or "undo the whole plan", "undo AGT-…") reverses every reversible step of the last multi-step plan at once, newest first, and tells you what it undid, what could not be undone, and which steps had nothing to reverse (an opened editor stays open). A dev server JARVIS started is stopped again; one that was already running is left alone. The **ROLLBACK** button on a failed plan does the same. Not undoable: shutdown/restart/sleep, sent messages, git commits, prompts sent to coding AIs.
- **Backup & restore:** **Settings → Backup & restore → EXPORT** saves chat, to-dos, flashcards, routines, study plans, triggers, settings and your project-folder list to one `.jarvis-backup` file ("back up my data" works too). API keys and the phone unlock key are included only if you choose, sealed with a password (AES-256). **IMPORT…** → **Merge** or **Replace**. JARVIS also keeps a **daily snapshot** for a week and one before every erase / import / restore.
- **One shared copy:** your data is saved on the PC (`~/jarvis/.jarvis-state.json`), so every browser and port shows the same chat, tasks and settings. Open in several tabs, a chat message typed in one appears in the others.

---

## 8. Command cheat sheet

| I want to… | Say / type |
|---|---|
| Open or close an app | `open spotify` · `close chrome` · `open canva` |
| Control the laptop | `volume 40` · `mute` · `brightness 60` · `dark mode` · `lock the screen` |
| Reminders & tasks | `remind me to call mom at 6pm` · `add revise graphs to my list` · `what's due this week?` |
| Focus | `start a focus session` · `focus on DBMS for 25 minutes` · `block distractions` |
| Plan study | `plan my day` · `plan my GATE prep, exam on 12 Feb, topics: OS, DBMS, CN` · `what should I study today?` |
| Track attendance & marks | `mark dbms present` · `attendance report` · `can i bunk tomorrow?` · `add s3: 8.6 gpa, 24 credits` · `what is my cgpa?` |
| Practise | `take my DBMS viva` · `quiz me on DBMS` · `coach me on two sum` |
| Ask my files | `what do my notes say about paging?` · `what does lecture3.pdf say about 3NF?` |
| Code | `write fizzbuzz in python and save it as fizz.py and run it` · `run main.py` → 🛠 EXPLAIN & FIX |
| Coding AI | `open vs code in dsa_sprint and tell copilot to add tests` · `ask claude in dsa_sprint to explain the code` |
| Build a website | `create a website for my college fest` → `make the header bigger` |
| Automate | `when I plug in my charger, start study mode` · `run my morning routine every day at 7am` |
| Panic & resume | `panic` · `resume` · `what were we talking about?` · `Ctrl+K` command palette |
| Screen | `read my screen` · `explain the error on my screen` · `describe my screen` |
| Web | `play lofi on youtube` · `weather in Hyderabad` · `upcoming contests` |
| Fix mistakes | `undo` · `undo that task` (a whole multi-step plan) · `delete my last message` · `regenerate` |
| See what a plan did | `what did you just do` · `inspect the last run` · `inspect AGT-…` · `why did you do that` |
| Help | `what can you do?` · `why did you do that?` · `run diagnostics` |

---

## 9. Settings reference

Open **SETTINGS** (top right).

| Section | Setting | What it does |
|---|---|---|
| **AI brain** | Use AI brain · Model | Turn the AI on/off; pick a local (Ollama) or cloud model. |
| | Guided setup (AI / PHONE) | Step-by-step setup for non-technical users. |
| | AI providers | Add an API key (auto-detected provider), TEST it, or remove it. **Custom** accepts any OpenAI-compatible URL (LM Studio, vLLM, llama.cpp). |
| **Voice** | Speak replies · Assistant (JARVIS/FRIDAY) · Speech language · Reply language | How JARVIS listens and answers. |
| | Online translation · Neural voice | Better Telugu/Kannada answers and natural voices (send reply text online). |
| | Voice check · Address me as · Voice · Speech rate · Interface sounds · Wake word | Voice details and your wake word. |
| **Behaviour** | HUD theme · Answer length | Arc blue, gold, crimson, violet; concise/balanced/detailed. |
| | Online tools · Home city | Weather, web answers, contests, directions (off by default). |
| | Smart alerts · Global hotkey | Battery/RAM/deadline alerts; Ctrl+Shift+J. |
| | Phone alerts · Phone access | ntfy alerts & commands (+ authenticator); Tailscale access. |
| | Focus / break (min) | Pomodoro lengths. |
| | Semantic search · Embedding model | Meaning-based file search ("wifi problem" finds "no internet"); needs an Ollama embed model such as `nomic-embed-text`. |
| **Backup & restore** | Export · Import · Include my API keys · snapshots | See [Undo, backup & your data](#undo-backup--your-data). |
| **Project folders** | Add/remove folders | Used for preparing environments, starting backends and frontends, git, and searching your notes. JARVIS can open files anywhere without adding them here. |
| **Data** | Require Windows Hello | Fingerprint/face/PIN for shutdown, restart, sleep, deleting files, clearing the sandbox, erasing data and importing backups. |
| | Erase all local data | Clears the shared data (a snapshot is taken first). |
| | Start with Windows · Stop JARVIS | Run JARVIS in the background at every sign-in; end the background server. |
| | Updates · Check | Compares your version with the latest GitHub release — only when you click, and only if Online tools is on. |

---

## 10. Privacy & security

- **Local only.** The server listens on `127.0.0.1` and refuses requests from other websites (Host/Origin checks, and `Sec-Fetch-Site` for sensitive reads). Nothing on your network can reach it.
- **Offline option.** With a local Ollama model, your chats, files, screenshots and clipboard never leave the laptop. With a **cloud model**, what you ask (and any screenshot, clipboard text or file excerpt you ask about) goes to that provider — Settings says so while one is selected.
- **Online extras are opt-in:** web tools, translation and neural voices say what they send and can be switched off.
- **The update check is click-to-run** (Settings → Data → Updates): GitHub is asked only then, and only while Online tools is on.
- **The server decides what's allowed, never the AI.** Every tool has an argument schema and a permission tier: *safe* (runs), *confirm* (asks first with the reason), *explicit* (its own confirmation every time, never in routines), or refused. Invented tools, `../` paths, "volume 999", shell commands — rejected before anything runs.
- **Windows Hello approvals** (optional): the server itself verifies a fresh signed challenge from your fingerprint/face/PIN before shutdown, restart, sleep, deleting files, clearing the sandbox, erasing data or importing a backup.
- **Three access zones for files.** *Home* (`~/jarvis`): free to use. *Laptop* (everywhere else): JARVIS can open and read, but **any change asks ALLOW / CANCEL first**, and phone commands or unattended routines can never approve one. *Blocked*: Windows, Program Files, ProgramData, your whole AppData, key folders (`.ssh`, `.aws`, …), the Recycle Bin, JARVIS's own config and its program folder — refused even if you click ALLOW. Deletes go to `~/jarvis/.trash` (also across drives) and JARVIS keeps the previous version of anything it overwrites, so "undo" works.
- **No shell injection:** apps open by exact Windows IDs, prompts to coding agents are passed as data (stdin or an encoded literal), never as shell text.
- **Secrets stay put:** API keys and the phone key live in `~/jarvis/.config.json`, are shown only masked, can't be read through JARVIS's own file tools, and are included in backups only when you choose (encrypted with your password).
- **Phone commands** need a fresh one-time authenticator code; dangerous and data-leaking commands are refused from the phone.

**Where your data lives** (all in your user folder):

| Path | Contents |
|---|---|
| `~/jarvis/.jarvis-state.json` | Chat, memory, tasks, reminders, flashcards, routines, triggers, settings |
| `~/jarvis/.config.json` | Project folders, API keys, phone key, Windows Hello public key |
| `~/jarvis/.jarvis.lock`, `.jarvis.pid`, `.jarvis-port` | Which JARVIS is running (pid and port); keeps it to one copy and lets Stop JARVIS find it |
| `~/jarvis/.backups/` | Automatic snapshots |
| `~/jarvis/.trash/` | Deleted files (restorable) |
| `~/jarvis/Notes`, `Code`, `Documents`, `Projects` | Your files |

---

## 11. How it works (architecture)

```
 Browser page (index.html + script.js)                 Node.js server (server.js, 127.0.0.1)
 ─────────────────────────────────────                 ─────────────────────────────────────
 mic / text ─► normalize & classify (nlu.js)            /api/tool/*     validated tools (apps, files, system…)
             ├─ known command ─► run tool ───────────►  /api/chat       ─► llm.js ─► Ollama or cloud provider
             ├─ several commands ─► agent.js plan ───►  /api/agent/*    permission tiers & plan validation
             └─ question / unclear ─► AI (streamed) ─►  scheduler.js    reminders, triggers, phone (ntfy), SSE
 skills (viva, coach, website), wizard, undo ◄────────  rag.js · skills.js · codetools.js · backup.js · hello.js
```

1. **Normalize** — strip the wake word and filler, fix typos, turn number words into numbers.
2. **Classify** — a rule engine with ~95 intent families and fuzzy app/site matching; follow-ups use context ("close it", "and firefox too").
3. **Route** — single commands run instantly; multi-step requests go through the agent; questions and unclear input go to the AI, which may answer or pick a tool (the server validates it first).
4. **Act & verify** — tools run on the server; results are checked for real where possible.
5. **Speak** — the reply is shown (Markdown), spoken, and translated if needed.

---

## 12. Project structure

| File | Role |
|---|---|
| `Start JARVIS.bat`, `start.ps1` | One-click launcher: Node check, first-time install, free port, desktop shortcut, opens the browser. `-Silent` (used by the desktop icon) runs the server hidden in the background with no terminal window |
| `jarvis-silent.vbs` | The no-window entry point the desktop/Startup shortcuts point to |
| `Stop JARVIS.bat`, `stop.ps1` | Ends the background server (the pid in the lock file; the fallback only stops a Node process running JARVIS's `server.js`) |
| `instance.js` | One JARVIS per user: the lock file, stale-lock replacement, the remembered port |
| `AGENTS.md` | Notes for AI coding tools: JARVIS lives at one address; never start a second copy |
| `server.js` | Express server: security checks, file access zones and approvals, apps, system tools, run code, dev servers (start/stop, health probe, dependency install), web lookups, state storage, module wiring |
| `llm.js` | AI layer: Ollama, OpenAI-compatible and Anthropic providers, streaming, retries, provider keys & routes |
| `agent-tools.js` | Tool registry: argument schemas, permission tiers, refusals, AI planner |
| `scheduler.js` | Server-side reminders & deadline alerts, triggers watcher, ntfy phone alerts/commands, live events to tabs |
| `system-tools.js` | Windows controls: brightness, theme, volume, Wi-Fi/Bluetooth, windows, screen OCR & vision, clipboard history |
| `codetools.js` | "Ask a coding AI in a folder": editor chats, terminal agents, desktop apps |
| `rag.js`, `pdftext.js`, `doctext.js` | Local hybrid search over your notes/code/PDFs/Office files; PDF & Office text extraction |
| `update.js` | Update check against GitHub Releases (click-to-run) |
| `skills.js`, `skills-page.js` | Website generator, DSA coach, viva practice, code fixer (server + chat side) |
| `backup.js` | Export/import, encryption of secrets, snapshots |
| `hello.js` | Windows Hello (WebAuthn) approvals |
| `autostart.js` | "Start with Windows": creates/removes the Startup link |
| `phoneauth.js` | Authenticator codes (TOTP) for phone commands |
| `hotkey.js` | Global Ctrl+Shift+J helper |
| `palette.js` | Ctrl+K command palette |
| `manifest.webmanifest`, `sw.js` | PWA install: own window, Start-menu icon, offline app shell |
| `tts.js` | Neural voices |
| `voice.js` | Utterance collector: waits until you have finished speaking before sending your sentence |
| `wakeword.js` | Background Windows listener for the wake word, so "Jarvis" works while you are in another tab |
| `index.html` | The page |
| `script.js` | Turn pipeline, UI, tasks, reminders, focus, files, streaming, settings |
| `nlu.js` | Normalization, intent rules, fuzzy matching, dates/times, coding-AI phrase parser |
| `agent.js` | Multi-step router, plans, state-aware previews, confirmations, verification, failure recovery (diagnose → fix → retry → verify), RETRY / CONTINUE / ROLLBACK, guided templates, command learning |
| `routines.js`, `triggers.js`, `study.js`, `undo.js`, `wizard.js`, `lang.js`, `persona.js` | Routines, trigger logic, study & attendance maths, undo stack, guided setup, languages, personality lines |
| `style.css`, `themes.css`, `ui.css` | Look & feel (`ui.css` is the current clean-HUD layout) |
| `landing.html` | Cinematic landing page (`/welcome`) |
| `vendor/qrcode.js` | QR codes for the phone setup (MIT) |
| `docs/` | Two standalone pages about the project: `jarvis-study-guide.html` (a reading guide: architecture, where data is stored, security, questions to expect) and `jarvis-lesson.html` (a slide deck) |
| `tests/` | Test suites (`npm test`) |
| `_backup_original/` | An older version, kept for reference |

---

## 13. Testing

Run everything (never touches your laptop or your data — the server-backed suites run an isolated copy of JARVIS in a temp folder):

```bash
npm test
```

A suite that can’t run on this machine (the browser suite without Edge/Chrome) is listed as **NOT RUN**, not as passed. Set `JARVIS_REQUIRE_ALL=1` to make that a failure (e.g. before a release).

Which features work, as a report (`tests/report.md`: one row per command, plus a checklist for what only you can check — mic, voice, Windows Hello, phone):

```bash
npm run test:report
```

Opt-in checks on the real laptop — sets volume and brightness and opens/closes Notepad, restoring everything (skipped when Notepad is already open):

```bash
npm run test:live
```

30 suites check every feature, not just the phrases:

| Suite | Checks | What it covers |
|---|---|---|
| `coverage.test.js` | 373 | Every command JARVIS has (178) is understood from its test phrases; fails if a new command has none |
| `api.test.js` | 185 | Every server route (138) on a real, isolated server: files and access zones, projects (including recognising a crash on missing dependencies vs. a code bug, and whether a started server really answers on its port), weather parsing against a fake wttr.in, git, backup, reminders firing, phone codes, security; routes that would act on the laptop are listed with the reason instead |
| `e2e.test.js` | 271 | The real page in headless Edge/Chrome: ~40 end-to-end flows (to-dos, reminders, focus, weather replies and their web-search fallback, attendance, marks, routines, triggers, multi-step plans…) plus every command run through the chat, with laptop actions faked. Without Edge/Chrome or on Node < 22 it is shown as **NOT RUN** (never as ✓) |
| `live.test.js` | 11 | Opt-in (`npm run test:live`) reversible checks on the real laptop |
| `nlu.test.js` | 266 | Understanding commands (intents, typos, dates, languages) |
| `agent.test.js` | 72 + 132 | Multi-step routing and safety (validator, refusals), the execution inspector card, undo tagging of plan runs |
| `llm.test.js` | 66 | AI providers, streaming, retries, key handling (with a fake server) |
| `student.test.js` | 60 | Attendance & bunk maths, marks → SGPA/CGPA, monthly/yearly repeats |
| `codeask.test.js` | 58 | Coding-AI phrases, safe command building |
| `skills-page.test.js` | 50 | Website / coach / viva conversations |
| `backup.test.js` | 44 | Export/import, encryption, hostile files, snapshots |
| `skills.test.js` | 38 | Page generation safety, coach, viva grading, code fixer |
| `hello.test.js` | 31 | Windows Hello verification and guarded routes |
| `triggers.test.js` | 31 | Trigger parsing, edges, cooldowns |
| `rag.test.js` | 28 | File search with page numbers, hybrid + semantic fusion, .docx/.pptx/.xlsx |
| `doctext.test.js` | 26 | Office file text extraction (zero dependencies) |
| `plan.test.js` | 53 | Goal sentences → merged, ordered, permission-previewed, verified plans; state-aware steps (a running server is kept); dev-project dependencies; failure recovery (missing dependencies → ask → install → restart → verify, declined, second failure diagnosed); RETRY / CONTINUE / ROLLBACK; teaching phrases |
| `paraphrase.test.js` | 259 + 7 | The same requests said many ways (casual, Indian-English, no verb): correct / handed to the AI / **confidently wrong** (must stay 0); statements and questions must not trigger commands |
| `study.test.js` | 25 | Study planner and progress maths |
| `scheduler.test.js` | 21 | Server reminders, monthly/yearly repeats, panic gating |
| `palette.test.js` | 20 | Command palette fuzzy search |
| `apps.test.js` | 17 | Installed-app matching |
| `phoneauth.test.js` | 15 | Authenticator codes (RFC 6238 vectors) |
| `undo.test.js` | 24 | Undo stack, including reversing a whole plan run newest-first |
| `update.test.js` | 14 | Update-check version comparison |
| `hotkey.test.js` | 12 | Hotkey helper protocol |
| `instance.test.js` | 16 | One JARVIS per user (second start reuses it, stale locks), chat sync between tabs, ntfy rate-limit safety |
| `voice.test.js` | 22 | Waiting for the end of a sentence, Telugu/Kannada collection |
| `wakeword.test.js` | 19 | Background wake-word listener protocol |
| `websearch.test.js` | 11 | "Open X website" picks the right result (not a look-alike) |
| `autostart.test.js` | 15 | Start with Windows |

`node tests/agent-eval.js` additionally measures the AI planner live against Ollama.

---

## 14. Troubleshooting & FAQ

**The page says "Backend offline".** Start JARVIS (`Start JARVIS.bat` or `npm start`) and open `http://localhost:PORT` — not the `index.html` file.

**Port 3000 is busy.** The launcher picks a free port automatically and remembers it (`~/jarvis/.jarvis-port`); with npm use `$env:PORT=3002; npm start` the first time.

**Different chats on different ports, or the phone (ntfy) app stops responding.** That means more than one JARVIS was running. Since the single-instance lock this can no longer happen from a normal start: starting JARVIS again (desktop icon, `npm start`, an AI tool, VS Code) just reuses the running one. If you ever see two, use **Stop JARVIS** (it stops the copy recorded in `~/jarvis/.jarvis.lock`) and start once. `JARVIS_ALLOW_MULTI=1` turns the guard off; only tests use it.

**"AI brain offline" / no answers to questions.** Start the Ollama app (or add an API key via Settings → Guided setup → AI). The first local reply takes about a minute while the model loads.

**Answers are slow or weak.** Small local models are limited on laptop GPUs. Add a cloud key (Gemini and Groq have free tiers) and pick it under **Model**.

**The mic doesn't work.** Use Chrome or Edge, allow microphone access, and keep an internet connection (browser speech recognition is online). **Settings → Voice check** shows what your browser supports.

**No voice / robotic voice.** Use Edge for the best built-in voice, or turn on **Neural voice**.

**My phone unlock code is "wrong".** Use **Settings → Phone alerts → Check** on the laptop. If it says "different key", delete every "JARVIS" entry in Google Authenticator and scan the QR again (Guided setup → PHONE → step 3). JARVIS must be running.

**Phone commands say "JARVIS isn't open".** Commands run in the page — keep a JARVIS tab open on the laptop. (Questions work without it.)

**Windows Hello stopped working after I changed my PIN/fingerprint.** Stop JARVIS, delete the `"hello"` entry from `~/jarvis/.config.json`, start again.

**"I can't find the folder".** JARVIS searches Desktop, Documents, Downloads, your home folder and other drives by name, so check the spelling first. If a coding AI must work in that folder, add it in **Settings → Project folders** or answer **ALLOW & CONTINUE**.

**A PDF "is a scan".** It contains pictures of pages, not text. Open it and use "read my screen" instead.

**Answers miss my new file.** JARVIS picks up new and changed files automatically (a 30-second scan plus a live file watcher). For a wholesale rename or move, say "reindex my files".

**Attendance percentages look off.** They come only from what you told JARVIS ("mark dbms absent"). "Attendance report" lists every entry, and "undo" takes back the last one.

**OpenCode only opened.** OpenCode's desktop app can't receive prompts from other programs — click its chat box and press Ctrl+V (JARVIS copied your request).

**Old look after an update.** Press **Ctrl+F5** once.

**Reset everything.** Settings → **Erase all local data** (a snapshot is kept in `~/jarvis/.backups`).

**How do I stop JARVIS?** Double-click **`Stop JARVIS.bat`** in the folder, or **Settings → Data → Stop JARVIS**. Start again with the desktop icon.

**The installed app (or browser tab) says "Backend offline".** JARVIS's server isn't running yet — press the **▶ START JARVIS** button on that page (accept the "Open JARVIS?" prompt Windows shows once), or double-click the desktop **JARVIS** icon. The page reconnects by itself the moment the server answers. Turn on **Settings → Data → Start with Windows** so this never happens after a reboot.

**A blue terminal window flashes when I start JARVIS.** Make sure the desktop shortcut points at `jarvis-silent.vbs` (JARVIS re-points it automatically the next time you start it once via `Start JARVIS.bat`).

---

## 15. Known limitations

- Windows-first: many laptop controls, notifications and the hotkey are Windows-only.
- Browser speech recognition needs the internet; everything else can run offline with a local model.
- Routines, scheduled routines and phone *commands* need a JARVIS tab open (reminders don't).
- Small local models occasionally misread instructions or answer briefly; cloud models are stronger.
- Scanned PDFs, password-protected PDFs and images aren't text-searchable. (.docx/.pptx/.xlsx are read directly.)
- Semantic search needs an Ollama embedding model pulled once (default `nomic-embed-text`); without it the keyword index alone still works.
- The update check compares release tags and points you at the release page — it doesn't update JARVIS itself.
- The PWA install (own window, offline shell) needs Chrome or Edge; everything that acts on your PC still runs through the local server.
- Automatic repair of dev servers covers missing dependencies and a stale port held by JARVIS's own earlier run; other crashes are diagnosed, not fixed. ROLLBACK only reverses actions JARVIS knows how to undo, within 30 minutes.
- Coding-AI hand-off depends on each tool's own command line; desktop apps without one (OpenCode) need a manual paste.
- Screen OCR is English only.

---

## 16. License

MIT — see `package.json`. Third-party: Express, unpdf (Mozilla pdf.js), qrcode-generator (MIT), Google Fonts via Fontsource.
