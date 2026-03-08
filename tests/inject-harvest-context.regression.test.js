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
    'function getHarvestContextFromRoute(pathname = location.pathname, search = location.search) {',
    'function currentSIdFromURL() {',
    'inject harvest context snippet'
  );
  const context = {
    location: { pathname: '/explore', search: '?feed=top' },
    URLSearchParams,
    harvestTemplates: {
      top: { name: 'topTemplate' },
      profile: { name: 'profileTemplate' },
      drafts: { name: 'draftsTemplate' },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${snippet}
globalThis.__getHarvestContextFromRoute = getHarvestContextFromRoute;
globalThis.__pickHarvestTemplateForContext = pickHarvestTemplateForContext;`,
    context,
    { filename: 'inject-harvest-context.harness.js' }
  );
  return {
    getHarvestContextFromRoute: context.__getHarvestContextFromRoute,
    pickHarvestTemplateForContext: context.__pickHarvestTemplateForContext,
  };
}

test('getHarvestContextFromRoute classifies Top feed route', () => {
  const { getHarvestContextFromRoute } = buildHarness();
  assert.equal(getHarvestContextFromRoute('/explore', '?feed=top'), 'top');
});

test('getHarvestContextFromRoute classifies Profile and Drafts routes', () => {
  const { getHarvestContextFromRoute } = buildHarness();
  assert.equal(getHarvestContextFromRoute('/profile/username/alice', ''), 'profile');
  assert.equal(getHarvestContextFromRoute('/drafts', ''), 'drafts');
});

test('getHarvestContextFromRoute returns null for unsupported routes', () => {
  const { getHarvestContextFromRoute } = buildHarness();
  assert.equal(getHarvestContextFromRoute('/explore', '?feed=latest'), null);
  assert.equal(getHarvestContextFromRoute('/p/s_123', ''), null);
});

test('pickHarvestTemplateForContext uses profile fallback order', () => {
  const { pickHarvestTemplateForContext } = buildHarness();
  const templates = {
    top: { id: 'top' },
    profile: null,
    drafts: { id: 'drafts' },
  };
  assert.deepEqual(
    pickHarvestTemplateForContext('profile', templates),
    { id: 'top' }
  );
});
