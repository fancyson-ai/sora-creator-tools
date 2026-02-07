/*
 * Copyright (c) 2025 Will (fancyson-ai), Topher (cameoed), Skye (thecosmicskye)
 * Licensed under the MIT License. See the LICENSE file for details.
 */

(() => {
  const p = String(location.pathname || '');
  const isDraftDetail = p === '/d' || p.startsWith('/d/');
  const ULTRA_MODE_KEY = 'SCT_ULTRA_MODE_V1';
  const METRICS_USERS_INDEX_KEY = 'metricsUsersIndex';

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
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, ULTRA_MODE_KEY)) return;
      syncUltraModePreference();
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

  // Always inject api.js (request/body rewriter + duration dropdown enhancer).
  // Inject inject.js on all pages; it self-limits on draft detail routes.
  injectPageScript('api.js', () => {
    injectPageScript('inject.js');
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
      const url = chrome.runtime.getURL('dashboard.html');
      let fallbackTimer = null;
      const openDirect = ()=>{
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = null;
        try { window.open(url, '_blank'); } catch {}
      };
      try {
        fallbackTimer = setTimeout(openDirect, 800);
        chrome.runtime.sendMessage({ action: 'open_dashboard' }, (resp)=>{
          if (fallbackTimer) clearTimeout(fallbackTimer);
          fallbackTimer = null;
          // If background didn't acknowledge, use direct open as a safety net
          if (chrome.runtime.lastError || !resp || resp.success !== true) {
            openDirect();
          }
        });
      } catch {
        openDirect();
      }
    } catch {
      dashboardOpenLock = false;
    }
  }

  window.addEventListener('message', function(ev) {
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'open_dashboard') return;
    const userKey = d.userKey || (d.userHandle ? `h:${String(d.userHandle).toLowerCase()}` : null);
    openDashboardTab({ userKey, userHandle: d.userHandle });
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

  // Listen for metrics snapshots posted from the injected script and persist to storage.
  (function () {
  const PENDING = [];
  let flushTimer = null;
  const metricsFallback = { users: {} };
  const METRICS_STORAGE_KEY = 'metrics';
  const METRICS_UPDATED_AT_KEY = 'metricsUpdatedAt';

  // Debug toggles
  const DEBUG = { storage: false, thumbs: false };
  const dlog = (topic, ...args) => { try { if (DEBUG[topic]) console.log('[SoraUV]', topic, ...args); } catch {} };

  const DEFAULT_METRICS = { users: {} };
  const postIdToUserKey = new Map();
  let metricsCache = null;
  let metricsCacheUpdatedAt = 0;
  let metricsCacheLoading = null;

  function normalizeMetrics(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_METRICS };
    const users = raw.users;
    if (!users || typeof users !== 'object' || Array.isArray(users)) return { ...DEFAULT_METRICS };
    return { ...raw, users };
  }

  function rebuildPostIndex(metrics) {
    postIdToUserKey.clear();
    const users = metrics?.users || {};
    for (const [userKey, user] of Object.entries(users)) {
      const posts = user?.posts;
      if (!posts || typeof posts !== 'object') continue;
      for (const postId of Object.keys(posts)) {
        postIdToUserKey.set(postId, userKey);
      }
    }
  }

  function cacheMetrics(rawMetrics, updatedAt) {
    const normalized = normalizeMetrics(rawMetrics);
    metricsCache = normalized;
    metricsCacheUpdatedAt = Number(updatedAt) || 0;
    rebuildPostIndex(normalized);
  }

  async function loadMetricsFromStorage() {
    if (metricsCacheLoading) return metricsCacheLoading;
    metricsCacheLoading = (async () => {
      try {
        const stored = await chrome.storage.local.get([METRICS_STORAGE_KEY, METRICS_UPDATED_AT_KEY]);
        cacheMetrics(stored[METRICS_STORAGE_KEY], stored[METRICS_UPDATED_AT_KEY]);
      } catch {
        metricsCache = normalizeMetrics(null);
        metricsCacheUpdatedAt = metricsCacheUpdatedAt || 0;
      } finally {
        metricsCacheLoading = null;
      }
      return { metrics: metricsCache || { users: {} }, metricsUpdatedAt: metricsCacheUpdatedAt || 0 };
    })();
    return metricsCacheLoading;
  }

  async function getMetricsState() {
    if (metricsCache) {
      return { metrics: metricsCache, metricsUpdatedAt: metricsCacheUpdatedAt || 0 };
    }
    return loadMetricsFromStorage();
  }

  function toTs(v) {
    if (typeof v === 'number' && isFinite(v)) return v < 1e11 ? v * 1000 : v;
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        return n < 1e11 ? n * 1000 : n;
      }
      const d = Date.parse(s);
      if (!isNaN(d)) return d;
    }
    return 0;
  }

  function getPostTimeMs(p) {
    const cands = [p?.post_time, p?.postTime, p?.post?.post_time, p?.post?.postTime, p?.meta?.post_time];
    for (const c of cands) {
      const t = toTs(c);
      if (t) return t;
    }
    return 0;
  }

  function latestSnapshot(snaps) {
    if (!Array.isArray(snaps) || snaps.length === 0) return null;
    const last = snaps[snaps.length - 1];
    if (last?.t != null) return last;
    let best = null;
    let bt = -Infinity;
    for (const s of snaps) {
      const t = Number(s?.t);
      if (isFinite(t) && t > bt) {
        bt = t;
        best = s;
      }
    }
    return best || last || null;
  }

  function pickSnapshotFields(snap) {
    if (!snap || typeof snap !== 'object') return null;
    return {
      t: snap.t ?? null,
      uv: snap.uv ?? null,
      likes: snap.likes ?? null,
      views: snap.views ?? null,
      comments: snap.comments ?? null,
      remixes: snap.remixes ?? null,
      remix_count: snap.remix_count ?? snap.remixes ?? null,
      duration: snap.duration ?? null,
      width: snap.width ?? null,
      height: snap.height ?? null,
    };
  }

  function trimPostForResponse(post, snapshotMode) {
    if (!post || typeof post !== 'object') return null;
    const postTime = getPostTimeMs(post);
    let snapshots = [];
    if (snapshotMode === 'all' && Array.isArray(post.snapshots)) {
      snapshots = post.snapshots.map(pickSnapshotFields).filter(Boolean);
    } else {
      const latest = latestSnapshot(post.snapshots);
      if (latest) {
        const picked = pickSnapshotFields(latest);
        if (picked) snapshots = [picked];
      }
    }
    return {
      url: post.url ?? null,
      thumb: post.thumb ?? null,
      caption: typeof post.caption === 'string' ? post.caption : null,
      text: typeof post.text === 'string' ? post.text : null,
      ownerKey: post.ownerKey ?? null,
      ownerHandle: post.ownerHandle ?? null,
      ownerId: post.ownerId ?? null,
      userHandle: post.userHandle ?? null,
      userKey: post.userKey ?? null,
      post_time: postTime || null,
      duration: post.duration ?? null,
      width: post.width ?? null,
      height: post.height ?? null,
      cameo_usernames: post.cameo_usernames ?? null,
      snapshots,
    };
  }

  function findPost(metrics, postId) {
    if (!postId || typeof postId !== 'string') return null;
    const userKey = postIdToUserKey.get(postId);
    if (userKey && metrics?.users?.[userKey]?.posts?.[postId]) {
      return { userKey, post: metrics.users[userKey].posts[postId] };
    }
    const users = metrics?.users || {};
    for (const [uKey, user] of Object.entries(users)) {
      const posts = user?.posts;
      if (!posts || typeof posts !== 'object') continue;
      if (posts[postId]) {
        postIdToUserKey.set(postId, uKey);
        return { userKey: uKey, post: posts[postId] };
      }
      for (const parentPost of Object.values(posts)) {
        const remixPostsData = parentPost?.remix_posts;
        const remixPosts = Array.isArray(remixPostsData)
          ? remixPostsData
          : (Array.isArray(remixPostsData?.items) ? remixPostsData.items : []);
        for (const remixItem of remixPosts) {
          const remixPost = remixItem?.post || remixItem;
          const remixId = remixPost?.id || remixPost?.post_id;
          if (remixId === postId) {
            postIdToUserKey.set(postId, uKey);
            return { userKey: uKey, post: remixPost };
          }
        }
      }
    }
    return null;
  }

  function buildAnalyzeMetrics(metrics, windowHours) {
    const trimmed = { users: {} };
    const NOW = Date.now();
    const hours = Math.min(24, Math.max(1, Number(windowHours) || 24));
    const windowMs = hours * 60 * 60 * 1000;
    const users = metrics?.users || {};
    for (const [userKey, user] of Object.entries(users)) {
      const posts = user?.posts;
      if (!posts || typeof posts !== 'object') continue;
      const nextPosts = {};
      for (const [pid, p] of Object.entries(posts)) {
        const tPost = getPostTimeMs(p);
        if (!tPost || NOW - tPost > windowMs) continue;
        const latest = latestSnapshot(p?.snapshots);
        if (!latest) continue;
        const trimmedPost = trimPostForResponse(p, 'latest');
        if (!trimmedPost) continue;
        nextPosts[pid] = trimmedPost;
      }
      if (Object.keys(nextPosts).length) {
        trimmed.users[userKey] = {
          handle: user?.handle ?? user?.userHandle ?? null,
          userHandle: user?.userHandle ?? user?.handle ?? null,
          id: user?.id ?? user?.userId ?? null,
          posts: nextPosts,
        };
      }
    }
    return trimmed;
  }

  function buildPostMetrics(metrics, postId, snapshotMode) {
    const result = { users: {} };
    const found = findPost(metrics, postId);
    if (!found) return result;
    const { userKey, post } = found;
    const user = metrics?.users?.[userKey] || {};
    const trimmedPost = trimPostForResponse(post, snapshotMode);
    if (!trimmedPost) return result;
    result.users[userKey] = {
      handle: user?.handle ?? user?.userHandle ?? null,
      userHandle: user?.userHandle ?? user?.handle ?? null,
      id: user?.id ?? user?.userId ?? null,
      posts: { [postId]: trimmedPost },
    };
    return result;
  }

  function buildMetricsForRequest(metrics, req) {
    const scope = typeof req?.scope === 'string' ? req.scope.toLowerCase() : 'full';
    if (scope === 'analyze') {
      return buildAnalyzeMetrics(metrics, req?.windowHours);
    }
    if (scope === 'post') {
      const snapshotMode = req?.snapshotMode === 'all' ? 'all' : 'latest';
      return buildPostMetrics(metrics, req?.postId, snapshotMode);
    }
    return metrics;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 750);
  }

  function onMessage(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'metrics_batch' || !Array.isArray(d.items)) return;
    for (const it of d.items) PENDING.push(it);
    scheduleFlush();
  }

  (function(){
    function onMetricsRequest(ev){
      const d = ev?.data;
      if (!d || d.__sora_uv__ !== true || d.type !== 'metrics_request') return;
      const req = d.req;
      (async () => {
        try {
          const { metrics, metricsUpdatedAt } = await getMetricsState();
          const responseMetrics = buildMetricsForRequest(metrics, d);
          // Reply back into the page
          window.postMessage({ __sora_uv__: true, type: 'metrics_response', req, metrics: responseMetrics, metricsUpdatedAt }, '*');
        } catch {
          // Fall back to an empty payload if storage is unavailable
          window.postMessage({ __sora_uv__: true, type: 'metrics_response', req, metrics: metricsFallback, metricsUpdatedAt: 0 }, '*');
        }
      })();
    }
    window.addEventListener('message', onMetricsRequest);
  })();

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes) return;
      const hasMetrics = Object.prototype.hasOwnProperty.call(changes, METRICS_STORAGE_KEY);
      const hasUpdatedAt = Object.prototype.hasOwnProperty.call(changes, METRICS_UPDATED_AT_KEY);
      if (hasMetrics) {
        const nextMetrics = changes[METRICS_STORAGE_KEY]?.newValue;
        const nextUpdatedAt = hasUpdatedAt ? changes[METRICS_UPDATED_AT_KEY]?.newValue : metricsCacheUpdatedAt;
        cacheMetrics(nextMetrics, nextUpdatedAt);
      } else if (hasUpdatedAt) {
        const nextUpdatedAt = Number(changes[METRICS_UPDATED_AT_KEY]?.newValue) || 0;
        metricsCacheUpdatedAt = nextUpdatedAt || metricsCacheUpdatedAt;
      }
    });
  } catch {}

  let isFlushing = false;
  let needsFlush = false;

  async function flush() {
    flushTimer = null;
    
    // If already flushing, mark that we need another pass and return
    if (isFlushing) {
      needsFlush = true;
      return;
    }
    
    if (!PENDING.length) return;
    
    isFlushing = true;

    try {
      // Check purge lock to prevent overwriting dashboard purge
      try {
        const { purgeLock } = await chrome.storage.local.get('purgeLock');
        if (purgeLock && Date.now() - purgeLock < 30000) { // 30s timeout
           dlog('storage', 'purge locked, retrying', {});
           isFlushing = false;
           scheduleFlush();
           return;
        }
      } catch {}
  
      // Take current items
      const items = PENDING.splice(0, PENDING.length);
      try {
        const { metrics } = await getMetricsState();
        dlog('storage', 'flush begin', { count: items.length });
        for (const snap of items) {
          const userKey = snap.userKey || snap.pageUserKey || 'unknown';
          const userEntry = metrics.users[userKey] || (metrics.users[userKey] = { handle: snap.userHandle || snap.pageUserHandle || null, id: snap.userId || null, posts: {}, followers: [], cameos: [] });
          if (!userEntry.posts || typeof userEntry.posts !== 'object' || Array.isArray(userEntry.posts)) userEntry.posts = {};
          if (!Array.isArray(userEntry.followers)) userEntry.followers = [];
          if (snap.postId) {
            postIdToUserKey.set(snap.postId, userKey);
            const post = userEntry.posts[snap.postId] || (userEntry.posts[snap.postId] = { url: snap.url || null, thumb: snap.thumb || null, snapshots: [] });
            // Persist owner attribution on the post to allow dashboard integrity checks
            if (!post.ownerKey && (snap.userKey || snap.pageUserKey)) post.ownerKey = snap.userKey || snap.pageUserKey;
            if (!post.ownerHandle && (snap.userHandle || snap.pageUserHandle)) post.ownerHandle = snap.userHandle || snap.pageUserHandle;
            if (!post.ownerId && snap.userId != null) post.ownerId = snap.userId;
            if (!post.url && snap.url) post.url = snap.url;
            // Capture/refresh caption
            if (typeof snap.caption === 'string' && snap.caption) {
              if (!post.caption) post.caption = snap.caption;
              else if (post.caption !== snap.caption) post.caption = snap.caption;
            }
            // Capture/refresh cameo_usernames
            if (snap.cameo_usernames != null) {
              if (Array.isArray(snap.cameo_usernames) && snap.cameo_usernames.length > 0) {
                post.cameo_usernames = snap.cameo_usernames;
              } else if (!post.cameo_usernames) {
                // Only set to null/empty if it wasn't already set (preserve existing data)
                post.cameo_usernames = null;
              }
            }
            // Update thumbnail when a better/different one becomes available
            if (snap.thumb) {
              if (!post.thumb) {
                post.thumb = snap.thumb;
                dlog('thumbs', 'thumb set', { postId: snap.postId, thumb: post.thumb });
              } else if (post.thumb !== snap.thumb) {
                dlog('thumbs', 'thumb update', { postId: snap.postId, old: post.thumb, new: snap.thumb });
                post.thumb = snap.thumb;
              } else {
                dlog('thumbs', 'thumb unchanged', { postId: snap.postId, thumb: post.thumb });
              }
            } else {
              dlog('thumbs', 'thumb missing in snap', { postId: snap.postId });
            }
            if (!post.post_time && snap.created_at) post.post_time = snap.created_at; // Map creation time so dashboard can sort posts
            // Relationship fields for deriving direct remix counts across metrics
            if (snap.parent_post_id != null) post.parent_post_id = snap.parent_post_id;
            if (snap.root_post_id != null) post.root_post_id = snap.root_post_id;
            
            // IMPORTANT: Always update duration and dimensions at post level when available
            // This ensures we capture frame count data even if metrics haven't changed
            // (duration doesn't affect snapshot deduplication since we check it separately below)
            if (snap.duration != null) {
              const d = Number(snap.duration);
              if (Number.isFinite(d)) {
                const wasSet = post.duration != null;
                post.duration = d;
                if (DEBUG.storage) {
                  dlog('storage', wasSet ? 'duration updated' : 'duration set', { postId: snap.postId, duration: d });
                }
              }
            }
            if (snap.width != null) {
              const w = Number(snap.width);
              if (Number.isFinite(w)) post.width = w;
            }
            if (snap.height != null) {
              const h = Number(snap.height);
              if (Number.isFinite(h)) post.height = h;
            }
  
            const s = {
              t: snap.ts || Date.now(),
              uv: snap.uv ?? null,
              likes: snap.likes ?? null,
              views: snap.views ?? null,
              comments: snap.comments ?? null,
              // Store direct remixes; map both names for backward/forward compat
              remixes: snap.remix_count ?? snap.remixes ?? null,
              remix_count: snap.remix_count ?? snap.remixes ?? null,
              // Store duration and dimensions (frame count data)
              duration: snap.duration ?? null,
              width: snap.width ?? null,
              height: snap.height ?? null,
              // shares/downloads removed
            };
            
            // Only add a new snapshot if engagement metrics changed (don't create new snapshot just for duration)
            const last = post.snapshots[post.snapshots.length - 1];
            const same = last && last.uv === s.uv && last.likes === s.likes && last.views === s.views &&
              last.comments === s.comments && last.remix_count === s.remix_count;
            
            if (!same) {
              post.snapshots.push(s);
            } else if (last && (last.duration !== s.duration || last.width !== s.width || last.height !== s.height)) {
              // If metrics are the same but duration/dimensions changed, update the last snapshot
              // This handles backfilling duration for existing posts without creating duplicate snapshots
              last.duration = s.duration;
              last.width = s.width;
              last.height = s.height;
            }
            
            post.lastSeen = Date.now();
          }
  
          // Capture follower history at the user level when available
          if (snap.followers != null) {
            const fCount = Number(snap.followers);
            if (Number.isFinite(fCount)) {
              const arr = userEntry.followers;
              const t = snap.ts || Date.now();
              const lastF = arr[arr.length - 1];
              if (!lastF || lastF.count !== fCount) {
                arr.push({ t, count: fCount });
                try { console.debug('[SoraMetrics] followers persisted', { userKey, count: fCount, t }); } catch {}
              }
            }
          }
          // Capture cameo count (profile-level) if available
          if (snap.cameo_count != null) {
            const cCount = Number(snap.cameo_count);
            if (Number.isFinite(cCount)) {
              if (!Array.isArray(userEntry.cameos)) userEntry.cameos = [];
              const arr = userEntry.cameos;
              const t = snap.ts || Date.now();
              const lastC = arr[arr.length - 1];
              if (!lastC || lastC.count !== cCount) {
                arr.push({ t, count: cCount });
                try { console.debug('[SoraMetrics] cameos persisted', { userKey, count: cCount, t }); } catch {}
              }
            }
          }
        }
        try {
          const metricsUpdatedAt = Date.now();
          const usersIndex = Object.entries(metrics.users || {}).map(([key, user])=>({
            key,
            handle: user?.handle || null,
            id: user?.id || null,
            postCount: Object.keys(user?.posts || {}).length
          }));
          await chrome.storage.local.set({
            [METRICS_STORAGE_KEY]: metrics,
            [METRICS_UPDATED_AT_KEY]: metricsUpdatedAt,
            [METRICS_USERS_INDEX_KEY]: usersIndex
          });
          metricsCache = metrics;
          metricsCacheUpdatedAt = metricsUpdatedAt;
          // Debug: Verify duration is in the metrics we just saved
          if (DEBUG.storage) {
            const sampleUser = Object.values(metrics.users || {})[0];
            if (sampleUser && sampleUser.posts) {
              const postsWithDuration = Object.values(sampleUser.posts).filter(p => p.duration != null);
              dlog('storage', 'flush end', { 
                totalPosts: Object.values(metrics.users || {}).reduce((sum, u) => sum + Object.keys(u.posts || {}).length, 0),
                postsWithDuration: postsWithDuration.length 
              });
            } else {
              dlog('storage', 'flush end', {});
            }
          }
        } catch (err) {
          try { console.warn('[SoraMetrics] storage.set failed; enable unlimitedStorage or lower snapshot cap', err); } catch {}
        }
      } catch (e) {
        try { console.warn('[SoraMetrics] flush failed', e); } catch {}
      }
    } finally {
      isFlushing = false;
      if (needsFlush) {
        needsFlush = false;
        scheduleFlush();
      }
    }
  }

    window.addEventListener('message', onMessage);
  })();
})();
