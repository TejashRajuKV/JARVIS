'use strict';
const { check, done } = require('./lib/server').suite('fm-radio');
const { parse, create } = require('../fm-radio');

(async () => {
  const settings = { city: 'Bangalore, Karnataka' };
  const opened = [];
  let writes = 0;
  let playerAvailable = true;
  const radio = create({ settings, save: () => writes++, open: async url => {
    opened.push(url);
    return playerAvailable;
  } });

  check('routing', 'normal media and weather commands fall through', ['play 1989', 'play lofi on YouTube', 'weather in Delhi'].every(text => parse(text) === null));
  check('home city', 'Home City aliases resolve without writing settings or opening a player',
    /Bengaluru[\s\S]*101\.3 FM/.test(await radio.handle('Show me the FM stations')) && writes === 0 && opened.length === 0);
  check('frequency', 'spoken decimal resolves to the Bengaluru channel',
    /Opened FM Rainbow Kannada/.test(await radio.handle('Jarvis, play 101 point 3')) &&
      opened.at(-1) === 'https://akashvani.gov.in/radio/live.php?channel=117');
  check('temporary city', 'listing another city changes the frequency lookup without saving it',
    /Vijayawada[\s\S]*102\.2 FM[\s\S]*101\.3 FM/.test(await radio.handle('Show FM stations in Vijayawada')) &&
      radio.currentCity().name === 'Vijayawada' && writes === 0);
  check('frequency', 'the same frequency uses the new city channel',
    /Opened Vividh Bharati Telugu/.test(await radio.handle('Play 101.3')) &&
      opened.at(-1) === 'https://akashvani.gov.in/radio/live.php?channel=51');
  check('favourites', 'saving a station persists its channel ID', /Saved/.test(await radio.handle('Save this radio station')) &&
    settings.radioFavorites.length === 1 && settings.radioFavorites[0] === 51 && writes === 1);
  check('favourites', 'local radio picks the saved station when available',
    /Opened Vividh Bharati Telugu/.test(await radio.handle('Play local radio')));
  check('saved city', 'radio city setting persists independently of Home City',
    /Saved Hyderabad/.test(await radio.handle('Set my radio city to Hyderabad')) && settings.radioCity === 'Hyderabad' &&
      settings.city === 'Bangalore, Karnataka' && writes === 2);
  const restored = create({ settings, save: () => {}, open: async () => true });
  check('saved city', 'a fresh view restores the radio city and keeps favourites city-specific',
    restored.currentCity().name === 'Hyderabad' && /No saved stations in Hyderabad/.test(await restored.handle('Show radio favourites')));
  const openedCount = opened.length;
  check('frequency', 'an unmatched frequency never opens a station in another city',
    /catalogue for Hyderabad/.test(await radio.handle('Play 101.3')) && opened.length === openedCount);
  check('unknown city', 'unsupported cities list supported options without falling back or changing state',
    /Supported cities/.test(await radio.handle('Play radio in Mumbai')) && radio.currentCity().name === 'Hyderabad' &&
      opened.length === openedCount);
  playerAvailable = false;
  check('playback handoff', 'a failed launch gives the manual player fallback without claiming success',
    /Could not open the player/.test(await radio.handle('Play FM Rainbow')));
  check('home city', 'clearing the override follows Home City again',
    /Bengaluru/.test(await radio.handle('Use my home city for radio')) && settings.radioCity === '' && writes === 3);
  process.exitCode = done() ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
