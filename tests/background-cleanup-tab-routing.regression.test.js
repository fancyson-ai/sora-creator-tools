const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BACKGROUND_PATH = path.join(__dirname, '..', 'background.js');

function extractSnippet(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start not found`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end not found`);
  return source.slice(start, end);
}

function buildCleanupTabHarness({ queryMap = {}, updateResults = {}, getResults = {} } = {}) {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'function queryTabs(queryInfo) {',
    'async function dispatchCleanupBulkUnfollow(request) {',
    'background cleanup tab routing snippet'
  );

  const calls = {
    query: [],
    update: [],
    create: [],
    get: [],
    addListener: 0,
    removeListener: 0,
  };

  const onUpdatedListeners = new Set();
  const chrome = {
    runtime: { lastError: null },
    tabs: {
      query(queryInfo, callback) {
        calls.query.push(queryInfo);
        const key = JSON.stringify(queryInfo);
        callback(Array.isArray(queryMap[key]) ? queryMap[key] : []);
      },
      update(tabId, updateProperties, callback) {
        calls.update.push({ tabId, updateProperties });
        callback(updateResults[String(tabId)] || { id: tabId, ...updateProperties });
      },
      create(createProperties, callback) {
        calls.create.push(createProperties);
        callback({ id: 999, ...createProperties, status: 'loading' });
      },
      get(tabId, callback) {
        calls.get.push(tabId);
        callback(getResults[String(tabId)] || { id: tabId, status: 'complete' });
      },
      onUpdated: {
        addListener(fn) {
          calls.addListener += 1;
          onUpdatedListeners.add(fn);
        },
        removeListener(fn) {
          calls.removeListener += 1;
          onUpdatedListeners.delete(fn);
        },
      },
    },
  };

  const context = {
    chrome,
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(
    `${snippet}\nglobalThis.__findOrOpenCleanupTab = findOrOpenCleanupTab;`,
    context,
    { filename: 'background-cleanup-tab-routing.harness.js' }
  );

  return {
    calls,
    findOrOpenCleanupTab: context.__findOrOpenCleanupTab,
  };
}

test('findOrOpenCleanupTab reuses an exact matching profile tab without rewriting its URL', async () => {
  const harness = buildCleanupTabHarness({
    queryMap: {
      [JSON.stringify({ active: true, lastFocusedWindow: true, url: 'https://sora.chatgpt.com/*' })]: [],
      [JSON.stringify({ url: 'https://sora.chatgpt.com/profile*' })]: [
        { id: 41, url: 'https://sora.chatgpt.com/profile/aidaredevils', status: 'complete' },
        { id: 42, url: 'https://sora.chatgpt.com/profile', status: 'complete' },
      ],
    },
    updateResults: {
      '41': { id: 41, url: 'https://sora.chatgpt.com/profile/aidaredevils', status: 'complete', active: true },
    },
  });

  const result = await harness.findOrOpenCleanupTab('aidaredevils');

  assert.equal(result?.id, 41);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.update)), [
    { tabId: 41, updateProperties: { active: true } },
  ]);
  assert.deepEqual(harness.calls.create, []);
});

test('findOrOpenCleanupTab retargets an existing Sora tab to the requested profile before messaging it', async () => {
  const harness = buildCleanupTabHarness({
    queryMap: {
      [JSON.stringify({ active: true, lastFocusedWindow: true, url: 'https://sora.chatgpt.com/*' })]: [],
      [JSON.stringify({ url: 'https://sora.chatgpt.com/profile*' })]: [
        { id: 55, url: 'https://sora.chatgpt.com/profile', status: 'complete' },
      ],
      [JSON.stringify({ url: 'https://sora.chatgpt.com/*' })]: [
        { id: 55, url: 'https://sora.chatgpt.com/profile', status: 'complete' },
      ],
    },
    updateResults: {
      '55': { id: 55, url: 'https://sora.chatgpt.com/profile/simeo', status: 'loading', active: true },
    },
    getResults: {
      '55': { id: 55, url: 'https://sora.chatgpt.com/profile/simeo', status: 'complete', active: true },
    },
  });

  const result = await harness.findOrOpenCleanupTab('simeo');

  assert.equal(result?.id, 55);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.update)), [
    {
      tabId: 55,
      updateProperties: { active: true, url: 'https://sora.chatgpt.com/profile/simeo' },
    },
  ]);
  assert.deepEqual(harness.calls.get, [55]);
  assert.equal(harness.calls.create.length, 0);
});
