const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractCumulativeSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function summarizeSeries(series){');
  assert.notEqual(start, -1, 'cumulative snippet start not found');
  const end = src.indexOf('function snapLog(event, details = {}){', start);
  assert.notEqual(end, -1, 'cumulative snippet end not found');
  return src.slice(start, end);
}

function buildHarness() {
  const snippet = extractCumulativeSnippet();
  const context = {};
  const bootstrap = `
    ${snippet}
    globalThis.__buildCumulativeSeriesPoints = buildCumulativeSeriesPoints;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-cumulative-series-harness.js' });
  return {
    buildCumulativeSeriesPoints: context.__buildCumulativeSeriesPoints,
  };
}

test('buildCumulativeSeriesPoints includes only changed snapshots by default', () => {
  const { buildCumulativeSeriesPoints } = buildHarness();
  const posts = {
    p1: { snapshots: [{ t: 1, views: 10 }, { t: 2, views: 10 }, { t: 3, views: 12 }] },
    p2: { snapshots: [{ t: 1, views: 5 }, { t: 3, views: 7 }] },
  };
  const out = buildCumulativeSeriesPoints(posts, (s) => s.views);
  assert.equal(out.eventCount, 5);
  assert.equal(out.points.length, 4);
  assert.equal(out.skippedNoChange, 1);
  assert.deepEqual(Array.from(out.points.map((p) => p.y)), [10, 15, 17, 19]);
});

test('buildCumulativeSeriesPoints can include unchanged snapshots', () => {
  const { buildCumulativeSeriesPoints } = buildHarness();
  const posts = {
    p1: { snapshots: [{ t: 1, likes: 1 }, { t: 2, likes: 1 }, { t: 3, likes: 2 }] },
  };
  const out = buildCumulativeSeriesPoints(posts, (s) => s.likes, { includeUnchanged: true });
  assert.equal(out.eventCount, 3);
  assert.equal(out.points.length, 3);
  assert.deepEqual(Array.from(out.points.map((p) => p.y)), [1, 1, 2]);
});
