const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

test('updateCompareCharts hydrates full snapshots for all compared users', () => {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('async function updateCompareCharts(){');
  assert.notEqual(start, -1, 'updateCompareCharts not found');
  const snippet = src.slice(start, start + 1200);
  assert.match(snippet, /await ensureFullSnapshots\(\{\s*userKeys\s*\}\);/);
});
