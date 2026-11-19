'use strict';

(async () => {
  const parameters = new URLSearchParams(location.search);
  history.replaceState(null, '', location.pathname);
  let connected = false;
  try {
    const code = parameters.get('code'), state = parameters.get('state');
    if (code && state && !parameters.has('error')) {
      const response = await fetch('/api/marks/accounts/callback', { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state }) });
      connected = response.ok && (await response.json()).connected === true;
    }
  } finally { location.replace('/marks.html?entry=account-' + (connected ? 'connected' : 'failed')); }
})().catch(() => {});
