const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function readSnapDebugExpr() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf("const SNAP_DEBUG_STORAGE_KEY = 'SCT_DASHBOARD_SNAPSHOT_DEBUG';");
  assert.notEqual(start, -1, 'SNAP_DEBUG_STORAGE_KEY not found');
  const end = src.indexOf('let snapDebugSeq = 0;', start);
  assert.notEqual(end, -1, 'snap debug expression boundary not found');
  return src.slice(start, end);
}

function evaluateSnapDebugEnabled(localStorageImpl) {
  const context = { localStorage: localStorageImpl };
  const snippet = readSnapDebugExpr();
  const bootstrap = `
    ${snippet}
    globalThis.__result = SNAP_DEBUG_ENABLED;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-snap-debug-harness.js' });
  return context.__result;
}

test('snapshot debug logs are disabled by default when no key exists', () => {
  const enabled = evaluateSnapDebugEnabled({
    getItem() { return null; },
  });
  assert.equal(enabled, false);
});

test('snapshot debug logs can still be explicitly enabled', () => {
  const enabled = evaluateSnapDebugEnabled({
    getItem() { return '1'; },
  });
  assert.equal(enabled, true);
});

test('snapshot debug logs remain disabled when localStorage access throws', () => {
  const enabled = evaluateSnapDebugEnabled({
    getItem() { throw new Error('blocked'); },
  });
  assert.equal(enabled, false);
});
