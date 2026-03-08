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
  const end = src.indexOf('  function formatPostedAtLocal(', start);
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
    const HOT_FLAME_MAX_AGE_MIN = 24 * MIN_PER_H;
    const idToLikes = new Map();
    ${snippet}
    globalThis.__flameApi = {
      MIN_PER_H,
      MIN_PER_D,
      HOT_FLAME_MAX_AGE_MIN,
      badgeStateFor,
      badgeEmojiFor,
      badgeBgFor,
      colorForAgeMin,
      idToLikes,
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-badge-flames-harness.js' });
  return context.__flameApi;
}

test('badge flame states keep the merged 24h rate-based hotness rules', () => {
  const api = buildFlameHarness();
  const expectState = (actual, expected) => {
    assert.equal(actual.isSuperHot, expected.isSuperHot);
    assert.equal(actual.isVeryHot, expected.isVeryHot);
    assert.equal(actual.isNearDay, expected.isNearDay);
    assert.equal(actual.isHot, expected.isHot);
  };

  assert.equal(api.HOT_FLAME_MAX_AGE_MIN, 24 * api.MIN_PER_H);

  expectState(api.badgeStateFor(50, 60), {
    isSuperHot: true,
    isVeryHot: true,
    isNearDay: false,
    isHot: true,
  });
  expectState(api.badgeStateFor(40, 60), {
    isSuperHot: false,
    isVeryHot: true,
    isNearDay: false,
    isHot: true,
  });
  expectState(api.badgeStateFor(30, 60), {
    isSuperHot: false,
    isVeryHot: false,
    isNearDay: false,
    isHot: true,
  });
  expectState(api.badgeStateFor(500, 2 * api.MIN_PER_D), {
    isSuperHot: false,
    isVeryHot: false,
    isNearDay: true,
    isHot: true,
  });

  api.idToLikes.set('post-super', 50);
  assert.equal(api.badgeEmojiFor('post-super', { ageMin: 60 }), '🔥🔥🔥🔥🔥');
  api.idToLikes.set('post-very', 40);
  assert.equal(api.badgeEmojiFor('post-very', { ageMin: 60 }), '🔥🔥🔥🔥');
  api.idToLikes.set('post-hot', 30);
  assert.equal(api.badgeEmojiFor('post-hot', { ageMin: 60 }), '🔥🔥🔥');
  api.idToLikes.set('post-old', 500);
  assert.equal(api.badgeEmojiFor('post-old', { ageMin: 2 * api.MIN_PER_D }), '📝');
});

test('badge backgrounds follow the merged super-hot, very-hot, day, and hot tiers', () => {
  const api = buildFlameHarness();

  api.idToLikes.set('post-super', 50);
  assert.equal(api.badgeBgFor('post-super', { ageMin: 60 }), api.colorForAgeMin(0));

  api.idToLikes.set('post-very', 40);
  assert.equal(api.badgeBgFor('post-very', { ageMin: 60 }), api.colorForAgeMin(0));

  api.idToLikes.set('post-day', 500);
  assert.equal(api.badgeBgFor('post-day', { ageMin: 2 * api.MIN_PER_D }), 'hsla(120, 85%, 32%, 0.92)');

  api.idToLikes.set('post-hot', 30);
  assert.equal(api.badgeBgFor('post-hot', { ageMin: 60 }), api.colorForAgeMin(60));
});
