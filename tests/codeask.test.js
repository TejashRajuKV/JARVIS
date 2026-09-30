// "Ask a coding AI in a folder" tests: NLU phrase parsing (nlu.js) and the pure launch helpers (codetools.js).
// Run: node tests/codeask.test.js
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'nlu.js'), 'utf8') + ';global.NLU=NLU;');
const CT = require(path.join(__dirname, '..', 'codetools.js'));

let fail = 0, total = 0;
const check = (name, ok, extra) => { total++; if (!ok) { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + JSON.stringify(extra) : '')); } };

/* ---------- NLU.parseCodeAsk ---------- */
{
  const r = NLU.parseCodeAsk('open dsa sprint in vs code and ask copilot to create a binary search function');
  check('open F in T and ask copilot to P — tool', r && r.tool === 'vscode', r);
  check('open F in T and ask copilot to P — folder', r && r.folder === 'dsa sprint', r);
  check('open F in T and ask copilot to P — prompt', r && r.prompt === 'create a binary search function', r);
}
{
  const r = NLU.parseCodeAsk('ask claude in dsa sprint to list the files');
  check('ask T in F to P — tool', r && r.tool === 'claude', r);
  check('ask T in F to P — folder', r && r.folder === 'dsa sprint', r);
  check('ask T in F to P — prompt', r && r.prompt === 'list the files', r);
}
{
  const r = NLU.parseCodeAsk('in dsa sprint, ask kiro to fix the bug');
  check('in F, ask T to P — tool', r && r.tool === 'kiro', r);
  check('in F, ask T to P — folder', r && r.folder === 'dsa sprint', r);
  check('in F, ask T to P — prompt', r && r.prompt === 'fix the bug', r);
}
{
  const r = NLU.parseCodeAsk('tell trae to refactor this in dsa sprint');
  check('tell T to P in F — tool', r && r.tool === 'trae', r);
  check('tell T to P in F — prompt', r && r.prompt === 'refactor this', r);
  check('tell T to P in F — folder', r && r.folder === 'dsa sprint', r);
}
{
  const r = NLU.parseCodeAsk('ask codex to add tests');
  check('ask T to P (no folder) — tool', r && r.tool === 'codex', r);
  check('ask T to P (no folder) — prompt', r && r.prompt === 'add tests', r);
  check('ask T to P (no folder) — folder empty', r && r.folder === '', r);
}
check('unknown tool alias → null', NLU.parseCodeAsk('ask my friend to fix it') === null);
check('no prompt → null', NLU.parseCodeAsk('open dsa sprint in vs code') === null);

// tool alias coverage
const ALIAS_CASES = [
  ['ask copilot to add a test', 'vscode'],
  ['ask antigravity to review this', 'antigravity'],
  ['ask windsurf to review this', 'devin'],
  ['ask open code to review this', 'opencode'],
  ['ask claude code to review this', 'claude'],
  ['ask free buff to review this', 'codebuff'],
  ['ask freebuff to review this', 'codebuff'],
  ['ask gemini to review this', 'gemini'],
  ['ask qwen to review this', 'qwen'],
];
for (const [text, want] of ALIAS_CASES) {
  const r = NLU.parseCodeAsk(text);
  check('alias: ' + text, r && r.tool === want, r);
}

// prompt keeps its original casing
{
  const r = NLU.parseCodeAsk('ask claude to Create a File Named Hello.py');
  check('prompt keeps original casing', r && r.prompt === 'Create a File Named Hello.py', r);
}

// free-form phrasings (real messages)
{
  const r = NLU.parseCodeAsk('Open vs code in dsa_sprint folder, create main. py folder and also to copilot tell to write a addition or multiplication function in main. py file');
  check('free-form: tool', r && r.tool === 'vscode', r);
  check('free-form: folder', r && r.folder === 'dsa_sprint', r);
  check('free-form: prompt keeps both steps, fixes "main. py"', r && /create main\.py file/i.test(r.prompt) && /write a addition or multiplication function in main\.py/i.test(r.prompt) && !/copilot|tell/i.test(r.prompt), r);
  const L = [
    ['open vs code in dsa_sprint and tell copilot to add a binary search function', 'vscode', 'dsa_sprint', 'Add a binary search function'],
    ['open dsa_sprint folder in vs code and have copilot write tests for main.py', 'vscode', 'dsa_sprint', 'Write tests for main.py'],
    ['in dsa_sprint folder ask claude to explain the code', 'claude', 'dsa_sprint', 'explain the code'],
    ['open kiro in the OOPS sprint folder and tell it to add a Stack class', 'kiro', 'OOPS sprint', 'Add a Stack class'],
    ['open vs code and tell claude to fix the bug in main.py in dsa_sprint folder', 'claude', 'dsa_sprint', 'fix the bug in main.py'],
  ];
  for (const [t, tool, folder, prompt] of L) { const x = NLU.parseCodeAsk(t); check('free-form: ' + t, x && x.tool === tool && x.folder === folder && x.prompt === prompt, x); }
  {
    const o = NLU.parseCodeAsk('Open  opencode in dsa_sprint folder, create main. py folder and also to copilot tell to write a addition or multiplication function in main. py file');
    check('opened tool wins over "copilot" (Copilot only lives in VS Code)', o && o.tool === 'opencode' && o.folder === 'dsa_sprint' && /^Create main\.py file and write/.test(o.prompt), o);
    const g = NLU.parseCodeAsk('Open  opencode in dsa_sprint folder, create main. py folder and also  tell ai to write a addition or multiplication function in main. py file');
    check('"tell ai to" is dropped from the request', g && g.tool === 'opencode' && g.prompt === 'Create main.py file and write a addition or multiplication function in main.py file', g);
    const c = NLU.parseCodeAsk('open vs code in dsa_sprint and tell claude to add tests');
    check('a named agent still wins ("open vs code … tell claude")', c && c.tool === 'claude', c);
  }
  check('"have you opened vs code" is not a request', NLU.parseCodeAsk('have you opened vs code') === null);
  check('free-form routes to CODE_ASK', ['Open vs code in dsa_sprint folder, create main. py folder and also to copilot tell to write a addition function in main. py file', 'open dsa_sprint folder in vs code and have copilot write tests for main.py']
    .every(t => NLU.classify(NLU.normalize(t, 'jarvis'), {}).intent === 'CODE_ASK'));
}

/* ---------- negative: existing intents must not be hijacked ---------- */
const route = t => { const n = NLU.normalize(t, 'jarvis'); return NLU.classify(n, {}); };
check('"open vs code" stays OPEN_APPLICATION', route('open vs code').intent === 'OPEN_APPLICATION');
check('"open dsa sprint in vs code" stays OPEN_IN_EDITOR', route('open dsa sprint in vs code').intent === 'OPEN_IN_EDITOR');
check('"what is copilot" is not CODE_ASK', route('what is copilot').intent !== 'CODE_ASK');
check('"open dsa sprint in vs code and ask copilot to add a test" → CODE_ASK', route('open dsa sprint in vs code and ask copilot to add a test').intent === 'CODE_ASK');
check('"ask claude in dsa sprint to list the files" → CODE_ASK', route('ask claude in dsa sprint to list the files').intent === 'CODE_ASK');

/* ---------- codetools.js pure helpers ---------- */
{
  const cmdText = '@echo off\r\nsetlocal\r\nset VSCODE_DEV=\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Code.exe" "%~dp0..\\04c0d99f4f\\resources\\app\\out\\cli.js" %*\r\nIF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%\r\nendlocal\r\n';
  const cmdPath = 'C:\\Users\\tejas\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
  const parsed = CT.parseLauncherCmd(cmdText, cmdPath);
  check('parseLauncherCmd finds the exe', parsed && parsed.exe === 'C:\\Users\\tejas\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', parsed);
  check('parseLauncherCmd finds cli.js', parsed && parsed.cliJs === 'C:\\Users\\tejas\\AppData\\Local\\Programs\\Microsoft VS Code\\04c0d99f4f\\resources\\app\\out\\cli.js', parsed);
  check('parseLauncherCmd rejects unrelated text', CT.parseLauncherCmd('not a launcher', cmdPath) === null);
}
{
  check('quotePwshLiteral wraps in single quotes', CT.quotePwshLiteral('hello') === "'hello'");
  check('quotePwshLiteral doubles embedded quotes', CT.quotePwshLiteral("it's") === "'it''s'");
  check('quotePwshLiteral leaves ; $( ) ` alone (still one literal token)', CT.quotePwshLiteral('a; $(rm -rf x) `evil`') === "'a; $(rm -rf x) `evil`'");
}
{
  // A hostile prompt must round-trip as literal text: decode the base64, and the payload must be exactly what
  // was asked for, still inside the single-quoted literal — never executed as its own PowerShell expression.
  const hostile = "x'; Remove-Item -Recurse -Force C:\\; echo 'done";
  const script = CT.buildTerminalScript('C:\\bin\\claude.exe', 'positional', hostile);
  const encoded = CT.buildEncodedCommand(script);
  const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
  const expected = "& 'C:\\bin\\claude.exe' 'x''; Remove-Item -Recurse -Force C:\\; echo ''done'";
  check('encoded command decodes back to the exact script', decoded === script, { script, decoded });
  check('hostile prompt round-trips as one doubled-quote literal', decoded === expected, { decoded, expected });
  check('the call operator only ever runs the exe, once', (decoded.match(/&/g) || []).length === 1);
}
{
  const script = CT.buildTerminalScript('C:\\bin\\gemini.exe', 'flag-i', 'explain this repo');
  check('flag-i mode adds -i before the quoted prompt', script === "& 'C:\\bin\\gemini.exe' -i 'explain this repo'", script);
}

/* ---------- registry sanity ---------- */
check('editor forks include vscode/kiro/trae/antigravity/devin', ['vscode', 'kiro', 'trae', 'antigravity', 'devin'].every(k => CT.EDITOR_FORKS.some(f => f.key === k)));
check('terminal agents include claude/codex/gemini/qwen/codebuff', ['claude', 'codex', 'gemini', 'qwen', 'codebuff'].every(k => CT.TERMINAL_AGENTS.some(f => f.key === k)));
check('opencode is registered as open-only', CT.OPEN_ONLY_EXES.some(o => o.key === 'opencode'));

console.log(`codeask: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
