const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function extractSnippet(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start not found`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end not found`);
  return source.slice(start, end);
}

function buildHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'function isLikelyJsonContentType(value) {',
    'function installFetchSniffer() {',
    'inject json guard snippet'
  );

  const context = {
    dlog: () => {},
    truncateInline: (value, max = 140) => String(value).slice(0, max),
  };

  vm.createContext(context);
  vm.runInContext(
    `${snippet}
globalThis.__isLikelyJsonContentType = isLikelyJsonContentType;
globalThis.__parseJsonPayloadSafely = parseJsonPayloadSafely;
globalThis.__cloneJsonResponseSafely = cloneJsonResponseSafely;`,
    context,
    { filename: 'inject-json-guard.harness.js' }
  );

  return {
    isLikelyJsonContentType: context.__isLikelyJsonContentType,
    parseJsonPayloadSafely: context.__parseJsonPayloadSafely,
    cloneJsonResponseSafely: context.__cloneJsonResponseSafely,
  };
}

test('isLikelyJsonContentType accepts standard and +json media types', () => {
  const { isLikelyJsonContentType } = buildHarness();
  assert.equal(isLikelyJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isLikelyJsonContentType('application/problem+json'), true);
  assert.equal(isLikelyJsonContentType('text/html'), false);
});

test('parseJsonPayloadSafely parses object and array payloads', () => {
  const { parseJsonPayloadSafely } = buildHarness();
  assert.equal(JSON.stringify(parseJsonPayloadSafely('{"ok":true}')), JSON.stringify({ ok: true }));
  assert.equal(JSON.stringify(parseJsonPayloadSafely(' [1, 2, 3] ')), JSON.stringify([1, 2, 3]));
});

test('parseJsonPayloadSafely ignores html responses instead of throwing', () => {
  const { parseJsonPayloadSafely } = buildHarness();
  assert.equal(
    parseJsonPayloadSafely('<!DOCTYPE html><html><body>nope</body></html>', {
      source: 'xhr',
      url: '/backend/nf/create',
      contentType: 'text/html',
    }),
    null
  );
  assert.equal(
    parseJsonPayloadSafely('<html><body>still nope</body></html>', {
      source: 'xhr',
      url: '/backend/nf/pending/v2',
      contentType: 'application/json',
    }),
    null
  );
});

test('parseJsonPayloadSafely still throws for genuinely malformed json', () => {
  const { parseJsonPayloadSafely } = buildHarness();
  assert.throws(
    () => parseJsonPayloadSafely('{"broken"', { contentType: 'application/json' }),
    (err) => /unexpected|expected|json/i.test(String(err?.message || ''))
  );
});

test('cloneJsonResponseSafely returns null for html payloads and parses json payloads', async () => {
  const { cloneJsonResponseSafely } = buildHarness();
  const htmlResponse = {
    clone() {
      return {
        headers: { get: () => 'text/html' },
        text: async () => '<!DOCTYPE html><html><body>login</body></html>',
      };
    },
  };
  const jsonResponse = {
    clone() {
      return {
        headers: { get: () => 'application/json' },
        text: async () => '{"id":"task_123"}',
      };
    },
  };

  assert.equal(await cloneJsonResponseSafely(htmlResponse, { source: 'fetch', url: '/backend/nf/create' }), null);
  assert.equal(
    JSON.stringify(await cloneJsonResponseSafely(jsonResponse, { source: 'fetch', url: '/backend/nf/create' })),
    JSON.stringify({ id: 'task_123' })
  );
});
