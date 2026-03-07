const baseTest = require('node:test');
const assert = require('node:assert/strict');

const createUVDraftsPageModule = require('../uv-drafts-page.js');
const test = createUVDraftsPageModule.__test ? baseTest : baseTest.skip;

const {
  getComposerModelFamily,
  resolveComposerModelValue,
  buildPublicPostPayload,
  FIRST_FRAME_UPLOAD_USE_CASE,
  buildFirstFrameInpaintItems,
  extractPublishedPost,
  resolveDraftPostData,
  applyPublishedPostToDraftData,
  extractRemixTargetPostId,
  extractPublishedPostGenerationId,
  buildComposerSourceFromPublishedPost,
  isLargeComposerSizeAllowed,
  normalizeComposerSizeForModel,
  parseComposerGensInputValue,
  extractPersistedGensCountValue,
  resolvePreferredComposerGensCountValue,
  extractPersistedComposerPromptValue,
  resolvePreferredComposerPromptValue,
  filterDraftsByWorkspace,
  isDraftVisibleInBookmarkedFilter,
  isDraftVisibleInFilterState,
  slugifyWorkspaceName,
  getWorkspaceUrlSlug,
  findWorkspaceIdByUrlSlug,
  extractWorkspaceSlugFromCreatortoolsPath,
  buildCreatortoolsPathForWorkspace,
  getDraftWorkspaceBadgeLabel,
  getUVDraftsPageTitle,
  formatWorkspaceSlugForTitle,
  getUVDraftsDocumentTitle,
  normalizeDraftOrientationValue,
  extractDraftDimensions,
  resolveDraftOrientationValue,
  getDraftCardVideoObjectFit,
  applyDraftCardVideoFullscreenPresentation,
  getDraftOrientationForLayout,
  getDraftCardPaddingTop,
  getDraftCardLayoutStyle,
  getUVDraftsViewportRerenderTargetCount,
  shouldGroupLandscapeDraftCard,
  getLandscapeRunChunkPlan,
  planLandscapeRunChunks,
  planDraftGridRows,
  extendDraftRenderEndToRowBoundary,
  extendLandscapeRunRenderEnd,
  isGenerationDraftId,
  resolvePendingPollState,
  buildPendingCompletionHandoffPlan,
  extractErrorMessage,
} = createUVDraftsPageModule.__test || {};

test('composer model helpers resolve legacy aliases onto canonical backend IDs', () => {
  const models = [
    { value: 'sy_8_20251208', label: 'Sora 2' },
    { value: 'sy_ore', label: 'Sora 2 Pro' },
  ];

  assert.equal(getComposerModelFamily('sora2'), 'sy_8');
  assert.equal(getComposerModelFamily('sora2pro'), 'sy_ore');
  assert.equal(resolveComposerModelValue(models, 'sora2'), 'sy_8_20251208');
  assert.equal(resolveComposerModelValue(models, 'sy_8'), 'sy_8_20251208');
  assert.equal(resolveComposerModelValue(models, 'sora2pro'), 'sy_ore');
  assert.equal(resolveComposerModelValue(models, 'sy_ore'), 'sy_ore');
});

test('buildPublicPostPayload uses the documented share payload shape', () => {
  assert.deepEqual(buildPublicPostPayload('gen_123', 'hello world'), {
    post_text: 'hello world',
    attachments_to_create: [
      {
        kind: 'sora',
        generation_id: 'gen_123',
      },
    ],
    destinations: [{ type: 'public' }],
  });
});

test('first frame uploads use the project_y inpaint_safe flow and file inpaint items', () => {
  assert.equal(FIRST_FRAME_UPLOAD_USE_CASE, 'inpaint_safe');
  assert.deepEqual(buildFirstFrameInpaintItems(' file_123 '), [
    {
      kind: 'file',
      file_id: 'file_123',
      frames: null,
      entity: null,
    },
  ]);
  assert.deepEqual(buildFirstFrameInpaintItems(''), []);
});

test('extractPublishedPost accepts nested post responses', () => {
  const payload = {
    item: {
      post: {
        id: 's_123',
        permalink: '/p/s_123',
      },
    },
  };

  assert.deepEqual(extractPublishedPost(payload), {
    id: 's_123',
    permalink: '/p/s_123',
  });
});

test('applyPublishedPostToDraftData marks drafts public and clears scheduled state', () => {
  const draft = {
    id: 'gen_123',
    scheduled_post_id: 'schedule_gen_123',
    scheduled_post_at: 123456789,
    scheduled_post_status: 'pending',
    scheduled_post_caption: 'queued caption',
    post_meta: {
      share_ref: 'old_ref',
    },
  };

  const updated = applyPublishedPostToDraftData(draft, {
    id: 's_123',
    permalink: '/p/s_123',
    share_ref: 'share_ref_1',
    permissions: { share_setting: 'public' },
  });

  assert.equal(updated.post_id, 's_123');
  assert.equal(updated.post_permalink, '/p/s_123');
  assert.equal(updated.post_visibility, 'public');
  assert.equal(updated.posted_to_public, true);
  assert.deepEqual(updated.post_meta, {
    id: 's_123',
    permalink: '/p/s_123',
    visibility: 'public',
    posted_to_public: true,
    share_ref: 'share_ref_1',
    share_setting: 'public',
  });
  assert.equal('scheduled_post_id' in updated, false);
  assert.equal('scheduled_post_at' in updated, false);
  assert.equal('scheduled_post_status' in updated, false);
  assert.equal('scheduled_post_caption' in updated, false);
});

test('resolveDraftPostData unwraps nested draft post payloads so shared drafts keep their post link', () => {
  const resolved = resolveDraftPostData({
    post_visibility: 'unlisted',
    post: {
      post: {
        id: 's_69a61668303c8191885cdaae108cf702',
        permalink: 'https://sora.chatgpt.com/p/s_69a61668303c8191885cdaae108cf702',
        posted_to_public: false,
        share_ref: 'share_ref_123',
        permissions: { share_setting: 'public' },
      },
    },
  });

  assert.equal(resolved.postId, 's_69a61668303c8191885cdaae108cf702');
  assert.equal(resolved.postPermalink, 'https://sora.chatgpt.com/p/s_69a61668303c8191885cdaae108cf702');
  assert.equal(resolved.postVisibility, 'unlisted');
  assert.equal(resolved.postedToPublic, false);
  assert.deepEqual(resolved.postMeta, {
    id: 's_69a61668303c8191885cdaae108cf702',
    permalink: 'https://sora.chatgpt.com/p/s_69a61668303c8191885cdaae108cf702',
    visibility: 'unlisted',
    posted_to_public: false,
    share_ref: 'share_ref_123',
    share_setting: 'public',
  });
});

test('extractRemixTargetPostId prefers nested published remix targets from draft payloads', () => {
  const apiDraft = {
    creation_config: {
      remix_target_post: {
        post: {
          id: 's_parent_123',
        },
      },
    },
  };

  assert.equal(extractRemixTargetPostId(apiDraft), 's_parent_123');
  assert.equal(extractRemixTargetPostId({}, { remix_target_post_id: 's_existing_456' }), 's_existing_456');
  assert.equal(extractRemixTargetPostId({ creation_config: { remix_target_post: { id: 'gen_parent_789' } } }), 'gen_parent_789');
});

test('buildComposerSourceFromPublishedPost preserves post media and any embedded generation ID', () => {
  const source = buildComposerSourceFromPublishedPost({
    id: 's_parent_123',
    post_text: 'Remix this published clip',
    attachments: [
      {
        generation_id: 'gen_parent_123',
        width: 640,
        height: 360,
        n_frames: 300,
        encodings: {
          source: { path: 'https://videos.openai.com/source.mp4' },
          thumbnail: { path: 'https://videos.openai.com/thumb.jpg' },
        },
      },
    ],
  });

  assert.equal(extractPublishedPostGenerationId({ attachments: [{ generation_id: 'gen_parent_123' }] }), 'gen_parent_123');
  assert.deepEqual(source, {
    type: 'post',
    id: 'gen_parent_123',
    post_id: 's_parent_123',
    storyboard_id: '',
    can_storyboard: false,
    prompt: 'Remix this published clip',
    title: '',
    url: 'https://videos.openai.com/source.mp4',
    preview_url: 'https://videos.openai.com/source.mp4',
    thumbnail_url: 'https://videos.openai.com/thumb.jpg',
    orientation: 'landscape',
    duration_seconds: 10,
    cameo_profiles: [],
    label: 'Remix this published clip',
  });
});

test('large size is restricted to Sora 2 Pro unless ultra mode is enabled', () => {
  assert.equal(isGenerationDraftId('gen_123'), true);
  assert.equal(isGenerationDraftId('s_123'), false);
  assert.equal(isLargeComposerSizeAllowed('sy_ore', false), true);
  assert.equal(isLargeComposerSizeAllowed('sy_8', false), false);
  assert.equal(isLargeComposerSizeAllowed('sy_8', true), true);
  assert.equal(normalizeComposerSizeForModel('large', 'sy_ore', false), 'large');
  assert.equal(normalizeComposerSizeForModel('large', 'sy_8', false), 'small');
  assert.equal(normalizeComposerSizeForModel('large', 'sy_8', true), 'large');
});

test('gens input parser allows empty editing states without forcing a value', () => {
  assert.equal(parseComposerGensInputValue(''), null);
  assert.equal(parseComposerGensInputValue('   '), null);
  assert.equal(parseComposerGensInputValue('4'), 4);
  assert.equal(parseComposerGensInputValue(7), 7);
  assert.equal(parseComposerGensInputValue('abc'), null);
});

test('stored gens value wins on load, but live composer edits still take effect', () => {
  assert.equal(extractPersistedGensCountValue(null), null);
  assert.equal(extractPersistedGensCountValue('{"count":4,"setAt":123}'), 4);
  assert.equal(extractPersistedGensCountValue('7'), 7);
  assert.equal(resolvePreferredComposerGensCountValue(1, 4, true), 4);
  assert.equal(resolvePreferredComposerGensCountValue(4, 1, false), 4);
  assert.equal(resolvePreferredComposerGensCountValue(null, 4, false), 4);
  assert.equal(resolvePreferredComposerGensCountValue('3', null, false), 3);
});

test('stored prompt value wins on load, but live prompt edits still take effect', () => {
  assert.equal(extractPersistedComposerPromptValue(null), null);
  assert.equal(extractPersistedComposerPromptValue('{"prompt":"Saved prompt","setAt":123}'), 'Saved prompt');
  assert.equal(extractPersistedComposerPromptValue('"String prompt"'), 'String prompt');
  assert.equal(resolvePreferredComposerPromptValue('Stale prompt', 'Saved prompt', true), 'Saved prompt');
  assert.equal(resolvePreferredComposerPromptValue('Typed prompt', 'Saved prompt', false), 'Typed prompt');
  assert.equal(resolvePreferredComposerPromptValue(null, 'Saved prompt', false), 'Saved prompt');
});

test('workspace badge label only shows in all-workspaces view when the workspace name is known', () => {
  const resolveWorkspaceName = (id) => ({ ws_music: 'Music Lab' }[id] || '');

  assert.equal(
    getDraftWorkspaceBadgeLabel({ workspace_id: 'ws_music' }, null, resolveWorkspaceName),
    'Music Lab'
  );
  assert.equal(
    getDraftWorkspaceBadgeLabel({ workspace_id: 'ws_music' }, '', resolveWorkspaceName),
    'Music Lab'
  );
  assert.equal(
    getDraftWorkspaceBadgeLabel({ workspace_id: 'ws_music' }, 'ws_music', resolveWorkspaceName),
    ''
  );
  assert.equal(
    getDraftWorkspaceBadgeLabel({ workspace_id: 'ws_unknown' }, null, resolveWorkspaceName),
    ''
  );
});

test('drafts page title uses the current workspace name when filtered to a workspace', () => {
  const resolveWorkspaceName = (id) => ({ ws_music: 'Music Lab' }[id] || '');

  assert.equal(getUVDraftsPageTitle(null, resolveWorkspaceName), 'My Drafts');
  assert.equal(getUVDraftsPageTitle('', resolveWorkspaceName), 'My Drafts');
  assert.equal(getUVDraftsPageTitle('ws_music', resolveWorkspaceName), 'Music Lab');
  assert.equal(getUVDraftsPageTitle('ws_unknown', resolveWorkspaceName), 'My Drafts');
});

test('drafts document title uses workspace name and falls back to the creatortools slug', () => {
  const resolveWorkspaceName = (id) => ({ ws_music: 'Music Lab' }[id] || '');

  assert.equal(formatWorkspaceSlugForTitle('food-travel'), 'Food Travel');
  assert.equal(getUVDraftsDocumentTitle('ws_music', resolveWorkspaceName, '/creatortools/music-lab'), 'Music Lab - Sora');
  assert.equal(getUVDraftsDocumentTitle('ws_unknown', resolveWorkspaceName, '/creatortools/selfies'), 'Selfies - Sora');
  assert.equal(getUVDraftsDocumentTitle(null, resolveWorkspaceName, '/creatortools'), 'My Drafts - Sora');
});

test('workspace draft filtering scopes stats and grid data to the active workspace', () => {
  const drafts = [
    { id: 'd1', workspace_id: 'ws_selfies' },
    { id: 'd2', workspace_id: 'ws_food' },
    { id: 'd3', workspace_id: 'ws_selfies' },
    { id: 'd4', workspace_id: null },
  ];

  assert.deepEqual(
    filterDraftsByWorkspace(drafts, 'ws_selfies').map((draft) => draft.id),
    ['d1', 'd3']
  );
  assert.deepEqual(
    filterDraftsByWorkspace(drafts, '').map((draft) => draft.id),
    ['d1', 'd2', 'd3', 'd4']
  );
});

test('bookmarked filter excludes hidden drafts even when they are bookmarked or newly seen', () => {
  const bookmarks = new Set(['draft_hidden_bookmark', 'draft_visible_bookmark']);
  const justSeen = new Set(['draft_hidden_seen', 'draft_visible_seen']);

  assert.equal(
    isDraftVisibleInBookmarkedFilter({ id: 'draft_hidden_bookmark', hidden: true }, bookmarks, justSeen),
    false
  );
  assert.equal(
    isDraftVisibleInBookmarkedFilter({ id: 'draft_hidden_seen', hidden: true, is_read: false }, bookmarks, justSeen),
    false
  );
  assert.equal(
    isDraftVisibleInBookmarkedFilter({ id: 'draft_visible_bookmark', hidden: false }, bookmarks, justSeen),
    true
  );
  assert.equal(
    isDraftVisibleInBookmarkedFilter({ id: 'draft_visible_seen', hidden: false, is_read: false }, bookmarks, justSeen),
    true
  );
  assert.equal(
    isDraftVisibleInBookmarkedFilter({ id: 'draft_visible_new', hidden: false, is_read: false }, bookmarks, justSeen, true),
    true
  );
});

test('hidden drafts stay out of non-hidden views and move into the hidden view', () => {
  assert.equal(
    isDraftVisibleInFilterState({ id: 'draft_hidden', hidden: true }, 'all'),
    false
  );
  assert.equal(
    isDraftVisibleInFilterState({ id: 'draft_hidden_new', hidden: true, is_read: false }, 'new'),
    false
  );
  assert.equal(
    isDraftVisibleInFilterState({ id: 'draft_hidden_violation', hidden: true, kind: 'sora_content_violation' }, 'violations'),
    false
  );
  assert.equal(
    isDraftVisibleInFilterState({ id: 'draft_hidden_unsynced', hidden: true, is_unsynced: true }, 'unsynced'),
    false
  );
  assert.equal(
    isDraftVisibleInFilterState({ id: 'draft_hidden_tab', hidden: true, is_unsynced: true }, 'hidden'),
    true
  );
  assert.equal(
    isDraftVisibleInFilterState({ id: 'draft_visible_hidden_tab', hidden: false }, 'hidden'),
    false
  );
});

test('workspace URL helpers build stable slugs and creatortools paths', () => {
  const workspaces = [
    { id: 'ws_selfies_a', name: 'Selfies' },
    { id: 'ws_selfies_b', name: 'Selfies' },
    { id: 'ws_food', name: 'Food & Travel' },
  ];

  assert.equal(slugifyWorkspaceName(' Food & Travel '), 'food-travel');
  assert.equal(getWorkspaceUrlSlug(workspaces[0], workspaces), 'selfies');
  assert.equal(getWorkspaceUrlSlug(workspaces[1], workspaces), 'selfies-2');
  assert.equal(getWorkspaceUrlSlug(workspaces[2], workspaces), 'food-travel');
  assert.equal(findWorkspaceIdByUrlSlug('selfies', workspaces), 'ws_selfies_a');
  assert.equal(findWorkspaceIdByUrlSlug('selfies-2', workspaces), 'ws_selfies_b');
  assert.equal(findWorkspaceIdByUrlSlug('food-travel', workspaces), 'ws_food');
  assert.equal(findWorkspaceIdByUrlSlug('ws_food', workspaces), 'ws_food');
  assert.equal(buildCreatortoolsPathForWorkspace(null, workspaces), '/creatortools');
  assert.equal(buildCreatortoolsPathForWorkspace('ws_selfies_b', workspaces), '/creatortools/selfies-2');
  assert.equal(buildCreatortoolsPathForWorkspace('ws_food', workspaces), '/creatortools/food-travel');
});

test('creatortools path parser extracts workspace slug for direct links', () => {
  assert.equal(extractWorkspaceSlugFromCreatortoolsPath('/creatortools'), '');
  assert.equal(extractWorkspaceSlugFromCreatortoolsPath('/creatortools/selfies'), 'selfies');
  assert.equal(extractWorkspaceSlugFromCreatortoolsPath('/creatortools/Food%20Travel'), 'food travel');
  assert.equal(extractWorkspaceSlugFromCreatortoolsPath('/profile/test'), null);
});

test('landscape cards group only inside consecutive landscape runs', () => {
  const drafts = [
    { id: 'l1', orientation: 'landscape' },
    { id: 'l2', width: 1280, height: 720 },
    { id: 'l3', orientation: 'landscape_16_9' },
    { id: 'l4', orientation: 'landscape' },
    { id: 'l5', orientation: 'landscape' },
    { id: 'p1', orientation: 'portrait' },
    { id: 'l6', orientation: 'landscape' },
    { id: 'p2', width: 720, height: 1280 },
  ];

  assert.equal(getDraftOrientationForLayout(drafts[0]), 'landscape');
  assert.equal(getDraftOrientationForLayout(drafts[1]), 'landscape');
  assert.equal(getDraftOrientationForLayout(drafts[7]), 'portrait');
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 0), true);
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 1), true);
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 4), true);
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 5), false);
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 6), false);
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 7), false);
  assert.equal(extendLandscapeRunRenderEnd(drafts, 1, 4), 5);
  assert.equal(extendLandscapeRunRenderEnd(drafts, 3, 4), 5);
  assert.equal(extendLandscapeRunRenderEnd(drafts, 3, 2), 4);
  assert.equal(extendLandscapeRunRenderEnd(drafts, 5, 4), 5);
});

test('blocked landscape drafts stay full height and break landscape runs', () => {
  const drafts = [
    { id: 'blocked', orientation: 'landscape', status: 'content_violation', reason: 'Policy blocked' },
    { id: 'l1', orientation: 'landscape' },
    { id: 'l2', orientation: 'landscape' },
    { id: 'l3', orientation: 'landscape' },
    { id: 'l4', orientation: 'landscape' },
    { id: 'l5', orientation: 'landscape' },
    { id: 'l6', orientation: 'landscape' },
    { id: 'p1', orientation: 'portrait' },
  ];

  assert.equal(shouldGroupLandscapeDraftCard(drafts, 0), false);
  assert.equal(shouldGroupLandscapeDraftCard(drafts, 1), true);
  assert.deepEqual(
    planDraftGridRows(drafts, 5),
    [
      [
        { kind: 'card', span: 1, draftIds: ['blocked'] },
        { kind: 'landscape-run', span: 3, draftIds: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'] },
        { kind: 'card', span: 1, draftIds: ['p1'] },
      ],
    ]
  );
});

test('multiple blocked landscape drafts do not collapse into a half-height run', () => {
  const drafts = [
    { id: 'blocked1', orientation: 'landscape', status: 'content_violation', reason: 'Policy blocked' },
    { id: 'blocked2', orientation: 'landscape', status: 'content_violation', reason: 'Policy blocked' },
    { id: 'l1', orientation: 'landscape' },
    { id: 'l2', orientation: 'landscape' },
    { id: 'p1', orientation: 'portrait' },
  ];

  assert.deepEqual(
    planDraftGridRows(drafts, 5),
    [
      [
        { kind: 'card', span: 1, draftIds: ['blocked1'] },
        { kind: 'card', span: 1, draftIds: ['blocked2'] },
        { kind: 'landscape-run', span: 1, draftIds: ['l1', 'l2'] },
        { kind: 'card', span: 1, draftIds: ['p1'] },
      ],
    ]
  );
});

test('processing error landscape drafts stay full height and break landscape runs', () => {
  const drafts = [
    { id: 'err', orientation: 'landscape', status: 'failed', failure_reason: 'Timeout talking to worker' },
    { id: 'l1', orientation: 'landscape' },
    { id: 'l2', orientation: 'landscape' },
    { id: 'p1', orientation: 'portrait' },
  ];

  assert.equal(shouldGroupLandscapeDraftCard(drafts, 0), false);
  assert.deepEqual(
    planDraftGridRows(drafts, 4),
    [
      [
        { kind: 'card', span: 1, draftIds: ['err'] },
        { kind: 'landscape-run', span: 1, draftIds: ['l1', 'l2'] },
        { kind: 'card', span: 1, draftIds: ['p1'] },
      ],
    ]
  );
});

test('draft card padding uses normalized orientation while placeholders stay full height', () => {
  assert.equal(getDraftCardPaddingTop({ orientation: 'landscape' }), '56.25%');
  assert.equal(getDraftCardPaddingTop({ width: 1280, height: 720 }), '56.25%');
  assert.equal(getDraftCardPaddingTop({ orientation: 'portrait' }), '177.78%');
  assert.equal(getDraftCardPaddingTop({ orientation: 'landscape' }, true), '177.78%');
});

test('draft card layout keeps cards top-aligned while portraits stay full height', () => {
  assert.deepEqual(getDraftCardLayoutStyle({ orientation: 'portrait' }), {
    alignSelf: 'start',
    paddingTop: '177.78%',
  });
  assert.deepEqual(getDraftCardLayoutStyle({ orientation: 'landscape' }), {
    alignSelf: 'start',
    paddingTop: '56.25%',
  });
  assert.deepEqual(getDraftCardLayoutStyle({ orientation: 'landscape' }, true), {
    alignSelf: 'start',
    paddingTop: '177.78%',
  });
});

test('viewport rerenders preserve the currently loaded draft depth instead of collapsing to the first batch', () => {
  assert.equal(getUVDraftsViewportRerenderTargetCount(300, 180), 180);
  assert.equal(getUVDraftsViewportRerenderTargetCount(180, 300), 180);
  assert.equal(getUVDraftsViewportRerenderTargetCount(24, 0), 24);
  assert.equal(getUVDraftsViewportRerenderTargetCount(0, 180), 0);
});

test('fullscreen draft video presentation switches portrait playback from cover to contain', () => {
  const video = { style: {}, ownerDocument: { fullscreenElement: null } };

  assert.equal(getDraftCardVideoObjectFit(false), 'cover');
  assert.equal(getDraftCardVideoObjectFit(true), 'contain');

  assert.equal(applyDraftCardVideoFullscreenPresentation(video, video.ownerDocument), false);
  assert.equal(video.style.objectFit, 'cover');
  assert.equal(video.style.background, '');

  video.ownerDocument.fullscreenElement = video;
  assert.equal(applyDraftCardVideoFullscreenPresentation(video, video.ownerDocument), true);
  assert.equal(video.style.objectFit, 'contain');
  assert.equal(video.style.background, '#000');
});

test('landscape run planner packs multiple items as half-height pairs by column', () => {
  assert.deepEqual(
    getLandscapeRunChunkPlan(4, 4, 0),
    { columnSpan: 2, chunkLength: 4 }
  );
  assert.deepEqual(
    getLandscapeRunChunkPlan(5, 4, 0),
    { columnSpan: 3, chunkLength: 5 }
  );
  assert.deepEqual(
    getLandscapeRunChunkPlan(3, 4, 2),
    { columnSpan: 2, chunkLength: 3 }
  );
  assert.deepEqual(
    getLandscapeRunChunkPlan(2, 4, 2),
    { columnSpan: 1, chunkLength: 2 }
  );
  assert.deepEqual(
    getLandscapeRunChunkPlan(2, 4, 3),
    { columnSpan: 1, chunkLength: 2 }
  );
});

test('landscape run chunk sequences avoid multi-slot holes and keep portrait-sized columns stable', () => {
  assert.deepEqual(
    planLandscapeRunChunks(10, 6, 2),
    [
      { columnSpan: 4, chunkLength: 8 },
      { columnSpan: 1, chunkLength: 2 },
    ]
  );

  for (let maxColumns = 2; maxColumns <= 6; maxColumns += 1) {
    for (let rowFill = 0; rowFill < maxColumns; rowFill += 1) {
      for (let runLength = 1; runLength <= 24; runLength += 1) {
        const chunks = planLandscapeRunChunks(runLength, maxColumns, rowFill);
        const totalChunkLength = chunks.reduce((sum, chunk) => sum + chunk.chunkLength, 0);
        assert.equal(totalChunkLength, runLength);

        let localRowFill = rowFill;
        for (const chunk of chunks) {
          const availableColumns = localRowFill > 0 ? (maxColumns - localRowFill) : maxColumns;
          assert.ok(chunk.columnSpan >= 1 && chunk.columnSpan <= availableColumns);
          assert.ok(chunk.chunkLength >= 1 && chunk.chunkLength <= chunk.columnSpan * 2);
          assert.ok((chunk.columnSpan * 2) - chunk.chunkLength <= 1);
          localRowFill = (localRowFill + chunk.columnSpan) % maxColumns;
        }
      }
    }
  }
});

test('row planner keeps a trailing portrait in the same full-height row after a completed landscape block', () => {
  const drafts = [
    { id: 'p-left', orientation: 'portrait' },
    { id: 'l1', orientation: 'landscape' },
    { id: 'l2', orientation: 'landscape' },
    { id: 'l3', orientation: 'landscape' },
    { id: 'l4', orientation: 'landscape' },
    { id: 'l5', orientation: 'landscape' },
    { id: 'l6', orientation: 'landscape' },
    { id: 'p-right', orientation: 'portrait' },
  ];

  assert.deepEqual(
    planDraftGridRows(drafts, 5),
    [
      [
        { kind: 'card', span: 1, draftIds: ['p-left'] },
        { kind: 'landscape-run', span: 3, draftIds: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'] },
        { kind: 'card', span: 1, draftIds: ['p-right'] },
      ],
    ]
  );
});

test('row planner uses all remaining row slots before wrapping a long landscape run', () => {
  const drafts = [
    { id: 'p-left', orientation: 'portrait' },
    { id: 'l1', orientation: 'landscape' },
    { id: 'l2', orientation: 'landscape' },
    { id: 'l3', orientation: 'landscape' },
    { id: 'l4', orientation: 'landscape' },
    { id: 'l5', orientation: 'landscape' },
    { id: 'l6', orientation: 'landscape' },
    { id: 'l7', orientation: 'landscape' },
    { id: 'l8', orientation: 'landscape' },
    { id: 'l9', orientation: 'landscape' },
    { id: 'l10', orientation: 'landscape' },
  ];

  assert.deepEqual(
    planDraftGridRows(drafts, 5),
    [
      [
        { kind: 'card', span: 1, draftIds: ['p-left'] },
        { kind: 'landscape-run', span: 4, draftIds: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'] },
      ],
      [
        { kind: 'landscape-run', span: 1, draftIds: ['l9', 'l10'] },
      ],
    ]
  );

  assert.equal(extendDraftRenderEndToRowBoundary(drafts, 6, 5), 9);
});

test('partial draft updates preserve existing landscape dimensions and orientation', () => {
  const existingDraft = {
    id: 'gen_landscape_1',
    width: 1280,
    height: 720,
    orientation: 'landscape',
    preview_url: 'https://videos.openai.com/existing.mp4',
    thumbnail_url: 'https://videos.openai.com/existing.jpg',
  };

  const partialDraft = {
    id: 'gen_landscape_1',
    prompt: 'same draft, partial payload',
    creation_config: {},
  };

  assert.equal(normalizeDraftOrientationValue('landscape_16_9'), 'landscape');
  assert.equal(normalizeDraftOrientationValue('portrait-9-16'), 'portrait');
  assert.deepEqual(extractDraftDimensions(partialDraft, existingDraft), { width: 1280, height: 720 });
  assert.equal(resolveDraftOrientationValue(partialDraft, existingDraft), 'landscape');
});

test('extractErrorMessage prefers nested backend message fields over object stringification', () => {
  assert.equal(
    extractErrorMessage({ error: { message: 'Rate limit exceeded' } }),
    'Rate limit exceeded'
  );
  assert.equal(
    extractErrorMessage({ detail: { message: 'Model not allowed' } }),
    'Model not allowed'
  );
  assert.match(
    extractErrorMessage({ error: { code: 'bad_request' } }, 'Unknown error'),
    /bad_request/
  );
});

test('resolvePendingPollState keeps dropped pending drafts visible as Complete until the draft appears', () => {
  const state = resolvePendingPollState(
    [
      {
        id: 'gen_drop_1',
        prompt: 'slow reveal',
        pending_status: 'running',
        pending_task_status: 'running',
        progress_pct: 72,
        is_pending: true,
      },
    ],
    new Set(['gen_drop_1']),
    [],
    []
  );

  assert.deepEqual(state.droppedIds, ['gen_drop_1']);
  assert.deepEqual(Array.from(state.endpointIds), []);
  assert.deepEqual(Array.from(state.visibleIds), ['gen_drop_1']);
  assert.equal(state.requiresTopRefresh, true);
  assert.deepEqual(state.visibleDrafts, [
    {
      id: 'gen_drop_1',
      prompt: 'slow reveal',
      pending_status: 'complete',
      pending_task_status: 'complete',
      progress_pct: 100,
      is_pending: true,
      pending_completion_waiting: true,
    },
  ]);
});

test('resolvePendingPollState removes completion placeholders once the matching draft is in drafts', () => {
  const state = resolvePendingPollState(
    [
      {
        id: 'gen_done_1',
        prompt: 'ocean sunset',
        pending_status: 'complete',
        pending_task_status: 'complete',
        progress_pct: 100,
        is_pending: true,
        pending_completion_waiting: true,
      },
    ],
    new Set(),
    [],
    [{ id: 'gen_done_1', prompt: 'ocean sunset' }]
  );

  assert.deepEqual(state.droppedIds, []);
  assert.deepEqual(Array.from(state.visibleIds), []);
  assert.deepEqual(state.visibleDrafts, []);
  assert.equal(state.requiresTopRefresh, false);
});

test('resolvePendingPollState removes completion placeholders when the finished draft matches by task_id', () => {
  const state = resolvePendingPollState(
    [
      {
        id: 'task_done_2',
        task_id: 'task_done_2',
        prompt: 'studio portrait',
        pending_status: 'complete',
        pending_task_status: 'complete',
        progress_pct: 100,
        is_pending: true,
        pending_completion_waiting: true,
      },
    ],
    new Set(),
    [],
    [{ id: 'gen_done_2', task_id: 'task_done_2', prompt: 'studio portrait' }]
  );

  assert.deepEqual(state.droppedIds, []);
  assert.deepEqual(Array.from(state.visibleIds), []);
  assert.deepEqual(state.visibleDrafts, []);
  assert.equal(state.requiresTopRefresh, false);
});

test('resolvePendingPollState does not synthesize a new completion card for a dropped id that was never visible', () => {
  const state = resolvePendingPollState(
    [],
    new Set(['gen_hidden_drop_1']),
    [],
    []
  );

  assert.deepEqual(state.droppedIds, ['gen_hidden_drop_1']);
  assert.deepEqual(Array.from(state.visibleIds), []);
  assert.deepEqual(state.visibleDrafts, []);
  assert.equal(state.requiresTopRefresh, true);
});

test('buildPendingCompletionHandoffPlan only replaces visible pending cards that now have real draft matches', () => {
  const handoffs = buildPendingCompletionHandoffPlan(
    [
      { id: 'gen_visible_1', task_id: 'task_visible_1', pending_completion_waiting: true },
      { id: 'gen_still_pending', task_id: 'task_still_pending', pending_completion_waiting: true },
    ],
    new Set(['gen_still_pending']),
    [
      { id: 'gen_real_1', task_id: 'task_visible_1', prompt: 'finished draft' },
      { id: 'gen_other', task_id: 'task_other', prompt: 'other draft' },
    ]
  );

  assert.deepEqual(handoffs.map((item) => [item.pendingId, item.settledId]), [
    ['gen_visible_1', 'gen_real_1'],
  ]);
});
