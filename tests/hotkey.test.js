// Global hotkey helper protocol (hotkey.js). Run: node tests/hotkey.test.js
const path = require('path');
const H = require(path.join(__dirname, '..', 'hotkey.js'));
let fail = 0, total = 0;
const check = (n, ok, x) => { total++; if (!ok) { fail++; console.log('FAIL  ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

check('READY', H.parseLine('READY\r').type === 'ready');
check('FAIL', H.parseLine('FAIL').type === 'fail');
check('press with text', JSON.stringify(H.parseLine('PRESS:' + b64('hello world'))) === '{"type":"press","text":"hello world","truncated":false}');
check('press with unicode / newlines', H.parseLine('PRESS:' + b64('తెలుగు\nline two ✓')).text === 'తెలుగు\nline two ✓');
check('press with nothing selected', H.parseLine('PRESS:').text === '');
check('long selections are cut, and flagged', (() => { const p = H.parseLine('PRESS:' + b64('x'.repeat(9000))); return p.text.length === H.MAX_TEXT && p.truncated === true; })());
check('NUL characters stripped', H.parseLine('PRESS:' + b64('a\0b')).text === 'ab');
check('junk lines are ignored (warnings, blank)', H.parseLine('') === null && H.parseLine('WARNING: something') === null && H.parseLine('PRESS:not base64!') === null);
check('the helper waits for the keys to be released before copying', /GetAsyncKeyState\(0x11\)/.test(H.HELPER) && /SendWait\('\^c'\)/.test(H.HELPER));
check('the helper restores the previous clipboard text', /SetText\(\$old\)/.test(H.HELPER));
check('the helper quits when JARVIS does', /JARVIS_PPID/.test(H.HELPER));
check('hotkey is Ctrl+Shift+J without auto-repeat', /RegisterHotKey\(\[IntPtr\]::Zero, 1, 0x4006, 0x4A\)/.test(H.HELPER));

console.log(`hotkey: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
