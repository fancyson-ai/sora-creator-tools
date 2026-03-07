const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UV_DRAFTS_PAGE_PATH = path.join(__dirname, '..', 'uv-drafts-page.js');

function extractRenderSnippet() {
  const src = fs.readFileSync(UV_DRAFTS_PAGE_PATH, 'utf8');
  const start = src.indexOf("function isUVDraftsLoadingIndicatorVisible() {");
  assert.notEqual(start, -1, 'render snippet start not found');
  const end = src.indexOf('  function setupUVDraftsInfiniteScroll() {', start);
  assert.notEqual(end, -1, 'render snippet end not found');
  return src.slice(start, end);
}

function buildRenderHarness() {
  const snippet = extractRenderSnippet();
  const context = {};
  const bootstrap = `
    class FakeNode {
      constructor(tagName = '') {
        this.tagName = String(tagName).toUpperCase();
        this.className = '';
        this.textContent = '';
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.parentNode = null;
        this._innerHTML = '';
        this.clientWidth = 1200;
      }

      appendChild(child) {
        if (!child) return child;
        if (child.isFragment) {
          for (const grandChild of child.children.slice()) {
            this.appendChild(grandChild);
          }
          child.children = [];
          return child;
        }
        child.parentNode = this;
        this.children.push(child);
        this._innerHTML = '';
        return child;
      }

      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      }

      querySelector(selector) {
        if (!selector || typeof selector !== 'string') return null;
        const matcher = buildMatcher(selector);
        const stack = [...this.children];
        while (stack.length > 0) {
          const node = stack.shift();
          if (matcher(node)) return node;
          if (Array.isArray(node.children) && node.children.length > 0) {
            stack.unshift(...node.children);
          }
        }
        return null;
      }

      set innerHTML(value) {
        this._innerHTML = String(value);
        for (const child of this.children) {
          child.parentNode = null;
        }
        this.children = [];
      }

      get innerHTML() {
        return this._innerHTML;
      }
    }

    class FakeFragment {
      constructor() {
        this.isFragment = true;
        this.children = [];
      }

      appendChild(child) {
        if (!child) return child;
        this.children.push(child);
        return child;
      }
    }

    function buildMatcher(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return (node) => String(node.className || '').split(/\\s+/).includes(cls);
      }
      if (selector.startsWith('[data-draft-id="') && selector.endsWith('"]')) {
        const id = selector.slice(16, -2);
        return (node) => String(node.dataset?.draftId || '') === id;
      }
      return () => false;
    }

    const document = {
      createElement(tagName) {
        return new FakeNode(tagName);
      },
      createDocumentFragment() {
        return new FakeFragment();
      },
    };

    const CSS = {
      escape(value) {
        return String(value);
      },
    };

    const UV_DRAFTS_BATCH_SIZE = 50;
    let currentDrafts = [];
    let uvDraftsGridEl = new FakeNode('div');
    let uvDraftsLoadingEl = new FakeNode('div');
    let uvDraftsPageEl = new FakeNode('div');
    let uvDraftsRenderedCount = 0;
    let uvDraftsFilteredCache = [];
    let uvDraftsAwaitingMoreResults = false;
    let uvDraftsSearchQuery = '';
    let uvDraftsData = [];
    let uvDraftsInitialLoadComplete = true;
    let uvDraftsSyncUiState = { syncing: false, processed: 0, page: 0 };
    let uvDraftsCurrentlyPlayingDraftId = null;
    let uvDraftsCurrentlyPlayingVideo = null;

    function getRenderableUVDrafts() {
      return currentDrafts.slice();
    }

    function createUVDraftCard(draft) {
      const card = new FakeNode('div');
      card.className = 'uv-draft-card';
      card.dataset.draftId = String(draft.id || '');
      card.textContent = String(draft.id || '');
      return card;
    }

    function shouldGroupLandscapeDraftCard() {
      return false;
    }

    function getLandscapeRunEndIndex() {
      return -1;
    }

    function getLandscapeRunGridColumnCapacity() {
      return 4;
    }

    function getLandscapeRunChunkSize(maxColumns) {
      return Math.max(2, Math.floor(Number(maxColumns) || 0)) * 2;
    }

    function getLandscapeRunColumnSpan() {
      return 2;
    }

    function extendLandscapeRunRenderEnd(drafts, end) {
      return Math.max(0, Math.min(Number(end) || 0, Array.isArray(drafts) ? drafts.length : 0));
    }

    function planDraftGridRows(drafts, maxColumns) {
      if (!Array.isArray(drafts) || drafts.length === 0) return [];
      const cols = Math.max(1, Math.floor(Number(maxColumns) || 0));
      const rows = [];
      for (let index = 0; index < drafts.length; index += cols) {
        rows.push(
          drafts.slice(index, index + cols).map((draft) => ({
            kind: 'card',
            span: 1,
            draftIds: [String(draft.id || '')],
          }))
        );
      }
      return rows;
    }

    function extendDraftRenderEndToRowBoundary(drafts, end) {
      return Math.max(0, Math.min(Number(end) || 0, Array.isArray(drafts) ? drafts.length : 0));
    }

    function updateLoadMoreIndicator() {}
    function setupUVDraftsInfiniteScroll() {}

    ${snippet}

    globalThis.__setState = (next) => {
      if (Object.prototype.hasOwnProperty.call(next, 'currentDrafts')) currentDrafts = Array.isArray(next.currentDrafts) ? next.currentDrafts.slice() : [];
      if (Object.prototype.hasOwnProperty.call(next, 'allDrafts')) uvDraftsData = Array.isArray(next.allDrafts) ? next.allDrafts.slice() : [];
      if (Object.prototype.hasOwnProperty.call(next, 'awaitingMoreResults')) uvDraftsAwaitingMoreResults = !!next.awaitingMoreResults;
      if (Object.prototype.hasOwnProperty.call(next, 'initialLoadComplete')) uvDraftsInitialLoadComplete = !!next.initialLoadComplete;
      if (Object.prototype.hasOwnProperty.call(next, 'syncing')) uvDraftsSyncUiState = { ...uvDraftsSyncUiState, syncing: !!next.syncing };
      if (Object.prototype.hasOwnProperty.call(next, 'searchQuery')) uvDraftsSearchQuery = String(next.searchQuery || '');
      if (Object.prototype.hasOwnProperty.call(next, 'loadingDisplay')) uvDraftsLoadingEl.style.display = next.loadingDisplay;
      if (Object.prototype.hasOwnProperty.call(next, 'loadingText')) uvDraftsLoadingEl.textContent = String(next.loadingText || '');
      if (Object.prototype.hasOwnProperty.call(next, 'resetGrid') && next.resetGrid) {
        uvDraftsGridEl = new FakeNode('div');
        uvDraftsRenderedCount = 0;
        uvDraftsFilteredCache = [];
      }
    };
    globalThis.__renderGrid = renderUVDraftsGrid;
    globalThis.__renderSyncUpdate = renderUVDraftsSyncUpdate;
    globalThis.__shouldRerenderAfterSync = shouldRerenderUVDraftsEmptyStateAfterSync;
    globalThis.__snapshot = () => ({
      loadingDisplay: uvDraftsLoadingEl.style.display || '',
      loadingText: uvDraftsLoadingEl.textContent || '',
      renderedCount: uvDraftsRenderedCount,
      childClasses: uvDraftsGridEl.children.map((child) => child.className || ''),
      childDraftIds: uvDraftsGridEl.children.flatMap((child) => {
        const selfId = child.dataset?.draftId ? [child.dataset.draftId] : [];
        const nestedIds = Array.isArray(child.children)
          ? child.children.map((grandChild) => grandChild.dataset?.draftId || '').filter(Boolean)
          : [];
        return [...selfId, ...nestedIds];
      }),
      emptyText: uvDraftsGridEl.querySelector('.uvd-empty-state')?.textContent || null,
    });
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'uv-drafts-empty-state-harness.js' });
  return {
    renderGrid: context.__renderGrid,
    renderSyncUpdate: context.__renderSyncUpdate,
    shouldRerenderAfterSync: context.__shouldRerenderAfterSync,
    setState: context.__setState,
    snapshot: context.__snapshot,
  };
}

test('renderUVDraftsGrid defers empty state while more draft pages are still pending', () => {
  const harness = buildRenderHarness();
  harness.setState({
    currentDrafts: [],
    allDrafts: [],
    awaitingMoreResults: true,
    searchQuery: '',
    resetGrid: true,
    loadingDisplay: '',
    loadingText: '',
  });

  harness.renderGrid();
  const snapshot = harness.snapshot();

  assert.equal(snapshot.emptyText, null);
  assert.equal(snapshot.loadingDisplay, 'flex');
  assert.equal(snapshot.loadingText, 'Syncing drafts...');
  assert.deepEqual(Array.from(snapshot.childClasses), []);
});

test('renderUVDraftsGrid keeps loading state while initial sync is still in progress', () => {
  const harness = buildRenderHarness();
  harness.setState({
    currentDrafts: [],
    allDrafts: [],
    awaitingMoreResults: false,
    syncing: true,
    searchQuery: '',
    resetGrid: true,
    loadingDisplay: '',
    loadingText: '',
  });

  harness.renderGrid();
  const snapshot = harness.snapshot();

  assert.equal(snapshot.emptyText, null);
  assert.equal(snapshot.loadingDisplay, 'flex');
  assert.equal(snapshot.loadingText, 'Loading drafts...');
});

test('renderUVDraftsGrid shows empty state immediately when a search query has no matches', () => {
  const harness = buildRenderHarness();
  harness.setState({
    currentDrafts: [],
    allDrafts: [],
    awaitingMoreResults: false,
    syncing: false,
    searchQuery: 'workspace:alpha',
    resetGrid: true,
    loadingDisplay: '',
    loadingText: '',
  });

  harness.renderGrid();
  const snapshot = harness.snapshot();

  assert.equal(snapshot.loadingDisplay, 'none');
  assert.equal(snapshot.emptyText, 'No drafts match your search');
});

test('renderUVDraftsGrid shows empty state once syncing has finished with no drafts', () => {
  const harness = buildRenderHarness();
  harness.setState({
    currentDrafts: [],
    allDrafts: [],
    awaitingMoreResults: false,
    syncing: false,
    searchQuery: '',
    resetGrid: true,
    loadingDisplay: 'flex',
    loadingText: 'Loading drafts...',
  });

  harness.renderGrid();
  const snapshot = harness.snapshot();

  assert.equal(snapshot.loadingDisplay, 'none');
  assert.equal(snapshot.emptyText, 'No drafts found');
});

test('shouldRerenderUVDraftsEmptyStateAfterSync treats an empty workspace result as empty even when other drafts exist', () => {
  const harness = buildRenderHarness();
  harness.setState({
    currentDrafts: [],
    allDrafts: [{ id: 'draft_other_workspace' }],
    awaitingMoreResults: false,
    syncing: false,
    searchQuery: '',
    resetGrid: true,
    loadingDisplay: 'flex',
    loadingText: 'Loading drafts...',
  });

  assert.equal(harness.shouldRerenderAfterSync(), true);
});

test('renderUVDraftsSyncUpdate removes stale empty state before appending real draft cards', () => {
  const harness = buildRenderHarness();
  harness.setState({
    currentDrafts: [],
    allDrafts: [],
    awaitingMoreResults: false,
    searchQuery: '',
    resetGrid: true,
  });

  harness.renderGrid();
  let snapshot = harness.snapshot();
  assert.equal(snapshot.emptyText, 'No drafts found');

  harness.setState({
    currentDrafts: [{ id: 'draft_1' }],
    loadingDisplay: 'flex',
    loadingText: 'Syncing drafts...',
  });
  harness.renderSyncUpdate();
  snapshot = harness.snapshot();

  assert.equal(snapshot.emptyText, null);
  assert.equal(snapshot.loadingDisplay, 'none');
  assert.deepEqual(Array.from(snapshot.childClasses), ['uv-draft-card']);
  assert.deepEqual(Array.from(snapshot.childDraftIds), ['draft_1']);
});
