'use strict';
/* Karnataka tenders (KPPP), chat side. Explicit wording only: a sentence has to be about tenders (tenderparse.js decides).
     "read these tenders"                       → reads the KPPP results you copied (Ctrl+A, Ctrl+C on the live search, after you typed its CAPTCHA)
     "list me building tenders in mysore"        → from that copied list: matching open tenders, soonest deadline first, number / name / place / value / deadline
     "how many tenders closing this week"        → the count
     "open kppp"                                 → opens the live search page
     "send me building tenders every day at 6pm" → a daily digest (one reminder the server fires; "stop the tender digest" removes it)
   The copied list is the only source for the detailed list: every answer says how old it is, and after 12 hours JARVIS says it may be out of date.
   "New" means new since your last import (JARVIS keeps every tender number it has seen), not "newly published on KPPP" — that is said only when the
   row's NIT Published Date shows it. KPPP has no address per tender: the link is the search page plus the tender number. */
const Tenders = (() => {
  const T = typeof TenderParse !== 'undefined' ? TenderParse : null;
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'TENDERS' }, extra || {});
  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const st = (k, f) => { try { return store.get(k, f); } catch (e) { return f; } };
  const put = (k, v) => { try { store.set(k, v); } catch (e) { /* the page keeps working; it just forgets */ } };
  const undo = (label, fn) => { if (typeof Undo !== 'undefined') Undo.push(label, fn); };
  const STALE_MS = 12 * 3600e3, KNOWN_MAX = 6000, SHOW = 15;
  const PHONE_NO = 'Reading tenders needs the clipboard on the laptop. Copy the KPPP results there and say **“read these tenders”** at the laptop.';
  const openBtn = () => ({ label: 'OPEN KPPP', fn: () => callTool('/tool/openUrl', { url: T.KPPP_URL }) });
  const readBtn = () => ({ label: 'READ COPIED LIST', fn: async () => jarvisSay(await importFromClipboard()) });
  const steps = '1. **OPEN KPPP** (the live tender search) and type its CAPTCHA.\n2. When the results show, press **Ctrl+A** then **Ctrl+C**.\n3. Say **“read these tenders”** (or press READ COPIED LIST).';

  /* ---- age of the copied list ---- */
  function ageText(at, now = Date.now()) {
    const min = Math.round((now - at) / 60000);
    if (min < 2) return 'just now'; if (min < 60) return min + ' minutes ago';
    const d = new Date(at), today = new Date(now); today.setHours(0, 0, 0, 0);
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (at >= today.getTime()) return 'today ' + t;
    if (at >= today.getTime() - 864e5) return 'yesterday ' + t;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + t;
  }
  // the freshness reminder: null when the copied list is fresh
  function freshness(snap, now = Date.now()) {
    if (!snap || !snap.rows) return 'I have **no copied KPPP list** yet, so I cannot list tenders.\n\n' + steps;
    if (now - snap.at > STALE_MS) return '⚠ Your copied list is from **' + ageText(snap.at, now) + '** — tenders may have been added or closed since. Copy a fresh one:\n\n' + steps;
    return null;
  }

  /* ---- import ---- */
  // the text you copied → the saved snapshot { at, rows, freshNos, skipped }, or { error }
  function importTenders(text, now = Date.now()) {
    const p = T.parsePasted(text);
    if (!p.rows.length) return { error: p.reason, skipped: p.skipped };
    const known = st('jarvis.tendersKnown', {}) || {};
    const freshNos = T.diffKnown(p.rows, known);
    for (const no of freshNos) known[no] = now;
    const keys = Object.keys(known);
    if (keys.length > KNOWN_MAX) keys.sort((a, b) => known[a] - known[b]).slice(0, keys.length - KNOWN_MAX).forEach(k => delete known[k]);
    const snap = { at: now, rows: p.rows, freshNos, skipped: p.skipped, firstImport: keys.length === freshNos.length };
    put('jarvis.tendersKnown', known); put('jarvis.tenders', snap);
    return snap;
  }
  async function importFromClipboard(source) {
    if (source === 'phone') return say(PHONE_NO);
    const c = await callTool('/tool/readClipboard', {});
    if (c.error) return say('I could not read the clipboard: ' + c.error);
    const before = st('jarvis.tenders', null), knownBefore = st('jarvis.tendersKnown', {});
    const snap = importTenders(String(c.content || c.text || ''));
    if (snap.error) return say('I could not find a KPPP tender table in what you copied — ' + snap.error + '.\n\n' + steps, { actions: [openBtn()] });
    undo('read a tender list', () => { put('jarvis.tenders', before); put('jarvis.tendersKnown', knownBefore); return 'Put back the tender list you had before.'; });
    const now = Date.now(), open = snap.rows.filter(r => r.closes === null || r.closes >= now), building = open.filter(T.isBuilding);
    const places = {}; for (const r of building) if (r.place) places[r.place] = (places[r.place] || 0) + 1;
    const top = Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => n + ' in ' + p).join(', ');
    return say('✓ Read **' + pl(snap.rows.length, 'tender') + '** from KPPP (' + open.length + ' still open, **' + building.length + ' building**' + (top ? ': ' + top : '') + ').'
      + (snap.firstImport ? '' : ' **' + snap.freshNos.length + ' new since your last import.**') + (snap.skipped ? ' ' + pl(snap.skipped, 'line') + ' could not be read and were left out.' : '')
      + '\n\nAsk **“list building tenders in mysore”**, **“tenders closing this week”** or **“new building tenders”**.', { suggestions: ['List building tenders', 'Tenders closing this week'] });
  }

  /* ---- choosing and listing ---- */
  function selectTenders(snap, q, now = Date.now()) { return T.filter(snap ? snap.rows : [], q, { now, freshNos: snap && snap.freshNos }); }
  function report(snap, q, now = Date.now()) {
    const { rows, closed } = selectTenders(snap, q, now);
    const fresh = new Set(snap.freshNos || []), what = T.describe(q);
    const head = rows.length ? '**' + rows.length + ' open ' + (rows.length === 1 ? what.replace('tenders', 'tender') : what) + '**' : 'No open ' + what;
    const recent = rows.filter(r => r.published && now - r.published < 864e5).length;
    const lines = rows.slice(0, SHOW).map(r => T.formatLine(r, now, !snap.firstImport && fresh.has(r.no)));
    const notes = [rows.length > SHOW ? '…and ' + (rows.length - SHOW) + ' more.' : '', closed ? pl(closed, 'matching tender') + ' in the list ' + (closed === 1 ? 'has' : 'have') + ' already closed and ' + (closed === 1 ? 'is' : 'are') + ' left out.' : '',
      recent ? recent + (recent === 1 ? ' was' : ' were') + ' published on KPPP in the last 24 hours (by the NIT Published Date).' : '',
      !snap.firstImport && rows.some(r => fresh.has(r.no)) ? '🆕 = new since your last import (not necessarily newly published).' : ''].filter(Boolean);
    return { rows, closed, text: head + ' in your KPPP list copied ' + ageText(snap.at, now) + (rows.length ? ', soonest deadline first:' : '.') + (lines.length ? '\n' + lines.join('\n') : '') + (notes.length ? '\n\n' + notes.join(' ') : '')
      + (rows.length ? '\n\nTo open one: **OPEN KPPP**, search by its tender number.' : '') };
  }
  async function liveTotal() {
    if (typeof settings === 'undefined' || !settings.online) return '';
    try { const r = await callTool('/tenders/count', { online: true }); return r && r.available && Number.isFinite(r.live) ? '\n\n*KPPP right now has **' + r.live.toLocaleString('en-IN') + '** live tenders in all (every category and place — only the total is public).*' : ''; } catch (e) { return ''; }
  }
  async function listTenders(q) {
    const snap = st('jarvis.tenders', null), now = Date.now(), fr = freshness(snap, now);
    if (!snap || !snap.rows) return say(fr, { actions: [openBtn(), readBtn()] });
    const r = report(snap, q, now);
    const first = r.rows[0];
    const actions = [openBtn(), readBtn()];
    if (first && typeof navigator !== 'undefined' && navigator.clipboard) actions.push({ label: 'COPY ' + (r.rows.length > 1 ? 'NUMBERS' : 'NUMBER'), fn: () => navigator.clipboard.writeText(r.rows.slice(0, SHOW).map(x => x.no).join('\n')).then(() => { if (typeof toast === 'function') toast('Copied'); }) });
    const body = q.op === 'count' ? (r.rows.length ? '**' + r.rows.length + '** open ' + T.describe(q) + ' in your KPPP list copied ' + ageText(snap.at, now) + (r.closed ? ' (' + r.closed + ' more already closed)' : '') + '.' + (r.rows.length <= 5 ? '\n' + r.rows.map(x => T.formatLine(x, now)).join('\n') : ' Say **“list ' + T.describe(q) + '”** to see them.') : r.text) : r.text;
    return say(body + (fr ? '\n\n' + fr : '') + await liveTotal(), { actions, speak: r.rows.length ? r.rows.length + ' ' + T.describe(q) + '.' : 'No matching open tenders.' });
  }

  /* ---- the daily digest ---- */
  const isDigest = r => r && r.kind === 'tenders';
  function scheduleDigest(q, time = '18:00') {
    if (typeof reminders === 'undefined' || typeof NLU === 'undefined' || !NLU.parseRepeat) return say('I could not set that up here.');
    const [h, m] = time.split(':').map(Number), ampm = (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'), phrase = 'every day at ' + ampm;
    const repeat = NLU.parseRepeat(phrase);
    const at = repeat && typeof repeatStart === 'function' ? repeatStart(repeat, phrase) : null;
    if (!repeat || !at) return say('I could not work out the time “' + time + '”. Try **“send me building tenders every day at 6pm”**.');
    const query = { cats: q.cats && q.cats.length ? q.cats : ['building'], place: q.place || null, placeRaw: q.placeRaw || '', minValue: q.minValue || null };
    const old = reminders.filter(isDigest);
    reminders = reminders.filter(r => !isDigest(r));
    const rem = { id: rid(), text: 'Tender digest: ' + T.describe(query), at, fired: false, repeat, kind: 'tenders', tenderQuery: query };
    reminders.push(rem); saveTasks();
    undo('set up the tender digest', () => { reminders = reminders.filter(r => r.id !== rem.id); reminders.push(...old); saveTasks(); return old.length ? 'The earlier tender digest is back.' : 'Removed the tender digest.'; });
    return say('✓ Every day at **' + ampm + '** I will send you **' + T.describe(query) + '** from your latest copied KPPP list, and remind you to copy a fresh one when it is old. First one: ' + (typeof fmtDay === 'function' ? fmtDay(at) + ' at ' + fmtTime(at) : new Date(at).toLocaleString()) + '. It reaches your phone too if phone notifications are on. Say **“undo”** or **“stop the tender digest”** to remove it.');
  }
  function stopDigest() {
    if (typeof reminders === 'undefined') return say('I could not change that here.');
    const old = reminders.filter(isDigest);
    if (!old.length) return say('There is no tender digest set up. Say **“send me building tenders every day at 6pm”** to start one.');
    reminders = reminders.filter(r => !isDigest(r)); saveTasks();
    undo('stopped the tender digest', () => { reminders.push(...old); saveTasks(); return 'The tender digest is back.'; });
    return say('✓ Stopped the daily tender digest. Say **“undo”** to bring it back.');
  }
  // → { report (null when there is no list), freshness (null when the list is fresh) }
  function buildDigest(rem, now = Date.now()) {
    const q = (rem && rem.tenderQuery) || { cats: ['building'] };
    const snap = st('jarvis.tenders', null);
    return { report: snap && snap.rows ? report(snap, Object.assign({ op: 'list' }, q), now).text : null, freshness: freshness(snap, now) };
  }
  // called when the digest reminder fires (only the leading tab: see the reminder listener in script.js)
  function digest(rem) {
    const d = buildDigest(rem);
    if (typeof sfx !== 'undefined') try { sfx.alarm(); } catch (e) { /* sound is optional */ }
    if (d.report) jarvisSay(say('🏗 **Your ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' tender digest** — ' + d.report, { noTTS: true, actions: [openBtn()] }));
    if (d.freshness) jarvisSay(say(d.freshness, { noTTS: !!d.report, actions: [openBtn(), readBtn()] }));
    if (typeof notify === 'function') notify('Tender digest', d.report ? 'Your building tenders are in JARVIS.' : 'Copy a fresh KPPP list for your tender digest.');
    return d;
  }

  /* ---- router ---- */
  async function intercept(text, source) {
    if (!T) return null;
    const q = T.parseQuery(text);
    if (!q) return null;
    switch (q.op) {
      case 'import': return importFromClipboard(source);
      case 'open': if (source === 'phone') return say('Open KPPP on the laptop: ' + T.KPPP_URL); await callTool('/tool/openUrl', { url: T.KPPP_URL }); return say('Opened the KPPP live tender search. Type its CAPTCHA, then copy the results (**Ctrl+A**, **Ctrl+C**) and say **“read these tenders”**.', { actions: [readBtn()] });
      case 'digest': return scheduleDigest(q, q.time || '18:00');
      case 'digest-stop': return stopDigest();
      default: return listTenders(q);
    }
  }
  return { intercept, importTenders, importFromClipboard, selectTenders, listTenders, scheduleDigest, stopDigest, buildDigest, digest, freshness, ageText, isDigest };
})();
if (typeof module !== 'undefined') module.exports = Tenders;
