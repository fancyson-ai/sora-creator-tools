/*
 * UV Drafts page module extracted from inject.js.
 */
(function initSoraUVDraftsPageModule(globalScope) {
  'use strict';

  function getComposerModelFamily(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!normalized) return '';
    if (normalized === 'sora2pro' || normalized === 'sy_ore' || normalized.startsWith('sy_ore_')) return 'sy_ore';
    if (normalized === 'sora2' || normalized === 'sy_8' || normalized.startsWith('sy_8_')) return 'sy_8';
    return '';
  }

  function composerModelMatchesFamily(model, family) {
    if (!model || typeof model !== 'object' || !family) return false;
    if (getComposerModelFamily(model.value) === family) return true;
    const label = typeof model.label === 'string' ? model.label : '';
    if (family === 'sy_ore') return /sora\s*2\s*pro/i.test(label);
    if (family === 'sy_8') return /sora\s*2(?!\s*pro)/i.test(label);
    return false;
  }

  function resolveComposerModelValue(models, value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return '';
    const available = Array.isArray(models) ? models : [];
    if (available.some((model) => model?.value === normalized)) return normalized;
    const family = getComposerModelFamily(normalized);
    if (!family) return '';
    return available.find((model) => composerModelMatchesFamily(model, family))?.value || '';
  }

  function buildPublicPostPayload(generationId, postText) {
    const id = typeof generationId === 'string' ? generationId.trim() : '';
    if (!id) throw new Error('Missing draft ID');
    return {
      post_text: typeof postText === 'string' ? postText : '',
      attachments_to_create: [
        {
          kind: 'sora',
          generation_id: id,
        },
      ],
      destinations: [{ type: 'public' }],
    };
  }

  function extractPublishedPost(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const candidates = [
      payload.post,
      payload.item?.post,
      payload.data?.post,
      Array.isArray(payload.items) ? payload.items[0]?.post || payload.items[0] : null,
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') return candidate;
    }
    if (payload.id || payload.permalink || payload.visibility || payload.post_text != null) return payload;
    return null;
  }

  function applyPublishedPostToDraftData(draft, publishedPost) {
    if (!draft || typeof draft !== 'object') return draft;
    const next = draft;
    const post = publishedPost && typeof publishedPost === 'object' ? publishedPost : {};
    const postId = post.id || next.post_id || next.post_meta?.id || null;
    const permalink = post.permalink || next.post_permalink || next.post_meta?.permalink || null;
    next.post_id = postId;
    next.post_permalink = permalink;
    next.post_visibility = 'public';
    next.posted_to_public = true;
    next.post_meta = {
      ...(next.post_meta && typeof next.post_meta === 'object' ? next.post_meta : {}),
      id: postId,
      permalink,
      visibility: 'public',
      posted_to_public: true,
      share_ref: post.share_ref ?? next.post_meta?.share_ref ?? null,
      share_setting: post.permissions?.share_setting ?? post.share_setting ?? next.post_meta?.share_setting ?? null,
    };
    delete next.scheduled_post_id;
    delete next.scheduled_post_at;
    delete next.scheduled_post_status;
    delete next.scheduled_post_caption;
    return next;
  }

  function extractRemixTargetPostId(apiDraft, existingData = {}) {
    const candidates = [
      apiDraft?.creation_config?.remix_target_post?.post?.id,
      apiDraft?.creation_config?.remix_target_post?.id,
      apiDraft?.remix_target_post_id,
      existingData?.remix_target_post_id,
    ];
    for (const candidate of candidates) {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      if (value) return value;
    }
    return null;
  }

  function extractPublishedPostGenerationId(post) {
    const candidates = [
      post?.generation_id,
      post?.draft_id,
    ];
    const attachments = Array.isArray(post?.attachments) ? post.attachments : [];
    for (const attachment of attachments) {
      candidates.push(
        attachment?.generation_id,
        attachment?.draft_id,
        attachment?.draft?.id,
        attachment?.generation?.id,
        attachment?.source_id,
        attachment?.core_id,
        attachment?.id
      );
    }
    for (const candidate of candidates) {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      if (/^gen_/i.test(value)) return value;
    }
    return '';
  }

  function extractPublishedPostVideoUrl(post) {
    const attachments = Array.isArray(post?.attachments) ? post.attachments : [];
    const candidates = [
      post?.url,
      post?.video_url,
      post?.media?.url,
      Array.isArray(post?.assets) ? post.assets[0]?.url : '',
    ];
    for (const attachment of attachments) {
      candidates.push(
        attachment?.url,
        attachment?.video_url,
        attachment?.draft?.url,
        attachment?.post?.url,
        attachment?.media?.url,
        attachment?.encodings?.source?.path,
        attachment?.encodings?.source_wm?.path,
        attachment?.encodings?.md?.path
      );
    }
    for (const candidate of candidates) {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      if (value) return value;
    }
    return '';
  }

  function extractPublishedPostThumbnailUrl(post) {
    const attachments = Array.isArray(post?.attachments) ? post.attachments : [];
    const candidates = [
      post?.preview_image_url,
      post?.thumbnail_url,
      post?.thumb,
      post?.cover,
      post?.poster?.url,
      post?.image?.url,
      Array.isArray(post?.images) ? post.images[0]?.url : '',
      Array.isArray(post?.assets) ? (post.assets[0]?.thumbnail_url || post.assets[0]?.url) : '',
      post?.media?.thumbnail,
      post?.media?.cover,
      post?.media?.poster,
    ];
    for (const attachment of attachments) {
      candidates.push(
        attachment?.thumbnail_url,
        attachment?.thumb,
        attachment?.cover,
        attachment?.poster?.url,
        attachment?.image?.url,
        attachment?.encodings?.thumbnail?.path
      );
    }
    for (const candidate of candidates) {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      if (value) return value;
    }
    return '';
  }

  function extractPublishedPostDurationSeconds(post) {
    const directDuration = Number(post?.duration_s);
    if (Number.isFinite(directDuration) && directDuration > 0) return directDuration;
    const attachments = Array.isArray(post?.attachments) ? post.attachments : [];
    for (const attachment of attachments) {
      const attDuration = Number(attachment?.duration_s);
      if (Number.isFinite(attDuration) && attDuration > 0) return attDuration;
      const attFrames = Number(attachment?.n_frames);
      if (Number.isFinite(attFrames) && attFrames > 0) return attFrames / 30;
    }
    const directFrames = Number(post?.n_frames || post?.video_metadata?.n_frames);
    if (Number.isFinite(directFrames) && directFrames > 0) return directFrames / 30;
    return 0;
  }

  function extractPublishedPostDimensions(post) {
    const attachments = Array.isArray(post?.attachments) ? post.attachments : [];
    const widthCandidates = [post?.width, post?.video_metadata?.width];
    const heightCandidates = [post?.height, post?.video_metadata?.height];
    for (const attachment of attachments) {
      widthCandidates.push(attachment?.width);
      heightCandidates.push(attachment?.height);
    }
    const width = widthCandidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
    const height = heightCandidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
    return { width, height };
  }

  function buildComposerSourceFromPublishedPost(post, fallbackPostId = '') {
    const publishedPost = post && typeof post === 'object' ? post : {};
    const postId = String(publishedPost.id || fallbackPostId || '').trim();
    const generationId = extractPublishedPostGenerationId(publishedPost);
    const prompt = String(publishedPost.text || publishedPost.post_text || '').trim();
    const title = String(publishedPost.title || '').trim();
    const url = extractPublishedPostVideoUrl(publishedPost);
    const thumbnailUrl = extractPublishedPostThumbnailUrl(publishedPost);
    const durationSeconds = extractPublishedPostDurationSeconds(publishedPost);
    const { width, height } = extractPublishedPostDimensions(publishedPost);
    const orientation = width > 0 && height > 0 ? (width > height ? 'landscape' : 'portrait') : '';
    if (!postId && !url) return null;
    return {
      type: 'post',
      id: generationId,
      post_id: postId,
      storyboard_id: '',
      can_storyboard: false,
      prompt,
      title,
      url,
      preview_url: url,
      thumbnail_url: thumbnailUrl,
      orientation,
      duration_seconds: durationSeconds,
      cameo_profiles: [],
      label: `${title || prompt || postId || 'Published video'}`.slice(0, 90),
    };
  }

  function isLargeComposerSizeAllowed(modelValue, ultraModeEnabled = false) {
    if (ultraModeEnabled) return true;
    return getComposerModelFamily(modelValue) === 'sy_ore';
  }

  function normalizeComposerSizeForModel(sizeValue, modelValue, ultraModeEnabled = false) {
    const normalizedSize = sizeValue === 'large' ? 'large' : 'small';
    if (normalizedSize === 'large' && !isLargeComposerSizeAllowed(modelValue, ultraModeEnabled)) {
      return 'small';
    }
    return normalizedSize;
  }

  function normalizeDraftOrientationValue(value) {
    const normalized = typeof value === 'string'
      ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
      : '';
    if (!normalized) return '';
    if (normalized === 'portrait' || normalized.startsWith('portrait_')) return 'portrait';
    if (normalized === 'landscape' || normalized.startsWith('landscape_')) return 'landscape';
    return '';
  }

  function extractDraftDimensions(draft, fallbackDraft = null) {
    const widthCandidates = [
      draft?.width,
      draft?.draft?.width,
      draft?.generation?.width,
      draft?.asset?.width,
      draft?.creation_config?.width,
      fallbackDraft?.width,
    ];
    const heightCandidates = [
      draft?.height,
      draft?.draft?.height,
      draft?.generation?.height,
      draft?.asset?.height,
      draft?.creation_config?.height,
      fallbackDraft?.height,
    ];
    const width = widthCandidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
    const height = heightCandidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
    return { width, height };
  }

  function resolveDraftOrientationValue(draft, fallbackDraft = null, dimensions = null) {
    const explicitOrientation = normalizeDraftOrientationValue(draft?.orientation)
      || normalizeDraftOrientationValue(draft?.creation_config?.orientation)
      || normalizeDraftOrientationValue(fallbackDraft?.orientation)
      || normalizeDraftOrientationValue(fallbackDraft?.creation_config?.orientation);
    if (explicitOrientation) return explicitOrientation;
    const resolvedDimensions = dimensions && typeof dimensions === 'object'
      ? dimensions
      : extractDraftDimensions(draft, fallbackDraft);
    if (resolvedDimensions.width > 0 && resolvedDimensions.height > 0) {
      return resolvedDimensions.width > resolvedDimensions.height ? 'landscape' : 'portrait';
    }
    return '';
  }

  function getDraftOrientationForLayout(draft) {
    return resolveDraftOrientationValue(draft);
  }

  function getDraftLayoutStateBlob(draft) {
    if (!draft || typeof draft !== 'object') return '';
    const fields = [
      draft.kind,
      draft.type,
      draft.status,
      draft.state,
      draft.reason,
      draft.failure_reason,
      draft.moderation_reason,
      draft.user_error_message,
      draft.message,
      draft.pending_status,
      draft.pending_task_status,
      draft.error,
      draft.detail,
    ];
    const parts = [];
    for (const field of fields) {
      if (typeof field === 'string') {
        const trimmed = field.trim();
        if (trimmed) parts.push(trimmed.toLowerCase());
        continue;
      }
      if (field && typeof field === 'object') {
        try {
          const serialized = JSON.stringify(field);
          if (serialized && serialized !== '{}') parts.push(serialized.toLowerCase());
        } catch {}
      }
    }
    return parts.join(' ');
  }

  function isForcedFullHeightDraftCard(draft) {
    const statusBlob = getDraftLayoutStateBlob(draft);
    return draft?.is_pending === true
      || /\bpending\b/.test(statusBlob)
      || statusBlob.includes('content_violation')
      || statusBlob.includes('context_violation')
      || statusBlob.includes('policy_violation')
      || statusBlob.includes('moderation_violation')
      || statusBlob.includes('safety_violation')
      || statusBlob.includes('policy blocked')
      || statusBlob.includes('processing_error')
      || statusBlob.includes('processing_failed')
      || statusBlob.includes('generation_error');
  }

  function getDraftOrientationForGrouping(draft) {
    if (isForcedFullHeightDraftCard(draft)) return 'portrait';
    return getDraftOrientationForLayout(draft);
  }

  function getDraftCardPaddingTop(draft, usePlaceholderThumb = false) {
    if (usePlaceholderThumb) return '177.78%';
    const draftOrientation = getDraftOrientationForLayout(draft);
    if (draftOrientation === 'landscape') return '56.25%';
    if (draftOrientation === 'portrait') return '177.78%';
    return Number(draft?.height) > Number(draft?.width) ? '177.78%' : '56.25%';
  }

  function getDraftCardLayoutStyle(draft, usePlaceholderThumb = false) {
    return {
      alignSelf: 'start',
      paddingTop: getDraftCardPaddingTop(draft, usePlaceholderThumb),
    };
  }

  const UV_DRAFTS_GRID_MIN_COLUMN_WIDTH = 240;
  const UV_DRAFTS_GRID_GAP = 14;

  function shouldGroupLandscapeDraftCard(drafts, index) {
    if (!Array.isArray(drafts) || !Number.isInteger(index) || index < 0 || index >= drafts.length) {
      return false;
    }
    if (getDraftOrientationForGrouping(drafts[index]) !== 'landscape') return false;
    return getDraftOrientationForGrouping(drafts[index - 1]) === 'landscape'
      || getDraftOrientationForGrouping(drafts[index + 1]) === 'landscape';
  }

  function getLandscapeRunStartIndex(drafts, index) {
    if (!Array.isArray(drafts) || !Number.isInteger(index) || index < 0 || index >= drafts.length) return -1;
    if (getDraftOrientationForGrouping(drafts[index]) !== 'landscape') return -1;
    let start = index;
    while (start > 0 && getDraftOrientationForGrouping(drafts[start - 1]) === 'landscape') {
      start -= 1;
    }
    return start;
  }

  function getLandscapeRunEndIndex(drafts, index) {
    if (!Array.isArray(drafts) || !Number.isInteger(index) || index < 0 || index >= drafts.length) return -1;
    if (getDraftOrientationForGrouping(drafts[index]) !== 'landscape') return -1;
    let end = index + 1;
    while (end < drafts.length && getDraftOrientationForGrouping(drafts[end]) === 'landscape') {
      end += 1;
    }
    return end;
  }

  function getLandscapeRunGridColumnCapacity(gridEl) {
    const targetGridEl = gridEl && typeof gridEl === 'object' ? gridEl : null;
    const width = Number(targetGridEl?.clientWidth)
      || Number(targetGridEl?.getBoundingClientRect?.().width)
      || 0;
    if (!Number.isFinite(width) || width <= 0) return 4;
    const capacity = Math.floor((width + UV_DRAFTS_GRID_GAP) / (UV_DRAFTS_GRID_MIN_COLUMN_WIDTH + UV_DRAFTS_GRID_GAP));
    return Math.max(1, capacity);
  }

  function getLandscapeRunChunkSize(maxColumns) {
    const normalizedMaxColumns = Math.max(1, Math.floor(Number(maxColumns) || 0));
    return normalizedMaxColumns * 2;
  }

  function getLandscapeRunColumnSpan(chunkLength, maxColumns) {
    if (!Number.isFinite(chunkLength) || chunkLength <= 1) return 1;
    const normalizedMaxColumns = Math.max(1, Math.floor(Number(maxColumns) || 0));
    return Math.min(normalizedMaxColumns, Math.max(2, Math.floor(chunkLength)));
  }

  function getLandscapeRunChunkPlan(remainingRunLength, maxColumns, currentRowFill = 0, options = {}) {
    const normalizedRunLength = Math.max(0, Math.floor(Number(remainingRunLength) || 0));
    const normalizedMaxColumns = Math.max(1, Math.floor(Number(maxColumns) || 0));
    const normalizedRowFill = Math.max(0, Math.floor(Number(currentRowFill) || 0)) % normalizedMaxColumns;
    const availableColumns = normalizedRowFill > 0
      ? Math.max(1, normalizedMaxColumns - normalizedRowFill)
      : normalizedMaxColumns;
    if (normalizedRunLength <= 1) {
      return {
        columnSpan: 1,
        chunkLength: normalizedRunLength,
      };
    }
    const chunkLength = Math.min(normalizedRunLength, availableColumns * 2);
    const columnSpan = Math.min(availableColumns, Math.max(1, Math.ceil(chunkLength / 2)));
    return {
      columnSpan,
      chunkLength,
    };
  }

  function planLandscapeRunChunks(runLength, maxColumns, currentRowFill = 0) {
    const normalizedRunLength = Math.max(0, Math.floor(Number(runLength) || 0));
    const normalizedMaxColumns = Math.max(1, Math.floor(Number(maxColumns) || 0));
    let remaining = normalizedRunLength;
    let rowFill = Math.max(0, Math.floor(Number(currentRowFill) || 0)) % normalizedMaxColumns;
    const chunks = [];
    while (remaining > 0) {
      const chunk = getLandscapeRunChunkPlan(remaining, normalizedMaxColumns, rowFill);
      if (!chunk || !Number.isFinite(chunk.chunkLength) || chunk.chunkLength <= 0) break;
      chunks.push(chunk);
      remaining -= chunk.chunkLength;
      rowFill = (rowFill + chunk.columnSpan) % normalizedMaxColumns;
    }
    return chunks;
  }

  function planDraftGridRows(drafts, maxColumns) {
    if (!Array.isArray(drafts) || drafts.length === 0) return [];
    const normalizedMaxColumns = Math.max(1, Math.floor(Number(maxColumns) || 0));
    const rows = [];
    let index = 0;

    while (index < drafts.length) {
      const row = [];
      let slotsRemaining = normalizedMaxColumns;

      while (index < drafts.length && slotsRemaining > 0) {
        if (shouldGroupLandscapeDraftCard(drafts, index)) {
          const runEnd = getLandscapeRunEndIndex(drafts, index);
          const remainingRunLength = runEnd > index ? (runEnd - index) : 1;
          const { columnSpan, chunkLength } = getLandscapeRunChunkPlan(remainingRunLength, normalizedMaxColumns, normalizedMaxColumns - slotsRemaining);
          const rowDrafts = drafts.slice(index, index + chunkLength);
          row.push({
            kind: 'landscape-run',
            span: columnSpan,
            draftIds: rowDrafts.map((draft) => draft?.id).filter(Boolean),
          });
          index += chunkLength;
          slotsRemaining -= columnSpan;
          continue;
        }

        const draft = drafts[index];
        row.push({
          kind: 'card',
          span: 1,
          draftIds: draft?.id ? [draft.id] : [],
        });
        index += 1;
        slotsRemaining -= 1;
      }

      if (row.length > 0) rows.push(row);
    }

    return rows;
  }

  function getDraftCountForGridRows(rows, rowCount = rows.length) {
    if (!Array.isArray(rows) || rowCount <= 0) return 0;
    return rows
      .slice(0, rowCount)
      .reduce((total, row) => total + row.reduce((rowTotal, item) => rowTotal + (Array.isArray(item?.draftIds) ? item.draftIds.length : 0), 0), 0);
  }

  function extendDraftRenderEndToRowBoundary(drafts, targetEnd, maxColumns) {
    if (!Array.isArray(drafts) || drafts.length === 0) return 0;
    const normalizedTargetEnd = Math.max(0, Math.min(Math.floor(Number(targetEnd) || 0), drafts.length));
    if (normalizedTargetEnd <= 0) return 0;
    const rows = planDraftGridRows(drafts, maxColumns);
    let consumed = 0;
    for (const row of rows) {
      consumed += row.reduce((rowTotal, item) => rowTotal + (Array.isArray(item?.draftIds) ? item.draftIds.length : 0), 0);
      if (consumed >= normalizedTargetEnd) return consumed;
    }
    return drafts.length;
  }

  function getRenderedGridRowFillCount(gridEl, maxColumns) {
    if (!gridEl || !Number.isFinite(maxColumns) || maxColumns <= 0) return 0;
    const children = Array.isArray(gridEl.children) ? gridEl.children : Array.from(gridEl.children || []);
    let fill = 0;
    for (const child of children) {
      const className = String(child?.className || '');
      if (className.includes('uv-drafts-load-more') || className.includes('uvd-empty-state') || className.includes('uv-drafts-loading')) {
        continue;
      }
      const gridColumnValue = String(child?.style?.gridColumn || '');
      const match = /span\s+(\d+)/i.exec(gridColumnValue);
      const span = match ? Math.max(1, Number(match[1]) || 1) : 1;
      fill = (fill + span) % maxColumns;
    }
    return fill;
  }

  function extendLandscapeRunRenderEnd(drafts, end, maxLandscapeColumns = 4) {
    if (!Array.isArray(drafts) || !Number.isInteger(end)) return 0;
    let nextEnd = Math.max(0, Math.min(end, drafts.length));
    if (nextEnd <= 0 || nextEnd >= drafts.length) return nextEnd;
    if (
      getDraftOrientationForGrouping(drafts[nextEnd - 1]) === 'landscape' &&
      getDraftOrientationForGrouping(drafts[nextEnd]) === 'landscape'
    ) {
      const runStart = getLandscapeRunStartIndex(drafts, nextEnd - 1);
      const runEnd = getLandscapeRunEndIndex(drafts, nextEnd - 1);
      if (runStart >= 0) {
        const chunkSize = getLandscapeRunChunkSize(maxLandscapeColumns);
        const runOffset = nextEnd - runStart;
        const nextChunkMultiple = Math.ceil(runOffset / chunkSize) * chunkSize;
        nextEnd = Math.min(runStart + nextChunkMultiple, runEnd >= 0 ? runEnd : drafts.length);
      }
    }
    return nextEnd;
  }

  function isGenerationDraftId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return /^gen_/i.test(normalized);
  }

  function extractErrorMessage(value, fallback = 'Unknown error') {
    if (value == null) return fallback;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || fallback;
    }
    if (value instanceof Error) {
      const message = typeof value.message === 'string' ? value.message.trim() : '';
      return message || fallback;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const message = extractErrorMessage(item, '');
        if (message) return message;
      }
      return fallback;
    }
    if (typeof value === 'object') {
      const candidates = [
        value.message,
        value.user_error_message,
        value.error,
        value.detail,
        value.failure_reason,
        value.reason,
        value.title,
        value.errors,
      ];
      for (const candidate of candidates) {
        const message = extractErrorMessage(candidate, '');
        if (message) return message;
      }
      try {
        const serialized = JSON.stringify(value);
        return serialized && serialized !== '{}' ? serialized : fallback;
      } catch {}
    }
    return fallback;
  }

  function parseComposerGensInputValue(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function extractPersistedGensCountValue(rawStorageValue) {
    if (rawStorageValue == null) return null;
    try {
      const parsed = JSON.parse(rawStorageValue);
      const value = parsed && typeof parsed === 'object' ? parsed.count : parsed;
      return parseComposerGensInputValue(value);
    } catch {
      return parseComposerGensInputValue(rawStorageValue);
    }
  }

  function extractPersistedComposerPromptValue(rawStorageValue) {
    if (rawStorageValue == null) return null;
    try {
      const parsed = JSON.parse(rawStorageValue);
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed === 'object' && typeof parsed.prompt === 'string') return parsed.prompt;
      return null;
    } catch {
      return typeof rawStorageValue === 'string' ? rawStorageValue : null;
    }
  }

  function resolvePreferredComposerGensCountValue(
    rawComposerGensCount,
    storedGensCount = null,
    preferStoredGensCount = true
  ) {
    const parsedRawComposerGensCount = parseComposerGensInputValue(rawComposerGensCount);
    const parsedStoredGensCount = parseComposerGensInputValue(storedGensCount);
    if (preferStoredGensCount && parsedStoredGensCount != null) return parsedStoredGensCount;
    if (parsedRawComposerGensCount != null) return parsedRawComposerGensCount;
    return parsedStoredGensCount;
  }

  function resolvePreferredComposerPromptValue(
    rawComposerPrompt,
    storedPrompt = null,
    preferStoredPrompt = true
  ) {
    const parsedRawComposerPrompt = typeof rawComposerPrompt === 'string' ? rawComposerPrompt : null;
    const parsedStoredPrompt = typeof storedPrompt === 'string' ? storedPrompt : null;
    if (preferStoredPrompt && parsedStoredPrompt != null) return parsedStoredPrompt;
    if (parsedRawComposerPrompt != null) return parsedRawComposerPrompt;
    return parsedStoredPrompt;
  }

  function getDraftWorkspaceBadgeLabel(draft, currentWorkspaceFilter = null, resolveWorkspaceName = null) {
    const normalizedWorkspaceFilter = typeof currentWorkspaceFilter === 'string'
      ? currentWorkspaceFilter.trim()
      : '';
    if (normalizedWorkspaceFilter) return '';
    const workspaceId = typeof draft?.workspace_id === 'string'
      ? draft.workspace_id.trim()
      : '';
    if (!workspaceId) return '';
    if (typeof resolveWorkspaceName !== 'function') return '';
    const workspaceName = String(resolveWorkspaceName(workspaceId) || '').trim();
    return workspaceName;
  }

  function getUVDraftsPageTitle(currentWorkspaceFilter = null, resolveWorkspaceName = null) {
    const normalizedWorkspaceFilter = typeof currentWorkspaceFilter === 'string'
      ? currentWorkspaceFilter.trim()
      : '';
    if (!normalizedWorkspaceFilter || typeof resolveWorkspaceName !== 'function') {
      return 'My Drafts';
    }
    const workspaceName = String(resolveWorkspaceName(normalizedWorkspaceFilter) || '').trim();
    return workspaceName || 'My Drafts';
  }

  function formatWorkspaceSlugForTitle(slug = '') {
    const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!normalizedSlug) return '';
    return normalizedSlug
      .split('-')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function getUVDraftsDocumentTitle(currentWorkspaceFilter = null, resolveWorkspaceName = null, pathname = '') {
    const pageTitle = getUVDraftsPageTitle(currentWorkspaceFilter, resolveWorkspaceName);
    if (pageTitle && pageTitle !== 'My Drafts') {
      return `${pageTitle} - Sora`;
    }
    const workspaceSlug = extractWorkspaceSlugFromCreatortoolsPath(pathname);
    const fallbackWorkspaceTitle = formatWorkspaceSlugForTitle(workspaceSlug);
    return `${fallbackWorkspaceTitle || pageTitle || 'My Drafts'} - Sora`;
  }

  function filterDraftsByWorkspace(drafts, currentWorkspaceFilter = null) {
    if (!Array.isArray(drafts)) return [];
    const normalizedWorkspaceFilter = typeof currentWorkspaceFilter === 'string'
      ? currentWorkspaceFilter.trim()
      : '';
    if (!normalizedWorkspaceFilter) return drafts;
    return drafts.filter((draft) => String(draft?.workspace_id || '').trim() === normalizedWorkspaceFilter);
  }

  function slugifyWorkspaceName(name, fallback = 'workspace') {
    const fallbackSlug = String(fallback || 'workspace')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';
    const rawName = typeof name === 'string' ? name.trim() : '';
    if (!rawName) return fallbackSlug;
    const normalized = rawName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallbackSlug;
  }

  function getWorkspaceUrlSlug(workspace, workspaces = []) {
    const workspaceId = typeof workspace?.id === 'string' ? workspace.id.trim() : '';
    if (!workspaceId) return '';
    const fallbackSlug = slugifyWorkspaceName(workspaceId, 'workspace');
    const baseSlug = slugifyWorkspaceName(workspace?.name, fallbackSlug);
    let duplicateIndex = 0;
    const list = Array.isArray(workspaces) ? workspaces : [];
    for (const item of list) {
      const itemId = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!itemId) continue;
      const itemBaseSlug = slugifyWorkspaceName(item?.name, slugifyWorkspaceName(itemId, 'workspace'));
      if (itemBaseSlug !== baseSlug) continue;
      duplicateIndex += 1;
      if (itemId === workspaceId) {
        return duplicateIndex === 1 ? baseSlug : `${baseSlug}-${duplicateIndex}`;
      }
    }
    return baseSlug;
  }

  function findWorkspaceIdByUrlSlug(slug, workspaces = []) {
    const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!normalizedSlug) return null;
    const list = Array.isArray(workspaces) ? workspaces : [];
    for (const workspace of list) {
      const workspaceId = typeof workspace?.id === 'string' ? workspace.id.trim() : '';
      if (!workspaceId) continue;
      const workspaceSlug = getWorkspaceUrlSlug(workspace, list);
      if (workspaceSlug === normalizedSlug || workspaceId.toLowerCase() === normalizedSlug) {
        return workspaceId;
      }
    }
    return null;
  }

  function extractWorkspaceSlugFromCreatortoolsPath(pathname = '') {
    const currentPath = String(pathname || '').split(/[?#]/)[0];
    if (currentPath === '/creatortools') return '';
    if (!currentPath.startsWith('/creatortools/')) return null;
    const remainder = currentPath.slice('/creatortools/'.length).replace(/^\/+/, '');
    if (!remainder) return '';
    const firstSegment = remainder.split('/')[0];
    if (!firstSegment) return '';
    try {
      return decodeURIComponent(firstSegment).trim().toLowerCase();
    } catch {
      return firstSegment.trim().toLowerCase();
    }
  }

  function buildCreatortoolsPathForWorkspace(workspaceId = null, workspaces = []) {
    const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    if (!normalizedWorkspaceId) return '/creatortools';
    const list = Array.isArray(workspaces) ? workspaces : [];
    const workspace = list.find((item) => String(item?.id || '').trim() === normalizedWorkspaceId);
    const slug = workspace
      ? getWorkspaceUrlSlug(workspace, list)
      : slugifyWorkspaceName(normalizedWorkspaceId, 'workspace');
    return slug ? `/creatortools/${encodeURIComponent(slug)}` : '/creatortools';
  }

  function createSoraUVDraftsPageModule(deps = {}) {
    let capturedAuthToken = null;
    let modelOverride = null;

    const SORA_DEFAULT_FPS = Number(deps.defaultFps) > 0 ? Number(deps.defaultFps) : 30;
    const BOOKMARKS_KEY = 'SORA_UV_BOOKMARKS_V1';
    const GENS_COUNT_KEY = 'SCT_GENS_COUNT_V1';
    const UV_DRAFTS_GENS_COUNT_KEY = 'SORA_UV_DRAFTS_GENS_COUNT_V1';
    const UV_DRAFTS_COMPOSER_PROMPT_KEY = 'SORA_UV_DRAFTS_PROMPT_V1';
    const ULTRA_MODE_KEY = 'SCT_ULTRA_MODE_V1';
    const GENS_COUNT_MIN = 1;
    const GENS_COUNT_MAX_DEFAULT = 10;
    const GENS_COUNT_MAX_ULTRA = 40;
    const UV_DRAFTS_DEBUG_KEY = 'SORA_UV_DRAFTS_DEBUG';
    const UV_DRAFTS_DEBUG_ENABLED = (() => {
      try {
        const raw = localStorage.getItem(UV_DRAFTS_DEBUG_KEY);
        if (raw == null) return false;
        const normalized = String(raw).trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
      } catch {
        return false;
      }
    })();
    const COMPOSER_MODELS = [
      { value: 'sy_8', label: 'Sora 2' },
      { value: 'sy_ore', label: 'Sora 2 Pro' },
    ];
    let composerModels = COMPOSER_MODELS.slice();
    let composerModelValues = new Set(composerModels.map((item) => item.value));

    // Mutable — updated from API via fetchComposerStyles()
    let composerStyles = [];

    // Duration → n_frames mapping (30 fps)
    const SECONDS_TO_FRAMES = { 5: 150, 10: 300, 15: 450, 25: 750 };
    const VALID_DURATIONS = [5, 10, 15, 25];

    // Cameo state for composer
    let composerCameoIds = [];
    let composerCameoReplacements = {};
    let composerCameoUsernames = {};
    let composerSourceCameoIds = new Set();

    // Sentinel SDK state
    let sentinelInitialized = false;
    let cachedSentinelToken = null;
    let cachedSentinelExpiry = 0;

    function debugLog(...args) {
      if (!UV_DRAFTS_DEBUG_ENABLED) return;
      try { console.log(...args); } catch {}
    }

    function getBookmarks() {
      try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        if (!raw) return new Set();
        const data = JSON.parse(raw);
        // Support both formats: { ids: [...] } (inject.js) and [...] (legacy)
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.ids) ? data.ids : []);
        return new Set(arr);
      } catch {
        return new Set();
      }
    }

    function setBookmarks(bookmarksSet) {
      // Safety: independently count bookmark IDs in raw storage to prevent
      // format-mismatch bugs from silently wiping all bookmarks on write.
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      if (raw) {
        let rawCount = 0;
        try {
          const data = JSON.parse(raw);
          if (Array.isArray(data)) rawCount = data.length;
          else if (data && typeof data === 'object') {
            for (const val of Object.values(data)) {
              if (Array.isArray(val) && val.length > rawCount) rawCount = val.length;
            }
          }
        } catch {}
        if (rawCount > 1 && bookmarksSet.size < rawCount - 1) {
          console.error('[UV Drafts] Bookmark safety: blocked write of', bookmarksSet.size,
            'bookmarks when storage has', rawCount, '. Potential data loss prevented.');
          return;
        }
      }
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify({ ids: [...bookmarksSet] }));
    }

    function toggleBookmark(draftId) {
      const bookmarks = getBookmarks();
      if (bookmarks.has(draftId)) bookmarks.delete(draftId);
      else bookmarks.add(draftId);
      setBookmarks(bookmarks);
      return bookmarks.has(draftId);
    }

    function removeBookmark(draftId) {
      const bookmarks = getBookmarks();
      bookmarks.delete(draftId);
      setBookmarks(bookmarks);
      return false;
    }

    function isBookmarked(draftId) {
      return getBookmarks().has(draftId);
    }

    function loadUltraModeEnabledFromStorage() {
      try {
        const raw = localStorage.getItem(ULTRA_MODE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return !!parsed.enabled;
        return raw === 'true' || raw === '1';
      } catch {
        return false;
      }
    }

    function getGensCountMax() {
      if (uvDraftsLogic && typeof uvDraftsLogic.getGensCountMax === 'function') {
        return uvDraftsLogic.getGensCountMax(loadUltraModeEnabledFromStorage());
      }
      return loadUltraModeEnabledFromStorage() ? GENS_COUNT_MAX_ULTRA : GENS_COUNT_MAX_DEFAULT;
    }

    function clampGensCount(value) {
      if (uvDraftsLogic && typeof uvDraftsLogic.clampGensCount === 'function') {
        return uvDraftsLogic.clampGensCount(value, loadUltraModeEnabledFromStorage());
      }
      const n = Number(value);
      if (!Number.isFinite(n)) return GENS_COUNT_MIN;
      return Math.min(getGensCountMax(), Math.max(GENS_COUNT_MIN, Math.round(n)));
    }

    function loadStoredGensCountValue() {
      try {
        const rawLocalDraftsCount = localStorage.getItem(UV_DRAFTS_GENS_COUNT_KEY);
        const rawSharedCount = localStorage.getItem(GENS_COUNT_KEY);
        const parsedCount = extractPersistedGensCountValue(rawLocalDraftsCount ?? rawSharedCount);
        return parsedCount == null ? null : clampGensCount(parsedCount);
      } catch {
        return null;
      }
    }

    function loadStoredGensCount() {
      return loadStoredGensCountValue() ?? GENS_COUNT_MIN;
    }

    function persistComposerGensCount(count) {
      const nextValue = JSON.stringify({ count: clampGensCount(count), setAt: Date.now() });
      try {
        localStorage.setItem(UV_DRAFTS_GENS_COUNT_KEY, nextValue);
      } catch {}
      try {
        localStorage.setItem(GENS_COUNT_KEY, nextValue);
      } catch {}
    }

    function loadStoredComposerPromptValue() {
      try {
        return extractPersistedComposerPromptValue(localStorage.getItem(UV_DRAFTS_COMPOSER_PROMPT_KEY));
      } catch {
        return null;
      }
    }

    function persistComposerPrompt(prompt) {
      const nextPrompt = typeof prompt === 'string' ? prompt : '';
      try {
        localStorage.setItem(
          UV_DRAFTS_COMPOSER_PROMPT_KEY,
          JSON.stringify({ prompt: nextPrompt, setAt: Date.now() })
        );
      } catch {}
    }

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function normalizeComposerModel(value) {
      return resolveComposerModelValue(composerModels, value);
    }

    function getDefaultComposerModel() {
      return (
        normalizeComposerModel(uvDraftsComposerState?.model) ||
        normalizeComposerModel(modelOverride) ||
        composerModels[0]?.value || 'sy_8'
      );
    }

    function isDraftPubliclyPosted(draft) {
      if (uvDraftsLogic && typeof uvDraftsLogic.isDraftPubliclyPosted === 'function') {
        return !!uvDraftsLogic.isDraftPubliclyPosted(draft);
      }
      const visibility = String(draft?.post_visibility || '').toLowerCase();
      if (visibility === 'public') return true;
      if (draft?.posted_to_public === true) return true;
      if (draft?.post_meta?.posted_to_public === true) return true;
      if (String(draft?.post_meta?.visibility || '').toLowerCase() === 'public') return true;
      return false;
    }

    function getDraftPostUrl(draft) {
      if (uvDraftsLogic && typeof uvDraftsLogic.getDraftPostUrl === 'function') {
        return uvDraftsLogic.getDraftPostUrl(draft, 'https://sora.chatgpt.com');
      }
      const postId = String(draft?.post_id || '').trim();
      if (!postId) return '';
      return `https://sora.chatgpt.com/p/${encodeURIComponent(postId)}`;
    }

    function canTrimDraft(draft) {
      if (uvDraftsLogic && typeof uvDraftsLogic.canTrimDraft === 'function') {
        return !!uvDraftsLogic.canTrimDraft(draft);
      }
      return !!(draft?.id && (draft?.storyboard_id || draft?.can_storyboard !== false));
    }

    function getDraftTrimUrl(draft) {
      if (uvDraftsLogic && typeof uvDraftsLogic.getDraftTrimUrl === 'function') {
        return uvDraftsLogic.getDraftTrimUrl(draft, 'https://sora.chatgpt.com');
      }
      if (!draft?.id) return '';
      if (draft.storyboard_id) return `https://sora.chatgpt.com/storyboard/${encodeURIComponent(draft.storyboard_id)}`;
      return `https://sora.chatgpt.com/d/${encodeURIComponent(draft.id)}`;
    }

    function getDraftKindKey(draft) {
      return String(draft?.kind || '').trim().toLowerCase();
    }

    function getDraftStatusKey(draft) {
      return String(draft?.status || draft?.pending_status || draft?.pending_task_status || '').trim().toLowerCase();
    }

    function getDraftReasonText(draft) {
      const value = draft?.violation_reason;
      if (typeof value === 'string') return value.toLowerCase();
      if (value && typeof value === 'object') {
        try {
          return JSON.stringify(value).toLowerCase();
        } catch {
          return '';
        }
      }
      return '';
    }

    function isContentViolationDraft(draft) {
      const kind = getDraftKindKey(draft);
      if (
        kind === 'sora_content_violation' ||
        kind.includes('content_violation') ||
        kind.includes('policy_violation') ||
        kind.includes('moderation_violation') ||
        kind.includes('safety_violation')
      ) {
        return true;
      }
      const status = getDraftStatusKey(draft);
      if (
        status === 'content_violation' ||
        status === 'sora_content_violation' ||
        status.includes('content_violation') ||
        status.includes('policy_violation') ||
        status.includes('moderation_violation') ||
        status.includes('safety_violation')
      ) {
        return true;
      }
      const reason = getDraftReasonText(draft);
      const hasContentSignals = /(content|policy|moderation|safety|blocked|violat|disallow)/i.test(reason);
      const hasInfraSignals = /(processing|generation|internal error|timeout|network|retry|server error|failed)/i.test(reason);
      return hasContentSignals && !hasInfraSignals;
    }

    function isContextViolationDraft(draft) {
      const kind = getDraftKindKey(draft);
      if (kind === 'sora_context_violation' || kind.includes('context_violation')) return true;
      const status = getDraftStatusKey(draft);
      return status === 'context_violation' || status === 'sora_context_violation' || status.includes('context_violation');
    }

    function isProcessingErrorDraft(draft) {
      const kind = getDraftKindKey(draft);
      if (kind === 'sora_processing_error' ||
        kind === 'processing_error' ||
        kind.includes('processing_error') ||
        kind.includes('processing_failed') ||
        kind.includes('generation_error') ||
        kind.endsWith('_error')) {
        return true;
      }
      const status = getDraftStatusKey(draft);
      if (
        status === 'processing_error' ||
        status.includes('processing_error') ||
        status.includes('processing_failed') ||
        status.includes('generation_error') ||
        status.endsWith('_error') ||
        status === 'failed' ||
        status.endsWith('_failed')
      ) {
        return true;
      }

      // Fallback for API variants that do not set a dedicated kind.
      const reasonText = getDraftReasonText(draft);
      if (!reasonText) return false;
      if (isContentViolationDraft(draft) || isContextViolationDraft(draft)) return false;
      const hasErrorDetails = reasonText.length > 0;
      const hasMedia = String(draft?.preview_url || '').trim() || String(draft?.thumbnail_url || '').trim();
      return hasErrorDetails && !hasMedia;
    }

    function isNoDateDraft(draft) {
      const localResult = isContentViolationDraft(draft) || isContextViolationDraft(draft) || isProcessingErrorDraft(draft);
      if (uvDraftsLogic && typeof uvDraftsLogic.isDraftAlwaysOld === 'function') {
        return !!uvDraftsLogic.isDraftAlwaysOld(draft) || localResult;
      }
      return localResult;
    }

    function isDraftUnreadState(draft) {
      if (isNoDateDraft(draft)) return false;
      if (uvDraftsLogic && typeof uvDraftsLogic.isDraftUnread === 'function') {
        return !!uvDraftsLogic.isDraftUnread(draft);
      }
      return draft?.is_read === false;
    }

    function getDraftCreatedAt(draft) {
      if (isNoDateDraft(draft)) return null;
      const createdAt = Number(draft?.created_at);
      if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
      return createdAt;
    }

    function getDraftNoDateOrderValue(draft) {
      const noDateOrder = Number(draft?.no_date_order);
      if (Number.isFinite(noDateOrder) && noDateOrder >= 0) {
        return Math.floor(noDateOrder);
      }
      const apiOrder = Number(draft?.api_order);
      if (Number.isFinite(apiOrder) && apiOrder >= 0) {
        return Math.floor(apiOrder);
      }
      return null;
    }

    function searchDependsOnBookmark(query) {
      return /(?:^|\s)bookmarked\s*:/i.test(String(query || ''));
    }
  const UV_DRAFTS_DB_NAME = 'SORA_UV_DRAFTS_CACHE';
  const UV_DRAFTS_DB_VERSION = 1;
  const UV_DRAFTS_STORES = {
    drafts: 'drafts',
    thumbnails: 'thumbnails',
    previews: 'previews',
    workspaces: 'workspaces',
    scheduledPosts: 'scheduled_posts',
    seenDrafts: 'seen_drafts',
    syncState: 'sync_state'
  };

  // == IndexedDB Cache Layer for UV Drafts ==
  let uvDraftsDB = null;

  async function openUVDraftsDB() {
    if (uvDraftsDB) return uvDraftsDB;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(UV_DRAFTS_DB_NAME, UV_DRAFTS_DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Drafts store - main draft metadata
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.drafts)) {
          const draftsStore = db.createObjectStore(UV_DRAFTS_STORES.drafts, { keyPath: 'id' });
          draftsStore.createIndex('created_at', 'created_at', { unique: false });
          draftsStore.createIndex('bookmarked', 'bookmarked', { unique: false });
          draftsStore.createIndex('hidden', 'hidden', { unique: false });
          draftsStore.createIndex('workspace_id', 'workspace_id', { unique: false });
        }

        // Thumbnails store - cached thumbnail blobs
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.thumbnails)) {
          db.createObjectStore(UV_DRAFTS_STORES.thumbnails, { keyPath: 'draft_id' });
        }

        // Previews store - cached preview video blobs
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.previews)) {
          db.createObjectStore(UV_DRAFTS_STORES.previews, { keyPath: 'draft_id' });
        }

        // Workspaces store - user-created folders
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.workspaces)) {
          db.createObjectStore(UV_DRAFTS_STORES.workspaces, { keyPath: 'id' });
        }

        // Scheduled posts store
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.scheduledPosts)) {
          const schedStore = db.createObjectStore(UV_DRAFTS_STORES.scheduledPosts, { keyPath: 'id' });
          schedStore.createIndex('scheduled_at', 'scheduled_at', { unique: false });
          schedStore.createIndex('draft_id', 'draft_id', { unique: false });
        }

        // Seen drafts store - tracks viewed drafts for "New" badge
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.seenDrafts)) {
          db.createObjectStore(UV_DRAFTS_STORES.seenDrafts, { keyPath: 'id' });
        }

        // Sync state store - cache freshness tracking
        if (!db.objectStoreNames.contains(UV_DRAFTS_STORES.syncState)) {
          db.createObjectStore(UV_DRAFTS_STORES.syncState, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        uvDraftsDB = request.result;
        resolve(uvDraftsDB);
      };
    });
  }

  async function uvDBGet(storeName, key) {
    const db = await openUVDraftsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function uvDBPut(storeName, value) {
    const db = await openUVDraftsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function uvDBDelete(storeName, key) {
    const db = await openUVDraftsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function uvDBGetAll(storeName) {
    const db = await openUVDraftsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function uvDBClear(storeName) {
    const db = await openUVDraftsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function uvDBPutAll(storeName, items) {
    const db = await openUVDraftsDB();
    return new Promise((resolve, reject) => {
      if (items.length === 0) return resolve();

      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));

      for (const item of items) {
        store.put(item);
      }
    });
  }

  // == UV Drafts API Fetcher ==
  async function fetchAllUVDrafts(onProgress) {
    const allDrafts = [];
    let cursor = null;
    let pageNum = 0;

    do {
      const url = new URL('https://sora.chatgpt.com/backend/project_y/profile/drafts');
      url.searchParams.set('limit', '500');
      if (cursor) url.searchParams.set('cursor', cursor);

      try {
        const headers = {
          'accept': '*/*',
          'cache-control': 'no-cache'
        };
        if (capturedAuthToken) {
          headers['Authorization'] = capturedAuthToken;
        }

        const response = await fetch(url.toString(), {
          credentials: 'include',
          headers
        });

        if (!response.ok) {
          if (response.status === 401) {
            console.error('[UV Drafts] Auth token missing or expired. Navigate to another page to capture a fresh token.');
          }
          throw new Error(`Drafts API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.items && Array.isArray(data.items)) {
          allDrafts.push(...data.items);
          pageNum++;
          if (onProgress) onProgress(allDrafts.length, pageNum);
        }

        // Handle cursor for pagination — trust the cursor, don't cut off based on count
        cursor = data.cursor || data.next_cursor || null;

        // If response was empty but had a cursor, retry once in case of transient hiccup
        if (cursor && (!data.items || data.items.length === 0)) {
          const retryUrl = new URL('https://sora.chatgpt.com/backend/project_y/profile/drafts');
          retryUrl.searchParams.set('limit', '500');
          retryUrl.searchParams.set('cursor', cursor);
          const retryResp = await fetch(retryUrl.toString(), { credentials: 'include', headers });
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            if (retryData.items && Array.isArray(retryData.items)) {
              allDrafts.push(...retryData.items);
              pageNum++;
              if (onProgress) onProgress(allDrafts.length, pageNum);
            }
            cursor = retryData.cursor || retryData.next_cursor || null;
          } else {
            cursor = null;
          }
        }
      } catch (err) {
        console.error('[UV Drafts] Fetch error:', err);
        throw err;
      }
    } while (cursor);

    return allDrafts;
  }

  // Fetch first batch of drafts quickly (for instant render)
  async function fetchFirstUVDrafts(limit = 8) {
    const url = new URL('https://sora.chatgpt.com/backend/project_y/profile/drafts');
    url.searchParams.set('limit', String(limit));

    const headers = { 'accept': '*/*', 'cache-control': 'no-cache' };
    if (capturedAuthToken) headers['Authorization'] = capturedAuthToken;

    const response = await fetch(url.toString(), { credentials: 'include', headers });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    return {
      items: data.items || [],
      cursor: data.cursor || data.next_cursor || null
    };
  }

  // Sync remaining drafts in background starting from cursor
  async function syncRemainingDrafts(startCursor, onProgress, runId = uvDraftsInitRunId, startOrder = 0, syncedIds = null, maxPages = Infinity) {
    const isStaleRun = () => runId !== uvDraftsInitRunId;
    let cursor = startCursor;
    let pageNum = 1;
    let syncSucceeded = true;
    let nextOrder = Number.isFinite(Number(startOrder)) ? Math.max(0, Math.floor(Number(startOrder))) : 0;

    while (cursor) {
      if (isStaleRun()) return false;
      if (pageNum > maxPages) break;
      const url = new URL('https://sora.chatgpt.com/backend/project_y/profile/drafts');
      url.searchParams.set('limit', '500');
      url.searchParams.set('cursor', cursor);

      try {
        const headers = { 'accept': '*/*', 'cache-control': 'no-cache' };
        if (capturedAuthToken) headers['Authorization'] = capturedAuthToken;

        const response = await fetch(url.toString(), { credentials: 'include', headers });
        if (!response.ok) {
          syncSucceeded = false;
          break;
        }

        const data = await response.json();
        if (isStaleRun()) return false;

        if (data.items && data.items.length > 0) {
          // Get existing data for merging
          const existingDrafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
          if (isStaleRun()) return false;
          const existingMap = new Map(existingDrafts.map(d => [d.id, d]));

          // Transform new items
          const transformed = data.items.map((d, idx) =>
            transformDraftForStorage(d, existingMap.get(d.id) || {}, { apiOrder: nextOrder + idx, fromDraftsApi: true })
          );
          addDraftIdsToSet(transformed, syncedIds);
          nextOrder += data.items.length;

          // Save to IndexedDB
          await uvDBPutAll(UV_DRAFTS_STORES.drafts, transformed);

          // Merge into uvDraftsData and update existing entries in place.
          const incomingById = new Map(transformed.map((draft) => [String(draft?.id || ''), draft]));
          let hadUpdates = false;
          const mergedData = (uvDraftsData || []).map((draft) => {
            const id = String(draft?.id || '');
            const incoming = incomingById.get(id);
            if (!incoming) return draft;
            incomingById.delete(id);
            hadUpdates = true;
            return incoming;
          });
          for (const incoming of incomingById.values()) {
            mergedData.push(incoming);
            hadUpdates = true;
          }
          uvDraftsData = mergedData;
          uvDraftsAwaitingMoreResults = false;

          pageNum++;
          if (onProgress) onProgress(uvDraftsData.length, pageNum);

          if (hadUpdates && uvDraftsPageEl && uvDraftsPageEl.style.display !== 'none') {
            renderUVDraftsSyncUpdate();
          }
          updateUVDraftsStats();
        }

        // Trust the cursor, don't cut off based on count
        cursor = data.cursor || data.next_cursor || null;

        // If response was empty but had a cursor, retry once
        if (cursor && (!data.items || data.items.length === 0)) {
          if (isStaleRun()) return false;
          const retryUrl = new URL('https://sora.chatgpt.com/backend/project_y/profile/drafts');
          retryUrl.searchParams.set('limit', '500');
          retryUrl.searchParams.set('cursor', cursor);
          const retryHeaders = { 'accept': '*/*', 'cache-control': 'no-cache' };
          if (capturedAuthToken) retryHeaders['Authorization'] = capturedAuthToken;
          const retryResp = await fetch(retryUrl.toString(), { credentials: 'include', headers: retryHeaders });
          if (!retryResp.ok) {
            cursor = null;
          } else {
            const retryData = await retryResp.json();
            if (isStaleRun()) return false;
            cursor = retryData.cursor || retryData.next_cursor || null;
            if (retryData.items && retryData.items.length > 0) {
              const existingDrafts2 = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
              if (isStaleRun()) return false;
              const existingMap2 = new Map(existingDrafts2.map(d => [d.id, d]));
              const transformed2 = retryData.items.map((d, idx) =>
                transformDraftForStorage(d, existingMap2.get(d.id) || {}, { apiOrder: nextOrder + idx, fromDraftsApi: true })
              );
              addDraftIdsToSet(transformed2, syncedIds);
              nextOrder += retryData.items.length;
              await uvDBPutAll(UV_DRAFTS_STORES.drafts, transformed2);
              const incomingById2 = new Map(transformed2.map((draft) => [String(draft?.id || ''), draft]));
              const mergedData2 = (uvDraftsData || []).map((draft) => {
                const id = String(draft?.id || '');
                const incoming = incomingById2.get(id);
                if (!incoming) return draft;
                incomingById2.delete(id);
                return incoming;
              });
              for (const incoming of incomingById2.values()) mergedData2.push(incoming);
              uvDraftsData = mergedData2;
              uvDraftsAwaitingMoreResults = false;
              if (uvDraftsPageEl && uvDraftsPageEl.style.display !== 'none') renderUVDraftsSyncUpdate();
              updateUVDraftsStats();
            }
          }
        }
      } catch (err) {
        console.error('[UV Drafts] Background sync error:', err);
        syncSucceeded = false;
        break;
      }
    }

    if (syncSucceeded) {
      // Update sync state when done
      if (!isStaleRun()) {
        await uvDBPut(UV_DRAFTS_STORES.syncState, {
          key: 'last_full_sync',
          value: Date.now()
        });
      }
    }
    return syncSucceeded;
  }

  // Transform API draft to our storage format
  function transformDraftForStorage(apiDraft, existingData = {}, options = {}) {
    const nFrames = apiDraft.creation_config?.n_frames || 0;
    const fps = SORA_DEFAULT_FPS;
    const durationSeconds = nFrames > 0 ? nFrames / fps : 0;
    const kind = apiDraft.kind || existingData.kind || 'sora_draft';
    const fromDraftsApi = options?.fromDraftsApi === true;
    const apiOrderRaw = Number(options?.apiOrder);
    const existingApiOrderRaw = Number(existingData?.api_order);
    const apiOrder = Number.isFinite(apiOrderRaw) && apiOrderRaw >= 0
      ? Math.floor(apiOrderRaw)
      : (Number.isFinite(existingApiOrderRaw) && existingApiOrderRaw >= 0 ? Math.floor(existingApiOrderRaw) : null);
    const violationReason =
      apiDraft.violation_reason ??
      apiDraft.rejection_reason ??
      apiDraft.moderation_result ??
      apiDraft.error_message ??
      apiDraft.reason ??
      existingData.violation_reason ??
      null;
    const thumbnailUrl = apiDraft.encodings?.thumbnail?.path || apiDraft.thumbnail_url || existingData.thumbnail_url || '';
    const previewUrl = apiDraft.encodings?.md?.path || apiDraft.video_url || apiDraft.url || existingData.preview_url || '';
    const noDate = isNoDateDraft({
      ...existingData,
      ...apiDraft,
      kind,
      violation_reason: violationReason,
      thumbnail_url: thumbnailUrl,
      preview_url: previewUrl,
    });
    const post = apiDraft.post && typeof apiDraft.post === 'object' ? apiDraft.post : null;
    const existingPostMeta = existingData.post_meta && typeof existingData.post_meta === 'object'
      ? existingData.post_meta
      : null;
    const { width, height } = extractDraftDimensions(apiDraft, existingData);
    const orientation = resolveDraftOrientationValue(apiDraft, existingData, { width, height });
    const apiCreatedAt = Number(apiDraft.created_at);
    const existingCreatedAt = Number(existingData.created_at);
    const resolvedCreatedAt = Number.isFinite(apiCreatedAt) && apiCreatedAt > 0
      ? apiCreatedAt
      : (Number.isFinite(existingCreatedAt) && existingCreatedAt > 0 ? existingCreatedAt : null);

    // Determine is_read: use API value if present, otherwise existing, otherwise default to true
    let isRead = true; // Default: assume read (not new)
    if (typeof apiDraft.draft_reviewed === 'boolean') {
      isRead = apiDraft.draft_reviewed;
    } else if (typeof existingData.is_read === 'boolean') {
      isRead = existingData.is_read;
    }
    if (noDate) {
      isRead = true;
    }

    const existingNoDateOrder = Number(existingData?.no_date_order);
    let noDateOrder = null;
    if (noDate) {
      if (Number.isFinite(apiOrderRaw) && apiOrderRaw >= 0) {
        noDateOrder = Math.floor(apiOrderRaw);
      } else if (Number.isFinite(existingNoDateOrder) && existingNoDateOrder >= 0) {
        noDateOrder = Math.floor(existingNoDateOrder);
      } else if (Number.isFinite(existingApiOrderRaw) && existingApiOrderRaw >= 0) {
        noDateOrder = Math.floor(existingApiOrderRaw);
      }
    }

    return {
      id: apiDraft.id || apiDraft.generation_id,
      kind,
      prompt: apiDraft.prompt || '',
      title: apiDraft.title || '',
      created_at: noDate ? null : resolvedCreatedAt,
      no_date_order: noDate ? noDateOrder : null,
      api_order: apiOrder,
      width,
      height,
      duration_seconds: durationSeconds,
      thumbnail_url: thumbnailUrl,
      preview_url: previewUrl,
      gif_url: apiDraft.encodings?.gif?.path || '',
      download_url: apiDraft.downloadable_url || apiDraft.download_urls?.no_watermark || apiDraft.video_url || apiDraft.url || existingData.download_url || '',
      can_remix: apiDraft.can_remix ?? true,
      can_storyboard: apiDraft.can_storyboard ?? true,
      storyboard_id: apiDraft.storyboard_id || apiDraft.creation_config?.storyboard_id || '',
      remix_target_draft_id: apiDraft.creation_config?.remix_target_id || existingData.remix_target_draft_id || null,
      remix_target_post_id: extractRemixTargetPostId(apiDraft, existingData),
      post_visibility: apiDraft.post_visibility || null,
      post_id: post?.id || existingData.post_id || null,
      post_permalink: post?.permalink || existingData.post_permalink || null,
      posted_to_public:
        typeof post?.posted_to_public === 'boolean'
          ? post.posted_to_public
          : typeof existingData.posted_to_public === 'boolean'
            ? existingData.posted_to_public
            : null,
      post_meta: post
        ? {
            id: post.id || null,
            permalink: post.permalink || null,
            visibility: post.visibility || null,
            posted_to_public: post.posted_to_public === true,
            share_ref: post.share_ref || null,
            share_setting: post.permissions?.share_setting || null,
          }
        : existingPostMeta,
      tags: apiDraft.tags || [],
      cameo_profiles: apiDraft.creation_config?.cameo_profiles || [],
      task_id: apiDraft.task_id || '',
      generation_type: apiDraft.generation_type || 'video_gen',
      model: apiDraft.model || apiDraft.creation_config?.model || null,
      resolution: apiDraft.resolution || apiDraft.creation_config?.resolution || null,
      orientation,
      n_frames: apiDraft.creation_config?.n_frames || nFrames || 0,
      style: apiDraft.creation_config?.style || null,
      seed: apiDraft.creation_config?.seed || null,
      // Violation reason (if this is a content violation)
      violation_reason: violationReason,
      // Server-side read status (draft_reviewed: true = has been read, false = NEW)
      is_read: isRead,
      // Preserve extension-specific fields from existing data
      // Note: bookmarked is stored separately in localStorage via BOOKMARKS_KEY
      hidden: existingData.hidden ?? false,
      workspace_id: existingData.workspace_id ?? uvDraftsPendingWorkspaceTags.get(apiDraft.task_id) ?? null,
      scheduled_post_id: existingData.scheduled_post_id || null,
      scheduled_post_at: Number(existingData.scheduled_post_at) > 0 ? Number(existingData.scheduled_post_at) : null,
      scheduled_post_status: existingData.scheduled_post_status || null,
      scheduled_post_caption: typeof existingData.scheduled_post_caption === 'string' ? existingData.scheduled_post_caption : '',
      is_unsynced: fromDraftsApi ? false : existingData?.is_unsynced === true,
      cached_at: Date.now(),
      last_fetched: Date.now()
    };
  }

  // Mark a draft as seen - calls server API and updates local cache
  // Track unsynced read marks for retry
  let uvDraftsUnsyncedReads = new Set();
  let uvDraftsRetryTimerId = null;

  // Rate limiter for read API calls (1 per 50ms)
  let uvDraftsReadQueue = [];
  let uvDraftsReadProcessing = false;
  const UV_DRAFTS_READ_RATE_MS = 50;

  async function processReadQueue() {
    if (uvDraftsReadProcessing || uvDraftsReadQueue.length === 0) return;
    uvDraftsReadProcessing = true;
    updateMarkAllProgressUI();

    while (uvDraftsReadQueue.length > 0) {
      const draftId = uvDraftsReadQueue.shift();
      await sendReadRequest(draftId);
      updateMarkAllProgressUI();
      if (uvDraftsReadQueue.length > 0) {
        await new Promise(r => setTimeout(r, UV_DRAFTS_READ_RATE_MS));
      }
    }

    uvDraftsReadProcessing = false;
    updateMarkAllProgressUI();
  }

  async function sendReadRequest(draftId) {
    try {
      const headers = {};
      if (capturedAuthToken) headers['Authorization'] = capturedAuthToken;

      const res = await fetch(`https://sora.chatgpt.com/backend/project_y/profile/drafts/${draftId}/read`, {
        method: 'POST',
        credentials: 'include',
        headers
      });

      if (!res.ok) {
        // 400 = server rejected it, won't succeed on retry — accept local mark and move on
        if (res.status === 400) {
          console.warn('[UV Drafts] Server returned 400 for mark-read, accepting local state:', draftId);
          uvDraftsUnsyncedReads.delete(draftId);
          onReadSyncDelivered(draftId);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      // Success - remove from unsynced if it was there
      uvDraftsUnsyncedReads.delete(draftId);
      onReadSyncDelivered(draftId);
    } catch (err) {
      console.error('[UV Drafts] Failed to mark draft as read on server:', err);
      // Add to unsynced for retry
      uvDraftsUnsyncedReads.add(draftId);
      startUnsyncedReadsRetry();
      updateMarkAllProgressUI();
    }
  }

  async function markDraftAsSeen(draftId) {
    // Update local cache first
    const draft = await uvDBGet(UV_DRAFTS_STORES.drafts, draftId);
    if (draft) {
      draft.is_read = true;
      await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
    }

    // Queue the API call (rate limited)
    queueReadSync(draftId);
  }

  function startUnsyncedReadsRetry() {
    if (uvDraftsRetryTimerId) return; // Already running

    uvDraftsRetryTimerId = setInterval(async () => {
      if (uvDraftsUnsyncedReads.size === 0) {
        clearInterval(uvDraftsRetryTimerId);
        uvDraftsRetryTimerId = null;
        return;
      }

      // Get one unsynced ID to retry
      const draftId = uvDraftsUnsyncedReads.values().next().value;
      if (!draftId) return;

      try {
        const headers = {};
        if (capturedAuthToken) headers['Authorization'] = capturedAuthToken;

        const res = await fetch(`https://sora.chatgpt.com/backend/project_y/profile/drafts/${draftId}/read`, {
          method: 'POST',
          credentials: 'include',
          headers
        });

        if (res.ok) {
          uvDraftsUnsyncedReads.delete(draftId);
          console.log('[UV Drafts] Retry succeeded for:', draftId);
          onReadSyncDelivered(draftId);
        } else if (res.status === 400) {
          // 400 = server won't accept it, stop retrying
          uvDraftsUnsyncedReads.delete(draftId);
          console.warn('[UV Drafts] Retry got 400, giving up for:', draftId);
          onReadSyncDelivered(draftId);
        }
      } catch (err) {
        console.log('[UV Drafts] Retry failed for:', draftId, err.message);
      }
      updateMarkAllProgressUI();
    }, 5000); // Retry one every 5 seconds
  }

  // Get all seen draft IDs as a Set for quick lookup
  async function getSeenDraftIds() {
    const seenDrafts = await uvDBGetAll(UV_DRAFTS_STORES.seenDrafts);
    return new Set(seenDrafts.map(d => d.id));
  }

  // == UV Drafts Page State ==
  let uvDraftsPageEl = null;
  let uvDraftsTitleEl = null;
  let uvDraftsGridEl = null;
  let uvDraftsFilterBarEl = null;
  let uvDraftsLoadingEl = null;
  let uvDraftsSearchInput = null;
  let uvDraftsFilterState = 'all'; // 'all', 'bookmarked', 'hidden', 'violations', 'new', 'unsynced'
  let uvDraftsWorkspaceFilter = null; // workspace_id or null
  let uvDraftsSearchQuery = '';
  let uvDraftsData = []; // Current loaded drafts

  // Virtual scrolling state
  const UV_DRAFTS_BATCH_SIZE = 50; // Render 50 cards at a time

  // Video playback state - once user clicks play, enable hover-to-play
  let uvDraftsVideoInteracted = false;
  let uvDraftsCurrentlyPlayingVideo = null;
  let uvDraftsCurrentlyPlayingDraftId = null;
  let uvDraftsRenderedCount = 0;
  let uvDraftsFilteredCache = []; // Cache filtered results to avoid re-filtering on scroll
  let uvDraftsScrollHandler = null;
  let uvDraftsAwaitingMoreResults = false; // First page was empty, but pagination indicates more results may arrive
  let uvDraftsJustSeenIds = new Set(); // Drafts marked seen this session (stay visible until refresh/filter change)
  let uvDraftsInitRunId = 0;
  let uvDraftsWorkspaceModalEl = null;
  let uvDraftsWorkspaceModalCleanup = null;
  let uvDraftsComposerEl = null;
  let uvDraftsComposerSource = null;
  let uvDraftsComposerState = null;
  let uvDraftsComposerFirstFrame = null; // { object_url, fileName } or null
  let uvDraftsSyncButtonEl = null;
  let uvDraftsMarkAllButtonEl = null;
  let uvDraftsMarkAllStatusEl = null;
  let uvDraftsMarkAllProgressTimerId = null;
  const UV_DRAFTS_SYNC_PROGRESS_KEY = 'SORA_UV_DRAFTS_SYNC_PROGRESS_V1';
  const UV_DRAFTS_MARK_ALL_PROGRESS_KEY = 'SORA_UV_DRAFTS_MARK_ALL_PROGRESS_V1';
  const UV_DRAFTS_PROGRESS_STALE_MS = 2 * 60 * 60 * 1000;
  let uvDraftsSyncUiState = loadPersistedSyncUiState();
  let uvDraftsMarkAllState = loadPersistedMarkAllState();
  let uvDraftsPendingData = [];
  let uvDraftsPendingIds = new Set();
  let uvDraftsPendingPollTimerId = null;
  let uvDraftsPendingFailures = 0;
  let uvDraftsPendingMinPolls = 0; // minimum polls before auto-stop (for newly submitted tasks)
  let uvDraftsGridResizeObserver = null;
  let uvDraftsWindowResizeHandler = null;
  let uvDraftsVisualViewportResizeHandler = null;
  let uvDraftsResponsiveLayoutTimerId = 0;
  let uvDraftsLastGridColumnCapacity = 0;
  // Auto-tag: map task_id → workspace_id for drafts created from within a workspace
  const uvDraftsPendingWorkspaceTags = new Map();
  let uvDraftsSyncConfirmedIds = new Set(); // IDs confirmed by the API in this session
  let uvDraftsTopRefreshInFlight = null;
  const UV_DRAFTS_PENDING_ENDPOINT = 'https://sora.chatgpt.com/backend/nf/pending/v2';
  const UV_DRAFTS_PENDING_POLL_MS = 5000;
  const UV_DRAFTS_PENDING_MAX_FAILURES = 8;

  const UV_DRAFTS_COMPOSER_KEY = 'SORA_UV_DRAFTS_COMPOSER_V1';
  const UV_PENDING_COMPOSE_KEY = 'SORA_UV_PENDING_COMPOSE_V1';
  const UV_PENDING_CREATE_OVERRIDES_KEY = 'SORA_UV_PENDING_CREATE_OVERRIDES_V1';

  const uvDraftsLogic = window.SoraUVDraftsLogic || null;

  function readJSONStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function writeJSONStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function removeStorageKey(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  function loadPersistedSyncUiState() {
    const raw = readJSONStorage(UV_DRAFTS_SYNC_PROGRESS_KEY);
    const fallback = { syncing: false, processed: 0, page: 0 };
    if (!raw || typeof raw !== 'object') return fallback;
    const updatedAt = Number(raw.updatedAt || 0);
    const stale = !updatedAt || (Date.now() - updatedAt > UV_DRAFTS_PROGRESS_STALE_MS);
    return {
      syncing: !stale && raw.syncing === true,
      processed: Number.isFinite(Number(raw.processed)) ? Math.max(0, Math.floor(Number(raw.processed))) : 0,
      page: Number.isFinite(Number(raw.page)) ? Math.max(0, Math.floor(Number(raw.page))) : 0,
    };
  }

  function persistSyncUiState() {
    writeJSONStorage(UV_DRAFTS_SYNC_PROGRESS_KEY, {
      syncing: uvDraftsSyncUiState.syncing === true,
      processed: Number.isFinite(Number(uvDraftsSyncUiState.processed))
        ? Math.max(0, Math.floor(Number(uvDraftsSyncUiState.processed)))
        : 0,
      page: Number.isFinite(Number(uvDraftsSyncUiState.page))
        ? Math.max(0, Math.floor(Number(uvDraftsSyncUiState.page)))
        : 0,
      updatedAt: Date.now(),
    });
  }

  function normalizeMarkAllState(raw) {
    const out = {
      active: false,
      total: 0,
      pendingIds: [],
      startedAt: 0,
      updatedAt: 0,
    };
    if (!raw || typeof raw !== 'object') return out;
    const updatedAt = Number(raw.updatedAt || 0);
    if (!updatedAt || (Date.now() - updatedAt > UV_DRAFTS_PROGRESS_STALE_MS)) return out;
    const pendingIds = Array.isArray(raw.pendingIds)
      ? Array.from(new Set(raw.pendingIds.map((id) => String(id || '').trim()).filter(Boolean)))
      : [];
    const total = Number.isFinite(Number(raw.total))
      ? Math.max(0, Math.floor(Number(raw.total)))
      : pendingIds.length;
    const clampedTotal = Math.max(total, pendingIds.length);
    return {
      active: raw.active === true && pendingIds.length > 0,
      total: clampedTotal,
      pendingIds,
      startedAt: Number(raw.startedAt || 0),
      updatedAt,
    };
  }

  function loadPersistedMarkAllState() {
    return normalizeMarkAllState(readJSONStorage(UV_DRAFTS_MARK_ALL_PROGRESS_KEY));
  }

  function persistMarkAllState() {
    if (!uvDraftsMarkAllState?.active || !Array.isArray(uvDraftsMarkAllState.pendingIds) || uvDraftsMarkAllState.pendingIds.length === 0) {
      removeStorageKey(UV_DRAFTS_MARK_ALL_PROGRESS_KEY);
      return;
    }
    const payload = {
      active: true,
      total: Math.max(
        Number.isFinite(Number(uvDraftsMarkAllState.total)) ? Math.floor(Number(uvDraftsMarkAllState.total)) : 0,
        uvDraftsMarkAllState.pendingIds.length
      ),
      pendingIds: Array.from(new Set(uvDraftsMarkAllState.pendingIds.map((id) => String(id || '').trim()).filter(Boolean))),
      startedAt: Number(uvDraftsMarkAllState.startedAt || Date.now()),
      updatedAt: Date.now(),
    };
    uvDraftsMarkAllState = payload;
    writeJSONStorage(UV_DRAFTS_MARK_ALL_PROGRESS_KEY, payload);
  }

  function clearMarkAllState() {
    uvDraftsMarkAllState = {
      active: false,
      total: 0,
      pendingIds: [],
      startedAt: 0,
      updatedAt: 0,
    };
    removeStorageKey(UV_DRAFTS_MARK_ALL_PROGRESS_KEY);
  }

  function getMarkAllCompletedCount() {
    const total = Number.isFinite(Number(uvDraftsMarkAllState?.total)) ? Math.max(0, Math.floor(Number(uvDraftsMarkAllState.total))) : 0;
    const pending = Array.isArray(uvDraftsMarkAllState?.pendingIds) ? uvDraftsMarkAllState.pendingIds.length : 0;
    return Math.max(0, total - pending);
  }

  function updateMarkAllProgressUI() {
    const hasUi = !!(uvDraftsMarkAllButtonEl && uvDraftsMarkAllStatusEl);
    const shouldTick = hasUi && !!(
      uvDraftsMarkAllState?.active ||
      uvDraftsReadQueue.length > 0 ||
      uvDraftsUnsyncedReads.size > 0
    );
    if (shouldTick) {
      if (!uvDraftsMarkAllProgressTimerId) {
        uvDraftsMarkAllProgressTimerId = setInterval(() => {
          if (!uvDraftsMarkAllState?.active && uvDraftsReadQueue.length === 0 && uvDraftsUnsyncedReads.size === 0) {
            clearInterval(uvDraftsMarkAllProgressTimerId);
            uvDraftsMarkAllProgressTimerId = null;
            return;
          }
          updateMarkAllProgressUI();
        }, 500);
      }
    } else if (uvDraftsMarkAllProgressTimerId) {
      clearInterval(uvDraftsMarkAllProgressTimerId);
      uvDraftsMarkAllProgressTimerId = null;
    }

    if (!hasUi) return;
    if (uvDraftsMarkAllState?.active) {
      const total = Number.isFinite(Number(uvDraftsMarkAllState.total))
        ? Math.max(0, Math.floor(Number(uvDraftsMarkAllState.total)))
        : 0;
      const completed = getMarkAllCompletedCount();
      const queueCount = uvDraftsReadQueue.length;
      const retryCount = uvDraftsUnsyncedReads.size;
      uvDraftsMarkAllButtonEl.disabled = true;
      uvDraftsMarkAllButtonEl.textContent = `Marking ${completed}/${total}...`;
      if (retryCount > 0) {
        uvDraftsMarkAllStatusEl.textContent = `${completed}/${total} • ${retryCount} retrying`;
        uvDraftsMarkAllStatusEl.dataset.tone = 'retry';
      } else if (queueCount > 0) {
        uvDraftsMarkAllStatusEl.textContent = `${completed}/${total} • syncing`;
        uvDraftsMarkAllStatusEl.dataset.tone = 'syncing';
      } else {
        uvDraftsMarkAllStatusEl.textContent = `${completed}/${total}`;
        uvDraftsMarkAllStatusEl.dataset.tone = 'syncing';
      }
      return;
    }
    uvDraftsMarkAllButtonEl.disabled = false;
    uvDraftsMarkAllButtonEl.textContent = '✓ Mark All Read';
    const queueCount = uvDraftsReadQueue.length;
    const retryCount = uvDraftsUnsyncedReads.size;
    if (queueCount > 0) {
      uvDraftsMarkAllStatusEl.textContent = `Syncing ${queueCount}...`;
      uvDraftsMarkAllStatusEl.dataset.tone = 'syncing';
    } else if (retryCount > 0) {
      uvDraftsMarkAllStatusEl.textContent = `${retryCount} failed, retrying...`;
      uvDraftsMarkAllStatusEl.dataset.tone = 'retry';
    } else {
      uvDraftsMarkAllStatusEl.textContent = '';
      uvDraftsMarkAllStatusEl.dataset.tone = '';
    }
  }

  function queueReadSync(draftId) {
    const id = String(draftId || '').trim();
    if (!id) return;
    if (!uvDraftsReadQueue.includes(id)) {
      uvDraftsReadQueue.push(id);
    }
    updateMarkAllProgressUI();
    processReadQueue();
  }

  function onReadSyncDelivered(draftId) {
    if (!uvDraftsMarkAllState?.active || !Array.isArray(uvDraftsMarkAllState.pendingIds)) {
      updateMarkAllProgressUI();
      return;
    }
    const id = String(draftId || '').trim();
    if (!id) return;
    if (!uvDraftsMarkAllState.pendingIds.includes(id)) {
      updateMarkAllProgressUI();
      return;
    }
    uvDraftsMarkAllState.pendingIds = uvDraftsMarkAllState.pendingIds.filter((pendingId) => pendingId !== id);
    if (uvDraftsMarkAllState.pendingIds.length === 0) {
      clearMarkAllState();
    } else {
      persistMarkAllState();
    }
    updateMarkAllProgressUI();
  }

  function resumePersistedMarkAllProgress(options = {}) {
    const queue = options.queue !== false;
    uvDraftsMarkAllState = loadPersistedMarkAllState();
    if (!uvDraftsMarkAllState.active) {
      clearMarkAllState();
      updateMarkAllProgressUI();
      return;
    }
    if (queue) {
      for (const draftId of uvDraftsMarkAllState.pendingIds) {
        queueReadSync(draftId);
      }
    }
    persistMarkAllState();
    updateMarkAllProgressUI();
  }

  function mergeDraftListById(primaryDrafts, secondaryDrafts) {
    if (uvDraftsLogic && typeof uvDraftsLogic.mergeDraftListById === 'function') {
      return uvDraftsLogic.mergeDraftListById(primaryDrafts, secondaryDrafts);
    }
    const merged = [];
    const seen = new Set();
    const pushUnique = (draft) => {
      const id = draft?.id ? String(draft.id) : '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(draft);
    };
    for (const draft of primaryDrafts || []) pushUnique(draft);
    for (const draft of secondaryDrafts || []) pushUnique(draft);
    return merged;
  }

  function appendUniqueDrafts(existingDrafts, incomingDrafts) {
    if (uvDraftsLogic && typeof uvDraftsLogic.appendUniqueDrafts === 'function') {
      return uvDraftsLogic.appendUniqueDrafts(existingDrafts, incomingDrafts);
    }
    const out = Array.isArray(existingDrafts) ? [...existingDrafts] : [];
    const seen = new Set(out.map((d) => String(d?.id || '')).filter(Boolean));
    for (const draft of incomingDrafts || []) {
      const id = String(draft?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(draft);
    }
    return out;
  }

  function removeDraftById(drafts, draftId) {
    if (uvDraftsLogic && typeof uvDraftsLogic.removeDraftById === 'function') {
      return uvDraftsLogic.removeDraftById(drafts, draftId);
    }
    const id = String(draftId || '');
    return (drafts || []).filter((d) => String(d?.id || '') !== id);
  }

  function getDraftPreviewText(draft, maxLen = 60) {
    if (uvDraftsLogic && typeof uvDraftsLogic.getDraftPreviewText === 'function') {
      return uvDraftsLogic.getDraftPreviewText(draft, maxLen);
    }
    const source = String(draft?.prompt || draft?.title || 'Untitled');
    return source.length > maxLen ? source.slice(0, maxLen) + '...' : source;
  }

  function computeUVDraftsStats() {
    const workspaceScopedDrafts = filterDraftsByWorkspace(uvDraftsData, uvDraftsWorkspaceFilter);
    const bookmarks = getBookmarks();
    if (uvDraftsLogic && typeof uvDraftsLogic.computeDraftStats === 'function') {
      return uvDraftsLogic.computeDraftStats(workspaceScopedDrafts, bookmarks, uvDraftsJustSeenIds);
    }
    return {
      total: workspaceScopedDrafts.length,
      bookmarked: workspaceScopedDrafts.filter((d) => bookmarks.has(d.id)).length,
      hidden: workspaceScopedDrafts.filter((d) => d.hidden).length,
      newCount: workspaceScopedDrafts.filter((d) => d?.is_unsynced !== true && isDraftUnreadState(d) && !uvDraftsJustSeenIds.has(d.id)).length,
    };
  }

  const UV_DRAFTS_VIEW_STATE_KEY = 'SORA_UV_DRAFTS_VIEW_STATE_V1';
  const UV_DRAFTS_FILTER_VALUES = new Set(['all', 'bookmarked', 'hidden', 'violations', 'new', 'unsynced']);
  let uvDraftsViewStateLoaded = false;

  function normalizeUVDraftsViewState(raw) {
    if (uvDraftsLogic && typeof uvDraftsLogic.normalizeViewState === 'function') {
      return uvDraftsLogic.normalizeViewState(raw);
    }
    const out = {
      filterState: 'all',
      workspaceFilter: null,
      searchQuery: '',
    };
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.filterState === 'string' && UV_DRAFTS_FILTER_VALUES.has(raw.filterState)) {
      out.filterState = raw.filterState;
    }
    if (typeof raw.workspaceFilter === 'string' && raw.workspaceFilter.trim()) {
      out.workspaceFilter = raw.workspaceFilter.trim();
    }
    if (typeof raw.searchQuery === 'string') {
      out.searchQuery = raw.searchQuery;
    }
    return out;
  }

  function loadUVDraftsViewState() {
    if (uvDraftsViewStateLoaded) return;
    uvDraftsViewStateLoaded = true;
    try {
      const raw = JSON.parse(localStorage.getItem(UV_DRAFTS_VIEW_STATE_KEY) || '{}');
      const viewState = normalizeUVDraftsViewState(raw);
      uvDraftsFilterState = viewState.filterState;
      uvDraftsWorkspaceFilter = viewState.workspaceFilter;
      uvDraftsSearchQuery = viewState.searchQuery;
    } catch {}
  }

  function persistUVDraftsViewState() {
    try {
      localStorage.setItem(
        UV_DRAFTS_VIEW_STATE_KEY,
        JSON.stringify({
          filterState: uvDraftsFilterState,
          workspaceFilter: uvDraftsWorkspaceFilter,
          searchQuery: uvDraftsSearchQuery,
        })
      );
    } catch {}
  }

  function defaultUVDraftsComposerState() {
    return {
      prompt: loadStoredComposerPromptValue() ?? '',
      model: getDefaultComposerModel(),
      durationSeconds: 10,
      gensCount: loadStoredGensCount(),
      orientation: 'portrait',
      size: 'small',
      style_id: '',
    };
  }

  function snapToValidDuration(seconds) {
    const s = Math.round(Number(seconds) || 10);
    let best = VALID_DURATIONS[0];
    let bestDist = Math.abs(s - best);
    for (let i = 1; i < VALID_DURATIONS.length; i++) {
      const dist = Math.abs(s - VALID_DURATIONS[i]);
      if (dist < bestDist) { best = VALID_DURATIONS[i]; bestDist = dist; }
    }
    return best;
  }

  function normalizeUVDraftsComposerState(raw, options = {}) {
    const out = defaultUVDraftsComposerState();
    const storedGensCount = Object.prototype.hasOwnProperty.call(options, 'storedGensCount')
      ? options.storedGensCount
      : loadStoredGensCountValue();
    const preferStoredGensCount = options.preferStoredGensCount === true;
    const storedPrompt = Object.prototype.hasOwnProperty.call(options, 'storedPrompt')
      ? options.storedPrompt
      : loadStoredComposerPromptValue();
    const preferStoredPrompt = options.preferStoredPrompt === true;
    if (!raw || typeof raw !== 'object') return out;
    const preferredPrompt = resolvePreferredComposerPromptValue(raw.prompt, storedPrompt, preferStoredPrompt);
    if (typeof preferredPrompt === 'string') out.prompt = preferredPrompt;
    if (typeof raw.model === 'string') out.model = normalizeComposerModel(raw.model) || out.model;
    if (typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds) && raw.durationSeconds > 0) {
      out.durationSeconds = snapToValidDuration(raw.durationSeconds);
    }
    const preferredGensCount = resolvePreferredComposerGensCountValue(
      raw.gensCount,
      storedGensCount,
      preferStoredGensCount
    );
    if (preferredGensCount != null) {
      out.gensCount = clampGensCount(preferredGensCount);
    }
    if (raw.orientation === 'portrait' || raw.orientation === 'landscape') {
      out.orientation = raw.orientation;
    }
    out.size = normalizeComposerSizeForModel(raw.size, out.model, loadUltraModeEnabledFromStorage());
    if (typeof raw.style_id === 'string') out.style_id = raw.style_id;
    return out;
  }

  function loadUVDraftsComposerState() {
    if (uvDraftsComposerState) return uvDraftsComposerState;
    try {
      const raw = JSON.parse(localStorage.getItem(UV_DRAFTS_COMPOSER_KEY) || '{}');
      uvDraftsComposerState = normalizeUVDraftsComposerState(raw, {
        preferStoredGensCount: true,
        preferStoredPrompt: true,
      });
    } catch {
      uvDraftsComposerState = defaultUVDraftsComposerState();
    }
    uvDraftsComposerState.model = normalizeComposerModel(uvDraftsComposerState.model) || getDefaultComposerModel();
    uvDraftsComposerState.gensCount = clampGensCount(uvDraftsComposerState.gensCount);
    return uvDraftsComposerState;
  }

  function persistUVDraftsComposerState() {
    try {
      localStorage.setItem(UV_DRAFTS_COMPOSER_KEY, JSON.stringify(uvDraftsComposerState || defaultUVDraftsComposerState()));
    } catch {}
    persistComposerPrompt(uvDraftsComposerState?.prompt || '');
    persistComposerGensCount(uvDraftsComposerState?.gensCount);
  }

  function loadPendingCreateOverrides() {
    try {
      const raw = sessionStorage.getItem(UV_PENDING_CREATE_OVERRIDES_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const createdAt = Number(parsed.createdAt || 0);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > 30 * 60 * 1000) {
        sessionStorage.removeItem(UV_PENDING_CREATE_OVERRIDES_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function savePendingCreateOverrides(overrides) {
    try {
      sessionStorage.setItem(UV_PENDING_CREATE_OVERRIDES_KEY, JSON.stringify({
        ...overrides,
        createdAt: Date.now(),
        consumed: false,
      }));
    } catch {}
  }

  function clearPendingCreateOverrides() {
    try {
      sessionStorage.removeItem(UV_PENDING_CREATE_OVERRIDES_KEY);
    } catch {}
  }

  function applyComposerOverridesToCreateBody(bodyString, overrides) {
    if (uvDraftsLogic && typeof uvDraftsLogic.applyCreateBodyOverrides === 'function') {
      return uvDraftsLogic.applyCreateBodyOverrides(bodyString, overrides);
    }

    if (typeof bodyString !== 'string' || !overrides || typeof overrides !== 'object') {
      return bodyString;
    }

    const normalized = {};
    const takeString = (key) => {
      const value = overrides[key];
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      normalized[key] = trimmed;
    };
    takeString('prompt');
    takeString('model');
    takeString('orientation');
    takeString('size');
    takeString('style_id');
    if (normalized.size) {
      const effectiveModel = normalizeComposerModel(normalized.model) || getDefaultComposerModel();
      normalized.size = normalizeComposerSizeForModel(
        normalized.size,
        effectiveModel,
        loadUltraModeEnabledFromStorage()
      );
    }
    if (!Object.keys(normalized).length) return bodyString;

    const applyOverrides = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      let changed = false;

      if (!obj.creation_config || typeof obj.creation_config !== 'object') {
        obj.creation_config = {};
        changed = true;
      }

      if (normalized.prompt) {
        if (obj.prompt !== normalized.prompt) {
          obj.prompt = normalized.prompt;
          changed = true;
        }
        if (obj.creation_config.prompt !== normalized.prompt) {
          obj.creation_config.prompt = normalized.prompt;
          changed = true;
        }
      }

      if (normalized.model) {
        if (obj.model !== normalized.model) {
          obj.model = normalized.model;
          changed = true;
        }
        if (obj.creation_config.model !== normalized.model) {
          obj.creation_config.model = normalized.model;
          changed = true;
        }
      }

      if (normalized.orientation) {
        if (obj.creation_config.orientation !== normalized.orientation) {
          obj.creation_config.orientation = normalized.orientation;
          changed = true;
        }
      }

      if (normalized.size) {
        if (obj.size !== normalized.size) {
          obj.size = normalized.size;
          changed = true;
        }
        if (obj.creation_config.size !== normalized.size) {
          obj.creation_config.size = normalized.size;
          changed = true;
        }
      }

      if (normalized.style_id) {
        if (obj.creation_config.style_id !== normalized.style_id) {
          obj.creation_config.style_id = normalized.style_id;
          changed = true;
        }
      }

      return changed;
    };

    try {
      const parsed = JSON.parse(bodyString);
      let changed = false;
      changed = applyOverrides(parsed) || changed;

      if (typeof parsed.body === 'string') {
        try {
          const inner = JSON.parse(parsed.body);
          const innerChanged = applyOverrides(inner);
          if (innerChanged) {
            parsed.body = JSON.stringify(inner);
            changed = true;
          }
        } catch {}
      }

      return changed ? JSON.stringify(parsed) : bodyString;
    } catch {
      return bodyString;
    }
  }
  // ============================================================================
  // == UV DRAFTS PAGE ==
  // ============================================================================

  function formatDurationShort(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const s = Math.round(seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function formatTimeAgo(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const now = Date.now() / 1000;
    const diff = now - ts;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts * 1000).toLocaleDateString();
  }

  function getWorkspaceNameById(workspaceId) {
    if (!workspaceId) return '';
    const ws = uvWorkspaces.find((item) => item.id === workspaceId);
    return ws?.name || '';
  }

  function syncWorkspaceSelectValue() {
    if (!uvWorkspaceSelectEl) return;
    const optionValues = new Set(Array.from(uvWorkspaceSelectEl.options).map((opt) => opt.value));
    const nextValue = uvDraftsWorkspaceFilter && optionValues.has(uvDraftsWorkspaceFilter)
      ? uvDraftsWorkspaceFilter
      : '';
    if (uvWorkspaceSelectEl.value !== nextValue) {
      uvWorkspaceSelectEl.value = nextValue;
    }
  }

  function syncCreatortoolsPathToWorkspaceFilter(options = {}) {
    const currentSlug = extractWorkspaceSlugFromCreatortoolsPath(location.pathname);
    if (currentSlug == null) return false;
    const nextPath = buildCreatortoolsPathForWorkspace(uvDraftsWorkspaceFilter, uvWorkspaces);
    if (location.pathname === nextPath) return false;
    const nextUrl = `${nextPath}${location.search || ''}${location.hash || ''}`;
    const historyMode = options.historyMode === 'replace' ? 'replaceState' : 'pushState';
    history[historyMode]({}, '', nextUrl);
    return true;
  }

  function syncWorkspaceFilterFromCreatortoolsPath(options = {}) {
    const currentSlug = extractWorkspaceSlugFromCreatortoolsPath(location.pathname);
    if (currentSlug == null) return false;

    let nextWorkspaceFilter = uvDraftsWorkspaceFilter;
    if (!currentSlug) {
      nextWorkspaceFilter = null;
    } else if (uvWorkspaces.length > 0) {
      nextWorkspaceFilter = findWorkspaceIdByUrlSlug(currentSlug, uvWorkspaces);
      if (!nextWorkspaceFilter) {
        nextWorkspaceFilter = null;
      }
    } else if (options.allowEmptyWorkspaces === true) {
      nextWorkspaceFilter = null;
    } else {
      return false;
    }

    const changed = nextWorkspaceFilter !== uvDraftsWorkspaceFilter;
    if (changed) {
      uvDraftsWorkspaceFilter = nextWorkspaceFilter;
      if (options.persist !== false) {
        persistUVDraftsViewState();
      }
    }

    if (options.updateSelect !== false) {
      syncWorkspaceSelectValue();
    }
    updateUVDraftsHeaderTitle();

    const canonicalPath = buildCreatortoolsPathForWorkspace(uvDraftsWorkspaceFilter, uvWorkspaces);
    if (options.updateUrl !== false && location.pathname !== canonicalPath) {
      const nextUrl = `${canonicalPath}${location.search || ''}${location.hash || ''}`;
      history.replaceState({}, '', nextUrl);
    }

    if (changed && options.render !== false && uvDraftsGridEl && isUVDraftsPageVisible()) {
      renderUVDraftsGrid();
    }
    return changed;
  }

  function parseSearchTerms(query) {
    if (uvDraftsLogic && typeof uvDraftsLogic.parseSearchQuery === 'function') {
      return uvDraftsLogic.parseSearchQuery(query);
    }
    const out = { terms: [], filters: [] };
    const knownKeys = new Set([
      'id', 'task', 'ws', 'workspace', 'model', 'ori', 'orientation', 'kind', 'tag', 'title',
      'prompt', 'dur', 'duration', 'new', 'hidden', 'bookmarked', 'resolution', 'style', 'seed'
    ]);
    const raw = typeof query === 'string' ? query : '';
    if (!raw.trim()) return out;

    const tokens = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === '"' && raw[i - 1] !== '\\') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && (/\s/.test(ch) || ch === ',' || ch === ';')) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += ch;
    }
    if (current) tokens.push(current);

    for (const token of tokens) {
      const cleanedToken = token.trim().replace(/[;,]+$/g, '');
      if (!cleanedToken) continue;
      const i = cleanedToken.indexOf(':');
      if (i > 0) {
        const key = cleanedToken.slice(0, i).toLowerCase();
        const value = cleanedToken.slice(i + 1).trim().replace(/[;,]+$/g, '');
        if (value && knownKeys.has(key)) {
          out.filters.push({ key, value });
          continue;
        }
      } else {
        const term = cleanedToken.toLowerCase();
        if (term) out.terms.push(term);
        continue;
      }
      const fallbackTerm = cleanedToken.toLowerCase();
      if (fallbackTerm) out.terms.push(fallbackTerm);
    }
    return out;
  }

  function buildDraftSearchBlob(draft) {
    if (uvDraftsLogic && typeof uvDraftsLogic.buildDraftSearchBlob === 'function') {
      return uvDraftsLogic.buildDraftSearchBlob(draft, getWorkspaceNameById(draft?.workspace_id));
    }
    const cameos = (draft.cameo_profiles || [])
      .map((c) => (typeof c === 'string' ? c : c?.username))
      .filter(Boolean)
      .join(' ');
    const tags = (draft.tags || []).join(' ');
    const fields = [
      draft.id,
      draft.task_id,
      draft.prompt,
      draft.title,
      draft.kind,
      draft.generation_type,
      draft.orientation,
      draft.model,
      draft.resolution,
      draft.style,
      draft.seed,
      getWorkspaceNameById(draft.workspace_id),
      cameos,
      tags,
    ];
    return fields.filter(Boolean).join(' ').toLowerCase();
  }

  function matchesDurationFilter(draft, value) {
    if (uvDraftsLogic && typeof uvDraftsLogic.matchesDurationFilter === 'function') {
      return uvDraftsLogic.matchesDurationFilter(draft?.duration_seconds, value);
    }
    const duration = Number(draft.duration_seconds || 0);
    const m = value.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)(?:s|sec|secs|seconds?)?$/i);
    if (!m) return false;
    const op = m[1] || '=';
    const target = Number(m[2]);
    if (!Number.isFinite(target)) return false;
    if (op === '>') return duration > target;
    if (op === '<') return duration < target;
    if (op === '>=') return duration >= target;
    if (op === '<=') return duration <= target;
    return Math.abs(duration - target) < 0.01;
  }

  function matchesDraftSearchFilters(draft, parsed, bookmarks) {
    if (uvDraftsLogic && typeof uvDraftsLogic.matchesDraftSearchFilters === 'function') {
      return uvDraftsLogic.matchesDraftSearchFilters(draft, parsed, {
        bookmarks,
        resolveWorkspaceName: getWorkspaceNameById,
      });
    }
    if (!parsed.filters.length) return true;
    for (const filter of parsed.filters) {
      const key = filter.key;
      const value = filter.value.toLowerCase();
      if (key === 'id' && !String(draft.id || '').toLowerCase().includes(value)) return false;
      if (key === 'task' && !String(draft.task_id || '').toLowerCase().includes(value)) return false;
      if ((key === 'ws' || key === 'workspace') && !getWorkspaceNameById(draft.workspace_id).toLowerCase().includes(value)) return false;
      if (key === 'model' && !String(draft.model || '').toLowerCase().includes(value)) return false;
      if ((key === 'ori' || key === 'orientation') && !String(draft.orientation || '').toLowerCase().includes(value)) return false;
      if (key === 'kind' && !String(draft.kind || '').toLowerCase().includes(value)) return false;
      if (key === 'tag' && !(draft.tags || []).some((tag) => String(tag).toLowerCase().includes(value))) return false;
      if (key === 'title' && !String(draft.title || '').toLowerCase().includes(value)) return false;
      if (key === 'prompt' && !String(draft.prompt || '').toLowerCase().includes(value)) return false;
      if ((key === 'dur' || key === 'duration') && !matchesDurationFilter(draft, filter.value)) return false;
      if (key === 'resolution' && !String(draft.resolution || '').toLowerCase().includes(value)) return false;
      if (key === 'style' && !String(draft.style || '').toLowerCase().includes(value)) return false;
      if (key === 'seed' && !String(draft.seed || '').toLowerCase().includes(value)) return false;
      if (key === 'new' && value !== String(isDraftUnreadState(draft))) return false;
      if (key === 'hidden' && value !== String(!!draft.hidden)) return false;
      if (key === 'bookmarked' && value !== String(bookmarks.has(draft.id))) return false;
    }
    return true;
  }

  // == Workspaces Helpers ==
  let uvWorkspaces = [];
  let uvWorkspaceSelectEl = null;

  async function loadWorkspaces() {
    try {
      uvWorkspaces = await uvDBGetAll(UV_DRAFTS_STORES.workspaces);
    } catch (err) {
      console.error('[UV Drafts] Load workspaces error:', err);
      uvWorkspaces = [];
    }
    return uvWorkspaces;
  }

  async function createWorkspace(name, color = '#3b82f6') {
    const workspace = {
      id: `workspace_${Date.now()}`,
      name: name,
      color: color,
      created_at: Date.now(),
      draft_ids: []
    };
    await uvDBPut(UV_DRAFTS_STORES.workspaces, workspace);
    uvWorkspaces.push(workspace);
    updateWorkspaceSelect();
    return workspace;
  }

  async function deleteWorkspace(workspaceId) {
    await uvDBDelete(UV_DRAFTS_STORES.workspaces, workspaceId);
    uvWorkspaces = uvWorkspaces.filter(w => w.id !== workspaceId);

    // Remove workspace reference from drafts
    const drafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
    const localById = new Map(uvDraftsData.map((draft) => [draft.id, draft]));
    for (const draft of drafts) {
      if (draft.workspace_id === workspaceId) {
        draft.workspace_id = null;
        await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
        const localDraft = localById.get(draft.id);
        if (localDraft) localDraft.workspace_id = null;
      }
    }

    if (uvDraftsWorkspaceFilter === workspaceId) {
      uvDraftsWorkspaceFilter = null;
      persistUVDraftsViewState();
    }

    updateWorkspaceSelect();
    renderUVDraftsGrid();
    updateUVDraftsStats();
  }

  async function addDraftToWorkspace(draftId, workspaceId, options = {}) {
    const normalizedDraftId = typeof draftId === 'string' ? draftId.trim() : '';
    const normalizedWorkspaceId = workspaceId ? String(workspaceId).trim() : null;
    const normalizedTaskId = typeof options?.taskId === 'string' ? options.taskId.trim() : '';

    const draft = normalizedDraftId ? await uvDBGet(UV_DRAFTS_STORES.drafts, normalizedDraftId) : null;
    if (draft) {
      draft.workspace_id = normalizedWorkspaceId;
      await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
    }

    const updateDraftCollection = (drafts) => {
      const matchedTaskIds = new Set();
      if (!Array.isArray(drafts)) return matchedTaskIds;
      for (const item of drafts) {
        const itemId = typeof item?.id === 'string' ? item.id.trim() : '';
        const itemTaskId = typeof item?.task_id === 'string' ? item.task_id.trim() : '';
        if ((normalizedDraftId && itemId === normalizedDraftId) || (normalizedTaskId && itemTaskId === normalizedTaskId)) {
          item.workspace_id = normalizedWorkspaceId;
          if (itemTaskId) matchedTaskIds.add(itemTaskId);
        }
      }
      return matchedTaskIds;
    };

    const matchedTaskIds = new Set([
      ...updateDraftCollection(uvDraftsData),
      ...updateDraftCollection(uvDraftsPendingData),
    ]);
    if (normalizedTaskId) matchedTaskIds.add(normalizedTaskId);

    for (const taskId of matchedTaskIds) {
      if (normalizedWorkspaceId) {
        uvDraftsPendingWorkspaceTags.set(taskId, normalizedWorkspaceId);
      } else {
        uvDraftsPendingWorkspaceTags.delete(taskId);
      }
    }
  }

  function updateWorkspaceSelect() {
    if (!uvWorkspaceSelectEl) return;
    const prevValue = uvWorkspaceSelectEl.value;
    uvWorkspaceSelectEl.innerHTML = '<option value="">All Workspaces</option>';
    for (const ws of uvWorkspaces) {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = ws.name;
      opt.style.color = ws.color;
      uvWorkspaceSelectEl.appendChild(opt);
    }
    // Add "Manage..." option
    const manageOpt = document.createElement('option');
    manageOpt.value = '__manage__';
    manageOpt.textContent = '+ Manage Workspaces...';
    uvWorkspaceSelectEl.appendChild(manageOpt);

    // Preserve current selection if still valid.
    const optionValues = new Set(Array.from(uvWorkspaceSelectEl.options).map((opt) => opt.value));
    if (prevValue && optionValues.has(prevValue)) {
      uvWorkspaceSelectEl.value = prevValue;
    } else if (uvDraftsWorkspaceFilter && optionValues.has(uvDraftsWorkspaceFilter)) {
      uvWorkspaceSelectEl.value = uvDraftsWorkspaceFilter || '';
    } else {
      uvWorkspaceSelectEl.value = '';
      if (uvDraftsWorkspaceFilter) {
        uvDraftsWorkspaceFilter = null;
        persistUVDraftsViewState();
      }
    }
    syncWorkspaceSelectValue();
    syncCreatortoolsPathToWorkspaceFilter({ historyMode: 'replace' });
    updateUVDraftsHeaderTitle();
  }

  function updateUVDraftsHeaderTitle() {
    if (!uvDraftsTitleEl) return;
    uvDraftsTitleEl.textContent = getUVDraftsPageTitle(uvDraftsWorkspaceFilter, getWorkspaceNameById);
    try {
      document.title = getUVDraftsDocumentTitle(uvDraftsWorkspaceFilter, getWorkspaceNameById, location.pathname);
    } catch {}
  }

  function closeDraftWorkspacePicker() {
    if (typeof uvDraftsWorkspaceModalCleanup === 'function') {
      try {
        uvDraftsWorkspaceModalCleanup();
      } catch {}
      uvDraftsWorkspaceModalCleanup = null;
    }
    if (!uvDraftsWorkspaceModalEl) return;
    try {
      uvDraftsWorkspaceModalEl.remove();
    } catch {}
    uvDraftsWorkspaceModalEl = null;
  }

  async function showDraftWorkspacePicker(draft) {
    if (!draft?.id) return;
    closeDraftWorkspacePicker();
    await loadWorkspaces();

    const modal = document.createElement('div');
    modal.className = 'uvd-modal-backdrop';

    const panel = document.createElement('div');
    panel.className = 'uvd-modal';

    const head = document.createElement('div');
    head.className = 'uvd-modal-head';
    const title = document.createElement('h3');
    title.textContent = 'Workspace';
    const subtitle = document.createElement('p');
    subtitle.textContent = getDraftPreviewText(draft, 72);
    head.appendChild(title);
    head.appendChild(subtitle);
    panel.appendChild(head);

    const status = document.createElement('div');
    status.className = 'uvd-modal-status';
    panel.appendChild(status);

    const list = document.createElement('div');
    list.className = 'uvd-ws-list';
    panel.appendChild(list);

    let selectedWorkspaceId = String(draft.workspace_id || '');

    const setStatus = (text, tone = '') => {
      status.textContent = text || '';
      status.dataset.tone = tone;
    };

    const renderWorkspaceOptions = () => {
      list.innerHTML = '';
      const options = [
        { id: '', name: 'No workspace', color: '', hint: 'Remove from workspace' },
        ...uvWorkspaces
          .slice()
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
          .map((ws) => ({
            id: String(ws.id || ''),
            name: ws.name || 'Untitled workspace',
            color: ws.color || '#3b82f6',
            hint: ws.id === draft.workspace_id ? 'Current workspace' : '',
          })),
      ];

      for (const option of options) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'uvd-ws-option';
        if (selectedWorkspaceId === option.id) row.classList.add('is-selected');

        const left = document.createElement('div');
        left.className = 'uvd-ws-option-main';

        const dot = document.createElement('span');
        dot.className = 'uvd-ws-dot';
        if (option.id) dot.style.background = option.color;
        else dot.classList.add('is-none');
        left.appendChild(dot);

        const labels = document.createElement('div');
        labels.className = 'uvd-ws-labels';
        const name = document.createElement('span');
        name.className = 'uvd-ws-name';
        name.textContent = option.name;
        labels.appendChild(name);
        if (option.hint) {
          const hint = document.createElement('span');
          hint.className = 'uvd-ws-hint';
          hint.textContent = option.hint;
          labels.appendChild(hint);
        }
        left.appendChild(labels);
        row.appendChild(left);

        const check = document.createElement('span');
        check.className = 'uvd-ws-check';
        check.textContent = selectedWorkspaceId === option.id ? '✓' : '';
        row.appendChild(check);

        row.addEventListener('click', () => {
          selectedWorkspaceId = option.id;
          renderWorkspaceOptions();
        });
        list.appendChild(row);
      }
    };
    renderWorkspaceOptions();

    const createRow = document.createElement('div');
    createRow.className = 'uvd-ws-create';
    const createInput = document.createElement('input');
    createInput.type = 'text';
    createInput.className = 'uvd-modal-input';
    createInput.placeholder = 'New workspace name...';
    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'uvd-modal-btn';
    createBtn.textContent = '+ Create';
    createBtn.addEventListener('click', async () => {
      const name = createInput.value.trim();
      if (!name) return;
      const existing = uvWorkspaces.find((ws) => String(ws.name || '').toLowerCase() === name.toLowerCase());
      if (existing) {
        selectedWorkspaceId = String(existing.id || '');
        createInput.value = '';
        renderWorkspaceOptions();
        setStatus('Selected existing workspace.', 'ok');
        return;
      }
      try {
        createBtn.disabled = true;
        const ws = await createWorkspace(name);
        selectedWorkspaceId = String(ws.id || '');
        createInput.value = '';
        renderWorkspaceOptions();
        setStatus('Workspace created.', 'ok');
      } catch (err) {
        console.error('[UV Drafts] Create workspace error:', err);
        setStatus('Failed to create workspace.', 'error');
      } finally {
        createBtn.disabled = false;
      }
    });
    createInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createBtn.click();
      }
    });
    createRow.appendChild(createInput);
    createRow.appendChild(createBtn);
    panel.appendChild(createRow);

    const footer = document.createElement('div');
    footer.className = 'uvd-modal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'uvd-modal-btn is-secondary';
    cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'uvd-modal-btn is-primary';
    saveBtn.textContent = 'Save';

    cancelBtn.addEventListener('click', closeDraftWorkspacePicker);
    saveBtn.addEventListener('click', async () => {
      try {
        saveBtn.disabled = true;
        const nextWorkspaceId = selectedWorkspaceId || null;
        if (String(draft.workspace_id || '') !== String(nextWorkspaceId || '')) {
          await addDraftToWorkspace(draft.id, nextWorkspaceId, { taskId: draft.task_id });
          renderUVDraftsGrid();
          updateUVDraftsStats();
        }
        closeDraftWorkspacePicker();
      } catch (err) {
        console.error('[UV Drafts] Failed to update workspace:', err);
        setStatus('Failed to update workspace.', 'error');
        saveBtn.disabled = false;
      }
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDraftWorkspacePicker();
      }
    };
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDraftWorkspacePicker();
    });

    modal.appendChild(panel);
    document.documentElement.appendChild(modal);
    window.addEventListener('keydown', onKeydown, true);
    uvDraftsWorkspaceModalCleanup = () => {
      try {
        window.removeEventListener('keydown', onKeydown, true);
      } catch {}
    };
    uvDraftsWorkspaceModalEl = modal;
    createInput.focus();
  }

  function showWorkspaceManager() {
    const modal = document.createElement('div');
    modal.className = 'uvd-modal-backdrop';

    const panel = document.createElement('div');
    panel.className = 'uvd-modal uvd-modal--workspace-manager';

    const head = document.createElement('div');
    head.className = 'uvd-modal-head';

    const title = document.createElement('h3');
    title.textContent = 'Manage Workspaces';
    head.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Create and organize workspace buckets for your drafts.';
    head.appendChild(subtitle);
    panel.appendChild(head);

    // New workspace form
    const form = document.createElement('div');
    form.className = 'uvd-ws-create';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New workspace name...';
    input.className = 'uvd-modal-input';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'uvd-modal-btn is-primary';
    addBtn.textContent = '+ Create';
    const createWorkspaceFromInput = async () => {
      if (!input.value.trim()) return;
      await createWorkspace(input.value.trim());
      input.value = '';
      renderWorkspaceList();
    };
    addBtn.addEventListener('click', createWorkspaceFromInput);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      createWorkspaceFromInput();
    });

    form.appendChild(input);
    form.appendChild(addBtn);
    panel.appendChild(form);

    // Workspace list
    const list = document.createElement('div');
    list.className = 'uvd-ws-manage-list';

    function renderWorkspaceList() {
      list.innerHTML = '';
      for (const ws of uvWorkspaces) {
        const row = document.createElement('div');
        row.className = 'uvd-ws-manage-row';

        const colorDot = document.createElement('span');
        colorDot.className = 'uvd-ws-dot';
        colorDot.style.background = ws.color || '#3b82f6';
        row.appendChild(colorDot);

        const name = document.createElement('div');
        name.className = 'uvd-ws-manage-name';
        name.textContent = ws.name;
        row.appendChild(name);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'uvd-ws-manage-delete';
        delBtn.textContent = '✕';
        delBtn.title = `Delete ${ws.name}`;
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete workspace "${ws.name}"?`)) return;
          await deleteWorkspace(ws.id);
          renderWorkspaceList();
        });
        row.appendChild(delBtn);

        list.appendChild(row);
      }

      if (uvWorkspaces.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'uvd-ws-manage-empty';
        empty.textContent = 'No workspaces yet. Create one above!';
        list.appendChild(empty);
      }
    }

    panel.appendChild(list);
    renderWorkspaceList();

    const footer = document.createElement('div');
    footer.className = 'uvd-modal-footer';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'uvd-modal-btn';
    closeBtn.textContent = 'Done';
    closeBtn.addEventListener('click', () => modal.remove());
    footer.appendChild(closeBtn);
    panel.appendChild(footer);

    modal.appendChild(panel);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  function applyNativeComposerPrompt(promptText) {
    const text = typeof promptText === 'string' ? promptText.trim() : '';
    if (!text) return false;
    const textarea =
      document.querySelector('textarea[placeholder="Describe your video..."]') ||
      document.querySelector('textarea[placeholder="Describe changes..."]') ||
      document.querySelector('textarea[placeholder^="Describe changes"]') ||
      document.querySelector('textarea[placeholder*="Describe changes"]');
    if (!textarea) return false;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.focus();
    return true;
  }

  function checkPendingComposePrompt() {
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(UV_PENDING_COMPOSE_KEY) || 'null');
    } catch {}
    if (!pending || typeof pending !== 'object') return;
    if (Date.now() - Number(pending.createdAt || 0) > 30 * 60 * 1000) {
      sessionStorage.removeItem(UV_PENDING_COMPOSE_KEY);
      return;
    }

    const attemptFill = (retries = 0) => {
      if (applyNativeComposerPrompt(pending.prompt || '')) {
        sessionStorage.removeItem(UV_PENDING_COMPOSE_KEY);
        return;
      }
      if (retries < 30) {
        setTimeout(() => attemptFill(retries + 1), 120);
      } else {
        sessionStorage.removeItem(UV_PENDING_COMPOSE_KEY);
      }
    };
    setTimeout(() => attemptFill(), 250);
  }

  function buildComposerSourceFromDraft(draft) {
    if (!draft?.id) return null;
    return {
      type: 'draft',
      id: draft.id,
      storyboard_id: draft.storyboard_id || '',
      can_storyboard: draft.can_storyboard !== false,
      prompt: draft.prompt || '',
      title: draft.title || '',
      url: draft.download_url || draft.preview_url || '',
      preview_url: draft.preview_url || '',
      thumbnail_url: draft.thumbnail_url || '',
      orientation: draft.orientation || '',
      duration_seconds: draft.duration_seconds || 0,
      cameo_profiles: draft.cameo_profiles || [],
      label: `${draft.title || draft.prompt || draft.id}`.slice(0, 90),
    };
  }

  async function fetchPublishedPostById(postId) {
    const id = typeof postId === 'string' ? postId.trim() : '';
    if (!id) return null;
    if (!capturedAuthToken) throw new Error('Browse Sora first so published source lookup can authenticate.');
    const headers = { accept: '*/*', Authorization: capturedAuthToken };
    const res = await fetch(`https://sora.chatgpt.com/backend/project_y/post/${encodeURIComponent(id)}`, {
      credentials: 'include',
      headers,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = extractErrorMessage(json, `HTTP ${res.status}`);
      throw new Error(`Published source lookup failed: ${detail}`);
    }
    return extractPublishedPost(json);
  }

  async function fetchDraftDetailById(draftId) {
    const id = typeof draftId === 'string' ? draftId.trim() : '';
    if (!id) return null;
    if (!capturedAuthToken) throw new Error('Browse Sora first so draft source lookup can authenticate.');
    const headers = { accept: '*/*', Authorization: capturedAuthToken };
    const res = await fetch(`https://sora.chatgpt.com/backend/project_y/profile/drafts/${encodeURIComponent(id)}`, {
      credentials: 'include',
      headers,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = extractErrorMessage(json, `HTTP ${res.status}`);
      throw new Error(`Draft source lookup failed: ${detail}`);
    }
    if (json && typeof json === 'object') {
      return json.draft || json.item?.draft || json.item || json.data?.draft || json.data || json;
    }
    return null;
  }

  async function resolveRetryComposerSource(draft) {
    const parentDraftId = typeof draft?.remix_target_draft_id === 'string'
      ? draft.remix_target_draft_id.trim()
      : '';
    if (parentDraftId) {
      const inMemoryParent = [...(uvDraftsData || []), ...(uvDraftsPendingData || [])]
        .find((item) => String(item?.id || '').trim() === parentDraftId);
      if (inMemoryParent) return buildComposerSourceFromDraft(inMemoryParent);

      try {
        const storedParent = await uvDBGet(UV_DRAFTS_STORES.drafts, parentDraftId);
        if (storedParent) return buildComposerSourceFromDraft(storedParent);
      } catch {}
    }

    const parentPostId = typeof draft?.remix_target_post_id === 'string'
      ? draft.remix_target_post_id.trim()
      : '';
    if (!parentPostId) return null;
    if (isGenerationDraftId(parentPostId)) {
      const existingDraft = [...(uvDraftsData || []), ...(uvDraftsPendingData || [])]
        .find((item) => String(item?.id || '').trim() === parentPostId);
      const existingStoredDraft = existingDraft || await uvDBGet(UV_DRAFTS_STORES.drafts, parentPostId).catch(() => null);
      if (existingStoredDraft) return buildComposerSourceFromDraft(existingStoredDraft);

      const fetchedDraft = await fetchDraftDetailById(parentPostId);
      const transformedDraft = transformDraftForStorage(fetchedDraft || {}, fetchedDraft || {});
      if (transformedDraft?.id) {
        try {
          await uvDBPut(UV_DRAFTS_STORES.drafts, transformedDraft);
        } catch {}
      }
      return buildComposerSourceFromDraft(transformedDraft);
    }
    const post = await fetchPublishedPostById(parentPostId);
    const source = buildComposerSourceFromPublishedPost(post, parentPostId);
    if (!source?.id) {
      throw new Error('Published source did not expose a remix target.');
    }
    return source;
  }

  function getComposerSourceHint(source) {
    if (!source || typeof source !== 'object') return '';
    if (source.type === 'url' && source.url) return `Source URL: ${source.url}`;
    if (source.type === 'file' && source.fileName) return `Local file: ${source.fileName}`;
    if (source.type === 'draft' && source.id) return `Source draft: ${source.id}`;
    if (source.type === 'post' && source.post_id) return `Source post: ${source.post_id}`;
    if (source.url) return `Source: ${source.url}`;
    return '';
  }

  function releaseComposerSource(source) {
    if (!source || source.type !== 'file') return;
    const objectUrl = typeof source.object_url === 'string' ? source.object_url : '';
    if (!objectUrl || !/^blob:/i.test(objectUrl)) return;
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }

  function normalizeComposerSource(source) {
    if (!source || typeof source !== 'object') return null;

    const normalized = {
      type: String(source.type || '').trim().toLowerCase(),
      id: String(source.id || '').trim(),
      post_id: String(source.post_id || '').trim(),
      storyboard_id: String(source.storyboard_id || '').trim(),
      can_storyboard: source.can_storyboard !== false,
      prompt: String(source.prompt || '').trim(),
      title: String(source.title || '').trim(),
      url: String(source.url || '').trim(),
      preview_url: String(source.preview_url || '').trim(),
      thumbnail_url: String(source.thumbnail_url || '').trim(),
      fileName: String(source.fileName || '').trim(),
      object_url: String(source.object_url || '').trim(),
      orientation: String(source.orientation || '').trim(),
      duration_seconds: Number(source.duration_seconds) > 0 ? Number(source.duration_seconds) : 0,
      cameo_profiles: Array.isArray(source.cameo_profiles) ? source.cameo_profiles : [],
      label: String(source.label || '').trim(),
    };

    const hasDraftIdentity = !!(normalized.id || normalized.storyboard_id);
    const hasPostIdentity = !!normalized.post_id;
    const hasPlayableMedia = !!(normalized.url || normalized.preview_url || normalized.object_url);
    const hasFileIdentity = !!(normalized.fileName || normalized.object_url);

    let valid = false;
    if (normalized.type === 'draft') valid = hasDraftIdentity || hasPlayableMedia;
    else if (normalized.type === 'post') valid = hasPostIdentity || hasPlayableMedia;
    else if (normalized.type === 'url') {
      try {
        const parsed = new URL(normalized.url);
        valid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch { valid = false; }
    }
    else if (normalized.type === 'file') valid = hasFileIdentity;
    else valid = hasDraftIdentity || hasPlayableMedia || hasFileIdentity;
    if (!valid) return null;

    if (!normalized.label) {
      normalized.label = (
        normalized.title ||
        normalized.prompt ||
        normalized.fileName ||
        normalized.post_id ||
        normalized.id ||
        normalized.url ||
        'Source video'
      ).slice(0, 90);
    }

    return normalized;
  }

  function setComposerSource(source, statusEl = null) {
    const nextSource = normalizeComposerSource(source);
    if (uvDraftsComposerSource && uvDraftsComposerSource !== nextSource) {
      releaseComposerSource(uvDraftsComposerSource);
    }
    uvDraftsComposerSource = nextSource;

    // Auto-populate cameos from source draft
    populateCameosFromSource(nextSource);

    if (uvDraftsComposerEl) {
      const sourcePanelEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-source-panel="1"]');
      const sourceEmptyEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-source-empty="1"]');
      const sourcePreviewEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-source-preview="1"]');
      const sourceTitleEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-source-title="1"]');
      const sourceSubtitleEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-source-subtitle="1"]');
      const sourceClearEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-source-clear="1"]');
      const dropzoneEl = uvDraftsComposerEl.querySelector('[data-uvd-dropzone="1"]');
      const remixBtn = uvDraftsComposerEl.querySelector('[data-uvd-compose-remix="1"]');
      const extendBtn = uvDraftsComposerEl.querySelector('[data-uvd-compose-extend="1"]');
      const hasSource = !!nextSource;

      uvDraftsComposerEl.classList.toggle('is-source-ready', hasSource);
      if (dropzoneEl) {
        dropzoneEl.style.display = hasSource ? 'none' : '';
      }
      if (sourcePanelEl) {
        sourcePanelEl.hidden = !hasSource;
        sourcePanelEl.style.display = hasSource ? 'grid' : 'none';
      }
      if (sourceEmptyEl) {
        sourceEmptyEl.hidden = hasSource;
        sourceEmptyEl.style.display = hasSource ? 'none' : '';
      }
      if (sourceClearEl) {
        sourceClearEl.hidden = !hasSource;
        sourceClearEl.style.display = hasSource ? '' : 'none';
      }

      if (sourceTitleEl) {
        sourceTitleEl.textContent = hasSource
          ? (nextSource.label || nextSource.title || nextSource.fileName || nextSource.id || 'Source video')
          : '';
      }
      if (sourceSubtitleEl) {
        if (!hasSource) {
          sourceSubtitleEl.textContent = '';
        } else {
          const subtitleParts = [];
          if (nextSource.type === 'draft' && nextSource.id) subtitleParts.push(`Draft ${nextSource.id}`);
          if (nextSource.type === 'post' && nextSource.post_id) subtitleParts.push(`Post ${nextSource.post_id}`);
          if (nextSource.type === 'url') subtitleParts.push('URL source');
          if (nextSource.type === 'file') subtitleParts.push('Local file');
          if (Number(nextSource.duration_seconds) > 0) {
            subtitleParts.push(formatDurationShort(Number(nextSource.duration_seconds)));
          }
          sourceSubtitleEl.textContent = subtitleParts.join(' • ');
        }
      }

      if (sourcePreviewEl) {
        sourcePreviewEl.textContent = '';
        const previewImage = hasSource && typeof nextSource.thumbnail_url === 'string' ? nextSource.thumbnail_url : '';
        const previewVideo = hasSource
          ? (
            (typeof nextSource.preview_url === 'string' && nextSource.preview_url) ||
            (typeof nextSource.url === 'string' && nextSource.url) ||
            (typeof nextSource.object_url === 'string' && nextSource.object_url) ||
            ''
          )
          : '';

        if (previewImage) {
          const img = document.createElement('img');
          img.src = previewImage;
          img.alt = 'Source preview';
          sourcePreviewEl.appendChild(img);
        } else if (previewVideo) {
          const video = document.createElement('video');
          video.src = previewVideo;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'metadata';
          sourcePreviewEl.appendChild(video);
        } else {
          const fallback = document.createElement('div');
          fallback.className = 'uvd-compose-source-fallback';
          fallback.textContent = 'Video';
          sourcePreviewEl.appendChild(fallback);
        }
      }

      if (remixBtn) remixBtn.disabled = !hasSource;
      if (extendBtn) extendBtn.disabled = !hasSource;

      // UX: selecting a source should seed the prompt only when the prompt is currently empty.
      if (hasSource) {
        const promptEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-prompt="1"]');
        const currentPrompt = String(promptEl?.value || '').trim();
        const sourcePrompt = String(nextSource.prompt || '').trim() || String(nextSource.title || '').trim();
        if (promptEl && !currentPrompt && sourcePrompt) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(promptEl, sourcePrompt);
          } else {
            promptEl.value = sourcePrompt;
          }
          promptEl.dispatchEvent(new Event('input', { bubbles: true }));
          promptEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
    if (statusEl) {
      if (nextSource) {
        statusEl.textContent = 'Source ready. Use Remix or Extend.';
        statusEl.dataset.tone = 'ok';
      } else {
        statusEl.textContent = '';
        delete statusEl.dataset.tone;
      }
    }
  }

  function persistComposerDurationOverride(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return;
    const safeSeconds = snapToValidDuration(s);
    const frames = SECONDS_TO_FRAMES[safeSeconds] || safeSeconds * SORA_DEFAULT_FPS;
    try {
      localStorage.setItem(
        'SCT_DURATION_OVERRIDE_V1',
        JSON.stringify({ seconds: safeSeconds, frames, setAt: Date.now() })
      );
    } catch {}
  }

  // ---- Sentinel SDK ----

  let sentinelInitPromise = null;

  async function ensureSentinelSDK() {
    if (typeof globalScope.SentinelSDK !== 'undefined') return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://chatgpt.com/sentinel/20260219f9f6/sdk.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load Sentinel SDK'));
      document.head.appendChild(s);
    });
    const deadline = Date.now() + 10000;
    while (typeof globalScope.SentinelSDK === 'undefined') {
      if (Date.now() > deadline) throw new Error('SentinelSDK load timeout');
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async function getSentinelToken() {
    if (cachedSentinelToken && Date.now() < cachedSentinelExpiry) {
      return cachedSentinelToken;
    }
    if (!sentinelInitPromise) {
      sentinelInitPromise = (async () => {
        await ensureSentinelSDK();
        if (!sentinelInitialized) {
          await globalScope.SentinelSDK.init('sora_init');
          sentinelInitialized = true;
        }
      })().catch(err => {
        sentinelInitPromise = null;
        throw err;
      });
    }
    await sentinelInitPromise;
    const token = await globalScope.SentinelSDK.token('sora_2_create_task');
    if (!token) throw new Error('Sentinel SDK returned null token');
    cachedSentinelToken = token;
    cachedSentinelExpiry = Date.now() + 8 * 60 * 1000; // 8 min TTL
    return token;
  }

  function setComposerStatus(text, tone = '') {
    const statusEl = uvDraftsComposerEl?.querySelector?.('[data-uvd-compose-status="1"]');
    if (!statusEl) return;
    statusEl.textContent = typeof text === 'string' ? text : '';
    if (tone) statusEl.dataset.tone = tone;
    else delete statusEl.dataset.tone;
  }

  function normalizeCameoUsername(value) {
    return typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
  }

  function rememberComposerCameoIdentity(userId, username = '') {
    const id = typeof userId === 'string' ? userId.trim() : '';
    const normalizedUsername = normalizeCameoUsername(username);
    if (!id || !normalizedUsername) return;
    composerCameoUsernames[id] = normalizedUsername;
  }

  function getComposerCameoLabel(userId) {
    const id = typeof userId === 'string' ? userId.trim() : '';
    if (!id) return '';
    const username = composerCameoUsernames[id];
    return username ? `@${username}` : id;
  }

  function getComposerCameoPromptValue(userId) {
    const id = typeof userId === 'string' ? userId.trim() : '';
    if (!id) return '';
    const username = composerCameoUsernames[id];
    return username ? `@${username}` : id;
  }

  async function resolveComposerCameoInput(rawInput) {
    const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
    if (!trimmed) throw new Error('Enter a cameo username or user ID.');
    const directId = trimmed.replace(/^@/, '');
    if (/^(user-|ch_)/i.test(directId)) {
      return { userId: directId, username: composerCameoUsernames[directId] || '' };
    }
    if (!capturedAuthToken) {
      throw new Error('Browse Sora first so cameo username lookup can authenticate.');
    }

    const username = normalizeCameoUsername(trimmed);
    const params = new URLSearchParams({
      username,
      intent: 'cameo',
      limit: '10',
    });
    const res = await fetch(`https://sora.chatgpt.com/backend/project_y/profile/search_mentions?${params.toString()}`, {
      headers: { Authorization: capturedAuthToken },
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`Cameo lookup failed (HTTP ${res.status}).`);
    }
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    const normalizedNeedle = username.toLowerCase();
    const picked = items.find((item) => normalizeCameoUsername(item?.profile?.username).toLowerCase() === normalizedNeedle) || items[0];
    const userId = picked?.profile?.user_id || picked?.profile?.id || picked?.user_id || '';
    const foundUsername = normalizeCameoUsername(picked?.profile?.username || picked?.username || username);
    if (!userId) {
      throw new Error(`No cameo match found for @${username}.`);
    }
    return { userId: String(userId).trim(), username: foundUsername };
  }

  function buildPendingRingMarkup(progressPct) {
    const pct = Number(progressPct);
    const pctNorm = Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 0;
    const indeterminate = pctNorm === 0;
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const dashArray = indeterminate
      ? `${circumference * 0.25} ${circumference * 0.75}`
      : `${circumference}`;
    const dashOffset = indeterminate
      ? circumference * 0.125
      : circumference - (pctNorm / 100) * circumference;
    const spinner = indeterminate
      ? '<animateTransform attributeName="transform" type="rotate" from="0 28 28" to="360 28 28" dur="1.4s" repeatCount="indefinite" />'
      : '';
    const text = pctNorm > 0 ? `${Math.round(pctNorm)}%` : '';
    return `<svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="${radius}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/>
      <g data-pending-ring-spinner="1">
        <circle data-pending-ring-progress="1" cx="28" cy="28" r="${radius}" fill="none" stroke="#89b6ff" stroke-width="3"
          stroke-linecap="round" stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}"
          transform="rotate(-90 28 28)" style="transition:stroke-dashoffset 0.6s ease;"/>
        ${spinner}
      </g>
      <text x="28" y="28" dy="0.35em" text-anchor="middle"
        fill="#89b6ff" font-size="13" font-weight="600" font-family="system-ui,sans-serif">${text}</text>
    </svg>`;
  }

  async function createPublicPostForDraft(draft, caption) {
    if (!draft?.id) throw new Error('Missing draft ID');
    if (!capturedAuthToken) throw new Error('Not authenticated. Browse Sora first to capture auth token.');
    const sentinel = await getSentinelToken();
    const headers = {
      Authorization: capturedAuthToken,
      'Content-Type': 'application/json',
      'openai-sentinel-token': sentinel,
    };
    const res = await fetch('https://sora.chatgpt.com/backend/project_y/post', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(buildPublicPostPayload(draft.id, caption)),
      __sctDirect: true,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = extractErrorMessage(json, `HTTP ${res.status}`);
      throw new Error(detail);
    }
    return extractPublishedPost(json);
  }

  async function deleteScheduledPostsForDraft(draftId) {
    const id = typeof draftId === 'string' ? draftId.trim() : '';
    if (!id) return;
    const scheduledPosts = await uvDBGetAll(UV_DRAFTS_STORES.scheduledPosts);
    for (const scheduledPost of scheduledPosts) {
      if (scheduledPost?.draft_id === id) {
        await uvDBDelete(UV_DRAFTS_STORES.scheduledPosts, scheduledPost.id);
      }
    }
  }

  async function persistDraftRecord(draft) {
    if (!draft?.id) return;
    await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
  }

  async function setDraftScheduledState(draft, scheduledPost = null) {
    if (!draft || typeof draft !== 'object') return;
    if (scheduledPost && typeof scheduledPost === 'object') {
      draft.scheduled_post_id = scheduledPost.id || draft.scheduled_post_id || null;
      draft.scheduled_post_at = Number(scheduledPost.scheduled_at) > 0 ? Number(scheduledPost.scheduled_at) : null;
      draft.scheduled_post_status = typeof scheduledPost.status === 'string' ? scheduledPost.status : 'pending';
      draft.scheduled_post_caption = typeof scheduledPost.caption === 'string' ? scheduledPost.caption : '';
    } else {
      delete draft.scheduled_post_id;
      delete draft.scheduled_post_at;
      delete draft.scheduled_post_status;
      delete draft.scheduled_post_caption;
    }
    await persistDraftRecord(draft);
  }

  // ---- API: Fetch models & styles ----

  async function fetchComposerModels() {
    if (!capturedAuthToken) return;
    try {
      const res = await fetch('https://sora.chatgpt.com/backend/models?nf2=true', {
        headers: { 'Authorization': capturedAuthToken },
      });
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.data) && json.data.length) {
        composerModels = json.data.map(m => ({ value: m.id, label: m.label || m.id }));
        composerModelValues = new Set(composerModels.map(m => m.value));
        refreshComposerModelSelect();
      }
    } catch {}
  }

  async function fetchComposerStyles() {
    if (!capturedAuthToken) return;
    try {
      const res = await fetch('https://sora.chatgpt.com/backend/project_y/initialize_async', {
        headers: { 'Authorization': capturedAuthToken },
      });
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.styles) && json.styles.length) {
        composerStyles = json.styles.map(s => ({ value: s.id, label: s.display_name || s.id }));
        refreshComposerStyleSelect();
      }
    } catch {}
  }

  function refreshComposerModelSelect() {
    if (!uvDraftsComposerEl) return;
    const sel = uvDraftsComposerEl.querySelector('[data-uvd-compose-model="1"]');
    if (!sel) return;
    const preferredValue =
      normalizeComposerModel(uvDraftsComposerState?.model) ||
      normalizeComposerModel(modelOverride) ||
      normalizeComposerModel(sel.value);
    sel.innerHTML = composerModels.map(m =>
      `<option value="${escapeHtml(m.value)}">${escapeHtml(m.label)}</option>`
    ).join('');
    sel.value = preferredValue || composerModels[0]?.value || '';
    if (uvDraftsComposerState) {
      uvDraftsComposerState.model = sel.value || getDefaultComposerModel();
      persistUVDraftsComposerState();
    }
    if (sel.value) modelOverride = sel.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function refreshComposerStyleSelect() {
    if (!uvDraftsComposerEl) return;
    const sel = uvDraftsComposerEl.querySelector('[data-uvd-compose-style="1"]');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">None</option>' + composerStyles.map(s =>
      `<option value="${escapeHtml(s.value)}">${escapeHtml(s.label)}</option>`
    ).join('');
    if (current && composerStyles.some(s => s.value === current)) sel.value = current;
    else sel.value = '';
  }

  // ---- File upload for first frame ----

  async function uploadFirstFrame(file) {
    if (!capturedAuthToken) throw new Error('Not authenticated');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('https://sora.chatgpt.com/backend/project_y/file/upload', {
      method: 'POST',
      headers: { 'Authorization': capturedAuthToken },
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    const json = await res.json();
    if (json.user_error_message) throw new Error(json.user_error_message);
    if (!json.file_id) throw new Error('Upload returned no file_id');
    return json.file_id;
  }

  // ---- Cameo UI helpers ----

  function renderCameoList() {
    if (!uvDraftsComposerEl) return;
    const listEl = uvDraftsComposerEl.querySelector('[data-uvd-cameo-list="1"]');
    if (!listEl) return;
    listEl.innerHTML = '';
    composerCameoIds.forEach((userId, idx) => {
      const canSwap = !!uvDraftsComposerSource && composerSourceCameoIds.has(userId);
      const chip = document.createElement('div');
      chip.className = 'uvd-cameo-chip';
      const replacement = composerCameoReplacements[userId];
      const labelEl = document.createElement('span');
      labelEl.className = 'uvd-cameo-label';
      labelEl.textContent = replacement ? `${getComposerCameoLabel(userId)} → ${getComposerCameoLabel(replacement)}` : getComposerCameoLabel(userId);
      const swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.className = 'uvd-cameo-swap';
      swapBtn.title = 'Swap cameo';
      swapBtn.textContent = '⇄';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'uvd-cameo-remove';
      removeBtn.title = 'Remove cameo';
      removeBtn.textContent = '×';
      chip.append(labelEl);
      if (canSwap) chip.append(swapBtn);
      chip.append(removeBtn);
      removeBtn.addEventListener('click', () => {
        composerCameoIds.splice(idx, 1);
        delete composerCameoReplacements[userId];
        delete composerCameoUsernames[userId];
        composerSourceCameoIds.delete(userId);
        renderCameoList();
      });
      swapBtn.addEventListener('click', async () => {
        const input = globalScope.prompt(
          'Replace with username or user ID:',
          getComposerCameoPromptValue(composerCameoReplacements[userId] || '')
        );
        if (input === null) return;
        if (input.trim() === '') {
          delete composerCameoReplacements[userId];
          renderCameoList();
          setComposerStatus(`Removed replacement for ${getComposerCameoLabel(userId)}.`, 'ok');
          return;
        }
        try {
          swapBtn.disabled = true;
          setComposerStatus(`Looking up ${input.trim()}...`);
          const resolved = await resolveComposerCameoInput(input);
          composerCameoReplacements[userId] = resolved.userId;
          rememberComposerCameoIdentity(resolved.userId, resolved.username);
          renderCameoList();
          setComposerStatus(`Replacement set to ${getComposerCameoLabel(resolved.userId)}.`, 'ok');
        } catch (err) {
          setComposerStatus(err?.message || 'Failed to resolve cameo username.', 'error');
        } finally {
          swapBtn.disabled = false;
        }
      });
      listEl.appendChild(chip);
    });
  }

  function populateCameosFromSource(source) {
    composerCameoIds = [];
    composerCameoReplacements = {};
    composerSourceCameoIds = new Set();
    if (source?.cameo_profiles && Array.isArray(source.cameo_profiles)) {
      for (const cp of source.cameo_profiles) {
        const rawId = typeof cp === 'string'
          ? cp
          : cp?.user_id || cp?.id || cp?.user?.id || cp?.username || cp?.handle || cp?.name || cp?.user?.username || cp?.user?.handle || '';
        const userId = String(rawId || '').trim().replace(/^@/, '');
        const username = normalizeCameoUsername(
          typeof cp === 'string'
            ? ''
            : cp?.username || cp?.handle || cp?.name || cp?.user?.username || cp?.user?.handle || ''
        );
        rememberComposerCameoIdentity(userId, username);
        if (userId && !composerCameoIds.includes(userId)) {
          composerCameoIds.push(userId);
          composerSourceCameoIds.add(userId);
        }
      }
    }
    renderCameoList();
  }

  // ---- Direct API: startComposerFlow ----

  async function startComposerFlow(mode, statusEl) {
    const state = normalizeUVDraftsComposerState(uvDraftsComposerState || defaultUVDraftsComposerState());
    uvDraftsComposerState = state;
    persistUVDraftsComposerState();

    const prompt = state.prompt.trim();
    const source = uvDraftsComposerSource;

    const setStatus = (text, tone = 'info') => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.dataset.tone = tone;
    };

    if (!capturedAuthToken) {
      setStatus('Not authenticated. Browse Sora first to capture auth token.', 'error');
      return;
    }

    const requiresSource = uvDraftsLogic?.modeRequiresComposerSource
      ? uvDraftsLogic.modeRequiresComposerSource(mode)
      : mode === 'remix' || mode === 'extend';
    if (requiresSource && !source) {
      setStatus('Drop a draft/video source first.', 'error');
      return;
    }

    if (!prompt && mode === 'compose') {
      setStatus('Enter a prompt.', 'error');
      return;
    }

    // Update model override for api.js compatibility
    if (state.model) modelOverride = normalizeComposerModel(state.model) || modelOverride;
    persistComposerDurationOverride(state.durationSeconds);
    persistComposerGensCount(state.gensCount);

    // Build the /nf/create request body
    const nFrames = SECONDS_TO_FRAMES[state.durationSeconds] || 300;
    const remixTargetId = String(source?.id || '').trim();
    const body = {
      kind: 'video',
      prompt: prompt || source?.prompt || source?.title || '',
      model: normalizeComposerModel(state.model) || composerModels[0]?.value || 'sy_8',
      orientation: state.orientation || 'portrait',
      size: normalizeComposerSizeForModel(state.size, state.model, loadUltraModeEnabledFromStorage()),
      n_frames: nFrames,
    };

    // Style
    if (state.style_id) body.style_id = state.style_id;

    // Cameos
    if (composerCameoIds.length) body.cameo_ids = [...composerCameoIds];
    if (Object.keys(composerCameoReplacements).length) {
      body.cameo_replacements = { ...composerCameoReplacements };
    }

    // Remix
    if (mode === 'remix') {
      if (!remixTargetId) {
        setStatus('Source video could not be prepared for remix.', 'error');
        return;
      }
      body.remix_target_id = remixTargetId;
    }

    // Extend (storyboard)
    if (mode === 'extend') {
      if (source?.storyboard_id) {
        body.storyboard_id = source.storyboard_id;
      } else if (remixTargetId) {
        // Fallback: use remix with extend-style prompt
        body.remix_target_id = remixTargetId;
        if (!prompt) {
          body.prompt = 'Extend this video seamlessly with matching style, motion, and framing.';
        }
      } else {
        setStatus('Source video could not be prepared for extend.', 'error');
        return;
      }
    }

    setStatus('Preparing generation…', 'ok');

    try {
      // Upload first frame if present
      let firstFrameFileId = null;
      if (uvDraftsComposerFirstFrame) {
        const file = uvDraftsComposerFirstFrame._file;
        if (file) {
          setStatus('Uploading first frame…', 'ok');
          firstFrameFileId = await uploadFirstFrame(file);
        }
      }
      if (firstFrameFileId) {
        body.inpaint_items = [{ kind: 'file', file_id: firstFrameFileId }];
      }

      // Get sentinel token
      setStatus('Generating sentinel token…', 'ok');
      const sentinel = await getSentinelToken();

      const headers = {
        'Authorization': capturedAuthToken,
        'Content-Type': 'application/json',
        'openai-sentinel-token': sentinel,
      };

      // Send N parallel generation requests
      const gensCount = clampGensCount(state.gensCount || 1);
      setStatus(`Starting ${gensCount} generation(s)…`, 'ok');

      const tasks = [];
      for (let i = 0; i < gensCount; i++) {
        tasks.push(
          fetch('https://sora.chatgpt.com/backend/nf/create', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            __sctDirect: true,
          }).then(r => r.json())
        );
      }
      const results = await Promise.allSettled(tasks);

      // Extract task IDs and feed into pending draft polling
      const taskIds = [];
      const errors = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.id) {
          taskIds.push(r.value.id);
        } else {
          const errMsg = r.status === 'rejected'
            ? extractErrorMessage(r.reason, 'Request failed')
            : extractErrorMessage(r.value, 'Unknown error');
          errors.push(errMsg);
        }
      }

      if (taskIds.length) {
        // Auto-tag: remember workspace for these tasks so completed drafts inherit it
        if (uvDraftsWorkspaceFilter) {
          for (const taskId of taskIds) {
            uvDraftsPendingWorkspaceTags.set(taskId, uvDraftsWorkspaceFilter);
          }
        }
        // Start continuous polling for the new tasks. The v2 endpoint may not
        // list them immediately, so set a minimum poll count to prevent the
        // poller from stopping before the backend registers the tasks.
        uvDraftsPendingMinPolls = 3;
        continuePendingDraftsPolling();
        setStatus(`Started ${taskIds.length} generation(s).` + (errors.length ? ` ${errors.length} failed.` : ''), 'ok');
      } else {
        setStatus('All generations failed: ' + (errors[0] || 'Unknown error'), 'error');
      }
    } catch (err) {
      setStatus('Error: ' + extractErrorMessage(err, 'Generation failed'), 'error');
    }
  }

  function buildUVDraftsComposer() {
    if (uvDraftsComposerFirstFrame?.object_url) {
      try { URL.revokeObjectURL(uvDraftsComposerFirstFrame.object_url); } catch {}
      uvDraftsComposerFirstFrame = null;
    }
    loadUVDraftsComposerState();
    const modelOptionsHtml = composerModels
      .map((model) => `<option value="${escapeHtml(model.value)}">${escapeHtml(model.label)}</option>`)
      .join('');
    const styleOptionsHtml = '<option value="">None</option>' + composerStyles
      .map((s) => `<option value="${escapeHtml(s.value)}">${escapeHtml(s.label)}</option>`)
      .join('');
    const composer = document.createElement('aside');
    composer.className = 'uvd-composer';
    composer.innerHTML = `
      <div class="uvd-composer-head">
        <h2>Compose</h2>
        <p></p>
      </div>
      <div class="uvd-dropzone" data-uvd-dropzone="1">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.45"><rect x="2" y="2" width="20" height="20" rx="2"/><polygon points="10,8 16,12 10,16"/></svg>
        <strong>Drag Draft Here</strong>
        <span>Drag and drop a draft to remix or extend</span>
      </div>
      <div class="uvd-compose-source-card" data-uvd-compose-source-panel="1" hidden>
        <div class="uvd-compose-source-preview" data-uvd-compose-source-preview="1"></div>
        <div class="uvd-compose-source-meta">
          <div class="uvd-compose-source-title" data-uvd-compose-source-title="1"></div>
          <div class="uvd-compose-source-subtitle" data-uvd-compose-source-subtitle="1"></div>
        </div>
        <button type="button" class="uvd-compose-source-clear" data-uvd-compose-source-clear="1">Remove</button>
      </div>
      <div class="uvd-compose-source-empty" data-uvd-compose-source-empty="1"></div>
      <div class="uvd-firstframe-zone" data-uvd-firstframe-zone="1">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.45"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        <strong>First Frame Image</strong>
        <span>Click to browse or drop an image</span>
        <input type="file" accept="image/*" data-uvd-firstframe-input="1" hidden />
      </div>
      <div class="uvd-firstframe-preview" data-uvd-firstframe-preview="1">
        <img data-uvd-firstframe-img="1" alt="First frame" />
        <div class="uvd-firstframe-meta">
          <div class="uvd-firstframe-name" data-uvd-firstframe-name="1"></div>
          <button type="button" class="uvd-firstframe-clear" data-uvd-firstframe-clear="1">Remove</button>
        </div>
      </div>
      <label class="uvd-field">
        <span>Prompt</span>
        <textarea data-uvd-compose-prompt="1" placeholder="Describe your video..."></textarea>
      </label>
      <div class="uvd-field-grid">
        <label class="uvd-field">
          <span>Model</span>
          <select data-uvd-compose-model="1">
            ${modelOptionsHtml}
          </select>
        </label>
        <label class="uvd-field">
          <span>Duration</span>
          <select data-uvd-compose-duration="1">
            <option value="5">5s</option>
            <option value="10">10s</option>
            <option value="15">15s</option>
            <option value="25">25s</option>
          </select>
        </label>
      </div>
      <div class="uvd-field-grid">
        <label class="uvd-field">
          <span>Gens</span>
          <input type="number" data-uvd-compose-gens="1" min="1" step="1" />
        </label>
        <label class="uvd-field">
          <span>Orientation</span>
          <select data-uvd-compose-orientation="1">
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
      </div>
      <div class="uvd-field-grid">
        <label class="uvd-field">
          <span>Style</span>
          <select data-uvd-compose-style="1">
            ${styleOptionsHtml}
          </select>
        </label>
        <label class="uvd-field">
          <span>Size</span>
          <select data-uvd-compose-size="1">
            <option value="small">Standard</option>
            <option value="large">High</option>
          </select>
        </label>
      </div>
      <div class="uvd-cameo-section" data-uvd-cameo-section="1">
        <span class="uvd-field-label">Cameos</span>
        <div class="uvd-cameo-list" data-uvd-cameo-list="1"></div>
        <div class="uvd-cameo-add-row">
          <input type="text" data-uvd-cameo-input="1" placeholder="@username or user-xxx" class="uvd-cameo-input" />
          <button type="button" data-uvd-cameo-add="1" class="uvd-cameo-add-btn">Add</button>
        </div>
      </div>
      <div class="uvd-compose-actions">
        <button type="button" data-uvd-compose-create="1">Create</button>
        <button type="button" class="uvd-requires-source" data-uvd-compose-remix="1">Remix</button>
        <button type="button" class="uvd-requires-source" data-uvd-compose-extend="1">Extend</button>
      </div>
      <div class="uvd-compose-status" data-uvd-compose-status="1"></div>
    `;

    const statusEl = composer.querySelector('[data-uvd-compose-status="1"]');
    const promptEl = composer.querySelector('[data-uvd-compose-prompt="1"]');
    const modelEl = composer.querySelector('[data-uvd-compose-model="1"]');
    const durationEl = composer.querySelector('[data-uvd-compose-duration="1"]');
    const gensEl = composer.querySelector('[data-uvd-compose-gens="1"]');
    const orientationEl = composer.querySelector('[data-uvd-compose-orientation="1"]');
    const sizeEl = composer.querySelector('[data-uvd-compose-size="1"]');
    const styleEl = composer.querySelector('[data-uvd-compose-style="1"]');
    const dropzone = composer.querySelector('[data-uvd-dropzone="1"]');
    const clearSourceBtn = composer.querySelector('[data-uvd-compose-source-clear="1"]');

    const syncGensFieldLimits = () => {
      if (!gensEl) return;
      gensEl.min = String(GENS_COUNT_MIN);
      gensEl.max = String(getGensCountMax());
      gensEl.value = String(clampGensCount(gensEl.value || uvDraftsComposerState.gensCount));
    };

    const syncComposerSizeField = () => {
      if (!sizeEl || !modelEl) return;
      const ultraModeEnabled = loadUltraModeEnabledFromStorage();
      const allowLarge = isLargeComposerSizeAllowed(modelEl.value, ultraModeEnabled);
      const normalizedSize = normalizeComposerSizeForModel(
        sizeEl.value || uvDraftsComposerState?.size,
        modelEl.value || uvDraftsComposerState?.model,
        ultraModeEnabled
      );
      if (sizeEl.value !== normalizedSize) sizeEl.value = normalizedSize;
      sizeEl.disabled = !allowLarge;
    };

    const syncStateFromFields = (options = {}) => {
      const commitGensValue = options.commitGensValue !== false;
      syncComposerSizeField();
      const parsedGensCount = parseComposerGensInputValue(gensEl?.value);
      uvDraftsComposerState = normalizeUVDraftsComposerState({
        prompt: promptEl.value,
        model: modelEl.value,
        durationSeconds: Number(durationEl.value),
        gensCount: parsedGensCount == null ? uvDraftsComposerState?.gensCount : parsedGensCount,
        orientation: orientationEl.value,
        size: sizeEl.value,
        style_id: styleEl.value,
      });
      persistUVDraftsComposerState();
      persistComposerGensCount(uvDraftsComposerState.gensCount);
      if (gensEl && commitGensValue) gensEl.value = String(uvDraftsComposerState.gensCount);
      if (sizeEl) sizeEl.value = uvDraftsComposerState.size;
    };

    promptEl.value = uvDraftsComposerState.prompt;
    modelEl.value = normalizeComposerModel(uvDraftsComposerState.model) || getDefaultComposerModel();
    if (!modelEl.value) modelEl.value = composerModels[0]?.value || 'sy_8';
    uvDraftsComposerState.model = modelEl.value;
    modelOverride = modelEl.value;
    durationEl.value = String(uvDraftsComposerState.durationSeconds);
    if (gensEl) gensEl.value = String(clampGensCount(uvDraftsComposerState.gensCount));
    orientationEl.value = uvDraftsComposerState.orientation;
    sizeEl.value = uvDraftsComposerState.size;
    styleEl.value = uvDraftsComposerState.style_id;
    syncGensFieldLimits();
    syncComposerSizeField();
    uvDraftsComposerState.size = sizeEl.value;
    persistUVDraftsComposerState();
    persistComposerGensCount(uvDraftsComposerState.gensCount);

    [promptEl, modelEl, durationEl, orientationEl, sizeEl, styleEl].filter(Boolean).forEach((el) => {
      el.addEventListener('input', syncStateFromFields);
      el.addEventListener('change', syncStateFromFields);
    });
    if (gensEl) {
      gensEl.addEventListener('input', () => syncStateFromFields({ commitGensValue: false }));
      gensEl.addEventListener('change', () => syncStateFromFields({ commitGensValue: true }));
      gensEl.addEventListener('blur', () => syncStateFromFields({ commitGensValue: true }));
    }
    window.addEventListener('sct_ultra_mode', () => {
      syncGensFieldLimits();
      syncStateFromFields();
    });
    window.addEventListener('storage', (event) => {
      if (event.key === ULTRA_MODE_KEY) {
        syncGensFieldLimits();
        syncStateFromFields();
      }
    });

    composer.querySelector('[data-uvd-compose-create="1"]')?.addEventListener('click', () => {
      syncStateFromFields({ commitGensValue: true });
      startComposerFlow('compose', statusEl);
    });
    composer.querySelector('[data-uvd-compose-remix="1"]')?.addEventListener('click', () => {
      syncStateFromFields({ commitGensValue: true });
      startComposerFlow('remix', statusEl);
    });
    composer.querySelector('[data-uvd-compose-extend="1"]')?.addEventListener('click', () => {
      syncStateFromFields({ commitGensValue: true });
      startComposerFlow('extend', statusEl);
    });
    clearSourceBtn?.addEventListener('click', () => setComposerSource(null, statusEl));

    // Cameo add button
    const cameoInput = composer.querySelector('[data-uvd-cameo-input="1"]');
    const cameoAddBtn = composer.querySelector('[data-uvd-cameo-add="1"]');
    const addCameoFromInput = async () => {
      const rawValue = cameoInput?.value || '';
      if (!rawValue.trim()) return;
      try {
        if (cameoAddBtn) cameoAddBtn.disabled = true;
        setComposerStatus(`Looking up ${rawValue.trim()}...`);
        const resolved = await resolveComposerCameoInput(rawValue);
        rememberComposerCameoIdentity(resolved.userId, resolved.username);
        if (!composerCameoIds.includes(resolved.userId)) {
          composerCameoIds.push(resolved.userId);
          renderCameoList();
        }
        if (cameoInput) cameoInput.value = '';
        setComposerStatus(`Added cameo ${getComposerCameoLabel(resolved.userId)}.`, 'ok');
      } catch (err) {
        setComposerStatus(err?.message || 'Failed to resolve cameo username.', 'error');
      } finally {
        if (cameoAddBtn) cameoAddBtn.disabled = false;
      }
    };
    cameoAddBtn?.addEventListener('click', () => { void addCameoFromInput(); });
    cameoInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void addCameoFromInput();
      }
    });

    const setDropVisual = (active) => {
      dropzone.classList.toggle('is-active', !!active);
    };
    dropzone.addEventListener('dragenter', (e) => { e.preventDefault(); setDropVisual(true); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); setDropVisual(true); });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (e.relatedTarget && dropzone.contains(e.relatedTarget)) return;
      setDropVisual(false);
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      setDropVisual(false);
      let source = null;
      try {
        const raw = e.dataTransfer?.getData('application/x-sora-uv-draft');
        if (raw) {
          const parsed = JSON.parse(raw);
          source = normalizeComposerSource({
            type: 'draft',
            id: parsed.id,
            storyboard_id: parsed.storyboard_id || '',
            can_storyboard: parsed.can_storyboard !== false,
            prompt: parsed.prompt || '',
            title: parsed.title || '',
            url: parsed.download_url || parsed.preview_url || '',
            preview_url: parsed.preview_url || '',
            thumbnail_url: parsed.thumbnail_url || '',
            cameo_profiles: parsed.cameo_profiles || [],
            label: `${parsed.title || parsed.prompt || parsed.id}`.slice(0, 90),
          });
        }
      } catch {}

      if (!source) {
        const uri = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim();
        if (uri) {
          try {
            const parsed = new URL(uri);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              source = normalizeComposerSource({ type: 'url', url: uri, label: uri.slice(0, 90) });
            }
          } catch {}
        }
      }

      if (!source && e.dataTransfer?.files?.length) {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
          source = normalizeComposerSource({
            type: 'file',
            fileName: file.name,
            object_url: URL.createObjectURL(file),
            label: `File: ${file.name}`,
          });
        }
      }

      if (source) {
        setComposerSource(source, statusEl);
      } else if (statusEl) {
        statusEl.textContent = 'Unsupported drop content. Drop a draft card to use as source.';
        statusEl.dataset.tone = 'error';
      }
    });

    // -- First Frame Image picker --
    const firstFrameZone = composer.querySelector('[data-uvd-firstframe-zone="1"]');
    const firstFrameInput = composer.querySelector('[data-uvd-firstframe-input="1"]');
    const firstFramePreview = composer.querySelector('[data-uvd-firstframe-preview="1"]');
    const firstFrameImg = composer.querySelector('[data-uvd-firstframe-img="1"]');
    const firstFrameName = composer.querySelector('[data-uvd-firstframe-name="1"]');
    const firstFrameClear = composer.querySelector('[data-uvd-firstframe-clear="1"]');

    const setFirstFrame = (file) => {
      if (uvDraftsComposerFirstFrame?.object_url) {
        try { URL.revokeObjectURL(uvDraftsComposerFirstFrame.object_url); } catch {}
      }
      if (!file) {
        uvDraftsComposerFirstFrame = null;
        if (firstFramePreview) firstFramePreview.classList.remove('is-visible');
        if (firstFrameZone) firstFrameZone.style.display = '';
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      uvDraftsComposerFirstFrame = { object_url: objectUrl, fileName: file.name, _file: file };
      if (firstFrameImg) firstFrameImg.src = objectUrl;
      if (firstFrameName) firstFrameName.textContent = file.name;
      if (firstFramePreview) firstFramePreview.classList.add('is-visible');
      if (firstFrameZone) firstFrameZone.style.display = 'none';
    };

    firstFrameZone?.addEventListener('click', () => {
      firstFrameInput?.click();
    });
    firstFrameInput?.addEventListener('change', () => {
      const file = firstFrameInput.files?.[0];
      if (file && file.type.startsWith('image/')) setFirstFrame(file);
      firstFrameInput.value = '';
    });
    firstFrameClear?.addEventListener('click', () => setFirstFrame(null));

    // First frame drop support
    firstFrameZone?.addEventListener('dragenter', (e) => { e.preventDefault(); firstFrameZone.classList.add('is-active'); });
    firstFrameZone?.addEventListener('dragover', (e) => { e.preventDefault(); firstFrameZone.classList.add('is-active'); });
    firstFrameZone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (e.relatedTarget && firstFrameZone.contains(e.relatedTarget)) return;
      firstFrameZone.classList.remove('is-active');
    });
    firstFrameZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      firstFrameZone.classList.remove('is-active');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        setFirstFrame(file);
      } else if (statusEl) {
        statusEl.textContent = 'Drop an image file for the first frame.';
        statusEl.dataset.tone = 'error';
      }
    });

    setComposerSource(uvDraftsComposerSource, statusEl);
    return composer;
  }

  async function loadUVDraftsFromCache() {
    try {
      const drafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
      return drafts;
    } catch (err) {
      console.error('[UV Drafts] Cache load error:', err);
      return [];
    }
  }

  async function syncUVDraftsFromAPI(onProgress) {
    try {
      // Fetch all drafts from API
      const apiDrafts = await fetchAllUVDrafts(onProgress);

      // Get existing data to preserve extension fields
      const existingDrafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
      const existingMap = new Map(existingDrafts.map(d => [d.id, d]));

      // Transform and merge with existing data
      const transformedDrafts = apiDrafts.map((d, idx) =>
        transformDraftForStorage(d, existingMap.get(d.id) || {}, { apiOrder: idx, fromDraftsApi: true })
      );

      // Save to IndexedDB
      await uvDBPutAll(UV_DRAFTS_STORES.drafts, transformedDrafts);

      // Update sync state
      await uvDBPut(UV_DRAFTS_STORES.syncState, {
        key: 'last_full_sync',
        value: Date.now()
      });

      return transformedDrafts;
    } catch (err) {
      console.error('[UV Drafts] API sync error:', err);
      throw err;
    }
  }

  function addDraftIdsToSet(drafts, idSet) {
    if (!(idSet instanceof Set) || !Array.isArray(drafts)) return;
    for (const draft of drafts) {
      const id = String(draft?.id || '').trim();
      if (id) {
        idSet.add(id);
        uvDraftsSyncConfirmedIds.add(id);
      }
    }
  }

  async function archiveUnsyncedDraftsAfterFullSync(syncedIds, runId = uvDraftsInitRunId) {
    if (!(syncedIds instanceof Set)) return;
    if (runId !== uvDraftsInitRunId) return;

    const allDrafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
    if (runId !== uvDraftsInitRunId) return;

    const updates = [];
    for (const draft of allDrafts) {
      if (!draft || typeof draft !== 'object') continue;
      const id = String(draft.id || '').trim();
      if (!id) continue;
      const shouldBeUnsynced = !syncedIds.has(id);
      if ((draft.is_unsynced === true) === shouldBeUnsynced) continue;
      const nextDraft = {
        ...draft,
        is_unsynced: shouldBeUnsynced,
      };
      updates.push(nextDraft);
    }

    if (updates.length > 0) {
      await uvDBPutAll(UV_DRAFTS_STORES.drafts, updates);
      if (runId !== uvDraftsInitRunId) return;
    }

    uvDraftsData = await loadUVDraftsFromCache();
    if (runId !== uvDraftsInitRunId) return;

    if (isUVDraftsPageVisible()) {
      renderUVDraftsGrid();
      updateUVDraftsStats();
    }
  }

  function isUVDraftsPageVisible() {
    return !!(uvDraftsPageEl && uvDraftsPageEl.style.display !== 'none');
  }

  function flattenPendingPayloadForDrafts(payload) {
    if (uvDraftsLogic && typeof uvDraftsLogic.flattenPendingV2Payload === 'function') {
      return uvDraftsLogic.flattenPendingV2Payload(payload);
    }
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data?.items)) return payload.data.items;
    return [];
  }

  function buildPendingDraftsFromPayload(payload) {
    const flattened = flattenPendingPayloadForDrafts(payload);
    if (!Array.isArray(flattened) || flattened.length === 0) return [];
    const existingById = new Map(uvDraftsData.map((draft) => [String(draft?.id || ''), draft]));
    const out = [];
    const seen = new Set();
    for (const item of flattened) {
      if (!item || typeof item !== 'object') continue;
      const itemId = String(item.id || item.generation_id || item.draft_id || '').trim();
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);
      const normalizedApiDraft = {
        ...item,
        id: itemId,
        prompt: item.prompt || item.creation_config?.prompt || '',
        draft_reviewed: true,
      };
      const transformed = transformDraftForStorage(normalizedApiDraft, existingById.get(itemId) || {});
      transformed.is_pending = true;
      transformed.pending_status = String(item.pending_status || item.status || 'pending').toLowerCase();
      transformed.pending_task_status = String(item.pending_task_status || '').toLowerCase();
      // v2 API may provide progress as 0-1 fraction or 0-100 percentage
      const rawPct = item.progress_pct ?? item.progress ?? null;
      transformed.progress_pct = rawPct != null && Number.isFinite(Number(rawPct))
        ? (Number(rawPct) <= 1 && Number(rawPct) > 0 ? Number(rawPct) * 100 : Number(rawPct))
        : null;
      transformed.is_read = true;
      const createdAt = Number(transformed.created_at);
      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        transformed.created_at = Math.floor(Date.now() / 1000);
      }
      out.push(transformed);
    }
    return out;
  }

  async function fetchPendingDraftsPayload() {
    const headers = { accept: '*/*', 'cache-control': 'no-cache' };
    if (capturedAuthToken) headers.Authorization = capturedAuthToken;
    const res = await fetch(UV_DRAFTS_PENDING_ENDPOINT, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Pending endpoint failed: ${res.status}`);
    }
    return res.json();
  }

  async function refreshTopUVDraftsFromAPI(reason = '') {
    if (uvDraftsTopRefreshInFlight) return uvDraftsTopRefreshInFlight;

    uvDraftsTopRefreshInFlight = (async () => {
      const runId = uvDraftsInitRunId;
      const isStaleRun = () => runId !== uvDraftsInitRunId;
      const fullSyncIds = new Set();
      setUVDraftsSyncUiState({ syncing: true, processed: uvDraftsData.length, page: 1 });
      const firstBatch = await fetchFirstUVDrafts(30);
      if (!firstBatch.items || firstBatch.items.length === 0) return;

      const existingDrafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
      const existingMap = new Map(existingDrafts.map((draft) => [draft.id, draft]));
      const transformed = firstBatch.items.map((draft, idx) =>
        transformDraftForStorage(draft, existingMap.get(draft.id) || {}, { apiOrder: idx, fromDraftsApi: true })
      );
      addDraftIdsToSet(transformed, fullSyncIds);
      // Clean up consumed workspace tags
      for (const draft of transformed) {
        if (draft.task_id && uvDraftsPendingWorkspaceTags.has(draft.task_id)) {
          uvDraftsPendingWorkspaceTags.delete(draft.task_id);
        }
      }
      await uvDBPutAll(UV_DRAFTS_STORES.drafts, transformed);
      if (isStaleRun()) return;
      uvDraftsData = mergeDraftListById(transformed, uvDraftsData);
      if (isUVDraftsPageVisible()) {
        renderUVDraftsGrid();
        updateUVDraftsStats();
      }
      if (firstBatch.cursor) {
        const syncSucceeded = await syncRemainingDrafts(firstBatch.cursor, null, runId, firstBatch.items.length, fullSyncIds, 3);
        if (!syncSucceeded || isStaleRun()) return;
      }
    })()
      .catch((err) => {
        console.error('[UV Drafts] Top refresh failed after pending change:', reason, err);
      })
      .finally(() => {
        setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
        uvDraftsTopRefreshInFlight = null;
      });

    return uvDraftsTopRefreshInFlight;
  }

  async function pollPendingDraftsOnce() {
    if (!capturedAuthToken) return;
    const runId = uvDraftsInitRunId;
    const payload = await fetchPendingDraftsPayload();
    if (runId !== uvDraftsInitRunId) return;

    const pendingDrafts = buildPendingDraftsFromPayload(payload);
    const nextIds = new Set(pendingDrafts.map((draft) => String(draft?.id || '')).filter(Boolean));
    const droppedIds = uvDraftsLogic && typeof uvDraftsLogic.getDroppedIds === 'function'
      ? uvDraftsLogic.getDroppedIds(uvDraftsPendingIds, nextIds)
      : [...uvDraftsPendingIds].filter((id) => !nextIds.has(id));

    // Re-render if IDs changed OR if progress/status data updated
    const idsChanged = nextIds.size !== uvDraftsPendingIds.size ||
      [...nextIds].some(id => !uvDraftsPendingIds.has(id));
    const dataChanged = !idsChanged && pendingDrafts.some((d, i) => {
      const prev = uvDraftsPendingData[i];
      if (!prev) return true;
      return d.progress_pct !== prev.progress_pct ||
        d.pending_status !== prev.pending_status ||
        d.pending_task_status !== prev.pending_task_status;
    });
    const pendingChanged = idsChanged || dataChanged;

    uvDraftsPendingIds = nextIds;
    uvDraftsPendingData = pendingDrafts;
    uvDraftsPendingFailures = 0;

    if (pendingChanged && isUVDraftsPageVisible()) {
      if (idsChanged) {
        // IDs added/removed — full rebuild needed
        renderUVDraftsGrid(true);
      } else {
        // Only progress/status changed — update pending cards in-place
        updatePendingCardsInPlace(pendingDrafts);
      }
    }

    if (droppedIds.length > 0) {
      await refreshTopUVDraftsFromAPI('pending_dropped');
    }
  }

  function startPendingDraftsPolling() {
    if (uvDraftsPendingPollTimerId || !capturedAuthToken) return;
    uvDraftsPendingFailures = 0;
    // Poll once immediately — only start the interval if there are pending items
    pollPendingDraftsOnce().then(() => {
      if (uvDraftsPendingIds.size > 0 && !uvDraftsPendingPollTimerId) {
        continuePendingDraftsPolling();
      }
    }).catch((err) => {
      uvDraftsPendingFailures += 1;
      console.error('[UV Drafts] Initial pending poll failed:', err);
    });
  }

  function continuePendingDraftsPolling() {
    if (uvDraftsPendingPollTimerId || !capturedAuthToken) return;
    uvDraftsPendingPollTimerId = setInterval(() => {
      pollPendingDraftsOnce().then(() => {
        if (uvDraftsPendingMinPolls > 0) uvDraftsPendingMinPolls--;
        // Stop polling once all pending items are gone and min polls exhausted
        if (uvDraftsPendingIds.size === 0 && uvDraftsPendingMinPolls <= 0) {
          stopPendingDraftsPolling(false);
        }
      }).catch((err) => {
        uvDraftsPendingFailures += 1;
        console.error('[UV Drafts] Pending poll failed:', err);
        if (uvDraftsPendingFailures >= UV_DRAFTS_PENDING_MAX_FAILURES) {
          console.error('[UV Drafts] Stopping pending polling after repeated failures');
          stopPendingDraftsPolling(false);
        }
      });
    }, UV_DRAFTS_PENDING_POLL_MS);
  }

  function stopPendingDraftsPolling(clearState = false) {
    if (uvDraftsPendingPollTimerId) {
      clearInterval(uvDraftsPendingPollTimerId);
      uvDraftsPendingPollTimerId = null;
    }
    uvDraftsPendingMinPolls = 0;
    if (clearState) {
      uvDraftsPendingData = [];
      uvDraftsPendingIds = new Set();
      uvDraftsPendingFailures = 0;
    }
  }

  // ---- Filtering (no sorting) ----

  function applyDraftFilters(drafts, options = {}) {
    let filtered = [...drafts];
    const bookmarks = getBookmarks();

    // Optional diagnostics for bookmark mismatch investigation.
    const _bmIds = [...bookmarks];
    const _draftIds = new Set(filtered.map(d => d?.id).filter(Boolean));
    const _bmInData = _bmIds.filter(id => _draftIds.has(id));
    const _bmMissing = _bmIds.filter(id => !_draftIds.has(id));
    const _bmUnsynced = _bmIds.filter(id => {
      const d = filtered.find(x => x?.id === id);
      return d?.is_unsynced === true;
    });
    debugLog('[UV Drafts DEBUG] filterState:', uvDraftsFilterState,
      '| bookmarks in storage:', _bmIds.length,
      '| drafts in data:', filtered.length,
      '| found in data:', _bmInData.length,
      '| missing from data:', _bmMissing.length,
      '| unsynced:', _bmUnsynced.length);
    if (_bmIds.length > 0) {
      debugLog('[UV Drafts DEBUG] bookmark IDs:', _bmIds);
    }
    if (_bmMissing.length > 0) {
      debugLog('[UV Drafts DEBUG] missing IDs:', _bmMissing);
    }
    // Also log raw localStorage value for format check
    debugLog('[UV Drafts DEBUG] raw localStorage:', localStorage.getItem(BOOKMARKS_KEY));

    // Apply search filter
    if (uvDraftsSearchQuery) {
      const parsed = parseSearchTerms(uvDraftsSearchQuery);
      if (uvDraftsLogic && typeof uvDraftsLogic.draftMatchesSearchQuery === 'function') {
        filtered = filtered.filter((d) =>
          uvDraftsLogic.draftMatchesSearchQuery(d, parsed, {
            bookmarks,
            resolveWorkspaceName: getWorkspaceNameById,
          })
        );
      } else {
        filtered = filtered.filter(d => {
          if (!matchesDraftSearchFilters(d, parsed, bookmarks)) return false;
          if (!parsed.terms.length) return true;
          const blob = buildDraftSearchBlob(d);
          return parsed.terms.every((term) => blob.includes(term));
        });
      }
    }

    filtered = filterDraftsByWorkspace(filtered, uvDraftsWorkspaceFilter);

    if (uvDraftsFilterState === 'unsynced') {
      filtered = filtered.filter((d) => d?.is_unsynced === true);
    } else {
      filtered = filtered.filter((d) => d?.is_unsynced !== true);
    }

    if (uvDraftsFilterState === 'bookmarked') {
      filtered = filtered.filter(d => {
        const isNew = d?.is_unsynced !== true && isDraftUnreadState(d) && !uvDraftsJustSeenIds.has(d.id);
        const justSeen = d?.is_unsynced !== true && uvDraftsJustSeenIds.has(d.id);
        return bookmarks.has(d.id) || isNew || justSeen;
      });
    } else if (uvDraftsFilterState === 'hidden') {
      filtered = filtered.filter(d => d?.is_unsynced !== true && d.hidden);
    } else if (uvDraftsFilterState === 'violations') {
      filtered = filtered.filter(d => d?.is_unsynced !== true && (isContentViolationDraft(d) || isContextViolationDraft(d)));
    } else if (uvDraftsFilterState === 'new') {
      // Only show drafts confirmed by the API this session to avoid ghost drafts from stale cache
      const requireConfirmed = uvDraftsSyncConfirmedIds.size > 0;
      filtered = filtered.filter(d =>
        d?.is_unsynced !== true &&
        isDraftUnreadState(d) &&
        !uvDraftsJustSeenIds.has(d.id) &&
        (!requireConfirmed || uvDraftsSyncConfirmedIds.has(d.id))
      );
    }

    return filtered;
  }

  // Build the final ordered list: pending first, then API-ordered, then cached without api_order.
  function getRenderableUVDrafts() {
    const mainFiltered = applyDraftFilters(uvDraftsData);

    // Separate API-ordered drafts from cached ones without an order
    const apiOrdered = [];
    const noOrder = [];
    for (const d of mainFiltered) {
      const ord = Number(d?.api_order);
      if (Number.isFinite(ord) && ord >= 0) apiOrdered.push(d);
      else noOrder.push(d);
    }
    // Sort API-ordered drafts by their api_order value (page 1 = 0..N, page 2 = N+1..M, etc)
    apiOrdered.sort((a, b) => a.api_order - b.api_order);
    const ordered = apiOrdered.concat(noOrder);

    // Prepend pending drafts
    if (Array.isArray(uvDraftsPendingData) && uvDraftsPendingData.length > 0) {
      const filteredPending = applyDraftFilters(uvDraftsPendingData);
      if (filteredPending.length > 0) {
        return mergeDraftListById(filteredPending, ordered);
      }
    }
    return ordered;
  }

  function createUVDraftCard(draft) {
    // NEW badge based on server-side is_read status (only show NEW if explicitly false, not undefined)
    const isPendingDraft = draft?.is_pending === true || String(draft?.pending_status || '').toLowerCase() === 'pending';
    const isContentViolation = isContentViolationDraft(draft);
    const isContextViolation = isContextViolationDraft(draft);
    const isProcessingError = isProcessingErrorDraft(draft);
    const isSpecialError = isContentViolation || isContextViolation || isProcessingError;
    const hasBlockedDraftActions = isPendingDraft || isSpecialError;
    const usePlaceholderThumb = isSpecialError || isPendingDraft;
    const isNew = isDraftUnreadState(draft) && !uvDraftsJustSeenIds.has(draft.id);
    const draftUrl = `https://sora.chatgpt.com/d/${encodeURIComponent(draft.id)}`;
    const draftOrientation = getDraftOrientationForLayout(draft);
    const draftCardLayoutStyle = getDraftCardLayoutStyle(draft, usePlaceholderThumb);

    const card = document.createElement('div');
    card.className = 'uv-draft-card uvd-card';
    card.style.alignSelf = draftCardLayoutStyle.alignSelf;
    if (draftOrientation) card.dataset.orientation = draftOrientation;
    if (isContentViolation || isContextViolation) card.classList.add('is-violation');
    if (isProcessingError) card.classList.add('is-processing-error');
    card.dataset.draftId = draft.id;
    if (hasBlockedDraftActions) card.style.cursor = 'default';
    card.draggable = !isPendingDraft;
    let suppressCardNavUntil = 0;
    const blockCardNavigation = (ms = 180) => {
      suppressCardNavUntil = Date.now() + ms;
    };
    const shouldIgnoreCardNavigationTarget = (target) => (
      target instanceof Element && !!target.closest(
        'a,button,input,textarea,select,video,label,[role="button"],[contenteditable="true"],.uv-play-btn'
      )
    );
    card.addEventListener('dragstart', (e) => {
      blockCardNavigation(650);
      try {
        const payload = {
          id: draft.id,
          storyboard_id: draft.storyboard_id || '',
          can_storyboard: draft.can_storyboard !== false,
          prompt: draft.prompt || '',
          title: draft.title || '',
          download_url: draft.download_url || '',
          preview_url: draft.preview_url || '',
          thumbnail_url: draft.thumbnail_url || '',
          orientation: draft.orientation || '',
          duration_seconds: draft.duration_seconds || 0,
          cameo_profiles: draft.cameo_profiles || [],
        };
        e.dataTransfer?.setData('application/x-sora-uv-draft', JSON.stringify(payload));
        const uri = draft.download_url || draft.preview_url || '';
        if (uri) {
          e.dataTransfer?.setData('text/plain', uri);
          e.dataTransfer?.setData('text/uri-list', uri);
        }
        e.dataTransfer.effectAllowed = 'copy';
      } catch {}
    });
    card.addEventListener('dragend', () => {
      blockCardNavigation(160);
    });

    // Thumbnail container
    const thumbContainer = document.createElement('div');
    Object.assign(thumbContainer.style, {
      position: 'relative',
      width: '100%',
      paddingTop: draftCardLayoutStyle.paddingTop,
      background: isPendingDraft
        ? '#182435'
        : (isContentViolation || isContextViolation ? '#2a1515' : (isProcessingError ? '#1b2235' : '#1a1a1a')),
      cursor: hasBlockedDraftActions ? 'default' : 'pointer',
    });

    // For violations/processing errors, show a placeholder instead of blank/broken media.
    if (usePlaceholderThumb) {
      const violationPlaceholder = document.createElement('div');
      Object.assign(violationPlaceholder.style, {
        position: 'absolute',
        inset: '0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        textAlign: 'center',
      });

      const warningIcon = document.createElement('div');
      if (isPendingDraft) {
        const pctVal = Number(draft.progress_pct);
        const pctNorm = Number.isFinite(pctVal) && pctVal > 0 ? Math.min(pctVal, 100) : 0;
        warningIcon.dataset.pendingRing = '1';
        warningIcon.innerHTML = buildPendingRingMarkup(pctNorm);
      } else {
        warningIcon.textContent = isProcessingError ? '⚙️' : '⚠️';
        warningIcon.style.fontSize = '48px';
      }
      warningIcon.style.marginBottom = '12px';
      violationPlaceholder.appendChild(warningIcon);

      const violationLabel = document.createElement('div');
      if (isPendingDraft) {
        violationLabel.dataset.pendingStatus = '1';
        const status = String(draft.pending_status || draft.pending_task_status || 'generating').replace(/_/g, ' ');
        violationLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      } else {
        violationLabel.textContent = isProcessingError
          ? 'Processing Error'
          : (isContextViolation ? 'Context Violation' : 'Content Violation');
      }
      Object.assign(violationLabel.style, {
        color: isPendingDraft ? '#89b6ff' : (isProcessingError ? '#ffb86b' : '#ff6b6b'),
        fontSize: '14px',
        fontWeight: '600',
        marginBottom: '8px',
      });
      violationPlaceholder.appendChild(violationLabel);

      // Show server-provided reason/error details if available.
      if (draft.violation_reason && !isPendingDraft) {
        const reasonLabel = document.createElement('div');
        reasonLabel.textContent = isProcessingError ? 'Details:' : 'Reason:';
        Object.assign(reasonLabel.style, {
          color: isProcessingError ? '#ffd5a0' : '#ff8888',
          fontSize: '11px',
          fontWeight: '600',
          marginBottom: '4px',
        });
        violationPlaceholder.appendChild(reasonLabel);

        const reasonText = document.createElement('div');
        const reason = typeof draft.violation_reason === 'string'
          ? draft.violation_reason
          : JSON.stringify(draft.violation_reason);
        reasonText.textContent = reason.length > 150 ? reason.slice(0, 150) + '...' : reason;
        Object.assign(reasonText.style, {
          color: '#ccc',
          fontSize: '11px',
          lineHeight: '1.4',
          marginBottom: '8px',
        });
        violationPlaceholder.appendChild(reasonText);
      }

      // Show truncated prompt for debugging/retry context.
      if (draft.prompt) {
        const promptLabel = document.createElement('div');
        promptLabel.textContent = 'Prompt:';
        Object.assign(promptLabel.style, {
          color: '#888',
          fontSize: '10px',
          fontWeight: '600',
          marginBottom: '2px',
        });
        violationPlaceholder.appendChild(promptLabel);

        const promptText = document.createElement('div');
        promptText.textContent = draft.prompt.length > 80 ? draft.prompt.slice(0, 80) + '...' : draft.prompt;
        Object.assign(promptText.style, {
          color: '#666',
          fontSize: '10px',
          lineHeight: '1.3',
          fontStyle: 'italic',
        });
        violationPlaceholder.appendChild(promptText);
      }

      if (isPendingDraft) {
        const helpText = document.createElement('div');
        helpText.textContent = 'This draft is still in progress.';
        Object.assign(helpText.style, {
          color: '#9eb8ff',
          fontSize: '10px',
          lineHeight: '1.35',
          marginTop: '8px',
        });
        violationPlaceholder.appendChild(helpText);
      } else if (isProcessingError) {
        const helpText = document.createElement('div');
        helpText.textContent = 'Try Retry or Use as Composer Source to adjust prompt/settings.';
        Object.assign(helpText.style, {
          color: '#9eb8ff',
          fontSize: '10px',
          lineHeight: '1.35',
          marginTop: '8px',
        });
        violationPlaceholder.appendChild(helpText);
      }

      thumbContainer.appendChild(violationPlaceholder);
    } else {
      // Thumbnail image (normal media cards)
      const thumb = document.createElement('img');
      thumb.src = draft.thumbnail_url || '';
      thumb.loading = 'lazy';
      Object.assign(thumb.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      });
      thumbContainer.appendChild(thumb);

      // Video element (hidden by default, shown on hover)
      // NOTE: Don't set src here to avoid memory issues with 500+ drafts
      const video = document.createElement('video');
      video.dataset.src = draft.preview_url || ''; // Store for lazy loading
      video.playsInline = true;
      video.preload = 'none';
      video.controls = false; // Enabled once playing — prevents native controls from stealing clicks
      video.draggable = false; // Prevent drag interfering with scrubber
      Object.assign(video.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: '0',
        transition: 'opacity 0.2s ease',
        zIndex: '1',
      });
      thumbContainer.appendChild(video);

      // Play button overlay
      const playBtn = document.createElement('div');
      playBtn.className = 'uv-play-btn';
      Object.assign(playBtn.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '60px',
        height: '60px',
        background: 'rgba(0,0,0,0.7)',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: '2',
        transition: 'transform 0.15s ease, background 0.15s ease',
      });
      playBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="white">
        <path d="M8 5v14l11-7z"/>
      </svg>`;
      // Hover anywhere on the thumbnail triggers play button hover state
      thumbContainer.addEventListener('mouseenter', () => {
        if (playBtn.style.display !== 'none') {
          playBtn.style.transform = 'translate(-50%, -50%) scale(1.1)';
          playBtn.style.background = 'rgba(0,0,0,0.9)';
        }
      });
      thumbContainer.addEventListener('mouseleave', () => {
        playBtn.style.transform = 'translate(-50%, -50%)';
        playBtn.style.background = 'rgba(0,0,0,0.7)';
      });
      thumbContainer.appendChild(playBtn);

      // Unified click handler — whole thumbnail area acts as play button
      thumbContainer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uvDraftsVideoInteracted = true;
        // Pause any other playing video
        if (uvDraftsCurrentlyPlayingVideo && uvDraftsCurrentlyPlayingVideo !== video) {
          uvDraftsCurrentlyPlayingVideo.pause();
          uvDraftsCurrentlyPlayingVideo.currentTime = 0;
          uvDraftsCurrentlyPlayingVideo.style.opacity = '0';
          uvDraftsCurrentlyPlayingVideo.controls = false;
          const otherPlayBtn = uvDraftsCurrentlyPlayingVideo.parentElement?.querySelector('.uv-play-btn');
          if (otherPlayBtn) otherPlayBtn.style.display = 'flex';
        }
        // Mark as seen
        if (!uvDraftsJustSeenIds.has(draft.id) && isDraftUnreadState(draft)) {
          uvDraftsJustSeenIds.add(draft.id);
          draft.is_read = true;
          markDraftAsSeen(draft.id);
          const badge = card.querySelector('.uv-new-badge');
          if (badge) badge.style.display = 'none';
          updateUVDraftsStats();
        }
        // Play
        playBtn.style.display = 'none';
        uvDraftsCurrentlyPlayingVideo = video;
        uvDraftsCurrentlyPlayingDraftId = draft.id;
        if (!video.src && video.dataset.src) {
          video.addEventListener('loadeddata', () => { video.style.opacity = '1'; video.controls = true; }, { once: true });
          video.src = video.dataset.src;
        } else {
          video.style.opacity = '1';
          video.controls = true;
        }
        video.play().catch(() => {});
      });

      // Duration badge
      if (draft.duration_seconds > 0) {
        const durationBadge = document.createElement('div');
        durationBadge.textContent = formatDurationShort(draft.duration_seconds);
        Object.assign(durationBadge.style, {
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: '12px',
          fontWeight: '600',
          padding: '2px 6px',
          borderRadius: '4px',
          pointerEvents: 'none',
        });
        thumbContainer.appendChild(durationBadge);
      }
    }

    // NEW badge
    const workspaceBadgeLabel = getDraftWorkspaceBadgeLabel(draft, uvDraftsWorkspaceFilter, getWorkspaceNameById);
    let topLeftBadges = null;
    let topRightBadges = null;
    const ensureTopLeftBadges = () => {
      if (topLeftBadges) return topLeftBadges;
      topLeftBadges = document.createElement('div');
      topLeftBadges.className = 'uvd-card-badges-top-left';
      Object.assign(topLeftBadges.style, {
        position: 'absolute',
        top: '8px',
        left: '8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '6px',
        zIndex: '3',
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 16px)',
      });
      thumbContainer.appendChild(topLeftBadges);
      return topLeftBadges;
    };

    const ensureTopRightBadges = () => {
      if (topRightBadges) return topRightBadges;
      topRightBadges = document.createElement('div');
      topRightBadges.className = 'uvd-card-badges-top-right';
      Object.assign(topRightBadges.style, {
        position: 'absolute',
        top: '8px',
        right: '8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '6px',
        zIndex: '3',
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 16px)',
      });
      thumbContainer.appendChild(topRightBadges);
      return topRightBadges;
    };

    if (workspaceBadgeLabel) {
      const workspaceBadge = document.createElement('div');
      workspaceBadge.className = 'uvd-workspace-badge';
      workspaceBadge.textContent = workspaceBadgeLabel;
      Object.assign(workspaceBadge.style, {
        maxWidth: '180px',
        background: 'rgba(8,12,18,0.82)',
        border: '1px solid rgba(255,255,255,0.16)',
        color: '#f4f7fb',
        fontSize: '10px',
        fontWeight: '700',
        padding: '4px 8px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: '0 6px 18px rgba(0,0,0,0.24)',
        backdropFilter: 'blur(8px)',
      });
      ensureTopRightBadges().appendChild(workspaceBadge);
    }

    if (isNew) {
      const newBadge = document.createElement('div');
      newBadge.className = 'uv-new-badge';
      newBadge.textContent = 'NEW';
      Object.assign(newBadge.style, {
        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        color: '#fff',
        fontSize: '10px',
        fontWeight: '700',
        padding: '3px 8px',
        borderRadius: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        boxShadow: '0 2px 8px rgba(59,130,246,0.5)',
      });
      ensureTopLeftBadges().appendChild(newBadge);
    }

    let bookmarkIndicator = null;
    const syncBookmarkIndicator = (on) => {
      if (!on) {
        if (bookmarkIndicator?.parentElement) bookmarkIndicator.remove();
        bookmarkIndicator = null;
        return;
      }
      if (bookmarkIndicator && bookmarkIndicator.parentElement) return;
      bookmarkIndicator = document.createElement('div');
      bookmarkIndicator.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`;
      Object.assign(bookmarkIndicator.style, {
        position: 'absolute',
        top: '8px',
        right: '8px',
        color: '#fbbf24',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
      });
      thumbContainer.appendChild(bookmarkIndicator);
    };
    syncBookmarkIndicator(isBookmarked(draft.id));

    // Wrap thumbnail in anchor for right-click "open in new tab" support
    const thumbLink = document.createElement('a');
    thumbLink.className = 'uvd-thumb-link';
    thumbLink.href = hasBlockedDraftActions ? '#' : draftUrl;
    thumbLink.draggable = false; // Prevent drag interfering with video scrubber
    thumbLink.addEventListener('dragstart', (e) => e.preventDefault());
    if (hasBlockedDraftActions) {
      thumbLink.addEventListener('click', (e) => e.preventDefault());
      thumbLink.style.cursor = 'default';
    }
    thumbLink.appendChild(thumbContainer);
    card.appendChild(thumbLink);

    // Info section
    const info = document.createElement('div');
    info.className = 'uvd-info';

    // Prompt preview
    const promptText = getDraftPreviewText(draft, 60);
    const postUrl = getDraftPostUrl(draft);
    const promptEl = postUrl ? document.createElement('a') : document.createElement('div');
    promptEl.className = 'uvd-prompt';
    promptEl.textContent = promptText;
    if (postUrl) {
      promptEl.href = postUrl;
      promptEl.title = 'Open post';
      promptEl.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
    info.appendChild(promptEl);

    // Time + duration
    const timeEl = document.createElement('div');
    timeEl.className = 'uvd-time';
    const metaParts = [];
    const createdAtLabel = formatTimeAgo(getDraftCreatedAt(draft));
    if (isPendingDraft) {
      metaParts.push('Generating...');
    } else if (createdAtLabel) {
      metaParts.push(createdAtLabel);
    } else if (isProcessingError) {
      metaParts.push('Processing failed');
    } else if (isContentViolation || isContextViolation) {
      metaParts.push('Policy blocked');
    }
    timeEl.textContent = metaParts.filter(Boolean).join(' • ');
    info.appendChild(timeEl);

    card.appendChild(info);

    // Action buttons row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'uvd-actions-row';

    // SVG icon definitions
    const icons = {
      bookmarkFilled: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`,
      bookmarkOutline: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
      copy: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
      check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      download: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
      retry: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`,
      eyeOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
      eyeClosed: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`,
      folder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
      source: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><path d="M10 8h4v4"></path><path d="M10 14L14 10"></path></svg>`,
      trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    };

    const createActionBtn = (icon, title, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'uvd-icon-btn';
      btn.type = 'button';
      btn.innerHTML = icon;
      btn.title = title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
      });
      return btn;
    };

    const flashIconSuccess = (btn, baseIcon) => {
      if (!btn) return;
      btn.innerHTML = icons.check;
      btn.style.color = '#4ade80';
      setTimeout(() => {
        btn.innerHTML = baseIcon;
        btn.style.color = '';
      }, 1400);
    };

    const sourceBtn = createActionBtn(icons.source, 'Use as Composer Source', () => {
      setComposerSource(buildComposerSourceFromDraft(draft));
      const statusEl = uvDraftsComposerEl?.querySelector('[data-uvd-compose-status="1"]');
      if (statusEl) {
        statusEl.textContent = 'Source selected from draft card.';
        statusEl.dataset.tone = 'ok';
      }
    });
    sourceBtn.disabled = hasBlockedDraftActions;
    actionsRow.appendChild(sourceBtn);

    // Bookmark button
    const isBookmarkedNow = isBookmarked(draft.id);
    const bookmarkBtn = createActionBtn(isBookmarkedNow ? icons.bookmarkFilled : icons.bookmarkOutline, 'Bookmark', () => {
      const newState = toggleBookmark(draft.id);
      bookmarkBtn.innerHTML = newState ? icons.bookmarkFilled : icons.bookmarkOutline;
      bookmarkBtn.style.color = newState ? '#fbbf24' : '#fff';
      syncBookmarkIndicator(newState);
      updateUVDraftsStats();
      if (uvDraftsFilterState === 'bookmarked' || searchDependsOnBookmark(uvDraftsSearchQuery)) {
        renderUVDraftsGrid();
      }
    });
    bookmarkBtn.disabled = isPendingDraft;
    if (isBookmarkedNow) bookmarkBtn.style.color = '#fbbf24';
    actionsRow.appendChild(bookmarkBtn);

    // Copy prompt button
    const copyBtn = createActionBtn(icons.copy, 'Copy Prompt', async () => {
      const prompt = String(draft.prompt || '').trim();
      if (!prompt) return;
      try {
        await Promise.resolve(navigator?.clipboard?.writeText?.(prompt));
        flashIconSuccess(copyBtn, icons.copy);
      } catch (err) {
        console.warn('[UV Drafts] Clipboard copy failed:', err);
      }
    });
    copyBtn.disabled = !String(draft.prompt || '').trim();
    actionsRow.appendChild(copyBtn);

    const retryBtn = createActionBtn(icons.retry, 'Retry (copy prompt to composer)', async () => {
      const prompt = String(draft.prompt || '').trim();
      if (!prompt) return;

      const isRemixDraft = !!String(draft?.remix_target_draft_id || draft?.remix_target_post_id || '').trim();
      let source = null;
      let sourceError = '';
      if (isRemixDraft) {
        try {
          source = await resolveRetryComposerSource(draft);
        } catch (err) {
          sourceError = err?.message || 'Parent source was not found.';
        }
      }
      setComposerSource(source);

      const promptField = uvDraftsComposerEl?.querySelector('[data-uvd-compose-prompt="1"]');
      if (promptField) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(promptField, prompt);
        } else {
          promptField.value = prompt;
        }
        promptField.dispatchEvent(new Event('input', { bubbles: true }));
        promptField.dispatchEvent(new Event('change', { bubbles: true }));
        promptField.focus();
      } else {
        sessionStorage.setItem(UV_PENDING_COMPOSE_KEY, JSON.stringify({ prompt, createdAt: Date.now() }));
      }

      const statusEl = uvDraftsComposerEl?.querySelector('[data-uvd-compose-status="1"]');
      if (statusEl) {
        if (isRemixDraft && source) {
          statusEl.textContent = 'Retry ready in composer. Parent source loaded.';
          statusEl.dataset.tone = 'ok';
        } else if (isRemixDraft) {
          statusEl.textContent = sourceError
            ? `Retry ready in composer. ${sourceError}`
            : 'Retry ready in composer. Parent source was not found.';
          statusEl.dataset.tone = 'error';
        } else {
          statusEl.textContent = 'Retry ready in composer.';
          statusEl.dataset.tone = 'ok';
        }
      }
      flashIconSuccess(retryBtn, icons.retry);
    });
    retryBtn.disabled = !String(draft.prompt || '').trim();
    actionsRow.appendChild(retryBtn);

    // Download button
    const downloadBtn = createActionBtn(icons.download, 'Download', async () => {
      if (!draft.download_url) return;
      try {
        const res = await fetch(draft.download_url);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sora-draft-${draft.id}.mp4`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        console.error('[UV Drafts] Download error:', err);
      }
    });
    downloadBtn.disabled = hasBlockedDraftActions || !draft.download_url;
    actionsRow.appendChild(downloadBtn);

    // Hide button
    const hideBtn = createActionBtn(draft.hidden ? icons.eyeClosed : icons.eyeOpen, draft.hidden ? 'Unhide' : 'Hide', async () => {
      draft.hidden = !draft.hidden;
      hideBtn.innerHTML = draft.hidden ? icons.eyeClosed : icons.eyeOpen;
      hideBtn.title = draft.hidden ? 'Unhide' : 'Hide';
      await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
      renderUVDraftsGrid();
      updateUVDraftsStats();
    });
    hideBtn.disabled = isPendingDraft;
    actionsRow.appendChild(hideBtn);

    // Workspace button
    const workspaceBtn = createActionBtn(icons.folder, 'Workspace', () => {
      showDraftWorkspacePicker(draft);
    });
    actionsRow.appendChild(workspaceBtn);

    // Delete button
    const deleteBtn = createActionBtn(icons.trash, 'Delete', async () => {
      if (!confirm(`Delete this draft?\n\n"${(draft.prompt || 'Untitled').slice(0, 50)}..."\n\nThis cannot be undone.`)) return;
      try {
        // Call API to delete
        const deleteHeaders = {};
        if (capturedAuthToken) deleteHeaders['Authorization'] = capturedAuthToken;
        const res = await fetch(`https://sora.chatgpt.com/backend/project_y/profile/drafts/${draft.id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: deleteHeaders,
        });
        if (res.ok) {
          await uvDBDelete(UV_DRAFTS_STORES.drafts, draft.id);
          await deleteScheduledPostsForDraft(draft.id);
          uvDraftsData = removeDraftById(uvDraftsData, draft.id);
          uvDraftsJustSeenIds.delete(draft.id);
          removeBookmark(draft.id);
          renderUVDraftsGrid();
          updateUVDraftsStats();
        } else {
          alert('Failed to delete draft');
        }
      } catch (err) {
        console.error('[UV Drafts] Delete error:', err);
        alert('Failed to delete draft');
      }
    });
    deleteBtn.disabled = isPendingDraft;
    actionsRow.appendChild(deleteBtn);

    card.appendChild(actionsRow);

    // Second row for post/schedule actions
    const actionsRow2 = document.createElement('div');
    actionsRow2.className = 'uvd-actions-row2';
    const isDraftScheduled = () => String(draft?.scheduled_post_status || '').toLowerCase() === 'pending'
      && Number(draft?.scheduled_post_at) > 0;

    let scheduleBtn = null;
    const syncScheduleButtonState = () => {
      if (!scheduleBtn) return;
      if (isDraftPubliclyPosted(draft)) {
        scheduleBtn.textContent = 'Posted ✓';
        scheduleBtn.disabled = true;
        scheduleBtn.dataset.tone = 'success';
        return;
      }
      if (isPendingDraft) {
        scheduleBtn.textContent = 'Schedule';
        scheduleBtn.disabled = true;
        delete scheduleBtn.dataset.tone;
        return;
      }
      if (hasBlockedDraftActions) {
        scheduleBtn.textContent = isDraftScheduled() ? 'Scheduled' : 'Schedule';
        scheduleBtn.disabled = true;
        if (isDraftScheduled()) scheduleBtn.dataset.tone = 'info';
        else delete scheduleBtn.dataset.tone;
        return;
      }
      scheduleBtn.textContent = isDraftScheduled() ? 'Scheduled' : 'Schedule';
      scheduleBtn.disabled = false;
      if (isDraftScheduled()) scheduleBtn.dataset.tone = 'info';
      else delete scheduleBtn.dataset.tone;
    };

    // Post button
    const postBtn = document.createElement('button');
    postBtn.className = 'uvd-action-pill';
    postBtn.type = 'button';
    postBtn.textContent = 'Post';
    if (isDraftPubliclyPosted(draft)) {
      postBtn.textContent = 'Posted ✓';
      postBtn.disabled = true;
      postBtn.dataset.tone = 'success';
    } else if (isPendingDraft) {
      postBtn.disabled = true;
    } else if (hasBlockedDraftActions) {
      postBtn.disabled = true;
    }
    postBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isDraftPubliclyPosted(draft)) return;

      const caption = prompt('Enter caption for post:', draft.title || draft.prompt?.slice(0, 100) || '');
      if (caption === null) return;

      try {
        postBtn.textContent = 'Posting...';
        postBtn.disabled = true;
        const publishedPost = await createPublicPostForDraft(draft, caption);
        await deleteScheduledPostsForDraft(draft.id);
        applyPublishedPostToDraftData(draft, publishedPost);
        await persistDraftRecord(draft);
        postBtn.textContent = 'Posted ✓';
        postBtn.dataset.tone = 'success';
        syncScheduleButtonState();
      } catch (err) {
        console.error('[UV Drafts] Post error:', err);
        postBtn.textContent = 'Post';
        postBtn.disabled = hasBlockedDraftActions;
        delete postBtn.dataset.tone;
        alert(`Failed to post draft${err?.message ? `: ${err.message}` : ''}`);
      }
    });
    actionsRow2.appendChild(postBtn);

    // Schedule button
    scheduleBtn = document.createElement('button');
    scheduleBtn.className = 'uvd-action-pill';
    scheduleBtn.type = 'button';
    syncScheduleButtonState();
    scheduleBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isDraftPubliclyPosted(draft)) {
        alert('This draft has already been posted.');
        return;
      }

      const dateStr = prompt(`${isDraftScheduled() ? 'Reschedule' : 'Schedule'} post for (YYYY-MM-DD HH:MM):`,
        new Date(Date.now() + 3600000).toISOString().slice(0, 16).replace('T', ' '));
      if (!dateStr) return;

      const scheduledTime = new Date(dateStr.replace(' ', 'T')).getTime();
      if (isNaN(scheduledTime) || scheduledTime < Date.now()) {
        alert('Invalid date/time. Please use format: YYYY-MM-DD HH:MM');
        return;
      }

      const caption = prompt('Enter caption for scheduled post:', draft.title || draft.prompt?.slice(0, 100) || '');
      if (caption === null) return;

      try {
        await deleteScheduledPostsForDraft(draft.id);
        const scheduledPost = {
          id: `schedule_${draft.id}`,
          draft_id: draft.id,
          scheduled_at: scheduledTime,
          caption,
          visibility: 'public',
          status: 'pending',
        };
        await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, scheduledPost);
        await setDraftScheduledState(draft, scheduledPost);
        syncScheduleButtonState();
        alert(`Post scheduled for ${new Date(scheduledTime).toLocaleString()}`);
      } catch (err) {
        console.error('[UV Drafts] Schedule error:', err);
        syncScheduleButtonState();
        alert(`Failed to schedule post${err?.message ? `: ${err.message}` : ''}`);
      }
    });
    actionsRow2.appendChild(scheduleBtn);

    const trimBtn = document.createElement('button');
    trimBtn.className = 'uvd-action-pill';
    trimBtn.type = 'button';
    trimBtn.textContent = 'Trim';
    trimBtn.disabled = hasBlockedDraftActions || !canTrimDraft(draft);
    trimBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trimUrl = getDraftTrimUrl(draft);
      if (!trimUrl) return;
      window.location.href = trimUrl;
    });
    actionsRow2.appendChild(trimBtn);

    card.appendChild(actionsRow2);

    card.addEventListener('click', (e) => {
      if (hasBlockedDraftActions) return;
      if (e.defaultPrevented) return;
      if (Date.now() < suppressCardNavUntil) return;
      if (shouldIgnoreCardNavigationTarget(e.target)) return;
      if (e.button !== 0) return;

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        window.open(draftUrl, '_blank', 'noopener');
        return;
      }

      window.location.href = draftUrl;
    });

    card.addEventListener('auxclick', (e) => {
      if (hasBlockedDraftActions) return;
      if (e.defaultPrevented) return;
      if (Date.now() < suppressCardNavUntil) return;
      if (shouldIgnoreCardNavigationTarget(e.target)) return;
      if (e.button !== 1) return;
      e.preventDefault();
      window.open(draftUrl, '_blank', 'noopener');
    });

    // Hover handlers for card effects
    const video = card.querySelector('video'); // May be null for violations
    const playBtn = card.querySelector('.uv-play-btn'); // May be null for violations

    card.addEventListener('mouseenter', () => {
      card.style.transform = 'scale(1.02)';
      card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';

      // If user has interacted with any video, auto-play on hover
      if (uvDraftsVideoInteracted && video) {
        // Pause any other playing video
        if (uvDraftsCurrentlyPlayingVideo && uvDraftsCurrentlyPlayingVideo !== video) {
          uvDraftsCurrentlyPlayingVideo.pause();
          uvDraftsCurrentlyPlayingVideo.currentTime = 0;
          uvDraftsCurrentlyPlayingVideo.style.opacity = '0';
          const otherPlayBtn = uvDraftsCurrentlyPlayingVideo.parentElement?.querySelector('.uv-play-btn');
          if (otherPlayBtn) otherPlayBtn.style.display = 'flex';
        }
        // Mark as seen when auto-playing on hover
        if (!uvDraftsJustSeenIds.has(draft.id) && isDraftUnreadState(draft)) {
          uvDraftsJustSeenIds.add(draft.id);
          draft.is_read = true;
          markDraftAsSeen(draft.id);
          const badge = card.querySelector('.uv-new-badge');
          if (badge) badge.style.display = 'none';
          updateUVDraftsStats();
        }
        // Lazy load and play this video — defer opacity until first frame to avoid grey flash
        if (playBtn) playBtn.style.display = 'none';
        uvDraftsCurrentlyPlayingVideo = video;
        uvDraftsCurrentlyPlayingDraftId = draft.id;
        if (!video.src && video.dataset.src) {
          video.addEventListener('loadeddata', () => { video.style.opacity = '1'; video.controls = true; }, { once: true });
          video.src = video.dataset.src;
        } else {
          video.style.opacity = '1';
          video.controls = true;
        }
        video.play().catch(() => {});
      }
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.boxShadow = '';
      if (video) {
        video.pause();
        video.currentTime = 0;
        video.style.opacity = '0';
        video.controls = false;
        if (uvDraftsCurrentlyPlayingVideo === video) {
          uvDraftsCurrentlyPlayingVideo = null;
          uvDraftsCurrentlyPlayingDraftId = null;
        }
      }
      if (playBtn) {
        playBtn.style.display = 'flex';
      }
    });

    // Track full video playthrough - mark as read on server and locally (only for non-violations)
    if (video) {
      video.addEventListener('ended', () => {
        if (!uvDraftsJustSeenIds.has(draft.id) && isDraftUnreadState(draft)) {
          uvDraftsJustSeenIds.add(draft.id);
          draft.is_read = true; // Update in-memory
          markDraftAsSeen(draft.id); // Update server and IndexedDB
          const badge = card.querySelector('.uv-new-badge');
          if (badge) badge.style.display = 'none';
          updateUVDraftsStats(); // Update stats display
        }
      });
    }

    return card;
  }

  // ---- Grid rendering ----
  // Three render paths, each purpose-built:
  //   renderUVDraftsGrid()     — full rebuild (initial load, filter/search change)
  //   renderUVDraftsSyncUpdate() — append-only (background sync pages, never touches existing cards)
  //   renderMoreUVDrafts()     — append-only (infinite scroll)

  function showUVDraftsLoadingIndicator(message = 'Loading...') {
    if (!uvDraftsLoadingEl) return;
    uvDraftsLoadingEl.style.display = 'flex';
    uvDraftsLoadingEl.textContent = message;
  }

  function hideUVDraftsLoadingIndicator() {
    if (!uvDraftsLoadingEl) return;
    uvDraftsLoadingEl.style.display = 'none';
  }

  function isUVDraftsLoadingIndicatorVisible() {
    if (!uvDraftsLoadingEl) return false;
    const display = String(uvDraftsLoadingEl.style.display || '').trim().toLowerCase();
    return !!display && display !== 'none';
  }

  function shouldDeferUVDraftsEmptyState() {
    if (String(uvDraftsSearchQuery || '').trim()) return false;
    if (uvDraftsAwaitingMoreResults) return true;
    if (uvDraftsSyncUiState?.syncing === true) return true;
    return false;
  }

  function shouldRerenderUVDraftsEmptyStateAfterSync() {
    const renderableDrafts = getRenderableUVDrafts();
    return !Array.isArray(renderableDrafts) || renderableDrafts.length === 0;
  }

  function restoreUVDraftsPlaybackState() {
    if (!uvDraftsCurrentlyPlayingDraftId || !uvDraftsGridEl) return;
    const card = uvDraftsGridEl.querySelector(`[data-draft-id="${CSS.escape(uvDraftsCurrentlyPlayingDraftId)}"]`);
    if (!card) return;
    const video = card.querySelector('video');
    const playBtn = card.querySelector('.uv-play-btn');
    if (!video) return;
    if (playBtn) playBtn.style.display = 'none';
    uvDraftsCurrentlyPlayingVideo = video;
    if (!video.src && video.dataset.src) {
      video.addEventListener('loadeddata', () => { video.style.opacity = '1'; video.controls = true; }, { once: true });
      video.src = video.dataset.src;
    } else {
      video.style.opacity = '1';
      video.controls = true;
    }
    video.play().catch(() => {});
  }

  function clearUVDraftsEmptyState() {
    if (!uvDraftsGridEl) return;
    const empty = uvDraftsGridEl.querySelector('.uvd-empty-state');
    if (empty) empty.remove();
  }

  // Append cards from uvDraftsFilteredCache[start..end) to the grid.
  // Never touches existing DOM — just creates and appends new cards.
  function appendCardsToGrid(start, end, options = {}) {
    if (!uvDraftsGridEl || start >= end) return;
    const loadMore = uvDraftsGridEl.querySelector('.uv-drafts-load-more');
    if (loadMore) loadMore.remove();
    clearUVDraftsEmptyState();
    hideUVDraftsLoadingIndicator();
    const fragment = document.createDocumentFragment();
    const maxLandscapeColumns = Math.max(1, Math.floor(Number(options.maxLandscapeColumns) || getLandscapeRunGridColumnCapacity(uvDraftsGridEl)));
    uvDraftsLastGridColumnCapacity = maxLandscapeColumns;
    const draftSlice = uvDraftsFilteredCache.slice(start, end);
    const plannedRows = planDraftGridRows(draftSlice, maxLandscapeColumns);
    let draftOffset = 0;

    for (const row of plannedRows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'uvd-grid-row';
      rowEl.style.gridTemplateColumns = `repeat(${maxLandscapeColumns}, minmax(0, 1fr))`;

      for (const item of row) {
        const itemDraftCount = Array.isArray(item?.draftIds) ? item.draftIds.length : 0;
        const itemDrafts = draftSlice.slice(draftOffset, draftOffset + itemDraftCount);
        draftOffset += itemDraftCount;

        if (item.kind === 'landscape-run' && itemDrafts.length > 1) {
          const landscapeRunEl = document.createElement('div');
          landscapeRunEl.className = 'uvd-landscape-run-grid';
          landscapeRunEl.style.gridColumn = `span ${item.span}`;
          landscapeRunEl.style.gridTemplateColumns = `repeat(${item.span}, minmax(0, 1fr))`;
          landscapeRunEl.style.alignSelf = 'start';
          for (const itemDraft of itemDrafts) {
            landscapeRunEl.appendChild(createUVDraftCard(itemDraft));
          }
          rowEl.appendChild(landscapeRunEl);
          continue;
        }

        if (itemDrafts[0]) {
          rowEl.appendChild(createUVDraftCard(itemDrafts[0]));
        }
      }

      if (rowEl.children.length > 0) fragment.appendChild(rowEl);
    }
    uvDraftsGridEl.appendChild(fragment);
    uvDraftsRenderedCount = end;
    updateLoadMoreIndicator();
  }

  function rerenderUVDraftsGridForGeometryChange() {
    if (!uvDraftsGridEl || !uvDraftsPageEl || uvDraftsPageEl.style.display === 'none') return;
    uvDraftsFilteredCache = getRenderableUVDrafts();
    if (uvDraftsFilteredCache.length === 0 || uvDraftsAwaitingMoreResults) {
      renderUVDraftsGrid();
      return;
    }

    const scrollTop = uvDraftsPageEl.scrollTop;
    const targetCount = Math.max(
      Math.min(UV_DRAFTS_BATCH_SIZE, uvDraftsFilteredCache.length),
      Math.min(uvDraftsRenderedCount, uvDraftsFilteredCache.length)
    );
    const maxLandscapeColumns = getLandscapeRunGridColumnCapacity(uvDraftsGridEl);
    uvDraftsLastGridColumnCapacity = maxLandscapeColumns;
    const end = extendDraftRenderEndToRowBoundary(
      uvDraftsFilteredCache,
      targetCount,
      maxLandscapeColumns
    );

    uvDraftsGridEl.innerHTML = '';
    uvDraftsRenderedCount = 0;
    appendCardsToGrid(0, end, { maxLandscapeColumns });
    setupUVDraftsInfiniteScroll();
    restoreUVDraftsPlaybackState();

    if (uvDraftsPageEl) {
      const maxScrollTop = Math.max(0, uvDraftsPageEl.scrollHeight - uvDraftsPageEl.clientHeight);
      uvDraftsPageEl.scrollTop = Math.min(scrollTop, maxScrollTop);
    }
  }

  function scheduleUVDraftsResponsiveLayoutCheck(force = false) {
    if (!uvDraftsGridEl || !uvDraftsPageEl || uvDraftsPageEl.style.display === 'none') return;
    if (uvDraftsResponsiveLayoutTimerId) {
      clearTimeout(uvDraftsResponsiveLayoutTimerId);
    }
    uvDraftsResponsiveLayoutTimerId = setTimeout(() => {
      uvDraftsResponsiveLayoutTimerId = 0;
      if (!uvDraftsGridEl || !uvDraftsPageEl || uvDraftsPageEl.style.display === 'none') return;
      const nextCapacity = getLandscapeRunGridColumnCapacity(uvDraftsGridEl);
      if (!force && nextCapacity === uvDraftsLastGridColumnCapacity) return;
      rerenderUVDraftsGridForGeometryChange();
    }, 60);
  }

  function ensureUVDraftsResponsiveLayoutWatchers() {
    if (!uvDraftsGridEl) return;

    if (typeof ResizeObserver === 'function') {
      if (!uvDraftsGridResizeObserver) {
        uvDraftsGridResizeObserver = new ResizeObserver(() => {
          scheduleUVDraftsResponsiveLayoutCheck();
        });
      } else {
        uvDraftsGridResizeObserver.disconnect();
      }
      uvDraftsGridResizeObserver.observe(uvDraftsGridEl);
    }

    if (!uvDraftsWindowResizeHandler && typeof globalScope?.addEventListener === 'function') {
      uvDraftsWindowResizeHandler = () => {
        scheduleUVDraftsResponsiveLayoutCheck();
      };
      globalScope.addEventListener('resize', uvDraftsWindowResizeHandler, { passive: true });
    }

    if (
      !uvDraftsVisualViewportResizeHandler
      && globalScope?.visualViewport
      && typeof globalScope.visualViewport.addEventListener === 'function'
    ) {
      uvDraftsVisualViewportResizeHandler = () => {
        scheduleUVDraftsResponsiveLayoutCheck();
      };
      globalScope.visualViewport.addEventListener('resize', uvDraftsVisualViewportResizeHandler, { passive: true });
    }

    uvDraftsLastGridColumnCapacity = getLandscapeRunGridColumnCapacity(uvDraftsGridEl);
  }

  // Background sync: new page arrived. Recalculate cache, append up to one batch of new cards.
  function renderUVDraftsSyncUpdate() {
    if (!uvDraftsGridEl) return;
    uvDraftsFilteredCache = getRenderableUVDrafts();
    if (uvDraftsFilteredCache.length <= uvDraftsRenderedCount) return;
    // Only append one batch beyond what's rendered — infinite scroll handles the rest
    const maxLandscapeColumns = getLandscapeRunGridColumnCapacity(uvDraftsGridEl);
    const end = extendDraftRenderEndToRowBoundary(
      uvDraftsFilteredCache,
      Math.min(uvDraftsRenderedCount + UV_DRAFTS_BATCH_SIZE, uvDraftsFilteredCache.length),
      maxLandscapeColumns
    );
    appendCardsToGrid(uvDraftsRenderedCount, end, { maxLandscapeColumns });
  }

  // Update only the status/progress text and ring on pending cards without rebuilding the grid.
  function updatePendingCardsInPlace(pendingDrafts) {
    if (!uvDraftsGridEl) return;
    for (const draft of pendingDrafts) {
      if (!draft?.id) continue;
      const card = uvDraftsGridEl.querySelector(`[data-draft-id="${CSS.escape(String(draft.id))}"]`);
      if (!card) continue;
      const pct = Number(draft.progress_pct);
      const pctNorm = Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 0;

      // Update status label
      const label = card.querySelector('[data-pending-status]');
      if (label) {
        const status = String(draft.pending_status || draft.pending_task_status || 'generating').replace(/_/g, ' ');
        label.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      }

      // Update progress ring
      const ring = card.querySelector('[data-pending-ring]');
      if (ring) {
        ring.innerHTML = buildPendingRingMarkup(pctNorm);
      }
    }
  }

  // Full grid rebuild — clears everything and renders from scratch.
  // Used on initial load, filter change, search change.
  function renderUVDraftsGrid(resetScroll = true) {
    if (!uvDraftsGridEl) return;

    uvDraftsFilteredCache = getRenderableUVDrafts();

    if (resetScroll) {
      uvDraftsGridEl.innerHTML = '';
      uvDraftsRenderedCount = 0;
    }

    if (uvDraftsFilteredCache.length === 0) {
      uvDraftsGridEl.innerHTML = '';
      uvDraftsRenderedCount = 0;
      if (shouldDeferUVDraftsEmptyState()) {
        if (!isUVDraftsLoadingIndicatorVisible()) {
          showUVDraftsLoadingIndicator(uvDraftsAwaitingMoreResults ? 'Syncing drafts...' : 'Loading drafts...');
        }
        return;
      }
      hideUVDraftsLoadingIndicator();
      const empty = document.createElement('div');
      empty.className = 'uvd-empty-state';
      empty.textContent = uvDraftsSearchQuery ? 'No drafts match your search' : 'No drafts found';
      uvDraftsGridEl.appendChild(empty);
      return;
    }

    const maxLandscapeColumns = getLandscapeRunGridColumnCapacity(uvDraftsGridEl);
    uvDraftsLastGridColumnCapacity = maxLandscapeColumns;
    const end = extendDraftRenderEndToRowBoundary(
      uvDraftsFilteredCache,
      resetScroll
        ? Math.min(UV_DRAFTS_BATCH_SIZE, uvDraftsFilteredCache.length)
        : Math.min(Math.max(uvDraftsRenderedCount, UV_DRAFTS_BATCH_SIZE), uvDraftsFilteredCache.length),
      maxLandscapeColumns
    );
    appendCardsToGrid(uvDraftsRenderedCount, end, { maxLandscapeColumns });
    setupUVDraftsInfiniteScroll();
    restoreUVDraftsPlaybackState();
  }

  // Infinite scroll: append next batch.
  function renderMoreUVDrafts() {
    if (!uvDraftsGridEl || uvDraftsRenderedCount >= uvDraftsFilteredCache.length) return;
    const maxLandscapeColumns = getLandscapeRunGridColumnCapacity(uvDraftsGridEl);
    const end = extendDraftRenderEndToRowBoundary(
      uvDraftsFilteredCache,
      Math.min(uvDraftsRenderedCount + UV_DRAFTS_BATCH_SIZE, uvDraftsFilteredCache.length),
      maxLandscapeColumns
    );
    appendCardsToGrid(uvDraftsRenderedCount, end, { maxLandscapeColumns });
  }

  function updateLoadMoreIndicator() {
    // Remove existing indicator
    const existing = uvDraftsPageEl?.querySelector('.uv-drafts-load-more');
    if (existing) existing.remove();

    if (uvDraftsRenderedCount < uvDraftsFilteredCache.length) {
      const indicator = document.createElement('div');
      indicator.className = 'uv-drafts-load-more';
      indicator.textContent = `Showing ${uvDraftsRenderedCount} of ${uvDraftsFilteredCache.length} drafts - scroll for more`;
      uvDraftsGridEl?.appendChild(indicator);
    }
  }

  function setupUVDraftsInfiniteScroll() {
    // Remove old scroll handler
    if (uvDraftsScrollHandler && uvDraftsPageEl) {
      uvDraftsPageEl.removeEventListener('scroll', uvDraftsScrollHandler);
    }

    uvDraftsScrollHandler = () => {
      if (!uvDraftsPageEl || uvDraftsRenderedCount >= uvDraftsFilteredCache.length) return;

      const scrollTop = uvDraftsPageEl.scrollTop;
      const scrollHeight = uvDraftsPageEl.scrollHeight;
      const clientHeight = uvDraftsPageEl.clientHeight;

      // Load more when within 500px of bottom
      if (scrollTop + clientHeight >= scrollHeight - 500) {
        renderMoreUVDrafts();
      }
    };

    if (uvDraftsPageEl) {
      uvDraftsPageEl.addEventListener('scroll', uvDraftsScrollHandler, { passive: true });
    }
  }

  function updateUVDraftsStats() {
    const statsEl = uvDraftsPageEl?.querySelector('.uv-drafts-stats');
    if (!statsEl) return;

    const workspaceScopedDrafts = filterDraftsByWorkspace(uvDraftsData, uvDraftsWorkspaceFilter);
    const { total, bookmarked, hidden, newCount } = computeUVDraftsStats();
    const unsyncedCount = workspaceScopedDrafts.reduce((count, draft) => count + (draft?.is_unsynced === true ? 1 : 0), 0);
    statsEl.textContent = `${total} drafts • ${bookmarked} bookmarked • ${hidden} hidden • ${newCount} new • ${unsyncedCount} unsynced`;
    setUVDraftsSyncUiState({ processed: total });
  }

  function setUVDraftsSyncUiState(nextState = {}) {
    uvDraftsSyncUiState = {
      ...uvDraftsSyncUiState,
      ...nextState,
    };
    persistSyncUiState();

    if (!uvDraftsSyncButtonEl) return;

    const processed = Number.isFinite(uvDraftsSyncUiState.processed)
      ? Math.max(0, Math.floor(uvDraftsSyncUiState.processed))
      : Math.max(0, Math.floor(uvDraftsData.length || 0));
    const page = Number.isFinite(uvDraftsSyncUiState.page)
      ? Math.max(0, Math.floor(uvDraftsSyncUiState.page))
      : 0;

    if (uvDraftsSyncUiState.syncing) {
      const pageSuffix = page > 0 ? ` • p${page}` : '';
      uvDraftsSyncButtonEl.textContent = `↻ Syncing ${processed}${pageSuffix}`;
      uvDraftsSyncButtonEl.disabled = true;
      return;
    }

    uvDraftsSyncButtonEl.textContent = `↻ Sync (${processed})`;
    uvDraftsSyncButtonEl.disabled = false;
  }

  async function initUVDraftsPage(fullSync = false) {
    const runId = ++uvDraftsInitRunId;
    const isStaleRun = () => runId !== uvDraftsInitRunId;
    uvDraftsAwaitingMoreResults = false;

    // Only show loading indicator if there's no cached data already rendered
    if (uvDraftsLoadingEl && (!uvDraftsGridEl || uvDraftsGridEl.children.length === 0)) {
      uvDraftsLoadingEl.style.display = 'flex';
      uvDraftsLoadingEl.textContent = 'Loading drafts from cache...';
    }
    const preserveSyncing = uvDraftsSyncUiState.syncing === true && !capturedAuthToken;
    setUVDraftsSyncUiState({
      syncing: preserveSyncing || !!capturedAuthToken,
      page: preserveSyncing ? uvDraftsSyncUiState.page : 0,
    });

    // Load from cache first regardless of auth token
    uvDraftsData = await loadUVDraftsFromCache();
    if (isStaleRun()) return;
    setUVDraftsSyncUiState({ processed: uvDraftsData.length });
    resumePersistedMarkAllProgress({ queue: false });

    if (uvDraftsData.length > 0) {
      // Skip redundant full rebuild if the grid already has cards (e.g. re-init after token arrives)
      if (!uvDraftsGridEl || uvDraftsGridEl.children.length === 0) {
        renderUVDraftsGrid();
      }
      updateUVDraftsStats();
      if (uvDraftsLoadingEl) {
        uvDraftsLoadingEl.style.display = 'none';
      }
    }

    // Check if we have an auth token - if not, show message but don't block
    if (!capturedAuthToken) {
      stopPendingDraftsPolling(false);
      setUVDraftsSyncUiState({
        syncing: uvDraftsSyncUiState.syncing === true,
        processed: uvDraftsData.length,
        page: uvDraftsSyncUiState.syncing === true ? uvDraftsSyncUiState.page : 0,
      });
      resumePersistedMarkAllProgress({ queue: false });
      console.log('[UV Drafts] No auth token yet, will retry on refresh');
      if (uvDraftsLoadingEl) {
        if (uvDraftsData.length === 0) {
          // No cache and no auth - show helpful message
          uvDraftsLoadingEl.innerHTML = `
            <div style="text-align:center;padding:20px;">
              <div style="font-size:16px;margin-bottom:12px;">⚠️ Auth token not captured yet</div>
              <div style="font-size:13px;color:#888;margin-bottom:16px;">
                Refresh the page or navigate somewhere else first to capture the auth token.
              </div>
              <button id="uv-drafts-refresh" style="padding:10px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;margin-right:8px;">
                Refresh Page
              </button>
              <button id="uv-drafts-nav-drafts" style="padding:10px 20px;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">
                Go to Drafts
              </button>
            </div>
          `;
          uvDraftsLoadingEl.querySelector('#uv-drafts-refresh')?.addEventListener('click', () => location.reload());
          uvDraftsLoadingEl.querySelector('#uv-drafts-nav-drafts')?.addEventListener('click', () => {
            window.location.href = 'https://sora.chatgpt.com/drafts';
          });
        } else {
          // Have cache but no auth - show subtle message
          uvDraftsLoadingEl.style.display = 'none';
        }
      }
      return;
    }

    startPendingDraftsPolling();
    setUVDraftsSyncUiState({ syncing: true, processed: uvDraftsData.length, page: 1 });
    resumePersistedMarkAllProgress({ queue: true });

    // Quick first fetch - get 8 drafts instantly for immediate render
    try {
      const fullSyncIds = new Set();
      uvDraftsSyncConfirmedIds = new Set(); // Reset for new sync session
      const firstBatch = await fetchFirstUVDrafts(8);
      if (isStaleRun()) return;

      const hadCachedData = uvDraftsData.length > 0;
      uvDraftsAwaitingMoreResults = !hadCachedData && firstBatch.items.length === 0 && !!firstBatch.cursor;

      if (firstBatch.items.length > 0) {
        // Get existing data for merging
        const existingDrafts = await uvDBGetAll(UV_DRAFTS_STORES.drafts);
        if (isStaleRun()) return;
        const existingMap = new Map(existingDrafts.map(d => [d.id, d]));

        // Transform first batch
        const transformed = firstBatch.items.map((d, idx) =>
          transformDraftForStorage(d, existingMap.get(d.id) || {}, { apiOrder: idx, fromDraftsApi: true })
        );

        // Save to IndexedDB
        await uvDBPutAll(UV_DRAFTS_STORES.drafts, transformed);
        if (isStaleRun()) return;
        addDraftIdsToSet(transformed, fullSyncIds);

        // Merge with existing cache data (first batch at top, dedupe rest)
        uvDraftsData = mergeDraftListById(transformed, uvDraftsData);
        setUVDraftsSyncUiState({ processed: uvDraftsData.length, page: 1 });

        // Render — use incremental update if grid already has cards to avoid flash
        if (hadCachedData && uvDraftsGridEl && uvDraftsGridEl.children.length > 0) {
          renderUVDraftsSyncUpdate();
        } else {
          renderUVDraftsGrid();
        }
        updateUVDraftsStats();
      }

      if (uvDraftsData.length === 0) {
        renderUVDraftsGrid();
        updateUVDraftsStats();
      }

      // Continue fetching rest in background (if there's more)
      // Full sync: first-ever population (no cache before) or user pressed sync button.
      // Otherwise quick sync: only 3 pages.
      const isFirstPopulation = !hadCachedData;
      const doFullSync = fullSync || isFirstPopulation;
      const syncMaxPages = doFullSync ? Infinity : 3;
      if (firstBatch.cursor) {
        // Don't await - let it run in background
        syncRemainingDrafts(firstBatch.cursor, (count, page) => {
          console.log(`[UV Drafts] Background sync: ${count} drafts (page ${page})`);
          setUVDraftsSyncUiState({ syncing: true, processed: count, page });
        }, runId, firstBatch.items.length, fullSyncIds, syncMaxPages)
          .then(async (syncSucceeded) => {
            if (!syncSucceeded || isStaleRun()) return;
            // Only archive unsynced drafts after a full sync
            if (doFullSync) {
              await archiveUnsyncedDraftsAfterFullSync(fullSyncIds, runId);
            }
          })
          .catch((syncErr) => {
            console.error('[UV Drafts] Background sync failed:', syncErr);
          })
          .finally(() => {
            if (isStaleRun()) return;
            uvDraftsAwaitingMoreResults = false;
            setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
            if (shouldRerenderUVDraftsEmptyStateAfterSync()) {
              renderUVDraftsGrid();
              updateUVDraftsStats();
            }
          });
      } else {
        uvDraftsAwaitingMoreResults = false;
        if (doFullSync) {
          await archiveUnsyncedDraftsAfterFullSync(fullSyncIds, runId);
          if (isStaleRun()) return;
        }
        setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
        if (shouldRerenderUVDraftsEmptyStateAfterSync()) {
          renderUVDraftsGrid();
          updateUVDraftsStats();
        }
      }
    } catch (err) {
      console.error('[UV Drafts] Quick fetch failed, falling back to full sync:', err);
      uvDraftsAwaitingMoreResults = false;
      // Fall back to full sync
      try {
        setUVDraftsSyncUiState({ syncing: true, processed: uvDraftsData.length, page: 1 });
        uvDraftsData = await syncUVDraftsFromAPI((count, page) => {
          if (uvDraftsLoadingEl) {
            uvDraftsLoadingEl.textContent = `Loading drafts... ${count} found (page ${page})`;
          }
          setUVDraftsSyncUiState({ syncing: true, processed: count, page });
        });
        if (isStaleRun()) return;
        await archiveUnsyncedDraftsAfterFullSync(
          new Set((uvDraftsData || []).map((draft) => String(draft?.id || '').trim()).filter(Boolean)),
          runId
        );
        if (isStaleRun()) return;
        renderUVDraftsGrid();
        updateUVDraftsStats();
        setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
        if (shouldRerenderUVDraftsEmptyStateAfterSync()) {
          renderUVDraftsGrid();
          updateUVDraftsStats();
        }
      } catch (syncErr) {
        console.error('[UV Drafts] Full sync also failed:', syncErr);
        setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
        if (shouldRerenderUVDraftsEmptyStateAfterSync()) {
          renderUVDraftsGrid();
          updateUVDraftsStats();
        }
      }
      if (uvDraftsLoadingEl) {
        uvDraftsLoadingEl.style.display = 'none';
      }
    }
  }

  // Scheduled posts background timer
  let scheduledPostsTimerId = null;
  let scheduledPostsFailureCount = 0;
  const SCHEDULED_POSTS_MAX_FAILURES = 5;

  async function checkScheduledPosts() {
    try {
      const scheduled = await uvDBGetAll(UV_DRAFTS_STORES.scheduledPosts);
      scheduledPostsFailureCount = 0; // Reset on success
      const now = Date.now();
      const hasDuePosts = scheduled.some((post) => post?.status === 'pending' && post?.scheduled_at <= now);
      if (hasDuePosts && !capturedAuthToken) {
        console.warn('[UV Drafts] Skipping scheduled posts until auth token is available.');
        return;
      }

      for (const post of scheduled) {
        if (post.status === 'pending' && post.scheduled_at <= now) {
          console.log('[UV Drafts] Executing scheduled post:', post.draft_id);

          try {
            const draft = await uvDBGet(UV_DRAFTS_STORES.drafts, post.draft_id);
            if (!draft) {
              post.status = 'failed';
              await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, post);
              console.error('[UV Drafts] Scheduled post failed: missing draft', post.draft_id);
              continue;
            }

            const publishedPost = await createPublicPostForDraft(draft, post.caption || '');
            if (publishedPost || publishedPost === null) {
              post.status = 'posted';
              await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, post);
              applyPublishedPostToDraftData(draft, publishedPost);
              await persistDraftRecord(draft);
              console.log('[UV Drafts] Scheduled post succeeded:', post.draft_id);
            }
          } catch (err) {
            post.status = 'failed';
            await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, post);
            const draft = await uvDBGet(UV_DRAFTS_STORES.drafts, post.draft_id);
            if (draft) {
              await setDraftScheduledState(draft, post);
            }
            console.error('[UV Drafts] Scheduled post error:', err);
          }
        }
      }
    } catch (err) {
      console.error('[UV Drafts] Check scheduled posts error:', err);
      scheduledPostsFailureCount++;
      if (scheduledPostsFailureCount >= SCHEDULED_POSTS_MAX_FAILURES) {
        console.error('[UV Drafts] Too many failures, stopping scheduled post checks');
        if (scheduledPostsTimerId) {
          clearInterval(scheduledPostsTimerId);
          scheduledPostsTimerId = null;
        }
      }
    }
  }

  function startScheduledPostsTimer() {
    if (scheduledPostsTimerId) return;
    // Check every minute
    scheduledPostsTimerId = setInterval(checkScheduledPosts, 60000);
    // Also check immediately on start
    checkScheduledPosts();
  }

  function ensureUVDraftsPage() {
    loadUVDraftsViewState();
    syncWorkspaceFilterFromCreatortoolsPath({
      render: false,
      updateSelect: false,
      updateUrl: false,
    });

    if (uvDraftsPageEl && document.contains(uvDraftsPageEl)) {
      uvDraftsPageEl.style.display = 'block';
      ensureUVDraftsResponsiveLayoutWatchers();
      syncWorkspaceFilterFromCreatortoolsPath({
        render: false,
        updateSelect: true,
        updateUrl: true,
        allowEmptyWorkspaces: true,
      });
      updateUVDraftsHeaderTitle();
      startPendingDraftsPolling();
      if (uvDraftsComposerEl) {
        const statusEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-status="1"]');
        setComposerSource(uvDraftsComposerSource, statusEl);
      }
      if (uvDraftsGridEl) {
        renderUVDraftsGrid();
        updateUVDraftsStats();
        setUVDraftsSyncUiState({ processed: uvDraftsData.length });
        updateMarkAllProgressUI();
      }
      return uvDraftsPageEl;
    }

    const page = document.createElement('div');
    page.className = 'sora-uv-drafts-page uvd-page';
    Object.assign(page.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 2147483646,
      background: 'var(--token-bg-primary, #080c12)',
      color: '#fff',
      overflow: 'auto',
      fontFamily: 'var(--token-font-sans, var(--token-font-family, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif))',
    });

    // Add custom scrollbar styles
    const style = document.createElement('style');
    style.textContent = `
      @keyframes uvd-ring-spin { to { transform: rotate(360deg); } }
      .sora-uv-drafts-page {
        --uvd-border: var(--token-border-light, rgba(255,255,255,0.12));
        --uvd-border-strong: var(--token-border-medium, rgba(255,255,255,0.2));
        --uvd-surface: var(--token-bg-surface-secondary, rgba(255,255,255,0.06));
        --uvd-surface-hover: var(--token-bg-surface-tertiary, rgba(255,255,255,0.11));
        --uvd-text: var(--token-text-primary, #f4f7fb);
        --uvd-subtext: var(--token-text-tertiary, rgba(255,255,255,0.7));
        --uvd-ok: #8de3ab;
        --uvd-error: #ffaba5;
        --uvd-font-sans: var(--token-font-sans, var(--token-font-family, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
      }
      .sora-uv-drafts-page, .sora-uv-drafts-page * { font-family: var(--uvd-font-sans); }
      .sora-uv-drafts-page::-webkit-scrollbar { width: 10px; height: 10px; }
      .sora-uv-drafts-page::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
      .sora-uv-drafts-page::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 999px; }
      .sora-uv-drafts-page::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.30); }
      .uvd-shell { width: 100%; box-sizing: border-box; max-width: 1880px; margin: 0 auto; padding: 20px 22px 28px 455px; }
      .uvd-layout { display: block; }
      .uvd-main { min-width: 0; max-width: 1800px; margin: 0 auto; }
      .uvd-header { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:18px; flex-wrap:nowrap; }
      .uvd-header-controls { display:flex; gap:10px; align-items:center; justify-content:flex-end; flex-shrink: 0; margin-left: auto; }
      .uvd-title-wrap h1 { font-size: 60px; margin: 8px 0 10px; letter-spacing: -0.035em; line-height: .96; color: var(--uvd-text); font-weight: 700; }
      .uvd-title-wrap .uv-drafts-stats { color: var(--uvd-subtext); font-size: 18px; }
      .uvd-header-actions { display:flex; gap:10px; align-items:center; flex-wrap: wrap; }
      .uvd-cta { border:1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 14px; padding: 12px 16px; font-size: 16px; font-weight: 600; cursor:pointer; transition: background .16s ease, border-color .16s ease; white-space: nowrap; }
      .uvd-cta:hover { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-sync-status { font-size: 13px; color: var(--uvd-subtext); min-height: 18px; }
      .uvd-sync-status[data-tone="syncing"] { color: #70b2ff; }
      .uvd-sync-status[data-tone="retry"] { color: #f7bf5f; }
      .uvd-filter-bar { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
      .uvd-input, .uvd-select { border:1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 12px; font-size: 16px; height: 48px; transition: border-color .14s ease, box-shadow .14s ease, background .14s ease; }
      .uvd-input:focus, .uvd-select:focus { outline: none; border-color: var(--uvd-border-strong); box-shadow: 0 0 0 3px rgba(255,255,255,0.08); background: var(--uvd-surface-hover); }
      .uvd-input { padding: 0 14px; min-width: 360px; flex: 1; }
      .uvd-select { padding: 0 12px; min-width: 190px; }
      .uvd-composer { position: fixed; left: 0; top: 0; bottom: 0; width: 390px; box-sizing: border-box; padding: 22px 18px 24px; overflow: auto; border-right: 1px solid var(--uvd-border); background: var(--token-bg-primary, #0a0e18); z-index: 2; }
      .uvd-composer-head h2 { margin: 0; font-size: 52px; line-height: .92; letter-spacing: -0.03em; color: var(--uvd-text); font-weight: 700; }
      .uvd-composer-head p { margin: 10px 0 0; color: var(--uvd-subtext); font-size: 16px; line-height: 1.35; }
      .uvd-dropzone { margin-top: 14px; border: 2px dashed var(--uvd-border-strong); border-radius: 12px; padding: 20px 14px; background: transparent; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; text-align:center; transition: background .15s ease, border-color .15s ease; cursor: default; }
      .uvd-composer.is-source-ready .uvd-dropzone { display: none !important; }
      .uvd-dropzone strong { font-size: 15px; color: var(--uvd-text); }
      .uvd-dropzone span { font-size: 12px; color: var(--uvd-subtext); line-height: 1.4; }
      .uvd-dropzone.is-active { background: var(--uvd-surface-hover); border-color: rgba(255,255,255,0.45); }
      .uvd-firstframe-zone { margin-top: 10px; border: 2px dashed var(--uvd-border-strong); border-radius: 12px; padding: 16px 14px; background: transparent; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; text-align:center; cursor:pointer; transition: background .15s ease, border-color .15s ease; }
      .uvd-firstframe-zone:hover { background: var(--uvd-surface-hover); border-color: rgba(255,255,255,0.35); }
      .uvd-firstframe-zone.is-active { background: var(--uvd-surface-hover); border-color: rgba(255,255,255,0.45); }
      .uvd-firstframe-zone strong { font-size: 14px; color: var(--uvd-text); pointer-events: none; }
      .uvd-firstframe-zone span { font-size: 12px; color: var(--uvd-subtext); line-height: 1.4; pointer-events: none; }
      .uvd-firstframe-zone svg { pointer-events: none; }
      .uvd-firstframe-preview { margin-top: 10px; border: 1px solid var(--uvd-border); border-radius: 12px; background: var(--uvd-surface); align-items: center; gap: 10px; padding: 8px; display: none; }
      .uvd-firstframe-preview.is-visible { display: flex; }
      .uvd-firstframe-preview img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--uvd-border); background: #121722; display: block; }
      .uvd-firstframe-meta { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .uvd-firstframe-name { font-size: 13px; color: var(--uvd-text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .uvd-firstframe-clear { align-self: flex-start; border: 1px solid var(--uvd-border); background: transparent; color: var(--uvd-text); border-radius: 8px; min-height: 26px; padding: 0 8px; font-size: 11px; font-weight: 600; cursor: pointer; }
      .uvd-firstframe-clear:hover { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-compose-source-card { margin-top: 10px; border: 1px solid var(--uvd-border); border-radius: 12px; background: var(--uvd-surface); display: none !important; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; padding: 8px; align-items: center; }
      .uvd-composer.is-source-ready .uvd-compose-source-card { display: grid !important; }
      .uvd-compose-source-preview { width: 72px; height: 96px; border-radius: 8px; overflow: hidden; background: #121722; border: 1px solid var(--uvd-border); }
      .uvd-compose-source-preview img, .uvd-compose-source-preview video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .uvd-compose-source-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--uvd-subtext); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
      .uvd-compose-source-meta { min-width: 0; display: grid; gap: 4px; align-self: start; }
      .uvd-compose-source-title { color: var(--uvd-text); font-size: 14px; line-height: 1.3; font-weight: 600; word-break: break-word; }
      .uvd-compose-source-subtitle { color: var(--uvd-subtext); font-size: 12px; line-height: 1.3; word-break: break-word; }
      .uvd-compose-source-clear { grid-column: 2; margin-top: 3px; border: 1px solid var(--uvd-border); background: transparent; color: var(--uvd-text); border-radius: 8px; min-height: 30px; padding: 0 9px; font-size: 12px; font-weight: 600; cursor: pointer; justify-self: start; }
      .uvd-compose-source-clear:hover { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-compose-source-empty { margin-top: 8px; font-size: 14px; color: var(--uvd-subtext); min-height: 18px; display: block !important; }
      .uvd-composer.is-source-ready .uvd-compose-source-empty { display: none !important; }
      .uvd-field { display:flex; flex-direction:column; gap:7px; margin-top: 10px; }
      .uvd-field span { font-size: 12px; color: var(--uvd-subtext); text-transform: uppercase; letter-spacing: .03em; font-weight: 600; }
      .uvd-field textarea, .uvd-field input, .uvd-field select { width:100%; border:1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 10px; font-size: 15px; padding: 10px 11px; box-sizing: border-box; }
      .uvd-field textarea { min-height: 124px; resize: vertical; }
      .uvd-field-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:8px; }
      .uvd-field-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .uvd-compose-actions { margin-top: 10px; display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; }
      .uvd-composer:not(.is-source-ready) .uvd-compose-actions { grid-template-columns: 1fr; }
      .uvd-composer.is-source-ready .uvd-compose-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .uvd-compose-actions button { border:1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 10px; min-height: 42px; padding: 8px 10px; font-size: 14px; font-weight: 700; cursor:pointer; transition: background .15s ease, border-color .15s ease; }
      .uvd-compose-actions button:hover:not(:disabled) { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-compose-actions button:disabled { opacity: .45; cursor: not-allowed; }
      .uvd-compose-actions .uvd-requires-source { display: none; }
      .uvd-composer.is-source-ready .uvd-compose-actions .uvd-requires-source { display: inline-flex; align-items: center; justify-content: center; }
      .uvd-composer.is-source-ready [data-uvd-compose-create="1"] { display: none; }
      .uvd-cameo-section { margin-top: 10px; }
      .uvd-cameo-section .uvd-field-label { font-size: 13px; font-weight: 600; color: var(--uvd-subtext); display: block; margin-bottom: 6px; }
      .uvd-cameo-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
      .uvd-cameo-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--uvd-surface); border: 1px solid var(--uvd-border); border-radius: 8px; padding: 3px 6px 3px 8px; font-size: 12px; color: var(--uvd-text); }
      .uvd-cameo-label { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .uvd-cameo-swap, .uvd-cameo-remove { background: none; border: none; color: var(--uvd-subtext); cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1; }
      .uvd-cameo-swap:hover, .uvd-cameo-remove:hover { color: var(--uvd-text); }
      .uvd-cameo-add-row { display: flex; gap: 6px; }
      .uvd-cameo-input { flex: 1; background: var(--uvd-surface); border: 1px solid var(--uvd-border); border-radius: 8px; color: var(--uvd-text); padding: 4px 8px; font-size: 12px; }
      .uvd-cameo-add-btn { background: var(--uvd-surface); border: 1px solid var(--uvd-border); border-radius: 8px; color: var(--uvd-text); padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .uvd-cameo-add-btn:hover { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-compose-status { min-height: 18px; margin-top: 8px; font-size: 13px; color: var(--uvd-subtext); }
      .uvd-compose-status[data-tone="ok"] { color: var(--uvd-ok); }
      .uvd-compose-status[data-tone="error"] { color: var(--uvd-error); }
      .uvd-modal-backdrop {
        --uvd-border: var(--token-border-light, rgba(255,255,255,0.12));
        --uvd-border-strong: var(--token-border-medium, rgba(255,255,255,0.2));
        --uvd-surface: var(--token-bg-surface-secondary, rgba(255,255,255,0.06));
        --uvd-surface-hover: var(--token-bg-surface-tertiary, rgba(255,255,255,0.11));
        --uvd-text: var(--token-text-primary, #f4f7fb);
        --uvd-subtext: var(--token-text-tertiary, rgba(255,255,255,0.7));
        --uvd-ok: #8de3ab;
        --uvd-error: #ffaba5;
        --uvd-font-sans: var(--token-font-sans, var(--token-font-family, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(0,0,0,0.58);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        box-sizing: border-box;
        color: var(--uvd-text);
        font-family: var(--uvd-font-sans);
      }
      .uvd-modal-backdrop * { font-family: inherit; }
      .uvd-modal { width: 100%; max-width: 520px; max-height: min(82vh, 780px); overflow: auto; border: 1px solid var(--uvd-border-strong); border-radius: 16px; background: var(--token-bg-primary, #0a0e18); box-shadow: 0 24px 64px rgba(0,0,0,0.5); padding: 16px; }
      .uvd-modal-head h3 { margin: 0; font-size: 24px; line-height: 1.1; color: var(--uvd-text); font-weight: 700; }
      .uvd-modal-head p { margin: 6px 0 0; font-size: 14px; line-height: 1.35; color: var(--uvd-subtext); }
      .uvd-modal-status { min-height: 20px; margin-top: 8px; font-size: 13px; color: var(--uvd-subtext); }
      .uvd-modal-status[data-tone="ok"] { color: var(--uvd-ok); }
      .uvd-modal-status[data-tone="error"] { color: var(--uvd-error); }
      .uvd-ws-list { margin-top: 10px; display: grid; gap: 8px; }
      .uvd-ws-option { width: 100%; border: 1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 12px; min-height: 56px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; text-align: left; }
      .uvd-ws-option:hover { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-ws-option.is-selected { border-color: rgba(103,177,255,0.8); box-shadow: inset 0 0 0 1px rgba(103,177,255,0.45); }
      .uvd-ws-option-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .uvd-ws-dot { width: 12px; height: 12px; border-radius: 999px; flex: 0 0 auto; background: #3b82f6; box-shadow: 0 0 0 1px rgba(255,255,255,0.18) inset; }
      .uvd-ws-dot.is-none { background: transparent; border: 1px solid var(--uvd-border-strong); box-shadow: none; }
      .uvd-ws-labels { display: flex; flex-direction: column; min-width: 0; }
      .uvd-ws-name { font-size: 14px; font-weight: 600; color: var(--uvd-text); line-height: 1.25; }
      .uvd-ws-hint { font-size: 12px; color: var(--uvd-subtext); line-height: 1.3; }
      .uvd-ws-check { width: 18px; text-align: center; font-size: 16px; font-weight: 700; color: #8de3ab; }
      .uvd-ws-create { margin-top: 10px; display: flex; gap: 8px; }
      .uvd-modal-input { flex: 1; border: 1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 10px; min-height: 40px; padding: 0 12px; font-size: 14px; }
      .uvd-modal-input:focus { outline: none; border-color: var(--uvd-border-strong); box-shadow: 0 0 0 3px rgba(255,255,255,0.08); background: var(--uvd-surface-hover); }
      .uvd-modal-footer { margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; }
      .uvd-modal-btn { border: 1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 10px; min-height: 40px; padding: 0 13px; font-size: 14px; font-weight: 600; cursor: pointer; }
      .uvd-modal-btn:hover:not(:disabled) { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-modal-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .uvd-modal-btn.is-primary { background: #1f8d51; border-color: #1f8d51; color: #f8fffc; }
      .uvd-modal-btn.is-primary:hover:not(:disabled) { background: #23a15d; border-color: #23a15d; }
      .uvd-modal--workspace-manager { max-width: 560px; }
      .uvd-ws-manage-list { margin-top: 10px; display: grid; gap: 8px; }
      .uvd-ws-manage-row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 12px; border: 1px solid var(--uvd-border); border-radius: 12px; background: var(--uvd-surface); }
      .uvd-ws-manage-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--uvd-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .uvd-ws-manage-delete { width: 32px; height: 32px; border: none; border-radius: 8px; background: transparent; color: #ff8d86; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; flex: 0 0 auto; }
      .uvd-ws-manage-delete:hover { background: rgba(255,255,255,0.08); color: #ffb4ad; }
      .uvd-ws-manage-empty { padding: 18px 12px; border: 1px dashed var(--uvd-border); border-radius: 12px; color: var(--uvd-subtext); background: rgba(255,255,255,0.02); text-align: center; font-size: 13px; line-height: 1.4; }
      .uvd-card { position: relative; overflow: hidden; cursor: pointer; border: 1px solid var(--uvd-border); background: var(--token-bg-surface-primary, #1f222a); box-shadow: 0 12px 32px rgba(0,0,0,0.3); border-radius: 14px; transition: transform 0.15s ease, box-shadow 0.15s ease; }
      .uvd-grid-row { display:grid; gap: 14px; align-items: start; }
      .uvd-landscape-run-grid { display:grid; grid-template-columns: repeat(var(--uvd-landscape-run-cols, 2), minmax(0, 1fr)); gap: 14px; align-content: start; }
      .uvd-card.is-violation { background: #3a2020; }
      .uvd-card.is-processing-error { background: #1f273b; border-color: rgba(125,164,255,0.5); }
      .uvd-thumb-link { display:block; text-decoration:none; color:inherit; }
      .uvd-info { padding: 10px; }
      .uvd-prompt { font-size: 13px; font-weight: 500; color: var(--uvd-text); line-height: 1.3; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
      .uvd-prompt:hover { color: #d9e7ff; }
      .uvd-time { font-size: 12px; color: var(--uvd-subtext); }
      .uvd-actions-row { display:grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap:6px; padding: 0 10px 10px; }
      .uvd-actions-row2 { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:6px; padding: 0 10px 10px; }
      .uvd-icon-btn { width: 100%; height: 34px; border-radius: 9px; border: 1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease; }
      .uvd-icon-btn:hover:not(:disabled) { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-icon-btn:disabled { opacity: .42; cursor:not-allowed; color: var(--uvd-text-dim); background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); pointer-events: none; }
      .uvd-action-pill { width: 100%; min-height: 38px; border: 1px solid var(--uvd-border); background: var(--uvd-surface); border-radius: 9px; color: var(--uvd-text); font-size: 13px; font-weight: 600; cursor:pointer; transition: background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease; }
      .uvd-action-pill:hover:not(:disabled) { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-action-pill[data-tone="success"] { background: #1f8d51; border-color: #1f8d51; }
      .uvd-action-pill[data-tone="info"] { background: #215ba6; border-color: #215ba6; }
      .uvd-action-pill:disabled { opacity: .42; cursor:not-allowed; color: var(--uvd-text-dim); background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); pointer-events: none; }
      .uv-drafts-loading, .uvd-empty-state, .uv-drafts-load-more { width: 100%; text-align: center; color: var(--uvd-subtext); }
      .uv-drafts-loading { display:flex; align-items:center; justify-content:center; padding: 42px 18px; font-size: 16px; }
      .uvd-empty-state { padding: 60px 20px; font-size: 16px; }
      .uv-drafts-load-more { padding: 20px; font-size: 14px; }
      .uv-drafts-grid { display:flex; flex-direction:column; gap: 14px; }
      @media (max-width: 1380px) {
        .uvd-shell { padding-left: 396px; }
        .uvd-composer { width: 332px; padding: 20px 14px 22px; }
        .uvd-composer-head h2 { font-size: 44px; }
        .uvd-composer-head p { font-size: 14px; }
        .uvd-compose-actions button { font-size: 13px; min-height: 40px; }
      }
      @media (max-width: 1040px) {
        .uvd-shell { padding: 12px; }
        .uvd-composer { position: static; width: 100%; border: 1px solid var(--uvd-border); border-radius: 16px; margin-bottom: 16px; }
        .uvd-title-wrap h1 { font-size: 36px; }
        .uvd-compose-actions { grid-template-columns: 1fr; }
        .uvd-grid-row { grid-template-columns: 1fr !important; }
        .uvd-landscape-run-grid { grid-column: auto; grid-template-columns: 1fr !important; }
        .uvd-actions-row { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .uvd-field-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 760px) {
        .uvd-input, .uvd-select { min-width: 100%; width: 100%; }
      }
    `;
    page.appendChild(style);

    // Container
    const container = document.createElement('div');
    container.className = 'uvd-shell';

    const layout = document.createElement('div');
    layout.className = 'uvd-layout';

    const mainPanel = document.createElement('section');
    mainPanel.className = 'uvd-main';

    // Header
    const header = document.createElement('div');
    header.className = 'uvd-header';
    const headerControls = document.createElement('div');
    headerControls.className = 'uvd-header-controls';

    const titleSection = document.createElement('div');
    titleSection.className = 'uvd-title-wrap';

    const title = document.createElement('h1');
    title.textContent = getUVDraftsPageTitle(uvDraftsWorkspaceFilter, getWorkspaceNameById);
    titleSection.appendChild(title);
    uvDraftsTitleEl = title;

    const stats = document.createElement('div');
    stats.className = 'uv-drafts-stats';
    stats.textContent = 'Loading...';
    titleSection.appendChild(stats);

    header.appendChild(titleSection);

    // Refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'uvd-cta';
    refreshBtn.textContent = '↻ Sync';
    refreshBtn.addEventListener('click', () => {
      uvDraftsJustSeenIds.clear();
      const statusEl = uvDraftsComposerEl?.querySelector('[data-uvd-compose-status="1"]');
      setComposerSource(null, statusEl);
      initUVDraftsPage(true);
    });
    uvDraftsSyncButtonEl = refreshBtn;
    setUVDraftsSyncUiState({ processed: uvDraftsData.length });
    headerControls.appendChild(refreshBtn);

    // Mark all as read button with sync status
    const markAllContainer = document.createElement('div');
    markAllContainer.className = 'uvd-header-actions';

    const markAllReadBtn = document.createElement('button');
    markAllReadBtn.className = 'uvd-cta';
    markAllReadBtn.textContent = '✓ Mark All Read';

    const syncStatusEl = document.createElement('span');
    syncStatusEl.className = 'uvd-sync-status';
    uvDraftsMarkAllButtonEl = markAllReadBtn;
    uvDraftsMarkAllStatusEl = syncStatusEl;

    updateMarkAllProgressUI();

    markAllReadBtn.addEventListener('click', async () => {
      // Mark all unread drafts as read
      const unreadDrafts = uvDraftsData.filter(d => isDraftUnreadState(d));
      if (unreadDrafts.length === 0) {
        updateMarkAllProgressUI();
        return;
      }
      if (!confirm(`Mark all ${unreadDrafts.length} new drafts as read?`)) return;

      const unreadIds = Array.from(
        new Set(unreadDrafts.map((draft) => String(draft?.id || '').trim()).filter(Boolean))
      );
      uvDraftsMarkAllState = {
        active: unreadIds.length > 0,
        total: unreadIds.length,
        pendingIds: unreadIds,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      persistMarkAllState();
      updateMarkAllProgressUI();

      for (const draft of unreadDrafts) {
        draft.is_read = true;
        uvDraftsJustSeenIds.add(draft.id);
        // Call API for each (fire and forget to avoid blocking)
        markDraftAsSeen(draft.id).catch(() => {});
      }

      // Update UI
      uvDraftsPageEl?.querySelectorAll('.uv-new-badge').forEach(badge => {
        badge.style.display = 'none';
      });
      updateUVDraftsStats();
      updateMarkAllProgressUI();
    });

    markAllContainer.appendChild(markAllReadBtn);
    markAllContainer.appendChild(syncStatusEl);
    headerControls.appendChild(markAllContainer);
    header.appendChild(headerControls);

    mainPanel.appendChild(header);

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.className = 'uv-drafts-filter-bar uvd-filter-bar';

    // Search input
    const searchInput = document.createElement('input');
    searchInput.className = 'uvd-input';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search prompts/titles or use filters: model:, ws:, dur:, bookmarked:true, hidden:false, "exact phrase"';
    let searchDebounce = null;
    searchInput.value = uvDraftsSearchQuery;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        uvDraftsSearchQuery = searchInput.value.trim();
        persistUVDraftsViewState();
        renderUVDraftsGrid();
      }, 300);
    });
    uvDraftsSearchInput = searchInput;
    filterBar.appendChild(searchInput);

    // Filter dropdown
    const filterSelect = document.createElement('select');
    filterSelect.className = 'uvd-select';
      filterSelect.innerHTML = `
        <option value="all">All Drafts</option>
        <option value="bookmarked">Bookmarked</option>
        <option value="hidden">Hidden</option>
        <option value="violations">Violations</option>
        <option value="new">New Only</option>
        <option value="unsynced">Unsynced</option>
      `;
    if (Array.from(filterSelect.options).some((opt) => opt.value === uvDraftsFilterState)) {
      filterSelect.value = uvDraftsFilterState;
    } else {
      uvDraftsFilterState = 'all';
      filterSelect.value = uvDraftsFilterState;
      persistUVDraftsViewState();
    }
    filterSelect.addEventListener('change', () => {
      uvDraftsFilterState = filterSelect.value;
      uvDraftsJustSeenIds.clear(); // Clear just-seen on filter change
      persistUVDraftsViewState();
      updateUVDraftsHeaderTitle();
      renderUVDraftsGrid();
    });
    filterBar.appendChild(filterSelect);

    // Workspace dropdown
    const workspaceSelect = document.createElement('select');
    workspaceSelect.className = 'uvd-select';
    workspaceSelect.innerHTML = '<option value="">All Workspaces</option>';
    workspaceSelect.addEventListener('change', () => {
      if (workspaceSelect.value === '__manage__') {
        showWorkspaceManager();
        workspaceSelect.value = uvDraftsWorkspaceFilter || '';
        return;
      }
      uvDraftsWorkspaceFilter = workspaceSelect.value || null;
      persistUVDraftsViewState();
      syncCreatortoolsPathToWorkspaceFilter({ historyMode: 'push' });
      updateUVDraftsHeaderTitle();
      renderUVDraftsGrid();
    });
    uvWorkspaceSelectEl = workspaceSelect;
    filterBar.appendChild(workspaceSelect);

    // Load workspaces async
    loadWorkspaces().then(() => {
      syncWorkspaceFilterFromCreatortoolsPath({
        render: false,
        updateSelect: false,
        updateUrl: true,
        allowEmptyWorkspaces: true,
      });
      updateWorkspaceSelect();
      updateUVDraftsHeaderTitle();
      if (uvDraftsGridEl && isUVDraftsPageVisible()) {
        renderUVDraftsGrid();
      }
    });

    // "Remove All Unsynced" button — only visible when unsynced filter is active
    const removeUnsyncedBtn = document.createElement('button');
    removeUnsyncedBtn.className = 'uvd-cta';
    removeUnsyncedBtn.textContent = 'Remove All Unsynced';
    removeUnsyncedBtn.style.display = uvDraftsFilterState === 'unsynced' ? '' : 'none';
    removeUnsyncedBtn.style.marginLeft = 'auto';
    removeUnsyncedBtn.addEventListener('click', async () => {
      const unsyncedDrafts = uvDraftsData.filter(d => d?.is_unsynced === true);
      if (unsyncedDrafts.length === 0) return;
      if (!confirm(`Remove ${unsyncedDrafts.length} unsynced draft${unsyncedDrafts.length === 1 ? '' : 's'} from local storage?\n\nThis only removes them locally — nothing is deleted from the server.`)) return;
      removeUnsyncedBtn.disabled = true;
      removeUnsyncedBtn.textContent = 'Removing...';
      try {
        for (const draft of unsyncedDrafts) {
          await uvDBDelete(UV_DRAFTS_STORES.drafts, draft.id);
        }
        uvDraftsData = uvDraftsData.filter(d => d?.is_unsynced !== true);
        renderUVDraftsGrid();
        updateUVDraftsStats();
      } catch (err) {
        console.error('[UV Drafts] Failed to remove unsynced drafts:', err);
      }
      removeUnsyncedBtn.disabled = false;
      removeUnsyncedBtn.textContent = 'Remove All Unsynced';
    });
    filterBar.appendChild(removeUnsyncedBtn);

    // Show/hide the remove button when filter changes
    filterSelect.addEventListener('change', () => {
      removeUnsyncedBtn.style.display = filterSelect.value === 'unsynced' ? '' : 'none';
    });

    mainPanel.appendChild(filterBar);
    uvDraftsFilterBarEl = filterBar;

    // Loading indicator
    const loading = document.createElement('div');
    loading.className = 'uv-drafts-loading';
    loading.textContent = 'Loading...';
    mainPanel.appendChild(loading);
    uvDraftsLoadingEl = loading;

    // Grid
    const grid = document.createElement('div');
    grid.className = 'uv-drafts-grid';
    mainPanel.appendChild(grid);
    uvDraftsGridEl = grid;

    uvDraftsComposerEl = buildUVDraftsComposer();
    layout.appendChild(uvDraftsComposerEl);
    layout.appendChild(mainPanel);
    container.appendChild(layout);
    page.appendChild(container);
    document.documentElement.appendChild(page);
    uvDraftsPageEl = page;
    ensureUVDraftsResponsiveLayoutWatchers();

    // Initialize data
    initUVDraftsPage();

    return page;
  }

  function hideUVDraftsPage() {
    const hasActiveProgress = uvDraftsSyncUiState.syncing === true ||
      uvDraftsMarkAllState?.active === true ||
      uvDraftsReadQueue.length > 0 ||
      uvDraftsUnsyncedReads.size > 0;
    if (!hasActiveProgress) {
      uvDraftsInitRunId++;
    }
    if (uvDraftsMarkAllProgressTimerId) {
      clearInterval(uvDraftsMarkAllProgressTimerId);
      uvDraftsMarkAllProgressTimerId = null;
    }
    stopPendingDraftsPolling(false);
    if (!hasActiveProgress) {
      setUVDraftsSyncUiState({ syncing: false, page: 0 });
      clearMarkAllState();
    } else {
      persistSyncUiState();
      persistMarkAllState();
      updateMarkAllProgressUI();
    }
    closeDraftWorkspacePicker();
    if (uvDraftsComposerEl) {
      const statusEl = uvDraftsComposerEl.querySelector('[data-uvd-compose-status="1"]');
      setComposerSource(null, statusEl);
    }
    if (uvDraftsComposerFirstFrame?.object_url) {
      try { URL.revokeObjectURL(uvDraftsComposerFirstFrame.object_url); } catch {}
      uvDraftsComposerFirstFrame = null;
    }
    if (uvDraftsPageEl) {
      uvDraftsPageEl.style.display = 'none';
    }
  }
    function setCapturedAuthToken(token) {
      const nextToken = typeof token === 'string' && token ? token : null;
      const gainedToken = !capturedAuthToken && !!nextToken;
      capturedAuthToken = nextToken;
      if (!gainedToken) return;

      if (uvDraftsMarkAllState?.active) {
        resumePersistedMarkAllProgress({ queue: true });
      }
      if (uvDraftsPageEl && uvDraftsPageEl.style.display !== 'none') {
        initUVDraftsPage();
      }

      // Fetch models and styles for composer once authenticated
      fetchComposerModels();
      fetchComposerStyles();
    }

    function setModelOverride(value) {
      const normalized = normalizeComposerModel(value);
      if (normalized) {
        modelOverride = normalized;
        return;
      }
      modelOverride = typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function getModelOverride() {
      return modelOverride;
    }

    function getDocumentTitle() {
      return getUVDraftsDocumentTitle(uvDraftsWorkspaceFilter, getWorkspaceNameById, location.pathname);
    }

    return {
      ensureUVDraftsPage,
      hideUVDraftsPage,
      startScheduledPostsTimer,
      checkPendingComposePrompt,
      loadPendingCreateOverrides,
      clearPendingCreateOverrides,
      applyComposerOverridesToCreateBody,
      setCapturedAuthToken,
      setModelOverride,
      getModelOverride,
      getDocumentTitle,
    };
  }

  globalScope.SoraUVDraftsPageModule = createSoraUVDraftsPageModule;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createSoraUVDraftsPageModule;
    module.exports.__test = {
      getComposerModelFamily,
      resolveComposerModelValue,
      buildPublicPostPayload,
      extractPublishedPost,
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
      getDraftOrientationForLayout,
      getDraftCardPaddingTop,
      getDraftCardLayoutStyle,
      shouldGroupLandscapeDraftCard,
      getLandscapeRunChunkPlan,
      planLandscapeRunChunks,
      planDraftGridRows,
      extendDraftRenderEndToRowBoundary,
      extendLandscapeRunRenderEnd,
      isGenerationDraftId,
      extractErrorMessage,
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
