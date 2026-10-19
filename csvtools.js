'use strict';
/* CSV analysis in plain Node: read a spreadsheet export, describe every column, find what moves together, answer "average marks
   by department", draw a chart as an SVG file. The code computes every number; the AI is only ever given a digest of
   STATISTICS (column names and summary numbers, never your rows) to put into words. A small safe filter language
   ("marks > 60 and dept = CSE") is parsed by hand, so there is no eval anywhere. Pure functions are exported for tests. */
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 10 * 1024 * 1024, MAX_ROWS = 100000, MAX_COLS = 200;
const MISSING = /^(?:|na|n\/a|nan|null|none|nil|-|--|\?)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x);

/* ---------- parsing ---------- */
function sniffDelimiter(text) {
  const lines = String(text).split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 20);
  if (!lines.length) return ',';
  const count = (line, d) => { let n = 0, q = false; for (const c of line) { if (c === '"') q = !q; else if (c === d && !q) n++; } return n; };
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map(l => count(l, d));
    if (!counts[0]) continue;
    const score = counts.filter(c => c === counts[0]).length * 1000 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function parseRecords(text, d) {
  const rows = []; let row = [], f = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { q = true; i++; continue; }                 // a quote only opens a quoted field at its start
    if (c === d) { row.push(f); f = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; rows.push(row); row = []; i++;
      if (rows.length > MAX_ROWS + 1) break;
      continue;
    }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

// → { delimiter, header, rows (strings), ragged, truncated } or throws an Error with a plain message
function parseCSV(text) {
  const t = String(text || '').replace(/^﻿/, '');
  if (!t.trim()) throw new Error('That file is empty.');
  if (/\u0000/.test(t.slice(0, 4096))) throw new Error('That doesn’t look like a text/CSV file.');
  const delimiter = sniffDelimiter(t);
  const all = parseRecords(t, delimiter);
  if (all.length < 2) throw new Error('I need a header row and at least one row of data.');
  let truncated = false;
  let header = all[0].slice(0, MAX_COLS).map(h => h.replace(/\s+/g, ' ').trim());
  if (all[0].length > MAX_COLS) truncated = true;
  const seen = new Map();
  header = header.map((h, i) => {
    let name = h || 'Column ' + (i + 1);
    const key = name.toLowerCase();
    if (seen.has(key)) { const n = seen.get(key) + 1; seen.set(key, n); name = name + '_' + n; } else seen.set(key, 1);
    return name;
  });
  let body = all.slice(1);
  if (body.length > MAX_ROWS) { body = body.slice(0, MAX_ROWS); truncated = true; }
  let ragged = 0;
  const rows = body.map(r => { if (r.length !== header.length) ragged++; const out = r.slice(0, header.length); while (out.length < header.length) out.push(''); return out; });
  return { delimiter, header, rows, ragged, truncated };
}

/* ---------- types and statistics ---------- */
function toNumber(s) {
  let t = String(s).trim();
  if (!t) return NaN;
  t = t.replace(/^[₹$€£]\s*/, '').replace(/\s*%$/, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) ? parseFloat(t) : NaN;
}
const isMissing = s => MISSING.test(String(s).trim());

// type of each column + the typed values (numbers for numeric columns)
function typeColumns(data) {
  return data.header.map((name, c) => {
    const vals = data.rows.map(r => r[c]);
    const present = vals.filter(v => !isMissing(v));
    const nums = present.filter(v => !Number.isNaN(toNumber(v))).length;
    const dates = present.filter(v => ISO_DATE.test(v.trim())).length;
    let type = 'text';
    if (present.length && nums / present.length >= 0.9) type = 'number';
    else if (present.length && dates / present.length >= 0.9) type = 'date';
    return { name, index: c, type, present: present.length };
  });
}
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }

function profileColumn(data, col) {
  const vals = data.rows.map(r => r[col.index]);
  const missing = vals.filter(isMissing).length;
  const base = { name: col.name, type: col.type, rows: vals.length, missing, count: vals.length - missing };
  if (col.type === 'number') {
    const nums = vals.filter(v => !isMissing(v)).map(toNumber).filter(x => !Number.isNaN(x)).sort((a, b) => a - b);
    const invalid = base.count - nums.length;
    const q1 = quantile(nums, 0.25), q3 = quantile(nums, 0.75), iqr = q3 - q1;
    return { ...base, invalid, unique: new Set(nums).size, min: r4(nums[0]), max: r4(nums[nums.length - 1]), mean: r4(mean(nums)), median: r4(quantile(nums, 0.5)), std: r4(std(nums)), q1: r4(q1), q3: r4(q3), sum: r4(nums.reduce((s, x) => s + x, 0)),
      outliers: nums.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).length };
  }
  const present = vals.filter(v => !isMissing(v)).map(v => v.trim());
  if (col.type === 'date') { const s = present.slice().sort(); return { ...base, unique: new Set(present).size, min: s[0], max: s[s.length - 1] }; }
  const counts = new Map();
  for (const v of present) counts.set(v, (counts.get(v) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value: value.slice(0, 60), count }));
  return { ...base, unique: counts.size, top, avgLength: present.length ? Math.round(present.reduce((s, v) => s + v.length, 0) / present.length) : 0, categorical: counts.size <= 20 && counts.size < Math.max(2, present.length / 2) };
}

function pearson(xs, ys) {
  const n = xs.length; if (n < 5) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
function correlations(data, cols, top = 5, minAbs = 0.3) {
  const numeric = cols.filter(c => c.type === 'number' && c.present >= 5).slice(0, 20);
  const out = [];
  for (let i = 0; i < numeric.length; i++) for (let j = i + 1; j < numeric.length; j++) {
    const xs = [], ys = [];
    for (const r of data.rows) {
      if (isMissing(r[numeric[i].index]) || isMissing(r[numeric[j].index])) continue;
      const x = toNumber(r[numeric[i].index]), y = toNumber(r[numeric[j].index]);
      if (!Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    const r = pearson(xs, ys);
    if (r !== null && Math.abs(r) >= minAbs) out.push({ a: numeric[i].name, b: numeric[j].name, r: r4(r), n: xs.length, strength: Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.5 ? 'moderate' : 'weak', direction: r > 0 ? 'rise together' : 'move in opposite directions' });
  }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, top);
}

function analyze(data) {
  const cols = typeColumns(data);
  const profiles = cols.map(c => profileColumn(data, c));
  const dupRows = data.rows.length - new Set(data.rows.map(r => r.join('\u0001'))).size;
  const notes = [];
  if (data.ragged) notes.push(data.ragged + ' row' + (data.ragged === 1 ? ' has' : 's have') + ' a different number of columns than the header (padded or cut).');
  if (data.truncated) notes.push('The file is bigger than I read in one go, so only the first ' + MAX_ROWS.toLocaleString('en-US') + ' rows / ' + MAX_COLS + ' columns are used.');
  if (dupRows) notes.push(dupRows + ' duplicate row' + (dupRows === 1 ? '' : 's') + '.');
  for (const p of profiles) {
    if (p.rows && p.missing / p.rows > 0.2) notes.push('“' + p.name + '” is empty in ' + Math.round(100 * p.missing / p.rows) + '% of rows.');
    if (p.type === 'number' && p.invalid) notes.push('“' + p.name + '” has ' + p.invalid + ' value' + (p.invalid === 1 ? '' : 's') + ' that are not numbers.');
    if (p.type === 'number' && p.outliers) notes.push('“' + p.name + '” has ' + p.outliers + ' unusually high or low value' + (p.outliers === 1 ? '' : 's') + '.');
  }
  return { rows: data.rows.length, cols: cols.length, delimiter: data.delimiter, columns: profiles, correlations: correlations(data, cols), duplicates: dupRows, notes: notes.slice(0, 12) };
}

// A short text for the AI: names and statistics only. No row is ever in it, and long free-text values (names, emails) are left out.
function digest(report, fileName) {
  const sensitive = v => /@|\d{7,}|https?:/i.test(v);
  const head = 'File: ' + String(fileName || 'data').slice(0, 60) + ' — ' + report.rows + ' rows × ' + report.cols + ' columns.';
  const tail = [];
  if (report.correlations.length) tail.push('Relationships: ' + report.correlations.map(c => c.a + ' & ' + c.b + ' r=' + c.r + ' (' + c.strength + ')').join('; '));
  if (report.notes.length) tail.push('Data quality: ' + report.notes.join(' '));
  const tailText = tail.join('\n').slice(0, 900);
  const budget = 3800 - head.length - tailText.length - 60;            // columns get what is left, so nothing is cut mid-line
  const lines = []; let used = 0, shown = 0;
  for (const p of report.columns) {
    let s = '- ' + String(p.name).slice(0, 50) + ' (' + p.type + '): ' + p.count + ' filled' + (p.missing ? ', ' + p.missing + ' empty' : '') + ', ' + p.unique + ' distinct';
    if (p.type === 'number') s += '; min ' + p.min + ', median ' + p.median + ', mean ' + p.mean + ', max ' + p.max + ', spread ' + p.std + (p.outliers ? ', ' + p.outliers + ' outliers' : '');
    else if (p.type === 'date') s += '; from ' + p.min + ' to ' + p.max;
    else if (p.categorical && p.top.every(t => !sensitive(t.value))) s += '; most common: ' + p.top.map(t => t.value + ' (' + t.count + ')').join(', ');
    if (used + s.length + 1 > budget) break;
    lines.push(s); used += s.length + 1; shown++;
  }
  if (shown < report.columns.length) lines.push('(' + (report.columns.length - shown) + ' more columns not shown)');
  return [head, ...lines, tailText].filter(Boolean).join('\n');
}

/* ---------- the filter language ---------- */
const squash = s => String(s).toLowerCase().replace(/[\s_\-.]+/g, '');
function tokenize(src) {
  const toks = []; let i = 0; const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") { let j = i + 1, v = ''; while (j < s.length && s[j] !== c) { v += s[j++]; } if (j >= s.length) throw new Error('A quote is not closed in “' + s + '”.'); toks.push({ t: 'str', v }); i = j + 1; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '!=', '<>', '==', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two === '<>' ? '!=' : two === '==' ? '=' : two }); i += 2; continue; }
    if ('<>=!(),'.includes(c)) { toks.push({ t: c === '(' || c === ')' || c === ',' ? c : 'op', v: c }); i++; continue; }
    const iso = s.slice(i).match(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/);   // 2024-05-01 works without quotes
    if (iso) { toks.push({ t: 'str', v: iso[0] }); i += iso[0].length; continue; }
    const num = s.slice(i).match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\p{L}_])/u);
    if (num) { toks.push({ t: 'num', v: parseFloat(num[0]), raw: num[0] }); i += num[0].length; continue; }
    const w = s.slice(i).match(/^[\p{L}\p{N}_.%$#@/\\-]+/u);
    if (w) { toks.push({ t: 'word', v: w[0] }); i += w[0].length; continue; }
    throw new Error('I don’t understand “' + c + '” in the filter.');
  }
  return toks;
}
const KEYWORDS = new Set(['and', 'or', 'not', 'contains', 'in', 'is', 'empty', 'missing', 'between', 'starts', 'ends', 'with']);

// → (row) => boolean. `cols` = typeColumns() result. Throws a plain-English Error for anything it can't read.
function compileFilter(src, cols) {
  const toks = tokenize(src); let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const isW = (tk, w) => tk && tk.t === 'word' && tk.v.toLowerCase() === w;
  const lookup = name => cols.find(c => c.name.toLowerCase() === String(name).toLowerCase()) || cols.find(c => squash(c.name) === squash(name));
  const col = tk => {
    const hit = lookup(tk.v);
    if (!hit) throw new Error('There is no column “' + tk.v + '”. The columns are: ' + cols.map(c => c.name).join(', ') + '.');
    return hit;
  };
  // A column name, quoted or not. Unquoted names may have spaces: "total marks > 40" finds the column "Total Marks".
  const colRef = tk => {
    if (tk.t === 'word') {
      for (let n = 4; n >= 2; n--) {
        const parts = [tk, ...toks.slice(p, p + n - 1)];
        if (parts.length === n && parts.every((x, i) => x.t === 'word' && (i === 0 || !KEYWORDS.has(x.v.toLowerCase())))) {
          const hit = lookup(parts.map(x => x.v).join(' '));
          if (hit) { p += n - 1; return hit; }
        }
      }
    }
    return col(tk);
  };
  const value = () => { const tk = next(); if (!tk || !['num', 'str', 'word'].includes(tk.t)) throw new Error('A value is missing in the filter.'); return tk; };
  const cell = (row, c) => row[c.index];
  function cmpValue(c, tk) {
    // a number column compares as numbers; anything else compares as text, ignoring case
    if (c.type === 'number' && (tk.t === 'num' || !Number.isNaN(toNumber(tk.t === 'num' ? tk.raw : tk.v)))) { const n = tk.t === 'num' ? tk.v : toNumber(tk.v); return { num: true, v: n }; }
    return { num: false, v: String(tk.t === 'num' ? tk.raw : tk.v).toLowerCase() };
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new Error('The filter ends too soon.');
    if (tk.t === '(') { next(); const e = or(); if (!peek() || peek().t !== ')') throw new Error('A bracket is not closed in the filter.'); next(); return e; }
    if (isW(tk, 'not') || (tk.t === 'op' && tk.v === '!')) { next(); const e = atom(); return r => !e(r); }
    if (tk.t !== 'word' && tk.t !== 'str') throw new Error('Expected a column name, but found “' + (tk.raw || tk.v) + '”.');
    next();
    const c = colRef(tk), op = next();
    if (!op) throw new Error('What should “' + c.name + '” be compared with?');
    if (isW(op, 'is')) {
      let neg = false; if (isW(peek(), 'not')) { next(); neg = true; }
      const w = next();
      if (!(isW(w, 'empty') || isW(w, 'missing'))) throw new Error('After “is” I expect “empty” or “missing”.');
      return r => isMissing(cell(r, c)) !== neg;
    }
    if (isW(op, 'contains')) { const v = String(value().v).toLowerCase(); return r => String(cell(r, c)).toLowerCase().includes(v); }
    if (isW(op, 'starts')) { if (isW(peek(), 'with')) next(); const v = String(value().v).toLowerCase(); return r => String(cell(r, c)).trim().toLowerCase().startsWith(v); }
    if (isW(op, 'ends')) { if (isW(peek(), 'with')) next(); const v = String(value().v).toLowerCase(); return r => String(cell(r, c)).trim().toLowerCase().endsWith(v); }
    if (isW(op, 'in')) {
      if (!peek() || peek().t !== '(') throw new Error('Write the list in brackets: dept in (CSE, ECE).');
      next(); const items = [];
      while (peek() && peek().t !== ')') { items.push(cmpValue(c, value())); if (peek() && peek().t === ',') next(); }
      if (!peek()) throw new Error('A bracket is not closed in the filter.'); next();
      return r => { const raw = cell(r, c); return items.some(it => (it.num ? toNumber(raw) === it.v : String(raw).trim().toLowerCase() === it.v)); };
    }
    if (isW(op, 'between')) {
      const lo = cmpValue(c, value()); if (!isW(peek(), 'and')) throw new Error('Write it as: marks between 40 and 60.'); next(); const hi = cmpValue(c, value());
      return r => { const x = toNumber(cell(r, c)); return !Number.isNaN(x) && lo.num && hi.num && x >= lo.v && x <= hi.v; };
    }
    if (op.t === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(op.v)) {
      const rhs = cmpValue(c, value());
      return r => {
        const raw = cell(r, c);
        if (isMissing(raw)) return op.v === '!=';                         // a missing value is never "greater than" anything
        const a = rhs.num ? toNumber(raw) : String(raw).trim().toLowerCase();
        if (rhs.num && Number.isNaN(a)) return op.v === '!=';
        switch (op.v) { case '=': return a === rhs.v; case '!=': return a !== rhs.v; case '<': return a < rhs.v; case '<=': return a <= rhs.v; case '>': return a > rhs.v; default: return a >= rhs.v; }
      };
    }
    throw new Error('I expected a comparison like “>”, “=”, “contains” or “between” after “' + c.name + '”.');
  }
  function and() { let e = atom(); while (peek() && (isW(peek(), 'and') || (peek().t === 'op' && peek().v === '&&'))) { next(); const r = atom(), l = e; e = row => l(row) && r(row); } return e; }
  function or() { let e = and(); while (peek() && (isW(peek(), 'or') || (peek().t === 'op' && peek().v === '||'))) { next(); const r = and(), l = e; e = row => l(row) || r(row); } return e; }
  if (!toks.length) throw new Error('The filter is empty.');
  const f = or();
  if (peek()) throw new Error('I didn’t understand “' + (peek().raw || peek().v) + '” in the filter.');
  return f;
}

/* ---------- questions about the data ---------- */
const AGGS = ['count', 'sum', 'mean', 'median', 'min', 'max', 'unique'];
function aggregate(values, fn) {
  if (fn === 'count') return values.length;
  if (fn === 'unique') return new Set(values).size;
  const n = values.filter(x => typeof x === 'number' && !Number.isNaN(x));
  if (!n.length) return null;
  if (fn === 'sum') return r4(n.reduce((s, x) => s + x, 0));
  if (fn === 'mean') return r4(mean(n));
  if (fn === 'median') return r4(quantile(n.slice().sort((a, b) => a - b), 0.5));
  if (fn === 'min') return Math.min(...n);
  if (fn === 'max') return Math.max(...n);
  return null;
}
const findCol = (cols, name) => {
  const q = String(name || '').trim();
  return cols.find(c => c.name.toLowerCase() === q.toLowerCase()) || cols.find(c => squash(c.name) === squash(q)) || cols.find(c => squash(c.name).startsWith(squash(q)) && squash(q).length >= 3);
};
const needCol = (cols, name, what) => { const c = findCol(cols, name); if (!c) throw new Error('There is no ' + (what || 'column') + ' “' + name + '”. The columns are: ' + cols.map(x => x.name).join(', ') + '.'); return c; };

// q: { filter, groupBy, agg, column, limit }
function runQuery(data, cols, q = {}) {
  const total = data.rows.length;
  const pred = q.filter ? compileFilter(q.filter, cols) : null;
  const rows = pred ? data.rows.filter(pred) : data.rows;
  const agg = q.agg ? String(q.agg).toLowerCase() : '';
  if (agg && !AGGS.includes(agg)) throw new Error('I can do ' + AGGS.join(', ') + ' — not “' + agg + '”.');
  const limit = Math.max(1, Math.min(50, +q.limit || 20));
  const valueOf = (c, r) => (c.type === 'number' ? toNumber(r[c.index]) : String(r[c.index]).trim());
  if (q.groupBy) {
    const g = needCol(cols, q.groupBy, 'column to group by');
    const fn = agg || (q.column ? 'mean' : 'count');
    const vc = q.column ? needCol(cols, q.column) : null;
    if (fn === 'unique' && !vc) throw new Error('Distinct values of which column? e.g. “unique names by ' + g.name + '”.');
    if (fn !== 'count' && fn !== 'unique' && (!vc || vc.type !== 'number')) throw new Error('“' + fn + '” needs a number column, e.g. “' + fn + ' of marks by ' + g.name + '”.');
    const groups = new Map();
    for (const r of rows) { const k = isMissing(r[g.index]) ? '(empty)' : String(r[g.index]).trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(vc ? valueOf(vc, r) : 1); }
    const list = [...groups.entries()].map(([group, vals]) => ({ group, value: aggregate(vals, fn), n: vals.length })).filter(x => x.value !== null).sort((a, b) => b.value - a.value || a.group.localeCompare(b.group));
    return { kind: 'groups', matched: rows.length, total, groupBy: g.name, agg: fn, column: vc ? vc.name : null, groups: list.slice(0, 30), groupCount: list.length };
  }
  if (q.column && agg) {
    const c = needCol(cols, q.column);
    if (c.type !== 'number' && agg !== 'count' && agg !== 'unique') throw new Error('“' + c.name + '” isn’t a number column, so I can’t take its ' + agg + '. (I can count or list its distinct values.)');
    const vals = rows.filter(r => !isMissing(r[c.index])).map(r => valueOf(c, r));
    return { kind: 'stat', matched: rows.length, total, column: c.name, agg, value: aggregate(vals, agg), used: vals.length };
  }
  const shown = rows.slice(0, limit);
  return { kind: 'rows', matched: rows.length, total, columns: data.header, rows: shown, more: Math.max(0, rows.length - shown.length) };
}

/* ---------- charts (SVG files; every piece of text is escaped) ---------- */
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NICE = v => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(r4(v)));
const FONT = 'font-family="Segoe UI, system-ui, sans-serif"';
function barChartSvg({ title, items, valueLabel }) {
  const rows = items.slice(0, 15), W = 760, labelW = 190, pad = 24, rowH = 28, H = 70 + rows.length * rowH + 20;
  const max = Math.max(...rows.map(i => i.value), 0) || 1, barW = W - labelW - pad * 2 - 70;
  const bars = rows.map((it, i) => {
    const y = 60 + i * rowH, w = Math.max(1, Math.round(barW * Math.max(it.value, 0) / max));
    return `<text x="${labelW - 8}" y="${y + 16}" text-anchor="end" font-size="13" fill="#334155" ${FONT}>${xml(String(it.label).slice(0, 26))}</text>` +
      `<rect x="${labelW}" y="${y + 3}" width="${w}" height="${rowH - 9}" rx="3" fill="#2563eb"/>` +
      `<text x="${labelW + w + 6}" y="${y + 16}" font-size="12" fill="#0f172a" ${FONT}>${xml(NICE(it.value))}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title>` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/><text x="${pad}" y="30" font-size="17" font-weight="600" fill="#0f172a" ${FONT}>${xml(title)}</text>` +
    (valueLabel ? `<text x="${pad}" y="48" font-size="12" fill="#64748b" ${FONT}>${xml(valueLabel)}</text>` : '') + bars + '</svg>';
}
function histogramSvg({ title, values, bins, valueLabel }) {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) throw new Error('There are no numbers to chart.');
  const lo = Math.min(...nums), hi = Math.max(...nums), k = Math.max(3, Math.min(30, bins || Math.ceil(Math.sqrt(nums.length)))), width = (hi - lo) / k || 1;
  const counts = new Array(k).fill(0);
  for (const x of nums) counts[Math.min(k - 1, Math.floor((x - lo) / width))]++;
  const W = 760, H = 380, left = 50, bottom = 70, top = 60, plotW = W - left - 30, plotH = H - top - bottom, max = Math.max(...counts) || 1, bw = plotW / k;
  const bars = counts.map((c, i) => {
    const h = Math.round(plotH * c / max), x = left + i * bw;
    return `<rect x="${x.toFixed(1)}" y="${top + plotH - h}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h}" fill="#2563eb"/>` + (c ? `<text x="${(x + bw / 2).toFixed(1)}" y="${top + plotH - h - 4}" text-anchor="middle" font-size="10" fill="#0f172a" ${FONT}>${c}</text>` : '');
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `<text x="${(left + plotW * f).toFixed(1)}" y="${top + plotH + 18}" text-anchor="middle" font-size="11" fill="#475569" ${FONT}>${xml(NICE(lo + (hi - lo) * f))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title>` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/><text x="24" y="30" font-size="17" font-weight="600" fill="#0f172a" ${FONT}>${xml(title)}</text>` +
    `<text x="24" y="48" font-size="12" fill="#64748b" ${FONT}>${xml(valueLabel || 'how many rows fall in each range')} · ${nums.length} values</text>` +
    `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#94a3b8"/>` + bars + ticks + '</svg>';
}

/* ---------- reading the file (path checks are the caller's job: findAllowed / anyPath) ---------- */
const cache = new Map();   // path|size|mtime → { data, cols }
function loadFile(p) {
  const st = fs.statSync(p);
  if (!st.isFile()) throw Object.assign(new Error('That is a folder, not a file.'), { status: 400 });
  if (st.size > MAX_BYTES) throw Object.assign(new Error('That file is ' + Math.round(st.size / 1048576) + ' MB. I read CSV files up to ' + MAX_BYTES / 1048576 + ' MB.'), { status: 413 });
  const key = p + '|' + st.size + '|' + st.mtimeMs;
  if (cache.has(key)) return cache.get(key);
  const data = parseCSV(fs.readFileSync(p, 'utf8'));
  const value = { data, cols: typeColumns(data) };
  cache.set(key, value); if (cache.size > 3) cache.delete(cache.keys().next().value);
  return value;
}
const slug = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chart';

/* ---------- routes ---------- */
module.exports = function setupCsv(app, { findAllowed, anyPath, openPath, rel, SANDBOX }) {
  const locate = name => {
    const n = String(name || '').trim();
    if (!n) return null;
    return (anyPath && path.isAbsolute(n.replace(/^["']|["']$/g, '')) ? anyPath(n) : null) || (findAllowed ? findAllowed(n, { kind: 'file' }) : null);
  };
  const open = (req, res) => {
    const p = locate((req.body || {}).name);
    if (!p || !fs.existsSync(p)) { res.status(404).json({ error: 'I can’t find “' + String((req.body || {}).name || '').slice(0, 60) + '” in ~/jarvis or your project folders. Put the file there, or give the full path.' }); return null; }
    try { return { p, ...loadFile(p) }; }
    catch (e) { res.status(e.status || 400).json({ error: e.message }); return null; }
  };

  app.post('/api/csv/analyze', (req, res) => {
    const f = open(req, res); if (!f) return;
    const report = analyze(f.data);
    res.json({ success: true, file: rel ? rel(f.p) : f.p, name: path.basename(f.p), ...report, digest: digest(report, path.basename(f.p)) });
  });
  app.post('/api/csv/query', (req, res) => {
    const f = open(req, res); if (!f) return;
    const b = req.body || {};
    try { res.json({ success: true, file: path.basename(f.p), ...runQuery(f.data, f.cols, { filter: b.filter, groupBy: b.groupBy, agg: b.agg, column: b.column, limit: b.limit }) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/csv/chart', (req, res) => {
    const f = open(req, res); if (!f) return;
    const b = req.body || {};
    try {
      const col = needCol(f.cols, b.column);
      const pred = b.filter ? compileFilter(b.filter, f.cols) : null;
      const rows = pred ? f.data.rows.filter(pred) : f.data.rows;
      const fname = path.basename(f.p);
      let svg, kind, title;
      if (b.groupBy || col.type !== 'number') {
        const q = b.groupBy ? runQuery({ ...f.data, rows }, f.cols, { groupBy: b.groupBy, agg: b.agg || (col.type === 'number' ? 'mean' : 'count'), column: col.type === 'number' ? col.name : undefined })
          : runQuery({ ...f.data, rows }, f.cols, { groupBy: col.name, agg: 'count' });
        kind = 'bar'; title = q.agg === 'count' ? 'Rows per ' + q.groupBy : cap1(q.agg) + ' of ' + q.column + ' by ' + q.groupBy;
        if (!q.groups.length) throw new Error('Nothing to chart: no rows match.');
        svg = barChartSvg({ title: title + ' — ' + fname, items: q.groups.map(g => ({ label: g.group, value: g.value })), valueLabel: q.groupCount > 15 ? 'top 15 of ' + q.groupCount + ' groups' : '' });
      } else {
        const values = rows.filter(r => !isMissing(r[col.index])).map(r => toNumber(r[col.index])).filter(Number.isFinite);
        kind = 'histogram'; title = 'Distribution of ' + col.name;
        svg = histogramSvg({ title: title + ' — ' + fname, values, valueLabel: 'how many rows fall in each range of ' + col.name });
      }
      const dir = path.join(SANDBOX, 'Charts'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, slug(fname) + '-' + slug(b.groupBy ? col.name + '-by-' + b.groupBy : col.name) + '.svg');
      fs.writeFileSync(file, svg);
      if (b.open !== false && openPath) openPath(file);
      res.json({ success: true, kind, title, file: rel ? rel(file) : file, path: file, bytes: Buffer.byteLength(svg) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
};
const cap1 = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
Object.assign(module.exports, { parseCSV, sniffDelimiter, parseRecords, toNumber, isMissing, typeColumns, profileColumn, correlations, analyze, digest, tokenize, compileFilter, runQuery, aggregate, findCol, barChartSvg, histogramSvg, xml, loadFile, quantile, pearson, AGGS, MAX_BYTES, MAX_ROWS, MAX_COLS });
