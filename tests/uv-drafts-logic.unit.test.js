const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDraftPreviewText,
  mergeDraftListById,
  appendUniqueDrafts,
  removeDraftById,
  computeDraftStats,
  normalizeViewState,
  DEFAULT_VIEW_STATE,
  parseSearchQuery,
  matchesDurationFilter,
  buildDraftSearchBlob,
  matchesDraftSearchFilters,
  draftMatchesSearchQuery,
  applyCreateBodyOverrides,
  parsePromptJsonl,
  normalizePromptQueueState,
  peekCurrentPrompt,
  advancePromptQueue,
  setPromptQueueSelection,
  removePromptAtIndex,
  consumeNextPrompt,
  modeRequiresComposerSource,
  getGensCountMax,
  clampGensCount,
  isDraftPubliclyPosted,
  getDraftPostUrl,
  canTrimDraft,
  getDraftTrimUrl,
  looksLikePendingV2Task,
  flattenPendingV2Payload,
  getDroppedIds,
  isDraftAlwaysOld,
  isDraftUnread,
  GENS_COUNT_MIN,
  GENS_COUNT_MAX_DEFAULT,
  GENS_COUNT_MAX_ULTRA,
  DEFAULT_PROMPT_QUEUE_MAX,
} = require('../uv-drafts-logic.js');

test('getDraftPreviewText uses prompt first and truncates correctly', () => {
  const draft = {
    id: 'd1',
    prompt: 'a'.repeat(65),
    title: 'short title',
  };

  const preview = getDraftPreviewText(draft, 60);
  assert.equal(preview.length, 63);
  assert.ok(preview.endsWith('...'));
  assert.equal(preview, `${'a'.repeat(60)}...`);
});

test('getDraftPreviewText falls back to title then Untitled', () => {
  assert.equal(getDraftPreviewText({ title: 'Title only' }, 60), 'Title only');
  assert.equal(getDraftPreviewText({}, 60), 'Untitled');
});

test('mergeDraftListById keeps primary order and removes duplicates', () => {
  const primary = [{ id: 'p1' }, { id: 'p2' }, { id: 'p1' }];
  const secondary = [{ id: 'p2' }, { id: 'p3' }];
  const merged = mergeDraftListById(primary, secondary);

  assert.deepEqual(merged.map((d) => d.id), ['p1', 'p2', 'p3']);
});

test('appendUniqueDrafts appends only drafts that are not already present', () => {
  const existing = [{ id: 'a' }, { id: 'b' }];
  const incoming = [{ id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'c' }];
  const next = appendUniqueDrafts(existing, incoming);

  assert.deepEqual(next.map((d) => d.id), ['a', 'b', 'c', 'd']);
});

test('removeDraftById removes matching draft id from list', () => {
  const drafts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const next = removeDraftById(drafts, 'b');

  assert.deepEqual(next.map((d) => d.id), ['a', 'c']);
});

test('computeDraftStats counts only loaded bookmarks and unread drafts not just seen', () => {
  const drafts = [
    { id: 'a', hidden: false, is_read: false },
    { id: 'b', hidden: true, is_read: false },
    { id: 'c', hidden: false, is_read: true },
  ];
  const bookmarked = new Set(['b', 'z']);
  const justSeen = new Set(['a']);

  const stats = computeDraftStats(drafts, bookmarked, justSeen);

  assert.deepEqual(stats, {
    total: 3,
    bookmarked: 1,
    hidden: 1,
    newCount: 1,
  });
});

test('computeDraftStats excludes no-date violation/processing drafts from new count', () => {
  const drafts = [
    { id: 'v1', kind: 'sora_content_violation', is_read: false },
    { id: 'e1', kind: 'sora_processing_error', is_read: false },
    { id: 'n1', kind: 'sora_draft', is_read: false },
  ];
  const stats = computeDraftStats(drafts, new Set(), new Set());
  assert.equal(stats.newCount, 1);
});

test('computeDraftStats excludes unsynced drafts from new count', () => {
  const drafts = [
    { id: 'a', is_read: false, is_unsynced: true },
    { id: 'b', is_read: false, is_unsynced: false },
    { id: 'c', is_read: false },
  ];
  const stats = computeDraftStats(drafts, new Set(), new Set());
  assert.equal(stats.newCount, 2, 'only non-unsynced unread drafts count as new');
});

test('normalizeViewState accepts only supported values and trims workspace', () => {
  const state = normalizeViewState({
    filterState: 'bookmarked',
    workspaceFilter: '  ws_1  ',
    searchQuery: 'cats',
  });

  assert.deepEqual(state, {
    filterState: 'bookmarked',
    workspaceFilter: 'ws_1',
    searchQuery: 'cats',
  });
});

test('normalizeViewState accepts unsynced filter state', () => {
  const state = normalizeViewState({ filterState: 'unsynced' });
  assert.equal(state.filterState, 'unsynced');
});

test('normalizeViewState falls back to defaults for invalid values', () => {
  const state = normalizeViewState({
    filterState: 'invalid',
    workspaceFilter: '   ',
    searchQuery: 123,
  });

  assert.deepEqual(state, DEFAULT_VIEW_STATE);
});

test('parseSearchQuery supports quoted values and keeps unknown key:value as a term', () => {
  const parsed = parseSearchQuery('model:sora2 ws:"Music Workspace" "exact phrase" nonsense:value');

  assert.deepEqual(parsed.filters, [
    { key: 'model', value: 'sora2' },
    { key: 'ws', value: 'Music Workspace' },
  ]);
  assert.deepEqual(parsed.terms, ['exact phrase', 'nonsense:value']);
});

test('matchesDurationFilter accepts comparison operators and second suffixes', () => {
  assert.equal(matchesDurationFilter(12, '>10'), true);
  assert.equal(matchesDurationFilter(12, '>=12s'), true);
  assert.equal(matchesDurationFilter(12, '<12sec'), false);
});

test('buildDraftSearchBlob includes prompt/model/workspace/cameos/tags', () => {
  const blob = buildDraftSearchBlob({
    id: 'd1',
    prompt: 'cat running',
    model: 'sora2',
    cameo_profiles: [{ username: 'alice' }],
    tags: ['music', 'neon'],
  }, 'workspace a');

  assert.ok(blob.includes('cat running'));
  assert.ok(blob.includes('sora2'));
  assert.ok(blob.includes('workspace a'));
  assert.ok(blob.includes('alice'));
  assert.ok(blob.includes('music neon'));
});

test('matchesDraftSearchFilters supports booleans and workspace resolution', () => {
  const parsed = parseSearchQuery('bookmarked:true hidden:false ws:alpha');
  const matches = matchesDraftSearchFilters({
    id: 'd1',
    workspace_id: 'ws_1',
    hidden: false,
  }, parsed, {
    bookmarks: new Set(['d1']),
    resolveWorkspaceName: () => 'Alpha Squad',
  });

  assert.equal(matches, true);
});

test('draftMatchesSearchQuery combines filters and terms', () => {
  const parsed = parseSearchQuery('model:sora2 "robot dance"');
  const hit = draftMatchesSearchQuery({
    id: 'd1',
    model: 'sora2',
    prompt: 'A robot dance in a warehouse',
  }, parsed, {
    resolveWorkspaceName: () => '',
    bookmarks: new Set(),
  });
  const miss = draftMatchesSearchQuery({
    id: 'd2',
    model: 'sora2',
    prompt: 'Sunset over beach',
  }, parsed, {
    resolveWorkspaceName: () => '',
    bookmarks: new Set(),
  });

  assert.equal(hit, true);
  assert.equal(miss, false);
});

test('applyCreateBodyOverrides applies overrides to root and nested body payload', () => {
  const source = JSON.stringify({
    prompt: 'old',
    creation_config: { orientation: 'portrait' },
    body: JSON.stringify({
      prompt: 'old inner',
      creation_config: {},
    }),
  });

  const next = applyCreateBodyOverrides(source, {
    prompt: 'new prompt',
    model: 'sora2',
    durationSeconds: 15,
    nFrames: 450,
    orientation: 'landscape',
    size: 'high',
    style_id: 'cinematic',
    seed: '12a34',
  });

  const parsed = JSON.parse(next);
  const inner = JSON.parse(parsed.body);

  assert.equal(parsed.prompt, 'new prompt');
  assert.equal(parsed.model, 'sora2');
  assert.equal(parsed.creation_config.prompt, 'new prompt');
  assert.equal(parsed.creation_config.model, 'sora2');
  assert.equal(parsed.creation_config.orientation, 'landscape');
  assert.equal(parsed.creation_config.size, 'high');
  assert.equal(parsed.creation_config.style_id, 'cinematic');
  assert.equal(parsed.creation_config.seed, '1234');
  assert.equal(parsed.creation_config.duration_seconds, 15);
  assert.equal(parsed.creation_config.n_frames, 450);
  assert.equal(parsed.duration_seconds, 15);
  assert.equal(parsed.n_frames, 450);

  assert.equal(inner.prompt, 'new prompt');
  assert.equal(inner.model, 'sora2');
  assert.equal(inner.creation_config.prompt, 'new prompt');
  assert.equal(inner.creation_config.orientation, 'landscape');
  assert.equal(inner.creation_config.duration_seconds, 15);
  assert.equal(inner.creation_config.n_frames, 450);
});

test('applyCreateBodyOverrides returns original payload when JSON is invalid', () => {
  const source = 'not-json';
  assert.equal(applyCreateBodyOverrides(source, { prompt: 'x' }), source);
});

test('parsePromptJsonl accepts strict prompt-only JSONL lines and reports invalid rows', () => {
  const input = [
    '{"prompt":"  first prompt  "}',
    '{"prompt":""}',
    '{"prompt":"second prompt","model":"sora2"}',
    '{"foo":"bar"}',
    'not json',
  ].join('\n');

  const out = parsePromptJsonl(input, { maxPrompts: 20 });
  assert.equal(out.maxPrompts, 20);
  assert.deepEqual(out.prompts, ['first prompt', 'second prompt']);
  assert.equal(out.acceptedCount, 2);
  assert.equal(out.invalidCount, 3);
  assert.equal(out.truncatedCount, 0);
  assert.equal(out.nonEmptyLines, 5);
  assert.deepEqual(out.errors.map((entry) => entry.line), [2, 4, 5]);
});

test('parsePromptJsonl enforces default prompt cap of 20', () => {
  const lines = [];
  for (let i = 1; i <= 24; i += 1) {
    lines.push(JSON.stringify({ prompt: `p${i}` }));
  }
  const out = parsePromptJsonl(lines.join('\n'));
  assert.equal(DEFAULT_PROMPT_QUEUE_MAX, 20);
  assert.equal(out.acceptedCount, 20);
  assert.equal(out.truncatedCount, 4);
  assert.deepEqual(out.prompts.slice(0, 3), ['p1', 'p2', 'p3']);
  assert.equal(out.prompts[out.prompts.length - 1], 'p20');
});

test('normalizePromptQueueState sanitizes prompts and clamps index', () => {
  const out = normalizePromptQueueState({
    prompts: ['  a  ', '', 'b', null],
    index: 5,
    selectedIndex: -3,
    createdAt: 123,
  });

  assert.deepEqual(out.prompts, ['a', 'b']);
  assert.equal(out.total, 2);
  assert.equal(out.index, 2);
  assert.equal(out.selectedIndex, 0);
  assert.equal(out.remaining, 0);
  assert.equal(out.exhausted, true);
});

test('setPromptQueueSelection clamps selectedIndex to queue bounds', () => {
  const queue = normalizePromptQueueState({
    prompts: ['p1', 'p2', 'p3'],
    index: 1,
    selectedIndex: 1,
    createdAt: 5,
  });
  const low = setPromptQueueSelection(queue, -10);
  assert.equal(low.selectedIndex, 0);
  assert.equal(low.index, 1);

  const high = setPromptQueueSelection(queue, 99);
  assert.equal(high.selectedIndex, 2);
  assert.equal(high.index, 1);
});

test('peekCurrentPrompt returns current prompt without advancing queue index', () => {
  const queue = normalizePromptQueueState({
    prompts: ['first', 'second'],
    index: 0,
    selectedIndex: 1,
    createdAt: 10,
  });
  const peek = peekCurrentPrompt(queue);
  assert.equal(peek.prompt, 'first');
  assert.equal(peek.index, 0);
  assert.equal(peek.queue.index, 0);
  assert.equal(peek.remaining, 2);
  assert.equal(queue.index, 0);
});

test('advancePromptQueue only advances submission cursor and preserves selectedIndex', () => {
  const queue = normalizePromptQueueState({
    prompts: ['first', 'second', 'third'],
    index: 0,
    selectedIndex: 2,
    createdAt: 10,
  });
  const next = advancePromptQueue(queue);
  assert.equal(next.prompt, 'first');
  assert.equal(next.consumed, true);
  assert.equal(next.queue.index, 1);
  assert.equal(next.queue.selectedIndex, 2);
  assert.equal(next.remaining, 2);
});

test('removePromptAtIndex adjusts selection and submission index safely', () => {
  const queue = normalizePromptQueueState({
    prompts: ['p1', 'p2', 'p3', 'p4'],
    index: 2,
    selectedIndex: 2,
    createdAt: 9,
  });
  const removedBeforeCurrent = removePromptAtIndex(queue, 1);
  assert.deepEqual(removedBeforeCurrent.prompts, ['p1', 'p3', 'p4']);
  assert.equal(removedBeforeCurrent.index, 1);
  assert.equal(removedBeforeCurrent.selectedIndex, 1);

  const removedSelected = removePromptAtIndex(removedBeforeCurrent, 1);
  assert.deepEqual(removedSelected.prompts, ['p1', 'p4']);
  assert.equal(removedSelected.index, 1);
  assert.equal(removedSelected.selectedIndex, 1);
});

test('consumeNextPrompt advances queue index and preserves order', () => {
  const queue = normalizePromptQueueState({ prompts: ['one', 'two'], index: 0, createdAt: 111 });
  const first = consumeNextPrompt(queue);
  assert.equal(first.prompt, 'one');
  assert.equal(first.consumed, true);
  assert.equal(first.queue.index, 1);
  assert.equal(first.remaining, 1);

  const second = consumeNextPrompt(first.queue);
  assert.equal(second.prompt, 'two');
  assert.equal(second.consumed, true);
  assert.equal(second.queue.index, 2);
  assert.equal(second.remaining, 0);

  const third = consumeNextPrompt(second.queue);
  assert.equal(third.prompt, '');
  assert.equal(third.consumed, false);
  assert.equal(third.remaining, 0);
});

test('modeRequiresComposerSource enforces source gating only for remix/extend', () => {
  assert.equal(modeRequiresComposerSource('compose'), false);
  assert.equal(modeRequiresComposerSource('remix'), true);
  assert.equal(modeRequiresComposerSource('extend'), true);
  assert.equal(modeRequiresComposerSource('trim'), false);
  assert.equal(modeRequiresComposerSource('  REMIX  '), true);
});

test('parseSearchQuery treats commas as separators for key:value filters', () => {
  const parsed = parseSearchQuery('model:sora2, ws:"Music Lab", dur:>=10, bookmarked:true');
  assert.deepEqual(parsed.filters, [
    { key: 'model', value: 'sora2' },
    { key: 'ws', value: 'Music Lab' },
    { key: 'dur', value: '>=10' },
    { key: 'bookmarked', value: 'true' },
  ]);
});

test('isDraftPubliclyPosted only returns true for public visibility', () => {
  assert.equal(isDraftPubliclyPosted({ post_visibility: 'public' }), true);
  assert.equal(isDraftPubliclyPosted({ post_meta: { posted_to_public: true } }), true);
  assert.equal(isDraftPubliclyPosted({ post_meta: { visibility: 'private' } }), false);
  assert.equal(isDraftPubliclyPosted({ post_visibility: 'private', posted_to_public: false }), false);
});

test('getDraftPostUrl prefers permalink and falls back to post id', () => {
  assert.equal(
    getDraftPostUrl({ post_permalink: '/p/abc123' }),
    'https://sora.chatgpt.com/p/abc123'
  );
  assert.equal(
    getDraftPostUrl({ post_id: 'xyz987' }),
    'https://sora.chatgpt.com/p/xyz987'
  );
});

test('canTrimDraft and getDraftTrimUrl support storyboard and draft fallback', () => {
  assert.equal(canTrimDraft({ id: 'd1', storyboard_id: 'sb1' }), true);
  assert.equal(
    getDraftTrimUrl({ id: 'd1', storyboard_id: 'sb1' }),
    'https://sora.chatgpt.com/storyboard/sb1'
  );
  assert.equal(canTrimDraft({ id: 'd2', can_storyboard: true }), true);
  assert.equal(
    getDraftTrimUrl({ id: 'd2', can_storyboard: true }),
    'https://sora.chatgpt.com/d/d2'
  );
  assert.equal(canTrimDraft({ id: 'd3', can_storyboard: false }), false);
});

test('gens helpers clamp according to ultra mode limits', () => {
  assert.equal(GENS_COUNT_MIN, 1);
  assert.equal(GENS_COUNT_MAX_DEFAULT, 10);
  assert.equal(GENS_COUNT_MAX_ULTRA, 40);
  assert.equal(getGensCountMax(false), 10);
  assert.equal(getGensCountMax(true), 40);
  assert.equal(clampGensCount(0, false), 1);
  assert.equal(clampGensCount(11, false), 10);
  assert.equal(clampGensCount(39.6, true), 40);
});

test('draft kind helpers treat violation/processing kinds as always old', () => {
  assert.equal(isDraftAlwaysOld({ kind: 'sora_content_violation' }), true);
  assert.equal(isDraftAlwaysOld({ kind: 'sora_context_violation' }), true);
  assert.equal(isDraftAlwaysOld({ kind: 'sora_processing_error' }), true);
  assert.equal(isDraftAlwaysOld({ kind: 'policy_violation' }), true);
  assert.equal(isDraftAlwaysOld({ violation_reason: 'Blocked by safety policy' }), true);
  assert.equal(isDraftAlwaysOld({ violation_reason: 'processing timeout', preview_url: '/x.mp4' }), false);
  assert.equal(isDraftAlwaysOld({ kind: 'sora_draft' }), false);

  assert.equal(isDraftUnread({ kind: 'sora_content_violation', is_read: false }), false);
  assert.equal(isDraftUnread({ kind: 'sora_processing_error', is_read: false }), false);
  assert.equal(isDraftUnread({ kind: 'sora_draft', is_read: false }), true);
});

test('pending helpers flatten v2 task payload into generation items with inherited prompt', () => {
  const payload = [
    {
      id: 'task_1',
      status: 'PENDING',
      prompt: 'robot dance',
      generations: [
        { id: 'gen_1', creation_config: { n_frames: 300 } },
        { generation_id: 'gen_2', prompt: '', creation_config: {} },
      ],
    },
  ];

  const out = flattenPendingV2Payload(payload);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'gen_1');
  assert.equal(out[0].task_id, 'task_1');
  assert.equal(out[0].creation_config.prompt, 'robot dance');
  assert.equal(out[0].is_pending, true);
  assert.equal(out[0].pending_status, 'pending');
  assert.equal(out[1].id, 'gen_2');
  assert.equal(out[1].creation_config.prompt, 'robot dance');
});

test('pending helpers support object payload wrappers and dropped-id detection', () => {
  const payload = {
    items: [
      { id: 'task_2', status: 'pending', generations: [{ draft_id: 'draft_1' }] },
      { id: 'task_3', status: 'pending', generations: [{ id: 'gen_3' }] },
    ],
  };
  const out = flattenPendingV2Payload(payload);
  assert.deepEqual(out.map((item) => item.id), ['draft_1', 'gen_3']);
  assert.equal(looksLikePendingV2Task(payload.items[0]), true);
  assert.deepEqual(getDroppedIds(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), ['a']);
});

test('pending helpers ignore non-pending statuses', () => {
  const payload = {
    items: [
      { id: 'task_pending', status: 'pending', generations: [{ id: 'gen_pending' }] },
      { id: 'task_done', status: 'completed', generations: [{ id: 'gen_done' }] },
      { id: 'task_failed', status: 'failed', generations: [{ id: 'gen_failed' }] },
    ],
  };
  const out = flattenPendingV2Payload(payload);
  assert.deepEqual(out.map((item) => item.id), ['gen_pending']);
});

test('pending helpers use task itself when generations array is empty (preprocessing/queued)', () => {
  const payload = [
    {
      id: 'task_early',
      status: 'preprocessing',
      prompt: 'test prompt',
      generations: [],
      creation_config: { orientation: 'portrait', n_frames: 300 },
      width: 352,
      height: 640,
    },
    {
      id: 'task_queued',
      status: 'queued',
      prompt: 'another prompt',
      generations: [],
    },
  ];

  const out = flattenPendingV2Payload(payload);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'task_early');
  assert.equal(out[0].task_id, 'task_early');
  assert.equal(out[0].prompt, 'test prompt');
  assert.equal(out[0].is_pending, true);
  assert.equal(out[0].pending_status, 'preprocessing');
  assert.equal(out[0].creation_config.prompt, 'test prompt');
  assert.equal(out[1].id, 'task_queued');
  assert.equal(out[1].pending_status, 'queued');
});

test('pending helpers show empty-generation tasks regardless of status', () => {
  const payload = [
    { id: 'task_a', status: 'completed', prompt: 'done', generations: [] },
    { id: 'task_b', status: 'running', prompt: 'active', generations: [] },
    { id: 'task_c', status: 'unknown_status', prompt: 'mystery', generations: [] },
  ];
  const out = flattenPendingV2Payload(payload);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(d => d.id), ['task_a', 'task_b', 'task_c']);
});

test('pending helpers keep generation-level pending even if task status differs', () => {
  const payload = [
    {
      id: 'task_mixed',
      status: 'completed',
      generations: [
        { id: 'gen_keep', status: 'running' },
        { id: 'gen_drop', status: 'completed' },
      ],
    },
  ];
  const out = flattenPendingV2Payload(payload);
  assert.deepEqual(out.map((item) => item.id), ['gen_keep']);
  assert.equal(out[0].pending_status, 'running');
});
