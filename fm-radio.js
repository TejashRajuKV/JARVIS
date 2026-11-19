/* Frequencies: Prasar Bharati's transmitter list and FM Rainbow chart.
   Channel IDs: https://akashvani.gov.in/radio/live.php (official player).
   A channel ID identifies a stream. The frequency identifies its local FM broadcast. */
const FMRadio = (() => {
  const player = 'https://akashvani.gov.in/radio/live.php';
  const cities = [
    { name: 'Bengaluru', aliases: ['bangalore'], stations: [
      { channel: 117, name: 'FM Rainbow Kannada', frequency: '101.3', language: 'Kannada' },
    ] },
    { name: 'Chennai', aliases: ['madras'], stations: [
      { channel: 297, name: 'FM Rainbow', frequency: '101.4', language: 'Tamil, English' },
      { channel: 241, name: 'FM Gold', frequency: '100.1', language: 'Tamil, English' },
    ] },
    { name: 'Delhi', aliases: ['new delhi'], stations: [
      { channel: 3, name: 'FM Rainbow', frequency: '102.6', language: 'Hindi' },
      { channel: 2, name: 'FM Gold', frequency: '100.1', language: 'Hindi' },
    ] },
    { name: 'Hyderabad', aliases: [], stations: [
      { channel: 256, name: 'FM Rainbow', frequency: '101.9', language: 'Telugu, Urdu, Hindi' },
      { channel: 257, name: 'Vividh Bharati Telugu', frequency: '102.8', language: 'Telugu, Urdu, Hindi' },
    ] },
    { name: 'Vijayawada', aliases: ['bezawada'], stations: [
      { channel: 50, name: 'FM Rainbow', frequency: '102.2', language: 'Telugu' },
      { channel: 51, name: 'Vividh Bharati Telugu', frequency: '101.3', language: 'Telugu' },
    ] },
    { name: 'Visakhapatnam', aliases: ['vizag', 'vishakhapatnam'], stations: [
      { channel: 53, name: 'FM Rainbow', frequency: '102.0', language: 'Telugu' },
    ] },
  ];
  const cityNames = cities.map(city => city.name).join(', ');
  const normalize = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const findCity = text => {
    const key = normalize(text).replace(/,.*$/, '');
    return cities.find(city => normalize(city.name) === key || city.aliases.includes(key));
  };
  const stationUrl = station => player + '?channel=' + station.channel;

  function parse(text) {
    const command = normalize(text).replace(/^jarvis[, ]+/, '').replace(/[.!?]+$/, '');
    let match = command.match(/^(?:set|change) (?:my )?(?:fm|radio) city to (.+)$/);
    if (match) return { action: 'city', city: match[1] };
    if (/^use (?:my )?home city for (?:fm|radio)$/.test(command)) return { action: 'home' };
    match = command.match(/^(?:(?:show|list|open) (?:me )?(?:the )?)?(?:(?:local )?(?:fm(?: radio)?|radio)(?: stations)?)(?: (?:in|for) (.+))?$/);
    if (match) return { action: 'list', city: match[1] };
    if (/^(?:save|favou?rite) (?:this|that) (?:radio )?station$/.test(command)) return { action: 'favorite' };
    if (/^(?:(?:show|list) )?(?:my )?(?:radio|fm) favou?rites$/.test(command)) return { action: 'favorites' };
    match = command.match(/^(?:tune (?:in )?to|play) (.+)$/);
    if (!match) return null;
    const [query, city] = match[1].split(/ in (.+)/);
    const frequency = query.match(/^(?:fm )?(\d{2,3})(?:(?:\.| point )([0-9]))?(?: (?:fm|mhz))?$/);
    if (frequency && (frequency[2] || /(?:fm|mhz)/.test(query) || command.startsWith('tune'))) {
      return { action: 'play', city, frequency: frequency[1] + '.' + (frequency[2] || '0') };
    }
    if (/^(?:the )?(?:local )?(?:radio|fm(?: radio)?)$/.test(query)) return { action: 'play', city };
    if (/^(?:fm (?:rainbow(?: kannada)?|gold)|rainbow(?: fm)?|vividh bharati(?: telugu)?)$/.test(query))
      return { action: 'play', city, name: query };
    return null;
  }

  function create({ settings, save, open, play }) {
    let sessionCity;
    let lastStation;
    const savedCity = () => findCity(settings.radioCity);
    const currentCity = () => sessionCity || savedCity() || findCity(settings.city);
    const rememberStation = (station, city) => { lastStation = { ...station, city: city.name }; };
    const favoriteIds = () => Array.isArray(settings.radioFavorites) ? settings.radioFavorites : [];
    const isFavorite = station => favoriteIds().includes(station.channel);
    const setFavorite = (station, on) => {
      const ids = new Set(favoriteIds());
      if (on) ids.add(station.channel);
      else ids.delete(station.channel);
      settings.radioFavorites = [...ids];
      save();
    };
    const rememberCity = city => {
      sessionCity = undefined;
      settings.radioCity = city ? city.name : '';
      save();
    };
    const label = station => station.name + ' (' + station.frequency + ' FM)';
    const stationLines = stations => stations.map(station => '- ' + label(station)).join('\n');
    async function playStation(station, city) {
      if (!await play?.(station, stationUrl(station))) return false;
      rememberStation(station, city);
      return true;
    }

    async function handle(text) {
      const request = parse(text);
      if (!request) return null;
      if (request.action === 'home') {
        rememberCity();
        const city = currentCity();
        return 'Radio follows your Home City.' + (city ? ' Current city: ' + city.name + '.' : ' Choose a supported Home City to see local stations.');
      }
      if (request.action === 'favorite') {
        if (!lastStation) return 'Open a radio station first, or save one from Today → Radio.';
        setFavorite(lastStation, true);
        return 'Saved ' + label(lastStation) + ' for ' + lastStation.city + '.';
      }
      const city = request.city ? findCity(request.city) : currentCity();
      if (!city) return 'Choose a radio city in Today. Supported cities: ' + cityNames + '.';
      if (request.action === 'city') rememberCity(city);
      else if (request.city) sessionCity = city;
      if (request.action === 'favorites') {
        const saved = city.stations.filter(isFavorite);
        return saved.length ? 'Saved stations in ' + city.name + ':\n' + stationLines(saved) : 'No saved stations in ' + city.name + ' yet.';
      }
      if (request.action !== 'play') {
        const title = request.action === 'city' ? 'Saved ' + city.name + ' as your radio city.' : 'FM stations in ' + city.name + '.';
        return title + '\n' + stationLines(city.stations);
      }
      const name = request.name?.replace(/^fm | fm$/g, '');
      const station = request.frequency ? city.stations.find(item => item.frequency === request.frequency)
        : name ? city.stations.find(item => normalize(item.name).includes(name))
          : city.stations.find(isFavorite) || city.stations[0];
      if (!station) return 'That station isn’t in the catalogue for ' + city.name + '.\n' + stationLines(city.stations);
      if (await playStation(station, city)) return 'Loaded ' + label(station) + ' for ' + city.name + '. Use Play if it does not start automatically.';
      if (!await open(stationUrl(station))) return 'Could not open the player. Use the Akashvani link in Today → Radio.';
      rememberStation(station, city);
      return 'Opened ' + label(station) + ' in Akashvani’s player for ' + city.name + '. Press Play there if needed.';
    }

    return { handle, currentCity, savedCity, isFavorite, setFavorite, rememberCity, rememberStation, playStation };
  }

  function mount(document, radio) {
    const select = document.getElementById('radioCity');
    const stationList = document.getElementById('radioStations');
    const status = document.getElementById('radioStatus');
    for (const city of cities) {
      const option = document.createElement('option');
      option.value = option.textContent = city.name;
      select.append(option);
    }
    function render() {
      const city = radio.currentCity();
      select.value = radio.savedCity()?.name || '';
      status.textContent = city ? 'Stations in ' + city.name + '.' : 'Select a city to see local FM stations.';
      stationList.replaceChildren();
      if (!city) return;
      for (const station of city.stations) {
        const row = document.createElement('li');
        const details = document.createElement('span');
        details.textContent = station.name + ' · ' + station.frequency + ' FM · ' + station.language;
        const open = document.createElement('a');
        open.className = 'btn';
        open.href = stationUrl(station);
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = 'Open player';
        open.setAttribute('aria-label', 'Open ' + station.name + ' in Akashvani’s player');
        open.addEventListener('click', () => radio.rememberStation(station, city));
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn';
        play.textContent = 'Play here';
        play.setAttribute('aria-label', 'Play ' + station.name + ' here');
        play.onclick = async () => {
          play.disabled = true;
          const playing = await radio.playStation(station, city);
          play.disabled = false;
          status.textContent = playing ? 'Loaded ' + station.name + '.' : 'Stream unavailable here. Try the official player.';
        };
        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'btn';
        favorite.textContent = 'Favourite';
        favorite.setAttribute('aria-label', 'Favourite ' + station.name);
        favorite.setAttribute('aria-pressed', String(radio.isFavorite(station)));
        favorite.addEventListener('click', () => {
          const saved = !radio.isFavorite(station);
          radio.setFavorite(station, saved);
          favorite.setAttribute('aria-pressed', String(saved));
        });
        row.append(details, play, open, favorite);
        stationList.append(row);
      }
    }
    select.addEventListener('change', () => { radio.rememberCity(findCity(select.value)); render(); });
    render();
    return render;
  }

  return { parse, findCity, create, mount };
})();

if (typeof module !== 'undefined') module.exports = FMRadio;
