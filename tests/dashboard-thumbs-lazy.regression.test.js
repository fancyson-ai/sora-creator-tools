const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.js');

function buildThumbHarness() {
  const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const start = src.indexOf("const SITE_ORIGIN = 'https://sora.chatgpt.com';");
  assert.notEqual(start, -1, 'thumb snippet start not found');
  const end = src.indexOf('const COLORS = [', start);
  assert.notEqual(end, -1, 'thumb snippet end not found');
  const snippet = src.slice(start, end);

  const context = {
    URL,
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
  };

  const bootstrap = `
    ${snippet}
    globalThis.__thumbApi = {
      DEFAULT_THUMB_URL,
      getThumbDisplayChoice,
      markThumbUrlExpired,
      markThumbUrlUsable,
      normalizePostThumbUrl,
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'dashboard-thumb-harness.js' });
  return context.__thumbApi;
}

test('getThumbDisplayChoice uses real thumb URL directly for unknown but valid URLs', () => {
  const api = buildThumbHarness();
  const url = 'https://videos.openai.com/example/thumb.png';
  const choice = api.getThumbDisplayChoice(url);
  assert.equal(choice.displayUrl, url);
  assert.equal(choice.sourceUrl, url);
  assert.equal('probeUrl' in choice, false);
});

test('getThumbDisplayChoice blocks disallowed thumbnail hosts', () => {
  const api = buildThumbHarness();
  const blocked = 'https://ogimg.chatgpt.com/?postId=abc';
  const choice = api.getThumbDisplayChoice(blocked);
  assert.equal(choice.displayUrl, api.DEFAULT_THUMB_URL);
  assert.equal(choice.sourceUrl, null);
});

test('getThumbDisplayChoice returns placeholder for known-bad thumbnail URLs', () => {
  const api = buildThumbHarness();
  const url = 'https://videos.openai.com/example/bad-thumb.png';
  api.markThumbUrlExpired(url);
  const choice = api.getThumbDisplayChoice(url);
  assert.equal(choice.displayUrl, api.DEFAULT_THUMB_URL);
  assert.equal(choice.sourceUrl, null);
});

test('getThumbDisplayChoice reuses known-usable thumbnail URLs', () => {
  const api = buildThumbHarness();
  const url = 'https://videos.openai.com/example/good-thumb.png';
  api.markThumbUrlUsable(url);
  const choice = api.getThumbDisplayChoice(url);
  assert.equal(choice.displayUrl, url);
  assert.equal(choice.sourceUrl, url);
});
