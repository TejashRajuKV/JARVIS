'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const operations = {
  trim: lines => lines.map(line => line.trim()),
  'drop-blank': lines => lines.filter(line => line.trim()),
  deduplicate: lines => [...new Set(lines)],
  sort: lines => lines.toSorted((first, second) => first.localeCompare(second)),
  bullets: lines => lines.map(line => `- ${line}`),
  number: lines => lines.map((line, index) => `${index + 1}. ${line}`),
  uppercase: lines => lines.map(line => line.toUpperCase()),
  lowercase: lines => lines.map(line => line.toLowerCase()),
};

if (parentPort) {
  const { steps, text } = workerData;
  if (!Array.isArray(steps) || !steps.length || steps.length > 8 || steps.some(step => !Object.hasOwn(operations, step)) ||
      typeof text !== 'string' || text.length > 4000) throw new Error('Invalid text transform.');
  const result = steps.reduce((lines, step) => operations[step](lines), text.split(/\r?\n/)).join('\n');
  parentPort.postMessage(result.slice(0, 12000));
}

module.exports = { operations };
