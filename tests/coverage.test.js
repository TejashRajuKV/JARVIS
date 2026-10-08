// Coverage: every command JARVIS understands (every intent in nlu.js) has phrases here that must reach it, in the same
// order script.js checks things (routines first, then the rules). A gate fails the suite when an intent has no phrases,
// so a new command can't ship untested. Also the feature list used by tests/report.js. Run: node tests/coverage.test.js
'use strict';
const fs = require('fs'), path = require('path');
const { suite, ROOT } = require('./lib/server');
eval(fs.readFileSync(path.join(ROOT, 'nlu.js'), 'utf8') + ';global.NLU=NLU;');
global.settings = { wakeWord: 'jarvis', focusMin: 25 };
global.store = { get: (k, d) => d, set: () => {} };
global.$ = () => null;
global.cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
eval(fs.readFileSync(path.join(ROOT, 'routines.js'), 'utf8') + ';global.Routines=Routines;');
const { check, done } = suite('coverage');

// [area, intent, phrases]. The area groups the report like the README.
const FEATURES = [
  // ---- conversation & persona
  ['Chat', 'GREETING', ['hello', 'good morning']], ['Chat', 'GOODNIGHT', ['good night', 'going to sleep']],
  ['Chat', 'HOME', ["i'm home", 'back again']], ['Chat', 'PRAISE', ['well done', "you're awesome"]],
  ['Chat', 'INSULT', ["you're useless", 'shut up']], ['Chat', 'HOW_ARE_YOU', ['how are you', "how's it going"]],
  ['Chat', 'IDENTITY', ['who are you', 'introduce yourself']], ['Chat', 'JOKE', ['tell me a joke', 'make me laugh']],
  ['Chat', 'THANKS', ['thanks', 'thank you so much']], ['Chat', 'GOODBYE', ['bye', 'see you']],
  ['Chat', 'HELP', ['what can you do', 'help']], ['Chat', 'PERSONA_SET', ['switch to friday', 'switch back to jarvis']],
  ['Chat', 'THEME_SET', ['switch to gold theme', 'change the hud colour to violet']],
  ['Chat', 'CHAT_MEMORY', ['what were we talking about', 'where were we']],
  ['Chat', 'REGENERATE', ['regenerate', 'give me a different answer']], ['Chat', 'DELETE_LAST_MSG', ['delete my last message', 'unsend that']],
  ['Chat', 'GET_TIME', ['what time is it', 'current time']], ['Chat', 'GET_DATE', ["what's the date today", 'which day is it']],
  ['Chat', 'BRIEFING', ['give me my briefing', 'morning report']],
  // ---- memory & learning
  ['Memory', 'RECALL_NAME', ["what's my name", 'do you know my name']], ['Memory', 'SET_NAME', ['my name is tejas', 'call me boss']],
  ['Memory', 'RECALL_ALL', ['what do you remember about me', 'show my memories']], ['Memory', 'FORGET', ['forget that i like tea', 'delete memory 2']],
  ['Memory', 'REMEMBER', ['remember that my exam is in december', 'keep in mind i use linux']],
  ['Memory', 'SET_CITY', ['my city is bengaluru', 'i live in hyderabad']],
  ['Memory', 'LEARN_LIST', ['what have you learned', 'show my taught commands']], ['Memory', 'LEARN_FORGET_ALL', ["forget everything you've learned", 'clear learned commands']],
  ['Memory', 'MISSES_LIST', ["what didn't you understand", 'show missed phrases']],
  ['Memory', 'WHY_ACTION', ['why did you do that', 'why was that permission needed']],
  ['Memory', 'AGENT_HISTORY', ['what did you just do', 'show my last runs']],
  ['Memory', 'AGENT_INSPECT', ['inspect the last run', 'inspect agt-20260930-021', 'show run details']],
  ['Laptop', 'UNDO_TASK', ['undo that task', 'undo the whole plan', 'roll back the last task', 'undo everything you just did']],
  // ---- laptop
  ['Laptop', 'OPEN_APPLICATION', ['open chrome', 'launch vs code', 'go to leetcode', 'Open the Smart India hackathon website', 'open sih website', 'open the official leetcode website']], ['Laptop', 'CLOSE_APPLICATION', ['close chrome', 'quit spotify']],
  ['Laptop', 'CONTEXT_CLOSE', ['close it', 'kill that']],
  ['Laptop', 'VOLUME_SET', ['set volume to 30', 'volume 30']], ['Laptop', 'VOLUME_UP', ['volume up', 'louder']],
  ['Laptop', 'VOLUME_DOWN', ['volume down', 'too loud']], ['Laptop', 'VOLUME_MUTE', ['mute', 'unmute']],
  ['Laptop', 'BRIGHTNESS', ['set brightness to 50', 'dim the screen']], ['Laptop', 'DARK_MODE', ['dark mode', 'switch windows to light']],
  ['Laptop', 'RADIO', ['turn off bluetooth', 'wifi on']], ['Laptop', 'POWER_PLAN', ['battery saver', 'high performance mode']],
  ['Laptop', 'DISPLAY_OFF', ['turn off the display', 'switch off the screen']], ['Laptop', 'WINDOW_LAYOUT', ['snap chrome to the left', 'maximize chrome']],
  ['Laptop', 'SHOW_DESKTOP', ['show desktop', 'minimize everything']], ['Laptop', 'OPEN_KNOWN_FOLDER', ['open downloads', 'open my pictures']],
  ['Laptop', 'SCREENSHOT', ['take a screenshot', 'capture my screen']], ['Laptop', 'SCREEN_READ', ['read my screen', "what's on my screen"]],
  ['Laptop', 'SCREEN_EXPLAIN', ['explain the error on my screen', "what's wrong with the code on my screen", 'analyse my second tab', 'what is in my browser', 'explain this web page']],
  ['Laptop', 'SYS_LOCK', ['lock the screen', 'lock my laptop']], ['Laptop', 'SYS_SLEEP', ['sleep', 'put the computer to sleep']],
  ['Laptop', 'SYS_SHUTDOWN', ['shut down', 'turn off the computer']], ['Laptop', 'SYS_RESTART', ['restart', 'reboot the laptop']],
  ['Laptop', 'SYS_CANCEL_SHUTDOWN', ['cancel the shutdown', "don't restart"]],
  ['Laptop', 'SYS_BATTERY', ['battery', 'am i charging']], ['Laptop', 'CHARGER_ALERTS', ['tell me when the charger is connected', 'stop charger announcements']], ['Laptop', 'SYS_CPU', ['cpu usage', 'how busy is the processor']],
  ['Laptop', 'SYS_RAM', ['ram usage', 'how much memory is free']], ['Laptop', 'SYS_DISK', ['disk space', 'how much storage is left']],
  ['Laptop', 'SYS_OS', ['what os am i on', 'windows version']], ['Laptop', 'SYS_ALL', ['system info', "how's my laptop doing"]],
  ['Laptop', 'SYS_NETWORK', ["what's my ip", 'which wifi am i connected to']], ['Laptop', 'SYS_PROCESSES', ["what's running", "what's eating my ram"]],
  ['Laptop', 'SYSTEM_STATE', ['system status', 'status']], ['Laptop', 'DIAGNOSTICS', ['run diagnostics', 'system check']],
  ['Laptop', 'MEDIA_PLAY', ['pause', 'resume the music']], ['Laptop', 'MEDIA_NEXT', ['next song', 'skip']],
  ['Laptop', 'MEDIA_PREV', ['previous song', 'go back a track']], ['Laptop', 'MEDIA_STOP', ['stop the music', 'stop playback']],
  ['Laptop', 'PANIC_ON', ['panic', 'stop everything']], ['Laptop', 'PANIC_OFF', ['resume', 'all clear']],
  ['Laptop', 'UNDO', ['undo', 'undo that']], ['Laptop', 'BACKUP', ['back up my data', 'export all my data']],
  // ---- clipboard
  ['Clipboard', 'READ_CLIPBOARD', ["what's in my clipboard", 'clipboard']], ['Clipboard', 'WRITE_CLIPBOARD', ['copy hello world to the clipboard', 'put my email to the clipboard']],
  ['Clipboard', 'CLIP_HISTORY', ['clipboard history', 'what did i copy earlier']],
  ['Clipboard', 'CLIP_TOOL', ['format the json in my clipboard', 'make my clipboard uppercase']],
  ['Clipboard', 'CLIP_TRANSFORM', ['convert the copied code to python', 'add comments to the code in my clipboard']],
  ['Clipboard', 'EXPLAIN_CLIPBOARD', ['explain the code in my clipboard', 'debug what i copied']],
  ['Clipboard', 'CLIPBOARD_IMAGE_READ', ['read the text from the image in my clipboard', 'ocr my clipboard image']],
  ['Clipboard', 'CLIPBOARD_TO_FILE', ['save my clipboard to notes.md', 'paste what i copied into todo.txt']],
  ['Clipboard', 'SUMMARISE_LINK', ['summarise the link in my clipboard', 'tldr https://example.com/post']],
  ['Clipboard', 'COPY_CONTENT', ['copy that', 'copy the code']], ['Clipboard', 'PASTE_TO_EDITOR', ['paste it in vs code', 'type it out for me']],
  // ---- files
  ['Files', 'WRITE_FILE', ['create a file called ideas', 'make a new note']], ['Files', 'NOTE_APPEND', ['take a note: buy pens', 'note down call the warden']],
  ['Files', 'READ_FILE', ['read my notes', 'open notes.md']], ['Files', 'LIST_FILES', ['list my files', "what's in the sandbox"]],
  ['Files', 'SEARCH_FILES', ['find the file about graphs', 'search for my notes']], ['Files', 'CREATE_FOLDER', ['create a folder called dsa', 'make a new folder']], ['Files', 'COUNT_FOLDERS', ['how many folders are on my laptop', 'list number of folders in my laptop']], ['Files', 'RECENT_FILES', ['what is the latest file in my project', 'which files did i change recently']], ['Laptop', 'TOOL_VERSION', ['what version of node am i running', 'check git version']], ['Safety', 'LOCK_JARVIS', ['lock jarvis', 'lock yourself']],
  ['Files', 'RENAME_FILE', ['rename notes.md to dbms.md', 'rename that']], ['Files', 'COPY_FILE', ['copy notes.md to backup', 'duplicate a.txt to b.txt']],
  ['Files', 'MOVE_FILE', ['move notes.md to archive', 'move report into done']], ['Files', 'DELETE_ITEM', ['delete the file old.txt', 'delete old.txt']],
  ['Files', 'DESTRUCTIVE', ['delete all my files', 'format my drive']], ['Files', 'CHECK_EXISTS', ['check if notes.md exists', 'does dsa exist', 'check whether DSS print folder exist in my laptop']],
  ['Files', 'OPEN_FOLDER', ['open the projects folder', 'open my documents folder']],
  ['Files', 'ASK_FILES', ['what does unit2.pdf say about 3NF?', 'explain deadlock according to my notes']],
  ['Files', 'SUMMARISE_FILE', ['summarise notes.md', 'give me a summary of lecture3.pdf']],
  ['Files', 'SAVE_CODE', ['save that code as bfs.py', 'save the program as main.c']],
  ['Files', 'WRITE_AND_SAVE', ['write a bubble sort in python and save it as sort.py', 'write a hello world and save it to hello.c']],
  // ---- study
  ['Study', 'ADD_TODO', ['add milk to my to-do list', 'new task: finish the lab record']], ['Study', 'LIST_TODOS', ['show my to-do list', 'what are my tasks']],
  ['Study', 'DONE_TODO', ['mark 2 as done', 'tick 1']], ['Study', 'CLEAR_TODOS', ['clear completed tasks', 'clear my to-do list']],
  ['Study', 'REMIND', ['remind me to call mom at 6pm', 'set a reminder for 7am to wake up']], ['Study', 'LIST_REMINDERS', ['what are my reminders', 'reminders']],
  ['Study', 'SET_TIMER', ['set a timer for 10 minutes', 'timer 5 min']], ['Study', 'CANCEL_TIMERS', ['cancel all timers', 'stop the timer']],
  ['Study', 'FOCUS_START', ['start a focus session', 'start a 45-minute session']], ['Study', 'FOCUS_STOP', ['stop the focus session', 'stop studying']],
  ['Study', 'BLOCK_DISTRACTIONS', ['block distractions', 'close distracting apps']],
  ['Study', 'ADD_DEADLINE', ['add assignment os lab record due friday', 'i have a dbms quiz on monday']],
  ['Study', 'LIST_DEADLINES', ["what's due this week", 'deadlines']],
  ['Study', 'ADD_CLASS', ['add class dbms on monday at 10am', 'add class os on tuesday at 11am']],
  ['Study', 'NEXT_CLASS', ['next class', 'when is my next lecture']], ['Study', 'LIST_CLASSES', ["today's classes", 'my timetable']],
  ['Study', 'STUDY_PLAN', ['plan my GATE prep, exam on 12 Feb, topics: OS, DBMS', 'create a study plan for my OS exam']],
  ['Study', 'STUDY_TODAY', ['what should i study today', 'which topic should i revise now']], ['Study', 'PLAN_DAY', ['plan my day', 'make a schedule for this evening']],
  ['Study', 'WEEK_REPORT', ['how was my week', 'weekly summary']], ['Study', 'PRODUCTIVITY_REPORT', ['how productive was i today', 'what did i get done']],
  ['Study', 'FLASH_MAKE', ['make flashcards from lecture3.pdf', 'create flashcards on deadlock']],
  ['Study', 'FLASH_REVIEW', ['review my flashcards', 'quiz me on my os flashcards']], ['Study', 'FLASH_LIST', ['show my flashcards', 'my decks']],
  ['Study', 'FLASH_DELETE', ['delete my os flashcards', 'remove the deck']],
  ['Study', 'ATTENDANCE_MARK', ['mark dbms present', 'i was absent for os today']], ['Study', 'ATTENDANCE_REPORT', ['attendance report', 'show my attendance']],
  ['Study', 'ATTENDANCE_TARGET', ['how many classes to reach 80%?', 'how many lectures to get to 85 percent']],
  ['Study', 'BUNK_CHECK', ['can i bunk tomorrow?', 'can i skip dbms']], ['Study', 'ADD_MARKS', ['add s3: 8.6 gpa, 24 credits', 'i got 8.2 sgpa in sem 4 with 22 credits']],
  ['Study', 'CGPA_REPORT', ['what is my cgpa?', 'cgpa']], ['Study', 'GPA_TARGET', ['what gpa do i need for an 8.5 cgpa?', 'i need 9 cgpa, what gpa should i get']],
  ['Study', 'CONTESTS', ['upcoming contests', 'when is the next codeforces round']], ['Study', 'CONTEST_REMIND', ['remind me before the next leetcode contest', 'notify me about the codeforces round']],
  ['Study', 'HACKATHONS', ['upcoming hackathons', 'hackathons in bengaluru']],
  // ---- web
  ['Web', 'WEB_SEARCH', ['google best laptops', 'search for dsa roadmap']], ['Web', 'SITE_SEARCH', ['search gfg for heap sort', 'search github for jarvis']],
  ['Web', 'OPEN_URL', ['open amazon.com', 'go to github.com']], ['Web', 'YOUTUBE', ['play lofi on youtube', 'search believer on youtube']],
  ['Web', 'YOUTUBE_PLAY', ['play believer', 'put on some arijit songs']], ['Web', 'RESEARCH', ['search the web for rust vs go', 'research quantum computing']],
  ['Web', 'WEATHER', ['weather in bengaluru', 'will it rain tomorrow']],
  ['Web', 'DIRECTIONS', ['directions to majestic', 'how do i get to the airport']], ['Web', 'DIRECTIONS_OPEN', ['open directions to majestic in maps', 'show directions on maps']],
  ['Web', 'DISTANCE', ['distance from hyderabad to bangalore', 'how far is mysore from bangalore']],
  // ---- code & dev
  ['Code', 'RUN_FILE', ['run bfs.py', 'run it']], ['Code', 'OPEN_IN_EDITOR', ['open main.py in vs code', 'edit notes.md', 'open vs code and the directory should be dsa sprint folder', 'open vs code in dsa sprint folder', 'open vs code with dsa sprint', 'open vs code at the dsa_sprint project']],
  ['Code', 'CODE_ASK', ['tell copilot to add tests', 'ask claude code to fix the login bug']],
  ['Code', 'LOCATE_PROJECT', ['locate my agriloop project', 'where is the dsa folder']],
  ['Code', 'START_PROCESS', ['start the agriloop backend', "start agriloop's frontend"]], ['Code', 'STOP_PROCESS', ['stop the agriloop backend', 'stop the agriloop server']],
  ['Code', 'CHECK_PORT', ['check port 3000', 'is port 5173 free']], ['Code', 'WORKFLOW', ['coding mode', "let's start coding"]],
  ['Code', 'GIT_STATUS', ['git status', 'any uncommitted changes']], ['Code', 'GIT_LOG', ['git log', 'recent commits']],
  ['Code', 'GIT_DIFF', ['git diff', 'what changed']], ['Code', 'GIT_COMMIT', ['git commit', 'commit my changes']],
  ['Code', 'GIT_CLONE', ['clone https://github.com/user/repo', 'git clone the github repo']],
  ['Code', 'SNIPPET_SAVE', ['save that as snippet dfs', 'save this code as a snippet']], ['Code', 'SNIPPET_LIST', ['show my snippets', 'snippets']],
  ['Code', 'SNIPPET_COPY', ['copy snippet dfs', 'give me the snippet']], ['Code', 'SNIPPET_DELETE', ['delete snippet dfs', 'remove the snippet']],
  ['Code', 'BASE_CONVERT', ['255 to binary', '0xff to decimal']], ['Code', 'DATA_SIZE', ['5 gb to mb', '1024 kb in mb']],
  ['Code', 'UNIT_CONVERT', ['100 f to c', '5 km in miles']], ['Code', 'ASCII', ['ascii of A', 'char for 65']],
  ['Code', 'BITWISE', ['5 xor 3', '12 & 10']], ['Code', 'CALCULATE', ['what is 25 times 4', '2^10']],
  // ---- automation
  ['Automation', 'ROUTINE_CREATE', ['create a routine called exam prep: open vs code, start a focus session', 'make a routine gym: mute, lock the screen']],
  ['Automation', 'ROUTINE_LIST', ['list my routines', 'routines']], ['Automation', 'ROUTINE_DELETE', ['delete the gym routine', 'remove routine called exam prep']],
  ['Automation', 'ROUTINE_RUN', ['run study mode', 'start my morning routine']],
  ['Automation', 'ROUTINE_SCHEDULE', ['run my morning routine every day at 7am', 'start study mode on weekdays at 6pm']],
  ['Automation', 'TRIGGER_CREATE', ['when i plug in my charger, start study mode', 'when the battery drops below 20%, run leaving']],
  ['Automation', 'TRIGGER_LIST', ['list my triggers', 'triggers']], ['Automation', 'TRIGGER_DELETE', ['delete trigger 2', 'remove all triggers']],
  ['Automation', 'CONTEXT_REOPEN', ['open it again', 'reopen that']],
];

// Order script.js uses: a routine name first (Routines.match), then the rules.
const understand = t => { const n = NLU.normalize(t, 'jarvis'); return Routines.match(n.text) ? { intent: 'ROUTINE_RUN', confidence: 1 } : NLU.classify(n, {}); };
for (const [area, intent, phrases] of FEATURES)
  for (const t of phrases) {
    const p = understand(t);
    check(area + ' · ' + intent, '“' + t + '”', p.intent === intent && p.confidence >= 0.85, p.intent + ' ' + p.confidence);
  }

// Gate: every intent in nlu.js has phrases above.
const all = [...new Set([...fs.readFileSync(path.join(ROOT, 'nlu.js'), 'utf8').matchAll(/^ {4}\['([A-Z_]+)'/gm)].map(m => m[1]))];
const covered = new Set(FEATURES.map(f => f[1]));
const missing = all.filter(i => !covered.has(i));
check('Coverage', 'every intent in nlu.js has test phrases (' + missing.length + ' missing)', !missing.length, missing.join(', '));
const unknown = [...covered].filter(i => !all.includes(i));
check('Coverage', 'the table names only intents that exist', !unknown.length, unknown.join(', '));
fs.writeFileSync(path.join(__dirname, '.features.json'), JSON.stringify(FEATURES.map(([area, intent, phrases]) => ({ area, intent, example: phrases[0] }))));
process.exit(done(all.length + ' intents') ? 1 : 0);
