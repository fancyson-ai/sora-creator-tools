const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function buildFlameHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf('  function colorForAgeMin(ageMin) {');
  assert.notEqual(start, -1, 'inject flame snippet start not found');
  const end = src.indexOf('  function likesPerMinute(', start);
  assert.notEqual(end, -1, 'inject flame snippet end not found');
  const snippet = src.slice(start, end);

  const context = {
    DEBUG: {},
    Map,
    Number,
    Math,
  };

  const bootstrap = `
    const MIN_PER_H = 60;
    const MIN_PER_D = 1440;
    const HOT_FLAME_MAX_AGE_MIN = 3 * MIN_PER_D;
    const idToLikes = new Map();
    ${snippet}
    globalThis.__flameApi = {
      MIN_PER_D,
      HOT_FLAME_MAX_AGE_MIN,
      flameCountByRate,
      badgeStateFor,
      badgeEmojiFor,
      badgeBgFor,
      colorForAgeMin,
      colorForFlameCount,
      idToLikes,
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-badge-flames-harness.js' });
  return context.__flameApi;
}

test('badge flame thresholds scale 1 through 5 using the same rate pattern for up to 3 days', () => {
  const api = buildFlameHarness();

  assert.equal(api.HOT_FLAME_MAX_AGE_MIN, 3 * api.MIN_PER_D);
  assert.equal(api.flameCountByRate(10, 60), 1);
  assert.equal(api.flameCountByRate(20, 60), 2);
  assert.equal(api.flameCountByRate(30, 60), 3);
  assert.equal(api.flameCountByRate(40, 60), 4);
  assert.equal(api.flameCountByRate(50, 60), 5);
  assert.equal(api.flameCountByRate(9, 1), 0);
  assert.equal(api.flameCountByRate(9, 60), 0);
  assert.equal(api.flameCountByRate(500, 2 * api.MIN_PER_D), 1);
  assert.equal(api.flameCountByRate(500, 4 * api.MIN_PER_D), 0);

  api.idToLikes.set('post-1', 30);
  assert.equal(api.badgeEmojiFor('post-1', { ageMin: 60 }), '🔥🔥🔥');
});

test('badge flame colors match the legacy 1-3 flame palette regardless of absolute age', () => {
  const api = buildFlameHarness();

  api.idToLikes.set('post-1', 500);
  assert.equal(api.badgeBgFor('post-1', { ageMin: 2 * api.MIN_PER_D }), api.colorForAgeMin(15 * 60));

  api.idToLikes.set('post-2', 1000);
  assert.equal(api.badgeBgFor('post-2', { ageMin: 2 * api.MIN_PER_D }), api.colorForAgeMin(9 * 60));

  api.idToLikes.set('post-3', 1500);
  assert.equal(api.badgeBgFor('post-3', { ageMin: 2 * api.MIN_PER_D }), api.colorForAgeMin(3 * 60));

  api.idToLikes.set('post-4', 300);
  assert.equal(api.badgeBgFor('post-4', { ageMin: api.MIN_PER_D }), api.colorForFlameCount(1));
});
