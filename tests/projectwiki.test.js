// Project wiki (projectwiki.js): reading code, the import graph, the pages and diagrams, the one-sentence AI summaries, the route.
// The key promise is tested directly: everything the wiki names exists in the project.
// Run: node tests/projectwiki.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const W = require(path.join(__dirname, '..', 'projectwiki.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'));
const mk = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

/* ---------- reading definitions ---------- */
{
  const js = W.parseJs(`'use strict';
const express = require('express');
const fs = require('fs'), { join } = require('node:path');
const local = require('./local');
import thing from '../lib/thing.js';
import('./lazy');
export class Cart extends Base {
  constructor() { super(); }
  add(item) { this.items.push(item); }
  async remove(id) { if (id) { return 1; } }
  static create() { return new Cart(); }
  get total() { return 1; }
}
class Plain {}
function total(items) { return 0; }
export async function load() {}
const save = async (x) => { return x; };
const pick = x => x;
const notAFunction = 5;
    function nestedNotTop() {}
app.listen(3000);
`);
  check('js: relative imports kept, outside packages listed without Node built-ins', js.imports.join() === './local,../lib/thing.js,./lazy' && js.externals.join() === 'express', js);
  check('js: classes with parent and real methods (control keywords and constructor are not methods)', js.classes.length === 2 && js.classes[0].name === 'Cart' && js.classes[0].extends === 'Base' && js.classes[0].methods.join() === 'add,remove,create,total' && js.classes[1].name === 'Plain' && js.classes[1].methods.length === 0, js.classes);
  check('js: top-level functions and arrow functions only', js.functions.join() === 'total,load,save,pick', js.functions);
  check('js: a server start counts as an entry point', js.entry === true && W.parseJs('function a(){}').entry === false && W.parseJs('if (require.main === module) main();').entry === true);
  check('js: scoped packages keep their scope; deep imports are the package', W.parseJs("require('@scope/pkg/sub'); require('lodash/fp');").externals.join() === '@scope/pkg,lodash');

  const py = W.parsePy(`"""Engine of the app."""
import os, sys as system
import utils
from core.engine import Engine, run as go
from . import sibling
from ..pkg.mod import thing
class Engine(Base, Mixin):
    def run(self):
        def inner(): pass
    async def stop(self): pass
    def run(self): pass
class Other:
    pass
def helper(x): return x
async def fetch(): pass
@decorator
def decorated(): pass
if __name__ == "__main__":
    helper(1)
`);
  const mods = py.imports.map(i => i.dots + ':' + i.mod);
  check('python: plain, aliased and from-imports (each imported name too), relative dots counted', mods.includes('0:os') && mods.includes('0:sys') && mods.includes('0:utils') && mods.includes('0:core.engine') && mods.includes('0:core.engine.Engine') && mods.includes('1:') && mods.includes('1:sibling') && mods.includes('2:pkg.mod') && mods.includes('2:pkg.mod.thing'), mods);
  check('python: classes with first parent and their methods (no duplicates, nested defs ignored)', py.classes.map(c => c.name + '<' + c.extends + '>' + c.methods.join('+')).join('|') === 'Engine<Base>run+stop|Other<>', py.classes);
  check('python: top-level functions only (also async and decorated)', py.functions.join() === 'helper,fetch,decorated', py.functions);
  check('python: __main__ block is the entry point', py.entry === true && W.parsePy('def f(): pass').entry === false);

  const java = W.parseJava(`package com.acme;
import com.acme.util.Strings;
import static java.lang.Math.max;
public class App extends Base implements Runnable {
    private int count;
    public static void main(String[] args) { }
    public void run() { if (x) { } }
    private static final List<String> names() { return null; }
    int notPublic() { }
}
interface Shape { double area(); }
enum Color { RED }
`);
  check('java: imports, classes / interfaces / enums with parent', java.imports.join() === 'com.acme.util.Strings,java.lang.Math.max' && java.classes.map(c => c.kind + ' ' + c.name + (c.extends ? '<' + c.extends : '')).join('|') === 'class App<Base|interface Shape|enum Color', java.classes);
  check('java: methods with a modifier, and main as the entry point', java.classes[0].methods.join() === 'main,run,names' && java.entry === true, java.classes[0].methods);

  const c = W.parseC('#include <stdio.h>\n#include "util.h"\n#include "sub/log.h"\nclass Widget : public Base {\n};\nstruct Node {\n};\nint add(int a, int b) {\n  return a + b;\n}\nstatic void helper()\n{\n}\nint main(int argc, char** argv) {\n}\n');
  check('c/c++: local includes only, classes and structs, functions, main', c.imports.join() === 'util.h,sub/log.h' && c.classes.map(x => x.name + '<' + x.extends).join() === 'Widget<Base,Node<' && c.functions.join() === 'add,helper,main' && c.entry === true, c);

  check('header: block comment, // lines, python docstring, python # lines, none', W.header('/*\n * Cart logic.\n * Adds items.\n */\ncode', 'JavaScript') === 'Cart logic. Adds items.' && W.header("'use strict';\n// Small helper\n// for dates\nx", 'JavaScript') === 'Small helper for dates' && W.header('#!/usr/bin/env python\n"""Engine of the app."""\nx', 'Python') === 'Engine of the app.' && W.header('# Tools for\n# the shop\nimport os', 'Python') === 'Tools for the shop' && W.header('const x = 1;', 'JavaScript') === '');
}

/* ---------- a JavaScript project on disk ---------- */
const shop = path.join(tmp, 'shop');
mk(shop, 'package.json', JSON.stringify({ name: 'shop', version: '1.2.0', description: 'A tiny shop API', main: 'src/server.js', scripts: { start: 'node src/server.js', test: 'node test.js' }, dependencies: { express: '^4' }, devDependencies: { jest: '^29' } }));
mk(shop, 'README.md', '# Shop\n\n[![badge](x)](y)\n\nA small online shop for demos.\n\nMore text.');
mk(shop, 'src/server.js', "/* The web server. */\nconst express = require('express');\nconst cart = require('./routes/cart');\nconst store = require('./db/store');\napp.listen(3000);\n");
mk(shop, 'src/routes/cart.js', "// Cart endpoints\nconst Base = require('./base');\nconst store = require('../db');\nclass CartRoute extends Base {\n  add(item) { return 1; }\n  remove(id) { return 2; }\n}\nfunction total() {}\nmodule.exports = CartRoute;\n");
mk(shop, 'src/routes/base.js', "class BaseRoute {\n  handle() {}\n}\nmodule.exports = BaseRoute;\n");
mk(shop, 'src/db/store.js', "const save = (x) => x;\nfunction load() {}\nmodule.exports = { save, load };\n");
mk(shop, 'src/db/index.js', "module.exports = require('./store');\n");
mk(shop, 'ui/app.js', "const store = require('../src/db/store');\nfunction render() {}\n");
mk(shop, 'tools.py', '"""Maintenance tools."""\nimport os\ndef clean(): pass\nif __name__ == "__main__":\n    clean()\n');
mk(shop, 'node_modules/junk/index.js', 'module.exports = 1;');
mk(shop, 'dist/bundle.min.js', 'var a=1;');
mk(shop, 'src/vendor.min.js', 'var b=2;');
mk(shop, '.hidden/secret.js', 'x');
mk(shop, 'package-lock.json', '{}');
mk(shop, 'notes.txt', 'not source');
let model;
{
  const w = W.walk(shop);
  const names = w.files.map(f => f.rel).sort();
  check('walk: source files only — no node_modules, dist, minified, lock, hidden or non-code files', names.join() === 'src/db/index.js,src/db/store.js,src/routes/base.js,src/routes/cart.js,src/server.js,tools.py,ui/app.js' && !w.truncated, names);
  model = W.scanProject(shop);
  check('scan: languages with files and lines', model.languages.JavaScript.files === 6 && model.languages.Python.files === 1 && model.languages.JavaScript.lines > 10, model.languages);
  check('scan: modules are the real folders (src is split because it holds subfolders), biggest first', model.modules.map(m => m.name).sort().join() === '(root files),src,src/db,src/routes,ui', model.modules.map(m => m.name));
  const key = model.edges.map(e => e.from + '>' + e.to).sort().join();
  check('scan: arrows only where a real import exists, between different modules', key === 'src/routes>src/db,src>src/db,src>src/routes,ui>src/db', key);
  check('scan: imports inside one module draw nothing (cart → base)', !model.edges.some(e => e.from === 'src/routes' && e.to === 'src/routes'));
  check('scan: a re-export through index.js resolves', model.files.find(f => f.rel === 'src/routes/cart.js').imports.includes('src/db/index.js') && model.files.find(f => f.rel === 'src/db/index.js').imports.join() === 'src/db/store.js');
  check('scan: manifest — name, version, description, scripts, dependencies', model.manifest.name === 'shop' && model.manifest.version === '1.2.0' && model.manifest.description === 'A tiny shop API' && model.manifest.scripts.start === 'node src/server.js' && model.manifest.dependencies.join() === 'express,jest (dev)', model.manifest);
  check('scan: README intro skips headings and badges', model.readme === 'A small online shop for demos.', model.readme);
  check('scan: entry points — the one named in package.json, and the Python main', model.entryPoints.map(e => e.file + ':' + e.why).join('|') === 'src/server.js:named in package.json|tools.py:has an if __name__ == "__main__" block', model.entryPoints);
  const srvMod = model.modules.find(m => m.name === 'src/routes');
  check('scan: a module knows who it uses and who uses it, and the outside packages it imports', model.modules.find(m => m.name === 'src').uses.get('src/routes') === 1 && model.modules.find(m => m.name === 'src/db').usedBy.get('ui') === 1 && model.modules.find(m => m.name === 'src').externals.has('express') && srvMod.externals.size === 0);
  check('scan: line counts are real (a trailing newline is not another line)', model.files.find(f => f.rel === 'src/db/index.js').lines === 1 && model.files.find(f => f.rel === 'src/routes/base.js').lines === 4 && model.files.find(f => f.rel === 'src/server.js').lines === 5, model.files.map(f => f.rel + ':' + f.lines));
  check('scan: not a git repository → no commit', model.sha === '');
}

/* ---------- the pages ---------- */
const AT = '2026-10-08 12:00';
const summaries = new Map([['src/routes', { text: 'Handles the cart endpoints.', ai: true }], ['src/db', { text: 'Cart endpoints', ai: false }]]);
{
  const pages = W.buildWiki(model, summaries, AT);
  check('pages: README, architecture, one page per module, and the class diagram', [...pages.keys()].sort().join() === 'README.md,architecture.md,diagrams/classes.md,modules/root-files.md,modules/src-db.md,modules/src-routes.md,modules/src.md,modules/ui.md', [...pages.keys()]);
  const readme = pages.get('README.md');
  check('readme: name, description, languages, entry points, commands, dependencies', /^# shop/.test(readme) && /A tiny shop API/.test(readme) && /\*\*Languages:\*\* JavaScript \(6 files/.test(readme) && /Python \(1 file,/.test(readme) && /`src\/server\.js` \(named in package\.json\)/.test(readme) && /`npm run start` — `node src\/server\.js`/.test(readme) && /`express`, `jest \(dev\)`/.test(readme), readme);
  check('readme: module list links to the module pages; AI sentences are marked, header comments are not', /\[src\/routes\]\(modules\/src-routes\.md\) — Handles the cart endpoints\. \*\(AI summary\)\*/.test(readme) && /\[src\/db\]\(modules\/src-db\.md\) — Cart endpoints\n/.test(readme) && !/Cart endpoints \*\(AI/.test(readme));
  check('readme: says when it was made and how the structure was found', /Generated by JARVIS on 2026-10-08 12:00/.test(readme) && /Structure is read from the source files/.test(readme));
  const mod = pages.get('modules/src-routes.md');
  check('module page: purpose, key files with their header comments, classes with methods, functions, connections', /^# Module: `src\/routes`/.test(mod) && /Handles the cart endpoints\. \*\(AI summary\)\*/.test(mod) && /- `src\/routes\/cart\.js` — \d+ lines — Cart endpoints/.test(mod) && /- `CartRoute` extends `Base` — `src\/routes\/cart\.js` — methods: `add`, `remove`/.test(mod) && /- `src\/routes\/cart\.js`: `total`/.test(mod) && /\*\*Uses:\*\* `src\/db` \(1 import\)/.test(mod) && /\*\*Used by:\*\* `src` \(1 import\)/.test(mod), mod);
  check('module page: no summary → says so honestly instead of making one up', /\*No description found in the code\.\*/.test(pages.get('modules/ui.md')));
  const arch = pages.get('architecture.md');
  check('architecture: a Mermaid flowchart with every module and the real arrows (counted)', /```mermaid\nflowchart LR\n/.test(arch) && (arch.match(/^    m\d+\["/gm) || []).length === 5 && (arch.match(/-->\|1\|/g) || []).length === 4, arch);
  check('architecture: marks the module that holds the entry point', /\*\*src\*\* —.*contains an entry point/.test(arch) && /\*\*\(root files\)\*\* —.*contains an entry point/.test(arch));
  const cls = pages.get('diagrams/classes.md');
  check('classes: a classDiagram with the methods and the inheritance arrow only when the parent is in the set', /classDiagram/.test(cls) && /class CartRoute \{\n        \+add\(\)\n        \+remove\(\)\n    \}/.test(cls) && !/<\|--/.test(cls.replace(/BaseRoute <\|-- CartRoute/, '')) === true, cls);
}
{
  // every page: balanced fences; every Mermaid node label is a module; every drawn arrow points at drawn nodes
  const pages = W.buildWiki(model, summaries, AT);
  for (const [name, text] of pages) {
    const fences = (text.match(/^```/gm) || []).length, opens = (text.match(/^```mermaid/gm) || []).length;
    check('fences balance in ' + name, fences === opens * 2, { fences, opens });
  }
  const arch = pages.get('architecture.md');
  const ids = new Map([...arch.matchAll(/^    (m\d+)\["([^"]*)"\]/gm)].map(m => [m[1], m[2]]));
  const modNames = new Set(model.modules.map(m => m.name));
  check('no invention: every diagram node is a real module', [...ids.values()].every(l => modNames.has(l)));
  const arrows = [...arch.matchAll(/^    (m\d+) -->\|\d+\| (m\d+)/gm)];
  check('no invention: every arrow joins two drawn nodes, and matches a real import edge', arrows.length === 4 && arrows.every(a => ids.has(a[1]) && ids.has(a[2]) && model.edges.some(e => e.from === ids.get(a[1]) && e.to === ids.get(a[2]))));
  // every `path` named in a module page is a file that exists in the project
  const files = new Set(model.files.map(f => f.rel));
  const named = [...[...pages.entries()].filter(([n]) => n.startsWith('modules/')).map(([, t]) => t).join('\n').matchAll(/`([\w.\/-]+\.(?:js|py|java|c|cpp|h))`/g)].map(m => m[1]);
  check('no invention: every file a module page names exists in the project', named.length > 5 && named.every(n => files.has(n)), named.filter(n => !files.has(n)));
  const classNames = new Set(model.files.flatMap(f => f.classes.map(c => c.name)));
  const diagramClasses = [...pages.get('diagrams/classes.md').matchAll(/^    class (\w+) \{/gm)].map(m => m[1]);
  check('no invention: every class in the class diagram is a class in the code', diagramClasses.length === 2 && diagramClasses.every(c => classNames.has(c)), diagramClasses);
}

/* ---------- hostile names ---------- */
{
  check('mermaid labels: quotes, brackets, tags and line breaks are removed; long names cut', W.mermaidLabel('a"]; click b call evil()\n<script>') === "a ; click b call evil() script" && W.mermaidLabel('') === 'unnamed' && W.mermaidLabel('x'.repeat(100)).length === 40 && !/["<>#\[\]{}|`]/.test(W.mermaidLabel('"<>#[]{}|`')));
  check('mermaid class ids are plain identifiers', W.ident('Cart$Route<T>') === 'Cart_Route_T_' && W.ident('9lives') === '_9lives' && W.ident('') === '_' && /^\w+$/.test(W.ident('naïve class')));
  const evil = path.join(tmp, 'evil'); mk(evil, "a b'c/main.js", 'class `Bad` {}\nfunction x(){}\n'); mk(evil, 'lib/zed.js', "class Q$ extends B { m$() {} }\nmodule.exports = 1;\n");
  const m = W.scanProject(evil), pages = W.buildWiki(m, new Map(), AT), all = [...pages.values()].join('\n');
  check('odd folder and class names never break a Mermaid block', pages.get('architecture.md').split('\n').filter(l => /^    m\d+\[/.test(l)).every(l => /^    m\d+\["[^"]*"\]$/.test(l)) && ![...pages.values()].some(t => /^```mermaid/m.test(t) && /\n    class [^\w\s{]/.test(t)), all.slice(0, 400));
  check('odd module names make safe page file names', [...pages.keys()].every(k => /^[\w\/.-]+$/.test(k)), [...pages.keys()]);
}

/* ---------- Python and Java projects ---------- */
{
  const py = path.join(tmp, 'pyapp');
  mk(py, 'main.py', 'import utils\nfrom core.engine import Engine\nif __name__ == "__main__":\n    Engine().run()\n');
  mk(py, 'utils.py', 'def helper(): pass\n');
  mk(py, 'core/__init__.py', '');
  mk(py, 'core/engine.py', '"""The engine."""\nfrom .helpers import clamp\nfrom core import helpers\nimport numpy\nclass Engine(Base):\n    def run(self): pass\n');
  mk(py, 'core/helpers.py', 'def clamp(x): return x\n');
  const m = W.scanProject(py);
  check('python project: modules, relative + absolute local imports resolved, outside packages listed', m.modules.map(x => x.name).sort().join() === '(root files),core' && m.edges.map(e => e.from + '>' + e.to).join() === '(root files)>core' && m.files.find(f => f.rel === 'core/engine.py').imports.includes('core/helpers.py') && m.modules.find(x => x.name === 'core').externals.size === 0, { mods: m.modules.map(x => x.name), edges: m.edges, imp: m.files.find(f => f.rel === 'core/engine.py').imports });
  check('python project: entry point and the header comment as the fallback summary', m.entryPoints[0].file === 'main.py' && W.fallbackSummary(m.modules.find(x => x.name === 'core')).text === 'The engine.' && W.fallbackSummary(m.modules.find(x => x.name === '(root files)')) === null);

  const jv = path.join(tmp, 'javaapp');
  mk(jv, 'src/main/java/com/acme/App.java', 'package com.acme;\nimport com.acme.util.Strings;\npublic class App {\n  public static void main(String[] a) {}\n}\n');
  mk(jv, 'src/main/java/com/acme/util/Strings.java', 'package com.acme.util;\npublic class Strings {\n  public static String up(String s) { return s; }\n}\n');
  const j = W.scanProject(jv);
  check('java project: the standard src/main/java/com/… layout is read; modules are the packages; the import is resolved; entry point found', j.files.length === 2 && j.modules.map(m => m.name).sort().join() === 'acme,util' && j.edges.map(e => e.from + '>' + e.to).join() === 'acme>util' && j.files.find(f => f.rel.endsWith('App.java')).imports.join() === 'src/main/java/com/acme/util/Strings.java' && j.entryPoints[0].why === 'has a main method', { mods: j.modules.map(m => m.name), edges: j.edges });
  check('java modules: build-layout folders and the reverse-domain prefix are not modules', W.moduleOf('src/main/java/com/acme/App.java', 'Java') === 'acme' && W.moduleOf('src/main/java/com/acme/util/Strings.java', 'Java') === 'util' && W.moduleOf('src/org/x/Y.java', 'Java') === 'x' && W.moduleOf('Y.java', 'Java') === '(root files)' && W.moduleOf('src/Foo.java', 'Java') === 'src' && W.moduleOf('src/routes/cart.js', 'JavaScript') === 'src/routes');
}

/* ---------- limits ---------- */
{
  const big = path.join(tmp, 'big');
  for (let i = 0; i < W.MAX_FILES + 30; i++) mk(big, 'f' + String(i).padStart(3, '0') + '.js', 'const a = ' + i + ';\n');
  const w = W.walk(big);
  check('limit: at most 400 source files, and it says it stopped', w.files.length === W.MAX_FILES && w.truncated);
  const deep = path.join(tmp, 'deep');
  mk(deep, 'a/b/c/d/e/f/g/h/too-deep.js', 'x'); mk(deep, 'a/b/c/d/e/f/g/ok.js', 'x'); mk(deep, 'top.js', 'x');
  const d = W.walk(deep);
  check('limit: folders deeper than 7 levels are not read, and it says so', d.files.map(f => f.rel).sort().join() === 'a/b/c/d/e/f/g/ok.js,top.js' && d.truncated);
  const huge = path.join(tmp, 'huge'); mk(huge, 'small.js', 'function a(){}\n'); mk(huge, 'giant.js', 'x'.repeat(250 * 1024));
  const h = W.scanProject(huge);
  check('limit: a giant file is counted but not read', h.files.find(f => f.rel === 'giant.js').skippedBig === true && h.files.find(f => f.rel === 'giant.js').classes.length === 0 && h.files.find(f => f.rel === 'small.js').functions.join() === 'a');
  let linked = false; const sl = path.join(tmp, 'linky'); mk(sl, 'real.js', 'x'); try { fs.symlinkSync(path.join(shop, 'src'), path.join(sl, 'out'), 'junction'); linked = true; } catch {}
  if (linked) check('limit: symbolic links / junctions are never followed', W.walk(sl).files.map(f => f.rel).join() === 'real.js');
  const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty);
  check('limit: an empty folder scans to nothing without error', W.scanProject(empty).files.length === 0 && W.buildWiki(W.scanProject(empty), new Map(), AT).has('README.md'));
  const many = path.join(tmp, 'many'); for (let i = 0; i < 14; i++) mk(many, 'mod' + String.fromCharCode(97 + i) + '/x.js', 'function f' + i + '(){}\n'.repeat(i + 1));
  const mm = W.scanProject(many);
  check('limit: 10 modules documented, the rest named', mm.modules.length === 10 && mm.otherModules.length === 4 && /…and 4 smaller/.test(W.readmeDoc(mm, new Map(), AT)));
}

/* ---------- git ---------- */
{
  const g = path.join(tmp, 'gitproj'); mk(g, 'a.js', 'x'); mk(g, '.git/HEAD', 'ref: refs/heads/main\n'); mk(g, '.git/refs/heads/main', 'abcdef1234567890abcdef1234567890abcdef12\n');
  check('git: the commit is read from .git without running git', W.gitSha(g) === 'abcdef1234567890abcdef1234567890abcdef12' && /from commit `abcdef1234`/.test(W.readmeDoc(W.scanProject(g), new Map(), AT)));
  mk(g, '.git/HEAD', 'ref: refs/heads/dev\n'); mk(g, '.git/packed-refs', '# pack\n1111111111111111111111111111111111111111 refs/heads/dev\n');
  check('git: a packed ref works; a detached HEAD works; no repo is fine', W.gitSha(g) === '1111111111111111111111111111111111111111' && (mk(g, '.git/HEAD', '2222222222222222222222222222222222222222\n'), W.gitSha(g)) === '2222222222222222222222222222222222222222' && W.gitSha(path.join(tmp, 'nope')) === '');
}

/* ---------- one sentence per module ---------- */
(async () => {
  const facts = W.moduleFacts(model.modules.find(m => m.name === 'src/routes'));
  check('summary input: names and header comments only — no code', /Module: src\/routes/.test(facts) && /CartRoute/.test(facts) && /Cart endpoints/.test(facts) && !/return 1|this\.items|require\(/.test(facts) && facts.length <= 1200, facts);
  const asked = [];
  let reply = () => 'Handles the cart endpoints.';
  const llm = { complete: async o => { asked.push(o); return typeof reply === 'function' ? reply(o) : reply; } };
  let r = await W.summarize(model, llm, 'qwen');
  check('summaries: one call per module, a low temperature and a small budget; marked as AI', asked.length === 5 && asked.every(o => o.model === 'qwen' && o.temperature <= 0.3 && o.maxTokens <= 80 && /at most 25 words/.test(o.system)) && r.ai === 5 && [...r.summaries.values()].every(s => s.ai === true), r.ai);
  reply = () => 'UNKNOWN'; r = await W.summarize(model, llm, 'q');
  check('summaries: "UNKNOWN" falls back to the header comment (or nothing) and is not marked AI', r.ai === 0 && r.summaries.get('src/routes').text === 'Cart endpoints' && r.summaries.get('src/routes').ai === false && r.summaries.get('ui') === null);
  reply = () => 'x'.repeat(300); r = await W.summarize(model, llm, 'q'); check('summaries: a rambling answer is not used', r.ai === 0);
  reply = () => { throw new Error('model down'); }; r = await W.summarize(model, llm, 'q'); check('summaries: an AI failure falls back, per module, without stopping', r.ai === 0 && r.summaries.size === 5);
  reply = () => '"Serves the shop web pages."'; r = await W.summarize(model, llm, 'q'); check('summaries: wrapping quotes are stripped', r.summaries.get('ui').text === 'Serves the shop web pages.');
  r = await W.summarize(model, null, 'q'); check('summaries: no AI at all works', r.ai === 0 && r.summaries.get('src/routes').text === 'Cart endpoints');

  /* ---------- writing ---------- */
  const out = path.join(tmp, 'out');
  const pages = W.buildWiki(model, summaries, AT);
  fs.mkdirSync(path.join(out, 'modules'), { recursive: true }); fs.writeFileSync(path.join(out, 'modules', 'old-gone.md'), 'stale'); fs.writeFileSync(path.join(out, 'modules', 'my-notes.txt'), 'mine');
  const written = W.writeWiki(out, pages, { project: 'shop' });
  check('write: all pages and the state file are on disk', written.length === pages.size && fs.existsSync(path.join(out, 'README.md')) && fs.existsSync(path.join(out, 'diagrams', 'classes.md')) && JSON.parse(fs.readFileSync(path.join(out, '.wiki-state.json'), 'utf8')).project === 'shop');
  check('write: pages from an earlier run that no longer exist are removed; other files are left alone', !fs.existsSync(path.join(out, 'modules', 'old-gone.md')) && fs.existsSync(path.join(out, 'modules', 'my-notes.txt')));

  /* ---------- the route ---------- */
  const routes = {}, app = { post: (p, h) => { routes[p] = h; } };
  const sandbox = path.join(tmp, 'sandbox'); fs.mkdirSync(sandbox);
  const opened = [], approvals = []; let approve = true;
  W(app, { llm, DEFAULT_MODEL: 'dm', SANDBOX: sandbox, findAllowed: n => (n === 'shop' ? shop : n === 'empty' ? path.join(tmp, 'empty') : null), anyPath: n => (/blocked/.test(n) ? null : path.resolve(n)),
    approvedChange: (req, res, action, ...ps) => { approvals.push([action, ps]); if (!approve) { res.status(409).json({ needsApproval: true }); return false; } return true; }, rel: p => path.relative(tmp, p).split(path.sep).join('/'), openPath: p => opened.push(p) });
  const call = async body => { let out2, code = 200; await routes['/api/project/wiki']({ body }, { json: o => { out2 = o; }, status: c => ({ json: o => { code = c; out2 = o; } }) }); return { code, ...out2 }; };
  asked.length = 0; reply = () => 'Does a thing.';
  let res = await call({ name: 'shop' });
  check('route: wiki written to ~/jarvis/Wikis/<project>, opened, with the counts', res.code === 200 && res.success && res.relDir === 'sandbox/Wikis/shop' && fs.existsSync(path.join(sandbox, 'Wikis', 'shop', 'architecture.md')) && opened.length === 1 && opened[0].endsWith('README.md') && res.modules === 5 && res.sourceFiles === 7 && res.aiSummaries === 5 && res.files.includes('README.md'), res);
  check('route: the AI got the default model and one call per module', asked.length === 5 && asked[0].model === 'dm');
  res = await call({ name: 'shop', ai: false, open: false, model: 'other' }); asked.length = 0;
  check('route: ai:false makes no model call; open:false does not open', res.aiSummaries === 0 && opened.length === 1 && asked.length === 0);
  check('route: the state file records where it came from', JSON.parse(fs.readFileSync(path.join(sandbox, 'Wikis', 'shop', '.wiki-state.json'), 'utf8')).source_path === shop);
  check('route: needs a name', (await call({})).code === 400);
  check('route: unknown project → 404 that says where I looked', (await call({ name: 'nope' })).code === 404 && /~\/jarvis or your project folders/.test((await call({ name: 'nope' })).error));
  check('route: blocked full path → 404', (await call({ name: 'C:\\blocked\\proj' })).code === 404);
  check('route: a whole drive is refused', (await call({ name: path.parse(tmp).root })).code === 400);
  check('route: no source files → 422 with what I look for', (await call({ name: 'empty' })).code === 422 && /node_modules/.test((await call({ name: 'empty' })).error));
  approve = false; approvals.length = 0;
  res = await call({ name: 'shop', into: 'project' });
  check('route: writing into the project asks for approval first and writes nothing when refused', res.code === 409 && approvals[0][0] === 'write the project wiki into' && approvals[0][1][0] === path.join(shop, 'docs', 'wiki') && !fs.existsSync(path.join(shop, 'docs')));
  approve = true; res = await call({ name: 'shop', into: 'project', ai: false, open: false });
  check('route: once approved it writes to <project>/docs/wiki', res.code === 200 && fs.existsSync(path.join(shop, 'docs', 'wiki', 'README.md')));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`projectwiki: ${total - fail}/${total}`);
  process.exitCode = fail ? 1 : 0;
})();
