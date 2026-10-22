'use strict';
/* Explicit service hand-offs. JARVIS prepares drafts/searches, then hands off to the provider.
   It never sends a WhatsApp message, books a seat, places an order, or pays automatically. */
const Services = (() => {
  const say = (text, extra) => Object.assign({ text, noPersona: true, intent: 'SERVICE_HANDOFF' }, extra || {});
  const clean = s => String(s || '').trim().replace(/[.!?]+$/, '');
  const patterns = {
    whatsapp: [
      /^(?:please\s+)?(?:send|text|message)\s+(?:me\s+)?(?:a\s+)?(?:whats?app\s+)?message\s+to\s+([+\d() .-]{8,24})\s+(?:saying|that says|:|message:)\s+(.+)$/i,
      /^(?:please\s+)?(?:send|text)\s+whats?app\s+to\s+([+\d() .-]{8,24})\s*:\s*(.+)$/i,
    ],
    movie: /^(?:please\s+)?(?:book|find|search)\s+(?:me\s+)?(?:movie|cinema|film)\s+tickets?\s+(?:for\s+)?(.+?)(?:\s+in\s+([a-z][a-z .'-]{1,50}))?$/i,
    bus: /^(?:please\s+)?(?:book|find|search)\s+(?:me\s+)?bus\s+tickets?\s+from\s+([a-z][a-z .'-]{1,50}?)\s+to\s+([a-z][a-z .'-]{1,50}?)(?:\s+on\s+(.+))?$/i,
    shopping: /^(?:please\s+)?(?:shop\s+for|search\s+(?:for\s+)?(?:shopping\s+)?items?\s+(?:for\s+)?|find\s+(?:me\s+)?to\s+buy\s+|buy\s+|order\s+)(.+)$/i,
  };
  function match(text) {
    const t = clean(text);
    for (const re of patterns.whatsapp) { const m = t.match(re); if (m) return { kind: 'whatsapp', phone: m[1].trim(), message: m[2].trim() }; }
    let m = t.match(patterns.movie);
    if (m) return { kind: 'movie', movie: m[1].trim(), city: (m[2] || 'Bengaluru').trim() };
    m = t.match(patterns.bus);
    if (m) return { kind: 'bus', from: m[1].trim(), to: m[2].trim(), date: (m[3] || '').trim() };
    m = t.match(patterns.shopping);
    if (m && m[1].trim()) return { kind: 'shopping', item: m[1].trim() };
    return null;
  }
  async function intercept(text, source) {
    const action = match(text);
    if (!action) return null;
    if (source === 'phone') return say('For privacy and purchase safety, start messaging, ticket and shopping hand-offs from JARVIS on your laptop.');
    if (action.kind === 'whatsapp' && !/^[+\d() .-]{8,24}$/.test(action.phone)) return say('I need the recipient’s phone number, including country code (for example +91 followed by the number). I cannot choose a contact by guessing.');
    const prepared = await callTool('/services/prepare', action);
    if (!prepared || prepared.error) return say((prepared && prepared.error) || 'I could not prepare that service hand-off.');
    const opened = await callTool('/tool/openUrl', { url: prepared.url });
    if (opened && opened.error) return say('I prepared the hand-off but could not open the provider: ' + opened.error, { suggestions: [prepared.url] });
    const textOut = action.kind === 'whatsapp'
      ? 'WhatsApp opened with a **draft only**. Check the recipient and message, then press **Send** yourself. JARVIS did not send it.'
      : action.kind === 'movie'
        ? prepared.summary + '\\n\\nI opened BookMyShow; choose the exact movie, cinema, showtime and seats, then review the total before confirming.'
        : action.kind === 'bus'
          ? prepared.summary + '\\n\\nI opened redBus; verify the route/date and select your operator and seats yourself.'
          : prepared.summary + '\\n\\nI opened the search page. Review the seller and final checkout details yourself; no order or payment was made.';
    return say(textOut, { tool: 'serviceHandoff', service: action.kind });
  }
  return { intercept, match };
})();
if (typeof module !== 'undefined') module.exports = Services;
