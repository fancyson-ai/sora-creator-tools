const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

test('inject defines the activity docking helper before control visibility logic', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const dockingHelperStart = src.indexOf('  function syncActivityButtonDocking(bar, shouldDock) {');
  assert.notEqual(dockingHelperStart, -1, 'inject activity docking helper not found');
  const visibilityStart = src.indexOf('  function updateControlsVisibility() {');
  assert.notEqual(visibilityStart, -1, 'inject visibility snippet start not found');
  assert.ok(dockingHelperStart < visibilityStart, 'activity docking helper must be defined before updateControlsVisibility');
});

function buildControlVisibilityHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const helperStart = src.indexOf('  const normalizeId = (s) => s?.toString().split(/[?#]/)[0].trim();');
  assert.notEqual(helperStart, -1, 'inject route helper snippet start not found');
  const helperEnd = src.indexOf('  function currentSIdFromURL() {', helperStart);
  assert.notEqual(helperEnd, -1, 'inject route helper snippet end not found');
  const helperSnippet = src.slice(helperStart, helperEnd);

  const visibilityStart = src.indexOf('  function updateControlsVisibility() {');
  assert.notEqual(visibilityStart, -1, 'inject visibility snippet start not found');
  const visibilityEnd = src.indexOf('  function onRouteChange() {', visibilityStart);
  assert.notEqual(visibilityEnd, -1, 'inject visibility snippet end not found');
  const visibilitySnippet = src.slice(visibilityStart, visibilityEnd);

  const context = {
    URL,
  };

  const bootstrap = `
    const location = {
      pathname: '/explore',
      search: '',
      href: 'https://sora.chatgpt.com/explore',
    };
    let analyzeActive = false;
    let analyzeBtn = { style: {} };
    let bookmarksBtn = { style: {} };
    let isGatheringActiveThisTab = false;
    let gatherState = { filterIndex: 0, isGathering: false };
    let syncCalls = [];
    let currentBar = null;

    function syncActivityButtonDocking(bar, active) {
      syncCalls.push({ bar, active });
    }
    function getGatherState() {
      return gatherState;
    }
    function setGatherState(next) {
      gatherState = next;
    }
    function makeBar() {
      const filterContainer = { style: {} };
      const gatherBtn = { style: {} };
      const gatherControlsWrapper = { style: {} };
      const sliderContainer = { style: {} };
      const filterDropdown = { querySelector() { return null; } };
      const filterBtn = {
        closest(selector) {
          return selector === '.sora-uv-filter-container' ? filterContainer : null;
        },
      };
      return {
        style: {},
        _parts: { filterContainer, gatherBtn, gatherControlsWrapper, sliderContainer, filterDropdown, filterBtn },
        querySelector(selector) {
          if (selector === '[data-role="filter-btn"]') return filterBtn;
          if (selector === '.sora-uv-gather-btn') return gatherBtn;
          if (selector === '.sora-uv-gather-controls-wrapper') return gatherControlsWrapper;
          if (selector === '.sora-uv-slider-container') return sliderContainer;
          if (selector === '.sora-uv-filter-dropdown') return filterDropdown;
          return null;
        },
        updateFilterLabel() {},
        updateBarPosition() {},
        updateGatherState() {},
      };
    }
    function ensureControlBar() {
      if (!currentBar) currentBar = makeBar();
      return currentBar;
    }

    ${helperSnippet}
    ${visibilitySnippet}

    function reset(pathname = '/explore') {
      location.pathname = pathname;
      location.search = '';
      location.href = 'https://sora.chatgpt.com' + pathname;
      analyzeActive = false;
      analyzeBtn = { style: {} };
      bookmarksBtn = { style: {} };
      isGatheringActiveThisTab = false;
      gatherState = { filterIndex: 0, isGathering: false };
      syncCalls = [];
      currentBar = makeBar();
    }

    globalThis.__controlVisibilityApi = {
      reset,
      isDraftEditor,
      isFilterHiddenPage,
      updateControlsVisibility,
      getBar: () => currentBar,
      getSyncCalls: () => syncCalls.slice(),
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-control-visibility-harness.js' });
  return context.__controlVisibilityApi;
}

test('draft editor routes are treated as filter-hidden pages', () => {
  const api = buildControlVisibilityHarness();

  api.reset('/de/gen_abc123');
  assert.equal(api.isDraftEditor(), true);
  assert.equal(api.isFilterHiddenPage(), true);

  api.reset('/explore');
  assert.equal(api.isDraftEditor(), false);
  assert.equal(api.isFilterHiddenPage(), false);
});

test('updateControlsVisibility hides the custom control bar on draft editor routes', () => {
  const api = buildControlVisibilityHarness();

  api.reset('/de/gen_abc123');
  api.updateControlsVisibility();

  assert.equal(api.getBar().style.display, 'none');
  const syncCalls = api.getSyncCalls();
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].active, false);
});
