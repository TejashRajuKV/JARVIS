'use strict';
const FocusAudio = (() => {
  function fromCommand(text) {
    const match = String(text || '').match(/\bwith (rain(?: sounds?)?|white[- ]noise)(?:\s*[.!?])?$/i);
    if (!match) return '';
    return /^rain/i.test(match[1]) ? 'rain' : 'white';
  }
  const valid = kind => kind === 'rain' || kind === 'white';
  const label = kind => kind === 'rain' ? 'rain sounds' : 'white noise';

  function create(makeContext = () => new AudioContext()) {
    let context, source, gain, tone, request = 0, quiet = false, volume = 1;
    const playing = () => !!source;
    function stop() {
      request++;
      if (source) {
        source.stop();
        source.disconnect();
        gain.disconnect();
        if (tone) tone.disconnect();
      }
      source = gain = tone = null;
    }
    const gainLevel = () => volume * (quiet ? 0.014 : 0.17);
    function adjustGain() { if (gain) gain.gain.setTargetAtTime(gainLevel(), context.currentTime, 0.05); }
    function duck(on) { quiet = !!on; adjustGain(); }
    function setVolume(value) { volume = Math.min(1.82, Math.max(0, value)); adjustGain(); }
    async function play(kind) {
      stop();
      if (!valid(kind)) return false;
      const id = request;
      try {
        context ||= makeContext();
        if (context.state !== 'running') {
          // A voice command may lack a browser audio gesture. Keep the timer responsive.
          let timeout;
          try { await Promise.race([context.resume(), new Promise(resolve => { timeout = setTimeout(resolve, 500); })]); }
          finally { clearTimeout(timeout); }
        }
        if (id !== request || context.state !== 'running') return false;
        const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.6;
        source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        gain = context.createGain();
        gain.gain.value = gainLevel();
        if (kind === 'rain') {
          tone = context.createBiquadFilter();
          tone.type = 'lowpass';
          tone.frequency.value = 980;
          source.connect(tone);
          tone.connect(gain);
        } else source.connect(gain);
        gain.connect(context.destination);
        source.start();
        return true;
      } catch {
        if (id !== request) return false;
        if (source) {
          source.disconnect();
          if (gain) gain.disconnect();
          if (tone) tone.disconnect();
        }
        source = gain = tone = null;
        return false;
      }
    }
    return { play, stop, duck, playing, setVolume };
  }
  return { create, fromCommand, valid, label };
})();
if (typeof module !== 'undefined') module.exports = FocusAudio;
