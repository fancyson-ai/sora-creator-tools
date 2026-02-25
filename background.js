/* Open full dashboard page when the action icon is clicked */
chrome.action.onClicked.addListener(() => {
  openOrFocusDashboard(() => {});
});

/* ─── Metrics module (single owner of cache + storage writes) ─── */

const PENDING = [];
let flushTimer = null;
const METRICS_STORAGE_KEY = 'metrics';
const METRICS_UPDATED_AT_KEY = 'metricsUpdatedAt';
const METRICS_USERS_INDEX_KEY = 'metricsUsersIndex';
const TRUSTED_TAB_URL_RE = /^https:\/\/sora\.chatgpt\.com\//i;
const MAX_MESSAGE_BATCH_ITEMS = 250;
const MAX_SNAPSHOT_HISTORY_PER_POST = 720;
const MAX_PROFILE_SERIES_POINTS = 720;

// Debug toggles
const DEBUG = { storage: false, thumbs: false };
const dlog = (topic, ...args) => { try { if (DEBUG[topic]) console.log('[SoraUV]', topic, ...args); } catch {} };

const DEFAULT_METRICS = { users: {} };
const postIdToUserKey = new Map();
let metricsCache = null;
let metricsCacheUpdatedAt = 0;
let metricsCacheLoading = null;
let lastSelfWriteTs = 0;
let knownUserCount = 0;
let lastUsersIndexWrite = 0;

// Hot/cold storage split constants and state
const COLD_PREFIX = 'snapshots_';
const COLD_DEBOUNCE_MS = 8000;
const STORAGE_VERSION_KEY = 'metricsStorageVersion';
const CURRENT_STORAGE_VERSION = 2;
const coldSnapshotBuffer = new Map(); // Map<userKey, Map<postId, snapshot[]>>
const coldDirtyUsers = new Set();
let coldWriteTimer = null;

let isFlushing = false;
let needsFlush = false;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeString(value, maxLen = 4096) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function sanitizeIdToken(value, maxLen = 128) {
  const s = sanitizeString(value, maxLen);
  if (!s) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(s)) return null;
  return s;
}

function sanitizeNumber(value, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function sanitizeUserId(value) {
  const numeric = sanitizeNumber(value);
  if (numeric != null) return numeric;
  return sanitizeIdToken(value);
}

function sanitizeCameoUsernames(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value) {
    if (out.length >= 32) break;
    const username = sanitizeString(raw, 80);
    if (!username) continue;
    out.push(username);
  }
  return out;
}

function sanitizeMetricsSnapshot(raw) {
  if (!isPlainObject(raw)) return null;
  const snap = {};

  const ts = sanitizeNumber(raw.ts, 0);
  if (ts != null) snap.ts = ts;
  const userKey = sanitizeIdToken(raw.userKey);
  if (userKey) snap.userKey = userKey;
  const pageUserKey = sanitizeIdToken(raw.pageUserKey);
  if (pageUserKey) snap.pageUserKey = pageUserKey;

  const userHandle = sanitizeString(raw.userHandle, 80);
  if (userHandle) snap.userHandle = userHandle;
  const pageUserHandle = sanitizeString(raw.pageUserHandle, 80);
  if (pageUserHandle) snap.pageUserHandle = pageUserHandle;

  const userId = sanitizeUserId(raw.userId);
  if (userId != null) snap.userId = userId;

  const postId = sanitizeIdToken(raw.postId);
  if (postId) snap.postId = postId;
  const parentPostId = sanitizeIdToken(raw.parent_post_id);
  if (parentPostId) snap.parent_post_id = parentPostId;
  const rootPostId = sanitizeIdToken(raw.root_post_id);
  if (rootPostId) snap.root_post_id = rootPostId;

  if (typeof raw.created_at === 'string') {
    const createdAt = sanitizeString(raw.created_at, 64);
    if (createdAt) snap.created_at = createdAt;
  } else {
    const createdAtNum = sanitizeNumber(raw.created_at, 0);
    if (createdAtNum != null) snap.created_at = createdAtNum;
  }

  const url = sanitizeString(raw.url, 2048);
  if (url) snap.url = url;
  const thumb = sanitizeString(raw.thumb, 2048);
  if (thumb) snap.thumb = thumb;
  const caption = sanitizeString(raw.caption, 4096);
  if (caption) snap.caption = caption;

  const cameoUsernames = sanitizeCameoUsernames(raw.cameo_usernames);
  if (cameoUsernames) snap.cameo_usernames = cameoUsernames;

  const uv = sanitizeNumber(raw.uv, 0);
  if (uv != null) snap.uv = uv;
  const likes = sanitizeNumber(raw.likes, 0);
  if (likes != null) snap.likes = likes;
  const views = sanitizeNumber(raw.views, 0);
  if (views != null) snap.views = views;
  const comments = sanitizeNumber(raw.comments, 0);
  if (comments != null) snap.comments = comments;
  const remixes = sanitizeNumber(raw.remixes, 0);
  if (remixes != null) snap.remixes = remixes;
  const remixCount = sanitizeNumber(raw.remix_count, 0);
  if (remixCount != null) snap.remix_count = remixCount;
  const followers = sanitizeNumber(raw.followers, 0);
  if (followers != null) snap.followers = followers;
  const cameoCount = sanitizeNumber(raw.cameo_count, 0);
  if (cameoCount != null) snap.cameo_count = cameoCount;
  const duration = sanitizeNumber(raw.duration, 0, 60 * 60 * 10);
  if (duration != null) snap.duration = duration;
  const width = sanitizeNumber(raw.width, 1, 20000);
  if (width != null) snap.width = width;
  const height = sanitizeNumber(raw.height, 1, 20000);
  if (height != null) snap.height = height;

  const hasSignal = !!snap.postId || snap.followers != null || snap.cameo_count != null;
  return hasSignal ? snap : null;
}

function sanitizeMetricsBatch(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const limit = Math.min(items.length, MAX_MESSAGE_BATCH_ITEMS);
  for (let i = 0; i < limit; i++) {
    const snap = sanitizeMetricsSnapshot(items[i]);
    if (snap) out.push(snap);
  }
  return out;
}

function normalizeRequestScope(scope) {
  const s = sanitizeString(scope, 16);
  if (!s) return null;
  const normalized = s.toLowerCase();
  if (normalized === 'analyze' || normalized === 'post') return normalized;
  return null;
}

function normalizeSnapshotMode(mode) {
  const s = sanitizeString(mode, 16);
  return s && s.toLowerCase() === 'all' ? 'all' : 'latest';
}

function sanitizeMetricsRequest(message) {
  const scope = normalizeRequestScope(message?.scope);
  if (!scope) return null;
  if (scope === 'analyze') {
    return {
      scope,
      windowHours: sanitizeNumber(message?.windowHours, 1, 24) ?? 24,
      snapshotMode: 'latest',
      postId: null,
    };
  }
  const postId = sanitizeIdToken(message?.postId);
  if (!postId) return null;
  return {
    scope,
    postId,
    windowHours: null,
    snapshotMode: normalizeSnapshotMode(message?.snapshotMode),
  };
}

function isTrustedSender(sender) {
  if (!sender) return false;
  const tabUrl = String(sender.tab?.url || '');
  if (tabUrl) return TRUSTED_TAB_URL_RE.test(tabUrl);
  if (sender.id && sender.id === chrome.runtime.id) return true;
  const senderUrl = String(sender.url || '');
  return senderUrl.startsWith(chrome.runtime.getURL(''));
}

function trimSeriesInPlace(arr, maxPoints = MAX_PROFILE_SERIES_POINTS) {
  if (!Array.isArray(arr) || arr.length <= maxPoints) return;
  arr.splice(0, arr.length - maxPoints);
}

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

function cacheMetrics(rawMetrics, updatedAt, opts) {
  const normalized = normalizeMetrics(rawMetrics);
  metricsCache = normalized;
  metricsCacheUpdatedAt = Number(updatedAt) || 0;
  if (opts?.rebuildIndex !== false) {
    rebuildPostIndex(normalized);
  }
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

async function migrateStorageIfNeeded() {
  try {
    const stored = await chrome.storage.local.get([STORAGE_VERSION_KEY, METRICS_STORAGE_KEY]);
    if (stored[STORAGE_VERSION_KEY] === CURRENT_STORAGE_VERSION) return;
    const raw = stored[METRICS_STORAGE_KEY];
    if (!raw || !raw.users) {
      // No metrics to migrate, just stamp the version
      await chrome.storage.local.set({ [STORAGE_VERSION_KEY]: CURRENT_STORAGE_VERSION });
      return;
    }
    const coldShards = {};
    for (const [userKey, user] of Object.entries(raw.users)) {
      if (!user?.posts) continue;
      const shardData = {};
      let hasColdData = false;
      for (const [postId, post] of Object.entries(user.posts)) {
        if (!Array.isArray(post.snapshots) || post.snapshots.length <= 1) continue;
        // Copy full snapshot history to cold shard
        shardData[postId] = post.snapshots.slice(-MAX_SNAPSHOT_HISTORY_PER_POST);
        // Trim hot post to latest snapshot only
        post.snapshots = [post.snapshots[post.snapshots.length - 1]];
        hasColdData = true;
      }
      if (hasColdData) {
        coldShards[COLD_PREFIX + userKey] = shardData;
      }
    }
    const writePayload = {
      [METRICS_STORAGE_KEY]: raw,
      [STORAGE_VERSION_KEY]: CURRENT_STORAGE_VERSION,
      ...coldShards
    };
    await chrome.storage.local.set(writePayload);
    dlog('storage', 'migration v2 complete', { coldShards: Object.keys(coldShards).length });
  } catch (err) {
    try { console.warn('[SoraMetrics] migration failed', err); } catch {}
  }
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
  const scope = normalizeRequestScope(req?.scope);
  if (scope === 'analyze') {
    return buildAnalyzeMetrics(metrics, req?.windowHours);
  }
  if (scope === 'post') {
    const snapshotMode = req?.snapshotMode === 'all' ? 'all' : 'latest';
    return buildPostMetrics(metrics, req?.postId, snapshotMode);
  }
  return { users: {} };
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 750);
}

function scheduleColdWrite() {
  if (coldWriteTimer) return;
  coldWriteTimer = setTimeout(flushCold, COLD_DEBOUNCE_MS);
}

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
      let dirty = false;
      const touchedPosts = new Set();
      for (const snap of items) {
        const userKey = snap.userKey || snap.pageUserKey || 'unknown';
        if (!metrics.users[userKey]) {
          dirty = true;
        }
        const userEntry = metrics.users[userKey] || (metrics.users[userKey] = { handle: snap.userHandle || snap.pageUserHandle || null, id: snap.userId || null, posts: {}, followers: [], cameos: [] });
        if (!userEntry.posts || typeof userEntry.posts !== 'object' || Array.isArray(userEntry.posts)) userEntry.posts = {};
        if (!Array.isArray(userEntry.followers)) userEntry.followers = [];
        if (snap.postId) {
          postIdToUserKey.set(snap.postId, userKey);
          if (!userEntry.posts[snap.postId]) {
            dirty = true;
          }
          const post = userEntry.posts[snap.postId] || (userEntry.posts[snap.postId] = { url: snap.url || null, thumb: snap.thumb || null, snapshots: [] });
          touchedPosts.add(post);
          // Persist owner attribution on the post to allow dashboard integrity checks
          if (!post.ownerKey && (snap.userKey || snap.pageUserKey)) { post.ownerKey = snap.userKey || snap.pageUserKey; dirty = true; }
          if (!post.ownerHandle && (snap.userHandle || snap.pageUserHandle)) { post.ownerHandle = snap.userHandle || snap.pageUserHandle; dirty = true; }
          if (!post.ownerId && snap.userId != null) { post.ownerId = snap.userId; dirty = true; }
          if (!post.url && snap.url) { post.url = snap.url; dirty = true; }
          // Capture/refresh caption
          if (typeof snap.caption === 'string' && snap.caption) {
            if (!post.caption) { post.caption = snap.caption; dirty = true; }
            else if (post.caption !== snap.caption) { post.caption = snap.caption; dirty = true; }
          }
          // Capture/refresh cameo_usernames
          if (snap.cameo_usernames != null) {
            if (Array.isArray(snap.cameo_usernames) && snap.cameo_usernames.length > 0) {
              post.cameo_usernames = snap.cameo_usernames; dirty = true;
            } else if (!post.cameo_usernames) {
              // Only set to null/empty if it wasn't already set (preserve existing data)
              post.cameo_usernames = null;
            }
          }
          // Update thumbnail when a better/different one becomes available
          if (snap.thumb) {
            if (!post.thumb) {
              post.thumb = snap.thumb; dirty = true;
              dlog('thumbs', 'thumb set', { postId: snap.postId, thumb: post.thumb });
            } else if (post.thumb !== snap.thumb) {
              dlog('thumbs', 'thumb update', { postId: snap.postId, old: post.thumb, new: snap.thumb });
              post.thumb = snap.thumb; dirty = true;
            } else {
              dlog('thumbs', 'thumb unchanged', { postId: snap.postId, thumb: post.thumb });
            }
          } else {
            dlog('thumbs', 'thumb missing in snap', { postId: snap.postId });
          }
          if (!post.post_time && snap.created_at) { post.post_time = snap.created_at; dirty = true; } // Map creation time so dashboard can sort posts
          // Relationship fields for deriving direct remix counts across metrics
          if (snap.parent_post_id != null && post.parent_post_id !== snap.parent_post_id) { post.parent_post_id = snap.parent_post_id; dirty = true; }
          if (snap.root_post_id != null && post.root_post_id !== snap.root_post_id) { post.root_post_id = snap.root_post_id; dirty = true; }

          // IMPORTANT: Always update duration and dimensions at post level when available
          if (snap.duration != null) {
            const d = Number(snap.duration);
            if (Number.isFinite(d) && post.duration !== d) {
              const wasSet = post.duration != null;
              post.duration = d; dirty = true;
              if (DEBUG.storage) {
                dlog('storage', wasSet ? 'duration updated' : 'duration set', { postId: snap.postId, duration: d });
              }
            }
          }
          if (snap.width != null) {
            const w = Number(snap.width);
            if (Number.isFinite(w) && post.width !== w) { post.width = w; dirty = true; }
          }
          if (snap.height != null) {
            const h = Number(snap.height);
            if (Number.isFinite(h) && post.height !== h) { post.height = h; dirty = true; }
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
          };

          // Only add a new snapshot if engagement metrics changed
          const last = post.snapshots[post.snapshots.length - 1];
          const same = last && last.uv === s.uv && last.likes === s.likes && last.views === s.views &&
            last.comments === s.comments && last.remix_count === s.remix_count;

          if (!same) {
            post.snapshots.push(s);
            dirty = true;
            // Buffer for cold write
            if (!coldSnapshotBuffer.has(userKey)) coldSnapshotBuffer.set(userKey, new Map());
            const userBuf = coldSnapshotBuffer.get(userKey);
            if (!userBuf.has(snap.postId)) userBuf.set(snap.postId, []);
            userBuf.get(snap.postId).push(s);
            coldDirtyUsers.add(userKey);
          } else if (last && (last.duration !== s.duration || last.width !== s.width || last.height !== s.height)) {
            // If metrics are the same but duration/dimensions changed, update the last snapshot
            last.duration = s.duration;
            last.width = s.width;
            last.height = s.height;
            dirty = true;
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
              trimSeriesInPlace(arr);
              dirty = true;
              if (DEBUG.storage) dlog('storage', 'followers persisted', { userKey, count: fCount, t });
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
              trimSeriesInPlace(arr);
              dirty = true;
              if (DEBUG.storage) dlog('storage', 'cameos persisted', { userKey, count: cCount, t });
            }
          }
        }
      }
      if (!dirty) {
        dlog('storage', 'flush skip (no changes)', {});
        return;
      }
      try {
        // Trim only the touched hot posts to latest-snapshot-only before writing.
        for (const post of touchedPosts) {
          if (Array.isArray(post?.snapshots) && post.snapshots.length > 1) {
            post.snapshots = [post.snapshots[post.snapshots.length - 1]];
          }
        }

        const metricsUpdatedAt = Date.now();
        const currentUserCount = Object.keys(metrics.users || {}).length;
        const shouldWriteIndex = currentUserCount !== knownUserCount || (metricsUpdatedAt - lastUsersIndexWrite >= 30000);
        const payload = {
          [METRICS_STORAGE_KEY]: metrics,
          [METRICS_UPDATED_AT_KEY]: metricsUpdatedAt,
        };
        if (shouldWriteIndex) {
          payload[METRICS_USERS_INDEX_KEY] = Object.entries(metrics.users || {}).map(([key, user])=>({
            key,
            handle: user?.handle || null,
            id: user?.id || null,
            postCount: Object.keys(user?.posts || {}).length
          }));
          knownUserCount = currentUserCount;
          lastUsersIndexWrite = metricsUpdatedAt;
        }
        lastSelfWriteTs = metricsUpdatedAt;
        await chrome.storage.local.set(payload);
        metricsCache = metrics;
        metricsCacheUpdatedAt = metricsUpdatedAt;
        // Schedule cold shard writes if there are buffered snapshots
        if (coldDirtyUsers.size > 0) {
          scheduleColdWrite();
        }
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

async function flushCold() {
  coldWriteTimer = null;
  if (coldDirtyUsers.size === 0) return;
  // Check purge lock to prevent overwriting dashboard purge
  try {
    const { purgeLock } = await chrome.storage.local.get('purgeLock');
    if (purgeLock && Date.now() - purgeLock < 30000) {
      // Retry after a delay
      coldWriteTimer = setTimeout(flushCold, 2000);
      return;
    }
  } catch {}

  const dirtyKeys = Array.from(coldDirtyUsers);
  coldDirtyUsers.clear();

  try {
    // Read existing cold shards for dirty users
    const storageKeys = dirtyKeys.map(k => COLD_PREFIX + k);
    const existing = await chrome.storage.local.get(storageKeys);
    const writePayload = {};

    for (const userKey of dirtyKeys) {
      const shardKey = COLD_PREFIX + userKey;
      const existingShard = existing[shardKey] || {};
      const buffered = coldSnapshotBuffer.get(userKey);
      if (!buffered) continue;

      for (const [postId, newSnaps] of buffered.entries()) {
        if (!existingShard[postId]) {
          existingShard[postId] = [];
        }
        // Append buffered snapshots (dedup by timestamp)
        const existingTs = new Set(existingShard[postId].map(s => s.t));
        for (const s of newSnaps) {
          if (!existingTs.has(s.t)) {
            existingShard[postId].push(s);
          }
        }
        if (existingShard[postId].length > MAX_SNAPSHOT_HISTORY_PER_POST) {
          existingShard[postId] = existingShard[postId].slice(-MAX_SNAPSHOT_HISTORY_PER_POST);
        }
      }
      writePayload[shardKey] = existingShard;
      coldSnapshotBuffer.delete(userKey);
    }

    if (Object.keys(writePayload).length > 0) {
      await chrome.storage.local.set(writePayload);
      dlog('storage', 'cold flush complete', { shards: Object.keys(writePayload).length });
    }
  } catch (err) {
    // Re-mark as dirty so we retry
    for (const k of dirtyKeys) {
      if (coldSnapshotBuffer.has(k)) coldDirtyUsers.add(k);
    }
    try { console.warn('[SoraMetrics] cold flush failed', err); } catch {}
  }
}

/* ─── Message handlers ─── */

function openOrFocusDashboard(sendResponse) {
  const url = chrome.runtime.getURL('dashboard.html');
  chrome.tabs.query({ url: `${url}*` }, (tabs) => {
    const existing = Array.isArray(tabs) ? tabs[0] : null;
    if (existing?.id != null) {
      chrome.tabs.update(existing.id, { active: true }, () => {
        sendResponse({ success: true, tabId: existing.id, reused: true });
      });
      return;
    }
    chrome.tabs.create({ url }, (tab) => {
      sendResponse({ success: true, tabId: tab?.id ?? null, reused: false });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isPlainObject(message) || typeof message.action !== 'string') return false;
  if (!isTrustedSender(sender)) {
    if (message.action === 'metrics_request') {
      sendResponse({ metrics: { users: {} }, metricsUpdatedAt: 0 });
    }
    return false;
  }

  if (message.action === 'open_dashboard') {
    openOrFocusDashboard(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (message.action === 'metrics_batch') {
    const items = sanitizeMetricsBatch(message.items);
    if (items.length) {
      for (const it of items) PENDING.push(it);
      scheduleFlush();
    }
    return false; // fire-and-forget
  }

  if (message.action === 'metrics_request') {
    const request = sanitizeMetricsRequest(message);
    if (!request) {
      sendResponse({ metrics: { users: {} }, metricsUpdatedAt: 0 });
      return false;
    }
    (async () => {
      try {
        const { metrics } = await getMetricsState();
        const responseMetrics = buildMetricsForRequest(metrics, request);
        sendResponse({ metrics: responseMetrics, metricsUpdatedAt: metricsCacheUpdatedAt });
      } catch {
        sendResponse({ metrics: { users: {} }, metricsUpdatedAt: 0 });
      }
    })();
    return true; // async response
  }
  return false;
});

/* ─── Storage change listener (catches external writes like dashboard purge) ─── */

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes) return;
  // Broadcast ultra mode changes to all Sora content scripts so they never need
  // their own chrome.storage.onChanged listener (which would deserialize the full
  // metrics blob into every tab on every flush).
  if (Object.prototype.hasOwnProperty.call(changes, 'SCT_ULTRA_MODE_V1')) {
    chrome.tabs.query({ url: 'https://sora.chatgpt.com/*' }, (tabs) => {
      if (!tabs) return;
      for (const tab of tabs) {
        try { chrome.tabs.sendMessage(tab.id, { action: 'ultra_mode_changed' }); } catch {}
      }
    });
  }
  const hasMetrics = Object.prototype.hasOwnProperty.call(changes, METRICS_STORAGE_KEY);
  const hasUpdatedAt = Object.prototype.hasOwnProperty.call(changes, METRICS_UPDATED_AT_KEY);
  // Skip self-triggered writes — we already updated the cache in flush()
  if (hasUpdatedAt) {
    const incomingTs = Number(changes[METRICS_UPDATED_AT_KEY]?.newValue) || 0;
    if (lastSelfWriteTs && Math.abs(incomingTs - lastSelfWriteTs) < 100) {
      return;
    }
  }
  if (hasMetrics) {
    const nextMetrics = changes[METRICS_STORAGE_KEY]?.newValue;
    const nextUpdatedAt = hasUpdatedAt ? changes[METRICS_UPDATED_AT_KEY]?.newValue : metricsCacheUpdatedAt;
    cacheMetrics(nextMetrics, nextUpdatedAt);
  } else if (hasUpdatedAt) {
    const nextUpdatedAt = Number(changes[METRICS_UPDATED_AT_KEY]?.newValue) || 0;
    metricsCacheUpdatedAt = nextUpdatedAt || metricsCacheUpdatedAt;
  }
});

/* ─── Startup ─── */

// Run one-time migration from v1 (monolithic) to v2 (hot/cold split)
migrateStorageIfNeeded();
