'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { JARVIS_BATTERY_LOW_DEFAULT } = require('./thresholds');

function createPowerControl({ getSample, getSettings, wait = sleep }) {
  let enabled = false;
  function status() {
    const override = Number(getSettings().thresholds?.batteryLow ?? JARVIS_BATTERY_LOW_DEFAULT);
    const threshold = Number.isFinite(override) ? Math.min(50, Math.max(5, override)) : JARVIS_BATTERY_LOW_DEFAULT;
    const sample = getSample();
    const known = Number.isFinite(sample?.battery) && typeof sample.charger === 'boolean';
    return { threshold, battery: known ? sample.battery : null,
      paused: enabled && known && !sample.charger && sample.battery <= threshold };
  }
  return {
    enabled: () => enabled,
    disable: () => { enabled = false; },
    command({ text }) {
      const action = text.toLowerCase().replace(/^power saving\s+/, '');
      if (['on', 'off'].includes(action)) enabled = action === 'on';
      else if (action !== 'status') return { text: 'Enter “on”, “off”, or “status”.' };
      const state = status();
      const battery = state.battery === null ? 'Battery reading unavailable.' : `Battery ${state.battery}%.`;
      return { text: `Marks power saving is ${enabled ? 'on' : 'off'}. ${battery} ${state.paused ? 'New heavy steps are waiting for power.' : `Threshold ${state.threshold}%.`}` };
    },
    async wait(signal) {
      while (status().paused) await wait(5000, undefined, { signal });
      signal.throwIfAborted();
    },
  };
}

module.exports = { createPowerControl };
