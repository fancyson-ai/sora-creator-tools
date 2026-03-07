const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractSnippet(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start not found`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end not found`);
  return source.slice(start, end);
}

function buildHarness() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'function buildHarvestOwnerFallbackMap(metricsState) {',
    'function harvestSortValue(record, key) {',
    'dashboard harvest owner fallback snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}
globalThis.__applyHarvestOwnerFallback = applyHarvestOwnerFallback;`,
    context,
    { filename: 'dashboard-harvest-owner-fallback.harness.js' }
  );
  return {
    applyHarvestOwnerFallback: context.__applyHarvestOwnerFallback,
  };
}

test('applyHarvestOwnerFallback fills missing owner identity for published records', () => {
  const { applyHarvestOwnerFallback } = buildHarness();
  const records = [
    { id: 'p_1', kind: 'published', user_handle: '', user_id: '' },
    { id: 'd_1', kind: 'draft', user_handle: '', user_id: '' },
  ];
  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 101,
        posts: {
          p_1: {},
        },
      },
    },
  };
  const out = applyHarvestOwnerFallback(records, metrics);
  assert.equal(out[0].user_handle, 'alice');
  assert.equal(out[0].user_id, '101');
  assert.equal(out[1].user_handle, '');
  assert.equal(out[1].user_id, '');
});

test('applyHarvestOwnerFallback keeps existing owner identity untouched', () => {
  const { applyHarvestOwnerFallback } = buildHarness();
  const records = [
    { id: 'p_2', kind: 'published', user_handle: 'bob', user_id: '202' },
  ];
  const metrics = {
    users: {
      'h:carol': {
        handle: 'carol',
        id: 303,
        posts: {
          p_2: {},
        },
      },
    },
  };
  const out = applyHarvestOwnerFallback(records, metrics);
  assert.equal(out[0].user_handle, 'bob');
  assert.equal(out[0].user_id, '202');
});
