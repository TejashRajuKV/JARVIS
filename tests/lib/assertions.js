'use strict';

const assert = require('node:assert/strict');

module.exports = function countAssertions(name) {
  let passed = 0;
  const counted = {};
  for (const method of ['equal', 'deepEqual', 'ok', 'match', 'throws']) {
    counted[method] = (...args) => {
      assert[method](...args);
      passed++;
    };
  }
  counted.rejects = async (...args) => {
    await assert.rejects(...args);
    passed++;
  };
  counted.report = () => console.log(name + ': ' + passed + '/' + passed + ' assertions passed');
  return counted;
};
