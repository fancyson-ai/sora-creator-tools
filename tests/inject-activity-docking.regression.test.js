const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

class MockNode {
  constructor(name) {
    this.name = name;
    this.parentNode = null;
    this.children = [];
    this.style = {};
    this.isConnected = false;
    this._closestMap = new Map();
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    child.isConnected = this.isConnected;
    return child;
  }

  insertBefore(child, nextSibling) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = this.children.indexOf(nextSibling);
    if (idx === -1) return this.appendChild(child);
    this.children.splice(idx, 0, child);
    child.parentNode = this;
    child.isConnected = this.isConnected;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentNode = null;
    child.isConnected = false;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  closest(selector) {
    return this._closestMap.get(selector) || null;
  }

  setClosest(selector, node) {
    this._closestMap.set(selector, node);
  }
}

function connectTree(node) {
  node.isConnected = true;
  for (const child of node.children) connectTree(child);
}

function buildHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf('  function findTopRightActivityButton() {');
  assert.notEqual(start, -1, 'activity docking snippet start not found');
  const end = src.indexOf('\n  function syncActivityButtonDocking(bar, shouldDock) {', start);
  assert.notEqual(end, -1, 'activity docking snippet end not found');
  const snippet = src.slice(start, end);

  const context = {
    Array,
    Math,
    document: {
      documentElement: { clientWidth: 0, clientHeight: 0 },
      querySelectorAll() {
        return [];
      },
    },
    window: {
      innerWidth: 0,
      innerHeight: 0,
    },
    controlBar: null,
  };

  vm.createContext(context);
  vm.runInContext(
    `${snippet}
    globalThis.__activityDockApi = {
      clearActivityDockSlot,
      undockActivityButton,
      dockActivityButton,
    };`,
    context,
    { filename: 'inject-activity-docking-harness.js' }
  );
  return context.__activityDockApi;
}

test('undockActivityButton removes stale docked activity nodes when their original parent was remounted away', () => {
  const api = buildHarness();
  const buttonRow = new MockNode('buttonRow');
  const dockSlot = new MockNode('dockSlot');
  const staleNode = new MockNode('staleNode');
  const bar = {
    _buttonRow: buttonRow,
    _activityDockSlot: dockSlot,
    _activityDockState: {
      node: staleNode,
      originalParent: { isConnected: false },
      originalNextSibling: null,
      nativeContainer: null,
      nativeDisplay: '',
      nodeMarginLeft: '',
      nodeMarginRight: '',
    },
  };
  buttonRow.appendChild(dockSlot);
  dockSlot.appendChild(staleNode);
  connectTree(buttonRow);

  api.undockActivityButton(bar);

  assert.equal(dockSlot.children.length, 0);
  assert.equal(bar._activityDockState, null);
  assert.equal(dockSlot.style.display, 'none');
});

test('dockActivityButton prunes duplicate activity nodes already left in the dock slot', () => {
  const api = buildHarness();
  const buttonRow = new MockNode('buttonRow');
  const dockSlot = new MockNode('dockSlot');
  const currentNode = new MockNode('currentNode');
  const staleNode = new MockNode('staleNode');
  const bar = {
    _buttonRow: buttonRow,
    _activityDockSlot: dockSlot,
    _activityDockState: {
      node: currentNode,
      originalParent: null,
      originalNextSibling: null,
      nativeContainer: null,
      nativeDisplay: '',
      nodeMarginLeft: '',
      nodeMarginRight: '',
    },
  };
  buttonRow.appendChild(dockSlot);
  dockSlot.appendChild(staleNode);
  dockSlot.appendChild(currentNode);
  connectTree(buttonRow);

  api.dockActivityButton(bar);

  assert.deepEqual(dockSlot.children.map((node) => node.name), ['currentNode']);
  assert.equal(dockSlot.style.display, 'flex');
});
