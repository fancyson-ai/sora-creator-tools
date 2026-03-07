const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UV_DRAFTS_PAGE_PATH = path.join(__dirname, '..', 'uv-drafts-page.js');

function loadEscapeHtml() {
  const src = fs.readFileSync(UV_DRAFTS_PAGE_PATH, 'utf8');
  const start = src.indexOf("    const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' };");
  assert.notEqual(start, -1, 'escapeHtml helper start not found');
  const end = src.indexOf('    function getBookmarks() {', start);
  assert.notEqual(end, -1, 'escapeHtml helper end not found');
  const snippet = src.slice(start, end);

  const context = {};
  vm.createContext(context);
  vm.runInContext(`${snippet}\nglobalThis.__escapeHtml = escapeHtml;`, context, {
    filename: 'uv-drafts-html-escape-harness.js',
  });
  return context.__escapeHtml;
}

test('escapeHtml in uv-drafts-page escapes option values and labels used by the composer', () => {
  const escapeHtml = loadEscapeHtml();

  assert.equal(escapeHtml('plain'), 'plain');
  assert.equal(
    escapeHtml(`<&>"'`),
    '&lt;&amp;&gt;&quot;&#39;'
  );
  assert.equal(
    escapeHtml('Sora "2" <Pro> & Remix'),
    'Sora &quot;2&quot; &lt;Pro&gt; &amp; Remix'
  );
});
