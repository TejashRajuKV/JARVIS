'use strict';
const DailyFeatures = (() => {
  const key = 'jarvis.workspaces';
  const normalized = value => String(value || '').trim().toLocaleLowerCase();
  const field = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const absolutePath = value => /^(?:[a-z]:[\\/]|\/(?!\/))/i.test(value) && !/[\u0000-\u001f]/.test(value);
  const notePath = value => absolutePath(value) && /\.(?:md|txt|pdf|docx|csv)$/i.test(value);
  function webLink(value) {
    try {
      const url = new URL(value);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {}
    return '';
  }
  const lines = value => field(value, 6000).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  function workspaceInput({ name, project, notes, links }) {
    name = field(name, 70).replace(/\s+/g, ' ');
    project = field(project, 500);
    notes = lines(notes);
    links = lines(links);
    if (!name || !(project || notes.length || links.length)) throw new Error('Enter a name and at least one project, note or link.');
    if (project && !absolutePath(project)) throw new Error('Enter the full path to the project folder.');
    if (notes.length > 8 || links.length > 8) throw new Error('Use up to eight notes and eight links per workspace.');
    if (notes.some(path => path.length > 500 || !notePath(path))) throw new Error('Use full paths to note files such as .md, .txt or .pdf.');
    if (links.some(link => !webLink(link))) throw new Error('Use HTTP or HTTPS links without embedded credentials.');
    return { name, project, notes: [...new Set(notes)], links: [...new Set(links.map(webLink))] };
  }
  function createWorkspaces({ store, id, open }) {
    let active, recentNotes = [], recentLinks = [];
    const list = () => {
      const saved = store.get(key, []);
      if (!Array.isArray(saved)) return [];
      return saved.flatMap(row => {
        if (!row || typeof row.id !== 'string') return [];
        try {
          const result = { ...workspaceInput({ ...row, notes: row.notes.join('\n'), links: row.links.join('\n') }), id: row.id };
          if (row.checkpoint) {
            const checkpoint = row.checkpoint;
            result.checkpoint = {
              project: absolutePath(checkpoint.project) ? field(checkpoint.project, 500) : '',
              notes: Array.isArray(checkpoint.notes) ? checkpoint.notes.filter(notePath).slice(0, 16) : [],
              links: Array.isArray(checkpoint.links) ? checkpoint.links.map(webLink).filter(Boolean).slice(0, 16) : [],
              task: field(checkpoint.task, 150), next: field(checkpoint.next, 500), at: Number(checkpoint.at) || 0,
            };
          }
          return [result];
        } catch { return []; }
      });
    };
    function save(input, editId) {
      const workspace = workspaceInput(input);
      const entries = list();
      if (editId && !entries.some(item => item.id === editId)) throw new Error('This workspace was removed. Create it again to save it.');
      if (entries.some(item => item.id !== editId && normalized(item.name) === normalized(workspace.name)))
        throw new Error('A workspace already uses that name.');
      if (!editId && entries.length >= 30) throw new Error('Remove an old workspace before saving another.');
      const entry = { ...workspace, id: editId || id() };
      const previous = entries.find(item => item.id === editId);
      if (previous?.checkpoint) entry.checkpoint = previous.checkpoint;
      store.set(key, [entry, ...entries.filter(item => item.id !== entry.id)]);
      return entry;
    }
    const remove = entry => store.set(key, list().filter(item => item.id !== entry.id));
    function checkpoint(workspace, next, task) {
      const rows = list();
      const current = rows.find(item => item.id === workspace.id);
      if (!current) throw new Error('This workspace was removed.');
      const note = field(next, 500);
      if (!note) throw new Error('Enter the next step to save a checkpoint.');
      current.checkpoint = {
        project: current.project,
        notes: [...new Set([...current.notes, ...(active === current.id ? recentNotes : [])])],
        links: [...new Set([...current.links, ...(active === current.id ? recentLinks : [])])],
        task: field(task ?? current.checkpoint?.task, 150), next: note, at: Date.now(),
      };
      store.set(key, rows);
      return current.checkpoint;
    }
    function record(route, data, result) {
      if (!active || !result?.success) return;
      if (route === '/tool/openFile' && notePath(result.path))
        recentNotes = [...new Set([...recentNotes, result.path])].slice(-8);
      if (route === '/tool/openUrl' && webLink(data?.url))
        recentLinks = [...new Set([...recentLinks, webLink(data.url)])].slice(-8);
    }
    async function resume(workspace) {
      active = workspace.id; recentNotes = []; recentLinks = [];
      const { project, notes, links, task, next } = workspace.checkpoint || workspace;
      const items = [
        ...(project ? [['project', '/tool/openInEditor', { name: project, exactKind: 'folder' }]] : []),
        ...notes.map((path, i) => ['note ' + (i + 1), '/tool/openFile', { name: path, exactKind: 'file' }]),
        ...links.map((url, i) => ['link ' + (i + 1), '/tool/openUrl', { url }]),
      ];
      const failures = [];
      for (const [label, route, data] of items) {
        try { if (!(await open(route, data))?.success) failures.push(label); }
        catch { failures.push(label); }
      }
      return {
        opened: items.length - failures.length,
        total: items.length,
        failures,
        ...(task ? { task } : {}),
        ...(next ? { next } : {}),
      };
    }
    return { list, save, remove, resume, checkpoint, record };
  }

  function noteSearch(notes, query) {
    const terms = normalized(query).split(/\s+/).filter(Boolean);
    return notes.filter(note => note.key === 'note' && terms.every(term => normalized(note.value).includes(term))).slice().reverse();
  }
  function parse(text) {
    const input = String(text || '').trim().replace(/^jarvis[, ]+/i, '');
    let match = input.match(/^(?:take|save|add) (?:a )?(?:voice|quick) note(?::\s*|\s+that\s+|\s+)(.+)$/i);
    if (match) return { action: 'note', text: match[1] };
    if (/^(?:(?:show|open|list) (?:my )?)?(?:voice notes|note inbox)[.!?]?$/i.test(input)) return { action: 'notes' };
    match = input.match(/^(?:search (?:my )?voice notes for|find in (?:my |the )?note inbox) (.+?)\s*[.!?]?$/i);
    if (match) return { action: 'notes', query: match[1] };
    match = input.match(/^resume (?:my |the )?(.+?) workspace[.!?]?$/i);
    if (match) return { action: 'resume', name: match[1] };
    match = input.match(/^pause (?:my )?(.+?)(?: workspace)? here[.!,:;]?\s+(?:current task[:,]?\s+(.+?)[.!;]\s+)?next[:,]?\s+(.+)$/is);
    if (match) return { action: 'checkpoint', name: match[1], task: match[2], next: match[3] };
    if (/^(?:show|open|list) (?:my )?workspaces[.!?]?$/i.test(input)) return { action: 'workspaces' };
    if (/^(?:brief me on (?:local|regional) news|(?:show (?:me )?)?(?:local|regional) news)[.!?]?$/i.test(input)) return { action: 'news' };
    match = input.match(/^(?:brief me on|(?:show (?:me )?)?(?:regional|local) news (?:in|for)) (.+?)(?: in ([\p{L} -]+?))?[.!?]?$/iu);
    if (match && (!/^brief me on/i.test(input) ||
        /^(?:Kannada|Telugu|Hindi|Tamil|English)$/i.test(match[2] || '') ||
        /^(?:bengaluru|bangalore|new delhi|delhi|chennai|madras|hyderabad|ಬೆಂಗಳೂರು|दिल्ली|சென்னை|హైదరాబాద్)$/i.test(match[1])))
      return { action: 'news', city: match[1], language: match[2] || '' };
    return null;
  }
  function describeResume(result) {
    const prefix = 'Opened ' + result.opened + ' of ' + result.total + ' workspace items.';
    return prefix + (result.failures.length ? ' Could not open ' + result.failures.join(', ') + '.' : '') +
      (result.task ? ' Current task: ' + result.task + '.' : '') +
      (result.next ? ' Next step: ' + result.next : '');
  }
  return { key, createWorkspaces, noteSearch, parse, describeResume };
})();
if (typeof module !== 'undefined') module.exports = DailyFeatures;
