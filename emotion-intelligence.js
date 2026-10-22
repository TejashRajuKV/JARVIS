'use strict';
/* Lightweight, deterministic emotional-context cues. No model calls, no mood history, no diagnosis. */
const EmotionIntelligence = (() => {
  const PATTERNS = [
    { mood: 'frustrated', confidence: 0.88, patterns: [
      /\b(i am|i'm|im|so|really|very)?\s*(frustrated|annoyed|fed up|irritated)\b/i,
      /\b(this|it|everything) (is|isn't|is not|doesn't|does not|won't|will not) working\b/i,
      /\b(you keep|it keeps) (failing|breaking|getting it wrong)\b/i,
      /\b(doesn't work|not working|still broken|wasting my time)\b/i
    ] },
    { mood: 'sad', confidence: 0.86, patterns: [
      /\b(i feel|i'm feeling|i am feeling|i've been feeling) (sad|down|low|empty|lonely|hopeless)\b/i,
      /\b(i feel like nobody cares|i feel alone|i miss them so much)\b/i,
      /\b(had a bad day|rough day|feeling blue)\b/i
    ] },
    { mood: 'anxious', confidence: 0.82, patterns: [
      /\b(i'm|i am|i feel|i'm feeling) (anxious|nervous|worried|scared|overwhelmed)\b/i,
      /\b(i can't stop worrying|i am panicking|i'm panicking|too much pressure)\b/i,
      /\b(afraid i will fail|worried about (my )?(exam|interview|future|deadline))\b/i
    ] },
    { mood: 'stressed', confidence: 0.8, patterns: [
      /\b(stressed|burnt out|burned out|exhausted|under pressure|too much to do)\b/i,
      /\b(i can't handle all this|i have too much on my plate)\b/i
    ] },
    { mood: 'confused', confidence: 0.76, patterns: [
      /\b(i don't understand|i do not understand|i'm confused|i am confused|lost here|makes no sense)\b/i,
      /\b(can you explain (it|that) (more )?simply|i don't get it)\b/i
    ] },
    { mood: 'excited', confidence: 0.8, patterns: [
      /\b(i'm so excited|i am so excited|this is amazing|i did it|we did it|finally worked|got selected|i got the job)\b/i,
      /\b(awesome|fantastic news|so happy|really happy)\b/i
    ] },
    { mood: 'positive', confidence: 0.74, patterns: [
      /\b(thank you so much|that helped a lot|i appreciate it|feeling good|proud of myself)\b/i
    ] }
  ];
  const HINTS = {
    frustrated: 'The user may be frustrated. Acknowledge the friction briefly, take responsibility if JARVIS caused it, then offer a concrete next step. Do not become defensive or overly cheerful.',
    sad: 'The user may be feeling low. Respond warmly and gently, acknowledge what they said, and invite them to share or choose practical help. Do not minimize, overpromise, or claim to know exactly how they feel.',
    anxious: 'The user may be anxious. Use a calm, grounded tone, acknowledge the worry, and break the situation into manageable next steps. Avoid catastrophizing or false reassurance.',
    stressed: 'The user may be under stress. Be calm and concise; reduce cognitive load and suggest one useful next step rather than a long list.',
    confused: 'The user may be confused. Be patient, explain in plain language step by step, and check what part needs clarification without making them feel bad.',
    excited: 'The user sounds excited. Match their positive energy naturally, celebrate the specific achievement, and then help with the next step if useful.',
    positive: 'The user expressed appreciation or a positive feeling. Respond warmly and naturally without overdoing praise.'
  };
  const TARGETS = [
    { target: 'jarvis', patterns: [/\b(jarvis|you keep|you are not listening|you misunderstood|you got it wrong|your answer|your response|you are repeating|you keep asking)\b/i] },
    { target: 'college', patterns: [/\b(college|campus|lecture|professor|attendance|assignment|semester|exam|internal marks|lab record|faculty|class test|viva)\b/i] },
    { target: 'coding', patterns: [/\b(code|coding|debug|bug|compiler|runtime|stack trace|build|deploy|github|repository|repo|commit|pull request|api|javascript|python|react|node\.js|typescript|function|algorithm|leetcode)\b/i] }
  ];
  const FOLLOW_UP = /\b(it|that|this|they|them|same|still|again|continue|what about|and then|next step|the previous|as i said|like before)\b/i;
  function targetOf(input) {
    const text = String(input || '');
    for (const group of TARGETS) if (group.patterns.some(re => re.test(text))) return group.target;
    return 'unclear';
  }
  function analyze(input, history) {
    const text = String(input || '').trim();
    const signal = detect(text);
    signal.target = targetOf(text);
    signal.inherited = false;
    const prior = Array.isArray(history) ? history.slice(-8) : [];
    if (signal.mood === 'neutral' && FOLLOW_UP.test(text)) {
      for (let i = prior.length - 1; i >= 0; i--) {
        if (!prior[i] || prior[i].role !== 'user' || !prior[i].text) continue;
        const earlier = detect(prior[i].text);
        if (earlier.mood !== 'neutral') {
          signal.mood = earlier.mood;
          signal.confidence = Math.min(0.62, earlier.confidence);
          signal.inherited = true;
        }
        if (signal.target === 'unclear') signal.target = targetOf(prior[i].text);
        break;
      }
    }
    return signal;
  }
  function continuity(input, history) {
    const text = String(input || '').trim();
    if (!FOLLOW_UP.test(text) || !Array.isArray(history)) return '';
    const previous = history.slice(-8).filter(m => m && m.role === 'user' && m.text).pop();
    if (!previous) return '';
    return 'This message may continue the recent conversation. Use the recent turns as context, preserve the active goal, and ask only if a key detail is genuinely missing.';
  }
  function detect(input) {
    const text = String(input || '').trim();
    if (!text) return { mood: 'neutral', confidence: 0, explicit: false };
    for (const item of PATTERNS) {
      if (item.patterns.some(re => re.test(text))) return { mood: item.mood, confidence: item.confidence, explicit: true };
    }
    return { mood: 'neutral', confidence: 0, explicit: false };
  }
  function instruction(signal) {
    if (!signal || !HINTS[signal.mood]) return '';
    let hint = HINTS[signal.mood];
    if (signal.target === 'jarvis' && signal.mood === 'frustrated') {
      hint = 'The frustration appears directed at JARVIS or its behavior. Acknowledge the specific failure, take responsibility without excuses, and state what will be corrected next. Do not blame the user or claim work was done unless verified.';
    } else if (signal.target === 'college' && ['frustrated', 'anxious', 'stressed'].includes(signal.mood)) {
      hint += ' The concern appears related to college or academics; do not treat it as frustration with JARVIS. Help prioritize the academic task.';
    } else if (signal.target === 'coding' && ['frustrated', 'anxious', 'stressed'].includes(signal.mood)) {
      hint += ' The concern appears related to coding or a technical task; focus on one concrete debugging or implementation step.';
    }
    if (['stressed', 'anxious', 'sad', 'frustrated'].includes(signal.mood)) {
      hint += ' Keep the answer concise and offer at most one practical next action, not a long checklist. Avoid forced positivity.';
    }
    if (signal.inherited) hint += ' This tone cue is inferred tentatively from the immediately relevant recent conversation, not a permanent user profile.';
    return hint;
  }
  function describe(signal) {
    return signal && HINTS[signal.mood] ? signal.mood : 'neutral';
  }
  return Object.freeze({ detect, analyze, continuity, targetOf, instruction, describe });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = EmotionIntelligence;
