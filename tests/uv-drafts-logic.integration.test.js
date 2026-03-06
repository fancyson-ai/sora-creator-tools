const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeDraftListById,
  appendUniqueDrafts,
  removeDraftById,
  computeDraftStats,
  parseSearchQuery,
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
  isDraftPubliclyPosted,
  getDraftPostUrl,
  canTrimDraft,
  getDraftTrimUrl,
  clampGensCount,
  flattenPendingV2Payload,
  getDroppedIds,
} = require('../uv-drafts-logic.js');

test('integration: quick fetch merge + background sync + delete keeps state and stats consistent', () => {
  const cached = [
    { id: 'a', hidden: false, is_read: true },
    { id: 'b', hidden: true, is_read: false },
  ];

  const firstBatch = [
    { id: 'c', hidden: false, is_read: false },
    { id: 'a', hidden: false, is_read: true },
  ];

  const mergedAfterQuickFetch = mergeDraftListById(firstBatch, cached);
  assert.deepEqual(mergedAfterQuickFetch.map((d) => d.id), ['c', 'a', 'b']);

  const nextPage = [
    { id: 'b', hidden: true, is_read: false },
    { id: 'd', hidden: false, is_read: true },
    { id: 'e', hidden: false, is_read: false },
  ];

  const mergedAfterBackground = appendUniqueDrafts(mergedAfterQuickFetch, nextPage);
  assert.deepEqual(mergedAfterBackground.map((d) => d.id), ['c', 'a', 'b', 'd', 'e']);

  const bookmarks = new Set(['b', 'e', 'missing']);
  const justSeen = new Set(['c']);

  const beforeDeleteStats = computeDraftStats(mergedAfterBackground, bookmarks, justSeen);
  assert.deepEqual(beforeDeleteStats, {
    total: 5,
    bookmarked: 2,
    hidden: 1,
    newCount: 2,
  });

  const afterDelete = removeDraftById(mergedAfterBackground, 'b');
  assert.deepEqual(afterDelete.map((d) => d.id), ['c', 'a', 'd', 'e']);

  const afterDeleteStats = computeDraftStats(afterDelete, bookmarks, justSeen);
  assert.deepEqual(afterDeleteStats, {
    total: 4,
    bookmarked: 1,
    hidden: 0,
    newCount: 1,
  });
});

test('integration: advanced search + composer override payload work together', () => {
  const drafts = [
    { id: 'a', model: 'sora2', prompt: 'neon dancer', duration_seconds: 12, workspace_id: 'w1' },
    { id: 'b', model: 'sora2pro', prompt: 'forest walk', duration_seconds: 8, workspace_id: 'w1' },
    { id: 'c', model: 'sora2', prompt: 'neon skyline', duration_seconds: 20, workspace_id: 'w2' },
  ];
  const workspaceNames = { w1: 'Music Lab', w2: 'Travel' };
  const parsed = parseSearchQuery('ws:"Music Lab" model:sora2 dur:>=10 bookmarked:true "neon"');
  const bookmarks = new Set(['a']);

  const filtered = drafts.filter((draft) =>
    draftMatchesSearchQuery(draft, parsed, {
      bookmarks,
      resolveWorkspaceName: (id) => workspaceNames[id] || '',
    })
  );
  assert.deepEqual(filtered.map((d) => d.id), ['a']);

  const payload = JSON.stringify({
    body: JSON.stringify({
      prompt: 'old',
      creation_config: {},
    }),
    creation_config: {},
  });
  const overridden = applyCreateBodyOverrides(payload, {
    prompt: 'new neon prompt',
    model: 'sora2',
    orientation: 'portrait',
    size: 'high',
    style_id: 'music video',
    seed: '77',
  });
  const parsedPayload = JSON.parse(overridden);
  const parsedBody = JSON.parse(parsedPayload.body);

  assert.equal(parsedPayload.model, 'sora2');
  assert.equal(parsedPayload.creation_config.orientation, 'portrait');
  assert.equal(parsedBody.creation_config.style_id, 'music video');
  assert.equal(parsedBody.creation_config.seed, '77');
});

test('integration: queued prompts consume in order and apply to create payloads', () => {
  const parsed = parsePromptJsonl([
    '{"prompt":"first queued"}',
    '{"prompt":"second queued"}',
  ].join('\n'));
  let queue = normalizePromptQueueState({ prompts: parsed.prompts, index: 0, createdAt: 1 });
  const payload = JSON.stringify({ prompt: 'fallback', creation_config: {} });

  const first = consumeNextPrompt(queue);
  const firstBody = applyCreateBodyOverrides(payload, { prompt: first.prompt });
  const parsedFirst = JSON.parse(firstBody);
  assert.equal(parsedFirst.prompt, 'first queued');
  assert.equal(parsedFirst.creation_config.prompt, 'first queued');

  queue = first.queue;
  const second = consumeNextPrompt(queue);
  const secondBody = applyCreateBodyOverrides(payload, { prompt: second.prompt });
  const parsedSecond = JSON.parse(secondBody);
  assert.equal(parsedSecond.prompt, 'second queued');
  assert.equal(parsedSecond.creation_config.prompt, 'second queued');
  assert.equal(second.remaining, 0);
});

test('integration: queue browse/edit operations preserve expected prompt order', () => {
  const parsed = parsePromptJsonl([
    '{"prompt":"alpha"}',
    '{"prompt":"beta"}',
    '{"prompt":"gamma"}',
    '{"prompt":"delta"}',
  ].join('\n'));
  let queue = normalizePromptQueueState({ prompts: parsed.prompts, index: 0, selectedIndex: 0, createdAt: 7 });

  queue = setPromptQueueSelection(queue, 2);
  assert.equal(queue.selectedIndex, 2);
  assert.equal(String(queue.prompts[queue.selectedIndex]), 'gamma');

  queue = removePromptAtIndex(queue, 1);
  assert.deepEqual(queue.prompts, ['alpha', 'gamma', 'delta']);
  assert.equal(queue.selectedIndex, 1);
  assert.equal(String(queue.prompts[queue.selectedIndex]), 'gamma');
});

test('integration: batch totals derive from prompts multiplied by gens-per-prompt', () => {
  const parsed = parsePromptJsonl([
    '{"prompt":"p1"}',
    '{"prompt":"p2"}',
    '{"prompt":"p3"}',
  ].join('\n'));
  const queue = normalizePromptQueueState({ prompts: parsed.prompts, index: 0 });
  const gensPerPrompt = 4;
  const totalGenerationJobs = queue.remaining * gensPerPrompt;
  assert.equal(queue.remaining, 3);
  assert.equal(totalGenerationJobs, 12);
});

test('integration: success path advances queue while failure path keeps current prompt intact', () => {
  let queue = normalizePromptQueueState({
    prompts: ['first', 'second', 'third'],
    index: 0,
    selectedIndex: 0,
  });
  const payload = JSON.stringify({ prompt: 'fallback', creation_config: {} });

  const firstPeek = peekCurrentPrompt(queue);
  const firstBody = applyCreateBodyOverrides(payload, { prompt: firstPeek.prompt });
  assert.equal(JSON.parse(firstBody).prompt, 'first');
  const afterSuccess = advancePromptQueue(queue);
  queue = afterSuccess.queue;
  assert.equal(queue.index, 1);

  const secondPeek = peekCurrentPrompt(queue);
  const secondBody = applyCreateBodyOverrides(payload, { prompt: secondPeek.prompt });
  assert.equal(JSON.parse(secondBody).prompt, 'second');
  assert.equal(queue.index, 1);
  assert.equal(peekCurrentPrompt(queue).prompt, 'second');
});

test('integration: composer source gating stays aligned with compose/remix/extend modes', () => {
  const modes = ['compose', 'remix', 'extend'];
  const sourceRequired = modes.filter((mode) => modeRequiresComposerSource(mode));
  const sourceOptional = modes.filter((mode) => !modeRequiresComposerSource(mode));

  assert.deepEqual(sourceRequired, ['remix', 'extend']);
  assert.deepEqual(sourceOptional, ['compose']);
});

test('integration: draft metadata helpers align card behavior for post links, trim, and gens cap', () => {
  const privateSharedDraft = {
    id: 'd1',
    post_meta: { visibility: 'private', posted_to_public: false, permalink: '/p/private123' },
    can_storyboard: true,
  };
  const publicDraft = {
    id: 'd2',
    post_visibility: 'public',
    post_id: 'post_2',
    storyboard_id: 'sb_2',
  };

  assert.equal(isDraftPubliclyPosted(privateSharedDraft), false);
  assert.equal(isDraftPubliclyPosted(publicDraft), true);

  assert.equal(getDraftPostUrl(privateSharedDraft), 'https://sora.chatgpt.com/p/private123');
  assert.equal(getDraftPostUrl(publicDraft), 'https://sora.chatgpt.com/p/post_2');

  assert.equal(canTrimDraft(privateSharedDraft), true);
  assert.equal(getDraftTrimUrl(privateSharedDraft), 'https://sora.chatgpt.com/d/d1');
  assert.equal(getDraftTrimUrl(publicDraft), 'https://sora.chatgpt.com/storyboard/sb_2');

  assert.equal(clampGensCount(25, false), 10);
  assert.equal(clampGensCount(25, true), 25);
});

test('integration: new:true filter excludes violation and processing kinds', () => {
  const drafts = [
    { id: 'a', kind: 'sora_draft', is_read: false },
    { id: 'b', kind: 'sora_content_violation', is_read: false },
    { id: 'c', kind: 'sora_processing_error', is_read: false },
  ];
  const parsed = parseSearchQuery('new:true');
  const ids = drafts
    .filter((draft) => draftMatchesSearchQuery(draft, parsed, { resolveWorkspaceName: () => '', bookmarks: new Set() }))
    .map((draft) => draft.id);
  assert.deepEqual(ids, ['a']);
});

test('integration: pending list drop detection lines up with prepend + refresh trigger conditions', () => {
  const pendingV2 = [
    {
      id: 'task_pending_1',
      status: 'pending',
      prompt: 'slow pan over mountains',
      generations: [{ id: 'draft_pending_1', creation_config: {} }],
    },
    {
      id: 'task_pending_2',
      status: 'pending',
      prompt: 'city night timelapse',
      generations: [{ id: 'draft_pending_2', creation_config: {} }],
    },
  ];

  const roundOne = flattenPendingV2Payload(pendingV2).map((item) => item.id);
  assert.deepEqual(roundOne, ['draft_pending_1', 'draft_pending_2']);

  const roundTwo = flattenPendingV2Payload([
    {
      id: 'task_pending_2',
      status: 'pending',
      prompt: 'city night timelapse',
      generations: [{ id: 'draft_pending_2', creation_config: {} }],
    },
  ]).map((item) => item.id);

  const dropped = getDroppedIds(new Set(roundOne), new Set(roundTwo));
  assert.deepEqual(dropped, ['draft_pending_1']);
});

test('integration: pending list treats status transitions out of pending as dropped', () => {
  const before = flattenPendingV2Payload([
    {
      id: 'task_x',
      status: 'pending',
      generations: [{ id: 'draft_x' }],
    },
  ]).map((item) => item.id);

  const after = flattenPendingV2Payload([
    {
      id: 'task_x',
      status: 'completed',
      generations: [{ id: 'draft_x' }],
    },
  ]).map((item) => item.id);

  assert.deepEqual(after, []);
  assert.deepEqual(getDroppedIds(new Set(before), new Set(after)), ['draft_x']);
});
