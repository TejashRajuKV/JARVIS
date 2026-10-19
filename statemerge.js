'use strict';
// Merging a tab's save with what the server already holds (state sync, plan item 1.2). The page saves WHOLE lists, so without this the last tab to save wins and
// silently drops what another tab added in the meantime. With the ids the writing tab knew about when it last synced (`baseIds`) the server can tell
// "this tab deleted it" from "another tab added it":
//   - everything the writing tab has is kept, in its order (its edits win);
//   - an item only the server has: if the writing tab knew it (id in base) the tab deleted it → dropped; otherwise someone else added it → kept, after the tab's own;
//   - an item only the writing tab has: if it was in the base, someone else deleted it → dropped; otherwise the tab added it → kept (it is the tab's own, listed first).
// Lists whose items have no ids, and a tab that sent no base, are not merged (the tab's copy simply replaces the server's, as before).

const hasIds = list => Array.isArray(list) && list.every(x => x && typeof x === 'object' && x.id !== undefined && x.id !== null);

// → the merged list, or null when this pair cannot be merged
function mergeIdList(server, client, baseIds) {
  if (!hasIds(server) || !hasIds(client) || !Array.isArray(baseIds)) return null;
  const base = new Set(baseIds.map(String)), serverIds = new Set(server.map(x => String(x.id))), out = [], seen = new Set();
  for (const it of client) {
    const id = String(it.id);
    if (seen.has(id)) continue;
    if (base.has(id) && !serverIds.has(id)) continue;          // deleted by another tab since this tab last synced
    seen.add(id); out.push(it);
  }
  for (const it of server) {
    const id = String(it.id);
    if (seen.has(id)) continue;
    if (base.has(id)) continue;                                // this tab knew it and no longer has it: it deleted it
    seen.add(id); out.push(it);                                // added by another tab
  }
  return out;
}

// attendance is { Subject: {...} }: the same rules, keyed by subject name
function mergeKeyed(server, client, baseKeys) {
  const plain = o => o && typeof o === 'object' && !Array.isArray(o);
  if (!plain(server) || !plain(client) || !Array.isArray(baseKeys)) return null;
  const base = new Set(baseKeys), out = {};
  for (const k of Object.keys(client)) { if (base.has(k) && !(k in server)) continue; out[k] = client[k]; }
  for (const k of Object.keys(server)) { if (k in out || base.has(k)) continue; out[k] = server[k]; }
  return out;
}

const LIST_KEYS = new Set(['jarvis.todos', 'jarvis.deadlines', 'jarvis.classes', 'jarvis.studyPlans', 'jarvis.expenses', 'jarvis.habits', 'jarvis.memory', 'jarvis.marks']);
const KEYED_KEYS = new Set(['jarvis.attendance']);

// → { value, changed } where `changed` says the result differs from what the tab sent (so the tab must take it)
function mergeState(key, serverValue, clientValue, base) {
  let merged = null;
  if (LIST_KEYS.has(key)) merged = mergeIdList(serverValue, clientValue, base);
  else if (KEYED_KEYS.has(key)) merged = mergeKeyed(serverValue, clientValue, base);
  if (merged === null) return { value: clientValue, changed: false, merged: false };
  return { value: merged, changed: JSON.stringify(merged) !== JSON.stringify(clientValue), merged: true };
}

module.exports = { mergeIdList, mergeKeyed, mergeState, LIST_KEYS, KEYED_KEYS };
