<div align="center">

# J.A.R.V.I.S. — your own AI assistant, on your laptop

**Talk or type. JARVIS opens your apps, plans your study, reads your notes and PDFs, fixes your code and automates your day — with a local server, local AI options and optional online services.**

Voice & chat · English / తెలుగు / ಕನ್ನಡ + limited Hindi/Hinglish commands · Local AI (Ollama) or your own API key · Windows

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

Recent additions — [current availability](#implemented-features-and-current-availability) · [immersive mode](#immersive-mode) · [notes and captures](#notes-and-capture-inbox) · [workspace checkpoints](#workspace-checkpoints) · [media and podcasts](#media-player) · [reviewed workflows](#reviewed-workflow-additions) · [account setup](#google-and-microsoft-account-setup) · [Marks preview](#marks-specialist-workspaces-developer-preview) · [background tasks, emergency stop and MCP](#background-tasks-and-mcp).

---

## 1. What is JARVIS?

JARVIS is a **voice and text AI assistant that runs on your own Windows laptop**, inspired by Tony Stark's J.A.R.V.I.S. It is a small Node.js server plus a web page you open in Chrome or Edge.

- A **fast rule engine** understands clear commands instantly ("open chrome", "set a timer for 10 minutes") — no AI needed, works offline.
- Anything casual, misspelled or open-ended goes to an **AI brain**: a local model through **[Ollama](https://ollama.com)**, or a cloud model with **your own API key** (OpenAI, Claude, Gemini, Groq, …). Local inference keeps that model request on your machine; enabled web, voice and connected services have separate network behavior.
- It can **act on your computer**: open any installed app, control volume/brightness/Wi-Fi/windows, read your screen, open and read files anywhere on the laptop (it asks before changing anything outside ~/jarvis), run code, start your dev servers, and hand tasks to coding AIs like Copilot or Claude Code.
- It **understands what you mean**, not just exact commands: misheard speech is repaired ("front and" → frontend), "there" / "that folder" / "open it" / "the second one" refer to what you just saw, and a name you half-remember gets **"Did you mean…?"** with the closest real folders.
- **JARVIS Code** — its own coding chat: describe an app, pick a folder, and JARVIS's AI **writes the files itself** (no copy-pasting).
- It is built for **students and developers**: study planner, flashcards, viva practice, DSA coach, answers from your own notes and PDFs, and a one-click "explain & fix" for crashing programs.
- **Reviewed actions:** a server-side permission list decides what's allowed, risky actions ask first, and selected actions can additionally require **Windows Hello**. Undo covers supported recorded changes; it cannot reverse every OS or provider action.

👉 **The complete list of what JARVIS can do** is in [Highlights](#what-jarvis-can-do--the-full-list); **how it works inside** (and how to debug it) is in [How it works](#11-how-it-works-architecture).

There is also a **cinematic landing page** that introduces JARVIS: open `http://localhost:3002/welcome` (or `http://localhost:3002/landing.html`) while JARVIS is running.

---

## 2. Highlights

| | |
|---|---|
| 🎙 **Voice & chat** | Hold the mic or say the wake word. English, Telugu, Kannada — even typed in English letters ("volume penchu"). Natural neural voices. Two personalities: **JARVIS** and **FRIDAY**. |
| 🧠 **Context & control** | A rolling summary carries the conversation forward — "what were we talking about?" picks the thread back up. JARVIS remembers the folder/file it just showed, so **"create a folder there"**, **"open it"**, **"open the second one"** just work. **"Did you mean…?"** for half-remembered names. **Ctrl+K** or **/** puts every command and skill one keystroke away. Say **"panic"** to pause all automation, **"resume"** to permit new work. |
| 💻 **Controls your laptop** | Opens **any Start-menu app**, volume, brightness, dark mode, Bluetooth/Wi-Fi, power plans, window layouts, screenshots, clipboard tools, screen reading & vision. |
| ◉ **Immersive mode** | Select **Hide controls** for the reactor and conversation. Ask for a calendar, task, note, workspace, app-control or media panel. One panel opens on demand, and the compact player stays available. |
| 🗂 **Capture and resume** | A searchable inbox combines voice notes and Quick Capture. Review entries before creating tasks or reminders. Named workspace checkpoints save your current task, files, links and next step. |
| 🎵 **Music, FM and podcasts** | Queue local audio, tune official city-specific FM streams, subscribe to podcast RSS feeds and resume episodes. Study sessions can play locally generated rain or white noise. |
| 🪟 **App and website actions** | Inspect a Windows application or browser window, then review a click or field fill against its named accessible controls. Each action requires one-time approval for its exact target and text. |
| 🧾 **Documents, data and media** | Create editable DOCX/PPTX/XLSX files, calculate grouped spreadsheet summaries and charts, extract quoted document facts, and resize/crop local images. Optional FFmpeg audio extraction can feed local Whisper. |
| 🔗 **Read-only accounts** | Opt-in Google/Microsoft mail, calendar and file reads with PKCE sign-in, Windows-user encrypted tokens and approval for each request. No email sending or provider writes. |
| 🦾 **Marks preview** | A separate workspace with 23 specialist profiles for desktop actions, read-and-draft jobs, batch files, reusable text tools, memory and watches. Developer preview only; hidden and disabled in a normal launch. |
| 📚 **Study** | Tasks, deadlines, timetable, reminders, focus sessions, **multi-day study planner**, progress dashboard, flashcards with spaced repetition, **viva practice** by voice, contests and web research. **Attendance with a 75% bunk-o-meter** (asks “did you attend?” after each class), marks → SGPA/CGPA, **assignments from a photo**, a study plan fitted to your timetable, an end-sem marks calculator, **lecture mode** with optional **offline Whisper** transcription. |
| 🧰 **Everyday life** | Expenses with a chart, habit streaks, quick-capture inbox, **keep JARVIS running** after a crash, a plain **backup to another drive**, **screenshot search** by the text inside them, **WhatsApp drafts, movie/bus ticket hand-offs and shopping searches**, and developer helpers (git summary, standup, commit message, “why did my build fail”). |
| 📄 **Your files & notes** | Drop in PDFs, notes, **.docx / .pptx / .xlsx** and ask questions — **hybrid keyword + semantic search**, answers with **page numbers**. Summaries and flashcards from any file. |
| ⌨ **JARVIS Code** | A coding chat of its own (**JARVIS CODE** button): pick a project folder in the Windows folder picker, choose **Build / Plan / Ask** and a model, describe what you want — JARVIS writes real files into the folder, opens the page, and **undo** takes it back. |
| 🛠 **Coding** | Write → save → run code, **EXPLAIN & FIX** crashes in one click, **DSA coach** (hints before solutions), **website generator**, "open VS Code in *folder* and tell Copilot to…", and **dev environments that recover from failures** (missing dependencies → install → restart → verify). |
| ⚡ **Automation** | Multi-step commands, **routines**, **triggers** ("when I plug in my charger…"), a **global hotkey** for any selected text, reminders that fire even with the tab closed. |
| 📱 **Phone & calling** | Pair the Android companion through the separate HTTPS Phone Hub gateway. View device pairing and permissions at `/phonehub.html`; receive reminder/deadline notifications, use the Android speech → JARVIS reply → speech flow, and explicitly request a real outbound phone announcement call. The gateway is off by default and exposes only allowlisted routes. Remote Phone Hub access can use an explicitly configured Tailscale interface; see [Phone Hub setup](docs/PHONE-HUB.md) and [Calling setup](docs/CALLING.md). Android background notifications currently use WorkManager polling; physical-device end-to-end testing is still required. |
| 🔐 **Permissions & privacy** | Loopback server, exact action approvals, optional Windows Hello, supported undo and encrypted backup exports. DPAPI credential storage is opt-in for existing model keys; cloud requests authenticate to their selected providers. |


### Implemented features and current availability

This README describes the repository and the existing app at **http://localhost:3002**.
Implemented features can still need opt-in settings, installed software or account
setup. The following read-only status snapshot was checked on **2026-11-19**;
it is not a permanent statement about your settings.

| Feature | Observed on this running copy | Where to use or enable it |
|---|---|---|
| Main JARVIS | Online on port 3002 | Dashboard and desktop JARVIS shortcut |
| Standard desktop inspection/click/fill | Windows adapter supported; individual apps must expose controls | **Apps**; review each action |
| Extended native actions | Supported, disabled | **Apps → Enable selection, toggles, scrolling and expansion** |
| Isolated browser | Supported, disabled, no session running | **Apps → Background tasks and MCP tools → Isolated browser controls** |
| Reviewed Node/Python scripts | Disabled | **Apps → Background tasks and MCP tools → Documents, data, images and reviewed code → Reviewed standalone code** |
| Google/Microsoft accounts | Neither configured nor connected | Account panel in **Apps**; see setup below |
| Encrypted credential vault | Windows DPAPI supported; migration not yet performed | Account panel → reviewed credential migration |
| Local media workflows | Image processing available; Whisper installed; FFmpeg unavailable | Install/configure optional dependencies before audio extraction |
| Emergency stop | Ready; global shortcut disabled | **Apps → Background tasks and MCP tools** |
| Marks | Disabled, no profiles exposed in the normal UI | Explicit developer-preview configuration; see Marks below |

Installed software and status checks do not prove microphone quality, real account
access, physical hotkeys or every application workflow. The [capability report](docs/IMPLEMENTATION-PROGRESS.md)
records implementation gaps and live verification requirements.

### What JARVIS can do — the full list

The capabilities below are implemented in this repository. Availability depends on your operating system, connected services, installed models and application support. The phrases are examples you can type or say; the details and setup are in [Features](#7-features), and the implementation is described in [How it works](#11-how-it-works-architecture).

**🗣 Talk to it**
- **Type or speak.** Hold the mic or `Space`, or say the wake word ("Jarvis") hands-free — even while you're in another tab or app. Replies are shown, streamed and spoken (browser voices or neural voices).
- **Languages.** English, Telugu and Kannada, including existing Romanized command handling. Limited Hindi/Hinglish command mappings also recognize phrases such as `Chrome kholo`, `वॉल्यूम ३० करो` and `5 minute ka timer lagao`; this is narrower than full Hindi conversation or microphone support.
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
- **Two research modes:** **Search Mode** retrieves and ranks web evidence and shows extracted passages with source links using zero LLM calls; **AI Research Mode** searches first, then synthesizes the retrieved evidence with a local Ollama model and inline citations. Research mode persists between turns; say “turn on Search Mode”, “switch to AI Research Mode”, or “what research mode is active?”
- **Places:** "nearest restaurants to Kodigehalli, Bengaluru" → Google Maps with the category, location and sort worked out.
- **Open or search:** "search google for…", "find react documentation" (opens the page), sites it knows, YouTube, weather, directions and distance, units and conversions, CS calculators (binary, hex, xor, complexity).
- **Research mode controls:** “turn on Search Mode” (no LLM calls), “switch to AI Research Mode” (web evidence + local model), “what research mode is active?”, and “turn off Search Mode” (returns to AI Research Mode).
- **Emotional intelligence controls:** “turn on emotional intelligence” / “turn off emotional intelligence” — persistent preference, enabled by default. It distinguishes frustration directed at JARVIS from academic or coding stress, carries relevant tone only across immediate follow-ups (no permanent mood profile), uses a calmer/slower spoken rate without overwriting your saved voice speed, and suggests one practical next action when a message signals overload.
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
- **Multi-step commands:** "open VS Code, create a folder DSA and start a 25 minute focus" — previewed, validated by the server and inspectable afterwards, with **RETRY / CONTINUE / ROLLBACK** where supported. Steps distinguish verified results from accepted-but-unverified actions.
- **Routines:** built-in (study mode, morning, bedtime, leaving), your own, and scheduled ("run my morning routine every day at 7am").
- **Routine builder** — Tasks tab → ROUTINES → **＋ NEW ROUTINE** (or **EDIT** on any routine): a name, one step per line the way you would say it, and an optional schedule (“every day at 9am”). As you type, each step shows what JARVIS will do with it (✓ open application, ✓ focus start…) and a step it does not know by itself is marked **?** before you save. SAVE makes or changes the routine and its schedule with one “undo”; a name that is already taken or a schedule it cannot read is refused with the reason.
- **Triggers:** "when I plug in my charger, start study mode", "when the battery drops below 20%…".
- **Global hotkey:** select text in any app → explain / summarise / rewrite / translate / fix code.
- **Smart alerts & panic mode:** low battery, high RAM, deadlines; say "panic" to pause all automation, "resume" to continue.
- **Undo:** "undo" reverses supported recorded changes (last 40 actions within 30 minutes), including reversible steps from a multi-step plan. Sent notifications, app launches and arbitrary code side effects are not universally reversible.

**📱 Phone**
- Reminders and alerts on your phone (**ntfy**), and phone commands that unlock with a 6-digit **authenticator code**; the full page over **Tailscale**.

**🔐 Safe, private, yours**
- A **server-side permission list** decides which registered tools run; risky actions ask first and selected actions can require **Windows Hello**. File tools refuse protected system-directory paths. This does not turn separately approved native scripts into an OS sandbox.
- **App lock:** switch on *Lock JARVIS* and it opens only after **Windows Hello** (fingerprint, face or your Windows Hello PIN); it re-locks when idle, on "lock jarvis", and at every restart.
- The main listener uses `127.0.0.1:3002`. Local model inference does not itself send the prompt to a cloud model. Browser speech recognition, online translation, neural voices, research, media and connected services have separate network behavior. Translation/neural-voice defaults are enabled; review the language and voice settings for offline use. Optional Phone Hub/Tailscale access is configured separately.
- Encrypted backups, daily snapshots, a restorable trash, and one shared copy of your data in `~/jarvis`.

**🚫 What JARVIS will not do** (on purpose)
- Open-ended system software installation/removal, arbitrary shell commands and provider email sending are not general assistant tools. Built-in setup/model downloads, approved project dependency recovery, web/media retrieval and reviewed standalone Node/Python scripts have their own explicit paths. File tools enforce protected-directory and approved-folder checks; native scripts run with your Windows user's access. Destructive actions still require their applicable review, and JARVIS should report unverified outcomes honestly.

---

## 3. Requirements

| Needed | Why |
|---|---|
| **Windows 10 or 11** | Most laptop controls (apps, volume, screen OCR, notifications, hotkey) use Windows features. The chat, study tools and AI also run elsewhere, but Windows is the supported platform. |
| **Node.js 22 or newer** | Runs the JARVIS server. The launcher offers to install it for you. (Developed and tested on Node 24.) |
| **Google Chrome or Microsoft Edge** | Voice input uses the browser's Web Speech API. Edge has the best built-in "JARVIS" voice. |
| **An AI brain** (pick one) | **Ollama** (free, private, offline) with a model such as `qwen3.5:4b`, **or** any API key (Gemini has a free tier), **or** a local OpenAI-compatible server (LM Studio). JARVIS still works for direct commands with no AI. |

Optional extras: **Python / Node / gcc & g++** (to run your code), **VS Code** and other editors or coding agents, **Windows Terminal**, the **ntfy** and **Google Authenticator** phone apps, **Tailscale** (full JARVIS page on your phone), **Windows Hello** (fingerprint/face/PIN approvals).

A compatible GPU can help local inference. Speed and memory use depend on the
model, quantization, context and hardware; the default model name is not a
performance guarantee. **Check my AI** reports installed versus loaded models and
available runtime information.

| Feature | Additional setup |
|---|---|
| Local voice-note or lecture transcription | Run `install-whisper.ps1` or configure `JARVIS_WHISPER_DIR`. |
| Scanned PDF search | Windows PDF rendering and OCR; select and index the PDF in Notes. |
| App and website controls | An accessible Windows application or browser window and approval for each action. |
| Podcast feeds and regional headlines | Internet access and **Online tools** enabled. |
| Live FM | Internet access and a supported broadcaster stream or official player. |
| Calendar availability | Local timetable data, with an optional public HTTPS iCalendar feed. |
| Home Assistant | Reachable server URL and a long-lived token configured under Connected Services. |
| Phone Hub and calling | The separate gateway/provider configuration in the linked setup guides. |

---

## 4. Install & run

### The easy way (no technical knowledge needed)

1. Put the `jarvis` folder anywhere on your PC (e.g. `D:\jarvis`).
2. Double-click **`Start JARVIS.bat`**. The first time it:
   - checks for Node.js and offers to install it if missing (then asks you to start it again),
   - installs JARVIS's parts (`npm install`, about a minute),
   - opens the JARVIS that is already running if there is one; otherwise starts it on the fixed address **http://localhost:3002** and adds a **JARVIS shortcut to your desktop**,
   - starts JARVIS and opens it in your browser.
3. That's it. From the second time on, **double-click the JARVIS icon on your desktop** — it starts Ollama when installed, starts the server quietly in the background (no terminal window), and opens JARVIS when it's ready.

### Starting and stopping

| | |
|---|---|
| **Start** | Double-click the desktop **JARVIS** icon (or `Start JARVIS.bat`). Ollama starts automatically when installed; no terminal window appears — the server runs hidden in the background and your browser opens automatically. |
| **Start from the page itself** | If you open JARVIS while the server is down, the page shows a **▶ START JARVIS** button — one click and Windows launches the server, then the page reconnects by itself. |
| **Stop** | Double-click **`Stop JARVIS.bat`**, or use **Settings → Data → Stop JARVIS** inside the app. |
| **Start automatically at every sign-in** | Settings → Data → **Start with Windows**. JARVIS then runs quietly in the background after every reboot, so the desktop icon (or the installed app) opens instantly. |
| **First-time setup** | The very first launch shows its progress in a window; every later launch is silent. |

If JARVIS is already running, double-clicking the icon starts Ollama if needed, then opens the existing JARVIS page at **http://localhost:3002**.

**Only one JARVIS runs at a time.** However it is started (desktop icon, `npm start`, an AI tool, a VS Code terminal), a second start finds the running copy through `~/jarvis/.jarvis.lock`, prints its address and exits. So there is one chat, one phone (ntfy) connection and one wake-word listener, whatever launched it. The launcher records that port in `~/jarvis/.jarvis-port`.

### The command-line way

```bash
npm install
npm start
```

Then open **http://localhost:3002**. If JARVIS is already running, `npm start` just tells you where. The test harness chooses its own isolated ports and profiles.

> Open JARVIS at `http://localhost:3002/` through its launcher or browser. The page needs the local server for commands and saved state.
>
> Running `npm start` in a terminal keeps the server tied to that window; close it and JARVIS stops. The desktop icon instead runs it in the background — that's what "Stop JARVIS" is for.

### Optional: local AI with Ollama

```bash
ollama pull qwen3.5:4b
```

Select an installed Ollama chat model in **Settings → Model**. The first reply can
take longer while the model loads; JARVIS attempts background warm-up. Screen
vision additionally requires an image-capable model/provider. A model appearing
in the installed list does not mean it is currently loaded or ready for every tool.

| Environment variable | Purpose | Default |
|---|---|---|
| `OLLAMA_URL` | Base URL for the Ollama server | `http://127.0.0.1:11434` |
| `JARVIS_MODEL` | Default model ID | `qwen3.5:4b` |
| `JARVIS_WHISPER_DIR` | Directory containing the offline Whisper executable and model | Searches `.whisper` next to JARVIS and in `~/jarvis` |
| `JARVIS_FFMPEG_PATH` | Existing FFmpeg executable for extracting WAV audio from local media | `ffmpeg` on PATH; extraction unavailable if missing |
| `NTFY_URL` | Base URL for the ntfy publish and subscription endpoints | `https://ntfy.sh` |
| `NTFY_TOKEN` | Bearer token for an ntfy server that requires authentication | Unset |
| `JARVIS_CALLING_ENABLED` | Enables the configured outbound announcement provider | Unset, calling disabled |
| `JARVIS_CALL_ON_REMINDERS` | Allows reminder/deadline calls after calling is configured | Unset, reminder calls disabled |
| `JARVIS_CALL_QUIET_HOURS` | Local-time quiet interval for reminder calls | `22:00-07:00` |
| `JARVIS_PHONEHUB_HOST` | Explicit private-interface address for the optional HTTPS Phone Hub gateway | Unset, gateway disabled |
| `JARVIS_MARKS` | Specialist workspace release mode | Unset, disabled; `preview` explicitly enables developer preview; `enabled` requires every profile to be verified |
| `JARVIS_MARKS_OLLAMA_URL` | Loopback Ollama endpoint for Marks local-only profiles | Falls back to `OLLAMA_URL`; use a numeric loopback address |
| `JARVIS_MARKS_LOCAL_MODEL` | Installed Ollama model for Marks local chat | Falls back to `JARVIS_MODEL` |
| `JARVIS_MARKS_PORTABLE_MODEL` | Installed local model of at most 2 GiB for Mark 5 | Unset; configure before using that model path |
| `JARVIS_MARKS_GOOGLE_CLIENT_ID`, `JARVIS_MARKS_GOOGLE_CLIENT_SECRET` | Google OAuth app credentials for the separate Marks preview connection | Unset; no account connected |
| `JARVIS_MARKS_MICROSOFT_CLIENT_ID`, `JARVIS_MARKS_MICROSOFT_CLIENT_SECRET` | Microsoft app ID and secret, if the app registration requires one, for Marks preview | Unset; no account connected |
| `JARVIS_REQUIRE_ALL` | Test-runner switch: `1` makes skipped suites fail | Unset; use for strict local verification, not as an app feature |

Set environment variables before starting the server. When JARVIS is already running, use **Stop JARVIS** and start it again to load new values. Calling credentials, destination numbers, gateway certificates and additional Phone Hub settings are described in the linked setup guides. [Calling setup](docs/CALLING.md), [Phone Hub setup](docs/PHONE-HUB.md)

These are process environment variables; JARVIS does not automatically load a
project `.env` file. For example, in PowerShell, set `$env:JARVIS_FFMPEG_PATH` to
your executable's full path before launching. Keep the main app on port **3002**.
Use the official stop/start launchers after server or environment changes; do not
start a second development copy on another port or kill Node processes by name.

### Useful addresses

| Address | What |
|---|---|
| `http://localhost:3002/` | The JARVIS app |
| `http://localhost:3002/welcome` | The landing page |
| `http://localhost:3002/?skipboot` | The app without the boot animation |
| `http://localhost:3002/phonehub.html` | Phone Hub pairing, device grants and gateway status |
| `http://localhost:3002/calling.html` | Configured outbound announcement calls |
| `http://localhost:3002/marks.html` | Specialist workspace, available only when Marks is explicitly enabled |
| `http://localhost:3002/marks-oauth.html` | Marks-only OAuth return page; not the main account panel's callback |

---

## 5. First-time setup (choose an AI)

On first run, JARVIS shows a **guided setup** (re-open it any time: **Settings → AI BRAIN → Guided setup → AI**):

- **Free online AI** — click the link, *Create API key* on Google's page, paste it. JARVIS checks the key and picks a good model.
- **Private, on this computer** — install Ollama; one button downloads the AI with a progress bar.
- **I already have an AI key** — paste it; JARVIS recognises the provider from the key itself (OpenAI, Claude, Gemini, Groq, OpenRouter, DeepSeek…) and picks a sensible model.

**Phone setup** (optional): **Settings → Guided setup → PHONE** walks you through installing ntfy, scanning a QR code to connect, adding the unlock code to Google Authenticator, and testing it. See [Phone](#phone--alerts-and-commands).

---

## 6. Using JARVIS — the interface

| View | What you can do |
|---|---|
| **Today** | Review your agenda, attendance, focus time, calendar, local FM, Home Assistant and system status. |
| **Chat** | Type or speak commands, read answers, and review action previews and approvals. |
| **Tasks** | Manage tasks, reminders, deadlines, timetable and routines. |
| **Memory** | Review remembered facts and notes. |
| **Notes** | Search voice notes and captures, review task/reminder conversions, and index a scanned PDF. |
| **Workspaces** | Save project locations, notes, links, current tasks and handoff checkpoints. |
| **Apps** | Native app controls; background queue, budgets, emergency stop and MCP; Office/media workflows; isolated browser; reviewed scripts; Google/Microsoft connections and credential migration. |
| **Media** | Queue local audio, subscribe to podcasts, resume episodes, and open provider links. |
| **JARVIS Code** | Use the separate Build, Plan and Ask coding conversation. |
| **Images** | Browse saved screenshots and captures. |
| **History** | Review attempted actions, their verification status, and available recovery actions. |

### Immersive mode

Select **Hide controls** in the header to use the reactor, live transcript and conversation with a bottom composer. The compact audio player stays available while something is loaded. **Show controls** returns to the dashboard.

Say “Show my calendar,” “Show my tasks,” “Show my notes,” “Show my workspaces,” or “Show my media.” A requested view opens in one side panel. A new request replaces the previous panel. “Show app controls” opens the Apps view. On narrow screens the panel sits above the player and composer and scrolls independently.

Use the panel’s **Close** button, say “Close panel,” or press **Esc** to dismiss it and return keyboard focus to the composer. With a panel closed, **Esc** retains its usual stop-speaking/generation behavior. Action previews and approvals remain accessible in the conversation. The layout honors the browser’s reduced-motion preference.

### Today, images and command history

The right panel opens on **TODAY**, which summarizes open tasks, deadlines due today, upcoming reminders/classes, focus time, attendance and laptop status. Use **BRIEF ME** to hear a short summary, including today’s connected calendar events and weather when Online tools are enabled. For an automatic spoken briefing, open **Settings → Connected Services**, enable **Morning daily briefing**, and choose a time. It is off by default, runs once per day while JARVIS is open, and requires speech output to be enabled. It does not replay a missed briefing if JARVIS starts more than ten minutes after the selected time.

**IMAGES** collects recent room-watch snapshots, indexed pictures and JARVIS screenshots; preview images in place, open them in their normal viewer, or open their containing folder. **HISTORY** records action attempts and the available verification result. Eligible commands can be repeated or retried; JARVIS offers undo only when its existing undo system can reverse the latest recorded action.

Action receipts distinguish **verified**, **failed** and **not checked**. Some effects have no reliable observer, so a successful response alone is not shown as proof. Receipts are shared through JARVIS's local state across its tabs and capped at 120 entries.

### City-aware FM radio

Open **Today → FM Radio**. The list follows the **Home City** in Settings until you choose a different default radio city. The starter catalogue covers Bengaluru, Chennai, Delhi, Hyderabad, Vijayawada, and Visakhapatnam. A frequency is resolved against the selected city. The catalogue and favourites are available offline.

**Play here** uses the compact player for supported official streams. **Open player** opens the broadcaster’s player, which is also available when an in-app stream cannot be played. Listening requires internet access, and stream availability and codec support depend on the station and browser. [Official Akashvani player](https://akashvani.gov.in/radio/live.php)

- “Show FM stations in Hyderabad” switches the list for the current session.
- “Set my radio city to Hyderabad” saves the radio city independently of your Home City.
- “Play 101.9” resolves that frequency in the current radio city.
- “Save this station” saves the last station opened from JARVIS. “Play local radio” prefers a favourite in the current city.

| City | Catalogue stations and local frequencies |
|---|---|
| Bengaluru | FM Rainbow Kannada — 101.3 FM |
| Chennai | FM Rainbow — 101.4 FM, FM Gold — 100.1 FM |
| Delhi | FM Rainbow — 102.6 FM, FM Gold — 100.1 FM |
| Hyderabad | FM Rainbow — 101.9 FM, Vividh Bharati Telugu — 102.8 FM |
| Vijayawada | FM Rainbow — 102.2 FM, Vividh Bharati Telugu — 101.3 FM |
| Visakhapatnam | FM Rainbow — 102.0 FM |

### Safer routines

The routine editor previews how each step parses and explains that unattended test runs execute only steps allowed by JARVIS's safety rules. Test runs can perform real actions, so review the preview and confirm before running. Scheduled/automatic routines can be paused or resumed from the Tasks panel; manual runs remain available.

### Notes and capture inbox

**Notes** combines notes saved with “remember that…” or “save a voice note…” and dated Quick Capture entries saved with “jot down…”. Entries show their source and time. Search by words or filter by date. “Show what I captured today” and “Show what I captured yesterday” open the corresponding view and a numbered preview.

Dictate a draft in Notes and review it before saving. **Use local Whisper** records and transcribes through the existing offline Whisper installation. Install it with `install-whisper.ps1` or select a custom installation through `JARVIS_WHISPER_DIR`.

Use **Create task** or select a future time and **Review reminder** on an entry. JARVIS shows the proposed task or reminder in chat for confirmation. After opening the inbox, you can also say “Make a task from the first one” or “Remind me about the second one tomorrow.” Numbered references use the recent inbox view and expire after five minutes. Repeating the same conversion reuses the existing task or matching reminder.

### Workspace checkpoints

Open **Workspaces** and save a name with at least one project folder, note file or HTTP(S) link. Enter full local paths and one note or link per line. A workspace can hold eight configured note files and eight links.

“Resume my DBMS workspace” reopens the saved project in VS Code, the note files in their usual viewers, and the links in the browser. The reply reports any items that could not open. VS Code must be installed for the project-editor step.

While using the workspace, save a checkpoint with its **Current task** and **Next step** fields, or say “Jarvis, pause DBMS here. Next, test the joins.” To include both by voice, say “Pause DBMS here. Current task: Review queries. Next, test the joins.”

The checkpoint includes the workspace’s saved locations and successfully opened notes and links used through JARVIS during that workspace session. Resuming reads back the task and handoff. Tracking follows JARVIS actions within the resumed workspace session.

### Quiet hours and missed alerts

In **Settings → Connected Services**, enable **Daily quiet hours** and choose a start and end time. The interval can span midnight. During a focus session, “Keep it quiet until my break” holds routine laptop alerts until the focus period ends. Cancelling that session clears its temporary quiet interval.

Held alerts are collected in a local recap. Say “What did I miss?” to review it; JARVIS also offers a recap when quiet time ends. The recap can retain up to 100 alerts and shows the latest ten in its reply.

Timers and critical battery warnings pass through. **Let deadline warnings through quiet hours** controls deadline exceptions. Phone notifications retain their existing settings. Reminder calls use the separate `JARVIS_CALL_QUIET_HOURS` configuration.

### Correct a pending voice action

A spoken file-open request has a short preview before execution. Say “Open my OS notes,” then “Wait, I meant DBMS” during the three-second preview. You can also correct the target of a pending approval. JARVIS reads back the corrected request and asks again for any required permission.

“Cancel,” “Never mind,” or **Esc** cancels a pending voice-open preview. Corrections apply while a request is waiting. After an action has run, use a new command or an available undo action.

### Find a free study slot

Ask “Where can I fit 45 minutes of DBMS before Friday?” JARVIS combines the local timetable with the connected read-only calendar, checks matching upcoming deadlines, and suggests up to three blocks within your study hours.

Set **Study hours start/end** in **Settings → Connected Services**; the defaults are 08:00–22:00. Searches accept durations of 5–360 minutes and look ahead up to 14 days. A class without a duration occupies one hour. A day-only cutoff such as “before Friday” ends at the start of that day.

Calendar availability accounts for recurring events, recurrence exceptions and all-day events. Unsupported time-zone definitions or unavailable calendar data produce an incomplete-coverage notice. Suggested slots should be read with that notice and the timetable assumptions in mind.

### Regional headlines and focus audio

Enable **Regional headlines in briefings** under **Settings → Connected Services**, enable **Online tools**, and set a supported Home City. You can also ask “Brief me on Bengaluru in Kannada.” The starter feeds cover Bengaluru in Kannada and Chennai, Delhi, and Hyderabad in English. Headlines carry a publisher link and publication time in IST. Feed availability and freshness depend on the publisher.

Say “Start a 45-minute study session with rain sounds” or request white noise. Both sounds are generated locally. Audio stops at the break or when the session is cancelled. **Play focus audio** starts it again after a reload or when the browser requires a click. Starting other audio pauses the focus sound, and assistant speech/listening reduces playback volume.

### Search scanned PDFs

In **Notes**, enter the PDF’s name or full path, choose **Index with local OCR**, and wait for the progress indicator. Search the indexed PDF there, or say “Find the deadlock diagram in this scanned PDF.”

JARVIS reuses an existing text layer and renders pages with little text through Windows PDF rendering and local OCR. Matches include the original filename, page number and an excerpt. Search uses the recognized words, so recognition quality affects diagram labels, handwriting and small text.

Indexing supports one job at a time, with cancellation, up to 400 pages and the existing 40 MB PDF limit. Unreadable pages are counted. The index is held in server memory; a changed file or server restart requires indexing again. Password-protected PDFs require an accessible, unlocked copy.

### Media player

Open **Media** to select local audio files or add a public HTTPS podcast RSS feed. The compact player supports Play/Pause, Previous/Next, seeking for finite tracks, and volume. It remains available in immersive mode and reduces volume while JARVIS speaks or listens.

Local audio uses the browser’s file selection and playback support. Reselect local files after a page reload. **Open a local video** creates a link that plays the chosen file in a browser tab.

For podcasts, enable **Online tools**, paste the feed URL, and choose an episode. Subscriptions and episode positions are saved locally. Playback supports 1×, 1.25×, 1.5× and 2× speeds. Use **Resume podcast**, say “Resume my podcast,” or say “Continue yesterday’s episode from where I stopped.” Resuming requires the saved episode to remain available in its feed.

Choose a sleep timer in Media or say “Stop my audio in 30 minutes.” Voice timers accept up to 180 minutes. Live radio uses the same compact player, with station selection under **Today → FM Radio**.

The provider form accepts a title or a supported link. “Play lo-fi study music on Spotify” and “Play Believer on YouTube” open the provider’s official search page. Supported Spotify and YouTube links open their official players. Provider login, playback rights and availability are handled by those services.

### Windows app and website controls

Open **Apps**, refresh the window list, and inspect an application or browser window. JARVIS shows the accessible controls and offers **Review click** and **Review fill** where the application supports those actions. Each click or fill requires one-time approval for the selected window, control, and text. Inspect again after an action to check what changed and choose the next control. Fields are checked by reading back their value.

Say “Inspect Notepad,” “Fill field Message with Meet at 5 PM,” or “Click control 7.” Use a control’s exact displayed name or its number. Duplicate names prompt you to use the number. Controls depend on the application’s Windows accessibility support. Password fields are omitted. Inspections expire after two minutes and actions use the control’s current identity.

JARVIS binds approval to the inspection, control, action and exact field text. An inspection is consumed after one action, including a failed or timed-out action. Refresh and inspect again to continue. A changed or closed window, missing control or expired inspection produces an error.

A successful fill is verified by reading back the field’s value. A click is reported as accepted by the application; inspect the resulting view to verify its effect. Apps and websites expose different accessibility patterns, so the available controls can differ from their visual appearance.

### Optional calendar and Home Assistant

In **Settings → Connected Services**, you can connect a read-only HTTPS iCalendar feed and/or a Home Assistant server. Calendar events appear on Today for the next 14 days. Free-slot searches also take recurring and all-day events into account and flag incomplete calendar coverage. The calendar feed URL and Home Assistant access token are kept in `~/jarvis/.config.json` and are never returned to the page after saving. Home Assistant exposes supported lights, switches, scenes, fans and covers on Today; each control asks before sending a change and checks the reported state afterward where possible. Natural commands such as “turn on desk lamp” are also supported when the device name matches uniquely. Sensors are shown as read-only. Disconnect either service from Settings to remove its saved credentials. These integrations remain unavailable until you connect and configure them.

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
- **Emotional intelligence:** local, rule-based cues for frustration, sadness, anxiety, stress, confusion, excitement and appreciation. JARVIS adapts its response tone and gives calmer, more actionable explanations when useful. It does not call a model to classify emotion, store mood history, or diagnose anyone. Say “turn off emotional intelligence” or “turn on emotional intelligence” to control it.
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
- **One breath, like "Hey Siri".** Say the wake word and the command together — "Hey Jarvis, open Chrome", even while you're in another app — and JARVIS takes the command straight away: no "Yes, Sir?", no repeating yourself, and the answer comes after a short pause (~0.9 s) rather than your full pause setting (which still applies when you say just the wake word and then think). The command travels with the wake event from the Windows listener; if it only catches the wake phrase, JARVIS asks as before.
- **Telugu & Kannada:** speak or type in తెలుగు / ಕನ್ನಡ, or say "switch to Telugu". Typing in English letters works too — "volume penchu", "5 nimishalu timer pettu", "timer cancel maadu", "recursion ante enti". Replies come back in your language.
- **Limited Hindi/Hinglish commands:** `Chrome kholo`, `वॉल्यूम ३० करो`, `5 minute ka timer lagao`, `music chalao` and supported schedule phrases have local mappings. An ambiguous `kal` asks whether you mean tomorrow or yesterday. This does not add a Hindi choice to the existing English/Telugu/Kannada microphone selector. Broader Hindi input and reply translation can still depend on the configured AI/translation service.
- **Typos are fixed**: "set timr 5 min", "clse chrome", "cancle the timer" (real words are never "corrected" into commands).
- **Misheard words are repaired** (spoken input only): "front and" / "front end" → frontend, "v s code" → vs code, "java script" → javascript, "fold her" → folder, "calculate her" → calculator… — always checked against the words around them, so "front and back of the page" stays as it is. JARVIS also waits for the recogniser's *final* words before acting (it no longer sends an unfinished "front"), and picks the best of its three guesses.
- **Settings → Test my mic** — say 14 command words ("frontend", "create a folder", "VS Code"…) and see what the mic heard and what JARVIS repaired, as a score.
- **Neural voices** for FRIDAY, Telugu and Kannada (Microsoft's neural voices, work in any browser). **Online translation** makes Telugu/Kannada answers as good as English ones. Both send the *reply text* online and can be turned off in Settings.

### Skill Hub, browser recovery, diagnostics and saved workflows

Open **✦ SKILL HUB** from the lower-right corner of the JARVIS page.

- **Skill Hub:** search bundled and personal skills, rescan the skill folders, run an enabled skill, and persistently enable/disable a skill. Disabled skills are omitted from normal skill routing and direct runs return 403. Skill files remain instruction text; they do not get operating-system permissions.
- **Browser recovery:** JARVIS keeps a bounded local list of web URLs opened through its own “open URL” tool, so you can reopen one after a refresh or accidental tab closure. The list is saved in `~/jarvis/.browser-recovery.json`; clear it from the Hub. Sensitive query parameters (tokens, keys, codes, session IDs and similar) are stripped before a URL is saved. This is not a complete Chrome/Edge history and does not detect pages opened outside JARVIS.
- **Restore a browser tab:** to restore a tab closed in Chrome or Edge, switch to the intended browser window and press **Ctrl+Shift+T** yourself. JARVIS deliberately does not inject that global shortcut, because it could affect the wrong active app.
- **Self-diagnostics:** checks the Node runtime, required skill/voice/automation files, local storage and Ollama reachability. It reports recommendations only; it does not run repair commands.
- **Workflow memory:** save a named reusable prompt/checklist and use it later from the Hub. Workflows are stored locally in `~/jarvis/.workflow-memory.json`; selecting “Use in chat” fills the chat box but never executes the workflow automatically. No mood profile is created.
- **Screenshot gallery:** the Hub's Screenshots tab lists recent screenshots created by JARVIS, shows image previews, and can take a fresh screenshot. Saved images are not deleted by OCR cleanup. The gallery is restricted to the local JARVIS page and only serves files with JARVIS screenshot names from known output folders.
- **Visual object inspection:** ask "identify objects on my screen", "what objects are visible on my screen", or "count the items in this window". JARVIS asks the selected image-capable model to describe visible objects and approximate locations, while distinguishing uncertain observations. This is model-based visual description, not a dedicated detector with guaranteed bounding boxes; choose an image-capable local model for privacy.
- **Quick actions:** the Hub can prepare a WhatsApp click-to-chat draft and open movie-ticket, bus-ticket, Amazon India, or Flipkart searches. You review the recipient/message and complete booking, payment, and checkout yourself; JARVIS does not auto-send messages or buy tickets/items.

The original **“open the recently closed app”** command still reopens the most recent app closed through JARVIS. Apps closed manually outside JARVIS are not automatically tracked.

### Agent Platform research notebook and workflow planner

Open **AGENT PLATFORM** from the JARVIS interface to save local research questions, findings and sanitized source links; validate a workflow's dependencies and permission tiers; and review the metadata-only audit trail. Workflow validation never executes commands. Research sessions and audit metadata are stored locally under `~/jarvis`.

The corresponding APIs are documented in [the Phase 3–8 implementation status](docs/PHASES-3-8-IMPLEMENTATION.md). Existing skill packs, reminders, browser recovery and Phone Hub remain the source of truth for those capabilities.

### Reviewed workflow additions

The **Apps** workspace includes panels for account connections, an isolated browser,
document/data/media workflows and reviewed script execution. They use the existing
dark cyan theme and approval cards. New control permissions start disabled.

- **Language and dialogue:** constrained Hindi/Hinglish commands, Devanagari digits,
  typed entities, clarification of ambiguous “kal”, safe reminder/timer slot recovery
  and returning to an interrupted question. File-changing commands containing
  exclusions stop for explicit selection rather than losing the exclusion. This is
  not unrestricted multilingual understanding or a complete bulk-file selector.
- **Desktop and browser:** Windows accessibility exposes supported selection,
  toggle, expand/collapse and scroll patterns after opt-in. Each action needs an
  exact one-time approval. The isolated Edge/Chrome profile reads DOM controls,
  rechecks observations before acting and denies downloads. Login, CAPTCHA,
  payment and sending screens require manual takeover. General keyboard shortcuts,
  drag/drop and cross-frame automation remain incomplete.
- **Background tasks:** supported read-only jobs have durable checkpoints, a start
  time within 31 days, a runtime budget and a model-call budget. Cancelled or
  interrupted work is not silently replayed. This is not an OS sandbox or a monetary
  spending cap; recurring task execution and general automatic replanning remain
  incomplete.
- **Office and content:** create editable DOCX, PPTX and XLSX downloads in
  `~/jarvis/Exports`. Workbooks support bounded formulas, grouped summaries and
  charts. Grouped summaries are not native Excel pivot-table objects. Approved
  documents can yield quoted amount, due-date and sender matches with page numbers,
  keyword counts and suggested classifications; no messages are automatically filed.
- **Media:** resize/crop/convert local raster images. Audio extraction and optional
  local transcription require FFmpeg and Whisper. Set `JARVIS_FFMPEG_PATH` to an
  existing FFmpeg executable if it is not on PATH. JARVIS does not install it.
- **Google/Microsoft:** configure your own OAuth client, register the displayed
  localhost callback, review configuration and sign in through the provider.
  PKCE connections request read-only mail/calendar/file scopes. Every data call
  needs one-time approval. No provider writes or sending scopes are implemented.
  Disconnect removes local tokens; revoke remote consent in the provider settings.
- **Secrets:** account tokens use Windows CurrentUser DPAPI. Existing model keys
  migrate only through the reviewed migration button, with decryption verification
  before plaintext configuration is removed. Backups made before migration may
  still contain old keys. Recognizable secrets are blocked before cloud chat and
  embedding calls; this is not comprehensive personal-data detection.
- **Reviewed scripts:** opt-in Node/Python execution previews exact code, arguments,
  working directory and timeout. It runs as your Windows user, with no VM isolation.
  Output and exit status do not prove every intended task effect succeeded.

Windows Hello, when enrolled and required, additionally binds approvals for these
actions to the exact request body. Browser observations and account responses are
evidence, never authorization for follow-up actions. See the
[capability evidence and remaining work](docs/IMPLEMENTATION-PROGRESS.md).

### Office, document and media workbench

Open **Apps → Background tasks and MCP tools → Documents, data, images and reviewed code**.
These are form-based workflows; a feature being present here does not mean every
open-ended spoken request for that feature has a command mapping.

| Workflow | Input and result | Limits and requirements |
|---|---|---|
| Word document | Title and text → editable `.docx` | API also supports bounded tables and source lists |
| Presentation | Title/text or structured slide sections → editable `.pptx` | Bounded slide content; not a general PowerPoint design or animation engine |
| Spreadsheet | CSV → `.xlsx`, optional group/value summary and chart | API accepts restricted formulas; grouped summaries are not native Excel pivot tables |
| Document evidence | Approved local text, PDF or Office file → quoted amounts, due dates, sender labels, page references and keywords | Rule-based extraction and category suggestions; scanned PDFs need OCR first |
| Image workflow | Approved local raster image → resized/cropped PNG, JPEG or WebP | Source stays unchanged; no remote image URL or SVG input; cropping is exposed by the API |
| Audio workflow | Approved local media → mono 16 kHz WAV, optional Whisper text | FFmpeg required; transcription additionally needs local Whisper; clips are limited to 12 minutes |
| Reviewed standalone code | Exact Node/Python source, arguments, approved working folder and timeout → captured output/exit status | Disabled until enabled and reviewed; runs with your Windows account's access, without a VM sandbox |

Outputs use unique names under **`~/jarvis/Exports`** and offer download links.
Review generated content and spreadsheet calculations before relying on them.
Stopping work before the final export write prevents that output from being
written; emergency stop does not undo an already completed export or side effect.

### Google and Microsoft account setup

For the main JARVIS connection, open **Apps → Background tasks and MCP tools →
Google, Microsoft and encrypted credentials**.

1. Create your own provider OAuth application with loopback/localhost redirect
   support. Use the callback displayed by JARVIS:
   **`http://localhost:3002/api/accounts/callback`**.
2. Enter its client ID and any client secret required by that registration. Review
   the provider, client ID, redirect and read-only scopes before saving.
3. Select sign-in, approve creation of the sign-in request, and follow the provider
   link. You complete sign-in and consent in the provider's page.
4. Return to JARVIS and refresh connection status. Choose mail, calendar or files,
   optionally supply a query/item ID, then review the exact read request.
5. Disconnect when finished. This removes the local account token; remote consent
   can also be revoked in the provider account's settings.

You can also say `read google mail`, `check microsoft calendar` or
`search google files for DBMS`. These commands still require connection and
one-time approval. Responses are bounded provider data, not an instruction to
perform follow-up actions. Listings generally return up to 20 items. Microsoft
calendar queries cover the next seven days, and Microsoft file queries filter
the first 20 drive items; they are not exhaustive account searches. File reads
in this adapter return metadata, not arbitrary document downloads or edits.

**Two account systems currently coexist.** Their configuration and tokens are
separate; connecting one does not connect the other.

| | Main Apps account panel | Marks developer preview |
|---|---|---|
| Setup | Client credentials through reviewed Apps configuration | `JARVIS_MARKS_*` OAuth environment variables and explicit connect in Mark 40 |
| Redirect | `/api/accounts/callback` on localhost:3002 | `/marks-oauth.html` on localhost:3002; page completes its own callback flow |
| Data access | Google/Microsoft mail, calendar and file metadata | Read-only mailbox metadata/calendar tools and Sentry watches |
| Token storage | Windows CurrentUser DPAPI vault | Server memory, cleared on restart/disconnect |
| Sending or editing provider data | Not implemented | Local drafts for review; no automatic sending |

Existing model API keys are a third, separate configuration. The migration button
encrypts eligible model keys for this Windows user and verifies them before
removing their plaintext configuration fields. It does not connect an account or
encrypt every other secret and historical backup. Copying the DPAPI vault to a
different Windows user is not a portable credential backup.

### Marks specialist workspaces (developer preview)

**Marks is not enabled in a normal launch.** All 23 catalog entries currently have
preview status; `JARVIS_MARKS=enabled` keeps the release gate closed until every
profile is verified. To explicitly try the developer preview, set
`JARVIS_MARKS=preview` in the launch environment, restart the same JARVIS instance,
and open **Marks** or `http://localhost:3002/marks.html`. Each tab starts with Standard.
Remove the environment setting and restart to return to ordinary startup.

Within an enabled preview, `open mark controls` opens the workspace and
`enable Mark 1` selects a profile there; it does not switch the main chat's mode or
override the global release gate. Names such as Gemini, Friday or Iron Legion are
profile names, not proof of a particular external model or unrestricted autonomy.

| Profile | Implemented purpose / example |
|---|---|
| Standard / Mark 1 · Basic | Typed questions, clock/calculator, app launches and web search |
| Mark 2 · Voice | Explicitly arm voice using the existing Windows wake listener; leaving the active tab/profile disarms it |
| Mark 3 · Desktop | `windows`, `inspect "Exact Window Title"`, or a reviewed desktop plan |
| Mark 5 · Offline Tray | Existing server from the tray, with a configured installed local model up to 2 GiB |
| Mark 6 · Power Saving | `on`, `off`, `status`; waits before new heavy steps when battery/charger policy requires it |
| Mark 7 · Instant Deploy | Compact command workspace through an opt-in Windows shortcut |
| Mark 17 · Heartbreaker | Exact file lookup or `click "Save" in "Exact Title" expect "Saved"` |
| Mark 22 · Hotrod | Direct time, date and arithmetic without a model |
| Mark 33 · Silver Centurion | Loopback Ollama text chat; conversation remains in memory with no saved history |
| Mark 38 · Igor | Review filename prefixes, Office-to-text conversion or CSV cleanup into new files |
| Mark 39 · Gemini | Web evidence and a cited research report, subject to Online tools/model availability |
| Mark 40 · Shotgun | Review web/code/Office/terminal-information/read-only account steps and local drafts |
| Mark 42 · Iron Legion | Up to two independent read-and-draft workers; one supported task per line |
| Mark 44 · Veronica | Reviewed extension-based quarantine in JARVIS folders, with content-checked recovery |
| Mark 46 · Mission | Reviewed read-and-draft plan with checkpoints, up to four hours |
| Mark 47 · Tutor | Explanations, quizzes and study notes |
| Mark 50 · Nanotech | Review reusable text tools; supported line transforms run a fixture in a bounded worker before registration |
| Mark 85 · Endgame | Approved memory, forgetting, or routing to another profile using `use mark-22 …` |
| House Party Protocol | Up to ten queued read-and-draft tasks, using the bounded worker lanes |
| Friday | Casual, concise typed replies |
| Sentry | Session-only watches for a specific sender, named local download or deadline |
| Damage Report | Connectivity, microphone-permission and local-model diagnostics |

**Start Marks Tray.bat** attaches to the existing server. **Start Marks Hotkey.bat**
opts into **Ctrl+Alt+J** for compact commands; its tray menu exits the helper. This
differs from the main selected-text shortcut **Ctrl+Shift+J** and the emergency
stop shortcut **Ctrl+Alt+Pause**. None starts another JARVIS server.

Marks has its own background checkpoints, batches, text-tool library, approved
memory and optional saved results. A profile's “no history” setting concerns its
conversation history; enabling other storage/features should be reviewed separately.
Sentry watches and Marks OAuth tokens are session-only. Mark 33 requires a local
Ollama service you control; it has no fallback to the normal cloud provider.

For phones, grant **Marks task status and shared reports** to the paired Android
device in Phone Hub. A completed task's **Review for Phone Hub** action shares
only the text you review. The device also needs the existing HTTPS gateway;
reviewed reports and device grants can be revoked independently.

See [Marks setup, commands and release checks](docs/MARKS.md). Physical tray/hotkey,
microphone, battery, provider sign-in/watches and Android grant/revocation flows
still need live acceptance evidence before promoting the preview profiles.

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
- **Suit up:** "suit up" sets the whole study scene at once — arc theme, HUD on, volume 30, closing distracting apps (it asks first), a focus session (default 45 minutes; "suit up for 25 minutes on dbms" directs it), and "with music" adds lofi study beats. A session already running is kept, never restarted, and one "undo" puts every part back.
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

- **Files.** JARVIS's own workspace is `~/jarvis` (Notes, Code, Documents, Projects). It can **open and read files and folders anywhere on the laptop** — "open the agriloop folder in vs code", "read notes.txt" — searching Desktop, Documents, Downloads, your home folder and your other drives by name. If a name matches several places it lists them (**OPEN 1 / OPEN 2**). **Changing** anything outside `~/jarvis` (write, rename, move, copy into, delete) shows an **ALLOW / CANCEL** card first; from the phone or a routine it is refused. The file tools refuse protected Windows, Program Files, AppData and key-folder paths. Examples: "take a note: revise recursion", "read my notes", "list my files", "create a folder called DSA", "rename a.md to b.md", "copy notes.md to Projects", "delete old.txt" (goes to `~/jarvis/.trash`).
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
- **Skill packs (your own skills, no code):** a folder with a `SKILL.md` in `~/jarvis/Skills` becomes a skill — run it with **`/name …`** or **"use the name skill to …"** (type `/` for the menu, or Ctrl+K), or by its trigger phrase at the start of a sentence. It is the same format Hermes Agent and Codex use (a `name` and `description` header, then plain instructions), so skills written for them load as they are; extra fields are ignored and scripts in the folder are **never run**. Say **"list my skills"** to see them and **"reload skills"** after adding one (a broken one is skipped and named, never fatal). Four ship with JARVIS:

  | Skill | What it does |
  |---|---|
  | `/research …` | Searches the web and answers **only** from the pages it found, with numbered sources (asks to turn on Online tools if they're off) |
  | `/quick …` | A short, direct answer (≤ 3 sentences, small token budget — easy on the GPU) |
  | `/code-review calc.py` | Finds the file in your folders and reviews or explains it, citing file and lines |
  | `/plan-then-act …` | Hands a request to the multi-step planner: a preview, then each step runs through JARVIS's own tools with the usual confirmations |

  Optional header lines: `triggers: [phrase one, phrase two]`, `max_tokens: 400`, and `uses: research | files | plan` (what the skill is wired to; leave it out for a plain skill). Only one skill's instructions (cut to about 6000 characters) are sent per request, so it stays fast on a small local model. Nothing is downloaded: copy a skill folder in yourself.
- **Extra tools (all explicit wording, so ordinary commands are never taken):** each is its own small module with its own tests, and the code does the work: the AI only explains results, so numbers and names are never invented.

  | Say | What happens |
  |---|---|
  | **"check my AI"**, "any AI errors today?", `/health` | Is Ollama up, which models are installed versus loaded and how much loaded model data is on the GPU, a report of the last day's AI calls (success rate, typical and slowest time, rate limits, bad keys, timeouts — outcomes only, never your questions or keys), free disk space and memory, with the fix next to each problem. "Check my AI properly" also asks the model one tiny question and times it. |
  | **"watch localhost:5000"**, "what is down?", "stop watching …", "stop the watchdog" | Checks Ollama and anything you add (a web address or `host:port`) every 2 minutes while it is on, and tells you **once** when it goes down (after 2 failed checks in a row, so one blip is ignored) and once when it is back, with how long it was down. Nothing is scanned: it only talks to what you named. |
  | **"list cafés near Majestic"**, "show pharmacies near me within 2 km", "what's near Indiranagar", `/nearby` | Real places from OpenStreetMap with distance, address, hours and phone when the map has them. "Near me" uses the city in Settings (JARVIS can't see your location and says so). The Google Maps reply for "nearest X to Y" gets a **LIST THEM HERE** button. Needs Online tools. |
  | **"analyze marks.csv"**, "average marks by dept in marks.csv", "show rows in marks.csv where marks > 60 and dept = CSE", "how many rows are in marks.csv", "chart attendance in marks.csv", `/csv` | Reads a CSV (comma, semicolon, tab or pipe; up to 10 MB / 100,000 rows) and describes each column, finds what moves together, answers questions with a small safe filter language (no code is ever run from your words), and draws bar charts or histograms as SVG files in `~/jarvis/Charts`. The AI gets only **statistics** (column names and summary numbers), never your rows. |
  | **"document my calculator project"**, "generate a wiki for dsa_sprint", `/wiki` | Reads a project folder (up to 400 files; skips `node_modules`, build folders and the like) and writes `~/jarvis/Wikis/<project>/`: an overview, an architecture page with a Mermaid diagram of which module imports which, one page per module (classes, functions, connections), and a class diagram. Everything named is read from the code; the AI adds one short sentence per module, marked **AI summary**. Add "and save it in the project folder" for `docs/wiki` there (asks first). |
  | **"generate an image of a cat astronaut"**, "draw me a castle in watercolor style", "make 3 pictures of a red fox in portrait", `/image` | Turns your idea into a detailed prompt (shown to you), then asks an image service for the picture: saved in `~/jarvis/Images` with a `.json` note beside it (prompt, seed, size, service). Every file is checked to really be a PNG/JPEG/WebP before it is saved. The first time, JARVIS says plainly that the description is sent to **Pollinations**. The service may want a free key: **Settings → IMAGE SERVICE**. If you run Stable Diffusion (Automatic1111) on this PC, that is used first and nothing leaves the laptop. |
  | **"merge a.pdf and b.pdf"**, "split notes.pdf pages 1-3", "keep the first 5 pages of notes.pdf", "rotate scan.pdf right", "watermark report.pdf with DRAFT", "make that into a PDF", `/pdf` | Always makes a **new** file in `~/jarvis/PDFs` (your original is never changed; "…and save it next to the original" asks first). Password-protected PDFs are refused. Text-to-PDF uses the standard Latin letters (Telugu, Kannada and emoji become "?" and it tells you how many). Uses the `pdf-lib` package. "Undo" moves the new file to the trash. |
  | **"what's using my C: drive?"**, "tidy my downloads" (or desktop / a folder, "…by month"), "find large files over 500 MB" then **"trash 1, 3 and 5"**, "find duplicate files" then "clean up the duplicates", "clean my temp files", "empty my JARVIS trash", `/disk` | **Disk care.** A scan only reads; a change is shown first, confirmed, applied from a plan kept on the server (never a list sent by the page), and re-checked file by file. *Tidy* sorts the loose files of a folder into Documents / Images / Videos / Audio / Archives / Installers / Code / Other (skipping unfinished downloads, files changed in the last 10 minutes and sub-folders). *Large files* and *duplicates* (found by content, one copy of each kept) are moved to a **same-drive JARVIS trash** (a rename, never a copy to C:), and **one "undo"** puts a whole run back. Moving to the trash frees no space until you **empty it**, which, like deleting **temp files older than 3 days** (only your user temp folder), is **permanent** and asks Windows Hello. OneDrive folders are skipped (reading an online-only file would download it); Windows, Program Files and app-data folders are never touched. |
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

### Public product and bus comparisons

JARVIS routes explicit product and bus fare comparison requests through `/api/commerce/compare`. It searches provider-specific public results, fetches readable public listing pages when available, extracts price candidates, and shows source links. A candidate price is not a checkout-verified total; JARVIS must not claim a guaranteed cheapest purchase until exact variant, route/date, availability, delivery/booking fees and offers are confirmed. Search failures or inaccessible pages are reported as missing data, not fabricated prices.

Natural-language intent rules handle clear buying/comparison requests and preserve the active commerce task for short provider follow-ups. For unclear or ambiguous requests, JARVIS should ask a focused clarification rather than guessing an external action. The local rule engine remains the fast first pass; the optional local Qwen NLU assist can interpret low-confidence commands when enabled.

### Multi-step commands (the agent)

"open VS Code, create a folder DSA and start a 25 minute focus", "set volume to 30 and tell me a joke".

- Commands JARVIS already knows run in order instantly; unknown parts are planned by the AI, **validated by the server**, and shown as a preview ("No changes have been made yet — EXECUTE / CANCEL").
- Requested read results are carried into the final reply. For example, “Read task-result.md and show my to-do list” returns the file contents and the task list. Long results show a shortening notice.
- Recovery choices use fresh step snapshots and preserve the original run record. Repeated clicks on a consumed Retry/Continue choice cannot start another recovery. Incomplete tasks are announced as incomplete.
- Desktop click/fill tools retain their exact-target server approval for each action. A plan preview is followed by those individual application approvals.
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
- **Qwen NLU assist** *(enabled by default for new installs)* — when the rules aren't sure what you meant, ask the local Qwen model to read the command. It may only choose from a fixed list of 26 commands that JARVIS really runs (apps, web, volume, mute, brightness, dark mode, battery, time, date, timer, to-dos, music keys, weather, files, calculator, screenshot) — never power off, restart, sleep, lock, delete, reminders or creating files. If it fails or is less sure than the rules, the rules' answer stands. (`POST /api/nlu/parse`.)
- **Face recognition greeting** *(off)* — one webcam snapshot when JARVIS goes idle; if it's you, "Welcome back, sir. Good evening." (at most every 5 minutes). Switch it on in Settings and look at the camera for the 3-sample enrollment. Only a 128-number face fingerprint is kept (in `~/jarvis/.config.json`, never an image), and the **comparison is done by the server**, so the stored fingerprint never leaves it. *The face model (`face-api.js`) is downloaded from a public CDN the first time you switch it on — so it needs the internet once.*
- **Hand gestures** *(off)* — UI-only, never commands: open palm toggles listening, pinch dismisses a card, swipes scroll the chat, thumbs-up answers *yes* to an approval card, a fist stops speech. *Loads MediaPipe from a public CDN on first use.*
- **Pattern learning** — notices habits locally ("you open VS Code every morning — run it automatically?") from app-open and command frequency per hour and battery / RAM baselines; no chat text, file contents or window titles.
- **Port-scan watch** — checks the listening ports every 60 s and alerts when a **new** one appears (an unexpected server, or something phoning home). Switch in Settings.
- **Better OCR** — `/api/ocr/image` reads text from any image (Windows OCR when it's a screen capture, Tesseract as the fallback, loaded only when needed).
- **Central thresholds** (`thresholds.js`) — low-battery, high-RAM, deadline window and similar alert levels live in one place and can be overridden in Settings.

### Camera, watchers, chat search & student tools

All explicit wording (a plain sentence never switches a camera or microphone on). **A message from the phone is refused** for anything that uses the camera or microphone. Whenever a camera or the microphone is live there is a **red indicator with a STOP button** at the bottom of the page, and nothing is switched on again after a reload except the presence lock if you left its switch on.

**Camera and pictures**
- **Scan a document** (“scan a document”, `/scan`) — take or choose a photo, JARVIS finds the page edges (OpenCV), you can drag the four corners, it straightens the page and cleans it (document / grey / whiteboard / colour), several pages make one **searchable PDF** in `~/jarvis/Scans` (the words are read with Windows OCR and put behind the picture, plus a `.txt`). *opencv.js (10 MB) is downloaded from a CDN the first time. Latin letters only in the search layer; handwriting is read poorly.*
- **QR codes** — “scan a QR code” reads one live or from a picture (jsQR) and shows what it says; a link is **never opened by itself** (only with a button, and only http/https), Wi-Fi passwords are kept out of the chat. “make a QR for https://…” saves an SVG in `~/jarvis/QR`.
- **Solve from a photo** (“solve this from a photo”, “what is in this picture”) — the local vision model looks at it (Windows OCR text is added as a hint). If an online model is selected the card says the photo would be sent there and asks first. *A 4B model can be wrong, especially at maths and handwriting.*
- **Lock when I leave** (Settings → Behaviour, or “lock when I leave”) — the webcam looks for a face every 2 seconds; after the chosen time without one, JARVIS locks itself (and Windows too only if you also switch that on). “Could not tell” (camera blocked, tab asleep) never counts as “gone”. It can only lock, never unlock, and needs **Lock JARVIS** (Windows Hello) to be set up first. No picture is saved or sent.
- **Watch my room** — movement alert with the camera: compares 128×96 frames twice per second after a 6-second camera warm-up, compensates for whole-frame exposure changes, and confirms movement across consecutive frames. Re-alerts no more than once a minute. Still pictures stay in `~/jarvis/Watch` (the last 50) and, if phone alerts are on, your phone gets a **text-only** alert. Starts after a confirmation, stops after 8 hours or on reload. *Keep the JARVIS window visible: browsers slow down hidden tabs.*
- **Similar photos** (“find similar photos”) — near-duplicates, even resized or re-saved, grouped in numbered sets; “clean sets 1 and 3” or “clean up the similar photos” moves the smaller copies to the JARVIS trash (undoable; copies inside a project are never touched). **Shrink** (“shrink my big photos”) re-saves JPEGs over 3 MB older than 90 days (quality 82, longest side 2560 px, EXIF kept); the original goes to the JARVIS trash and the new file keeps its name and date. *Space is only freed when you empty the trash.*

**Faster and smarter**
- **Skill suggestions** — when a message goes to ordinary chat and matches one of your skills by words (name, triggers, `keywords:` in `SKILL.md`), a button appears under the answer (“USE THE CODE-REVIEW SKILL”). A skill with `auto: true` in its header is used straight away; `suggest: false` keeps one out. Plain keyword matching, nothing is sent anywhere. Switch: *Suggest skills*.
- **Speak while writing** — the first sentence is spoken as soon as it is finished and the rest follow, for English chat answers (the same limit as before: the first two sentences, or more while the total stays under 320 characters, then “the full answer is on screen”; code is never read out). **Stop**: the ■ STOP button, Esc, or typing / saying “stop”, “be quiet”, “enough” cut the voice and the answer together. *There is no hands-free stop word while JARVIS is talking: the microphone cannot tell your voice from its own.* Switch: *Speak while writing*.
- **Chat search** — every message is also saved on this laptop (`~/jarvis/.chat-archive`, one file per month, 20 MB limit, oldest month first; a dot-folder, so file search never reads it). “What did I decide about the database last week?”, “search my chats for pandas in September”, `/history …` find old chats by words and dates; an AI summary is written only if the AI is on (and asked first when it is an online one). “Chat archive status”, “forget my chat archive” (Windows Hello), “turn off the chat archive”.

**For students**
- **Import my timetable** — from a **photo** (the table is rebuilt from word positions: days down the side or across the top), a **calendar file** (`.ics`, weekly repeating events) or **pasted lines** (“Mon 9:00-10:00 DBMS”). You see what was read and say yes; classes already there are skipped; **two classes at overlapping times** (among the new ones, or against one you already have) are flagged with “⚠ N clashes” before you say yes; **one “undo”** removes the new ones. If the photo cannot be read as a table, the text it saw is offered for you to correct.
- **Can I bunk tomorrow?** — tomorrow’s classes from the timetable and, per subject, your attendance now and after missing them against 75%.
- **Lecture mode** (“start lecture mode for DBMS”, “stop the lecture”) — the browser’s speech recogniser listens until you stop; the transcript is appended to `~/jarvis/Notes/lecture-<subject>-<date>.md` every 3 minutes, and at the end the AI writes notes (Notes / Key terms / Questions to revise / Announcements) from the transcript in pieces it can hold. *By default the browser’s recogniser sends the audio to Google or Microsoft, so it needs the internet and the tab must stay visible. For audio that never leaves the laptop, install **offline speech** (below) and say “turn on offline speech”; the wake word is paused meanwhile either way.*
- **Offline speech (Whisper)** — `install-whisper.ps1` (you run it; JARVIS never downloads on its own) puts the whisper.cpp program (a few MB) and one model (`base.en`, ~150 MB) in the `.whisper` folder next to JARVIS. If the browser reports no internet, regular mic dictation uses the installed local Whisper; if the connection drops during dictation, JARVIS switches when the browser speech service returns a network error. Lecture mode can also use Whisper with the Settings switch **Offline lecture transcription** (or “turn on offline speech”): it records the microphone in the page, cuts it at pauses into ~25-second pieces, converts each to 16 kHz mono WAV and has the local server transcribe it. Quiet pieces are never sent to Whisper (it invents words for silence). *CPU-only, so it can lag; English models are best; expect some wrong words.* “Is offline speech installed?” says what is missing.
- **Month-first dates** — numeric dates in an assignment sheet are read day first (10/11/2026 = 10 November). If your college writes them month first, say “my college writes dates month first” once (“read dates day first” switches back, “undo” too); then 10/11/2026 is 11 October. JARVIS always says how it read an ambiguous date.
- **Assignment from a photo or file** (“add assignment from a photo”, “add assignment from dbms_assign.pdf”) — the text is read (Windows OCR, or the file), and the title, subject, due date (day first: 03/04 is 3 April; “by Friday” is the next Friday; a time like “5 pm” is used, else 23:59), marks and numbered questions are found. You see the result and any assumptions first; “yes” adds one **deadline** and one **to-do per question**, and one **undo** removes them together. If no date is found it says so and adds nothing without you.
  Its question to-dos are **linked to the deadline**: the Tasks tab shows “OS lab · 2/5 done”, ticking the last one offers **MARK SUBMITTED**, and marking the deadline submitted ticks the to-dos still open.
- **Weekly deadlines** — “add assignment DBMS record due every Monday” (or “weekly lab report due Friday”) is marked ↻; when you mark it submitted, next week’s is added on the same weekday and time.
- **Flashcards → Anki, and how you are doing** — “export my flashcards to anki” (or “export my dbms flashcards to anki”) saves `Notes/anki-<date>.txt` in Anki’s import format (File → Import; the deck name becomes a tag). “Flashcard stats” shows cards, how many are due now, known well (box 5) and still new, per deck.
- **Did you attend?** — a few minutes after each class in your timetable ends JARVIS asks **I ATTENDED / I MISSED IT / CLASS CANCELLED / SKIP** (a cancelled class counts for nobody and is not asked about again that day; “undo” takes it back) (once per class per day, only while JARVIS is open; a subject you already marked today is skipped). Switch it in Settings or say “stop asking me about attendance”. Each mark has an undo.
- **One subject, many spellings.** “DBMS”, “dbms” and “Database Management Systems” (also OS, DSA, CN, COA, TOC, DAA, SE, OOP, AI, ML, DM, WT and a few more) are the same subject when you mark attendance, import a timetable or get the “did you attend?” prompt — no second row. A name JARVIS does not know is just itself.
- **Attendance target** — 75% unless your college asks for another number: say “my college needs 80% attendance” (or use Settings → Attendance target, 60–90%). Warnings, the bunk-o-meter, “can I bunk tomorrow?” and the report all use it; “undo” puts the old one back.
- **Fit my study plan to my timetable** — “fit my study plan to my timetable” puts each open day of your study plan into the longest free gap of that day (between 8 am and 9 pm, 60-minute sessions by default; “…with 90 minute sessions”), shows the result, and only a button adds a reminder at each slot’s start (one undo). Without a plan it lists your free gaps for the week.
  It also steps around your own reminders at a fixed time (“gym at 6pm” keeps 6:00–6:30 free); timers, routines and the study reminders it made itself do not count.
- **Your college’s grade scale, said once** — “my grade cutoffs are O 85, A+ 75, A 65, B+ 55, B 50, C 45, P 40” (any subset works; the ones you leave out keep the usual 90/80/70/60/55/50/40). The end-sem calculator then uses it for “…to get an A”, and says which scale it used. Higher grades must need higher percentages or JARVIS refuses the sentence; “undo” goes back.
- **What do I need in the end-sem?** — “I got 32/40 in internals, what do I need in the end sem to get 80%?” (also a grade letter, “pass” = 40%, or “end sem is out of 70”). It shows the working and says plainly when the target is out of reach. Grade cut-offs (90/80/70/60/55/50/40) differ between colleges.
- **Exam mode** (“start an exam on dbms_notes.md”, “exam me on normalization for 10 minutes”) — questions with model answers from a note, PDF or topic, a countdown, answers typed or spoken (everything you say is an answer until “stop the exam”), marked at the end against the answers in your notes. Weak answers go to a **Mistakes** flashcard deck (no duplicates, one undo); every result is kept: “how did my exams go?”.

### Everyday tools, screenshots & developer helpers

All explicit wording; anything that changes the system asks first, and the page’s own data changes with one undo. Phone messages are refused for anything that changes the laptop or reads your code.

- **Karnataka tenders (KPPP)** — “list me building tenders in mysore”, “how many building tenders in belgaum”, “tenders closing this week”, “road tenders above 1 crore”, “new building tenders”. Answers come from the KPPP results **you copied**: KPPP (kppp.karnataka.gov.in — the old eproc.karnataka.gov.in now lists none) shows its tender list only after a CAPTCHA, and JARVIS does not solve or get around it. So:
  1. Say **“open kppp”** (or press OPEN KPPP) — the live tender search opens; type its CAPTCHA.
  2. When the results show, press **Ctrl+A**, **Ctrl+C**.
  3. Say **“read these tenders”**. JARVIS reads the table (any column order; tab- or space-separated), keeps every tender number it has seen, and says how many there are, how many are building tenders and where, and how many are **new since your last import** (new to JARVIS — “published in the last 24 hours” is said only when KPPP’s NIT Published Date shows it).
  Lists are ordered by deadline (“closes today 5:30 pm”, “closes 24 Oct (in 7 days)”); tenders that already closed are left out and counted; each line has the tender number, name, place and value. KPPP has no web address per tender, so the link is the search page — search there by the number (COPY NUMBERS copies them). Places are understood in either spelling (Mysore/Mysuru, Belgaum/Belagavi, Bangalore/Bengaluru…). Every answer says when the list was copied, and after 12 hours JARVIS adds a separate warning that it may be out of date. With Online tools on it also gives KPPP’s public total of live tenders (every category — the only figure KPPP gives without the CAPTCHA).
  **6 PM digest:** “send me building tenders in mysore every day at 6pm” sets one daily reminder (the server fires it even with the tab closed, and it reaches your phone if phone notifications are on). At 6 PM JARVIS sends the building tenders from your latest copied list and, if that list is old or missing, a reminder to copy a fresh one with OPEN KPPP. “Stop the tender digest” removes it; “undo” works for both.
- **Recurring expenses** — “I pay 199 for netflix every month”, “pay 5000 for rent every month on the 1st”, “add a monthly expense 299 spotify on the 12th”. JARVIS logs it by itself on that day each month (once per month; if JARVIS was closed that day, when it next opens; a 31st means the last day of a short month) and says so in the chat, counting it toward your budget. A day already past this month is not back-dated — the first entry is next month’s. “Show my recurring expenses” lists them with the monthly total; “stop recurring netflix” removes one (past entries stay); “undo” reverses either.
- **Monthly budget** — “set my budget to 5000” (also “12k”, “1.5 lakh”, “my budget is 8,000 a month”). From then on, every expense you log adds a line when you pass 80% (“85% of your ₹5,000 budget is used — ₹750 left for 12 days, about ₹62 a day”) and when you go over it. “How’s my budget?” shows the status; “remove my budget” clears it; “undo” reverses either. Stored on this laptop with your expenses.
- **Expenses** — “spent 120 on lunch”, “paid 80 for auto”, “spent 1.5k on recharge yesterday”; “how much did I spend this month / on food this week” (with a small chart), “export my expenses” (CSV in `Notes`), “delete all my expenses” (asks; undoable). Categories are guessed from the words (Food, Transport, Study…). Sentences like “I spent the whole day studying” are not taken.
- **Habits** — “track habit gym”, “I did gym” (or “…yesterday”), “my gym streak”, “habits” (🟩 for the last 7 days). A streak counts back from today, or from yesterday when today is not ticked yet.
- **Quick capture** — “jot down buy a charger”, “note to self: …”, “capture: …” append a timed line to `Notes/inbox-<date>.md`; “show my inbox”. **Ctrl+Shift+N** opens a one-box panel while JARVIS is the active window (a system-wide key would need the desktop hotkey helper). Plain “capture the flag” or “inbox zero” are not taken.
- **Keep JARVIS running** — “keep JARVIS running” (asks first) adds a Windows scheduled task, **JARVIS Keepalive**, that checks every 2 minutes and starts JARVIS again only if it is not running; it never restarts it after *you* stopped it (Stop JARVIS or “quit”). “Stop keeping JARVIS alive” removes it. A Settings switch does the same, and a restart is announced next time you open the page.
- **Back up to another drive** — “back up my files to D:” (or “set my backup folder to D:\JARVIS-Backup”, then “run a backup”, “backup status”, “turn on weekly backup”, “include my projects in the backup”). A plain folder of plain files: new and changed files only, an older version of a changed file kept 30 days in `_previous`, **nothing deleted from the backup**, every copy checked, never your API keys, the trash, or the screenshot index. The folder must be one you approve and is marked so it is never mixed with other things. Weekly runs happen while JARVIS is open.
- **Verify my backup** — “verify my backup” / “check my backup” / “is my backup intact?” compares the backup folder with your files and changes nothing: files **not in the backup yet**, files **changed since the last run**, and backup copies that are **damaged** (same size and date as your file but different bytes — files up to 8 MB are compared byte for byte). It names the first few of each and says what to do (“back up my files” to catch up; delete a damaged copy and back up again).
- **Free space from projects** — “find old node_modules” / “clean regenerable folders” lists `node_modules`, `__pycache__`, build folders and similar in projects untouched for 30+ days (they can be rebuilt); moves them to the JARVIS trash with undo. A low-disk alert offers it.
- **Screenshot search and visual analysis** — “find the screenshot with the wifi password”, “index my screenshots”, “add D:\\Shots to my screenshot folders”. The index includes JARVIS screenshots saved to Desktop as well as Pictures\\Screenshots, OneDrive screenshot folders and the JARVIS folder. Windows OCR reads each picture once on this laptop; use **ANALYZE** on a search result to ask the selected vision model about visible objects, interface elements and text in that saved image (it does not recapture the live screen). This is vision-model scene understanding, not a pixel-accurate bounding-box detector; it reports uncertainty rather than inventing detections. Screenshot files are kept; OCR indexing no longer deletes Desktop screenshots after an hour. The text index remains in `~/jarvis/.shotindex.json` and is excluded from drive backup. Handwriting and small text can be missed.
  Search also matches word forms: “invoices” finds a picture that says “invoice”, “errors” finds “Error:”, “booked” finds “booking”.
- **Developer helpers** — “git summary today / yesterday / this week” (your commits in the project folders you gave JARVIS, plus uncommitted files), “write my standup” (last working day + today + near deadlines), “write a commit message” (the AI reads your uncommitted diff; files like `.env` and keys are left out; **it writes text only — nothing is staged or committed**), “why did my build fail?” / “explain the error on my screen” (reads the clipboard, else the screen; finds your own files and lines in the trace, reads ±15 lines around them, and explains). With an online AI model each of these asks before sending code.
  Commit messages come in two styles: plain (“Add login rate limit”) or **conventional** — say “write a **conventional** commit message” (or “semantic”) and you get “feat: add login rate limit”, “fix: crash when…”, “docs: …”; a message the AI already wrote that way is kept as it is.

- **WhatsApp drafts** — “send WhatsApp message to +91 98765 43210 saying I’ll arrive at 5”. JARVIS opens a prefilled WhatsApp draft; verify the recipient and press Send yourself. It does not send silently.
- **Movie tickets** — “book movie tickets for Dune in Bengaluru” opens BookMyShow for the city. Pick the exact movie, cinema, time and seats and confirm on the provider site.
- **Bus tickets** — “book bus tickets from Bengaluru to Mysuru on 25 October” opens the redBus route. Verify date, boarding point, operator and cancellation policy before booking.
- **Shopping** — “shop for wireless mouse” or “buy wireless mouse” opens an Amazon India search. JARVIS does not place orders, save payment details or pay; you review the seller and checkout yourself.

### Calling and Android voice

JARVIS now includes an **opt-in outbound phone announcement** flow and an initial Android in-app voice flow:

- **Outbound phone call:** configure Twilio credentials on the JARVIS server, then open `/calling.html` or issue the explicit desktop command “JARVIS, call me.” The call speaks a short message to your configured number; it is **not yet a two-way conversational cellular call**.
- **Android voice:** the companion app captures one utterance, sends it through the capability-protected Phone Hub gateway, then speaks JARVIS's text reply. This is turn-based speech, not continuous full-duplex audio.
- **Reminder calls:** off by default. Enable only if wanted with `JARVIS_CALL_ON_REMINDERS=true`; reminder calls also respect the JARVIS Alerts and panic switches and the configured quiet hours.
- **Security:** calling credentials stay server-side. The Phone Hub gateway is separately configured, HTTPS-only, disabled unless explicitly enabled, and grants `voice` and `calls` capabilities separately. For away-from-home in-app voice, connect both devices to Tailscale and bind the gateway to the laptop's Tailscale IP; do not expose the general JARVIS server or forward gateway ports publicly.

Start with [Calling setup](docs/CALLING.md), [Phone Hub setup and security](docs/PHONE-HUB.md), and the [Android companion guide](android/phonehub/README.md). This is an initial implementation: Twilio credentials, provider account restrictions, Android certificate trust, physical-device pairing, and real call delivery must be configured and verified by the operator. CI/build checks do not prove a real call or phone-network setup works.

### Phone — alerts and commands

- **Phone alerts:** Settings → **Phone alerts** pushes reminders and deadline alerts to the free **ntfy** app on your phone. Messages to ntfy go out one at a time, an identical reply is sent only once within 30 seconds, and after a "too many requests" answer from ntfy.sh JARVIS pauses instead of retrying, so the phone app stays responsive.
- **Phone commands:** send commands from ntfy — they only run after you **unlock with the 6-digit code** from Google Authenticator (just send the digits, e.g. `482913`). Unlocked for **10 minutes**; send `lock` to lock. Each code works once; 5 wrong codes pause unlocking for 10 minutes. **Strict mode** (Settings → Phone alerts) removes the unlock window: every command starts with its own fresh code (`482913 open chrome`), so someone watching the public topic can never ride on your unlock. `NTFY_TOKEN` (an environment variable) is sent as a Bearer token if you use a private or self-hosted ntfy.
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
| Show a panel in immersive mode | Select **Hide controls**, then say `show my notes` · `show my calendar` · `close panel` |
| Inspect an application or website | `show app controls` · `inspect Notepad` · select a browser window in **Apps** |
| Review a control action | `click control 7` · `fill field Message with Meet at 5 PM` → review the exact window, control and text |
| Hindi/Hinglish direct commands | `Chrome kholo` · `वॉल्यूम ३० करो` · `5 minute ka timer lagao` |
| Main account reads | `read google mail` · `check microsoft calendar` · `search google files for DBMS` → connect and approve first |
| Office/media outputs | Open **Apps → Background tasks and MCP tools → Documents, data, images and reviewed code** and use its forms |
| Specialist workspace | `open mark controls` · `enable Mark 1` — only within explicitly enabled Marks preview |
| Emergency stop | `emergency stop` · `stop everything` · Apps stop button · opt-in **Ctrl+Alt+Pause**; explicit `resume` permits new work |
| Capture and review notes | `save a voice note: DBMS demo moved to Friday` · `show what I captured today` · `make a task from the first one` |
| Turn a capture into a reminder | Open the inbox, then `remind me about the second one tomorrow` → review |
| Save or resume a checkpoint | `pause DBMS here. Next, test the joins.` · `resume my DBMS workspace` |
| Hold routine alerts | `keep it quiet until my break` · `what did I miss?` |
| Correct a pending voice request | `open my OS notes` → `wait, I meant DBMS` |
| Find study time | `where can I fit 45 minutes of DBMS before Friday?` |
| Search a scanned PDF | Select and index the PDF in **Notes**, then `find the deadlock diagram in this scanned PDF` |
| Listen to local FM | `show FM stations in Hyderabad` · `set my radio city to Hyderabad` · `play 101.9` |
| Study with sound | `start a 45-minute study session with rain sounds` |
| Play and resume audio | `open media` · `pause my audio` · `resume my podcast` · `stop my audio in 30 minutes` |
| Open provider music | `play lo-fi study music on Spotify` · `play Believer on YouTube` |
| Hear regional news | `brief me on Bengaluru in Kannada` |
| Open or close an app | `open spotify` · `close chrome` · `open canva` |
| Control the laptop | `volume 40` · `mute` · `brightness 60` · `dark mode` · `lock the screen` |
| Reminders & tasks | `remind me to call mom at 6pm` · `add revise graphs to my list` · `what's due this week?` |
| Focus | `start a focus session` · `focus on DBMS for 25 minutes` · `block distractions` |
| Suit up (the whole scene) | `suit up` · `suit up for 25 minutes on dbms with music` · `undo` puts it all back |
| Plan study | `plan my day` · `plan my GATE prep, exam on 12 Feb, topics: OS, DBMS, CN` · `what should I study today?` |
| Track attendance & marks | `mark dbms present` · `attendance report` · `can i bunk tomorrow?` · `add s3: 8.6 gpa, 24 credits` · `what is my cgpa?` |
| Student extras | `start lecture mode for DBMS` · `add assignment from a photo` · `fit my study plan to my timetable` · `I got 32/40 in internals, what do I need in the end sem to get 80%?` · `turn on offline speech` |
| Money, habits, notes | `spent 120 on lunch` · `how much did I spend this month` · `track habit gym` → `I did gym` · `jot down buy a charger` · `show my inbox` |
| Keep it safe | `keep JARVIS running` · `back up my files to D:` · `backup status` · `turn on weekly backup` · `find old node_modules` |
| Screenshots | `show my saved screenshots` · `index my screenshots` · `find the screenshot with the wifi password` · choose ANALYZE on a result to identify visible objects/text |
| Developer day | `git summary today` · `write my standup` · `write a commit message` · `why did my build fail` |
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
| **Connected services** | Calendar feed · Connect/Disconnect | Read-only public HTTPS iCalendar feed for Today and availability searches. |
| | Morning daily briefing · Briefing time | Opt-in daily spoken summary while JARVIS is open, with a ten-minute late-start window. |
| | Regional headlines in briefings | Uses your Home City and Online tools for supported regional feeds. |
| | Daily quiet hours · Quiet start/end | Holds routine laptop alerts during the selected local-time interval. |
| | Let deadline warnings through quiet hours | Allows deadline warnings during quiet time. |
| | Study hours start/end | Bounds suggested study slots; defaults to 08:00–22:00. |
| | Home Assistant URL/token · Connect/Disconnect | Connects supported devices, reports actual connection state, and requires one-time approval for control actions. |
| **AI brain** | Use AI brain · Model | Turn the AI on/off; pick a local (Ollama) or cloud model. |
| | Guided setup (AI / PHONE) | Step-by-step setup for non-technical users. |
| | AI providers | Add an API key (auto-detected provider), TEST it, or remove it. **Custom** accepts any OpenAI-compatible URL (LM Studio, vLLM, llama.cpp). |
| **Voice** | Speak replies · Assistant (JARVIS/FRIDAY) · Speech language · **Microphone engine** · Reply language | Choose Web Speech API (faster, multilingual, needs internet) or Whisper (local, offline, slower). |
| | Online translation · Neural voice | Better Telugu/Kannada answers and natural voices (send reply text online). |
| | Voice check · Address me as · Voice · Speech rate · Interface sounds · Wake word | Voice details and your wake word. |
| | Test my mic | Say 14 command words; see what the mic heard, what JARVIS repaired, and the score. |
| **Behaviour** | HUD theme · Answer length | Arc blue, gold, crimson, violet; concise/balanced/detailed. |
| | Online tools · Home city | Weather, web answers, contests, directions (off by default). |
| | Show how I understood you | Under each reply: what was heard, intent, confidence, details, context, decision (tool / local AI / web) and why, permission tier. |
| | Smart alerts · Charger alerts · Global hotkey | Battery/RAM/deadline alerts; "charger connected / disconnected"; Ctrl+Shift+J. |
| | Phone alerts · Phone access | ntfy alerts & commands (+ authenticator); Tailscale access. |
| | Focus / break (min) | Pomodoro lengths. |
| | **Ask about attendance after class** | A few minutes after each class in your timetable ends, JARVIS asks *I attended / I missed it / skip* (on by default; only while JARVIS is open). |
| | **Offline lecture transcription** | Lecture mode uses Whisper on this laptop instead of the browser’s recogniser (audio never leaves the computer). Off by default; needs `install-whisper.ps1`. |
| | Speak while writing | Speaks the first sentence of supported English chat answers while generation continues; Stop/Esc interrupts it. |
| | Suggest skills | Shows an optional matching skill under an answer. Research mode and emotional-intelligence preferences also have their own chat commands. |
| | **Keep JARVIS running** | Adds / removes the Windows scheduled task *JARVIS Keepalive* (checks every 2 minutes; never restarts JARVIS after you stopped it). |
| | Semantic search · Embedding model | Meaning-based file search ("wifi problem" finds "no internet"); needs an Ollama embed model such as `nomic-embed-text`. |
| **Backup & restore** | Export · Import · Include my API keys · snapshots | See [Undo, backup & your data](#undo-backup--your-data). |
| **Project folders** | Add/remove folders | Used for preparing environments, starting backends and frontends, git, and searching your notes. JARVIS can open files anywhere without adding them here. |
| **Data** | Require Windows Hello | Fingerprint/face/PIN for shutdown, restart, sleep, deleting files, clearing the sandbox, erasing data and importing backups. |
| | **Lock JARVIS** · Auto-lock · LOCK NOW | Opens JARVIS only after Windows Hello (needs *Require Windows Hello* first). Auto-lock after Never / 5 / 15 / 30 / 60 min idle. Turning it on/off needs a Windows Hello approval. Say "lock jarvis" to lock now. |
| | Erase all local data | Clears shared application state after a snapshot; it does not recursively erase exports, provider configuration, browser profiles or separate Marks/runtime files. |
| | Start with Windows · Stop JARVIS | Run JARVIS in the background at every sign-in; end the background server. |
| | Updates · Check | Compares your version with the latest GitHub release — only when you click, and only if Online tools is on. |

Several controls live in **Apps**, outside the Settings drawer: background start
time/runtime/model-call budgets, emergency stop and **Ctrl+Alt+Pause**, MCP
connections, extended native actions, isolated browser, reviewed scripts and the
main account/vault panel. Marks preview settings use their own workspace and
environment variables. Enabling one of these does not automatically enable the others.

---

## 10. Privacy & security

- **Local listener.** The main server binds to `127.0.0.1:3002` and checks Host, Origin and sensitive read requests. Optional Tailscale access and the separate HTTPS Phone Hub gateway require their own setup.
- **AI and online services.** Local Ollama inference runs on the laptop. A selected cloud model receives the request and any file excerpt, clipboard text or screenshot used for that request. Web research, feeds, streaming, phone notifications, translation and neural voices use their configured online services.
- **Application actions.** Window inspection runs on demand through Windows accessibility. Password controls are omitted. Click/fill and enabled extended native actions require exact one-time server approvals, and an action consumes its inspection. The separate browser adapter rechecks page content, labels and form values before acting.
- **Connected-service credentials.** Calendar feed URLs and Home Assistant tokens are stored in the server configuration. Settings returns connection status while keeping saved credentials server-side.
- **Recent local features.** Workspace checkpoints, podcast subscriptions/positions and held-alert recaps use the shared local state. Selected local audio plays from a browser file URL, and PDF OCR uses local Windows rendering and recognition.
- **Online extras:** the Online tools switch controls its associated tools, not every possible network call. Cloud model selection, browser speech recognition, connected accounts, translation and neural voices have their own settings and consent paths. Translation and neural voices default to enabled and can be switched off.
- **The update check is click-to-run** (Settings → Data → Updates): GitHub is asked only then, and only while Online tools is on.
- **The server decides what's allowed, never the AI.** Every tool has an argument schema and a permission tier: *safe* (runs), *confirm* (asks first with the reason), *explicit* (its own confirmation every time, never in routines), or refused. Invented tools, `../` paths, "volume 999", shell commands — rejected before anything runs.
- **Windows Hello approvals** (optional): the server verifies a fresh signed challenge for guarded power/file/data actions. When enrolled and required, reviewed desktop/browser/execution/account/vault/MCP requests additionally bind the proof to the exact approved request body; it cannot authorize a different target or be replayed.
- **Credential storage:** the main account panel uses Windows-user DPAPI. Model keys migrate only after review; Home Assistant credentials and legacy/unmigrated secrets still have separate configuration storage. Marks preview account tokens stay in server memory. Authentication keys/tokens are sent to their intended providers when making authorized requests.
- **Cloud privacy filter:** recognizable private keys, labeled credentials and selected financial identifiers are blocked before cloud chat and embedding requests. It is a bounded pattern filter, not a guarantee that every piece of personal data is detected.
- **A reload no longer loses things.** What **“it” / “there”** refer to (the folder or file JARVIS last showed, found or made, and the numbered results) is kept too, for 15 minutes. A **focus session** (and its break) is saved as it runs and picked up again when the page reopens, if its time has not run out (a session that ended while the page was closed is not revived); running **timers** already came back the same way. **Two routines due at the same moment** used to lose the second one — now it waits in line (once, however many times it is due) and runs after the first. And with **two tabs open, an alert is said once**: the first tab to ask the server for it wins (`POST /api/claim`), the other stays quiet — class-starts-soon, battery and the other smart alerts alike; if the server cannot be reached a tab just says it.
- **“Ask my files” got three upgrades.** (1) **Telugu, Kannada and other scripts are searchable** — the word splitter used to see only a–z, so notes written in Telugu or Kannada could never be found. (2) **The index survives a restart** (`~/jarvis/.rag-cache.json`, a hidden file that is not backed up or shown to other tools): a restart no longer re-reads every note and re-extracts every PDF/Word/PowerPoint file; a file is reused only while its size and modified time are unchanged, a damaged cache is ignored. (3) **Every folder you share gets its own share of the 3,000-file limit**, so a big project folder can no longer use it all up and leave your notes un-indexed.
- **If Ollama is not running, JARVIS says so at once.** The first refused connection fails every AI call that is waiting, and for the next 3 seconds new ones fail straight away with “is Ollama running?” — instead of each one retrying in turn and piling up behind a server that is not there.
- **“JARVIS froze” leaves a trace.** The server log notes any request that took over 3 seconds (`[slow] POST /api/... 4200 ms`), one the page gave up on (`[unfinished]`), and any moment the server itself was busy for more than 1.5 s (`[lag]`). Paths and times only — never what you typed.
- **The local model takes turns, chat first.** Your laptop has one GPU. A long job (a JARVIS Code build, lecture notes, a project wiki, a chat summary, the weekly digest) and a chat message sent at the same moment used to fight for it and both crawled. Now calls to the local model run **one at a time**, and when several are waiting the next is the most urgent: **chat first, ordinary tools next, background work last** (a job already running is never cut off; a request you cancel while it waits simply leaves the line). Online models are not queued. Slots are always given back — when a reply ends, fails, is cancelled or the reader stops. Advanced: `llmParallel` in the config allows 2–4 at once if your GPU can take it. (`llm.js`, tested in `llmqueue.test.js`.)
- **A permission card makes JARVIS wait for your answer.** When JARVIS asks ALLOW / CANCEL (a change outside `~/jarvis`) or YES / NO in the middle of a task, it is in an explicit “waiting for your answer” state: typing **yes**, **yes please**, **no** or **cancel** answers the card; anything else you type is queued (“Queued: …”) and runs after the answer instead of starting a second task in the middle of the first. A card nobody answers counts as **no** after 10 minutes, so JARVIS never stays stuck.
- **Two tabs no longer overwrite each other.** JARVIS saves whole lists, so a tab left open all morning used to write its old to-dos, classes, attendance or expenses over what another tab (or the phone page) had just saved. Now the server tells every other open tab the moment one of these lists changes — to-dos, reminders, deadlines, timetable, attendance, marks, study plans, memory, expenses, habits, the budget — and they take the new copy at once. A tab ignores its own changes, skips a list it is itself saving, and never echoes back. Settings stay per tab. Restoring or importing a backup makes every open tab reload, so none can write its old copy back over it. And if a tab is a save behind anyway (two saves crossing), the server **merges** instead of overwriting: what the other tab added is kept, what this tab deleted stays deleted, and for an item both changed this tab’s version wins (`statemerge.js`).
- **Web pages are fetched from the public internet only.** When JARVIS reads a page (research, “summarise this link”), the address is checked, the name is resolved and every address it gives must be public, and redirects are followed one step at a time with the same check — so a public page cannot send JARVIS to `127.0.0.1`, your router, a printer or another program on this laptop (including JARVIS itself). Spellings like `[::ffff:7f00:1]`, `2130706433`, `100.64.x.x`, `*.local` and `*.internal` are refused too.
- **App lock (optional): JARVIS opens only after Windows Hello.** Settings → Data → **Lock JARVIS**. While locked, the *server* refuses every `/api` request (your chat, memory, tasks and every tool) and shows a standalone **lock page** instead of the app — the app's code doesn't even load, so it isn't just a cover over the page. Unlocking is a signed **Windows Hello** check (fingerprint, face, or your **Windows Hello PIN** — the PIN you use to sign in to Windows) verified by the server, the same mechanism as the shutdown/delete approvals. JARVIS can't read or check your Windows account *password* itself; Windows Hello is how a web app asks Windows to confirm it's you. It locks again after the chosen idle time (Never / 5 / 15 / 30 / 60 min), on **"lock jarvis"** / **LOCK NOW**, and whenever JARVIS restarts. Turning the lock on or off needs a fresh Windows Hello approval. Unlocking works **at the laptop only** (Windows Hello is localhost-only), so the phone/Tailscale page stays locked. Reminders, triggers and phone alerts keep running in the background while locked. It needs "Require Windows Hello" to be set up first, and it can never lock you out: if the Windows Hello key is removed from `~/jarvis/.config.json` (the documented recovery), the lock simply stands down.
- **Three access zones for files.** *Home* (`~/jarvis`): free to use. *Laptop* (everywhere else): JARVIS can open and read, but **any change asks ALLOW / CANCEL first**, and phone commands or unattended routines can never approve one. *Blocked*: Windows, Program Files, ProgramData, your whole AppData, key folders (`.ssh`, `.aws`, …), the Recycle Bin, JARVIS's own config and its program folder — refused even if you click ALLOW. Deletes go to `~/jarvis/.trash` (also across drives) and JARVIS keeps the previous version of anything it overwrites, so "undo" works.
- **No shell injection:** apps open by exact Windows IDs, prompts to coding agents are passed as data (stdin or an encoded literal), never as shell text.
- **Secrets stay put:** API keys and the phone key live in `~/jarvis/.config.json`, are shown only masked, can't be read through JARVIS's own file tools, and are included in backups only when you choose (encrypted with your password).
- **A single command can no longer skip the permission tier.** Typing or saying “close chrome”, “run main.py”, “start/stop the dev server”, “clone a repo” or “paste into the editor” shows what is about to happen and waits for **YES, DO IT** (a misheard word can’t kill an app or run a program). Commands that already ask for themselves (shutdown, Wi-Fi off, commit…) are not asked twice.
- **Private content goes to an online AI only after a yes.** With a cloud model, the text you copied, your screen (picture or OCR text), excerpts from your own files and text you selected with the hotkey each ask once per page session before they are sent. A local Ollama model never asks.
- **JARVIS’s own data files are unreadable through the file tools:** every dot-file/dot-folder in `~/jarvis` (screenshot index, chat archive, AI log, backup settings…) and loose credential files in your home folder (`.git-credentials`, `.npmrc`, `.netrc`, shell histories…) plus `.claude`, `.codex`, `.gemini`, `.config/gh|gcloud|git`.
- **“Commit all changes” never guesses and never commits a secret.** It needs a named project (or the only git project you gave JARVIS; never JARVIS’s own folder), lists the exact files `git add -A` would stage, and **refuses** if any looks like a secret by name (`.env`, keys, certificates…) or by content (private keys, cloud/API tokens, `password = "…"`). The same patterns are blanked out of a diff before an AI writes a commit message.
- **“ALLOW” can’t be faked.** A change outside `~/jarvis` is only done after the page presents a one-time token that the server handed out for exactly that action on exactly those paths (valid 5 minutes, used up by one retry). A request that merely says `"approved": true` is answered with a new 409 and does nothing.
- **Websites JARVIS builds can’t phone home.** Each generated page carries a Content-Security-Policy that lets it run its own script and style and show its own pictures, and blocks every outside request (fetch, images from other sites, fonts, frames, forms), plus any `<base>` tag; the text filters stay as a second layer.
- **The AI is asked again, politely, when its provider hiccups.** A busy or briefly-down model (HTTP 429/500/502/503/504, or a dropped connection) is retried up to twice with a short, slightly random pause (and the provider’s “Retry-After”); a bad key, a bad request or a Stop is never retried. Calls the page makes to the laptop stop waiting after 3 minutes (15 for AI, folder-walking, installs), instead of hanging JARVIS for ever.
- **Saying “don’t …” does nothing.** “Don’t lock the screen”, “never open chrome”, “no, don’t set a timer” are understood as a refusal: JARVIS answers “Okay — I won’t …” and runs nothing (before, “don’t open chrome” closed it and “don’t lock the screen” locked it). “Don’t shut down” still cancels a pending shutdown, “stop the music” is still a command, and “don’t forget to …” is still a reminder-style sentence.
- **“Yes, make it a routine” makes one.** When JARVIS notices you open the same app (or start the same focus session) around the same hour and you accept its offer, it creates a routine with that one step and schedules it every day at that hour (it runs while JARVIS is open; “undo” removes it). A learned command that is only an intent name is not turned into a routine — JARVIS tells you how to make one by hand.
- **Timers survive a reload.** Each timer is also written down as a hidden safety-net reminder 20 seconds after it should ring: if the page is open it rings on time and removes the reminder first; if the page was closed or reloaded, the laptop’s scheduler rings it (and your phone, if phone alerts are on) and a reloaded page brings the countdown back. Focus sessions and breaks also restore their remaining time after a reload; audio may require a click to restart.
- **Undo survives a reload** for file actions (delete, rename, move, copy, create, overwrite): the server keeps how to reverse each for 30 minutes (`~/jarvis/.undo-log.json`, a private file) and the page restores them when it starts.
- **The local AI’s memory is sized to each request** (it never exceeds what a feature asked for, never goes below 4,096, and counts Telugu/Kannada text in full), so a short question no longer makes the model reserve room for a long page. Research answers no longer carry the earlier chat (the fetched pages hold everything needed).
- **Lecture notes** now cover a lecture of up to about three hours in full (36 pieces) and say plainly when the merged notes were too long to arrange; exam questions look at more of a long note when more questions are asked for.
- **Screen readers:** the conversation is a log region, every settings switch and dropdown is named from its row label, and each finished reply is announced once in a polite live region (streamed words are not read one by one).
- **Phone commands** need a fresh one-time authenticator code; dangerous and data-leaking commands are refused from the phone.
- **Sensitive laptop-only APIs.** Expenses, the screenshot text index, drive backup, keep-alive and developer-helper data require the laptop page's origin/access checks. Separately configured phone APIs expose only granted capabilities. JARVIS does fetch approved web/feed/media/model resources; optional Whisper installation remains a user-run setup step.
- **Code and errors go to an online AI only after you say yes.** If your model is online, “write a commit message” and “why did my build fail” ask first; the commit-message diff leaves out `.env`, keys and certificates.

**Where your data lives** (all in your user folder):

| Path | Contents |
|---|---|
| `~/jarvis/.jarvis-state.json` | Chat, memory, tasks, reminders, flashcards, routines, triggers, settings, workspaces/checkpoints, podcast subscriptions/positions and quiet-hour recaps |
| `~/jarvis/.config.json` | Project folders, provider settings, unmigrated API keys or vault references, Home Assistant/feed settings, phone key and Windows Hello public key |
| `~/jarvis/.secret-vault.json` | Windows CurrentUser DPAPI-encrypted main account tokens and migrated model/client secrets; not portable across Windows users |
| `~/jarvis/.agent-jobs.json`, `.mcp-connections.json` | Main read-only job checkpoints/results and saved MCP connections; external tools reconnect explicitly after restart |
| `~/jarvis/.managed-browser/session-*` | Separate browser profiles; may retain site data independently of chat history |
| `~/jarvis/.execution/` | Temporary reviewed script sources, removed after execution; not a VM |
| `~/jarvis/Exports/` | Generated Office files and converted image/audio outputs |
| `~/jarvis/.marks-history.json`, `.marks-jobs-*.json` | Profile-dependent preview results, separate background checkpoints and reviewed phone-report sharing state |
| `~/jarvis/.marks-library.json`, `.marks-batches/` | Approved text tools/memories and retained batch recovery data |
| `~/jarvis/.jarvis.lock`, `.jarvis.pid`, `.jarvis-port` | Which JARVIS is running (pid and port); keeps it to one copy and lets Stop JARVIS find it |
| `~/jarvis/.backups/` | Automatic snapshots |
| `~/jarvis/.shotindex.json` | Words read from your screenshots (never copied by the drive backup; “forget my screenshot index” deletes it) |
| `~/jarvis/.mirror.json`, `.keepalive.json` | Drive-backup settings and last run · whether keep-alive is on |
| `D:\jarvis\.whisper\` (next to the program) | whisper.cpp and the speech model, only if you ran `install-whisper.ps1` |
| `~/jarvis/Notes/inbox-<date>.md`, `expenses-<date>.csv` | Quick-capture inbox · expense exports |
| `~/jarvis/.trash/` | Deleted files (restorable) |
| `~/jarvis/Notes`, `Code`, `Documents`, `Projects` | Your files |

**Erase all local data** resets shared state and takes a snapshot. It is not a
whole-folder secure wipe: configuration, credentials, exports, backups, browser
profiles and the separate runtime/Marks stores require their own review and
cleanup. Disconnect providers and revoke remote consent separately where needed.

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
- **The classifier is first-match.** `nlu.js` tries its rule table (`R`, 186 distinct intents) top to bottom and returns the first rule that matches, then applies a few *sanity checks* that can change or downgrade the result (e.g. a device word inside a question drops to 0.6). Rule **order** therefore matters.
- **0.85 is the line.** At or above it a command runs directly; below it the request goes to the decider's fallbacks / the AI. The decider sits *on top of* the classifier and may overrule a weak match (for example "open the nearest ATM" is caught by the generic "open a web page" rule, but the decider sends it to Maps).

### 11.3 Understanding layer

#### Speech input — `voice.js`, `script.js`, `wakeword.js`
- **What it does:** turns your voice into one clean sentence.
- **Flow:** choose **Web Speech API** or **Whisper · local** under Settings → Voice. Web Speech API uses browser `SpeechRecognition` (English / Telugu / Kannada, continuous, interim results, 3 alternatives) and falls back to Whisper when offline if the installed model supports the selected language. Whisper records locally and submits a phrase after a pause. The current `base.en` model supports English only. `finishDictation` → `handleUser(text, 'voice')`.
- **Wake word:** on Windows, `wakeword.js` runs the offline `System.Speech` recogniser in the foreground and in other apps; a hit starts dictation with `source: 'wake'`. Turning it on is remembered across page reloads; the browser recogniser remains a foreground fallback on platforms without Windows speech.
- **Privacy note:** Chrome/Edge normally send dictation audio to their speech service. When the browser reports offline, JARVIS uses its installed local Whisper model; if the connection drops mid-dictation, it switches after the browser speech service returns a network error. Lecture mode uses Whisper when **Offline lecture transcription** is enabled; otherwise it uses browser speech recognition and needs the internet.
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
- **Debug:** `curl -X POST localhost:3002/api/tool/similar -H "Content-Type: application/json" -d '{"name":"calculater","kind":"folder"}'`; `tests/reliability.test.js` ("Did you mean").

#### Skills & routines — `skills-page.js`, `skills.js`, `routines.js`
- **What they do:** multi-turn features that own the conversation until they finish: website generator (asks what / where), UI-design prompt (TCREI), DSA coach, viva practice.
- **Flow:** `Skills.intercept(text)` runs early in `handleUser`; while a session is active it answers every message; otherwise it matches a start phrase (`SITE_START`, `VIVA_START`, …) or returns `null`. Heavy lifting is on the server (`/api/skill/site`, `/siteEdit`, `/siteRevert`, `/coach`, `/viva/*`) so the AI call and the file writes are validated there.
- **Debug:** `Skills.state` in the console.
- **Skill packs (`skillpack.js`):** `GET /api/skills` lists the loaded skills (never their instructions), `POST /api/skills/reload` rescans, `POST /api/skill/run {skill, input}` runs one (its `SKILL.md` body is the system prompt). Folders are read from `./skills-bundled` and `~/jarvis/Skills`; yours replaces a shipped one of the same name; symlinks, oversize files and bad names are skipped and reported. The page loads the list at start (`Skills.loadPacks()`), matches `/name`, "use the X skill…", then trigger phrases (only after the built-in skills, so they can't take over a session), and runs by `uses`: `research` → `doResearch` builds the sources prompt, `files` → `/rag/search` finds the excerpts, `plan` → `Agent.plan`, none → just the skill. `Skills.packs` shows what's loaded.

#### Multi-step agent — `agent.js`, `agent-tools.js`
- **What it does:** several actions in one sentence, planned, validated, previewed and verified.
- **Flow:** `Agent.route` splits the sentence (`parts`, `splitAnd`, goal sentences like "I'm going to study…") → known parts are classified by the rules, unknown parts go to the **AI planner** (`POST /api/agent/plan`: JSON, ≤ 5 steps, temperature 0, pre-filtered by `refuse()` for things no tool can do) → the server **validates every step** (`validatePlan`: tool exists, arguments fit the schema, tier) → the page shows a **preview** ("No changes have been made yet — EXECUTE / CANCEL") → `Agent.execute` runs the steps in order, **verifying each for real** (`check:` kinds such as `app_started`, `todo`, `volume`, `file`) → a tally ("4 of 4 verified"). Failures offer **RETRY / CONTINUE / ROLLBACK**; every run gets an id (`AGT-…`) and an **execution inspector** card.
- **Debug:** `Agent.lastRuns()`, "inspect the last run", `GET /api/agent/tools` (every tool, its tier and check), `tests/agent.test.js`, `plan.test.js`.

### Background tasks and MCP

The separate [Marks developer preview](docs/MARKS.md) is gated off in standard JARVIS and uses the same `localhost:3002` instance.

**Emergency stop:** say `emergency stop` or `stop everything`, or use the button under **Apps → Background tasks and MCP tools**. It bypasses busy chat and pending approval cards, blocks new server action requests, cancels background jobs, invalidates native desktop approvals, and disconnects MCP tools. It requests termination of registered JARVIS code/build and project-server children by their specific process IDs, never by process name. Stop state persists across a restart and cannot be cleared by a stale tab's state write. Say `resume` explicitly to allow new requests; cancelled tasks and old approvals do not resume. Already accepted OS/provider operations may still finish; subprocesses launched through other adapters are not all covered yet. This is tracked as incomplete in the [implementation progress](docs/IMPLEMENTATION-PROGRESS.md).

The same panel offers an **off-by-default global Ctrl+Alt+Pause shortcut** on Windows, using [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey). It receives only shortcut notifications and does not log ordinary keyboard input. The panel reports listener availability and registration conflicts. The helper shuts down with JARVIS. A laptop without a Pause key can use the button or voice/text command.

**Command fixes:** `set brightness to half` means 50%; `make volume 20 percent lower` reduces the current value proportionally (80 → 64); `20 points lower` subtracts points (80 → 60). Fractional units such as `two and a half GB to MB` are supported (binary 1024-based storage units), as are `end of the month` and `end of next month`. With a pending reminder, `I meant Wednesday` or `actually, make it 6` replaces an existing day/time slot and keeps the confirmation flow.

**Background tasks:** say `in background summarize dbms.md`, `in background list my tasks`, or `show background tasks`. JARVIS previews the plan before queueing it. Supported background tools are `read_file`, `summarise_file`, `list_todos`, and `list_deadlines`. File access stays within approved folders, excludes private JARVIS state, and currently supports text files up to 200KB. Summaries use the configured default AI model; with a cloud model, the selected text goes to that provider.

The server saves the queue before accepting a task and checkpoints every step. You can close the page and keep working while the JARVIS server runs. Completion uses the existing page, Windows toast and configured phone-alert delivery. Inspect results or cancel work under **Apps → Background tasks and MCP tools**. Cancellation prevents later steps and discards a cancelled step's result; an AI request already in flight may finish on its provider. After a server restart, queued jobs are revalidated and resumed; in-flight jobs become **interrupted** and are never automatically replayed. The queue holds up to 10 pending tasks and 50 records, with up to 32 steps per submitted job. The natural-language planner retains its five-step limit.

The plan preview includes its start time and budgets. Main-queue starts can be
scheduled within 31 days; the default runtime budget is 120 seconds and the default
model-call budget is five. Configured limits are 100 ms–one hour and 0–32 model
calls. Exhaustion stops later steps and retains the checkpoint for review. These
are execution limits, not a provider token/dollar cap or a recurring-job scheduler.
Marks has separate bounded lanes and profile limits, including selected four-hour
read-and-draft profiles.

**Failure memory and task context:** exact failed tool/argument combinations are checked against saved run history. The interactive executor asks before retrying; unattended jobs block a repeated failure. A later verified success clears that failure. Previous failures and compact recent-task summaries inform the planner, without granting permission or choosing a different target. Compact checkpoint summaries retain step outcomes without screenshots or approval tokens. Pending vision captures are limited to two, single-use, with two-minute validity and active expiry cleanup. These records are bounded; this is failure avoidance within retained history, not model training.

**Screen understanding:** normal foreground-window reading tries Windows accessibility first, without a screenshot. Unsupported or empty accessibility results fall back to local OCR and optional vision. Explicit image/chart/layout requests, clipboard images and whole-desktop reads use the capture path. OCR text never supplies coordinates or authorizes a click. Native app actions still recheck the exact window and control before every click/fill and retain their one-time approvals.

**MCP:** open **Apps → Background tasks and MCP tools** or say `show MCP tools`. Enter a server name and explicit loopback endpoint such as `http://127.0.0.1:8080/mcp`, then review the connection. JARVIS connects to an existing server; it does not launch another JARVIS copy or start external processes. This client supports the [MCP Streamable HTTP 2025-11-25 protocol family](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), including JSON/SSE responses, initialization, sessions, tool discovery and calls. It does not support remote HTTPS/OAuth servers, stdio subprocesses, server-requested sampling, or automatic AI selection of external tools yet.

Choose a discovered tool, inspect its JSON input schema, enter its arguments as JSON, and select **Review external call**. Every call—including tools claiming to be read-only—requires a one-time server approval bound to the exact connection, session, tool definition and arguments. Changed definitions require another review. Failures/timeouts consume approval and never retry automatically. External results are displayed as unverified. Connections persist locally but stay disconnected after restarting JARVIS; reconnect explicitly. No MCP server is configured by default.

The job API is `GET/POST /api/agent/jobs`, `GET /api/agent/jobs/:id`, and `POST /api/agent/jobs/:id/cancel`. MCP uses `GET /api/mcp/servers` and `POST /api/mcp/connect`, `/api/mcp/call`, `/api/mcp/disconnect`, `/api/mcp/remove`. These routes use the same origin, host and app-lock checks as the other JARVIS APIs. Private runtime files live at `~/jarvis/.agent-jobs.json` and `~/jarvis/.mcp-connections.json`.

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

**Asks before a mismatched change.** When the rule match is a command that *changes* something but the request reads like a question about your own things (*"git commit the latest changes in my project"* — “latest” about your project usually means *show me*), JARVIS asks “Just to be sure…” before running it. Read-only commands still run straight away, and commands that already ask (close an app, run a program…) are not asked twice. Every decision also carries `policy` (what it needs: a direct tool, the local model, web evidence), `needsReview` (signals disagree — shown in the inspector) and `decisionSignals`.

**Online tools off:** JARVIS says so and offers **ENABLE ONLINE TOOLS & SEARCH** or **ANSWER FROM MEMORY** (flagged "may be out of date") — it never answers something that changes from stale memory silently.

- **Debug:** turn on *Show how I understood you*; or `Decider.decide(Decider.signals('…', {}), { online: true })` in the console; in plain Node `const D = require('./decider.js')`. `tests/decider.test.js` (141 checks, ~30 of them conflicts, plus the execution policy).
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
- **Panic / emergency stop:** pauses automation and alerts, blocks new action requests, revokes pending approvals and cancels supported running jobs. Explicit resume permits new requests; cancelled work and consumed approvals are not replayed.
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
| `skillpack.js`, `skills-bundled/`, `skill-hub.js` | Skill packs: bundled and personal `SKILL.md` folders, persistent enable/disable, search and run controls in the Skill Hub; bundled skills include research, quick, code-review, plan-then-act, debugging-coach, study-sprint, meeting-notes, and career-helper (plus two internal skills) |
| `extras-page.js` | Chat side of the extra tools below: recognises the explicit wording, calls the route, words the answer |
| `aihealth.js` | AI call history (one hook in `llm.js`), the "check my AI" report, disk and memory checks |
| `watchdog.js` | Service watchdog: Ollama and the pages / ports you add, uptime, one alert per change |
| `nearby.js` | Places near somewhere from OpenStreetMap (Nominatim + Overpass), built from a fixed category table |
| `csvtools.js` | CSV parser, column statistics, relationships, safe filter language, group-by, SVG charts, the statistics-only digest for the AI |
| `projectwiki.js` | Project scanner (JS, Python, Java, C/C++), import graph, wiki pages and Mermaid diagrams, one-sentence AI summaries |
| `imagegen.js` | Text-to-image through Pollinations (optional key) or a local Stable Diffusion; file-signature checks; `.json` notes |
| `pdftools.js` | Merge, take pages, rotate, text-to-PDF, watermark (`pdf-lib`); always a new file |
| `diskcare.js` | Disk care: drive and folder usage, tidy a folder, large and duplicate files, old temp files, JARVIS's own trash. Scan → plan (kept on the server) → apply → one-step undo; permanent actions are separate and Hello-guarded |
| `scanmath.js`, `camera-page.js`, `watch-page.js` | Camera tools on the page: page-corner and clean-up maths, fingerprints, motion and presence logic (pure) · the capture panel, scanner, QR, photo questions and the camera indicator · the presence lock and room watch |
| `scan.js` | Server half of the scanner: keeps pages, reads words with Windows OCR (`/api/ocr/words`), builds the searchable PDF; `/api/vision/ask`; room snapshots |
| `skillrouter.js`, `speech-stream.js` | Skill suggestions (keyword ranking) · speak-while-writing: sentence splitting, the 320-character rule, the speech queue, the “stop” words |
| `chatarchive.js` | The monthly chat archive, date phrases (“last week”), search, forget |
| `ttparse.js`, `student-page.js`, `studyserver.js` | Timetable reading (text, `.ics`, OCR word boxes) · timetable import, bunk-tomorrow, lecture and exam mode · lecture notes and exam questions (server) |
| `lifeparse.js`, `life-page.js` | Expense, habit and quick-capture sentences (pure) · the chat side of expenses, habits, capture, keep-alive, drive backup and screenshot search |
| `services-page.js`, `commerce.js` | Explicit WhatsApp draft, movie/bus ticket and shopping hand-offs; provider URLs are validated server-side and never send/pay/book automatically |
| `keepalive.js`, `keepalive.ps1/.vbs`, `mirror.js`, `shotindex.js` | Keep-alive scheduled task and its checker · the plain drive backup · the screenshot text index (all laptop-page-only routes) |
| `assignparse.js`, `traceparse.js` | Assignment sheet text → title/due/questions · error text → error type and your own file:line frames (pure) |
| `csp.js`, `cdnpins.js`, `lock-page.js` | The page's Content-Security-Policy · fingerprints of the camera libraries fetched from the CDN · the unlock page's script (it used to be inline) |
| `trashkeep.js`, `undolog.js` | The trash on the item's own drive with a 30-day clean-up · how to reverse each file action, kept so undo survives a reload |
| `gitsafe.js`, `nodecheck.js`, `netsafe.js` | What `git add -A` would stage and what looks like a secret (name or content) · the Node.js version check at start · the public-internet-only check for fetched pages (addresses, resolved names, redirects) |
| `tenderparse.js`, `tenders-page.js` | Karnataka tenders: reading a copied KPPP table, questions, filters (pure) · the chat side, the 6 PM digest |
| `devtools.js`, `dev-page.js` | Git summary, commit message, error explainer (server) · their chat side |
| `wavutil.js`, `whisper.js`, `stt-page.js`, `install-whisper.ps1` | Audio conversion · whisper.cpp runner and routes · page recorder for lecture mode · the installer you run yourself |
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
| `script.js` | Turn pipeline, UI, tasks, reminders, focus, files, streaming, settings; `executeTool` is now a short dispatcher |
| `tools/registry.js`, `tools/*.js` | The tools themselves, one file per area — `apps`, `web`, `tasks` (timers, focus, to-dos, reminders, deadlines, timetable, routines), `study`, `system` (power, volume, media, system info, laptop controls, screen), `files`, `code` (code → file → run, snippets, git, clipboard), `productivity`. Every intent belongs to exactly one area; every result also carries `ok` and `errorCode` (`failed` / `cancelled` / `not_found` / `needs_ai`), hidden from saved chats. A file that fails to load costs only its own area |
| `nlu.js` | Normalization, intent rules, fuzzy matching, dates/times, coding-AI phrase parser |
| `agent.js` | Multi-step router, plans, state-aware previews, confirmations, verification, failure recovery (diagnose → fix → retry → verify), RETRY / CONTINUE / ROLLBACK, guided templates, command learning |
| `routines.js`, `triggers.js`, `study.js`, `undo.js`, `wizard.js`, `lang.js`, `persona.js` | Routines, trigger logic, study & attendance maths, undo stack, guided setup, languages, personality lines |
| `style.css`, `themes.css`, `ui.css` | Look & feel (`ui.css` is the current clean-HUD layout) |
| `landing.html` | Cinematic landing page (`/welcome`) |
| `vendor/qrcode.js` | QR codes for the phone setup (MIT) |
| `workspace.js`, `action-receipts.js`, `statemerge.js` | Today, Images and History; receipt presentation and state merging across tabs |
| `daily-features.js`, `assistant-tools.js`, `assistant-features-page.js` | Named workspace checkpoints, merged note/capture inbox, quiet-hour helpers, pending voice corrections and study-slot suggestions |
| `fm-radio.js`, `media-center.js`, `media-server.js`, `focus-audio.js` | City/station catalogue, local playback, official HLS streams, podcast RSS/audio, position tracking and synthesized focus sound |
| `regional-news.js` | Supported city/language feeds, headline sources, publication times and short-lived caching |
| `pdf-ocr-index.js`, `pdf-ocr-page.ps1` | Bounded PDF indexing jobs, Windows page rendering, OCR search and page citations |
| `desktop-control.js`, `desktop-automation.js`, `desktop-automation.ps1` | Apps UI and commands, one-time approvals, temporary window/control references, Windows accessibility inspection and actions |
| `screen-perception.js`, `agent-context.js` | Accessibility-first text reading, retained failure checks and bounded task summaries |
| `agent-jobs.js`, `agent-background-tools.js`, `agent-runtime-page.js` | Durable supported background jobs, cancellation, results and task/MCP UI |
| `mcp-client.js` | Opt-in local MCP Streamable HTTP connections and exact one-time approvals for external calls |
| `understanding.js` | Typed entities, conservative exclusions, constrained Hindi/Hinglish commands and expiring safe dialogue state |
| `task-control.js`, `owned-processes.js`, `emergency-hotkey.js`, `emergency-hotkey.ps1` | Server stop latch, revocation/cancellation, owned-child termination and opt-in global emergency shortcut |
| `managed-browser.js`, `managed-browser-page.js` | Separate browser profile, bounded DOM observations, page-staleness checks, approved actions and handoff UI |
| `account-connections.js`, `account-page.js`, `secret-vault.js` | Main Google/Microsoft PKCE reads, reviewed setup, Windows-user DPAPI storage and model-key migration |
| `office-exports.js`, `content-workflows.js`, `media-workflows.js`, `workbench-page.js` | Editable Office downloads, quoted source facts, raster/audio processing and Apps workflow forms |
| `reviewed-execution.js`, `privacy-filter.js` | Approved standalone Node/Python execution and recognizable-secret checks before cloud chat/embeddings |
| `marks.js`, `marks-profiles.json`, `marks.html`, `marks-page.js`, `marks.css` | Gated specialist catalog, isolated workspace, approvals, profile routing and results |
| `marks-jobs.js`, `marks-precision.js`, `marks-batch.js`, `marks-power.js` | Separate bounded workers, reviewed desktop plans, recoverable local batches and power policy |
| `marks-library.js`, `marks-text-worker.js` | Approved text-tool/memory library and bounded worker transforms |
| `marks-accounts.js`, `marks-account-readers.js`, `marks-oauth.html`, `marks-oauth.js`, `marks-toolbox.js`, `marks-sentry.js` | Separate in-memory preview OAuth, read-only provider tools, reviewed toolbox and session watches |
| `marks-tray.ps1`, `Start Marks Tray.bat`, `Start Marks Hotkey.bat` | Optional tray/compact-shortcut helpers attached to the existing server |
| `site-theme.css` | Shared site colors used by the landing page and JARVIS pages |
| `calendar.js`, `homeassistant.js`, `approvals.js` | Read-only calendar connection, Home Assistant device controls, and one-time approvals |
| `skill-hub.js`, `browser-recovery.js`, `workflow-memory.js`, `diagnostics.js` | Skill Hub UI, safe browser recovery, saved workflows and read-only diagnostics |
| `agent-platform.js`, `platform-ui.js` | Research notebook, workflow validation and audit metadata |
| `phonehub.html`, `phonehub-ui.js`, `phonehub.css`, `phonehub-auth.js`, `phonehub-gateway.js`, `phonehub-notifications.js` | Phone Hub owner UI, pairing, gateway and notifications |
| `calling.html`, `calling-ui.js`, `calling-service.js`, `android/phonehub/` | Outbound calling and the Android companion |
| `emotion-intelligence.js`, `commerce-compare.js`, `safewrite.js` | Tone cues, observed-price extraction and path-checked writes |
| `jarvis-shortcut.vbs`, `jarvis-msg.vbs`, `package.json`, `package-lock.json` | Desktop shortcuts and messages, project commands and pinned dependencies |
| `docs/` | Setup, architecture and QA evidence. Learning pages: `docs/jarvis-study-guide.html` and `docs/jarvis-lesson.html` |
| `tests/` | Test suites (`npm test`) |
| `_backup_original/` | An older version, kept for reference |

---

## 13. Testing

Run the automated suites with disposable JARVIS homes. The desktop-control suite opens dedicated native-app and private-browser fixtures and acts on those test windows. Browser command suites use fake laptop actions.

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

The source/isolated-runtime inventory checked on **2026-11-19** contains **139 automated suites**, plus the opt-in live suite, **350 distinct mounted API routes**, **186 rule intents**, **81 registered agent tools**, and **23 Marks profiles**. These are snapshot counts: concurrent development can change them during a run. External MCP tools are separate from the internal registry; Marks profile names are not additional NLU intents. The earlier strict full-run log records all 139 suites passing for that changing-tree revision; this documentation comparison did not rerun the full suite or certify subsequent edits. Current implementation evidence and remaining live prerequisites are tracked in [IMPLEMENTATION-PROGRESS.md](docs/IMPLEMENTATION-PROGRESS.md).

Windows CI runs `npm ci` and `npm test` on Node 22 and 24 with `JARVIS_REQUIRE_ALL` unset. To require every suite locally, use the shell-appropriate form below.

```powershell
$env:JARVIS_REQUIRE_ALL = '1'
npm test
Remove-Item Env:JARVIS_REQUIRE_ALL
```

The recorded clean-checkout audit covers an earlier 123-suite revision. Its route and assertion counts are historical evidence for that revision. [QA Round 2 report](docs/QA-ROUND2.md)

For focused checks of the recent features, run `node tests/daily-features.test.js`, `node tests/fm-radio.test.js`, `node tests/desktop-automation.test.js`, `node tests/scan.test.js` or `node tests/browser-scenarios.test.js`. Native accessibility and OCR fixtures require Windows; browser fixtures require Edge or Chrome. Marks preview setup and its optional stress fixture are documented in [docs/MARKS.md](docs/MARKS.md).

| Suite | What it covers |
|---|---|
| `daily-features.test.js` | Notes and capture search, workspace checkpoints and handoffs, focus sound, quiet-hour exceptions, voice corrections, availability/recurrences, podcast parsing and provider links. |
| `fm-radio.test.js` | City/frequency resolution, station choice and saved favourites. |
| `desktop-automation.test.js` | Exact-target approval, altered-text and replay rejection, expiration, password omission, native WPF field/button actions and an isolated private-browser website fixture. |
| `coverage.test.js` | Phrase checks for all 186 rule intents, plus special handling such as negation; fails if a new rule intent has no phrase |
| `api.test.js` | Uses a real isolated server and a coverage gate for every mounted API route (350 in the latest snapshot). The route inventory distinguishes requested endpoints and documented exclusions. Checks include success and refusal paths. |
| `nlu-phase1.test.js`, `task-control.test.js` | Command semantics, corrections, emergency cancellation, stale approvals, and opt-in shortcut helper lifecycle |
| `agent-runtime.test.js` | Failure matching, context bounds, accessibility fallback, durable jobs, cancellation, restart recovery and permission exclusions |
| `job-budgets.test.js` | Future starts, runtime deadlines, hung-tool cancellation and model-call limits |
| `understanding.test.js` | Typed entities, exclusion preservation, constrained Hindi/Hinglish, ambiguity and expiring safe dialogue slots; generated examples are smoke coverage, not a held-out benchmark |
| `managed-browser.test.js` | Real isolated browser controls, exact approvals, password handoff, fill/click verification, dropdown selection, directional scrolling and cancellation during launch |
| `vault-accounts.test.js` | Encrypted storage, disposable native DPAPI checks, fake Google/Microsoft PKCE flows, reviewed reads and stale/replayed state rejection |
| `owner-actions.test.js` | Signed WebAuthn-shaped proofs bound to exact request bodies; changed targets, endpoints and replay are rejected |
| `office-exports.test.js` | Real editable Office files, workbook formulas, grouped aggregates, embedded charts and stop-before-write behavior |
| `content-media.test.js` | Page-backed quoted facts, classification suggestions, real raster conversion and source preservation/cancellation |
| `reviewed-execution.test.js` | Disabled defaults, exact code approvals, real harmless Node arguments/timeouts and temporary-source cleanup; no claim of OS isolation |
| `marks.test.js` | Preview gate, profile routing, local-only requests, reviewed desktop/batch/library/account flows, separate jobs, recovery and permission boundaries with isolated fixtures. `JARVIS_MARKS_STRESS=1` adds the opt-in 10,000-file rename/restore fixture. |
| `mcp-client.test.js` | MCP handshake/session headers, JSON/SSE results, exact approvals, expiry, changed definitions, no replay and disconnected restart state |
| `e2e.test.js` | Runs browser flows, then samples the command catalogue in chat. It fakes laptop actions. Without Edge/Chrome or on Node < 22 it is shown as **NOT RUN**. |
| `browser-scenarios.test.js` | Two browser tabs, state sync, immersive panels, calendar states, playback continuity, inbox conversion, voice corrections, desktop approvals, returned multi-step answers, checkpoint interruption and actual rollback. |
| `connected-services.test.js` | Fake Home Assistant status, outages, recovery, approval and readback, plus ICS parsing and URL guards |
| `positive-routes.test.js` | Success paths for the 14 previously unexplained routes, using fake calling, shopping, image and phone fixtures |
| `live.test.js` | Opt-in (`npm run test:live`) reversible checks on the real laptop |
| `nlu.test.js` | Understanding commands (intents, typos, dates, languages), including six checks of the dispatched app or URL |
| `agent.test.js` | Multi-step routing and safety (validator, refusals), the execution inspector card, undo tagging of plan runs |
| `llm.test.js` | AI providers, streaming, retries, key handling (with a fake server) |
| `student.test.js` | Attendance & bunk maths, marks → SGPA/CGPA, monthly/yearly repeats |
| `codeask.test.js` | Coding-AI phrases, safe command building |
| `skills-page.test.js` | Website / coach / viva conversations, and skill packs on the page (`/name`, "use the X skill", trigger phrases not hijacking commands, research / files / plan skills, list / reload) |
| `skillpack.test.js` | `SKILL.md` parsing and loading, symlink rejection, bundled vs personal skills, enable/disable persistence, disabled-run rejection, and routes exercised with a fake model |
| `skillrouter.test.js` | Context-aware skill ranking, exact triggers, ambiguous requests, cooldowns, and ordinary conversation that must not trigger a skill |
| `skill-hub-quality.test.js` | All newly bundled skills are discoverable, metadata is valid, intended requests select the right skill, and ordinary messages are not routed |
| `skill-hub-ui.test.js` | Main-page and PWA wiring, management endpoints, safe manual browser restore, and workflow prompts not auto-submitted |
| `workflow-memory.test.js` | Explicit local workflow save/update/reload/delete, validation, and bounded prompt size |
| `browser-recovery.test.js` | URL validation, sensitive query redaction, persistent history, explicit reopen, and clearing |
| `diagnostics.test.js` | Read-only checks, missing-provider reporting, recommendations, and no repair execution |
| `extras-page.test.js` | The eight tools in chat: every phrase that is taken, and a long list of ordinary sentences that must not be ("watch youtube", "open marks.csv", "draw a graph", "split the bill"…) |
| `aihealth.test.js` | Error classes from the real `llm.js` messages, the history (ring buffer, saving, hand-edited files), the report and its fixes, the hook with a faked network (nothing secret recorded, cancelled calls not counted) |
| `watchdog.test.js` | What may be watched (no `file:`, no passwords), when an alert is worth sending, the probes against real local servers, saving and loading, laptop-only changes |
| `nearby.test.js` | Words → kinds of place (and that everything in `places.js` is covered), the Overpass query (nothing but table text and numbers), reading answers, mirrors, caching |
| `csvtools.test.js` | Parsing edge cases, statistics, relationships, the filter language including hostile input that must never run, charts with escaped text, the digest that must contain no row |
| `projectwiki.test.js` | Reading JS / Python / Java / C, the import graph, the pages; **everything the wiki names exists in the project**; Mermaid safety; limits, symlinks, git |
| `imagegen.test.js` | What counts as a picture (by its bytes), each service's request, failures in plain words, saving with a note, the key never shown back |
| `pdftools.test.js` | Page selections, merging, taking pages, rotation, text-to-PDF layout, the watermark, password-protected and damaged files, the original untouched |
| `scanmath.test.js` | Page corners and flattened size, the cleaner (shadows go, ink stays, marker colours kept), picture fingerprints, motion detector (warm-up, exposure compensation, subtle movement, cooldown), presence tracker (“could not tell” never locks), QR contents (Wi-Fi escapes, link warnings) |
| `scan.test.js` | Drawn-image Windows OCR, searchable scan PDFs, image-only PDF indexing with original-page citations, limits, cancellation-related routes, snapshots, vision refusals and phone alerts. |
| `camera-page.test.js` | Camera / QR / photo wording (and sentences that must not match), phone refusals, QR maker and descriptions, presence lock and room watch driven by a fake camera, detector and clock |
| `photocare.test.js` | Similar photos (cache, project protection, plan → apply → undo) and JPEG shrink (original always kept, refusals, undo) with fakes, then **real Windows image tools** on drawn pictures including EXIF rotation |
| `skillrouter.test.js` · `speechstream.test.js` | Which messages suggest which skill (and 22 that must not) · sentence splitting however the text arrives, the 320-character rule, code blocks, the queue and Stop, the stop words |
| `chatarchive.test.js` | ~35 date phrases, search, monthly files and the size cap, forgetting, laptop-only routes |
| `ttparse.test.js` · `studyserver.test.js` · `student-page.test.js` | Timetable text / `.ics` / OCR grids · lecture notes in pieces and exam questions with a fake AI · import, bunking, lecture and exam flows with a fake recogniser and clock |
| `lifeparse.test.js` · `life-page.test.js` | Expense, habit, streak and capture sentences (and ordinary sentences that must not be taken) · keep-alive, drive backup, expenses, habits, capture and screenshot-search flows with fake servers: confirmations, undo, phone refusal |
| `keepalive.test.js` · `mirror.test.js` · `regen.test.js` | The scheduled-task checker and its states · the drive backup on temp folders (changed files, kept versions, never deleting, markers, full drive) · regenerable-folder cleanup |
| `shotindex.test.js` | Screenshot text index on temp folders with a fake reader: depth, changes, deletions, budgets, forgetting, `open` only for indexed files |
| `commerce.test.js` | WhatsApp draft links, phone validation, movie/bus ticket hand-offs, shopping searches and manual-purchase safeguards |
| `services-page.test.js` | Explicit command parsing for WhatsApp, movies, buses and shopping; ordinary conversation must not match |
| `saved-vision.test.js` | Saved-image analysis refuses cross-site requests and paths outside approved screenshot folders before calling the model |
| `assigntrace.test.js` · `studyplus.test.js` | Assignment sheets (day-first dates, times, questions) and stack traces (Node, Python, Java, gcc, TypeScript) · classes that just ended, free gaps, plan fitting, end-sem marks |
| `devtools.test.js` · `dev-page.test.js` | Real temp git repositories: summary windows, my commits only, secret files kept out of the diff, error frames read only inside project folders · the chat side with a fake AI |
| `whisper.test.js` · `stt-page.test.js` | WAV conversion and checks, finding the program and model, silence skipping, one-at-a-time, with a fake program · the page recorder with a fake microphone: cuts at pauses, ordered pieces, error reporting, release |
| `diskcare.test.js` | Real folder trees in a temp folder: classifying and tidying (name clashes, in-progress downloads, links), large files, duplicates (identical edges but different middle is *not* a duplicate), the temp cleaner and its escape attempts, JARVIS's trash, journals and undo, plans that expire, the routes |
| `reliability.test.js` | The presentation review: many wordings → one intent (create/count/list folders, frontends, saving code), misheard speech repaired (and ordinary sentences left alone), "did you mean" ranking, the frontend-for-a-project flow |
| `decider.test.js` | The decision engine: ~45 requests → each route, ~30 **conflicts** (action + place, local + fresh, this-laptop + version, show vs explain, statements), place reading (category / location / sort), Online-tools-off offers, payloads, confidence, a reason for every decision |
| `jarviscode.test.js` | JARVIS Code: the AI's answer → files, the plain-code-block fallback, paths that must never leave the project |
| `backup.test.js` | Export/import, encryption, hostile files, snapshots |
| `gitsafe.test.js` · `nodecheck.test.js` · `sw.test.js` · `chatprompt.test.js` | What “commit all changes” would stage and what looks like a secret (real temp repository) · the Node version check and that package.json, the README and the check agree · the service worker lists only real files and never caches /api/ · what the AI is really sent, against a fake Ollama (the tools section is left out when the page will not run a tool) |
| `phonecmd.test.js` | Commands from the phone against a fake ntfy server that streams messages to the real server: locked / unlock / 10-minute window / replay refused, **strict mode** (a code with every command, bare code or wrong code runs nothing), the access-token header |
| `csp.test.js` · `trashkeep.test.js` · `undolog.test.js` | The page policy (no inline scripts, connections only back here) and that every CDN script has a fingerprint · the trash on the item's own drive, finding items again, the 30-day clean-up · the undo log that survives a reload (30 minutes, 40 records, laptop page only) |
| `nluq.test.js` | Qwen assist: the server list and the page list match, every command it may name has a real handler, and the risky ones are not offered |
| `a11y.test.js` | Every switch, input and dropdown can be named by a screen reader; the chat is a log; finished replies go to a live region once; images have alt text |
| `skills.test.js` | Page generation safety (including the Content-Security-Policy every generated page gets), coach, viva grading that never turns an unreadable reply into a silent 0, code fixer |
| `hello.test.js` | Windows Hello verification and guarded routes |
| `applock.test.js` | The app lock on a real server with a software-signed Windows Hello key: every way round the gate (path spellings, forged / replayed / wrong-purpose signatures, other ports' cookies), unlock, lock now, turning it off, idle expiry on a fake clock, the no-lock-out guarantee |
| `thresholds` · `facegreet` · `gesture` · `learn` · `ocr` · `portwatch` · `transitions` · `dashboard` | The optional extras: alert thresholds, face-greeting routes (enroll, validation, server-side match) and module, gesture recognition logic, pattern learning, OCR routes, the port watcher, transition effects, the dashboard endpoint (the dashboard suite needs the optional `systeminformation` package — `npm install` — and fails without it) |
| `triggers.test.js` | Trigger parsing, edges, cooldowns, charger announcements |
| `rag.test.js` | File search with page numbers, hybrid + semantic fusion, .docx/.pptx/.xlsx |
| `doctext.test.js` | Office file text extraction (zero dependencies) |
| `plan.test.js` | Goal sentences → merged, ordered, permission-previewed, verified plans; state-aware steps (a running server is kept); dev-project dependencies; failure recovery (missing dependencies → ask → install → restart → verify, declined, second failure diagnosed); RETRY / CONTINUE / ROLLBACK; teaching phrases |
| `paraphrase.test.js` | The same requests said many ways (casual, Indian-English, no verb): correct / handed to the AI / **confidently wrong** (must stay 0); statements and questions must not trigger commands |
| `study.test.js` | Study planner and progress maths |
| `scheduler.test.js` | Server reminders, monthly/yearly repeats, panic gating |
| `palette.test.js` | Command palette fuzzy search, skill-pack and tool entries |
| `apps.test.js` | Installed-app matching |
| `phoneauth.test.js` | Authenticator codes (RFC 6238 vectors) |
| `undo.test.js` | Undo stack, including reversing a whole plan run newest-first |
| `update.test.js` | Update-check version comparison |
| `hotkey.test.js` | Hotkey helper protocol |
| `instance.test.js` | One JARVIS per user (second start reuses it, stale locks), chat sync between tabs, ntfy rate-limit safety |
| `voice.test.js` | Waiting for the end of a sentence and for the recogniser's final words, tap-to-send, Telugu/Kannada collection |
| `wakeword.test.js` | Background wake-word listener protocol |
| `llmqueue.test.js` | The local-model queue: one at a time, chat before background, nothing cut off, slots given back after a finished / failed / abandoned / cancelled call, extra lanes on request |
| `toolregistry.test.js` · `routines.test.js` | Every intent in exactly one tool area, the page loads and caches them in order, the real dispatcher (first area wins, a crash names its area), `ok`/`errorCode` on every result · finding routines by what you say, splitting steps, create/replace/remove with undo, runs that wait in line |
| `tenderparse.test.js` · `tenders-page.test.js` · `tendercount.test.js` | KPPP tables (column order, tabs or spaces, malformed lines), dates and values, building/place/value filters, deadline edges (closes today vs closed, tomorrow at midnight, this week on a Sunday), 25+ phrasings and sentences that are not about tenders · importing, new-since-last-import, freshness, the 6 PM digest · the public total: offline, cached, a fixed address, safe failure |
| `statemerge.test.js` | Saving a stale list: another tab’s additions kept, this tab’s deletions honoured, attendance by subject, older pages without a base still replace, through the real route |
| `statesync.test.js` | Two tabs against a real server: a saved list is pushed to the other tab (only when it changed), settings are not, the chat still is, an import tells every tab to reload |
| `tts.test.js` · `lockclient.test.js` | The online-voice route against a fake socket (input checks, rate limits, escaping, cache, clean failures) · the page half of the app lock (reload when locked, throttled keep-alive pings, nothing reloads twice) |
| `netsafe.test.js` | Private, mapped and odd addresses are refused; names that resolve privately; redirects to this laptop are refused hop by hop; loops stop; a page download stops at 1 MB and PDFs/images are refused |
| `websearch.test.js` | "Open X website" picks the right result (not a look-alike) |
| `autostart.test.js` | Start with Windows |

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

**The page says "Backend offline".** Start JARVIS (`Start JARVIS.bat` or `npm start`) and open `http://localhost:3002` — not the `index.html` file.

**JARVIS does not open at localhost:3002.** Start it with the desktop **JARVIS** icon or `Start JARVIS.bat`. JARVIS always uses port 3002; if another program is using that port, close that program and start JARVIS again. Enable **Settings → Data → Start with Windows** to have JARVIS ready after you sign in.

**Different chats on different ports, or the phone (ntfy) app stops responding.** That means more than one JARVIS was running. Since the single-instance lock this can no longer happen from a normal start: starting JARVIS again (desktop icon, `npm start`, an AI tool, VS Code) just reuses the running one. If you ever see two, use **Stop JARVIS** (it stops the copy recorded in `~/jarvis/.jarvis.lock`) and start once. `JARVIS_ALLOW_MULTI=1` turns the guard off; only tests use it.

**"AI brain offline" / no answers to questions.** Start Ollama or configure a provider
via **Settings → Guided setup → AI**. Check that the selected model is installed;
a cold model can take time to load. `check my AI` distinguishes installed models
from loaded models and reports unavailable probes rather than inventing a list.
`check my AI properly` also sends a small inference request to the selected model.

**The new Apps tools appear but do not run.** Expand **Background tasks and MCP
tools**. Native extensions, the separate browser, reviewed scripts and account
connections each need their own setup/approval. Seeing their form is not proof
that the corresponding permission is enabled.

**Audio conversion says FFmpeg is missing.** Whisper handles transcription, not
container/audio extraction. Install FFmpeg yourself and put it on PATH or set
`JARVIS_FFMPEG_PATH` before restarting JARVIS. Image workflows do not need FFmpeg.

**Google/Microsoft says connect first after I already signed in.** Check whether
you connected the main Apps panel or the separate Marks preview. They do not share
tokens or redirects. Main connections require this Windows user's vault; Marks
connections clear when the server restarts. Reconnect through the correct panel.

**Marks is missing or disabled.** Normal startup hides it. All profiles remain
preview, so `JARVIS_MARKS=enabled` does not promote them. Use the explicit developer
preview procedure in [docs/MARKS.md](docs/MARKS.md); selecting a Mark in chat cannot
bypass that gate.

**Credential migration or vault access fails.** Main encrypted credentials belong
to the Windows user who created them. Review the vault status and configuration
write access; do not replace an unreadable vault with plaintext secrets. Earlier
backups and unrelated service credentials have separate storage and recovery rules.

**Answers are slow or weak.** Small local models are limited on laptop GPUs. Add a cloud key (Gemini and Groq have free tiers) and pick it under **Model**.

**The mic doesn't work.** Use Chrome or Edge, allow microphone access, and keep an internet connection (browser speech recognition is online). **Settings → Voice check** shows what your browser supports.

**No voice / robotic voice.** Use Edge for the best built-in voice, or turn on **Neural voice**.

**My phone unlock code is "wrong".** Use **Settings → Phone alerts → Check** on the laptop. If it says "different key", delete every "JARVIS" entry in Google Authenticator and scan the QR again (Guided setup → PHONE → step 3). JARVIS must be running.

**Phone commands say "JARVIS isn't open".** Commands run in the page — keep a JARVIS tab open on the laptop. (Questions work without it.)

**JARVIS opens a lock page and Windows Hello won't verify (or I turned the lock on and lost access).** The lock needs the Windows Hello key JARVIS enrolled. Stop JARVIS (`Stop JARVIS.bat`), open `~/jarvis/.config.json`, delete the `"appLock"` entry (and the `"hello"` entry too if Windows Hello itself is the problem — the lock then stands down on its own), and start JARVIS again. Unlocking works at the laptop only: open `http://localhost:3002` (not `127.0.0.1`, not the phone/Tailscale address) in Chrome or Edge.

**Windows Hello stopped working after I changed my PIN/fingerprint.** Stop JARVIS, delete the `"hello"` entry from `~/jarvis/.config.json`, start again.

**"I can't find the folder".** JARVIS searches Desktop, Documents, Downloads, your home folder and other drives by name, so check the spelling first. If a coding AI must work in that folder, add it in **Settings → Project folders** or answer **ALLOW & CONTINUE**.

**A PDF "is a scan".** Open **Notes**, select the PDF by name or full path, choose **Index with local OCR**, then search it there. Wait for indexing to finish and review the unreadable-page count. This uses local Windows OCR.

**An app control is missing or unavailable.** Refresh the window list in **Apps**, select the intended window and inspect it. A control must be visible, enabled and expose a supported Windows accessibility pattern. A changed window or a completed action needs a new inspection.

**An app approval expired.** Inspect the window again and request the action again. Inspections expire after two minutes, and each inspection is used for one action.

**FM or podcasts will not play.** Check connectivity and browser audio permissions. Use **Open player** for FM when its stream is unavailable. Podcasts need Online tools and a public feed; refresh the feed before resuming an episode. The browser may require a direct **Play** click.

**Spotify or YouTube opens another page.** The provider link and title commands open their official player/search pages. Use the compact JARVIS player for local audio, supported FM and podcasts.

**A workspace item moved.** Edit its saved path in Workspaces and save a new checkpoint. Resume reports missing items so you can correct them.

**No free study slot appears.** Check study-hour settings, the requested cutoff, timetable durations and calendar coverage. A day-only cutoff ends at the start of that day.

**Routine laptop alerts have gone quiet.** Check Daily quiet hours and any “until my break” interval. “What did I miss?” shows held alerts.

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

- Task coverage depends on registered tools, configured services and application accessibility. Open-ended requests can require clarification, an available tool or a handoff to another application.
- Windows-first: many laptop controls, notifications and the hotkey are Windows-only.
- Browser speech recognition needs internet access. Local AI, notes, stored workspaces and local audio can work offline. Web research, live FM, podcast retrieval, regional news and connected services require their respective connections. Offline transcription requires a configured Whisper installation.
- Keep-alive, the attendance prompt, the weekly backup and screenshot indexing work only while the laptop is on (JARVIS itself must be open for the attendance prompt and the backup).
- Screenshot search uses Windows OCR (English); the standup, git summary and commit message read only the project folders you gave JARVIS.
- Routines, scheduled routines and phone *commands* need a JARVIS tab open (reminders don't).
- The background queue runs only its documented read-only tools. Native window actions, file changes, routines and external MCP calls stay interactive. The JARVIS server must keep running; laptop sleep pauses work.
- MCP currently connects only to explicit loopback HTTP servers using the documented protocol family. Remote HTTPS/OAuth, stdio and automatic model selection of external tools remain unsupported.
- Small local models occasionally misread instructions or answer briefly; cloud models are stronger.
- Scanned PDFs can be indexed from Notes using Windows OCR. Recognition quality affects search results, and indexes need rebuilding after a server restart or file change. Password-protected PDFs need an accessible copy. Office files use their existing text extraction.
- Semantic search needs an Ollama embedding model pulled once (default `nomic-embed-text`); without it the keyword index alone still works.
- The update check compares release tags and points you at the release page — it doesn't update JARVIS itself.
- The PWA install (own window, offline shell) needs Chrome or Edge; everything that acts on your PC still runs through the local server.
- Automatic repair of dev servers covers missing dependencies and a stale port held by JARVIS's own earlier run; other crashes are diagnosed, not fixed. ROLLBACK only reverses actions JARVIS knows how to undo, within 30 minutes.
- Coding-AI hand-off depends on each tool's own command line; desktop apps without one (OpenCode) need a manual paste.
- The app lock unlocks at the laptop only (Windows Hello is localhost-only), so the phone/Tailscale page can't be unlocked while it is on; and JARVIS can't check your Windows account *password* — Windows Hello (your fingerprint, face or Windows Hello PIN) is the lock's key.
- Screen OCR is English only.
- App and website actions depend on accessible control patterns exposed by each application. Each click or fill needs approval and a recent inspection. Click acceptance is followed by inspection to check its effect.
- Extended UIA actions require their explicit switch. The managed browser supports reviewed click, fill, select, focus and scrolling; general keyboard shortcuts, drag/drop, upload dialogs and cross-frame task execution remain incomplete.
- Hindi/Hinglish support is a constrained command layer, not feature parity with English or a new fully supported microphone language. Generated language smoke tests are not a held-out voice/accent benchmark.
- Main account connections are read-only and bounded; provider writes, sending and exhaustive mailbox/drive search are not implemented. Marks uses its separate preview connection and session tokens.
- Reviewed Node/Python execution runs as the Windows user. Approved working folders, a timeout and separate browser profiles do not provide VM isolation or guarantee containment of arbitrary script side effects.
- Marks is developer preview, with live acceptance still required. Its worker lanes perform supported read-and-draft tasks, not unrestricted parallel desktop agents. Sentry watches stop with the server session.
- The 115-capability checklist remains partly implemented. General demonstration learning, speaker identity, broad automatic replanning, monetary budgets and complete data-forgetting coverage are not established by the existing tests. See [implementation progress](docs/IMPLEMENTATION-PROGRESS.md).
- The media player uses browser-supported codecs. Spotify and YouTube use official provider pages, and local file selections must be made again after reloading the page.
- Availability suggestions depend on the accuracy of your timetable, deadlines and calendar coverage. Regional news covers the city/language feeds listed above.

---

## 16. License

MIT — see `package.json`. Dependencies and their license files include Express, unpdf (Mozilla pdf.js), pdf-lib, hls.js, ical.js, systeminformation, docx, ExcelJS, PptxGenJS and sharp. The bundled QR code library and font assets retain their own licenses.
