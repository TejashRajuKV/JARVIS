'use strict';
/* ============ utils ============ */
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rand=(a,b)=>a+Math.random()*(b-a);
const randi=(a,b)=>Math.floor(rand(a,b+1));
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pad=n=>String(n).padStart(2,'0');
const rid=()=>Math.random().toString(36).slice(2,9);
const cap=s=>s? s[0].toUpperCase()+s.slice(1):'';
const escapeReg=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const escHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const ts=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());};
const store={
  get(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f;}catch(e){return f;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
};

/* ============ data ============ */
const settings=Object.assign(
  {wakeWord:'jarvis',tts:true,rate:1,voice:'',sound:true,online:false,wakeOn:false,responseLen:'balanced'},
  store.get('jarvis.settings',{})
);
let memory=store.get('jarvis.memory',[]);       // [{id,key,value,ts}]
let sandbox=store.get('jarvis.fs',{folders:['Documents','Downloads','Projects'],files:{'notes.txt':'Stay local. Ship JARVIS. Trust no cloud.'}});
const saveFS=()=>store.set('jarvis.fs',sandbox);
function memAdd(key,value){memory.push({id:rid(),key,value,ts:Date.now()});store.set('jarvis.memory',memory);renderMemory();engine('mem',true);setTimeout(()=>engine('mem',false),900);}
function memSet(key,value){const ex=memory.find(m=>m.key===key);if(ex){ex.value=value;ex.ts=Date.now();}else memory.push({id:rid(),key,value,ts:Date.now()});store.set('jarvis.memory',memory);renderMemory();}
function memGet(key){const m=memory.find(m=>m.key===key);return m?m.value:null;}
function memDel(id){memory=memory.filter(m=>m.id!==id);store.set('jarvis.memory',memory);renderMemory();}

/* ============ dom refs ============ */
const stateChip=$('#stateChip'),stateMsg=$('#stateMsg'),liveTranscript=$('#liveTranscript');
const micBtn=$('#micBtn'),wakeBtn=$('#wakeBtn'),chatInput=$('#chatInput'),sendBtn=$('#sendBtn');
const messages=$('#messages'),logBox=$('#logStream'),memoryList=$('#memoryList'),timerChips=$('#timerChips');
const bgCanvas=$('#bgCanvas'),waveCanvas=$('#waveCanvas');

/* ============ log / toast / sfx ============ */
function log(type,msg){
  const el=document.createElement('div');el.className='ll '+type;
  el.innerHTML='<span class="lt">'+ts()+'</span><span class="lm">'+escHtml(msg)+'</span>';
  logBox.appendChild(el);
  while(logBox.children.length>100)logBox.removeChild(logBox.firstChild);
  logBox.scrollTop=logBox.scrollHeight;
}
function toast(msg){
  const t=document.createElement('div');t.className='toast';t.textContent=msg;
  $('#toasts').appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transition='.4s';setTimeout(()=>t.remove(),400);},2600);
}
let AC=null;
function ac(){if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC;}
function blip(freq,dur,type,gain){
  if(!settings.sound)return;
  try{const c=ac(),o=c.createOscillator(),g=c.createGain();
    o.type=type||'sine';o.frequency.value=freq;
    g.gain.setValueAtTime(gain||.045,c.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+dur);
    o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+dur);}catch(e){}
}
const sfx={
  wake(){blip(740,.07);setTimeout(()=>blip(1180,.09),75);},
  ok(){blip(1040,.06,'sine',.035);},
  err(){blip(170,.22,'sawtooth',.05);},
  key(){blip(1500,.03,'square',.018);}
};

/* ============ state ============ */
let state='BOOT';
const stateMeta={
  IDLE:['◈ READY','How can I help you?'],
  LISTENING:['◉ LISTENING','Speak — I am listening'],
  PROCESSING:['◐ PROCESSING','Reasoning locally…'],
  EXECUTING:['▲ EXECUTING','Running validated tool…'],
  SPEAKING:['◍ SPEAKING','Responding…'],
  ERROR:['✕ ERROR','Something went wrong'],
  BOOT:['◈ BOOTING','Initializing local runtime…']
};
function setState(s,msg){
  state=s;const m=stateMeta[s]||stateMeta.IDLE;
  document.body.dataset.state={IDLE:'idle',LISTENING:'listen',PROCESSING:'proc',EXECUTING:'exec',SPEAKING:'speak',ERROR:'err',BOOT:'boot'}[s];
  stateChip.textContent=m[0];
  stateMsg.textContent=msg!==undefined?msg:m[1];
}

/* ============ engines / telemetry ============ */
function engine(key,on){
  const el=$('#eng-'+key);if(!el)return;
  el.classList.toggle('active',!!on);
  if(on)el.classList.remove('boot');
  if(on)el.classList.add('on');
}
function setLastTool(t){$('#lastTool').textContent='tool: '+t;}
const sys={cpu:24,ram:52,disk:210,temp:41};
function renderTele(){
  $('#cpuBar').style.width=sys.cpu+'%';$('#cpuVal').textContent=sys.cpu.toFixed(0)+'%';
  $('#ramBar').style.width=sys.ram+'%';$('#ramVal').textContent=sys.ram.toFixed(0)+'%';
  $('#dskBar').style.width=(sys.disk/3)+'%';$('#dskVal').textContent=sys.disk.toFixed(0)+' GB';
  $('#tmpBar').style.width=(sys.temp)+'%';$('#tmpVal').textContent=sys.temp.toFixed(1)+'°C';
}
async function updateRealSystemStats(){
  try{
    const res=await fetch(API_URL+'/tool/systemInfo');
    if(!res.ok)return;
    const data=await res.json();
    if(data.success){
      sys.cpu=data.cpuUsage||sys.cpu;
      sys.ram=data.memoryUsagePercent||sys.ram;
      sys.disk=data.diskFreeGB||sys.disk;
      sys.temp=data.temperature||sys.temp;
      renderTele();
    }
  }catch(e){
    // silently fail - use demo data if backend unavailable
  }
}
setInterval(updateRealSystemStats,2000);

/* ============ clock / uptime ============ */
const bootTime=Date.now();let latSum=0,latN=0;
setInterval(()=>{
  const d=new Date();
  $('#clockTime').textContent=pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
  const days=['SUN','MON','TUE','WED','THU','FRI','SAT'],mos=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  $('#clockDate').textContent=days[d.getDay()]+' '+pad(d.getDate())+' '+mos[d.getMonth()]+' '+d.getFullYear();
  const up=Math.floor((Date.now()-bootTime)/1000);
  $('#statUp').textContent=pad(Math.floor(up/60))+':'+pad(up%60);
  $('#statLat').textContent=latN?Math.round(latSum/latN)+'ms':'—';
},1000);

/* ============ canvas: background + wave ============ */
const bctx=bgCanvas.getContext('2d'),wctx=waveCanvas.getContext('2d');
const DPR=Math.min(window.devicePixelRatio||1,2);
function fit(c,ctx){const r=c.getBoundingClientRect();c.width=Math.max(2,r.width*DPR);c.height=Math.max(2,r.height*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);}
function fitAll(){fit(bgCanvas,bctx);fit(waveCanvas,wctx);}
window.addEventListener('resize',fitAll);
const stars=Array.from({length:70},()=>({x:Math.random(),y:Math.random(),s:rand(.4,1.6),v:rand(.008,.03)}));
function drawBG(dt){
  const w=bgCanvas.width/DPR,h=bgCanvas.height/DPR;
  bctx.clearRect(0,0,w,h);
  // perspective grid
  bctx.strokeStyle='rgba(63,217,255,.05)';bctx.lineWidth=1;
  const hy=h*.62;
  for(let i=-8;i<=8;i++){
    bctx.beginPath();bctx.moveTo(w/2+i*w*.02,hy);bctx.lineTo(w/2+i*w*.16,h);bctx.stroke();
  }
  const off=(performance.now()/140)%28;
  for(let y=hy+off;y<h;y+=28){
    const t=(y-hy)/(h-hy);
    bctx.strokeStyle='rgba(63,217,255,'+(0.02+t*0.06)+')';
    bctx.beginPath();bctx.moveTo(0,y);bctx.lineTo(w,y);bctx.stroke();
  }
  // particles
  for(const p of stars){
    p.y-=p.v*dt/60;if(p.y<0)p.y=1;
    bctx.fillStyle='rgba(157,241,255,'+(0.08+p.s*0.1)+')';
    bctx.fillRect(p.x*w,p.y*h,p.s,p.s);
  }
}
let waveLevel=0,waveTarget=.08;
function drawWave(){
  const w=waveCanvas.width/DPR,h=waveCanvas.height/DPR;
  wctx.clearRect(0,0,w,h);
  waveLevel+=(waveTarget-waveLevel)*.12;
  const N=64,bw=w/N,t=performance.now()/1000;
  let freq=null;
  if(analyser&&micActive){const d=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(d);freq=d;}
  for(let i=0;i<N;i++){
    let v;
    if(freq){v=(freq[Math.floor(i*freq.length/N/2)]||0)/255;}
    else{
      const base=Math.sin(i*.42+t*3.1)*.5+.5;
      const jit=Math.random()*.35;
      v=(base*.7+jit)*waveLevel+0.015;
    }
    const bh=clamp(v,0.02,1)*h*.48;
    const speaking=state==='SPEAKING';
    wctx.fillStyle=speaking?'rgba(255,184,77,'+(0.35+v*.6)+')':'rgba(63,217,255,'+(0.25+v*.6)+')';
    wctx.fillRect(i*bw+1,h/2-bh,bw-2,bh*2);
  }
  wctx.strokeStyle='rgba(63,217,255,.25)';
  wctx.beginPath();wctx.moveTo(0,h/2);wctx.lineTo(w,h/2);wctx.stroke();
}
/* orb rings */
const coilG=$('#coilG');
for(let i=0;i<12;i++){
  const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
  const a=i/12*Math.PI*2;
  r.setAttribute('x','196');r.setAttribute('y','86');r.setAttribute('width','8');r.setAttribute('height','16');
  r.setAttribute('fill','#3fd9ff');r.setAttribute('opacity','.5');
  r.setAttribute('transform','rotate('+(a*180/Math.PI)+' 200 200)');
  coilG.appendChild(r);
}
const ringA=$('#ringA'),ringB=$('#ringB'),ringC=$('#ringC');
let aA=0,aB=0,aC=0;
const ringSpeeds={idle:[4,-2.4,7],listen:[26,-14,34],proc:[70,-95,120],exec:[40,-26,54],speak:[34,-20,44],err:[90,-60,110],boot:[10,-6,14]};
const curSp=[4,-2.4,7];
function spinOrb(dt){
  const key=document.body.dataset.state||'idle';
  const tgt=ringSpeeds[key]||ringSpeeds.idle;
  for(let i=0;i<3;i++)curSp[i]+=(tgt[i]-curSp[i])*.04;
  aA+=curSp[0]*dt/1000;aB+=curSp[1]*dt/1000;aC+=curSp[2]*dt/1000;
  ringA.setAttribute('transform','rotate('+aA+' 200 200)');
  ringB.setAttribute('transform','rotate('+aB+' 200 200)');
  ringC.setAttribute('transform','rotate('+aC+' 200 200)');
  coilG.setAttribute('transform','rotate('+(-aB*.5)+' 200 200)');
  const st=state;
  waveTarget= st==='LISTENING'?(micActive?.9:.35)
    : st==='SPEAKING'?rand(.5,.85)
    : st==='PROCESSING'?rand(.25,.45)
    : st==='EXECUTING'?rand(.35,.55)
    : st==='ERROR'?rand(.1,.2)
    : .08;
}
let lastT=performance.now();
function frame(t){
  const dt=Math.min(50,t-lastT);lastT=t;
  if(!reduceMotion)drawBG(dt);
  spinOrb(dt);
  drawWave();
  requestAnimationFrame(frame);
}
fitAll();requestAnimationFrame(frame);
if(reduceMotion){drawBG(16);}

/* ============ boot sequence ============ */
const bootLinesData=[
  ['hl','JARVIS kernel v3.2.1 — local runtime'],
  ['ok','[ OK ] whisper.cpp loaded — model base.en · 142 MB'],
  ['ok','[ OK ] ollama bridge — llama3.2:3b · Q4_K_M'],
  ['ok','[ OK ] piper voice en_GB-alan · 22 kHz'],
  ['ok','[ OK ] tool registry — 14 tools allowlisted'],
  ['ok','[ OK ] memory store — json mounted at ~/jarvis'],
  ['warn','[ -- ] cloud APIs ............ none required'],
  ['ok','[ OK ] security — no arbitrary shell execution'],
  ['hl','[ OK ] all systems local. standing by.']
];
let bootSkip=false;
$('#bootSkip').addEventListener('click',()=>bootSkip=true);
$('#bootOverlay').addEventListener('click',()=>bootSkip=true);
async function bootSequence(){
  const box=$('#bootLines'),bar=$('#bootBarFill');
  for(let i=0;i<bootLinesData.length;i++){
    if(bootSkip){box.innerHTML='';bootLinesData.forEach(l=>{const d=document.createElement('div');d.className=l[0];d.textContent='> '+l[1];box.appendChild(d);});bar.style.width='100%';break;}
    const d=document.createElement('div');d.className=bootLinesData[i][0];d.textContent='> '+bootLinesData[i][1];
    box.appendChild(d);bar.style.width=((i+1)/bootLinesData.length*100)+'%';
    await sleep(randi(110,260));
  }
  await sleep(bootSkip?150:500);
  $('#bootOverlay').classList.add('done');
  setTimeout(()=>$('#bootOverlay').remove(),800);
  Object.keys({mic:1,stt:1,llm:1,tts:1,core:1,mem:1}).forEach((k,i)=>setTimeout(()=>{
    const el=$('#eng-'+k);el.classList.remove('boot');el.classList.add('on');
  },i*140));
  log('ok','runtime online — all engines local');
  log('info','wake word armed: "'+settings.wakeWord+'"');
  setState('IDLE');
  const nm=memGet('name');
  jarvisSay({text:'All systems are local and online.'+(nm?' Welcome back, '+nm+'.':'')+' How can I help you?',intent:'SYSTEM',noTTS:document.hidden});
  if(settings.wakeOn){settings.wakeOn=false;}
}

/* ============ TTS ============ */
let voices=[];
function loadVoices(){
  if(!('speechSynthesis' in window))return;
  voices=speechSynthesis.getVoices();
  const sel=$('#voiceSelect');sel.innerHTML='';
  const auto=document.createElement('option');auto.value='';auto.textContent='AUTO (en-GB preferred)';sel.appendChild(auto);
  voices.forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=v.name+' · '+v.lang;if(v.name===settings.voice)o.selected=true;sel.appendChild(o);});
}
if('speechSynthesis' in window){loadVoices();speechSynthesis.onvoiceschanged=loadVoices;}
function pickVoice(){
  if(settings.voice){const v=voices.find(x=>x.name===settings.voice);if(v)return v;}
  return voices.find(v=>/en[-_]GB/i.test(v.lang)&&/male|daniel|arthur|george/i.test(v.name))
      ||voices.find(v=>/en[-_]GB/i.test(v.lang))
      ||voices.find(v=>/^en/i.test(v.lang))||null;
}
function cleanForTTS(t){return t.replace(/[`*_#\[\]{}()]/g,'').replace(/\s+/g,' ');}
function speak(text){
  return new Promise(res=>{
    if(!('speechSynthesis' in window)||!settings.tts)return res();
    try{
      const u=new SpeechSynthesisUtterance(cleanForTTS(text));
      u.rate=clamp(parseFloat(settings.rate)||1,.5,2);u.pitch=.92;
      const v=pickVoice();if(v)u.voice=v;
      u.onend=res;u.onerror=res;
      speechSynthesis.speak(u);
      setTimeout(res,text.length*95+3500); // safety resolve
    }catch(e){res();}
  });
}

/* ============ messages / reply queue ============ */
let turns=0;
function addMsg(role,text,opts){
  opts=opts||{};
  const wrap=document.createElement('div');wrap.className='msg '+role;
  if(role==='user'){
    wrap.innerHTML='<div class="mhead"><span>'+ts()+'</span><span class="src">'+(opts.source||'text').toUpperCase()+'</span><span class="who">YOU</span></div><div class="mbody"></div>';
    wrap.querySelector('.mbody').textContent=text;
  }else{
    wrap.innerHTML='<div class="avatar"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="#3fd9ff" stroke-width="1.4" stroke-dasharray="5 3"/><circle cx="20" cy="20" r="6" fill="#3fd9ff"/><circle cx="20" cy="20" r="10.5" fill="none" stroke="#9df1ff" stroke-width=".7" opacity=".7"/></svg></div>'
      +'<div class="mcontent"><div class="mhead"><span class="who">JARVIS</span><span>'+ts()+'</span><span class="meta"></span></div><div class="mbody"></div><div class="mextra"></div></div>';
  }
  messages.appendChild(wrap);messages.scrollTop=messages.scrollHeight;
  if(role==='user'){turns++;$('#msgCount').textContent=turns+' turns';}
  return {root:wrap,bodyEl:wrap.querySelector('.mbody'),metaEl:wrap.querySelector('.meta'),extraEl:wrap.querySelector('.mextra')};
}
function typeText(el,text,instant){
  return new Promise(res=>{
    if(instant||reduceMotion){el.textContent=text;return res();}
    el.classList.add('typing');let i=0;
    (function step(){
      i+=2;el.textContent=text.slice(0,i);
      if(i<text.length){messages.scrollTop=messages.scrollHeight;setTimeout(step,16);}
      else{el.classList.remove('typing');res();}
    })();
  });
}
const replyQ=[];let pumping=false;
function jarvisSay(o){replyQ.push(o);pump();}
async function pump(){
  if(pumping)return;pumping=true;
  while(replyQ.length){
    const o=replyQ.shift();
    await renderReply(o);
    if(replyQ.length)await sleep(160);
  }
  pumping=false;
  engine('tts',false);
  if(state==='SPEAKING'||state==='ERROR')setState(wakeOn?'LISTENING':'IDLE',wakeOn?'Say "'+settings.wakeWord+'" to wake me':undefined);
}
async function renderReply(o){
  const node=addMsg('jarvis','');
  const typed=typeText(node.bodyEl,o.text,o.instant);
  const spoken=(!o.noTTS&&settings.tts)?speak(o.text):sleep(240);
  await Promise.all([typed,spoken]);
  if(o.intent&&node.metaEl)node.metaEl.textContent=o.intent+(o.tool?' · '+o.tool+'()':'')+' · LOCAL';
  if(o.confirm){
    const d=document.createElement('div');d.className='confirmRow';
    const yes=document.createElement('button');yes.className='cbtn danger';yes.textContent=o.confirm.yes||'CONFIRM';
    const no=document.createElement('button');no.className='cbtn';no.textContent=o.confirm.no||'CANCEL';
    yes.addEventListener('click',()=>{yes.disabled=no.disabled=true;d.classList.add('done');sfx.ok();o.confirm.onConfirm();});
    no.addEventListener('click',()=>{yes.disabled=no.disabled=true;d.classList.add('done');jarvisSay({text:'Understood — operation cancelled.',intent:'CONFIRM_CANCEL'});});
    d.append(yes,no);node.extraEl.appendChild(d);
  }
}

/* ============ intent classification ============ */
function I(intent,confidence,tool,payload){return {intent:intent,confidence:confidence,tool:tool||null,payload:payload};}
function classify(raw){
  const t=raw.trim(),s=t.toLowerCase();
  const has=re=>re.test(s);
  if(has(/^(hi|hello|hey)\b|good (morning|afternoon|evening)/))return I('GREETING',.97);
  if(has(/who are you|what are you\b/))return I('IDENTITY',.96);
  if(has(/tell me a joke|make me laugh|something funny/))return I('JOKE',.95);
  if(has(/what('s| is) my name|do you know my name/))return I('RECALL_NAME',.98,null);
  const nm=t.match(/my name is ([a-zA-Z]+)/i);if(nm)return I('SET_NAME',.99,null,cap(nm[1]));
  if(has(/\bremember\b/))return I('REMEMBER',.95);
  if(has(/what do you remember|show (my )?memory|list memory/))return I('RECALL_ALL',.95);
  if(has(/\bwhat time\b|\btime is it\b|^time$/))return I('GET_TIME',.98);
  if(has(/\bwhat day\b|today'?s date|\bdate is it\b/))return I('GET_DATE',.97);
  if(has(/\bbriefing\b/))return I('BRIEFING',.93,'dailyBriefing');
  if(has(/productivity mode|prepare my (coding )?environment|start coding\b/))return I('WORKFLOW',.92,'runWorkflow');
  if(has(/set (a )?timer/))return I('SET_TIMER',.97,'setTimer');
  if(has(/[\d)][\s]*[×x*\/÷+\-][\s]*[\d(]/)||has(/\b(plus|minus|times|multiplied by|divided by)\b/)||(has(/^(calculate|compute)/)&&/\d/.test(s)))return I('CALCULATE',.96,'calculate');
  if(has(/\b(cpu|processor)\b/)&&has(/usage|load|how|what|check/))return I('SYS_CPU',.95,'getSystemInfo');
  if(has(/\b(ram|memory)\b/)&&has(/usag|using|how|free|available/))return I('SYS_RAM',.94,'getSystemInfo');
  if(has(/storage|disk space/))return I('SYS_DISK',.95,'getSystemInfo');
  if(has(/operating system|what os\b/))return I('SYS_OS',.97,'getSystemInfo');
  if(has(/system (status|info|health)|how (is|are) the system/))return I('SYS_ALL',.93,'getSystemInfo');
  if(has(/delete everything|delete all files|\bformat\b/))return I('DESTRUCTIVE',.99,'deleteFiles');
  if(has(/\bdelete (the )?(folder|file)\b/))return I('DELETE_ITEM',.94,'deleteItem');
  if(has(/create (a )?folder/))return I('CREATE_FOLDER',.97,'createFolder');
  if(has(/create (a )?(text )?file|new file/))return I('CREATE_FILE',.96,'createFile');
  if(has(/\blist (the )?files\b|show (the |me the )?files/))return I('LIST_FILES',.95,'listFiles');
  if(has(/\bread\b.*\b(file|notes)\b/))return I('READ_FILE',.9,'readFile');
  if(has(/\bopen\b/)&&has(/\bfolder\b|downloads|documents|my projects?\b/))return I('OPEN_FOLDER',.93,'openFolder');
  if(has(/\bgo to\b/))return I('NAVIGATE',.92,'openBrowser');
  if(has(/\bsearch\b/))return I('WEB_SEARCH',.94,'searchWeb');
  if(has(/\bclose\b/))return I('CLOSE_APPLICATION',.9,'closeApplication');
  if(has(/\b(open|launch|start|run)\b/))return I('OPEN_APPLICATION',.9,'openApplication');
  if(has(/machine learning/))return I('CONVERSATION',.9,null,{topic:'ml'});
  if(has(/thank/))return I('THANKS',.97);
  if(has(/\bhelp\b|what can you do/))return I('HELP',.96);
  // Power control
  if(has(/\block\b/)&&has(/screen|system|computer/))return I('SYS_LOCK',.96,'lockSystem');
  if(has(/\bsleep\b/)&&has(/computer|system|pc|laptop/))return I('SYS_SLEEP',.95,'sleepSystem');
  if(has(/\b(shutdown|shut down|power off|turn off)\b/)&&has(/computer|system|pc|laptop/))return I('SYS_SHUTDOWN',.95,'shutdownSystem');
  if(has(/\b(restart|reboot)\b/)&&has(/computer|system|pc|laptop/))return I('SYS_RESTART',.95,'restartSystem');
  if(has(/cancel.*shut|abort.*shut/))return I('SYS_CANCEL_SHUTDOWN',.97,'cancelShutdown');
  // Volume & media
  if(has(/\b(mute|unmute)\b/))return I('VOLUME_MUTE',.97,'setVolume');
  if(has(/volume up|increase volume|louder/))return I('VOLUME_UP',.96,'setVolume');
  if(has(/volume down|decrease volume|quieter|lower.*volume/))return I('VOLUME_DOWN',.96,'setVolume');
  if(has(/\b(play|pause|resume)\b.*music|music.*\b(play|pause)/))return I('MEDIA_PLAY',.95,'mediaKey');
  if(has(/next (song|track)|skip/))return I('MEDIA_NEXT',.95,'mediaKey');
  if(has(/previous (song|track)|go back.*song/))return I('MEDIA_PREV',.95,'mediaKey');
  if(has(/stop (music|playing)/))return I('MEDIA_STOP',.94,'mediaKey');
  // System extras
  if(has(/take.*screenshot|screenshot/))return I('SCREENSHOT',.96,'screenshot');
  if(has(/\bbattery\b/))return I('SYS_BATTERY',.95,'batteryStatus');
  if(has(/running processes|what.*running|top processes|cpu hog/))return I('SYS_PROCESSES',.93,'listProcesses');
  // File ops
  if(has(/\brename\b.*\bfile\b|\brename\b.*\bfolder\b/))return I('RENAME_FILE',.93,'renameFile');
  if(has(/\bcopy\b.*\bfile\b/))return I('COPY_FILE',.92,'copyFile');
  if(has(/\bmove\b.*\bfile\b/))return I('MOVE_FILE',.92,'moveFile');
  if(has(/\bfind\b.*\bfile\b|search.*file|\bsearch files\b/))return I('SEARCH_FILES',.93,'searchFiles');
  // Clipboard
  if(has(/\bclipboard\b|what.*clipboard|read.*clipboard/))return I('READ_CLIPBOARD',.95,'readClipboard');
  if(has(/copy.*clipboard|write.*clipboard|put.*clipboard/))return I('WRITE_CLIPBOARD',.93,'writeClipboard');
  // Network
  if(has(/\b(ip|network|ip address)\b/))return I('SYS_NETWORK',.95,'networkInfo');
  // Git
  if(has(/git status|repo status/))return I('GIT_STATUS',.96,'gitStatus');
  if(has(/git log|recent commits|commit history/))return I('GIT_LOG',.95,'gitLog');
  if(has(/git diff|what.*changed/))return I('GIT_DIFF',.94,'gitDiff');
  if(has(/git commit|commit.*changes/))return I('GIT_COMMIT',.93,'gitCommit');
  // Dev tools
  if(has(/\bport\b.*\b\d+\b|check.*port|is.*port.*open/))return I('CHECK_PORT',.94,'checkPort');
  return I('CONVERSATION',.6);
}

/* ============ apps / sites ============ */
const APPS=[
  {k:'chrome',m:/chrome|google chrome/,n:'Google Chrome'},
  {k:'firefox',m:/firefox/,n:'Firefox'},
  {k:'edge',m:/edge|microsoft edge/,n:'Microsoft Edge'},
  {k:'vscode',m:/vs ?code|visual studio code|code editor/,n:'VS Code'},
  {k:'notepad',m:/notepad/,n:'Notepad'},
  {k:'explorer',m:/explorer|file manager|file explorer/,n:'File Explorer'},
  {k:'terminal',m:/terminal|console|command prompt/,n:'Terminal'},
  {k:'powershell',m:/powershell/,n:'PowerShell'},
  {k:'calculator',m:/calculator|calc/,n:'Calculator'},
  {k:'calendar',m:/calendar|gcal/,n:'Calendar'},
  {k:'outlook',m:/outlook/,n:'Outlook'},
  {k:'mail',m:/\bmail\b|\bemail\b/,n:'Mail'},
  {k:'word',m:/\bword\b|document editor/,n:'Word'},
  {k:'excel',m:/excel|spreadsheet/,n:'Excel'},
  {k:'spotify',m:/spotify|music player/,n:'Spotify'},
  {k:'discord',m:/discord/,n:'Discord'},
  {k:'slack',m:/slack/,n:'Slack'},
  {k:'zoom',m:/zoom/,n:'Zoom'},
  {k:'teams',m:/teams|microsoft teams/,n:'Teams'},
  {k:'steam',m:/steam/,n:'Steam'},
  {k:'paint',m:/paint|mspaint/,n:'Paint'},
  {k:'task manager',m:/task manager|taskmgr/,n:'Task Manager'},
  {k:'antigravity',m:/antigravity|agy/,n:'Antigravity'}
];
function findApp(s){for(const a of APPS){if(a.m.test(s))return a;}return null;}
const SITES={youtube:'https://www.youtube.com',github:'https://github.com',gmail:'https://mail.google.com',google:'https://www.google.com',twitter:'https://twitter.com',reddit:'https://www.reddit.com','stack overflow':'https://stackoverflow.com'};

// Backend API connection
const API_URL='http://localhost:3000/api';
async function toolStep(label){
  log('tool',label);sfx.key();
  try{
    // Try to send to backend
    const res=await fetch(API_URL+'/health',{method:'GET'});
    if(res.ok)return; // Backend is connected
  }catch(e){}
  // Fallback: simulate locally
  await sleep(randi(150,360));
}

async function callTool(endpoint,data){
  try{
    const res=await fetch(API_URL+endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    return await res.json();
  }catch(e){
    log('error','Backend not connected: '+e.message);
    return {error:'Backend unavailable'};
  }
}

/* ============ safe math ============ */
function tryCalc(text){
  let e=text.toLowerCase()
    .replace(/what is|what's|calculate|compute|equals|equal|\?|=/g,' ')
    .replace(/plus/g,'+').replace(/minus/g,'-')
    .replace(/times|multiplied by/g,'*').replace(/divided by/g,'/')
    .replace(/[×x]/g,'*').replace(/÷/g,'/').replace(/\^/g,'**').replace(/,/g,'');
  e=e.replace(/[^0-9+\-*/().%\s]/g,' ').trim();
  if(!/\d/.test(e)||!/[+\-*/%]/.test(e))return null;
  if(!/^[0-9+\-*/().%\s]+$/.test(e))return null;
  try{
    const val=Function('"use strict";return ('+e+')')();
    if(typeof val!=='number'||!isFinite(val))return null;
    return {expr:e.replace(/\s+/g,' ').trim(),val:parseFloat(val.toPrecision(10))};
  }catch(err){return null;}
}

/* ============ timers ============ */
const timers=[];
setInterval(()=>{
  const nowMs=Date.now();
  for(let i=timers.length-1;i>=0;i--){
    const tm=timers[i];
    const left=tm.end-nowMs;
    if(left<=0){timers.splice(i,1);tm.el.remove();sfx.wake();log('ok','timer complete: '+tm.label);jarvisSay({text:'Your '+tm.label+' timer is finished.',intent:'TIMER_DONE'});}
    else{const s=Math.ceil(left/1000);tm.el.textContent='⏱ '+tm.label+' '+pad(Math.floor(s/60))+':'+pad(s%60);}
  }
},500);
function addTimer(label,ms){
  const el=document.createElement('span');el.className='tchip';timerChips.appendChild(el);
  timers.push({label,end:Date.now()+ms,el});
}

/* ============ conversation / canned replies ============ */
const JOKES=[
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I told my computer I needed a break… now it will not stop sending me KitKat ads. Locally, of course.',
  'There are only 10 kinds of people: those who understand binary, and those who do not.',
  'A cloud service walks into a bar. The bartender says: "Sorry — we are local-only here."',
  'Why did the neural network stay home? It had too many layers of issues and no GPU to talk to.'
];
const FALLBACK=[
  'I parsed that as open conversation. My local tools cover applications, files in ~/jarvis, system health, calculations and timers — try one of those.',
  'That is outside my local tool registry for now. You could say: "open VS Code", "create a folder called AI Projects", or "how much RAM am I using?"',
  'I do not have a confident plan for that yet. My intent layer classified it as CONVERSATION — ask me to act on apps, files or system info and I will execute it.'
];
async function conversationReply(p,text){
  const nm=memGet('name');
  switch(p.intent){
    case 'GREETING':{
      const h=new Date().getHours();
      const day=h<12?'morning':(h<18?'afternoon':'evening');
      return {text:'Good '+day+(nm?', '+nm:'')+'. All systems local, no cloud in sight. What do you need?'};
    }
    case 'IDENTITY':
      return {text:'I am JARVIS — a privacy-first local AI agent. Speech recognition, reasoning and voice output all run on this machine. No API keys. No cloud. Think, listen, act — locally.'};
    case 'JOKE':
      return {text:pick(JOKES)};
    case 'THANKS':
      return {text:pick(['Anytime.','At your service.','Always glad to help.'])};
    case 'HELP':{
      const base='Here is what my allowlisted tools can do:\n• OPEN apps — "open Chrome / VS Code / Notepad"\n• FILES — "create a folder called X", "list the files", "read my notes file"\n• SYSTEM — "how much RAM am I using?"\n• MATH — "what is 25 × 40?"\n• TIMERS — "set a timer for 30 seconds"\n• MEMORY — "remember that…", "what is my name?"\n• WORKFLOWS — "prepare my coding environment"';
      return {text:settings.responseLen==='concise'?'I can open apps, manage files, check the system, calculate, set timers and remember things. Just ask.':base};
    }
    case 'GET_TIME':{
      const d=new Date();return {text:'It is '+pad(d.getHours())+':'+pad(d.getMinutes())+'.'};
    }
    case 'GET_DATE':{
      const d=new Date();
      return {text:'Today is '+d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'.'};
    }
    case 'CONVERSATION':{
      if(p.payload&&p.payload.topic==='ml'){
        return {text:'Machine learning is a branch of artificial intelligence where systems learn patterns from data instead of following hand-written rules. It covers supervised learning, unsupervised learning and reinforcement learning — and, fittingly, it is the layer that powers my intent detection.'};
      }
      return {text:settings.responseLen==='concise'?'Noted. Give me an actionable command and I will execute it.':pick(FALLBACK)};
    }
    default:
      return {text:pick(FALLBACK)};
  }
}

/* ============ tool execution ============ */
let lastApp=null;
function safeName(n){return /^[\w][\w \-.]{0,40}$/.test(n)&&!/\.\./.test(n);}
async function executeTool(p,text){
  const s=text.toLowerCase();
  switch(p.intent){
    case 'OPEN_APPLICATION':{
      const app=findApp(s);
      if(!app)return {text:'I could not identify that application on the allowlist. Try Chrome, VS Code, Notepad, Terminal or Calculator.'};
      await toolStep('openApplication → '+app.k);setLastTool('openApplication');
      const result=await callTool('/tool/openApplication',{app:app.k});
      lastApp=app.k;
      if(result.error){log('err','failed to open '+app.n+': '+result.error);}else{log('ok','execution successful — '+app.n);}
      return {text:'Okay, opening '+app.n+'.',tool:'openApplication'};
    }
    case 'CLOSE_APPLICATION':{
      const app=findApp(s)||APPS.find(a=>a.k===lastApp);
      if(!app)return {text:'Which application should I close?'};
      await toolStep('closeApplication → '+app.k);setLastTool('closeApplication');
      return {text:'Closing '+app.n+'.',tool:'closeApplication'};
    }
    case 'CALCULATE':{
      const c=tryCalc(text);
      if(!c)return {text:'I could not parse that expression safely.'};
      await toolStep('calculate → '+c.expr);setLastTool('calculate');
      return {text:c.expr.replace(/\*/g,'×').replace(/\//g,' ÷ ')+' is '+c.val+'.',tool:'calculate'};
    }
    case 'CREATE_FOLDER':{
      const m=text.match(/folder\s+(?:called|named)?\s*["“']?([\w \-.]+?)["”']?\s*(?:$|please|in\b)/i);
      const name=m?m[1].trim():'';
      if(!name||!safeName(name)){log('err','validation failed — folder name');return {text:'Please give the folder a simple name — letters, numbers, spaces and dashes only.'};}
      if(sandbox.folders.find(f=>f.toLowerCase()===name.toLowerCase())){return {text:'The "'+name+'" folder already exists in ~/jarvis.'};}
      await toolStep('createFolder → ~/jarvis/'+name);setLastTool('createFolder');
      sandbox.folders.push(name);saveFS();log('ok','folder created — ~/jarvis/'+name);
      return {text:'Done. I created the '+name+' folder in ~/jarvis.',tool:'createFolder'};
    }
    case 'CREATE_FILE':{
      const m=text.match(/file\s+(?:called|named)?\s*["“']?([\w\-. ]+?)["”']?\s*(?:$|please)/i);
      let name=m?m[1].trim():'';
      if(name&&!/\./.test(name))name+='.txt';
      if(!name||!safeName(name)){log('err','validation failed — file name');return {text:'Please give the file a simple name, like notes.txt.'};}
      await toolStep('createFile → ~/jarvis/'+name);setLastTool('createFile');
      sandbox.files[name]='Created by JARVIS on '+new Date().toLocaleString()+'.';saveFS();
      return {text:'Created '+name+' in ~/jarvis.',tool:'createFile'};
    }
    case 'LIST_FILES':{
      await toolStep('listFiles → ~/jarvis');setLastTool('listFiles');
      const f=Object.keys(sandbox.files);
      return {text:'Contents of ~/jarvis — '+sandbox.folders.length+' folders: '+sandbox.folders.join(', ')+'. '+f.length+' file'+(f.length===1?'':'s')+': '+(f.join(', ')||'none')+'.'};
    }
    case 'READ_FILE':{
      const m=text.match(/read\s+(?:my\s+|the\s+)?([\w\-.]+?)(?:\s+file)?\s*$/i);
      const want=(m?m[1]:'').toLowerCase();
      const key=Object.keys(sandbox.files).find(k=>k.toLowerCase()===want||k.toLowerCase()===want+'.txt');
      if(!key){log('warn','readFile — not found: '+want);return {text:'I could not find "'+(want||'that file')+'" in the permitted directories.'};}
      await toolStep('readFile → ~/jarvis/'+key);setLastTool('readFile');
      return {text:'From '+key+': "'+sandbox.files[key]+'"',tool:'readFile'};
    }
    case 'OPEN_FOLDER':{
      const known=['downloads','documents','projects'];
      const hit=known.find(k=>s.includes(k))||sandbox.folders.find(f=>s.includes(f.toLowerCase()));
      const target=hit?cap(hit):'Projects';
      await toolStep('openFolder → ~/jarvis/'+target);setLastTool('openFolder');
      return {text:'Opening your '+target+' folder.',tool:'openFolder'};
    }
    case 'NAVIGATE':{
      const site=Object.keys(SITES).find(k=>s.includes(k));
      if(!site)return {text:'Where should I navigate? I know YouTube, GitHub, Gmail, Google, Reddit and Stack Overflow.'};
      await toolStep('openBrowser → '+site);setLastTool('openBrowser');
      lastApp='chrome';
      if(settings.online){window.open(SITES[site],'_blank');return {text:'Opening '+cap(site)+' in the browser.',tool:'openBrowser'};}
      return {text:'Navigation simulated — '+cap(site)+' would open in '+(lastApp==='chrome'?'Chrome':'the browser')+'. Online tools are switched off in settings.',tool:'openBrowser'};
    }
    case 'WEB_SEARCH':{
      const q=text.replace(/^.*?\bsearch\s*(the web\s*)?(for\s*)?/i,'').trim();
      await toolStep('searchWeb → "'+(q||'?')+'"');setLastTool('searchWeb');
      if(settings.online&&q){window.open('https://duckduckgo.com/?q='+encodeURIComponent(q),'_blank');return {text:'Searching for "'+q+'" — results opening in your browser.',tool:'searchWeb'};}
      return {text:'Web search is an optional online tool and is currently disabled — core JARVIS works fully offline. Enable it in Settings if you want.',tool:'searchWeb'};
    }
    case 'SET_TIMER':{
      const m=s.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/);
      if(!m)return {text:'How long? For example: "set a timer for 30 seconds".'};
      const n=parseFloat(m[1]);const unit=m[2][0];
      const ms=unit==='h'?n*3600000:unit==='m'?n*60000:n*1000;
      const label=n+' '+(unit==='h'?'hour':unit==='m'?'minute':'second')+(n===1?'':'s');
      addTimer(label,ms);setLastTool('setTimer');
      await toolStep('setTimer → '+label);
      return {text:'Timer set for '+label+'. I will let you know.',tool:'setTimer'};
    }
    case 'SYS_CPU':await toolStep('getSystemInfo → cpu');setLastTool('getSystemInfo');
      return {text:'Your CPU usage is currently '+sys.cpu.toFixed(0)+'%.'};
    case 'SYS_RAM':await toolStep('getSystemInfo → memory');setLastTool('getSystemInfo');
      return {text:'You are using approximately '+sys.ram.toFixed(0)+'% of available memory.'};
    case 'SYS_DISK':await toolStep('getSystemInfo → storage');setLastTool('getSystemInfo');
      return {text:'You have approximately '+sys.disk.toFixed(0)+' GB of free storage.'};
    case 'SYS_OS':{
      const ua=navigator.userAgent;
      const os=/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'your OS';
      return {text:'You are running '+os+' with a '+(navigator.hardwareConcurrency||'multi')+'-core CPU — everything I need.'};
    }
    case 'SYS_ALL':await toolStep('getSystemInfo → full');setLastTool('getSystemInfo');
      return {text:'System status: CPU '+sys.cpu.toFixed(0)+'%, memory '+sys.ram.toFixed(0)+'%, about '+sys.disk.toFixed(0)+' GB free, core temperature '+sys.temp.toFixed(0)+'°C. All engines local.'};
    case 'BRIEFING':{
      await toolStep('dailyBriefing → aggregate');setLastTool('dailyBriefing');
      const d=new Date();const nm=memGet('name');
      const notes=memory.filter(m=>m.key==='note').length;
      return {text:'Good '+(d.getHours()<12?'morning':'evening')+(nm?', '+nm:'')+'. It is '+pad(d.getHours())+':'+pad(d.getMinutes())+'. CPU at '+sys.cpu.toFixed(0)+'%, memory '+sys.ram.toFixed(0)+'%, '+sys.disk.toFixed(0)+' GB free. '+(notes?notes+' saved note'+(notes===1?'':'s')+' in memory.':'No pending tasks.')+' All systems local.'};
    }
    case 'WORKFLOW':{
      await toolStep('workflow → openApplication(vscode)');
      await toolStep('workflow → openFolder(~/jarvis/Projects)');
      await toolStep('workflow → spawn dev-server :3000');
      setLastTool('runWorkflow');log('ok','workflow complete — coding environment ready');
      return [
        {text:'Opening VS Code.',noTTS:true,instant:true},
        {text:'Opening your project folder.',noTTS:true,instant:true},
        {text:'Development server starting on port 3000.',noTTS:true,instant:true},
        {text:'Your coding environment is ready.'}
      ];
    }
    case 'SET_NAME':memSet('name',p.payload);log('ok','memory saved — user name');
      return {text:'Nice to meet you, '+p.payload+'. I will remember that.'};
    case 'RECALL_NAME':{
      const n=memGet('name');
      return n?{text:'Your name is '+n+'.'}:{text:'You have not told me your name yet. Say: "my name is …" and I will store it locally.'};
    }
    case 'REMEMBER':{
      const m=text.match(/remember\s+(?:that\s+)?(.+)/i);
      const fact=m?m[1].trim().replace(/\.$/,''):text;
      memAdd('note',cap(fact));log('ok','memory saved — note');
      return {text:'Noted — stored in local memory: "'+fact+'".'};
    }
    case 'RECALL_ALL':{
      if(!memory.length)return {text:'My local memory is empty so far. Teach me something.'};
      return {text:'I remember: '+memory.map(m=>m.key+' → '+m.value).join('; ')+'.'};
    }
    case 'DESTRUCTIVE':
      log('warn','destructive request intercepted');
      return {text:'That is a potentially destructive operation. Path restrictions limit me to ~/jarvis — system locations are protected. Proceed anyway?',
        confirm:{yes:'YES — CLEAR SANDBOX',no:'CANCEL',onConfirm:async()=>{
          await toolStep('deleteFiles → ~/jarvis/* (sandboxed)');setLastTool('deleteFiles');
          sandbox.files={};saveFS();
          jarvisSay({text:'Done — sandbox files cleared. Everything outside ~/jarvis was untouched, as designed.',intent:'DELETE_ITEM',tool:'deleteFiles'});
        }}};
    case 'DELETE_ITEM':{
      const m=text.match(/(folder|file)\s+(?:called|named)?\s*["“']?([\w\-. ]+?)["”']?\s*$/i);
      const kind=m?m[1].toLowerCase():'item';const name=m?m[2].trim():'';
      if(!name||!safeName(name))return {text:'Tell me exactly which '+kind+' to delete.'};
      return {text:'Confirm deletion of '+kind+' "'+name+'" from ~/jarvis?',
        confirm:{yes:'DELETE',no:'KEEP',onConfirm:async()=>{
          await toolStep('deleteItem → '+kind+' '+name);setLastTool('deleteItem');
          if(kind==='folder')sandbox.folders=sandbox.folders.filter(f=>f.toLowerCase()!==name.toLowerCase());
          else{const k=Object.keys(sandbox.files).find(k=>k.toLowerCase()===name.toLowerCase()||k.toLowerCase()===name.toLowerCase()+'.txt');if(k)delete sandbox.files[k];}
          saveFS();
          jarvisSay({text:'Deleted. The '+kind+' "'+name+'" is gone from ~/jarvis.',intent:'DELETE_ITEM',tool:'deleteItem'});
        }}};
    }
    case 'SYS_LOCK':{
      await toolStep('lockSystem');setLastTool('lockSystem');
      await callTool('/tool/lockSystem',{});
      return {text:'Okay, locking your screen now.',tool:'lockSystem'};
    }
    case 'SYS_SLEEP':{
      await toolStep('sleepSystem');setLastTool('sleepSystem');
      await callTool('/tool/sleepSystem',{});
      return {text:'Putting the system to sleep. Goodnight.',tool:'sleepSystem'};
    }
    case 'SYS_SHUTDOWN':{
      log('warn','shutdown requested — awaiting confirmation');
      return {text:'Are you sure you want to shut down the computer? This will close all running applications.',
        confirm:{yes:'YES — SHUTDOWN',no:'CANCEL',onConfirm:async()=>{
          await toolStep('shutdownSystem');setLastTool('shutdownSystem');
          await callTool('/tool/shutdownSystem',{});
          jarvisSay({text:'Okay. Shutting down in 10 seconds. Say cancel shutdown to abort.',intent:'SYS_SHUTDOWN',tool:'shutdownSystem'});
        }}};
    }
    case 'SYS_RESTART':{
      log('warn','restart requested — awaiting confirmation');
      return {text:'Are you sure you want to restart the computer?',
        confirm:{yes:'YES — RESTART',no:'CANCEL',onConfirm:async()=>{
          await toolStep('restartSystem');setLastTool('restartSystem');
          await callTool('/tool/restartSystem',{});
          jarvisSay({text:'Okay. Restarting in 10 seconds.',intent:'SYS_RESTART',tool:'restartSystem'});
        }}};
    }
    case 'SYS_CANCEL_SHUTDOWN':{
      await toolStep('cancelShutdown');setLastTool('cancelShutdown');
      await callTool('/tool/cancelShutdown',{});
      return {text:'Shutdown aborted. Your system is safe.',tool:'cancelShutdown'};
    }
    case 'VOLUME_MUTE':{
      const isMute=s.includes('mute')&&!s.includes('unmute');
      const vmAction=isMute?'mute':'unmute';
      await toolStep('setVolume → '+vmAction);setLastTool('setVolume');
      await callTool('/tool/setVolume',{action:vmAction});
      return {text:isMute?'Okay, muting the audio.':'Unmuting audio.',tool:'setVolume'};
    }
    case 'VOLUME_UP':{
      await toolStep('setVolume → up');setLastTool('setVolume');
      await callTool('/tool/setVolume',{action:'up'});
      return {text:'Turning the volume up.',tool:'setVolume'};
    }
    case 'VOLUME_DOWN':{
      await toolStep('setVolume → down');setLastTool('setVolume');
      await callTool('/tool/setVolume',{action:'down'});
      return {text:'Turning the volume down.',tool:'setVolume'};
    }
    case 'MEDIA_PLAY':{
      await toolStep('mediaKey → play');setLastTool('mediaKey');
      await callTool('/tool/mediaKey',{key:'play'});
      return {text:'Okay, toggling play and pause.',tool:'mediaKey'};
    }
    case 'MEDIA_NEXT':{
      await toolStep('mediaKey → next');setLastTool('mediaKey');
      await callTool('/tool/mediaKey',{key:'next'});
      return {text:'Skipping to the next track.',tool:'mediaKey'};
    }
    case 'MEDIA_PREV':{
      await toolStep('mediaKey → prev');setLastTool('mediaKey');
      await callTool('/tool/mediaKey',{key:'prev'});
      return {text:'Going back to the previous track.',tool:'mediaKey'};
    }
    case 'MEDIA_STOP':{
      await toolStep('mediaKey → stop');setLastTool('mediaKey');
      await callTool('/tool/mediaKey',{key:'stop'});
      return {text:'Stopping playback.',tool:'mediaKey'};
    }
    case 'SCREENSHOT':{
      await toolStep('screenshot → desktop');setLastTool('screenshot');
      const rsc=await callTool('/tool/screenshot',{});
      if(rsc.error){log('err','screenshot: '+rsc.error);return {text:'Screenshot failed: '+rsc.error};}
      return {text:'Screenshot saved to desktop as '+rsc.file+'.',tool:'screenshot'};
    }
    case 'SYS_BATTERY':{
      await toolStep('batteryStatus');setLastTool('batteryStatus');
      const rbat=await callTool('/tool/batteryStatus',{});
      if(rbat.level===null||rbat.level===undefined)return {text:'No battery detected — you appear to be on a desktop.',tool:'batteryStatus'};
      return {text:'Battery is at '+rbat.level+'% and currently '+rbat.status.toLowerCase()+'.',tool:'batteryStatus'};
    }
    case 'SYS_PROCESSES':{
      await toolStep('listProcesses');setLastTool('listProcesses');
      const rproc=await callTool('/tool/listProcesses',{});
      if(!rproc.processes||!rproc.processes.length)return {text:'Could not retrieve process list.',tool:'listProcesses'};
      const top5=rproc.processes.slice(0,5).map(p=>(p.Name||'?')+' (CPU: '+(p.CPU||0)+'%)').join(', ');
      return {text:'Top processes by CPU usage: '+top5+'.',tool:'listProcesses'};
    }
    case 'RENAME_FILE':{
      const rmatch=text.match(/rename\s+["'`]?([\w\-.]+)["'`]?\s+to\s+["'`]?([\w\-.]+)["'`]?/i);
      if(!rmatch)return {text:'Please say: rename oldname.txt to newname.txt'};
      await toolStep('renameFile');setLastTool('renameFile');
      const rrn=await callTool('/tool/renameFile',{oldName:rmatch[1],newName:rmatch[2]});
      return rrn.error?{text:'Rename failed: '+rrn.error}:{text:'Done. Renamed '+rmatch[1]+' to '+rmatch[2]+'.',tool:'renameFile'};
    }
    case 'COPY_FILE':{
      const cmatch=text.match(/copy\s+["'`]?([\w\-.]+)["'`]?\s+to\s+["'`]?([\w\-.]+)["'`]?/i);
      if(!cmatch)return {text:'Please say: copy file.txt to backup.txt'};
      await toolStep('copyFile');setLastTool('copyFile');
      const rcp2=await callTool('/tool/copyFile',{src:cmatch[1],dest:cmatch[2]});
      return rcp2.error?{text:'Copy failed: '+rcp2.error}:{text:'Done. Copied '+cmatch[1]+' to '+cmatch[2]+'.',tool:'copyFile'};
    }
    case 'MOVE_FILE':{
      const mmatch=text.match(/move\s+["'`]?([\w\-.]+)["'`]?\s+to\s+["'`]?([\w\-.]+)["'`]?/i);
      if(!mmatch)return {text:'Please say: move file.txt to folder/file.txt'};
      await toolStep('moveFile');setLastTool('moveFile');
      const rmv2=await callTool('/tool/moveFile',{src:mmatch[1],dest:mmatch[2]});
      return rmv2.error?{text:'Move failed: '+rmv2.error}:{text:'Done. Moved '+mmatch[1]+' to '+mmatch[2]+'.',tool:'moveFile'};
    }
    case 'SEARCH_FILES':{
      const sq=text.replace(/find|file|files|search|for|named?/gi,'').trim();
      if(!sq)return {text:'What should I search for?'};
      await toolStep('searchFiles → "'+sq+'"');setLastTool('searchFiles');
      const rsf=await callTool('/tool/searchFiles',{query:sq});
      if(!rsf.results||!rsf.results.length)return {text:'No files matching "'+sq+'" found.',tool:'searchFiles'};
      return {text:'Found '+rsf.results.length+' match'+(rsf.results.length===1?'':'es')+': '+rsf.results.slice(0,6).join(', ')+(rsf.results.length>6?' and more.':'.'),tool:'searchFiles'};
    }
    case 'READ_CLIPBOARD':{
      await toolStep('readClipboard');setLastTool('readClipboard');
      const rcb=await callTool('/tool/readClipboard',{});
      if(rcb.content)return {text:'Your clipboard contains: "'+rcb.content+'"',tool:'readClipboard'};
      return {text:'Your clipboard appears to be empty.',tool:'readClipboard'};
    }
    case 'WRITE_CLIPBOARD':{
      const wcm=text.match(/(?:copy|write|put)\s+["']?(.+?)["']?\s+(?:to|in(?:to)?)\s+(?:the\s+)?clipboard/i);
      if(!wcm)return {text:'What should I copy to the clipboard?'};
      await toolStep('writeClipboard');setLastTool('writeClipboard');
      await callTool('/tool/writeClipboard',{text:wcm[1].trim()});
      return {text:'Copied "'+wcm[1].trim()+'" to your clipboard.',tool:'writeClipboard'};
    }
    case 'SYS_NETWORK':{
      await toolStep('networkInfo');setLastTool('networkInfo');
      const rnet=await callTool('/tool/networkInfo',{});
      return {text:'Your local IP is '+rnet.ip+' ('+rnet.interface+'). Hostname: '+rnet.hostname+'.',tool:'networkInfo'};
    }
    case 'GIT_STATUS':{
      await toolStep('gitStatus');setLastTool('gitStatus');
      const rgs=await callTool('/tool/gitStatus',{});
      return rgs.error?{text:'Git error: '+rgs.error}:{text:'Git status: '+rgs.output,tool:'gitStatus'};
    }
    case 'GIT_LOG':{
      await toolStep('gitLog');setLastTool('gitLog');
      const rgl=await callTool('/tool/gitLog',{});
      return rgl.error?{text:'Git error: '+rgl.error}:{text:'Recent commits — '+rgl.output,tool:'gitLog'};
    }
    case 'GIT_DIFF':{
      await toolStep('gitDiff');setLastTool('gitDiff');
      const rgd=await callTool('/tool/gitDiff',{});
      return rgd.error?{text:'Git error: '+rgd.error}:{text:'Git diff: '+rgd.output,tool:'gitDiff'};
    }
    case 'GIT_COMMIT':{
      const gcm=text.match(/commit\s+(?:with\s+message\s+)?["'`]?(.+?)["'`]?\s*$/i);
      if(!gcm)return {text:'What commit message should I use?'};
      await toolStep('gitCommit');setLastTool('gitCommit');
      const rgc=await callTool('/tool/gitCommit',{message:gcm[1].trim()});
      return rgc.error?{text:'Commit failed: '+rgc.error}:{text:'Committed: '+rgc.output,tool:'gitCommit'};
    }
    case 'CHECK_PORT':{
      const cpm=s.match(/\b(\d{2,5})\b/);
      if(!cpm)return {text:'Which port number should I check?'};
      await toolStep('checkPort → '+cpm[1]);setLastTool('checkPort');
      const rcp=await callTool('/tool/checkPort',{port:cpm[1]});
      return {text:rcp.inUse?'Port '+cpm[1]+' is in use.':'Port '+cpm[1]+' is free.',tool:'checkPort'};
    }
    default:return conversationReply(p,text);
  }
}

/* ============ main turn pipeline ============ */
let busy=false;
async function handleUser(text,source){
  text=(text||'').trim();if(!text)return;
  if(busy){toast('One request at a time — queued as ignored');return;}
  busy=true;const t0=performance.now();
  try{
    if('speechSynthesis' in window)speechSynthesis.cancel();
    addMsg('user',text,{source:source||'text'});
    log('info','input ('+(source||'text')+'): "'+text+'"');
    setState('PROCESSING','Parsing utterance');
    if(source==='voice'||source==='wake'){
      engine('stt',true);await sleep(randi(140,280));
      log('ok','STT completed — conf 0.'+randi(87,99)+' (whisper base.en)');
      engine('stt',false);
    }
    engine('llm',true);setState('PROCESSING','Local LLM reasoning…');
    await sleep(randi(280,640));
    const p=classify(text);
    log('ok','intent: '+p.intent+' · conf '+p.confidence.toFixed(2));
    engine('llm',false);
    let result;
    if(p.tool){
      setState('EXECUTING','tool: '+p.tool+'()');engine('core',true);
      result=await executeTool(p,text);
      engine('core',false);
    }else{
      result=await conversationReply(p,text);
    }
    const items=Array.isArray(result)?result:[result];
    setState('SPEAKING');engine('tts',true);
    items.forEach((it,idx)=>{
      it.intent=it.intent||p.intent;it.tool=it.tool||p.tool;
      replyQ.push(it);
    });
    pump();
    const ms=Math.round(performance.now()-t0);latSum+=ms;latN++;
    log('ok','turn complete in '+ms+'ms');
  }catch(err){
    log('err',String(err&&err.message||err));sfx.err();
    setState('ERROR');engine('tts',true);
    jarvisSay({text:'Sorry — I hit an internal fault: '+String(err&&err.message||err),intent:'ERROR',noTTS:true});
  }finally{busy=false;}
}

/* ============ speech recognition ============ */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,wakeRec=null,wakeOn=false,awaitingCmd=false,micHeld=false,wakePaused=false;
let analyser=null,micStream=null,micActive=false;
async function ensureAnalyser(){
  if(analyser)return;
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const audioInputs=devices.filter(d=>d.kind==='audioinput');
    if(audioInputs.length===0){log('warn','No microphone devices found');return;}
    
    micStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const c=ac();const src=c.createMediaStreamSource(micStream);
    analyser=c.createAnalyser();analyser.fftSize=128;src.connect(analyser);
    log('ok','microphone initialized — '+audioInputs[0].label);
  }catch(e){
    if(e.name==='NotAllowedError'){
      log('err','Microphone permission denied — allow access in browser settings');
      toast('Microphone permission denied');
    }else if(e.name==='NotFoundError'){
      log('warn','No microphone found on this system');
    }else{
      log('warn','mic analyser unavailable: '+e.message+' — synthetic waveform');
    }
  }
}
function makeRec(continuous){const r=new SR();r.lang='en-US';r.continuous=continuous;r.interimResults=true;r.maxAlternatives=1;return r;}
function startDictation(){
  if(!SR){toast('Speech recognition unavailable in this browser — type instead');chatInput.focus();return;}
  if(busy){toast('JARVIS is busy');return;}
  if(wakeOn){wakePaused=true;try{wakeRec.onend=null;wakeRec.stop();}catch(e){}}
  ensureAnalyser();
  try{
    rec=makeRec(false);let finalText='';micActive=true;
    rec.onresult=ev=>{
      let interim='';
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const tt=ev.results[i][0].transcript;
        if(ev.results[i].isFinal)finalText+=tt;else interim+=tt;
      }
      liveTranscript.textContent=(finalText+interim).trim();liveTranscript.classList.add('on');
    };
    rec.onend=()=>{
      micHeld=false;micActive=false;micBtn.classList.remove('live');liveTranscript.classList.remove('on');
      const t=liveTranscript.textContent.trim();liveTranscript.textContent='';
      engine('stt',false);
      if(wakeOn&&wakePaused){wakePaused=false;loopWake();}
      if(t){log('info','voice input received');handleUser(t,'voice');}
      else if(!wakeOn&&state==='LISTENING')setState('IDLE');
      else if(wakeOn)setState('LISTENING','Say "'+settings.wakeWord+'" to wake me');
    };
    rec.onerror=ev=>{
      micActive=false;micHeld=false;micBtn.classList.remove('live');
      if(ev.error==='not-allowed'){toast('Microphone permission denied');log('err','mic permission denied');stopWake();}
      else log('warn','STT error: '+ev.error);
    };
    rec.start();micHeld=true;micBtn.classList.add('live');
    setState('LISTENING','Speak now…');engine('stt',true);
    log('info','voice input received — push-to-talk');
  }catch(e){log('err','STT failed to start');micActive=false;}
}
function stopDictation(){if(rec){try{rec.stop();}catch(e){}}}
micBtn.addEventListener('pointerdown',e=>{e.preventDefault();startDictation();});
window.addEventListener('pointerup',()=>{if(micHeld)stopDictation();});
micBtn.addEventListener('contextmenu',e=>e.preventDefault());

function loopWake(){
  if(!wakeOn)return;
  try{
    wakeRec=makeRec(true);
    wakeRec.onresult=ev=>{
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const tt=(ev.results[i][0].transcript||'').trim();if(!tt)continue;
        const w=settings.wakeWord.toLowerCase();
        if(!awaitingCmd){
          if(tt.toLowerCase().includes(w)){
            awaitingCmd=true;sfx.wake();log('ok','wake word detected: "'+w+'"');
            setState('LISTENING','Yes? I am listening');
            const nm=memGet('name');
            jarvisSay({text:nm?'Yes, '+nm+'?':'Yes?',intent:'WAKE_WORD',noTTS:false});
          }
        }else if(ev.results[i].isFinal){
          let cmd=tt;
          const re=new RegExp('^.*?'+escapeReg(settings.wakeWord.toLowerCase())+'[,]?\\s*','i');
          const stripped=tt.toLowerCase().replace(re,'');
          if(stripped)cmd=stripped;
          awaitingCmd=false;
          if(cmd.trim()){log('info','post-wake command: "'+cmd+'"');handleUser(cmd,'wake');}
        }
      }
    };
    wakeRec.onerror=ev=>{if(ev.error==='not-allowed'){toast('Microphone permission denied');stopWake();}};
    wakeRec.onend=()=>{if(wakeOn&&!wakePaused)setTimeout(loopWake,250);};
    wakeRec.start();
  }catch(e){log('err','wake listener failed');}
}
function startWake(){
  if(!SR){toast('Wake word needs browser speech support');return;}
  wakeOn=true;wakeBtn.classList.add('on');ensureAnalyser();micActive=true;
  log('ok','wake-word listener armed — say "'+settings.wakeWord+'"');
  setState('LISTENING','Say "'+settings.wakeWord+'" to wake me');
  loopWake();
}
function stopWake(){
  wakeOn=false;awaitingCmd=false;wakeBtn.classList.remove('on');micActive=false;
  if(wakeRec){try{wakeRec.onend=null;wakeRec.stop();}catch(e){}}
  if(state==='LISTENING')setState('IDLE');
  log('info','wake-word listener off');
}
wakeBtn.addEventListener('click',()=>{wakeOn?stopWake():startWake();});
if(!SR){micBtn.classList.add('off');wakeBtn.classList.add('off');}

/* ============ input / chips ============ */
function sendInput(){const v=chatInput.value;chatInput.value='';if(v.trim())handleUser(v,'text');}
sendBtn.addEventListener('click',sendInput);
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendInput();});
const CHIP_CMDS=['Volume up','Volume down','Mute','Take a screenshot','What is my battery?','Skip to next song','Lock the screen','Sleep the computer','What is my IP address?','What are the top processes?','Git status','Open VS Code','Set a timer for 30 seconds','Tell me a joke','Give me my briefing'];
CHIP_CMDS.forEach(c=>{
  const b=document.createElement('button');b.className='chip-cmd';b.textContent=c;
  b.addEventListener('click',()=>handleUser(c,'text'));
  $('#chipsRow').appendChild(b);
});

/* ============ memory panel ============ */
function renderMemory(){
  memoryList.innerHTML='';
  if(!memory.length){memoryList.innerHTML='<div class="mem-empty">MEMORY EMPTY — TEACH ME SOMETHING</div>';return;}
  memory.slice().reverse().forEach(m=>{
    const d=document.createElement('div');d.className='mem';
    d.innerHTML='<b>'+escHtml(m.key.toUpperCase())+'</b><span title="'+escHtml(m.value)+'">'+escHtml(m.value)+'</span><button title="forget">✕</button>';
    d.querySelector('button').addEventListener('click',()=>{memDel(m.id);log('info','memory entry deleted');});
    memoryList.appendChild(d);
  });
}
$('#clearMemBtn').addEventListener('click',()=>{memory=[];store.set('jarvis.memory',memory);renderMemory();toast('Local memory cleared');});

/* ============ settings drawer ============ */
const drawer=$('#settingsDrawer'),backdrop=$('#backdrop');
function openDrawer(){drawer.classList.add('open');backdrop.classList.add('open');}
function closeDrawer(){drawer.classList.remove('open');backdrop.classList.remove('open');}
$('#settingsBtn').addEventListener('click',openDrawer);
$('#closeSettings').addEventListener('click',closeDrawer);
backdrop.addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
function bindSwitch(id,key,after){
  const el=$(id);
  el.classList.toggle('on',!!settings[key]);el.setAttribute('aria-checked',String(!!settings[key]));
  el.addEventListener('click',()=>{
    settings[key]=!settings[key];
    el.classList.toggle('on',settings[key]);el.setAttribute('aria-checked',String(settings[key]));
    store.set('jarvis.settings',settings);sfx.key();
    if(after)after(settings[key]);
  });
}
bindSwitch('#ttsToggle','tts');
bindSwitch('#soundToggle','sound');
bindSwitch('#onlineToggle','online',v=>log(v?'warn':'info','online tools '+(v?'ENABLED — data may leave this machine':'disabled — fully offline')));
$('#voiceSelect').addEventListener('change',e=>{settings.voice=e.target.value;store.set('jarvis.settings',settings);});
$('#rateRange').addEventListener('input',e=>{settings.rate=parseFloat(e.target.value);$('#rateVal').textContent=settings.rate.toFixed(1)+'×';store.set('jarvis.settings',settings);});
$('#wakeWordInput').value=settings.wakeWord;
$('#wakeWordInput').addEventListener('change',e=>{
  const v=e.target.value.trim().toLowerCase().replace(/\s+/g,' ')||'jarvis';
  settings.wakeWord=v;e.target.value=v;store.set('jarvis.settings',settings);
  log('info','wake word updated: "'+v+'"');
  if(wakeOn){stopWake();startWake();}
});
$('#lenSelect').value=settings.responseLen;
$('#lenSelect').addEventListener('change',e=>{settings.responseLen=e.target.value;store.set('jarvis.settings',settings);});
$('#rateRange').value=settings.rate;$('#rateVal').textContent=parseFloat(settings.rate).toFixed(1)+'×';
$('#wipeBtn').addEventListener('click',()=>{
  ['jarvis.settings','jarvis.memory','jarvis.fs'].forEach(k=>localStorage.removeItem(k));
  location.reload();
});

/* ============ init ============ */
renderMemory();renderTele();
log('info','JARVIS frontend attached — SIM-CORE demo driver');
log('info','STT/LLM/TTS simulated in-browser · swap for Node/Express + whisper/ollama/piper');
bootSequence();
