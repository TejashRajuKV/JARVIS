// Paraphrase test: the same request said the way people actually say it (casual, Indian-English, no verb, extra
// words). Measures three outcomes per phrase, not just pass/fail:
//   correct         — a rule matched the right intent (≥ 0.85)
//   handed to AI    — no confident rule; goes to the AI planner (it can act) or to chat (it can't)
//   CONFIDENT-WRONG — a rule matched the WRONG intent with ≥ 0.85, so the AI never sees it. The bad one.
// Run: node tests/paraphrase.test.js   (add -v to list every miss)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'nlu.js'), 'utf8') + ';global.NLU=NLU;');
global.settings = { wakeWord: 'jarvis', focusMin: 25 };
global.ctx = {};
global.store = { get: (k, d) => d, set: () => {} };
global.getJSON = async () => ({});
global.cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
global.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const src = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
eval(src.slice(src.indexOf('function expandSteps('), src.indexOf('async function runDiagnostics(')) + ';global.expandSteps=expandSteps;');
eval(fs.readFileSync(path.join(root, 'agent.js'), 'utf8') + ';global.Agent=Agent;');
global.$ = () => null;   // routines.js renders its list into the page; no page here
eval(fs.readFileSync(path.join(root, 'routines.js'), 'utf8') + ';global.Routines=Routines;');

// [accepted intents, phrasings]
const CASES = [
  [['VOLUME_UP', 'VOLUME_SET'], ['volume up', 'can u make it louder', 'increase the volume a bit', 'louder please', 'turn it up', 'i cant hear anything, raise the volume']],
  [['VOLUME_DOWN', 'VOLUME_SET'], ['volume down', 'make it quieter', 'too loud', 'reduce the sound', 'lower the volume little bit', 'turn it down']],
  [['VOLUME_SET'], ['set volume to 30', 'volume 30', 'volume 30 pls', 'put the volume at 30 percent', 'make volume 30%', 'change volume to 30']],
  [['VOLUME_MUTE'], ['mute', 'mute the sound', 'silence please', 'shut the sound off', 'mute my laptop', 'no sound']],
  [['BRIGHTNESS'], ['set brightness to 50', 'brightness 50', 'make the screen brighter', 'dim the screen', 'screen is too bright', 'reduce brightness']],
  [['FOCUS_START'], ['start a focus session', 'i wanna study for 45 mins', 'start a 45 minute session', 'focus mode on', 'enable focus mode', 'lets do a pomodoro', 'begin study session for 30 minutes', 'i need to focus for an hour']],
  [['FOCUS_STOP'], ['stop the focus session', 'end focus', 'stop studying', 'cancel my pomodoro', 'i am done with focus']],
  [['BLOCK_DISTRACTIONS'], ['block distractions', 'close distracting apps', 'close all the distracting apps', 'kill distractions', 'no distractions please', 'help me concentrate']],
  [['SET_TIMER'], ['set a timer for 10 minutes', 'timer 10 min', '10 minute timer', 'start a timer for 5 mins', 'countdown 2 minutes', 'set timer 90 seconds']],
  [['REMIND'], ['remind me to call mom at 6pm', 'remind me in 10 minutes to drink water', 'set a reminder for 7am to wake up', 'dont let me forget to submit the form tomorrow', 'remind me at 9 to revise dbms', 'pay fees every year in july']],
  [['ADD_TODO'], ['add milk to my to-do list', 'add revise dbms to my todo', 'new task: finish the lab record', 'put buy pens on my list', 'todo: call the hostel office', 'add submit assignment to tasks']],
  [['LIST_TODOS'], ['show my to-do list', 'what are my tasks', 'list my todos', 'what do i have to do', 'my to do list']],
  [['OPEN_APPLICATION'], ['open chrome', 'launch vs code', 'start spotify', 'open up notepad', 'can you open chrome', 'please open vs code']],
  [['CLOSE_APPLICATION'], ['close chrome', 'quit spotify', 'kill notepad', 'shut down vs code app', 'can you close chrome', 'exit spotify']],
  // OPEN_APPLICATION opens a known site too (its handler falls back to NLU.findSite): "open gfg" really opens GeeksforGeeks.
  [['OPEN_URL', 'WEB_SEARCH', 'SITE_SEARCH', 'OPEN_APPLICATION'], ['open youtube.com', 'go to leetcode', 'open gfg', 'take me to github']],
  [['WEB_SEARCH', 'SITE_SEARCH'], ['search google for heap sort', 'google best laptops under 50k', 'search for dsa roadmap', 'look up binary search on google']],
  [['YOUTUBE', 'YOUTUBE_PLAY'], ['play lofi on youtube', 'play believer', 'put on some lofi music on youtube', 'youtube play arijit songs']],
  [['SCREENSHOT'], ['take a screenshot', 'screenshot', 'capture my screen', 'take a screen shot please']],
  [['SYS_LOCK'], ['lock the screen', 'lock my laptop', 'lock pc', 'lock it']],
  [['SYS_BATTERY'], ['battery', 'how much battery is left', 'am i charging', 'battery percentage', 'whats my battery']],
  [['DARK_MODE'], ['dark mode', 'turn on dark mode', 'switch to light mode', 'enable dark theme on windows']],
  [['RADIO'], ['turn off bluetooth', 'bluetooth on', 'switch off wifi', 'turn on wi-fi', 'disable bluetooth']],
  [['ATTENDANCE_MARK'], ['mark dbms present', 'i was absent for os today', 'mark cn absent yesterday', 'i missed the dbms class', 'present in maths today']],
  [['ATTENDANCE_REPORT'], ['attendance report', 'show my attendance', 'hows my attendance', 'attendance']],
  [['ATTENDANCE_TARGET'], ['how many classes to reach 80%?', 'how many more classes do i need for 75 percent', 'how many lectures to get to 80%']],
  [['BUNK_CHECK'], ['can i bunk tomorrow?', 'can i skip dbms', 'should i attend os class tomorrow', 'can i miss the next cn class']],
  [['ADD_MARKS'], ['add s3: 8.6 gpa, 24 credits', 'i got 8.2 sgpa in sem 4 with 22 credits', 'save my s2 result 7.9 gpa 20 credits']],
  [['CGPA_REPORT'], ['what is my cgpa?', 'show my cgpa', 'my cgpa', 'cgpa']],
  [['GPA_TARGET'], ['what gpa do i need for an 8.5 cgpa?', 'what sgpa do i need to get 8 cgpa', 'i need 9 cgpa, what gpa should i get']],
  [['READ_FILE', 'ASK_FILES', 'SUMMARISE_FILE'], ['open my dbms notes', 'read my notes', 'show me notes.md', 'read os notes']],
  [['CREATE_FOLDER'], ['create a folder called dsa', 'make a new folder dsa', 'new folder named projects']],
  [['ROUTINE_RUN'], ['run study mode', 'start my morning routine', 'run bedtime']],
  [['WEATHER'], ['weather in bengaluru', 'whats the weather', 'is it going to rain today', 'weather tomorrow']],
  [['GET_TIME'], ['what time is it', 'time please', 'tell me the time', 'whats the time now']],
  [['SYSTEM_STATE', 'SYS_ALL', 'DIAGNOSTICS'], ['system status', 'whats the state of my laptop', 'status', 'laptop status']],
  // Second set, written after the rules were tuned on the set above and measured before any change (90% → 92%):
  // keeps the score honest. Misses here are left for the AI planner, not patched one by one.
  [['VOLUME_UP', 'VOLUME_SET'], ['bump up the volume', 'sound up', 'make it a little louder jarvis', 'increase sound']],
  [['VOLUME_DOWN', 'VOLUME_SET'], ['bring the volume down', 'decrease sound a bit', 'its too loud yaar', 'sound down']],
  [['VOLUME_SET'], ['volume to 50', 'keep volume at 40', 'set the sound to 20 percent']],
  [['VOLUME_MUTE'], ['mute everything', 'mute audio', 'kill the sound']],
  [['BRIGHTNESS'], ['brightness up', 'increase screen brightness', 'make the display dimmer', 'brightness to 70']],
  [['FOCUS_START'], ['start pomodoro', 'i want to study now', 'focus for 25 minutes', 'start deep work', 'begin a 50 minute focus', 'time to study']],
  [['FOCUS_STOP'], ['stop pomodoro', 'end my study session', 'finish the focus timer']],
  [['BLOCK_DISTRACTIONS'], ['block all distractions', 'close all distractions', 'turn on do not disturb mode', 'get me focused']],
  [['SET_TIMER'], ['timer for 15 minutes', 'set a 20 min timer', 'put a timer of 3 minutes', 'alarm in 10 minutes']],
  [['REMIND'], ['remind me to take medicine at 9pm', 'remind me tomorrow at 8 to go to the bank', 'set reminder call dad at 7', 'remember to water plants in 2 hours']],
  [['ADD_TODO'], ['add buy notebook to my todo list', 'put finish dbms assignment on my to-do list', 'add task: email professor', 'new todo revise os']],
  [['LIST_TODOS'], ['show todos', 'what is on my to do list', 'check my task list', 'tasks']],
  [['OPEN_APPLICATION'], ['open whatsapp', 'launch notepad', 'fire up chrome', 'open discord please']],
  [['CLOSE_APPLICATION'], ['close whatsapp', 'quit chrome', 'close notepad now', 'shut spotify']],
  [['WEB_SEARCH', 'SITE_SEARCH'], ['search for merge sort', 'google how to install python', 'search heap sort on gfg']],
  [['SCREENSHOT'], ['take screenshot', 'grab a screenshot', 'screen capture']],
  [['SYS_LOCK'], ['lock computer', 'lock the laptop', 'lock screen']],
  [['SYS_BATTERY'], ['battery level', 'how much charge do i have', 'check battery']],
  [['RADIO'], ['bluetooth off', 'turn wifi off', 'enable bluetooth']],
  [['ATTENDANCE_MARK'], ['mark os present today', 'i was present in dbms', 'mark maths absent', 'absent in cn today']],
  [['ATTENDANCE_REPORT'], ['my attendance', 'attendance percentage', 'show attendance report']],
  [['BUNK_CHECK'], ['can i skip os tomorrow', 'can i afford to miss dbms', 'can i bunk cn']],
  [['CGPA_REPORT'], ['whats my cgpa', 'current cgpa', 'show my sgpa']],
  [['CREATE_FOLDER'], ['create folder called notes', 'make a folder named os', 'new folder os-lab']],
  [['GET_TIME'], ['what is the time', 'current time', 'time now']],
  [['WEATHER'], ['weather today', 'how is the weather in hyderabad', 'will it rain tomorrow']],
];
// Not requests: the wider hand-off to the AI planner must leave these with chat.
const CHAT_ONLY = ['explain how browser tabs use memory', 'i go to the gym every day', 'what is volume in physics', 'my brightness is always low, why?', 'we have exams every year in may',
  'how does bluetooth work', 'i love the dark mode theme', 'explain the timer interrupt in 8051'];

const verbose = process.argv.includes('-v');
let correct = 0, toPlanner = 0, toChat = 0, wrong = 0, total = 0;
const misses = [];
for (const [want, phrases] of CASES) {
  for (const t of phrases) {
    total++;
    const n = NLU.normalize(t, 'jarvis');
    // Same order as script.js: a routine name is matched before the rules.
    const p = Routines.match(n.text) ? { intent: 'ROUTINE_RUN', confidence: 1 } : NLU.classify(n, {});
    const confident = p.intent !== 'CONVERSATION' && p.confidence >= 0.85;
    if (confident && want.includes(p.intent)) { correct++; continue; }
    if (confident) { wrong++; misses.push('WRONG   ' + t.padEnd(52) + ' → ' + p.intent + ' ' + p.confidence + '  (want ' + want.join('|') + ')'); continue; }
    // Same gate script.js uses: only an action-looking request goes to the AI planner; the rest goes to chat.
    if (Agent.wantsAction(n.text)) { toPlanner++; misses.push('→ AI    ' + t.padEnd(52) + ' (planner)'); }
    else { toChat++; misses.push('→ chat  ' + t.padEnd(52) + ' (chat can’t act — want ' + want.join('|') + ')'); }
  }
}
const pct = x => Math.round(100 * x / total) + '%';
if (verbose) misses.forEach(m => console.log(m));
else misses.filter(m => m.startsWith('WRONG')).forEach(m => console.log(m));
console.log(`paraphrase: ${correct}/${total} correct (${pct(correct)}) · ${toPlanner} to AI planner · ${toChat} to chat · ${wrong} confident-wrong`);
let grabbed = 0;
for (const t of CHAT_ONLY) {
  const n = NLU.normalize(t, 'jarvis'), p = NLU.classify(n, {});
  const acts = (p.intent !== 'CONVERSATION' && p.confidence >= 0.85) || Agent.wantsAction(n.text);
  if (acts) { grabbed++; console.log('FAIL  not a request, but would act / go to the planner: ' + t + ' → ' + p.intent); }
}
console.log(`chat-only: ${CHAT_ONLY.length - grabbed}/${CHAT_ONLY.length} left with chat`);
// Regression guards: a confident-wrong match acts wrongly without asking, and a statement grabbed as a command is
// the same failure from the other side. Both must stay at zero.
process.exit(wrong || grabbed ? 1 : 0);
