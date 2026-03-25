const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractCleanupSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function cloneRelationshipGraphNode(node) {');
  assert.notEqual(start, -1, 'cleanup snippet start not found');
  const end = src.indexOf('function clearCleanupPlannerList(el, emptyText) {', start);
  assert.notEqual(end, -1, 'cleanup snippet end not found');
  return src.slice(start, end);
}

function buildCleanupHarness() {
  const snippet = extractCleanupSnippet();
  const context = {};
  const bootstrap = `
    const CLEANUP_PANEL_FILTER_DEFAULTS = { pageSize: 25 };
    function toTs(v){
      if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
      if (typeof v === 'string' && v.trim()) {
        const s = v.trim();
        if (/^\\d+(?:\\.\\d+)?$/.test(s)) {
          const n = Number(s);
          return n < 1e11 ? n * 1000 : n;
        }
        const d = Date.parse(s);
        if (!Number.isNaN(d)) return d;
      }
      return 0;
    }
    ${snippet}
    globalThis.__buildCleanupPlannerModel = buildCleanupPlannerModel;
    globalThis.__mergeRelationshipGraphs = mergeRelationshipGraphs;
    globalThis.__filterCleanupPlannerItems = filterCleanupPlannerItems;
    globalThis.__paginateCleanupPlannerItems = paginateCleanupPlannerItems;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-cleanup-planner.harness.js' });
  return {
    buildCleanupPlannerModel: context.__buildCleanupPlannerModel,
    mergeRelationshipGraphs: context.__mergeRelationshipGraphs,
    filterCleanupPlannerItems: context.__filterCleanupPlannerItems,
    paginateCleanupPlannerItems: context.__paginateCleanupPlannerItems,
  };
}

test('mergeRelationshipGraphs keeps latest node stats while preserving both edge directions', () => {
  const { mergeRelationshipGraphs } = buildCleanupHarness();
  const merged = mergeRelationshipGraphs([
    {
      nodes: {
        'h:bob': { user_key: 'h:bob', user_handle: 'bob', follower_count: 12, updated_at: 1700000000, lastSeenAt: 1700000000000 },
      },
      edges: {
        followers: {},
        following: {
          'h:bob': { user_key: 'h:bob', is_following: true, follows_you: false, seenAt: 1700000000000 },
        },
      },
    },
    {
      nodes: {
        'h:bob': { user_key: 'h:bob', user_handle: 'bob', follower_count: 25, updated_at: 1700003600, lastSeenAt: 1700005000000 },
      },
      edges: {
        followers: {
          'h:bob': { user_key: 'h:bob', is_following: false, follows_you: true, seenAt: 1700005000000 },
        },
        following: {},
      },
    },
  ]);
  assert.ok(merged);
  assert.equal(merged.nodes['h:bob'].follower_count, 25);
  assert.equal(merged.edges.following['h:bob'].is_following, true);
  assert.equal(merged.edges.followers['h:bob'].follows_you, true);
});

test('buildCleanupPlannerModel surfaces non-mutual low-signal following accounts first', () => {
  const { buildCleanupPlannerModel } = buildCleanupHarness();
  const now = Date.UTC(2026, 2, 22);
  const user = {
    relationshipGraph: {
      nodes: {
        'h:inactive': {
          user_key: 'h:inactive',
          user_handle: 'inactive',
          follower_count: 8,
          post_count: 3,
          likes_received_count: 12,
          updated_at: Math.floor((now - 90 * 24 * 60 * 60 * 1000) / 1000),
          permalink: 'https://sora.chatgpt.com/profile/inactive',
        },
        'h:creator': {
          user_key: 'h:creator',
          user_handle: 'creator',
          follower_count: 5400,
          post_count: 220,
          likes_received_count: 48000,
          updated_at: Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000),
          verified: true,
          permalink: 'https://sora.chatgpt.com/profile/creator',
        },
      },
      edges: {
        followers: {
          'h:creator': {
            user_key: 'h:creator',
            follows_you: true,
            is_following: false,
            seenAt: now - 1000,
          },
        },
        following: {
          'h:inactive': {
            user_key: 'h:inactive',
            follows_you: false,
            is_following: true,
            seenAt: now - 1000,
          },
          'h:creator': {
            user_key: 'h:creator',
            follows_you: true,
            is_following: true,
            seenAt: now - 1000,
          },
        },
      },
    },
  };

  const plan = buildCleanupPlannerModel(user, {
    maxFollowers: 200,
    minPosts: 12,
    staleDays: 45,
    minLikesReceived: 120,
    maxRows: 10,
  }, now);

  assert.equal(plan.summary.followingCaptured, 2);
  assert.equal(plan.summary.mutualCount, 1);
  assert.equal(plan.following[0].userKey, 'h:inactive');
  assert.equal(plan.following[0].recommendation, 'Unfollow likely');
  assert.ok(plan.following[0].reasons.some((reason) => reason.label === 'not following you back'));
  assert.ok(plan.following.every((item) => item.userKey !== 'h:creator' || item.score < plan.following[0].score));
});

test('buildCleanupPlannerModel marks exact zero-signal following accounts for one-click selection', () => {
  const { buildCleanupPlannerModel } = buildCleanupHarness();
  const now = Date.UTC(2026, 2, 23);
  const user = {
    relationshipGraph: {
      nodes: {
        'h:ghost': {
          user_key: 'h:ghost',
          user_handle: 'ghost',
          follower_count: 0,
          post_count: 0,
          likes_received_count: 0,
          updated_at: Math.floor((now - 131 * 24 * 60 * 60 * 1000) / 1000),
          permalink: 'https://sora.chatgpt.com/profile/ghost',
        },
      },
      edges: {
        followers: {},
        following: {
          'h:ghost': {
            user_key: 'h:ghost',
            user_handle: 'ghost',
            follows_you: false,
            is_following: true,
            seenAt: now - 1000,
          },
        },
      },
    },
  };

  const plan = buildCleanupPlannerModel(user, {
    maxFollowers: 200,
    minPosts: 12,
    staleDays: 45,
    minLikesReceived: 120,
  }, now);

  assert.equal(plan.summary.zeroSignalFollowingCount, 1);
  assert.equal(plan.following[0].userKey, 'h:ghost');
  assert.equal(plan.following[0].zeroSignal, true);
  assert.equal(plan.following[0].nonMutual, true);
  assert.equal(plan.following[0].inactive, true);
});

test('filterCleanupPlannerItems supports reason and status filtering before pagination', () => {
  const { filterCleanupPlannerItems, paginateCleanupPlannerItems } = buildCleanupHarness();
  const items = [
    { userKey: 'h:alpha', userHandle: 'alpha', displayName: 'Alpha', score: 82, nonMutual: true, lowFollowers: true, lowPosts: true, lowLikes: true, inactive: true, zeroSignal: true, verified: false, followerCount: 0, postCount: 0, likesReceivedCount: 0, inactiveDays: 90 },
    { userKey: 'h:beta', userHandle: 'beta', displayName: 'Beta', score: 61, nonMutual: true, lowFollowers: false, lowPosts: false, lowLikes: false, inactive: false, verified: false, followerCount: 250, postCount: 45, inactiveDays: 5 },
    { userKey: 'h:creator', userHandle: 'creator', displayName: 'Creator', score: 18, nonMutual: false, lowFollowers: false, lowPosts: false, lowLikes: false, inactive: false, verified: true, followerCount: 5000, postCount: 240, inactiveDays: 1 },
  ];

  const filtered = filterCleanupPlannerItems(items, {
    search: 'a',
    status: 'actionable',
    reason: 'non_mutual',
    sort: 'followers_asc',
  }, 'following');
  assert.deepEqual(filtered.map((item) => item.userKey), ['h:alpha', 'h:beta']);

  const page = paginateCleanupPlannerItems(filtered, 2, 1);
  assert.equal(page.totalPages, 2);
  assert.equal(page.page, 2);
  assert.deepEqual(page.items.map((item) => item.userKey), ['h:beta']);

  const zeroSignal = filterCleanupPlannerItems(items, {
    search: '',
    status: 'all',
    reason: 'zero_signal',
    sort: 'score_desc',
  }, 'following');
  assert.deepEqual(zeroSignal.map((item) => item.userKey), ['h:alpha']);

  const smartUnfollow = filterCleanupPlannerItems(items, {
    search: '',
    status: 'actionable',
    reason: 'smart_unfollow',
    sort: 'score_desc',
  }, 'following');
  assert.deepEqual(smartUnfollow.map((item) => item.userKey), ['h:alpha']);

  const lowLikes = filterCleanupPlannerItems(items, {
    search: '',
    status: 'all',
    reason: 'low_likes',
    sort: 'likes_asc',
  }, 'following');
  assert.deepEqual(lowLikes.map((item) => item.userKey), ['h:alpha']);
});
