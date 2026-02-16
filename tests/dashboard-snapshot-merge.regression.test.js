const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

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

function extractSnapshotMergeHelpersSource() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf("const SNAPSHOT_NUMERIC_FIELDS = ['views', 'uv', 'likes', 'comments', 'remixes', 'remix_count', 'interactions', 'followers', 'count'];");
  assert.notEqual(start, -1, 'snapshot merge helper start not found in dashboard.js');
  const end = src.indexOf('\n  // Strict post time lookup: only consider explicit post time fields; everything else sorts last', start);
  assert.notEqual(end, -1, 'snapshot merge helper boundary not found in dashboard.js');
  return src.slice(start, end);
}

function buildHarness() {
  const helperSource = extractSnapshotMergeHelpersSource();
  const context = { __toTs: toTs };
  const bootstrap = `
    const toTs = globalThis.__toTs;
    ${helperSource}
    globalThis.__mergeSnapshotsByTimestamp = mergeSnapshotsByTimestamp;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-snapshot-merge-harness.js' });
  return {
    mergeSnapshotsByTimestamp: context.__mergeSnapshotsByTimestamp,
  };
}

test('mergeSnapshotsByTimestamp updates duplicate timestamps instead of dropping newer values', () => {
  const { mergeSnapshotsByTimestamp } = buildHarness();
  const existing = [{ t: 1700000000000, views: 10, likes: 2 }];
  const incoming = [{ t: 1700000000000, views: 25, likes: 7 }];
  const merged = mergeSnapshotsByTimestamp(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].t, 1700000000000);
  assert.equal(merged[0].views, 25);
  assert.equal(merged[0].likes, 7);
});

test('mergeSnapshotsByTimestamp normalizes second timestamps and keeps sorted order', () => {
  const { mergeSnapshotsByTimestamp } = buildHarness();
  const merged = mergeSnapshotsByTimestamp(
    [{ t: 1700000000000, views: 1 }],
    [{ t: 1700000010, views: 2 }, { t: 1700000005000, views: 3 }]
  );
  assert.deepEqual(Array.from(merged.map((s) => s.t)), [1700000000000, 1700000005000, 1700000010000]);
});
