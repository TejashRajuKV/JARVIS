'use strict';
const MediaLinks = (() => {
  function target(input, provider) {
    const value = String(input || '').trim();
    const preferred = String(provider || '').toLowerCase();
    if (/^spotify:(?:track|album|playlist|episode|show):[A-Za-z0-9]+$/.test(value)) {
      const [, type, id] = value.split(':');
      return { provider: 'Spotify', url: 'https://open.spotify.com/' + type + '/' + id };
    }
    if (/^https?:\/\//i.test(value)) {
      let url;
      try { url = new URL(value); } catch { return null; }
      if (url.username || url.password) return null;
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname))
        return { provider: 'YouTube', url: url.href };
      if (url.hostname === 'open.spotify.com' && /^\/(?:embed\/)?(?:track|album|playlist|episode|show)\/[A-Za-z0-9]+\/?$/.test(url.pathname))
        return { provider: 'Spotify', url: 'https://open.spotify.com' + url.pathname.replace(/^\/embed\//, '/') };
      return preferred === 'video link' ? { provider: 'browser', url: url.href } : null;
    }
    if (!value || /^[a-z][\w+.-]*:/i.test(value)) return null;
    if (preferred === 'youtube') return { provider: 'YouTube', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(value) };
    if (preferred === 'spotify') return { provider: 'Spotify', url: 'https://open.spotify.com/search/' + encodeURIComponent(value) };
    return null;
  }
  return { target };
})();
if (typeof module !== 'undefined') module.exports = MediaLinks;

if (typeof window !== 'undefined') window.MediaCenter = (() => {
  const audio = $('#mediaAudio'), compact = $('#compactMedia'), playbackStatus = $('#mediaPlaybackStatus');
  const status = $('#mediaStatus'), fallback = $('#mediaFallback'), seek = $('#mediaSeek'), volume = $('#mediaVolume');
  const feeds = $('#podcastFeeds'), positionsKey = 'jarvis.podcastPositions', subscriptionsKey = 'jarvis.podcastFeeds';
  const queue = [];
  let current, hls, hlsLibrary, generation = 0, sleepTimer, ducked = false, volumeLevel = 0.55, localVideo, lastProgressAt = 0;
  const storedFeeds = () => {
    const saved = store.get(subscriptionsKey, []);
    return Array.isArray(saved) ? saved.filter(item => item && typeof item.url === 'string' && typeof item.title === 'string') : [];
  };
  const positions = () => {
    const saved = store.get(positionsKey, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  };
  function savePosition(finished = false) {
    finished ||= audio.ended;
    if (current?.kind !== 'podcast' || (!finished && audio.currentTime < 1)) return;
    const items = positions();
    items[current.id] = { id: current.id, seconds: Math.floor(audio.currentTime), feed: current.feed, at: Date.now(), done: finished };
    store.set(positionsKey, Object.fromEntries(Object.entries(items).sort((a, b) => b[1].at - a[1].at).slice(0, 200)));
  }
  function release() {
    generation++;
    savePosition();
    audio.pause();
    if (hls) { hls.destroy(); hls = null; }
    audio.removeAttribute('src');
    audio.load();
    current = null;
  }
  function refresh() {
    const focusSound = focus?.phase === 'focus' && FocusAudio.valid(focus.sound) && (!current || focusAudio.playing());
    compact.hidden = !current && !focusSound;
    if (focusSound) {
      $('#mediaNow').textContent = FocusAudio.label(focus.sound);
      $('#mediaToggle').textContent = focusAudio.playing() ? 'Pause' : 'Play';
      $('#mediaPrevious').disabled = $('#mediaNext').disabled = true;
      $('#mediaSeekLabel').hidden = fallback.hidden = true;
      playbackStatus.textContent = focusAudio.playing() ? 'Focus audio playing' : 'Focus audio paused';
      return;
    }
    if (!current) return;
    $('#mediaNow').textContent = current.title;
    $('#mediaToggle').textContent = audio.paused ? 'Play' : 'Pause';
    const index = queue.indexOf(current);
    $('#mediaPrevious').disabled = index <= 0;
    $('#mediaNext').disabled = index < 0 || index >= queue.length - 1;
    $('#mediaSeekLabel').hidden = current.kind === 'radio' || !Number.isFinite(audio.duration);
    seek.max = Number.isFinite(audio.duration) ? audio.duration : 1;
    if (document.activeElement !== seek) seek.value = audio.currentTime || 0;
    fallback.hidden = !current.official;
    if (current.official) fallback.href = current.official;
    else fallback.removeAttribute('href');
  }
  function duck(quiet) {
    ducked = quiet;
    audio.volume = ducked ? volumeLevel * 0.22 : volumeLevel;
    focusAudio.setVolume(volumeLevel / 0.55);
  }
  async function start() {
    if (!current) return false;
    focusAudio.stop(); renderFocusAudio();
    try {
      await audio.play();
      playbackStatus.textContent = 'Playing';
      return true;
    } catch {
      playbackStatus.textContent = 'Press Play to start, or use the official player if the source is unavailable.';
      return false;
    } finally { refresh(); }
  }
  async function select(entry) {
    if (current === entry) return start();
    release(); current = entry;
    audio.playbackRate = entry.kind === 'podcast' ? Number($('#mediaSpeed').value) : 1;
    audio.src = entry.url;
    const at = !positions()[entry.id]?.done && positions()[entry.id]?.seconds;
    if (entry.kind === 'podcast' && at) {
      const checkpoint = generation;
      audio.addEventListener('loadedmetadata', () => {
        if (checkpoint === generation) audio.currentTime = Math.min(at, audio.duration || at);
      }, { once: true });
    }
    refresh();
    return start();
  }
  function showQueue() {
    const host = $('#mediaQueue'); host.replaceChildren();
    if (!queue.length) { host.textContent = 'No audio queued.'; return; }
    for (const entry of queue) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = entry.title;
      button.onclick = () => void select(entry);
      host.append(button);
    }
  }
  function step(offset) {
    const index = queue.indexOf(current);
    if (index >= 0 && queue[index + offset]) void select(queue[index + offset]);
  }
  audio.addEventListener('timeupdate', () => {
    refresh();
    if (Date.now() - lastProgressAt > 5000) { savePosition(); lastProgressAt = Date.now(); }
  });
  audio.addEventListener('loadedmetadata', refresh);
  audio.addEventListener('pause', () => { savePosition(); refresh(); });
  audio.addEventListener('play', refresh);
  audio.addEventListener('ended', () => { savePosition(true); step(1); refresh(); });
  audio.addEventListener('error', () => { if (current) playbackStatus.textContent = 'This audio could not be played.'; });
  window.addEventListener('pagehide', () => savePosition(), { capture: true });
  volume.oninput = () => { volumeLevel = Number(volume.value); duck(ducked); };
  seek.oninput = () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value); };
  $('#mediaToggle').onclick = () => {
    if (focusAudio.playing()) { focusAudio.stop(); renderFocusAudio(); return; }
    if (!current) { void playFocusAudio(); return; }
    if (audio.paused) void start(); else audio.pause();
  };
  $('#mediaPrevious').onclick = () => step(-1);
  $('#mediaNext').onclick = () => step(1);
  $('#mediaSpeed').onchange = event => { if (current?.kind === 'podcast') audio.playbackRate = Number(event.target.value); };
  $('#mediaSleep').onchange = event => {
    clearTimeout(sleepTimer);
    const minutes = Number(event.target.value);
    if (minutes) sleepTimer = setTimeout(() => {
      audio.pause(); $('#mediaSleep').value = '0'; playbackStatus.textContent = 'Sleep timer ended.';
    }, minutes * 60000);
  };
  $('#mediaFiles').onchange = event => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 100 - queue.length));
    for (const file of files) queue.push({ kind: 'local', title: file.name, url: URL.createObjectURL(file) });
    event.target.value = '';
    showQueue();
    if (files.length && !current) void select(queue[0]);
  };
  $('#mediaVideo').onchange = event => {
    if (localVideo) URL.revokeObjectURL(localVideo);
    const file = event.target.files?.[0];
    const link = $('#mediaLocalVideoLink');
    localVideo = file ? URL.createObjectURL(file) : '';
    link.hidden = !localVideo;
    if (localVideo) link.href = localVideo;
  };
  $('#mediaClear').onclick = () => {
    release();
    for (const entry of queue) if (entry.kind === 'local') URL.revokeObjectURL(entry.url);
    queue.length = 0; showQueue(); refresh();
  };
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    hlsLibrary ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/api/media/hls.js';
      script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error('HLS unavailable'));
      script.onerror = () => reject(new Error('HLS unavailable'));
      document.head.append(script);
    }).catch(error => { hlsLibrary = null; throw error; });
    return hlsLibrary;
  }
  async function radio(station, official) {
    const url = '/api/media/radio/' + station.channel;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(16000) });
      if (!response.ok) return false;
      const native = audio.canPlayType('application/vnd.apple.mpegurl');
      const Hls = native ? null : await loadHls();
      if (!native && !Hls.isSupported()) return false;
      release();
      current = { kind: 'radio', title: station.name + ' · ' + station.frequency + ' FM', official };
      playbackStatus.textContent = 'Loading live radio…';
      audio.playbackRate = 1;
      if (native) { audio.src = url; void start(); }
      else {
        hls = new Hls({ enableWorker: false, maxBufferLength: 20, liveSyncDurationCount: 3 });
        hls.on(Hls.Events.MANIFEST_PARSED, () => void start());
        hls.on(Hls.Events.ERROR, (_event, detail) => {
          if (!detail.fatal) return;
          audio.pause(); playbackStatus.textContent = 'The broadcast could not play here. Open the official player.';
        });
        hls.attachMedia(audio); hls.loadSource(url);
      }
      refresh(); return true;
    } catch { return false; }
  }
  async function provider(input, service) {
    const target = MediaLinks.target(input, service);
    if (!target) return 'Enter a valid provider link or a search title.';
    const result = await callTool('/tool/openUrl', { url: target.url });
    if (!result.error) audio.pause();
    return result.error || 'Opened ' + target.provider + ' in its own player or search page.';
  }
  $('#mediaProviderForm').onsubmit = async event => {
    event.preventDefault();
    status.textContent = await provider($('#mediaProviderInput').value, $('#mediaProvider').value);
  };
  function showFeeds(selected = '') {
    feeds.replaceChildren(new Option('Choose a podcast', ''));
    for (const feed of storedFeeds()) feeds.add(new Option(feed.title, feed.url));
    feeds.value = selected;
  }
  async function loadFeed(url) {
    if (!settings.online) return { error: 'Enable Online tools to load podcasts.' };
    const target = String(url || '').trim();
    if (!target) return { error: 'Choose a podcast feed.' };
    return callTool('/media/podcast', { url: target, online: true });
  }
  async function podcastItem(feed, episode) {
    let item = queue.find(entry => entry.id === episode.id);
    if (!item) {
      if (queue.length >= 100) return false;
      item = { id: episode.id, feed, title: episode.name, url: '/api/media/episode/' + episode.id, kind: 'podcast' };
      queue.push(item); showQueue();
    }
    await select(item);
    return true;
  }
  function showEpisodes(url, result) {
    const target = $('#podcastEpisodes'); target.replaceChildren();
    if (result.error) { status.textContent = result.error; return; }
    status.textContent = result.episodes.length ? result.title : 'No supported audio episodes in this feed.';
    for (const episode of result.episodes) {
      const row = document.createElement('article');
      const title = document.createElement('strong'); title.textContent = episode.name;
      const play = document.createElement('button'); play.type = 'button'; play.className = 'btn';
      play.textContent = positions()[episode.id]?.seconds && !positions()[episode.id].done ? 'Resume' : 'Play';
      play.onclick = async () => { if (!await podcastItem(url, episode)) status.textContent = 'Clear the audio queue before adding another episode.'; };
      row.append(title, play); target.append(row);
    }
  }
  $('#podcastForm').onsubmit = async event => {
    event.preventDefault();
    const url = $('#podcastUrl').value.trim();
    const saved = storedFeeds();
    if (saved.length >= 20 && !saved.some(item => item.url === url)) { status.textContent = 'Remove a subscription before adding another.'; return; }
    status.textContent = 'Loading podcast…';
    const result = await loadFeed(url);
    if (!result.error) {
      store.set(subscriptionsKey, [{ url, title: result.title }, ...storedFeeds().filter(item => item.url !== url)].slice(0, 20));
      showFeeds(url); event.target.reset();
    }
    showEpisodes(url, result);
  };
  feeds.onchange = async () => { const url = feeds.value; showEpisodes(url, url ? await loadFeed(url) : { episodes: [] }); };
  $('#podcastRemove').onclick = () => {
    if (!feeds.value) return;
    store.set(subscriptionsKey, storedFeeds().filter(item => item.url !== feeds.value));
    showFeeds(); $('#podcastEpisodes').replaceChildren(); status.textContent = 'Subscription removed.';
  };
  async function resumePodcast(yesterday = false) {
    const day = new Date();
    if (yesterday) day.setDate(day.getDate() - 1);
    const saved = Object.values(positions()).filter(item => item && !item.done && (!yesterday ||
      AssistantTools.localDay(new Date(item.at)) === AssistantTools.localDay(day))).sort((a, b) => b.at - a.at)[0];
    if (!saved) return 'No unfinished podcast episode' + (yesterday ? ' from yesterday' : '') + '.';
    const result = await loadFeed(saved.feed);
    if (result.error) return result.error;
    const episode = result.episodes.find(item => item.id === saved.id);
    if (!episode) return 'The episode is no longer in its feed.';
    if (!await podcastItem(saved.feed, episode)) return 'Clear the audio queue before resuming.';
    return 'Loaded ' + episode.name + ' at the saved position.';
  }
  $('#podcastResume').onclick = async () => { status.textContent = await resumePodcast(); };
  async function command(text) {
    const input = text.replace(/^jarvis[, ]+/i, '').trim();
    const audioCommand = /^(play|pause|next|previous) (?:my )?(?:music|audio|media)[.!?]?$/i.exec(input);
    if (audioCommand?.[1].toLowerCase() === 'pause' && focusAudio.playing()) {
      focusAudio.stop(); renderFocusAudio(); return 'Paused focus audio.';
    }
    if (audioCommand && current) {
      switch (audioCommand[1].toLowerCase()) {
        case 'pause': audio.pause(); return 'Paused the player.';
        case 'next': step(1); return 'Checked the next item in the queue.';
        case 'previous': step(-1); return 'Checked the previous item in the queue.';
        default: return await start() ? 'Playing.' : 'Press Play to start the player.';
      }
    }
    if (/^(?:continue|resume) (?:my podcast|my episode|yesterday(?:'s|’s) episode)(?: from where i stopped)?[.!?]?$/i.test(input))
      return resumePodcast(/yesterday/i.test(input));
    if (/^(?:show|open) (?:the )?(?:media|music|audio player)[.!?]?$/i.test(input)) { openDailyPane('media'); return 'Opened Media.'; }
    const sleep = /^stop (?:my )?(?:music|audio|radio) in (\d{1,3}) minutes?[.!?]?$/i.exec(input);
    if (sleep && current) {
      const minutes = Math.min(180, Number(sleep[1]));
      if (!minutes) return 'Give me a positive number of minutes.';
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => { audio.pause(); playbackStatus.textContent = 'Sleep timer ended.'; }, minutes * 60000);
      return 'I’ll stop the player in ' + minutes + ' minutes.';
    }
    const onProvider = /^play (.+?) on (youtube|spotify)[.!?]?$/i.exec(input);
    if (onProvider) return provider(onProvider[1], onProvider[2]);
    const link = /^play\s+(https?:\/\/\S+|spotify:\S+)$/i.exec(input);
    if (link && MediaLinks.target(link[1])) return provider(link[1]);
    const video = /^open video\s+(https?:\/\/\S+)$/i.exec(input);
    if (video) return provider(video[1], 'video link');
    return null;
  }
  showQueue(); showFeeds(); duck(false); refresh();
  return { radio, command, duck, refresh, pause: () => audio.pause() };
})();
