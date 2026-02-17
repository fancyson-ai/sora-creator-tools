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
    let metrics = { users: {} };
    let isMetricsPartial = false;
    let lastMetricsUpdatedAt = 0;
    const cameoUserCache = { updatedAt: 0, users: new Map() };
    const getPostTimeForRecency = () => 0;
    const latestSnapshot = () => null;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const normalizeCameoName = (value) => String(value || '').trim().toLowerCase();
    const toTs = (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
      if (typeof v === 'string' && v.trim()) {
        const s = v.trim();
        if (/^\\d+$/.test(s)) {
          const n = Number(s);
          return n < 1e11 ? n * 1000 : n;
        }
        const d = Date.parse(s);
        if (!Number.isNaN(d)) return d;
      }
      return 0;
    };
    const SNAPSHOT_NUMERIC_FIELDS = ['views', 'uv', 'likes', 'comments', 'remixes', 'remix_count', 'interactions', 'followers', 'count'];
    function mergeSnapshotPoint(existing, incoming){
      const left = (existing && typeof existing === 'object') ? existing : null;
      const right = (incoming && typeof incoming === 'object') ? incoming : null;
      if (!left && !right) return null;
      if (!left) {
        const t = toTs(right?.t);
        return t ? { ...right, t } : { ...right };
      }
      if (!right) {
        const t = toTs(left?.t);
        return t ? { ...left, t } : { ...left };
      }
      const merged = { ...left, ...right };
      const mergedTs = toTs(right?.t) || toTs(left?.t);
      if (mergedTs) merged.t = mergedTs;
      for (const field of SNAPSHOT_NUMERIC_FIELDS) {
        const a = Number(left?.[field]);
        const b = Number(right?.[field]);
        if (Number.isFinite(a) && Number.isFinite(b)) merged[field] = Math.max(a, b);
        else if (Number.isFinite(b)) merged[field] = b;
        else if (Number.isFinite(a)) merged[field] = a;
      }
      return merged;
    }
    function mergeSnapshotsByTimestamp(existingSnaps, incomingSnaps){
      const byTs = new Map();
      const mergeIn = (list) => {
        for (const rawSnap of (Array.isArray(list) ? list : [])) {
          if (!rawSnap || typeof rawSnap !== 'object') continue;
          const t = toTs(rawSnap.t);
          if (!t) continue;
          const snap = t === rawSnap.t ? rawSnap : { ...rawSnap, t };
          const prev = byTs.get(t);
          byTs.set(t, mergeSnapshotPoint(prev, snap));
        }
      };
      mergeIn(existingSnaps);
      mergeIn(incomingSnaps);
      const out = Array.from(byTs.values()).filter(Boolean);
      out.sort((a, b) => (toTs(a?.t) || 0) - (toTs(b?.t) || 0));
      return out;
    }
    ${snippet}
    globalThis.__resolveUserForKey = resolveUserForKey;
    globalThis.__isSelectableUserKey = isSelectableUserKey;
    globalThis.__areEquivalentUserKeys = areEquivalentUserKeys;
    globalThis.__chooseRestoredUserKey = chooseRestoredUserKey;
    globalThis.__shouldDeferStoredRestore = shouldDeferStoredRestore;
    globalThis.__findAliasKeysForUser = findAliasKeysForUser;
    globalThis.__countIdentityPosts = countIdentityPosts;
    globalThis.__buildMergedIdentityUser = buildMergedIdentityUser;
    globalThis.__setMetrics = (next) => { metrics = next; };
    globalThis.__setMetricsPartial = (next) => { isMetricsPartial = !!next; };
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-user-resolution-harness.js' });
  return {
    resolveUserForKey: context.__resolveUserForKey,
    isSelectableUserKey: context.__isSelectableUserKey,
    areEquivalentUserKeys: context.__areEquivalentUserKeys,
    chooseRestoredUserKey: context.__chooseRestoredUserKey,
    shouldDeferStoredRestore: context.__shouldDeferStoredRestore,
    findAliasKeysForUser: context.__findAliasKeysForUser,
    countIdentityPosts: context.__countIdentityPosts,
    buildMergedIdentityUser: context.__buildMergedIdentityUser,
    setMetrics: context.__setMetrics,
    setMetricsPartial: context.__setMetricsPartial,
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

test('isSelectableUserKey treats alias id key as selectable when matching handle bucket exists', () => {
  const { isSelectableUserKey, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({
    users: {
      'h:alice': {
        id: 'user-1',
        handle: 'alice',
        posts: { p1: { snapshots: [{ t: 1 }] } },
      },
    },
  });
  setMetricsPartial(false);
  assert.equal(isSelectableUserKey('id:user-1'), true);
});

test('isSelectableUserKey rejects top-today while metrics are partial', () => {
  const { isSelectableUserKey, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({ users: {} });
  setMetricsPartial(true);
  assert.equal(isSelectableUserKey('__top_today__'), false);
});

test('areEquivalentUserKeys matches id and handle aliases for the same identity', () => {
  const { areEquivalentUserKeys } = buildResolutionHarness();
  const metrics = {
    users: {
      'id:user-1': { id: 'user-1', handle: 'alice', posts: {} },
      'h:alice': { id: 'user-1', handle: 'alice', posts: {} },
    },
  };
  assert.equal(areEquivalentUserKeys(metrics, 'id:user-1', 'h:alice'), true);
});

test('areEquivalentUserKeys does not match users with same handle but different ids', () => {
  const { areEquivalentUserKeys } = buildResolutionHarness();
  const metrics = {
    users: {
      'id:user-1': { id: 'user-1', handle: 'alice', posts: {} },
      'id:user-2': { id: 'user-2', handle: 'alice', posts: {} },
    },
  };
  assert.equal(areEquivalentUserKeys(metrics, 'id:user-1', 'id:user-2'), false);
});

test('chooseRestoredUserKey prefers stored key when stored key is an alias-equivalent identity', () => {
  const { chooseRestoredUserKey, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({
    users: {
      'id:user-1': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
      'h:alice': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
    },
  });
  setMetricsPartial(false);
  assert.equal(chooseRestoredUserKey('h:alice', 'id:user-1'), 'id:user-1');
});

test('chooseRestoredUserKey switches to stored key when identities differ and stored key is selectable', () => {
  const { chooseRestoredUserKey, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({
    users: {
      'h:alice': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
      'h:bob': { id: 'user-2', handle: 'bob', posts: { p2: { snapshots: [{ t: 2 }] } } },
    },
  });
  setMetricsPartial(false);
  assert.equal(chooseRestoredUserKey('h:alice', 'h:bob'), 'h:bob');
});

test('chooseRestoredUserKey keeps current key when stored key is not selectable', () => {
  const { chooseRestoredUserKey, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({
    users: {
      'h:alice': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
    },
  });
  setMetricsPartial(false);
  assert.equal(chooseRestoredUserKey('h:alice', 'h:missing'), 'h:alice');
});

test('shouldDeferStoredRestore returns true when current key is selectable but stored key is not yet selectable', () => {
  const { shouldDeferStoredRestore, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({
    users: {
      'id:user-1': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
    },
  });
  setMetricsPartial(false);
  assert.equal(shouldDeferStoredRestore('id:user-1', 'h:alice-alt'), true);
});

test('shouldDeferStoredRestore returns false when stored key is already selectable', () => {
  const { shouldDeferStoredRestore, setMetrics, setMetricsPartial } = buildResolutionHarness();
  setMetrics({
    users: {
      'id:user-1': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
      'h:alice': { id: 'user-1', handle: 'alice', posts: { p1: { snapshots: [{ t: 1 }] } } },
    },
  });
  setMetricsPartial(false);
  assert.equal(shouldDeferStoredRestore('id:user-1', 'h:alice'), false);
});

test('findAliasKeysForUser matches by id and by exact handle (even with different id)', () => {
  const { findAliasKeysForUser } = buildResolutionHarness();
  const metrics = {
    users: {
      'h:alice': { id: 'user-1', handle: 'alice', posts: {} },
      'id:user-1': { id: 'user-1', handle: 'alice', posts: {} },
      'h:alice-alt': { id: 'user-1', handle: 'alice-alt', posts: {} },
      'id:user-2': { id: 'user-2', handle: 'alice', posts: {} },
      'id:user-3': { id: 'user-3', handle: 'bob', posts: {} },
    },
  };
  // Exact handle match (alice === alice) is trusted, consistent with keyMatchesUserIdentity.
  // id:user-2 has handle 'alice' so it merges. id:user-3 has handle 'bob' so it doesn't.
  const aliases = Array.from(findAliasKeysForUser(metrics, 'h:alice', metrics.users['h:alice'])).sort();
  assert.deepEqual(aliases, ['h:alice-alt', 'id:user-1', 'id:user-2']);
});

test('countIdentityPosts returns merged unique post count across aliases', () => {
  const { countIdentityPosts } = buildResolutionHarness();
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
        posts: { p2: { snapshots: [{ t: 2 }] }, p3: { snapshots: [{ t: 3 }] } },
      },
      'id:user-2': {
        id: 'user-2',
        handle: 'alice',
        posts: { p9: { snapshots: [{ t: 9 }] } },
      },
    },
  };
  // id:user-2 handle 'alice' merges via exact handle match → p9 included → 4 unique posts
  assert.equal(countIdentityPosts(metrics, 'id:user-1', metrics.users['id:user-1']), 4);
});

test('buildMergedIdentityUser unions snapshots across alias buckets for the same post id', () => {
  const { buildMergedIdentityUser } = buildResolutionHarness();
  const metrics = {
    users: {
      'id:user-1': {
        id: 'user-1',
        handle: 'alice',
        posts: {
          p1: {
            snapshots: [
              { t: 1700000000000, views: 10, uv: 5, likes: 1 },
              { t: 1700000005000, views: 20, uv: 10, likes: 2 },
            ],
          },
        },
      },
      'h:alice': {
        id: 'user-1',
        handle: 'alice',
        posts: {
          p1: {
            snapshots: [
              { t: 1700000005000, views: 21, uv: 11, likes: 3 },
              { t: 1700000010000, views: 30, uv: 15, likes: 4 },
            ],
          },
          p2: {
            snapshots: [{ t: 1700000000000, views: 5, uv: 2, likes: 1 }],
          },
        },
      },
    },
  };
  const merged = buildMergedIdentityUser(metrics, 'id:user-1', metrics.users['id:user-1']);
  assert.ok(merged && merged.user);
  assert.equal(Object.keys(merged.user.posts || {}).length, 2);
  const mergedP1 = merged.user.posts.p1;
  assert.ok(Array.isArray(mergedP1.snapshots));
  assert.equal(mergedP1.snapshots.length, 3);
  assert.deepEqual(Array.from(mergedP1.snapshots.map((s) => s.t)), [1700000000000, 1700000005000, 1700000010000]);
  const t2 = mergedP1.snapshots.find((s) => s.t === 1700000005000);
  assert.equal(t2.views, 21);
  assert.equal(t2.uv, 11);
  assert.equal(t2.likes, 3);
});

test('buildMergedIdentityUser merges followers from multiple alias buckets by timestamp', () => {
  const { buildMergedIdentityUser, setMetrics } = buildResolutionHarness();
  const metrics = {
    users: {
      'id:user-1': {
        id: 'user-1',
        handle: 'cosmicskye',
        posts: { p1: { snapshots: [{ t: 1700000000000, views: 1 }] } },
        followers: [
          { t: 1700000010000, count: 50 },
          { t: 1700000020000, count: 55 },
        ],
        cameos: [],
      },
      'h:cosmic-skye': {
        id: 'user-1',
        handle: 'cosmicskye',
        posts: {},
        followers: [
          { t: 1700000001000, count: 10 },
          { t: 1700000005000, count: 30 },
          { t: 1700000010000, count: 48 },
        ],
        cameos: [
          { t: 1700000001000, count: 2 },
          { t: 1700000005000, count: 5 },
        ],
      },
      'h:cosmicskye': {
        handle: 'cosmicskye',
        posts: {},
        followers: [
          { t: 1700000030000, count: 60 },
        ],
        cameos: [
          { t: 1700000030000, count: 8 },
        ],
      },
    },
  };
  setMetrics(metrics);
  const merged = buildMergedIdentityUser(metrics, 'id:user-1', metrics.users['id:user-1']);
  const f = merged.user.followers;
  assert.ok(Array.isArray(f), 'followers should be an array');
  assert.equal(f.length, 5, 'should merge 5 unique timestamps from all buckets');
  assert.deepEqual(Array.from(f.map(e => e.t)), [1700000001000, 1700000005000, 1700000010000, 1700000020000, 1700000030000]);
  assert.equal(f[2].count, 50, 'duplicate timestamp should keep higher count');
  assert.equal(f[4].count, 60, 'most recent entry from new handle should be present');
  const c = merged.user.cameos;
  assert.ok(Array.isArray(c), 'cameos should be an array');
  assert.equal(c.length, 3, 'should merge 3 unique cameo timestamps');
  assert.equal(c[2].count, 8, 'most recent cameo from new handle should be present');
});
