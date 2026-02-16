const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractSnapshotTimelineSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function summarizeUserSnapshotTimeline(user){');
  assert.notEqual(start, -1, 'snapshot timeline snippet start not found');
  const end = src.indexOf('function summarizeMetricsSnapshots(inputMetrics){', start);
  assert.notEqual(end, -1, 'snapshot timeline snippet end not found');
  return src.slice(start, end);
}

function buildHarness() {
  const snippet = extractSnapshotTimelineSnippet();
  const context = { Date };
  const bootstrap = `
    ${snippet}
    globalThis.__summarizeUserSnapshotTimeline = summarizeUserSnapshotTimeline;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-snapshot-timeline-harness.js' });
  return {
    summarizeUserSnapshotTimeline: context.__summarizeUserSnapshotTimeline,
  };
}

test('summarizeUserSnapshotTimeline reports zero defaults for missing snapshots', () => {
  const { summarizeUserSnapshotTimeline } = buildHarness();
  const out = summarizeUserSnapshotTimeline({ posts: { p1: { snapshots: [] } } });
  assert.equal(out.postCount, 1);
  assert.equal(out.snapshotCount, 0);
  assert.equal(out.minT, 0);
  assert.equal(out.maxT, 0);
  assert.equal(out.minTISO, null);
  assert.equal(out.maxTISO, null);
  assert.equal(out.maxAgeMs, null);
});

test('summarizeUserSnapshotTimeline computes min/max timestamps and ignores invalid entries', () => {
  const { summarizeUserSnapshotTimeline } = buildHarness();
  const out = summarizeUserSnapshotTimeline({
    posts: {
      p1: { snapshots: [{ t: 2000 }, { t: 3000 }, { t: 'x' }] },
      p2: { snapshots: [{ t: 1500 }, { t: 0 }, { t: -10 }] },
      p3: { snapshots: [{ t: 2500 }] },
    },
  });
  assert.equal(out.postCount, 3);
  assert.equal(out.snapshotCount, 4);
  assert.equal(out.minT, 1500);
  assert.equal(out.maxT, 3000);
  assert.equal(out.minTISO, '1970-01-01T00:00:01.500Z');
  assert.equal(out.maxTISO, '1970-01-01T00:00:03.000Z');
  assert.equal(typeof out.maxAgeMs, 'number');
  assert.ok(out.maxAgeMs >= 0);
});
