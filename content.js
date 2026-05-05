/*
 * Copyright (c) 2025-2026 sora-creator-tools contributors
 * Licensed under the MIT License. See the LICENSE file for details.
 */

(() => {
  const p = String(location.pathname || '');
  const isDraftDetail = p === '/d' || p.startsWith('/d/');
  const PAGE_ORIGIN = location.origin;
  const ULTRA_MODE_KEY = 'SCT_ULTRA_MODE_V1';
  const MAX_METRICS_BATCH_ITEMS = 250;
  const MAX_STR_LEN = 4096;
  const MAX_URL_LEN = 2048;
  const MAX_ID_LEN = 128;
  const MAX_HANDLE_LEN = 80;
  const MAX_REQUEST_ID_LEN = 80;
  const MAX_CAMEO_USERNAMES = 32;
  const MAX_SOCIAL_GRAPH_ITEMS = 5000;

  function sanitizeString(value, maxLen = MAX_STR_LEN) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  }

  function sanitizeNumber(value, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }

  function sanitizeIdToken(value, maxLen = MAX_ID_LEN) {
    const s = sanitizeString(value, maxLen);
    if (!s) return null;
    if (!/^[A-Za-z0-9:_.-]+$/.test(s)) return null;
    return s;
  }

  function sanitizeUserId(value) {
    const numeric = sanitizeNumber(value);
    if (numeric != null) return numeric;
    return sanitizeIdToken(value, MAX_ID_LEN);
  }

  function sanitizeCameoUsernames(value) {
    if (!Array.isArray(value)) return null;
    const out = [];
    for (const raw of value) {
      if (out.length >= MAX_CAMEO_USERNAMES) break;
      const username = sanitizeString(raw, MAX_HANDLE_LEN);
      if (!username) continue;
      out.push(username);
    }
    return out;
  }

  function sanitizeBoolean(value) {
    return typeof value === 'boolean' ? value : null;
  }

  function sanitizeRelationshipListKind(value) {
    const s = sanitizeString(value, 16);
    if (!s) return null;
    const n = s.toLowerCase();
    return n === 'followers' || n === 'following' ? n : null;
  }

  function sanitizeCleanupTarget(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const userKey = sanitizeIdToken(raw.userKey ?? raw.user_key);
    const userHandle = sanitizeString(raw.userHandle ?? raw.user_handle, MAX_HANDLE_LEN);
    const permalink = sanitizeString(raw.permalink, MAX_URL_LEN);
    if (!userKey && !userHandle) return null;
    return {
      userKey: userKey || (userHandle ? `h:${userHandle.toLowerCase()}` : null),
      userHandle: userHandle || null,
      permalink: permalink || null,
    };
  }

  function sanitizeCleanupBulkUnfollowRequest(message) {
    const profileHandle = sanitizeString(message?.profileHandle, MAX_HANDLE_LEN);
    const userKey = sanitizeIdToken(message?.userKey);
    if (!Array.isArray(message?.targets)) return null;
    const targets = [];
    for (const raw of message.targets) {
      if (targets.length >= 150) break;
      const item = sanitizeCleanupTarget(raw);
      if (item) targets.push(item);
    }
    if (!targets.length) return null;
    return {
      profileHandle: profileHandle || null,
      userKey: userKey || null,
      targets,
    };
  }

  function sanitizeCleanupRequestId(value) {
    return sanitizeString(value, 160);
  }

  function sanitizeSocialGraphNode(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = {};
    const userKey = sanitizeIdToken(raw.user_key);
    if (userKey) item.user_key = userKey;
    const userHandle = sanitizeString(raw.user_handle, MAX_HANDLE_LEN);
    if (userHandle) item.user_handle = userHandle;
    const userId = sanitizeUserId(raw.user_id);
    if (userId != null) item.user_id = userId;
    if (!item.user_key && userHandle) item.user_key = `h:${userHandle.toLowerCase()}`;
    if (!item.user_key && userId != null) item.user_key = `id:${String(userId)}`;
    if (!item.user_key) return null;

    const displayName = sanitizeString(raw.display_name, 120);
    if (displayName) item.display_name = displayName;
    const followerCount = sanitizeNumber(raw.follower_count, 0);
    if (followerCount != null) item.follower_count = followerCount;
    const followingCount = sanitizeNumber(raw.following_count, 0);
    if (followingCount != null) item.following_count = followingCount;
    const postCount = sanitizeNumber(raw.post_count, 0);
    if (postCount != null) item.post_count = postCount;
    const replyCount = sanitizeNumber(raw.reply_count, 0);
    if (replyCount != null) item.reply_count = replyCount;
    const likesReceivedCount = sanitizeNumber(raw.likes_received_count, 0);
    if (likesReceivedCount != null) item.likes_received_count = likesReceivedCount;
    const remixCount = sanitizeNumber(raw.remix_count, 0);
    if (remixCount != null) item.remix_count = remixCount;
    const cameoCount = sanitizeNumber(raw.cameo_count, 0);
    if (cameoCount != null) item.cameo_count = cameoCount;
    const verified = sanitizeBoolean(raw.verified);
    if (verified != null) item.verified = verified;
    const canCameo = sanitizeBoolean(raw.can_cameo);
    if (canCameo != null) item.can_cameo = canCameo;
    const followsYou = sanitizeBoolean(raw.follows_you);
    if (followsYou != null) item.follows_you = followsYou;
    const isFollowing = sanitizeBoolean(raw.is_following);
    if (isFollowing != null) item.is_following = isFollowing;

    const planType = sanitizeString(raw.plan_type, 64);
    if (planType) item.plan_type = planType;
    const permalink = sanitizeString(raw.permalink, MAX_URL_LEN);
    if (permalink) item.permalink = permalink;
    const description = sanitizeString(raw.description, 512);
    if (description) item.description = description;
    const location = sanitizeString(raw.location, 160);
    if (location) item.location = location;
    const createdAt = sanitizeNumber(raw.created_at, 0);
    if (createdAt != null) item.created_at = createdAt;
    const updatedAt = sanitizeNumber(raw.updated_at, 0);
    if (updatedAt != null) item.updated_at = updatedAt;
    return item;
  }

  function sanitizeSocialGraphPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const listKind = sanitizeRelationshipListKind(raw.list_kind);
    if (!listKind) return null;
    const items = Array.isArray(raw.items) ? raw.items : [];
    const outItems = [];
    const limit = Math.min(items.length, MAX_SOCIAL_GRAPH_ITEMS);
    for (let i = 0; i < limit; i++) {
      const item = sanitizeSocialGraphNode(items[i]);
      if (item) outItems.push(item);
    }
    const replace = raw.replace === true;
    if (!outItems.length && !replace) return null;
    const out = { list_kind: listKind, items: outItems };
    const cursor = sanitizeString(raw.cursor, MAX_URL_LEN);
    if (cursor) out.cursor = cursor;
    if (replace) out.replace = true;
    return out;
  }

  function sanitizeMetricsItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = {};

    const ts = sanitizeNumber(raw.ts, 0);
    if (ts != null) item.ts = ts;

    const userKey = sanitizeIdToken(raw.userKey);
    if (userKey) item.userKey = userKey;
    const pageUserKey = sanitizeIdToken(raw.pageUserKey);
    if (pageUserKey) item.pageUserKey = pageUserKey;

    const userHandle = sanitizeString(raw.userHandle, MAX_HANDLE_LEN);
    if (userHandle) item.userHandle = userHandle;
    const pageUserHandle = sanitizeString(raw.pageUserHandle, MAX_HANDLE_LEN);
    if (pageUserHandle) item.pageUserHandle = pageUserHandle;

    const userId = sanitizeUserId(raw.userId);
    if (userId != null) item.userId = userId;
    if (!item.userKey && userId != null) item.userKey = `id:${String(userId)}`;

    const postId = sanitizeIdToken(raw.postId);
    if (postId) item.postId = postId;
    const parentPostId = sanitizeIdToken(raw.parent_post_id);
    if (parentPostId) item.parent_post_id = parentPostId;
    const rootPostId = sanitizeIdToken(raw.root_post_id);
    if (rootPostId) item.root_post_id = rootPostId;

    const createdAt = raw.created_at;
    if (typeof createdAt === 'string' || Number.isFinite(Number(createdAt))) {
      item.created_at = typeof createdAt === 'string'
        ? sanitizeString(createdAt, 64)
        : Number(createdAt);
    }

    const url = sanitizeString(raw.url, MAX_URL_LEN);
    if (url) item.url = url;
    const thumb = sanitizeString(raw.thumb, MAX_URL_LEN);
    if (thumb) item.thumb = thumb;
    const caption = sanitizeString(raw.caption, MAX_STR_LEN);
    if (caption) item.caption = caption;

    const cameoUsernames = sanitizeCameoUsernames(raw.cameo_usernames);
    if (cameoUsernames) item.cameo_usernames = cameoUsernames;

    const uv = sanitizeNumber(raw.uv, 0);
    if (uv != null) item.uv = uv;
    const likes = sanitizeNumber(raw.likes, 0);
    if (likes != null) item.likes = likes;
    const views = sanitizeNumber(raw.views, 0);
    if (views != null) item.views = views;
    const comments = sanitizeNumber(raw.comments, 0);
    if (comments != null) item.comments = comments;
    const remixes = sanitizeNumber(raw.remixes, 0);
    if (remixes != null) item.remixes = remixes;
    const remixCount = sanitizeNumber(raw.remix_count, 0);
    if (remixCount != null) item.remix_count = remixCount;
    const followers = sanitizeNumber(raw.followers, 0);
    if (followers != null) item.followers = followers;
    const cameoCount = sanitizeNumber(raw.cameo_count, 0);
    if (cameoCount != null) item.cameo_count = cameoCount;
    const socialGraph = sanitizeSocialGraphPayload(raw.social_graph);
    if (socialGraph) item.social_graph = socialGraph;
    const duration = sanitizeNumber(raw.duration, 0, 60 * 60 * 10);
    if (duration != null) item.duration = duration;
    const width = sanitizeNumber(raw.width, 1, 20000);
    if (width != null) item.width = width;
    const height = sanitizeNumber(raw.height, 1, 20000);
    if (height != null) item.height = height;

    const hasSignal = !!item.postId || item.followers != null || item.cameo_count != null || !!item.social_graph;
    return hasSignal ? item : null;
  }

  function sanitizeMetricsBatch(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    const limit = Math.min(items.length, MAX_METRICS_BATCH_ITEMS);
    for (let i = 0; i < limit; i++) {
      const item = sanitizeMetricsItem(items[i]);
      if (item) out.push(item);
    }
    return out;
  }

  function sanitizeRequestId(value) {
    const s = sanitizeString(value, MAX_REQUEST_ID_LEN);
    if (!s) return null;
    if (!/^[A-Za-z0-9._:-]+$/.test(s)) return null;
    return s;
  }

  function normalizeMetricsScope(scope) {
    const s = sanitizeString(scope, 16);
    if (!s) return null;
    const n = s.toLowerCase();
    if (n === 'analyze' || n === 'post') return n;
    return null;
  }

  function normalizeSnapshotMode(mode) {
    const s = sanitizeString(mode, 16);
    return s && s.toLowerCase() === 'all' ? 'all' : 'latest';
  }

  function postMetricsResponse(req, metrics = { users: {} }, metricsUpdatedAt = 0) {
    try {
      window.postMessage(
        { __sora_uv__: true, type: 'metrics_response', req, metrics, metricsUpdatedAt },
        PAGE_ORIGIN
      );
    } catch {}
  }
  function writeUltraModeToLocalStorage(enabled) {
    try {
      localStorage.setItem(ULTRA_MODE_KEY, JSON.stringify({ enabled: !!enabled, setAt: Date.now() }));
    } catch {}
  }

  async function syncUltraModePreference() {
    try {
      const stored = await chrome.storage.local.get(ULTRA_MODE_KEY);
      const enabled = !!stored[ULTRA_MODE_KEY];
      writeUltraModeToLocalStorage(enabled);
      try {
        window.dispatchEvent(new CustomEvent('sct_ultra_mode', { detail: { enabled } }));
      } catch {}
    } catch {}
  }

  syncUltraModePreference();
  // Listen for ultra mode changes broadcast from background (avoids chrome.storage.onChanged
  // which would serialize the full metrics blob to every content script on every flush).
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === 'ultra_mode_changed') {
        syncUltraModePreference();
        return false;
      }
      if (message?.action === 'cleanup_bulk_unfollow') {
        const request = sanitizeCleanupBulkUnfollowRequest(message);
        const requestId = sanitizeCleanupRequestId(message?.requestId);
        if (!request) {
          sendResponse({ ok: false, error: 'Invalid cleanup unfollow payload.' });
          return false;
        }
        if (!requestId) {
          sendResponse({ ok: false, error: 'Missing cleanup request id.' });
          return false;
        }
        const req = `cleanup:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        let done = false;
        const finish = (payload) => {
          if (done) return;
          done = true;
          try { clearTimeout(timer); } catch {}
          try { window.removeEventListener('message', onReply); } catch {}
          try {
            chrome.runtime.sendMessage({
              action: 'cleanup_bulk_unfollow_result',
              requestId,
              payload: payload && typeof payload === 'object' ? payload : { ok: false, error: 'No response from the page action.' },
            });
          } catch {}
        };
        const onReply = (ev) => {
          if (ev?.source !== window) return;
          const data = ev?.data;
          if (!data || data.__sora_uv__ !== true || data.type !== 'cleanup_action_response' || data.req !== req) return;
          finish(data.payload || { ok: false, error: 'No cleanup response payload.' });
        };
        const timer = setTimeout(() => {
          finish({ ok: false, error: 'Timed out waiting for the Sora page to process the cleanup action.' });
        }, 180000);
        try {
          window.addEventListener('message', onReply);
          window.postMessage({
            __sora_uv__: true,
            type: 'cleanup_action_request',
            req,
            command: 'bulk_unfollow',
            payload: request,
          }, PAGE_ORIGIN);
          sendResponse({ ok: true, started: true, requestId });
        } catch (err) {
          finish({ ok: false, error: err?.message || 'Could not relay the cleanup action to the page.' });
          sendResponse({ ok: false, error: err?.message || 'Could not relay the cleanup action to the page.' });
        }
        return false;
      }
      return false;
    });
  } catch {}

  function injectPageScript(filename, next) {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL(filename);
      s.async = false;
      s.onload = () => {
        try {
          s.remove();
        } catch {}
        try {
          if (typeof next === 'function') next();
        } catch {}
      };
      s.onerror = () => {
        try {
          if (typeof next === 'function') next();
        } catch {}
      };
      (document.head || document.documentElement).appendChild(s);
    } catch {
      try {
        if (typeof next === 'function') next();
      } catch {}
    }
  }

  let uvDraftsScriptsInjected = false;
  let uvDraftsScriptsInjecting = false;
  let uvDraftsScriptReadyCallbacks = [];

  function isUVDraftsRoute(pathname = location.pathname) {
    const current = String(pathname || '');
    return current === '/creatortools' || current.startsWith('/creatortools/');
  }

  function flushUVDraftsReadyCallbacks() {
    const cbs = uvDraftsScriptReadyCallbacks;
    uvDraftsScriptReadyCallbacks = [];
    for (const cb of cbs) {
      try { cb(); } catch {}
    }
  }

  function announceUVDraftsScriptsReady() {
    try {
      window.postMessage({ __sora_uv__: true, type: 'uv_drafts_scripts_ready' }, PAGE_ORIGIN);
    } catch {}
  }

  function ensureUVDraftsScriptsInjected(next) {
    if (typeof next === 'function') uvDraftsScriptReadyCallbacks.push(next);
    if (uvDraftsScriptsInjected) {
      flushUVDraftsReadyCallbacks();
      return;
    }
    if (uvDraftsScriptsInjecting) return;
    uvDraftsScriptsInjecting = true;
    injectPageScript('uv-drafts-logic.js', () => {
      injectPageScript('uv-drafts-page.js', () => {
        uvDraftsScriptsInjected = true;
        uvDraftsScriptsInjecting = false;
        announceUVDraftsScriptsReady();
        flushUVDraftsReadyCallbacks();
      });
    });
  }

  // Inject core page scripts first. UV Drafts modules are lazy-loaded on demand.
  injectPageScript('api.js', () => {
    injectPageScript('inject.js', () => {
      if (isUVDraftsRoute()) ensureUVDraftsScriptsInjected();
    });
  });

  // Listen for dashboard open requests from inject.js and relay to background.
  let dashboardOpenLock = false;
  let dashboardOpenLockTimer = null;
  function openDashboardTab(opts){
    try {
      if (dashboardOpenLock) return;
      dashboardOpenLock = true;
      if (dashboardOpenLockTimer) clearTimeout(dashboardOpenLockTimer);
      dashboardOpenLockTimer = setTimeout(()=>{ dashboardOpenLock = false; }, 1000);
      const payload = {};
      if (opts?.userKey) payload.lastUserKey = opts.userKey;
      if (opts?.userHandle) payload.lastUserHandle = opts.userHandle;
      if (Object.keys(payload).length) chrome.storage.local.set(payload);
      try {
        chrome.runtime.sendMessage({ action: 'open_dashboard' }, (resp)=>{
          if (chrome.runtime.lastError || !resp || resp.success !== true) {
            dashboardOpenLock = false;
          }
        });
      } catch {
        dashboardOpenLock = false;
      }
    } catch {
      dashboardOpenLock = false;
    }
  }

  window.addEventListener('message', function(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'open_dashboard') return;
    const userHandle = sanitizeString(d.userHandle, MAX_HANDLE_LEN);
    const providedUserKey = sanitizeIdToken(d.userKey);
    const userKey = providedUserKey || (userHandle ? `h:${userHandle.toLowerCase()}` : null);
    openDashboardTab({ userKey, userHandle });
  });

  window.addEventListener('message', function(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'load_uv_drafts_scripts') return;
    ensureUVDraftsScriptsInjected();
  });

  // Fallback: also listen directly for clicks on the injected dashboard button in the page DOM.
  const dashboardClickHandler = (ev)=>{
    const btn = ev.target && ev.target.closest && ev.target.closest('.sora-uv-dashboard-btn');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    openDashboardTab({});
  };
  document.addEventListener('click', dashboardClickHandler, true);
  document.addEventListener('pointerup', dashboardClickHandler, true);
  document.addEventListener('touchend', dashboardClickHandler, true);

  if (isDraftDetail) return;

  // Relay metrics batches from inject.js to background service worker (fire-and-forget).
  window.addEventListener('message', function(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'metrics_batch' || !Array.isArray(d.items)) return;
    const items = sanitizeMetricsBatch(d.items);
    if (!items.length) return;
    try {
      chrome.runtime.sendMessage({ action: 'metrics_batch', items });
    } catch {}
  });

  // Relay metrics requests from inject.js to background and return the response.
  window.addEventListener('message', function(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'metrics_request') return;
    const req = sanitizeRequestId(d.req);
    const scope = normalizeMetricsScope(d.scope);
    if (!req || !scope) return;
    const postId = scope === 'post' ? sanitizeIdToken(d.postId) : null;
    if (scope === 'post' && !postId) {
      postMetricsResponse(req);
      return;
    }
    const windowHours = scope === 'analyze'
      ? (sanitizeNumber(d.windowHours, 1, 24) ?? 24)
      : undefined;
    const snapshotMode = normalizeSnapshotMode(d.snapshotMode);
    try {
      chrome.runtime.sendMessage({
        action: 'metrics_request',
        scope,
        postId,
        windowHours,
        snapshotMode,
      }, (response) => {
        if (chrome.runtime.lastError || !response) {
          postMetricsResponse(req);
          return;
        }
        postMetricsResponse(req, response.metrics, response.metricsUpdatedAt);
      });
    } catch {
      postMetricsResponse(req);
    }
  });
})();
