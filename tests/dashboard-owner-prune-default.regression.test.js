const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function readOwnerPruneSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf("const OWNER_PRUNE_STORAGE_KEY = 'SCT_DASHBOARD_ENABLE_OWNER_PRUNE';");
  assert.notEqual(start, -1, 'OWNER_PRUNE_STORAGE_KEY not found');
  const end = src.indexOf('let snapDebugSeq = 0;', start);
  assert.notEqual(end, -1, 'owner prune expression boundary not found');
  return src.slice(start, end);
}

function readMaintenanceGuardSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function shouldRunPostOwnershipMaintenance(opts = {}){');
  assert.notEqual(start, -1, 'shouldRunPostOwnershipMaintenance not found');
  const end = src.indexOf('\n\n  async function getMetricsUpdatedAt()', start);
  assert.notEqual(end, -1, 'maintenance guard boundary not found');
  return src.slice(start, end);
}

function buildHarness(localStorageImpl) {
  const context = { localStorage: localStorageImpl };
  const ownerSnippet = readOwnerPruneSnippet();
  const guardSnippet = readMaintenanceGuardSnippet();
  const bootstrap = `
    const isVirtualUserKey = (key) => key === '__top_today__' || String(key || '').startsWith('c:');
    ${ownerSnippet}
    ${guardSnippet}
    globalThis.__enabled = OWNER_PRUNE_ENABLED;
    globalThis.__shouldRun = shouldRunPostOwnershipMaintenance;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-owner-prune-default-harness.js' });
  return {
    enabled: context.__enabled,
    shouldRun: context.__shouldRun
  };
}

test('owner prune is disabled by default when no key exists', () => {
  const h = buildHarness({ getItem() { return null; } });
  assert.equal(h.enabled, false);
});

test('owner prune can be explicitly enabled', () => {
  const h = buildHarness({ getItem() { return '1'; } });
  assert.equal(h.enabled, true);
});

test('ownership maintenance guard never runs during auto refresh', () => {
  const h = buildHarness({ getItem() { return '1'; } });
  assert.equal(h.shouldRun({
    currentUserKey: 'h:alice',
    isMetricsPartial: false,
    autoRefresh: true
  }), false);
});

test('ownership maintenance guard runs only for explicit non-auto full user views', () => {
  const h = buildHarness({ getItem() { return '1'; } });
  assert.equal(h.shouldRun({
    currentUserKey: 'h:alice',
    isMetricsPartial: false,
    autoRefresh: false
  }), true);
  assert.equal(h.shouldRun({
    currentUserKey: '__top_today__',
    isMetricsPartial: false,
    autoRefresh: false
  }), false);
});

