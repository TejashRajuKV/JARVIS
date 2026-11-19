'use strict';
(function(root) {
  const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const fileAction = /^(?:(?:please|jarvis)[, ]+)*(?:delete|remove|trash|clear|empty|move|copy|rename|organize|organise)\b/i;
  function exclusion(text) {
    const value = clean(text), match = /\b(?:except|excluding|apart from|other than)\s+(.+?)[.!?]*$/i.exec(value);
    if (!match || !fileAction.test(value)) return null;
    return { include: value.slice(0, match.index).trim(), exclude: match[1], reviewRequired: true };
  }
  function language(text) {
    if (/[\u0900-\u097f]/.test(text)) return 'hi';
    if (/[\u0c00-\u0c7f]/.test(text)) return 'te';
    if (/[\u0c80-\u0cff]/.test(text)) return 'kn';
    return /\b(?:kholo|dikhao|batao|band karo|chalao|mera|meri|mujhe)\b/i.test(text) ? 'hi-Latn' : 'en';
  }
  function translateKnown(text) {
    const original = clean(text), lang = language(original);
    if (!['hi','hi-Latn'].includes(lang)) return { text: original, language: lang };
    const s = original.replace(/[०-९]/g, d => String(d.charCodeAt(0)-0x0966));
    const kal = /\bkal\b|कल/.test(s);
    if (kal) return { text: original, language: lang, clarification: 'Does “kal” mean tomorrow or yesterday here?', choices: ['tomorrow','yesterday'] };
    const patterns = [
      [/^(?:please\s+)?(.+?)\s+(?:kholo|खोलो|खोलिए)[.!?]*$/i, m => 'open ' + m[1]],
      [/^(?:please\s+)?(.+?)\s+(?:band karo|बंद करो|बंद कीजिए)[.!?]*$/i, m => 'close ' + m[1]],
      [/^(?:mera |meri |मेरी |मेरा )?(?:(aaj|today|tomorrow|yesterday|आज) (?:ka|का) )?(?:schedule|timetable|समय सारणी)\s+(?:dikhao|दिखाओ)[.!?]*$/i, m => 'show my schedule ' + ({aaj:'today','आज':'today'}[m[1]] || m[1] || 'today')],
      [/^(?:volume|आवाज़|वॉल्यूम)\s+(\d+)\s*(?:percent|प्रतिशत|%)?\s*(?:karo|kar do|करो|कर दो)[.!?]*$/i, m => 'set volume to ' + m[1]],
      [/^(\d+)\s*(?:minute|minut|मिनट)\s*(?:ka |का )?(?:timer|टाइमर)\s*(?:lagao|लगाओ)[.!?]*$/i, m => 'set a timer for ' + m[1] + ' minutes'],
      [/^(?:music|gaana|गाना|संगीत)\s+(?:chalao|चलाओ)[.!?]*$/i, () => 'play music']
    ];
    for (const [pattern, render] of patterns) { const match=pattern.exec(s); if (match) return { text: render(match), language: lang, translated: true }; }
    return { text: original, language: lang, needsModel: true };
  }
  function understand(text, { nlu, context = {}, now = new Date(), preferences = {} } = {}) {
    if (!nlu) throw new Error('NLU is required');
    const original = clean(text), translated = translateKnown(original), norm = nlu.normalize(translated.text, 'jarvis');
    const scope = exclusion(norm.text);
    const classified = nlu.classify(norm, context);
    const entities = [];
    const add = (type, value, source = original) => { if (value !== undefined && value !== null && value !== '') entities.push({ type, value, source }); };
    const app = nlu.findApp(norm.text); if (app) add('app', app.k);
    for (const match of original.matchAll(/(?:[a-z]:[\\/][^"\n]+?\.[a-z0-9]{1,8}|[\w.-]+\.(?:pdf|docx|xlsx|pptx|md|txt|csv|js|py))(?=\s|$|["'])/gi)) add('file', match[0]);
    for (const match of original.matchAll(/["“]([^"”]+)["”]/g)) add('quoted', match[1]);
    for (const match of norm.text.matchAll(/\b(\d+(?:\.\d+)?)\s*(percent|points|minutes?|hours?|gb|mb|kg|km)?\b/g)) add('number', { amount: +match[1], unit: match[2] || null });
    const when = nlu.parseWhen(norm.text, now); if (when) add('time', when);
    const person = /\b(?:call|email|message|meet)\s+(?!me\b|my\b|the\b)([\p{L}][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)?)/u.exec(original);
    if (person) add('person', person[1]);
    const city = /\b(?:weather|forecast)\s+(?:in|for)\s+(.+?)(?:\s+(?:today|tomorrow)|[.!?]|$)/i.exec(original);
    if (city) add('place', city[1]);
    const references = [...original.matchAll(/\b(it|that|this|him|her|the (?:first|second|third|last) one|my boss|my usual playlist|the project folder)\b/gi)].map(m => m[0]);
    const slots = { ...(classified.args || {}) };
    if (/^(?:play music|play my usual playlist)[.!?]*$/i.test(original) && preferences.playlist) slots.playlist = clean(preferences.playlist);
    const clarification = translated.clarification || (scope ? 'Review the exact included files before changing anything; the exclusion must be preserved.' :
      /^(?:it(?:'s| is) too dark in here|i(?:'m| am) leaving)[.!?]*$/i.test(original) ? 'Which action should I take? I will not infer a device change from that statement.' : null);
    return { version: 1, original, text: norm.text, language: translated.language, intent: classified.intent,
      confidence: classified.confidence, entities, slots, references, scope, clarification,
      candidates: [{ intent: classified.intent, confidence: classified.confidence }],
      executable: !clarification && classified.intent !== 'NEGATED' && classified.intent !== 'CONVERSATION' && classified.confidence >= .85 };
  }
  function createDialogue({ load = () => null, save = () => {}, now = Date.now, ttl = 30 * 60000 } = {}) {
    let state = load();
    if (!state || state.version !== 1 || state.expires <= now()) state = { version: 1, stack: [], current: null, expires: now()+ttl };
    const clone = value => JSON.parse(JSON.stringify(value));
    function persist() { state.expires = now()+ttl; save(clone(state)); }
    function current() { if (state.expires<=now()) {state.current=null;state.stack=[];} return state.current && clone(state.current); }
    function begin(intent, slots = {}, missing = [], goal = '') {
      if (state.current) state.stack.push(state.current);
      state.stack=state.stack.slice(-5);
      state.current={intent:clean(intent).slice(0,80),slots:clone(slots),missing:[...missing].slice(0,10),goal:clean(goal).slice(0,500)};
      persist(); return current();
    }
    function fill(slot, value) { if (!current() || !state.current.missing.includes(slot)) return null; state.current.slots[slot]=value;state.current.missing=state.current.missing.filter(s=>s!==slot);persist();return current(); }
    function correct(slot,value) { if(!current() || !Object.hasOwn(state.current.slots,slot)) return null;state.current.slots[slot]=value;persist();return current(); }
    function resume() { state.current=state.stack.pop()||null;persist();return current(); }
    function clear() {state.current=null;state.stack=[];persist();}
    return {begin,fill,correct,resume,clear,current, snapshot:()=>clone(state)};
  }
  function persistPending(context, store, now = Date.now) {
    const key='jarvis.dialoguePending', safe=new Set(['REMIND','SET_TIMER','LANG_DAY']);
    const saved=store.get(key,null);
    let pending=saved?.expires>now() && safe.has(saved.value?.intent)?saved.value:null, expires=saved?.expires||0;
    Object.defineProperty(context,'pending',{configurable:true,enumerable:true,get:()=>{if(expires<=now())pending=null;return pending;},set:value=>{
      pending=value;
      expires=now()+30*60000;
      if(value && safe.has(value.intent) && JSON.stringify(value).length<6000) store.set(key,{version:1,expires,value:JSON.parse(JSON.stringify(value))});
      else store.set(key,null);
    }});
  }
  const api={exclusion,language,translateKnown,understand,createDialogue,persistPending};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Understanding=api;
})(globalThis);
