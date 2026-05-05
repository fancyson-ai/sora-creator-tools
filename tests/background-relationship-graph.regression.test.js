const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BACKGROUND_PATH = path.join(__dirname, '..', 'background.js');

function extractSnippet(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start not found`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end not found`);
  return source.slice(start, end);
}

function buildRelationshipGraphHarness() {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const snippet = extractSnippet(
    src,
    'function isPlainObject(value) {',
    'function normalizeMetrics(raw) {',
    'background relationship graph snippet'
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${snippet}\nglobalThis.__upsertRelationshipGraph = upsertRelationshipGraph;`,
    context,
    { filename: 'background-relationship-graph.harness.js' }
  );
  assert.equal(typeof context.__upsertRelationshipGraph, 'function');
  return context.__upsertRelationshipGraph;
}

test('upsertRelationshipGraph replace payload prunes stale following edges', () => {
  const upsertRelationshipGraph = buildRelationshipGraphHarness();
  const userEntry = {
    relationshipGraph: {
      nodes: {
        'h:keep': { user_key: 'h:keep', user_handle: 'keep', lastSeenAt: 1700000000000 },
        'h:remove': { user_key: 'h:remove', user_handle: 'remove', lastSeenAt: 1700000000000 },
      },
      edges: {
        followers: {},
        following: {
          'h:keep': { user_key: 'h:keep', user_handle: 'keep', is_following: true, follows_you: false, seenAt: 1700000000000 },
          'h:remove': { user_key: 'h:remove', user_handle: 'remove', is_following: true, follows_you: false, seenAt: 1700000000000 },
        },
      },
    },
  };

  const changed = upsertRelationshipGraph(userEntry, {
    list_kind: 'following',
    replace: true,
    items: [
      {
        user_key: 'h:keep',
        user_handle: 'keep',
        user_id: 'user-keep',
        follower_count: 1,
        follows_you: false,
        is_following: true,
      },
    ],
  }, 1700005000000);

  assert.equal(changed, true);
  assert.deepEqual(Object.keys(userEntry.relationshipGraph.edges.following), ['h:keep']);
  assert.equal(userEntry.relationshipGraph.fullSyncAt.following, 1700005000000);
});

test('upsertRelationshipGraph replace payload can clear a following bucket entirely', () => {
  const upsertRelationshipGraph = buildRelationshipGraphHarness();
  const userEntry = {
    relationshipGraph: {
      nodes: {},
      edges: {
        followers: {},
        following: {
          'h:remove': { user_key: 'h:remove', user_handle: 'remove', is_following: true, follows_you: false, seenAt: 1700000000000 },
        },
      },
    },
  };

  const changed = upsertRelationshipGraph(userEntry, {
    list_kind: 'following',
    replace: true,
    items: [],
  }, 1700008000000);

  assert.equal(changed, true);
  assert.deepEqual(Object.keys(userEntry.relationshipGraph.edges.following), []);
  assert.equal(userEntry.relationshipGraph.fullSyncAt.following, 1700008000000);
});
