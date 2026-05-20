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

function buildContentSanitizerHarness() {
  const src = fs.readFileSync(CONTENT_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'const MAX_METRICS_BATCH_ITEMS = 250;',
    'function sanitizeMetricsBatch(items) {',
    'content metrics sanitizer snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}\nglobalThis.__sanitizeMetricsItem = sanitizeMetricsItem;`,
    context,
    { filename: 'content-sanitize-metrics-item.harness.js' }
  );
  assert.equal(typeof context.__sanitizeMetricsItem, 'function');
  return context.__sanitizeMetricsItem;
}

function buildBackgroundSanitizerHarness() {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'function isPlainObject(value) {',
    'function sanitizeMetricsBatch(items) {',
    'background metrics sanitizer snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}\nglobalThis.__sanitizeMetricsSnapshot = sanitizeMetricsSnapshot;`,
    context,
    { filename: 'background-sanitize-metrics-snapshot.harness.js' }
  );
  assert.equal(typeof context.__sanitizeMetricsSnapshot, 'function');
  return context.__sanitizeMetricsSnapshot;
}

test('content sanitizer preserves dotted user keys and dotted page keys', () => {
  const sanitizeMetricsItem = buildContentSanitizerHarness();
  const out = sanitizeMetricsItem({
    userKey: 'h:alice.sora',
    pageUserKey: 'h:page.owner',
    postId: 's_123',
  });
  assert.ok(out);
  assert.equal(out.userKey, 'h:alice.sora');
  assert.equal(out.pageUserKey, 'h:page.owner');
});

test('background sanitizer preserves dotted user keys and dotted page keys', () => {
  const sanitizeMetricsSnapshot = buildBackgroundSanitizerHarness();
  const out = sanitizeMetricsSnapshot({
    userKey: 'h:alice.sora',
    pageUserKey: 'h:page.owner',
    postId: 's_123',
  });
  assert.ok(out);
  assert.equal(out.userKey, 'h:alice.sora');
  assert.equal(out.pageUserKey, 'h:page.owner');
});

test('content sanitizer falls back to id key when userKey is invalid but userId is valid', () => {
  const sanitizeMetricsItem = buildContentSanitizerHarness();
  const out = sanitizeMetricsItem({
    userKey: 'h:alice.sora!',
    userId: 'user-123',
    postId: 's_123',
  });
  assert.ok(out);
  assert.equal(out.userId, 'user-123');
  assert.equal(out.userKey, 'id:user-123');
});

test('background sanitizer falls back to id key when userKey is invalid but userId is valid', () => {
  const sanitizeMetricsSnapshot = buildBackgroundSanitizerHarness();
  const out = sanitizeMetricsSnapshot({
    userKey: 'h:alice.sora!',
    userId: 'user-123',
    postId: 's_123',
  });
  assert.ok(out);
  assert.equal(out.userId, 'user-123');
  assert.equal(out.userKey, 'id:user-123');
});

test('sanitizers keep userKey empty when invalid and no userId fallback is available', () => {
  const sanitizeMetricsItem = buildContentSanitizerHarness();
  const sanitizeMetricsSnapshot = buildBackgroundSanitizerHarness();
  const contentOut = sanitizeMetricsItem({
    userKey: 'h:alice.sora!',
    postId: 's_123',
  });
  const backgroundOut = sanitizeMetricsSnapshot({
    userKey: 'h:alice.sora!',
    postId: 's_123',
  });
  assert.ok(contentOut);
  assert.ok(backgroundOut);
  assert.equal(contentOut.userKey, undefined);
  assert.equal(backgroundOut.userKey, undefined);
});

test('sanitizers still reject payloads with no metrics signal', () => {
  const sanitizeMetricsItem = buildContentSanitizerHarness();
  const sanitizeMetricsSnapshot = buildBackgroundSanitizerHarness();
  assert.equal(
    sanitizeMetricsItem({ userKey: 'h:alice.sora' }),
    null
  );
  assert.equal(
    sanitizeMetricsSnapshot({ userKey: 'h:alice.sora' }),
    null
  );
});

test('sanitizers preserve discovery phrases when a metrics signal is present', () => {
  const sanitizeMetricsItem = buildContentSanitizerHarness();
  const sanitizeMetricsSnapshot = buildBackgroundSanitizerHarness();
  const discoveryPhrase = 'delft   pottery \n organ   pug';
  const payload = {
    userKey: 'h:alice.sora',
    postId: 's_123',
    likes: 4,
    discovery_phrase: `  ${discoveryPhrase}  `,
  };

  const contentOut = sanitizeMetricsItem(payload);
  const backgroundOut = sanitizeMetricsSnapshot(payload);

  assert.ok(contentOut);
  assert.ok(backgroundOut);
  assert.equal(contentOut.discovery_phrase, discoveryPhrase);
  assert.equal(backgroundOut.discovery_phrase, discoveryPhrase);
});
