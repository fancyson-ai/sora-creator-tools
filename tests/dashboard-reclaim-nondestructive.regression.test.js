const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractReclaimSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function keyMatchesUserIdentity(metrics, candidateKey, userKey, user){');
  assert.notEqual(start, -1, 'keyMatchesUserIdentity not found');
  const end = src.indexOf('\n\n  // Fallback: derive a comparable numeric from the post ID', start);
  assert.notEqual(end, -1, 'reclaim/prune snippet boundary not found');
  return src.slice(start, end);
}

function buildHarness() {
  const saveMetricsCalls = [];
  const now = Date.now();
  const context = {
    normalizeCameoName: (value) => String(value || '').trim().toLowerCase(),
    isCameoKey: (key) => String(key || '').startsWith('c:'),
    isTopTodayKey: (key) => key === '__top_today__',
    toTs: (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
      if (typeof v === 'string' && v.trim()) {
        const s = v.trim();
        if (/^\d+$/.test(s)) {
          const n = Number(s);
          return n < 1e11 ? n * 1000 : n;
        }
        const d = Date.parse(s);
        if (!Number.isNaN(d)) return d;
      }
      return 0;
    },
    latestSnapshot: (snaps) => {
      if (!Array.isArray(snaps) || !snaps.length) return null;
      return snaps[snaps.length - 1];
    },
    lastRefreshMsForPost: (post) => {
      const last = Array.isArray(post?.snapshots) && post.snapshots.length ? post.snapshots[post.snapshots.length - 1] : null;
      const snapT = Number(last?.t) || 0;
      const seenT = Number(post?.lastSeen) || 0;
      return Math.max(snapT, seenT);
    },
    saveMetrics: async (_metrics, opts = {}) => {
      saveMetricsCalls.push(opts);
    }
  };
  const snippet = extractReclaimSnippet();
  const bootstrap = `
    ${snippet}
    globalThis.__reclaimFromUnknownForUser = reclaimFromUnknownForUser;
    globalThis.__pruneEmptyPostsForUser = pruneEmptyPostsForUser;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-reclaim-nondestructive-harness.js' });
  return {
    reclaimFromUnknownForUser: context.__reclaimFromUnknownForUser,
    pruneEmptyPostsForUser: context.__pruneEmptyPostsForUser,
    saveMetricsCalls,
    now
  };
}

test('reclaimFromUnknownForUser does not delete from unknown by default', async () => {
  const harness = buildHarness();
  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {}
      },
      unknown: {
        posts: {
          p1: {
            ownerHandle: 'alice',
            snapshots: [{ t: harness.now - 1000, likes: 1 }]
          }
        }
      }
    }
  };

  const result = await harness.reclaimFromUnknownForUser(metrics, 'h:alice');
  assert.equal(result.moved, 1);
  assert.ok(metrics.users['h:alice'].posts.p1);
  assert.ok(metrics.users.unknown.posts.p1);
  assert.equal(harness.saveMetricsCalls.length, 1);
});

test('pruneEmptyPostsForUser only removes old empty posts', async () => {
  const harness = buildHarness();
  const oneHourMs = 60 * 60 * 1000;
  const twoDaysMs = 48 * oneHourMs;
  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          recentEmpty: {
            post_time: harness.now - oneHourMs,
            snapshots: []
          },
          oldEmpty: {
            post_time: harness.now - twoDaysMs,
            snapshots: []
          },
          oldWithMetric: {
            post_time: harness.now - twoDaysMs,
            snapshots: [{ t: harness.now - twoDaysMs, likes: 1 }]
          }
        }
      }
    }
  };

  const result = await harness.pruneEmptyPostsForUser(metrics, 'h:alice');
  assert.equal(Array.isArray(result.removed), true);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0], 'oldEmpty');
  assert.ok(metrics.users['h:alice'].posts.recentEmpty);
  assert.ok(metrics.users['h:alice'].posts.oldWithMetric);
  assert.equal(harness.saveMetricsCalls.length, 1);
});
