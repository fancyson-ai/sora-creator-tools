const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

/**
 * Extracts the cold shard hydration loop from ensureFullSnapshots and wraps it
 * in a callable function so we can verify that cold snapshots are merged into
 * in-memory posts without crashing (regression for keyStat ReferenceError).
 */
function buildHarness() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');

  // Extract mergeSnapshotsByTimestamp and helpers
  const snapStart = src.indexOf("const SNAPSHOT_NUMERIC_FIELDS = ['views', 'uv', 'likes', 'comments', 'remixes', 'remix_count', 'interactions', 'followers', 'count'];");
  assert.notEqual(snapStart, -1, 'snapshot merge helper start not found');
  const snapEnd = src.indexOf('\n  // Strict post time lookup: only consider explicit post time fields; everything else sorts last', snapStart);
  assert.notEqual(snapEnd, -1, 'snapshot merge helper boundary not found');
  const snapshotHelpers = src.slice(snapStart, snapEnd);

  // Extract the inner hydration loop body from ensureFullSnapshots.
  // The loop iterates plan.targetUserKeys on the main branch.
  const loopStart = src.indexOf('for (const userKey of plan.targetUserKeys) {');
  assert.notEqual(loopStart, -1, 'cold shard hydration loop start not found');
  const loopEndMarker = 'if (mergeStats.aborted) break;\n        }';
  const loopEnd = src.indexOf(loopEndMarker, loopStart);
  assert.notEqual(loopEnd, -1, 'cold shard hydration loop end not found');
  const loopBody = src.slice(loopStart, loopEnd + loopEndMarker.length);

  const context = {};
  const bootstrap = `
    function toTs(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
      if (typeof value === 'string' && value.trim()) {
        const text = value.trim();
        if (/^\\d+$/.test(text)) { const p = Number(text); return p < 1e11 ? p * 1000 : p; }
        const d = Date.parse(text);
        if (!Number.isNaN(d)) return d;
      }
      return 0;
    }
    ${snapshotHelpers}

    const COLD_PREFIX = 'snapshots_';
    const CAMEO_KEY_PREFIX = 'c:';
    const TOP_TODAY_KEY = '__top_today__';
    function normalizeCameoName(name){ return name ? String(name).trim().toLowerCase() : ''; }
    function isCameoKey(k){ return typeof k === 'string' && k.startsWith(CAMEO_KEY_PREFIX); }
    function isTopTodayKey(k){ return k === TOP_TODAY_KEY; }
    function getIdentityUserId(userKey, user){
      const byUser = user?.id != null ? String(user.id) : '';
      if (byUser) return byUser;
      if (typeof userKey === 'string' && userKey.startsWith('id:')) return String(userKey.slice(3) || '');
      return '';
    }
    function findAliasKeysForUser(metrics, userKey, user) {
      if (!userKey || !user || !metrics?.users) return [];
      const identityId = getIdentityUserId(userKey, user);
      const curHandle = normalizeCameoName(user.handle || (userKey.startsWith('h:') ? userKey.slice(2) : ''));
      if (!identityId && !curHandle) return [];
      const aliases = [];
      for (const key of Object.keys(metrics.users)) {
        if (key === userKey || key === 'unknown') continue;
        if (isCameoKey(key) || isTopTodayKey(key)) continue;
        const candidateUser = metrics.users[key];
        const candidateId = getIdentityUserId(key, candidateUser);
        if (identityId && candidateId && candidateId === identityId) { aliases.push(key); continue; }
        if (curHandle) {
          const cHandle = normalizeCameoName(candidateUser?.handle || (key.startsWith('h:') ? key.slice(2) : ''));
          if (cHandle && cHandle === curHandle) aliases.push(key);
        }
      }
      return aliases;
    }

    /**
     * Runs the cold shard hydration merge loop extracted from ensureFullSnapshots.
     * Returns mergeStats so callers can verify snapshots were merged.
     */
    function hydrateColdShards({ metrics, currentUserKey, coldStorage, debugEnabled }) {
      const SNAP_DEBUG_ENABLED = !!debugEnabled;
      const snapshotsHydrationEpoch = 1;
      const runEpoch = 1;
      const user = metrics.users?.[currentUserKey];
      const targetUserKeys = user
        ? [currentUserKey, ...findAliasKeysForUser(metrics, currentUserKey, user)]
        : Object.keys(metrics?.users || {});
      // Build plan object matching the shape used by ensureFullSnapshots
      const canonicalByTarget = new Map();
      for (const uk of targetUserKeys) canonicalByTarget.set(uk, currentUserKey);
      const plan = { targetUserKeys, canonicalByTarget };
      const allStorage = {};
      for (const uk of targetUserKeys) {
        const key = COLD_PREFIX + uk;
        if (coldStorage[key]) allStorage[key] = coldStorage[key];
      }
      const mergeStats = {
        requestedShards: targetUserKeys.length,
        hydratedShards: 0,
        userCount: 0,
        postCount: 0,
        snapshotsAdded: 0,
        snapshotsUpdated: 0,
        aborted: false,
        keyStats: SNAP_DEBUG_ENABLED ? [] : undefined,
        truncatedKeyStats: 0
      };
      ${loopBody}
      return mergeStats;
    }
    globalThis.__hydrateColdShards = hydrateColdShards;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'cold-shard-hydration-harness.js' });
  return { hydrateColdShards: context.__hydrateColdShards };
}

test('cold shard hydration merges historical snapshots into posts', () => {
  const { hydrateColdShards } = buildHarness();
  const metrics = {
    users: {
      'id:user-1': {
        id: 'user-1',
        handle: 'alice',
        posts: {
          'post-a': { snapshots: [{ t: 1700000030000, views: 100 }] },
          'post-b': { snapshots: [{ t: 1700000030000, views: 50 }] },
        }
      }
    }
  };
  const coldStorage = {
    'snapshots_id:user-1': {
      'post-a': [
        { t: 1700000010000, views: 20 },
        { t: 1700000020000, views: 60 },
      ],
      'post-b': [
        { t: 1700000010000, views: 5 },
      ],
    }
  };
  const stats = hydrateColdShards({ metrics, currentUserKey: 'id:user-1', coldStorage });
  assert.equal(stats.snapshotsAdded, 3, 'should add 3 historical snapshots');
  assert.equal(stats.postCount, 2, 'should process 2 posts');
  assert.equal(metrics.users['id:user-1'].posts['post-a'].snapshots.length, 3);
  assert.equal(metrics.users['id:user-1'].posts['post-b'].snapshots.length, 2);
});

test('cold shard hydration does not crash with debug stats enabled', () => {
  const { hydrateColdShards } = buildHarness();
  const metrics = {
    users: {
      'id:user-1': {
        id: 'user-1',
        handle: 'alice',
        posts: {
          'post-a': { snapshots: [{ t: 1700000030000, views: 100 }] },
        }
      }
    }
  };
  const coldStorage = {
    'snapshots_id:user-1': {
      'post-a': [{ t: 1700000010000, views: 10 }],
    }
  };
  const stats = hydrateColdShards({ metrics, currentUserKey: 'id:user-1', coldStorage, debugEnabled: true });
  assert.equal(stats.snapshotsAdded, 1);
  assert.ok(Array.isArray(stats.keyStats), 'keyStats should be an array when debug is enabled');
  assert.equal(stats.keyStats.length, 1);
  assert.equal(stats.keyStats[0].matchedPostCount, 1);
  assert.equal(stats.keyStats[0].snapshotsAdded, 1);
});

test('cold shard hydration merges alias user cold shards into canonical posts', () => {
  const { hydrateColdShards } = buildHarness();
  const metrics = {
    users: {
      'id:user-1': {
        id: 'user-1',
        handle: 'alice',
        posts: {
          'post-a': { snapshots: [{ t: 1700000030000, views: 100 }] },
        }
      },
      'h:alice': {
        handle: 'alice',
        posts: {}
      }
    }
  };
  const coldStorage = {
    'snapshots_h:alice': {
      'post-a': [
        { t: 1700000010000, views: 15 },
      ],
    }
  };
  const stats = hydrateColdShards({ metrics, currentUserKey: 'id:user-1', coldStorage });
  assert.equal(stats.snapshotsAdded, 1, 'alias cold snapshot should merge into canonical post');
  assert.equal(metrics.users['id:user-1'].posts['post-a'].snapshots.length, 2);
});
