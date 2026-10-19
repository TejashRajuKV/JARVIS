'use strict';
/* Update check: compares this JARVIS install against the latest GitHub release.
   Rules: nothing automatic and no phone-home — the page asks only when you click
   "Check for updates" in Settings, and the page only offers the button when the
   Online tools switch is on (so a privacy-first install never touches the network). */
const REPO = 'tejas/jarvis'; // single place to change if the project moves

// "1.0.0" → [1,0,0]; ignores a leading v and any -beta suffix, compares numerically.
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').split('-')[0].match(/^\d+(\.\d+)*/);
  return m ? m[0].split('.').map(Number) : null;
}
function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

module.exports = function setupUpdate(app, { appVersion }) {
  const version = String(appVersion || '0.0.0');

  // Cheap local facts (no network): what am I running, where would the release come from?
  app.get('/api/update/status', (req, res) => {
    res.json({ success: true, version, repo: REPO, releasesUrl: 'https://github.com/' + REPO + '/releases/latest' });
  });

  // The one networked call — fired only by the Settings button.
  app.get('/api/update/check', async (req, res) => {
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
        headers: { 'User-Agent': 'JARVIS-update-check', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 404) return res.json({ success: true, version, update: false, note: 'No releases published yet.' });
      if (!r.ok) return res.status(502).json({ error: 'GitHub said HTTP ' + r.status });
      const j = await r.json();
      const latest = String(j.tag_name || '').trim();
      res.json({
        success: true,
        version,
        latest: latest.replace(/^v/i, ''),
        update: isNewer(latest, version),
        url: j.html_url || ('https://github.com/' + REPO + '/releases'),
        notes: String(j.body || '').slice(0, 2000),
      });
    } catch (e) {
      res.status(502).json({ error: 'Could not reach GitHub: ' + e.message });
    }
  });
};

Object.assign(module.exports, { parseVersion, isNewer, REPO });
