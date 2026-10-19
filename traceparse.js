'use strict';
/* Reading an error message or stack trace (copied from a terminal, or read from the screen): which error it is, and which of YOUR files and lines it points at.
   Handles Node/JavaScript, Python, Java, C/C++ (gcc/clang), TypeScript, Go and Rust-style locations. Frames inside node_modules, the standard library or
   the language's own files are kept apart, so the first frame in your own code comes first. Pure; the server then looks the files up and reads a few lines
   around each (devtools.js). */
const TraceParse = (() => {
  const INTERNAL = /(?:^|[\\/])(?:node_modules|site-packages|dist-packages|\.cargo|\.rustup|go[\\/]pkg|lib[\\/]python[\d.]+|python[\d.]+[\\/]lib)(?:[\\/]|$)|^node:|^internal[\\/]|\(<anonymous>\)|^<frozen |[\\/]usr[\\/](?:lib|include)[\\/]|^java\.|^javax\.|^jdk\.|^sun\./i;
  const LOC = [
    // Node:  at fn (C:\x\a.js:12:5)   at C:\x\a.js:12:5   at file:///C:/x/a.mjs:3:9
    { re: /\bat\s+(?:[^\s(]+\s+)?\(?((?:file:\/\/\/)?(?:[A-Za-z]:)?[^\s():]+?\.(?:[cm]?[jt]sx?|vue|svelte)):(\d+):(\d+)\)?/g, lang: 'js' },
    // Python:  File "C:\x\a.py", line 12, in fn
    { re: /File\s+"([^"]+\.py[w]?)",\s+line\s+(\d+)/g, lang: 'python' },
    // Java:  at com.x.Main.run(Main.java:34)
    { re: /\bat\s+[\w.$<>]+\(([\w$]+\.(?:java|kt|scala)):(\d+)\)/g, lang: 'java' },
    // gcc/clang/rustc/go:  src/a.c:12:5: error: …   ./main.go:7:2: …   --> src/main.rs:4:5
    { re: /(?:^|\s|-->\s*)((?:[A-Za-z]:)?[^\s:()]+\.(?:c|cc|cpp|cxx|h|hpp|go|rs)):(\d+)(?::(\d+))?(?=[:\s])/gm, lang: 'c' },
    // TypeScript:  src/a.ts(12,5): error TS2322
    { re: /((?:[A-Za-z]:)?[^\s:()]+\.tsx?)\((\d+),(\d+)\):\s*error/g, lang: 'ts' },
  ];
  const ERR_LINE = [
    /^\s*((?:[A-Z][A-Za-z]*(?:Error|Exception|Warning)|Error|Exception|Traceback|SyntaxError|ReferenceError|TypeError|RangeError|AssertionError|KeyError|ValueError|ImportError|ModuleNotFoundError|IndentationError|NameError|AttributeError|ZeroDivisionError|FileNotFoundError|NullPointerException|ArrayIndexOutOfBoundsException|ClassNotFoundException|StackOverflowError|OutOfMemoryError)(?:\.[A-Za-z]+)*)\s*[:(]\s*(.*)$/,
    /^\s*(?:npm\s+)?ERR!?\s*(.+)$/i,
    /^\s*(?:fatal\s+)?error(?:\[[A-Z]\d+\])?:\s*(.+)$/i,
    /[:)]\s*(?:fatal\s+)?error(?:\s+TS\d+)?:\s*(.+)$/i,
    /^\s*(Cannot find module|Module not found|Uncaught|Unhandled|Segmentation fault|panic:|command not found|ENOENT|EADDRINUSE|EACCES|ECONNREFUSED)\b(.*)$/i,
  ];
  const normPath = p => String(p).replace(/^file:\/\/\//, '').replace(/\//g, '\\').replace(/^\\([A-Za-z]:)/, '$1');

  // text → { error: { type, message, line } | null, frames: [{ file, line, col, lang, internal }], mine: [frames in your code], looksLikeError }
  function parseTrace(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n').slice(0, 30000);
    const lines = t.split('\n');
    // the error: the LAST matching line of a Python traceback / the first of anything else is usually the message
    let error = null;
    for (let i = lines.length - 1; i >= 0 && !error; i--) {
      const l = lines[i];
      let m;
      if ((m = l.match(ERR_LINE[0]))) error = { type: m[1], message: (m[2] || '').trim().slice(0, 300), line: l.trim().slice(0, 300) };
    }
    if (!error) for (const l of lines) { let m; for (let k = 1; k < ERR_LINE.length && !error; k++) if ((m = l.match(ERR_LINE[k]))) error = { type: (m[1] && k === 4 ? m[1] : 'Error'), message: (k === 4 ? (m[1] + (m[2] || '')) : m[1]).trim().slice(0, 300), line: l.trim().slice(0, 300) }; if (error) break; }
    const frames = [], seen = new Set();
    for (const { re, lang } of LOC) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(t))) {
        const file = normPath(m[1]), ln = +m[2], col = m[3] ? +m[3] : null;
        if (!(ln > 0 && ln < 10000000)) continue;
        const key = file.toLowerCase() + ':' + ln;
        if (seen.has(key)) continue; seen.add(key);
        frames.push({ file, line: ln, col, lang, internal: INTERNAL.test(file), at: m.index });
      }
    }
    frames.sort((a, b) => a.at - b.at);
    const mine = frames.filter(f => !f.internal);
    const looksLikeError = !!error || frames.length > 0 || /\b(?:error|exception|traceback|failed|fatal|panic)\b/i.test(t);
    return { error, frames: frames.map(({ at, ...f }) => f), mine: mine.map(({ at, ...f }) => f), looksLikeError };
  }
  // a Python traceback lists the call that failed LAST, so the frame closest to the error is the best first look
  const orderForReading = (parsed) => {
    const python = parsed.mine.length && parsed.mine.every(f => f.lang === 'python');
    return python ? parsed.mine.slice().reverse() : parsed.mine.slice();
  };
  return { parseTrace, orderForReading, INTERNAL };
})();
if (typeof module !== 'undefined') module.exports = TraceParse;
