const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');
const DASHBOARD_SRC = fs.readFileSync(DASHBOARD_PATH, 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = DASHBOARD_SRC.indexOf(startMarker);
  assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
  const end = DASHBOARD_SRC.indexOf(endMarker, start);
  assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
  return DASHBOARD_SRC.slice(start, end);
}

function extractConstString(name) {
  const match = DASHBOARD_SRC.match(new RegExp(`const ${name} = '([^']+)';`));
  assert.ok(match, `constant not found: ${name}`);
  return match[1];
}

function buildPreferenceHarness() {
  const storageKey = extractConstString('DASHBOARD_DISCOVERY_PHRASE_STORAGE_KEY');
  const snippet = extractBetween('async function loadDiscoveryPhrasePreference(){', 'function num(v){');
  const state = {
    storedValue: undefined,
    setCalls: [],
  };
  const context = {
    __state: state,
  };
  const bootstrap = `
    const DASHBOARD_DISCOVERY_PHRASE_STORAGE_KEY = ${JSON.stringify(storageKey)};
    const chrome = {
      storage: {
        local: {
          async get(key) {
            const state = globalThis.__state;
            if (state.storedValue === undefined) return {};
            return { [key]: state.storedValue };
          },
          async set(payload) {
            globalThis.__state.setCalls.push(payload);
            globalThis.__state.storedValue = payload[DASHBOARD_DISCOVERY_PHRASE_STORAGE_KEY];
          }
        }
      }
    };
    ${snippet}
    globalThis.__loadDiscoveryPhrasePreference = loadDiscoveryPhrasePreference;
    globalThis.__saveDiscoveryPhrasePreference = saveDiscoveryPhrasePreference;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-discovery-pref-harness.js' });
  return {
    state,
    loadDiscoveryPhrasePreference: context.__loadDiscoveryPhrasePreference,
    saveDiscoveryPhrasePreference: context.__saveDiscoveryPhrasePreference,
    storageKey,
  };
}

function buildLineHarness() {
  const snippet = extractBetween('function normalizeDiscoveryPhrase(value) {', 'function truncateForPurgeCaption(text){');
  const context = {};
  const bootstrap = `
    ${snippet}
    globalThis.__normalizeDiscoveryPhrase = normalizeDiscoveryPhrase;
    globalThis.__buildDiscoveryPhraseLine = buildDiscoveryPhraseLine;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-discovery-line-harness.js' });
  return {
    normalizeDiscoveryPhrase: context.__normalizeDiscoveryPhrase,
    buildDiscoveryPhraseLine: context.__buildDiscoveryPhraseLine,
  };
}

function latestSnapshot(snaps) {
  if (!Array.isArray(snaps) || snaps.length === 0) return null;
  return snaps[snaps.length - 1] || null;
}

function getPostTimeStrict(post) {
  return post?.post_time || null;
}

function interactionRate(snap) {
  const uv = Number(snap?.uv);
  if (!Number.isFinite(uv) || uv <= 0) return null;
  const likes = Number(snap?.likes) || 0;
  const comments = Number(snap?.comments ?? snap?.reply_count) || 0;
  return ((likes + comments) / uv) * 100;
}

function remixRate(likes, remixes) {
  const l = Number(likes);
  const r = Number(remixes);
  if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(r) || r < 0) return null;
  return ((r / l) * 100).toFixed(2);
}

function likeRate(likes, uv) {
  const l = Number(likes);
  const u = Number(uv);
  if (!Number.isFinite(l) || l < 0 || !Number.isFinite(u) || u <= 0) return null;
  return (l / u) * 100;
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

function computeTotalsForUser(user) {
  const totals = { views: 0, likes: 0, replies: 0, remixes: 0, interactions: 0 };
  for (const post of Object.values(user?.posts || {})) {
    const latest = latestSnapshot(post?.snapshots);
    if (!latest) continue;
    totals.views += Number(latest.views) || 0;
    totals.likes += Number(latest.likes) || 0;
    totals.replies += Number(latest.comments ?? latest.reply_count) || 0;
    totals.remixes += Number(latest.remix_count ?? latest.remixes) || 0;
  }
  totals.interactions = totals.likes + totals.replies;
  return totals;
}

function buildExportHarness(metricsFixture, opts = {}) {
  const snippet = extractBetween('function escapeCSV(str) {', '\n  // Parse CSV line handling quoted fields');
  const state = {
    blob: null,
    clickCount: 0,
    downloadName: null,
    revokedUrl: null,
    alerts: [],
    warnings: [],
  };
  const loadedMetricsFixture = opts.loadedMetricsFixture || metricsFixture;
  const hydratedMetricsFixture = opts.hydratedMetricsFixture || metricsFixture;
  const context = {
    __loadedMetricsFixture: loadedMetricsFixture,
    __hydratedMetricsFixture: hydratedMetricsFixture,
    __hydrationCompletes: opts.hydrationCompletes !== false,
    __snapshotDebugEnabled: !!opts.snapshotDebugEnabled,
    __throwOnAlert: opts.throwOnAlert !== false,
    __state: state,
    __latestSnapshot: latestSnapshot,
    __getPostTimeStrict: getPostTimeStrict,
    __interactionRate: interactionRate,
    __remixRate: remixRate,
    __likeRate: likeRate,
    __computeTotalsForUser: computeTotalsForUser,
    __toTs: toTs,
  };
  const bootstrap = `
    const SITE_ORIGIN = 'https://sora.chatgpt.com';
    const SNAP_DEBUG_ENABLED = !!globalThis.__snapshotDebugEnabled;
    let metrics = { users: {} };
    let snapshotsHydrated = false;
    let snapshotsHydratedForKey = null;
    let snapshotsHydrationEpoch = 1;
    let currentUserKey = 'h:test';
    const loadMetrics = async () => {
      metrics = globalThis.__loadedMetricsFixture;
      return metrics;
    };
    const ensureFullSnapshots = async () => {
      metrics = globalThis.__hydratedMetricsFixture;
      snapshotsHydrated = !!globalThis.__hydrationCompletes;
      snapshotsHydratedForKey = snapshotsHydrated ? 'users:h:test' : null;
    };
    const latestSnapshot = globalThis.__latestSnapshot;
    const getPostTimeStrict = globalThis.__getPostTimeStrict;
    const interactionRate = globalThis.__interactionRate;
    const remixRate = globalThis.__remixRate;
    const likeRate = globalThis.__likeRate;
    const computeTotalsForUser = globalThis.__computeTotalsForUser;
    const toTs = globalThis.__toTs;
    const alert = (message) => {
      globalThis.__state.alerts.push(message);
      if (globalThis.__throwOnAlert) throw new Error(message || 'unexpected alert during export');
    };
    const console = {
      warn(...args) {
        globalThis.__state.warnings.push(args);
      },
      log() {}
    };
    class Blob {
      constructor(parts, opts = {}) {
        this.parts = parts;
        this.type = opts.type || '';
      }
    }
    const URL = {
      createObjectURL(blob) {
        globalThis.__state.blob = blob;
        return 'blob:test';
      },
      revokeObjectURL(url) {
        globalThis.__state.revokedUrl = url;
      }
    };
    const document = {
      body: {
        appendChild() {},
        removeChild() {}
      },
      createElement(tag) {
        if (tag !== 'a') return {};
        return {
          href: '',
          download: '',
          click() {
            globalThis.__state.clickCount += 1;
            globalThis.__state.downloadName = this.download;
          }
        };
      }
    };
    const setTimeout = (fn) => { fn(); return 1; };
    ${snippet}
    globalThis.__exportAllDataCSV = exportAllDataCSV;
    globalThis.__exportRawBackupJSON = exportRawBackupJSON;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-discovery-export-harness.js' });
  return {
    state,
    exportAllDataCSV: context.__exportAllDataCSV,
    exportRawBackupJSON: context.__exportRawBackupJSON,
  };
}

function buildImportHarness() {
  const snapshotMergeHelpers = extractBetween('function mergeSnapshotPoint(existing, incoming){', '\n  // Strict post time lookup: only consider explicit post time fields; everything else sorts last');
  const snippet = extractBetween('function parseCSVLine(line) {', '\n  async function main(prefetchedCache){');
  const context = {
    __toTs: toTs,
  };
  const bootstrap = `
    const SITE_ORIGIN = 'https://sora.chatgpt.com';
    const SNAP_DEBUG_ENABLED = false;
    const toTs = globalThis.__toTs;
    ${snapshotMergeHelpers}
    ${snippet}
    globalThis.__importDataCSVText = importDataCSVText;
    globalThis.__importDataText = importDataText;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-discovery-import-harness.js' });
  return {
    importDataCSVText: context.__importDataCSVText,
    importDataText: context.__importDataText,
  };
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test('dashboard discovery phrase preference defaults to true and saves to the dashboard-specific key', async () => {
  const harness = buildPreferenceHarness();

  assert.equal(await harness.loadDiscoveryPhrasePreference(), true);

  await harness.saveDiscoveryPhrasePreference(false);
  assert.equal(harness.state.setCalls.length, 1);
  assert.equal(harness.state.setCalls[0][harness.storageKey], false);
  assert.equal(await harness.loadDiscoveryPhrasePreference(), false);
});

test('buildDiscoveryPhraseLine normalizes whitespace and returns empty for missing phrases', () => {
  const { normalizeDiscoveryPhrase, buildDiscoveryPhraseLine } = buildLineHarness();

  assert.equal(normalizeDiscoveryPhrase('  delft   pottery \n organ   pug  '), 'delft pottery organ pug');
  assert.equal(buildDiscoveryPhraseLine({ discovery_phrase: '  delft   pottery \n organ   pug  ' }), 'delft pottery organ pug');
  assert.equal(buildDiscoveryPhraseLine({ discovery_phrase: '   ' }), '');
  assert.equal(buildDiscoveryPhraseLine({}), '');
});

test('exportAllDataCSV includes discovery phrase columns and values', async () => {
  const metricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            post_time: 1773541644483,
            snapshots: [
              { t: 1773541932509, uv: 27, views: 37, likes: 9, comments: 1, remix_count: 0 }
            ]
          }
        },
        followers: [],
        cameos: []
      }
    }
  };

  const harness = buildExportHarness(metricsFixture);
  await harness.exportAllDataCSV();

  assert.equal(harness.state.clickCount, 1);
  assert.ok(harness.state.blob, 'expected blob to be created');

  const csv = harness.state.blob.parts.join('');
  assert.match(csv, /Discovery Phrase/);
  assert.match(csv, /Post Discovery Phrase/);
  assert.match(csv, /delft pottery organ pug/);
});

test('exportRawBackupJSON preserves hydrated metrics fields beyond the reporting CSV schema', async () => {
  const metricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        followers: [{ t: 1773541000000, count: 321 }],
        cameos: [{ t: 1773541000000, count: 12 }],
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            thumb: 'https://videos.example/thumb.jpg',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            cameo_usernames: ['bob', 'carol'],
            duration: 12.5,
            width: 1920,
            height: 1080,
            post_time: 1773541644483,
            snapshots: [
              { t: 1773541932509, uv: 27, views: 37, likes: 9, comments: 1, remix_count: 0, duration: 12.5, width: 1920, height: 1080 },
              { t: 1773542932509, uv: 29, views: 41, likes: 11, comments: 2, remix_count: 1, duration: 12.5, width: 1920, height: 1080 }
            ]
          }
        }
      }
    }
  };

  const harness = buildExportHarness(metricsFixture);
  await harness.exportRawBackupJSON();

  assert.equal(harness.state.clickCount, 1);
  assert.equal(harness.state.downloadName.endsWith('.json'), true);
  assert.equal(harness.state.downloadName.startsWith('sora_full_backup_with_snapshots_'), true);
  assert.equal(harness.state.blob.type, 'application/json;charset=utf-8;');

  const payload = JSON.parse(harness.state.blob.parts.join(''));
  assert.equal(payload.format, 'sora-creator-tools/raw-backup-v1');
  assert.equal(payload.snapshotsHydrated, true);
  assert.deepEqual(payload.metrics.users['h:alice'].posts['s_123'].cameo_usernames, ['bob', 'carol']);
  assert.equal(payload.metrics.users['h:alice'].posts['s_123'].duration, 12.5);
  assert.equal(payload.metrics.users['h:alice'].posts['s_123'].width, 1920);
  assert.equal(payload.metrics.users['h:alice'].posts['s_123'].height, 1080);
  assert.deepEqual(
    payload.metrics.users['h:alice'].posts['s_123'].snapshots.map((snap) => snap.t),
    [1773541932509, 1773542932509]
  );
});

test('exportRawBackupJSON warns and aborts when snapshot hydration does not complete', async () => {
  const metricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            post_time: 1773541644483,
            snapshots: [
              { t: 1773541932509, uv: 27, views: 37, likes: 9, comments: 1, remix_count: 0 }
            ]
          }
        }
      }
    }
  };

  const harness = buildExportHarness(metricsFixture, { hydrationCompletes: false, throwOnAlert: false });
  await harness.exportRawBackupJSON();

  assert.equal(harness.state.clickCount, 0);
  assert.equal(harness.state.blob, null);
  assert.equal(harness.state.alerts.length, 1);
  assert.match(harness.state.alerts[0], /hydration did not complete/i);
  assert.equal(harness.state.warnings.length, 0);
});

test('exports use hydrated metrics after ensureFullSnapshots adds historical snapshots', async () => {
  const loadedMetricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            post_time: 1773541644483,
            snapshots: [
              { t: 1773542932509, uv: 29, views: 41, likes: 11, comments: 2, remix_count: 1 }
            ]
          }
        }
      }
    }
  };
  const hydratedMetricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            post_time: 1773541644483,
            snapshots: [
              { t: 1773541932509, uv: 27, views: 37, likes: 9, comments: 1, remix_count: 0 },
              { t: 1773542932509, uv: 29, views: 41, likes: 11, comments: 2, remix_count: 1 }
            ]
          }
        }
      }
    }
  };

  const rawHarness = buildExportHarness(hydratedMetricsFixture, { loadedMetricsFixture, hydratedMetricsFixture });
  await rawHarness.exportRawBackupJSON();
  const rawPayload = JSON.parse(rawHarness.state.blob.parts.join(''));
  assert.deepEqual(
    rawPayload.metrics.users['h:alice'].posts['s_123'].snapshots.map((snap) => snap.t),
    [1773541932509, 1773542932509]
  );

  const csvHarness = buildExportHarness(hydratedMetricsFixture, { loadedMetricsFixture, hydratedMetricsFixture });
  await csvHarness.exportAllDataCSV();
  const csvText = csvHarness.state.blob.parts.join('');
  const firstSnapshotIso = new Date(1773541932509).toISOString();
  const lastSnapshotIso = new Date(1773542932509).toISOString();
  assert.equal(csvText.includes(`,2,${firstSnapshotIso},${lastSnapshotIso}`), true);
});

test('raw backup JSON survives export/import round-trip through dashboard backup format', async () => {
  const metricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        followers: [{ t: 1773541000000, count: 321 }],
        cameos: [{ t: 1773541000000, count: 12 }],
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            cameo_usernames: ['bob', 'carol'],
            duration: 12.5,
            width: 1920,
            height: 1080,
            post_time: 1773541644483,
            snapshots: [
              { t: 1773541932509, uv: 27, views: 37, likes: 9, comments: 1, remix_count: 0, duration: 12.5, width: 1920, height: 1080 },
              { t: 1773542932509, uv: 29, views: 41, likes: 11, comments: 2, remix_count: 1, duration: 12.5, width: 1920, height: 1080 }
            ]
          }
        }
      }
    }
  };

  const exportHarness = buildExportHarness(metricsFixture);
  await exportHarness.exportRawBackupJSON();
  const json = exportHarness.state.blob.parts.join('');

  const importHarness = buildImportHarness();
  const importedMetrics = { users: {} };
  const stats = {
    postsAdded: 0,
    postsUpdated: 0,
    snapshotsAdded: 0,
    snapshotsSkipped: 0,
    followersAdded: 0,
    followersSkipped: 0,
    cameosAdded: 0,
    cameosSkipped: 0,
    usersAdded: 0,
    usersUpdated: 0,
  };

  const didImport = await importHarness.importDataText(json, importedMetrics, stats);
  assert.equal(didImport, true);
  assert.deepEqual(toPlainJson(importedMetrics.users['h:alice'].posts['s_123'].cameo_usernames), ['bob', 'carol']);
  assert.equal(importedMetrics.users['h:alice'].posts['s_123'].duration, 12.5);
  assert.equal(importedMetrics.users['h:alice'].posts['s_123'].width, 1920);
  assert.equal(importedMetrics.users['h:alice'].posts['s_123'].height, 1080);
  assert.deepEqual(
    toPlainJson(importedMetrics.users['h:alice'].posts['s_123'].snapshots.map((snap) => snap.t)),
    [1773541932509, 1773542932509]
  );
  assert.deepEqual(toPlainJson(importedMetrics.users['h:alice'].followers), [{ t: 1773541000000, count: 321 }]);
  assert.deepEqual(toPlainJson(importedMetrics.users['h:alice'].cameos), [{ t: 1773541000000, count: 12 }]);
});

test('raw backup JSON import merges alias user buckets into one identity', async () => {
  const importHarness = buildImportHarness();
  const importedBackup = JSON.stringify({
    format: 'sora-creator-tools/raw-backup-v1',
    metrics: {
      users: {
        'id:user-1': {
          handle: 'alice',
          id: 'user-1',
          followers: [{ t: 1773543000000, count: 100 }],
          cameos: [{ t: 1773543000000, count: 5 }],
          posts: {
            's_backup': {
              url: 'https://sora.chatgpt.com/p/s_backup',
              caption: 'Backup Post',
              discovery_phrase: 'backup phrase',
              post_time: 1773543000000,
              snapshots: [
                { t: 1773543600000, uv: 10, views: 20, likes: 3, comments: 1, remix_count: 0 }
              ]
            }
          }
        }
      }
    }
  });
  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        followers: [{ t: 1773541000000, count: 90 }],
        cameos: [],
        posts: {
          's_handle': {
            url: 'https://sora.chatgpt.com/p/s_handle',
            caption: 'Handle Post',
            discovery_phrase: 'handle phrase',
            post_time: 1773541000000,
            snapshots: [
              { t: 1773541600000, uv: 5, views: 8, likes: 1, comments: 0, remix_count: 0 }
            ]
          }
        }
      },
      'id:user-1': {
        handle: 'alice',
        id: 'user-1',
        followers: [{ t: 1773542000000, count: 95 }],
        cameos: [{ t: 1773542000000, count: 2 }],
        posts: {
          's_id': {
            url: 'https://sora.chatgpt.com/p/s_id',
            caption: 'ID Post',
            discovery_phrase: 'id phrase',
            post_time: 1773542000000,
            snapshots: [
              { t: 1773542600000, uv: 7, views: 12, likes: 2, comments: 1, remix_count: 0 }
            ]
          }
        }
      }
    }
  };
  const stats = {
    postsAdded: 0,
    postsUpdated: 0,
    snapshotsAdded: 0,
    snapshotsSkipped: 0,
    followersAdded: 0,
    followersSkipped: 0,
    cameosAdded: 0,
    cameosSkipped: 0,
    usersAdded: 0,
    usersUpdated: 0,
  };

  const didImport = await importHarness.importDataText(importedBackup, metrics, stats);
  assert.equal(didImport, true);
  assert.deepEqual(
    Object.keys(metrics.users).sort(),
    ['id:user-1']
  );
  assert.deepEqual(
    Object.keys(metrics.users['id:user-1'].posts).sort(),
    ['s_backup', 's_handle', 's_id']
  );
  assert.deepEqual(
    toPlainJson(metrics.users['id:user-1'].followers),
    [
      { t: 1773541000000, count: 90 },
      { t: 1773542000000, count: 95 },
      { t: 1773543000000, count: 100 }
    ]
  );
  assert.deepEqual(
    toPlainJson(metrics.users['id:user-1'].cameos),
    [
      { t: 1773542000000, count: 2 },
      { t: 1773543000000, count: 5 }
    ]
  );
});

test('discovery phrases survive export/import round-trip through dashboard CSV', async () => {
  const metricsFixture = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            caption: 'Delft Pug',
            discovery_phrase: 'delft pottery organ pug',
            post_time: 1773541644483,
            snapshots: [
              { t: 1773541932509, uv: 27, views: 37, likes: 9, comments: 1, remix_count: 0 }
            ]
          }
        },
        followers: [],
        cameos: []
      }
    }
  };

  const exportHarness = buildExportHarness(metricsFixture);
  await exportHarness.exportAllDataCSV();
  const csv = exportHarness.state.blob.parts.join('');

  const importHarness = buildImportHarness();
  const importedMetrics = { users: {} };
  const stats = {
    postsAdded: 0,
    postsUpdated: 0,
    snapshotsAdded: 0,
    snapshotsSkipped: 0,
    followersAdded: 0,
    followersSkipped: 0,
    cameosAdded: 0,
    cameosSkipped: 0,
    usersAdded: 0,
    usersUpdated: 0,
  };

  const didImport = await importHarness.importDataCSVText(csv, importedMetrics, stats);
  assert.equal(didImport, true);
  assert.equal(importedMetrics.users['h:alice'].posts['s_123'].discovery_phrase, 'delft pottery organ pug');
});

test('importDataCSVText does not overwrite an existing discovery phrase with a blank CSV field', async () => {
  const importHarness = buildImportHarness();
  const metrics = {
    users: {
      'h:alice': {
        handle: 'alice',
        id: 'user-1',
        posts: {
          's_123': {
            url: 'https://sora.chatgpt.com/p/s_123',
            discovery_phrase: 'keep existing phrase',
            snapshots: []
          }
        },
        followers: [],
        cameos: []
      }
    }
  };
  const stats = {
    postsAdded: 0,
    postsUpdated: 0,
    snapshotsAdded: 0,
    snapshotsSkipped: 0,
    followersAdded: 0,
    followersSkipped: 0,
    cameosAdded: 0,
    cameosSkipped: 0,
    usersAdded: 0,
    usersUpdated: 0,
  };
  const csv = [
    '=== POSTS SUMMARY (Latest Snapshot Per Post) ===',
    'User Key,User Handle,User ID,Post ID,Post URL,Post Time,Post Time (ISO),Caption,Discovery Phrase,Thumbnail URL,Parent Post ID,Root Post ID,Last Seen Timestamp,Owner Key,Owner Handle,Owner ID,Latest Snapshot Timestamp,Unique Views,Total Views,Likes,Comments,Remixes,Interaction Rate %,Remix Rate %,Like Rate %,Snapshot Count,First Snapshot Timestamp,Last Snapshot Timestamp',
    'h:alice,alice,user-1,s_123,https://sora.chatgpt.com/p/s_123,,,,,https://thumb.example/image.jpg,,,,h:alice,alice,user-1,2026-03-15T01:00:00.000Z,27,37,9,1,0,37.04,0,33.33,1,2026-03-15T01:00:00.000Z,2026-03-15T01:00:00.000Z'
  ].join('\n');

  const didImport = await importHarness.importDataCSVText(csv, metrics, stats);
  assert.equal(didImport, true);
  assert.equal(metrics.users['h:alice'].posts['s_123'].discovery_phrase, 'keep existing phrase');
});
