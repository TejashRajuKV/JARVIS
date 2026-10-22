'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const status = $('calling-status');
  const details = $('calling-details');
  const submit = $('calling-submit');
  const refresh = $('calling-refresh');
  const error = $('calling-error');
  const result = $('calling-result');
  async function refreshStatus() {
    status.textContent = 'Checking configuration…';
    try {
      const response = await fetch('/api/calling/status', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read calling status');
      status.textContent = data.enabled ? 'Calling is configured and enabled.' : data.configured ? 'Provider credentials are present, but calling is disabled.' : 'Calling is not configured yet.';
      details.textContent = 'Provider: Twilio. Mode: spoken announcement. Reminder calls: ' + (data.reminderCallsEnabled ? 'enabled' : 'disabled') + '. Limit: ' + data.rateLimit.maxCalls + ' calls per ' + data.rateLimit.windowMinutes + ' minutes.';
      submit.disabled = !data.enabled;
    } catch (e) {
      status.textContent = 'Could not read calling status.';
      details.textContent = '';
      submit.disabled = true;
    }
  }
  refresh.addEventListener('click', refreshStatus);
  submit.addEventListener('click', async () => {
    error.hidden = true;
    result.textContent = '';
    const message = $('calling-message').value.trim();
    if (!message || message.length > 600) {
      error.textContent = 'Enter a message between 1 and 600 characters.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Requesting call…';
    try {
      const response = await fetch('/api/calling/call', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Call request failed');
      result.textContent = 'Call queued by the provider. Status: ' + (data.status || 'queued') + '. Destination: ' + (data.to || 'configured phone') + '.';
    } catch (e) {
      error.textContent = String(e.message || 'Call request failed').slice(0, 200);
      error.hidden = false;
    } finally {
      submit.textContent = 'Call my configured number';
      await refreshStatus();
    }
  });
  refreshStatus();
})();
