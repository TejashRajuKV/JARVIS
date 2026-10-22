'use strict';
const EmotionIntelligence = require('../emotion-intelligence');
const cases = [
  ['This is not working and I am frustrated', 'frustrated'],
  ["I'm feeling sad today", 'sad'],
  ['I am worried about my exam', 'anxious'],
  ['I am stressed and have too much to do', 'stressed'],
  ["I don't understand recursion", 'confused'],
  ['I did it, finally worked!', 'excited'],
  ['Thank you so much, that helped a lot', 'positive'],
  ['Open Chrome and search for React docs', 'neutral'],
  ['I need a stack implementation', 'neutral'],
  ['', 'neutral']
];
let failures = 0;
function check(ok, label) {
  if (!ok) { failures++; console.error('FAIL', label); }
  else console.log('PASS', label);
}
for (const [input, expected] of cases) check(EmotionIntelligence.detect(input).mood === expected, 'mood: ' + expected + ' / ' + input);
check(EmotionIntelligence.instruction(EmotionIntelligence.detect("I'm feeling sad today")).includes('warmly'), 'sad guidance');
check(EmotionIntelligence.instruction(EmotionIntelligence.detect('open chrome')) === '', 'neutral adds no guidance');
check(EmotionIntelligence.analyze('I am frustrated with your answer', []).target === 'jarvis', 'distinguishes frustration with JARVIS');
check(EmotionIntelligence.analyze('I am stressed about my exam', []).target === 'college', 'distinguishes college stress');
check(EmotionIntelligence.analyze('I am frustrated debugging this function', []).target === 'coding', 'distinguishes coding frustration');
const inherited = EmotionIntelligence.analyze('what should I do next about it?', [{role:'user',text:'I am overwhelmed by my assignment',t:1}]);
check(inherited.mood === 'anxious' && inherited.inherited, 'tentative emotional continuity for a follow-up');
check(EmotionIntelligence.continuity('continue with that', [{role:'user',text:'help me debug this',t:1}]).length > 0, 'continuity hint on follow-up');
check(EmotionIntelligence.continuity('open Chrome', [{role:'user',text:'help me debug this',t:1}]) === '', 'no continuity hint for unrelated command');
check(EmotionIntelligence.instruction(EmotionIntelligence.detect('I am overwhelmed and stressed')).includes('one practical next action'), 'concise next-step guidance');
console.log((19 - failures) + '/19 emotional intelligence checks passed');
process.exitCode = failures ? 1 : 0;
