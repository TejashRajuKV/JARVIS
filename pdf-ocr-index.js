'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { pdfPages } = require('./pdftext');

async function renderPage(file, index, output, signal) {
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'pdf-ocr-page.ps1'),
    file, String(index), output], { windowsHide: true, timeout: 30000, signal });
}
const fingerprint = stat => stat.size + ':' + stat.mtimeMs;
function searchPages(pages, query) {
  const words = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return pages.flatMap(({ page, text }) => {
    const clean = text.replace(/\s+/g, ' ').trim(), lower = clean.toLocaleLowerCase();
    if (!words.every(word => lower.includes(word))) return [];
    const start = Math.max(0, lower.indexOf(words[0]) - 80);
    return [{ page, excerpt: (start ? '…' : '') + clean.slice(start, start + 240) }];
  }).slice(0, 20);
}
function register(app, { isWindows, resolve, recognize, readPdf = pdfPages, render = renderPage }) {
  const jobs = new Map();
  const respond = job => ({ id: job.id, file: job.name, state: job.state, done: job.done, total: job.total, unreadable: job.unreadable, error: job.error });
  async function index(job) {
    let temporary;
    try {
      const pdf = await readPdf(job.file);
      job.total = pdf.total;
      if (pdf.total > 400) throw new Error('OCR supports up to 400 PDF pages.');
      for (let i = 0; i < pdf.pages.length && !job.abort.signal.aborted; i++) {
        if (fingerprint(await fs.stat(job.file)) !== job.version) throw new Error('The PDF changed. Start indexing again.');
        let text = pdf.pages[i] || '';
        if (text.trim().length < 40) {
          if (!isWindows) { if (!text.trim()) job.unreadable++; }
          else {
            temporary ||= await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-pdf-ocr-'));
            const output = path.join(temporary, 'page-' + i + '.png');
            try {
              await render(job.file, i, output, job.abort.signal);
              if (!job.abort.signal.aborted) {
                const result = await recognize(await fs.readFile(output));
                if (result.error || !result.text?.trim()) job.unreadable++;
                else text = result.text;
              }
            } catch { if (!job.abort.signal.aborted) job.unreadable++; }
            finally { await fs.unlink(output).catch(() => {}); }
          }
        }
        job.pages.push({ page: i + 1, text });
        job.done++;
      }
      job.state = job.abort.signal.aborted ? 'cancelled' : 'completed';
    } catch (error) { job.state = job.abort.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; }
    finally { if (temporary) await fs.rmdir(temporary).catch(() => {}); }
  }
  app.post('/api/pdf/ocr/index', async (req, res) => {
    const file = resolve(String(req.body?.file || '').trim());
    if (!file || !/\.pdf$/i.test(file)) return res.status(404).json({ error: 'Choose an accessible PDF by name or full path.' });
    try {
      const version = fingerprint(await fs.stat(file));
      const existing = [...jobs.values()].find(job => job.file === file && job.version === version && ['running', 'completed'].includes(job.state));
      if (existing) return res.json(respond(existing));
      if ([...jobs.values()].some(job => job.state === 'running')) return res.status(409).json({ error: 'Wait for the current PDF or cancel it first.' });
      if (jobs.size >= 8) jobs.delete(jobs.keys().next().value);
      const job = { id: randomUUID(), file, name: path.basename(file), version, state: 'running', abort: new AbortController(), done: 0, total: 0, unreadable: 0, pages: [] };
      jobs.set(job.id, job);
      void index(job);
      res.json(respond(job));
    } catch { res.status(404).json({ error: 'The PDF is no longer available.' }); }
  });
  app.get('/api/pdf/ocr/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'This OCR job is unavailable.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(respond(job));
  });
  app.delete('/api/pdf/ocr/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'This OCR job is unavailable.' });
    if (job.state === 'running') job.abort.abort();
    res.json({ success: true });
  });
  app.post('/api/pdf/ocr/search', async (req, res) => {
    const job = jobs.get(req.body?.id);
    if (!job || job.state !== 'completed') return res.status(409).json({ error: 'Index the selected PDF first.' });
    try {
      if (fingerprint(await fs.stat(job.file)) !== job.version) throw new Error();
      res.json({ file: job.name, unreadable: job.unreadable, matches: searchPages(job.pages, String(req.body?.query || '').slice(0, 160)) });
    } catch { res.status(409).json({ error: 'The PDF moved or changed. Index it again.' }); }
  });
}
module.exports = { register, searchPages };
