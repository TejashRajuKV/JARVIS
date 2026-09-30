// Installed-app matching tests: Start-menu apps open by name, without stealing website or fixed-app phrases.
// Run: node tests/apps.test.js
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'nlu.js'), 'utf8') + ';global.NLU=NLU;');

NLU.setInstalledApps(['Canva', 'Telegram Desktop', 'GitHub Desktop', 'Docker Desktop', 'MySQL Workbench 8.0 CE', 'Arduino IDE', 'Photos', 'Mail',
  'Reddit', 'Google Chrome', 'Visual Studio Code', 'Zoom Workplace', 'Epic Games Launcher', 'Python 3.12 (64-bit)', 'Character Map', 'Run']);

let fail = 0, total = 0;
const route = t => { const n = NLU.normalize(t, 'jarvis'); const p = NLU.classify(n, {}); const a = NLU.findApp(n.text); return { intent: p.intent, app: a && a.k, site: (NLU.findSite(n.text) || {}).n }; };
const check = (t, test, desc) => { total++; const r = route(t); if (!test(r)) { fail++; console.log(`FAIL  ${t.padEnd(30)} ${desc} — got ${JSON.stringify(r)}`); } };

check('open canva', r => r.intent === 'OPEN_APPLICATION' && r.app === 'app:canva', 'installed app opens (not canva.com)');
check('canva', r => r.intent === 'OPEN_APPLICATION' && r.app === 'app:canva', 'bare installed app name');
check('open telegram', r => r.app === 'app:telegram desktop', 'short alias without "Desktop"');
check('open mysql workbench', r => r.app === 'app:mysql workbench 8.0 ce', 'short alias without version');
check('open arduino', r => r.app === 'app:arduino ide', 'short alias without "IDE"');
check('open github desktop', r => r.intent === 'OPEN_APPLICATION' && r.app === 'app:github desktop', 'app, not the Desktop folder');
check('open github', r => !r.app && r.site === 'GitHub', 'the website still wins over "GitHub Desktop"');
check('open mail', r => !r.app || !/^app:/.test(r.app), 'site/fixed names never become an installed alias');
check('open reddit', r => !r.app || !/^app:/.test(r.app), 'site name wins over a same-named app');
check('open chrome', r => r.app === 'chrome', 'fixed list wins');
check('open vs code', r => r.app === 'vscode', 'fixed list wins');
check('open zoom', r => r.app === 'zoom', 'fixed zoom, not "Zoom Workplace"');
check('open photos', r => r.intent === 'OPEN_KNOWN_FOLDER', 'single-word folder name keeps opening the folder');
check('close telegram', r => r.intent === 'CLOSE_APPLICATION' && r.app === 'app:telegram desktop', 'close resolves installed apps too');
check('open canvaa', r => r.app !== 'app:canva', 'no typo-guessing for installed apps');
check('open character map', r => r.app === 'app:character map', 'multi-word app name');
check('uninstall canva', r => r.intent !== 'OPEN_APPLICATION', '"uninstall X" must never open X');

console.log(`apps: ${total - fail}/${total}`);
process.exitCode = fail ? 1 : 0;
