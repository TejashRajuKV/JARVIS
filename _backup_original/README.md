# JARVIS - Local AI Voice Agent

JARVIS is a privacy-first, local AI voice agent. It leverages local runtimes for speech recognition, command processing, and voice synthesis, ensuring that your data never leaves your machine. No cloud APIs, no subscription keys, just powerful local control.

![JARVIS UI Screenshot](https://raw.githubusercontent.com/sudan-s/jarvis/main/screenshot.png) 
*(Note: This is a placeholder image link. You should replace it with an actual screenshot of your project.)*

## ✨ Features

*   **100% Local:** All core functions—speech-to-text, intent recognition, and text-to-speech—run on your local machine.
*   **Privacy-Focused:** No data is sent to external cloud services for processing.
*   **Voice & Text Input:** Interact via wake word, push-to-talk, or text input.
*   **System Control:** Open applications, manage system power (shutdown, sleep), control volume, and more.
*   **File Management:** Create, list, read, and manage files within a sandboxed `~/jarvis` directory.
*   **Real-time System Info:** Get live stats on CPU, RAM, disk space, and running processes.
*   **Developer Tools:** Includes Git integration, port checking, and clipboard utilities.
*   **Extensible Toolset:** The backend is built with a simple API structure, making it easy to add new tools.
*   **Rich Frontend:** A dynamic and responsive UI built with vanilla JavaScript, providing real-time feedback and visualizations.

## ⚙️ How It Works

The project consists of two main parts: a Node.js backend server and a vanilla JavaScript frontend.

### 1. Frontend (`script.js`)

The frontend is the user's main interaction point.

*   **UI & State Management:** Manages the entire user interface, including the animated orb, console logs, and system telemetry.
*   **Input Handling:** Captures user input via:
    *   **Text Input:** A standard chat box.
    *   **Voice (Push-to-Talk):** Using the browser's `SpeechRecognition` API.
    *   **Voice (Wake Word):** Continuously listens for a wake word (e.g., "Jarvis") using the same API.
*   **Intent Classification:** When a command is received, a JavaScript function (`classify()`) uses a series of regular expressions to determine the user's intent and identify which tool to use. This is a simple, fast, and offline-first approach to Natural Language Understanding (NLU).
*   **API Communication:** Once an intent is classified as a tool-use, the frontend sends a `fetch` request to the appropriate endpoint on the backend server.

### 2. Backend (`server.js`)

The backend is a lightweight Express.js server that acts as the bridge between the web UI and the host operating system.

*   **Tool API:** It exposes a series of REST API endpoints under `/api/tool/`. Each endpoint corresponds to a specific "tool" that JARVIS can use.
*   **System Interaction:** When an API endpoint is hit, the server uses Node.js's `child_process` module (`spawn` and `exec`) to run system-level commands.
*   **Cross-Platform:** The code includes logic to run the correct commands for Windows, macOS, and Linux where possible. For example, `taskkill` is used on Windows to close an app, while `killall` is used on Linux/macOS.
*   **Security:**
    *   Applications that can be opened are defined in an `APPS` allowlist to prevent arbitrary execution.
    *   File system operations are sandboxed to the project directory to prevent accidental changes to system files.

### The Flow of a Command

1.  **User:** "Jarvis, open VS Code."
2.  **Frontend:** The `SpeechRecognition` API transcribes the audio to text.
3.  **Frontend:** The `classify('open vs code')` function matches this to the `OPEN_APPLICATION` intent and identifies the tool `openApplication`.
4.  **Frontend:** A POST request is sent to `http://localhost:3000/api/tool/openApplication` with the body `{ "app": "vscode" }`.
5.  **Backend:** The server receives the request. It looks up `"vscode"` in its `APPS` map to find the executable path.
6.  **Backend:** It executes the command to launch VS Code using `child_process.spawn()`.
7.  **Backend:** It sends a success response back to the frontend: `{ "success": true, "message": "Opening VS Code" }`.
8.  **Frontend:** Receives the success message and generates a spoken and written response: "Okay, opening VS Code."

## 🚀 Getting Started

Follow these instructions to get the project running on your local machine.

### Prerequisites

*   Node.js (v14 or higher recommended)
*   A modern web browser that supports the Web Speech API (e.g., Google Chrome, Edge).
*   (Optional for some tools) Git, `xdotool` (Linux), `scrot` (Linux).

### Installation & Running

1.  **Clone the repository (or download the files):**
    ```bash
    git clone <your-repo-url>
    cd jarvis-backend
    ```

2.  **Install dependencies:**
    Open a terminal in the project directory and run:
    ```bash
    npm install
    ```

3.  **Start the backend server:**
    ```bash
    npm start
    ```
    You should see a message in your terminal: `🤖 JARVIS backend running on http://localhost:3000`.

4.  **Open the frontend:**
    Open the `index.html` file (not provided in context, but should be in the root) in your web browser. The application should boot up and be ready for commands.

---
*This README was generated based on the project's source code.*