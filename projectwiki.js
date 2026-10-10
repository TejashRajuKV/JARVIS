'use strict';
/* "Document my project": a reference wiki for a folder of code, built from what is really in the files.
   The code does the reading: languages, entry points, modules, classes and functions (found by pattern matching, not guessed),
   which module imports which, and the Mermaid diagrams drawn from that import graph. The AI only adds ONE sentence per module,
   from its names and header comment, and it is marked as such. Every module, file, class and arrow in the output exists in the code.
   Pure functions are exported for tests. */
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'venv', '.venv', 'env', '__pycache__', 'dist', 'build', 'target', 'out', 'coverage', 'vendor', 'bin', 'obj', 'site-packages', 'pods', 'bower_components', 'third_party', 'thirdparty', 'generated', 'migrations', '.trash']);
const SKIP_FILE = /(?:\.min\.(?:js|css)|\.bundle\.js|_pb2(?:_grpc)?\.py|\.generated\.\w+|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.d\.ts)$/i;
const MAX_FILES = 400, MAX_DEPTH = 7, MAX_READ = 200 * 1024, MAX_TOTAL_READ = 20 * 1024 * 1024, MAX_MODULES = 10, MAX_NODES = 20;
const LANG = { '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python', '.java': 'Java', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.cs': 'C#', '.go': 'Go', '.rs': 'Rust', '.php': 'PHP', '.rb': 'Ruby', '.kt': 'Kotlin', '.swift': 'Swift', '.html': 'HTML', '.css': 'CSS', '.sql': 'SQL', '.sh': 'Shell', '.ps1': 'PowerShell', '.bat': 'Batch' };
const PARSED = new Set(['JavaScript', 'TypeScript', 'Python', 'Java', 'C', 'C++']);
const GENERIC = new Set(['src', 'lib', 'app', 'source', 'sources', 'main', 'java', 'python', 'pkg', 'packages']);
const NODE_BUILTIN = new Set(['fs', 'path', 'os', 'http', 'https', 'url', 'util', 'events', 'stream', 'crypto', 'child_process', 'net', 'zlib', 'readline', 'assert', 'buffer', 'querystring', 'timers', 'tls', 'dns', 'cluster', 'worker_threads', 'perf_hooks', 'vm', 'process', 'module', 'string_decoder', 'dgram', 'v8']);

/* ---------- helpers ---------- */
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
const posix = p => p.split(path.sep).join('/');
const code = s => '`' + String(s).replace(/`/g, "'") + '`';
const mermaidLabel = s => String(s).replace(/["\r\n<>#`|\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'unnamed';
const ident = s => String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1').slice(0, 40) || '_';
const cleanComment = s => String(s || '').replace(/^\s*(?:\/\*+|\*\/|\*|\/\/+|#+|"""|''')\s?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 300);

/* ---------- walking the folder ---------- */
function walk(root) {
  const files = []; let truncated = false;
  const rec = (dir, depth) => {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of items) {
      if (it.isSymbolicLink() || it.name.startsWith('.')) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name.toLowerCase())) continue;
        if (depth >= MAX_DEPTH) { truncated = true; continue; }
        rec(full, depth + 1);
      } else if (it.isFile()) {
        const ext = path.extname(it.name).toLowerCase(), lang = LANG[ext];
        if (!lang || SKIP_FILE.test(it.name)) continue;
        if (files.length >= MAX_FILES) { truncated = true; return; }
        let st; try { st = fs.statSync(full); } catch { continue; }
        files.push({ rel: posix(path.relative(root, full)), abs: full, ext, lang, size: st.size });
      }
    }
  };
  rec(root, 0);
  return { files, truncated };
}

/* ---------- reading definitions (pattern matching; each parser returns what is literally in the text) ---------- */
function header(text, lang) {
  let t = text.replace(/^﻿/, '').replace(/^#!.*\n/, '').replace(/^\s*(?:['"]use strict['"];?\s*)/, '');
  if (lang === 'Python') {
    const d = t.match(/^\s*(?:#[^\n]*\n\s*)*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
    if (d) return cleanComment(d[1] || d[2]);
    const c = t.match(/^((?:\s*#[^\n]*\n?)+)/); return c ? cleanComment(c[1]) : '';
  }
  const b = t.match(/^\s*\/\*([\s\S]*?)\*\//);
  if (b) return cleanComment(b[1]);
  const l = t.match(/^((?:\s*\/\/[^\n]*\n?)+)/);
  return l ? cleanComment(l[1]) : '';
}
const JS_CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'with', 'constructor']);

function braceBlock(lines, start) {                      // lines of a { … } block starting at line `start` (naive brace count)
  let depth = 0, begun = false, i = start;
  for (; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; begun = true; } else if (ch === '}') depth--; }
    if (begun && depth <= 0) break;
  }
  return lines.slice(start + 1, Math.min(i + 1, lines.length));
}

function parseJs(text) {
  const out = { imports: [], externals: [], classes: [], functions: [], entry: false };
  const lines = text.split('\n');
  for (const m of text.matchAll(/(?:require\(\s*|import\s*\(\s*|from\s+|import\s+)['"]([^'"\n]+)['"]/g)) {
    const s = m[1];
    if (/^\.{1,2}(\/|$)/.test(s)) out.imports.push(s);
    else { const pkg = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]; if (!NODE_BUILTIN.has(pkg.replace(/^node:/, '')) && !pkg.startsWith('node:')) out.externals.push(pkg); }
  }
  lines.forEach((ln, i) => {
    let m = ln.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/);
    if (m) {
      const methods = [];
      for (const b of braceBlock(lines, i)) {
        const mm = b.match(/^\s{1,8}(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
        if (mm && !JS_CONTROL.has(mm[1])) methods.push(mm[1]);
      }
      out.classes.push({ name: m[1], extends: m[2] || '', methods: [...new Set(methods)] });
      return;
    }
    m = ln.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/) || ln.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    if (m) out.functions.push(m[1]);
  });
  out.entry = /require\.main\s*===\s*module|app\.listen\(|\.listen\(\s*(?:PORT|\d)/.test(text);
  return out;
}

function parsePy(text) {
  const out = { imports: [], externals: [], classes: [], functions: [], entry: false };
  const lines = text.split('\n');
  let cur = null;
  lines.forEach(ln => {
    let m = ln.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/);
    if (m) {
      const dots = m[1], mod = m[2], names = m[3].replace(/[()#\\].*$/, '').split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(x => /^\w+$/.test(x));
      if (dots) { out.imports.push({ dots: dots.length, mod }); for (const n of names) out.imports.push({ dots: dots.length, mod: mod ? mod + '.' + n : n }); }
      else { out.imports.push({ dots: 0, mod }); for (const n of names) out.imports.push({ dots: 0, mod: mod + '.' + n }); }
      return;
    }
    m = ln.match(/^\s*import\s+([\w., ]+)/);
    if (m) { for (const part of m[1].split(',')) { const mod = part.trim().split(/\s+as\s+/)[0]; if (/^[\w.]+$/.test(mod)) out.imports.push({ dots: 0, mod }); } return; }
    m = ln.match(/^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/);
    if (m) { cur = { name: m[1], extends: (m[2] || '').split(',')[0].trim().replace(/[^\w.]/g, ''), methods: [] }; out.classes.push(cur); return; }
    m = ln.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
    if (m) { out.functions.push(m[1]); cur = null; return; }
    m = ln.match(/^(\s+)(?:async\s+)?def\s+(\w+)\s*\(/);
    if (m && cur) {                                       // only defs at the class body's own indent are methods (not defs nested inside them)
      if (cur.indent === undefined) cur.indent = m[1].length;
      if (m[1].length === cur.indent && !cur.methods.includes(m[2])) cur.methods.push(m[2]);
      return;
    }
    if (/^\S/.test(ln) && !/^\s*(#|@)/.test(ln) && ln.trim()) cur = cur && /^class\b/.test(ln) ? cur : null;
  });
  out.entry = /^if\s+__name__\s*==\s*['"]__main__['"]/m.test(text);
  return out;
}

function parseJava(text) {
  const out = { imports: [], externals: [], classes: [], functions: [], entry: false };
  for (const m of text.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+);/gm)) out.imports.push(m[1]);
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*(?:(?:public|protected|private|abstract|final|static)\s+)*(class|interface|enum)\s+(\w+)(?:\s+extends\s+([\w.]+))?/);
    if (!m) return;
    const methods = [];
    for (const b of braceBlock(lines, i)) {
      const mm = b.match(/^\s+(?:(?:public|protected|private|static|final|abstract|synchronized)\s+)+[\w<>\[\],.? ]+?\s+(\w+)\s*\(/);
      if (mm && !JS_CONTROL.has(mm[1])) methods.push(mm[1]);
    }
    out.classes.push({ name: m[2], kind: m[1], extends: m[3] || '', methods: [...new Set(methods)] });
  });
  out.entry = /public\s+static\s+void\s+main\s*\(/.test(text);
  return out;
}

function parseC(text) {
  const out = { imports: [], externals: [], classes: [], functions: [], entry: false };
  for (const m of text.matchAll(/^\s*#\s*include\s+"([^"\n]+)"/gm)) out.imports.push(m[1]);
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    let m = ln.match(/^\s*(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|private|protected)?\s*(\w+))?\s*\{?\s*$/);
    if (m) { out.classes.push({ name: m[1], extends: m[2] || '', methods: [] }); return; }
    m = ln.match(/^(?:[A-Za-z_][\w:<>*&\s]*?\s+)\**(\w+)\s*\([^;{]*\)\s*(?:const\s*)?\{?\s*$/);
    // a definition opens its body on this line or the next; a call or a prototype does not
    if (m && !JS_CONTROL.has(m[1]) && !/^(?:else|return|typedef)\b/.test(ln.trim()) && (/\{\s*$/.test(ln) || /^\s*\{/.test(lines[i + 1] || ''))) out.functions.push(m[1]);
  });
  out.entry = /\bint\s+main\s*\(/.test(text);
  return out;
}
const PARSERS = { JavaScript: parseJs, TypeScript: parseJs, Python: parsePy, Java: parseJava, C: parseC, 'C++': parseC };

/* ---------- resolving imports to files that really exist ---------- */
function resolveImports(file, parsed, index) {
  const { set, byStem } = index, out = [];
  const dir = path.posix.dirname(file.rel);
  const tryList = list => list.find(c => set.has(c));
  if (file.lang === 'JavaScript' || file.lang === 'TypeScript') {
    for (const s of parsed.imports) {
      const base = path.posix.normalize(path.posix.join(dir, s));
      const hit = tryList([base, ...['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].map(e => base + e), ...['.js', '.ts', '.tsx', '.jsx', '.mjs'].map(e => base + '/index' + e)]);
      if (hit) out.push(hit);
    }
  } else if (file.lang === 'Python') {
    for (const { dots, mod } of parsed.imports) {
      const parts = mod ? mod.split('.') : [];
      const bases = dots ? [path.posix.join(dir, ...Array(Math.max(0, dots - 1)).fill('..'))] : ['', dir];
      for (const b of bases) {
        const p = path.posix.normalize(path.posix.join(b, ...parts));
        const hit = tryList([p + '.py', p + '/__init__.py']);
        if (hit) { out.push(hit); break; }
      }
    }
  } else if (file.lang === 'Java') {
    for (const imp of parsed.imports) {
      const p = imp.split('.').join('/') + '.java';
      const hit = [...set].find(r => r === p || r.endsWith('/' + p));
      if (hit) out.push(hit);
    }
  } else {
    for (const s of parsed.imports) {
      const base = path.posix.normalize(path.posix.join(dir, s));
      const hit = tryList([base, ...(byStem.get(path.posix.basename(s).replace(/\.\w+$/, '')) || [])]);
      if (hit) out.push(hit);
    }
  }
  return [...new Set(out.filter(r => r !== file.rel))];
}

/* ---------- manifests and the README ---------- */
const readSmall = (p, max = 64 * 1024) => { try { const st = fs.statSync(p); return st.isFile() && st.size <= max ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
function readManifests(root) {
  const m = { name: '', version: '', description: '', scripts: {}, dependencies: [], entry: [], files: [] };
  const pj = readSmall(path.join(root, 'package.json'));
  if (pj) {
    try {
      const j = JSON.parse(pj); m.files.push('package.json');
      m.name = String(j.name || ''); m.version = String(j.version || ''); m.description = String(j.description || '').slice(0, 300);
      if (j.scripts && typeof j.scripts === 'object') for (const [k, v] of Object.entries(j.scripts).slice(0, 12)) m.scripts[k] = String(v).slice(0, 120);
      m.dependencies.push(...Object.keys(j.dependencies || {}), ...Object.keys(j.devDependencies || {}).map(d => d + ' (dev)'));
      if (j.main) m.entry.push(String(j.main));
      if (typeof j.bin === 'string') m.entry.push(j.bin); else if (j.bin && typeof j.bin === 'object') m.entry.push(...Object.values(j.bin).map(String));
    } catch {}
  }
  const rq = readSmall(path.join(root, 'requirements.txt'));
  if (rq) { m.files.push('requirements.txt'); m.dependencies.push(...rq.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim().split(/[<>=!~\s;\[]/)[0]).filter(x => /^[\w.-]+$/.test(x))); }
  const pp = readSmall(path.join(root, 'pyproject.toml'));
  if (pp) { m.files.push('pyproject.toml'); const n = pp.match(/^\s*name\s*=\s*["']([^"']+)["']/m); if (n && !m.name) m.name = n[1]; const dl = pp.match(/dependencies\s*=\s*\[([\s\S]*?)\]/); if (dl) m.dependencies.push(...[...dl[1].matchAll(/["']([\w.-]+)/g)].map(x => x[1])); }
  const pom = readSmall(path.join(root, 'pom.xml'));
  if (pom) { m.files.push('pom.xml'); m.dependencies.push(...[...pom.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map(x => x[1])); const n = pom.match(/<artifactId>([^<]+)<\/artifactId>/); if (n && !m.name) m.name = n[1]; }
  const gr = readSmall(path.join(root, 'build.gradle'));
  if (gr) { m.files.push('build.gradle'); m.dependencies.push(...[...gr.matchAll(/(?:implementation|api|compile)\s*\(?\s*['"]([^'"]+)['"]/g)].map(x => x[1])); }
  const cg = readSmall(path.join(root, 'Cargo.toml'));
  if (cg) { m.files.push('Cargo.toml'); const sec = cg.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/); if (sec) m.dependencies.push(...[...sec[1].matchAll(/^\s*([\w-]+)\s*=/gm)].map(x => x[1])); }
  const gm = readSmall(path.join(root, 'go.mod'));
  if (gm) { m.files.push('go.mod'); const n = gm.match(/^module\s+(\S+)/m); if (n && !m.name) m.name = n[1]; }
  m.dependencies = [...new Set(m.dependencies)].slice(0, 40);
  return m;
}
function readmeIntro(root) {
  for (const n of ['README.md', 'readme.md', 'README.txt', 'README']) {
    const t = readSmall(path.join(root, n));
    if (!t) continue;
    const paras = t.replace(/\r/g, '').split(/\n\s*\n/).map(p => p.trim()).filter(p => p && !/^#|^!\[|^\[!\[|^<|^[-=*_]{3,}$/.test(p));
    if (paras[0]) return paras[0].replace(/\s+/g, ' ').slice(0, 300);
  }
  return '';
}
function gitSha(root) {
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 40);
    const ref = head.slice(4).trim();
    try { return fs.readFileSync(path.join(root, '.git', ref), 'utf8').trim().slice(0, 40); }
    catch { const pk = fs.readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(' ' + ref)); return pk ? pk.split(' ')[0] : ''; }
  } catch { return ''; }
}

/* ---------- the model of the project ---------- */
function moduleOf(rel, lang) {
  const seg = rel.split('/');
  if (seg.length === 1) return '(root files)';
  if (lang === 'Java') {                                    // src/main/java/com/acme/util/X.java → "util" (the package, not the build layout)
    const dirs = seg.slice(0, -1);
    let i = 0;
    while (i < dirs.length - 1 && GENERIC.has(dirs[i].toLowerCase())) i++;
    if (/^(?:com|org|net|io|edu|gov)$/i.test(dirs[i] || '') && dirs.length - i > 2) i += 2;
    else if (/^(?:com|org|net|io|edu|gov)$/i.test(dirs[i] || '') && dirs.length - i > 1) i += 1;
    return dirs[i];
  }
  if (GENERIC.has(seg[0].toLowerCase()) && seg.length >= 3) return seg[0] + '/' + seg[1];
  return seg[0];
}

function scanProject(root) {
  const { files, truncated } = walk(root);
  const set = new Set(files.map(f => f.rel)), byStem = new Map();
  for (const f of files) { const s = path.posix.basename(f.rel).replace(/\.\w+$/, ''); if (!byStem.has(s)) byStem.set(s, []); byStem.get(s).push(f.rel); }
  const index = { set, byStem };
  let read = 0;
  for (const f of files) {
    f.module = moduleOf(f.rel, f.lang); f.lines = 0; f.classes = []; f.functions = []; f.imports = []; f.externals = []; f.header = ''; f.entry = false; f.parsed = false;
    if (f.size > MAX_READ || read + f.size > MAX_TOTAL_READ) { f.lines = Math.round(f.size / 38); f.skippedBig = true; continue; }
    let text; try { text = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
    read += f.size;
    f.lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;      // a file's last newline does not start another line
    f.header = header(text, f.lang);
    if (PARSERS[f.lang]) {
      const p = PARSERS[f.lang](text);
      f.parsed = true; f.classes = p.classes; f.functions = [...new Set(p.functions)]; f.externals = [...new Set(p.externals)]; f.entry = p.entry;
      f.imports = resolveImports(f, p, index);
    }
  }
  const languages = {};
  for (const f of files) { const l = languages[f.lang] || (languages[f.lang] = { files: 0, lines: 0 }); l.files++; l.lines += f.lines; }
  // modules
  const mods = new Map();
  for (const f of files) {
    if (!mods.has(f.module)) mods.set(f.module, { name: f.module, files: [], lines: 0 });
    const m = mods.get(f.module); m.files.push(f); m.lines += f.lines;
  }
  let modules = [...mods.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  const other = modules.slice(MAX_MODULES);
  modules = modules.slice(0, MAX_MODULES);
  const fileModule = new Map(); for (const m of modules) for (const f of m.files) fileModule.set(f.rel, m.name);
  for (const m of modules) {
    m.uses = new Map(); m.usedBy = new Map(); m.externals = new Set();
    for (const f of m.files) for (const e of f.externals) m.externals.add(e);
  }
  const edges = new Map();
  for (const f of files) for (const target of f.imports) {
    const a = fileModule.get(f.rel), b = fileModule.get(target);
    if (!a || !b || a === b) continue;
    const k = a + '\u0001' + b; edges.set(k, (edges.get(k) || 0) + 1);
    const ma = modules.find(m => m.name === a), mb = modules.find(m => m.name === b);
    ma.uses.set(b, (ma.uses.get(b) || 0) + 1); mb.usedBy.set(a, (mb.usedBy.get(a) || 0) + 1);
  }
  const manifest = readManifests(root);
  const entryPoints = [];
  for (const e of manifest.entry) { const rel = posix(path.normalize(e)).replace(/^\.\//, ''); if (set.has(rel)) entryPoints.push({ file: rel, why: 'named in ' + (manifest.files[0] || 'the manifest') }); }
  for (const f of files) if (f.entry && !entryPoints.some(e => e.file === f.rel)) entryPoints.push({ file: f.rel, why: f.lang === 'Python' ? 'has an if __name__ == "__main__" block' : f.lang === 'Java' ? 'has a main method' : f.lang === 'C' || f.lang === 'C++' ? 'has a main function' : 'starts a server or is run directly' });
  for (const n of ['index.html']) if (set.has(n) && !entryPoints.some(e => e.file === n)) entryPoints.push({ file: n, why: 'the web page' });
  return { name: path.basename(root), root, files, modules, otherModules: other.map(m => m.name), edges: [...edges.entries()].map(([k, n]) => { const [from, to] = k.split('\u0001'); return { from, to, count: n }; }), languages, manifest, entryPoints: entryPoints.slice(0, 8), readme: readmeIntro(root), sha: gitSha(root), truncated, parsedFiles: files.filter(f => f.parsed).length };
}

/* ---------- writing the pages ---------- */
const pluralize = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
function moduleDoc(model, m, summary) {
  const L = [`# Module: ${code(m.name)}`, ''];
  L.push(summary ? summary.text + (summary.ai ? ' *(AI summary)*' : '') : '*No description found in the code.*', '');
  L.push(`${pluralize(m.files.length, 'source file')}, about ${m.lines.toLocaleString('en-US')} lines. Languages: ${[...new Set(m.files.map(f => f.lang))].join(', ')}.`, '');
  const top = m.files.slice().sort((a, b) => b.lines - a.lines).slice(0, 8);
  L.push('## Key files', '');
  for (const f of top) L.push(`- ${code(f.rel)} — ${f.lines.toLocaleString('en-US')} lines` + (f.header ? ' — ' + f.header.slice(0, 160) : '') + (f.entry ? ' — **entry point**' : '') + (f.skippedBig ? ' — *too large to read, not analysed*' : ''));
  const classes = m.files.flatMap(f => f.classes.map(c => ({ ...c, file: f.rel })));
  if (classes.length) {
    L.push('', '## Classes', '');
    for (const c of classes.slice(0, 25)) L.push(`- ${code(c.name)}` + (c.extends ? ` extends ${code(c.extends)}` : '') + ` — ${code(c.file)}` + (c.methods.length ? ` — methods: ${c.methods.slice(0, 12).map(code).join(', ')}${c.methods.length > 12 ? ', …' : ''}` : ''));
    if (classes.length > 25) L.push(`- …and ${classes.length - 25} more`);
  }
  const fns = m.files.flatMap(f => f.functions.map(n => ({ n, file: f.rel })));
  if (fns.length) {
    L.push('', '## Functions', '');
    const byFile = new Map(); for (const x of fns) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x.n); }
    let shown = 0;
    for (const [file, names] of byFile) { if (shown >= 30) break; const take = names.slice(0, 30 - shown); shown += take.length; L.push(`- ${code(file)}: ${take.map(code).join(', ')}${take.length < names.length ? ', …' : ''}`); }
    if (fns.length > shown) L.push(`- …and ${fns.length - shown} more`);
  }
  L.push('', '## Connections', '');
  L.push('- **Uses:** ' + ([...m.uses.keys()].length ? [...m.uses.entries()].map(([k, n]) => `${code(k)} (${pluralize(n, 'import')})`).join(', ') : 'no other module of this project'));
  L.push('- **Used by:** ' + ([...m.usedBy.keys()].length ? [...m.usedBy.entries()].map(([k, n]) => `${code(k)} (${pluralize(n, 'import')})`).join(', ') : 'no other module of this project'));
  if (m.externals.size) L.push('- **Outside packages imported:** ' + [...m.externals].sort().slice(0, 20).map(code).join(', '));
  L.push('', '*Found by reading the source with pattern matching: names and imports are exact, but unusual code styles can be missed.*', '');
  return L.join('\n');
}
function architectureDoc(model) {
  const mods = model.modules.slice(0, MAX_NODES), id = new Map(mods.map((m, i) => [m.name, 'm' + i]));
  const entryMods = new Set(model.entryPoints.map(e => (model.files.find(f => f.rel === e.file) || {}).module));
  const L = ['# Architecture', '', `${code(model.name)} has ${pluralize(model.modules.length, 'main module')}` + (model.otherModules.length ? ` (plus ${model.otherModules.length} smaller ones not drawn)` : '') + `. An arrow means “imports from”, counted from the real source files.`, '', '## Modules', ''];
  for (const m of mods) L.push(`- **${m.name}** — ${pluralize(m.files.length, 'file')}, ${m.lines.toLocaleString('en-US')} lines — [details](modules/${slug(m.name)}.md)${entryMods.has(m.name) ? ' — contains an entry point' : ''}`);
  L.push('', '## Import diagram', '', '```mermaid', 'flowchart LR');
  for (const m of mods) L.push(`    ${id.get(m.name)}["${mermaidLabel(m.name)}"]`);
  const drawn = model.edges.filter(e => id.has(e.from) && id.has(e.to));
  for (const e of drawn) L.push(`    ${id.get(e.from)} -->|${e.count}| ${id.get(e.to)}`);
  L.push('```', '');
  if (!drawn.length) L.push('*No imports between modules were found, so no arrows are drawn.*', '');
  return L.join('\n');
}
function classesDoc(model) {
  const all = model.files.flatMap(f => f.classes.map(c => ({ ...c, file: f.rel }))).filter(c => c.methods.length || c.extends).slice(0, 25);
  if (!all.length) return '';
  const names = new Map(), used = new Set();
  for (const c of all) { let n = ident(c.name); while (used.has(n)) n += '_'; used.add(n); names.set(c, n); }
  const L = ['# Classes', '', 'Classes with methods or a parent class, as found in the source (the first 25).', '', '```mermaid', 'classDiagram'];
  for (const c of all) {
    L.push(`    class ${names.get(c)} {`);
    for (const m of c.methods.slice(0, 8)) L.push(`        +${ident(m)}()`);
    L.push('    }');
  }
  for (const c of all) {
    const parent = c.extends && all.find(p => p.name === c.extends.split('.').pop() && p !== c);
    if (parent) L.push(`    ${names.get(parent)} <|-- ${names.get(c)}`);
  }
  L.push('```', '', '## Where they are', '');
  for (const c of all) L.push(`- ${code(c.name)}` + (c.extends ? ` extends ${code(c.extends)}` : '') + ` — ${code(c.file)}`);
  L.push('');
  return L.join('\n');
}
function readmeDoc(model, summaries, generatedAt) {
  const man = model.manifest;
  const L = [`# ${model.name}`, ''];
  const intro = man.description || model.readme;
  L.push(intro ? intro : '*The project has no description in its manifest or README.*', '');
  L.push('## At a glance', '');
  L.push('- **Source files:** ' + model.files.length + (model.truncated ? ' (the folder is bigger than I read; I stopped at ' + MAX_FILES + ' files / ' + MAX_DEPTH + ' folder levels)' : ''));
  L.push('- **Languages:** ' + (Object.entries(model.languages).sort((a, b) => b[1].lines - a[1].lines).map(([l, v]) => `${l} (${pluralize(v.files, 'file')}, ${v.lines.toLocaleString('en-US')} lines)`).join(', ') || 'none found'));
  if (man.version) L.push('- **Version:** ' + man.version);
  if (model.entryPoints.length) L.push('- **Entry points:** ' + model.entryPoints.map(e => `${code(e.file)} (${e.why})`).join('; '));
  L.push('', '## Modules', '');
  for (const m of model.modules) { const s = summaries.get(m.name); L.push(`- [${m.name}](modules/${slug(m.name)}.md) — ${s ? s.text + (s.ai ? ' *(AI summary)*' : '') : pluralize(m.files.length, 'file') + ', ' + m.lines.toLocaleString('en-US') + ' lines'}`); }
  if (model.otherModules.length) L.push(`- …and ${model.otherModules.length} smaller: ${model.otherModules.slice(0, 12).map(code).join(', ')}`);
  L.push('', 'How the modules connect: [architecture.md](architecture.md).' + (classesDoc(model) ? ' Classes: [diagrams/classes.md](diagrams/classes.md).' : ''), '');
  const scripts = Object.entries(man.scripts);
  if (scripts.length) { L.push('## Commands from package.json', ''); for (const [k, v] of scripts) L.push(`- ${code('npm run ' + k)} — ${code(v)}`); L.push(''); }
  if (man.dependencies.length) L.push('## Dependencies (from ' + man.files.join(', ') + ')', '', man.dependencies.map(code).join(', '), '');
  L.push('---', `*Generated by JARVIS on ${generatedAt}` + (model.sha ? ` from commit ${code(model.sha.slice(0, 10))}` : '') + `. Structure is read from the source files; sentences marked “AI summary” were written by a language model and may be wrong.*`, '');
  return L.join('\n');
}
function buildWiki(model, summaries, generatedAt) {
  const pages = new Map();
  pages.set('README.md', readmeDoc(model, summaries, generatedAt));
  pages.set('architecture.md', architectureDoc(model));
  for (const m of model.modules) pages.set('modules/' + slug(m.name) + '.md', moduleDoc(model, m, summaries.get(m.name)));
  const cls = classesDoc(model);
  if (cls) pages.set('diagrams/classes.md', cls);
  return pages;
}

/* ---------- one sentence per module ---------- */
function fallbackSummary(m) {
  const withHeader = m.files.slice().sort((a, b) => b.lines - a.lines).find(f => f.header);
  return withHeader ? { text: withHeader.header.slice(0, 200), ai: false } : null;
}
function moduleFacts(m) {
  const names = [...m.files.flatMap(f => f.classes.map(c => c.name)), ...m.files.flatMap(f => f.functions)].slice(0, 25).join(', ');
  const headers = m.files.slice().sort((a, b) => b.lines - a.lines).filter(f => f.header).slice(0, 3).map(f => f.rel + ': ' + f.header.slice(0, 150)).join('\n');
  return `Module: ${m.name}\nFiles: ${m.files.slice(0, 12).map(f => f.rel).join(', ')}\nClasses and functions: ${names || '(none found)'}\n${headers ? 'Header comments:\n' + headers : ''}`.slice(0, 1200);
}
const SUMMARY_SYSTEM = 'You describe one part of a software project in a single plain sentence of at most 25 words. Use ONLY the names and comments you are given. Do not guess features that are not suggested by them. If the facts are too thin to say anything, reply exactly: UNKNOWN. Output only the sentence.';
async function summarize(model, llm, modelId, onProgress) {
  const out = new Map();
  let ai = 0;
  for (const m of model.modules) {
    let s = null;
    if (llm) {
      try {
        const t = (await llm.complete({ model: modelId, system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: moduleFacts(m) }], temperature: 0.2, maxTokens: 70, timeoutMs: 60000 })).trim().replace(/\s+/g, ' ');
        if (t && !/^UNKNOWN\.?$/i.test(t) && t.length <= 240) { s = { text: t.replace(/^["']|["']$/g, ''), ai: true }; ai++; }
      } catch {}
    }
    out.set(m.name, s || fallbackSummary(m));
    if (onProgress) onProgress(m.name);
  }
  return { summaries: out, ai };
}

/* ---------- writing to disk ---------- */
function writeWiki(dir, pages, state) {
  fs.mkdirSync(path.join(dir, 'modules'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'diagrams'), { recursive: true });
  for (const sub of ['modules', 'diagrams']) {               // pages of an earlier run that no longer exist
    try { for (const f of fs.readdirSync(path.join(dir, sub))) if (/\.md$/.test(f) && !pages.has(sub + '/' + f)) fs.unlinkSync(path.join(dir, sub, f)); } catch {}
  }
  for (const [rel, text] of pages) fs.writeFileSync(path.join(dir, ...rel.split('/')), text);
  fs.writeFileSync(path.join(dir, '.wiki-state.json'), JSON.stringify(state, null, 1));
  return [...pages.keys()];
}

/* ---------- route ---------- */
module.exports = function setupWiki(app, { llm, DEFAULT_MODEL, SANDBOX, findAllowed, anyPath, approvedChange, rel, openPath }) {
  app.post('/api/project/wiki', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || b.folder || '').trim();
    if (!name) return res.status(400).json({ error: 'Which project? Give its folder name or path.' });
    let p = null;
    if (anyPath && path.isAbsolute(name.replace(/^["']|["']$/g, ''))) p = anyPath(name);
    if (!p && findAllowed) p = findAllowed(name, { kind: 'folder' });
    let st; try { st = p && fs.statSync(p); } catch {}
    if (!st || !st.isDirectory()) return res.status(404).json({ error: 'I can’t find a project folder called “' + name.slice(0, 60) + '” in ~/jarvis or your project folders.' });
    if (path.parse(p).root === p) return res.status(400).json({ error: 'That is a whole drive. Point me at one project folder.' });
    const into = b.into === 'project';
    const outDir = into ? path.join(p, 'docs', 'wiki') : path.join(SANDBOX, 'Wikis', slug(path.basename(p)));
    if (into && approvedChange && !approvedChange(req, res, 'write the project wiki into', outDir)) return;
    try {
      const model = scanProject(p);
      if (!model.files.length) return res.status(422).json({ error: 'I found no source files in that folder (I look for code up to ' + MAX_DEPTH + ' folders deep, and skip node_modules, build folders and the like).' });
      const useAi = b.ai !== false && !!llm;
      const { summaries, ai } = await summarize(model, useAi ? llm : null, String(b.model || DEFAULT_MODEL));
      const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const pages = buildWiki(model, summaries, generatedAt);
      const written = writeWiki(outDir, pages, { project: model.name, source_path: p, source_sha: model.sha || 'not a git repository', generated_at: new Date().toISOString(), generator: 'JARVIS project wiki v1', modules: model.modules.map(m => m.name), source_files: model.files.length, ai_summaries: ai });
      if (b.open !== false && openPath) openPath(path.join(outDir, 'README.md'));
      res.json({ success: true, name: model.name, dir: outDir, relDir: rel ? rel(outDir) : outDir, files: written, modules: model.modules.length, sourceFiles: model.files.length, parsedFiles: model.parsedFiles, languages: model.languages, aiSummaries: ai, truncated: model.truncated, sha: model.sha });
    } catch (e) { res.status(500).json({ error: 'I couldn’t build the wiki: ' + String(e.message).slice(0, 120) }); }
  });
};
Object.assign(module.exports, { walk, scanProject, parseJs, parsePy, parseJava, parseC, header, resolveImports, readManifests, readmeIntro, gitSha, moduleOf, buildWiki, readmeDoc, architectureDoc, classesDoc, moduleDoc, summarize, fallbackSummary, moduleFacts, writeWiki, mermaidLabel, ident, slug, MAX_FILES, MAX_DEPTH, MAX_MODULES, MAX_NODES, SKIP_DIRS });
