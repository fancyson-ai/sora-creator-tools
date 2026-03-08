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

function buildMergeHarness() {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'function isPlainObject(value) {',
    'function normalizeRequestScope(scope) {',
    'background harvest merge snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}
globalThis.__mergeHarvestRecord = mergeHarvestRecord;`,
    context,
    { filename: 'background-harvest-merge.harness.js' }
  );
  return context.__mergeHarvestRecord;
}

test('mergeHarvestRecord keeps earliest first_seen_ts and latest last_seen_ts', () => {
  const mergeHarvestRecord = buildMergeHarness();
  const merged = mergeHarvestRecord(
    {
      id: 's_1',
      kind: 'published',
      first_seen_ts: 2000,
      last_seen_ts: 3000,
    },
    {
      id: 's_1',
      kind: 'published',
      first_seen_ts: 1000,
      last_seen_ts: 9000,
    }
  );
  assert.equal(merged.first_seen_ts, 1000);
  assert.equal(merged.last_seen_ts, 9000);
});

test('mergeHarvestRecord keeps maximum numeric counters', () => {
  const mergeHarvestRecord = buildMergeHarness();
  const merged = mergeHarvestRecord(
    {
      id: 's_1',
      kind: 'published',
      view_count: 5,
      unique_view_count: 4,
      like_count: 3,
      remix_count: 1,
    },
    {
      id: 's_1',
      kind: 'published',
      view_count: 11,
      unique_view_count: 9,
      like_count: 10,
      remix_count: 2,
    }
  );
  assert.equal(merged.view_count, 11);
  assert.equal(merged.unique_view_count, 9);
  assert.equal(merged.like_count, 10);
  assert.equal(merged.remix_count, 2);
});

test('mergeHarvestRecord prefers incoming non-empty metadata when existing is empty', () => {
  const mergeHarvestRecord = buildMergeHarness();
  const merged = mergeHarvestRecord(
    {
      id: 'd_1',
      kind: 'draft',
      prompt: '',
      title: '',
      cast_names: [],
    },
    {
      id: 'd_1',
      kind: 'draft',
      prompt: 'new prompt',
      title: 'new title',
      cast_names: ['alice'],
    }
  );
  assert.equal(merged.prompt, 'new prompt');
  assert.equal(merged.title, 'new title');
  assert.deepEqual(Array.from(merged.cast_names), ['alice']);
});

test('mergeHarvestRecord keeps existing non-empty metadata when incoming is empty', () => {
  const mergeHarvestRecord = buildMergeHarness();
  const merged = mergeHarvestRecord(
    {
      id: 'd_1',
      kind: 'draft',
      prompt: 'existing prompt',
      title: 'existing title',
      cast_names: ['alice'],
    },
    {
      id: 'd_1',
      kind: 'draft',
      prompt: '',
      title: '',
      cast_names: [],
    }
  );
  assert.equal(merged.prompt, 'existing prompt');
  assert.equal(merged.title, 'existing title');
  assert.deepEqual(Array.from(merged.cast_names), ['alice']);
});

test('mergeHarvestRecord carries owner identity fields when incoming fills missing values', () => {
  const mergeHarvestRecord = buildMergeHarness();
  const merged = mergeHarvestRecord(
    {
      id: 's_1',
      kind: 'published',
      user_handle: '',
      user_id: null,
    },
    {
      id: 's_1',
      kind: 'published',
      user_handle: 'alice',
      user_id: 42,
    }
  );
  assert.equal(merged.user_handle, 'alice');
  assert.equal(merged.user_id, 42);
});
