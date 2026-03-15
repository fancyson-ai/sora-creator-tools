const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function extractConstString(src, name) {
  const match = src.match(new RegExp(`const ${name} = '([^']+)';`));
  assert.ok(match, `could not find const ${name}`);
  return match[1];
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDiscoveryPhraseHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const prefsStart = src.indexOf('  function getPrefs() {');
  assert.notEqual(prefsStart, -1, 'inject prefs snippet start not found');
  const prefsEnd = src.indexOf('  // == Bookmarks (Drafts) ==', prefsStart);
  assert.notEqual(prefsEnd, -1, 'inject prefs snippet end not found');
  const prefsSnippet = src.slice(prefsStart, prefsEnd);

  const discoveryStart = src.indexOf('  function defaultDiscoveryPhrasePreference() {');
  assert.notEqual(discoveryStart, -1, 'inject discovery snippet start not found');
  const discoveryEnd = src.indexOf('  function getDiscoveryPhraseForId(id) {', discoveryStart);
  assert.notEqual(discoveryEnd, -1, 'inject discovery snippet end not found');
  const discoverySnippet = src.slice(discoveryStart, discoveryEnd);

  const storageStart = src.indexOf('  function handleStorageChange(e) {');
  assert.notEqual(storageStart, -1, 'inject storage snippet start not found');
  const storageEnd = src.indexOf('  // Inject dashboard button into left sidebar', storageStart);
  assert.notEqual(storageEnd, -1, 'inject storage snippet end not found');
  const storageSnippet = src.slice(storageStart, storageEnd);

  const context = {};
  const bootstrap = `
    const PREF_KEY = ${JSON.stringify(extractConstString(src, 'PREF_KEY'))};
    const LEGACY_DISCOVERY_PHRASE_PREF_KEY = ${JSON.stringify(extractConstString(src, 'LEGACY_DISCOVERY_PHRASE_PREF_KEY'))};
    const VIDEO_GENS_BALANCE_KEY = ${JSON.stringify(extractConstString(src, 'VIDEO_GENS_BALANCE_KEY'))};
    let badgeDataGeneration = 0;
    let renderBadgesCalls = 0;
    let renderDetailBadgeCalls = 0;
    let injectSidebarGensCounterCalls = 0;
    let startGatheringCalls = 0;
    let isGatheringActiveThisTab = false;

    const document = {
      querySelector() {
        return null;
      },
    };

    const storage = new Map();
    const localStorage = {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    };

    function renderBadges() {
      renderBadgesCalls++;
    }
    function renderDetailBadge() {
      renderDetailBadgeCalls++;
    }
    function injectSidebarGensCounter() {
      injectSidebarGensCounterCalls++;
    }
    function isTopFeed() {
      return false;
    }
    function startGathering() {
      startGatheringCalls++;
    }

${prefsSnippet}
${discoverySnippet}
${storageSnippet}

    function readStoredPrefs() {
      try {
        return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function reset() {
      storage.clear();
      badgeDataGeneration = 0;
      renderBadgesCalls = 0;
      renderDetailBadgeCalls = 0;
      injectSidebarGensCounterCalls = 0;
      startGatheringCalls = 0;
      isGatheringActiveThisTab = false;
    }

    globalThis.__injectDiscoveryApi = {
      reset,
      getPrefs,
      setPrefs,
      discoveryPhraseEnabled,
      writeDiscoveryPhrasePreference,
      readStoredPrefs,
      handleStorageChange,
      getLegacyValue: () => localStorage.getItem(LEGACY_DISCOVERY_PHRASE_PREF_KEY),
      setLegacyValue: (value) => localStorage.setItem(LEGACY_DISCOVERY_PHRASE_PREF_KEY, value),
      setRawPrefsValue: (value) => localStorage.setItem(PREF_KEY, value),
      getState: () => ({
        badgeDataGeneration,
        renderBadgesCalls,
        renderDetailBadgeCalls,
        injectSidebarGensCounterCalls,
        startGatheringCalls,
      }),
      getPrefKey: () => PREF_KEY,
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-discovery-phrase-harness.js' });
  return context.__injectDiscoveryApi;
}

test('content discovery phrases default to enabled without stored prefs', () => {
  const api = buildDiscoveryPhraseHarness();
  api.reset();

  assert.equal(api.discoveryPhraseEnabled(), true);
  assert.deepEqual(toPlain(api.readStoredPrefs()), {});
});

test('content discovery phrase preference migrates legacy standalone storage key', () => {
  const api = buildDiscoveryPhraseHarness();
  api.reset();
  api.setLegacyValue('0');

  assert.equal(api.discoveryPhraseEnabled(), false);
  assert.deepEqual(toPlain(api.readStoredPrefs()), { showDiscoveryPhrase: false });
  assert.equal(api.getLegacyValue(), null);
});

test('content discovery phrase preference writes into shared prefs', () => {
  const api = buildDiscoveryPhraseHarness();
  api.reset();

  assert.equal(api.writeDiscoveryPhrasePreference(false), false);
  assert.deepEqual(toPlain(api.readStoredPrefs()), { showDiscoveryPhrase: false });

  assert.equal(api.writeDiscoveryPhrasePreference(true), true);
  assert.deepEqual(toPlain(api.readStoredPrefs()), { showDiscoveryPhrase: true });
});

test('prefs storage changes rerender badges when discovery phrase visibility changes', () => {
  const api = buildDiscoveryPhraseHarness();
  api.reset();

  const prefKey = api.getPrefKey();
  api.handleStorageChange({
    key: prefKey,
    oldValue: JSON.stringify({ showDiscoveryPhrase: true }),
    newValue: JSON.stringify({ showDiscoveryPhrase: false }),
  });

  assert.deepEqual(toPlain(api.getState()), {
    badgeDataGeneration: 1,
    renderBadgesCalls: 1,
    renderDetailBadgeCalls: 1,
    injectSidebarGensCounterCalls: 0,
    startGatheringCalls: 0,
  });
});
