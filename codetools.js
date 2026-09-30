'use strict';
/* Coding-AI tools: open a VS Code-fork or terminal agent in a project folder and hand it a prompt.
   No user text ever reaches a shell that parses it — chat-tool prompts go over stdin, and terminal-agent
   prompts are embedded as a PowerShell single-quoted literal inside a base64 -EncodedCommand blob, so `wt`
   and PowerShell only ever see opaque argv tokens, never raw text with ; " ' $( ) or backticks in it. */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const WHERE = IS_WIN ? 'where' : 'which';

/* ---------- pure helpers (unit tested — no fs/process access) ---------- */

// Parses a VS Code-fork's bin\<name>.cmd, e.g.
//   "%~dp0..\Code.exe" "%~dp0..\04c0d99f4f\resources\app\out\cli.js" %*
// into the app's exe and its Node-mode cli.js, both resolved relative to the .cmd file's own folder.
function parseLauncherCmd(cmdText, cmdPath) {
  const m = /"%~dp0\.\.\\(.+?\.exe)"\s+"%~dp0\.\.\\(.+?cli\.js)"/i.exec(String(cmdText || ''));
  if (!m) return null;
  const dir = path.dirname(cmdPath);
  return { exe: path.resolve(dir, '..', m[1]), cliJs: path.resolve(dir, '..', m[2]) };
}

// A literal, single-quoted PowerShell string: safe for ANY content, including ' ; $( ) ` and double quotes —
// PowerShell does no interpolation or escaping inside single quotes except a doubled '' for an embedded quote.
function quotePwshLiteral(str) {
  return "'" + String(str).replace(/'/g, "''") + "'";
}

// The one-line script a terminal agent's console tab runs.
function buildTerminalScript(exePath, argMode, prompt) {
  const bin = quotePwshLiteral(exePath);
  const p = quotePwshLiteral(prompt);
  return '& ' + bin + ' ' + (argMode === 'flag-i' ? '-i ' + p : p);
}

// -EncodedCommand takes base64 of the UTF-16LE bytes of the script — PowerShell's own requirement.
function buildEncodedCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

/* ---------- registry ---------- */
// chat: has a `chat -m agent -r -` CLI that takes the prompt on stdin, inside the folder's own window.
// open (no CLI, or a fork whose `chat` subcommand doesn't exist): open the folder, put the prompt on the clipboard.
// terminal: a CLI coding agent, started in its own Windows Terminal tab at the folder.
const EDITOR_FORKS = [
  { key: 'vscode', label: 'VS Code (Copilot)', bin: 'code', dirs: [], chat: true },
  { key: 'kiro', label: 'Kiro', bin: 'kiro', dirs: [], chat: true },
  { key: 'trae', label: 'Trae', bin: 'trae', dirs: ['D:\\Trae'], chat: true },
  { key: 'antigravity', label: 'Antigravity IDE', bin: 'antigravity-ide', dirs: ['D:\\Antigravity IDE'], chat: true },
  // no `chat` subcommand → auto-paste into its AI panel (Ctrl+L opens/focuses Cascade)
  { key: 'devin', label: 'Devin', bin: 'devin-desktop', dirs: ['D:\\Windsurf'], chat: false, proc: 'Devin', focusKeys: '^l' },
];
const OPEN_ONLY_EXES = [
  // OpenCode's start screen has no focused chat box and its local server is password-protected, so JARVIS only
  // brings it to the front with the request on the clipboard (no keys pressed into a screen it can't see).
  { key: 'opencode', label: 'OpenCode', proc: 'OpenCode', focusKeys: '', noKeys: true, candidates: [path.join(process.env.LOCALAPPDATA || '', 'Programs', '@opencode-aidesktop', 'OpenCode.exe')] },
];
const TERMINAL_AGENTS = [
  { key: 'claude', label: 'Claude Code', bin: 'claude', argMode: 'positional' },
  { key: 'codex', label: 'Codex', bin: 'codex', argMode: 'positional' },
  { key: 'gemini', label: 'Gemini', bin: 'gemini', argMode: 'flag-i' },
  { key: 'qwen', label: 'Qwen', bin: 'qwen', argMode: 'flag-i' },
  { key: 'codebuff', label: 'Codebuff', bin: 'codebuff', argMode: 'positional', installHint: 'npm install -g codebuff' },
];

// `where` often lists several shims for one name (a bare POSIX shell script, .cmd, .ps1, ...) — the bare one
// isn't runnable by PowerShell's call operator, so prefer .cmd (works via Windows' file association), then .exe, then .ps1.
function whereBin(bin) {
  try {
    const lines = execFileSync(WHERE, [bin], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    const byExt = ext => lines.find(l => l.toLowerCase().endsWith(ext));
    return byExt('.cmd') || byExt('.exe') || byExt('.ps1') || lines[0];
  } catch { return null; }
}
function findCmdInDirs(bin, dirs) {
  for (const d of dirs) { const p = path.join(d, 'bin', bin + '.cmd'); if (fs.existsSync(p)) return p; }
  return null;
}
function detectEditorFork(f) {
  const cmdPath = (IS_WIN && whereBin(f.bin)) || findCmdInDirs(f.bin, f.dirs || []);
  if (!cmdPath) return { ...f, kind: f.chat ? 'chat' : 'open', ready: false };
  let parsed = null;
  try { parsed = parseLauncherCmd(fs.readFileSync(cmdPath, 'utf8'), cmdPath); } catch {}
  if (!parsed || !fs.existsSync(parsed.exe) || !fs.existsSync(parsed.cliJs)) return { ...f, kind: f.chat ? 'chat' : 'open', ready: false };
  return { ...f, kind: f.chat ? 'chat' : 'open', ready: true, exe: parsed.exe, cliJs: parsed.cliJs };
}
function detectOpenOnly(o) {
  const exe = o.candidates.find(c => c && fs.existsSync(c));
  return { ...o, kind: 'open', ready: !!exe, exe: exe || null, cliJs: null };
}
function detectTerminalAgent(t) {
  const bin = IS_WIN ? whereBin(t.bin) : null;
  return { ...t, kind: 'terminal', ready: !!bin, exe: bin || null };
}

/* ---------- clipboard (self-contained — mirrors /api/tool/writeClipboard) ---------- */
function writeClipboardText(text, cb) {
  const p = spawn('powershell', ['-NoProfile', '-Command', '$input | Out-String | ForEach-Object { $_.TrimEnd() } | Set-Clipboard'], { windowsHide: true });
  p.on('error', e => cb(e));
  p.on('close', () => cb(null));
  p.stdin.end(text);
}

/* ---------- runners ---------- */
// Opens the fork's window at the folder, then feeds the prompt to its `chat` CLI over stdin.
function runChatTool(tool, folder, prompt) {
  return new Promise((resolve, reject) => {
    const openP = spawn(tool.exe, [tool.cliJs, folder], { detached: true, stdio: 'ignore', windowsHide: false });
    openP.on('error', reject);
    openP.unref();
    setTimeout(() => {
      const chatP = spawn(tool.exe, [tool.cliJs, 'chat', '-m', 'agent', '-r', '-'], { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stderr = '';
      chatP.stderr.on('data', d => { stderr += d; });
      chatP.on('error', reject);
      chatP.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || ('the chat window did not accept the prompt (exit ' + code + ')'))));
      chatP.stdin.end(prompt);
    }, 2500);
  });
}
// No chat CLI: open the folder/app and put the prompt on the clipboard for the user to paste in.
// After opening an app that has no prompt CLI: wait for its window, bring it to the front, and only if the window in
// front really belongs to that app, press (focus keys), Ctrl+V and Enter. Prints "pasted" or "skipped:<why>".
// The prompt is already on the clipboard; nothing is typed anywhere else.
const AUTO_PASTE = `Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -Namespace J -Name FG -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
$name = $env:JARVIS_PROC
$p = $null
for ($i = 0; $i -lt 50 -and -not $p; $i++) { $p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1; if (-not $p) { Start-Sleep -Milliseconds 500 } }
if (-not $p) { [Console]::Out.WriteLine('skipped:no-window'); exit }
Start-Sleep -Milliseconds ([int]$env:JARVIS_WAIT)
$p = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
$ok = $false
for ($try = 0; $try -lt 4 -and -not $ok -and $p; $try++) {
  $h = $p.MainWindowHandle
  if ([J.FG]::IsIconic($h)) { [void][J.FG]::ShowWindow($h, 9) }
  # A single Alt tap is the documented way to let a program bring another window to the front.
  [J.FG]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [J.FG]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][J.FG]::SetForegroundWindow($h)
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) } catch {}
  Start-Sleep -Milliseconds 700
  $fp = 0; [void][J.FG]::GetWindowThreadProcessId([J.FG]::GetForegroundWindow(), [ref]$fp)
  $fg = Get-Process -Id $fp -ErrorAction SilentlyContinue
  $ok = $fg -and $fg.ProcessName -eq $name
}
if (-not $ok) { [Console]::Out.WriteLine('skipped:not-in-front'); exit }
if ($env:JARVIS_NOKEYS -eq '1') { [Console]::Out.WriteLine('front'); exit }
if ($env:JARVIS_FOCUS) { [System.Windows.Forms.SendKeys]::SendWait($env:JARVIS_FOCUS); Start-Sleep -Milliseconds 600 }
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
[Console]::Out.WriteLine('pasted')`;
function autoPaste(tool, wasRunning) {
  return new Promise(resolve => {
    if (!IS_WIN || !tool.proc) return resolve('skipped:unsupported');
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', AUTO_PASTE],
      { windowsHide: true, env: { ...process.env, JARVIS_PROC: tool.proc, JARVIS_FOCUS: tool.focusKeys || '', JARVIS_NOKEYS: tool.noKeys ? '1' : '0', JARVIS_WAIT: String(wasRunning ? 2500 : 6000) } });
    let out = '';
    ps.stdout.on('data', d => { out += d; });
    ps.on('error', () => resolve('skipped:error'));
    ps.on('close', () => resolve((out.trim().split(/\r?\n/).pop() || 'skipped:error').trim()));
    setTimeout(() => { try { ps.kill(); } catch {} }, 45000);
  });
}
function isRunning(proc) {
  if (!IS_WIN || !proc) return false;
  try { return new RegExp('^"' + proc + '\\.exe"', 'im').test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq ' + proc + '.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })); } catch { return false; }
}
function runOpenOnly(tool, folder, prompt) {
  return new Promise((resolve, reject) => {
    const wasRunning = isRunning(tool.proc);
    const args = tool.cliJs ? [tool.cliJs, folder] : [folder];
    const openP = spawn(tool.exe, args, { cwd: folder, detached: true, stdio: 'ignore', windowsHide: false });
    openP.on('error', reject);
    openP.unref();
    writeClipboardText(prompt, err => {
      if (err) return reject(err);
      autoPaste(tool, wasRunning).then(r => resolve({ pasted: r === 'pasted', pasteNote: r }));
    });
  });
}
// A terminal coding agent, started in its own Windows Terminal tab at the folder.
function runTerminalTool(tool, folder, prompt) {
  const script = buildTerminalScript(tool.exe, tool.argMode, prompt);
  const encoded = buildEncodedCommand(script);
  const args = ['-d', folder, 'powershell', '-NoExit', '-EncodedCommand', encoded];
  const wtPath = whereBin('wt');
  const child = wtPath
    ? spawn('wt', args, { detached: true, stdio: 'ignore', windowsHide: false })
    : spawn('powershell', ['-NoExit', '-EncodedCommand', encoded], { cwd: folder, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return Promise.resolve();
}

/* ---------- setup ---------- */
module.exports = function setupCodeTools(app, { findAllowed, rel, SANDBOX }) {
  const REGISTRY = [
    ...EDITOR_FORKS.map(detectEditorFork),
    ...OPEN_ONLY_EXES.map(detectOpenOnly),
    ...TERMINAL_AGENTS.map(detectTerminalAgent),
  ];
  const findTool = key => REGISTRY.find(t => t.key === String(key || '').toLowerCase().trim()) || null;

  app.get('/api/codeTools', (req, res) => {
    res.json({ success: true, tools: REGISTRY.map(t => ({ key: t.key, label: t.label, kind: t.kind, ready: t.ready, installHint: t.installHint || null })) });
  });

  app.post('/api/tool/codeAsk', async (req, res) => {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'What should I ask it to do?' });
    if (prompt.length > 2000) return res.status(400).json({ error: 'That prompt is too long (2000 characters max)' });
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(prompt)) return res.status(400).json({ error: 'The prompt has control characters I can\u2019t send' });
    const tool = findTool(req.body.tool);
    if (!tool) return res.status(400).json({ error: `"${req.body.tool}" is not a coding tool I know` });
    if (!tool.ready) return res.status(501).json({ error: `${tool.label} isn\u2019t installed on this laptop` + (tool.installHint ? ` — \`${tool.installHint}\`` : '') });
    const folderName = String(req.body.folder || '').trim();
    const p = folderName ? findAllowed(folderName, { kind: 'folder' }) : SANDBOX;
    if (!p) return res.status(404).json({ error: `No folder "${folderName}" in ~/jarvis or your project folders` });
    if (/[;"]/.test(p)) return res.status(400).json({ error: 'That folder\u2019s path has characters I can\u2019t pass to a terminal safely' });
    let extra = null;
    try {
      if (tool.kind === 'chat') await runChatTool(tool, p, prompt);
      else if (tool.kind === 'terminal') await runTerminalTool(tool, p, prompt);
      else extra = await runOpenOnly(tool, p, prompt);
      res.json({ success: true, tool: tool.label, folder: rel(p) || path.basename(p), kind: tool.kind, ...(extra || {}) });
    } catch (e) {
      res.status(500).json({ error: e.message || ('Could not start ' + tool.label) });
    }
  });
};

module.exports.parseLauncherCmd = parseLauncherCmd;
module.exports.quotePwshLiteral = quotePwshLiteral;
module.exports.buildTerminalScript = buildTerminalScript;
module.exports.buildEncodedCommand = buildEncodedCommand;
module.exports.EDITOR_FORKS = EDITOR_FORKS;
module.exports.OPEN_ONLY_EXES = OPEN_ONLY_EXES;
module.exports.TERMINAL_AGENTS = TERMINAL_AGENTS;
