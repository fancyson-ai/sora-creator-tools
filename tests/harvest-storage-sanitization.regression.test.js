const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CONTENT_PATH = path.join(__dirname, '..', 'content.js');
const BACKGROUND_PATH = path.join(__dirname, '..', 'background.js');

function extractSnippet(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start not found`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end not found`);
  return source.slice(start, end);
}

function buildContentHarvestHarness() {
  const src = fs.readFileSync(CONTENT_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'const MAX_METRICS_BATCH_ITEMS = 250;',
    'function sanitizeRequestId(value) {',
    'content harvest sanitizer snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}
globalThis.__sanitizeHarvestItem = sanitizeHarvestItem;
globalThis.__sanitizeHarvestBatch = sanitizeHarvestBatch;`,
    context,
    { filename: 'content-harvest-sanitizer.harness.js' }
  );
  return {
    sanitizeHarvestItem: context.__sanitizeHarvestItem,
    sanitizeHarvestBatch: context.__sanitizeHarvestBatch,
  };
}

function buildBackgroundHarvestHarness() {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'const MAX_HARVEST_BATCH_ITEMS = 250;',
    'function normalizeRequestScope(scope) {',
    'background harvest sanitizer snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}
globalThis.__sanitizeHarvestRecord = sanitizeHarvestRecord;
globalThis.__sanitizeHarvestBatch = sanitizeHarvestBatch;`,
    context,
    { filename: 'background-harvest-sanitizer.harness.js' }
  );
  return {
    sanitizeHarvestRecord: context.__sanitizeHarvestRecord,
    sanitizeHarvestBatch: context.__sanitizeHarvestBatch,
  };
}

test('content and background harvest sanitizers accept valid record shape', () => {
  const content = buildContentHarvestHarness();
  const background = buildBackgroundHarvestHarness();
  const sample = {
    id: 's_123',
    kind: 'published',
    context: 'top',
    source: 'api',
    user_handle: 'alice',
    user_id: 123456,
    detail_url: 'https://sora.chatgpt.com/backend/project_y/post/s_123',
    prompt: 'A cinematic slow motion scene',
    title: 'Test title',
    like_count: 12,
    unique_view_count: 99,
    first_seen_ts: 1000,
    last_seen_ts: 2000,
    last_harvest_run_id: 'harvest_123',
  };
  const contentOut = content.sanitizeHarvestItem(sample);
  const backgroundOut = background.sanitizeHarvestRecord(sample);
  assert.ok(contentOut);
  assert.ok(backgroundOut);
  assert.equal(contentOut.id, 's_123');
  assert.equal(backgroundOut.id, 's_123');
  assert.equal(contentOut.kind, 'published');
  assert.equal(backgroundOut.kind, 'published');
  assert.equal(contentOut.user_handle, 'alice');
  assert.equal(backgroundOut.user_handle, 'alice');
  assert.equal(contentOut.user_id, 123456);
  assert.equal(backgroundOut.user_id, 123456);
});

test('content and background harvest sanitizers reject invalid ids and kinds', () => {
  const content = buildContentHarvestHarness();
  const background = buildBackgroundHarvestHarness();
  const badId = { id: 's_123!', kind: 'published' };
  const badKind = { id: 's_123', kind: 'post' };
  assert.equal(content.sanitizeHarvestItem(badId), null);
  assert.equal(content.sanitizeHarvestItem(badKind), null);
  assert.equal(background.sanitizeHarvestRecord(badId), null);
  assert.equal(background.sanitizeHarvestRecord(badKind), null);
});

test('harvest batch sanitizers enforce max item cap', () => {
  const content = buildContentHarvestHarness();
  const background = buildBackgroundHarvestHarness();
  const many = [];
  for (let i = 0; i < 400; i++) {
    many.push({ id: `s_${i}`, kind: 'published' });
  }
  const contentBatch = content.sanitizeHarvestBatch(many);
  const backgroundBatch = background.sanitizeHarvestBatch(many);
  assert.equal(contentBatch.length, 250);
  assert.equal(backgroundBatch.length, 250);
});

test('harvest sanitizers clamp cast_names and cameos arrays', () => {
  const content = buildContentHarvestHarness();
  const background = buildBackgroundHarvestHarness();
  const longList = [];
  for (let i = 0; i < 80; i++) longList.push(`name_${i}`);
  const sample = {
    id: 'd_1',
    kind: 'draft',
    cast_names: longList,
    cameos: longList,
  };
  const contentOut = content.sanitizeHarvestItem(sample);
  const backgroundOut = background.sanitizeHarvestRecord(sample);
  assert.ok(contentOut.cast_names.length <= 32);
  assert.ok(contentOut.cameos.length <= 32);
  assert.ok(backgroundOut.cast_names.length <= 32);
  assert.ok(backgroundOut.cameos.length <= 32);
});
