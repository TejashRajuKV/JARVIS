// Basic accessibility of the page (index.html + the code that names things at start): every control has a name a screen reader can read, the chat is a log,
// and finished replies are announced. A static check of the HTML; the running page is checked in the browser suite. Run: node tests/a11y.test.js
'use strict';
const fs = require('fs'), path = require('path');
const root = f => path.join(__dirname, '..', f);
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const html = fs.readFileSync(root('index.html'), 'utf8');
const script = fs.readFileSync(root('script.js'), 'utf8');

// a settings row: <div class="s-row"><label>NAME<small>…</small></label> …controls… </div>
const rows = [...html.matchAll(/<div class="s-row"[^>]*>([\s\S]*?)<\/div>(?=\s*(?:<div|<\/|<!--|$))/g)].map(m => m[1]);
const named = (attrs, rowHasLabel) => /aria-label=|aria-labelledby=/.test(attrs) || /\bplaceholder=/.test(attrs) || /\btitle=/.test(attrs) || rowHasLabel;

// every switch is in a row with a label (the page copies that label onto the switch when it starts)
const switches = [...html.matchAll(/<button\b[^>]*class="switch[^"]*"[^>]*>/g)].map(m => m[0]);
const switchesNoRow = switches.filter(sw => { const id = (sw.match(/id="([^"]+)"/) || [])[1]; return !rows.some(r => r.includes('id="' + id + '"') && /<label[ >]/.test(r)); });
check('every settings switch sits in a row that has a label (30+ switches)', switches.length >= 30 && switchesNoRow.length === 0, switchesNoRow);
check('role="switch" and aria-checked on every switch', switches.every(sw => /role="switch"/.test(sw) && /aria-checked=/.test(sw)));

// every form control has some name: aria-label, placeholder, title, or a labelled settings row
const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)].filter(m => !/type="(hidden|checkbox)"/.test(m[2]) && !/\shidden(\s|$)/.test(m[2] + ' '));
const unnamed = controls.filter(m => { const id = (m[2].match(/id="([^"]+)"/) || [])[1]; const inRow = id && rows.some(r => r.includes('id="' + id + '"') && /<label[ >]/.test(r)); return !named(m[2], inRow); }).map(m => m[0].slice(0, 100));
check('every visible input / select / textarea has a name (aria-label, placeholder, title, or a labelled row)', unnamed.length === 0, unnamed);
check('every image has alt text', ![...html.matchAll(/<img\b([^>]*)>/gi)].some(m => !/\balt=/.test(m[1])));
const btns = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].filter(m => !/class="switch/.test(m[1]) && !/aria-label=|aria-labelledby=/.test(m[1]) && m[2].replace(/<[^>]+>/g, '').trim().length < 2);
check('every other button has visible text or an aria-label (the two language buttons are labelled "Telugu" and "Kannada")', btns.length === 0 && /aria-label="Telugu"/.test(html) && /aria-label="Kannada"/.test(html), btns.map(m => m[0].slice(0, 80)));

// the conversation
check('the chat is a log region that is not announced word by word', /<div id="messages" role="log"[^>]*aria-live="off"/.test(html));
check('a separate polite live region exists for finished replies, and it is hidden visually only', /<div id="srLive" class="sr-only" aria-live="polite" aria-atomic="true">/.test(html) && /\.sr-only\s*\{[^}]*clip/.test(fs.readFileSync(root('ui.css'), 'utf8')));
check('the page code names switches and controls from their row label at start', /querySelectorAll\('\.s-row'\)[\s\S]{0,900}setAttribute\('aria-label'/.test(script));
check('the page code announces a reply once its text stops changing (never every streamed word)', /function srWatch\(node\)/.test(script) && /stable >= 3/.test(script) && /new MutationObserver\([\s\S]{0,300}srWatch\(n\)/.test(script));
check('history restored at start is not read aloud (announcing waits until 4 seconds after load)', /srReady/.test(script) && /setTimeout\(\(\) => \{ srReady = true; \}, 4000\)/.test(script));
check('the document language is set', /<html[^>]*\blang="en"/.test(html));
check('there is a viewport meta tag and a title', /<meta name="viewport"/.test(html) && /<title>[^<]+<\/title>/.test(html));

console.log(`a11y: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
