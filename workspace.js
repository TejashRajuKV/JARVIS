'use strict';
/* Today, image gallery, optional integrations and command history. Uses JARVIS's existing local store and API. */
(() => {
  const $ = s => document.querySelector(s), esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function req(path, method='GET', body) {
    try { const r = await fetch('/api' + path, { method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(12000) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }
    catch(e) { throw e; }
  }
  async function controlEntity(entity, service, command) {
    const natural = {turn_off:'turn off ', open_cover:'open ', close_cover:'close '};
    const result = await callTool('/homeassistant/service', {domain:entity.domain, service, entity_id:entity.id});
    if (result.cancelled) return {text:'Cancelled. I left ' + entity.name + ' unchanged.'};
    const receiptId = ActionReceipts.begin(command || (natural[service] || 'turn on ') + entity.name, 'HOME_ASSISTANT', '', {repeatable:false});
    const done = (status, text, error) => {
      ActionReceipts.update(receiptId, {status, note:text});
      return {text, receiptId, error};
    };
    if (result.error || !result.success) {
      const reason = result.error || 'Home Assistant did not accept the action.';
      return done('failed', 'I could not control ' + entity.name + ': ' + reason, reason);
    }
    if (entity.domain === 'scene') return done('unverified', 'Scene activation sent. Home Assistant has no on/off state to check for ' + entity.name + '.');
    const expected = {turn_on:'on', turn_off:'off', open_cover:'open', close_cover:'closed'}[service];
    try {
      await new Promise(r => setTimeout(r, 600));
      const latest = await req('/homeassistant/entity/' + encodeURIComponent(entity.id));
      if (latest.state === expected) return done('verified', entity.name + ' is ' + latest.state + '.');
      return done('failed', 'I sent the command, but ' + entity.name + ' reports ' + latest.state + '.');
    } catch(e) {
      return done('unverified', 'I sent the command, but could not verify the device state: ' + e.message);
    }
  }
  async function runWithReceipt(command,intent,action,note,repeatable=false) {
    const id=ActionReceipts.begin(command,intent,'',{repeatable});
    try {
      const out = await action();
      if (!out?.success) throw new Error(out?.error || 'JARVIS did not accept the open request.');
      ActionReceipts.update(id, {status:'unverified', note:note || 'Open request accepted; the viewer was not checked.'});
      return out;
    }
    catch(e){ActionReceipts.update(id,{status:'failed',note:e.message});alert(e.message);return null;}
  }
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function localTasks() {
    const todos = store.get('jarvis.todos', []), deadlines = store.get('jarvis.deadlines', []), reminders = store.get('jarvis.reminders', []), classes = store.get('jarvis.classes', []);
    const now = new Date(), dayStart = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(), tomorrow = dayStart + 86400000;
    const agenda = [];
    for (const x of deadlines) if (!x.done && Number(x.due) >= dayStart && Number(x.due) < tomorrow) agenda.push({at:+x.due,label:'Deadline · '+x.title});
    for (const x of reminders) if (!x.fired && Number(x.at) >= Date.now() && Number(x.at) < tomorrow) agenda.push({at:+x.at,label:'Reminder · '+x.text});
    for (const x of classes) if (String(x.day).toLowerCase()===days[now.getDay()].toLowerCase() || +x.day===now.getDay()) { const at=new Date(now.getFullYear(),now.getMonth(),now.getDate(),+x.h||0,+x.m||0).getTime(); if(at>=Date.now())agenda.push({at,label:'Class · '+x.name}); }
    agenda.sort((a,b)=>a.at-b.at);
    const attendance=store.get('jarvis.attendance',{}), target=+(store.get('jarvis.settings',{}).attendanceMin||75);
    const attendanceRisk=Object.entries(attendance).map(([name,x])=>({name,pct:x.held?Math.round(100*x.attended/x.held):100})).sort((a,b)=>a.pct-b.pct)[0]||null;
    return {todos,deadlines,reminders,classes,agenda,dayStart,tomorrow,attendanceRisk,target};
  }
  async function renderToday() {
    const d = new Date(), data = localTasks();
    $('#todayDate').textContent=d.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'}).toUpperCase();
    const focus=store.get('jarvis.focusState',null), focusActive=!!(focus&&focus.end>Date.now());
    $('#todaySummary').innerHTML=[['OPEN TASKS',data.todos.filter(x=>!x.done).length],['DUE TODAY',data.deadlines.filter(x=>!x.done&&+x.due>=data.dayStart&&+x.due<data.tomorrow).length],['UP NEXT',data.agenda.length],['FOCUS',focusActive?Math.max(0,Math.ceil((focus.end-Date.now())/60000))+' MIN':'READY'],['ATTENDANCE',data.attendanceRisk?data.attendanceRisk.pct+'% · '+data.attendanceRisk.name:'NO DATA']].map(x=>'<article class="home-stat"><span>'+x[0]+'</span><b>'+esc(x[1])+'</b></article>').join('');
    const ag=$('#todayAgenda'); ag.replaceChildren();
    const entries=[...data.agenda,...data.todos.filter(x=>!x.done).slice(0,4).map(x=>({at:Infinity,label:'Task · '+x.text}))].slice(0,8);
    if(!entries.length){ag.innerHTML='<div class="home-empty">Nothing scheduled for the rest of today.</div>';}
    else for(const x of entries){const row=document.createElement('div');row.className='agenda-row';row.innerHTML='<time></time><span></span>';row.querySelector('time').textContent=Number.isFinite(x.at)?new Date(x.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'OPEN';row.querySelector('span').textContent=x.label;ag.appendChild(row);}
    try { const j=await req('/tool/systemInfo'); const values=[['CPU',j.cpuUsage==null?'—':Math.round(j.cpuUsage)+'%'],['MEMORY',j.memoryUsagePercent==null?'—':Math.round(j.memoryUsagePercent)+'%'],['DISK FREE',j.disk&&j.disk.freeGB!=null?j.disk.freeGB+' GB':'—'],['UPTIME',j.uptimeMin==null?'—':Math.floor(j.uptimeMin/60)+'h '+Math.round(j.uptimeMin%60)+'m']]; $('#todaySystem').innerHTML=values.map(x=>'<article class="home-stat"><span>'+x[0]+'</span><b>'+esc(x[1])+'</b></article>').join(''); } catch { $('#todaySystem').textContent='System status is unavailable.'; }
    renderCalendar(); renderHomeAssistant();
  }
  async function renderCalendar() {
    const el=$('#todayCalendar'); try { const s=await req('/calendar/status'); if(!s.configured){el.className='home-empty';el.textContent='Optional read-only calendar feed. Connect one in Settings.';return;} const j=await req('/calendar/events'); if(!j.events||!j.events.length){el.className='home-empty';el.textContent='No upcoming calendar events in the next 14 days.';return;} el.className='agenda-list';el.replaceChildren();for(const e of j.events.slice(0,6)){const row=document.createElement('div');row.className='agenda-row';const t=document.createElement('time');t.textContent=new Date(e.start).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});const s=document.createElement('span');s.textContent=e.title+(e.location?' · '+e.location:'');row.append(t,s);el.append(row);} } catch(e){el.className='home-empty';el.textContent=e.message;}
  }
  async function renderHomeAssistant() {
    const el=$('#todayHomeAssistant');try{const s=await req('/homeassistant/status');if(!s.configured){el.className='home-empty';el.textContent='Connect Home Assistant in Settings to see your devices.';return;}const j=await req('/homeassistant/entities');el.className='ha-entities';el.replaceChildren();if(!j.entities.length){el.textContent='Configured; no supported light, switch, sensor, fan or cover entities were found.';return;}for(const e of j.entities.slice(0,8)){const row=document.createElement('div');row.className='ha-row';const label=document.createElement('span');label.textContent=e.name+' · '+e.state+(e.attributes&&e.attributes.unit?' '+e.attributes.unit:'');const button=document.createElement('button');button.className='cbtn';button.textContent=e.domain==='sensor'?'READ ONLY':['light','switch','fan'].includes(e.domain)?(e.state==='on'?'TURN OFF':'TURN ON'):e.domain==='cover'?(e.state==='open'?'CLOSE':'OPEN'):'ACTIVATE';button.disabled=e.domain==='sensor';button.onclick=async()=>{const service=e.domain==='cover'?(e.state==='open'?'close_cover':'open_cover'):e.domain==='scene'?'turn_on':e.state==='on'?'turn_off':'turn_on';button.disabled=true;try{const result=await controlEntity(e,service);if(result.error)alert(result.text);else await renderHomeAssistant();}finally{button.disabled=false;}};row.append(label,button);el.append(row);}}catch(e){el.className='home-empty';el.textContent=e.message;}
  }
  function preview(src,title){let modal=$('#imagePreview');if(!modal){modal=document.createElement('div');modal.id='imagePreview';modal.className='image-preview';modal.innerHTML='<button aria-label="Close preview">✕</button><img alt=""><div></div>';document.body.append(modal);modal.querySelector('button').onclick=()=>modal.classList.remove('open');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open');};document.addEventListener('keydown',e=>{if(e.key==='Escape')modal.classList.remove('open');});}modal.querySelector('img').src=src;modal.querySelector('img').alt=title;modal.querySelector('div').textContent=title;modal.classList.add('open');}
  async function gallery() {
    const host=$('#galleryList');host.replaceChildren();let items=[];
    const add=async(path,fn)=>{try{const j=await req(path);items.push(...fn(j));}catch{}};
    await Promise.all([add('/room/images',j=>(j.images||[]).map(x=>({name:x.name,path:x.path,src:'/api/room/image?name='+encodeURIComponent(x.name),modified:x.modified}))),add('/shots/recent',j=>(j.images||[]).map(x=>({name:x.name,path:x.path,src:x.url,modified:x.modified}))),add('/tool/screenshots',j=>(j.screenshots||[]).map(x=>({name:x.name,path:x.path,src:'/api/tool/screenshots/'+x.id,modified:x.modified}))) ]);
    const unique=new Map();for(const x of items)if(!unique.has(x.path))unique.set(x.path,x);items=[...unique.values()].sort((a,b)=>b.modified-a.modified).slice(0,60);
    if(!items.length){host.innerHTML='<div class="home-empty">No recent images found. Room captures and JARVIS screenshots will appear here.</div>';return;}
    for(const x of items){const card=document.createElement('article');card.className='gallery-card';const img=document.createElement('img');img.loading='lazy';img.src=x.src;img.alt=x.name;img.onclick=()=>preview(x.src,x.name);const title=document.createElement('div');title.className='gallery-title';title.textContent=x.name;const when=document.createElement('time');when.textContent=new Date(x.modified).toLocaleString();const actions=document.createElement('div');actions.className='gallery-actions';const b=(label,fn)=>{const q=document.createElement('button');q.className='cbtn';q.textContent=label;q.onclick=fn;actions.appendChild(q);};b('PREVIEW',()=>preview(x.src,x.name));b('OPEN',()=>runWithReceipt('Open image '+x.name,'OPEN_IMAGE',()=>callTool('/tool/openFile',{name:x.path}),'Asked the default image viewer to open '+x.name+'.'));b('FOLDER',()=>{const p=x.path.replace(/[\\/][^\\/]+$/,'');return runWithReceipt('Open folder containing '+x.name,'OPEN_FOLDER',()=>callTool('/tool/openFolder',{name:p}),'Asked the file manager to open the image folder.');});card.append(img,title,when,actions);host.appendChild(card);}
  }
  async function saveCalendar(){const url=$('#calendarUrl').value.trim();try{await req('/calendar/config','PUT',{url});$('#calendarStatus').textContent='Connected · read-only events for the next 14 days.';$('#calendarUrl').value='';$('#calendarRemove').hidden=false;await renderCalendar();}catch(e){$('#calendarStatus').textContent=e.message;}}
  async function saveHA(){const url=$('#haUrl').value.trim(),token=$('#haToken').value.trim();try{await req('/homeassistant/config','PUT',{url,token});$('#haStatus').textContent='Connected · access token stored on this laptop.';$('#haToken').value='';$('#haRemove').hidden=false;await renderHomeAssistant();}catch(e){$('#haStatus').textContent=e.message;}}
  async function integrationStatus(){try{const c=await req('/calendar/status');$('#calendarRemove').hidden=!c.configured;$('#calendarStatus').textContent=c.configured?'Feed saved · '+(c.host||'private feed'):'Not connected';const h=await req('/homeassistant/status');$('#haRemove').hidden=!h.configured;$('#haStatus').textContent=h.configured?'Configured · '+h.url:'Not connected';if(h.configured)$('#haUrl').value=h.url;}catch{}}
  async function briefing(){const data=localTasks();let parts=[];const open=data.todos.filter(x=>!x.done);const due=data.deadlines.filter(x=>!x.done&&+x.due>=data.dayStart&&+x.due<data.tomorrow);const top=[...due.map(x=>x.title),...data.agenda.map(x=>x.label.replace(/^(?:Reminder|Class|Deadline) · /,'')),...open.map(x=>x.text)].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).slice(0,3);if(top.length)parts.push('Your top items today: '+top.join('; ')+'.');if(!top.length)parts.push('Your schedule is clear so far.');if(data.attendanceRisk&&data.attendanceRisk.pct<data.target)parts.push('Attendance needs attention: '+data.attendanceRisk.name+' is at '+data.attendanceRisk.pct+' percent, below your '+data.target+' percent target.');const prefs=store.get('jarvis.settings',{});if(prefs.online){try{const j=await req('/calendar/events');const today=(j.events||[]).filter(e=>new Date(e.start).toDateString()===new Date().toDateString());if(today.length)parts.push('Calendar: '+today.length+' event'+(today.length===1?'':'s')+' today: '+today.map(x=>x.title).join(', ')+'.');}catch{}try{const w=await req('/tool/weather','POST',{city:prefs.city||'',online:true});if(w.success)parts.push('Weather for '+w.place+': '+w.tempC+' degrees and '+String(w.desc||'').toLowerCase()+', with '+w.rainChance+' percent chance of rain.');}catch{}}const text=parts.join(' ');jarvisSay({text,intent:'DAILY_BRIEFING'});}
  async function scheduledBriefingCheck(){
    if (!settings.dailyBriefing || !settings.tts || !settings.dailyBriefingTime) return;
    const now=new Date(),[hour,minute]=settings.dailyBriefingTime.split(':').map(Number);
    if(!Number.isFinite(hour)||!Number.isFinite(minute))return;
    const due=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hour,minute);
    const late=now-due;if(late<0||late>10*60000)return;
    const day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    let claim;
    try { claim = await req('/claim', 'POST', {key:'daily-briefing:' + day}); }
    catch (e) { console.warn('Could not claim the daily briefing:', e.message); return; }
    if (claim.won) await briefing();
  }
  async function homeAssistantCommand(text) {
    const m=String(text||'').match(/^\s*(?:please\s+)?(turn\s+on|turn\s+off|toggle|switch\s+on|switch\s+off|open|close)\s+(?:the\s+)?(.+?)\s*[.!?]*\s*$/i); if(!m)return null;
    let status;try{status=await req('/homeassistant/status');}catch{return null;}if(!status.configured)return null;
    const action=m[1].toLowerCase(), wanted=m[2].toLowerCase().replace(/\b(light|lights|switch|switches|plug|plugs|fan|fans|cover|blinds?)\b/g,'').trim();
    const {entities=[]}=await req('/homeassistant/entities');const candidates=entities.filter(e=>{const hay=(e.name+' '+e.id).toLowerCase();return wanted&&(hay.includes(wanted)||wanted.split(/\s+/).every(w=>hay.includes(w)));});
    if(!candidates.length)return null;
    if(candidates.length!==1)return {handled:true,text:'I found more than one matching device. Please use a more specific name: '+candidates.slice(0,5).map(x=>x.name).join(', ')+'.'};
    const e=candidates[0], service=action==='open'?'open_cover':action==='close'?'close_cover':action.includes('off')?'turn_off':action==='toggle'?(e.state==='on'?'turn_off':'turn_on'):'turn_on';
    const allowed=(e.domain==='cover'&&['open_cover','close_cover'].includes(service))||(['light','switch','fan'].includes(e.domain)&&['turn_on','turn_off'].includes(service))||(e.domain==='scene'&&service==='turn_on');
    if(!allowed)return {handled:true,text:'That action is not supported for '+e.name+'.'};
    return {handled:true, ...await controlEntity(e, service, text), intent:'HOME_ASSISTANT'};
  }
  function setup(){
    const briefingToggle=$('#dailyBriefingToggle'),briefingTime=$('#dailyBriefingTime');briefingToggle.checked=!!settings.dailyBriefing;briefingTime.value=settings.dailyBriefingTime||'07:30';
    briefingToggle.onchange=()=>{settings.dailyBriefing=briefingToggle.checked;saveSettings();};briefingTime.onchange=()=>{settings.dailyBriefingTime=briefingTime.value||'07:30';saveSettings();};
    $('#galleryRefresh').onclick=gallery;$('#historyClear').onclick=()=>{if(confirm('Clear the command history receipts?')){for(const r of ActionReceipts.list())ActionReceipts.remove(r.id);ActionReceipts.render();}};
    $('#calendarSave').onclick=saveCalendar;$('#haSave').onclick=saveHA;
    $('#calendarRemove').onclick=async()=>{await req('/calendar/config','DELETE');$('#calendarUrl').value='';$('#calendarStatus').textContent='Disconnected';$('#calendarRemove').hidden=true;await renderCalendar();};
    $('#haRemove').onclick=async()=>{await req('/homeassistant/config','DELETE');$('#haUrl').value='';$('#haToken').value='';$('#haStatus').textContent='Disconnected';$('#haRemove').hidden=true;await renderHomeAssistant();};
    $('#briefingBtn').onclick=briefing;$('#calendarSettingsBtn').onclick=$('#haSettingsBtn').onclick=()=>{document.getElementById('settingsBtn').click();};
    document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>document.querySelector('.tab[data-tab="'+b.dataset.goto+'"]').click());
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tab==='today')renderToday();if(b.dataset.tab==='images')gallery();if(b.dataset.tab==='history')ActionReceipts.render();}));
    document.addEventListener('jarvis:receipt',ev=>{const r=ev.detail,el=document.querySelector('.action-receipt[data-receipt-id="'+CSS.escape(r.id)+'"]');if(el){const badge=el.querySelector('.receipt-status');if(badge){badge.className='receipt-status '+r.status;badge.textContent=r.status.toUpperCase();}const note=el.querySelector('.receipt-note');if(note)note.textContent=r.note;}});
    document.addEventListener('jarvis:receipt',()=>{if(document.querySelector('.tab[data-tab="today"]')?.classList.contains('active'))renderToday();});
    setInterval(()=>{if(document.querySelector('.tab[data-tab="today"]')?.classList.contains('active'))renderToday();},60000);
    setInterval(scheduledBriefingCheck,60000);scheduledBriefingCheck();
    integrationStatus();ActionReceipts.render();renderToday();
  }
  window.HomeAssistant={handleCommand:homeAssistantCommand};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
