// Classifier regression tests. Run: node tests/nlu.test.js
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'nlu.js'), 'utf8') + ';global.NLU=NLU;');

const CASES = [
  // core commands
  ['yo can u fire up crome pls', 'OPEN_APPLICATION'], ['hey jarvis open spotfy', 'OPEN_APPLICATION'], ['close it', 'CONTEXT_CLOSE'],
  ["how's my battery doing", 'SYS_BATTERY'], ["what's thirty times 12", 'CALCULATE'], ['set a timer for half a minute', 'SET_TIMER'],
  ['remind me to call mom at 6pm', 'REMIND'], ['remind me every day at 9pm to revise', 'REMIND'], ['add milk to my shopping list', 'ADD_TODO'],
  ["what's on my to do list", 'LIST_TODOS'], ['mark 2 as done', 'DONE_TODO'], ['add assignment DBMS lab due friday', 'ADD_DEADLINE'],
  ['add class OS on monday at 10am', 'ADD_CLASS'], ['whats my next class', 'NEXT_CLASS'], ['start a focus session', 'FOCUS_START'],
  ['255 to binary', 'BASE_CONVERT'], ['1.5 gb to mb', 'DATA_SIZE'], ['100 f to c', 'UNIT_CONVERT'], ['12 xor 7', 'BITWISE'],
  ['play lofi beats on youtube', 'YOUTUBE'], ['open amazon.com', 'OPEN_URL'], ['OPEN SIH 2026 PROBLEM STATEMENTS', 'OPEN_WEB'],
  ['search stack overflow for segfault', 'SITE_SEARCH'], ['whats the weather in bangalore', 'WEATHER'], ['what is the weather in manali', 'WEATHER'],
  ['open', 'ASK_WHAT'], ['launch', 'ASK_WHAT'], ['what is the weather like on mars', 'CONVERSATION'], ['temperature of the sun', 'CONVERSATION'],
  ['how is the climate in mysore today', 'WEATHER'], ['hows it outside', 'WEATHER'], ['what is climate change', 'CONVERSATION'], ['explain the climate of india', 'CONVERSATION'], ['what is a deadlock', 'CONVERSATION'],
  ['take a note: revise trees', 'NOTE_APPEND'], ['list my files', 'LIST_FILES'], ['lock the screen', 'SYS_LOCK'], ["what's my ip", 'SYS_NETWORK'],
  ['check whether DSA sprint folder exists', 'CHECK_EXISTS'], ['does the notes file exist', 'CHECK_EXISTS'], ['is there a folder called dsa', 'CHECK_EXISTS'],
  ['do I have a file called bfs.py', 'CHECK_EXISTS'], ['check off milk', 'DONE_TODO'], ['mark 2 as done', 'DONE_TODO'],
  ['git status', 'GIT_STATUS'], ['is port 3000 free', 'CHECK_PORT'], ['give me my briefing', 'BRIEFING'], ['volume up', 'VOLUME_UP'],
  ['mute', 'VOLUME_MUTE'], ['next song', 'MEDIA_NEXT'], ['take a screenshot', 'SCREENSHOT'], ['show desktop', 'SHOW_DESKTOP'],
  ['save that code as bfs.py', 'SAVE_CODE'], ['run bfs.py', 'RUN_FILE'], ['open it in vs code', 'OPEN_IN_EDITOR'], ['upcoming contests', 'CONTESTS'],
  ['make flashcards on normalization', 'FLASH_MAKE'], ['plan my day', 'PLAN_DAY'], ['block distractions', 'BLOCK_DISTRACTIONS'],
  ['HI JARVIS ARE YOU THERE', 'PRESENCE'], ['jarvis?', 'PRESENCE'], ['good job', 'PRAISE'], ["i'm home", 'HOME'], ['thanks jarvis', 'THANKS'],
  // routines
  ['create a routine called exam prep: open vs code, open leetcode, start a 45 minute focus session', 'ROUTINE_CREATE'],
  ['make a routine called gaming that opens steam and discord', 'ROUTINE_CREATE'],
  ['list my routines', 'ROUTINE_LIST'], ['delete the bedtime routine', 'ROUTINE_DELETE'],
  ['run my morning routine every day at 7am', 'ROUTINE_SCHEDULE'], ['run the exam prep routine', 'ROUTINE_RUN'],
  // themes / persona / diagnostics
  ['switch to the gold theme', 'THEME_SET'], ['red alert', 'THEME_SET'], ['change the hud colour to violet', 'THEME_SET'], ['stand down alert', 'THEME_SET'],
  ['switch to friday', 'PERSONA_SET'], ['bring jarvis back', 'PERSONA_SET'], ['friday take over', 'PERSONA_SET'],
  ['run diagnostics', 'DIAGNOSTICS'], ['systems check', 'DIAGNOSTICS'], ['suit status', 'DIAGNOSTICS'], ['how is my system doing', 'SYS_ALL'],
  // screen reading
  ['read my screen', 'SCREEN_READ'], ["what's on my screen", 'SCREEN_READ'], ['explain the error on my screen', 'SCREEN_EXPLAIN'],
  ['summarise what is on my screen', 'SCREEN_EXPLAIN'], ['read the image I copied', 'CLIPBOARD_IMAGE_READ'], ['explain the error in the image I copied', 'CLIPBOARD_IMAGE_READ'],
  // laptop controls
  ['set brightness to 50', 'BRIGHTNESS'], ['make it brighter', 'BRIGHTNESS'], ['dim the screen', 'BRIGHTNESS'],
  ['turn on dark mode', 'DARK_MODE'], ['switch to light mode', 'DARK_MODE'],
  ['turn off bluetooth', 'RADIO'], ['is my wifi on', 'RADIO'], ['bluetooth on', 'RADIO'],
  ['switch to power saver', 'POWER_PLAN'], ['which power plan am i on', 'POWER_PLAN'],
  ['set volume to 40', 'VOLUME_SET'], ["what's the volume", 'VOLUME_SET'],
  ['increase volume up to 100', 'VOLUME_SET'], ['increase volume upto 100', 'VOLUME_SET'], ['increase the volume upto 80 percent', 'VOLUME_SET'],
  ['raise the volume to 90', 'VOLUME_SET'], ['crank the volume up to 70', 'VOLUME_SET'], ['increase the volume', 'VOLUME_UP'],
  ['set volume 60', 'VOLUME_SET'], ['make the volume 30', 'VOLUME_SET'], ['crank it up to 77', 'VOLUME_SET'], ['turn it up to 65', 'VOLUME_SET'],
  ['decrease the sound to 10', 'VOLUME_SET'], ['bring the volume down to 40', 'VOLUME_SET'], ['reduce volume to 20', 'VOLUME_SET'],
  ['set volume to max', 'VOLUME_SET'], ['set volume to full', 'VOLUME_SET'], ['set the volume to maximum', 'VOLUME_SET'], ['set volume to zero', 'VOLUME_SET'],
  ['turn off the display', 'DISPLAY_OFF'], ['screen off', 'DISPLAY_OFF'],
  ['put vs code on the left and chrome on the right', 'WINDOW_LAYOUT'], ['maximize chrome', 'WINDOW_LAYOUT'],
  ['minimize everything except vs code', 'WINDOW_LAYOUT'], ['minimize everything', 'SHOW_DESKTOP'],
  ['start clipboard history', 'CLIP_HISTORY'], ['what did i copy earlier', 'CLIP_HISTORY'], ['copy the 3rd one', 'CLIP_HISTORY'],
  ["what's in my clipboard", 'READ_CLIPBOARD'],
  // typos and slang (fixed list + fuzzy second pass)
  ['wats the tym', 'GET_TIME'], ['set timr 5 min', 'SET_TIMER'], ['remnd me call mom 6pm', 'REMIND'], ['take screnshot', 'SCREENSHOT'],
  ['lok screen', 'SYS_LOCK'], ['add finsh assignmnt to todo', 'ADD_TODO'], ['brightnes up', 'BRIGHTNESS'], ['bluetooh off', 'RADIO'],
  ['strt focus', 'FOCUS_START'], ['reed my screen', 'SCREEN_READ'], ['dark mod on', 'DARK_MODE'], ['hru jarvis', 'HOW_ARE_YOU'],
  ['stop timr', 'CANCEL_TIMERS'], ['opn crome pls', 'OPEN_APPLICATION'], ['thanks ra', 'THANKS'],
  ['clse chrome', 'CLOSE_APPLICATION'], ['googl best laptops', 'WEB_SEARCH'], ['cancle the timer', 'CANCEL_TIMERS'], ['tel me a joke', 'JOKE'],
  ['turn of bluetooth', 'RADIO'], ['dark mode of', 'DARK_MODE'], ['chrome', 'OPEN_APPLICATION'],
  ['turn off the timer', 'CANCEL_TIMERS'], ['add completing my to-do list assignment', 'ADD_TODO'],
  ['what assignments are due', 'LIST_DEADLINES'],
  // distance / directions
  ['distance from Hyderabad to Bangalore', 'DISTANCE'], ['how far is Paris from London', 'DISTANCE'], ['distance between Delhi and Mumbai', 'DISTANCE'],
  ['directions from Hyderabad to Bangalore', 'DIRECTIONS'], ['directions to Bangalore', 'DIRECTIONS'], ['how do i get to the airport', 'DIRECTIONS'], ['navigate to the station', 'DIRECTIONS'],
  // natural phrasing, no "directions"/"route" keyword at all — this is the bug the user hit live
  ['i need to go from hyderabad to bangalore', 'DIRECTIONS'], ['i want to go to mumbai', 'DIRECTIONS'], ['how do i go from bangalore to mysore', 'DIRECTIONS'],
  ['take me to the airport', 'DIRECTIONS'], ['take me from delhi to agra', 'DIRECTIONS'],
  ['I want to travel from Hyderabad to Bangalore', 'DIRECTIONS'], ['I am planning a trip from Delhi to Agra', 'DIRECTIONS'],
  ['how can I reach Mumbai from Pune', 'DIRECTIONS'], ['how do I reach the airport', 'DIRECTIONS'], ['guide me to the railway station', 'DIRECTIONS'],
  ['show me how to get to the stadium', 'DIRECTIONS'], ['which way to the hospital', 'DIRECTIONS'], ['get me to the airport', 'DIRECTIONS'],
  ['drive me to the station', 'DIRECTIONS'], ['plan a road trip to manali', 'DIRECTIONS'], ['whats the fastest way to reach the airport', 'DIRECTIONS'],
  ['how to reach the temple', 'DIRECTIONS'], ['how to get to the museum', 'DIRECTIONS'], ['traveling to Jaipur from Delhi', 'DIRECTIONS'],
  ['how long to drive from Bangalore to Chennai', 'DISTANCE'], ['how many km from Delhi to Jaipur', 'DISTANCE'], ['is Mysore far from Bangalore', 'DISTANCE'],
  ['whats the travel time from Pune to Mumbai', 'DISTANCE'], ['how many kilometers between Delhi and Agra', 'DISTANCE'], ['km from Hyderabad to Vijayawada', 'DISTANCE'],
  ['guide me to Mysore from Bangalore', 'DIRECTIONS'], ['I need to reach Pune from Mumbai', 'DIRECTIONS'], ['plan a trip to Manali from Delhi', 'DIRECTIONS'],
  // idioms that must NOT be read as travel requests
  ['how do i reach out to customer support', 'CONVERSATION'], ['how can i reach out to him', 'CONVERSATION'], ['I need to reach out to someone', 'CONVERSATION'],
  ['open directions to Bangalore in maps', 'DIRECTIONS_OPEN'], ['show me directions to airport on google maps', 'DIRECTIONS_OPEN'],
  // must not collide with the existing "open maps" bookmark or generic site search
  ['open maps', 'OPEN_APPLICATION'], ['open google maps', 'OPEN_APPLICATION'], ['search maps for coffee shops', 'SITE_SEARCH'],
  // command learning
  ['what have you learned', 'LEARN_LIST'], ["list what you've learned", 'LEARN_LIST'], ['show me my learned commands', 'LEARN_LIST'],
  ['what have you learnt', 'LEARN_LIST'], ['forget everything you have learnt', 'LEARN_FORGET_ALL'],
  ["forget everything you've learned", 'LEARN_FORGET_ALL'], ['forget everything you have learned', 'LEARN_FORGET_ALL'], ['clear your learned commands', 'LEARN_FORGET_ALL'],
  // must not be swallowed by the (broader, later-checked) personal-memory rules
  ['forget my nickname', 'FORGET'], ['what do you remember about me', 'RECALL_ALL'], ['show my memories', 'RECALL_ALL'],
  // an app name inside another request must not launch the app
  ['uninstall discord', 'CONVERSATION'], ['update whatsapp', 'CONVERSATION'], ['discord please', 'OPEN_APPLICATION'], ['clear all my to-dos', 'CLEAR_TODOS'], ['any homework due tomorrow', 'LIST_DEADLINES'], ['my project is due on monday', 'ADD_DEADLINE'],
  ['add finish the assignment to my to-do list', 'ADD_TODO'], ['finish the assignment and add it to my to-do list', 'ADD_TODO'],
  // real words must not be "corrected" into commands
  ['the clock is wrong', 'CONVERSATION'], ['look at this', 'CONVERSATION'], ['tell me about tigers', 'CONVERSATION'],
  // dev projects
  ['locate my agriloop project', 'LOCATE_PROJECT'], ['find the agriloop folder', 'LOCATE_PROJECT'], ["where's my agriloop project", 'LOCATE_PROJECT'],
  ['start the agriloop backend', 'START_PROCESS'], ["start agriloop's frontend", 'START_PROCESS'], ['start the agriloop server', 'START_PROCESS'],
  ['stop the agriloop backend', 'STOP_PROCESS'], ["stop agriloop's frontend", 'STOP_PROCESS'],
  // these must not be swallowed by the new project rules
  ['start a focus session', 'FOCUS_START'], ['start vs code', 'OPEN_APPLICATION'], ['stop the timer', 'CANCEL_TIMERS'],
  // charger announcements (must not steal trigger routines or battery questions)
  ['tell me when the charger is connected', 'CHARGER_ALERTS'], ['stop charger announcements', 'CHARGER_ALERTS'],
  ['turn on charger alerts', 'CHARGER_ALERTS'], ['announce when my charger is unplugged', 'CHARGER_ALERTS'],
  ['when i plug in my charger start study mode', 'TRIGGER_CREATE'], ['am i charging', 'SYS_BATTERY'],
  // file creation with a file-type word ("html file", "python file") is still file creation
  ['create a html file called calculator.html', 'WRITE_FILE'], ['create a new python file called calc.py', 'WRITE_FILE'],
  ['create a python file in that folder with all calculator operations', 'WRITE_FILE'],
  ['create a folder called test folder in desktop', 'CREATE_FOLDER'], ['make a test folder', 'CREATE_FOLDER'],
];
// Telugu / Kannada typed in English letters: [text, language, intent after fromRoman]
const ROMAN = [
  ['chrome open cheyyi', 'te', 'OPEN_APPLICATION'], ['spotify close maadi', 'kn', 'CLOSE_APPLICATION'], ['time entha', 'te', 'GET_TIME'],
  ['ivattu date enu', 'kn', 'GET_DATE'], ['5 nimishalu timer pettu', 'te', 'SET_TIMER'], ['5 nimisha timer idu', 'kn', 'SET_TIMER'],
  ['6 ki amma ki call cheyyamani gurthu cheyyi', 'te', 'REMIND'], ['6 ge amma ge call maadoke nenapisu', 'kn', 'REMIND'],
  ['volume penchu', 'te', 'VOLUME_UP'], ['volume kammi maadu', 'kn', 'VOLUME_DOWN'], ['mute cheyyi', 'te', 'VOLUME_MUTE'],
  ['battery entha undi', 'te', 'SYS_BATTERY'], ['weather hegide', 'kn', 'WEATHER'], ['oka joke cheppu', 'te', 'JOKE'], ['ondu joke helu', 'kn', 'JOKE'],
  ['screenshot tegi', 'kn', 'SCREENSHOT'], ['laptop lock cheyyi', 'te', 'SYS_LOCK'], ['youtube lo believer song play cheyyi', 'te', 'YOUTUBE'],
  ['youtube alli believer song haaku', 'kn', 'YOUTUBE'], ['todo list lo assignment add cheyyi', 'te', 'ADD_TODO'], ['nanna todo list torisu', 'kn', 'LIST_TODOS'],
  ['brightness jaasti maadu', 'kn', 'BRIGHTNESS'], ['bluetooth off cheyyi', 'te', 'RADIO'], ['focus session shuru maadu', 'kn', 'FOCUS_START'],
  ['system ela undi', 'te', 'SYS_ALL'], ['system hegide', 'kn', 'SYS_ALL'], ['google lo best laptops vethuku', 'te', 'SITE_SEARCH'],
  ['nanna screen odu', 'kn', 'SCREEN_READ'], ['dark mode on cheyyi', 'te', 'DARK_MODE'], ['ela unnav', 'te', 'HOW_ARE_YOU'], ['hegiddiya', 'kn', 'HOW_ARE_YOU'],
  ['25 into 4 entha', 'te', 'CALCULATE'], ['gold theme haaku', 'kn', 'THEME_SET'], ['briefing kodu', 'kn', 'BRIEFING'], ['timers cancel cheyyi', 'te', 'CANCEL_TIMERS'],
  ['recursion ante enti', 'te', 'CONVERSATION'],
];

// ---- Strengthening: negation rewriting ----
// "don't open chrome" → CLOSE_APPLICATION (rewritten to "close chrome")
// Each entry: [input, expectedIntent, optionalNegatedFlag]
const NEGATION_CASES = [
  ["don't open chrome", 'CLOSE_APPLICATION', true],
  ['do not open chrome', 'CLOSE_APPLICATION', true],
  ['never open spotify', 'CLOSE_APPLICATION', true],
  ['stop opening discord', 'CLOSE_APPLICATION', true],   // -ing form
  ["don't launch firefox", 'CLOSE_APPLICATION', true],
  ['never start zoom', 'CLOSE_APPLICATION', true],
  ["don't run vs code", 'CLOSE_APPLICATION', true],
  // Without negation — control cases that should NOT be rewritten
  ['open chrome', 'OPEN_APPLICATION', false],
  ['close chrome', 'CLOSE_APPLICATION', false],
];

// ---- Strengthening: fuzzy fix should also re-check medium-confidence matches ----
// These are commands where the original first-pass produced a less-confident match
// (the old code only re-checked on bare/CONVERSATION). They should still work.
const FUZZY_STRENGTHEN_CASES = [
  // (existing typos like 'crome', 'spotfy' already covered — these test the new path)
  ['opn notepad', 'OPEN_APPLICATION'],          // typo in the verb
  ['clse calculator', 'CLOSE_APPLICATION'],     // typo in the verb
  ['opn the calculator', 'OPEN_APPLICATION'],
];
// English that must never be read as Telugu/Kannada.
const NOT_ROMAN = ['I love lo-fi music', 'open vs code ide', 'what is the time', 'add milk to my list', 'set a reminder for tmr', 'play kannada songs', 'who is odu'];

let fail = 0;
for (const [text, want] of CASES) {
  const got = NLU.classify(NLU.normalize(text, 'jarvis'), {}).intent;
  if (got !== want) { fail++; console.log(`FAIL  ${text.padEnd(62)} got ${got}, want ${want}`); }
}
// Strengthening: negation rewriting tests
for (const [text, want, expectNegated] of NEGATION_CASES) {
  const r = NLU.classify(NLU.normalize(text, 'jarvis'), {});
  if (r.intent !== want) { fail++; console.log(`FAIL  [negation] ${text.padEnd(62)} got ${r.intent}, want ${want}`); continue; }
  if (expectNegated === true && !r._negated) { fail++; console.log(`FAIL  [negation] ${text.padEnd(62)} should have _negated=true but did not`); }
  if (expectNegated === false && r._negated === true) { fail++; console.log(`FAIL  [negation] ${text.padEnd(62)} should NOT have _negated=true but does`); }
}
// Strengthening: fuzzy fix on medium-confidence matches
for (const [text, want] of FUZZY_STRENGTHEN_CASES) {
  const r = NLU.classify(NLU.normalize(text, 'jarvis'), {});
  if (r.intent !== want) { fail++; console.log(`FAIL  [fuzzy] ${text.padEnd(62)} got ${r.intent}, want ${want}`); }
}
for (const [text, lang, want] of ROMAN) {
  const l = NLU.romanLang(text);
  const got = l ? NLU.classify(NLU.normalize(NLU.fromRoman(text, l), 'jarvis'), {}).intent : 'not detected';
  if (l !== lang || got !== want) { fail++; console.log(`FAIL  ${text.padEnd(62)} got ${l}/${got}, want ${lang}/${want}`); }
}
// "who is odu" may be flagged at the loose threshold, but it is not a command, so handleUser ignores it (it needs score ≥ 3 then).
for (const text of NOT_ROMAN) if (NLU.romanLang(text, 3)) { fail++; console.log(`FAIL  ${text.padEnd(62)} wrongly read as Telugu/Kannada`); }
const total = CASES.length + ROMAN.length + NOT_ROMAN.length + NEGATION_CASES.length + FUZZY_STRENGTHEN_CASES.length;
console.log(`${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
