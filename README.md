<div align="center">

# J.A.R.V.I.S. — your own AI assistant, on your laptop

**Talk or type. JARVIS opens your apps, plans your study, reads your notes and PDFs, fixes your code and automates your day — running on your own computer, privately, for free.**

Voice & chat · English / తెలుగు / ಕನ್ನಡ · Local AI (Ollama) or your own API key · Windows

</div>

---

## Contents

1. [What is JARVIS?](#1-what-is-jarvis)
2. [Highlights](#2-highlights) — and [the full list of what JARVIS can do](#what-jarvis-can-do--the-full-list)
3. [Requirements](#3-requirements)
4. [Install & run](#4-install--run)
5. [First-time setup (choose an AI)](#5-first-time-setup-choose-an-ai)
6. [Using JARVIS — the interface](#6-using-jarvis--the-interface)
7. [Features](#7-features) — everything JARVIS can do, with examples
8. [Command cheat sheet](#8-command-cheat-sheet)
9. [Settings reference](#9-settings-reference)
10. [Privacy & security](#10-privacy--security)
11. [How it works (architecture)](#11-how-it-works-architecture) — the pipeline, every subsystem, how to extend it
12. [Project structure](#12-project-structure)
13. [Testing](#13-testing)
14. [Troubleshooting & FAQ](#14-troubleshooting--faq) — including the [debugging guide](#debugging-guide)
15. [Known limitations](#15-known-limitations)
16. [License](#16-license)

---

## 1. What is JARVIS?

JARVIS is a **voice and text AI assistant that runs on your own Windows laptop**, inspired by Tony Stark's J.A.R.V.I.S. It is a small Node.js server plus a web page you open in Chrome or Edge.

- A **fast rule engine** understands clear commands instantly ("open chrome", "set a timer for 10 minutes") — no AI needed, works offline.
- Anything casual, misspelled or open-ended goes to an **AI brain**: a free local model through **[Ollama](https://ollama.com)** (nothing leaves your laptop), or a cloud model with **your own API key** (OpenAI, Claude, Gemini, Groq, …).
- It can **act on your computer**: open any installed app, control volume/brightness/Wi-Fi/windows, read your screen, open and read files anywhere on the laptop (it asks before changing anything outside ~/jarvis), run code, start your dev servers, and hand tasks to coding AIs like Copilot or Claude Code.
- It **understands what you mean**, not just exact commands: misheard speech is repaired ("front and" → frontend), "there" / "that folder" / "open it" / "the second one" refer to what you just saw, and a name you half-remember gets **"Did you mean…?"** with the closest real folders.
- **JARVIS Code** — its own coding chat: describe an app, pick a folder, and JARVIS's AI **writes the files itself** (no copy-pasting).
- It is built for **students and developers**: study planner, flashcards, viva practice, DSA coach, answers from your own notes and PDFs, and a one-click "explain & fix" for crashing programs.
- **Safety first:** a server-side permission list decides what's allowed (never the AI), risky actions ask first, the most dangerous ones can require **Windows Hello**, and **"undo"** reverses almost everything.

👉 **The complete list of what JARVIS can do** is in [Highlights](#what-jarvis-can-do--the-full-list); **how it works inside** (and how to debug it) is in [How it works](#11-how-it-works-architecture).

There is also a **cinematic landing page** that introduces JARVIS: open `http://localhost:PORT/welcome` (or `/landing.html`) — PORT is the address JARVIS prints (3002 on the author's laptop) while JARVIS is running.

---

## 2. Highlights

| | |
|---|---|
| 🎙 **Voice & chat** | Hold the mic or say the wake word. English, Telugu, Kannada — even typed in English letters ("volume penchu"). Natural neural voices. Two personalities: **JARVIS** and **FRIDAY**. |
| 🧠 **Context & control** | A rolling summary carries the conversation forward — "what were we talking about?" picks the thread back up. JARVIS remembers the folder/file it just showed, so **"create a folder there"**, **"open it"**, **"open the second one"** just work. **"Did you mean…?"** for half-remembered names. **Ctrl+K** or **/** puts every command and skill one keystroke away. Say **"panic"** to pause all automation, **"resume"** to continue. |
| 💻 **Controls your laptop** | Opens **any Start-menu app**, volume, brightness, dark mode, Bluetooth/Wi-Fi, power plans, window layouts, screenshots, clipboard tools, screen reading & vision. |
| 📚 **Study** | Tasks, deadlines, timetable, reminders, focus sessions, **multi-day study planner**, progress dashboard, flashcards with spaced repetition, **viva practice** by voice, contests and web research. **Attendance with a 75% bunk-o-meter**, marks → SGPA/CGPA. |
| 📄 **Your files & notes** | Drop in PDFs, notes, **.docx / .pptx / .xlsx** and ask questions — **hybrid keyword + semantic search**, answers with **page numbers**. Summaries and flashcards from any file. |
| ⌨ **JARVIS Code** | A coding chat of its own (**JARVIS CODE** button): pick a project folder in the Windows folder picker, choose **Build / Plan / Ask** and a model, describe what you want — JARVIS writes real files into the folder, opens the page, and **undo** takes it back. |
| 🛠 **Coding** | Write → save → run code, **EXPLAIN & FIX** crashes in one click, **DSA coach** (hints before solutions), **website generator**, "open VS Code in *folder* and tell Copilot to…", and **dev environments that recover from failures** (missing dependencies → install → restart → verify). |
| ⚡ **Automation** | Multi-step commands, **routines**, **triggers** ("when I plug in my charger…"), a **global hotkey** for any selected text, reminders that fire even with the tab closed. |
| 📱 **Phone** | Reminders on your phone (ntfy), and phone commands locked behind a 6-digit **authenticator code**. |
| 🔐 **Safe & private** | Local-only server, permission tiers, Windows Hello approvals, **undo**, encrypted backups, keys that never leave the laptop. |


### What JARVIS can do — the full list

Everything below works today. The phrases are examples you can type or say; the details, options and edge cases are in [Features](#7-features), and how each part works inside is in [How it works](#11-how-it-works-architecture).

**🗣 Talk to it**
- **Type or speak.** Hold the mic or `Space`, or say the wake word ("Jarvis") hands-free — even while you're in another tab or app. Replies are shown, streamed and spoken (browser voices or neural voices).
- **Three languages.** English, Telugu and Kannada — in their own script or typed in English letters ("volume penchu", "timer pettu"). Replies come back in your language.
- **Two personalities.** JARVIS (calm, dry British wit) and FRIDAY (brisk, warm). It calls you sir / ma'am / boss / your name. Greetings answer in kind — "good evening" gets an evening reply, plain "hi" follows the clock — and, if you switch it on, it can greet you by name when the camera sees you ([Looks, camera & extras](#looks-camera--extras-optional)).
- **It copes with messy input.** Typos ("opn crome"), filler ("umm can you please… for me"), number words ("brightness to fifty"), mixed languages, and **misheard speech** ("front and" → frontend; "ugly loop folder" → your `AGRILOOP` folder; "b drive" → D drive).
- **It asks instead of guessing.** A half-heard command gets **"Did you mean…?"**; a half-remembered folder name gets the closest real folders to choose from.
- **It remembers.** Your name and facts ("remember that my exam is on Friday"), the whole conversation (rolling summary), and **what you were just doing** — "create a folder *there*", "open *it*", "open *the second one*", "in *the same project*", "and then list the files".
- **You can teach it.** "What didn't you understand?" lists missed phrases; **TEACH** maps a phrase to a command. "No, that's wrong" logs a mistake.
- **You can see how it thought.** Settings → *Show how I understood you* (or "how did you understand that?") shows what it heard, the intent, confidence, details, context, decision and permission tier.

**💻 Control your laptop**
- **Apps:** open or close any installed app by name ("fire up VS Code", "open canva", "close it"), bare names ("chrome"), follow-ups ("and firefox too").
- **System:** volume, mute, media keys, brightness, dark mode, Wi-Fi / Bluetooth (asks before turning off), power plan, display off, lock, battery, system health, top processes, "is port 3000 free?", network / IP, run diagnostics.
- **Windows & screen:** snap windows, minimise everything except one app, show desktop, screenshots, **read my screen** (OCR), **describe my screen** (the AI sees it), **"analyze my second tab"** (switches the tab itself).
- **Clipboard:** paste into files, format JSON, fix code and copy it back, count words, summarise a link; optional clipboard history.
- **This laptop's own facts:** "what version of node am I running", "check git version", "what's the latest file in my project", charger plugged / unplugged alerts.

**📁 Files & folders — anywhere on the laptop**
- **Find anything by name** across every drive ("where is pythonProject", "find conifer"), with a background index of all file and folder names.
- **Open, read, list, count:** "open the agriloop folder", "read notes.txt", "list folders in D drive", "how many folders are on my laptop" (per drive), "open calculator.html" (opens the file, not the Calculator app).
- **Create & change:** "create a folder called css there / on my desktop / in D drive", "create a python file for calculator operations" (name inferred), save code JARVIS wrote, rename, copy, move, delete (to a restorable trash). **Anything outside `~/jarvis` asks ALLOW / CANCEL first.**
- **Documents:** PDFs, `.docx`, `.pptx`, `.xlsx`, notes, code — ask questions with **page-numbered sources**, summarise, make flashcards ("what does lecture3.pdf say about paging?").

**🌐 Web & the world**
- **Fresh facts:** it searches the web and the local AI answers **only from the pages it fetched**, with sources ("what's the latest Node.js version", "today's AI news", "price of RTX 5060 in India").
- **Places:** "nearest restaurants to Kodigehalli, Bengaluru" → Google Maps with the category, location and sort worked out.
- **Open or search:** "search google for…", "find react documentation" (opens the page), sites it knows, YouTube, weather, directions and distance, units and conversions, CS calculators (binary, hex, xor, complexity).
- **Study-related web:** upcoming contests (Codeforces / LeetCode / CodeChef), hackathons, "research…" with sources.
- **Honest when offline:** if the answer needs the web and Online tools is off, it says so and offers to turn it on — it never passes off old memory as current news.

**📚 Study & everyday life**
- **Tasks:** to-dos, deadlines (alerts 3 h before), timetable, reminders (one-off and recurring — fired by the **server**, so they work with the tab closed), timers, "plan my day".
- **Focus:** focus sessions and pomodoro per subject, **block distractions**, productivity reports, a 7-day dashboard and streak.
- **Planner:** multi-day study plans from an exam date and topics, with review days and a mock test.
- **Practice:** flashcards with spaced repetition, **viva / mock interview** by voice with scores and model answers, **DSA coach** (hints before solutions).
- **Student maths:** attendance with a 75% **bunk-o-meter**, marks → SGPA / CGPA.
- **Writing helpers:** commit messages, bug reports, resume bullets, stand-up updates, LinkedIn drafts, leave emails, and a **TCREI UI-design prompt** for v0 / Lovable / Claude.

**⌨ Code**
- **JARVIS Code:** its own coding chat — pick a folder, choose *Build / Plan / Ask* and a model; the AI returns files and **JARVIS writes them itself**, opens the page, and **undo** restores everything.
- **Write → save → run:** `.py`, `.js`, `.c`, `.cpp` with a 10 s limit; **EXPLAIN & FIX** for crashes; save any code block ("save this file by creating a new folder called X").
- **Website generator:** "create a website / frontend for…" → asks where to save → writes real files; project frontends go to `<project>/frontend/`; change it by talking ("make the header bigger").
- **Hand work to a coding AI:** "open vs code in dsa_sprint and tell copilot to…" (Copilot, Kiro, Trae, Antigravity, Devin, OpenCode, Claude Code, Codex, Gemini, Qwen, Codebuff).
- **Dev projects:** "prepare my development environment for AgriLoop" — locate, open, start backend + frontend, **recover from missing dependencies** (ask → install → restart → verify).
- **Git & tooling:** status, log, diff, commit message, clone; check a compiler or VS Code extension is installed; "I want to learn Python" creates and runs a real Hello-World.

**⚡ Automate**
- **Multi-step commands:** "open VS Code, create a folder DSA and start a 25 minute focus" — previewed, validated by the server, executed with **RETRY / CONTINUE / ROLLBACK**, each step verified for real, and inspectable afterwards.
- **Routines:** built-in (study mode, morning, bedtime, leaving), your own, and scheduled ("run my morning routine every day at 7am").
- **Triggers:** "when I plug in my charger, start study mode", "when the battery drops below 20%…".
- **Global hotkey:** select text in any app → explain / summarise / rewrite / translate / fix code.
- **Smart alerts & panic mode:** low battery, high RAM, deadlines; say "panic" to pause all automation, "resume" to continue.
- **Undo:** "undo" reverses almost anything (last 40 actions within 30 minutes), including a whole multi-step plan.

**📱 Phone**
- Reminders and alerts on your phone (**ntfy**), and phone commands that unlock with a 6-digit **authenticator code**; the full page over **Tailscale**.

**🔐 Safe, private, yours**
- A **server-side permission list** (never the AI) decides what runs; risky things ask first; the most dangerous can require **Windows Hello**; Windows, Program Files and AppData are never touched.
- **App lock:** switch on *Lock JARVIS* and it opens only after **Windows Hello** (fingerprint, face or your Windows Hello PIN); it re-locks when idle, on "lock jarvis", and at every restart.
- Runs on `127.0.0.1` only. With a local model nothing leaves the laptop; cloud models, online translation and neural voices are opt-in.
- Encrypted backups, daily snapshots, a restorable trash, and one shared copy of your data in `~/jarvis`.

**🚫 What JARVIS will not do** (on purpose)
- Install, update or uninstall software (it explains the steps instead) · download files on its own · run shell commands · send emails or messages for you · change passwords, accounts, firewall, registry or environment settings · delete "everything" in one go · change anything outside `~/jarvis` without your ALLOW · touch Windows / Program Files / AppData · claim it did something it didn't.

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
│              │  CHAT · TASKS · MEMORY · JARVIS CODE              │
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
- **JARVIS Code** tab / button — a separate coding conversation with its own composer (see [JARVIS Code](#jarvis-code)).
- **Orb** (left) — shows what JARVIS is doing (ready / listening / thinking / working / speaking).
- **☰** — the Systems panel: engines, CPU/RAM/disk, and the activity log.
- **Message box** — 🎤 hold-to-talk, 📎 attach a PDF or notes file (or drag files anywhere onto JARVIS), language switch **EN | తె | ಕ**, and **WAKE WORD** for hands-free.
- **Quick actions** — one row of suggestion chips by category, under the message box.
- **Ctrl+K palette** — every command, skill, attendance action and taught phrase in one fuzzy-searchable list; arrow keys + Enter to run, Esc to close.
- **"/" skills menu** — type `/` in the message box for the same list right above it (`/ui` → the UI design prompt, `/att` → attendance); ↑↓ and Enter/Tab to pick.
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
- **Honest AI:** the chat AI is told it cannot create, save, open or run anything by writing a reply — it never claims "saved as calculator.html" unless JARVIS really did it. Asking for code gives it room for a whole page (no answers cut off half-way).
- Voice persona lines live in `persona.js` — edit them to taste.

### Voice & languages

- **Hold the mic** (or `Space`) to talk, or turn on **WAKE WORD** and say "Jarvis …" hands-free. The wake word survives brief network blips (it retries before giving up, and tells you if it stops).
- **JARVIS lets you finish.** It keeps listening through pauses mid-sentence and answers once you've been quiet for a moment — "Jarvis, open VS Code … and start a focus session" runs both. Say just "Jarvis" and it waits for your command (and says "Yes, sir?" if you pause). Tap the mic again to send straight away. **Settings → Pause before I answer**: Short (1 s), Normal (1.6 s) or Long (2.5 s — handy if you think mid-sentence). Works the same in Telugu and Kannada, including the recogniser's different spellings of "జార్విస్ / ಜಾರ್ವಿಸ್".
- **Telugu & Kannada:** speak or type in తెలుగు / ಕನ್ನಡ, or say "switch to Telugu". Typing in English letters works too — "volume penchu", "5 nimishalu timer pettu", "timer cancel maadu", "recursion ante enti". Replies come back in your language.
- **Typos are fixed**: "set timr 5 min", "clse chrome", "cancle the timer" (real words are never "corrected" into commands).
- **Misheard words are repaired** (spoken input only): "front and" / "front end" → frontend, "v s code" → vs code, "java script" → javascript, "fold her" → folder, "calculate her" → calculator… — always checked against the words around them, so "front and back of the page" stays as it is. JARVIS also waits for the recogniser's *final* words before acting (it no longer sends an unfinished "front"), and picks the best of its three guesses.
- **Settings → Test my mic** — say 14 command words ("frontend", "create a folder", "VS Code"…) and see what the mic heard and what JARVIS repaired, as a score.
- **Neural voices** for FRIDAY, Telugu and Kannada (Microsoft's neural voices, work in any browser). **Online translation** makes Telugu/Kannada answers as good as English ones. Both send the *reply text* online and can be turned off in Settings.

### Laptop control

- **Apps:** "open chrome", "fire up VS Code", "close it" — plus **anything in your Start menu** by name ("open canva", "open telegram", "open docker", "open mysql workbench"). Closing works for regular desktop apps; for Microsoft Store apps JARVIS won't guess which process to close and says so.
- **System:** "set volume to 30", "mute", "next song", "set brightness to 60", "dark mode", "is my Bluetooth on", "turn off wifi" (asks first), "switch to balanced power plan", "turn off the display", "lock the screen", "battery", "how's my system?", "top processes", "is port 3000 free?", "run diagnostics".
- **Windows:** "put VS Code on the left and Chrome on the right", "minimize everything except VS Code", "show desktop".
- **Screen:** "read my screen", "explain the error on my screen" (Windows OCR, local). **"Analyze my second tab"** — JARVIS switches to tab 2 itself (Ctrl+2, only while your browser shows JARVIS), reads it and comes back; if it would only capture its own window it says so instead of guessing. **Screen vision** — "describe my screen", "explain the chart on my screen", "describe the image I copied" — the AI *sees* the screenshot (needs an image-capable model; the capture is kept in memory only, single use, ≤2 minutes).
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
- **Finds anything on the laptop:** a background list of every file and folder name on every drive (names only — never contents; system, hidden and build folders skipped; rebuilt every 30 minutes) — "where is pythonProject", "find conifer", "locate Forest-Competition-Simulator", "check whether the calculator folder exists".
- **"Did you mean…?"** — a name that isn't found exactly gets the closest real ones (typos, short forms, version endings like `AGRILOOP-1`, extra words): "open agri look folder" → *Did you mean AGRILOOP-1 or AGRILOOP61?* Answer **yes**, a number or **no**. It never acts on a guess.
- **Count & list folders anywhere:** "list number of folders in my laptop" (per drive), "how many folders are in D drive", "list folders in D drive", "show folders on my desktop", "list files in C:\Users\me\Projects".
- **"There", "it", "the second one":** JARVIS remembers the folder or file it just showed, found or made — "create a folder called css there", "make me a directory called notes in that directory", "create a folder in it", "open it", "open the second one", "open number 3". Unclear references are asked about, never guessed. "Create a folder called test **in D drive** / **on my desktop**" works too (asks first — it's outside ~/jarvis).
- **"Open calculator.html"** opens the file (in your browser), not the Calculator app.
- **Drop in PDFs and notes:** drag files onto JARVIS or click **📎**. They're saved to `~/jarvis/Documents`.
- **Ask your files:** "what did my OS notes say about deadlocks?", "what does lecture3.pdf say about paging?", "search my notes for normalization", "according to my notes, what is a semaphore?". Answers come from your files with a **Sources** list (file + page number or lines). A name with spaces needs quotes: `what does "10. Numpy.pdf" say about arrays`.
- **Summarise / flashcards / read / open:** "summarise lecture3.pdf", "make flashcards from lecture3.pdf", "read lecture3.pdf" (shows the text), "open lecture3.pdf" (opens your PDF viewer).
- The search is a local **hybrid index** over text, code, PDF **and Office files (.docx/.pptx/.xlsx)** (skips `node_modules`, hidden folders, the trash and JARVIS's own data). PDF text is extracted locally with Mozilla's pdf.js; Office files are unzipped and read directly. Scanned PDFs (pictures of pages) can't be read as text — JARVIS says so. Up to 40 MB / 400 pages for PDFs, 30 MB for Office files.
- **Search is hybrid:** keyword ranking fused with optional **semantic search** — turn it on in Settings and "no internet at my place" also finds "wifi problem" notes. Needs a small Ollama embedding model (`ollama pull nomic-embed-text`); without it the keyword index alone still works. New and changed files are picked up automatically.

### Coding

- **Save code JARVIS wrote:** "save this file by creating a new folder called calculator_website" / "save it on my desktop" — the code from JARVIS's last answer goes into that folder as a real file (`index.html` for a web page). For a new folder or a web page JARVIS **asks where** first.
- **Write → save → run:** "write fizzbuzz in python and save it as fizz.py and run it", "save that code as bfs.py", "run it", "run sort.cpp with input 5 3 1", "open it in VS Code", "paste that code into my editor" (3-second countdown, then Ctrl+V). Runs `.py`, `.js`, `.c`, `.cpp` with a 10-second limit, in `~/jarvis` and your project folders.
- **🛠 EXPLAIN & FIX:** when a run fails, JARVIS explains the error in plain English (what, which line, why) and shows the fixed file. **APPLY FIX & RUN** saves and re-runs it; **"undo"** gets your original back.
- **DSA coach:** "coach me on two sum", "help me with leetcode 15 3sum", "I'm stuck on longest palindromic substring". Hints first ("next hint" — they build on each other, never code), "my approach is …" gets checked without spoilers, "show solution in C++", "save it" (to your `dsa_sprint` folder or `~/jarvis/Code`), "stop coaching".
- **Website generator:** "create a website for my college fest", "build me a landing page for my startup", "make a portfolio website", "create a frontend website for a calculator". A few quick questions, then **"Where should I save it?"** (desktop, D drive, a full path, or ~/jarvis/Projects) — a complete page is written there as real files and opens in your browser (≈1–3 min with a local model). **"Create a frontend for my calculator project"** finds that project (or a close name — "did you mean…?") and builds into `<project>/frontend/`. Change it by talking: "make the header bigger", "add a contact section" — "undo" goes back. Pages load no outside scripts and forms never send data anywhere.
- **UI design prompt (TCREI):** "ui design prompt" (or `/ui`) asks four questions — **T**ask, **C**ontext, **R**eferences, **E**valuate — then writes one ready-to-paste prompt for v0 / Lovable / Claude with the five TCREI headings (Task, Context, References, Evaluate, Iterate), built only from your answers.
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

### JARVIS Code

A coding mode with **its own conversation**, separate from the normal chat. Click **JARVIS CODE** (next to SEND) or the **JARVIS CODE** tab.

```
┌────────────────────────────────────────────────────────────────┐
│ Describe what to build or change…                              │
│ ＋ calculator ✕   Build ▾   qwen3.5:4b ▾            CHAT   [↑] │
└────────────────────────────────────────────────────────────────┘
```

- **＋** opens the **Windows "Select Folder" dialog** — the project JARVIS works in (✕ goes back to a new project in `~/jarvis/Projects`).
- **Build** — the AI sees the project's files and writes complete new or changed files; **JARVIS saves them itself** and opens `index.html` in your browser. Outside `~/jarvis` an **ALLOW / CANCEL** card (in the JARVIS Code chat) lists the exact files first. Changed files are backed up — type **undo** to take it all back.
- **Plan** — the steps and files it would create or change; nothing is written. Answer **yes / proceed / go ahead / okay build it** and it builds that plan (switching to Build for you).
- **Ask** — questions about the project's code.
- **Model** — any installed or cloud model. It remembers the conversation, so follow-ups work: "make the buttons bigger", "keep it in separate html, css and js files".
- Safety: the AI only returns text; JARVIS checks every path, so nothing lands outside the project folder (`..`, other drives and `node_modules` are refused). If a small model skips the file markers, plain ```` ```html / ```css / ```js ```` blocks are still saved; if no files come back, it asks the AI once more.
- **CHAT** or **Esc** returns to the normal chat; **clear** starts a fresh JARVIS Code conversation.

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
- **Same intent, many wordings:** "make a folder" / "make me a directory" / "can you create a folder"; "how many folders are on my laptop" / "list number of folders" / "count directories in D drive"; "create a frontend" / "build UI for calculator" / "design the front end" — each maps to one command with its details (name, place, project) pulled out.
- **Obvious names aren't asked for:** "continue in the same project calculator, create a python file which includes all operations of calculator" finds the `calculator` project and writes `calculator.py` there (the AI writes the code) — only when two or three names are equally plausible does it ask, with them as choices. "In the same project" / "this project" / "my calculator project" all resolve to the project; "and …", "also …", "then …" carry the context on.
- **Half-heard voice commands are asked about:** if the mic's words only half-match a command (medium confidence), JARVIS asks "Did you mean …?" (**Yes / No**) instead of guessing or handing it to the AI.
- **See how it understood you:** **Settings → Show how I understood you** adds a 🔍 block under each reply — what was heard (and repaired), intent and confidence, the details it pulled out, the context it used, the decision (tool / local AI / web) with its reason, the route, the permission tier and timing. "How did you understand that?" shows it any time.
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
- **Charger alerts:** JARVIS says when the charger is plugged in or unplugged (with the battery level) — no trigger needed; **Settings → Charger alerts** turns it off, and panic mode pauses it.

### Looks, camera & extras (optional)

Added in later versions; each has its own switch in **Settings → Behaviour** (or a header button). Nothing here changes what the commands do.

- **Cinematic boot** *(on by default)* — an arc-reactor animation behind the boot screen. **Transitions** add small one-shot effects when JARVIS wakes, works or hits an error (all respect your "reduce motion" setting).
- **Holographic HUD** *(off)* — floating translucent panels (clock, system stats…); the **HUD** button in the header toggles it. **Esc** closes the overlay.
- **DIAG dashboard** — the **DIAG** header button opens an animated diagnostics overlay with live sparklines: CPU, RAM, network, top processes, and (with the optional `systeminformation` package: `npm install`) CPU temperature, GPU and battery details.
- **Qwen NLU assist** *(off)* — when the rules aren't sure what you meant, ask the local Qwen model to read the command. It may only choose from a fixed list of known commands, and if it fails or is less sure than the rules, the rules' answer stands. (`POST /api/nlu/parse`.)
- **Face recognition greeting** *(off)* — one webcam snapshot when JARVIS goes idle; if it's you, "Welcome back, sir. Good evening." (at most every 5 minutes). Switch it on in Settings and look at the camera for the 3-sample enrollment. Only a 128-number face fingerprint is kept (in `~/jarvis/.config.json`, never an image), and the **comparison is done by the server**, so the stored fingerprint never leaves it. *The face model (`face-api.js`) is downloaded from a public CDN the first time you switch it on — so it needs the internet once.*
- **Hand gestures** *(off)* — UI-only, never commands: open palm toggles listening, pinch dismisses a card, swipes scroll the chat, thumbs-up answers *yes* to an approval card, a fist stops speech. *Loads MediaPipe from a public CDN on first use.*
- **Pattern learning** — notices habits locally ("you open VS Code every morning — run it automatically?") from app-open and command frequency per hour and battery / RAM baselines; no chat text, file contents or window titles.
- **Port-scan watch** — checks the listening ports every 60 s and alerts when a **new** one appears (an unexpected server, or something phoning home). Switch in Settings.
- **Better OCR** — `/api/ocr/image` reads text from any image (Windows OCR when it's a screen capture, Tesseract as the fallback, loaded only when needed).
- **Central thresholds** (`thresholds.js`) — low-battery, high-RAM, deadline window and similar alert levels live in one place and can be overridden in Settings.

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
| Build a website | `create a website for my college fest` → `make the header bigger` · `create a frontend for my calculator project` |
| JARVIS Code | **JARVIS CODE** → ＋ pick a folder → `a todo list app with html, css and js` → `make the buttons bigger` · Plan → `yes` builds it |
| Find & count | `where is pythonProject` · `list number of folders in my laptop` · `list folders in D drive` · `check whether calculator folder exists` |
| Context | `create a folder called css there` · `open it` · `open the second one` · `open agri look folder` → *Did you mean…?* → `2` |
| Save code | `save this file by creating a new folder called calculator_website` → `desktop` |
| Prompts | `ui design prompt` (TCREI) · type `/` for the skills menu |
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
| | Test my mic | Say 14 command words; see what the mic heard, what JARVIS repaired, and the score. |
| **Behaviour** | HUD theme · Answer length | Arc blue, gold, crimson, violet; concise/balanced/detailed. |
| | Online tools · Home city | Weather, web answers, contests, directions (off by default). |
| | Show how I understood you | Under each reply: what was heard, intent, confidence, details, context, decision (tool / local AI / web) and why, permission tier. |
| | Smart alerts · Charger alerts · Global hotkey | Battery/RAM/deadline alerts; "charger connected / disconnected"; Ctrl+Shift+J. |
| | Phone alerts · Phone access | ntfy alerts & commands (+ authenticator); Tailscale access. |
| | Focus / break (min) | Pomodoro lengths. |
| | Semantic search · Embedding model | Meaning-based file search ("wifi problem" finds "no internet"); needs an Ollama embed model such as `nomic-embed-text`. |
| **Backup & restore** | Export · Import · Include my API keys · snapshots | See [Undo, backup & your data](#undo-backup--your-data). |
| **Project folders** | Add/remove folders | Used for preparing environments, starting backends and frontends, git, and searching your notes. JARVIS can open files anywhere without adding them here. |
| **Data** | Require Windows Hello | Fingerprint/face/PIN for shutdown, restart, sleep, deleting files, clearing the sandbox, erasing data and importing backups. |
| | **Lock JARVIS** · Auto-lock · LOCK NOW | Opens JARVIS only after Windows Hello (needs *Require Windows Hello* first). Auto-lock after Never / 5 / 15 / 30 / 60 min idle. Turning it on/off needs a Windows Hello approval. Say "lock jarvis" to lock now. |
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
- **App lock (optional): JARVIS opens only after Windows Hello.** Settings → Data → **Lock JARVIS**. While locked, the *server* refuses every `/api` request (your chat, memory, tasks and every tool) and shows a standalone **lock page** instead of the app — the app's code doesn't even load, so it isn't just a cover over the page. Unlocking is a signed **Windows Hello** check (fingerprint, face, or your **Windows Hello PIN** — the PIN you use to sign in to Windows) verified by the server, the same mechanism as the shutdown/delete approvals. JARVIS can't read or check your Windows account *password* itself; Windows Hello is how a web app asks Windows to confirm it's you. It locks again after the chosen idle time (Never / 5 / 15 / 30 / 60 min), on **"lock jarvis"** / **LOCK NOW**, and whenever JARVIS restarts. Turning the lock on or off needs a fresh Windows Hello approval. Unlocking works **at the laptop only** (Windows Hello is localhost-only), so the phone/Tailscale page stays locked. Reminders, triggers and phone alerts keep running in the background while locked. It needs "Require Windows Hello" to be set up first, and it can never lock you out: if the Windows Hello key is removed from `~/jarvis/.config.json` (the documented recovery), the lock simply stands down.
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

This section explains JARVIS from the outside in: the big picture, what happens to one request, then each subsystem — what it's for, which files hold it, how data flows through it, and **where to look when it misbehaves**. (A symptom-by-symptom checklist is in [Debugging guide](#debugging-guide).)

### 11.1 The big picture

```
                         YOU   (voice · text · phone · hotkey)
                                         │
   ┌─────────────────────────────────────▼──────────────────────────────────────┐
   │                        BROWSER PAGE   (index.html)                          │
   │                                                                             │
   │   INPUT       speechfix.js · voice.js · lang.js          mic, repair, language│
   │      ▼                                                                      │
   │   UNDERSTAND  skills-page.js · routines.js · agent.js (router)              │
   │               nlu.js  normalize ─► classify  (rule engine)                  │
   │      ▼                                                                      │
   │   DECIDE      decider.js (+ places.js)   ◄── context: ctx.focus, ctx.pending │
   │      ▼                                                                      │
   │   ACT         script.js  executeTool ──► callTool() ──► /api/…              │
   │   OUTPUT      deliver ► renderReply ► typeMD + speak       inspector (trace) │
   └──────────────────────┬───────────────────────────────────────▲──────────────┘
                          │  HTTP · 127.0.0.1 only                 │  SSE  /api/events
   ┌──────────────────────▼───────────────────────────────────────┴──────────────┐
   │                        NODE SERVER   (server.js)                             │
   │   /api/tool/*    files · apps · system · web · code · git       (validated)   │
   │   /api/agent/*   tool registry · permission tiers · AI planner               │
   │   /api/chat      llm.js ───► Ollama (local)  or  a cloud provider            │
   │   /api/code/*    JARVIS Code          /api/skill/*   website · coach · viva  │
   │   /api/state     shared data          scheduler.js   reminders · triggers    │
   │   access zones · approvals · Windows Hello · laptop file index · RAG         │
   └──────────────────────┬───────────────────────────────────────────────────────┘
                          ▼
              your laptop: apps · files · Windows · network
```

**The one rule that explains most of the design: the page proposes, the server disposes.** Every action is a request to `/api/*`. The server checks the arguments against a schema, checks the **access zone** and **permission tier**, and only then touches the laptop. The AI never has direct access either: it can only emit *text*; JARVIS parses that text, validates it like any other request, and refuses anything it doesn't recognise.

Three "brains", in order of cost: **rules** (`nlu.js`, instant, offline) → **the decision engine** (`decider.js`, instant, offline) → **the AI** (`llm.js`, seconds, local or cloud). Anything a rule or the decider can settle never reaches the AI.

### 11.2 One request, step by step

Everything starts in `handleUser(text, source)` in `script.js`. `source` is `text`, `voice`, `wake` (spoken after "Jarvis") or `chip` (a suggestion button). The stages run in this order, and **any stage can end the turn** by delivering a reply:

| # | Stage | Where | What happens | Debug hint |
|---|---|---|---|---|
| 0 | **Capture** | `sendInput`, `finishDictation`, wake path | text / spoken sentence arrives; a *turn trace* is started | — |
| 1 | **Speech repair** *(voice only, English)* | `SpeechFix.fix` → `fixDrives` → `fixNames` | misheard words fixed; your folder names matched by sound | log: `heard "…" → understood "…"` · inspector row *Mic heard* |
| 2 | **Gates** | top of `handleUser` | busy → queued; a permission card on screen → typed *yes / no* presses it | toast "Queued: …" |
| 3 | **Language** | `Lang.switchRequest`, `Lang.toEnglish`, `NLU.fromRoman` | "switch to Telugu"; Telugu/Kannada (script or English letters) → English for the rules | log: `understood as: "…"` |
| 4 | **Early pending answers** | `ctx.pending` | answers to TEACH ("what should I do when you say…"), create-a-project and design-prompt questions — consumed before anything else sees the text | `ctx.pending` in the console |
| 5 | **Meta commands** | `handleUser` | "how did you understand that", "no, that's wrong" | — |
| 6 | **Continuations** | `handleUser` | leading *and / also / then / now* removed; context kept | inspector note *continuation* |
| 7 | **Skills** | `Skills.intercept` (`skills-page.js`) | active website / UI-prompt / DSA-coach / viva sessions and their trigger phrases | route: *skill* |
| 8 | **Routines** | `Routines.match` | a routine called by name | — |
| 9 | **Fixed agent goals** | `Agent.*Goal` helpers | taught phrases, dev-environment, learn/create-project, design-prompt, guided templates | — |
| 10 | **Multi-step router** | `Agent.route` → `Agent.handleMulti` | 2+ actions in one sentence → plan, validate, preview, **EXECUTE** | route: *multi-step agent* |
| 11 | **Classify** | `NLU.normalize` → `resolvePending` → `NLU.classify` | `resolvePending` first turns answers to *JARVIS's own questions* ("Did you mean…?" → yes / 2, a file name, a place, "yes" to a confirmation) into the command they complete; otherwise text → `{ intent, confidence, args, tool }` (first matching rule wins) | log: `intent: X · conf 0.94` |
| 12 | **Decide** | `Decider.signals` + `Decider.decide` | picks the route, the reason, the payload, a confidence; may *override* a weak rule match | inspector rows *Decision* / *Signals* |
| 13 | **Medium-confidence check** | `CONFIRM_INTENT` | a *spoken* command at 0.60–0.85 → "Did you mean …?" (Yes / No) | route: *medium confidence → asked first* |
| 14 | **Execute** | `executeTool(p)` → `callTool('/tool/…')` | the command runs (confidence ≥ 0.85) | ☰ log `tool` lines · browser Network tab |
| 15 | **No-rule fallbacks** | `Agent.plan`, `MAPS`, `GUIDE`, `WEB_OPEN`, `doResearch`, `OFFER_ONLINE` | what the decider chose when no command matched | route row |
| 16 | **AI chat** | `askLLM` → `/api/chat` | streamed answer; may contain one `<<tool {json}>>` call → `/agent/validate` → tier gate → run | model shown in the reply header |
| 17 | **Deliver** | `deliver` → `renderReply` | persona voice, translation, Markdown, typing effect, speech, chips, **inspector block** | — |
| 18 | **After** | handlers | `Undo.push`, `Agent.watchSingle` (verify), `ctx.lastIntent`, `ctx.focus` updated | `ctx` in the console |

A few properties worth knowing when debugging:
- **Order is meaning.** Skills run before routines, before the multi-step router, before the classifier. A phrase that "does the wrong thing" is often being taken by an earlier stage — check the inspector's *Route* row first.
- **The classifier is first-match.** `nlu.js` tries its rule table (`R`, ~180 intents) top to bottom and returns the first rule that matches, then applies a few *sanity checks* that can change or downgrade the result (e.g. a device word inside a question drops to 0.6). Rule **order** therefore matters.
- **0.85 is the line.** At or above it a command runs directly; below it the request goes to the decider's fallbacks / the AI. The decider sits *on top of* the classifier and may overrule a weak match (for example "open the nearest ATM" is caught by the generic "open a web page" rule, but the decider sends it to Maps).

### 11.3 Understanding layer

#### Speech input — `voice.js`, `script.js`, `wakeword.js`
- **What it does:** turns your voice into one clean sentence.
- **Flow:** the mic button / `Space` / wake word calls `startDictation` → `makeRec` creates a browser `SpeechRecognition` (language from **Speech language**: en-IN / te-IN / kn-IN, continuous, interim results, 3 alternatives). `piecesOf` turns each result into `{text, isFinal}`, choosing the best alternative with `SpeechFix.pickAlternative`. `Voice.createUtterance` (voice.js) collects the pieces across pauses and recogniser restarts, **waits for the final version of the last words**, and commits after *Pause before I answer* of silence (1 / 1.6 / 2.5 s) or when you tap again. `finishDictation` → `handleUser(text, 'voice')`.
- **Wake word:** `wakeword.js` runs Windows' offline `System.Speech` recogniser so "Jarvis" works while you're in another tab or app; on a hit the page starts dictation with `source: 'wake'`.
- **Privacy note:** Chrome/Edge send the audio to their speech service — this part needs the internet even with a local AI.
- **Debug:** *Settings → Test my mic* (14 words, raw vs repaired, scored); the live transcript line above the box; the ☰ log line `heard "…" → understood "…"`.

#### Speech repair — `speechfix.js`
- **What it does:** repairs what the recogniser gets wrong, for spoken English only, before any rule sees it.
- **Three layers:** (1) a guarded phrase map ("front and" / "front end" → frontend, "v s code" → vs code, "fold her" → folder…) — each rule checks its neighbours, so "front and back of the page" is untouched; (2) **your own names matched by sound** — `sound()` reduces a word to its consonant skeleton, so "ugly loop", "agree look" and "agri Roop" all match `AGRILOOP-1`; (3) drive letters that don't exist ("b drive" → D drive).
- **Where the names come from:** `GET /api/voice/vocab` (folder names from your project folders, home, Desktop, Documents, Downloads and drive roots; names only), refreshed every 10 minutes into `voiceVocab`.
- **Safety:** it only rewrites the slot where a name belongs (just before *folder / project / backend* or *in vs code*), requires a clear winner, and leaves ambiguous cases for the "Did you mean…?" step.
- **Debug:** `SpeechFix.fix("…")` / `SpeechFix.fixNames("…", voiceVocab.names)` in the browser console; `tests/reliability.test.js`.

#### Language — `lang.js`
- **What it does:** English / Telugu / Kannada in and out.
- **Flow:** script detection (`Lang.detect`); Telugu/Kannada text is translated to English by the AI (`Lang.toEnglish`) so one rule engine serves all three; English-letter Telugu/Kannada ("volume penchu") is mapped by `NLU.fromRoman`; replies are translated back (`Lang.localize`, optional online translation) while code, lists and numbers stay in English.
- **Debug:** log lines `understood as: "…"`; `Lang.replyLang()` in the console.

#### Rule engine — `nlu.js`
- **What it does:** understands clear commands instantly, offline.
- **`normalize(raw, wakeWord)`:** strips the wake word and leading filler (`LEAD_FILLER`: "umm", "hey") and politeness (`LEAD_POLITE`: "can you please", "i want you to"), trailing politeness (`TRAIL`), fixes known abbreviations (`TYPOS`: plz → please), converts number words ("fifty" → 50). Returns `{ text, original, … }`.
- **`classify(norm, ctx)`:** walks the rule table `R` — entries like `['CREATE_FOLDER', /…/, 0.96, 'createFolder']` where the test is a regex or a function — and returns the first match with its **fixed confidence**, then applies sanity checks (questions about devices, "open <unknown>" → best web page, file names → READ_FILE, `node.js` is not a file, …). A typo pass (`corrected`) retries with fuzzy-fixed text and keeps the result only if it reaches ≥ 0.85. No match → `CONVERSATION 0.50`. Follow-ups ("and firefox too", "close it") use `ctx.lastIntent` / `ctx.lastApp`.
- **Helpers:** `parseWhen` / `parseDate` / `parseRepeat` (times and repeats), `findApp` / `findSite` (apps and sites), `parseCodeAsk` (coding-AI phrases), `inferFileNames` (a file name from what it's for), `suggest` ("did you mean one of these" examples).
- **Debug:** `NLU.classify(NLU.normalize('…','jarvis'), {})` in the console, or in plain Node: `node -e "eval(require('fs').readFileSync('nlu.js','utf8')+';global.NLU=NLU;'); console.log(NLU.classify(NLU.normalize('open chrome','jarvis'),{}))"`. `tests/nlu.test.js`, `coverage.test.js`, `paraphrase.test.js`.

#### Context engine — `script.js` (`ctx`, `setFocus`, `scopeFrom`, `resolveProject`)
- **What it does:** makes "there", "it", "the second one", "the same project" mean something.
- **State:** `ctx.focus = { folder, file, created, project, results[], lastAction }`, each with a timestamp and a **15-minute** life. It is filled by every handler that shows, finds, lists, creates or opens something (`setFocus`, `setResults`), and by `deliver` (`lastAction`).
- **Resolution:** `scopeFrom(original)` turns "…in that directory", "…there", "…in it", "…in D drive", "…on my desktop", "…in C:\x" into a place; `REF_RE` recognises the reference words (including "the same / this / my current project"); `resolveProject` finds "the calculator project" (focus → laptop search → "did you mean…?"); `openFocusTarget` handles "open it" / "open the second one" / "open number 3". If a reference can't be resolved, JARVIS **asks** — it never guesses.
- **Continuations:** a leading "and / also / then / now" is stripped so "and create a python file there" keeps the context.
- **The AI sees it too:** `focusSummary()` (current project, folder, file, last action) is sent with every chat and planner request.
- **Debug:** `ctx.focus` and `ctx.pending` in the console; the inspector's *Context* row.

#### "Did you mean…?" — `server.js` (`nameSimilarity`, `similarNames`), `script.js` (`didYouMeanReply`)
- **What it does:** a name that isn't found exactly gets the closest real ones, ranked.
- **How names are compared:** `squashName` ignores case, spaces, `_` and `-`; version endings (`-1`, `61`, `(2)`, `copy`) are ignored; Jaro-Winkler plus edit distance catches typos; "contains" and "starts with" catch short forms; a two-typo match is capped below a name that clearly contains what you said; matches inside library / icon folders (`site-packages`, `venv`…) rank lower. Over the **laptop file index**, via `POST /api/tool/similar`.
- **The question:** `didYouMeanReply` stores `ctx.pending = { intent: 'DID_YOU_MEAN', paths, then }`; your *yes / 2 / the second one / no* is resolved in `resolvePending`. It never acts on a guess.
- **Debug:** `curl -X POST localhost:PORT/api/tool/similar -H "Content-Type: application/json" -d '{"name":"calculater","kind":"folder"}'`; `tests/reliability.test.js` ("Did you mean").

#### Skills & routines — `skills-page.js`, `skills.js`, `routines.js`
- **What they do:** multi-turn features that own the conversation until they finish: website generator (asks what / where), UI-design prompt (TCREI), DSA coach, viva practice.
- **Flow:** `Skills.intercept(text)` runs early in `handleUser`; while a session is active it answers every message; otherwise it matches a start phrase (`SITE_START`, `VIVA_START`, …) or returns `null`. Heavy lifting is on the server (`/api/skill/site`, `/siteEdit`, `/siteRevert`, `/coach`, `/viva/*`) so the AI call and the file writes are validated there.
- **Debug:** `Skills.state` in the console.

#### Multi-step agent — `agent.js`, `agent-tools.js`
- **What it does:** several actions in one sentence, planned, validated, previewed and verified.
- **Flow:** `Agent.route` splits the sentence (`parts`, `splitAnd`, goal sentences like "I'm going to study…") → known parts are classified by the rules, unknown parts go to the **AI planner** (`POST /api/agent/plan`: JSON, ≤ 5 steps, temperature 0, pre-filtered by `refuse()` for things no tool can do) → the server **validates every step** (`validatePlan`: tool exists, arguments fit the schema, tier) → the page shows a **preview** ("No changes have been made yet — EXECUTE / CANCEL") → `Agent.execute` runs the steps in order, **verifying each for real** (`check:` kinds such as `app_started`, `todo`, `volume`, `file`) → a tally ("4 of 4 verified"). Failures offer **RETRY / CONTINUE / ROLLBACK**; every run gets an id (`AGT-…`) and an **execution inspector** card.
- **Debug:** `Agent.lastRuns()`, "inspect the last run", `GET /api/agent/tools` (every tool, its tier and check), `tests/agent.test.js`, `plan.test.js`.

### 11.4 Decision engine — `decider.js`, `places.js`

Every request goes through a small **decision engine** — plain rules, no AI call, so it is fast and predictable. It looks at a few *signals* and picks one *route*:

| Route | When | Example |
|---|---|---|
| **Direct tool** | a command JARVIS knows | "open chrome", "set volume to 50", "create a folder called test" |
| **Local** (your files + tools) | it's about *your* things — files, folders, projects, this laptop, what you were just working on | "fix the previous python file", "where is pythonProject", "what does my notes.md say" |
| **Local AI** | understanding or reasoning that doesn't need fresh facts | "explain binary search simply", "why is quicksort faster" |
| **Web + local AI** | it needs current or outside information — the web is searched, then the local AI answers **only from those pages**, with sources | "what's the latest Node.js version", "today's AI news", "find the latest React docs and explain hooks" |
| **Web search (browser)** | you asked to search | "search google for binary search visualizer" |
| **Open the page** | you want the page itself, not an answer about it | "find react documentation", "open the latest node.js documentation" |
| **Google Maps** | a kind of place + near / in / to somewhere (category, location and sort worked out: *restaurants · Kodigehalli, Bengaluru · nearest*) | "nearest restaurants to bengaluru(kodigehalli)", "open the nearest atm" |
| **How-to (local AI)** | installing or updating software — JARVIS never does that itself, so it explains the steps | "update my node.js", "install python" |
| **Offer online** | the web is needed but **Online tools is off** → ask | "latest python version" while offline |

**Signals** (`Decider.signals(text, { intent, confidence, implicitSearch })`):

| Signal | Means | Triggered by |
|---|---|---|
| `action` | a known command matched (≥ 0.85) | the rule engine's result |
| `fresh` | the answer changes over time | latest, today, now, recent, version, update, price, news, weather, driver, who won, CEO, population, a year like 2026… |
| `source` | you asked for outside sources | search for, look up, google, official documentation, according to, on the internet… |
| `local` | it's about your own things | my / this / that / previous + file, folder, project, code, notes; *there*, *it*, *continue*; a file name like `main.py` |
| `machine` | it's about *this laptop* | "am I running", "installed on my", "my node / python / gpu" |
| `place` | looking for somewhere | a kind of place (`places.js`) + near / nearest / in / to <somewhere> (or phrased as a request) |
| `reasoning` | needs explaining | explain, why, how does, compare, summarise, should I… |
| `question`, `links`, `install`, `showPage`, `implicitSearch` | question form; "search google for…"; "update/install X"; "find/show the docs"; a bare "find X" | — |

**Decision order** (`Decider.decide`, first match wins): explicit search → places → known command → install/update (how-to) → "show me the page" → bare "find X" (laptop search) → your own things → fresh / source (web + AI) → local AI. If a web route is chosen but Online tools is off, it becomes **Offer online**.

**Conflicts.** When signals disagree the order decides, and the **confidence drops to ≤ 0.75** (visible in the inspector): a place beats the generic "open the best web page" ("open the nearest atm" → Maps) but never a real command ("open chrome"); your own files beat place words ("open my restaurant folder"); "latest" / "version" about **this laptop** is local ("what version of node am I running" → the installed version, "the latest file in my project" → the newest files) while about the world it's the web ("the latest python version").

**What it returns:** `{ route, reason, confidence, payload, override? }`. The `payload` is what the route needs, already worked out — for Maps `{ category, location, sort, query }` (`Decider.placeQuery`: *"what are the nearest restaurants to bengaluru(kodigehalli)"* → `restaurants · Kodigehalli, Bengaluru · nearest`), for web routes the search text — so the code that follows never re-reads the sentence.

**Traps it avoids:** the noun "binary **search**" isn't a request to search; `node.js` isn't one of your files; "my **latest** file" is local, not news; "I am at the park" isn't a places search.

**Online tools off:** JARVIS says so and offers **ENABLE ONLINE TOOLS & SEARCH** or **ANSWER FROM MEMORY** (flagged "may be out of date") — it never answers something that changes from stale memory silently.

- **Debug:** turn on *Show how I understood you*; or `Decider.decide(Decider.signals('…', {}), { online: true })` in the console; in plain Node `const D = require('./decider.js')`. `tests/decider.test.js` (96 checks, ~30 of them conflicts).
- **Extending:** a new kind of place → add the word to a group in `places.js` (data only). A new route → `decide()` branch + `LABEL` + a branch in `handleUser` + tests.

### 11.5 Acting on your laptop — execution, permissions, undo

- **`executeTool(p)`** (`script.js`) is one large `switch` on the intent. Each `case` parses its details from the text/`args`, calls the server with `callTool('/tool/…')`, records focus and an undo step, and returns `{ text, speak, suggestions, actions, … }`.
- **`callTool` / `callToolRaw`** post JSON to `/api/…`. When the server answers `409 { needsApproval }` the page shows an **ALLOW / CANCEL** card (`askApproval`) and, if you allow, repeats the call with `approved: true`. For the most dangerous actions, when Windows Hello is enabled, the page also attaches a freshly signed Hello token (`X-Hello-Token`) that the server verifies itself.
- **Server-side checks** (`server.js`), in this order for any file operation: argument validation → **path resolution** (`safePath` for plain names in `~/jarvis` and your project folders, `anyPath` for full paths, `scopeDir` / `whereDir` for "D drive" / "desktop") → **access zone** (`blockedPath` / `zoneOf`: *home* free, *laptop* needs approval, *blocked* refused) → `approvedChange` → the actual operation. Overwrites keep the old version in `~/jarvis/.trash`.
- **Permission tiers** (`agent-tools.js`): *safe* (runs), *confirm* (asks with the reason), *explicit* (its own confirmation every time, never in routines), unlisted = refused. `INTENT_TIERS` covers rule-engine intents; `TOOLS` carries argument schemas for the AI/planner. Invented tools, `../` paths, "volume 999" and shell commands are rejected here.
- **Verification** (`check:` in `agent-tools.js`, `Agent.watchSingle`): after an action the page re-checks reality where it can (app really started, to-do exists, volume reads back); steps that can't be checked show *○ not checked*, never a fake ✓.
- **Undo** (`undo.js`): a stack of `{ label, fn }` (last **40** actions, **30 minutes**). Handlers push a function that reverses what they did (restore a backup, move back from the trash, reopen an app…). "Undo that task" reverses a whole plan run, newest first.
- **Debug:** ☰ log `tool` lines show each call; the browser Network tab shows the request/response (`403` = off-limits, `409` = approval, `400` = invalid argument); `GET /api/agent/tools`; `tests/api.test.js` (every route on an isolated server), `tests/undo.test.js`.

### 11.6 The AI layer — `llm.js`, `server.js`, `script.js`

- **Providers (`llm.js`):** Ollama (local), OpenAI-compatible endpoints (OpenAI, Gemini, Groq, custom URLs) and Anthropic. A model id like `gemini::gemini-2.5-flash` selects the provider; no `::` means Ollama. `llm.complete` (one answer) and `llm.openStream` (streaming) hide the differences; replies are re-emitted as NDJSON `{ message: { content } }` so the page reads them one way.
- **Chat (`POST /api/chat`):** the page sends the last ~12 messages, a **rolling summary** of earlier ones, and `llmContext()` (your name, remembered facts, tasks, persona, language, `focusSummary()`). The server builds the **system prompt** (`buildSystemPrompt`): personality, behaviour rules, the **tool catalogue**, length rules.
- **Honesty rules in the prompt:** it can't create, save, open or run anything by writing a reply — it must never claim it did; for "build me an app" it points to the website builder / JARVIS Code; for current facts it must say it doesn't know rather than invent. Code requests get a larger token budget so a whole page isn't cut off.
- **Tool calls:** if an action fits, the model replies with exactly one line `<<tool_name {"arg":"value"}>>`. The page maps it (`LLM_TOOLS`), the server **validates** it (`POST /api/agent/validate`: known tool, argument schema, tier), and only then does it run — through the same `executeTool` as a typed command. A **refused** call (e.g. a missing argument) runs nothing; JARVIS asks the model again for a plain answer without tools instead of giving up.
- **The planner** (`POST /api/agent/plan`) is a separate, stricter call: temperature 0, JSON only, ≤ 5 steps, a `Context:` line carrying `focusSummary()`.
- **Web answers:** the model is asked to answer **only from the fetched pages** and cite `[1] [2]`; for things that change it is told never to answer from memory.
- **Debug:** `GET /api/llm/status` (providers, models, errors); the model name in each reply header; ☰ log `AI tool call rejected: …`; `tests/llm.test.js`.

### 11.7 Web, places and Online tools — `script.js` (`doResearch`), `server.js`

- **Gate:** anything JARVIS itself fetches needs **Online tools**. Opening a page or Maps in *your* browser doesn't.
- **`doResearch(query)`:** `POST /api/tool/research` → `webSearch` (Bing's no-JavaScript results first; if they look irrelevant — scored by how many of the question's key words appear — it retries with DuckDuckGo, then with reworded variants; results cached for 10 minutes) → fetches the top pages (`pageText`, 6 s, capped) → if the AI is available, `askLLM` answers only from them with a **Sources** list; if the results don't even mention the question's key words for something that changes, it says so instead of answering from memory; with the AI off it lists the top links.
- **Maps:** the decider's `MAPS` route opens `https://www.google.com/maps/search/<query>` through `/api/tool/openUrl`; the reply shows PLACE / WHERE / SORT. ("Nearest" goes into the search words — Maps doesn't allow forcing a sort order by link.)
- **Other online tools:** weather (`wttr.in`), directions & distance (OpenStreetMap), contests (Codeforces / LeetCode / CodeChef), translation and neural voices — each says what it sends.
- **Debug:** the inspector's *Route* (*web search → local AI answers from the pages*); `POST /api/tool/research` in Network; `tests/websearch.test.js`.

### 11.8 Your files — the laptop index, search and RAG

- **Laptop file index** (`server.js`: `buildFileIndex`, `fileIndex`): a background list of every file and folder **name** on your home folder and every drive (never contents; Windows, Program Files, AppData, hidden / `$` entries and build folders like `node_modules` and `.git` skipped). Built ~15 s after start, rebuilt every 30 minutes, held in memory as parallel arrays (`paths`, `low`, `sq` (squashed), `dirs`). Status: `GET /api/fileIndex/status`.
- **Finding by name** (`laptopSearch`, `findAnywhere`): a quick bounded scan of Desktop / Documents / Downloads / OneDrive / home / drives first, then the index; results cached 30 s; several matches → numbered **OPEN 1 / OPEN 2** choices.
- **Counting & listing** (`POST /api/tool/folderStats`, `/listFiles`): "laptop" and drives come from the index; a single folder is counted live from disk. `scopeDir` understands "my laptop", "D drive", "d:", "desktop", full paths.
- **Newest files** (`/api/tool/recentFiles`): a bounded walk sorted by modified time.
- **RAG — asking your files** (`rag.js`, `pdftext.js`, `doctext.js`): a local **hybrid index** of text, code, PDF (Mozilla pdf.js) and Office files: keyword ranking fused with optional semantic search (an Ollama embedding model). A file watcher + 30-second scan keep it current. `ASK_FILES` retrieves the best excerpts and the AI answers only from them, with file + page / line sources.
- **Debug:** `GET /api/fileIndex/status` (`ready`, `count`, `perRoot`); `tests/rag.test.js`; "reindex my files".

### 11.9 JARVIS Code — `jarviscode.js` (server), `codepanel.js` (page)

```
 you ─► JARVIS CODE tab ─► [Build | Plan | Ask] + folder (＋ → Windows folder picker) + model
                │
                ├─ POST /api/code/generate   server reads the project (file tree + small text files),
                │                            keeps the last ~8 messages, asks the model, and PARSES the answer
                │                            === FILE: path === … === END ===   (fallback: plain ```html/css/js blocks;
                │                            then one retry that spells out the format)
                │                            → returns files WITHOUT writing anything
                └─ POST /api/code/apply      cleanRelPath() on every path (no .., drives, node_modules) →
                                             anyPath(forWrite) → approvedChange (ALLOW card outside ~/jarvis) →
                                             backups of changed files → writes → Undo entry → opens index.html
```
- **Own conversation:** its own tab, saved separately (`jarvis.codeChat`), so coding never mixes with normal chat. "yes / proceed / okay build it" right after a **Plan** builds that plan (switching to Build); the page strips JARVIS's own labels before sending history so the model doesn't copy them.
- **Why it's safe:** the model only returns *text*; every path is re-checked server-side; nothing is written until the file list is applied (and approved if outside `~/jarvis`).
- **Debug:** the reply shows each file and its line count; `tests/jarviscode.test.js` (parsing, fallback, path safety); `POST /api/code/generate` with `mode: "plan"` is a harmless dry run.

### 11.10 Automation in the background — `scheduler.js`, `triggers.js`, `routines.js`

- **Server-side jobs** (`scheduler.js`, run by the server, **work with no tab open**): reminders and deadline alerts (`fireDue`, `nextOccurrence` for repeats), the **triggers watcher** (samples sensors — power / battery, Wi-Fi, running apps — and fires on *changes*, at most once per 10 minutes), built-in **charger plugged / unplugged** announcements, the weekly digest, ntfy phone alerts and phone-command intake.
- **Live events:** the server pushes events to every open tab over **Server-Sent Events** (`GET /api/events`: reminder fired, trigger fired, charger event…, with a heartbeat every 25 s); triggers that fired while no tab was open (less than 10 minutes ago) run as soon as a tab connects.
- **Page-side:** routines and phone *commands* are executed by the page (they use the same `executeTool` pipeline), which is why they need a tab open. Routines and triggers run **unattended**, so only steps that need no permission run.
- **Panic mode:** pauses deadline alerts, the digest, reminder alerts and triggers; alerts that fire while paused are remembered.
- **Debug:** ☰ log; the Tasks tab (reminders, triggers); `tests/scheduler.test.js`, `triggers.test.js`.

### 11.11 State, sync and the offline shell

- **Your data** lives in `~/jarvis/.jarvis-state.json` — chat, memory, tasks, reminders, flashcards, routines, triggers, settings and more, as `jarvis.*` keys (e.g. `jarvis.settings`, `jarvis.chat`, `jarvis.codeChat`, `jarvis.code`, `jarvis.flashcards`).
- **Flow:** the server injects the current state into the page (`/api/state.js` → `window.JARVIS_STATE`); the page's `store` wrapper reads from that cache, writes are **batched** and posted to `POST /api/state`, and other tabs pick changes up — so every browser and port shows the same data. Without the server it falls back to `localStorage`.
- **One copy:** `instance.js` keeps a lock (`~/jarvis/.jarvis.lock`, pid + port) so starting JARVIS twice reuses the running copy.
- **Service worker** (`sw.js`): caches the page shell (`SHELL` list) under a `VERSION` name. **After changing any front-end file, bump `VERSION`** (and add new files to `SHELL`) or browsers keep the old copy.
- **Debug:** `GET /api/health`; `~/jarvis/.launcher.log`; DevTools → Application → Service Workers → *Unregister* (or **Ctrl+Shift+R**).

### 11.12 Output — `deliver`, `renderReply`, `tts.js`, `persona.js`

- `deliver(result, p)` is the single exit: it adds JARVIS's voice to rule-based replies (`Persona.jarvisify`, skipped with `noPersona`), translates for Telugu / Kannada, and queues the reply. `pump` → `renderReply` shows it with a typing effect (`typeMD`), speaks it (`speak` → browser voice, or `tts.js` neural voices), and adds cards, ALLOW/CANCEL rows, action buttons and suggestion chips.
- The reply header (`INTENT · tool() · confidence`, or `LOCAL AI · model · seconds`) tells you which path produced it.
- Every reply is saved to the chat log (`logChat`), which is what survives a reload.

### 11.13 The inspector — seeing a decision

When **Settings → Show how I understood you** is on (or you ask "how did you understand that?"), a **🔍 How I understood this** block appears under the reply. It is built from `turnTrace`, which `handleUser` fills as it goes (`noteTrace`, `traceRoute`):

| Row | Meaning |
|---|---|
| You typed / said · Mic heard | the input, and what the recogniser gave before repair |
| Read as | the normalized text the rules saw |
| Intent · confidence | which rule matched and how sure it is (`CONVERSATION 0.50` = no rule matched) |
| Details | arguments the rule pulled out |
| Place / Location / Sort / File name / Project … | what a handler worked out (`noteTrace`) |
| Context | what `ctx.focus` held at that moment |
| **Decision · Signals** | the route, its confidence and reason; fresh / source / local / reasoning / question ✓✗ |
| Route | which path actually produced the answer |
| Permission | the tier and why |
| Time | total milliseconds |

### 11.14 Adding to JARVIS — a checklist

**A new command** ("what time is sunset"):
1. `nlu.js` — add a rule to `R`: `['SUNSET', /regex/, 0.93, 'sunset']` (mind the order — first match wins; keep it above any broader rule that would catch it).
2. `script.js` — add `case 'SUNSET':` in `executeTool`; call the server with `callTool`, record `setFocus` / `Undo.push` if it changes something, return `{ text, speak, … }`.
3. `server.js` (or a module) — add the route; validate every argument; use `approvedChange` for anything that writes outside `~/jarvis`.
4. `agent-tools.js` — add the intent to `INTENT_TIERS` if it isn't *safe*; add a `TOOLS` entry (+ `LLM_TOOLS` in `script.js`) if the AI and planner should be able to use it.
5. Tests — phrases in `tests/coverage.test.js` (it fails if an intent has none), the route in `tests/api.test.js`, edge cases in `reliability.test.js` / `decider.test.js`.
6. Docs & shell — a line in this README, and bump `VERSION` in `sw.js`.

**A new kind of place:** add the word to a group in `places.js`. **A new decision route:** `Decider.decide` branch + `LABEL` + a branch in `handleUser` + `decider.test.js`.

### 11.15 App lock — `applock.js`, `lock.html`, `lock-client.js`

```
 browser ──► GET /  ──► gate (applock.js, mounted BEFORE the static files and every route)
                         │
        unlocked? ───────┤  yes: no lock set up, or a valid session cookie ─► the normal app
        (lock on + a Hello key + a live session cookie)
                         │  no:   GET /  →  lock.html (standalone: no app code loads)
                         │        /api/* →  401 { locked: true }   (except the few routes needed to unlock)
                         ▼
   lock.html ─► POST /api/hello/challenge {purpose:"unlock"} ─► navigator.credentials.get() ─► Windows Hello
             ─► POST /api/lock/unlock {signed assertion} ─► hello.js verifyChallenge() ─► Set-Cookie jarvis_session_<port>
             ─► reload ─► the real app
```
- **The gate** (`applock.js` `gate`) runs first. It is active only when `config.appLock.enabled` **and** a Windows Hello key exists (so removing the Hello key can never lock you out). A request passes with a valid session cookie. Otherwise `GET /` and `/index.html` get `lock.html`, anything under `/api` is `401 { locked: true }` (paths are normalised like Express routes them — `/API/STATE.JS`, `/api//state.js`, `/api/state.js/` are all refused), and only `GET /api/health`, `GET /api/lock/status`, `GET /api/hello/status`, `POST /api/hello/challenge` and `POST /api/lock/unlock` stay reachable. App scripts, styles and images are not data, so they're still served.
- **Unlocking reuses the existing Windows Hello code.** `hello.js` exposes `verifyChallenge(body, purpose)` (a single-use challenge, a signature checked against the enrolled key, `userVerification` required, origin and relying party pinned to `localhost`); `/api/hello/verify` and `/api/lock/unlock` both call it. An approval for another purpose (say, shutdown) can't be used to unlock. Failed attempts are rate-limited (8 per minute).
- **Sessions** are random 256-bit tokens kept **in memory only** (`Map` in `applock.js`), sent as an `HttpOnly; SameSite=Strict` cookie named for the port. A server restart clears them — JARVIS is locked after every start.
- **Auto-lock:** the page (`lock-client.js`) pings `POST /api/lock/ping` on real use (typing, clicking, a spoken command — throttled to once per 20 s); background polling does not count. A session idle longer than the chosen time is dropped; the page notices (status check every 30 s, or any `401`) and reloads into the lock page. `lock-client.js` also wraps `fetch` so any `401 { locked: true }` reloads.
- **Turning it on/off** (`POST /api/lock/enable` / `disable`) is a *guarded* route in `hello.js` (purpose `lock`): it needs a fresh Windows Hello approval token, like shutdown and delete. Enabling also signs the person who enabled it in.
- **"lock jarvis" / "lock yourself" / "lock the app"** → intent `LOCK_JARVIS` (`nlu.js`); it reads the raw text because the wake word is stripped ("lock jarvis" would otherwise become "lock", the *Windows* screen lock). "lock the screen" / "lock my laptop" still lock Windows.
- **Debug:** `GET /api/lock/status` (`enabled`, `active`, `locked`, `idleMin`, `helloEnrolled`); a locked page's Network tab shows `401 { locked: true }`; `tests/applock.test.js` (54 checks: path tricks, forged and replayed signatures, wrong-purpose approvals, idle expiry with a fake clock, no-lock-out). **Locked out of everything?** Stop JARVIS, remove the `"appLock"` (and/or `"hello"`) entry from `~/jarvis/.config.json`, start again.

---

## 12. Project structure

| File | Role |
|---|---|
| `Start JARVIS.bat`, `start.ps1` | One-click launcher: Node check, first-time install, free port, desktop shortcut, opens the browser. `-Silent` (used by the desktop icon) runs the server hidden in the background with no terminal window |
| `jarvis-silent.vbs` | The no-window entry point the desktop/Startup shortcuts point to |
| `Stop JARVIS.bat`, `stop.ps1` | Ends the background server (the pid in the lock file; the fallback only stops a Node process running JARVIS's `server.js`) |
| `instance.js` | One JARVIS per user: the lock file, stale-lock replacement, the remembered port |
| `AGENTS.md` | Notes for AI coding tools: JARVIS lives at one address; never start a second copy |
| `server.js` | Express server: security checks, file access zones and approvals, the laptop-wide file index, "did you mean" name matching, folder counts, apps, system tools, run code, dev servers (start/stop, health probe, dependency install), web lookups, state storage, module wiring |
| `llm.js` | AI layer: Ollama, OpenAI-compatible and Anthropic providers, streaming, retries, provider keys & routes |
| `agent-tools.js` | Tool registry: argument schemas, permission tiers, refusals, AI planner |
| `scheduler.js` | Server-side reminders & deadline alerts, triggers watcher, ntfy phone alerts/commands, live events to tabs |
| `system-tools.js` | Windows controls: brightness, theme, volume, Wi-Fi/Bluetooth, windows, screen OCR & vision, browser-tab switching, the Windows folder picker, clipboard history |
| `codetools.js` | "Ask a coding AI in a folder": editor chats, terminal agents, desktop apps |
| `jarviscode.js`, `codepanel.js` | JARVIS Code: generate files with the AI (Build / Plan / Ask), path checks, writing with approval and backups (server) · the JARVIS Code tab, composer, folder picker and its own conversation (page) |
| `rag.js`, `pdftext.js`, `doctext.js` | Local hybrid search over your notes/code/PDFs/Office files; PDF & Office text extraction |
| `update.js` | Update check against GitHub Releases (click-to-run) |
| `skills.js`, `skills-page.js` | Website generator (any folder, or a project's frontend), UI design prompt (TCREI), DSA coach, viva practice, code fixer (server + chat side) |
| `backup.js` | Export/import, encryption of secrets, snapshots |
| `hello.js` | Windows Hello (WebAuthn) approvals |
| `thresholds.js`, `boot-cinema.js/.css`, `transitions.js/.css`, `hud-overlay.js/.css`, `dashboard.js/.css`, `learn.js`, `nlu-qwen.js`, `face-greet.js`, `gesture.js` | Optional extras (see *Looks, camera & extras*): central alert thresholds, boot animation, state-change effects, HUD overlay, DIAG dashboard, pattern learning, Qwen NLU assist, face greeting (server-side match), hand gestures |
| `portwatch.js`, `ocr.js` | Server modules: new-listening-port watcher · OCR from any image (Windows OCR with a Tesseract fallback) |
| `applock.js`, `lock.html`, `lock-client.js` | The app lock: the server gate that keeps JARVIS closed until Windows Hello is verified · the standalone lock page · the page's side (reload when locked, activity pings for the auto-lock) |
| `autostart.js` | "Start with Windows": creates/removes the Startup link |
| `phoneauth.js` | Authenticator codes (TOTP) for phone commands |
| `hotkey.js` | Global Ctrl+Shift+J helper |
| `palette.js` | Ctrl+K command palette and the "/" skills menu |
| `decider.js`, `places.js` | The decision engine: direct tool, your local things, Maps, opening a page, the local AI, or the web — from plain signals, with a reason, payload and confidence · the kinds of places it recognises (data) |
| `manifest.webmanifest`, `sw.js` | PWA install: own window, Start-menu icon, offline app shell |
| `tts.js` | Neural voices |
| `voice.js` | Utterance collector: waits until you have finished speaking (and for the recogniser's final words) before sending your sentence |
| `speechfix.js` | Repairs commonly misheard command words and picks the best of the recogniser's alternatives |
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

43 suites check every feature, not just the phrases:

| Suite | Checks | What it covers |
|---|---|---|
| `coverage.test.js` | 377 | Every command JARVIS has (180) is understood from its test phrases; fails if a new command has none |
| `api.test.js` | 198 | Every server route (144) on a real, isolated server: files and access zones, projects (including recognising a crash on missing dependencies vs. a code bug, and whether a started server really answers on its port), weather parsing against a fake wttr.in, git, backup, reminders firing, phone codes, security; routes that would act on the laptop are listed with the reason instead |
| `e2e.test.js` | 289 | The real page in headless Edge/Chrome: ~50 end-to-end flows (to-dos, reminders, focus, weather replies and their web-search fallback, attendance, marks, routines, triggers, multi-step plans, "there" / "open it" / "the second one", "did you mean…?", saving code into a new folder…) plus every command run through the chat, with laptop actions faked. Without Edge/Chrome or on Node < 22 it is shown as **NOT RUN** (never as ✓) |
| `live.test.js` | 11 | Opt-in (`npm run test:live`) reversible checks on the real laptop |
| `nlu.test.js` | 281 | Understanding commands (intents, typos, dates, languages) |
| `agent.test.js` | 74 + 132 | Multi-step routing and safety (validator, refusals), the execution inspector card, undo tagging of plan runs |
| `llm.test.js` | 66 | AI providers, streaming, retries, key handling (with a fake server) |
| `student.test.js` | 60 | Attendance & bunk maths, marks → SGPA/CGPA, monthly/yearly repeats |
| `codeask.test.js` | 58 | Coding-AI phrases, safe command building |
| `skills-page.test.js` | 51 | Website / coach / viva conversations |
| `reliability.test.js` | 84 | The presentation review: many wordings → one intent (create/count/list folders, frontends, saving code), misheard speech repaired (and ordinary sentences left alone), "did you mean" ranking, the frontend-for-a-project flow |
| `decider.test.js` | 96 | The decision engine: ~45 requests → each route, ~30 **conflicts** (action + place, local + fresh, this-laptop + version, show vs explain, statements), place reading (category / location / sort), Online-tools-off offers, payloads, confidence, a reason for every decision |
| `jarviscode.test.js` | 20 | JARVIS Code: the AI's answer → files, the plain-code-block fallback, paths that must never leave the project |
| `backup.test.js` | 44 | Export/import, encryption, hostile files, snapshots |
| `skills.test.js` | 38 | Page generation safety, coach, viva grading, code fixer |
| `hello.test.js` | 31 | Windows Hello verification and guarded routes |
| `applock.test.js` | 54 | The app lock on a real server with a software-signed Windows Hello key: every way round the gate (path spellings, forged / replayed / wrong-purpose signatures, other ports' cookies), unlock, lock now, turning it off, idle expiry on a fake clock, the no-lock-out guarantee |
| `thresholds` · `facegreet` · `gesture` · `learn` · `ocr` · `portwatch` · `transitions` · `dashboard` | 56 · 33 · 22 · 26 · 15 · 18 · 18 · — | The optional extras: alert thresholds, face-greeting routes (enroll, validation, server-side match) and module, gesture recognition logic, pattern learning, OCR routes, the port watcher, transition effects, the dashboard endpoint (the dashboard suite needs the optional `systeminformation` package — `npm install` — and fails without it) |
| `triggers.test.js` | 35 | Trigger parsing, edges, cooldowns, charger announcements |
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
| `voice.test.js` | 28 | Waiting for the end of a sentence and for the recogniser's final words, tap-to-send, Telugu/Kannada collection |
| `wakeword.test.js` | 19 | Background wake-word listener protocol |
| `websearch.test.js` | 11 | "Open X website" picks the right result (not a look-alike) |
| `autostart.test.js` | 15 | Start with Windows |

`node tests/agent-eval.js` additionally measures the AI planner live against Ollama.

---

## 14. Troubleshooting & FAQ

### Debugging guide

Start here when something misbehaves. Every part of JARVIS can be inspected without special tools.

**Your four instruments**

| Instrument | How | Shows |
|---|---|---|
| **Inspector** | Settings → *Show how I understood you* (or ask "how did you understand that?") | what was heard, the intent and confidence, extracted details, context, the **decision** and its reason, the route taken, the permission tier, timing |
| **Activity log** | the **☰** panel (top left) | one line per step: `input (voice): "…"`, `heard "…" → understood "…"`, `intent: X · conf 0.94`, `tool` calls, warnings (`AI tool call rejected: …`), errors, `turn complete in 812ms` |
| **Browser console / Network tab** | `F12` on the JARVIS page | the live objects (below) and every request to `/api/*` with its status and JSON |
| **Server** | `GET /api/health`, `~/jarvis/.launcher.log`, or run `npm start` in a terminal | whether the server is up, and its output |

**Live objects you can poke at** (type these in the browser console on the JARVIS page):

```js
NLU.classify(NLU.normalize('open the agri look folder', 'jarvis'), {})     // what the rules make of a sentence
Decider.decide(Decider.signals('what is the latest node version', {}), { online: true })   // which route, and why
SpeechFix.fix('create a front and for calculator')                         // what the mic-repair does
ctx.focus                      // what "there", "it", "the second one", "same project" mean right now
ctx.pending                    // a question JARVIS is waiting for you to answer
settings                       // every setting (settings.online, settings.inspect …)
llm.model                      // which AI model is answering
```

The same checks work without a browser (this is how the tests load the code):

```bash
node -e "eval(require('fs').readFileSync('nlu.js','utf8')+';global.NLU=NLU;'); console.log(NLU.classify(NLU.normalize('open chrome','jarvis'),{}))"
node -e "const D=require('./decider.js'); console.log(D.decide(D.signals('nearest atm',{}),{online:true}))"
```

**Symptom → likely cause → where to look**

| Symptom | Likely cause | Look at |
|---|---|---|
| It answers like a chatbot instead of doing the thing | no rule matched: inspector shows `CONVERSATION · confidence 0.50` | add a rule in `nlu.js` + phrases in `coverage.test.js` (see [11.14](#1114-adding-to-jarvis--a-checklist)); try the phrase in the console with `NLU.classify` |
| It does the **wrong** thing confidently | an earlier or broader rule matched first (rules are first-match); or a stage before the classifier took it | inspector *Intent* and *Route*; find the earlier rule in `nlu.js` `R`; check skills / routines / agent goals (stages 7–10 in [11.2](#112-one-request-step-by-step)) |
| It searched the web (or didn't) when it shouldn't (should) | the decision engine read the signals differently | inspector *Decision* + *Signals*; `Decider.signals('…', {})` in the console; `decider.js`; add a case to `tests/decider.test.js` |
| "Opening Google Maps / a web page" for something local (or vice-versa) | a conflict between signals (place vs local, action vs place) | inspector confidence ≤ 0.75 = a conflict; the order in `Decider.decide` |
| It says the web is needed but nothing happens | **Online tools** is off | Settings → Online tools; the reply offers **ENABLE ONLINE TOOLS & SEARCH** |
| A spoken command comes out wrong, typed works | the recogniser misheard | inspector *Mic heard*; Settings → **Test my mic**; `speechfix.js`; for your own names check `GET /api/voice/vocab` |
| "I can't find …" for a folder that exists | it's new (index rebuilds every 30 min), in a skipped place (hidden, `node_modules`, Windows, AppData), or spelled differently | `GET /api/fileIndex/status` (`ready`, `count`); the *Did you mean…?* list; for a brand-new folder open it by full path |
| "There" / "it" / "the second one" doesn't work | nothing in focus, or it expired (15 min), or two candidates | `ctx.focus`; JARVIS asks which folder when unsure |
| An action says it can't / asks ALLOW | outside `~/jarvis` (needs approval), or a blocked place | Network tab: `409` = approval card, `403` = off-limits; `blockedPath` in `server.js` |
| `AGENT_FAILED` / "The AI suggested an action I can't run safely" | the AI emitted a malformed tool call (e.g. a missing argument) | ☰ log `AI tool call rejected: …`; JARVIS now retries without tools, so you'll see a plain answer plus an inspector note; `agent-tools.js` schema |
| The AI is slow, empty or "offline" | Ollama not running / model still loading / no key for a cloud model | `GET /api/llm/status`; start Ollama; Settings → Guided setup → AI; the first local reply takes about a minute |
| A reply claims it did something it didn't | the AI wrote it (small models sometimes do) — rule-based replies report what a tool actually returned | the reply header: `LOCAL AI · model` means the AI wrote it with no tool; real actions show `INTENT · tool()`; the system prompt forbids such claims |
| JARVIS Code says "didn't return any files" | the model ignored the file format | it already retries once and accepts plain code blocks; try a stronger model or a simpler request |
| A reminder / trigger didn't fire | panic mode on; Online-only trigger; server not running | the ⚠ PANIC pill; `GET /api/health`; Tasks tab; `scheduler.js` |
| The page looks old after an update | service-worker cache | **Ctrl+Shift+R**; DevTools → Application → Service Workers → Unregister; developers: bump `VERSION` in `sw.js` |
| "Backend offline" | the server isn't running | Start JARVIS; `GET /api/health`; `~/jarvis/.launcher.log` |

**Which test covers what** (run one suite with `node tests/<name>.test.js`; everything with `npm test`):

| Area | Suite |
|---|---|
| a phrase isn't understood / is misread | `nlu`, `coverage`, `paraphrase`, `reliability` |
| web vs local vs tool, places, conflicts | `decider` |
| a server route, file zones, approvals | `api` |
| a whole conversation in the real page | `e2e` |
| multi-step plans, permissions, planner | `agent`, `plan` |
| voice collection, wake word | `voice`, `wakeword` |
| JARVIS Code parsing and path safety | `jarviscode` |
| undo, scheduler, triggers | `undo`, `scheduler`, `triggers` |
| the AI layer (fake provider) | `llm` |

`npm run test:report` writes `tests/report.md` (one row per command, plus a checklist for what only you can check: mic, voice, Windows Hello, phone).

**When you find a bug:** reproduce it with the inspector on, copy the *How I understood this* block, write the failing phrase into the matching test **first**, then fix the stage the inspector points at. The pipeline is layered on purpose, so a wrong answer almost always has one culprit.

### Common problems

**The page says "Backend offline".** Start JARVIS (`Start JARVIS.bat` or `npm start`) and open `http://localhost:PORT` — not the `index.html` file.

**Port 3000 is busy.** The launcher picks a free port automatically and remembers it (`~/jarvis/.jarvis-port`); with npm use `$env:PORT=3002; npm start` the first time.

**Different chats on different ports, or the phone (ntfy) app stops responding.** That means more than one JARVIS was running. Since the single-instance lock this can no longer happen from a normal start: starting JARVIS again (desktop icon, `npm start`, an AI tool, VS Code) just reuses the running one. If you ever see two, use **Stop JARVIS** (it stops the copy recorded in `~/jarvis/.jarvis.lock`) and start once. `JARVIS_ALLOW_MULTI=1` turns the guard off; only tests use it.

**"AI brain offline" / no answers to questions.** Start the Ollama app (or add an API key via Settings → Guided setup → AI). The first local reply takes about a minute while the model loads.

**Answers are slow or weak.** Small local models are limited on laptop GPUs. Add a cloud key (Gemini and Groq have free tiers) and pick it under **Model**.

**The mic doesn't work.** Use Chrome or Edge, allow microphone access, and keep an internet connection (browser speech recognition is online). **Settings → Voice check** shows what your browser supports.

**No voice / robotic voice.** Use Edge for the best built-in voice, or turn on **Neural voice**.

**My phone unlock code is "wrong".** Use **Settings → Phone alerts → Check** on the laptop. If it says "different key", delete every "JARVIS" entry in Google Authenticator and scan the QR again (Guided setup → PHONE → step 3). JARVIS must be running.

**Phone commands say "JARVIS isn't open".** Commands run in the page — keep a JARVIS tab open on the laptop. (Questions work without it.)

**JARVIS opens a lock page and Windows Hello won't verify (or I turned the lock on and lost access).** The lock needs the Windows Hello key JARVIS enrolled. Stop JARVIS (`Stop JARVIS.bat`), open `~/jarvis/.config.json`, delete the `"appLock"` entry (and the `"hello"` entry too if Windows Hello itself is the problem — the lock then stands down on its own), and start JARVIS again. Unlocking works at the laptop only: open `http://localhost:PORT` (not `127.0.0.1`, not the phone/Tailscale address) in Chrome or Edge.

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
- The app lock unlocks at the laptop only (Windows Hello is localhost-only), so the phone/Tailscale page can't be unlocked while it is on; and JARVIS can't check your Windows account *password* — Windows Hello (your fingerprint, face or Windows Hello PIN) is the lock's key.
- Screen OCR is English only.

---

## 16. License

MIT — see `package.json`. Third-party: Express, unpdf (Mozilla pdf.js), qrcode-generator (MIT), Google Fonts via Fontsource.
