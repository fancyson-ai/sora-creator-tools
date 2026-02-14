const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractResolutionSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function isCharacterId(id){');
  assert.notEqual(start, -1, 'user resolution snippet start not found');
  const end = src.indexOf('const DBG_SORT = false;', start);
  assert.notEqual(end, -1, 'user resolution snippet end not found');
  return src.slice(start, end);
}

function buildResolutionHarness() {
  const snippet = extractResolutionSnippet();
  const context = {};
  const bootstrap = `
    const TOP_TODAY_KEY = '__top_today__';
    const TOP_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;
    const TOP_TODAY_MIN_UNIQUE_VIEWS = 100;
    const TOP_TODAY_MIN_LIKES = 15;
    const CAMEO_KEY_PREFIX = 'c:';
    let lastMetricsUpdatedAt = 0;
    const cameoUserCache = { updatedAt: 0, users: new Map() };
    const getPostTimeForRecency = () => 0;
    const latestSnapshot = () => null;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const normalizeCameoName = (value) => String(value || '').trim().toLowerCase();
    ${snippet}
    globalThis.__resolveUserForKey = resolveUserForKey;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-user-resolution-harness.js' });
  return {
    resolveUserForKey: context.__resolveUserForKey,
  };
}

test('resolveUserForKey(id:...) prefers matching handle bucket when direct id bucket is empty', () => {
  const { resolveUserForKey } = buildResolutionHarness();
  const metrics = {
    users: {
      'id:user-1': { id: 'user-1', handle: 'alice', posts: {} },
      'h:alice': {
        id: 'user-1',
        handle: 'alice',
        posts: { p1: { snapshots: [{ t: 1 }] } },
      },
    },
  };
  const resolved = resolveUserForKey(metrics, 'id:user-1');
  assert.equal(resolved, metrics.users['h:alice']);
});

test('resolveUserForKey(h:...) prefers matching id bucket when direct handle bucket is empty', () => {
  const { resolveUserForKey } = buildResolutionHarness();
  const metrics = {
    users: {
      'h:alice': { id: 'user-1', handle: 'alice', posts: {} },
      'id:user-1': {
        id: 'user-1',
        handle: 'alice',
        posts: { p1: { snapshots: [{ t: 1 }] } },
      },
    },
  };
  const resolved = resolveUserForKey(metrics, 'h:alice');
  assert.equal(resolved, metrics.users['id:user-1']);
});

test('resolveUserForKey keeps direct id bucket when it already has posts', () => {
  const { resolveUserForKey } = buildResolutionHarness();
  const metrics = {
    users: {
      'id:user-1': {
        id: 'user-1',
        handle: 'alice',
        posts: { p1: { snapshots: [{ t: 1 }] }, p2: { snapshots: [{ t: 2 }] } },
      },
      'h:alice': {
        id: 'user-1',
        handle: 'alice',
        posts: { p3: { snapshots: [{ t: 3 }] } },
      },
    },
  };
  const resolved = resolveUserForKey(metrics, 'id:user-1');
  assert.equal(resolved, metrics.users['id:user-1']);
});
