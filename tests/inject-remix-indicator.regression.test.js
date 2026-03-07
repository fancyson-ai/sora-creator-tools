const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function extractRemixHelpersSource() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf("const normalizeId = (s) => s?.toString().split(/[?#]/)[0].trim();");
  assert.notEqual(start, -1, 'normalizeId helper start not found in inject.js');
  const end = src.indexOf('\n\n  // == Data extraction ==', start);
  assert.notEqual(end, -1, 'remix helper boundary not found in inject.js');
  return src.slice(start, end);
}

function buildHarness() {
  const helperSource = extractRemixHelpersSource();
  const context = {
    __location: { origin: 'https://sora.chatgpt.com', pathname: '/explore' },
  };
  const bootstrap = `
    const location = globalThis.__location;
    const idToIsRemix = new Map();
    const idToRemixSourcePostId = new Map();
    ${helperSource}
    globalThis.__normalizeSoraPostId = normalizeSoraPostId;
    globalThis.__derivePostRemixSourceId = derivePostRemixSourceId;
    globalThis.__setPostRemixState = setPostRemixState;
    globalThis.__maps = { idToIsRemix, idToRemixSourcePostId };
  `;
  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-remix-indicator-harness.js' });
  return {
    normalizeSoraPostId: context.__normalizeSoraPostId,
    derivePostRemixSourceId: context.__derivePostRemixSourceId,
    setPostRemixState: context.__setPostRemixState,
    maps: context.__maps,
  };
}

test('derivePostRemixSourceId prioritizes explicit source fields', () => {
  const { derivePostRemixSourceId } = buildHarness();
  const source = derivePostRemixSourceId({
    source_post_id: 's_source_1',
    remix_target_post_id: 's_target_ignored',
    parent_post_id: 's_parent_ignored',
  }, 's_current_1');
  assert.equal(source, 's_source_1');
});

test('derivePostRemixSourceId falls back to parent then root', () => {
  const { derivePostRemixSourceId } = buildHarness();
  const parentFallback = derivePostRemixSourceId({}, 's_current_a', 's_parent_a');
  assert.equal(parentFallback, 's_parent_a');

  const rootFallback = derivePostRemixSourceId({
    root_post_id: 's_root_a',
  }, 's_current_b');
  assert.equal(rootFallback, 's_root_a');
});

test('derivePostRemixSourceId ignores current post id and invalid ids', () => {
  const { derivePostRemixSourceId } = buildHarness();
  const ignoredCurrent = derivePostRemixSourceId({
    source_post_id: 's_same',
    parent_post_id: 's_same',
    root_post_id: 's_same',
  }, 's_same');
  assert.equal(ignoredCurrent, '');

  const ignoredInvalid = derivePostRemixSourceId({
    source_post_id: 'not_a_post_id',
    parent_post_id: 'also_bad',
  }, 's_current');
  assert.equal(ignoredInvalid, '');
});

test('setPostRemixState stores remix marker and source post id when available', () => {
  const { setPostRemixState, maps } = buildHarness();
  setPostRemixState('s_child_1', { source_post_id: 's_parent_1' });
  assert.equal(maps.idToIsRemix.get('s_child_1'), true);
  assert.equal(maps.idToRemixSourcePostId.get('s_child_1'), 's_parent_1');
});

test('setPostRemixState keeps remix marker with missing source when boolean signal exists', () => {
  const { setPostRemixState, maps } = buildHarness();
  setPostRemixState('s_child_2', { is_remix: true });
  assert.equal(maps.idToIsRemix.get('s_child_2'), true);
  assert.equal(maps.idToRemixSourcePostId.has('s_child_2'), false);
});

test('setPostRemixState marks non-remix posts and clears stale source', () => {
  const { setPostRemixState, maps } = buildHarness();
  setPostRemixState('s_plain_1', { source_post_id: 's_old_source' });
  assert.equal(maps.idToRemixSourcePostId.get('s_plain_1'), 's_old_source');
  setPostRemixState('s_plain_1', {});
  assert.equal(maps.idToIsRemix.get('s_plain_1'), false);
  assert.equal(maps.idToRemixSourcePostId.has('s_plain_1'), false);
});

test('normalizeSoraPostId supports direct ids and /p/ URLs', () => {
  const { normalizeSoraPostId } = buildHarness();
  assert.equal(normalizeSoraPostId('s_abc123'), 's_abc123');
  assert.equal(normalizeSoraPostId('/p/s_def456?foo=1'), 's_def456');
  assert.equal(normalizeSoraPostId('https://sora.chatgpt.com/p/s_xyz789'), 's_xyz789');
  assert.equal(normalizeSoraPostId('bad'), '');
});
