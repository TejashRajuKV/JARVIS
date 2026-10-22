'use strict';
/* Skill Hub: one place for skill discovery, explicit enable/disable, workflow templates,
   safe browser recovery, and read-only diagnostics. Saved workflows are inserted into chat but never auto-run. */
(() => {
  if (window.__JARVIS_SKILL_HUB__) return;
  window.__JARVIS_SKILL_HUB__ = true;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json = async (url, options={}) => {
    const r=await fetch(url,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    let data={}; try{data=await r.json();}catch{}
    if(!r.ok) throw new Error(data.error||('HTTP '+r.status));
    return data;
  };
  const styles = document.createElement('style');
  styles.textContent = `
  #jarvisHubOpen{position:fixed;right:18px;bottom:18px;z-index:9000;border:1px solid #3fd9ff99;border-radius:999px;padding:11px 16px;background:#061522f2;color:#b0f3ff;font:600 12px ui-monospace,monospace;letter-spacing:.08em;box-shadow:0 0 22px #3fd9ff22}
  #jarvisHubShade{position:fixed;inset:0;z-index:9001;background:#02070cbb;backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:18px}
  #jarvisHubShade.open{display:flex}
  #jarvisHub{width:min(900px,100%);max-height:min(88vh,900px);overflow:hidden;display:flex;flex-direction:column;background:#06131ff7;border:1px solid #3fd9ff66;border-radius:14px;box-shadow:0 20px 80px #000b;color:#e2f7ff;font:14px system-ui,sans-serif}
  #jarvisHub *{box-sizing:border-box} #jarvisHub button,#jarvisHub input,#jarvisHub textarea{font:inherit}
  .jh-head{display:flex;align-items:center;justify-content:space-between;padding:17px 20px;border-bottom:1px solid #3fd9ff33}
  .jh-head h2{font:700 18px ui-monospace,monospace;letter-spacing:.12em;color:#b0f3ff;margin:0}
  .jh-head p{font-size:12px;color:#8aa9bd;margin:5px 0 0}
  .jh-x,.jh-tab,.jh-btn{border:1px solid #3fd9ff44;border-radius:7px;padding:8px 11px;background:#071b2a;color:#ccefff;cursor:pointer}
  .jh-tabs{display:flex;gap:7px;padding:12px 18px;border-bottom:1px solid #3fd9ff22;flex-wrap:wrap}
  .jh-tab[aria-selected=true]{background:#0d3b50;border-color:#3fd9ff;color:#fff}
  .jh-content{overflow:auto;padding:16px 18px 22px}
  .jh-muted{color:#8aa9bd;font-size:12px;line-height:1.5}.jh-row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:13px 0;border-bottom:1px solid #3fd9ff1c}
  .jh-row:last-child{border-bottom:0}.jh-title{font-weight:650;color:#e2f7ff;overflow-wrap:anywhere}.jh-meta{font-size:12px;color:#8aa9bd;margin-top:4px;line-height:1.5;overflow-wrap:anywhere}
  .jh-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.jh-btn{font-size:12px!important;white-space:nowrap}.jh-btn.primary{border-color:#3fd9ff99;background:#0b3042}.jh-btn.danger{border-color:#ff5f6b66;color:#ffb8bd}
  .jh-field{width:100%;border:1px solid #3fd9ff44;border-radius:7px;background:#020b12;color:#e2f7ff;padding:10px;margin:6px 0 12px;min-width:0}
  .jh-label{font-size:11px;color:#8aa9bd;letter-spacing:.08em;text-transform:uppercase}
  .jh-form{max-width:100%;border:1px solid #3fd9ff28;border-radius:9px;padding:13px;margin-bottom:16px}
  .jh-pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#020b12;border:1px solid #3fd9ff22;border-radius:7px;padding:11px;margin-top:10px;font:12px/1.5 ui-monospace,monospace;max-height:260px;overflow:auto}
  .jh-badge{font:10px ui-monospace,monospace;border:1px solid #3fd9ff33;border-radius:99px;padding:3px 7px;color:#8eeaff}
  .jh-badge.off{border-color:#ffb84d55;color:#ffcf87}.jh-check{accent-color:#3fd9ff;width:17px;height:17px}
  .jh-empty{padding:25px 10px;text-align:center;color:#8aa9bd}.jh-note{padding:11px;border-left:3px solid #ffb84d;background:#ffb84d0b;color:#d5dbe1;font-size:12px;line-height:1.6;margin:10px 0}
  @media(max-width:600px){#jarvisHubOpen{right:10px;bottom:10px;padding:10px 12px}#jarvisHubShade{padding:6px}#jarvisHub{max-height:94vh}.jh-head{padding:13px}.jh-content{padding:12px}.jh-row{gap:8px}.jh-actions{max-width:46%}}
  `;
  document.head.appendChild(styles);
  const openBtn=document.createElement('button'); openBtn.id='jarvisHubOpen';openBtn.type='button';openBtn.textContent='✦ SKILL HUB';
  openBtn.setAttribute('aria-haspopup','dialog');openBtn.setAttribute('aria-controls','jarvisHub');
  const shade=document.createElement('div');shade.id='jarvisHubShade';shade.innerHTML=`
    <section id="jarvisHub" role="dialog" aria-modal="true" aria-labelledby="jhTitle">
      <header class="jh-head"><div><h2 id="jhTitle">JARVIS SKILL HUB</h2><p>Manage skills · recover pages · reuse saved workflows · diagnose issues</p></div><button class="jh-x" data-action="close" aria-label="Close Skill Hub">✕</button></header>
      <nav class="jh-tabs" role="tablist">
        <button class="jh-tab" data-tab="skills" aria-selected="true">Skills</button>
        <button class="jh-tab" data-tab="browser" aria-selected="false">Browser recovery</button>
        <button class="jh-tab" data-tab="workflows" aria-selected="false">Workflow memory</button>
        <button class="jh-tab" data-tab="diagnostics" aria-selected="false">Diagnostics</button>
      </nav>
      <div class="jh-content" id="jhContent" tabindex="0"><div class="jh-empty">Loading Skill Hub…</div></div>
    </section>`;
  document.body.append(openBtn,shade);
  let tab='skills',skills=[],pages=[],workflows=[],search='',busy=false;
  const content=()=>document.getElementById('jhContent');
  const setTab=t=>{tab=t;shade.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===t)));render();};
  const msg=(text,bad=false)=>{const el=document.createElement('div');el.className='jh-note';el.style.borderLeftColor=bad?'#ff5f6b':'#54ffa8';el.textContent=text;content().prepend(el);};
  async function loadSkills(){const r=await json('/api/skills?all=1');skills=r.skills||[];}
  async function loadPages(){const r=await json('/api/browser-recovery');pages=r.pages||[];}
  async function loadWorkflows(){const r=await json('/api/workflows');workflows=r.workflows||[];}
  function skillView(){const filtered=skills.filter(s=>(s.name+' '+s.hint+' '+(s.keywords||[]).join(' ')).toLowerCase().includes(search.toLowerCase()));
    return `<div class="jh-muted">Skills are prompt instructions, not executable plugins. Disabled skills are excluded from routing and cannot be run. Changes persist locally.</div>
      <input class="jh-field" id="jhSearch" aria-label="Search skills" placeholder="Search skills by name, purpose, or keyword…" value="${esc(search)}">
      <div class="jh-actions" style="justify-content:flex-start;margin-bottom:12px"><button class="jh-btn" data-action="reload-skills">↻ Rescan skills</button><span class="jh-badge">${skills.filter(s=>s.enabled!==false).length} ENABLED / ${skills.length} TOTAL</span></div>
      ${filtered.length?filtered.map(s=>`<article class="jh-row"><div style="flex:1;min-width:0"><div class="jh-title">${esc(s.name)} <span class="jh-badge ${s.enabled===false?'off':''}">${s.enabled===false?'DISABLED':esc(s.source||'skill')}</span></div><div class="jh-meta">${esc(s.hint||'No description')}</div><div class="jh-meta">Triggers: ${esc((s.triggers||[]).join(' · ')||'None')} ${s.uses?' · Uses: '+esc(s.uses):''}</div>
      <textarea class="jh-field" data-skill-input="${esc(s.name)}" rows="2" maxlength="14000" placeholder="What should this skill work on?"></textarea><div class="jh-pre" data-skill-output="${esc(s.name)}" hidden></div></div>
      <div class="jh-actions" style="min-width:90px"><label class="jh-muted" style="display:flex;align-items:center;gap:6px"><input class="jh-check" type="checkbox" data-enabled="${esc(s.name)}" ${s.enabled!==false?'checked':''}> Enabled</label><button class="jh-btn primary" data-action="run-skill" data-name="${esc(s.name)}" ${s.enabled===false?'disabled':''}>Run</button></div></article>`).join(''):'<div class="jh-empty">No skills match this search.</div>'}
      ${skills.some(s=>s.truncated)?'<div class="jh-note">Some skill instructions were shortened to fit the local model context. Review those skill files if output quality is poor.</div>':''}
      <div class="jh-muted">Folder: ${esc((skills[0]&&skills[0].source)||'bundled and local skills')} · Skill files are rescanned from the existing bundled and user skill directories.</div>`;
  }
  function browserView(){return `<div class="jh-note">Safety: JARVIS records only web pages opened through JARVIS. It does not read your full browser history or send Ctrl+Shift+T to whichever window happens to be active. URLs stay in your local JARVIS data folder; sensitive query parameters are removed before saving.</div>
      <div class="jh-actions" style="justify-content:flex-start;margin-bottom:10px"><button class="jh-btn" data-action="refresh-pages">↻ Refresh</button><button class="jh-btn danger" data-action="clear-pages">Clear recovery list</button></div>
      ${pages.length?pages.map(p=>`<article class="jh-row"><div style="flex:1;min-width:0"><div class="jh-title">${esc(p.title||new URL(p.url).hostname)}</div><div class="jh-meta">${esc(p.url)}<br>Opened ${esc(new Date(p.openedAt).toLocaleString())}</div></div><button class="jh-btn primary" data-action="open-page" data-id="${esc(p.id)}">Reopen page</button></article>`).join(''):'<div class="jh-empty">No JARVIS-opened pages recorded yet. Pages you open using JARVIS will appear here.</div>'}
      <h3 style="margin:18px 0 6px">Restore a tab closed in Chrome or Edge</h3><p class="jh-muted">1. Switch to the intended browser window yourself. 2. Confirm that window is focused. 3. Press <b>Ctrl+Shift+T</b> manually; repeat to restore earlier tabs. JARVIS intentionally does not send this global shortcut because it could affect the wrong app.</p>`;
  }
  function workflowView(){return `<div class="jh-muted">Workflow memory stores only workflows you explicitly save. A workflow is a reusable prompt template, not a macro; using it fills the chat box and never runs it automatically. No mood or emotion profile is created.</div>
      <form class="jh-form" id="jhWorkflowForm"><div class="jh-label">Workflow name</div><input class="jh-field" name="name" maxlength="60" required placeholder="e.g. Review my project before a release"><div class="jh-label">Reusable instructions</div><textarea class="jh-field" name="prompt" rows="4" maxlength="1800" required placeholder="Describe the steps or checklist JARVIS should help with…"></textarea><button class="jh-btn primary" type="submit">＋ Save workflow</button></form>
      ${workflows.length?workflows.map(w=>`<article class="jh-row"><div style="flex:1;min-width:0"><div class="jh-title">${esc(w.name)}</div><div class="jh-meta">${esc(w.prompt)}<br>Saved ${esc(new Date(w.updatedAt).toLocaleString())}</div></div><div class="jh-actions"><button class="jh-btn primary" data-action="use-workflow" data-id="${esc(w.id)}">Use in chat</button><button class="jh-btn danger" data-action="delete-workflow" data-id="${esc(w.id)}">Delete</button></div></article>`).join(''):'<div class="jh-empty">No saved workflows yet. Save a repeatable process above.</div>'}
      <div class="jh-actions" style="justify-content:flex-start;margin-top:12px"><button class="jh-btn danger" data-action="clear-workflows">Delete all workflows</button></div>`;
  }
  function diagnosticsView(){return `<div class="jh-muted">Read-only checks of JARVIS files, runtime, voice modules, automation modules, local storage and Ollama reachability. This does not execute repair commands or change settings.</div><div class="jh-actions" style="justify-content:flex-start;margin:12px 0"><button class="jh-btn primary" data-action="diagnose">Run diagnostics</button></div><div id="jhDiagnostics"><div class="jh-empty">Press Run diagnostics to inspect the current installation.</div></div>`;}
  function render(){if(!shade.classList.contains('open'))return;content().innerHTML=tab==='skills'?skillView():tab==='browser'?browserView():tab==='workflows'?workflowView():diagnosticsView();}
  async function refreshCurrent(){try{if(tab==='skills')await loadSkills();if(tab==='browser')await loadPages();if(tab==='workflows')await loadWorkflows();render();}catch(e){content().innerHTML='<div class="jh-note">'+esc(e.message)+'</div>';}}
  function show(){shade.classList.add('open');document.body.style.overflow='hidden';refreshCurrent();const b=shade.querySelector('.jh-x');if(b)b.focus();}
  function hide(){shade.classList.remove('open');document.body.style.overflow='';openBtn.focus();}
  openBtn.addEventListener('click',show);
  shade.addEventListener('click',async e=>{
    if(e.target===shade){hide();return;}
    const tabBtn=e.target.closest('[data-tab]');if(tabBtn){setTab(tabBtn.dataset.tab);refreshCurrent();return;}
    const action=e.target.closest('[data-action]');if(!action)return;
    const a=action.dataset.action;
    try{
      if(a==='close'){hide();return;}
      if(a==='reload-skills'){await json('/api/skills/reload',{method:'POST',body:'{}'});if(window.Skills&&typeof Skills.loadPacks==='function')await Skills.loadPacks();await loadSkills();render();msg('Skills rescanned.');return;}
      if(a==='run-skill'){
        const name=action.dataset.name,field=shade.querySelector('[data-skill-input="'+CSS.escape(name)+'"]'),out=shade.querySelector('[data-skill-output="'+CSS.escape(name)+'"]');
        const input=field&&field.value.trim();if(!input){msg('Enter a task for this skill first.',true);field&&field.focus();return;}
        action.disabled=true;action.textContent='Working…';
        try{const r=await json('/api/skill/run',{method:'POST',body:JSON.stringify({skill:name,input})});out.hidden=false;out.textContent=r.text||'(No text returned)';}
        finally{action.disabled=false;action.textContent='Run';}
        return;
      }
      if(a==='refresh-pages'){await loadPages();render();return;}
      if(a==='open-page'){const r=await json('/api/browser-recovery/open/'+encodeURIComponent(action.dataset.id),{method:'POST',body:'{}'});msg('Reopen requested: '+r.url);return;}
      if(a==='clear-pages'){if(!confirm('Clear the locally saved JARVIS-opened page list? This does not close browser tabs.'))return;await json('/api/browser-recovery',{method:'DELETE'});await loadPages();render();return;}
      if(a==='use-workflow'){const w=workflows.find(x=>x.id===action.dataset.id);if(!w)throw new Error('Workflow not found');const input=document.getElementById('chatInput');if(!input)throw new Error('Chat input is unavailable');input.value=w.prompt;input.focus();hide();return;}
      if(a==='delete-workflow'){if(!confirm('Delete this saved workflow?'))return;await json('/api/workflows/'+encodeURIComponent(action.dataset.id),{method:'DELETE'});await loadWorkflows();render();return;}
      if(a==='clear-workflows'){if(!workflows.length)return;if(!confirm('Delete all saved workflows?'))return;await json('/api/workflows',{method:'DELETE'});await loadWorkflows();render();return;}
      if(a==='diagnose'){const box=document.getElementById('jhDiagnostics');box.innerHTML='<div class="jh-empty">Checking…</div>';const r=await json('/api/diagnostics');box.innerHTML='<div class="jh-badge">'+r.summary.passed+' / '+r.summary.total+' CHECKS PASSED</div>'+r.checks.map(c=>'<article class="jh-row"><div style="flex:1"><div class="jh-title">'+(c.ok?'✓ ':'✕ ')+esc(c.name)+'</div><div class="jh-meta">'+esc(c.detail)+'</div></div><span class="jh-badge '+(c.ok?'':'off')+'">'+(c.ok?'OK':'CHECK')+'</span></article>').join('')+(r.recommendations.length?'<h3 style="margin-top:16px">Recommended actions</h3>'+r.recommendations.map(x=>'<div class="jh-note"><b>'+esc(x.name)+':</b> '+esc(x.action)+'</div>').join(''):'<div class="jh-note">No missing files or immediate local-provider issues were detected by these checks.</div>');return;}
    }catch(err){msg(err.message||String(err),true);}
  });
  shade.addEventListener('change',async e=>{
    const c=e.target.closest('[data-enabled]');if(!c)return;
    const name=c.dataset.enabled;c.disabled=true;
    try{await json('/api/skills/'+encodeURIComponent(name)+'/enabled',{method:'POST',body:JSON.stringify({enabled:c.checked})});if(window.Skills&&typeof Skills.loadPacks==='function')await Skills.loadPacks();await loadSkills();render();msg(name+(c.checked?' enabled.':' disabled.'));}
    catch(err){c.checked=!c.checked;msg(err.message,true);}finally{c.disabled=false;}
  });
  shade.addEventListener('input',e=>{if(e.target.id==='jhSearch'){const pos=e.target.selectionStart;search=e.target.value;const val=search;render();const next=document.getElementById('jhSearch');if(next){next.focus();next.setSelectionRange(pos,pos);}}});
  shade.addEventListener('submit',async e=>{
    if(e.target.id!=='jhWorkflowForm')return;e.preventDefault();const fd=new FormData(e.target);
    try{await json('/api/workflows',{method:'POST',body:JSON.stringify({name:fd.get('name'),prompt:fd.get('prompt')})});await loadWorkflows();render();msg('Workflow saved locally. It will only run when you choose to use it and send the prompt.');}
    catch(err){msg(err.message,true);}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shade.classList.contains('open'))hide();if(e.key==='Tab'&&shade.classList.contains('open')){const f=[...shade.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')].filter(x=>x.offsetParent!==null);if(!f.length)return;const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
})();
