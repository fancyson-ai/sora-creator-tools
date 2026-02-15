const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function extractPruneSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function keyMatchesUserIdentity(metrics, candidateKey, userKey, user){');
  assert.notEqual(start, -1, 'keyMatchesUserIdentity not found');
  const end = src.indexOf('\n\n  // Remove posts that are missing data for the selected user.', start);
  assert.notEqual(end, -1, 'prune function boundary not found');
  return src.slice(start, end);
}

function buildPruneHarness() {
  const saveMetricsCalls = [];
  const context = {
    normalizeCameoName: (value) => String(value || '').trim().toLowerCase(),
    saveMetrics: async (_metrics, opts = {}) => {
      saveMetricsCalls.push(clone(opts));
    },
  };
  const snippet = extractPruneSnippet();
  const bootstrap = `
    ${snippet}
    globalThis.__pruneMismatchedPostsForUser = pruneMismatchedPostsForUser;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-prune-owner-key-harness.js' });
  return {
    pruneMismatchedPostsForUser: context.__pruneMismatchedPostsForUser,
    saveMetricsCalls,
  };
}

test('pruneMismatchedPostsForUser keeps posts when ownerKey id alias matches selected h: user identity', async () => {
  const harness = buildPruneHarness();
  const metrics = {
    users: {
      'h:cosmonaut_': {
        handle: 'cosmonaut_',
        id: 'user-1',
        posts: {
          p1: {
            ownerKey: 'id:user-1',
            ownerId: 'user-1',
            ownerHandle: 'cosmonaut_',
            snapshots: [{ t: 1, likes: 1 }],
          },
        },
      },
      'id:user-1': {
        handle: 'cosmonaut_',
        id: 'user-1',
        posts: {},
      },
    },
  };

  const result = await harness.pruneMismatchedPostsForUser(metrics, 'h:cosmonaut_', { log: false });

  assert.equal(result.moved.length, 0);
  assert.equal(result.kept, 1);
  assert.ok(metrics.users['h:cosmonaut_'].posts.p1);
  assert.equal(metrics.users['h:cosmonaut_'].posts.p1.ownerKey, 'h:cosmonaut_');
  assert.equal(harness.saveMetricsCalls.length, 0);
});

test('pruneMismatchedPostsForUser moves posts when ownerKey points to a different user identity', async () => {
  const harness = buildPruneHarness();
  const metrics = {
    users: {
      'h:cosmonaut_': {
        handle: 'cosmonaut_',
        id: 'user-1',
        posts: {
          p1: {
            ownerKey: 'id:user-2',
            ownerId: 'user-2',
            ownerHandle: 'other_handle',
            snapshots: [{ t: 1, likes: 1 }],
          },
        },
      },
    },
  };

  const result = await harness.pruneMismatchedPostsForUser(metrics, 'h:cosmonaut_', { log: false });

  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].to, 'id:user-2');
  assert.equal(result.kept, 0);
  assert.ok(!metrics.users['h:cosmonaut_'].posts.p1);
  assert.ok(metrics.users['id:user-2'].posts.p1);
  assert.equal(harness.saveMetricsCalls.length, 1);
  assert.deepEqual(harness.saveMetricsCalls[0].userKeys.sort(), ['h:cosmonaut_', 'id:user-2'].sort());
});
