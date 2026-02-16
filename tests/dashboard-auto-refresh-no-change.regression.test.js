const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractAutoRefreshNoChangeSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function evaluateAutoRefreshNoChange(opts = {}){');
  assert.notEqual(start, -1, 'auto refresh no-change snippet start not found');
  const end = src.indexOf('async function getMetricsUpdatedAt(){', start);
  assert.notEqual(end, -1, 'auto refresh no-change snippet end not found');
  return src.slice(start, end);
}

function buildHarness() {
  const snippet = extractAutoRefreshNoChangeSnippet();
  const context = {};
  const bootstrap = `
    ${snippet}
    globalThis.__evaluateAutoRefreshNoChange = evaluateAutoRefreshNoChange;
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-auto-refresh-no-change-harness.js' });
  return {
    evaluateAutoRefreshNoChange: context.__evaluateAutoRefreshNoChange,
  };
}

test('evaluateAutoRefreshNoChange skips when no-change signal exists under the streak cap', () => {
  const { evaluateAutoRefreshNoChange } = buildHarness();
  const out = evaluateAutoRefreshNoChange({
    isMetricsPartial: false,
    nextUpdatedAt: 1234,
    lastMetricsUpdatedAt: 1234,
    skipStreak: 1,
    maxSkipStreak: 2,
  });
  assert.equal(out.shouldSkip, true);
  assert.equal(out.noChangeSignal, true);
  assert.equal(out.nextSkipStreak, 2);
  assert.equal(out.reason, 'no_change');
});

test('evaluateAutoRefreshNoChange forces a refresh when skip streak cap is reached', () => {
  const { evaluateAutoRefreshNoChange } = buildHarness();
  const out = evaluateAutoRefreshNoChange({
    isMetricsPartial: false,
    nextUpdatedAt: 1234,
    lastMetricsUpdatedAt: 1234,
    skipStreak: 2,
    maxSkipStreak: 2,
  });
  assert.equal(out.shouldSkip, false);
  assert.equal(out.noChangeSignal, true);
  assert.equal(out.nextSkipStreak, 0);
  assert.equal(out.reason, 'skip_streak_limit_reached');
});

test('evaluateAutoRefreshNoChange does not skip when no-change signal is absent', () => {
  const { evaluateAutoRefreshNoChange } = buildHarness();
  const out = evaluateAutoRefreshNoChange({
    isMetricsPartial: false,
    nextUpdatedAt: 2000,
    lastMetricsUpdatedAt: 1000,
    skipStreak: 2,
    maxSkipStreak: 2,
  });
  assert.equal(out.shouldSkip, false);
  assert.equal(out.noChangeSignal, false);
  assert.equal(out.nextSkipStreak, 0);
  assert.equal(out.reason, 'changed_or_unknown');
});
