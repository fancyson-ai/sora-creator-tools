const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function extractFilterSessionSnippet() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf('function normalizeFilterAction(action){');
  assert.notEqual(start, -1, 'filter session snippet start not found');
  const end = src.indexOf("let currentVisibilitySource = 'showAll';", start);
  assert.notEqual(end, -1, 'filter session snippet end not found');
  return src.slice(start, end);
}

function buildFilterSessionHarness() {
  const snippet = extractFilterSessionSnippet();
  const context = {};
  const bootstrap = `
    const PRESET_VISIBILITY_ACTIONS = new Set(['pastDay','pastWeek','last5','last10','top5','top10','bottom5','bottom10','stale']);
    function isPresetVisibilitySource(source){
      return PRESET_VISIBILITY_ACTIONS.has(source);
    }
    function isCustomFilterAction(action){
      return typeof action === 'string' && action.startsWith('cf:');
    }
    let currentUserKey = 'id:user-1';
    let lastFilterAction = null;
    let lastFilterActionByUser = {};
    const sessionStorage = {
      setItem(){},
      getItem(){ return null; },
      removeItem(){},
    };
    const localStorage = {
      setItem(){},
      getItem(){ return null; },
      removeItem(){},
    };
    const chrome = {
      storage: {
        local: {
          set(){},
        }
      }
    };
    ${snippet}
    globalThis.__getSessionFilterAction = getSessionFilterAction;
    globalThis.__setLastFilterAction = setLastFilterAction;
    globalThis.__setState = (next) => {
      if (Object.prototype.hasOwnProperty.call(next, 'currentUserKey')) currentUserKey = next.currentUserKey;
      if (Object.prototype.hasOwnProperty.call(next, 'lastFilterAction')) lastFilterAction = next.lastFilterAction;
      if (Object.prototype.hasOwnProperty.call(next, 'lastFilterActionByUser')) lastFilterActionByUser = next.lastFilterActionByUser;
    };
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-filter-session-harness.js' });
  return {
    getSessionFilterAction: context.__getSessionFilterAction,
    setLastFilterAction: context.__setLastFilterAction,
    setState: context.__setState,
  };
}

test('getSessionFilterAction restores persisted preset actions', () => {
  const { getSessionFilterAction, setState } = buildFilterSessionHarness();
  setState({
    currentUserKey: 'id:user-1',
    lastFilterAction: 'last10',
    lastFilterActionByUser: { 'id:user-1': 'last10' },
  });
  assert.equal(getSessionFilterAction('id:user-1'), 'last10');
});

test('getSessionFilterAction preserves persisted non-preset actions', () => {
  const { getSessionFilterAction, setState } = buildFilterSessionHarness();
  setState({
    currentUserKey: 'id:user-1',
    lastFilterAction: 'showAll',
    lastFilterActionByUser: { 'id:user-1': 'hideAll' },
  });
  assert.equal(getSessionFilterAction('id:user-1'), 'hideAll');
});

test('getSessionFilterAction preserves persisted custom filter action', () => {
  const { getSessionFilterAction, setState } = buildFilterSessionHarness();
  setState({
    currentUserKey: 'id:user-1',
    lastFilterAction: 'showAll',
    lastFilterActionByUser: { 'id:user-1': 'cf:abc123' },
  });
  assert.equal(getSessionFilterAction('id:user-1'), 'cf:abc123');
});
