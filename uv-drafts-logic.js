/*
 * Shared UV Drafts logic for runtime + tests.
 */
(function initUVDraftsLogic(globalScope) {
  'use strict';

  const VIEW_FILTER_VALUES = new Set(['all', 'bookmarked', 'hidden', 'violations', 'new', 'unsynced']);
  const COMPOSER_SOURCE_REQUIRED_MODES = new Set(['remix', 'extend']);
  const GENS_COUNT_MIN = 1;
  const GENS_COUNT_MAX_DEFAULT = 10;
  const GENS_COUNT_MAX_ULTRA = 40;
  const DEFAULT_PROMPT_QUEUE_MAX = 20;
  const ACTIVE_PENDING_STATUSES = new Set([
    'pending',
    'queued',
    'queueing',
    'enqueued',
    'running',
    'processing',
    'preprocessing',
    'in_progress',
    'in-progress',
    'starting',
    'submitted',
    'waiting',
    'retrying',
  ]);
  const SEARCH_FILTER_KEYS = new Set([
    'id',
    'task',
    'ws',
    'workspace',
    'model',
    'ori',
    'orientation',
    'kind',
    'tag',
    'title',
    'prompt',
    'dur',
    'duration',
    'new',
    'hidden',
    'bookmarked',
    'resolution',
    'style',
    'seed',
  ]);
  const DEFAULT_VIEW_STATE = Object.freeze({
    filterState: 'all',
    workspaceFilter: null,
    searchQuery: '',
  });

  function toDraftId(value) {
    if (value == null) return '';
    return String(value);
  }

  function getDraftPreviewText(draft, maxLen) {
    const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 60;
    const source = (draft && (draft.prompt || draft.title)) ? String(draft.prompt || draft.title) : 'Untitled';
    if (source.length <= limit) return source;
    return source.slice(0, limit) + '...';
  }

  function mergeDraftListById(primaryDrafts, secondaryDrafts) {
    const merged = [];
    const seen = new Set();

    const pushUnique = (draft) => {
      const id = toDraftId(draft && draft.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(draft);
    };

    for (const draft of Array.isArray(primaryDrafts) ? primaryDrafts : []) pushUnique(draft);
    for (const draft of Array.isArray(secondaryDrafts) ? secondaryDrafts : []) pushUnique(draft);
    return merged;
  }

  function appendUniqueDrafts(existingDrafts, incomingDrafts) {
    const out = Array.isArray(existingDrafts) ? [...existingDrafts] : [];
    const seen = new Set(out.map((d) => toDraftId(d && d.id)).filter(Boolean));

    for (const draft of Array.isArray(incomingDrafts) ? incomingDrafts : []) {
      const id = toDraftId(draft && draft.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(draft);
    }
    return out;
  }

  function removeDraftById(drafts, draftId) {
    const id = toDraftId(draftId);
    if (!id || !Array.isArray(drafts)) return Array.isArray(drafts) ? [...drafts] : [];
    return drafts.filter((draft) => toDraftId(draft && draft.id) !== id);
  }

  function normalizeSet(values) {
    if (values instanceof Set) return values;
    if (Array.isArray(values)) return new Set(values.map((v) => toDraftId(v)).filter(Boolean));
    return new Set();
  }

  function tokenizeSearchQuery(query) {
    const text = typeof query === 'string' ? query : '';
    const tokens = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"' && text[i - 1] !== '\\') {
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
    return tokens;
  }

  function parseSearchQuery(query) {
    const out = { terms: [], filters: [] };
    const tokens = tokenizeSearchQuery(query);
    for (const token of tokens) {
      const cleanedToken = String(token || '').trim().replace(/[;,]+$/g, '');
      if (!cleanedToken) continue;
      const separator = cleanedToken.indexOf(':');
      if (separator > 0) {
        const key = cleanedToken.slice(0, separator).trim().toLowerCase();
        const value = cleanedToken.slice(separator + 1).trim().replace(/[;,]+$/g, '');
        if (value && SEARCH_FILTER_KEYS.has(key)) {
          out.filters.push({ key, value });
          continue;
        }
      }
      const normalized = cleanedToken.toLowerCase();
      if (normalized) out.terms.push(normalized);
    }
    return out;
  }

  function parseBooleanFilterValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'n') return false;
    return null;
  }

  function draftKindKey(draft) {
    return String(draft && draft.kind || '').trim().toLowerCase();
  }

  function draftStatusKey(draft) {
    return String(
      draft && (draft.status || draft.pending_status || draft.pending_task_status) || ''
    ).trim().toLowerCase();
  }

  function draftReasonText(draft) {
    const value = draft && draft.violation_reason;
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

  function isKindProcessingError(kind) {
    return kind === 'sora_processing_error' ||
      kind === 'processing_error' ||
      kind.includes('processing_error') ||
      kind.includes('processing_failed') ||
      kind.includes('generation_error') ||
      kind.endsWith('_error');
  }

  function isKindContextViolation(kind) {
    return kind === 'sora_context_violation' ||
      kind === 'context_violation' ||
      kind.includes('context_violation');
  }

  function isKindContentViolation(kind) {
    return kind === 'sora_content_violation' ||
      kind.includes('content_violation') ||
      kind.includes('policy_violation') ||
      kind.includes('moderation_violation') ||
      kind.includes('safety_violation');
  }

  function isStatusProcessingError(status) {
    return status === 'processing_error' ||
      status.includes('processing_error') ||
      status.includes('processing_failed') ||
      status.includes('generation_error') ||
      status.endsWith('_error') ||
      status === 'failed' ||
      status.endsWith('_failed');
  }

  function isStatusContextViolation(status) {
    return status === 'context_violation' ||
      status === 'sora_context_violation' ||
      status.includes('context_violation');
  }

  function isStatusContentViolation(status) {
    return status === 'content_violation' ||
      status === 'sora_content_violation' ||
      status.includes('content_violation') ||
      status.includes('policy_violation') ||
      status.includes('moderation_violation') ||
      status.includes('safety_violation');
  }

  function isReasonLikelyContentViolation(reason) {
    if (!reason) return false;
    const hasContentSignals = /(content|policy|moderation|safety|blocked|violat|disallow)/i.test(reason);
    const hasInfraSignals = /(processing|generation|internal error|timeout|network|retry|server error|failed)/i.test(reason);
    return hasContentSignals && !hasInfraSignals;
  }

  function isDraftAlwaysOld(draft) {
    const data = draft || {};
    const kind = draftKindKey(data);
    if (isKindContentViolation(kind) || isKindContextViolation(kind) || isKindProcessingError(kind)) {
      return true;
    }
    const status = draftStatusKey(data);
    if (isStatusContentViolation(status) || isStatusContextViolation(status) || isStatusProcessingError(status)) {
      return true;
    }

    const reason = draftReasonText(data);
    if (isReasonLikelyContentViolation(reason)) return true;

    const hasErrorDetails = !!reason;
    const hasMedia = !!String(data.preview_url || '').trim() || !!String(data.thumbnail_url || '').trim();
    if (hasErrorDetails && !hasMedia) return true;
    return false;
  }

  function isDraftUnread(draft) {
    return !isDraftAlwaysOld(draft) && draft && draft.is_read === false;
  }

  function looksLikePendingV2Task(item) {
    if (!item || typeof item !== 'object') return false;
    if (!Array.isArray(item.generations)) return false;
    const id = toDraftId(item.id);
    return !!id;
  }

  function normalizePendingStatus(status) {
    const raw = String(status || '').trim();
    if (!raw) return 'pending';
    return raw.toLowerCase();
  }

  function isPendingLikeStatus(status) {
    return ACTIVE_PENDING_STATUSES.has(normalizePendingStatus(status));
  }

  function resolvePendingGenerationId(generation, taskId, index) {
    const direct = toDraftId(
      generation && (generation.id || generation.generation_id || generation.draft_id)
    );
    if (direct) return direct;
    const task = toDraftId(taskId);
    if (!task) return '';
    const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
    return `${task}:pending:${safeIndex}`;
  }

  function flattenPendingV2Payload(payload) {
    const sourceItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.items)
        ? payload.items
        : Array.isArray(payload && payload.data && payload.data.items)
          ? payload.data.items
          : [];
    if (!Array.isArray(sourceItems) || sourceItems.length === 0) return [];

    const hasTaskShape = sourceItems.some(looksLikePendingV2Task);
    const out = [];

    if (hasTaskShape) {
      for (const task of sourceItems) {
        if (!looksLikePendingV2Task(task)) continue;
        const taskId = toDraftId(task.id);
        const taskPrompt = typeof task.prompt === 'string' ? task.prompt : '';
        const taskStatus = normalizePendingStatus(task.status);
        const generations = Array.isArray(task.generations) ? task.generations : [];

        // Early stages (preprocessing, queued, etc.) have empty generations — use task itself
        if (generations.length === 0) {
          if (!taskId) continue;
          const copy = { ...task, id: taskId };
          copy.task_id = taskId;
          if (!copy.prompt && taskPrompt) copy.prompt = taskPrompt;
          const baseCreationConfig = copy.creation_config && typeof copy.creation_config === 'object'
            ? { ...copy.creation_config }
            : {};
          if (!baseCreationConfig.prompt && taskPrompt) baseCreationConfig.prompt = taskPrompt;
          copy.creation_config = baseCreationConfig;
          copy.pending_status = taskStatus;
          copy.pending_task_status = taskStatus;
          copy.is_pending = true;
          out.push(copy);
          continue;
        }

        for (let i = 0; i < generations.length; i += 1) {
          const generation = generations[i];
          if (!generation || typeof generation !== 'object') continue;
          const pendingStatus = normalizePendingStatus(generation.status || taskStatus);
          if (!isPendingLikeStatus(pendingStatus)) continue;
          const id = resolvePendingGenerationId(generation, taskId, i);
          if (!id) continue;

          const copy = { ...generation, id };
          if (!copy.task_id && taskId) copy.task_id = taskId;
          if (!copy.prompt && taskPrompt) copy.prompt = taskPrompt;
          const baseCreationConfig = copy.creation_config && typeof copy.creation_config === 'object'
            ? { ...copy.creation_config }
            : {};
          if (!baseCreationConfig.prompt && taskPrompt) baseCreationConfig.prompt = taskPrompt;
          copy.creation_config = baseCreationConfig;
          copy.pending_status = pendingStatus;
          copy.pending_task_status = taskStatus;
          copy.is_pending = true;
          out.push(copy);
        }
      }
      return out;
    }

    for (const item of sourceItems) {
      if (!item || typeof item !== 'object') continue;
      const pendingStatus = normalizePendingStatus(item.status);
      if (!isPendingLikeStatus(pendingStatus)) continue;
      const id = resolvePendingGenerationId(item, '', 0);
      if (!id) continue;
      out.push({
        ...item,
        id,
        pending_status: pendingStatus,
        is_pending: true,
      });
    }

    return out;
  }

  function getDroppedIds(previousIds, nextIds) {
    const prev = normalizeSet(previousIds);
    const next = normalizeSet(nextIds);
    const dropped = [];
    for (const id of prev) {
      if (!next.has(id)) dropped.push(id);
    }
    return dropped;
  }

  function modeRequiresComposerSource(mode) {
    if (typeof mode !== 'string') return false;
    return COMPOSER_SOURCE_REQUIRED_MODES.has(mode.trim().toLowerCase());
  }

  function getGensCountMax(ultraModeEnabled) {
    return ultraModeEnabled ? GENS_COUNT_MAX_ULTRA : GENS_COUNT_MAX_DEFAULT;
  }

  function clampGensCount(value, ultraModeEnabled) {
    const n = Number(value);
    if (!Number.isFinite(n)) return GENS_COUNT_MIN;
    const max = getGensCountMax(!!ultraModeEnabled);
    return Math.min(max, Math.max(GENS_COUNT_MIN, Math.round(n)));
  }

  function matchesDurationFilter(durationSeconds, value) {
    const duration = Number(durationSeconds || 0);
    const match = String(value || '').trim().match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)(?:s|sec|secs|seconds?)?$/i);
    if (!match) return false;
    const op = match[1] || '=';
    const target = Number(match[2]);
    if (!Number.isFinite(target)) return false;
    if (op === '>') return duration > target;
    if (op === '<') return duration < target;
    if (op === '>=') return duration >= target;
    if (op === '<=') return duration <= target;
    return Math.abs(duration - target) < 0.01;
  }

  function isPublicVisibility(value) {
    return String(value || '').trim().toLowerCase() === 'public';
  }

  function isDraftPubliclyPosted(draft) {
    const data = draft || {};
    if (isPublicVisibility(data.post_visibility)) return true;
    if (data.posted_to_public === true) return true;

    const postMeta = data.post_meta && typeof data.post_meta === 'object' ? data.post_meta : null;
    if (postMeta) {
      if (postMeta.posted_to_public === true) return true;
      if (isPublicVisibility(postMeta.visibility)) return true;
    }

    const post = data.post && typeof data.post === 'object' ? data.post : null;
    if (post) {
      if (post.posted_to_public === true) return true;
      if (isPublicVisibility(post.visibility)) return true;
    }

    return false;
  }

  function normalizeSoraPostUrl(urlValue, origin) {
    const raw = typeof urlValue === 'string' ? urlValue.trim() : '';
    if (!raw) return '';
    const base = typeof origin === 'string' && origin.trim() ? origin.trim().replace(/\/$/, '') : 'https://sora.chatgpt.com';
    try {
      const parsed = new URL(raw, base);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      if (!/\/p\//i.test(parsed.pathname)) return '';
      return `${base}${parsed.pathname}${parsed.search}`;
    } catch {
      return '';
    }
  }

  function getDraftPostUrl(draft, origin) {
    const data = draft || {};
    const postMeta = data.post_meta && typeof data.post_meta === 'object' ? data.post_meta : null;
    const post = data.post && typeof data.post === 'object' ? data.post : null;

    const direct = normalizeSoraPostUrl(
      data.post_permalink || postMeta?.permalink || post?.permalink || '',
      origin
    );
    if (direct) return direct;

    const postId = String(
      data.post_id || postMeta?.id || post?.id || postMeta?.share_ref || post?.share_ref || ''
    ).trim();
    if (!postId) return '';
    const base = typeof origin === 'string' && origin.trim() ? origin.trim().replace(/\/$/, '') : 'https://sora.chatgpt.com';
    return `${base}/p/${encodeURIComponent(postId)}`;
  }

  function normalizeDraftRemixPostId(value) {
    if (value == null) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^s_[A-Za-z0-9_-]+$/i.test(raw)) return raw;
    try {
      const parsed = new URL(raw, 'https://sora.chatgpt.com');
      const m = parsed.pathname.match(/\/p\/(s_[A-Za-z0-9_-]+)/i);
      return m ? m[1] : '';
    } catch {
      const m = raw.match(/\/p\/(s_[A-Za-z0-9_-]+)/i);
      return m ? m[1] : '';
    }
  }

  function normalizeDraftRemixDraftId(value) {
    if (value == null) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, 'https://sora.chatgpt.com');
      const m = parsed.pathname.match(/\/d\/([A-Za-z0-9_-]+)/i);
      if (m) return m[1];
    } catch {
      const m = raw.match(/\/d\/([A-Za-z0-9_-]+)/i);
      if (m) return m[1];
    }
    if (/^[A-Za-z0-9_-]+$/i.test(raw)) return raw;
    return '';
  }

  function getDraftRemixSource(draft) {
    const data = draft && typeof draft === 'object' ? draft : {};
    const creationConfig = data.creation_config && typeof data.creation_config === 'object'
      ? data.creation_config
      : {};

    const postSourceCandidates = [
      data.remix_target_post_id,
      creationConfig?.remix_target_post?.id,
      creationConfig?.remix_target_post?.post?.id,
      data.source_post_id,
      creationConfig?.source_post_id,
    ];
    for (const candidate of postSourceCandidates) {
      const sourcePostId = normalizeDraftRemixPostId(candidate);
      if (!sourcePostId) continue;
      return {
        isRemix: true,
        sourceType: 'post',
        sourceId: sourcePostId,
        sourcePostId,
        sourceDraftId: '',
      };
    }

    const draftSourceCandidates = [
      data.remix_target_draft_id,
      creationConfig?.remix_target_draft?.id,
      creationConfig?.remix_target_draft?.draft?.id,
      creationConfig?.source_draft_id,
      data.source_draft_id,
    ];
    for (const candidate of draftSourceCandidates) {
      const sourceDraftId = normalizeDraftRemixDraftId(candidate);
      if (!sourceDraftId) continue;
      return {
        isRemix: true,
        sourceType: 'draft',
        sourceId: sourceDraftId,
        sourcePostId: '',
        sourceDraftId,
      };
    }

    const remixSignalCandidates = [
      data.is_remix,
      creationConfig?.is_remix,
      creationConfig?.mode,
      data.remix_target_post_id,
      data.remix_target_draft_id,
      data.source_post_id,
      data.source_draft_id,
      creationConfig?.remix_target_post,
      creationConfig?.remix_target_draft,
      creationConfig?.source_post_id,
      creationConfig?.source_draft_id,
    ];
    const isRemix = remixSignalCandidates.some((value) => {
      if (value === true) return true;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'remix' || normalized === 'true';
      }
      if (value && typeof value === 'object') return true;
      return false;
    });

    return {
      isRemix,
      sourceType: '',
      sourceId: '',
      sourcePostId: '',
      sourceDraftId: '',
    };
  }

  function canTrimDraft(draft) {
    const data = draft || {};
    if (!data.id) return false;
    if (String(data.storyboard_id || '').trim()) return true;
    return data.can_storyboard !== false;
  }

  function getDraftTrimUrl(draft, origin) {
    const data = draft || {};
    if (!canTrimDraft(data)) return '';
    const base = typeof origin === 'string' && origin.trim() ? origin.trim().replace(/\/$/, '') : 'https://sora.chatgpt.com';
    const storyboardId = String(data.storyboard_id || '').trim();
    if (storyboardId) return `${base}/storyboard/${encodeURIComponent(storyboardId)}`;
    return `${base}/d/${encodeURIComponent(String(data.id || ''))}`;
  }

  function buildDraftSearchBlob(draft, workspaceName) {
    const data = draft || {};
    const cameos = Array.isArray(data.cameo_profiles)
      ? data.cameo_profiles.map((profile) => {
          if (typeof profile === 'string') return profile;
          if (profile && typeof profile.username === 'string') return profile.username;
          return '';
        }).filter(Boolean).join(' ')
      : '';
    const tags = Array.isArray(data.tags) ? data.tags.join(' ') : '';
    const parts = [
      data.id,
      data.task_id,
      data.prompt,
      data.title,
      data.kind,
      data.generation_type,
      data.orientation,
      data.model,
      data.resolution,
      data.style,
      data.seed,
      data.duration_seconds,
      workspaceName || '',
      cameos,
      tags,
    ];
    return parts.filter((part) => part != null && part !== '').map((part) => String(part)).join(' ').toLowerCase();
  }

  function matchesDraftSearchFilters(draft, parsed, options) {
    const filters = parsed && Array.isArray(parsed.filters) ? parsed.filters : [];
    if (!filters.length) return true;
    const data = draft || {};
    const bookmarks = normalizeSet(options && (options.bookmarks || options.bookmarksSet));
    const resolveWorkspaceName = options && typeof options.resolveWorkspaceName === 'function'
      ? options.resolveWorkspaceName
      : () => (options && options.workspaceName ? String(options.workspaceName) : '');
    const workspaceName = String(resolveWorkspaceName(data.workspace_id) || '').toLowerCase();
    const workspaceId = String(data.workspace_id || '').toLowerCase();

    for (const filter of filters) {
      const key = String(filter && filter.key || '').toLowerCase();
      const valueRaw = String(filter && filter.value || '').trim();
      const value = valueRaw.toLowerCase();

      if (key === 'id' && !String(data.id || '').toLowerCase().includes(value)) return false;
      if (key === 'task' && !String(data.task_id || '').toLowerCase().includes(value)) return false;
      if ((key === 'ws' || key === 'workspace') && !workspaceName.includes(value) && !workspaceId.includes(value)) return false;
      if (key === 'model' && !String(data.model || '').toLowerCase().includes(value)) return false;
      if ((key === 'ori' || key === 'orientation') && !String(data.orientation || '').toLowerCase().includes(value)) return false;
      if (key === 'kind' && !String(data.kind || '').toLowerCase().includes(value)) return false;
      if (key === 'tag' && !(Array.isArray(data.tags) ? data.tags : []).some((tag) => String(tag || '').toLowerCase().includes(value))) return false;
      if (key === 'title' && !String(data.title || '').toLowerCase().includes(value)) return false;
      if (key === 'prompt' && !String(data.prompt || '').toLowerCase().includes(value)) return false;
      if ((key === 'dur' || key === 'duration') && !matchesDurationFilter(data.duration_seconds, valueRaw)) return false;
      if (key === 'resolution' && !String(data.resolution || '').toLowerCase().includes(value)) return false;
      if (key === 'style' && !String(data.style || '').toLowerCase().includes(value)) return false;
      if (key === 'seed' && !String(data.seed || '').toLowerCase().includes(value)) return false;
      if (key === 'new') {
        const wanted = parseBooleanFilterValue(valueRaw);
        if (wanted == null) return false;
        if (isDraftUnread(data) !== wanted) return false;
      }
      if (key === 'hidden') {
        const wanted = parseBooleanFilterValue(valueRaw);
        if (wanted == null) return false;
        if (Boolean(data.hidden) !== wanted) return false;
      }
      if (key === 'bookmarked') {
        const wanted = parseBooleanFilterValue(valueRaw);
        if (wanted == null) return false;
        if (bookmarks.has(toDraftId(data.id)) !== wanted) return false;
      }
    }
    return true;
  }

  function draftMatchesSearchQuery(draft, parsed, options) {
    const parsedQuery = parsed && typeof parsed === 'object' ? parsed : parseSearchQuery('');
    if (!matchesDraftSearchFilters(draft, parsedQuery, options)) return false;
    if (!Array.isArray(parsedQuery.terms) || parsedQuery.terms.length === 0) return true;
    const resolveWorkspaceName = options && typeof options.resolveWorkspaceName === 'function'
      ? options.resolveWorkspaceName
      : () => (options && options.workspaceName ? String(options.workspaceName) : '');
    const workspaceName = resolveWorkspaceName(draft && draft.workspace_id);
    const blob = buildDraftSearchBlob(draft, workspaceName);
    return parsedQuery.terms.every((term) => blob.includes(String(term || '').toLowerCase()));
  }

  function normalizeCreateOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object') return null;
    const out = {};
    const assignTrimmed = (key) => {
      const value = overrides[key];
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      out[key] = trimmed;
    };

    assignTrimmed('prompt');
    assignTrimmed('model');
    assignTrimmed('orientation');
    assignTrimmed('size');
    assignTrimmed('style_id');
    assignTrimmed('mode');

    if (typeof overrides.seed === 'string') {
      const seed = overrides.seed.replace(/[^\d]/g, '').slice(0, 10);
      if (seed) out.seed = seed;
    }
    const durationSeconds = Number(overrides.durationSeconds);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      out.durationSeconds = Math.floor(durationSeconds);
    }
    const nFrames = Number(overrides.nFrames);
    if (Number.isFinite(nFrames) && nFrames > 0) {
      out.nFrames = Math.floor(nFrames);
    }
    return Object.keys(out).length ? out : null;
  }

  function applyCreateBodyOverrides(bodyString, overrides) {
    if (typeof bodyString !== 'string') return bodyString;
    const normalized = normalizeCreateOverrides(overrides);
    if (!normalized) return bodyString;

    const applyToObject = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      let changed = false;
      if (!obj.creation_config || typeof obj.creation_config !== 'object') {
        obj.creation_config = {};
        changed = true;
      }
      const creationConfig = obj.creation_config;

      if (normalized.prompt) {
        if (obj.prompt !== normalized.prompt) {
          obj.prompt = normalized.prompt;
          changed = true;
        }
        if (creationConfig.prompt !== normalized.prompt) {
          creationConfig.prompt = normalized.prompt;
          changed = true;
        }
      }

      if (normalized.model) {
        if (obj.model !== normalized.model) {
          obj.model = normalized.model;
          changed = true;
        }
        if (creationConfig.model !== normalized.model) {
          creationConfig.model = normalized.model;
          changed = true;
        }
      }

      if (normalized.orientation && creationConfig.orientation !== normalized.orientation) {
        creationConfig.orientation = normalized.orientation;
        changed = true;
      }

      if (normalized.size) {
        if (obj.size !== normalized.size) {
          obj.size = normalized.size;
          changed = true;
        }
        if (creationConfig.size !== normalized.size) {
          creationConfig.size = normalized.size;
          changed = true;
        }
      }

      if (normalized.style_id && creationConfig.style_id !== normalized.style_id) {
        creationConfig.style_id = normalized.style_id;
        changed = true;
      }

      if (normalized.seed && creationConfig.seed !== normalized.seed) {
        creationConfig.seed = normalized.seed;
        changed = true;
      }

      if (Number.isFinite(normalized.durationSeconds) && normalized.durationSeconds > 0) {
        if (creationConfig.duration_seconds !== normalized.durationSeconds) {
          creationConfig.duration_seconds = normalized.durationSeconds;
          changed = true;
        }
        if (obj.duration_seconds !== normalized.durationSeconds) {
          obj.duration_seconds = normalized.durationSeconds;
          changed = true;
        }
      }

      if (Number.isFinite(normalized.nFrames) && normalized.nFrames > 0) {
        if (creationConfig.n_frames !== normalized.nFrames) {
          creationConfig.n_frames = normalized.nFrames;
          changed = true;
        }
        if (obj.n_frames !== normalized.nFrames) {
          obj.n_frames = normalized.nFrames;
          changed = true;
        }
      }

      if (normalized.mode && obj.mode !== normalized.mode) {
        obj.mode = normalized.mode;
        changed = true;
      }

      return changed;
    };

    try {
      const parsed = JSON.parse(bodyString);
      let changed = applyToObject(parsed);

      if (typeof parsed.body === 'string') {
        try {
          const inner = JSON.parse(parsed.body);
          if (applyToObject(inner)) {
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

  function normalizeQueuePrompt(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  function parsePromptJsonl(text, options) {
    const raw = typeof text === 'string' ? text : '';
    const providedMax = Number(options && options.maxPrompts);
    const maxPrompts = Number.isFinite(providedMax) && providedMax > 0
      ? Math.floor(providedMax)
      : DEFAULT_PROMPT_QUEUE_MAX;
    const lines = raw.split(/\r?\n/);
    const prompts = [];
    const errors = [];
    let invalidCount = 0;
    let truncatedCount = 0;
    let nonEmptyLines = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const lineNumber = i + 1;
      const line = String(lines[i] || '');
      if (!line.trim()) continue;
      nonEmptyLines += 1;

      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        invalidCount += 1;
        errors.push({ line: lineNumber, reason: 'Invalid JSON' });
        continue;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        invalidCount += 1;
        errors.push({ line: lineNumber, reason: 'Line must be a JSON object' });
        continue;
      }

      const prompt = normalizeQueuePrompt(parsed.prompt);
      if (!prompt) {
        invalidCount += 1;
        errors.push({ line: lineNumber, reason: 'Missing non-empty "prompt" string' });
        continue;
      }

      if (prompts.length >= maxPrompts) {
        truncatedCount += 1;
        continue;
      }
      prompts.push(prompt);
    }

    return {
      maxPrompts,
      prompts,
      acceptedCount: prompts.length,
      invalidCount,
      truncatedCount,
      nonEmptyLines,
      errors,
    };
  }

  function normalizePromptQueueState(raw) {
    const promptsRaw = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw && raw.prompts) ? raw.prompts : []);
    const prompts = [];
    for (const value of promptsRaw) {
      const prompt = normalizeQueuePrompt(value);
      if (!prompt) continue;
      prompts.push(prompt);
    }

    const total = prompts.length;
    const rawIndex = Number(raw && raw.index);
    let index = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
    if (index < 0) index = 0;
    if (index > total) index = total;

    const createdAtRaw = Number(raw && raw.createdAt);
    const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0
      ? Math.floor(createdAtRaw)
      : Date.now();
    const rawSelectedIndex = Number(raw && raw.selectedIndex);
    const selectedDefault = total > 0 ? Math.min(index, total - 1) : 0;
    let selectedIndex = Number.isFinite(rawSelectedIndex)
      ? Math.floor(rawSelectedIndex)
      : selectedDefault;
    if (total <= 0) {
      selectedIndex = 0;
    } else {
      if (selectedIndex < 0) selectedIndex = 0;
      if (selectedIndex > total - 1) selectedIndex = total - 1;
    }
    const remaining = Math.max(0, total - index);

    return {
      prompts,
      index,
      selectedIndex,
      total,
      remaining,
      createdAt,
      exhausted: remaining === 0,
    };
  }

  function peekCurrentPrompt(queueState) {
    const current = normalizePromptQueueState(queueState);
    const prompt = current.remaining > 0
      ? String(current.prompts[current.index] || '')
      : '';
    return {
      prompt,
      index: current.index,
      queue: current,
      remaining: current.remaining,
      hasPrompt: !!prompt,
    };
  }

  function advancePromptQueue(queueState) {
    const current = normalizePromptQueueState(queueState);
    if (current.remaining <= 0) {
      return {
        prompt: '',
        queue: current,
        consumed: false,
        remaining: 0,
      };
    }

    const prompt = current.prompts[current.index];
    const queue = normalizePromptQueueState({
      prompts: current.prompts,
      index: current.index + 1,
      selectedIndex: current.selectedIndex,
      createdAt: current.createdAt,
    });

    return {
      prompt,
      queue,
      consumed: true,
      remaining: queue.remaining,
    };
  }

  function setPromptQueueSelection(queueState, nextSelectedIndex) {
    const current = normalizePromptQueueState(queueState);
    if (current.total <= 0) return current;
    const raw = Number(nextSelectedIndex);
    let selectedIndex = Number.isFinite(raw)
      ? Math.floor(raw)
      : current.selectedIndex;
    if (selectedIndex < 0) selectedIndex = 0;
    if (selectedIndex > current.total - 1) selectedIndex = current.total - 1;
    return normalizePromptQueueState({
      prompts: current.prompts,
      index: current.index,
      selectedIndex,
      createdAt: current.createdAt,
    });
  }

  function removePromptAtIndex(queueState, removeIndex) {
    const current = normalizePromptQueueState(queueState);
    if (current.total <= 0) return current;
    const raw = Number(removeIndex);
    if (!Number.isFinite(raw)) return current;
    const targetIndex = Math.floor(raw);
    if (targetIndex < 0 || targetIndex >= current.total) return current;

    const prompts = current.prompts.filter((_, idx) => idx !== targetIndex);
    let index = current.index;
    if (targetIndex < current.index) {
      index -= 1;
    } else if (targetIndex === current.index && index >= prompts.length) {
      index = prompts.length;
    }
    if (index < 0) index = 0;
    if (index > prompts.length) index = prompts.length;

    let selectedIndex = current.selectedIndex;
    if (targetIndex < selectedIndex) {
      selectedIndex -= 1;
    } else if (targetIndex === selectedIndex) {
      selectedIndex = Math.min(selectedIndex, Math.max(0, prompts.length - 1));
    }
    if (prompts.length <= 0) selectedIndex = 0;

    return normalizePromptQueueState({
      prompts,
      index,
      selectedIndex,
      createdAt: current.createdAt,
    });
  }

  function consumeNextPrompt(queueState) {
    return advancePromptQueue(queueState);
  }

  function normalizeViewState(raw) {
    const out = {
      filterState: DEFAULT_VIEW_STATE.filterState,
      workspaceFilter: DEFAULT_VIEW_STATE.workspaceFilter,
      searchQuery: DEFAULT_VIEW_STATE.searchQuery,
    };
    if (!raw || typeof raw !== 'object') return out;

    if (typeof raw.filterState === 'string' && VIEW_FILTER_VALUES.has(raw.filterState)) {
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

  function computeDraftStats(drafts, bookmarkedIds, justSeenIds) {
    const data = Array.isArray(drafts) ? drafts : [];
    const bookmarks = normalizeSet(bookmarkedIds);
    const justSeen = normalizeSet(justSeenIds);

    let hidden = 0;
    let newCount = 0;
    let bookmarked = 0;

    for (const draft of data) {
      const id = toDraftId(draft && draft.id);
      if (!id) continue;
      if (draft && draft.hidden) hidden += 1;
      if (draft && draft.is_unsynced !== true && isDraftUnread(draft) && !justSeen.has(id)) newCount += 1;
      if (bookmarks.has(id)) bookmarked += 1;
    }

    return {
      total: data.length,
      bookmarked,
      hidden,
      newCount,
    };
  }

  const api = {
    DEFAULT_VIEW_STATE,
    GENS_COUNT_MIN,
    GENS_COUNT_MAX_DEFAULT,
    GENS_COUNT_MAX_ULTRA,
    DEFAULT_PROMPT_QUEUE_MAX,
    getDraftPreviewText,
    mergeDraftListById,
    appendUniqueDrafts,
    removeDraftById,
    computeDraftStats,
    normalizeViewState,
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
    isDraftAlwaysOld,
    isDraftUnread,
    getDraftRemixSource,
    looksLikePendingV2Task,
    flattenPendingV2Payload,
    getDroppedIds,
    isDraftPubliclyPosted,
    getDraftPostUrl,
    canTrimDraft,
    getDraftTrimUrl,
  };

  globalScope.SoraUVDraftsLogic = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
