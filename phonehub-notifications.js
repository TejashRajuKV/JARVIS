'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function createPhoneHubNotifications(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const maxItems = Number.isSafeInteger(options.maxItems) && options.maxItems > 0
    ? Math.min(options.maxItems, 500) : DEFAULT_MAX_ITEMS;
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs > 0
    ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const items = [];

  function sweep() {
    const cutoff = now() - maxAgeMs;
    while (items.length && items[0].createdAt < cutoff) items.shift();
    while (items.length > maxItems) items.shift();
    return items.length;
  }

  function publish(input = {}) {
    const title = clean(input.title, 120);
    const body = clean(input.body || input.message, 1000);
    if (!title || !body) return null;
    const createdAt = now();
    const item = Object.freeze({
      id: crypto.randomUUID(),
      type: clean(input.type || 'notice', 40) || 'notice',
      title,
      body,
      createdAt,
      sourceId: clean(input.sourceId || input.id, 100) || null
    });
    items.push(item);
    sweep();
    return { ...item };
  }

  function list(limit = 50) {
    sweep();
    const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 50;
    return items.slice(-count).reverse().map(item => ({ ...item }));
  }

  return Object.freeze({ publish, list, sweep });
}

module.exports = { createPhoneHubNotifications, DEFAULT_MAX_ITEMS, DEFAULT_MAX_AGE_MS };
