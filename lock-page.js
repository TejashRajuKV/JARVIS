// The unlock page's own script (it used to be inline in lock.html; JARVIS's Content-Security-Policy allows no inline scripts).
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const say = (t, err) => { $('msg').textContent = t || ''; $('msg').className = 'msg' + (err ? ' err' : ''); };
  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch {} return Object.assign({ _status: r.status }, j); };
  let busy = false;

  // Why Windows Hello can't be used on this page, or null when it can.
  async function unavailable() {
    if (/\.ts\.net$/i.test(location.hostname)) return 'JARVIS is locked. Unlocking has to be done at the laptop itself — Windows Hello can’t be used from another device.';
    if (location.hostname !== 'localhost') return 'Open JARVIS at http://localhost:' + location.port + ' to unlock it with Windows Hello.';
    if (!window.PublicKeyCredential || !navigator.credentials) return 'This browser can’t use Windows Hello — open JARVIS in Chrome or Edge.';
    try { if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return 'Windows Hello isn’t available on this PC.'; } catch {}
    return null;
  }
  async function unlock() {
    if (busy) return;
    const why = await unavailable(); if (why) { say(why, true); return; }
    busy = true; $('go').disabled = true; $('orb').classList.add('busy'); say('Waiting for Windows Hello…');
    try {
      const c = await post('/api/hello/challenge', { purpose: 'unlock' });
      if (!c.challenge || !c.credId) throw new Error(c.error || 'Windows Hello isn’t set up on this JARVIS');
      const a = await navigator.credentials.get({ publicKey: { challenge: fromB64u(c.challenge), rpId: 'localhost',
        allowCredentials: [{ type: 'public-key', id: fromB64u(c.credId), transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
      const r = await post('/api/lock/unlock', { authenticatorData: b64u(a.response.authenticatorData), clientDataJSON: b64u(a.response.clientDataJSON), signature: b64u(a.response.signature) });
      if (!r.success) throw new Error(r._status === 429 ? 'Too many failed attempts — wait a minute and try again.' : (r.error || 'Windows Hello didn’t verify'));
      say('Unlocked.'); location.reload();
    } catch (e) {
      say(e && e.name === 'NotAllowedError' ? 'Cancelled or timed out — try again.' : (e && e.message) || 'Could not unlock.', true);
      busy = false; $('go').disabled = false; $('orb').classList.remove('busy');
    }
  }
  $('go').addEventListener('click', unlock);
  // Ask straight away; the button is there if you dismiss the prompt.
  unavailable().then(why => { if (why) say(why, true); else setTimeout(unlock, 450); });
})();
