'use strict';
/* executeTool, web: websites, search, YouTube, maps, research, coding contests.
   Moved unchanged out of script.js (tools/registry.js). Called as handler(p, raw, s, a) with s = p.text and a = p.args || {}; the globals it uses
   (callTool, toolStep, settings, todos…) come from script.js at call time. An intent that is not this area's returns ToolHandlers.NONE. */
ToolHandlers.add('web', async function (p, raw, s, a) {
  switch (p.intent) {
    case 'COMMERCE_COMPARE': {
      const type = a.type === 'bus' ? 'bus' : 'product';
      const payload = type === 'bus'
        ? { type, from: String(a.from || '').slice(0, 100), to: String(a.to || '').slice(0, 100), date: String(a.date || '').slice(0, 40), provider: String(a.provider || 'all').slice(0, 20) }
        : { type, query: String(a.query || s || '').slice(0, 160), provider: String(a.provider || 'all').slice(0, 20) };
      if ((type === 'bus' && (!payload.from || !payload.to)) || (type === 'product' && !payload.query)) return { text: type === 'bus' ? 'Tell me the departure city and destination city so I can compare bus options.' : 'Which exact product or model should I compare?' };
      const r = await callTool('/commerce/compare', payload);
      if (!r || !r.success) return { text: 'I could not retrieve comparison results right now. ' + ((r && r.error) || 'Try again in a moment.'), error: true };
      const lines = [];
      lines.push(type === 'bus' ? '**Live bus-search comparison**' : '**Live product-search comparison**');
      lines.push(type === 'bus' ? 'Route: **' + payload.from + ' → ' + payload.to + '**' + (payload.date ? ' · ' + payload.date : '') : 'Product: **' + payload.query + '**');
      for (const provider of (r.providers || [])) {
        lines.push('\n**' + provider.name + '**');
        if (!provider.results || !provider.results.length) { lines.push('- No matching public listing found in this search.'); continue; }
        for (const item of provider.results.slice(0, 3)) {
          const price = item.priceCandidates && item.priceCandidates.length ? ' · observed price candidate: **' + item.priceCandidates[0].display + '**' : ' · no reliable price found in the accessible listing';
          lines.push('- [' + item.title + '](' + item.url + ')' + price);
        }
      }
      if (r.lowestObserved) lines.push('\n**Lowest observed listing candidate:** ' + r.lowestObserved.display + ' on ' + r.lowestObserved.provider + '. This is not a confirmed checkout total; verify exact model/route, date, availability, fees and offers before deciding.');
      lines.push('\nPrices are live search/page observations, not guaranteed checkout totals. JARVIS does not book or purchase automatically.');
      return { text: lines.join('\n'), tool: 'commerceCompare', suggestions: type === 'bus' ? ['Compare another date', 'Show government buses'] : ['Compare a different model', 'Check another budget'] };
    }

    /* ---- web ---- */
    case 'OPEN_URL': {
      const m = (a.url || s).match(/(https?:\/\/)?(([a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?/i);
      if (!m) return { text: 'Which website should I open?' };
      const url = (m[1] || 'https://') + m[2] + (m[4] || '');
      toolStep('openUrl → ' + url);
      const r = await callTool('/tool/openUrl', { url });
      return r.error ? { text: 'Could not open that: ' + r.error } : { text: 'Opening **' + m[2] + '**.', tool: 'openUrl' };
    }
    case 'YOUTUBE':
    case 'YOUTUBE_PLAY': {
      const YT = NLU.SITES[0];
      const searchOnly = !a.query && /^(search|find|look up|show me)\b/.test(s);
      let q = a.query || (s.match(/^(?:play|search|find|watch|put on|put|show me|look up|stream)\s+(.+?)\s+(?:on|in)\s+(?:youtube|yt)$/) || s.match(/^(?:on|in)\s+(?:youtube|yt),?\s+(?:play|put on|put|watch|stream)\s+(.+)$/) || s.match(/^(?:youtube|yt)\s+(.+)$/) || s.match(/^(?:play|put on|stream|watch)\s+(.+)$/) || [])[1] || '';
      q = cleanMediaQuery(String(q).toLowerCase());
      if (!q) return openSite(YT);
      if (searchOnly) return openSite(YT, q);
      toolStep('youtubeTop → ' + q);
      const top = await callTool('/tool/youtubeTop', { query: q });
      if (!top.success) { log('warn', 'youtube top result unavailable: ' + (top.error || '?')); return openSite(YT, q); }
      toolStep('openUrl → ' + top.url);
      const r = await callTool('/tool/openUrl', { url: top.url });
      if (r.error) return { text: 'I found **' + top.title + '** but could not open the browser: ' + r.error };
      return { text: '▶ Playing **' + top.title + '** on YouTube.', speak: 'Playing ' + top.title.split(/[|(\[]/)[0].trim(), tool: 'youtube', suggestions: ['Search YouTube for ' + q, 'Pause'] };
    }
    case 'SITE_SEARCH': {
      const site = NLU.findSite(s) || NLU.SITES[1];
      let m = s.match(/search (?:on |in )?.+? (?:for )(.+)$/) || s.match(/(?:search|look up|find) (?:for )?(.+) on .+$/) || s.match(/search (?:on |in )?\S+(?: \S+)? (.+)$/);
      const q = a.query || (m ? m[1] : '');
      if (!q) return { text: 'What should I search ' + site.n + ' for?' };
      return openSite(site, q.trim());
    }
    case 'WEB_SEARCH': {
      const q = a.query || s.replace(/^(google|search( the web| online| google| the internet)?( for)?|look up|search up|browse for)\s+/, '');
      return openSite(NLU.SITES[1], q);
    }
    case 'WEATHER': {
      if (!settings.online) return { text: 'Weather needs the internet, and Online tools are switched off. Enable them?', actions: enableOnlineAction() };
      let city = a.city || ((s.match(/\b(?:in|at|for|of)\s+([a-z][a-z .'-]+?)(?:\s+(?:today|tomorrow|now|right now|this week|tonight))?$/) || [])[1] || '').trim();
      // "the weather in this/that place" names no city — use the home city, or ask which place.
      if (/^(the|my|here|outside|this place|that place|there)$/.test(city)) city = '';
      if (!city && /\b(this|that) (place|location|area|city)\b/.test(s)) {
        if (settings.city) return executeTool({ ...p, text: p.text.replace(/\b(this|that) (place|location|area|city)\b/g, ' ').replace(/\s+/g, ' ').trim(), args: {} }, raw);
        return { text: 'Which place? Name it — "weather in **Manali**" — or set a home city ("my city is Bengaluru") and "this place" will mean it.', speak: 'Which place should I check the weather for?' };
      }
      toolStep('weather → ' + (city || settings.city || 'auto'));
      const w = await fetchWeather(city);
      if (w.error) {
        // Service down or place unknown: fall back to a web search, never guess.
        const placeName = city || settings.city || '';
        if (placeName && settings.online && backend.online) {
          toolStep('research → weather in ' + placeName);
          const res = await doResearch('current weather in ' + placeName);
          if (!res.askLLM || llmReady()) return { ...res, speak: 'I could not reach the weather service, so I searched the web for the weather in ' + placeName + '.' };
        }
        return { text: 'I could not reach the weather service — ' + w.error };
      }
      if (w.approximate) return { text: 'Your internet connection only tells me the country, not the city, so I would be guessing. Tell me your city — say "my city is Bengaluru" — and I will remember it.', suggestions: ['My city is Bengaluru', 'Weather in Bengaluru'] };
      ctx.lastIntent = 'WEATHER';
      if (/tomorrow/.test(s) && w.tomorrow) return { text: 'Tomorrow in **' + w.place + '**: ' + w.tomorrow.desc.toLowerCase() + ', ' + w.tomorrow.minC + '–' + w.tomorrow.maxC + '°C.', tool: 'weather' };
      const umbrella = w.rainChance >= 50 ? ' Chance of rain is ' + w.rainChance + '% — take an umbrella.' : '';
      return { text: '**' + w.place + '**: ' + w.tempC + '°C and ' + w.desc.toLowerCase() + ' (feels like ' + w.feelsC + '°C). Today ' + w.minC + '–' + w.maxC + '°C.' + umbrella, card: [['HUMIDITY', w.humidity + '%'], ['WIND', w.windKmph + ' km/h'], ['RAIN CHANCE', w.rainChance + '%']], tool: 'weather' };
    }

    case 'DISTANCE': {
      if (!settings.online) return { text: 'Distance needs the internet, and Online tools are switched off. Enable them?', actions: enableOnlineAction() };
      let from = a.from, to = a.to;
      if (!from || !to) {
        let m = p.original.match(/\bdistance\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)[.?!]*$/i)
          || p.original.match(/\bhow (?:many|much) (?:kms?|kilometers?|kilometres?)\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)[.?!]*$/i)
          || p.original.match(/^km\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\bhow long\s+(?:to|does it take to)\s+drive\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\btravel time\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i);
        if (m) { from = m[1].trim(); to = m[2].trim(); }
        if (!from) { m = p.original.match(/\bhow far\s+(?:is|are)\s+(?:it\s+)?from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i); if (m) { from = m[1].trim(); to = m[2].trim(); } }
        if (!from) {
          m = p.original.match(/\bhow far\s+(?:is|are)\s+(?:it\s+)?(.+?)\s+from\s+(.+?)[.?!]*$/i) || p.original.match(/\bis\s+(.+?)\s+far from\s+(.+?)[.?!]*$/i);
          if (m) { to = m[1].trim(); from = m[2].trim(); }
        }
      }
      if (!from || !to) return { text: 'Distance between which two places?' };
      toolStep('distance → ' + from + ' to ' + to);
      const r = await callTool('/tool/distance', { from, to, online: true });
      if (r.error) return { text: cap(r.error) + '.' };
      const dur = r.durationMin >= 60 ? Math.floor(r.durationMin / 60) + 'h ' + (r.durationMin % 60) + 'm' : r.durationMin + ' min';
      return { text: 'It’s **' + r.distanceKm + ' km** from **' + r.from.name + '** to **' + r.to.name + '** — about ' + dur + ' by road.', tool: 'distance',
        actions: [{ label: 'OPEN IN GOOGLE MAPS', fn: () => Agent.chatTool('open_directions', { from, to }, 0).then(res => deliver(res, { intent: 'AGENT_RUN', confidence: 1 })) }] };
    }
    case 'DIRECTIONS': {
      if (!settings.online) return { text: 'Directions need the internet, and Online tools are switched off. Enable them?', actions: enableOnlineAction() };
      let from = a.from, to = a.to;
      if (!from && !to) {
        // "X ... from A to B" (origin mentioned before destination)
        let m = p.original.match(/\b(?:directions?|route)\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\b(?:go|travel|drive)\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\btake me\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i)
          || p.original.match(/\bplan(?:ning)? a (?:road trip|trip)\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i);
        if (m) { from = m[1].trim(); to = m[2].trim(); }
        // "reach/travel to B from A" (destination mentioned before origin)
        if (!to) {
          m = p.original.match(/\b(?:how (?:can|do) i reach|(?:need|want|have) to reach)\s+(.+?)\s+from\s+(.+?)[.?!]*$/i) || p.original.match(/\btravel(?:l)?ing to\s+(.+?)\s+from\s+(.+?)[.?!]*$/i);
          if (m) { to = m[1].trim(); from = m[2].trim(); }
        }
        // destination only
        if (!to) {
          m = p.original.match(/\b(?:directions?|route)\s+to\s+(.+?)[.?!]*$/i) || p.original.match(/\bhow do i get to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bhow do i go to\s+(.+?)[.?!]*$/i) || p.original.match(/\bnavigate to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bgo to\s+(.+?)[.?!]*$/i) || p.original.match(/\btake me to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\b(?:how (?:to|do i) reach|(?:need|want|have) to reach)\s+(.+?)[.?!]*$/i) || p.original.match(/\bhow to get to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bguide me to\s+(.+?)[.?!]*$/i) || p.original.match(/\bwhich way to\s+(.+?)[.?!]*$/i)
            || p.original.match(/\b(?:get|drive) me to\s+(.+?)[.?!]*$/i) || p.original.match(/\bfastest way to (?:reach|get to)\s+(.+?)[.?!]*$/i)
            || p.original.match(/\bplan(?:ning)? a (?:road trip|trip) to\s+(.+?)[.?!]*$/i);
          if (m) to = m[1].trim();
        }
        // A "destination-only" pattern above is greedy to end-of-string, so "guide me to Mysore from Bangalore"
        // captures "Mysore from Bangalore" as one blob — split the origin back out if it's in there.
        if (to && !from) {
          const fm = to.match(/^(.+?)\s+from\s+(.+)$/i);
          if (fm) { to = fm[1].trim(); from = fm[2].trim(); }
        }
      }
      if (!to) return { text: 'Directions to where?' };
      if (!from) { ctx.pending = { intent: 'DIRECTIONS', to }; return { text: 'Where are you starting from?' }; }
      toolStep('directions → ' + from + ' to ' + to);
      const r = await callTool('/tool/directions', { from, to, online: true });
      if (r.error) return { text: cap(r.error) + '.' };
      const dur = r.durationMin >= 60 ? Math.floor(r.durationMin / 60) + 'h ' + (r.durationMin % 60) + 'm' : r.durationMin + ' min';
      const list = r.steps.map((st, i) => (i + 1) + '. ' + st.instruction).join('\n');
      return { text: '**' + r.distanceKm + ' km · about ' + dur + '** — **' + r.from.name + '** to **' + r.to.name + '**:\n' + list, tool: 'directions',
        actions: [{ label: 'OPEN IN GOOGLE MAPS', fn: () => Agent.chatTool('open_directions', { from, to }, 0).then(res => deliver(res, { intent: 'AGENT_RUN', confidence: 1 })) }] };
    }
    case 'DIRECTIONS_OPEN': {
      let from = a.from, to = a.to;
      if (!from && !to) {
        let m = p.original.match(/\bdirections?\s+from\s+(.+?)\s+to\s+(.+?)\s*(?:in|on)\s+maps?\b/i) || p.original.match(/\bdirections?\s+from\s+(.+?)\s+to\s+(.+?)[.?!]*$/i);
        if (m) { from = m[1].trim(); to = m[2].trim(); }
        if (!to) { m = p.original.match(/\bdirections?\s+(?:to|for)\s+(.+?)\s*(?:in|on)\s+maps?\b/i) || p.original.match(/\bdirections?\s+(?:to|for)\s+(.+?)[.?!]*$/i); if (m) to = m[1].trim(); }
      }
      if (!to) return { text: 'Directions to where?' };
      if (!from) { ctx.pending = { intent: 'DIRECTIONS_OPEN', to }; return { text: 'Where are you starting from?' }; }
      const url = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(from) + '&destination=' + encodeURIComponent(to);
      toolStep('openUrl → maps directions ' + from + ' → ' + to);
      const r = await callTool('/tool/openUrl', { url });
      if (r.error) return { text: 'Could not open the browser: ' + r.error };
      return { text: 'Opening directions from **' + from + '** to **' + to + '** in Google Maps.', tool: 'openUrl' };
    }

    case 'SET_CITY': {
      const m = (p.original || s).replace(/[.!]+$/, '').match(/(?:city is|live in|stay in|in|to|as)\s+([a-z][a-z .'-]{1,38})$/i);
      const city = m ? m[1].trim().replace(/\b[a-z]/g, x => x.toUpperCase()) : '';
      if (!city) return { text: 'Which city should I use for the weather?' };
      settings.city = city; saveSettings();
      const inp = $('#cityInput'); if (inp) inp.value = city;
      return { text: '✓ Home city set to **' + city + '**. Weather will be for ' + city + ' from now on (change it in Settings → Home city).', suggestions: ["What's the weather?"], tool: 'weather' };
    }

    /* ---- web: open best page / research ---- */
    case 'OPEN_WEB': {
      let q = keepCase(p, a.query || s.replace(/^(open|launch|start|run|fire up|boot up|boot|pull up|bring up|load|show me)\s+(up\s+)?(the\s+|my\s+)?/, ''));
      if (q === q.toUpperCase()) q = q.toLowerCase();
      // A site JARVIS already knows ("smart india hackathon website" → sih.gov.in) opens directly — no search.
      const bare = NLU.bareSiteName(q), known = NLU.findSite(bare);
      if (known && known.names.includes(bare)) return openSite(known);
      setState('EXECUTING', 'Finding the best page…'); toolStep('webSearch → ' + q);
      let r = await callTool('/tool/webSearch', { q });
      if (!r.results || !r.results[0]) return openSite(NLU.SITES[1], q);
      // Open the result that best matches what you asked for (NLU.bestResult) — "atria university" is Atria University,
      // not the first page that merely says "Atria". If nothing mentions the name, search once more for just the name
      // ("reva university website" → "reva university"), then ask rather than open a wrong page.
      let top = NLU.bestResult(r.results, q);
      if (!top && bare && bare !== q.toLowerCase()) {
        toolStep('webSearch → ' + bare);
        const r2 = await callTool('/tool/webSearch', { q: bare });
        const t2 = r2.results && NLU.bestResult(r2.results, bare);
        if (t2) { r = r2; top = t2; }
      }
      if (!top) return { text: 'I searched for **' + q + '**, but none of the top results look like it. Which one did you mean?\n\n' + r.results.slice(0, 3).map((x, i) => (i + 1) + '. [' + x.title + '](' + x.url + ')').join('\n'),
        actions: r.results.slice(0, 3).map((x, i) => ({ label: 'OPEN ' + (i + 1), fn: () => callTool('/tool/openUrl', { url: x.url }) })), suggestions: ['Search Google for ' + q], tool: 'openWeb' };
      toolStep('openUrl → ' + top.url);
      const o = await callTool('/tool/openUrl', { url: top.url });
      if (o.error) return { text: 'I found it but could not open the browser: ' + o.error };
      const host = new URL(top.url).hostname.replace(/^www\./, '');
      const others = r.results.filter(x => x !== top).slice(0, 3);
      return { text: 'Opening **' + top.title + '** (' + host + ')' + (others.length ? '\n\nOther matches:\n' + others.map(x => '- [' + x.title + '](' + x.url + ')').join('\n') : ''),
        speak: 'Opening ' + top.title.split(/\s[|\-–:]\s/)[0].trim() + '.', suggestions: ['Search Google for ' + q, 'Search the web for ' + q], tool: 'openWeb' };
    }
    case 'HACKATHONS':
    case 'RESEARCH': {
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const q = a.query || (p.intent === 'HACKATHONS' ? 'upcoming hackathons India ' + month + ' students'
        : keepCase(p, s.replace(/^(search|look up|check|google) (the )?(web|internet|online)( for| about)?\s+|^(research|investigate)\s+(about\s+|on\s+)?|^.*?\bwhat does the (web|internet) say about\s+|\s*(and )?(tell me|summari[sz]e it|explain it)$/g, '').trim()) || s);
      const extra = p.intent === 'HACKATHONS' ? ['Open Unstop', 'Open Devfolio', 'Open Devpost', 'Open SIH'] : null;
      if (!settings.online) return { text: 'Searching the web and reading pages needs **Online tools**, which are off.', actions: enableOnlineAction(), suggestions: ['Search Google for ' + q].concat(extra || []) };
      return doResearch(q, extra);
    }

    /* ---- contests ---- */
    case 'CONTESTS':
    case 'CONTEST_REMIND': {
      if (!settings.online) return { text: 'Contest schedules come from Codeforces, LeetCode and CodeChef, so I need **Online tools** on.', actions: enableOnlineAction() };
      setState('EXECUTING', 'Checking contest calendars…'); toolStep('contests');
      const r = await callTool('/tool/contests', { online: true });
      if (r.error) return { text: r.error };
      let list = r.contests || [];
      const plat = a.platform && a.platform !== 'all' ? String(a.platform).toLowerCase() : (s.match(/\b(codeforces|leetcode|codechef)\b/) || [])[1];
      if (plat) list = list.filter(c => c.platform.toLowerCase() === plat);
      const day = d => new Date(d).toDateString();
      if (/\btoday\b|\btonight\b/.test(s)) list = list.filter(c => day(c.start) === day(Date.now()));
      else if (/\btomorrow\b/.test(s)) list = list.filter(c => day(c.start) === day(Date.now() + 864e5));
      else if (/\bthis week\b/.test(s)) list = list.filter(c => c.start - Date.now() < 7 * 864e5);
      const name = plat ? cap(plat === 'leetcode' ? 'LeetCode' : plat === 'codechef' ? 'CodeChef' : plat) + ' ' : '';
      if (!list.length) return { text: 'No upcoming ' + name + 'contests found for that time.' + (r.failed && r.failed.length ? ' (Could not reach ' + r.failed.join(', ') + '.)' : '') };
      if (p.intent === 'CONTEST_REMIND') {
        const c = list[0];
        if (reminders.some(x => x.contestUrl === c.url && !x.fired)) return { text: 'You already have a reminder for **' + c.name + '**.' };
        const at = Math.max(c.start - 15 * 6e4, Date.now() + 6e4);
        reminders.push({ id: rid(), text: c.name + ' (' + c.platform + ') starts at ' + fmtTime(c.start) + ' — ' + c.url, at, fired: false, contestUrl: c.url }); saveTasks(); askNotify();
        return { text: '✓ I will remind you 15 minutes before **[' + c.name + '](' + c.url + ')** — ' + c.platform + ', ' + fmtDay(c.start) + ' at ' + fmtTime(c.start) + '.', speak: 'Reminder set for ' + c.name + ', ' + fmtDay(c.start) + ' at ' + fmtTime(c.start) + '.', tool: 'contests' };
      }
      const dur = m => m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0) + 'h' : m + 'm';
      const rows = list.slice(0, 8).map(c => '- **' + c.platform + '** · [' + c.name + '](' + c.url + ') — ' + fmtDay(c.start) + ' ' + fmtTime(c.start) + ' · ' + dur(c.durationMin));
      const next = list[0];
      return { text: 'Upcoming ' + name + 'contests:\n' + rows.join('\n'), speak: 'Next up is ' + next.name + ' on ' + next.platform + ', ' + fmtDay(next.start) + ' at ' + fmtTime(next.start) + '.',
        suggestions: ['Remind me about the next ' + next.platform + ' contest'], tool: 'contests' };
    }

    default: return ToolHandlers.NONE;
  }
});
