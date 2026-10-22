'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPhoneHubNotifications } = require('../phonehub-notifications');

let now = 1_800_000_000_000;
const feed = createPhoneHubNotifications({ now: () => now, maxItems: 3, maxAgeMs: 1000 });
const first = feed.publish({ type: 'reminder', title: '  Assignment due ', body: 'Submit DBMS notes', sourceId: 'r-1' });
assert.equal(first.title, 'Assignment due');
assert.equal(feed.list()[0].id, first.id);
assert.equal(feed.publish({ title: '', body: 'No title' }), null);
assert.equal(feed.publish({ title: 'No body', body: '   ' }), null);
feed.publish({ type: 'deadline', title: 'Deadline', body: 'Project submission' });
feed.publish({ type: 'trigger', title: 'Trigger', body: 'Charger plugged' });
feed.publish({ type: 'reminder', title: 'Fourth', body: 'This evicts the oldest item' });
assert.equal(feed.list().length, 3);
assert.equal(feed.list()[0].title, 'Fourth');
assert.equal(feed.list(2).length, 2);
assert.equal(feed.list(2)[1].title, 'Trigger');
const safe = feed.publish({ title: 'A\u0000B', body: 'Line\u0007 with controls' });
assert.equal(safe.title, 'AB');
assert.equal(safe.body, 'Line with controls');
now += 1001;
assert.equal(feed.list().length, 0);

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const scheduler = fs.readFileSync(path.join(__dirname, '..', 'scheduler.js'), 'utf8');
assert.match(server, /getNotifications: async \(\) => phoneHubNotifications\.list\(50\)/);
assert.match(scheduler, /app\.locals\.phoneHubNotify\(\{ type: ev\.type, title, body/);
assert.match(scheduler, /title: 'JARVIS trigger', body: label/);
console.log('phonehub-notifications: bounded queue and scheduler integration cases defined');
