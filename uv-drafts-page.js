/*
 * UV Drafts page module extracted from inject.js.
 */
(function initSoraUVDraftsPageModule(globalScope) {
  'use strict';

  function createSoraUVDraftsPageModule(deps = {}) {
    let capturedAuthToken = null;
    let modelOverride = null;

    const SORA_DEFAULT_FPS = Number(deps.defaultFps) > 0 ? Number(deps.defaultFps) : 30;
    const BOOKMARKS_KEY = 'SORA_UV_BOOKMARKS_V1';
    const GENS_COUNT_KEY = 'SCT_GENS_COUNT_V1';
    const ULTRA_MODE_KEY = 'SCT_ULTRA_MODE_V1';
    const GENS_COUNT_MIN = 1;
    const GENS_COUNT_MAX_DEFAULT = 10;
    const GENS_COUNT_MAX_ULTRA = 40;
    const COMPOSER_MODELS = [
      { value: 'sora2', label: 'Sora 2' },
      { value: 'sora2pro', label: 'Sora 2 Pro' },
    ];
    const COMPOSER_MODEL_VALUES = new Set(COMPOSER_MODELS.map((item) => item.value));

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

    function loadStoredGensCount() {
      try {
        const raw = localStorage.getItem(GENS_COUNT_KEY);
        if (!raw) return GENS_COUNT_MIN;
        const parsed = JSON.parse(raw);
        const count = parsed && typeof parsed === 'object' ? parsed.count : raw;
        return clampGensCount(count);
      } catch {
        return GENS_COUNT_MIN;
      }
    }

    function persistComposerGensCount(count) {
      try {
        localStorage.setItem(
          GENS_COUNT_KEY,
          JSON.stringify({ count: clampGensCount(count), setAt: Date.now() })
        );
      } catch {}
    }

    function normalizeComposerModel(value) {
      const normalized = typeof value === 'string' ? value.trim() : '';
      return COMPOSER_MODEL_VALUES.has(normalized) ? normalized : '';
    }

    function getDefaultComposerModel() {
      return (
        normalizeComposerModel(uvDraftsComposerState?.model) ||
        normalizeComposerModel(modelOverride) ||
        COMPOSER_MODELS[0].value
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
  async function syncRemainingDrafts(startCursor, onProgress, runId = uvDraftsInitRunId, startOrder = 0, syncedIds = null) {
    const isStaleRun = () => runId !== uvDraftsInitRunId;
    let cursor = startCursor;
    let pageNum = 1;
    let syncSucceeded = true;
    let nextOrder = Number.isFinite(Number(startOrder)) ? Math.max(0, Math.floor(Number(startOrder))) : 0;

    while (cursor) {
      if (isStaleRun()) return false;
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
    const thumbnailUrl = apiDraft.encodings?.thumbnail?.path || existingData.thumbnail_url || '';
    const previewUrl = apiDraft.encodings?.md?.path || apiDraft.url || existingData.preview_url || '';
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
      id: apiDraft.id,
      kind,
      prompt: apiDraft.prompt || '',
      title: apiDraft.title || '',
      created_at: noDate ? null : resolvedCreatedAt,
      no_date_order: noDate ? noDateOrder : null,
      api_order: apiOrder,
      width: apiDraft.width || 0,
      height: apiDraft.height || 0,
      duration_seconds: durationSeconds,
      thumbnail_url: thumbnailUrl,
      preview_url: previewUrl,
      gif_url: apiDraft.encodings?.gif?.path || '',
      download_url: apiDraft.downloadable_url || apiDraft.download_urls?.no_watermark || existingData.download_url || '',
      can_remix: apiDraft.can_remix ?? true,
      can_storyboard: apiDraft.can_storyboard ?? true,
      storyboard_id: apiDraft.storyboard_id || apiDraft.creation_config?.storyboard_id || '',
      remix_target_post_id: apiDraft.creation_config?.remix_target_post?.id || null,
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
      orientation: apiDraft.creation_config?.orientation || (apiDraft.width > apiDraft.height ? 'landscape' : 'portrait'),
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
      workspace_id: existingData.workspace_id ?? null,
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
  let uvDraftsGridEl = null;
  let uvDraftsFilterBarEl = null;
  let uvDraftsLoadingEl = null;
  let uvDraftsSearchInput = null;
  let uvDraftsFilterState = 'all'; // 'all', 'bookmarked', 'hidden', 'violations', 'new', 'unsynced'
  let uvDraftsSortState = 'newest'; // 'newest', 'oldest' (API order)
  let uvDraftsWorkspaceFilter = null; // workspace_id or null
  let uvDraftsSearchQuery = '';
  let uvDraftsData = []; // Current loaded drafts

  // Virtual scrolling state
  const UV_DRAFTS_BATCH_SIZE = 50; // Render 50 cards at a time

  // Video playback state - once user clicks play, enable hover-to-play
  let uvDraftsVideoInteracted = false;
  let uvDraftsCurrentlyPlayingVideo = null;
  let uvDraftsRenderedCount = 0;
  let uvDraftsFilteredCache = []; // Cache filtered results to avoid re-filtering on scroll
  let uvDraftsScrollHandler = null;
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
  const UV_DRAFTS_SYNC_PROGRESS_KEY = 'SORA_UV_DRAFTS_SYNC_PROGRESS_V1';
  const UV_DRAFTS_MARK_ALL_PROGRESS_KEY = 'SORA_UV_DRAFTS_MARK_ALL_PROGRESS_V1';
  const UV_DRAFTS_PROGRESS_STALE_MS = 2 * 60 * 60 * 1000;
  let uvDraftsSyncUiState = loadPersistedSyncUiState();
  let uvDraftsMarkAllState = loadPersistedMarkAllState();
  let uvDraftsPendingData = [];
  let uvDraftsPendingIds = new Set();
  let uvDraftsPendingPollTimerId = null;
  let uvDraftsPendingFailures = 0;
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
    if (!uvDraftsMarkAllButtonEl || !uvDraftsMarkAllStatusEl) return;
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
    const bookmarks = getBookmarks();
    if (uvDraftsLogic && typeof uvDraftsLogic.computeDraftStats === 'function') {
      return uvDraftsLogic.computeDraftStats(uvDraftsData, bookmarks, uvDraftsJustSeenIds);
    }
    return {
      total: uvDraftsData.length,
      bookmarked: uvDraftsData.filter((d) => bookmarks.has(d.id)).length,
      hidden: uvDraftsData.filter((d) => d.hidden).length,
      newCount: uvDraftsData.filter((d) => isDraftUnreadState(d) && !uvDraftsJustSeenIds.has(d.id)).length,
    };
  }

  const UV_DRAFTS_VIEW_STATE_KEY = 'SORA_UV_DRAFTS_VIEW_STATE_V1';
  const UV_DRAFTS_FILTER_VALUES = new Set(['all', 'bookmarked', 'hidden', 'violations', 'new', 'unsynced']);
  const UV_DRAFTS_SORT_VALUES = new Set(['newest', 'oldest']);
  let uvDraftsViewStateLoaded = false;

  function normalizeUVDraftsViewState(raw) {
    if (uvDraftsLogic && typeof uvDraftsLogic.normalizeViewState === 'function') {
      return uvDraftsLogic.normalizeViewState(raw);
    }
    const out = {
      filterState: 'all',
      sortState: 'newest',
      workspaceFilter: null,
      searchQuery: '',
    };
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.filterState === 'string' && UV_DRAFTS_FILTER_VALUES.has(raw.filterState)) {
      out.filterState = raw.filterState;
    }
    if (typeof raw.sortState === 'string') {
      const normalizedRawSortState = raw.sortState.trim().toLowerCase();
      const legacyMappedSortState =
        normalizedRawSortState === 'api' || normalizedRawSortState === 'duration'
          ? 'newest'
          : normalizedRawSortState;
      if (UV_DRAFTS_SORT_VALUES.has(legacyMappedSortState)) {
        out.sortState = legacyMappedSortState;
      }
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
      uvDraftsSortState = viewState.sortState;
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
          sortState: uvDraftsSortState,
          workspaceFilter: uvDraftsWorkspaceFilter,
          searchQuery: uvDraftsSearchQuery,
        })
      );
    } catch {}
  }

  function defaultUVDraftsComposerState() {
    return {
      prompt: '',
      model: getDefaultComposerModel(),
      durationSeconds: 10,
      gensCount: loadStoredGensCount(),
      orientation: 'portrait',
      resolution: 'standard',
      style: '',
      seed: '',
    };
  }

  function normalizeUVDraftsComposerState(raw) {
    const out = defaultUVDraftsComposerState();
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.prompt === 'string') out.prompt = raw.prompt;
    if (typeof raw.model === 'string') out.model = normalizeComposerModel(raw.model) || out.model;
    if (typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds) && raw.durationSeconds > 0) {
      out.durationSeconds = Math.min(30, Math.max(4, Math.round(raw.durationSeconds)));
    }
    if (typeof raw.gensCount === 'number' && Number.isFinite(raw.gensCount)) {
      out.gensCount = clampGensCount(raw.gensCount);
    } else if (typeof raw.gensCount === 'string' && raw.gensCount.trim()) {
      out.gensCount = clampGensCount(raw.gensCount);
    }
    if (raw.orientation === 'portrait' || raw.orientation === 'landscape' || raw.orientation === 'square') {
      out.orientation = raw.orientation;
    }
    if (raw.resolution === 'standard' || raw.resolution === 'high') {
      out.resolution = raw.resolution;
    }
    if (typeof raw.style === 'string') out.style = raw.style;
    if (typeof raw.seed === 'string') out.seed = raw.seed.replace(/[^\d]/g, '').slice(0, 10);
    return out;
  }

  function loadUVDraftsComposerState() {
    if (uvDraftsComposerState) return uvDraftsComposerState;
    try {
      const raw = JSON.parse(localStorage.getItem(UV_DRAFTS_COMPOSER_KEY) || '{}');
      uvDraftsComposerState = normalizeUVDraftsComposerState(raw);
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
    takeString('resolution');
    takeString('style');
    if (typeof overrides.seed === 'string') {
      const seed = overrides.seed.replace(/[^\d]/g, '').slice(0, 10);
      if (seed) normalized.seed = seed;
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

      if (normalized.resolution) {
        if (obj.resolution !== normalized.resolution) {
          obj.resolution = normalized.resolution;
          changed = true;
        }
        if (obj.creation_config.resolution !== normalized.resolution) {
          obj.creation_config.resolution = normalized.resolution;
          changed = true;
        }
      }

      if (normalized.style) {
        if (obj.creation_config.style !== normalized.style) {
          obj.creation_config.style = normalized.style;
          changed = true;
        }
      }

      if (normalized.seed) {
        if (obj.creation_config.seed !== normalized.seed) {
          obj.creation_config.seed = normalized.seed;
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

  async function addDraftToWorkspace(draftId, workspaceId) {
    const draft = await uvDBGet(UV_DRAFTS_STORES.drafts, draftId);
    if (draft) {
      draft.workspace_id = workspaceId;
      await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
    }

    // Update local data
    const localDraft = uvDraftsData.find(d => d.id === draftId);
    if (localDraft) {
      localDraft.workspace_id = workspaceId;
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
          await addDraftToWorkspace(draft.id, nextWorkspaceId);
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
    Object.assign(modal.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#1e1e1e',
      borderRadius: '16px',
      padding: '24px',
      minWidth: '400px',
      maxWidth: '500px',
      maxHeight: '80vh',
      overflow: 'auto',
    });

    const title = document.createElement('h2');
    title.textContent = 'Manage Workspaces';
    Object.assign(title.style, { margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600' });
    panel.appendChild(title);

    // New workspace form
    const form = document.createElement('div');
    Object.assign(form.style, { display: 'flex', gap: '8px', marginBottom: '16px' });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New workspace name...';
    Object.assign(input.style, {
      flex: '1',
      padding: '10px 12px',
      borderRadius: '8px',
      border: '1px solid #333',
      background: '#2a2a2a',
      color: '#fff',
      fontSize: '14px',
    });

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Create';
    Object.assign(addBtn.style, {
      padding: '10px 16px',
      borderRadius: '8px',
      border: 'none',
      background: '#3b82f6',
      color: '#fff',
      cursor: 'pointer',
      fontWeight: '600',
    });
    addBtn.addEventListener('click', async () => {
      if (!input.value.trim()) return;
      await createWorkspace(input.value.trim());
      input.value = '';
      renderWorkspaceList();
    });

    form.appendChild(input);
    form.appendChild(addBtn);
    panel.appendChild(form);

    // Workspace list
    const list = document.createElement('div');
    list.className = 'workspace-list';
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '8px' });

    function renderWorkspaceList() {
      list.innerHTML = '';
      for (const ws of uvWorkspaces) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px',
          background: '#2a2a2a',
          borderRadius: '8px',
        });

        const colorDot = document.createElement('div');
        Object.assign(colorDot.style, {
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: ws.color,
        });
        row.appendChild(colorDot);

        const name = document.createElement('div');
        name.textContent = ws.name;
        Object.assign(name.style, { flex: '1', fontWeight: '500' });
        row.appendChild(name);

        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑';
        Object.assign(delBtn.style, {
          background: 'none',
          border: 'none',
          color: '#ef4444',
          cursor: 'pointer',
          fontSize: '16px',
        });
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
        empty.textContent = 'No workspaces yet. Create one above!';
        Object.assign(empty.style, { color: '#888', textAlign: 'center', padding: '20px' });
        list.appendChild(empty);
      }
    }

    panel.appendChild(list);
    renderWorkspaceList();

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Done';
    Object.assign(closeBtn.style, {
      marginTop: '16px',
      width: '100%',
      padding: '12px',
      borderRadius: '8px',
      border: 'none',
      background: 'rgba(255,255,255,0.1)',
      color: '#fff',
      cursor: 'pointer',
      fontWeight: '600',
    });
    closeBtn.addEventListener('click', () => modal.remove());
    panel.appendChild(closeBtn);

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
      label: `${draft.title || draft.prompt || draft.id}`.slice(0, 90),
    };
  }

  function getComposerSourceHint(source) {
    if (!source || typeof source !== 'object') return '';
    if (source.type === 'url' && source.url) return `Source URL: ${source.url}`;
    if (source.type === 'file' && source.fileName) return `Local file: ${source.fileName} (attach manually in composer)`;
    if (source.type === 'draft' && source.id) return `Source draft: ${source.id}`;
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
      label: String(source.label || '').trim(),
    };

    const hasDraftIdentity = !!(normalized.id || normalized.storyboard_id);
    const hasPlayableMedia = !!(normalized.url || normalized.preview_url || normalized.object_url);
    const hasFileIdentity = !!(normalized.fileName || normalized.object_url);

    let valid = false;
    if (normalized.type === 'draft') valid = hasDraftIdentity || hasPlayableMedia;
    else if (normalized.type === 'url') valid = /^https?:\/\//i.test(normalized.url);
    else if (normalized.type === 'file') valid = hasFileIdentity;
    else valid = hasDraftIdentity || hasPlayableMedia || hasFileIdentity;
    if (!valid) return null;

    if (!normalized.label) {
      normalized.label = (
        normalized.title ||
        normalized.prompt ||
        normalized.fileName ||
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
      statusEl.textContent = nextSource
        ? 'Source ready. Use Remix or Extend.'
        : 'No source selected. Use Create, or drop a draft card for Remix/Extend.';
      statusEl.dataset.tone = nextSource ? 'ok' : '';
    }
  }

  function persistComposerDurationOverride(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return;
    const safeSeconds = Math.min(30, Math.max(4, Math.round(s)));
    const frames = safeSeconds * SORA_DEFAULT_FPS;
    try {
      localStorage.setItem(
        'SCT_DURATION_OVERRIDE_V1',
        JSON.stringify({ seconds: safeSeconds, frames, setAt: Date.now() })
      );
    } catch {}
  }

  function startComposerFlow(mode, statusEl) {
    const state = normalizeUVDraftsComposerState(uvDraftsComposerState || defaultUVDraftsComposerState());
    uvDraftsComposerState = state;
    persistUVDraftsComposerState();

    const prompt = state.prompt.trim();
    const style = state.style.trim();
    const seed = state.seed.trim();
    const source = uvDraftsComposerSource;

    const setStatus = (text, tone = 'info') => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.dataset.tone = tone;
    };

    const requiresSource = uvDraftsLogic?.modeRequiresComposerSource
      ? uvDraftsLogic.modeRequiresComposerSource(mode)
      : mode === 'remix' || mode === 'extend';
    if (requiresSource && !source) {
      setStatus('Drop a draft/video source first.', 'error');
      return;
    }

    const createOverrides = {
      prompt: prompt || null,
      model: normalizeComposerModel(state.model) || null,
      orientation: state.orientation || null,
      resolution: state.resolution || null,
      style: style || null,
      seed: seed || null,
      mode,
      firstFrameImage: uvDraftsComposerFirstFrame?.object_url || null,
    };
    savePendingCreateOverrides(createOverrides);
    if (state.model) modelOverride = normalizeComposerModel(state.model) || modelOverride;
    persistComposerDurationOverride(state.durationSeconds);
    persistComposerGensCount(state.gensCount);

    const sourceHint = getComposerSourceHint(source);
    const makePromptWithSource = (basePrompt, includeSource = false) => {
      const trimmed = (basePrompt || '').trim();
      if (includeSource && sourceHint) {
        return trimmed ? `${trimmed}\n\n${sourceHint}` : sourceHint;
      }
      return trimmed;
    };

    let promptForRemix = prompt || source?.prompt || source?.title || '';
    if (mode === 'extend') {
      promptForRemix = promptForRemix
        ? `Extend this video seamlessly. ${promptForRemix}`
        : 'Extend this video seamlessly with matching style, motion, and framing.';
    }

    if (mode === 'compose') {
      const composePrompt = makePromptWithSource(prompt || source?.prompt || source?.title || '', !!source && source.type !== 'draft');
      if (composePrompt) {
        sessionStorage.setItem(
          UV_PENDING_COMPOSE_KEY,
          JSON.stringify({ prompt: composePrompt, createdAt: Date.now() })
        );
      }
      setStatus('Opening native composer…', 'ok');
      window.location.href = 'https://sora.chatgpt.com/drafts';
      return;
    }

    if (mode === 'remix') {
      if (source?.id) {
        if (promptForRemix) {
          sessionStorage.setItem('SORA_UV_REDO_PROMPT', promptForRemix);
        }
        setStatus('Opening remix…', 'ok');
        window.location.href = `https://sora.chatgpt.com/d/${source.id}?remix=`;
        return;
      }
      const manualRemixPrompt = makePromptWithSource(
        promptForRemix || 'Remix this source video with high fidelity to motion and style.',
        true
      );
      if (manualRemixPrompt) {
        sessionStorage.setItem(
          UV_PENDING_COMPOSE_KEY,
          JSON.stringify({ prompt: manualRemixPrompt, createdAt: Date.now() })
        );
      }
      setStatus('Opening composer for manual remix with dropped source…', 'ok');
      window.location.href = 'https://sora.chatgpt.com/drafts';
      return;
    }

    if (mode === 'extend') {
      if (source?.storyboard_id) {
        setStatus('Opening storyboard for extension…', 'ok');
        window.location.href = `https://sora.chatgpt.com/storyboard/${source.storyboard_id}`;
      } else if (source?.id) {
        if (promptForRemix) {
          sessionStorage.setItem('SORA_UV_REDO_PROMPT', promptForRemix);
        }
        setStatus('Opening remix as fallback extend flow…', 'ok');
        window.location.href = `https://sora.chatgpt.com/d/${source.id}?remix=`;
      } else {
        const manualExtendPrompt = makePromptWithSource(promptForRemix, true);
        if (manualExtendPrompt) {
          sessionStorage.setItem(
            UV_PENDING_COMPOSE_KEY,
            JSON.stringify({ prompt: manualExtendPrompt, createdAt: Date.now() })
          );
        }
        setStatus('Opening composer for manual extend with dropped source…', 'ok');
        window.location.href = 'https://sora.chatgpt.com/drafts';
      }
    }
  }

  function buildUVDraftsComposer() {
    if (uvDraftsComposerFirstFrame?.object_url) {
      try { URL.revokeObjectURL(uvDraftsComposerFirstFrame.object_url); } catch {}
      uvDraftsComposerFirstFrame = null;
    }
    loadUVDraftsComposerState();
    const modelOptionsHtml = COMPOSER_MODELS
      .map((model) => `<option value="${model.value}">${model.label}</option>`)
      .join('');
    const composer = document.createElement('aside');
    composer.className = 'uvd-composer';
    composer.innerHTML = `
      <div class="uvd-composer-head">
        <h2>Compose</h2>
        <p>Create from prompt, or drop a draft card to remix or extend.</p>
      </div>
      <div class="uvd-dropzone" data-uvd-dropzone="1">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.45"><rect x="2" y="2" width="20" height="20" rx="2"/><polygon points="10,8 16,12 10,16"/></svg>
        <strong>Drop Source Video</strong>
        <span>Drag a draft card here to remix or extend</span>
      </div>
      <div class="uvd-compose-source-card" data-uvd-compose-source-panel="1" hidden>
        <div class="uvd-compose-source-preview" data-uvd-compose-source-preview="1"></div>
        <div class="uvd-compose-source-meta">
          <div class="uvd-compose-source-title" data-uvd-compose-source-title="1"></div>
          <div class="uvd-compose-source-subtitle" data-uvd-compose-source-subtitle="1"></div>
        </div>
        <button type="button" class="uvd-compose-source-clear" data-uvd-compose-source-clear="1">Remove</button>
      </div>
      <div class="uvd-compose-source-empty" data-uvd-compose-source-empty="1">No source selected.</div>
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
      <div class="uvd-field-grid uvd-field-grid-3">
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
            <option value="20">20s</option>
            <option value="25">25s</option>
          </select>
        </label>
        <label class="uvd-field">
          <span>Generations</span>
          <input type="number" data-uvd-compose-gens="1" min="1" step="1" />
        </label>
      </div>
      <div class="uvd-field-grid">
        <label class="uvd-field">
          <span>Orientation</span>
          <select data-uvd-compose-orientation="1">
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
            <option value="square">Square</option>
          </select>
        </label>
        <label class="uvd-field">
          <span>Resolution</span>
          <select data-uvd-compose-resolution="1">
            <option value="standard">Standard</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <div class="uvd-field-grid">
        <label class="uvd-field">
          <span>Style</span>
          <input type="text" data-uvd-compose-style="1" placeholder="cinematic, anime, gritty..." />
        </label>
        <label class="uvd-field">
          <span>Seed</span>
          <input type="text" data-uvd-compose-seed="1" placeholder="optional seed" inputmode="numeric" />
        </label>
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
    const resolutionEl = composer.querySelector('[data-uvd-compose-resolution="1"]');
    const styleEl = composer.querySelector('[data-uvd-compose-style="1"]');
    const seedEl = composer.querySelector('[data-uvd-compose-seed="1"]');
    const dropzone = composer.querySelector('[data-uvd-dropzone="1"]');
    const clearSourceBtn = composer.querySelector('[data-uvd-compose-source-clear="1"]');

    const syncGensFieldLimits = () => {
      if (!gensEl) return;
      gensEl.min = String(GENS_COUNT_MIN);
      gensEl.max = String(getGensCountMax());
      gensEl.value = String(clampGensCount(gensEl.value || uvDraftsComposerState.gensCount));
    };

    const syncStateFromFields = () => {
      uvDraftsComposerState = normalizeUVDraftsComposerState({
        prompt: promptEl.value,
        model: modelEl.value,
        durationSeconds: Number(durationEl.value),
        gensCount: clampGensCount(gensEl?.value),
        orientation: orientationEl.value,
        resolution: resolutionEl.value,
        style: styleEl.value,
        seed: seedEl.value,
      });
      persistUVDraftsComposerState();
      persistComposerGensCount(uvDraftsComposerState.gensCount);
      if (gensEl) gensEl.value = String(uvDraftsComposerState.gensCount);
    };

    promptEl.value = uvDraftsComposerState.prompt;
    modelEl.value = normalizeComposerModel(uvDraftsComposerState.model) || getDefaultComposerModel();
    if (!modelEl.value) modelEl.value = COMPOSER_MODELS[0].value;
    uvDraftsComposerState.model = modelEl.value;
    modelOverride = modelEl.value;
    durationEl.value = String(uvDraftsComposerState.durationSeconds);
    if (gensEl) gensEl.value = String(clampGensCount(uvDraftsComposerState.gensCount));
    orientationEl.value = uvDraftsComposerState.orientation;
    resolutionEl.value = uvDraftsComposerState.resolution;
    styleEl.value = uvDraftsComposerState.style;
    seedEl.value = uvDraftsComposerState.seed;
    syncGensFieldLimits();
    persistUVDraftsComposerState();
    persistComposerGensCount(uvDraftsComposerState.gensCount);

    [promptEl, modelEl, durationEl, gensEl, orientationEl, resolutionEl, styleEl, seedEl].filter(Boolean).forEach((el) => {
      el.addEventListener('input', syncStateFromFields);
      el.addEventListener('change', syncStateFromFields);
    });
    window.addEventListener('sct_ultra_mode', syncGensFieldLimits);
    window.addEventListener('storage', (event) => {
      if (event.key === ULTRA_MODE_KEY) syncGensFieldLimits();
    });

    composer.querySelector('[data-uvd-compose-create="1"]')?.addEventListener('click', () => startComposerFlow('compose', statusEl));
    composer.querySelector('[data-uvd-compose-remix="1"]')?.addEventListener('click', () => startComposerFlow('remix', statusEl));
    composer.querySelector('[data-uvd-compose-extend="1"]')?.addEventListener('click', () => startComposerFlow('extend', statusEl));
    clearSourceBtn?.addEventListener('click', () => setComposerSource(null, statusEl));

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
            label: `${parsed.title || parsed.prompt || parsed.id}`.slice(0, 90),
          });
        }
      } catch {}

      if (!source) {
        const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
        if (uri && /^https?:\/\//i.test(uri)) {
          source = normalizeComposerSource({ type: 'url', url: uri.trim(), label: uri.trim().slice(0, 90) });
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
      uvDraftsComposerFirstFrame = { object_url: objectUrl, fileName: file.name };
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
      if (id) idSet.add(id);
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
      await uvDBPutAll(UV_DRAFTS_STORES.drafts, transformed);
      if (isStaleRun()) return;
      uvDraftsData = mergeDraftListById(transformed, uvDraftsData);
      if (isUVDraftsPageVisible()) {
        renderUVDraftsGrid();
        updateUVDraftsStats();
      }
      if (firstBatch.cursor) {
        const syncSucceeded = await syncRemainingDrafts(firstBatch.cursor, null, runId, firstBatch.items.length, fullSyncIds);
        if (!syncSucceeded || isStaleRun()) return;
      }
      await archiveUnsyncedDraftsAfterFullSync(fullSyncIds, runId);
      if (isStaleRun()) return;
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

    uvDraftsPendingIds = nextIds;
    uvDraftsPendingData = pendingDrafts;
    uvDraftsPendingFailures = 0;

    if (isUVDraftsPageVisible()) {
      renderUVDraftsGrid();
    }

    if (droppedIds.length > 0) {
      await refreshTopUVDraftsFromAPI('pending_dropped');
    }
  }

  function startPendingDraftsPolling() {
    if (uvDraftsPendingPollTimerId || !capturedAuthToken) return;
    uvDraftsPendingFailures = 0;
    pollPendingDraftsOnce().catch((err) => {
      uvDraftsPendingFailures += 1;
      console.error('[UV Drafts] Initial pending poll failed:', err);
    });
    uvDraftsPendingPollTimerId = setInterval(() => {
      pollPendingDraftsOnce().catch((err) => {
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
    if (clearState) {
      uvDraftsPendingData = [];
      uvDraftsPendingIds = new Set();
      uvDraftsPendingFailures = 0;
    }
  }

  function getRenderableUVDrafts() {
    const mainDrafts = filterAndSortUVDrafts(uvDraftsData);
    if (!Array.isArray(uvDraftsPendingData) || uvDraftsPendingData.length === 0) return mainDrafts;
    const filteredPending = filterAndSortUVDrafts(uvDraftsPendingData, { skipSort: true });
    if (filteredPending.length === 0) return mainDrafts;
    return mergeDraftListById(filteredPending, mainDrafts);
  }

  function filterAndSortUVDrafts(drafts, options = {}) {
    let filtered = [...drafts];
    const bookmarks = getBookmarks();
    const skipSort = !!options?.skipSort;

    // DEBUG: bookmark diagnostics
    const _bmIds = [...bookmarks];
    const _draftIds = new Set(filtered.map(d => d?.id).filter(Boolean));
    const _bmInData = _bmIds.filter(id => _draftIds.has(id));
    const _bmMissing = _bmIds.filter(id => !_draftIds.has(id));
    const _bmUnsynced = _bmIds.filter(id => {
      const d = filtered.find(x => x?.id === id);
      return d?.is_unsynced === true;
    });
    console.log('[UV Drafts DEBUG] filterState:', uvDraftsFilterState,
      '| bookmarks in storage:', _bmIds.length,
      '| drafts in data:', filtered.length,
      '| found in data:', _bmInData.length,
      '| missing from data:', _bmMissing.length,
      '| unsynced:', _bmUnsynced.length);
    if (_bmIds.length > 0) {
      console.log('[UV Drafts DEBUG] bookmark IDs:', _bmIds);
    }
    if (_bmMissing.length > 0) {
      console.log('[UV Drafts DEBUG] missing IDs:', _bmMissing);
    }
    // Also log raw localStorage value for format check
    console.log('[UV Drafts DEBUG] raw localStorage:', localStorage.getItem(BOOKMARKS_KEY));

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

    // Apply workspace filter
    if (uvDraftsWorkspaceFilter) {
      filtered = filtered.filter(d => d.workspace_id === uvDraftsWorkspaceFilter);
    }

    // Unsynced cards are archived by default and only shown in the dedicated filter.
    // Exception: bookmarked items survive when viewing the bookmarked filter.
    if (uvDraftsFilterState === 'unsynced') {
      filtered = filtered.filter((d) => d?.is_unsynced === true);
    } else if (uvDraftsFilterState === 'bookmarked') {
      filtered = filtered.filter((d) => d?.is_unsynced !== true || bookmarks.has(d.id));
    } else {
      filtered = filtered.filter((d) => d?.is_unsynced !== true);
    }

    // Apply state filter (but always include "new" drafts when filtering by bookmarked)
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
      filtered = filtered.filter(d => d?.is_unsynced !== true && isDraftUnreadState(d) && !uvDraftsJustSeenIds.has(d.id));
    } else if (uvDraftsFilterState === 'unsynced') {
      // Already handled above.
    }
    // 'all' shows everything

    // Apply sort — purely by api_order (position in paginated API results).
    // "Newest" = API order (ascending api_order), "Oldest" = reverse.
    if (!skipSort) {
      const withOrder = filtered.map((draft, order) => ({ draft, order }));
      withOrder.sort((a, b) => {
        const aOrd = Number(a.draft?.api_order);
        const bOrd = Number(b.draft?.api_order);
        const aHas = Number.isFinite(aOrd) && aOrd >= 0;
        const bHas = Number.isFinite(bOrd) && bOrd >= 0;

        if (!aHas && !bHas) return a.order - b.order;
        if (!aHas) return 1;
        if (!bHas) return -1;

        if (uvDraftsSortState === 'oldest') {
          return (bOrd - aOrd) || (b.order - a.order);
        }
        return (aOrd - bOrd) || (a.order - b.order);
      });
      filtered = withOrder.map((entry) => entry.draft);
    }

    return filtered;
  }

  function createUVDraftCard(draft) {
    // NEW badge based on server-side is_read status (only show NEW if explicitly false, not undefined)
    const isPendingDraft = draft?.is_pending === true || String(draft?.pending_status || '').toLowerCase() === 'pending';
    const isContentViolation = isContentViolationDraft(draft);
    const isContextViolation = isContextViolationDraft(draft);
    const isProcessingError = isProcessingErrorDraft(draft);
    const isSpecialError = isContentViolation || isContextViolation || isProcessingError;
    const usePlaceholderThumb = isSpecialError || isPendingDraft;
    const isNew = isDraftUnreadState(draft) && !uvDraftsJustSeenIds.has(draft.id);
    const draftUrl = `https://sora.chatgpt.com/d/${encodeURIComponent(draft.id)}`;

    const card = document.createElement('div');
    card.className = 'uv-draft-card uvd-card';
    if (isContentViolation || isContextViolation) card.classList.add('is-violation');
    if (isProcessingError) card.classList.add('is-processing-error');
    card.dataset.draftId = draft.id;
    card.draggable = true;
    let suppressCardNavUntil = 0;
    const blockCardNavigation = (ms = 180) => {
      suppressCardNavUntil = Date.now() + ms;
    };
    const shouldIgnoreCardNavigationTarget = (target) => (
      target instanceof Element && !!target.closest(
        'a,button,input,textarea,select,video,label,[role="button"],[contenteditable="true"],.uv-play-btn,.uvd-actions-row,.uvd-actions-row2'
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
      paddingTop: draft.height > draft.width ? '177.78%' : '56.25%', // 9:16 or 16:9
      background: isPendingDraft
        ? '#182435'
        : (isContentViolation || isContextViolation ? '#2a1515' : (isProcessingError ? '#1b2235' : '#1a1a1a')),
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
      warningIcon.textContent = isPendingDraft ? '⏳' : (isProcessingError ? '⚙️' : '⚠️');
      warningIcon.style.fontSize = '48px';
      warningIcon.style.marginBottom = '12px';
      violationPlaceholder.appendChild(warningIcon);

      const violationLabel = document.createElement('div');
      violationLabel.textContent = isPendingDraft
        ? 'Generating...'
        : (isProcessingError
        ? 'Processing Error'
        : (isContextViolation ? 'Context Violation' : 'Content Violation'));
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
        helpText.textContent = 'This draft is still in progress. It will move into drafts when complete.';
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
      video.controls = true; // Show controls for volume/seeking
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
      playBtn.addEventListener('mouseenter', () => {
        playBtn.style.transform = 'translate(-50%, -50%) scale(1.1)';
        playBtn.style.background = 'rgba(0,0,0,0.9)';
      });
      playBtn.addEventListener('mouseleave', () => {
        playBtn.style.transform = 'translate(-50%, -50%)';
        playBtn.style.background = 'rgba(0,0,0,0.7)';
      });
      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Mark that user has interacted - enable hover-to-play
        uvDraftsVideoInteracted = true;
        // Pause any other playing video
        if (uvDraftsCurrentlyPlayingVideo && uvDraftsCurrentlyPlayingVideo !== video) {
          uvDraftsCurrentlyPlayingVideo.pause();
          uvDraftsCurrentlyPlayingVideo.currentTime = 0;
          uvDraftsCurrentlyPlayingVideo.style.opacity = '0';
          const otherPlayBtn = uvDraftsCurrentlyPlayingVideo.parentElement?.querySelector('.uv-play-btn');
          if (otherPlayBtn) otherPlayBtn.style.display = 'flex';
        }
        // Mark as seen when clicking play
        if (!uvDraftsJustSeenIds.has(draft.id) && isDraftUnreadState(draft)) {
          uvDraftsJustSeenIds.add(draft.id);
          draft.is_read = true;
          markDraftAsSeen(draft.id);
          const badge = card.querySelector('.uv-new-badge');
          if (badge) badge.style.display = 'none';
          updateUVDraftsStats();
        }
        // Lazy load video src
        if (!video.src && video.dataset.src) {
          video.src = video.dataset.src;
        }
        video.style.opacity = '1';
        playBtn.style.display = 'none';
        uvDraftsCurrentlyPlayingVideo = video;
        video.play().catch((err) => {
          console.log('[UV Drafts] Play button click failed:', err);
        });
      });
      thumbContainer.appendChild(playBtn);

      // Click on video to toggle play/pause
      video.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (video.paused) {
          uvDraftsVideoInteracted = true; // Re-enable hover-to-play
          uvDraftsCurrentlyPlayingVideo = video;
          playBtn.style.display = 'none';
          video.style.opacity = '1';
          video.play();
        } else {
          uvDraftsVideoInteracted = false; // Disable hover-to-play when paused
          uvDraftsCurrentlyPlayingVideo = null;
          video.pause();
          video.style.opacity = '0';
          video.currentTime = 0;
          playBtn.style.display = 'flex';
        }
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
    if (isNew) {
      const newBadge = document.createElement('div');
      newBadge.className = 'uv-new-badge';
      newBadge.textContent = 'NEW';
      Object.assign(newBadge.style, {
        position: 'absolute',
        top: '8px',
        left: '8px',
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
      thumbContainer.appendChild(newBadge);
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
    thumbLink.href = draftUrl;
    thumbLink.draggable = false; // Prevent drag interfering with video scrubber
    thumbLink.addEventListener('dragstart', (e) => e.preventDefault());
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
    if (Number(draft.duration_seconds) > 0) {
      metaParts.push(formatDurationShort(Number(draft.duration_seconds)));
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
    sourceBtn.disabled = isPendingDraft;
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

    const retryBtn = createActionBtn(icons.retry, 'Retry (copy prompt to composer)', () => {
      const prompt = String(draft.prompt || '').trim();
      if (!prompt) return;

      const source = buildComposerSourceFromDraft(draft);
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
        statusEl.textContent = 'Retry ready in composer.';
        statusEl.dataset.tone = 'ok';
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
    downloadBtn.disabled = isPendingDraft || !draft.download_url;
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
    actionsRow.appendChild(hideBtn);

    // Workspace button
    actionsRow.appendChild(createActionBtn(icons.folder, 'Workspace', () => {
      showDraftWorkspacePicker(draft);
    }));

    // Delete button
    actionsRow.appendChild(createActionBtn(icons.trash, 'Delete', async () => {
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
          const scheduledPosts = await uvDBGetAll(UV_DRAFTS_STORES.scheduledPosts);
          for (const scheduledPost of scheduledPosts) {
            if (scheduledPost?.draft_id === draft.id) {
              await uvDBDelete(UV_DRAFTS_STORES.scheduledPosts, scheduledPost.id);
            }
          }
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
    }));

    card.appendChild(actionsRow);

    // Second row for post/schedule actions
    const actionsRow2 = document.createElement('div');
    actionsRow2.className = 'uvd-actions-row2';

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
      postBtn.textContent = 'Pending...';
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

        // Post the draft (this is a simplified version - actual API may differ)
        const postHeaders = { 'Content-Type': 'application/json' };
        if (capturedAuthToken) postHeaders['Authorization'] = capturedAuthToken;
        const res = await fetch('https://sora.chatgpt.com/backend/project_y/posts', {
          method: 'POST',
          credentials: 'include',
          headers: postHeaders,
          body: JSON.stringify({
            draft_id: draft.id,
            caption: caption,
            visibility: 'public'
          })
        });

        if (res.ok) {
          draft.post_visibility = 'public';
          draft.posted_to_public = true;
          draft.post_meta = {
            ...(draft.post_meta || {}),
            id: draft.post_id || draft.post_meta?.id || null,
            visibility: 'public',
            posted_to_public: true,
            permalink: draft.post_permalink || draft.post_meta?.permalink || null,
          };
          await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
          postBtn.textContent = 'Posted ✓';
          postBtn.dataset.tone = 'success';
        } else {
          postBtn.textContent = 'Post';
          postBtn.disabled = false;
          postBtn.dataset.tone = '';
          alert('Failed to post draft. The API may have changed.');
        }
      } catch (err) {
        console.error('[UV Drafts] Post error:', err);
        postBtn.textContent = 'Post';
        postBtn.disabled = false;
        postBtn.dataset.tone = '';
        alert('Failed to post draft');
      }
    });
    actionsRow2.appendChild(postBtn);

    // Schedule button
    const scheduleBtn = document.createElement('button');
    scheduleBtn.className = 'uvd-action-pill';
    scheduleBtn.type = 'button';
    scheduleBtn.textContent = '📅 Schedule';
    scheduleBtn.disabled = isPendingDraft;
    scheduleBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isDraftPubliclyPosted(draft)) {
        alert('This draft has already been posted.');
        return;
      }

      const dateStr = prompt('Schedule post for (YYYY-MM-DD HH:MM):',
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
        await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, {
          id: `schedule_${Date.now()}`,
          draft_id: draft.id,
          scheduled_at: scheduledTime,
          caption: caption,
          visibility: 'public',
          status: 'pending'
        });

        scheduleBtn.textContent = '📅 Scheduled';
        scheduleBtn.dataset.tone = 'info';
        alert(`Post scheduled for ${new Date(scheduledTime).toLocaleString()}`);
      } catch (err) {
        console.error('[UV Drafts] Schedule error:', err);
        alert('Failed to schedule post');
      }
    });
    actionsRow2.appendChild(scheduleBtn);

    const trimBtn = document.createElement('button');
    trimBtn.className = 'uvd-action-pill';
    trimBtn.type = 'button';
    trimBtn.textContent = 'Trim';
    trimBtn.disabled = isPendingDraft || !canTrimDraft(draft);
    trimBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trimUrl = getDraftTrimUrl(draft);
      if (!trimUrl) return;
      window.location.href = trimUrl;
    });
    actionsRow2.appendChild(trimBtn);

    card.appendChild(actionsRow2);

    card.addEventListener('click', (e) => {
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
        // Lazy load and play this video
        if (!video.src && video.dataset.src) {
          video.src = video.dataset.src;
        }
        video.style.opacity = '1';
        if (playBtn) playBtn.style.display = 'none';
        uvDraftsCurrentlyPlayingVideo = video;
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
        if (uvDraftsCurrentlyPlayingVideo === video) {
          uvDraftsCurrentlyPlayingVideo = null;
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

  // Lightweight render for background sync — updates cache and appends new cards
  // without destroying existing DOM elements (no flicker).
  function renderUVDraftsSyncUpdate() {
    if (!uvDraftsGridEl) return;
    uvDraftsFilteredCache = getRenderableUVDrafts();
    if (uvDraftsFilteredCache.length === 0) return;
    renderMoreUVDrafts();
  }

  function renderUVDraftsGrid(resetScroll = true) {
    if (!uvDraftsGridEl) return;

    // Filter and cache results
    uvDraftsFilteredCache = getRenderableUVDrafts();

    if (resetScroll) {
      uvDraftsGridEl.innerHTML = '';
      uvDraftsRenderedCount = 0;
    }

    if (uvDraftsFilteredCache.length === 0) {
      uvDraftsGridEl.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'uvd-empty-state';
      empty.textContent = uvDraftsSearchQuery ? 'No drafts match your search' : 'No drafts found';
      uvDraftsGridEl.appendChild(empty);
      return;
    }

    // Render initial batch
    renderMoreUVDrafts();

    // Setup infinite scroll
    setupUVDraftsInfiniteScroll();
  }

  function renderMoreUVDrafts() {
    if (!uvDraftsGridEl || uvDraftsRenderedCount >= uvDraftsFilteredCache.length) return;

    const endIndex = Math.min(uvDraftsRenderedCount + UV_DRAFTS_BATCH_SIZE, uvDraftsFilteredCache.length);
    const fragment = document.createDocumentFragment();

    for (let i = uvDraftsRenderedCount; i < endIndex; i++) {
      fragment.appendChild(createUVDraftCard(uvDraftsFilteredCache[i]));
    }

    uvDraftsGridEl.appendChild(fragment);
    uvDraftsRenderedCount = endIndex;

    // Update load more indicator
    updateLoadMoreIndicator();
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

    const { total, bookmarked, hidden, newCount } = computeUVDraftsStats();
    const unsyncedCount = uvDraftsData.reduce((count, draft) => count + (draft?.is_unsynced === true ? 1 : 0), 0);
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

  async function initUVDraftsPage() {
    const runId = ++uvDraftsInitRunId;
    const isStaleRun = () => runId !== uvDraftsInitRunId;

    // Show loading
    if (uvDraftsLoadingEl) {
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
      renderUVDraftsGrid();
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
      const firstBatch = await fetchFirstUVDrafts(8);
      if (isStaleRun()) return;

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

        // Render immediately
        renderUVDraftsGrid();
        updateUVDraftsStats();
      }

      // Even when the first batch is empty, leave loading state and show empty view.
      if (uvDraftsLoadingEl) {
        uvDraftsLoadingEl.style.display = 'none';
      }
      if (uvDraftsData.length === 0) {
        renderUVDraftsGrid();
        updateUVDraftsStats();
      }

      // Continue fetching rest in background (if there's more)
      if (firstBatch.cursor) {
        // Don't await - let it run in background
        syncRemainingDrafts(firstBatch.cursor, (count, page) => {
          // Optionally show background sync progress in a subtle way
          console.log(`[UV Drafts] Background sync: ${count} drafts (page ${page})`);
          setUVDraftsSyncUiState({ syncing: true, processed: count, page });
        }, runId, firstBatch.items.length, fullSyncIds)
          .then(async (syncSucceeded) => {
            if (!syncSucceeded || isStaleRun()) return;
            await archiveUnsyncedDraftsAfterFullSync(fullSyncIds, runId);
          })
          .catch((syncErr) => {
            console.error('[UV Drafts] Background sync failed:', syncErr);
          })
          .finally(() => {
          if (isStaleRun()) return;
          setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
        });
      } else {
        await archiveUnsyncedDraftsAfterFullSync(fullSyncIds, runId);
        if (isStaleRun()) return;
        setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
      }
    } catch (err) {
      console.error('[UV Drafts] Quick fetch failed, falling back to full sync:', err);
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
      } catch (syncErr) {
        console.error('[UV Drafts] Full sync also failed:', syncErr);
        setUVDraftsSyncUiState({ syncing: false, processed: uvDraftsData.length, page: 0 });
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

      for (const post of scheduled) {
        if (post.status === 'pending' && post.scheduled_at <= now) {
          console.log('[UV Drafts] Executing scheduled post:', post.draft_id);

          try {
            // Post the draft
            const scheduledHeaders = { 'Content-Type': 'application/json' };
            if (capturedAuthToken) scheduledHeaders['Authorization'] = capturedAuthToken;
            const res = await fetch('https://sora.chatgpt.com/backend/project_y/posts', {
              method: 'POST',
              credentials: 'include',
              headers: scheduledHeaders,
              body: JSON.stringify({
                draft_id: post.draft_id,
                caption: post.caption,
                visibility: post.visibility || 'public'
              })
            });

            if (res.ok) {
              post.status = 'posted';
              await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, post);

              // Update draft status in cache
              const draft = await uvDBGet(UV_DRAFTS_STORES.drafts, post.draft_id);
              if (draft) {
                draft.post_visibility = 'public';
                draft.posted_to_public = true;
                draft.post_meta = {
                  ...(draft.post_meta || {}),
                  visibility: 'public',
                  posted_to_public: true,
                };
                await uvDBPut(UV_DRAFTS_STORES.drafts, draft);
              }

              console.log('[UV Drafts] Scheduled post succeeded:', post.draft_id);
            } else {
              post.status = 'failed';
              await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, post);
              console.error('[UV Drafts] Scheduled post failed:', post.draft_id, res.status);
            }
          } catch (err) {
            post.status = 'failed';
            await uvDBPut(UV_DRAFTS_STORES.scheduledPosts, post);
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

    if (uvDraftsPageEl && document.contains(uvDraftsPageEl)) {
      uvDraftsPageEl.style.display = 'block';
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
      .uvd-header { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:18px; flex-wrap:wrap; }
      .uvd-header-controls { display:flex; gap:10px; align-items:center; justify-content:flex-end; flex-wrap: wrap; margin-left: auto; }
      .uvd-title-wrap h1 { font-size: 60px; margin: 8px 0 10px; letter-spacing: -0.035em; line-height: .96; color: var(--uvd-text); font-weight: 700; }
      .uvd-title-wrap .uv-drafts-stats { color: var(--uvd-subtext); font-size: 18px; }
      .uvd-back-btn { background:none; border:none; color: var(--uvd-subtext); cursor:pointer; font-size: 16px; font-weight: 600; padding: 4px 0; margin-bottom: 6px; }
      .uvd-header-actions { display:flex; gap:10px; align-items:center; flex-wrap: wrap; }
      .uvd-cta { border:1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); border-radius: 14px; padding: 12px 16px; font-size: 16px; font-weight: 600; cursor:pointer; transition: background .16s ease, border-color .16s ease; }
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
      .uvd-compose-status { min-height: 18px; margin-top: 8px; font-size: 13px; color: var(--uvd-subtext); }
      .uvd-compose-status[data-tone="ok"] { color: var(--uvd-ok); }
      .uvd-compose-status[data-tone="error"] { color: var(--uvd-error); }
      .uvd-modal-backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.58); display: flex; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box; }
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
      .uvd-card { position: relative; overflow: hidden; cursor: pointer; border: 1px solid var(--uvd-border); background: var(--token-bg-surface-primary, #1f222a); box-shadow: 0 12px 32px rgba(0,0,0,0.3); border-radius: 14px; transition: transform 0.15s ease, box-shadow 0.15s ease; }
      .uvd-card.is-violation { background: #3a2020; }
      .uvd-card.is-processing-error { background: #1f273b; border-color: rgba(125,164,255,0.5); }
      .uvd-thumb-link { display:block; text-decoration:none; color:inherit; }
      .uvd-info { padding: 10px; }
      .uvd-prompt { font-size: 13px; font-weight: 500; color: var(--uvd-text); line-height: 1.3; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
      .uvd-prompt:hover { color: #d9e7ff; }
      .uvd-time { font-size: 12px; color: var(--uvd-subtext); }
      .uvd-actions-row { display:grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap:6px; padding: 0 10px 10px; }
      .uvd-actions-row2 { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:6px; padding: 0 10px 10px; }
      .uvd-icon-btn { width: 100%; height: 34px; border-radius: 9px; border: 1px solid var(--uvd-border); background: var(--uvd-surface); color: var(--uvd-text); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: background .15s ease, border-color .15s ease; }
      .uvd-icon-btn:hover { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-action-pill { width: 100%; min-height: 38px; border: 1px solid var(--uvd-border); background: var(--uvd-surface); border-radius: 9px; color: var(--uvd-text); font-size: 13px; font-weight: 600; cursor:pointer; transition: background .15s ease, border-color .15s ease; }
      .uvd-action-pill:hover:not(:disabled) { background: var(--uvd-surface-hover); border-color: var(--uvd-border-strong); }
      .uvd-action-pill[data-tone="success"] { background: #1f8d51; border-color: #1f8d51; }
      .uvd-action-pill[data-tone="info"] { background: #215ba6; border-color: #215ba6; }
      .uvd-action-pill:disabled { opacity: .6; cursor:not-allowed; }
      .uv-drafts-loading, .uvd-empty-state, .uv-drafts-load-more { grid-column: 1 / -1; text-align: center; color: var(--uvd-subtext); }
      .uv-drafts-loading { display:flex; align-items:center; justify-content:center; padding: 42px 18px; font-size: 16px; }
      .uvd-empty-state { padding: 60px 20px; font-size: 16px; }
      .uv-drafts-load-more { padding: 20px; font-size: 14px; }
      .uv-drafts-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
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

    const backBtn = document.createElement('button');
    backBtn.className = 'uvd-back-btn';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => {
      hideUVDraftsPage();
      history.back();
    });
    titleSection.appendChild(backBtn);

    const title = document.createElement('h1');
    title.textContent = 'My Drafts';
    titleSection.appendChild(title);

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
      initUVDraftsPage();
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

    // Keep status responsive while queues update.
    setInterval(updateMarkAllProgressUI, 200);
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
      renderUVDraftsGrid();
    });
    uvWorkspaceSelectEl = workspaceSelect;
    filterBar.appendChild(workspaceSelect);

    // Load workspaces async
    loadWorkspaces().then(() => updateWorkspaceSelect());

    // Sort dropdown
    const sortSelect = document.createElement('select');
    sortSelect.className = 'uvd-select';
    sortSelect.innerHTML = `
      <option value="newest">Newest First</option>
      <option value="oldest">Oldest First</option>
    `;
    if (Array.from(sortSelect.options).some((opt) => opt.value === uvDraftsSortState)) {
      sortSelect.value = uvDraftsSortState;
    } else {
      uvDraftsSortState = 'newest';
      sortSelect.value = uvDraftsSortState;
      persistUVDraftsViewState();
    }
    sortSelect.addEventListener('change', () => {
      uvDraftsSortState = sortSelect.value;
      persistUVDraftsViewState();
      renderUVDraftsGrid();
    });
    filterBar.appendChild(sortSelect);

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
      if (uvDraftsPageEl && uvDraftsPageEl.style.display !== 'none' && uvDraftsSyncUiState.syncing) {
        initUVDraftsPage();
      }
    }

    function setModelOverride(value) {
      modelOverride = typeof value === 'string' && value ? value : null;
    }

    function getModelOverride() {
      return modelOverride;
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
    };
  }

  globalScope.SoraUVDraftsPageModule = createSoraUVDraftsPageModule;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createSoraUVDraftsPageModule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
