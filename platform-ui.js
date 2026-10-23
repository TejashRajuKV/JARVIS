'use strict';
(() => {
  if (window.__JARVIS_PLATFORM_UI__) return;
  window.__JARVIS_PLATFORM_UI__ = true;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url, options = {}) {
    const r = await fetch(url, { cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data.message || data.error || ('HTTP ' + r.status));
    return data;
  }
  const style = document.createElement('style');
  style.textContent = `
  #jarvisPlatformOpen{position:fixed;left:18px;bottom:18px;z-index:8998;border:1px solid #3fd9ff88;border-radius:999px;padding:11px 15px;background:#061522f2;color:#b0f3ff;font:600 11px ui-monospace,monospace;letter-spacing:.08em;box-shadow:0 0 20px #3fd9ff20;cursor:pointer}
  #jarvisPlatformShade{position:fixed;inset:0;z-index:8999;background:#02070cbb;backdrop-filter:blur(7px);display:none;align-items:center;justify-content:center;padding:16px}
  #jarvisPlatformShade.open{display:flex} #jarvisPlatform{width:min(850px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;background:#06131ff7;border:1px solid #3fd9ff66;border-radius:14px;color:#e2f7ff;font:14px system-ui,sans-serif;box-shadow:0 20px 80px #000b}
  #jarvisPlatform *{box-sizing:border-box} .jp-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #3fd9ff33}
  .jp-head h2{font:700 16px ui-monospace,monospace;letter-spacing:.1em;margin:0;color:#b0f3ff}.jp-tabs{display:flex;gap:7px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #3fd9ff22}
  .jp-btn{border:1px solid #3fd9ff44;border-radius:7px;padding:8px 11px;background:#071b2a;color:#ccefff;cursor:pointer;font:inherit}.jp-btn[aria-selected=true]{background:#0d3b50;border-color:#3fd9ff}
  .jp-content{padding:16px;overflow:auto}.jp-label{display:block;color:#8aa9bd;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:10px 0 5px}
  .jp-field{display:block;width:100%;border:1px solid #3fd9ff44;border-radius:7px;background:#020b12;color:#e2f7ff;padding:10px;font:13px/1.5 ui-monospace,monospace;min-width:0}
  .jp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.jp-card{border:1px solid #3fd9ff28;border-radius:8px;padding:12px;margin:10px 0;overflow-wrap:anywhere}
  .jp-muted{color:#8aa9bd;font-size:12px;line-height:1.5}.jp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.jp-status{min-height:20px;color:#b0f3ff;font-size:12px;margin-top:10px;white-space:pre-wrap}
  @media(max-width:600px){.jp-grid{grid-template-columns:1fr}#jarvisPlatformOpen{bottom:68px}}
  `;
  document.head.appendChild(style);
  const button = document.createElement('button'); button.id = 'jarvisPlatformOpen'; button.textContent = 'AGENT PLATFORM';
  button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-controls','jarvisPlatformShade');
  const shade = document.createElement('div'); shade.id = 'jarvisPlatformShade'; shade.innerHTML = `
  <section id="jarvisPlatform" role="dialog" aria-modal="true" aria-labelledby="jpTitle">
    <header class="jp-head"><div><h2 id="jpTitle">JARVIS AGENT PLATFORM</h2><div class="jp-muted">Local research, workflow validation, and audit trail</div></div><button class="jp-btn" data-close aria-label="Close">✕</button></header>
    <nav class="jp-tabs" aria-label="Platform sections"><button class="jp-btn" data-tab="research" aria-selected="true">Research notebook</button><button class="jp-btn" data-tab="workflow" aria-selected="false">Workflow planner</button><button class="jp-btn" data-tab="audit" aria-selected="false">Audit trail</button></nav>
    <div class="jp-content" id="jpContent"></div>
  </section>`;
  document.body.append(button, shade);
  const content = shade.querySelector('#jpContent');
  const status = msg => { let el = content.querySelector('.jp-status'); if (el) el.textContent = msg; };
  const tabs = () => [...shade.querySelectorAll('[data-tab]')];
  let active = 'research';
  async function renderResearch() {
    content.innerHTML = `
      <form id="jpResearchForm"><div class="jp-grid"><div><label class="jp-label" for="jpQuestion">Research question *</label><textarea class="jp-field" id="jpQuestion" rows="2" required maxlength="1200" placeholder="What are you investigating?"></textarea></div><div><label class="jp-label" for="jpTitleInput">Title</label><input class="jp-field" id="jpTitleInput" maxlength="180" placeholder="Optional short title"></div></div>
      <label class="jp-label" for="jpSummary">Findings / notes</label><textarea class="jp-field" id="jpSummary" rows="3" maxlength="5000" placeholder="Save your findings and conclusions"></textarea>
      <label class="jp-label" for="jpSources">Source URLs (one per line)</label><textarea class="jp-field" id="jpSources" rows="2" placeholder="https://example.com/paper"></textarea>
      <div class="jp-actions"><button class="jp-btn" type="submit">Save research session</button><button class="jp-btn" type="button" id="jpReloadResearch">Refresh</button></div><div class="jp-status" aria-live="polite"></div></form>
      <h3>Saved sessions</h3><div id="jpSessions" class="jp-muted">Loading…</div>`;
    content.querySelector('#jpResearchForm').addEventListener('submit', async e => {
      e.preventDefault(); const form = e.currentTarget; const question = content.querySelector('#jpQuestion').value.trim();
      const sources = content.querySelector('#jpSources').value.split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => ({url}));
      try { await api('/api/research/sessions',{method:'POST',body:JSON.stringify({question,title:content.querySelector('#jpTitleInput').value,summary:content.querySelector('#jpSummary').value,sources})}); form.reset(); await loadSessions(); status('Research session saved locally. Unsafe URLs are discarded.'); }
      catch(err){status(err.message);}
    });
    content.querySelector('#jpReloadResearch').addEventListener('click', loadSessions);
    await loadSessions();
  }
  async function loadSessions() {
    const target=content.querySelector('#jpSessions'); if(!target)return;
    try { const data=await api('/api/research/sessions'); target.innerHTML=data.sessions.length?data.sessions.map(s=>`
      <article class="jp-card"><strong>${esc(s.title)}</strong><div class="jp-muted">${new Date(s.createdAt).toLocaleString()} · ${s.sources.length} source(s)</div><p>${esc(s.question)}</p>${s.summary?`<p>${esc(s.summary)}</p>`:''}<div class="jp-muted">${s.sources.map(src=>`<div>${esc(src.title)} — ${esc(src.url)}</div>`).join('')}</div><div class="jp-actions"><button class="jp-btn" data-delete="${esc(s.id)}">Delete</button></div></article>`).join(''):'<p class="jp-muted">No saved research sessions yet.</p>';
      target.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',async()=>{try{await api('/api/research/sessions/'+encodeURIComponent(b.dataset.delete),{method:'DELETE'});await loadSessions();}catch(err){status(err.message);}}));
    } catch(err){target.textContent='Could not load sessions: '+err.message;}
  }
  async function renderWorkflow() {
    content.innerHTML = `<p class="jp-muted">Validate dependencies and permission tiers before execution. This endpoint validates a plan only; it does not execute commands.</p>
      <label class="jp-label" for="jpWorkflowJson">Workflow JSON</label><textarea class="jp-field" id="jpWorkflowJson" rows="12" spellcheck="false">${esc(JSON.stringify({steps:[{id:'read_docs',label:'Read documentation',tier:'safe',readOnly:true},{id:'read_tests',label:'Read tests',tier:'safe',readOnly:true},{id:'change',label:'Apply change',tier:'confirm',dependsOn:['read_docs','read_tests']},{id:'verify',label:'Verify result',tier:'safe',readOnly:true,dependsOn:['change']}]},null,2))}</textarea>
      <div class="jp-actions"><button class="jp-btn" id="jpValidate">Validate workflow</button></div><div class="jp-status" id="jpWorkflowResult" aria-live="polite"></div>`;
    content.querySelector('#jpValidate').addEventListener('click',async()=>{
      const out=content.querySelector('#jpWorkflowResult');
      try{const body=JSON.parse(content.querySelector('#jpWorkflowJson').value);const r=await api('/api/workflows/validate',{method:'POST',body:JSON.stringify(body)});out.textContent=JSON.stringify(r.plan,null,2);}
      catch(err){out.textContent=err.message;}
    });
  }
  async function renderAudit() {
    content.innerHTML='<div class="jp-actions"><button class="jp-btn" id="jpRefreshAudit">Refresh audit trail</button></div><div class="jp-muted" id="jpAudit">Loading…</div>';
    const load=async()=>{const target=content.querySelector('#jpAudit');try{const d=await api('/api/audit/events?limit=100');target.innerHTML=d.events.length?d.events.map(e=>`<article class="jp-card"><strong>${esc(e.category)} · ${esc(e.action)}</strong><div class="jp-muted">${new Date(e.at).toLocaleString()} · ${esc(e.outcome)}${e.runId?' · '+esc(e.runId):''}</div></article>`).join(''):'No audit events yet.';}catch(e){target.textContent=e.message;}};
    content.querySelector('#jpRefreshAudit').addEventListener('click',load);await load();
  }
  async function show(tab) {
    active=tab; tabs().forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
    try { if(tab==='research') await renderResearch(); else if(tab==='workflow') await renderWorkflow(); else await renderAudit(); }
    catch(e){content.textContent='Could not open section: '+e.message;}
  }
  button.addEventListener('click',()=>{shade.classList.add('open');show(active);});
  shade.querySelector('[data-close]').addEventListener('click',()=>shade.classList.remove('open'));
  shade.addEventListener('click',e=>{if(e.target===shade)shade.classList.remove('open');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shade.classList.contains('open'))shade.classList.remove('open');});
  tabs().forEach(b=>b.addEventListener('click',()=>show(b.dataset.tab)));
})();
