'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const state = { pairingTimer: null, expiresAt: 0, gatewayOrigin: '' };
  const CAPABILITY_LABELS = {
    status: 'Device status',
    notifications: 'Notifications',
    'sms.read': 'Read SMS',
    'sms.send': 'Send SMS',
    'contacts.read': 'Read contacts',
    calls: 'Call controls',
    'photos.read': 'Read photos',
    'clipboard.read': 'Read clipboard',
    'app.launch': 'Launch apps'
  };
  const escText = (el, value) => { el.textContent = String(value ?? ''); };
  const showError = (el, message) => { escText(el, message); el.hidden = !message; };
  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || ('Request failed (' + response.status + ')'));
    return data;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
  }
  function updatePairingCountdown() {
    const remaining = Math.max(0, state.expiresAt - Date.now());
    if (!remaining) {
      $('pairing-expiry').textContent = 'Expired — create a new code to pair another device.';
      if (state.pairingTimer) clearInterval(state.pairingTimer);
      state.pairingTimer = null;
      return;
    }
    $('pairing-expiry').textContent = 'Expires in ' + Math.ceil(remaining / 1000) + ' seconds.';
  }
  function renderDevices(data) {
    const root = $('devices');
    root.replaceChildren();
    if (!data.devices || !data.devices.length) {
      root.append(el('p', 'muted', 'No devices have been paired yet.'));
      return;
    }
    for (const device of data.devices) {
      const card = el('article', 'device-card');
      const head = el('div', 'device-head');
      const identity = el('div');
      identity.append(el('h3', '', device.name || 'Android device'));
      identity.append(el('p', 'muted small', 'Paired ' + formatTime(device.createdAt)));
      identity.append(el('p', 'muted small', 'Session expires ' + formatTime(device.expiresAt)));
      head.append(identity);
      head.append(el('span', device.revoked ? 'pill revoked' : 'pill active', device.revoked ? 'Revoked' : 'Active'));
      card.append(head);
      const group = el('fieldset', 'capabilities');
      const legend = el('legend', '', 'Allowed capabilities');
      group.append(legend);
      const selected = new Set(device.capabilities || []);
      for (const capability of data.capabilities || []) {
        const label = el('label', 'capability');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = capability;
        input.checked = selected.has(capability);
        input.disabled = !!device.revoked;
        label.append(input, document.createTextNode(' ' + (CAPABILITY_LABELS[capability] || capability)));
        group.append(label);
      }
      card.append(group);
      const actions = el('div', 'device-actions');
      const save = el('button', 'button secondary', 'Save permissions');
      save.type = 'button';
      save.disabled = !!device.revoked;
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const capabilities = [...group.querySelectorAll('input:checked')].map(input => input.value);
          await api('/api/phonehub/devices/' + encodeURIComponent(device.id) + '/grant', {
            method: 'POST', body: JSON.stringify({ capabilities })
          });
          await refresh();
        } catch (error) {
          alert('Could not save permissions: ' + error.message);
          save.disabled = !!device.revoked;
        }
      });
      const revoke = el('button', 'button danger', device.revoked ? 'Already revoked' : 'Revoke device');
      revoke.type = 'button';
      revoke.disabled = !!device.revoked;
      revoke.addEventListener('click', async () => {
        if (!confirm('Revoke access for ' + (device.name || 'this device') + '? It will need to pair again.')) return;
        revoke.disabled = true;
        try {
          await api('/api/phonehub/devices/' + encodeURIComponent(device.id), { method: 'DELETE' });
          await refresh();
        } catch (error) {
          alert('Could not revoke device: ' + error.message);
          revoke.disabled = false;
        }
      });
      actions.append(save, revoke);
      card.append(actions);
      root.append(card);
    }
  }
  async function refresh() {
    $('refresh').disabled = true;
    try {
      const data = await api('/api/phonehub/status');
      $('gateway-status').textContent = data.gateway
        ? 'HTTPS gateway active at ' + data.host + ':' + data.port
        : 'Gateway disabled — laptop pairing and device management are available locally, but a phone cannot connect yet.';
      showError($('gateway-error'), data.gatewayError ? 'Gateway startup error: ' + data.gatewayError : '');
      const gatewayHost = String(data.host || '');
      state.gatewayOrigin = data.gateway && gatewayHost ? 'https://' + (gatewayHost.includes(':') ? '[' + gatewayHost + ']' : gatewayHost) + ':' + Number(data.port || 18443) : '';
      renderDevices(data);
    } catch (error) {
      $('gateway-status').textContent = 'Could not load Phone Hub status.';
      showError($('gateway-error'), error.message);
    } finally {
      $('refresh').disabled = false;
    }
  }
  async function createPairing() {
    const button = $('create-pairing');
    button.disabled = true;
    showError($('pairing-error'), '');
    try {
      const data = await api('/api/phonehub/pairing', { method: 'POST', body: '{}' });
      $('pairing-code').textContent = data.code;
      $('pairing-id').textContent = data.pairingId;
      $('pairing-result').hidden = false;
      const qrRoot = $('pairing-qr');
      qrRoot.replaceChildren();
      if (state.gatewayOrigin && typeof QRCode === 'function') {
        const payload = JSON.stringify({ version: 1, endpoint: state.gatewayOrigin, pairingId: data.pairingId, code: data.code });
        new QRCode(qrRoot, { text: payload, width: 240, height: 240, colorDark: '#111827', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        $('pairing-qr-help').textContent = 'The QR contains only the short-lived pairing code, pairing ID and gateway address. It does not contain a device token.';
      } else {
        $('pairing-qr-help').textContent = 'QR unavailable until the HTTPS gateway is active. Use manual pairing fields below.';
      }
      state.expiresAt = data.expiresAt;
      if (state.pairingTimer) clearInterval(state.pairingTimer);
      updatePairingCountdown();
      state.pairingTimer = setInterval(updatePairingCountdown, 1000);
    } catch (error) {
      showError($('pairing-error'), error.message);
    } finally {
      button.disabled = false;
    }
  }
  $('refresh').addEventListener('click', refresh);
  $('create-pairing').addEventListener('click', createPairing);
  refresh();
})();
