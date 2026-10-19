'use strict';
/* Safety for the things JARVIS does with git on your behalf.
     pending(git, repo)       what `git add -A` would stage right now: [{ code, path }] (modified, new, deleted, renamed — not ignored files)
     findSecrets(files)       which of those files look like secrets, by NAME (.env, keys, certificates, credentials…) or by CONTENT (private keys, cloud and
                              API tokens, "password = '…'" lines). Content is read from the working tree, text files up to 200 KB.
     redact(text)             the same patterns blanked out, for text that is about to be sent to an AI (a diff for a commit message)
   "Commit all changes" refuses when anything here looks like a secret: add it to .gitignore, or commit by hand if you are sure.
   Pure functions plus an injected `git(args, cwd) → { code, out }`, so they are tested on temp repositories. */
const fs = require('fs');
const path = require('path');

const SECRET_FILES = ['.env', '.env.*', '*.pem', '*.key', '*.pfx', '*.p12', 'id_rsa*', 'id_ed25519*', '*credentials*', '*secret*', '*.keystore', '.npmrc', '.netrc'];
const nameRe = SECRET_FILES.map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'));
const isSecretName = p => { const b = path.basename(String(p)); return nameRe.some(r => r.test(b)) && !/\.(example|sample|template|dist)$/i.test(b); };
const SECRET_LINE = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['API key (sk-…)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['Stripe secret key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['hard-coded password or token', /\b(?:api[_-]?key|secret|token|passwd|password|auth)["']?\s*[:=]\s*["'][^"'\s${}<>]{12,}["']/i],
];
const MAX_READ = 200 * 1024;

// → [{ code:'M'|'A'|'D'|'R'|'?', path }]  (what `git add -A` would stage). Uses -z so odd file names are safe.
async function pending(git, repo) {
  const r = await git(['status', '--porcelain', '-z', '--untracked-files=all'], repo);
  if (r.code !== 0) return { error: /not a git repository/i.test(r.err || '') ? 'That folder is not a git repository.' : 'git said: ' + String(r.err || r.out).trim().split('\n')[0].slice(0, 120), files: [] };
  const parts = String(r.out).split('\0').filter(Boolean), files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i], xy = e.slice(0, 2), p = e.slice(3);
    if (/[RC]/.test(xy)) i++;                                    // a rename/copy lists the old name next
    const c = xy.includes('?') ? '?' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : xy.includes('A') ? 'A' : 'M';
    files.push({ code: c, path: p });
  }
  return { files };
}
function looksText(buf) { for (let i = 0; i < Math.min(buf.length, 2000); i++) if (buf[i] === 0) return false; return true; }
// files: [{ path (relative), code }], repo: folder. → [{ path, why }]
function findSecrets(files, repo) {
  const out = [];
  for (const f of files) {
    if (f.code === 'D') continue;
    if (isSecretName(f.path)) { out.push({ path: f.path, why: 'its name looks like a secret file' }); continue; }
    try {
      const full = path.join(repo, f.path), st = fs.statSync(full);
      if (!st.isFile() || st.size > MAX_READ * 5) continue;
      const fd = fs.openSync(full, 'r'); const buf = Buffer.alloc(Math.min(st.size, MAX_READ)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      if (!looksText(buf)) continue;
      const text = buf.toString('utf8');
      for (const [why, re] of SECRET_LINE) if (re.test(text)) { out.push({ path: f.path, why: 'it contains a ' + why }); break; }
    } catch { /* unreadable or gone: nothing to scan */ }
  }
  return out;
}
function redact(text) {
  let t = String(text || '');
  for (const [, re] of SECRET_LINE) t = t.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), m => (m.length > 20 ? m.slice(0, 6) : '') + '[REDACTED]');
  return t;
}
module.exports = { pending, findSecrets, redact, isSecretName, SECRET_FILES, SECRET_LINE };
