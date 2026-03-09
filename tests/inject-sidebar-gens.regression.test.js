const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function buildSidebarGensHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf('  function parseStoredVideoGensBalance(raw) {');
  assert.notEqual(start, -1, 'sidebar gens helper snippet start not found');
  const end = src.indexOf('  function scheduleInjectDashboardButton() {', start);
  assert.notEqual(end, -1, 'sidebar gens helper snippet end not found');
  const snippet = src.slice(start, end);

  const context = {
    Intl,
  };

  const bootstrap = `
    const VIDEO_GENS_BALANCE_KEY = 'SCT_VIDEO_GENS_BALANCE_V1';
    let storedRaw = null;
    let sidebarGensCounterEl = null;
    const localStorage = {
      getItem(key) {
        return key === VIDEO_GENS_BALANCE_KEY ? storedRaw : null;
      },
    };
    const document = {
      contains(node) {
        return node === sidebarGensCounterEl;
      },
      querySelector() {
        return null;
      },
    };

    ${snippet}

    globalThis.__sidebarGensApi = {
      parseStoredVideoGensBalance,
      readStoredVideoGensBalance,
      formatSidebarGensCount,
      formatSidebarGensResetTooltip,
      updateSidebarGensCounter,
      setStoredRaw(value) {
        storedRaw = value;
      },
      setCounterEl(value) {
        sidebarGensCounterEl = value;
      },
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-sidebar-gens-harness.js' });
  return context.__sidebarGensApi;
}

function createCounterEl() {
  return {
    hidden: false,
    textContent: '',
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  };
}

test('sidebar gens helpers parse stored balance and format count/reset tooltip', () => {
  const api = buildSidebarGensHarness();

  api.setStoredRaw(JSON.stringify({ count: 12345, resetsInSeconds: 3661 }));

  const parsed = api.readStoredVideoGensBalance();
  assert.equal(parsed.count, 12345);
  assert.equal(parsed.resetsInSeconds, 3661);
  assert.equal(api.formatSidebarGensCount(parsed.count), '12,345');
  assert.equal(api.formatSidebarGensResetTooltip(parsed.resetsInSeconds), 'Resets in 1h 2m');
});

test('updateSidebarGensCounter applies text and hover tooltip to the sidebar node', () => {
  const api = buildSidebarGensHarness();
  const counterEl = createCounterEl();
  api.setCounterEl(counterEl);

  const updated = api.updateSidebarGensCounter({ count: 42, resetsInSeconds: 5400 });

  assert.equal(updated, true);
  assert.equal(counterEl.hidden, false);
  assert.equal(counterEl.textContent, '42');
  assert.equal(counterEl.attrs['data-tooltip'], 'Resets in 1h 30m');
  assert.equal(counterEl.attrs['aria-label'], '42 video gens remaining. Resets in 1h 30m.');
});
