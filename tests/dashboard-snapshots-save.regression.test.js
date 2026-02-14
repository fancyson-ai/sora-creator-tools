const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');
const COLD_PREFIX = 'snapshots_';
const USERS_INDEX_STORAGE_KEY = 'metricsUsersIndex';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toTs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    if (/^\d+$/.test(text)) {
      const parsed = Number(text);
      return parsed < 1e11 ? parsed * 1000 : parsed;
    }
    const parsedDate = Date.parse(text);
    if (!Number.isNaN(parsedDate)) return parsedDate;
  }
  return 0;
}

function extractSaveMetricsFunctionSource() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('async function saveMetrics(nextMetrics, opts = {}){');
  assert.notEqual(start, -1, 'saveMetrics function not found in dashboard.js');
  const end = src.indexOf('\n\n  async function getMetricsUpdatedAt()', start);
  assert.notEqual(end, -1, 'saveMetrics function boundary not found in dashboard.js');
  return src.slice(start, end);
}

function buildHarness(options = {}) {
  const {
    snapshotsHydrated = false,
    isMetricsPartial = false,
    existingCold = {},
  } = options;

  const calls = {
    get: [],
    set: [],
    remove: [],
  };

  const storage = {
    async get(keys) {
      calls.get.push(clone(keys));
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(existingCold, key)) out[key] = clone(existingCold[key]);
        }
        return out;
      }
      if (typeof keys === 'string') {
        return Object.prototype.hasOwnProperty.call(existingCold, keys) ? { [keys]: clone(existingCold[keys]) } : {};
      }
      return {};
    },
    async set(payload) {
      calls.set.push(clone(payload));
    },
    async remove(keys) {
      calls.remove.push(clone(keys));
    },
  };

  const context = {
    __snapshotsHydrated: snapshotsHydrated,
    __isMetricsPartial: isMetricsPartial,
    __usersIndex: [],
    __lastMetricsUpdatedAt: 0,
    __COLD_PREFIX: COLD_PREFIX,
    __USERS_INDEX_STORAGE_KEY: USERS_INDEX_STORAGE_KEY,
    __chrome: { storage: { local: storage } },
    __toTs: toTs,
    __snapLog() {},
    __summarizeMetricsSnapshots(metrics) {
      const users = metrics?.users || {};
      let userCount = 0;
      let postCount = 0;
      for (const user of Object.values(users)) {
        userCount++;
        postCount += Object.keys(user?.posts || {}).length;
      }
      return { userCount, postCount };
    },
    __summarizeColdPayload(payload) {
      let shardCount = 0;
      let postCount = 0;
      let snapshotCount = 0;
      for (const shard of Object.values(payload || {})) {
        shardCount++;
        for (const snaps of Object.values(shard || {})) {
          postCount++;
          snapshotCount += Array.isArray(snaps) ? snaps.length : 0;
        }
      }
      return { shardCount, postCount, snapshotCount };
    },
    __buildUsersIndexFromMetrics(metrics) {
      return Object.entries(metrics?.users || {}).map(([key, user]) => ({
        key,
        handle: user?.handle || null,
        postCount: Object.keys(user?.posts || {}).length,
      }));
    },
  };

  const saveMetricsSource = extractSaveMetricsFunctionSource();
  const bootstrap = `
    let snapshotsHydrated = globalThis.__snapshotsHydrated;
    let isMetricsPartial = globalThis.__isMetricsPartial;
    let usersIndex = globalThis.__usersIndex;
    let lastMetricsUpdatedAt = globalThis.__lastMetricsUpdatedAt;
    const COLD_PREFIX = globalThis.__COLD_PREFIX;
    const USERS_INDEX_STORAGE_KEY = globalThis.__USERS_INDEX_STORAGE_KEY;
    const chrome = globalThis.__chrome;
    const toTs = globalThis.__toTs;
    const snapLog = globalThis.__snapLog;
    const summarizeMetricsSnapshots = globalThis.__summarizeMetricsSnapshots;
    const summarizeColdPayload = globalThis.__summarizeColdPayload;
    const buildUsersIndexFromMetrics = globalThis.__buildUsersIndexFromMetrics;
    ${saveMetricsSource}
    globalThis.__saveMetrics = saveMetrics;
    globalThis.__readState = () => ({ usersIndex, lastMetricsUpdatedAt });
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-saveMetrics-harness.js' });

  return {
    calls,
    saveMetrics: context.__saveMetrics,
    readState: context.__readState,
  };
}

test('saveMetrics keeps in-memory snapshots intact while persisting hot metrics as latest-only', async () => {
  const harness = buildHarness({ snapshotsHydrated: true });
  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        posts: {
          p1: {
            url: 'https://sora.chatgpt.com/p/p1',
            snapshots: [
              { t: 1000, likes: 1 },
              { t: 2000, likes: 2 },
            ],
          },
        },
      },
    },
  };

  await harness.saveMetrics(metrics, { userKeys: ['h:alice'] });

  assert.equal(harness.calls.set.length, 1);
  const payload = harness.calls.set[0];

  assert.deepEqual(metrics.users['h:alice'].posts.p1.snapshots.map((s) => s.t), [1000, 2000]);
  assert.deepEqual(payload.metrics.users['h:alice'].posts.p1.snapshots.map((s) => s.t), [2000]);
  assert.deepEqual(payload[`${COLD_PREFIX}h:alice`].p1.map((s) => s.t), [1000, 2000]);
  assert.ok(Number.isFinite(payload.metricsUpdatedAt) && payload.metricsUpdatedAt > 0);

  const state = harness.readState();
  assert.ok(Number.isFinite(state.lastMetricsUpdatedAt) && state.lastMetricsUpdatedAt > 0);
  assert.equal(Array.isArray(state.usersIndex), true);
  assert.equal(state.usersIndex.length, 1);
});

test('saveMetrics merges existing cold snapshots before hydration to avoid dropping history', async () => {
  const harness = buildHarness({
    snapshotsHydrated: false,
    existingCold: {
      [`${COLD_PREFIX}h:alice`]: {
        p1: [
          { t: 1000, likes: 1 },
          { t: 1500, likes: 2 },
        ],
      },
    },
  });

  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        posts: {
          p1: {
            snapshots: [{ t: 2000, likes: 3 }],
          },
        },
      },
    },
  };

  await harness.saveMetrics(metrics, { userKeys: ['h:alice'] });

  assert.equal(harness.calls.get.length, 1);
  assert.deepEqual(harness.calls.get[0], [`${COLD_PREFIX}h:alice`]);
  assert.equal(harness.calls.set.length, 1);

  const payload = harness.calls.set[0];
  assert.deepEqual(payload[`${COLD_PREFIX}h:alice`].p1.map((s) => s.t), [1000, 1500, 2000]);
  assert.deepEqual(payload.metrics.users['h:alice'].posts.p1.snapshots.map((s) => s.t), [2000]);
  assert.deepEqual(metrics.users['h:alice'].posts.p1.snapshots.map((s) => s.t), [2000]);
});
