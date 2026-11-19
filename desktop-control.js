'use strict';
window.DesktopControl = (() => {
  const select = $('#desktopWindows'), status = $('#desktopStatus'), host = $('#desktopControls');
  let windows = [], snapshot, acting = false, reading = false;
  const resultText = result => result.error || (result.cancelled ? 'Cancelled.' : result.note);
  async function refresh() {
    if (acting || reading) return;
    reading = true; snapshot = null; host.replaceChildren();
    try {
      const result = await getJSON('/desktop/windows');
      windows = result.windows || [];
      select.replaceChildren(new Option('Choose a window', ''));
      for (const window of windows) select.add(new Option(window.title + ' · ' + window.app, window.id));
      status.textContent = result.error || (windows.length ? 'Choose the application to inspect.' : 'No accessible windows were found.');
      return result;
    } finally { reading = false; }
  }
  async function inspect(id = select.value) {
    if (acting || reading) return { error:'Wait for the current app operation.' };
    if (!id) return { error:'Choose a window first.' };
    reading = true; snapshot = null; host.replaceChildren();
    status.textContent = 'Reading the selected window…';
    try {
      const result = await callTool('/desktop/inspect', { windowId:id });
      if (!result.error) { snapshot = result; render(); }
      status.textContent = result.error || ('Found ' + result.controls.length + ' controls in ' + result.title + '.' +
        (result.truncated ? ' More controls are outside this inspection.' : ''));
      return result;
    } finally { reading = false; }
  }
  async function action(control, kind, value) {
    if (acting || reading) return { text:'Wait for the current app operation.' };
    if (!snapshot || snapshot.expiresAt <= Date.now() || !snapshot.controls.includes(control))
      return { text:'Inspect the window again before acting.' };
    const selected = snapshot;
    acting = true;
    const label = kind.charAt(0).toUpperCase()+kind.slice(1)+' ';
    const receipt = ActionReceipts.begin(label + (control.name || control.type) + ' in ' + selected.title, 'DESKTOP_CONTROL', '', {repeatable:false});
    try {
      switchTab('chat');
      const result = await callTool('/desktop/action', {
        snapshotId:selected.snapshotId, controlId:control.id, action:kind, ...(['fill','toggle','scroll'].includes(kind) ? {value} : {}),
      });
      if (!result.cancelled) { snapshot = null; host.replaceChildren(); }
      const text = resultText(result) || 'The application returned no result.';
      status.textContent = text;
      ActionReceipts.update(receipt, {
        status:result.error || result.cancelled ? 'failed' : result.verified ? 'verified' : 'unverified', note:text,
      });
      return { text, receiptId:receipt, noTTS:true, ...(result.error ? {error:result.error} : {}),
        ...(result.cancelled ? {cancelled:true} : {}),
        ...(result.success ? {op:{kind:'desktop',verified:result.verified === true,note:text}} : {}) };
    } finally { acting = false; }
  }
  function render() {
    host.replaceChildren();
    for (const [index, control] of snapshot.controls.entries()) {
      const row = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = (index + 1) + '. ' + (control.name || '(unnamed)') + ' · ' + control.type.replace(/^ControlType\./, '');
      row.append(title);
      for(const [enabled,kind,values]of [[control.canSelect,'select',['']],[control.canToggle,'toggle',['on','off']],[control.canExpand,'expand',['']],[control.canExpand,'collapse',['']],[control.canScroll,'scroll',['up','down','left','right']]]) {
        if(!enabled)continue;
        for(const value of values){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Review '+kind+(value?' '+value:'');button.onclick=()=>void action(control,kind,value).then(jarvisSay);row.append(button);}
      }
      if (control.canClick) {
        const click = document.createElement('button'); click.type = 'button'; click.className = 'btn'; click.textContent = 'Review click';
        click.onclick = () => void action(control, 'click').then(jarvisSay);
        row.append(click);
      }
      if (control.canFill) {
        const form = document.createElement('form'); form.className = 'daily-actions';
        const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 2000;
        input.setAttribute('aria-label', 'Text for ' + (control.name || 'control ' + (index + 1)));
        const fill = document.createElement('button'); fill.type = 'submit'; fill.className = 'btn'; fill.textContent = 'Review fill';
        form.onsubmit = event => { event.preventDefault(); void action(control, 'fill', input.value).then(jarvisSay); };
        form.append(input, fill); row.append(form);
      }
      host.append(row);
    }
  }
  function findControl(name) {
    if (!snapshot) return { error:'Inspect the application window first.' };
    const numbered = /^control (\d+)$/i.exec(name);
    const candidates = numbered ? [snapshot.controls[Number(numbered[1]) - 1]].filter(Boolean)
      : snapshot.controls.filter(control => control.name.toLowerCase() === name.toLowerCase());
    if (candidates.length !== 1) return { error:candidates.length ? 'Several controls have that name. Use the control number shown in Apps.' : 'No control has that exact name. Inspect the window again or use a listed control number.' };
    return { control:candidates[0] };
  }
  async function inspectNamed(name) {
    const refreshed = await refresh();
    if (refreshed?.error) return {text:refreshed.error, error:refreshed.error};
    const wanted = name.toLowerCase();
    const candidates = windows.filter(item => item.title.toLowerCase() === wanted || item.app.toLowerCase() === wanted || item.title.toLowerCase().includes(wanted));
    openDailyPane('desktop');
    if (candidates.length !== 1) return {text:candidates.length ? 'Several windows match. Choose one in Apps.' : 'No matching window. Choose an open application in Apps.', absent:true};
    select.value = candidates[0].id;
    const result = await inspect(candidates[0].id);
    if (result.error) return {text:result.error,error:result.error};
    return {text:status.textContent + '\n' + result.controls.map((item,i) =>
      (i+1) + '. ' + (item.name || '(unnamed)') + ' · ' + item.type.replace(/^ControlType\./,'')).join('\n'),noTTS:true};
  }
  async function run(intent, args = {}) {
    if (intent === 'DESKTOP_WINDOWS') {
      openDailyPane('desktop');
      const result = await refresh();
      return result?.error ? {text:result.error,error:result.error} : {
        text:windows.length ? windows.map(item => '- ' + item.title + ' · ' + item.app).join('\n') : 'No accessible application windows were found.',noTTS:true,
      };
    }
    if (intent === 'DESKTOP_INSPECT') return inspectNamed(args.window);
    const found = findControl(args.control);
    if (found.error) return {text:found.error,error:found.error};
    const click = intent === 'DESKTOP_CLICK';
    if (click && !found.control.canClick || !click && !found.control.canFill)
      return {text:'This control does not support that action.',error:'CONTROL_UNAVAILABLE'};
    return action(found.control, click ? 'click' : 'fill', args.value);
  }
  async function command(text) {
    const input = text.replace(/^jarvis[, ]+/i, '').trim();
    if (/^inspect\s/i.test(input) && (NLU.classify(NLU.normalize(input, settings.wakeWord), ctx).intent === 'AGENT_INSPECT' ||
        /^inspect (?:that|my last (?:message|command))[.!?]?$/i.test(input))) return null;
    if (/^fill me in\b/i.test(input)) return null;
    if (!/^fill\s/i.test(input) && /\b(?:then|and then)\b/i.test(input)) return null;
    if (/^(?:show|list|open) (?:my |the )?(?:app controls|desktop controls|open windows)[.!?]?$/i.test(input)) {
      return run('DESKTOP_WINDOWS');
    }
    const window = /^inspect (?:the )?(.+?)(?: window)?[.!?]?$/i.exec(input);
    if (window) {
      return run('DESKTOP_INSPECT',{window:window[1]});
    }
    const click = /^click (?:the )?(.+?)[.!?]?$/i.exec(input);
    const fill = /^fill (?:the )?(?:field )?(.+?) with ([\s\S]*)$/i.exec(input);
    if (!click && !fill) return null;
    return run(click ? 'DESKTOP_CLICK' : 'DESKTOP_FILL',{control:(click || fill)[1],value:fill?.[2]});
  }
  $('#desktopRefresh').onclick = () => void refresh();
  $('#desktopInspect').onclick = () => void inspect().then(result => { if (result.error) status.textContent = result.error; });
  select.onchange = () => { if (!acting) { snapshot = null; host.replaceChildren(); } };
  $('#desktopExtended').onchange=()=>void (async()=>{const result=await callTool('/desktop/extended',{enabled:$('#desktopExtended').checked});if(result.error)status.textContent=result.error;const current=await getJSON('/desktop/extended');$('#desktopExtended').checked=current.enabled===true;})();
  return { command, run };
})();
