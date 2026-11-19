'use strict';
// Text perception uses UI Automation first. Visual/clipboard/full-desktop requests
// still need their existing capture path; OCR observations never become click targets.
async function readAccessible({ source, vision, adapter = require('./desktop-automation').windowsAdapter }) {
  if (source !== 'window' || vision) return null;
  try {
    const result = await adapter({ operation: 'read' });
    const rows = (result.controls || []).filter(c => !c.password && !c.offscreen && c.name &&
      c.type !== 'ControlType.Window').slice(0, 250);
    if (!rows.length) return null;
    const text = rows.map(c => String(c.name).replace(/[\u0000-\u001f\u007f]/g, ' ')).join('\n').slice(0, 20000);
    if (!text.trim()) return null;
    return { success: true, source, method: 'accessibility', text, lines: rows.length,
      title: String(result.title || '').slice(0, 300), truncated: !!result.truncated };
  } catch { return null; }
}
module.exports = { readAccessible };
