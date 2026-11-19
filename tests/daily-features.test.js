'use strict';
const assert = require('node:assert/strict');
const { check, done } = require('./lib/server').suite('daily-features');
const Daily = require('../daily-features');
const FocusAudio = require('../focus-audio');
const News = require('../regional-news');
const Assistant = require('../assistant-tools');
const { availabilityEvents } = require('../calendar');
const { readPodcast, rewriteManifest } = require('../media-server');
const { target: mediaTarget } = require('../media-center');
const { mergeState } = require('../statemerge');

function fakeAudio() {
  const events = [];
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    state: 'running', sampleRate: 100, currentTime: 0, destination: {},
    createBuffer: (_channels, size) => ({ getChannelData: () => new Float32Array(size) }),
    createBufferSource: () => ({ ...node(), start: () => events.push('start'), stop: () => events.push('stop') }),
    createGain: () => ({ ...node(), gain: { setTargetAtTime: v => events.push(v) } }),
    createBiquadFilter: () => { events.push('filter'); return { ...node(), frequency: {} }; },
  };
  return { context, events };
}

(async () => {
  const notes = [{ key: 'note', value: 'DBMS demo moved to Friday' }, { key: 'name', value: 'DBMS Friday' }, { key: 'note', value: 'Buy a notebook' }];
  check('notes', 'search finds only note records with every search word in any order', Daily.noteSearch(notes, 'Friday dbms').map(note => note.value).join() === 'DBMS demo moved to Friday');
  check('notes', 'quick note and workspace commands retain the original case', Daily.parse('Save a voice note: DBMS demo').text === 'DBMS demo' && Daily.parse('Resume my DBMS workspace.').name === 'DBMS');
  check('routing', 'existing memory, file note and general briefing commands are untouched', ['remember that the demo moved', 'take a note: revise recursion', 'brief me on quantum computing'].every(text => Daily.parse(text) === null));
  check('news command', 'city and requested language are distinct', Daily.parse('Brief me on Bengaluru in Kannada.').language === 'Kannada' && Daily.parse('Brief me on Bengaluru in Kannada.').city === 'Bengaluru');

  const state = new Map();
  const calls = [];
  const workspaces = Daily.createWorkspaces({
    store: { get: (key, fallback) => state.get(key) || fallback, set: (key, value) => state.set(key, value) },
    id: () => 'workspace-1',
    open: async (route, data) => { calls.push([route, data]); return { success: route !== '/tool/openFile' }; },
  });
  const saved = workspaces.save({ name: 'DBMS', project: 'D:\\Projects\\DBMS', notes: 'D:\\Notes\\DBMS.md', links: 'https://example.org/class' });
  check('workspaces', 'saved items reopen exact project and note paths and retain the selected HTTP link',
    JSON.stringify(workspaces.list()[0]) === JSON.stringify(saved) &&
    (await workspaces.resume(saved)).opened === 2 &&
    calls[0][1].exactKind === 'folder' && calls[1][1].exactKind === 'file' && calls[2][1].url === 'https://example.org/class');
  check('workspaces', 'a missing file is reported while later items still open', Daily.describeResume({ opened: 2, total: 3, failures: ['note 1'] }) === 'Opened 2 of 3 workspace items. Could not open note 1.');
  check('workspaces', 'unsafe schemes, credentials and program files are rejected', [
    { links: 'javascript:alert(1)' }, { links: 'https://user:pass@example.org/' }, { notes: 'D:\\scripts\\run.bat' },
  ].every(input => { try { workspaces.save({ name: 'Unsafe', ...input }); return false; } catch { return true; } }));
  check('workspaces', 'simultaneous first writes merge instead of dropping the other tab’s new entry',
    mergeState(Daily.key, [saved], [{ id: 'workspace-2' }], []).value.length === 2);
  workspaces.save({ name: 'DBMS updated', links: 'https://example.org/new' }, saved.id);
  check('workspaces', 'editing retains the original record ID', workspaces.list().length === 1 && workspaces.list()[0].id === saved.id && workspaces.list()[0].name === 'DBMS updated');
  const workspace = workspaces.list()[0];
  await workspaces.resume(workspace);
  workspaces.record('/tool/openFile', {}, { success: true, path: 'D:\\Notes\\joins.pdf' });
  workspaces.record('/tool/openFile', {}, { error: 'not found', path: 'D:\\Notes\\missing.pdf' });
  const spoken = Daily.parse('Pause DBMS here. Current task: Review queries. Next, test the joins.');
  const checkpoint = workspaces.checkpoint(workspace, spoken.next, spoken.task);
  const restored = await workspaces.resume(workspaces.list()[0]);
  check('workspaces', 'the checkpoint only adds successful opens and resumes with its saved handoff',
    checkpoint.notes.join() === 'D:\\Notes\\joins.pdf' && restored.task === 'Review queries' &&
    restored.next === 'test the joins.' && /review queries.*test the joins/i.test(Daily.describeResume(restored)));

  const capture = Assistant.captures('inbox-2026-11-17.md', '- 3:35 PM — Review database joins');
  const liked = Assistant.inbox([{ id: 'n1', key: 'note', value: 'Database sketch', ts: +new Date(2026, 10, 17, 11) }], capture, 'database', '2026-11-17');
  check('inbox', 'named sources share the same date filter and newest-first order', liked.map(item => item.source).join() === 'Quick capture,Notes' && new Date(liked[0].at).getHours() === 15, liked);
  const quiet = { 'jarvis.settings': { quietEnabled: true, quietStart: '22:00', quietEnd: '07:00', quietPassDeadlines: true } };
  const overnight = +new Date(2026, 10, 17, 3, 15);
  check('quiet', 'overnight quiet holds reminders, while timers, urgent battery and opted-in deadlines pass',
    Assistant.holdAlert(quiet, 'reminder', overnight) && ['timer', 'battery_crit', 'deadline'].every(kind => !Assistant.holdAlert(quiet, kind, overnight)) &&
    !Assistant.holdAlert(quiet, 'reminder', +new Date(2026, 10, 17, 7)));
  check('voice correction', 'short target replaces the pending file name and carries its kind', Assistant.corrected('Open my OS notes.', 'DBMS.') === 'Open DBMS notes');

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:daily', 'SUMMARY:Class', 'DTSTART:20261116T100000Z', 'DTEND:20261116T110000Z',
    'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE:20261117T100000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:all-day', 'SUMMARY:Seminar', 'DTSTART;VALUE=DATE:20261118', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const localStart = +new Date(2026, 10, 16, 8);
  const period = availabilityEvents(ics, localStart, +new Date(2026, 10, 20));
  check('availability', 'recurrences respect exclusions and all-day items occupy a local day', !period.incomplete &&
    period.events.filter(item => item.title === 'Class').map(item => new Date(item.start).getUTCDate()).join() === '16,18' &&
    period.events.some(item => item.title === 'Seminar' && item.start === +new Date(2026, 10, 18) && item.end === +new Date(2026, 10, 19)), period);
  const hour = 3600000;
  const slots = Assistant.slots({ from: localStart, to: localStart + 3 * hour, minutes: 45, busy: [{ start: localStart + hour / 2, end: localStart + hour }] });
  check('availability', 'suggests a study slot after a clash and inside the cutoff', slots.length === 1 && slots[0].start === localStart + hour && slots[0].end === localStart + 1.75 * hour, slots);

  const rss = '<rss><channel><title>Lectures</title><item><title>Episode &amp; Notes</title><guid>ep-1</guid><enclosure url="https://media.example.org/ep.mp3" type="audio/mpeg" /></item></channel></rss>';
  const podcast = readPodcast(rss, 'https://example.org/feed');
  check('media', 'RSS yields a playable episode with a stable ID', podcast.title === 'Lectures' && podcast.episodes.length === 1 &&
    podcast.episodes[0].name === 'Episode & Notes' && podcast.episodes[0].id === readPodcast(rss, 'https://example.org/feed').episodes[0]?.id, podcast);
  check('media', 'HLS references are rewritten to registered same-origin resources', rewriteManifest('#EXTM3U\nclip.ts', 'https://example.org/radio/playlist.m3u8',
    url => url.pathname.startsWith('/radio/'), url => '/radio-part/' + new URL(url).pathname.split('/').pop()) === '#EXTM3U\n/radio-part/clip.ts');
  check('media', 'official player searches encode the exact title', mediaTarget('A & B', 'Spotify')?.url === 'https://open.spotify.com/search/A%20%26%20B' &&
    mediaTarget('https://youtu.be/example')?.provider === 'YouTube');

  const fake = fakeAudio();
  const audio = FocusAudio.create(() => fake.context);
  check('focus audio', 'both requested sounds resolve without changing a silent session', FocusAudio.fromCommand('Start a 45-minute study session with rain sounds.') === 'rain' && FocusAudio.fromCommand('with white noise') === 'white' && FocusAudio.fromCommand('Start a session') === '');
  check('focus audio', 'rain plays a locally generated filtered buffer', await audio.play('rain') && audio.playing() && fake.events.join() === 'filter,start');
  audio.duck(true);
  audio.stop();
  check('focus audio', 'the loop ducks and releases the source on stop', fake.events.includes(0.014) && fake.events.at(-1) === 'stop' && !audio.playing());
  check('focus audio', 'white noise skips the rain filter', await audio.play('white') && fake.events.filter(e => e === 'filter').length === 1);

  const feed = News.findFeed('Bangalore, Karnataka', 'Kannada');
  const host = new URL(feed.url).origin;
  const now = new Date('2026-11-17T10:30:00+05:30').getTime();
  const item = (title, url, date) => '<item><title>' + title + '</title><link>' + url + '</link><pubDate>' + date + '</pubDate></item>';
  const fixture = '<rss><channel>' +
    item('ಹಳೆಯ ಸುದ್ದಿ', host + '/old', '1 Nov 2026 08:00:00 +0530') +
    item('<![CDATA[ಬೆಂಗಳೂರು &amp; ಮಳೆ]]>', host + '/rain', '17 Nov 2026 09:30:00 +0530') +
    item('Unknown time', host + '/time', '') +
    item('Another site', 'https://example.org/story', '17 Nov 2026 10:00:00 +0530') +
    '</channel></rss>';
  const headlines = News.parseRss(fixture, feed, now);
  check('news parser', 'native title, original source and publication time survive parsing without forged or stale items',
    headlines.length === 1 && headlines[0].title === 'ಬೆಂಗಳೂರು & ಮಳೆ' && !!headlines[0].source && headlines[0].publishedAt === '2026-11-17T04:00:00.000Z');
  check('news feed', 'a mismatched language is not silently replaced with another language', !News.findFeed('Bengaluru', 'Telugu'));
  assert.throws(() => News.parseRss('<!DOCTYPE rss><rss></rss>', feed));
  let handler, loads = 0;
  News.register({ post(_path, fn) { handler = fn; } }, { load: async () => { loads++; return '<rss><channel></channel></rss>'; } });
  const call = async body => {
    const reply = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; } };
    await handler({ body }, reply);
    return reply;
  };
  check('news route', 'disabled online tools or an unsupported city causes no publisher request',
    (await call({ city: 'Bengaluru' })).code === 400 && (await call({ city: 'unknown', online: true })).code === 404 && loads === 0);
  await call({ city: 'Bengaluru', online: true });
  check('news route', 'valid requests fetch once and reuse the short in-memory cache',
    (await call({ city: 'Bengaluru', online: true })).value.city === 'Bengaluru' && loads === 1);
  process.exitCode = done() ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
