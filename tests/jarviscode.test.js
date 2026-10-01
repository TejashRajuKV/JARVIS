// JARVIS Code (jarviscode.js): the AI's answer → files, and paths that must never leave the project folder.
// Run: node tests/jarviscode.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { suite } = require('./lib/server');
const { check, done } = suite('jarviscode');
const { parseFiles, cleanRelPath, projectContext } = require('../jarviscode.js');

const answer = `Building a calculator.
=== FILE: index.html ===
<!DOCTYPE html>
<html><body><div id="app"></div><script src="script.js"></script></body></html>
=== END ===

=== FILE: script.js ===
\`\`\`javascript
const add = (a, b) => a + b;
\`\`\`
=== END ===
=== FILE: ../evil.txt ===
nope
=== END ===
=== FILE: C:\\Windows\\x.dll ===
nope
=== END ===
Open index.html to use it.`;
const files = parseFiles(answer);
check('Parse', 'two good files come out, in order', files.length === 2 && files[0].path === 'index.html' && files[1].path === 'script.js', files.map(f => f.path));
check('Parse', 'whole file content is kept', /<!DOCTYPE html>/.test(files[0].content) && /script\.js/.test(files[0].content));
check('Parse', 'a ``` fence inside a file is unwrapped', files[1].content === 'const add = (a, b) => a + b;\n', JSON.stringify(files[1].content));
check('Parse', 'no markers → no files', parseFiles('Here is some code:\n```js\nx()\n```').length === 0);
const { parseFencedFallback } = require('../jarviscode.js');
const plain = 'Here is your to-do list:\n```html\n<!DOCTYPE html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><ul id="list"></ul></body></html>\n```\nAnd the styles:\n```css\nbody { font-family: sans-serif; margin: 2rem; }\n```\napp.js:\n```javascript\ndocument.getElementById("list").innerHTML = "<li>first</li>";\n```';
const fb = parseFencedFallback(plain);
check('Fallback', 'plain ```html / ```css / ```js blocks still become files (small models skip the markers)', fb.map(f => f.path).join(',') === 'index.html,style.css,app.js', fb.map(f => f.path));
check('Fallback', 'a tiny snippet is not mistaken for a file', parseFencedFallback('Use ```js\nx()\n```').length === 0);

for (const [p, want] of [['src/app.js', 'src/app.js'], ['./style.css', 'style.css'], ['css\\main.css', 'css/main.css'], ['`index.html`', 'index.html'],
  ['../x', null], ['a/../../x', null], ['C:\\x.txt', null], ['/etc/passwd', null], ['node_modules/x.js', null], ['a/b/c/d/e/f/g.js', null], ['bad|name.js', null], ['', null]])
  check('Paths', JSON.stringify(p) + ' → ' + JSON.stringify(want), cleanRelPath(p) === want, cleanRelPath(p));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcode-'));
fs.writeFileSync(path.join(dir, 'index.html'), '<h1>calc</h1>');
fs.mkdirSync(path.join(dir, 'node_modules')); fs.writeFileSync(path.join(dir, 'node_modules', 'big.js'), 'x');
fs.writeFileSync(path.join(dir, 'photo.png'), 'binary');
const c = projectContext(dir, 'make the calculator bigger');
check('Context', 'the file tree skips node_modules', c.tree.includes('index.html') && !c.tree.some(t => /node_modules/.test(t)), c.tree);
check('Context', 'small text files are shown to the AI, pictures are not', c.files.length === 1 && c.files[0].path === 'index.html', c.files.map(f => f.path));
fs.rmSync(dir, { recursive: true, force: true });
done();
