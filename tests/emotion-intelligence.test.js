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
for (const [input, expected] of cases) {
  const got = EmotionIntelligence.detect(input);
  if (got.mood !== expected) {
    failures++;
    console.error('FAIL', JSON.stringify(input), 'expected', expected, 'got', got.mood);
  } else console.log('PASS', expected, JSON.stringify(input));
}
const sad = EmotionIntelligence.detect("I'm feeling sad today");
if (!EmotionIntelligence.instruction(sad).includes('warmly')) {
  failures++;
  console.error('FAIL sad cue should return gentle response guidance');
} else console.log('PASS mood-specific response guidance');
if (EmotionIntelligence.instruction(EmotionIntelligence.detect('open chrome')) !== '') {
  failures++;
  console.error('FAIL neutral input should not add emotional guidance');
} else console.log('PASS neutral input adds no guidance');
console.log((12 - failures) + '/12 emotional intelligence checks passed');
process.exitCode = failures ? 1 : 0;
