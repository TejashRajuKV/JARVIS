'use strict';
const fs=require('fs'),path=require('path');
const P=require('../skillpack'),R=require('../skillrouter');
let fail=0,total=0;const check=(n,ok,x)=>{total++;if(!ok){fail++;console.log('FAIL '+n+(x?' — '+JSON.stringify(x):''));}};
const loaded=P.loadAll(path.join(__dirname,'..','skills-bundled'),path.join(__dirname,'not-present'));
const names=loaded.skills.map(s=>s.name);
for(const name of ['debugging-coach','study-sprint','meeting-notes','career-helper'])check('new skill is discoverable: '+name,names.includes(name));
check('all bundled skills have valid names and descriptions',loaded.skills.every(s=>P.NAME_RE.test(s.name)&&s.description&&s.body));
const publicSkills=loaded.skills.map(s=>P.publicView(s));
for(const [q,want] of [
 ['help me debug this stack trace and find the root cause','debugging-coach'],
 ['make a study sprint for my exam revision with active recall','study-sprint'],
 ['extract action items and decisions from these meeting notes','meeting-notes'],
 ['improve my resume bullets for a software engineering interview','career-helper']
]){R.reset();const p=R.pick(q,publicSkills);check('context-aware skill selection: '+want,!!p&&p.name===want,p&&{name:p.name,score:p.score});}
for(const q of ['hello jarvis','open chrome and set a timer','what is recursion','i am frustrated today']){R.reset();check('ambiguous/ordinary message is not auto-routed: '+q,R.pick(q,publicSkills)===null);}
check('malformed skill metadata is rejected',!!P.parseSkill('---\nname: ../escape\ndescription: bad\n---\nbody','x').error);
console.log('skill-hub-quality: '+(total-fail)+'/'+total);process.exitCode=fail?1:0;
