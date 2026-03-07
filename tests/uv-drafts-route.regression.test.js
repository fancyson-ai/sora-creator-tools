const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CONTENT_PATH = path.join(__dirname, '..', 'content.js');
const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function buildContentRouteHarness() {
  const src = fs.readFileSync(CONTENT_PATH, 'utf8');
  const start = src.indexOf("  const UV_DRAFTS_ROUTE_RE = /^\\/(?:uv-drafts|creatortools)(?:\\/|$)/i;");
  assert.notEqual(start, -1, 'content UV drafts route snippet start not found');
  const end = src.indexOf('  function flushUVDraftsReadyCallbacks() {', start);
  assert.notEqual(end, -1, 'content UV drafts route snippet end not found');
  const snippet = src.slice(start, end);

  const context = {};
  const bootstrap = `
    const location = { pathname: '/explore' };
    ${snippet}
    globalThis.__contentRouteApi = {
      isUVDraftsRoute,
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'content-uv-drafts-route-harness.js' });
  return context.__contentRouteApi;
}

function buildInjectRouteHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const helperStart = src.indexOf("  const UV_DRAFTS_CANONICAL_PREFIX = '/creatortools';");
  assert.notEqual(helperStart, -1, 'inject UV drafts route helper snippet start not found');
  const helperEnd = src.indexOf('  const isTopFeed = () => {', helperStart);
  assert.notEqual(helperEnd, -1, 'inject UV drafts route helper snippet end not found');
  const helperSnippet = src.slice(helperStart, helperEnd);

  const navStart = src.indexOf('  function navigateToUVDraftsRoute() {');
  assert.notEqual(navStart, -1, 'inject UV drafts navigation snippet start not found');
  const navEnd = src.indexOf('  function getDraftsQueueUiSummary() {', navStart);
  assert.notEqual(navEnd, -1, 'inject UV drafts navigation snippet end not found');
  const navSnippet = src.slice(navStart, navEnd);

  const context = {
    URL,
  };
  const bootstrap = `
    const location = {
      pathname: '/explore',
      search: '',
      hash: '',
      href: 'https://sora.chatgpt.com/explore',
    };
    const document = { title: 'Explore - Sora' };
    let uvDraftsPrevDocTitle = null;
    let onRouteChangeCalls = 0;

    function setLocationFromUrl(url) {
      const raw = String(url || '');
      const hashIndex = raw.indexOf('#');
      const pathAndSearch = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
      const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
      const searchIndex = pathAndSearch.indexOf('?');
      const pathname = searchIndex >= 0 ? pathAndSearch.slice(0, searchIndex) : pathAndSearch;
      const search = searchIndex >= 0 ? pathAndSearch.slice(searchIndex) : '';
      location.pathname = pathname || '';
      location.search = search;
      location.hash = hash;
      location.href = 'https://sora.chatgpt.com' + location.pathname + location.search + location.hash;
    }

    const history = {
      state: { preserved: true },
      pushed: [],
      replaced: [],
      pushState(state, unused, url) {
        this.state = state;
        this.pushed.push({ state, url });
        setLocationFromUrl(url);
      },
      replaceState(state, unused, url) {
        this.state = state;
        this.replaced.push({ state, url });
        setLocationFromUrl(url);
      },
    };

    function onRouteChange() {
      onRouteChangeCalls += 1;
    }

    ${helperSnippet}
    ${navSnippet}

    function reset(pathname = '/explore', search = '', hash = '') {
      setLocationFromUrl(pathname + search + hash);
      document.title = 'Explore - Sora';
      uvDraftsPrevDocTitle = null;
      onRouteChangeCalls = 0;
      history.state = { preserved: true };
      history.pushed = [];
      history.replaced = [];
    }

    globalThis.__injectRouteApi = {
      reset,
      isUVDrafts,
      getCanonicalUVDraftsPath,
      maybeCanonicalizeUVDraftsRoute,
      navigateToUVDraftsRoute,
      snapshot() {
        return {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
          href: location.href,
          prevTitle: uvDraftsPrevDocTitle,
          onRouteChangeCalls,
          pushedUrls: history.pushed.map((entry) => entry.url),
          replacedUrls: history.replaced.map((entry) => entry.url),
        };
      },
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-uv-drafts-route-harness.js' });
  return context.__injectRouteApi;
}

test('content route helper recognizes both legacy and canonical UV Drafts paths', () => {
  const api = buildContentRouteHarness();

  assert.equal(api.isUVDraftsRoute('/uv-drafts'), true);
  assert.equal(api.isUVDraftsRoute('/uv-drafts/workspace-a'), true);
  assert.equal(api.isUVDraftsRoute('/creatortools'), true);
  assert.equal(api.isUVDraftsRoute('/creatortools/workspace-a'), true);
  assert.equal(api.isUVDraftsRoute('/drafts'), false);
});

test('inject route helper canonicalizes legacy UV Drafts links onto /creatortools', () => {
  const api = buildInjectRouteHarness();

  api.reset('/uv-drafts/music-lab', '?view=grid', '#top');
  assert.equal(api.isUVDrafts(), true);
  assert.equal(api.getCanonicalUVDraftsPath('/uv-drafts/music-lab'), '/creatortools/music-lab');
  assert.equal(api.maybeCanonicalizeUVDraftsRoute(), true);

  const snapshot = api.snapshot();
  assert.equal(snapshot.pathname, '/creatortools/music-lab');
  assert.equal(snapshot.search, '?view=grid');
  assert.equal(snapshot.hash, '#top');
  assert.deepEqual(Array.from(snapshot.replacedUrls), ['/creatortools/music-lab?view=grid#top']);
});

test('navigateToUVDraftsRoute uses the canonical /creatortools path', () => {
  const api = buildInjectRouteHarness();

  api.reset('/explore');
  api.navigateToUVDraftsRoute();

  const snapshot = api.snapshot();
  assert.equal(snapshot.pathname, '/creatortools');
  assert.deepEqual(Array.from(snapshot.pushedUrls), ['/creatortools']);
  assert.equal(snapshot.prevTitle, 'Explore - Sora');
  assert.equal(snapshot.onRouteChangeCalls, 1);
});
