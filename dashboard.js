/* Dashboard for Sora Metrics */
(function(){
  'use strict';

  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const TOP_TODAY_KEY = '__top_today__';
  const EVERYONE_LABEL = 'Top Today';
  const TOP_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const TOP_TODAY_MIN_UNIQUE_VIEWS = 100;
    const TOP_TODAY_MIN_LIKES = 15;
  const AUTO_REFRESH_MS = 60000;
  const CAMEO_KEY_PREFIX = 'c:';
  const ULTRA_MODE_STORAGE_KEY = 'SCT_ULTRA_MODE_V1';
  const ULTRA_MODE_TAP_COUNT = 5;
  const SITE_ORIGIN = 'https://sora.chatgpt.com';
  const DEFAULT_THUMB_URL = 'icons/logo.webp';
  const EXPIRED_THUMB_URLS_STORAGE_KEY = 'SCT_EXPIRED_THUMB_URLS_V1';
  const USABLE_THUMB_URLS_STORAGE_KEY = 'SCT_USABLE_THUMB_URLS_V1';
  const MAX_EXPIRED_THUMB_URLS = 2000;
  const MAX_USABLE_THUMB_URLS = 4000;
  const BLOCKED_THUMB_HOSTS = new Set(['ogimg.chatgpt.com']);
  const CUSTOM_FILTER_PREFIX = 'custom:';
  const absUrl = (u, pid) => {
    if (!u && pid) return `${SITE_ORIGIN}/p/${pid}`;
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return SITE_ORIGIN + u;
    return SITE_ORIGIN + '/' + u;
  };
  const isBlockedThumbUrl = (rawUrl) => {
    if (typeof rawUrl !== 'string' || !rawUrl) return false;
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return BLOCKED_THUMB_HOSTS.has(host);
    } catch {
      return false;
    }
  };
  const normalizePostThumbUrl = (raw) => {
    if (typeof raw !== 'string') return null;
    let value = raw.trim();
    if (!value) return null;
    value = value
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/\\u003a/gi, ':')
      .replace(/\\u002f/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&');
    if (!value || value.startsWith('data:')) return null;
    if (value.startsWith('//')) value = `https:${value}`;
    else if (value.startsWith('/')) value = `${SITE_ORIGIN}${value}`;
    if (!/^https?:\/\//i.test(value)) return null;
    if (isBlockedThumbUrl(value)) return null;
    return value;
  };
  const loadExpiredThumbUrls = () => {
    const out = new Set();
    try {
      const raw = localStorage.getItem(EXPIRED_THUMB_URLS_STORAGE_KEY);
      if (!raw) return out;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return out;
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry) out.add(entry);
      }
    } catch {}
    return out;
  };
  const expiredThumbUrls = loadExpiredThumbUrls();
  const loadUsableThumbUrls = () => {
    const out = new Set();
    try {
      const raw = localStorage.getItem(USABLE_THUMB_URLS_STORAGE_KEY);
      if (!raw) return out;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return out;
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry) out.add(entry);
      }
    } catch {}
    return out;
  };
  const usableThumbUrls = loadUsableThumbUrls();
  const thumbProbeState = new Map();
  const thumbValidationInflight = new Map();
  let thumbLazyObserver = null;
  const persistExpiredThumbUrls = () => {
    try {
      while (expiredThumbUrls.size > MAX_EXPIRED_THUMB_URLS) {
        const first = expiredThumbUrls.values().next().value;
        if (!first) break;
        expiredThumbUrls.delete(first);
      }
      localStorage.setItem(EXPIRED_THUMB_URLS_STORAGE_KEY, JSON.stringify(Array.from(expiredThumbUrls)));
    } catch {}
  };
  const persistUsableThumbUrls = () => {
    try {
      while (usableThumbUrls.size > MAX_USABLE_THUMB_URLS) {
        const first = usableThumbUrls.values().next().value;
        if (!first) break;
        usableThumbUrls.delete(first);
      }
      localStorage.setItem(USABLE_THUMB_URLS_STORAGE_KEY, JSON.stringify(Array.from(usableThumbUrls)));
    } catch {}
  };
  const markThumbUrlExpired = (url) => {
    if (!url || url === DEFAULT_THUMB_URL) return;
    thumbProbeState.set(url, 'bad');
    if (usableThumbUrls.delete(url)) persistUsableThumbUrls();
    if (!expiredThumbUrls.has(url)) {
      expiredThumbUrls.add(url);
      persistExpiredThumbUrls();
    }
  };
  const markThumbUrlUsable = (url) => {
    if (!url) return;
    thumbProbeState.set(url, 'ok');
    if (!usableThumbUrls.has(url)) {
      usableThumbUrls.add(url);
      persistUsableThumbUrls();
    }
    if (expiredThumbUrls.delete(url)) persistExpiredThumbUrls();
  };
  const getThumbDisplayChoice = (raw) => {
    const normalized = normalizePostThumbUrl(raw);
    if (!normalized || normalized === DEFAULT_THUMB_URL) {
      return { displayUrl: DEFAULT_THUMB_URL, sourceUrl: null };
    }
    if (expiredThumbUrls.has(normalized) || thumbProbeState.get(normalized) === 'bad') {
      return { displayUrl: DEFAULT_THUMB_URL, sourceUrl: null };
    }
    return { displayUrl: normalized, sourceUrl: normalized };
  };
  const setThumbBackgroundUrl = (thumbEl, url) => {
    if (!thumbEl) return;
    const next = typeof url === 'string' && url ? url : DEFAULT_THUMB_URL;
    thumbEl.style.backgroundImage = `url('${next.replace(/'/g,"%27")}')`;
  };
  const validateThumbUrl = (url) => {
    if (!url || url === DEFAULT_THUMB_URL) return Promise.resolve(true);
    if (isBlockedThumbUrl(url)) {
      markThumbUrlExpired(url);
      return Promise.resolve(false);
    }
    if (expiredThumbUrls.has(url) || thumbProbeState.get(url) === 'bad') return Promise.resolve(false);
    if (usableThumbUrls.has(url) || thumbProbeState.get(url) === 'ok') return Promise.resolve(true);
    const inflight = thumbValidationInflight.get(url);
    if (inflight) return inflight;
    thumbProbeState.set(url, 'pending');
    const pending = new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        thumbValidationInflight.delete(url);
        if (ok) markThumbUrlUsable(url);
        else markThumbUrlExpired(url);
        resolve(!!ok);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      try {
        img.src = url;
      } catch {
        finish(false);
      }
    });
    thumbValidationInflight.set(url, pending);
    return pending;
  };
  const loadThumbForElement = (thumbEl) => {
    if (!thumbEl) return;
    const desiredUrl = thumbEl.dataset.thumbDisplayUrl || '';
    const sourceUrl = thumbEl.dataset.thumbSourceUrl || '';
    if (!desiredUrl || !sourceUrl || desiredUrl === DEFAULT_THUMB_URL) {
      setThumbBackgroundUrl(thumbEl, DEFAULT_THUMB_URL);
      thumbEl.dataset.thumbLoaded = '1';
      thumbEl.dataset.thumbLoadedUrl = DEFAULT_THUMB_URL;
      return;
    }
    if (thumbEl.dataset.thumbLoaded === '1' && thumbEl.dataset.thumbLoadedUrl === desiredUrl) return;
    validateThumbUrl(sourceUrl).then((ok) => {
      if ((thumbEl.dataset.thumbSourceUrl || '') !== sourceUrl) return;
      const next = ok ? desiredUrl : DEFAULT_THUMB_URL;
      setThumbBackgroundUrl(thumbEl, next);
      thumbEl.dataset.thumbLoaded = '1';
      thumbEl.dataset.thumbLoadedUrl = next;
      const observer = ensureThumbLazyObserver();
      if (observer) observer.unobserve(thumbEl);
    }).catch(() => {
      if ((thumbEl.dataset.thumbSourceUrl || '') !== sourceUrl) return;
      markThumbUrlExpired(sourceUrl);
      setThumbBackgroundUrl(thumbEl, DEFAULT_THUMB_URL);
      thumbEl.dataset.thumbLoaded = '1';
      thumbEl.dataset.thumbLoadedUrl = DEFAULT_THUMB_URL;
      const observer = ensureThumbLazyObserver();
      if (observer) observer.unobserve(thumbEl);
    });
  };
  const ensureThumbLazyObserver = () => {
    if (thumbLazyObserver || typeof IntersectionObserver !== 'function') return thumbLazyObserver;
    thumbLazyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const thumbEl = entry?.target;
        if (!thumbEl) continue;
        if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
        thumbEl.dataset.thumbVisible = '1';
        loadThumbForElement(thumbEl);
      }
    }, { root: null, rootMargin: '300px 0px', threshold: 0.01 });
    return thumbLazyObserver;
  };
  const setThumbImageUrl = (thumbEl, url, sourceUrl = null) => {
    if (!thumbEl) return;
    const next = typeof url === 'string' && url ? url : DEFAULT_THUMB_URL;
    const nextSource = sourceUrl && sourceUrl !== DEFAULT_THUMB_URL ? sourceUrl : '';
    const unchanged = thumbEl.dataset.thumbDisplayUrl === next && thumbEl.dataset.thumbSourceUrl === nextSource;
    thumbEl.dataset.thumbDisplayUrl = next;
    thumbEl.dataset.thumbSourceUrl = nextSource;
    if (!nextSource) {
      setThumbBackgroundUrl(thumbEl, next);
      thumbEl.dataset.thumbLoaded = '1';
      thumbEl.dataset.thumbLoadedUrl = next;
      const observer = ensureThumbLazyObserver();
      if (observer) observer.unobserve(thumbEl);
      return;
    }
    if (unchanged) {
      if (thumbEl.dataset.thumbLoaded !== '1') {
        const observer = ensureThumbLazyObserver();
        if (observer) observer.observe(thumbEl);
        else loadThumbForElement(thumbEl);
      }
      return;
    }
    thumbEl.dataset.thumbLoaded = '0';
    thumbEl.dataset.thumbLoadedUrl = '';
    setThumbBackgroundUrl(thumbEl, DEFAULT_THUMB_URL);
    const observer = ensureThumbLazyObserver();
    if (observer) {
      observer.observe(thumbEl);
      if (thumbEl.dataset.thumbVisible === '1') loadThumbForElement(thumbEl);
    } else {
      loadThumbForElement(thumbEl);
    }
  };
  const COLORS = [
    '#7dc4ff','#ff8a7a','#ffd166','#95e06c','#c792ea','#64d3ff','#ffa7c4','#9fd3c7','#f6bd60','#84a59d','#f28482',
    '#ffe066','#b7ff5a','#6ff5c7','#54e6ff','#6aaeff','#b08bff','#ff66d4','#ff7aa2','#e2c08c'
  ];
  let paletteOffset = 0;
  let basePaletteOffset = 0;
  const THEME_STORAGE_KEY = 'SCT_DASHBOARD_THEME_V1';
  const THEME_TOGGLE_SEEN_KEY = 'SCT_THEME_TOGGLE_SEEN_V1';
  const THEME_PRESETS = {
    red: { label: 'Red', accent: '#ff6b6b', accentStrong: '#ff9b93', accentRgb: '255,107,107' },
    orange: { label: 'Orange', accent: '#ff9f43', accentStrong: '#ffbf7a', accentRgb: '255,159,67' },
    gold: { label: 'Gold', accent: '#ffcf8f', accentStrong: '#ffe1b5', accentRgb: '255,207,143' },
    lemon: { label: 'Lemon', accent: '#ffe066', accentStrong: '#ffe994', accentRgb: '255,224,102' },
    lime: { label: 'Lime', accent: '#b7ff5a', accentStrong: '#cdff8c', accentRgb: '183,255,90' },
    green: { label: 'Green', accent: '#9eea6a', accentStrong: '#c1f28f', accentRgb: '158,234,106' },
    mint: { label: 'Mint', accent: '#6ff5c7', accentStrong: '#9af8d8', accentRgb: '111,245,199' },
    teal: { label: 'Teal', accent: '#5fe0d7', accentStrong: '#8cf0e9', accentRgb: '95,224,215' },
    cyan: { label: 'Cyan', accent: '#54e6ff', accentStrong: '#87eeff', accentRgb: '84,230,255' },
    blue: { label: 'Blue', accent: '#7dc4ff', accentStrong: '#9ad5ff', accentRgb: '125,196,255' },
    sky: { label: 'Sky', accent: '#6aaeff', accentStrong: '#97c6ff', accentRgb: '106,174,255' },
    indigo: { label: 'Indigo', accent: '#9a7cff', accentStrong: '#b6a1ff', accentRgb: '154,124,255' },
    violet: { label: 'Violet', accent: '#b08bff', accentStrong: '#c8aeff', accentRgb: '176,139,255' },
    magenta: { label: 'Magenta', accent: '#ff66d4', accentStrong: '#ff94e1', accentRgb: '255,102,212' },
    pink: { label: 'Pink', accent: '#ff8fd3', accentStrong: '#ffb6e7', accentRgb: '255,143,211' },
    rose: { label: 'Rose', accent: '#ff7aa2', accentStrong: '#ffa2be', accentRgb: '255,122,162' },
    sand: { label: 'Sand', accent: '#e2c08c', accentStrong: '#ebd3ae', accentRgb: '226,192,140' },
    gray: { label: 'Gray', accent: '#c9d1d9', accentStrong: '#e4e9ef', accentRgb: '201,209,217' },
    darkRed: { label: 'Dark Red', accent: '#c44545', accentStrong: '#e07a7a', accentRgb: '196,69,69' },
    darkOrange: { label: 'Dark Orange', accent: '#c26a2a', accentStrong: '#e49857', accentRgb: '194,106,42' },
    darkGold: { label: 'Dark Gold', accent: '#c8a042', accentStrong: '#e0bc5e', accentRgb: '200,160,66' },
    darkLime: { label: 'Dark Lime', accent: '#5aa83a', accentStrong: '#8cc275', accentRgb: '90,168,58' },
    darkGreen: { label: 'Dark Green', accent: '#39ff14', accentStrong: '#7bff5f', accentRgb: '57,255,20' },
    darkMint: { label: 'Dark Mint', accent: '#1f8f6f', accentStrong: '#62b19a', accentRgb: '31,143,111' },
    darkTeal: { label: 'Dark Teal', accent: '#1f9c8a', accentStrong: '#45b9aa', accentRgb: '31,156,138' },
    darkCyan: { label: 'Dark Cyan', accent: '#1a7f9b', accentStrong: '#5fa5b9', accentRgb: '26,127,155' },
    darkCopper: { label: 'Dark Copper', accent: '#8b5a3b', accentStrong: '#ae8c76', accentRgb: '139,90,59' },
    darkBlue: { label: 'Dark Blue', accent: '#2f6fb3', accentStrong: '#5c8fca', accentRgb: '47,111,179' },
    darkSky: { label: 'Dark Sky', accent: '#2b5c9c', accentStrong: '#6b8dba', accentRgb: '43,92,156' },
    darkIndigo: { label: 'Dark Indigo', accent: '#4d2f7a', accentStrong: '#6e4aa6', accentRgb: '77,47,122' },
    darkViolet: { label: 'Dark Violet', accent: '#5c3a8f', accentStrong: '#8d75b1', accentRgb: '92,58,143' },
    darkMagenta: { label: 'Dark Magenta', accent: '#9b3d86', accentStrong: '#b977aa', accentRgb: '155,61,134' },
    darkPink: { label: 'Dark Pink', accent: '#b64b8f', accentStrong: '#d476b4', accentRgb: '182,75,143' },
    darkRose: { label: 'Dark Rose', accent: '#a3465d', accentStrong: '#bf7e8e', accentRgb: '163,70,93' },
    darkSlate: { label: 'Dark Slate', accent: '#5b6b7a', accentStrong: '#8c97a2', accentRgb: '91,107,122' },
    darkGray: { label: 'Dark Gray', accent: '#8d949c', accentStrong: '#aeb5bd', accentRgb: '141,148,156' }
  };
  const THEME_ALIASES = { amber: 'gold', rose: 'red', violet: 'indigo', grey: 'gray', deepPurple: 'indigo', darkPurple: 'darkPink', yellow: 'lemon', limegreen: 'lime', aqua: 'cyan', turquoise: 'cyan', skyblue: 'sky', purple: 'violet', fuchsia: 'magenta', beige: 'sand', copper: 'darkCopper', slate: 'darkSlate' };
  const BASE_RGB = {
    bg: [10,15,20],
    'bg-deep': [7,11,16],
    'bg-alt': [10,14,19],
    'bg-dark': [8,12,16],
    'bg-ultra': [6,10,14],
    panel: [18,25,38],
    'panel-strong': [24,33,49],
    'panel-deep': [12,16,22],
    'panel-mid': [12,18,26],
    'panel-soft': [20,28,40],
    'panel-soft-alt': [20,28,38],
    'panel-hover': [22,30,42],
    'panel-edge': [24,34,46],
    surface: [16,22,31],
    'surface-strong': [18,26,36],
    'bg-subtle': [18,24,32],
    chip: [18,26,36]
  };
  const BASE_TINT = {
    bg: 0.12,
    'bg-deep': 0.1,
    'bg-alt': 0.12,
    'bg-dark': 0.1,
    'bg-ultra': 0.09,
    panel: 0.08,
    'panel-strong': 0.08,
    'panel-deep': 0.07,
    'panel-mid': 0.07,
    'panel-soft': 0.08,
    'panel-soft-alt': 0.08,
    'panel-hover': 0.08,
    'panel-edge': 0.08,
    surface: 0.09,
    'surface-strong': 0.09,
    'bg-subtle': 0.1,
    chip: 0.09
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SIDEBAR_WIDTH_KEY = 'SCT_DASHBOARD_SIDEBAR_WIDTH';
  const SIDEBAR_MIN_WIDTH = 260;
  const SIDEBAR_MAX_WIDTH = 620;
  const USERS_INDEX_STORAGE_KEY = 'metricsUsersIndex';
  const SESSION_CACHE_KEY = 'SCT_DASHBOARD_CACHE_V1';
  const SESSION_CACHE_MAX_BYTES = 4 * 1024 * 1024;
  const BOOT_CACHE_KEY = 'SCT_DASHBOARD_BOOT_CACHE_V1';
  const BOOT_CACHE_MAX_BYTES = 350 * 1024;
  const BEST_TIME_CACHE_KEY = 'SCT_DASHBOARD_BEST_TIME_V2';
  const BEST_TIME_PREFS_KEY = 'SCT_DASHBOARD_BEST_TIME_PREFS_V1';
  const VIEWS_TYPE_STORAGE_KEY = 'SCT_DASHBOARD_VIEWS_TYPE_V1';
  const CHART_MODE_STORAGE_KEY = 'SCT_DASHBOARD_CHART_MODE_V1';
  const STACKED_WINDOW_STORAGE_KEYS = {
    interaction: 'SCT_DASHBOARD_STACKED_WINDOW_INTERACTION_V1',
    views: 'SCT_DASHBOARD_STACKED_WINDOW_VIEWS_V1',
    viewsPerPerson: 'SCT_DASHBOARD_STACKED_WINDOW_VPP_V1'
  };
  const STACKED_WINDOW_STORAGE_MIN_KEYS = {
    interaction: 'SCT_DASHBOARD_STACKED_WINDOW_INTERACTION_MIN_V1',
    views: 'SCT_DASHBOARD_STACKED_WINDOW_VIEWS_MIN_V1',
    viewsPerPerson: 'SCT_DASHBOARD_STACKED_WINDOW_VPP_MIN_V1'
  };
  const LEGACY_CHART_MODE_KEYS = {
    interaction: 'SCT_DASHBOARD_INTERACTION_MODE_V1',
    views: 'SCT_DASHBOARD_VIEWS_MODE_V1',
    viewsPerPerson: 'SCT_DASHBOARD_VIEWS_PER_PERSON_MODE_V1'
  };
  const INTERACTION_RATE_DEFAULT_ZOOM_Y_MAX = 15;
  const STACKED_WINDOW_MINUTES_DEFAULT = 24 * 60;
  const STACKED_WINDOW_MINUTES_MAX = 15 * 24 * 60;
  const STACKED_WINDOW_MIN_GAP_MINUTES = 60;
  const COLD_PREFIX = 'snapshots_';
  let metrics = { users: {} };
  let lastMetricsUpdatedAt = 0;
  let usersIndex = null;
  let isMetricsPartial = false;
  let snapshotsHydrated = false;
  let snapshotsHydrationEpoch = 0;
  let snapshotsHydrationPromise = null;
  let lastSessionCacheAt = 0;
  let currentUserKey = null;
  let lastSelectedUserKey = null;
  let nextAutoRefreshAt = 0;
  let autoRefreshCountdownTimer = null;
  let cameoSuggestionCache = { updatedAt: -1, userCount: -1, list: [] };
  let cameoUserCache = { updatedAt: -1, users: new Map() };
  let postHydrationToken = 0;
  let isHydratingPosts = false;
  let metricsHydrationToken = 0;
  let isHydratingMetrics = false;
  const ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  const esc = (s)=> String(s).replace(/[&<>"']/g, (c)=> ESC_MAP[c] || c);
  const PERF_STORAGE_KEY = 'SCT_DASHBOARD_PERF';
  const PERF_STORAGE_AUTO_KEY = 'SCT_DASHBOARD_PERF_AUTO';
  const PERF_ENABLED = (function(){
    try { return localStorage.getItem(PERF_STORAGE_KEY) === '1'; } catch { return false; }
  })();
  const cacheLog = ()=>{};
  const PERF_AUTO_ENABLED = (function(){
    try { return localStorage.getItem(PERF_STORAGE_AUTO_KEY) === '1'; } catch { return false; }
  })();
  const perfMarks = [];
  const perfStart = (name)=>{
    if (!PERF_ENABLED || typeof performance === 'undefined') return null;
    return { name, t: performance.now() };
  };
  const perfEnd = (mark)=>{
    if (!PERF_ENABLED || !mark || typeof performance === 'undefined') return;
    const ms = performance.now() - mark.t;
    perfMarks.push({ step: mark.name, ms: Math.round(ms * 10) / 10 });
  };
  const perfFlush = (label, log = true)=>{
    if (!PERF_ENABLED) return;
    perfMarks.length = 0;
  };
  const SNAP_DEBUG_STORAGE_KEY = 'SCT_DASHBOARD_SNAPSHOT_DEBUG';
  const SNAP_DEBUG_ENABLED = (function(){
    try {
      const raw = localStorage.getItem(SNAP_DEBUG_STORAGE_KEY);
      if (raw == null) return false;
      const norm = String(raw).trim().toLowerCase();
      return norm === '1' || norm === 'true' || norm === 'yes' || norm === 'on' || norm === 'all';
    } catch {
      return false;
    }
  })();
  let snapDebugSeq = 0;
  function summarizeUserSnapshots(user){
    const posts = Object.values(user?.posts || {});
    const out = {
      postCount: posts.length,
      postsWithSnapshots: 0,
      postsWithHistory: 0,
      latestOnlyPosts: 0,
      totalSnapshots: 0,
      minSnapshots: 0,
      maxSnapshots: 0
    };
    let minSnapshots = Infinity;
    for (const post of posts){
      const count = Array.isArray(post?.snapshots) ? post.snapshots.length : 0;
      if (!count) continue;
      out.postsWithSnapshots++;
      out.totalSnapshots += count;
      if (count > 1) out.postsWithHistory++;
      else out.latestOnlyPosts++;
      if (count < minSnapshots) minSnapshots = count;
      if (count > out.maxSnapshots) out.maxSnapshots = count;
    }
    out.minSnapshots = Number.isFinite(minSnapshots) ? minSnapshots : 0;
    return out;
  }
  function summarizeMetricsSnapshots(inputMetrics){
    const users = inputMetrics?.users || {};
    const out = { userCount: 0, postCount: 0, totalSnapshots: 0, postsWithHistory: 0, latestOnlyPosts: 0 };
    for (const user of Object.values(users)){
      out.userCount++;
      const summary = summarizeUserSnapshots(user);
      out.postCount += summary.postCount;
      out.totalSnapshots += summary.totalSnapshots;
      out.postsWithHistory += summary.postsWithHistory;
      out.latestOnlyPosts += summary.latestOnlyPosts;
    }
    return out;
  }
  function summarizeColdPayload(payload){
    const out = { shardCount: 0, postCount: 0, snapshotCount: 0 };
    for (const shard of Object.values(payload || {})){
      out.shardCount++;
      for (const snaps of Object.values(shard || {})){
        out.postCount++;
        out.snapshotCount += Array.isArray(snaps) ? snaps.length : 0;
      }
    }
    return out;
  }
  function snapLog(event, details = {}){
    if (!SNAP_DEBUG_ENABLED) return;
    try {
      console.log('[SCT][snap]', {
        seq: ++snapDebugSeq,
        at: new Date().toISOString(),
        event,
        ...details
      });
    } catch {}
  }
  snapLog('debug:enabled', {
    storageKey: SNAP_DEBUG_STORAGE_KEY,
    hint: `localStorage.setItem('${SNAP_DEBUG_STORAGE_KEY}','1') to enable`
  });
  function invalidateSnapshotHydration(reason, details = {}){
    const wasHydrated = snapshotsHydrated;
    snapshotsHydrated = false;
    snapshotsHydrationEpoch += 1;
    snapLog('snapshotsHydration:invalidated', {
      reason,
      wasHydrated,
      snapshotsHydrationEpoch,
      ...details
    });
  }
  const nextPaint = ()=> new Promise((resolve)=>{
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  const PRUNE_THROTTLE_MS = 5 * 60 * 1000;
  const lastPruneAtByUser = new Map();

  function buildUsersIndexFromMetrics(metrics){
    const out = [];
    for (const [key, user] of Object.entries(metrics?.users || {})){
      const postCount = Object.keys(user?.posts || {}).length;
      out.push({ key, handle: user?.handle || null, id: user?.id || null, postCount });
    }
    return out;
  }

  function normalizeUsersIndex(raw){
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (const entry of raw){
      if (!entry || typeof entry !== 'object') continue;
      const key = typeof entry.key === 'string' ? entry.key : null;
      if (!key) continue;
      const postCount = Number(entry.postCount);
      out.push({
        key,
        handle: typeof entry.handle === 'string' ? entry.handle : null,
        id: entry.id != null ? String(entry.id) : null,
        postCount: Number.isFinite(postCount) ? postCount : 0
      });
    }
    return out;
  }

  function findUserIndexEntry(userKey){
    if (!userKey || !Array.isArray(usersIndex)) return null;
    return usersIndex.find((entry)=> entry.key === userKey) || null;
  }

  function normalizeDashboardCache(cache){
    if (!cache || typeof cache !== 'object') return null;
    if (!cache.userKey || !cache.user || !cache.usersIndex) return null;
    const index = normalizeUsersIndex(cache.usersIndex);
    if (!index || !index.length) return null;
    const bestTimeData = normalizeBestTimeData(cache?.bestTime?.data);
    const bestTime = bestTimeData ? {
      data: bestTimeData,
      metricsUpdatedAt: Number(cache?.bestTime?.metricsUpdatedAt) || 0,
      savedAt: Number(cache?.bestTime?.savedAt) || 0
    } : null;
    return {
      userKey: cache.userKey,
      user: cache.user,
      usersIndex: index,
      metricsUpdatedAt: Number(cache.metricsUpdatedAt) || 0,
      bestTime
    };
  }

  function loadSessionCache(){
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      return normalizeDashboardCache(cache);
    } catch {
      return null;
    }
  }

  function loadBootCache(){
    try {
      const raw = localStorage.getItem(BOOT_CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      return normalizeDashboardCache(cache);
    } catch {
      return null;
    }
  }

  function loadInstantCache(){
    return loadSessionCache() || loadBootCache();
  }

  function trackLastSelectedUserKey(){
    if (!currentUserKey || isTopTodayKey(currentUserKey)) return;
    lastSelectedUserKey = currentUserKey;
  }

  function resolveCacheUserKeyForSave(){
    if (currentUserKey) return currentUserKey;
    if (lastSelectedUserKey && !isTopTodayKey(lastSelectedUserKey)) return lastSelectedUserKey;
    return null;
  }

  function buildBootUsersIndex(cache, user){
    const key = cache?.userKey;
    if (!key) return [];
    const fallbackUser = user || cache?.user || {};
    const existing = Array.isArray(cache?.usersIndex)
      ? cache.usersIndex.find((entry)=> entry && entry.key === key)
      : null;
    const handle = existing?.handle || fallbackUser.handle || (key.startsWith('h:') ? key.slice(2) : null);
    const id = existing?.id ?? fallbackUser.id ?? (key.startsWith('id:') ? key.slice(3) : null);
    const postCount = Number(existing?.postCount);
    const count = Number.isFinite(postCount) ? postCount : Object.keys(fallbackUser.posts || {}).length;
    return [{
      key,
      handle: handle || null,
      id: id != null ? String(id) : null,
      postCount: count
    }];
  }

  function buildBootCache(cache){
    if (!cache || typeof cache !== 'object') return null;
    const user = cache.user;
    if (!user || typeof user !== 'object') return null;
    const slimPostForBoot = (post)=>{
      if (!post || typeof post !== 'object') return null;
      const out = {};
      if (typeof post.url === 'string') out.url = post.url;
      if (typeof post.thumb === 'string') out.thumb = post.thumb;
      if (typeof post.caption === 'string') {
        out.caption = post.caption.length > 320 ? post.caption.slice(0, 320) : post.caption;
      }
      if (Array.isArray(post.cameos)) out.cameos = post.cameos.slice(0, 12);
      if (post.post_time != null) out.post_time = post.post_time;
      if (post.ownerKey) out.ownerKey = post.ownerKey;
      if (post.ownerHandle) out.ownerHandle = post.ownerHandle;
      if (post.ownerId) out.ownerId = post.ownerId;
      if (post.lastSeen) out.lastSeen = post.lastSeen;
      if (post.parentPostId) out.parentPostId = post.parentPostId;
      if (post.rootPostId) out.rootPostId = post.rootPostId;
      return out;
    };
    const posts = {};
    for (const [pid, post] of Object.entries(user.posts || {})){
      if (!post || typeof post !== 'object') continue;
      const slim = slimPostForBoot(post);
      if (!slim) continue;
      const last = latestSnapshot(post.snapshots);
      const next = { ...slim };
      if (last) next.snapshots = [last];
      else if (Array.isArray(next.snapshots)) next.snapshots = [];
      posts[pid] = next;
    }
    const liteUser = { posts };
    if (typeof user.handle === 'string') liteUser.handle = user.handle;
    if (user.id != null) liteUser.id = user.id;
    if (Array.isArray(user.followers)) liteUser.followers = user.followers.slice(-1);
    if (Array.isArray(user.cameos)) liteUser.cameos = user.cameos.slice(-1);
    if (user.__specialKey) liteUser.__specialKey = user.__specialKey;
    const bootUsersIndex = buildBootUsersIndex(cache, liteUser);
    if (!bootUsersIndex.length) return null;
    return { ...cache, user: liteUser, usersIndex: bootUsersIndex };
  }

  function safeStringifyCache(value){
    try { return JSON.stringify(value); } catch {}
    try {
      return JSON.stringify(value, (_key, v)=>{
        if (typeof v === 'bigint') return v.toString();
        if (typeof v === 'function') return undefined;
        return v;
      });
    } catch {
      return null;
    }
  }

  function trimUsersIndexForBoot(cache){
    const list = Array.isArray(cache?.usersIndex) ? cache.usersIndex : null;
    if (!list || list.length <= 1) return;
    const key = cache.userKey;
    let entry = key ? list.find((it)=> it && it.key === key) : null;
    if (!entry) entry = list[0] || null;
    if (!entry) return;
    cache.usersIndex = [entry];
  }

  function shrinkBootCacheToFit(cache, maxBytes){
    if (!cache || !cache.user) return null;
    if (!cache.user.posts || typeof cache.user.posts !== 'object') cache.user.posts = {};
    const initialJson = safeStringifyCache(cache);
    if (!initialJson) {
      cacheLog('boot cache stringify failed');
      return null;
    }
    if (initialJson.length <= maxBytes) return cache;
    cacheLog('boot cache oversized', { bytes: initialJson.length, maxBytes });
    if (Array.isArray(cache.usersIndex) && cache.usersIndex.length > 1) {
      const before = cache.usersIndex.length;
      trimUsersIndexForBoot(cache);
      const indexJson = safeStringifyCache(cache);
      if (indexJson && indexJson.length <= maxBytes) {
        cacheLog('boot cache trimmed usersIndex', { before, after: cache.usersIndex.length });
        return cache;
      }
    }
    const entries = Object.entries(cache.user.posts || {});
    if (!entries.length) return cache;
    entries.sort((a, b) => {
      const at = latestSnapshot(a[1]?.snapshots)?.t || 0;
      const bt = latestSnapshot(b[1]?.snapshots)?.t || 0;
      return bt - at;
    });
    const trimmedUser = { ...cache.user, posts: {} };
    const trimmedCache = { ...cache, user: trimmedUser };
    for (const [pid, post] of entries) {
      trimmedUser.posts[pid] = post;
      const json = safeStringifyCache(trimmedCache);
      if (!json) {
        delete trimmedUser.posts[pid];
        break;
      }
      if (json.length > maxBytes) {
        delete trimmedUser.posts[pid];
        break;
      }
    }
    const kept = Object.keys(trimmedUser.posts).length;
    if (!kept) {
      cacheLog('boot cache trimmed to empty posts');
      trimmedUser.posts = {};
      return trimmedCache;
    }
    return trimmedCache;
  }

  function saveSessionCache(opts = {}){
    try {
      const force = !!opts.force;
      const cacheUserKey = resolveCacheUserKeyForSave();
      if (!cacheUserKey) {
        cacheLog('skip: no cache user', { currentUserKey, lastSelectedUserKey });
        return;
      }
      const user = resolveUserForKey(metrics, cacheUserKey);
      if (!user) {
        cacheLog('skip: user missing', { cacheUserKey });
        return;
      }
      if (!Array.isArray(usersIndex) || !usersIndex.length) {
        usersIndex = buildUsersIndexFromMetrics(metrics);
      }
      const normalizedBestTime = normalizeBestTimeData(bestTimeData);
      const bestTime = normalizedBestTime ? {
        data: normalizedBestTime,
        metricsUpdatedAt: lastBestTimeMetricsUpdatedAt || lastMetricsUpdatedAt || 0,
        savedAt: lastBestTimeUpdate || 0
      } : null;
      const cache = {
        userKey: cacheUserKey,
        user,
        usersIndex,
        metricsUpdatedAt: lastMetricsUpdatedAt || 0,
        savedAt: Date.now(),
        bestTime
      };
      const json = JSON.stringify(cache);
      const now = Date.now();
      if (!force && now - lastSessionCacheAt < 5000) {
        cacheLog('skip: throttle', { deltaMs: now - lastSessionCacheAt });
        return;
      }
      lastSessionCacheAt = now;
      if (json.length <= SESSION_CACHE_MAX_BYTES) {
        try { sessionStorage.setItem(SESSION_CACHE_KEY, json); } catch {}
      } else {
        cacheLog('session cache too large', { bytes: json.length });
      }
      try {
        const bootCache = buildBootCache(cache);
        if (!bootCache) {
          cacheLog('boot cache build failed');
        }
        const trimmedBootCache = bootCache ? shrinkBootCacheToFit(bootCache, BOOT_CACHE_MAX_BYTES) : null;
        if (!trimmedBootCache) {
          cacheLog('boot cache trimmed to null');
          localStorage.removeItem(BOOT_CACHE_KEY);
          return;
        }
        const bootJson = safeStringifyCache(trimmedBootCache);
        if (!bootJson) {
          cacheLog('boot cache stringify failed at save');
          localStorage.removeItem(BOOT_CACHE_KEY);
          return;
        }
        localStorage.setItem(BOOT_CACHE_KEY, bootJson);
        cacheLog('boot cache saved', {
          bytes: bootJson.length,
          userKey: trimmedBootCache.userKey,
          postCount: Object.keys(trimmedBootCache?.user?.posts || {}).length
        });
      } catch {}
    } catch {}
  }

  function normalizeBestTimeHeatmap(raw){
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.matrix)) return null;
    const matrix = raw.matrix
      .slice(0, 7)
      .map((row)=>{
        if (!Array.isArray(row)) return [];
        return row.slice(0, 24).map((v)=> Number(v) || 0);
      });
    if (!matrix.length) return null;
    const out = { matrix };
    if (Array.isArray(raw.counts)) {
      const counts = raw.counts
        .slice(0, 7)
        .map((row)=>{
          if (!Array.isArray(row)) return [];
          return row.slice(0, 24).map((v)=> Math.max(0, Math.floor(Number(v) || 0)));
        });
      out.counts = counts;
    }
    if (Array.isArray(raw.avgLikes)) {
      const avgLikes = raw.avgLikes
        .slice(0, 7)
        .map((row)=>{
          if (!Array.isArray(row)) return [];
          return row.slice(0, 24).map((v)=> Number(v) || 0);
        });
      out.avgLikes = avgLikes;
    }
    const max = Number(raw.max);
    const min = Number(raw.min);
    if (Number.isFinite(max)) out.max = max;
    if (Number.isFinite(min)) out.min = min;
    return out;
  }

  function normalizeBestTimeEntry(raw){
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    if (raw.primary && typeof raw.primary === 'object') out.primary = raw.primary;
    if (raw.secondary && typeof raw.secondary === 'object') out.secondary = raw.secondary;
    const heatmap = normalizeBestTimeHeatmap(raw.heatmap);
    if (heatmap) out.heatmap = heatmap;
    if (!out.primary && !out.secondary && !out.heatmap) return null;
    return out;
  }

  function normalizeBestTimeData(raw){
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    let hasAny = false;
    ['year', 'month', 'week'].forEach((range)=>{
      const entry = normalizeBestTimeEntry(raw[range]);
      if (entry) {
        out[range] = entry;
        hasAny = true;
      } else {
        out[range] = null;
      }
    });
    return hasAny ? out : null;
  }

  function loadBestTimeCache(){
    try {
      const raw = localStorage.getItem(BEST_TIME_CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      const data = normalizeBestTimeData(cache?.data);
      if (!data) return null;
      return {
        data,
        metricsUpdatedAt: Number(cache?.metricsUpdatedAt) || 0,
        savedAt: Number(cache?.savedAt) || 0
      };
    } catch {
      return null;
    }
  }

  function saveBestTimeCache(data){
    try {
      if (!data || typeof data !== 'object') return;
      const payload = {
        data,
        metricsUpdatedAt: lastBestTimeMetricsUpdatedAt || lastMetricsUpdatedAt || 0,
        savedAt: Date.now()
      };
      localStorage.setItem(BEST_TIME_CACHE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function normalizeBestTimePrefs(raw){
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    if (['week', 'month', 'year'].includes(raw?.range)) out.range = raw.range;
    if (['primary', 'secondary', 'today'].includes(raw?.rec)) out.rec = raw.rec;
    return Object.keys(out).length ? out : null;
  }

  function loadBestTimePrefs(){
    try {
      const raw = localStorage.getItem(BEST_TIME_PREFS_KEY);
      if (raw) return normalizeBestTimePrefs(JSON.parse(raw));
    } catch {}
    return normalizeBestTimePrefs(bestTimePrefsFromStorage);
  }

  function saveBestTimePrefs(){
    const payload = {
      range: bestTimeRange,
      rec: bestTimeRec,
      savedAt: Date.now()
    };
    try { localStorage.setItem(BEST_TIME_PREFS_KEY, JSON.stringify(payload)); } catch {}
    try { chrome.storage.local.set({ [BEST_TIME_PREFS_KEY]: payload }); } catch {}
    bestTimePrefsLoaded = true;
    bestTimePrefsFromStorage = normalizeBestTimePrefs(payload);
  }

  function normalizeViewsChartType(raw){
    return raw === 'unique' || raw === 'total' ? raw : null;
  }

  function loadViewsChartType(){
    try { return normalizeViewsChartType(localStorage.getItem(VIEWS_TYPE_STORAGE_KEY)); } catch { return null; }
  }

  function saveViewsChartType(type){
    const normalized = normalizeViewsChartType(type);
    if (!normalized) return;
    try { localStorage.setItem(VIEWS_TYPE_STORAGE_KEY, normalized); } catch {}
    try { chrome.storage.local.set({ [VIEWS_TYPE_STORAGE_KEY]: normalized }); } catch {}
  }

  function normalizeChartMode(raw){
    return raw === 'linear' || raw === 'stacked' ? raw : null;
  }

  function loadChartMode(key){
    try { return normalizeChartMode(localStorage.getItem(key)); } catch { return null; }
  }

  function saveChartMode(key, mode){
    const normalized = normalizeChartMode(mode);
    if (!normalized) return;
    try { localStorage.setItem(key, normalized); } catch {}
    try { chrome.storage.local.set({ [key]: normalized }); } catch {}
  }

  function resolveLegacyChartMode(legacyModes){
    const modes = [
      normalizeChartMode(legacyModes?.interaction),
      normalizeChartMode(legacyModes?.views),
      normalizeChartMode(legacyModes?.viewsPerPerson)
    ].filter(Boolean);
    if (!modes.length) return null;
    const first = modes[0];
    return modes.every((mode)=>mode === first) ? first : null;
  }

  let lastBestTimeUpdate = 0;
  let lastBestTimeMetricsUpdatedAt = 0;
  let bestTimeData = null;
  let bestTimeRange = 'year';
  let bestTimeRec = 'primary';
  let bestTimePrefsFromStorage = null;
  let bestTimePrefsLoaded = false;
  let bestTimeHeatmapTooltip = null;
  let bestTimeInfoTooltip = null;
  let bestTimeRefreshInFlight = false;
  let bestTimeRefreshQueued = false;

  function hydrateBestTimeFromCache(sessionCache){
    try {
      const prefs = loadBestTimePrefs();
      bestTimePrefsLoaded = !!prefs;
      if (prefs?.range) bestTimeRange = prefs.range;
      if (prefs?.rec) bestTimeRec = prefs.rec;
      const cachedBestTime = sessionCache?.bestTime?.data ? sessionCache.bestTime : loadBestTimeCache();
      if (cachedBestTime?.data) {
        bestTimeData = cachedBestTime.data;
        lastBestTimeMetricsUpdatedAt = cachedBestTime.metricsUpdatedAt || 0;
        if (cachedBestTime.savedAt) lastBestTimeUpdate = cachedBestTime.savedAt;
        if (typeof renderBestTimeWidget === 'function') {
          renderBestTimeWidget(bestTimeData, bestTimeRange);
        }
        return true;
      }
    } catch {}
    return false;
  }

  function applyTheme(themeId){
    const theme = THEME_PRESETS[themeId] || THEME_PRESETS.darkBlue;
    const root = document.documentElement;
    if (!root || !theme) return;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-strong', theme.accentStrong);
    root.style.setProperty('--accent-rgb', theme.accentRgb);
    root.style.setProperty('--glow-right', `rgba(${theme.accentRgb},0.2)`);
    root.style.setProperty('--glow-right-soft', `rgba(${theme.accentRgb},0.16)`);
    const accent = theme.accentRgb.split(',').map((v)=> Number(v.trim()) || 0);
    const mix = (base, amt)=> base.map((v, i)=> Math.round(v + (accent[i] - v) * amt));
    Object.entries(BASE_RGB).forEach(([key, base])=>{
      const amt = BASE_TINT[key] ?? 0.08;
      const mixed = mix(base, amt).join(',');
      root.style.setProperty(`--${key}-rgb`, mixed);
    });
  }

  function resolveThemeId(themeId){
    return THEME_PRESETS[themeId] ? themeId : (THEME_ALIASES[themeId] || 'darkBlue');
  }

  function setTheme(themeId, persist = true){
    const resolved = resolveThemeId(themeId);
    applyTheme(resolved);
    if (persist) {
      try { localStorage.setItem(THEME_STORAGE_KEY, resolved); } catch {}
    }
    $$('.theme-swatch').forEach((btn)=>{
      const active = btn.dataset.theme === resolved;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    try { window.dispatchEvent(new CustomEvent('sct-theme-change', { detail: { themeId: resolved } })); } catch {}
  }

  function initThemePicker(){
    const swatches = $$('.theme-swatch');
    if (!swatches.length) return;
    const picker = $('.theme-picker');
    const toggleBtn = $('#themeToggle');
    let hideTimer = null;
    const inactivityEvents = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'focusin'];
    let stored = null;
    let themeToggleSeen = false;
    let currentThemeId = 'darkBlue';
    let previewThemeId = null;
    let isHoveringPicker = false;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch {}
    try { themeToggleSeen = localStorage.getItem(THEME_TOGGLE_SEEN_KEY) === '1'; } catch {}
    currentThemeId = resolveThemeId(stored || 'darkBlue');
    setTheme(currentThemeId, false);
    if (toggleBtn) toggleBtn.classList.toggle('theme-seen', themeToggleSeen);

    const clearHideTimer = ()=>{
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const hidePicker = ()=>{
      clearHideTimer();
      if (picker) {
        picker.classList.add('is-hidden');
        picker.setAttribute('aria-hidden', 'true');
      }
      if (toggleBtn) {
        toggleBtn.classList.remove('is-hidden');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
    };
    const armHideTimer = ()=>{
      clearHideTimer();
      hideTimer = setTimeout(hidePicker, 12000);
    };
    const markThemeToggleSeen = ()=>{
      if (!toggleBtn || toggleBtn.classList.contains('theme-seen')) return;
      toggleBtn.classList.add('theme-seen');
      try { localStorage.setItem(THEME_TOGGLE_SEEN_KEY, '1'); } catch {}
    };
    const registerActivity = (el)=>{
      if (!el) return;
      inactivityEvents.forEach((eventName)=>{
        el.addEventListener(eventName, armHideTimer, { passive: true });
      });
    };
    const showPicker = ()=>{
      if (picker) {
        picker.classList.remove('is-hidden');
        picker.setAttribute('aria-hidden', 'false');
      }
      if (toggleBtn) {
        toggleBtn.classList.add('is-hidden');
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
      armHideTimer();
    };

    if (toggleBtn && picker) {
      hidePicker();
      toggleBtn.addEventListener('click', (e)=>{
        e.preventDefault();
        showPicker();
        markThemeToggleSeen();
      });
      registerActivity(picker);
      registerActivity(toggleBtn);
      picker.addEventListener('mouseenter', ()=>{
        isHoveringPicker = true;
      });
      picker.addEventListener('mouseleave', ()=>{
        isHoveringPicker = false;
        if (previewThemeId) {
          applyTheme(currentThemeId);
          previewThemeId = null;
          try { window.dispatchEvent(new CustomEvent('sct-theme-change', { detail: { themeId: currentThemeId, preview: false } })); } catch {}
          setPaletteOffset(basePaletteOffset);
        }
      });
    }
    swatches.forEach((btn)=>{
      btn.addEventListener('mouseenter', ()=>{
        const themeId = resolveThemeId(btn.dataset.theme || 'blue');
        previewThemeId = themeId;
        applyTheme(themeId);
        try { window.dispatchEvent(new CustomEvent('sct-theme-change', { detail: { themeId, preview: true } })); } catch {}
        setPaletteOffset(basePaletteOffset + 1);
        armHideTimer();
      });
      btn.addEventListener('mouseleave', ()=>{
        if (previewThemeId && !isHoveringPicker) {
          applyTheme(currentThemeId);
          previewThemeId = null;
          try { window.dispatchEvent(new CustomEvent('sct-theme-change', { detail: { themeId: currentThemeId, preview: false } })); } catch {}
          setPaletteOffset(basePaletteOffset);
        }
      });
      btn.addEventListener('click', ()=>{
        const themeId = btn.dataset.theme || 'blue';
        setTheme(themeId);
        currentThemeId = resolveThemeId(themeId);
        previewThemeId = null;
        setPaletteOffset(basePaletteOffset);
        hidePicker();
      });
    });
  }

  function getCurrentThemeAccent(){
    const root = document.documentElement;
    if (!root) return THEME_PRESETS.darkBlue.accent;
    const accent = getComputedStyle(root).getPropertyValue('--accent').trim();
    return accent || THEME_PRESETS.darkBlue.accent;
  }

  function getChartDragColors(){
    const root = document.documentElement;
    if (!root) {
      return { stroke: '#7dc4ff', fill: '#7dc4ff22' };
    }
    const styles = getComputedStyle(root);
    const accentRgb = styles.getPropertyValue('--accent-rgb').trim() || THEME_PRESETS.darkBlue.accentRgb;
    const strokeAlphaValue = parseFloat(styles.getPropertyValue('--chart-drag-stroke-alpha'));
    const fillAlphaValue = parseFloat(styles.getPropertyValue('--chart-drag-fill-alpha'));
    const strokeAlpha = Number.isFinite(strokeAlphaValue) ? strokeAlphaValue : 0.9;
    const fillAlpha = Number.isFinite(fillAlphaValue) ? fillAlphaValue : 0.14;
    return {
      stroke: `rgba(${accentRgb},${strokeAlpha})`,
      fill: `rgba(${accentRgb},${fillAlpha})`
    };
  }

  function getChartGridColor(){
    const root = document.documentElement;
    if (!root) return '#25303b';
    const styles = getComputedStyle(root);
    const accentRgb = styles.getPropertyValue('--accent-rgb').trim() || THEME_PRESETS.darkBlue.accentRgb;
    const gridAlphaValue = parseFloat(styles.getPropertyValue('--chart-grid-alpha'));
    const gridAlpha = Number.isFinite(gridAlphaValue) ? gridAlphaValue : 0.3;
    return `rgba(${accentRgb},${gridAlpha})`;
  }

  function getPaletteColor(idx){
    const len = COLORS.length || 1;
    const offset = ((paletteOffset % len) + len) % len;
    return COLORS[(idx + offset) % len];
  }

  function setPaletteOffset(nextOffset){
    const len = COLORS.length || 1;
    paletteOffset = ((nextOffset % len) + len) % len;
    if (makeColorMap.cache) makeColorMap.cache.clear();
    if (typeof renderComparePills === 'function') renderComparePills();
    if (typeof updateCompareCharts === 'function') updateCompareCharts();
    if (typeof refreshUserUI === 'function') {
      refreshUserUI({ preserveEmpty: true, skipPostListRebuild: true, skipRestoreZoom: true });
    }
  }

  function getCompareSeriesColor(idx){
    if (idx === 0) return getCurrentThemeAccent();
    return getPaletteColor(idx);
  }

  function setCompareNextColor(color){
    const section = document.querySelector('.compare-section');
    if (!section) return;
    const rgb = (function(){
      if (!color) return null;
      const hex = color.startsWith('#') ? color.slice(1) : color;
      if (hex.length !== 6) return null;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (![r,g,b].every(Number.isFinite)) return null;
      return { r, g, b };
    })();
    if (!rgb) {
      section.style.removeProperty('--compare-next-color');
      section.style.removeProperty('--compare-next-border');
      return;
    }
    section.style.setProperty('--compare-next-color', color);
    section.style.setProperty('--compare-next-border', `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`);
  }
  
  // Blend two hex colors (50/50 mix)
  function blendColors(color1, color2){
    const hex1 = color1.replace('#', '');
    const hex2 = color2.replace('#', '');
    const r1 = parseInt(hex1.substr(0, 2), 16);
    const g1 = parseInt(hex1.substr(2, 2), 16);
    const b1 = parseInt(hex1.substr(4, 2), 16);
    const r2 = parseInt(hex2.substr(0, 2), 16);
    const g2 = parseInt(hex2.substr(2, 2), 16);
    const b2 = parseInt(hex2.substr(4, 2), 16);
    const r = Math.round((r1 + r2) / 2);
    const g = Math.round((g1 + g2) / 2);
    const b = Math.round((b1 + b2) / 2);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  
  // Convert plural to singular
  function singularize(word){
    if (word.endsWith('s') && word.length > 1) {
      return word.slice(0, -1);
    }
    return word;
  }
  function unitLabelForValue(unit, value){
    const lower = String(unit || '').toLowerCase();
    if (isFinite(value) && value === 1 && lower.endsWith('s') && !/per person/.test(lower)) {
      return singularize(lower);
    }
    return lower;
  }

  // (thumbnails are provided by the collector; no auto-rewrite here)

  function fmt(n){
    if (n == null || !isFinite(n)) return '-';
    if (n >= 1e6) return (n/1e6).toFixed(n%1e6?1:0)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(n%1e3?1:0)+'K';
    return String(n);
  }
  function fmt1(n){
    const v = Number(n);
    if (!isFinite(v)) return '-';
    if (v >= 1e6) return (v/1e6).toFixed(1)+'M';
    if (v >= 1e3) return (v/1e3).toFixed(1)+'K';
    return v.toFixed(1);
  }

  // Fixed-two-decimal formatter with K/M suffixes
  function fmt2(n){
    const v = Number(n);
    if (!isFinite(v)) return '-';
    if (v >= 1e6) return (v/1e6).toFixed(2)+'M';
    if (v >= 1e3) return (v/1e3).toFixed(2)+'K';
    return v.toFixed(2);
  }
  // Fixed-zero-decimal formatter with K/M suffixes
  function fmt0(n){
    const v = Number(n);
    if (!isFinite(v)) return '-';
    if (v >= 1e6) return (v/1e6).toFixed(0)+'M';
    if (v >= 1e3) return (v/1e3).toFixed(0)+'K';
    return Math.round(v).toString();
  }
  // For counts where we want 2 decimals with K/M, but no decimals below 1K
  function fmtK2OrInt(n){
    const v = Number(n);
    if (!isFinite(v)) return '-';
    if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2)+'M';
    if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(2)+'K';
    return Math.round(v).toString();
  }

  let toastTimer = null;
  function showToast(message){
    try {
      let toast = document.getElementById('sctToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sctToast';
        toast.className = 'sct-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    } catch {}
  }

  function hoistChartTooltips(){
    const tooltips = $$('.tooltip');
    tooltips.forEach((tooltip)=>{
      if (tooltip.parentElement !== document.body) {
        document.body.appendChild(tooltip);
      }
    });
  }
  function ensureTooltipInBody(tooltip){
    if (!tooltip) return;
    const body = document.body;
    if (!body) return;
    if (tooltip.parentElement !== body) {
      body.appendChild(tooltip);
    }
  }

  function hoistToBody(el){
    if (!el) return;
    const body = document.body;
    if (!body) return;
    if (el.parentElement !== body) body.appendChild(el);
  }

  async function loadUltraModePreference(){
    try {
      const stored = await chrome.storage.local.get(ULTRA_MODE_STORAGE_KEY);
      return !!stored[ULTRA_MODE_STORAGE_KEY];
    } catch {
      return false;
    }
  }

  async function saveUltraModePreference(enabled){
    try {
      await chrome.storage.local.set({ [ULTRA_MODE_STORAGE_KEY]: !!enabled });
    } catch {}
  }

  function num(v){ const n = Number(v); return isFinite(n) ? n : 0; }
  function interactionsOfSnap(s){
    if (!s) return 0;
    const likes = num(s.likes);
    const comments = num(s.comments ?? s.reply_count); // non-recursive
    // Exclude remixes, shares, and downloads
    return likes + comments;
  }

  function likeRate(likes, uv){
    const a = Number(likes), b = Number(uv);
    if (!isFinite(a) || !isFinite(b) || b <= 0) return null;
    return (a / b) * 100;
  }
  function interactionRate(snap){
    if (!snap) return null;
    const uv = Number(snap.uv);
    if (!isFinite(uv) || uv <= 0) return null;
    const inter = interactionsOfSnap(snap);
    return (inter / uv) * 100;
  }
  function remixRate(likes, remixes){
    const l = Number(likes);
    const r = Number(remixes);
    if (!isFinite(l) || l <= 0 || !isFinite(r) || r < 0) return null;
    return ((r / l) * 100).toFixed(2);
  }

  // Get latest snapshot by timestamp; fallback to last array entry
  function latestSnapshot(snaps){
    if (!Array.isArray(snaps) || snaps.length === 0) return null;
    let best = null, bestT = -Infinity, sawT = false;
    for (const s of snaps){
      const t = Number(s?.t);
      if (isFinite(t)){
        sawT = true;
        if (t > bestT){ bestT = t; best = s; }
      }
    }
    if (sawT && best) return best;
    return snaps[snaps.length - 1] || null;
  }

  // Find latest available remix count (from whichever field) for a post
  function latestRemixCountForPost(post){
    try {
      const snaps = Array.isArray(post?.snapshots) ? post.snapshots : [];
      for (let i = snaps.length - 1; i >= 0; i--){
        const v = Number(snaps[i]?.remix_count ?? snaps[i]?.remixes);
        if (isFinite(v)) return v;
      }
    } catch {}
    return 0;
  }

  function lastRefreshMsForPost(post){
    const last = latestSnapshot(post?.snapshots);
    const snapT = toTs(last?.t) || 0;
    const seenT = toTs(post?.lastSeen) || 0;
    return Math.max(snapT, seenT);
  }

  // Timestamp helpers
  function toTs(v){
    if (typeof v === 'number' && isFinite(v)){
      // Normalize seconds to milliseconds if needed
      // Heuristic: timestamps before year ~2001 in ms are < 1e12
      // If it's < 1e11, likely seconds
      const n = v < 1e11 ? v * 1000 : v;
      return n;
    }
    if (typeof v === 'string' && v.trim()){
      const s = v.trim();
      if (/^\d+$/.test(s)){
        const n = Number(s);
        return n < 1e11 ? n*1000 : n;
      }
      const d = Date.parse(s);
      if (!isNaN(d)) return d; // ms
    }
    return 0;
  }
  // Strict post time lookup: only consider explicit post time fields; everything else sorts last
  function getPostTimeStrict(p){
    // Only accept explicit post time; do NOT infer from snapshots in this strict mode
    const candidates = [
      p?.post_time,
      p?.postTime,
      p?.post?.post_time,
      p?.post?.postTime,
      p?.meta?.post_time,
    ];
    for (const c of candidates){
      const t = toTs(c);
      if (t) return t;
    }
    return 0; // unknown -> sort to bottom
  }
  // Loose post time lookup for recency filters: allow snapshot-time fallback
  function getPostTimeForRecency(p){
    const strict = getPostTimeStrict(p);
    if (strict) return strict;
    const snaps = Array.isArray(p?.snapshots) ? p.snapshots : [];
    let best = Infinity;
    for (const s of snaps){
      const t = toTs(s?.t);
      if (t && t < best) best = t;
    }
    return best < Infinity ? best : 0;
  }
  function normalizeCameoName(name){
    if (!name) return '';
    return String(name).trim().toLowerCase();
  }
  function normalizeMenuName(name){
    if (!name) return '';
    return normalizeCameoName(name).replace(/^@/, '');
  }
  function isCharacterId(id){
    return typeof id === 'string' && id.startsWith('ch_');
  }
  function isCameoKey(k){
    return typeof k === 'string' && k.startsWith(CAMEO_KEY_PREFIX);
  }
  function cameoNameFromKey(k){
    return isCameoKey(k) ? k.slice(CAMEO_KEY_PREFIX.length) : '';
  }
  function makeCameoKey(name){
    const normalized = normalizeCameoName(name);
    return normalized ? `${CAMEO_KEY_PREFIX}${normalized}` : null;
  }
  function formatCameoLabel(name){
    const clean = String(name || '').trim();
    if (!clean) return '';
    const suffix = ' character';
    if (clean.toLowerCase().endsWith(suffix)) return clean;
    return `${clean}${suffix}`;
  }
  function isVirtualUserKey(k){
    return isTopTodayKey(k) || isCameoKey(k);
  }
  function isVirtualUser(user){
    const key = user?.__specialKey || '';
    return key === TOP_TODAY_KEY || isCameoKey(key);
  }
  function isTopTodayKey(k){ return k === TOP_TODAY_KEY; }
  function buildTopTodayUser(metrics){
    const now = Date.now();
    const cutoff = now - TOP_TODAY_WINDOW_MS;
    const posts = {};
    for (const [userKey, user] of Object.entries(metrics?.users || {})){
      for (const [pid, p] of Object.entries(user?.posts || {})){
        const t = getPostTimeForRecency(p);
        if (!t || t < cutoff) continue;

        // Threshold filter for "Top Today": require some minimum engagement.
        const last = latestSnapshot(p?.snapshots);
        const uv = num(last?.uv);
        const likes = num(last?.likes);
        if (uv < TOP_TODAY_MIN_UNIQUE_VIEWS) continue;
        if (likes < TOP_TODAY_MIN_LIKES) continue;

        // Prefer the entry with more snapshots if we see duplicates
        const existing = posts[pid];
        if (existing){
          const a = Array.isArray(existing.snapshots) ? existing.snapshots.length : 0;
          const b = Array.isArray(p.snapshots) ? p.snapshots.length : 0;
          if (b <= a) continue;
        }
        // Avoid mutating stored data; ensure ownerHandle is present for labeling.
        const ownerHandle = p?.ownerHandle || user?.handle || (userKey.startsWith('h:') ? userKey.slice(2) : '') || null;
        posts[pid] = ownerHandle && !p?.ownerHandle ? { ...p, ownerHandle } : p;
      }
    }
    return { handle: 'Top Today', id: null, posts, followers: [], cameos: [], __specialKey: TOP_TODAY_KEY };
  }
  function getUserPostCount(user){
    return Object.keys(user?.posts || {}).length;
  }
  function getUserSnapshotCount(user){
    let total = 0;
    for (const post of Object.values(user?.posts || {})){
      if (!Array.isArray(post?.snapshots)) continue;
      total += post.snapshots.length;
    }
    return total;
  }
  function pickPreferredUserCandidate(best, candidate, opts = {}){
    if (!candidate) return best;
    if (!best) return candidate;
    const bestPosts = getUserPostCount(best.user);
    const candPosts = getUserPostCount(candidate.user);
    if (candPosts !== bestPosts) return candPosts > bestPosts ? candidate : best;
    const bestSnaps = getUserSnapshotCount(best.user);
    const candSnaps = getUserSnapshotCount(candidate.user);
    if (candSnaps !== bestSnaps) return candSnaps > bestSnaps ? candidate : best;
    if (opts.preferNonCharacter !== false) {
      const bestChar = isCharacterId(best.user?.id);
      const candChar = isCharacterId(candidate.user?.id);
      if (bestChar !== candChar) return candChar ? best : candidate;
    }
    if (opts.preferredPrefix) {
      const bestPrefix = String(best.key || '').startsWith(opts.preferredPrefix);
      const candPrefix = String(candidate.key || '').startsWith(opts.preferredPrefix);
      if (bestPrefix !== candPrefix) return candPrefix ? candidate : best;
    }
    if (opts.preferredExactKey) {
      const bestExact = best.key === opts.preferredExactKey;
      const candExact = candidate.key === opts.preferredExactKey;
      if (bestExact !== candExact) return candExact ? candidate : best;
    }
    const bestCameos = Array.isArray(best.user?.cameos) ? best.user.cameos.length : 0;
    const candCameos = Array.isArray(candidate.user?.cameos) ? candidate.user.cameos.length : 0;
    if (candCameos !== bestCameos) return candCameos > bestCameos ? candidate : best;
    return best;
  }
  function findUserByHandle(metrics, handle){
    if (!handle || !metrics?.users) return null;
    const normalized = normalizeCameoName(handle);
    if (!normalized) return null;
    const directKey = `h:${normalized}`;
    const directUser = metrics.users[directKey];
    if (directUser && getUserPostCount(directUser) > 0) return directUser;
    let best = directUser ? { key: directKey, user: directUser } : null;
    for (const [key, user] of Object.entries(metrics.users || {})){
      const userHandle = normalizeCameoName(user?.handle || user?.userHandle || '');
      if (!userHandle || userHandle !== normalized) continue;
      best = pickPreferredUserCandidate(best, { key, user }, {
        preferredPrefix: 'h:',
        preferredExactKey: directKey,
        preferNonCharacter: true
      });
    }
    return best?.user || null;
  }
  function findUserById(metrics, id){
    if (!id || !metrics?.users) return null;
    const needle = String(id);
    const directKey = `id:${needle}`;
    const directUser = metrics.users[directKey];
    if (directUser && getUserPostCount(directUser) > 0) return directUser;
    let best = directUser ? { key: directKey, user: directUser } : null;
    for (const [key, user] of Object.entries(metrics.users || {})){
      if (!(key === directKey || (user?.id != null && String(user.id) === needle))) continue;
      best = pickPreferredUserCandidate(best, { key, user }, {
        preferredPrefix: 'h:',
        preferredExactKey: directKey,
        preferNonCharacter: true
      });
    }
    return best?.user || null;
  }
  function buildCameoUser(metrics, cameoName){
    const name = normalizeCameoName(cameoName);
    if (!name) return null;
    const key = makeCameoKey(name);
    const updatedAt = Number(lastMetricsUpdatedAt) || 0;
    if (cameoUserCache.updatedAt !== updatedAt) {
      cameoUserCache.updatedAt = updatedAt;
      cameoUserCache.users.clear();
    }
    if (key && cameoUserCache.users.has(key)) return cameoUserCache.users.get(key);
    const profileUser = findUserByHandle(metrics, name);
    const posts = {};
    const postSource = new Map();
    for (const [userKey, user] of Object.entries(metrics?.users || {})){
      const userHandle = user?.handle || user?.userHandle || (userKey.startsWith('h:') ? userKey.slice(2) : null);
      for (const [pid, p] of Object.entries(user?.posts || {})){
        const ownerHandle = p?.ownerHandle || p?.userHandle || userHandle || null;
        let cameoMatch = false;
        const cameos = Array.isArray(p?.cameo_usernames) ? p.cameo_usernames : [];
        for (const cameo of cameos){
          if (normalizeCameoName(cameo) === name) { cameoMatch = true; break; }
        }
        if (!cameoMatch) continue;
        const existing = posts[pid];
        if (existing){
          const a = Array.isArray(existing.snapshots) ? existing.snapshots.length : 0;
          const b = Array.isArray(p.snapshots) ? p.snapshots.length : 0;
          const isProfileSource = profileUser && user === profileUser;
          const existingIsProfile = postSource.get(pid) === true;
          if (b < a) continue;
          if (b === a && !(isProfileSource && !existingIsProfile)) continue;
        }
        const next = ownerHandle && !p?.ownerHandle ? { ...p, ownerHandle } : p;
        posts[pid] = next;
        postSource.set(pid, profileUser && user === profileUser);
      }
    }
    const cameoHistory = Array.isArray(profileUser?.cameos) ? profileUser.cameos.slice() : [];
    const followerHistory = Array.isArray(profileUser?.followers) ? profileUser.followers.slice() : [];
    const cameoUser = {
      handle: profileUser?.handle || name,
      id: profileUser?.id || null,
      posts,
      followers: followerHistory,
      cameos: cameoHistory,
      __specialKey: key
    };
    if (key) cameoUserCache.users.set(key, cameoUser);
    return cameoUser;
  }
  function resolveUserForKey(metrics, userKey){
    if (isTopTodayKey(userKey)) {
      const cachedTopToday = metrics?.users?.[TOP_TODAY_KEY];
      if (cachedTopToday) return cachedTopToday;
      return buildTopTodayUser(metrics);
    }
    if (isCameoKey(userKey)) {
      const cachedCameo = metrics?.users?.[userKey];
      if (cachedCameo) return cachedCameo;
      return buildCameoUser(metrics, cameoNameFromKey(userKey));
    }
    if (typeof userKey === 'string' && userKey.startsWith('h:')) {
      const byHandle = findUserByHandle(metrics, userKey.slice(2));
      if (byHandle) return byHandle;
    }
    if (typeof userKey === 'string' && userKey.startsWith('id:')) {
      const byId = findUserById(metrics, userKey.slice(3));
      if (byId) return byId;
    }
    return metrics?.users?.[userKey] || null;
  }
  function keyMatchesUserIdentity(metrics, candidateKey, userKey, user){
    if (!candidateKey || !userKey || !user) return false;
    if (candidateKey === userKey) return true;
    const curHandle = normalizeCameoName(user?.handle || (userKey.startsWith('h:') ? userKey.slice(2) : ''));
    const curId = String(user?.id || (userKey.startsWith('id:') ? userKey.slice(3) : '') || '');
    if (candidateKey.startsWith('id:')) {
      const candidateId = String(candidateKey.slice(3) || '');
      if (candidateId && curId && candidateId === curId) return true;
    }
    if (candidateKey.startsWith('h:')) {
      const candidateHandle = normalizeCameoName(candidateKey.slice(2));
      if (candidateHandle && curHandle && candidateHandle === curHandle) return true;
    }
    const candidateUser = metrics?.users?.[candidateKey];
    if (!candidateUser) return false;
    const candidateId = String(candidateUser?.id || (candidateKey.startsWith('id:') ? candidateKey.slice(3) : '') || '');
    const candidateHandle = normalizeCameoName(candidateUser?.handle || candidateUser?.userHandle || (candidateKey.startsWith('h:') ? candidateKey.slice(2) : ''));
    if (candidateId && curId && candidateId === curId) return true;
    if (candidateHandle && curHandle && candidateHandle === curHandle) return true;
    return false;
  }
  const DBG_SORT = false; // hide noisy sorting logs by default

  // Reconcile posts for the selected user:
  // - If a post has an ownerKey different from this user, move it to that owner user bucket.
  // - If ownerKey is missing but ownerId exists, derive key as id:<ownerId> and move there.
  // - If both ownerKey and ownerId are missing, move the post to the 'unknown' user bucket.
  async function pruneMismatchedPostsForUser(metrics, userKey, opts = {}){
    const log = opts.log !== false;
    try {
      const user = metrics?.users?.[userKey];
      if (!user || !user.posts) return { moved: [], kept: 0 };
      const moved = [];
      const keep = {};
      const keys = Object.keys(user.posts);
      const total = keys.length;
      // Helpers to compare against this user's canonical identity
      const curHandle = (user.handle || (userKey.startsWith('h:') ? userKey.slice(2) : '') || '').toLowerCase();
      const curId = (user.id || (userKey.startsWith('id:') ? userKey.slice(3) : '') || '').toString();
      for (const pid of keys){
        const p = user.posts[pid];
        const ownerKey = (p && p.ownerKey) ? String(p.ownerKey) : null;
        const ownerId = (p && p.ownerId) ? String(p.ownerId) : null;
        const ownerHandle = (p && p.ownerHandle) ? String(p.ownerHandle).toLowerCase() : null;
        const ownerKeyMatchesCurrent = ownerKey ? keyMatchesUserIdentity(metrics, ownerKey, userKey, user) : false;
        let targetKey = null;
        if (ownerKey && ownerKey !== userKey && !ownerKeyMatchesCurrent){
          targetKey = ownerKey;
        } else if (ownerId && curId && ownerId !== curId){
          // Explicit id mismatch → move to owner id bucket
          targetKey = `id:${ownerId}`;
        } else if (ownerHandle && curHandle && ownerHandle !== curHandle){
          // Explicit handle mismatch → move to owner handle bucket
          targetKey = `h:${ownerHandle}`;
        }

        if (targetKey && targetKey !== userKey){
          // Ensure target user bucket exists
          if (!metrics.users[targetKey]){
            const guessedHandle = targetKey.startsWith('h:') ? targetKey.slice(2) : (p.ownerHandle || null);
            const guessedId = targetKey.startsWith('id:') ? targetKey.slice(3) : (p.ownerId || null);
            metrics.users[targetKey] = { handle: guessedHandle, id: guessedId, posts: {}, followers: [] };
          }
          // Optionally normalize the ownerKey on the post
          if (!p.ownerKey && targetKey !== 'unknown') p.ownerKey = targetKey;
          metrics.users[targetKey].posts[pid] = p;
          moved.push({ pid, from: userKey, to: targetKey, ownerKey: ownerKey || null, ownerId: ownerId || null, ownerHandle: p.ownerHandle || null });
          // do not include in keep
        } else {
          // If owner info absent, infer owner as current user instead of moving to unknown
          if (!ownerKey && !ownerId && !p.ownerHandle){
            p.ownerKey = userKey;
            if (!p.ownerHandle && curHandle) p.ownerHandle = curHandle;
            if (!p.ownerId && curId) p.ownerId = curId;
          } else if (ownerKeyMatchesCurrent && ownerKey !== userKey) {
            // Normalize alias key (id:/h:) to the selected bucket key to avoid flip-flop moves.
            p.ownerKey = userKey;
          }
          keep[pid] = p; // stay under current user
        }
      }
      if (moved.length){
        metrics.users[userKey].posts = keep;
        // Reconciliation logging removed.
        const affectedKeys = new Set([userKey]);
        moved.forEach((it)=>{ if (it && it.to) affectedKeys.add(it.to); });
        await saveMetrics(metrics, { userKeys: Array.from(affectedKeys) });
      } else {
        // Reconciliation logging removed.
      }
      return { moved, kept: Object.keys(metrics.users[userKey].posts).length };
    } catch {
      return { moved: [], kept: 0 };
    }
  }

  // Remove posts that are missing data for the selected user.
  // Definition: no snapshots OR every snapshot lacks all known metrics (uv, views, likes, comments, remixes).
  async function pruneEmptyPostsForUser(metrics, userKey){
    try {
      const user = metrics?.users?.[userKey];
      if (!user || !user.posts) return { removed: [] };
      const removed = [];
      const keep = {};
      const keys = Object.keys(user.posts);
      const hasAnyMetric = (s)=>{
        if (!s) return false;
        const fields = ['uv','views','likes','comments','remix_count'];
        for (const k of fields){ if (s[k] != null && isFinite(Number(s[k]))) return true; }
        return false;
      };
      for (const pid of keys){
        const p = user.posts[pid];
        const snaps = Array.isArray(p?.snapshots) ? p.snapshots : [];
        const valid = snaps.length > 0 && snaps.some(hasAnyMetric);
        if (!valid){
          removed.push(pid);
        } else {
          keep[pid] = p;
        }
      }
      if (removed.length){
        metrics.users[userKey].posts = keep;
        await saveMetrics(metrics, { userKeys: [userKey] });
      }
      return { removed };
    } catch {
      return { removed: [] };
    }
  }
  // Try to reclaim posts from the 'unknown' bucket that clearly belong to the selected user.
  async function reclaimFromUnknownForUser(metrics, userKey){
    try {
      const user = metrics?.users?.[userKey];
      const unk = metrics?.users?.unknown;
      if (!user || !unk || !unk.posts) return { moved: 0 };
      const curHandle = (user.handle || (userKey.startsWith('h:') ? userKey.slice(2) : '') || '').toLowerCase();
      const curId = (user.id || (userKey.startsWith('id:') ? userKey.slice(3) : '') || '').toString();
      let moved = 0;
      for (const [pid, p] of Object.entries(unk.posts)){
        const oKey = p.ownerKey ? String(p.ownerKey) : null;
        const oId = p.ownerId ? String(p.ownerId) : null;
        const oHandle = p.ownerHandle ? String(p.ownerHandle).toLowerCase() : null;
        const matchByKey = oKey && keyMatchesUserIdentity(metrics, oKey, userKey, user);
        const matchById = oId && curId && oId === curId;
        const matchByHandle = oHandle && curHandle && oHandle === curHandle;
        if (matchByKey || matchById || matchByHandle){
          if (!metrics.users[userKey].posts) metrics.users[userKey].posts = {};
          metrics.users[userKey].posts[pid] = p;
          // Normalize
          if (!p.ownerKey) p.ownerKey = userKey;
          if (!p.ownerHandle && curHandle) p.ownerHandle = curHandle;
          if (!p.ownerId && curId) p.ownerId = curId;
          delete unk.posts[pid];
          moved++;
        }
      }
      if (moved){
        await saveMetrics(metrics, { userKeys: [userKey, 'unknown'] });
      }
      return { moved };
    } catch {
      return { moved: 0 };
    }
  }

  // Fallback: derive a comparable numeric from the post ID (assumes hex-like GUID after 's_')
  function pidBigInt(pid){
    try{
      const m = /^s_([0-9a-fA-F]+)/.exec(pid || '');
      if (!m) return 0n;
      return BigInt('0x' + m[1]);
    } catch { return 0n; }
  }

  function pruneEmptyUsers(metrics){
    let removed = 0;
    const users = metrics?.users || {};
    for (const [key, user] of Object.entries(users)){
      const posts = user?.posts || {};
      const hasPosts = posts && Object.keys(posts).length > 0;
      const hasFollowers = Array.isArray(user?.followers) && user.followers.length > 0;
      const hasCameos = Array.isArray(user?.cameos) && user.cameos.length > 0;
      const keepForCharacter = isCharacterId(user?.id);
      if (!hasPosts && !hasFollowers && !hasCameos && !keepForCharacter){
        delete users[key];
        removed++;
      }
    }
    return removed;
  }

  async function saveMetrics(nextMetrics, opts = {}){
    const metricsUpdatedAt = Date.now();
    const affectedUserKeys = opts.userKeys || Object.keys(nextMetrics.users || {});
    const hotMetrics = { ...nextMetrics, users: { ...(nextMetrics?.users || {}) } };
    const shouldMergeExistingCold = !snapshotsHydrated;
    snapLog('saveMetrics:start', {
      metricsUpdatedAt,
      affectedUserCount: affectedUserKeys.length,
      shouldMergeExistingCold,
      snapshotsHydrated,
      isMetricsPartial,
      inputSummary: summarizeMetricsSnapshots(nextMetrics)
    });

    // Extract full snapshots into cold shards for affected users, then trim hot to latest-only
    const coldPayload = {};
    for (const userKey of affectedUserKeys) {
      const user = nextMetrics.users?.[userKey];
      if (!user?.posts) continue;
      const hotUser = { ...user, posts: { ...user.posts } };
      hotMetrics.users[userKey] = hotUser;
      const shardData = {};
      for (const [postId, post] of Object.entries(user.posts)) {
        if (!Array.isArray(post.snapshots) || post.snapshots.length === 0) continue;
        // Even single-snapshot posts go to cold (to maintain complete cold shards).
        shardData[postId] = post.snapshots.slice();
        const last = post.snapshots[post.snapshots.length - 1];
        hotUser.posts[postId] = post.snapshots.length > 1 ? { ...post, snapshots: [last] } : post;
      }
      if (Object.keys(shardData).length > 0) {
        coldPayload[COLD_PREFIX + userKey] = shardData;
      }
    }
    snapLog('saveMetrics:coldPayload', summarizeColdPayload(coldPayload));

    if (shouldMergeExistingCold && Object.keys(coldPayload).length > 0) {
      const mergeStats = { shardCount: 0, postsMerged: 0, snapshotsBefore: 0, snapshotsAfter: 0 };
      try {
        const existingCold = await chrome.storage.local.get(Object.keys(coldPayload));
        for (const [shardKey, shardData] of Object.entries(coldPayload)) {
          mergeStats.shardCount++;
          const existingShard = existingCold?.[shardKey];
          if (!existingShard || typeof existingShard !== 'object') continue;
          for (const [postId, newSnaps] of Object.entries(shardData)) {
            const prevSnaps = Array.isArray(existingShard?.[postId]) ? existingShard[postId] : [];
            if (!prevSnaps.length || !Array.isArray(newSnaps) || !newSnaps.length) continue;
            mergeStats.postsMerged++;
            mergeStats.snapshotsBefore += prevSnaps.length + newSnaps.length;
            const merged = [];
            const seenTs = new Set();
            for (const s of prevSnaps.concat(newSnaps)) {
              if (!s || typeof s !== 'object') continue;
              const t = toTs(s.t);
              if (t && seenTs.has(t)) continue;
              if (t) seenTs.add(t);
              merged.push(s);
            }
            merged.sort((a, b) => (toTs(a?.t) || 0) - (toTs(b?.t) || 0));
            shardData[postId] = merged;
            mergeStats.snapshotsAfter += merged.length;
          }
        }
        snapLog('saveMetrics:coldMerged', mergeStats);
      } catch (err) {
        snapLog('saveMetrics:coldMergeFailed', { message: String(err?.message || err || 'unknown') });
      }
    }

    // Also remove cold shards for users that were deleted from metrics
    const keysToRemove = [];
    for (const userKey of affectedUserKeys) {
      if (!nextMetrics.users?.[userKey]) {
        keysToRemove.push(COLD_PREFIX + userKey);
      }
    }

    const payload = { metrics: hotMetrics, metricsUpdatedAt, ...coldPayload };
    const shouldUpdateIndex = opts.updateIndex !== false && !isMetricsPartial;
    if (shouldUpdateIndex) {
      usersIndex = buildUsersIndexFromMetrics(hotMetrics);
      payload[USERS_INDEX_STORAGE_KEY] = usersIndex;
    }
    try {
      await chrome.storage.local.set(payload);
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
      lastMetricsUpdatedAt = metricsUpdatedAt;
      snapLog('saveMetrics:done', {
        keysToRemove: keysToRemove.length,
        outputSummary: summarizeMetricsSnapshots(hotMetrics),
        coldPayload: summarizeColdPayload(coldPayload),
        indexUpdated: shouldUpdateIndex
      });
    } catch (err) {
      snapLog('saveMetrics:failed', { message: String(err?.message || err || 'unknown') });
    }
  }

  async function getMetricsUpdatedAt(){
    try {
      const st = await chrome.storage.local.get('metricsUpdatedAt');
      const v = Number(st.metricsUpdatedAt);
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  async function loadMetrics(){
    snapLog('loadMetrics:start', {
      snapshotsHydrated,
      isMetricsPartial,
      currentUserKey
    });
    const perfGet = perfStart('storage.get metrics');
    const { metrics = { users:{} }, metricsUpdatedAt } = await chrome.storage.local.get(['metrics', 'metricsUpdatedAt']);
    perfEnd(perfGet);
    if (metricsUpdatedAt != null) {
      const next = Number(metricsUpdatedAt);
      if (Number.isFinite(next) && next > 0) lastMetricsUpdatedAt = next;
    }
    snapLog('loadMetrics:fetched', {
      metricsUpdatedAt: Number(metricsUpdatedAt) || 0,
      summary: summarizeMetricsSnapshots(metrics)
    });
    const perfPrune = perfStart('prune empty users');
    const removed = pruneEmptyUsers(metrics);
    perfEnd(perfPrune);
    if (removed) {
      snapLog('loadMetrics:prunedEmptyUsers', { removed });
    }
    if (removed) {
      const perfSet = perfStart('storage.set metrics');
      await saveMetrics(metrics, { userKeys: Object.keys(metrics.users || {}) });
      if (!lastMetricsUpdatedAt) {
        lastMetricsUpdatedAt = Date.now();
      }
      perfEnd(perfSet);
    } else if (!lastMetricsUpdatedAt) {
      const ts = Date.now();
      lastMetricsUpdatedAt = ts;
      try { await chrome.storage.local.set({ metricsUpdatedAt: ts }); } catch {}
    }
    usersIndex = buildUsersIndexFromMetrics(metrics);
    invalidateSnapshotHydration('loadMetrics', {
      summary: summarizeMetricsSnapshots(metrics)
    });
    snapLog('loadMetrics:done', {
      snapshotsHydrated,
      lastMetricsUpdatedAt,
      summary: summarizeMetricsSnapshots(metrics)
    });
    return metrics;
  }

  async function ensureFullSnapshots() {
    if (snapshotsHydrated) {
      snapLog('ensureFullSnapshots:skip', { reason: 'already_hydrated', currentUserKey });
      return;
    }
    if (snapshotsHydrationPromise) {
      snapLog('ensureFullSnapshots:join', {
        currentUserKey,
        snapshotsHydrationEpoch
      });
      await snapshotsHydrationPromise;
      return;
    }
    const runEpoch = snapshotsHydrationEpoch;
    const allUserKeys = Object.keys(metrics?.users || {});
    const targetUserKeys = (function(){
      if (!isMetricsPartial) return allUserKeys;
      if (currentUserKey && metrics?.users?.[currentUserKey]) return [currentUserKey];
      return allUserKeys;
    })();
    snapLog('ensureFullSnapshots:start', {
      currentUserKey,
      runEpoch,
      isMetricsPartial,
      allUserCount: allUserKeys.length,
      targetUserCount: targetUserKeys.length,
      beforeSummary: summarizeMetricsSnapshots(metrics)
    });
    snapshotsHydrationPromise = (async () => {
      const mergeStats = { requestedShards: 0, hydratedShards: 0, userCount: 0, postCount: 0, snapshotsAdded: 0, aborted: false };
      try {
        const shardKeys = targetUserKeys.map((userKey)=> COLD_PREFIX + userKey);
        const allStorage = shardKeys.length ? await chrome.storage.local.get(shardKeys) : {};
        mergeStats.requestedShards = shardKeys.length;
        for (const userKey of targetUserKeys) {
          if (runEpoch !== snapshotsHydrationEpoch) {
            mergeStats.aborted = true;
            break;
          }
          const key = COLD_PREFIX + userKey;
          const shard = allStorage?.[key];
          if (!shard || typeof shard !== 'object') continue;
          mergeStats.hydratedShards++;
          const user = metrics.users?.[userKey];
          if (!user?.posts) continue;
          mergeStats.userCount++;
          for (const [postId, coldSnaps] of Object.entries(shard)) {
            if (runEpoch !== snapshotsHydrationEpoch) {
              mergeStats.aborted = true;
              break;
            }
            if (!Array.isArray(coldSnaps) || !coldSnaps.length) continue;
            const post = user.posts[postId];
            if (!post) continue;
            mergeStats.postCount++;
            if (!Array.isArray(post.snapshots)) post.snapshots = [];
            // Merge cold snapshots, deduplicating by timestamp
            const existingTs = new Set(post.snapshots.map(s => s.t));
            for (const s of coldSnaps) {
              if (!existingTs.has(s.t)) {
                post.snapshots.push(s);
                existingTs.add(s.t);
                mergeStats.snapshotsAdded++;
              }
            }
            // Sort by timestamp
            post.snapshots.sort((a, b) => (a.t || 0) - (b.t || 0));
          }
          if (mergeStats.aborted) break;
        }
      } catch (err) {
        try { console.warn('[SoraMetrics] cold shard hydration failed', err); } catch {}
        snapLog('ensureFullSnapshots:failed', { message: String(err?.message || err || 'unknown') });
      }
      const epochStable = runEpoch === snapshotsHydrationEpoch;
      snapshotsHydrated = epochStable;
      snapLog('ensureFullSnapshots:done', {
        ...mergeStats,
        runEpoch,
        snapshotsHydrationEpoch,
        epochStable,
        snapshotsHydrated,
        afterSummary: summarizeMetricsSnapshots(metrics)
      });
    })().finally(() => {
      snapshotsHydrationPromise = null;
    });
    await snapshotsHydrationPromise;
  }

  function buildUserOptions(metrics){
    const sel = $('#userSelect');
    sel.innerHTML = '';
    let firstKey = null;

    const useIndex = Array.isArray(usersIndex) && usersIndex.length > 0;
    if (!isMetricsPartial) {
      // "Top Today" virtual option (last 24h across all users)
      const topToday = buildTopTodayUser(metrics);
      const opt = document.createElement('option');
      opt.value = TOP_TODAY_KEY;
      const postCount = Object.keys(topToday.posts||{}).length;
      if (postCount > 0) {
        opt.textContent = formatUserOptionLabel(topToday.handle, postCount);
        sel.appendChild(opt);
        if (!firstKey) firstKey = TOP_TODAY_KEY;
      }
    }

    let entries = useIndex ? usersIndex.map((entry)=>[entry.key, entry]) : Object.entries(metrics.users);
    // Sort by post count (most to least), pushing 'unknown' to the end
    const users = entries.sort((a,b)=>{
      const ax = a[0]==='unknown' ? 1 : 0;
      const bx = b[0]==='unknown' ? 1 : 0;
      if (ax !== bx) return ax - bx;
      const aCount = useIndex ? (Number(a[1].postCount) || 0) : Object.keys(a[1].posts||{}).length;
      const bCount = useIndex ? (Number(b[1].postCount) || 0) : Object.keys(b[1].posts||{}).length;
      if (aCount !== bCount) return bCount - aCount; // Descending order
      // If same post count, sort alphabetically
      const A = (a[1].handle||a[0]||'').toLowerCase();
      const B = (b[1].handle||b[0]||'').toLowerCase();
      return A.localeCompare(B);
    });
    for (const [key, u] of users){
      const opt = document.createElement('option');
      opt.value = key;
      const postCount = useIndex ? (Number(u.postCount) || 0) : Object.keys(u.posts||{}).length;
      if (postCount > 0) {
        opt.textContent = formatUserOptionLabel(u.handle || key, postCount);
        sel.appendChild(opt);
        if (!firstKey) firstKey = key;
      }
    }
    return firstKey;
  }

  function updateAutoRefreshCountdown(userKey = currentUserKey){
    const el = $('#metricsAutoRefresh');
    if (!el) return;
    const show = !!userKey;
    if (!show) {
      el.textContent = '';
      el.classList.add('is-hidden');
      return;
    }
    el.classList.remove('is-hidden');
    if (!nextAutoRefreshAt) nextAutoRefreshAt = Date.now() + AUTO_REFRESH_MS;
    const remainingMs = Math.max(0, nextAutoRefreshAt - Date.now());
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    el.textContent = `refreshing in ${remainingSec}`;
  }

  function resetAutoRefreshCountdown(){
    nextAutoRefreshAt = Date.now() + AUTO_REFRESH_MS;
    updateAutoRefreshCountdown(currentUserKey);
  }

  function startAutoRefreshCountdown(){
    if (autoRefreshCountdownTimer) return;
    resetAutoRefreshCountdown();
    autoRefreshCountdownTimer = setInterval(() => {
      updateAutoRefreshCountdown(currentUserKey);
    }, 1000);
  }

  function updateMetricsHeader(userKey, user){
    const header = $('#metricsHeader');
    const headerText = $('#metricsHeaderText') || header;
    if (!headerText) return;
    if (!userKey) {
      headerText.textContent = 'Metrics for —';
      updateAutoRefreshCountdown(userKey);
      return;
    }
    if (isTopTodayKey(userKey)) {
      headerText.textContent = 'Metrics for Everyone Today';
      updateAutoRefreshCountdown(userKey);
      return;
    }
    if (isCameoKey(userKey)) {
      const cameoName = cameoNameFromKey(userKey) || user?.handle || 'Unknown';
      headerText.textContent = `Metrics for ${formatCameoLabel(cameoName)}`;
      updateAutoRefreshCountdown(userKey);
      return;
    }
    const raw = user?.handle || (userKey || '').replace(/^h:/i, '');
    const name = raw || 'Unknown';
    headerText.textContent = `Metrics for ${name}`;
    updateAutoRefreshCountdown(userKey);
  }

  function getGatherDisplayName(userKey, user){
    if (!userKey) return '—';
    if (isTopTodayKey(userKey)) return EVERYONE_LABEL;
    if (isCameoKey(userKey)) {
      const cameoName = cameoNameFromKey(userKey) || user?.handle || 'Unknown';
      return formatCameoLabel(cameoName);
    }
    const raw = user?.handle || (userKey || '').replace(/^h:/i, '');
    return raw || 'Unknown';
  }

  function getProfileHandleFromKey(userKey, user){
    if (!userKey || isTopTodayKey(userKey)) return '';
    if (isCameoKey(userKey)) {
      const cameoName = cameoNameFromKey(userKey) || user?.handle || '';
      return cameoName.replace(/^@/, '').trim();
    }
    const raw = user?.handle || (userKey || '').replace(/^h:/i, '');
    if (!raw) return '';
    return raw.replace(/^@/, '').trim();
  }

  function updateMetricsGatherNote(userKey, user){
    const noteText = $('#metricsGatherNoteText');
    const link = $('#metricsGatherLink');
    if (!noteText || !link) return;
    const label = getGatherDisplayName(userKey, user);
    if (isCameoKey(userKey)) {
      noteText.textContent = `Based on all posts you've seen tied to ${label}.`;
    } else {
      noteText.textContent = `Based on all posts you've seen from ${label}.`;
    }
    let url = '';
    if (userKey) {
      if (isTopTodayKey(userKey)) {
        url = `${SITE_ORIGIN}/explore?feed=top&gather=1`;
      } else {
        const handle = getProfileHandleFromKey(userKey, user);
        if (handle) url = `${SITE_ORIGIN}/profile/${encodeURIComponent(handle)}?gather=1`;
      }
    }
    link.href = url || '#';
    if (url) {
      link.removeAttribute('aria-disabled');
    } else {
      link.setAttribute('aria-disabled', 'true');
    }
  }

  function collectCameoUsernamesFromMetrics(metrics){
    const userPostIds = new Map();
    for (const [userKey, user] of Object.entries(metrics?.users || {})){
      for (const [pid, p] of Object.entries(user?.posts || {})){
        const tiedUsernames = new Set();
        const cameos = Array.isArray(p?.cameo_usernames) ? p.cameo_usernames : [];
        for (const cameo of cameos){
          const cameoName = normalizeCameoName(cameo);
          if (cameoName) tiedUsernames.add(cameoName);
        }
        for (const username of tiedUsernames){
          let postIds = userPostIds.get(username);
          if (!postIds) {
            postIds = new Set();
            userPostIds.set(username, postIds);
          }
          postIds.add(pid);
        }
      }
    }
    return Array.from(userPostIds.entries())
      .map(([username, postIds]) => ({ username, count: postIds.size }))
      .sort((a, b) => (b.count - a.count) || a.username.localeCompare(b.username));
  }

  function getCameoSuggestionItems(metrics, query){
    const updatedAt = Number(lastMetricsUpdatedAt) || 0;
    const userCount = Object.keys(metrics?.users || {}).length;
    if (cameoSuggestionCache.updatedAt !== updatedAt || cameoSuggestionCache.userCount !== userCount) {
      cameoSuggestionCache.updatedAt = updatedAt;
      cameoSuggestionCache.userCount = userCount;
      cameoSuggestionCache.list = collectCameoUsernamesFromMetrics(metrics);
    }
    const needle = (query || '').trim().toLowerCase();
    const list = cameoSuggestionCache.list || [];
    const filtered = needle ? list.filter((item)=> item.username.includes(needle)) : list;
    const out = [];
    for (const item of filtered){
      const key = makeCameoKey(item.username);
      if (!key) continue;
      out.push({ key, label: formatCameoLabel(item.username), count: item.count, baseName: item.username });
    }
    return out;
  }

  function filterUsersByQuery(metrics, q){
    const res = [];
    const needle = q.trim().toLowerCase();
    if (Array.isArray(usersIndex) && usersIndex.length) {
      for (const entry of usersIndex){
        const name = (entry.handle || entry.key || '').toLowerCase();
        if (!needle || name.includes(needle)) res.push([entry.key, entry]);
      }
      res.sort((a,b)=>{
        const aCount = Number(a[1].postCount) || 0;
        const bCount = Number(b[1].postCount) || 0;
        if (aCount !== bCount) return bCount - aCount;
        return (a[1].handle||a[0]||'').localeCompare(b[1].handle||b[0]||'');
      });
      return res;
    }
    for (const [key, u] of Object.entries(metrics.users)){
      const name = (u.handle || key || '').toLowerCase();
      if (!needle || name.includes(needle)) res.push([key,u]);
    }
    res.sort((a,b)=>{
      const aCount = Object.keys(a[1].posts||{}).length;
      const bCount = Object.keys(b[1].posts||{}).length;
      if (aCount !== bCount) return bCount - aCount; // Descending order
      // If same post count, sort alphabetically
      return (a[1].handle||a[0]||'').localeCompare(b[1].handle||b[0]||'');
    });
    return res;
  }

  function countUserPosts(user){
    if (!user) return 0;
    const pc = Number(user.postCount);
    if (Number.isFinite(pc)) return pc;
    return Object.keys(user?.posts || {}).length;
  }

  function getPostsHydrateIndicator(){
    const wrap = $('#posts');
    if (!wrap) return null;
    let el = wrap.querySelector('.posts-hydrate');
    if (!el) {
      el = document.createElement('div');
      el.className = 'posts-hydrate';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
      const spinner = document.createElement('div');
      spinner.className = 'posts-hydrate-spinner';
      for (let i = 0; i < 8; i++) {
        const dot = document.createElement('span');
        dot.style.setProperty('--i', i);
        spinner.appendChild(dot);
      }
      el.appendChild(spinner);
      wrap.appendChild(el);
    }
    return el;
  }

  function getUserSelectHydrateIndicator(){
    const wrap = document.querySelector('.user-select-bar .user-picker');
    if (!wrap) return null;
    let el = wrap.querySelector('.user-select-hydrate');
    if (!el) {
      el = document.createElement('div');
      el.className = 'user-select-hydrate';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
      const spinner = document.createElement('div');
      spinner.className = 'user-select-spinner';
      for (let i = 0; i < 8; i++) {
        const dot = document.createElement('span');
        dot.style.setProperty('--i', i);
        spinner.appendChild(dot);
      }
      el.appendChild(spinner);
      wrap.appendChild(el);
      wrap.classList.add('has-hydrate-indicator');
    }
    return el;
  }

  function getUserSelectMeasureSpan(){
    const wrap = document.querySelector('.user-select-bar .user-picker');
    if (!wrap) return null;
    let el = wrap.querySelector('.user-select-measure');
    if (!el) {
      el = document.createElement('span');
      el.className = 'user-select-measure';
      el.setAttribute('aria-hidden', 'true');
      wrap.appendChild(el);
    }
    return el;
  }

  function updateUserSelectHydrateIndicatorPosition(){
    const wrap = document.querySelector('.user-select-bar .user-picker');
    if (!wrap) return;
    const input = wrap.querySelector('input[type=search]');
    const spinnerWrap = wrap.querySelector('.user-select-hydrate');
    if (!input || !spinnerWrap) return;
    const measure = getUserSelectMeasureSpan();
    if (!measure) return;
    const style = window.getComputedStyle(input);
    measure.style.fontSize = style.fontSize;
    measure.style.fontFamily = style.fontFamily;
    measure.style.fontWeight = style.fontWeight;
    measure.style.letterSpacing = style.letterSpacing;
    measure.textContent = input.value || input.placeholder || '';
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const inputWidth = input.clientWidth || 0;
    const textWidth = measure.offsetWidth || 0;
    const spinnerWidth = spinnerWrap.offsetWidth || 14;
    let left = paddingLeft + textWidth + 6;
    const maxLeft = Math.max(paddingLeft, inputWidth - paddingRight - spinnerWidth);
    if (!Number.isFinite(left)) left = paddingLeft;
    left = Math.min(left, maxLeft);
    left = Math.max(paddingLeft, left);
    spinnerWrap.style.left = `${left}px`;
    spinnerWrap.style.right = 'auto';
  }

  function syncUserSelectHydrateIndicator(){
    const el = getUserSelectHydrateIndicator();
    if (!el) return;
    const active = isHydratingPosts || isHydratingMetrics || isMetricsPartial;
    if (active) {
      el.classList.add('is-active');
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.classList.remove('is-active');
      el.setAttribute('aria-hidden', 'true');
    }
    updateUserSelectHydrateIndicatorPosition();
  }

  function setPostsHydrateState(active){
    isHydratingPosts = !!active;
    const el = getPostsHydrateIndicator();
    if (!el) return;
    if (isHydratingPosts) {
      el.classList.add('is-active');
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.classList.remove('is-active');
      el.setAttribute('aria-hidden', 'true');
    }
    syncUserSelectHydrateIndicator();
  }

  function setMetricsHydrateState(active){
    isHydratingMetrics = !!active;
    syncUserSelectHydrateIndicator();
  }

  function formatPostCount(count){
    const num = Number(count) || 0;
    return `${num} ${num === 1 ? 'post' : 'posts'}`;
  }

  function formatUserOptionLabel(name, count){
    return `${name} - ${formatPostCount(count)}`;
  }

  function getUserDisplayLabel(userKey, user){
    if (!userKey) return '';
    if (isTopTodayKey(userKey)) return EVERYONE_LABEL;
    if (isCameoKey(userKey)) {
      const cameoName = user?.handle || cameoNameFromKey(userKey) || userKey;
      return formatCameoLabel(cameoName);
    }
    return user?.handle || userKey;
  }

  function getUserHandleLabel(userKey, user){
    if (!userKey) return '';
    if (isTopTodayKey(userKey)) return 'Top Today';
    if (isCameoKey(userKey)) return user?.handle || cameoNameFromKey(userKey) || userKey;
    return user?.handle || userKey;
  }

  function getFollowersSeriesForUser(userKey, user){
    let arr = Array.isArray(user?.followers) ? user.followers : [];
    if ((!arr || !arr.length) && isCameoKey(userKey)) {
      const fallbackUser = findUserByHandle(metrics, user?.handle || cameoNameFromKey(userKey));
      arr = Array.isArray(fallbackUser?.followers) ? fallbackUser.followers : arr;
    }
    return arr;
  }

  function formatUserSelectionLabel(userKey, user){
    if (!userKey) return '';
    const meta = user || findUserIndexEntry(userKey);
    const count = countUserPosts(user || meta);
    const name = getUserDisplayLabel(userKey, user || meta);
    return formatUserOptionLabel(name, count);
  }

  function buildUserSuggestionItems(metrics, query){
    const needle = (query || '').trim().toLowerCase();
    const items = [];
    const everyoneSearch = 'top today everyone all users';
    if ((!needle || everyoneSearch.includes(needle)) && !isMetricsPartial){
      const topToday = buildTopTodayUser(metrics);
      const postCount = countUserPosts(topToday);
      if (postCount > 0) {
        items.push({ key: TOP_TODAY_KEY, label: EVERYONE_LABEL, count: postCount, hint: '' });
      }
    }
    const cameoList = getCameoSuggestionItems(metrics, query);
    const cameoMap = new Map();
    for (const cameo of cameoList){
      const norm = normalizeMenuName(cameo.baseName || cameo.label);
      if (!norm || cameoMap.has(norm)) continue;
      cameoMap.set(norm, cameo);
    }
    const seenProfiles = new Set();
    const seenCameoKeys = new Set();
    const list = filterUsersByQuery(metrics, query);
    for (const [key, u] of list){
      const label = u.handle || key;
      const postCount = countUserPosts(u);
      if (postCount <= 0) continue;
      const norm = normalizeMenuName(label || key);
      if (norm && seenProfiles.has(norm)) continue;
      items.push({ key, label, count: postCount });
      if (norm) seenProfiles.add(norm);
      const cameo = norm ? cameoMap.get(norm) : null;
      if (cameo && !seenCameoKeys.has(cameo.key) && Number(cameo.count) > 0) {
        items.push({ key: cameo.key, label: cameo.label, count: Number(cameo.count) || 0 });
        seenCameoKeys.add(cameo.key);
      }
    }
    for (const cameo of cameoList){
      if (Number(cameo.count) <= 0) continue;
      if (seenCameoKeys.has(cameo.key)) continue;
      items.push(cameo);
      seenCameoKeys.add(cameo.key);
    }
    return items;
  }

  // Helper function to build post label with cameo info
  function buildPostLabel(post, userHandle) {
    const cap = (typeof post?.caption === 'string' && post.caption) ? post.caption.trim() : null;
    const cameos = Array.isArray(post?.cameo_usernames) ? post.cameo_usernames.filter(c => typeof c === 'string' && c.trim()) : [];
    const owner = userHandle || post?.ownerHandle || '';
    const captionText = cap || post.id || '';
    
    if (owner && cameos.length > 0) {
      const cameoList = cameos.join(', ');
      return `${owner} cast ${cameoList} - ${captionText}`;
    } else if (owner) {
      return `${owner} - ${captionText}`;
    } else {
      return captionText;
    }
  }

  function truncateForPurgeCaption(text){
    const clean = (typeof text === 'string' ? text.trim() : '') || 'this post';
    if (clean.length <= 100) return clean;
    return clean.slice(0, 100) + '...';
  }

  function initSidebarResizer(){
    const sidebar = document.querySelector('.sidebar');
    const resizer = document.querySelector('.sidebar-resizer');
    if (!sidebar || !resizer) return;
    const root = document.documentElement;
    const clampWidth = (w)=>{
      const maxByWindow = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 360));
      return clamp(w, SIDEBAR_MIN_WIDTH, maxByWindow);
    };
    const applyWidth = (w)=>{
      const next = clampWidth(w);
      root.style.setProperty('--sidebar-width', `${next}px`);
      root.style.setProperty('--sidebar-min', `${SIDEBAR_MIN_WIDTH}px`);
      root.style.setProperty('--sidebar-max', `${SIDEBAR_MAX_WIDTH}px`);
      resizer.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
      resizer.setAttribute('aria-valuemax', String(SIDEBAR_MAX_WIDTH));
      resizer.setAttribute('aria-valuenow', String(Math.round(next)));
      return next;
    };

    let current = SIDEBAR_MIN_WIDTH;
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(saved)) current = saved;
    } catch {}
    current = applyWidth(current);

    let startX = 0;
    let startWidth = 0;
    const onMove = (e)=>{
      const next = applyWidth(startWidth + (e.clientX - startX));
      current = next;
    };
    const onUp = ()=>{
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing');
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(current)); } catch {}
    };
    resizer.addEventListener('mousedown', (e)=>{
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      document.body.classList.add('is-resizing');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    window.addEventListener('resize', ()=>{ current = applyWidth(current); });
  }

  function buildPostLabelKey(p){
    const cameoKey = Array.isArray(p.cameos) ? p.cameos.join('|') : '';
    const caption = p.caption || p.pid || '';
    return `${p.owner || ''}::${cameoKey}::${caption}`;
  }

  function buildPostLinkContent(link, p){
    link.textContent = '';
    if (p.owner) {
      const ownerSpan = document.createElement('span');
      ownerSpan.textContent = p.owner;
      ownerSpan.style.fontWeight = '800';
      link.appendChild(ownerSpan);

      if (p.cameos && p.cameos.length > 0) {
        const cameoWord = document.createElement('span');
        cameoWord.textContent = ' cast ';
        cameoWord.style.fontWeight = '300';
        link.appendChild(cameoWord);

        p.cameos.forEach((cameo, idx) => {
          const cameoSpan = document.createElement('span');
          cameoSpan.textContent = cameo;
          cameoSpan.style.fontWeight = '800';
          link.appendChild(cameoSpan);

          if (idx < p.cameos.length - 1) {
            const comma = document.createElement('span');
            comma.textContent = ', ';
            comma.style.fontWeight = '300';
            link.appendChild(comma);
          }
        });
      }

      const sep = document.createElement('span');
      sep.textContent = ' - ';
      sep.style.fontWeight = '300';
      link.appendChild(sep);

      const captionSpan = document.createElement('span');
      captionSpan.textContent = p.caption || p.pid;
      captionSpan.style.fontWeight = '300';
      link.appendChild(captionSpan);
    } else {
      const captionSpan = document.createElement('span');
      captionSpan.textContent = p.caption || p.pid;
      captionSpan.style.fontWeight = '300';
      link.appendChild(captionSpan);
    }
  }

  function ensureSortedPoints(points){
    if (!Array.isArray(points) || points.length < 2) return points;
    let sorted = true;
    for (let i = 1; i < points.length; i++){
      if (points[i].t < points[i-1].t){
        sorted = false;
        break;
      }
    }
    if (sorted) return points;
    return [...points].sort((a,b)=>a.t - b.t);
  }

  function updateSummaryMetrics(user, visibleSet){
    try{
      const uniqueViewsEl = $('#uniqueViewsTotal');
      const totalViewsEl = $('#totalViewsTotal');
      const likesEl = $('#likesTotal');
      const repliesEl = $('#repliesTotal');
      const remixesEl = $('#remixesTotal');
      const interEl = $('#interactionsTotal');
      const cameosEl = $('#userCameosTotal');
      const followersEl = $('#userFollowersTotal');
      const isTopToday = user?.__specialKey === TOP_TODAY_KEY;
      if (isTopToday) {
        const cutoff = Date.now() - TOP_TODAY_WINDOW_MS;
        let totalUniqueViews = 0, totalViews = 0, totalLikes = 0, totalReplies = 0, totalRemixes = 0, totalInteractions = 0;
        const activeUsers = new Set();
        for (const [userKey, u] of Object.entries(metrics.users || {})) {
          for (const p of Object.values(u.posts || {})) {
            const postTime = getPostTimeForRecency(p);
            if (!postTime || postTime < cutoff) continue;
            activeUsers.add(userKey);
            const last = latestSnapshot(p.snapshots);
            totalUniqueViews += num(last?.uv);
            totalViews += num(last?.views);
            totalLikes += num(last?.likes);
            totalReplies += num(last?.comments);
            totalRemixes += num(latestRemixCountForPost(p));
            totalInteractions += interactionsOfSnap(last);
          }
        }
        if (uniqueViewsEl) uniqueViewsEl.textContent = fmt2(totalUniqueViews);
        if (totalViewsEl) totalViewsEl.textContent = fmt2(totalViews);
        if (likesEl) likesEl.textContent = fmt2(totalLikes);
        if (repliesEl) repliesEl.textContent = fmtK2OrInt(totalReplies);
        if (remixesEl) remixesEl.textContent = fmt2(totalRemixes);
        if (interEl) interEl.textContent = fmt2(totalInteractions);
        if (cameosEl) {
          let totalCameos = 0;
          for (const key of activeUsers) {
            const arr = Array.isArray(metrics.users?.[key]?.cameos) ? metrics.users[key].cameos : [];
            const last = arr.length > 0 ? arr[arr.length - 1] : null;
            totalCameos += num(last?.count);
          }
          cameosEl.textContent = fmtK2OrInt(totalCameos);
        }
        if (followersEl) {
          let totalFollowers = 0;
          for (const key of activeUsers) {
            const arr = Array.isArray(metrics.users?.[key]?.followers) ? metrics.users[key].followers : [];
            const last = arr.length > 0 ? arr[arr.length - 1] : null;
            totalFollowers += num(last?.count);
          }
          followersEl.textContent = fmtK2OrInt(totalFollowers);
        }
        return;
      }
      let totalUniqueViews = 0, totalViews = 0, totalLikes = 0, totalReplies = 0, totalRemixes = 0, totalInteractions = 0;
      const current = visibleSet ? Array.from(visibleSet) : [];
      for (const pid of current){
        const post = user.posts?.[pid];
        const last = latestSnapshot(post?.snapshots);
        totalUniqueViews += num(last?.uv);
        totalViews += num(last?.views);
        totalLikes += num(last?.likes);
        totalReplies += num(last?.comments);
        totalRemixes += num(latestRemixCountForPost(post));
        totalInteractions += interactionsOfSnap(last);
      }
      if (uniqueViewsEl) uniqueViewsEl.textContent = fmt2(totalUniqueViews);
      if (totalViewsEl) totalViewsEl.textContent = fmt2(totalViews);
      if (likesEl) likesEl.textContent = fmt2(totalLikes);
      if (repliesEl) repliesEl.textContent = fmtK2OrInt(totalReplies);
      if (remixesEl) remixesEl.textContent = fmt2(totalRemixes);
      if (interEl) interEl.textContent = fmt2(totalInteractions);
      if (cameosEl) {
        const cameosArr = Array.isArray(user.cameos) ? user.cameos : [];
        const lastCameo = cameosArr.length > 0 ? cameosArr[cameosArr.length - 1] : null;
        cameosEl.textContent = lastCameo ? fmtK2OrInt(lastCameo.count) : '0';
      }
      if (followersEl) {
        const followersArr = Array.isArray(user.followers) ? user.followers : [];
        const lastFollower = followersArr.length > 0 ? followersArr[followersArr.length - 1] : null;
        followersEl.textContent = lastFollower ? fmtK2OrInt(lastFollower.count) : '0';
      }
    } catch {}
  }

  function computeOrderedPosts(user, visibleSet, activeActionId){
    if (!user) return [];
    const isTopToday = user?.__specialKey === TOP_TODAY_KEY;
    const isVirtual = isVirtualUser(user);
    // Build and sort: known-dated posts first (newest -> oldest), undated go to bottom
    const mapped = Object.entries(user.posts||{}).map(([pid,p])=>{
      const last = latestSnapshot(p.snapshots) || {};
      const postTime = (isVirtual ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0;
      const rate = interactionRate(last);
      const bi = pidBigInt(pid);
      const views = num(last?.views);
      const likes = num(last?.likes);
      const lastSeen = p?.lastSeen || 0;
      const cap = (typeof p?.caption === 'string' && p.caption) ? p.caption.trim() : null;
      const cameos = Array.isArray(p?.cameo_usernames) ? p.cameo_usernames.filter(c => typeof c === 'string' && c.trim()) : [];
      const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');

      let label, title;
      const captionText = cap || pid;
      if (owner && cameos.length > 0) {
        const cameoList = cameos.join(', ');
        label = `${owner} cast ${cameoList} - ${captionText}`;
        title = label;
      } else if (owner) {
        label = `${owner} - ${captionText}`;
        title = label;
      } else {
        label = captionText;
        title = captionText;
      }

      return { pid, url: absUrl(p.url, pid), thumb: p.thumb, label, title, last, postTime, pidBI: bi, rate, cameos, owner, caption: cap, views, likes, lastSeen };
    });
    const withTs = mapped.filter(x=>x.postTime>0).sort((a,b)=>b.postTime - a.postTime);
    const noTs  = mapped.filter(x=>x.postTime<=0).sort((a,b)=>{
      if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
      return a.pidBI < b.pidBI ? 1 : -1;
    });
    const posts = withTs.concat(noTs);

    let orderedPosts = posts;
    if (activeActionId) {
      if (!visibleSet || visibleSet.size === 0) {
        const unselected = posts.slice();
        orderedPosts = [];
        orderedPosts.push({ __separator: true });
        orderedPosts.push(...unselected);
        return orderedPosts;
      }
      const pidToPost = new Map(posts.map(p=>[p.pid, p]));
      const bottomComparator = (a,b)=>{
        const dl = (a.likes - b.likes);
        if (dl !== 0) return dl;
        const dv = a.views - b.views;
        if (dv !== 0) return dv;
        const dt = (a.postTime || 0) - (b.postTime || 0);
        if (dt !== 0) return dt;
        if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
        return a.pidBI < b.pidBI ? -1 : 1;
      };
      const topComparator = (a,b)=>{
        const dl = (b.likes - a.likes);
        if (dl !== 0) return dl;
        const dv = b.views - a.views;
        if (dv !== 0) return dv;
        const dt = (b.postTime || 0) - (a.postTime || 0);
        if (dt !== 0) return dt;
        if (a.pidBI === b.pidBI) return b.pid.localeCompare(a.pid);
        return a.pidBI < b.pidBI ? 1 : -1;
      };

      let selectedOrdered = [];
      if (activeActionId === 'top5' || activeActionId === 'top10') {
        selectedOrdered = posts.filter(p=>visibleSet.has(p.pid)).slice().sort(topComparator);
      } else if (activeActionId === 'bottom5' || activeActionId === 'bottom10') {
        if (isTopToday) {
          selectedOrdered = posts.filter(p=>visibleSet.has(p.pid)).slice().sort(bottomComparator);
        } else {
          const now = Date.now();
          const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
          const withAge = posts.map(p=>({ ...p, ageMs: p.postTime ? now - p.postTime : Infinity }));
          const olderThan24h = withAge.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS).sort(bottomComparator);
          const allSorted = withAge.slice().sort(bottomComparator);
          for (const it of olderThan24h) {
            if (visibleSet.has(it.pid)) selectedOrdered.push(pidToPost.get(it.pid));
          }
          for (const it of allSorted) {
            if (visibleSet.has(it.pid) && !selectedOrdered.find(p=>p.pid===it.pid)) {
              selectedOrdered.push(pidToPost.get(it.pid));
            }
          }
        }
      } else if (activeActionId === 'stale') {
        // Keep the same default order as Show All/Hide All; visibleSet already holds stale pids.
        selectedOrdered = posts.filter(p=>visibleSet.has(p.pid));
      } else {
        selectedOrdered = posts.filter(p=>visibleSet.has(p.pid));
      }

      const unselected = posts.filter(p=>!visibleSet.has(p.pid));
      orderedPosts = [];
      orderedPosts.push(...selectedOrdered);
      if ((selectedOrdered.length || visibleSet.size === 0) || unselected.length) orderedPosts.push({ __separator: true });
      orderedPosts.push(...unselected);
    }

    return orderedPosts;
  }

  function computeVisibleSetForAction(user, actionId){
    if (!user || !actionId) return null;
    const useRecencyFallback = isVirtualUserKey(currentUserKey);
    const posts = user.posts || {};
    const makeSetFrom = (arr)=> {
      const s = new Set();
      arr.forEach(it=>{ if (it && it.pid) s.add(it.pid); });
      return s;
    };
    if (actionId === 'showAll') return new Set(Object.keys(posts));
    if (actionId === 'hideAll') return new Set();
    if (actionId === 'pastDay' || actionId === 'pastWeek'){
      const now = Date.now();
      const windowMs = actionId === 'pastDay' ? (24 * 60 * 60 * 1000) : (7 * 24 * 60 * 60 * 1000);
      const cutoff = now - windowMs;
      const mapped = Object.entries(posts).map(([pid,p])=>({
        pid,
        postTime: (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
        pidBI: pidBigInt(pid)
      }));
      const sorted = mapped.filter(x=>x.postTime>0 && x.postTime >= cutoff).sort((a,b)=>{
        const dt = b.postTime - a.postTime;
        if (dt !== 0) return dt;
        if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
        return a.pidBI < b.pidBI ? 1 : -1;
      });
      return makeSetFrom(sorted);
    }
    if (actionId === 'last5' || actionId === 'last10'){
      const mapped = Object.entries(posts).map(([pid,p])=>({
        pid,
        postTime: (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
        pidBI: pidBigInt(pid)
      }));
      const withTs = mapped.filter(x=>x.postTime>0).sort((a,b)=>b.postTime - a.postTime);
      const noTs = mapped.filter(x=>x.postTime<=0).sort((a,b)=>{
        if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
        return a.pidBI < b.pidBI ? 1 : -1;
      });
      const sorted = withTs.concat(noTs);
      return makeSetFrom(sorted.slice(0, actionId === 'last5' ? 5 : 10));
    }
    if (actionId === 'top5' || actionId === 'top10'){
      const mapped = Object.entries(posts).map(([pid,p])=>{
        const last = latestSnapshot(p.snapshots);
        return {
          pid,
          views: num(last?.views),
          likes: num(last?.likes),
          postTime: getPostTimeStrict(p) || 0,
          pidBI: pidBigInt(pid)
        };
      });
      const sorted = mapped.sort((a,b)=>{
        if (!a || !b) return !a && !b ? 0 : (!a ? 1 : -1);
        const dl = b.likes - a.likes;
        if (dl !== 0) return dl;
        const dv = b.views - a.views;
        if (dv !== 0) return dv;
        const dt = (b.postTime || 0) - (a.postTime || 0);
        if (dt !== 0) return dt;
        if (a.pidBI === b.pidBI) return b.pid.localeCompare(a.pid);
        return a.pidBI < b.pidBI ? 1 : -1;
      });
      return makeSetFrom(sorted.slice(0, actionId === 'top5' ? 5 : 10));
    }
    if (actionId === 'bottom5' || actionId === 'bottom10'){
      const now = Date.now();
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
      const mapped = Object.entries(posts).map(([pid,p])=>{
        const postTime = (isTopToday ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0;
        const ageMs = postTime ? now - postTime : Infinity;
        const last = latestSnapshot(p.snapshots);
        return {
          pid,
          postTime,
          views: num(last?.views),
          likes: num(last?.likes),
          ageMs,
          pidBI: pidBigInt(pid)
        };
      });
      const pickCount = actionId === 'bottom5' ? 5 : 10;
      const picked = (function(){
        if (isTopToday){
          const sorted = mapped.slice().sort((a,b)=>{
            const dl = a.likes - b.likes;
            if (dl !== 0) return dl;
            const dv = a.views - b.views;
            if (dv !== 0) return dv;
            const dt = (a.postTime || 0) - (b.postTime || 0);
            if (dt !== 0) return dt;
            if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
            return a.pidBI < b.pidBI ? -1 : 1;
          });
          return sorted.slice(0, pickCount);
        }
        const olderThan24h = mapped.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
        const sortedOlder = olderThan24h.sort((a,b)=>{
          const dl = a.likes - b.likes;
          if (dl !== 0) return dl;
          const dv = a.views - b.views;
          if (dv !== 0) return dv;
          const dt = (a.postTime || 0) - (b.postTime || 0);
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? -1 : 1;
        });
        const sortedAll = mapped.slice().sort((a,b)=>{
          const dl = a.likes - b.likes;
          if (dl !== 0) return dl;
          const dv = a.views - b.views;
          if (dv !== 0) return dv;
          const dt = (a.postTime || 0) - (b.postTime || 0);
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? -1 : 1;
        });
        const out = [];
        for (const it of sortedOlder) {
          if (out.length >= pickCount) break;
          out.push(it);
        }
        if (out.length < pickCount) {
          const seen = new Set(out.map(p=>p.pid));
          for (const it of sortedAll) {
            if (out.length >= pickCount) break;
            if (seen.has(it.pid)) continue;
            out.push(it);
          }
        }
        return out;
      })();
      return makeSetFrom(picked);
    }
    if (actionId === 'stale'){
      const now = Date.now();
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
      const mapped = Object.entries(posts).map(([pid,p])=>{
        const lastRefresh = lastRefreshMsForPost(p);
        const ageMs = lastRefresh ? now - lastRefresh : Infinity;
        return { pid, ageMs };
      });
      const stale = mapped.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
      return makeSetFrom(stale);
    }
    return null;
  }

  function applyPostRowUpdate(row, p, colorFor, visibleSet, opts){
    const cache = row._sctCache || {};
    row.dataset.pid = p.pid;
    const thumbDiv = cache.thumbDiv || row.querySelector('.thumb');
    const thumbLink = cache.thumbLink || row.querySelector('.thumb-link');
    if (thumbLink) {
      if (thumbLink.href !== p.url) thumbLink.href = p.url;
      if (thumbLink.title !== p.title) thumbLink.title = p.title;
    }
    const thumbChoice = getThumbDisplayChoice(p.thumb);
    if (thumbDiv) {
      if (row._sctThumbUrl !== thumbChoice.displayUrl || row._sctThumbSourceUrl !== thumbChoice.sourceUrl) {
        setThumbImageUrl(thumbDiv, thumbChoice.displayUrl, thumbChoice.sourceUrl);
        row._sctThumbUrl = thumbChoice.displayUrl;
        row._sctThumbSourceUrl = thumbChoice.sourceUrl;
      }
      const dotDiv = cache.dotDiv || thumbDiv.querySelector('.dot');
      if (dotDiv && typeof colorFor === 'function') {
        const nextColor = colorFor(p.pid);
        if (dotDiv.style.background !== nextColor) dotDiv.style.background = nextColor;
      }
    }
    const link = cache.link || row.querySelector('.id a');
    if (link) {
      if (link.href !== p.url) link.href = p.url;
      if (link.title !== p.title) link.title = p.title;
      const labelKey = buildPostLabelKey(p);
      if (row._sctLabelKey !== labelKey) {
        buildPostLinkContent(link, p);
        row._sctLabelKey = labelKey;
      }
    }
    const statsDiv = cache.statsDiv || row.querySelector('.stats');
    if (statsDiv) {
      const nextStats = `${fmt(p.last?.likes)} Likes - ${fmt1(p.last?.uv)} Viewers - ${p.rate==null?'-':p.rate.toFixed(1)+'%'} IR`;
      if (statsDiv.textContent !== nextStats) statsDiv.textContent = nextStats;
    }
    const toggleDiv = cache.toggleDiv || row.querySelector('.toggle');
    if (toggleDiv) {
      toggleDiv.dataset.pid = p.pid;
      if (visibleSet && !visibleSet.has(p.pid)) {
        row.classList.add('hidden');
        if (toggleDiv.textContent !== 'Show') toggleDiv.textContent = 'Show';
      } else {
        row.classList.remove('hidden');
        if (toggleDiv.textContent !== 'Hide') toggleDiv.textContent = 'Hide';
      }
    }
    row._sctPurgeSnippet = truncateForPurgeCaption(p.caption || p.label || p.pid);
    if (opts && typeof opts.onPurge === 'function') row._sctOnPurge = opts.onPurge;
  }

  function createPostRow(p, colorFor, visibleSet, opts){
    const row = document.createElement('div');
    row.className = 'post';
    row.dataset.pid = p.pid;
    const color = typeof colorFor === 'function' ? colorFor(p.pid) : getPaletteColor(0);
    const thumbChoice = getThumbDisplayChoice(p.thumb);

    const thumbLink = document.createElement('a');
    thumbLink.className = 'thumb-link';
    thumbLink.href = p.url;
    thumbLink.target = '_blank';
    thumbLink.rel = 'noopener';
    thumbLink.title = p.title;

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'thumb';
    setThumbImageUrl(thumbDiv, thumbChoice.displayUrl, thumbChoice.sourceUrl);
    const dotDiv = document.createElement('div');
    dotDiv.className = 'dot';
    dotDiv.style.background = color;
    thumbDiv.appendChild(dotDiv);
    thumbLink.appendChild(thumbDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'meta';

    const idDiv = document.createElement('div');
    idDiv.className = 'id';
    const link = document.createElement('a');
    link.href = p.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = p.title;
    buildPostLinkContent(link, p);
    idDiv.appendChild(link);

    const statsDiv = document.createElement('div');
    statsDiv.className = 'stats';
    statsDiv.textContent = `${fmt(p.last?.likes)} Likes - ${fmt1(p.last?.uv)} Viewers - ${p.rate==null?'-':p.rate.toFixed(1)+'%'} IR`;

    metaDiv.appendChild(idDiv);
    metaDiv.appendChild(statsDiv);

    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'toggle';
    toggleDiv.dataset.pid = p.pid;
    toggleDiv.textContent = 'Hide';

    const purgeBtn = document.createElement('button');
    purgeBtn.type = 'button';
    purgeBtn.className = 'post-purge-btn';
    purgeBtn.title = 'Purge data for this post';
    purgeBtn.textContent = '×';
    purgeBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const snippet = row._sctPurgeSnippet || truncateForPurgeCaption(p.caption || p.label || p.pid);
      const onPurge = row._sctOnPurge;
      if (onPurge) onPurge(p.pid, snippet);
    });

    row.appendChild(thumbLink);
    row.appendChild(metaDiv);
    row.appendChild(toggleDiv);
    row.appendChild(purgeBtn);
    row._sctCache = { thumbDiv, thumbLink, dotDiv, link, statsDiv, toggleDiv };
    row._sctLabelKey = buildPostLabelKey(p);
    row._sctThumbUrl = thumbChoice.displayUrl;
    row._sctThumbSourceUrl = thumbChoice.sourceUrl;
    row._sctPurgeSnippet = truncateForPurgeCaption(p.caption || p.label || p.pid);
    if (opts && typeof opts.onPurge === 'function') row._sctOnPurge = opts.onPurge;

    if (visibleSet && !visibleSet.has(p.pid)) { row.classList.add('hidden'); toggleDiv.textContent = 'Show'; }
    return row;
  }

  function syncPostsListRows(user, orderedPosts, colorFor, visibleSet, opts={}){
    const wrap = $('#posts');
    if (!wrap || !user) return false;
    wrap._sctOnHover = typeof opts.onHover === 'function' ? opts.onHover : null;
    wrap._sctSeparatorContext = { user };

    const prevRects = new Map();
        const animTargets = Array.from(wrap.querySelectorAll('.post, .posts-separator'));
    for (const el of animTargets) {
      prevRects.set(el, el.getBoundingClientRect());
    }

    const existingSeps = Array.from(wrap.querySelectorAll('.posts-separator'));
    const reusableSep = existingSeps.shift() || null;
    existingSeps.forEach((el)=> el.remove());
    const existingRows = new Map();
    Array.from(wrap.querySelectorAll('.post')).forEach((row)=> existingRows.set(row.dataset.pid, row));
    const used = new Set();
    const abovePids = [];
    let separatorUsed = false;
    for (const item of orderedPosts){
      if (item && item.__separator) {
        const sep = reusableSep || document.createElement('div');
        sep.className = 'posts-separator';
        sep.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'posts-separator-btn';
        if (abovePids.length && abovePids.length <= 20) {
          btn.textContent = `Open ${abovePids.length} Above`;
          btn.dataset.pids = JSON.stringify(abovePids);
          sep.appendChild(btn);
        } else if (!abovePids.length) {
          btn.textContent = 'No Results';
          btn.disabled = true;
          btn.style.cursor = 'default';
          btn.classList.add('no-results');
          sep.appendChild(btn);
        } else {
          sep.classList.add('no-button');
        }
        wrap.appendChild(sep);
        separatorUsed = true;
        continue;
      }
      const row = existingRows.get(item.pid) || createPostRow(item, colorFor, visibleSet, opts);
      applyPostRowUpdate(row, item, colorFor, visibleSet, opts);
      wrap.appendChild(row);
      used.add(item.pid);
      abovePids.push(item.pid);
    }
    for (const [pid, row] of existingRows){
      if (!used.has(pid)) row.remove();
    }
    if (!separatorUsed && reusableSep) reusableSep.remove();

    // If no separator used and no rows below, append an empty separator at end for consistent UI
    if (!separatorUsed) {
      const sep = reusableSep || document.createElement('div');
      sep.className = 'posts-separator';
      sep.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'posts-separator-btn';
      if (abovePids.length && abovePids.length <= 20) {
        btn.textContent = `Open ${abovePids.length} Above`;
        btn.dataset.pids = JSON.stringify(abovePids);
        sep.appendChild(btn);
      } else if (!abovePids.length) {
        btn.textContent = 'No Results';
        btn.disabled = true;
        sep.appendChild(btn);
      } else {
        sep.classList.add('no-button');
      }
      wrap.appendChild(sep);
    }
    const hydrateEl = getPostsHydrateIndicator();
    if (hydrateEl) wrap.appendChild(hydrateEl);

    if (prevRects.size > 0) {
      const MAX_FLIP_TRAVEL = 500;
      requestAnimationFrame(()=>{
        for (const el of animTargets) {
          const prev = prevRects.get(el);
          if (!prev || !document.body.contains(el)) continue;
          const next = el.getBoundingClientRect();
          let dx = prev.left - next.left;
          let dy = prev.top - next.top;
          if (!dx && !dy) continue;
          if (Math.abs(dx) > MAX_FLIP_TRAVEL || Math.abs(dy) > MAX_FLIP_TRAVEL) continue;
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(()=>{
            el.style.transition = '';
            el.style.transform = '';
          });
        }
      });
    }

    updateSummaryMetrics(user, visibleSet);

    if (!wrap._sctHoverBound){
      wrap._sctHoverBound = true;
      wrap.addEventListener('mouseover', (e)=>{
        const el = e.target.closest('.post');
        if (!el) return;
        wrap.classList.add('is-hovering');
        $$('.post', wrap).forEach(r=>r.classList.remove('hover'));
        el.classList.add('hover');
        if (wrap._sctOnHover) wrap._sctOnHover(el.dataset.pid);
      });
      wrap.addEventListener('mouseleave', ()=>{
        wrap.classList.remove('is-hovering');
        $$('.post', wrap).forEach(r=>r.classList.remove('hover'));
        if (wrap._sctOnHover) wrap._sctOnHover(null);
      });
    }
    if (!wrap._sctSeparatorBound){
      wrap._sctSeparatorBound = true;
      wrap.addEventListener('click', (e)=>{
        const btn = e.target.closest('.posts-separator-btn');
        if (!btn || !wrap.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        let pids = [];
        const raw = btn.dataset.pids;
        if (raw) {
          try { pids = JSON.parse(raw); } catch { pids = raw.split(',').map(s=>s.trim()).filter(Boolean); }
        }
        const ctx = wrap._sctSeparatorContext;
        const user = ctx?.user;
        if (!user || !pids.length) return;
        for (const pid of pids) {
          const url = absUrl(user.posts?.[pid]?.url, pid);
          if (url) window.open(url, '_blank');
        }
      });
    }
    return true;
  }

  function buildPostsList(user, colorFor, visibleSet, opts={}){
    const wrap = $('#posts');
    if (!wrap) return;
    if (!user) {
      wrap.innerHTML = '';
      return;
    }
    const orderedPosts = computeOrderedPosts(user, visibleSet, opts.activeActionId || null);
    syncPostsListRows(user, orderedPosts, colorFor, visibleSet, opts);
  }

  function updatePostsListRows(user, colorFor, visibleSet, opts={}){
    if (!user) return false;
    const orderedPosts = computeOrderedPosts(user, visibleSet, opts.activeActionId || null);
    return syncPostsListRows(user, orderedPosts, colorFor, visibleSet, opts);
  }

  function computeTotalsForUser(user){
    const res = { views:0, uniqueViews:0, likes:0, replies:0, remixes:0, interactions:0 };
    if (!user || !user.posts) return res;
    for (const [pid, p] of Object.entries(user.posts)){
      const last = latestSnapshot(p?.snapshots);
      if (!last) continue;
      res.views += num(last?.views);
      res.uniqueViews += num(last?.uv);
      res.likes += num(last?.likes);
      res.replies += num(last?.comments);
      res.remixes += num(latestRemixCountForPost(p));
      res.interactions += interactionsOfSnap(last);
    }
    return res;
  }

  function computeTotalsForUsers(userKeys, metrics){
    const res = { views:0, uniqueViews:0, likes:0, replies:0, remixes:0, interactions:0, cameos:0, followers:0 };
    for (const userKey of userKeys){
      const user = metrics?.users?.[userKey];
      if (!user) continue;
      const userTotals = computeTotalsForUser(user);
      res.views += userTotals.views;
      res.uniqueViews += userTotals.uniqueViews;
      res.likes += userTotals.likes;
      res.replies += userTotals.replies;
      res.remixes += userTotals.remixes;
      res.interactions += userTotals.interactions;
      // Get latest cast in count
      const cameosArr = Array.isArray(user.cameos) ? user.cameos : [];
      if (cameosArr.length > 0){
        const lastCameo = cameosArr[cameosArr.length - 1];
        res.cameos += num(lastCameo?.count);
      }
      // Get latest followers count
      const followersArr = Array.isArray(user.followers) ? user.followers : [];
      if (followersArr.length > 0){
        const lastFollower = followersArr[followersArr.length - 1];
        res.followers += num(lastFollower?.count);
      }
    }
    return res;
  }

  function safeGetDomain(chart){
    try {
      return chart && typeof chart.getDomain === 'function' ? chart.getDomain() : null;
    } catch {
      return null;
    }
  }

  function expandZoomRightIfAtEdge(chart, prevDomain, newDomain){
    try {
      if (!chart || !prevDomain?.x || !newDomain?.x) return;
      const z = chart.getZoom();
      if (!z || !z.x) return;
      const prevMax = prevDomain.x[1];
      const newMax = newDomain.x[1];
      const span = prevDomain.x[1] - prevDomain.x[0];
      if (!isFinite(prevMax) || !isFinite(newMax) || !isFinite(span) || span <= 0) return;
      if (newMax <= prevMax) return;
      const eps = Math.max(span * 0.002, 1);
      if (Math.abs(z.x[1] - prevMax) <= eps) {
        chart.setZoom({ x: [z.x[0], newMax], y: z.y });
      }
    } catch {}
  }

  function computeSeriesForUser(user, selectedPIDs, colorFor, useUniqueViews = true){
    const series=[];
    const entries = Object.entries(user.posts||{});
    const isVirtual = isVirtualUser(user);
    for (let i=0;i<entries.length;i++){
      const [pid, p] = entries[i];
      const pts = [];
      for (const s of (p.snapshots||[])){
        const r = interactionRate(s);
        const viewValue = useUniqueViews ? s.uv : s.views;
        if (viewValue != null && r != null) pts.push({ x:viewValue, y:r, t:s.t });
      }
      const color = typeof colorFor === 'function' ? colorFor(pid) : getPaletteColor(i);
      const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
      const label = buildPostLabel({ ...p, id: pid }, owner);
      if (pts.length) series.push({ id: pid, label, color, points: pts, highlighted: selectedPIDs.includes(pid) });
    }
    return series;
  }

  function makeColorMap(user){
    const key = user?.__specialKey || user?.handle || 'default';
    if (!makeColorMap.cache) makeColorMap.cache = new Map();
    const ids = Object.keys(user.posts||{}).sort();
    const cacheKey = key + '::' + ids.join(',');
    if (makeColorMap.cache.has(cacheKey)) return makeColorMap.cache.get(cacheKey);
    const map = new Map();
    ids.forEach((pid, idx)=> map.set(pid, getPaletteColor(idx)));
    const fn = (pid) => map.get(pid) || getPaletteColor(0);
    makeColorMap.cache.clear(); // keep cache bounded; only one entry needed per current state
    makeColorMap.cache.set(cacheKey, fn);
    return fn;
  }

  function extent(arr, acc){
    let lo= Infinity, hi=-Infinity;
    for (const v of arr){
      const x = acc(v);
      if (x==null || !isFinite(x)) continue;
      if (x<lo) lo=x; if (x>hi) hi=x;
    }
    if (lo===Infinity) lo=0; if (hi===-Infinity) hi=1;
    if (lo===hi){ hi = hi+1; lo = Math.max(0, lo-1); }
    return [lo,hi];
  }

  const LINE_CURVE_TENSION = 0.28;

  function drawSmoothLine(ctx, points, mapX, mapY, tension = LINE_CURVE_TENSION){
    if (!points || points.length < 2) return false;
    const mapped = points.map((p)=>({ x: mapX(p.x), y: mapY(p.y) }));
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    if (mapped.length === 2 || tension <= 0){
      ctx.lineTo(mapped[1].x, mapped[1].y);
      return true;
    }
    const t = Math.max(0, Math.min(1, tension));
    const smoothFactor = (p0, p1, p2)=>{
      const v1x = p1.x - p0.x;
      const v1y = p1.y - p0.y;
      const v2x = p2.x - p1.x;
      const v2y = p2.y - p1.y;
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (!len1 || !len2) return 0;
      const cos = clamp((v1x * v2x + v1y * v2y) / (len1 * len2), -1, 1);
      const angle = Math.acos(cos);
      const angleFactor = Math.max(0, 1 - angle / Math.PI);
      const lenFactor = Math.min(len1, len2) / Math.max(len1, len2);
      return angleFactor * lenFactor;
    };
    for (let i = 0; i < mapped.length - 1; i++){
      const p0 = mapped[i - 1] || mapped[i];
      const p1 = mapped[i];
      const p2 = mapped[i + 1];
      const p3 = mapped[i + 2] || p2;
      const t1 = t * smoothFactor(p0, p1, p2);
      const t2 = t * smoothFactor(p1, p2, p3);
      let cp1x = p1.x + (p2.x - p0.x) * t1 / 6;
      let cp1y = p1.y + (p2.y - p0.y) * t1 / 6;
      let cp2x = p2.x - (p3.x - p1.x) * t2 / 6;
      let cp2y = p2.y - (p3.y - p1.y) * t2 / 6;
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      cp1x = clamp(cp1x, minX, maxX);
      cp2x = clamp(cp2x, minX, maxX);
      cp1y = clamp(cp1y, minY, maxY);
      cp2y = clamp(cp2y, minY, maxY);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    return true;
  }

  function makeChart(canvas, xAxisLabel = 'Viewers', tooltipLabel = 'Viewers'){
    const ctx = canvas.getContext('2d');
    const DPR = Math.max(1, window.devicePixelRatio||1);
    let W = canvas.clientWidth||canvas.width, H = canvas.clientHeight||canvas.height;
    // plot area margins
    const M = { left:58, top:20, right:30, bottom:40 };
    function resize(){
      W = canvas.clientWidth||canvas.width; H = canvas.clientHeight||canvas.height;
      canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0);
      draw();
    }
    const state = { series:[], x:[0,1], y:[0,1], zoomX:null, zoomY:null, hover:null, hoverSeries:null };
    let hoverCb = null;

    function setData(series){
      state.series = series.map(s=>({
        ...s,
        points: ensureSortedPoints(s.points || [])
      }));
      const xs=[], ys=[];
      for (const s of state.series){
        for (const p of s.points){ xs.push(p.x); ys.push(p.y); }
      }
      state.x = extent(xs, d=>d);
      state.y = extent(ys, d=>d);
      draw();
    }

    function mapX(x){ const [a,b]=(state.zoomX||state.x); return M.left + ( (x-a)/(b-a) ) * (W - (M.left+M.right)); }
    function mapY(y){ const [a,b]=(state.zoomY||state.y); return H - M.bottom - ( (y-a)/(b-a) ) * (H - (M.top+M.bottom)); }
    function clampToPlot(px, py){
      const x = Math.max(M.left, Math.min(W - M.right, px));
      const y = Math.max(M.top, Math.min(H - M.bottom, py));
      return [x,y];
    }

    function grid(){
      const gridColor = getChartGridColor();
      ctx.strokeStyle = gridColor; ctx.lineWidth=1; ctx.setLineDash([4,4]);
      // verticals (x)
      for (let i=0;i<6;i++){ const x = M.left + i*(W-(M.left+M.right))/5; ctx.beginPath(); ctx.moveTo(x, M.top); ctx.lineTo(x, H - M.bottom); ctx.stroke(); }
      // horizontals (y)
      for (let i=0;i<6;i++){ const y = M.top + i*(H-(M.top+M.bottom))/5; ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    function axes(){
      const xDomain = state.zoomX || state.x;
      const yDomain = state.zoomY || state.y;
      ctx.strokeStyle = '#607080'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(M.left,M.top); ctx.lineTo(M.left,H-M.bottom); ctx.lineTo(W-M.right,H-M.bottom); ctx.stroke();
      ctx.fillStyle = '#a7b0ba'; ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      // ticks
      const xticks = 5, yticks=5;
      ctx.textAlign = 'right';
      for (let i=0;i<=xticks;i++){
        const x = M.left + i*(W-(M.left+M.right))/xticks; const v = xDomain[0] + i*(xDomain[1]-xDomain[0])/xticks;
        ctx.textAlign = 'left';
        ctx.fillText(fmt(Math.round(v)), x-10, H - (M.bottom - 18));
      }
      ctx.textAlign = 'right';
      for (let i=0;i<=yticks;i++){
        const y = H - M.bottom - i*(H-(M.top+M.bottom))/yticks; const v = yDomain[0] + i*(yDomain[1]-yDomain[0])/yticks;
        ctx.fillText(`${Number(v).toFixed(1)}%`, 50, y+4);
      }
      ctx.textAlign = 'left';
      // labels
      ctx.fillStyle = '#e8eaed'; ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText(xAxisLabel, W/2-50, H-6);
    }

    function drawSeries(){
      const muted = '#38424c';
      const anyHover = !!state.hoverSeries;
      for (const s of state.series){
        const color = (anyHover && state.hoverSeries !== s.id) ? muted : s.color;
        // line
        if (s.points.length>1){
          ctx.strokeStyle = color; ctx.lineWidth = s.highlighted ? 2.2 : 1.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          if (drawSmoothLine(ctx, s.points, mapX, mapY)) ctx.stroke();
        }
        // points
        for (const p of s.points){
          const x = mapX(p.x), y = mapY(p.y);
          const isHover = state.hover && state.hover.pid === s.id && state.hover.i === p.t;
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x,y, isHover?4.2:2.4, 0, Math.PI*2); ctx.fill();
          if (isHover){ ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x,y, 6, 0, Math.PI*2); ctx.stroke(); }
        }
      }
    }

    function draw(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      grid(); axes(); drawSeries();
    }

    // hover and click
    const tooltip = $('#tooltip');
    let rafPending = null;
    let lastHover = null;
    
    // Calculate distance from point to line segment
    function pointToLineDistance(px, py, x1, y1, x2, y2) {
      const A = px - x1;
      const B = py - y1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      let xx, yy;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      const dx = px - xx;
      const dy = py - yy;
      return Math.hypot(dx, dy);
    }

    function nearestLine(mx, my) {
      let best = null, bd = Infinity;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      for (const s of state.series) {
        if (s.points.length < 2) continue;
        for (let i = 0; i < s.points.length - 1; i++) {
          const p1 = s.points[i];
          const p2 = s.points[i + 1];
          const x1 = mapX(p1.x), y1 = mapY(p1.y);
          const x2 = mapX(p2.x), y2 = mapY(p2.y);
          // Skip if both points are outside plot
          if ((x1 < M.left && x2 < M.left) || (x1 > W - M.right && x2 > W - M.right) ||
              (y1 < M.top && y2 < M.top) || (y1 > H - M.bottom && y2 > H - M.bottom)) continue;
          const d = pointToLineDistance(mx, my, x1, y1, x2, y2);
          if (d < bd && d < 6) {
            bd = d;
            // Interpolate value at mouse x position
            let interpX = mouseX;
            let interpY = null;
            if (mouseX >= Math.min(p1.x, p2.x) && mouseX <= Math.max(p1.x, p2.x)) {
              if (p1.x === p2.x) {
                interpY = p1.y;
              } else {
                const t = (mouseX - p1.x) / (p2.x - p1.x);
                interpY = p1.y + (p2.y - p1.y) * t;
              }
            } else if (mouseX < Math.min(p1.x, p2.x)) {
              interpX = Math.min(p1.x, p2.x);
              interpY = p1.x < p2.x ? p1.y : p2.y;
            } else {
              interpX = Math.max(p1.x, p2.x);
              interpY = p1.x > p2.x ? p1.y : p2.y;
            }
            best = { pid: s.id, label: s.label || s.id, x: interpX, y: interpY, t: interpX, color: s.color, highlighted: s.highlighted, url: s.url, profileUrl: s.profileUrl, isLineHover: true };
          }
        }
      }
      return best;
    }

    function nearest(mx,my){
      let best=null, bd=Infinity;
      for (const s of state.series){
        for (const p of s.points){
          const x = mapX(p.x), y = mapY(p.y);
          // ignore points outside plot
          if (x < M.left || x > W - M.right || y < M.top || y > H - M.bottom) continue;
          const d = Math.hypot(mx-x,my-y);
          if (d<bd && d<16) { bd=d; best = { pid: s.id, label: s.label || s.id, x:p.x, y:p.y, t:p.t, color:s.color, highlighted:s.highlighted, url: s.url, profileUrl: s.profileUrl }; }
        }
      }
      return best;
    }

    function showTooltip(h, clientX, clientY){
      ensureTooltipInBody(tooltip);
      if (!h){ tooltip.style.display='none'; return; }
      tooltip.style.display='block';
      // Truncate label if longer than 150 chars (allow wrapping to multiple lines)
      let labelText = h.label || h.pid || '';
      if (labelText.length > 150) {
        labelText = labelText.substring(0, 150) + '...';
      }
      const header = `<div style="display:flex;align-items:flex-start;gap:6px"><span class="dot" style="background:${h.color};flex-shrink:0;margin-top:2px"></span><strong title="${esc(h.label||h.pid)}" style="word-wrap:break-word;overflow-wrap:break-word">${esc(labelText)}</strong></div>`;
      const engagements = Math.round(h.x * (h.y / 100));
      const viewsLabel = Math.round(h.x) === 1 ? 'view' : 'views';
      const engagementsLabel = engagements === 1 ? 'engagement' : 'engagements';
      const body = `<div class="tooltip-stats">${fmt(h.x)} ${viewsLabel} • ${h.y.toFixed(1)}% IR • ${fmt(engagements)} ${engagementsLabel}</div>`;
      tooltip.innerHTML = header + body;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const width = tooltip.offsetWidth || 0;
      let left = clientX + 8;
      if (left + width > vw - 8){
        left = clientX - 8 - width;
        if (left < 8) left = 8;
      }
      tooltip.style.left = left + 'px';
      tooltip.style.top  = (clientY + 8) + 'px';
    }

    function handleMouseMove(e){
      if (rafPending) return;
      rafPending = requestAnimationFrame(()=>{
        rafPending = null;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
        const my = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
        if (drag){ updateDragFromEvent(e); return; }
        const h = nearest(mx,my);
        let lineHover = null;
        if (!h) {
          lineHover = nearestLine(mx, my);
        }
        const hoverKey = h ? `${h.pid}-${h.t}` : (lineHover ? `${lineHover.pid}-line` : null);
        const prev = state.hoverSeries;
        state.hover = h || lineHover;
        // If no point hover, check for line hover
        if (!h) {
          state.hoverSeries = lineHover?.pid || null;
        } else {
          state.hoverSeries = h?.pid || null;
        }
        // Clear hoverSeries if not hovering over anything
        if (!h && !lineHover) {
          state.hoverSeries = null;
        }
        // Only skip redraw if both hover key and hoverSeries haven't changed
        if (hoverKey === lastHover && prev === state.hoverSeries) {
          showTooltip(h || lineHover, e.clientX, e.clientY);
          return;
        }
        lastHover = hoverKey;
        if (hoverCb && prev !== state.hoverSeries) hoverCb(state.hoverSeries);
        draw();
        showTooltip(h || lineHover, e.clientX, e.clientY);
      });
    }

    // Zoom drag state
    let drag = null; // {x0,y0,x1,y1}
    let dragRaf = 0;
    let lastDragPos = null;
    let dragMoved = false;
    let lastDragTs = 0;
    const dragClickThreshold = 4;

    function updateDragFromEvent(e){
      if (!drag || !e) return;
      lastDragPos = { x: e.clientX, y: e.clientY };
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        if (!drag || !lastDragPos) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (lastDragPos.x - rect.left) * (canvas.width / rect.width) / DPR;
        const my = (lastDragPos.y - rect.top) * (canvas.height / rect.height) / DPR;
        drag.x1 = mx;
        drag.y1 = my;
        const dx = mx - drag.x0;
        const dy = my - drag.y0;
        if (!dragMoved && Math.hypot(dx, dy) > dragClickThreshold) {
          dragMoved = true;
        }
        draw();
        drawDragRect(drag);
        showTooltip(null);
      });
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousemove', (e)=>{ if (drag) updateDragFromEvent(e); });
    canvas.addEventListener('mouseleave', ()=>{ rafPending = null; lastHover = null; state.hover=null; state.hoverSeries=null; if (hoverCb) hoverCb(null); draw(); if (drag) drawDragRect(drag); showTooltip(null); });
    canvas.addEventListener('click', (e)=>{
      // Skip link opens immediately after a drag selection
      if (drag) return;
      if (Date.now() - lastDragTs < 250) return;
      if (state.hover && state.hover.url) {
        window.open(state.hover.url, '_blank');
        return;
      }
      // If no point was clicked, check for line clicks
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
      const my = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
      const lineHit = nearestLine(mx, my);
      if (lineHit) {
        const url = lineHit.url || lineHit.profileUrl;
        if (url) window.open(url, '_blank');
      }
    });

    canvas.addEventListener('mousedown', (e)=>{
      const rect = canvas.getBoundingClientRect();
      let x0 = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
      let y0 = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
      // allow starting outside; we'll clamp on render/mouseup
      dragMoved = false;
      drag = { x0, y0, x1: null, y1: null };
    });
    window.addEventListener('mouseup', (e)=>{
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      let x1 = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
      let y1 = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
      const dx = x1 - drag.x0;
      const dy = y1 - drag.y0;
      const didDrag = dragMoved || Math.hypot(dx, dy) > dragClickThreshold;
      // clamp both ends to plot for decision and mapping
      const [cx0, cy0] = clampToPlot(drag.x0, drag.y0);
      const [cx1, cy1] = clampToPlot(x1, y1);
      drag.x1 = cx1; drag.y1 = cy1; // store clamped end for consistent rectangle draw
      const minW = 10, minH = 10;
      const w = Math.abs(cx1 - cx0), h = Math.abs(cy1 - cy0);
      if (didDrag) lastDragTs = Date.now();
      if (w > minW && h > minH){
        // convert to data space
        const [X0,X1] = [cx0, cx1].sort((a,b)=>a-b);
        const [Y0,Y1] = [cy0, cy1].sort((a,b)=>a-b);
        const invMapX = (px)=>{ const [a,b]=(state.zoomX||state.x); return a + ( (px - M.left)/(W - (M.left+M.right)) ) * (b-a); };
        const invMapY = (py)=>{ const [a,b]=(state.zoomY||state.y); return a + ( ( (H - M.bottom) - py)/(H - (M.top+M.bottom)) ) * (b-a); };
        state.zoomX = [invMapX(X0), invMapX(X1)];
        state.zoomY = [invMapY(Y1), invMapY(Y0)];
      }
      dragMoved = false;
      drag = null; draw(); showTooltip(null);
    });

    function drawDragRect(d){
      if (!d || d.x1==null || d.y1==null) return;
      const dragColors = getChartDragColors();
      ctx.save(); ctx.strokeStyle = dragColors.stroke; ctx.fillStyle = dragColors.fill; ctx.lineWidth=1; ctx.setLineDash([4,3]);
      // clamp rect to plot area for rendering
      const x0 = Math.max(M.left, Math.min(W - M.right, d.x0));
      const y0 = Math.max(M.top,  Math.min(H - M.bottom, d.y0));
      const x1 = Math.max(M.left, Math.min(W - M.right, d.x1));
      const y1 = Math.max(M.top,  Math.min(H - M.bottom, d.y1));
      const x = Math.min(x0,x1), y = Math.min(y0,y1), w = Math.abs(x1-x0), h = Math.abs(y1-y0);
      ctx.strokeRect(x,y,w,h); ctx.fillRect(x,y,w,h); ctx.restore();
    }

    // Double-click to reset zoom
    canvas.addEventListener('dblclick', ()=>{ resetZoom(); });

    window.addEventListener('resize', resize);
    resize();
    function resetZoom(){
      state.zoomX = null;
      state.zoomY = null;
      draw();
    }
    function setHoverSeries(pid){ state.hoverSeries = pid || null; draw(); }
    function onHover(cb){ hoverCb = cb; }
    function getZoom(){ return { x: state.zoomX ? [...state.zoomX] : null, y: state.zoomY ? [...state.zoomY] : null }; }
    function getDomain(){ return { x: state.x ? [...state.x] : null, y: state.y ? [...state.y] : null }; }
    function setZoom(z){
      if (!z) return;
      if (z.x && isFinite(z.x[0]) && isFinite(z.x[1])) state.zoomX = [z.x[0], z.x[1]];
      if (z.y && isFinite(z.y[0]) && isFinite(z.y[1])) state.zoomY = [z.y[0], z.y[1]];
      draw();
    }
    function setAxisLabels(xAxis, tooltip){ xAxisLabel = xAxis; tooltipLabel = tooltip; draw(); }
    return { setData, resetZoom, setHoverSeries, onHover, getZoom, getDomain, setZoom, setAxisLabels };
  }

function makeTimeChart(canvas, tooltipSelector = '#viewsTooltip', yAxisLabel = 'Views', yFmt = fmt){
    const ctx = canvas.getContext('2d');
    const DPR = Math.max(1, window.devicePixelRatio||1);
    let W = canvas.clientWidth||canvas.width, H = canvas.clientHeight||canvas.height;
    const M = { left:58, top:20, right:30, bottom:40 };
    function resize(){
      W = canvas.clientWidth||canvas.width; H = canvas.clientHeight||canvas.height;
      canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0);
      draw();
    }
    const state = { series:[], x:[0,1], y:[0,1], zoomX:null, zoomY:null, hover:null, hoverSeries:null, comparisonLine:null };
    let hoverCb = null;

    function setData(series){
      state.series = series.map(s=>({
        ...s,
        points: [...s.points].sort((a,b)=>a.t-b.t)
      }));
      const xs=[], ys=[];
      for (const s of state.series){
        for (const p of s.points){ xs.push(p.x); ys.push(p.y); }
      }
      state.x = extent(xs, d=>d);
      state.y = extent(ys, d=>d);
      draw();
    }

    function mapX(x){ const [a,b]=(state.zoomX||state.x); return M.left + ( (x-a)/(b-a||1) ) * (W - (M.left+M.right)); }
    function mapY(y){ const [a,b]=(state.zoomY||state.y); return H - M.bottom - ( (y-a)/(b-a||1) ) * (H - (M.top+M.bottom)); }
    function clampToPlot(px, py){
      const x = Math.max(M.left, Math.min(W - M.right, px));
      const y = Math.max(M.top, Math.min(H - M.bottom, py));
      return [x,y];
    }
    function grid(){
      const gridColor = getChartGridColor();
      ctx.strokeStyle = gridColor; ctx.lineWidth=1; ctx.setLineDash([4,4]);
      for (let i=0;i<6;i++){ const x = M.left + i*(W-(M.left+M.right))/5; ctx.beginPath(); ctx.moveTo(x, M.top); ctx.lineTo(x, H - M.bottom); ctx.stroke(); }
      for (let i=0;i<6;i++){ const y = M.top + i*(H-(M.top+M.bottom))/5; ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    function fmtDate(t){ try { const d=new Date(t); return d.toLocaleDateString(undefined,{month:'short',day:'2-digit'}); } catch { return String(t); } }
    function fmtDateTime(t){
      try {
        const d = new Date(t);
        const ds = d.toLocaleDateString(undefined,{month:'short',day:'2-digit'});
        const ts = d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
        return ds+" "+ts;
      } catch { return String(t); }
    }
    function axes(){
      const xDomain = state.zoomX || state.x;
      const yDomain = state.zoomY || state.y;
      ctx.strokeStyle = '#607080'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(M.left,M.top); ctx.lineTo(M.left,H-M.bottom); ctx.lineTo(W-M.right,H-M.bottom); ctx.stroke();
      ctx.fillStyle = '#a7b0ba'; ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      const xticks=5, yticks=5;
      const tickVals = [];
      for (let i=0;i<=xticks;i++) tickVals.push(Math.round(xDomain[0] + i*(xDomain[1]-xDomain[0])/xticks));
      for (let i=0;i<=xticks;i++){
        const x = M.left + i*(W-(M.left+M.right))/xticks; const v = tickVals[i];
        const label = fmtDate(v);
        const off = 24;
        ctx.textAlign = 'left';
        ctx.fillText(label, x-off, H - (M.bottom - 18));
      }
      ctx.textAlign = 'right';
      for (let i=0;i<=yticks;i++){
        const y = H - M.bottom - i*(H-(M.top+M.bottom))/yticks; const v = yDomain[0] + i*(yDomain[1]-yDomain[0])/yticks;
        ctx.fillText(yFmt(v), 50, y+4);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8eaed'; ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText('Time', W/2-20, H-6);
    }
    // Interpolate/extrapolate value for a series at a given x (time)
    function getValueAtX(series, x){
      if (!series.points || series.points.length === 0) return null;
      const pts = series.points;
      // Find the two points that bracket x, or use nearest if outside range
      let before = null, after = null;
      for (let i = 0; i < pts.length; i++){
        if (pts[i].x <= x) before = pts[i];
        if (pts[i].x >= x && !after) after = pts[i];
      }
      // If x is before all points, use first point (extrapolate backward)
      if (!before && after) return after.y;
      // If x is after all points, use last point (extrapolate forward)
      if (before && !after) return before.y;
      // If we have both, interpolate
      if (before && after){
        if (before.x === after.x) return before.y;
        const t = (x - before.x) / (after.x - before.x);
        return before.y + (after.y - before.y) * t;
      }
      // Fallback to first point
      return pts[0]?.y ?? null;
    }
    
    // Find two nearest series vertically at mouse x position
    function findNearestTwoSeries(mx, my){
      if (state.series.length < 2) return null;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      const candidates = [];
      for (const s of state.series){
        const val = getValueAtX(s, mouseX);
        if (val == null) continue;
        const y = mapY(val);
        if (y < M.top || y > H - M.bottom) continue;
        const dist = Math.abs(my - y);
        candidates.push({ series: s, y, val, dist });
      }
      if (candidates.length < 2) return null;
      candidates.sort((a,b) => a.dist - b.dist);
      return {
        top: candidates[0].y < candidates[1].y ? candidates[0] : candidates[1],
        bottom: candidates[0].y < candidates[1].y ? candidates[1] : candidates[0],
        x: mx,
        mouseX
      };
    }
    
    // Calculate distance from point to line segment
    function pointToLineDistance(px, py, x1, y1, x2, y2) {
      const A = px - x1;
      const B = py - y1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      let xx, yy;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      const dx = px - xx;
      const dy = py - yy;
      return Math.hypot(dx, dy);
    }

    function nearestLine(mx, my) {
      let best = null, bd = Infinity;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      for (const s of state.series) {
        if (s.points.length < 2) continue;
        for (let i = 0; i < s.points.length - 1; i++) {
          const p1 = s.points[i];
          const p2 = s.points[i + 1];
          const x1 = mapX(p1.x), y1 = mapY(p1.y);
          const x2 = mapX(p2.x), y2 = mapY(p2.y);
          // Skip if both points are outside plot
          if ((x1 < M.left && x2 < M.left) || (x1 > W - M.right && x2 > W - M.right) ||
              (y1 < M.top && y2 < M.top) || (y1 > H - M.bottom && y2 > H - M.bottom)) continue;
          const d = pointToLineDistance(mx, my, x1, y1, x2, y2);
          if (d < bd && d < 6) {
            bd = d;
            // Interpolate value at mouse x position
            let interpX = mouseX;
            let interpY = null;
            if (mouseX >= Math.min(p1.x, p2.x) && mouseX <= Math.max(p1.x, p2.x)) {
              if (p1.x === p2.x) {
                interpY = p1.y;
              } else {
                const t = (mouseX - p1.x) / (p2.x - p1.x);
                interpY = p1.y + (p2.y - p1.y) * t;
              }
            } else if (mouseX < Math.min(p1.x, p2.x)) {
              interpX = Math.min(p1.x, p2.x);
              interpY = p1.x < p2.x ? p1.y : p2.y;
            } else {
              interpX = Math.max(p1.x, p2.x);
              interpY = p1.x > p2.x ? p1.y : p2.y;
            }
            best = { pid: s.id, label: s.label || s.id, x: interpX, y: interpY, t: interpX, color: s.color, url: s.url, profileUrl: s.profileUrl, isLineHover: true };
          }
        }
      }
      return best;
    }

    function nearest(mx,my){
      let best=null, bd=Infinity;
      for (const s of state.series){
        for (const p of s.points){
          const x = mapX(p.x), y = mapY(p.y);
          if (x < M.left || x > W - M.right || y < M.top || y > H - M.bottom) continue;
          const d = Math.hypot(mx-x,my-y);
          if (d < bd && d < 16){
            bd = d;
            best = { pid: s.id, label: s.label || s.id, x: p.x, y: p.y, t: p.t, color: s.color, url: s.url, profileUrl: s.profileUrl };
          }
        }
      }
      return best;
    }
    const tooltip = $(tooltipSelector);
    let rafPending = null;
    let lastHover = null;
    
    function showTooltip(h, clientX, clientY, comparisonData){
      ensureTooltipInBody(tooltip);
      if (comparisonData){
        const diff = Math.abs(comparisonData.top.val - comparisonData.bottom.val);
        const unit = yAxisLabel || 'Views';
        const unitLower = unitLabelForValue(unit, diff);
        const isViewsPerPerson = unit === 'Views Per Person';
        const diffFormatted = isViewsPerPerson ? Number(diff).toFixed(2) : fmt(Math.ceil(diff));
        const topColor = comparisonData.top.series.color || '#7dc4ff';
        const bottomColor = comparisonData.bottom.series.color || '#7dc4ff';
        tooltip.style.display='block';
        tooltip.innerHTML = `<div class="tooltip-stats-row">
          <div style="position:relative;width:20px;height:20px;">
            <span class="dot" style="position:absolute;left:0;top:0;width:16px;height:16px;background:${topColor};z-index:2;"></span>
            <span class="dot" style="position:absolute;left:8px;top:0;width:16px;height:16px;background:${bottomColor};z-index:1;"></span>
          </div>
          <strong>${diffFormatted} ${unitLower} gap</strong>
        </div>`;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const width = tooltip.offsetWidth || 0;
        let left = clientX + 8;
        if (left + width > vw - 8){
          left = clientX - 8 - width;
          if (left < 8) left = 8;
        }
        tooltip.style.left = left + 'px';
        tooltip.style.top = (clientY + 8) + 'px';
        return;
      }
      if (!h){ tooltip.style.display='none'; return; }
      tooltip.style.display='block';
      // Check if this is a profile line (has profileUrl)
      if (h.profileUrl) {
        // Extract handle from label (e.g., "@handle's Views" -> "@handle")
        let handle = h.label || h.pid || '';
        handle = handle.replace(/'s (Views|Likes|Cast in|Followers)$/i, '').trim();
        if (!handle.startsWith('@')) handle = '@' + handle;
        const rawUnit = yAxisLabel || 'Views';
        const unit = (/views/i.test(rawUnit) && !/views per person/i.test(rawUnit)) ? 'Views' : rawUnit;
        const unitLower = unitLabelForValue(unit, Number(h.y));
        const dateStr = fmtDateTime(h.x);
        const numStr = yFmt(h.y);
        // Truncate handle if longer than 150 chars (allow wrapping to multiple lines)
        let displayHandle = handle;
        let displayText = `${displayHandle} ${numStr} ${unitLower}`;
        if (displayText.length > 150) {
          displayHandle = displayHandle.length > 150 ? displayHandle.substring(0, 150) + '...' : displayHandle;
          displayText = `${displayHandle} ${numStr} ${unitLower}`;
          if (displayText.length > 150) {
            displayText = displayText.substring(0, 150) + '...';
          }
        }
        tooltip.innerHTML = `<div style="display:flex;align-items:flex-start;gap:6px"><span class="dot" style="background:${h.color};flex-shrink:0;margin-top:2px"></span><strong title="${esc(handle)} ${numStr} ${unitLower}" style="word-wrap:break-word;overflow-wrap:break-word">${esc(displayText)}</strong></div><div class="tooltip-subtext">on ${dateStr}</div>`;
      } else {
        // Truncate label if longer than 150 chars (allow wrapping to multiple lines)
        let labelText = h.label || h.pid || '';
        if (labelText.length > 150) {
          labelText = labelText.substring(0, 150) + '...';
        }
        const header = `<div style="display:flex;align-items:flex-start;gap:6px"><span class="dot" style="background:${h.color};flex-shrink:0;margin-top:2px"></span><strong title="${esc(h.label||h.pid)}" style="word-wrap:break-word;overflow-wrap:break-word">${esc(labelText)}</strong></div>`;
        const rawUnit = yAxisLabel || 'Views';
        const unit = (/views/i.test(rawUnit) && !/views per person/i.test(rawUnit)) ? 'Views' : rawUnit;
        const unitLower = unitLabelForValue(unit, Number(h.y));
        const body = `<div class="tooltip-stats">${fmtDateTime(h.x)} • ${yFmt(h.y)} ${unitLower}</div>`;
        tooltip.innerHTML = header + body;
      }
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const width = tooltip.offsetWidth || 0;
      let left = clientX + 8;
      if (left + width > vw - 8){
        left = clientX - 8 - width;
        if (left < 8) left = 8;
      }
      tooltip.style.left = left + 'px';
      tooltip.style.top = (clientY + 8) + 'px';
    }
    
    function handleMouseMove(e){
      if (rafPending) return;
      rafPending = requestAnimationFrame(()=>{
        rafPending = null;
        const rect=canvas.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; const my=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR;
        if (drag){ updateDragFromEvent(e); return; }
        
        const h = nearest(mx,my);
        let lineHover = null;
        if (!h) {
          lineHover = nearestLine(mx, my);
        }
        const hoverKey = h ? `${h.pid}-${h.t}` : (lineHover ? `${lineHover.pid}-line` : null);
        const prev=state.hoverSeries;
        state.hover=h || lineHover;
        
        // Always check for line hover to update hoverSeries for dimming effect
        if (!h) {
          state.hoverSeries = lineHover?.pid || null;
        } else {
          state.hoverSeries = h?.pid || null;
        }
        // Clear hoverSeries if not hovering over anything
        if (!h && !lineHover) {
          state.hoverSeries = null;
        }
        
        // Check if we're in comparison mode (2+ series) and find nearest two
        // Only show comparison line if NOT hovering over a specific point or line
        const comparison = (!h && !lineHover && state.series.length >= 2) ? findNearestTwoSeries(mx, my) : null;
        if (comparison && mx >= M.left && mx <= W - M.right){
          state.comparisonLine = comparison;
          // Redraw if hoverSeries changed to update dimming
          if (prev !== state.hoverSeries) {
            if (hoverCb) hoverCb(state.hoverSeries);
          }
          draw();
          showTooltip(null, e.clientX, e.clientY, comparison);
          lastHover = hoverKey;
          return;
        }
        
        state.comparisonLine = null;
        // Only skip redraw if both hover key and hoverSeries haven't changed
        if (hoverKey === lastHover && prev === state.hoverSeries) {
          showTooltip(h || lineHover, e.clientX, e.clientY);
          return;
        }
        lastHover = hoverKey;
        if (hoverCb && prev!==state.hoverSeries) hoverCb(state.hoverSeries);
        draw();
        showTooltip(h || lineHover, e.clientX, e.clientY);
      });
    }
    
    let drag=null;
    let dragRaf = 0;
    let lastDragPos = null;
    let dragMoved = false;
    let lastDragTs = 0;
    const dragClickThreshold = 4;

    function updateDragFromEvent(e){
      if (!drag || !e) return;
      lastDragPos = { x: e.clientX, y: e.clientY };
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        if (!drag || !lastDragPos) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (lastDragPos.x - rect.left) * (canvas.width / rect.width) / DPR;
        const my = (lastDragPos.y - rect.top) * (canvas.height / rect.height) / DPR;
        drag.x1 = mx;
        drag.y1 = my;
        const dx = mx - drag.x0;
        const dy = my - drag.y0;
        if (!dragMoved && Math.hypot(dx, dy) > dragClickThreshold) {
          dragMoved = true;
        }
        state.comparisonLine = null;
        draw();
        drawDragRect(drag);
        showTooltip(null);
      });
    }
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousemove', (e)=>{ if (drag) updateDragFromEvent(e); });
    canvas.addEventListener('mouseleave', ()=>{ rafPending = null; lastHover = null; state.hover=null; state.hoverSeries=null; state.comparisonLine=null; if (hoverCb) hoverCb(null); draw(); if (drag) drawDragRect(drag); showTooltip(null); });
    // Track recent double-click to avoid opening posts while resetting zoom
    let lastDblClickTs = 0;
    canvas.addEventListener('dblclick', ()=>{ lastDblClickTs = Date.now(); resetZoom(); });
    canvas.addEventListener('click', (e)=>{
      const now = Date.now();
      if (now - lastDblClickTs < 250) return; // ignore clicks immediately after dblclick
      if (now - lastDragTs < 250) return;
      if (state.hover && state.hover.url) {
        window.open(state.hover.url,'_blank');
        return;
      }
      // If no point was clicked, check for line clicks
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
      const my = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
      const lineHit = nearestLine(mx, my);
      if (lineHit) {
        const url = lineHit.url || lineHit.profileUrl;
        if (url) window.open(url, '_blank');
      }
    });
    canvas.addEventListener('mousedown',(e)=>{
      const rect=canvas.getBoundingClientRect(); let x0=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; let y0=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR; dragMoved=false; drag={x0,y0,x1:null,y1:null};
    });
    window.addEventListener('mouseup',(e)=>{
      if (!drag) return; const rect=canvas.getBoundingClientRect(); let x1=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; let y1=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR; const dx=x1-drag.x0; const dy=y1-drag.y0; const didDrag=dragMoved||Math.hypot(dx, dy)>dragClickThreshold;
      const [cx0,cy0]=clampToPlot(drag.x0,drag.y0); const [cx1,cy1]=clampToPlot(x1,y1);
      drag.x1=cx1; drag.y1=cy1; const minW=10,minH=10; const w=Math.abs(cx1-cx0), h=Math.abs(cy1-cy0); if (didDrag) lastDragTs=Date.now();
      if (w>minW && h>minH){ const [X0,X1]=[cx0,cx1].sort((a,b)=>a-b); const [Y0,Y1]=[cy0,cy1].sort((a,b)=>a-b);
        const invMapX=(px)=>{ const [a,b]=(state.zoomX||state.x); return a + ((px-M.left)/(W-(M.left+M.right)))*(b-a); };
        const invMapY=(py)=>{ const [a,b]=(state.zoomY||state.y); return a + (((H-M.bottom)-py)/(H-(M.top+M.bottom)))*(b-a); };
        state.zoomX=[invMapX(X0),invMapX(X1)]; state.zoomY=[invMapY(Y1),invMapY(Y0)]; }
      dragMoved=false; drag=null; draw(); showTooltip(null);
    });
    function drawDragRect(d){
      if (!d||d.x1==null||d.y1==null) return;
      const dragColors = getChartDragColors();
      ctx.save(); ctx.strokeStyle=dragColors.stroke; ctx.fillStyle=dragColors.fill; ctx.lineWidth=1; ctx.setLineDash([4,3]);
      const x0=Math.max(M.left,Math.min(W-M.right,d.x0)); const y0=Math.max(M.top,Math.min(H-M.bottom,d.y0)); const x1=Math.max(M.left,Math.min(W-M.right,d.x1)); const y1=Math.max(M.top,Math.min(H-M.bottom,d.y1));
      const x=Math.min(x0,x1), y=Math.min(y0,y1), w=Math.abs(x1-x0), h=Math.abs(y1-y0); ctx.strokeRect(x,y,w,h); ctx.fillRect(x,y,w,h); ctx.restore(); }
    function drawComparisonLine(){
      if (!state.comparisonLine) return;
      const cl = state.comparisonLine;
      const x = Math.max(M.left, Math.min(W - M.right, cl.x));
      const topY = Math.max(M.top, Math.min(H - M.bottom, cl.top.y));
      const bottomY = Math.max(M.top, Math.min(H - M.bottom, cl.bottom.y));
      ctx.save();
      const topColor = cl.top.series.color || '#7dc4ff';
      const bottomColor = cl.bottom.series.color || '#7dc4ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]); // No dash pattern, we'll draw segments manually
      
      // Calculate line length and segment size
      const lineLength = Math.abs(bottomY - topY);
      const dashLength = 4;
      const gapLength = 4;
      const segmentLength = dashLength + gapLength;
      const numSegments = Math.ceil(lineLength / segmentLength);
      
      // Draw alternating colored dashes
      const startY = Math.min(topY, bottomY);
      for (let i = 0; i < numSegments; i++) {
        const yStart = startY + (i * segmentLength);
        const yEnd = Math.min(startY + (i * segmentLength) + dashLength, startY + lineLength);
        
        if (yStart >= startY + lineLength) break;
        
        // Alternate colors: even segments use top color, odd use bottom color
        ctx.strokeStyle = (i % 2 === 0) ? topColor : bottomColor;
        ctx.beginPath();
        ctx.moveTo(x, yStart);
        ctx.lineTo(x, yEnd);
        ctx.stroke();
      }
      ctx.restore();
    }
    
    function drawSeries(){
      const muted='#38424c'; const anyHover=!!state.hoverSeries;
      for (const s of state.series){ const color=(anyHover && state.hoverSeries!==s.id)?muted:s.color; if (s.points.length>1){ ctx.strokeStyle=color; ctx.lineWidth=1.4; ctx.lineJoin='round'; ctx.lineCap='round';
        if (drawSmoothLine(ctx, s.points, mapX, mapY)) ctx.stroke(); }
        for (const p of s.points){ const x=mapX(p.x), y=mapY(p.y); const isHover=state.hover && state.hover.pid===s.id && state.hover.i===p.t; ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,isHover?4.2:2.4,0,Math.PI*2); ctx.fill(); if (isHover){ ctx.strokeStyle='#ffffffaa'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.stroke(); } }
      }
    }
    function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); grid(); axes(); drawSeries(); drawComparisonLine(); }
    window.addEventListener('resize', resize); resize();
    function resetZoom(){
      state.zoomX = null;
      state.zoomY = null;
      draw();
    }
    function setHoverSeries(pid){ state.hoverSeries=pid||null; draw(); }
    function onHover(cb){ hoverCb=cb; }
    function getZoom(){ return { x: state.zoomX ? [...state.zoomX] : null, y: state.zoomY ? [...state.zoomY] : null }; }
    function getDomain(){ return { x: state.x ? [...state.x] : null, y: state.y ? [...state.y] : null }; }
    function setZoom(z){ if (!z) return; if (z.x && isFinite(z.x[0]) && isFinite(z.x[1])) state.zoomX = [z.x[0], z.x[1]]; if (z.y && isFinite(z.y[0]) && isFinite(z.y[1])) state.zoomY = [z.y[0], z.y[1]]; draw(); }
    function setYAxisLabel(label){ yAxisLabel = label; draw(); }
    return { setData, resetZoom, setHoverSeries, onHover, getZoom, getDomain, setZoom, setYAxisLabel };
  }

  // First 24 hours views chart (x-axis = minutes since post creation, y-axis = views)
  function makeFirst24HoursChart(canvas, tooltipSelector = '#first24HoursTooltip', yAxisLabel = 'Views', yFmt = fmt){
    const ctx = canvas.getContext('2d');
    const DPR = Math.max(1, window.devicePixelRatio||1);
    let W = canvas.clientWidth||canvas.width, H = canvas.clientHeight||canvas.height;
    const M = { left:58, top:20, right:30, bottom:40 };
    function resize(){
      W = canvas.clientWidth||canvas.width; H = canvas.clientHeight||canvas.height;
      canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0);
      draw();
    }
    const state = { series:[], x:[0,1], y:[0,1], zoomX:null, zoomY:null, hover:null, hoverSeries:null, comparisonLine:null, timeWindowMinutes:STACKED_WINDOW_MINUTES_DEFAULT, timeWindowMinMinutes:0 };
    let hoverCb = null;

    function setData(series, minMinutes = 0, maxMinutes = STACKED_WINDOW_MINUTES_DEFAULT){
      state.timeWindowMinMinutes = minMinutes;
      state.timeWindowMinutes = maxMinutes;
      const EPS = 1e-6;
      const interpolateAt = (pts, target)=>{
        if (!pts.length) return null;
        let before = null;
        let after = null;
        for (const p of pts){
          if (p.x <= target) before = p;
          if (p.x >= target){ after = p; break; }
        }
        if (!before || !after) return null;
        const span = after.x - before.x;
        const t = Math.abs(span) < EPS ? 0 : (target - before.x) / span;
        const y = before.y + (after.y - before.y) * t;
        const time = before.t + (after.t - before.t) * t;
        return { x: target, y, t: time, originalX: null, isInterpolated: true };
      };
      // Filter and transform points: x = minutes since post creation, y = views
      state.series = series.map(s=>{
        if (!s.postTime || !s.points?.length) return { ...s, points: [] };
        const allPoints = s.points
          .filter(p => p.t != null && p.y != null)
          .map(p => {
            const minutesSinceCreation = (p.t - s.postTime) / (60 * 1000);
            return { x: minutesSinceCreation, y: p.y, t: p.t, originalX: p.x };
          })
          .sort((a,b)=>a.x-b.x);
        if (!allPoints.length) return { ...s, points: [] };
        const windowed = allPoints.filter(p => p.x >= minMinutes && p.x <= maxMinutes);
        const addBoundaryPoint = (target, toStart)=>{
          const boundary = interpolateAt(allPoints, target);
          if (!boundary) return;
          const hasPoint = windowed.some(p => Math.abs(p.x - target) < EPS);
          if (hasPoint) return;
          if (toStart) windowed.unshift(boundary);
          else windowed.push(boundary);
        };
        addBoundaryPoint(minMinutes, true);
        addBoundaryPoint(maxMinutes, false);
        return { ...s, points: windowed };
      });
      const xs=[], ys=[];
      for (const s of state.series){
        for (const p of s.points){ xs.push(p.x); ys.push(p.y); }
      }
      state.x = extent(xs, d=>d);
      state.y = extent(ys, d=>d);
      if (state.x[0] === Infinity) state.x = [minMinutes, maxMinutes];
      if (state.y[0] === Infinity) state.y = [0, 1];
      draw();
    }

    function mapX(x){ const [a,b]=(state.zoomX||state.x); return M.left + ( (x-a)/(b-a||1) ) * (W - (M.left+M.right)); }
    function mapY(y){ const [a,b]=(state.zoomY||state.y); return H - M.bottom - ( (y-a)/(b-a||1) ) * (H - (M.top+M.bottom)); }
    function clampToPlot(px, py){
      const x = Math.max(M.left, Math.min(W - M.right, px));
      const y = Math.max(M.top, Math.min(H - M.bottom, py));
      return [x,y];
    }
    function grid(){
      const gridColor = getChartGridColor();
      ctx.strokeStyle = gridColor; ctx.lineWidth=1; ctx.setLineDash([4,4]);
      for (let i=0;i<6;i++){ const x = M.left + i*(W-(M.left+M.right))/5; ctx.beginPath(); ctx.moveTo(x, M.top); ctx.lineTo(x, H - M.bottom); ctx.stroke(); }
      for (let i=0;i<6;i++){ const y = M.top + i*(H-(M.top+M.bottom))/5; ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    function fmtTime(minutes){
      if (minutes < 60) return `${Math.round(minutes)}m`;
      const totalMinutes = Math.round(minutes);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const mins = totalMinutes % 60;
      if (days > 0) {
        if (hours === 0 && mins === 0) return `${days}d`;
        if (mins === 0) return `${days}d ${hours}h`;
        if (hours === 0) return `${days}d ${mins}m`;
        return `${days}d ${hours}h ${mins}m`;
      }
      if (mins === 0) return `${hours}h`;
      return `${hours}h ${mins}m`;
    }
    function axes(){
      const xDomain = state.zoomX || state.x;
      const yDomain = state.zoomY || state.y;
      ctx.strokeStyle = '#607080'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(M.left,M.top); ctx.lineTo(M.left,H-M.bottom); ctx.lineTo(W-M.right,H-M.bottom); ctx.stroke();
      ctx.fillStyle = '#a7b0ba'; ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      const xticks=5, yticks=5;
      const tickVals = [];
      for (let i=0;i<=xticks;i++) tickVals.push(xDomain[0] + i*(xDomain[1]-xDomain[0])/xticks);
      for (let i=0;i<=xticks;i++){
        const x = M.left + i*(W-(M.left+M.right))/xticks; const v = tickVals[i];
        const label = fmtTime(v);
        const off = label.length * 6;
        ctx.textAlign = 'left';
        ctx.fillText(label, x-off/2, H - (M.bottom - 18));
      }
      ctx.textAlign = 'right';
      for (let i=0;i<=yticks;i++){
        const y = H - M.bottom - i*(H-(M.top+M.bottom))/yticks; const v = yDomain[0] + i*(yDomain[1]-yDomain[0])/yticks;
        ctx.fillText(yFmt(v), 50, y+4);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8eaed'; ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText('Time Since Creation', W/2-60, H-6);
    }
    // Interpolate/extrapolate value for a series at a given x (time)
    function getValueAtX(series, x){
      if (!series.points || series.points.length === 0) return null;
      const pts = series.points;
      let before = null, after = null;
      for (let i = 0; i < pts.length; i++){
        if (pts[i].x <= x) before = pts[i];
        if (pts[i].x >= x && !after) after = pts[i];
      }
      if (!before && after) return after.y;
      if (before && !after) return before.y;
      if (before && after){
        if (before.x === after.x) return before.y;
        const t = (x - before.x) / (after.x - before.x);
        return before.y + (after.y - before.y) * t;
      }
      return pts[0]?.y ?? null;
    }
    
    // Find two nearest series vertically at mouse x position
    function findNearestTwoSeries(mx, my){
      if (state.series.length < 2) return null;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      const candidates = [];
      for (const s of state.series){
        const val = getValueAtX(s, mouseX);
        if (val == null) continue;
        const y = mapY(val);
        if (y < M.top || y > H - M.bottom) continue;
        const dist = Math.abs(my - y);
        candidates.push({ series: s, y, val, dist });
      }
      if (candidates.length < 2) return null;
      candidates.sort((a,b) => a.dist - b.dist);
      return {
        top: candidates[0].y < candidates[1].y ? candidates[0] : candidates[1],
        bottom: candidates[0].y < candidates[1].y ? candidates[1] : candidates[0],
        x: mx,
        mouseX
      };
    }
    
    // Calculate distance from point to line segment
    function pointToLineDistance(px, py, x1, y1, x2, y2) {
      const A = px - x1;
      const B = py - y1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      let xx, yy;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      const dx = px - xx;
      const dy = py - yy;
      return Math.hypot(dx, dy);
    }

    function nearestLine(mx, my) {
      let best = null, bd = Infinity;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      for (const s of state.series) {
        if (s.points.length < 2) continue;
        for (let i = 0; i < s.points.length - 1; i++) {
          const p1 = s.points[i];
          const p2 = s.points[i + 1];
          const x1 = mapX(p1.x), y1 = mapY(p1.y);
          const x2 = mapX(p2.x), y2 = mapY(p2.y);
          if ((x1 < M.left && x2 < M.left) || (x1 > W - M.right && x2 > W - M.right) ||
              (y1 < M.top && y2 < M.top) || (y1 > H - M.bottom && y2 > H - M.bottom)) continue;
          const d = pointToLineDistance(mx, my, x1, y1, x2, y2);
          if (d < bd && d < 6) {
            bd = d;
            let interpX = mouseX;
            let interpY = null;
            if (mouseX >= Math.min(p1.x, p2.x) && mouseX <= Math.max(p1.x, p2.x)) {
              if (p1.x === p2.x) {
                interpY = p1.y;
              } else {
                const t = (mouseX - p1.x) / (p2.x - p1.x);
                interpY = p1.y + (p2.y - p1.y) * t;
              }
            } else if (mouseX < Math.min(p1.x, p2.x)) {
              interpX = Math.min(p1.x, p2.x);
              interpY = p1.x < p2.x ? p1.y : p2.y;
            } else {
              interpX = Math.max(p1.x, p2.x);
              interpY = p1.x > p2.x ? p1.y : p2.y;
            }
            best = { pid: s.id, label: s.label || s.id, x: interpX, y: interpY, t: interpX, color: s.color, url: s.url, profileUrl: s.profileUrl, isLineHover: true, minutesSinceCreation: interpX, originalTime: s.postTime ? s.postTime + interpX * 60 * 1000 : null };
          }
        }
      }
      return best;
    }

    function nearest(mx,my){
      let best=null, bd=Infinity;
      for (const s of state.series){
        for (const p of s.points){
          if (p.isInterpolated) continue;
          const x = mapX(p.x), y = mapY(p.y);
          if (x < M.left || x > W - M.right || y < M.top || y > H - M.bottom) continue;
          const d = Math.hypot(mx-x,my-y);
          if (d < bd && d < 16){
            bd = d;
            best = { pid: s.id, label: s.label || s.id, x: p.x, y: p.y, t: p.t, color: s.color, url: s.url, profileUrl: s.profileUrl, minutesSinceCreation: p.x, originalTime: p.t };
          }
        }
      }
      return best;
    }
    const tooltip = $(tooltipSelector);
    let rafPending = null;
    let lastHover = null;
    
    function showTooltip(h, clientX, clientY, comparisonData){
      ensureTooltipInBody(tooltip);
      if (comparisonData){
        const diff = Math.abs(comparisonData.top.val - comparisonData.bottom.val);
        const unit = yAxisLabel || 'Views';
        const unitLower = unitLabelForValue(unit, diff);
        const isViewsPerPerson = unit === 'Views Per Person';
        const diffFormatted = isViewsPerPerson ? Number(diff).toFixed(2) : fmt(Math.ceil(diff));
        const topColor = comparisonData.top.series.color || '#7dc4ff';
        const bottomColor = comparisonData.bottom.series.color || '#7dc4ff';
        tooltip.style.display='block';
        tooltip.innerHTML = `<div class="tooltip-stats-row">
          <div style="position:relative;width:20px;height:20px;">
            <span class="dot" style="position:absolute;left:0;top:0;width:16px;height:16px;background:${topColor};z-index:2;"></span>
            <span class="dot" style="position:absolute;left:8px;top:0;width:16px;height:16px;background:${bottomColor};z-index:1;"></span>
          </div>
          <strong>${diffFormatted} ${unitLower} gap</strong>
        </div>`;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const width = tooltip.offsetWidth || 0;
        let left = clientX + 8;
        if (left + width > vw - 8){
          left = clientX - 8 - width;
          if (left < 8) left = 8;
        }
        tooltip.style.left = left + 'px';
        tooltip.style.top = (clientY + 8) + 'px';
        return;
      }
      if (!h){ tooltip.style.display='none'; return; }
      tooltip.style.display='block';
      if (h.profileUrl) {
        let handle = h.label || h.pid || '';
        handle = handle.replace(/'s (Views|Likes|Cast in|Followers)$/i, '').trim();
        if (!handle.startsWith('@')) handle = '@' + handle;
        const rawUnit = yAxisLabel || 'Views';
        const unit = (/views/i.test(rawUnit) && !/views per person/i.test(rawUnit)) ? 'Views' : rawUnit;
        const unitLower = unitLabelForValue(unit, Number(h.y));
        const timeStr = fmtTime(h.minutesSinceCreation || 0);
        const numStr = yFmt(h.y);
        // Truncate if longer than 150 chars (allow wrapping to multiple lines)
        let displayText = `${handle} ${numStr} ${unitLower}`;
        if (displayText.length > 150) {
          displayText = displayText.substring(0, 150) + '...';
        }
        tooltip.innerHTML = `<div style="display:flex;align-items:flex-start;gap:6px"><span class="dot" style="background:${h.color};flex-shrink:0;margin-top:2px"></span><strong title="${esc(handle)} ${numStr} ${unitLower}" style="word-wrap:break-word;overflow-wrap:break-word">${esc(displayText)}</strong></div><div class="tooltip-subtext">${timeStr} after creation</div>`;
      } else {
        // Truncate label if longer than 150 chars (allow wrapping to multiple lines)
        let labelText = h.label || h.pid || '';
        if (labelText.length > 150) {
          labelText = labelText.substring(0, 150) + '...';
        }
        const header = `<div style="display:flex;align-items:flex-start;gap:6px"><span class="dot" style="background:${h.color};flex-shrink:0;margin-top:2px"></span><strong title="${esc(h.label||h.pid)}" style="word-wrap:break-word;overflow-wrap:break-word">${esc(labelText)}</strong></div>`;
        const rawUnit = yAxisLabel || 'Views';
        const unit = (/views/i.test(rawUnit) && !/views per person/i.test(rawUnit)) ? 'Views' : rawUnit;
        const timeStr = fmtTime(h.minutesSinceCreation || 0);
        const unitLower = unitLabelForValue(unit, Number(h.y));
        const body = `<div class="tooltip-stats">${timeStr} after creation • ${yFmt(h.y)} ${unitLower}</div>`;
        tooltip.innerHTML = header + body;
      }
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const width = tooltip.offsetWidth || 0;
      let left = clientX + 8;
      if (left + width > vw - 8){
        left = clientX - 8 - width;
        if (left < 8) left = 8;
      }
      tooltip.style.left = left + 'px';
      tooltip.style.top = (clientY + 8) + 'px';
    }
    
    function handleMouseMove(e){
      if (rafPending) return;
      rafPending = requestAnimationFrame(()=>{
        rafPending = null;
        const rect=canvas.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; const my=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR;
        if (drag){ updateDragFromEvent(e); return; }
        
        const h = nearest(mx,my);
        let lineHover = null;
        if (!h) {
          lineHover = nearestLine(mx, my);
        }
        const hoverKey = h ? `${h.pid}-${h.t}` : (lineHover ? `${lineHover.pid}-line` : null);
        const prev=state.hoverSeries;
        state.hover=h || lineHover;
        
        if (!h) {
          state.hoverSeries = lineHover?.pid || null;
        } else {
          state.hoverSeries = h?.pid || null;
        }
        if (!h && !lineHover) {
          state.hoverSeries = null;
        }
        
        const comparison = (!h && !lineHover && state.series.length >= 2) ? findNearestTwoSeries(mx, my) : null;
        if (comparison && mx >= M.left && mx <= W - M.right){
          state.comparisonLine = comparison;
          if (prev !== state.hoverSeries) {
            if (hoverCb) hoverCb(state.hoverSeries);
          }
          draw();
          showTooltip(null, e.clientX, e.clientY, comparison);
          lastHover = hoverKey;
          return;
        }
        
        state.comparisonLine = null;
        if (hoverKey === lastHover && prev === state.hoverSeries) {
          showTooltip(h || lineHover, e.clientX, e.clientY);
          return;
        }
        lastHover = hoverKey;
        if (hoverCb && prev!==state.hoverSeries) hoverCb(state.hoverSeries);
        draw();
        showTooltip(h || lineHover, e.clientX, e.clientY);
      });
    }
    
    let drag=null;
    let dragRaf = 0;
    let lastDragPos = null;
    let dragMoved = false;
    let lastDragTs = 0;
    const dragClickThreshold = 4;

    function updateDragFromEvent(e){
      if (!drag || !e) return;
      lastDragPos = { x: e.clientX, y: e.clientY };
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        if (!drag || !lastDragPos) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (lastDragPos.x - rect.left) * (canvas.width / rect.width) / DPR;
        const my = (lastDragPos.y - rect.top) * (canvas.height / rect.height) / DPR;
        drag.x1 = mx;
        drag.y1 = my;
        const dx = mx - drag.x0;
        const dy = my - drag.y0;
        if (!dragMoved && Math.hypot(dx, dy) > dragClickThreshold) {
          dragMoved = true;
        }
        state.comparisonLine = null;
        draw();
        drawDragRect(drag);
        showTooltip(null);
      });
    }
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousemove', (e)=>{ if (drag) updateDragFromEvent(e); });
    canvas.addEventListener('mouseleave', ()=>{ rafPending = null; lastHover = null; state.hover=null; state.hoverSeries=null; state.comparisonLine=null; if (hoverCb) hoverCb(null); draw(); if (drag) drawDragRect(drag); showTooltip(null); });
    let lastDblClickTs = 0;
    canvas.addEventListener('dblclick', ()=>{ lastDblClickTs = Date.now(); state.zoomX=null; state.zoomY=null; draw(); });
    canvas.addEventListener('click', (e)=>{
      const now = Date.now();
      if (now - lastDblClickTs < 250) return;
      if (now - lastDragTs < 250) return;
      if (state.hover && state.hover.url) {
        window.open(state.hover.url,'_blank');
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
      const my = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
      const lineHit = nearestLine(mx, my);
      if (lineHit) {
        const url = lineHit.url || lineHit.profileUrl;
        if (url) window.open(url, '_blank');
      }
    });
    canvas.addEventListener('mousedown',(e)=>{
      const rect=canvas.getBoundingClientRect(); let x0=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; let y0=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR; dragMoved=false; drag={x0,y0,x1:null,y1:null};
    });
    window.addEventListener('mouseup',(e)=>{
      if (!drag) return; const rect=canvas.getBoundingClientRect(); let x1=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; let y1=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR; const dx=x1-drag.x0; const dy=y1-drag.y0; const didDrag=dragMoved||Math.hypot(dx, dy)>dragClickThreshold;
      const [cx0,cy0]=clampToPlot(drag.x0,drag.y0); const [cx1,cy1]=clampToPlot(x1,y1);
      drag.x1=cx1; drag.y1=cy1; const minW=10,minH=10; const w=Math.abs(cx1-cx0), h=Math.abs(cy1-cy0); if (didDrag) lastDragTs=Date.now();
      if (w>minW && h>minH){ const [X0,X1]=[cx0,cx1].sort((a,b)=>a-b); const [Y0,Y1]=[cy0,cy1].sort((a,b)=>a-b);
        const invMapX=(px)=>{ const [a,b]=(state.zoomX||state.x); return a + ((px-M.left)/(W-(M.left+M.right)))*(b-a); };
        const invMapY=(py)=>{ const [a,b]=(state.zoomY||state.y); return a + (((H-M.bottom)-py)/(H-(M.top+M.bottom)))*(b-a); };
        state.zoomX=[invMapX(X0),invMapX(X1)]; state.zoomY=[invMapY(Y1),invMapY(Y0)]; }
      dragMoved=false; drag=null; draw(); showTooltip(null);
    });
    function drawDragRect(d){
      if (!d||d.x1==null||d.y1==null) return;
      const dragColors = getChartDragColors();
      ctx.save(); ctx.strokeStyle=dragColors.stroke; ctx.fillStyle=dragColors.fill; ctx.lineWidth=1; ctx.setLineDash([4,3]);
      const x0=Math.max(M.left,Math.min(W-M.right,d.x0)); const y0=Math.max(M.top,Math.min(H-M.bottom,d.y0)); const x1=Math.max(M.left,Math.min(W-M.right,d.x1)); const y1=Math.max(M.top,Math.min(H-M.bottom,d.y1));
      const x=Math.min(x0,x1), y=Math.min(y0,y1), w=Math.abs(x1-x0), h=Math.abs(y1-y0); ctx.strokeRect(x,y,w,h); ctx.fillRect(x,y,w,h); ctx.restore(); }
    function drawComparisonLine(){
      if (!state.comparisonLine) return;
      const cl = state.comparisonLine;
      const x = Math.max(M.left, Math.min(W - M.right, cl.x));
      const topY = Math.max(M.top, Math.min(H - M.bottom, cl.top.y));
      const bottomY = Math.max(M.top, Math.min(H - M.bottom, cl.bottom.y));
      ctx.save();
      const topColor = cl.top.series.color || '#7dc4ff';
      const bottomColor = cl.bottom.series.color || '#7dc4ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      
      const lineLength = Math.abs(bottomY - topY);
      const dashLength = 4;
      const gapLength = 4;
      const segmentLength = dashLength + gapLength;
      const numSegments = Math.ceil(lineLength / segmentLength);
      
      const startY = Math.min(topY, bottomY);
      for (let i = 0; i < numSegments; i++) {
        const yStart = startY + (i * segmentLength);
        const yEnd = Math.min(startY + (i * segmentLength) + dashLength, startY + lineLength);
        
        if (yStart >= startY + lineLength) break;
        
        ctx.strokeStyle = (i % 2 === 0) ? topColor : bottomColor;
        ctx.beginPath();
        ctx.moveTo(x, yStart);
        ctx.lineTo(x, yEnd);
        ctx.stroke();
      }
      ctx.restore();
    }
    
    function drawSeries(){
      const muted='#38424c'; const anyHover=!!state.hoverSeries;
      for (const s of state.series){ const color=(anyHover && state.hoverSeries!==s.id)?muted:s.color; if (s.points.length>1){ ctx.strokeStyle=color; ctx.lineWidth=1.4; ctx.lineJoin='round'; ctx.lineCap='round';
        if (drawSmoothLine(ctx, s.points, mapX, mapY)) ctx.stroke(); }
        for (const p of s.points){ if (p.isInterpolated) continue; const x=mapX(p.x), y=mapY(p.y); const isHover=state.hover && state.hover.pid===s.id && state.hover.i===p.t; ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,isHover?4.2:2.4,0,Math.PI*2); ctx.fill(); if (isHover){ ctx.strokeStyle='#ffffffaa'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.stroke(); } }
      }
    }
    function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); grid(); axes(); drawSeries(); drawComparisonLine(); }
    window.addEventListener('resize', resize); resize();
    function resetZoom(){ state.zoomX=null; state.zoomY=null; draw(); }
    function setHoverSeries(pid){ state.hoverSeries=pid||null; draw(); }
    function onHover(cb){ hoverCb=cb; }
    function getZoom(){ return { x: state.zoomX ? [...state.zoomX] : null, y: state.zoomY ? [...state.zoomY] : null }; }
    function getDomain(){ return { x: state.x ? [...state.x] : null, y: state.y ? [...state.y] : null }; }
    function setZoom(z){
      if (!z) return;
      if (z.x && isFinite(z.x[0]) && isFinite(z.x[1])) state.zoomX = [z.x[0], z.x[1]];
      if (z.y && isFinite(z.y[0]) && isFinite(z.y[1])) state.zoomY = [z.y[0], z.y[1]];
      draw();
    }
    function setYAxisLabel(label){ yAxisLabel = label; draw(); }
    return { setData, resetZoom, setHoverSeries, onHover, getZoom, getDomain, setZoom, setYAxisLabel };
  }

  // Followers time chart (multi-series, Y-axis = Followers)
  function makeFollowersChart(canvas){
    const ctx = canvas.getContext('2d');
    const DPR = Math.max(1, window.devicePixelRatio||1);
    let W = canvas.clientWidth||canvas.width, H = canvas.clientHeight||canvas.height;
    const M = { left:58, top:20, right:30, bottom:40 };
    function resize(){ W=canvas.clientWidth||canvas.width; H=canvas.clientHeight||canvas.height; canvas.width=Math.floor(W*DPR); canvas.height=Math.floor(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); draw(); }
    const state = { series:[], x:[0,1], y:[0,1], zoomX:null, zoomY:null, hover:null, hoverSeries:null, comparisonLine:null };
    let hoverCb = null;
    
    // Interpolate/extrapolate value for a series at a given x (time)
    function getValueAtX(series, x){
      if (!series.points || series.points.length === 0) return null;
      const pts = series.points;
      let before = null, after = null;
      for (let i = 0; i < pts.length; i++){
        if (pts[i].x <= x) before = pts[i];
        if (pts[i].x >= x && !after) after = pts[i];
      }
      if (!before && after) return after.y;
      if (before && !after) return before.y;
      if (before && after){
        if (before.x === after.x) return before.y;
        const t = (x - before.x) / (after.x - before.x);
        return before.y + (after.y - before.y) * t;
      }
      return pts[0]?.y ?? null;
    }
    
    // Find two nearest series vertically at mouse x position
    function findNearestTwoSeries(mx, my){
      if (state.series.length < 2) return null;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      const candidates = [];
      for (const s of state.series){
        const val = getValueAtX(s, mouseX);
        if (val == null) continue;
        const y = mapY(val);
        if (y < M.top || y > H - M.bottom) continue;
        const dist = Math.abs(my - y);
        candidates.push({ series: s, y, val, dist });
      }
      if (candidates.length < 2) return null;
      candidates.sort((a,b) => a.dist - b.dist);
      return {
        top: candidates[0].y < candidates[1].y ? candidates[0] : candidates[1],
        bottom: candidates[0].y < candidates[1].y ? candidates[1] : candidates[0],
        x: mx,
        mouseX
      };
    }
    function setData(series){ state.series = series.map(s=>({...s, points: ensureSortedPoints(s.points||[])})); const xs=[], ys=[]; for (const s of state.series){ for (const p of s.points){ xs.push(p.x); ys.push(p.y); } } state.x=extent(xs,d=>d); state.y=extent(ys,d=>d); draw(); }
    function mapX(x){ const [a,b]=(state.zoomX||state.x); return M.left + ((x-a)/(b-a||1))*(W-(M.left+M.right)); }
    function mapY(y){ const [a,b]=(state.zoomY||state.y); return H - M.bottom - ((y-a)/(b-a||1))*(H-(M.top+M.bottom)); }
    function clampToPlot(px,py){ const x=Math.max(M.left,Math.min(W-M.right,px)); const y=Math.max(M.top,Math.min(H-M.bottom,py)); return [x,y]; }
    function grid(){
      const gridColor = getChartGridColor();
      ctx.strokeStyle = gridColor; ctx.lineWidth=1; ctx.setLineDash([4,4]);
      for (let i=0;i<6;i++){
        const x = M.left + i * (W - (M.left + M.right)) / 5;
        ctx.beginPath();
        ctx.moveTo(x, M.top);
        ctx.lineTo(x, H - M.bottom);
        ctx.stroke();
      }
      for (let i=0;i<6;i++){
        const y = M.top + i * (H - (M.top + M.bottom)) / 5;
        ctx.beginPath();
        ctx.moveTo(M.left, y);
        ctx.lineTo(W - M.right, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    function fmtDate(t){ try { const d=new Date(t); return d.toLocaleDateString(undefined,{month:'short',day:'2-digit'}); } catch { return String(t); } }
    function fmtDateTime(t){ try { const d=new Date(t); const ds=d.toLocaleDateString(undefined,{month:'short',day:'2-digit'}); const ts=d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); return ds+" "+ts; } catch { return String(t);} }
    function axes(){
      const xDomain=state.zoomX||state.x; const yDomain=state.zoomY||state.y;
      ctx.strokeStyle='#607080'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(M.left,M.top); ctx.lineTo(M.left,H-M.bottom); ctx.lineTo(W-M.right,H-M.bottom); ctx.stroke();
      ctx.fillStyle='#a7b0ba'; ctx.font='12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      const xticks=5, yticks=5;
      const tickVals=[]; for (let i=0;i<=xticks;i++){ tickVals.push(Math.round(xDomain[0]+i*(xDomain[1]-xDomain[0])/xticks)); }
      for (let i=0;i<=xticks;i++){
        const x=M.left+i*(W-(M.left+M.right))/xticks; const v=tickVals[i]; const label = fmtDate(v); const off = 24; ctx.fillText(label, x-off, H-(M.bottom-18));
      }
      ctx.textAlign = 'right';
      for (let i=0;i<=yticks;i++){ const y=H-M.bottom - i*(H-(M.top+M.bottom))/yticks; const v=yDomain[0]+i*(yDomain[1]-yDomain[0])/yticks; ctx.fillText(fmt2(v), 50, y+4); }
      ctx.textAlign = 'left';
      ctx.fillStyle='#e8eaed'; ctx.font='bold 13px system-ui, -apple-system, Segoe UI, Roboto, Arial'; ctx.fillText('Time', W/2-20, H-6);
    }
    function drawComparisonLine(){
      if (!state.comparisonLine) return;
      const cl = state.comparisonLine;
      const x = Math.max(M.left, Math.min(W - M.right, cl.x));
      const topY = Math.max(M.top, Math.min(H - M.bottom, cl.top.y));
      const bottomY = Math.max(M.top, Math.min(H - M.bottom, cl.bottom.y));
      ctx.save();
      const topColor = cl.top.series.color || '#ffd166';
      const bottomColor = cl.bottom.series.color || '#ffd166';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]); // No dash pattern, we'll draw segments manually
      
      // Calculate line length and segment size
      const lineLength = Math.abs(bottomY - topY);
      const dashLength = 4;
      const gapLength = 4;
      const segmentLength = dashLength + gapLength;
      const numSegments = Math.ceil(lineLength / segmentLength);
      
      // Draw alternating colored dashes
      const startY = Math.min(topY, bottomY);
      for (let i = 0; i < numSegments; i++) {
        const yStart = startY + (i * segmentLength);
        const yEnd = Math.min(startY + (i * segmentLength) + dashLength, startY + lineLength);
        
        if (yStart >= startY + lineLength) break;
        
        // Alternate colors: even segments use top color, odd use bottom color
        ctx.strokeStyle = (i % 2 === 0) ? topColor : bottomColor;
        ctx.beginPath();
        ctx.moveTo(x, yStart);
        ctx.lineTo(x, yEnd);
        ctx.stroke();
      }
      ctx.restore();
    }
    
    function drawSeries(){
      const muted='#38424c'; const anyHover=!!state.hoverSeries;
      for (const s of state.series){
        const color=(anyHover && state.hoverSeries!==s.id)?muted:s.color;
        if (s.points.length>1){
          ctx.strokeStyle=color||'#ffd166'; ctx.lineWidth=1.6; ctx.lineJoin='round'; ctx.lineCap='round';
          if (drawSmoothLine(ctx, s.points, mapX, mapY)) ctx.stroke();
        }
        for (const p of s.points){
          const x=mapX(p.x), y=mapY(p.y);
          const isHover=state.hover && state.hover.id===s.id && state.hover.t===p.t;
          ctx.fillStyle=color||'#ffd166'; ctx.beginPath(); ctx.arc(x,y,isHover?4.2:2.4,0,Math.PI*2); ctx.fill();
          if (isHover){
            ctx.strokeStyle='#ffffffaa'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.stroke();
          }
        }
      }
    }
    function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); grid(); axes(); drawSeries(); drawComparisonLine(); }
    const tooltip = $('#followersTooltip');
    let rafPending = null;
    let lastHover = null;
    
    // Calculate distance from point to line segment
    function pointToLineDistance(px, py, x1, y1, x2, y2) {
      const A = px - x1;
      const B = py - y1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      let xx, yy;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      const dx = px - xx;
      const dy = py - yy;
      return Math.hypot(dx, dy);
    }

    function nearestLine(mx, my) {
      let best = null, bd = Infinity;
      const invMapX = (px) => {
        const [a,b] = (state.zoomX||state.x);
        return a + ((px - M.left)/(W - (M.left+M.right))) * (b-a);
      };
      const mouseX = invMapX(mx);
      for (const s of state.series) {
        if (s.points.length < 2) continue;
        for (let i = 0; i < s.points.length - 1; i++) {
          const p1 = s.points[i];
          const p2 = s.points[i + 1];
          const x1 = mapX(p1.x), y1 = mapY(p1.y);
          const x2 = mapX(p2.x), y2 = mapY(p2.y);
          // Skip if both points are outside plot
          if ((x1 < M.left && x2 < M.left) || (x1 > W - M.right && x2 > W - M.right) ||
              (y1 < M.top && y2 < M.top) || (y1 > H - M.bottom && y2 > H - M.bottom)) continue;
          const d = pointToLineDistance(mx, my, x1, y1, x2, y2);
          if (d < bd && d < 6) {
            bd = d;
            // Interpolate value at mouse x position
            let interpX = mouseX;
            let interpY = null;
            if (mouseX >= Math.min(p1.x, p2.x) && mouseX <= Math.max(p1.x, p2.x)) {
              if (p1.x === p2.x) {
                interpY = p1.y;
              } else {
                const t = (mouseX - p1.x) / (p2.x - p1.x);
                interpY = p1.y + (p2.y - p1.y) * t;
              }
            } else if (mouseX < Math.min(p1.x, p2.x)) {
              interpX = Math.min(p1.x, p2.x);
              interpY = p1.x < p2.x ? p1.y : p2.y;
            } else {
              interpX = Math.max(p1.x, p2.x);
              interpY = p1.x > p2.x ? p1.y : p2.y;
            }
            best = { id: s.id, label: s.label || s.id, x: interpX, y: interpY, t: interpX, color: s.color, url: s.url, profileUrl: s.profileUrl, isLineHover: true };
          }
        }
      }
      return best;
    }

    function nearest(mx,my){
      let best=null,bd=Infinity;
      for (const s of state.series){
        for (const p of s.points){
          const x=mapX(p.x), y=mapY(p.y);
          if (x<M.left||x>W-M.right||y<M.top||y>H-M.bottom) continue;
          const d=Math.hypot(mx-x,my-y);
          if (d<bd && d<16){
            bd=d;
            best={ id:s.id, label:s.label||s.id, x:p.x, y:p.y, t:p.t, color:s.color, url: s.url, profileUrl: s.profileUrl };
          }
        }
      }
      return best;
    }
    function showTooltip(h,cx,cy,comparisonData){
      ensureTooltipInBody(tooltip);
      if (comparisonData){
        const diff = Math.abs(comparisonData.top.val - comparisonData.bottom.val);
        const diffRounded = Math.ceil(diff);
        const unitLabel = unitLabelForValue('Followers', diffRounded);
        const topColor = comparisonData.top.series.color || '#ffd166';
        const bottomColor = comparisonData.bottom.series.color || '#ffd166';
        tooltip.style.display='block';
        tooltip.innerHTML = `<div class="tooltip-stats-row">
          <div style="position:relative;width:20px;height:20px;">
            <span class="dot" style="position:absolute;left:0;top:0;width:16px;height:16px;background:${topColor};z-index:2;"></span>
            <span class="dot" style="position:absolute;left:8px;top:0;width:16px;height:16px;background:${bottomColor};z-index:1;"></span>
          </div>
          <strong>${fmt(diffRounded)} ${unitLabel} gap</strong>
        </div>`;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const width = tooltip.offsetWidth || 0;
        let left = cx + 12;
        if (left + width > vw - 8){
          left = cx - 12 - width;
          if (left < 8) left = 8;
        }
        tooltip.style.left = left + 'px';
        tooltip.style.top = (cy + 8) + 'px';
        return;
      }
      if (!h){ tooltip.style.display='none'; return; }
      tooltip.style.display='block';
      // Check if this is a profile line (has profileUrl)
      if (h.profileUrl) {
        // Extract handle from label (e.g., "@handle's Followers" -> "@handle")
        let handle = h.label || h.id || '';
        handle = handle.replace(/'s Followers$/i, '').trim();
        if (!handle.startsWith('@')) handle = '@' + handle;
        const dateStr = fmtDateTime(h.x);
        const numStr = fmt(h.y);
        const unitLabel = unitLabelForValue('Followers', Number(h.y));
        tooltip.innerHTML = `<div style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:${h.color||'#ffd166'}"></span><strong>${esc(handle)} ${numStr} ${unitLabel}</strong></div><div class="tooltip-subtext">on ${dateStr}</div>`;
      } else {
        const header = `<div style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:${h.color||'#ffd166'}"></span><strong>${esc(h.label||'Followers')}</strong></div>`;
        const unitLabel = unitLabelForValue('Followers', Number(h.y));
        const body = `<div class="tooltip-stats">${fmtDateTime(h.x)} • ${fmt(h.y)} ${unitLabel}</div>`;
        tooltip.innerHTML = header + body;
      }
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const width = tooltip.offsetWidth || 0;
      let left = cx + 12;
      if (left + width > vw - 8){
        left = cx - 12 - width;
        if (left < 8) left = 8;
      }
      tooltip.style.left = left + 'px';
      tooltip.style.top = (cy + 8) + 'px';
    }
    
    function handleMouseMove(e){
      if (rafPending) return;
      rafPending = requestAnimationFrame(()=>{
        rafPending = null;
        const rect=canvas.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; const my=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR;
        if (drag){ updateDragFromEvent(e); return; }
        
        const h=nearest(mx,my);
        let lineHover = null;
        if (!h) {
          lineHover = nearestLine(mx, my);
        }
        const hoverKey = h ? `${h.id}-${h.t}` : (lineHover ? `${lineHover.id}-line` : null);
        const prev=state.hoverSeries;
        state.hover=h || lineHover;
        
        // Always check for line hover to update hoverSeries for dimming effect
        if (!h) {
          state.hoverSeries = lineHover?.id || null;
        } else {
          state.hoverSeries = h?.id || null;
        }
        // Clear hoverSeries if not hovering over anything
        if (!h && !lineHover) {
          state.hoverSeries = null;
        }
        
        // Check if we're in comparison mode (2+ series) and find nearest two
        // Only show comparison line if NOT hovering over a specific point or line
        const comparison = (!h && !lineHover && state.series.length >= 2) ? findNearestTwoSeries(mx, my) : null;
        if (comparison && mx >= M.left && mx <= W - M.right){
          state.comparisonLine = comparison;
          // Redraw if hoverSeries changed to update dimming
          if (prev !== state.hoverSeries) {
            if (hoverCb) hoverCb(state.hoverSeries);
          }
          draw();
          showTooltip(null, e.clientX, e.clientY, comparison);
          lastHover = hoverKey;
          return;
        }
        
        state.comparisonLine = null;
        // Only skip redraw if both hover key and hoverSeries haven't changed
        if (hoverKey === lastHover && prev === state.hoverSeries) {
          showTooltip(h || lineHover, e.clientX, e.clientY);
          return;
        }
        lastHover = hoverKey;
        if (hoverCb && prev!==state.hoverSeries) hoverCb(state.hoverSeries);
        draw();
        showTooltip(h || lineHover, e.clientX, e.clientY);
      });
    }
    
    let drag=null;
    let dragRaf = 0;
    let lastDragPos = null;
    let dragMoved = false;
    let lastDragTs = 0;
    const dragClickThreshold = 4;

    function updateDragFromEvent(e){
      if (!drag || !e) return;
      lastDragPos = { x: e.clientX, y: e.clientY };
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        if (!drag || !lastDragPos) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (lastDragPos.x - rect.left) * (canvas.width / rect.width) / DPR;
        const my = (lastDragPos.y - rect.top) * (canvas.height / rect.height) / DPR;
        drag.x1 = mx;
        drag.y1 = my;
        const dx = mx - drag.x0;
        const dy = my - drag.y0;
        if (!dragMoved && Math.hypot(dx, dy) > dragClickThreshold) {
          dragMoved = true;
        }
        state.comparisonLine = null;
        draw();
        drawDragRect(drag);
        showTooltip(null);
      });
    }
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousemove', (e)=>{ if (drag) updateDragFromEvent(e); });
    canvas.addEventListener('mouseleave', ()=>{ rafPending = null; lastHover = null; state.hover=null; state.hoverSeries=null; state.comparisonLine=null; if (hoverCb) hoverCb(null); draw(); if (drag) drawDragRect(drag); showTooltip(null); });
    canvas.addEventListener('mousedown',(e)=>{ const rect=canvas.getBoundingClientRect(); let x0=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; let y0=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR; dragMoved=false; drag={x0,y0,x1:null,y1:null}; });
    window.addEventListener('mouseup',(e)=>{ if (!drag) return; const rect=canvas.getBoundingClientRect(); let x1=(e.clientX-rect.left)*(canvas.width/rect.width)/DPR; let y1=(e.clientY-rect.top)*(canvas.height/rect.height)/DPR; const dx=x1-drag.x0; const dy=y1-drag.y0; const didDrag=dragMoved||Math.hypot(dx, dy)>dragClickThreshold; const [cx0,cy0]=clampToPlot(drag.x0,drag.y0); const [cx1,cy1]=clampToPlot(x1,y1); drag.x1=cx1; drag.y1=cy1; const minW=10,minH=10; const w=Math.abs(cx1-cx0), h=Math.abs(cy1-cy0); if (didDrag) lastDragTs=Date.now(); if (w>minW && h>minH){ const [X0,X1]=[cx0,cx1].sort((a,b)=>a-b); const [Y0,Y1]=[cy0,cy1].sort((a,b)=>a-b); const invMapX=(px)=>{ const [a,b]=(state.zoomX||state.x); return a + ((px-M.left)/(W-(M.left+M.right)))*(b-a); }; const invMapY=(py)=>{ const [a,b]=(state.zoomY||state.y); return a + (((H-M.bottom)-py)/(H-(M.top+M.bottom)))*(b-a); }; state.zoomX=[invMapX(X0),invMapX(X1)]; state.zoomY=[invMapY(Y1),invMapY(Y0)]; } dragMoved=false; drag=null; draw(); showTooltip(null); });
    function drawDragRect(d){
      if (!d||d.x1==null||d.y1==null) return;
      const dragColors = getChartDragColors();
      ctx.save(); ctx.strokeStyle=dragColors.stroke; ctx.fillStyle=dragColors.fill; ctx.lineWidth=1; ctx.setLineDash([4,3]);
      const x0=Math.max(M.left,Math.min(W-M.right,d.x0)); const y0=Math.max(M.top,Math.min(H-M.bottom,d.y0)); const x1=Math.max(M.left,Math.min(W-M.right,d.x1)); const y1=Math.max(M.top,Math.min(H-M.bottom,d.y1));
      const x=Math.min(x0,x1), y=Math.min(y0,y1), w=Math.abs(x1-x0), h=Math.abs(y1-y0); ctx.strokeRect(x,y,w,h); ctx.fillRect(x,y,w,h); ctx.restore();
    }
    canvas.addEventListener('dblclick', ()=>{ state.zoomX=null; state.zoomY=null; draw(); });
    canvas.addEventListener('click', (e)=>{
      if (drag) return;
      if (Date.now() - lastDragTs < 250) return;
      if (state.hover && state.hover.url) {
        window.open(state.hover.url, '_blank');
        return;
      }
      if (state.hover && state.hover.profileUrl) {
        window.open(state.hover.profileUrl, '_blank');
        return;
      }
      // If no point was clicked, check for line clicks
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width/rect.width) / DPR;
      const my = (e.clientY - rect.top) * (canvas.height/rect.height) / DPR;
      const lineHit = nearestLine(mx, my);
      if (lineHit) {
        const url = lineHit.url || lineHit.profileUrl;
        if (url) window.open(url, '_blank');
      }
    });
    window.addEventListener('resize', resize);
    resize();
    function resetZoom(){ state.zoomX=null; state.zoomY=null; draw(); }
    function setHoverSeries(id){ state.hoverSeries=id||null; draw(); }
    function onHover(cb){ hoverCb=cb; }
    function getZoom(){ return { x: state.zoomX ? [...state.zoomX] : null, y: state.zoomY ? [...state.zoomY] : null }; }
    function setZoom(z){ if (!z) return; if (z.x && isFinite(z.x[0]) && isFinite(z.x[1])) state.zoomX = [z.x[0], z.x[1]]; if (z.y && isFinite(z.y[0]) && isFinite(z.y[1])) state.zoomY = [z.y[0], z.y[1]]; draw(); }
    return { setData, resetZoom, setHoverSeries, onHover, getZoom, setZoom };
  }

  // Legend removed — left list serves as legend

  async function exportCSV(user){
    await ensureFullSnapshots();
    const lines = ['post_id,timestamp,unique,likes,views,interaction_rate'];
    for (const [pid,p] of Object.entries(user.posts||{})){
      for (const s of (p.snapshots||[])){
        const rate = interactionRate(s);
        lines.push([pid, s.t, s.uv??'', s.likes??'', s.views??'', rate==null?'':rate.toFixed(4)].join(','));
      }
    }
    const blob = new Blob([lines.join('\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='sora_metrics.csv'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  // Escape CSV field (handle commas, quotes, newlines)
  function escapeCSV(str) {
    if (str == null) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // Format timestamp for CSV
  function fmtTimestamp(ts) {
    if (!ts) return '';
    const t = toTs(ts);
    if (!t) return '';
    try {
      return new Date(t).toISOString();
    } catch {
      return String(t);
    }
  }

  async function exportAllDataCSV(){
    try {
      const metrics = await loadMetrics();
      await ensureFullSnapshots();
      const allLines = [];
      
      // === SHEET 1: Posts Summary (one row per post with latest snapshot) ===
      const postsHeader = [
        'User Key', 'User Handle', 'User ID', 
        'Post ID', 'Post URL', 'Post Time', 'Post Time (ISO)', 'Caption',
        'Thumbnail URL', 'Parent Post ID', 'Root Post ID', 'Last Seen Timestamp',
        'Owner Key', 'Owner Handle', 'Owner ID',
        'Latest Snapshot Timestamp', 'Unique Views', 'Total Views', 'Likes', 'Comments', 'Remixes',
        'Interaction Rate %', 'Remix Rate %', 'Like Rate %',
        'Snapshot Count', 'First Snapshot Timestamp', 'Last Snapshot Timestamp'
      ];
      allLines.push('=== POSTS SUMMARY (Latest Snapshot Per Post) ===');
      allLines.push(postsHeader.map(escapeCSV).join(','));
      
      for (const [userKey, user] of Object.entries(metrics.users || {})){
        const handle = user.handle || '';
        const userId = user.id || '';
        
        for (const [pid, post] of Object.entries(user.posts || {})){
          const latest = latestSnapshot(post.snapshots);
          const postTimeRaw = getPostTimeStrict(post);
          const postTime = fmtTimestamp(postTimeRaw);
          const postTimeISO = postTimeRaw ? new Date(postTimeRaw).toISOString() : '';
          const latestTime = latest ? fmtTimestamp(latest.t) : '';
          
          const uv = latest?.uv ?? '';
          const views = latest?.views ?? '';
          const likes = latest?.likes ?? '';
          const comments = latest?.comments ?? latest?.reply_count ?? '';
          const remixes = latest?.remix_count ?? latest?.remixes ?? '';
          
          const ir = interactionRate(latest);
          const rr = remixRate(likes, remixes);
          const lr = likeRate(likes, uv);
          
          const caption = (typeof post.caption === 'string' && post.caption) ? post.caption.replace(/\n/g, ' ').replace(/\r/g, '') : '';
          const thumb = post.thumb || '';
          const url = post.url || `${SITE_ORIGIN}/p/${pid}`;
          const ownerKey = post.ownerKey || userKey;
          const ownerHandle = post.ownerHandle || handle;
          const ownerId = post.ownerId || userId;
          const parentPostId = post.parent_post_id || '';
          const rootPostId = post.root_post_id || '';
          const lastSeen = post.lastSeen ? fmtTimestamp(post.lastSeen) : '';
          
          const snaps = Array.isArray(post.snapshots) ? post.snapshots : [];
          const snapshotCount = snaps.length;
          const firstSnapshot = snaps.length > 0 ? fmtTimestamp(snaps[0]?.t) : '';
          const lastSnapshot = latest ? fmtTimestamp(latest.t) : '';
          
          allLines.push([
            userKey, handle, userId,
            pid, url, postTime, postTimeISO, caption,
            thumb, parentPostId, rootPostId, lastSeen,
            ownerKey, ownerHandle, ownerId,
            latestTime, uv, views, likes, comments, remixes,
            ir != null ? ir.toFixed(2) : '', rr != null ? rr : '', lr != null ? lr.toFixed(2) : '',
            snapshotCount, firstSnapshot, lastSnapshot
          ].map(escapeCSV).join(','));
        }
      }
      
      // === SHEET 2: Post Snapshots (all historical data) ===
      allLines.push('');
      allLines.push('=== POST SNAPSHOTS (Complete Historical Timeline) ===');
      const snapshotsHeader = [
        'User Key', 'User Handle', 'User ID',
        'Post ID', 'Post URL', 'Post Caption', 'Post Time',
        'Owner Key', 'Owner Handle', 'Owner ID',
        'Snapshot Timestamp', 'Snapshot Timestamp (ISO)', 'Snapshot Age (minutes)',
        'Unique Views', 'Total Views', 'Likes', 'Comments', 'Remixes',
        'Interaction Rate %', 'Remix Rate %', 'Like Rate %',
        'Views Change', 'Likes Change', 'Comments Change', 'Remixes Change'
      ];
      allLines.push(snapshotsHeader.map(escapeCSV).join(','));
      
      for (const [userKey, user] of Object.entries(metrics.users || {})){
        const handle = user.handle || '';
        const userId = user.id || '';
        
        for (const [pid, post] of Object.entries(user.posts || {})){
          const snaps = Array.isArray(post.snapshots) ? post.snapshots : [];
          const postTimeRaw = getPostTimeStrict(post);
          const postTime = fmtTimestamp(postTimeRaw);
          const caption = (typeof post.caption === 'string' && post.caption) ? post.caption.replace(/\n/g, ' ').replace(/\r/g, '') : '';
          const url = post.url || `${SITE_ORIGIN}/p/${pid}`;
          const ownerKey = post.ownerKey || userKey;
          const ownerHandle = post.ownerHandle || handle;
          const ownerId = post.ownerId || userId;
          
          let prevViews = null, prevLikes = null, prevComments = null, prevRemixes = null;
          
          for (const snap of snaps){
            const t = snap.t ? Number(snap.t) : null;
            const tFormatted = t ? fmtTimestamp(t) : '';
            const tISO = t ? new Date(t).toISOString() : '';
            const ageMin = t && postTimeRaw ? Math.floor((t - postTimeRaw) / 60000) : '';
            
            const uv = snap.uv ?? '';
            const views = snap.views ?? '';
            const likes = snap.likes ?? '';
            const comments = snap.comments ?? snap.reply_count ?? '';
            const remixes = snap.remix_count ?? snap.remixes ?? '';
            
            const ir = interactionRate(snap);
            const rr = remixRate(likes, remixes);
            const lr = likeRate(likes, uv);
            
            const viewsChange = prevViews != null && views !== '' ? (Number(views) - Number(prevViews)) : '';
            const likesChange = prevLikes != null && likes !== '' ? (Number(likes) - Number(prevLikes)) : '';
            const commentsChange = prevComments != null && comments !== '' ? (Number(comments) - Number(prevComments)) : '';
            const remixesChange = prevRemixes != null && remixes !== '' ? (Number(remixes) - Number(prevRemixes)) : '';
            
            allLines.push([
              userKey, handle, userId,
              pid, url, caption, postTime,
              ownerKey, ownerHandle, ownerId,
              tFormatted, tISO, ageMin,
              uv, views, likes, comments, remixes,
              ir != null ? ir.toFixed(2) : '', rr != null ? rr : '', lr != null ? lr.toFixed(2) : '',
              viewsChange, likesChange, commentsChange, remixesChange
            ].map(escapeCSV).join(','));
            
            if (views !== '') prevViews = Number(views);
            if (likes !== '') prevLikes = Number(likes);
            if (comments !== '') prevComments = Number(comments);
            if (remixes !== '') prevRemixes = Number(remixes);
          }
        }
      }
      
      // === SHEET 3: User Followers History ===
      allLines.push('');
      allLines.push('=== USER FOLLOWERS HISTORY (Complete Timeline) ===');
      const followersHeader = [
        'User Key', 'User Handle', 'User ID', 
        'Timestamp', 'Timestamp (ISO)', 'Follower Count', 'Follower Change', 'Days Since First'
      ];
      allLines.push(followersHeader.map(escapeCSV).join(','));
      
      for (const [userKey, user] of Object.entries(metrics.users || {})){
        const handle = user.handle || '';
        const userId = user.id || '';
        const followers = Array.isArray(user.followers) ? user.followers : [];
        
        let firstTimestamp = null;
        let prevCount = null;
        
        for (const entry of followers){
          const t = entry.t ? Number(entry.t) : null;
          const tFormatted = t ? fmtTimestamp(t) : '';
          const tISO = t ? new Date(t).toISOString() : '';
          const count = entry.count ?? '';
          
          if (firstTimestamp === null && t) firstTimestamp = t;
          const daysSinceFirst = firstTimestamp && t ? ((t - firstTimestamp) / (24 * 60 * 60 * 1000)).toFixed(2) : '';
          const followerChange = prevCount != null && count !== '' ? (Number(count) - Number(prevCount)) : '';
          
          allLines.push([
            userKey, handle, userId,
            tFormatted, tISO, count, followerChange, daysSinceFirst
          ].map(escapeCSV).join(','));
          
          if (count !== '') prevCount = Number(count);
        }
      }
      
      // === SHEET 4: User Cast in History ===
      allLines.push('');
      allLines.push('=== USER CAST IN HISTORY (Complete Timeline) ===');
      const cameosHeader = [
        'User Key', 'User Handle', 'User ID',
        'Timestamp', 'Timestamp (ISO)', 'Cast in Count', 'Cast in Change', 'Days Since First'
      ];
      allLines.push(cameosHeader.map(escapeCSV).join(','));
      
      for (const [userKey, user] of Object.entries(metrics.users || {})){
        const handle = user.handle || '';
        const userId = user.id || '';
        const cameos = Array.isArray(user.cameos) ? user.cameos : [];
        
        let firstTimestamp = null;
        let prevCount = null;
        
        for (const entry of cameos){
          const t = entry.t ? Number(entry.t) : null;
          const tFormatted = t ? fmtTimestamp(t) : '';
          const tISO = t ? new Date(t).toISOString() : '';
          const count = entry.count ?? '';
          
          if (firstTimestamp === null && t) firstTimestamp = t;
          const daysSinceFirst = firstTimestamp && t ? ((t - firstTimestamp) / (24 * 60 * 60 * 1000)).toFixed(2) : '';
          const castInChange = prevCount != null && count !== '' ? (Number(count) - Number(prevCount)) : '';
          
          allLines.push([
            userKey, handle, userId,
            tFormatted, tISO, count, castInChange, daysSinceFirst
          ].map(escapeCSV).join(','));
          
          if (count !== '') prevCount = Number(count);
        }
      }
      
      // === SHEET 5: Users Summary ===
      allLines.push('');
      allLines.push('=== USERS SUMMARY (Aggregated Totals) ===');
      const usersHeader = [
        'User Key', 'User Handle', 'User ID', 
        'Post Count', 'Total Snapshots',
        'Latest Follower Count', 'Latest Follower Timestamp', 'Follower History Points',
        'Latest Cast in Count', 'Latest Cast in Timestamp', 'Cast in History Points',
        'Total Views (Latest)', 'Total Likes (Latest)', 'Total Comments (Latest)', 'Total Remixes (Latest)',
        'Total Interactions (Latest)', 'Average Interaction Rate %', 'Average Remix Rate %',
        'First Post Time', 'Last Post Time', 'Post Time Span (days)'
      ];
      allLines.push(usersHeader.map(escapeCSV).join(','));
      
      for (const [userKey, user] of Object.entries(metrics.users || {})){
        const handle = user.handle || '';
        const userId = user.id || '';
        const postCount = Object.keys(user.posts || {}).length;
        
        let totalSnapshots = 0;
        let firstPostTime = null;
        let lastPostTime = null;
        let totalIR = 0;
        let irCount = 0;
        let totalRR = 0;
        let rrCount = 0;
        
        for (const [pid, post] of Object.entries(user.posts || {})){
          const snaps = Array.isArray(post.snapshots) ? post.snapshots : [];
          totalSnapshots += snaps.length;
          
          const postTime = getPostTimeStrict(post);
          if (postTime) {
            if (!firstPostTime || postTime < firstPostTime) firstPostTime = postTime;
            if (!lastPostTime || postTime > lastPostTime) lastPostTime = postTime;
          }
          
          const latest = latestSnapshot(snaps);
          if (latest) {
            const ir = interactionRate(latest);
            if (ir != null) { totalIR += ir; irCount++; }
            
            const likes = latest.likes;
            const remixes = latest.remix_count ?? latest.remixes;
            const rr = remixRate(likes, remixes);
            if (rr != null) { totalRR += Number(rr); rrCount++; }
          }
        }
        
        const followers = Array.isArray(user.followers) ? user.followers : [];
        const latestFollowers = followers.length > 0 ? (followers[followers.length - 1]?.count ?? '') : '';
        const latestFollowersTime = followers.length > 0 ? fmtTimestamp(followers[followers.length - 1]?.t) : '';
        const followerHistoryPoints = followers.length;
        
        const cameos = Array.isArray(user.cameos) ? user.cameos : [];
        const latestCameos = cameos.length > 0 ? (cameos[cameos.length - 1]?.count ?? '') : '';
        const latestCameosTime = cameos.length > 0 ? fmtTimestamp(cameos[cameos.length - 1]?.t) : '';
        const cameoHistoryPoints = cameos.length;
        
        const totals = computeTotalsForUser(user);
        const avgIR = irCount > 0 ? (totalIR / irCount).toFixed(2) : '';
        const avgRR = rrCount > 0 ? (totalRR / rrCount).toFixed(2) : '';
        
        const firstPostTimeFormatted = firstPostTime ? fmtTimestamp(firstPostTime) : '';
        const lastPostTimeFormatted = lastPostTime ? fmtTimestamp(lastPostTime) : '';
        const postTimeSpan = firstPostTime && lastPostTime ? ((lastPostTime - firstPostTime) / (24 * 60 * 60 * 1000)).toFixed(2) : '';
        
        allLines.push([
          userKey, handle, userId,
          postCount, totalSnapshots,
          latestFollowers, latestFollowersTime, followerHistoryPoints,
          latestCameos, latestCameosTime, cameoHistoryPoints,
          totals.views, totals.likes, totals.replies, totals.remixes,
          totals.interactions, avgIR, avgRR,
          firstPostTimeFormatted, lastPostTimeFormatted, postTimeSpan
        ].map(escapeCSV).join(','));
      }
      
      // Create and download CSV
      const csvContent = allLines.join('\n');
      const blob = new Blob([csvContent], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `sora_all_data_export_${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert('Export failed. Please try again.');
    }
  }

  // Parse CSV line handling quoted fields
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Convert ISO timestamp string back to milliseconds timestamp
  function parseTimestamp(tsStr) {
    if (!tsStr || tsStr === '') return null;
    const d = Date.parse(tsStr);
    if (!isNaN(d)) return d;
    return toTs(tsStr);
  }

  async function importDataCSVText(text, metrics, stats){
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return false;

    let currentSection = null;
    let headerRow = null;
    let dataStartIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('===') && line.endsWith('===')) {
        if (currentSection && headerRow && dataStartIdx >= 0 && i > dataStartIdx) {
          const sectionRows = lines.slice(dataStartIdx, i).filter(r => r && r.trim());
          await processSection(currentSection, headerRow, sectionRows, metrics, stats);
        }
        if (line.includes('POSTS SUMMARY')) {
          currentSection = 'posts_summary';
        } else if (line.includes('POST SNAPSHOTS')) {
          currentSection = 'snapshots';
        } else if (line.includes('USER FOLLOWERS HISTORY')) {
          currentSection = 'followers';
        } else if (line.includes('USER CAST IN HISTORY')) {
          currentSection = 'cameos';
        } else if (line.includes('USERS SUMMARY')) {
          currentSection = 'users_summary';
        } else {
          currentSection = null;
        }
        headerRow = null;
        dataStartIdx = -1;
        continue;
      }
      if (currentSection && !headerRow && !line.startsWith('===')) {
        headerRow = parseCSVLine(line);
        dataStartIdx = i + 1;
        continue;
      }
    }
    if (currentSection && headerRow && dataStartIdx >= 0) {
      const sectionRows = lines.slice(dataStartIdx).filter(r => r && r.trim());
      await processSection(currentSection, headerRow, sectionRows, metrics, stats);
    }
    return true;
  }

  async function importDataCSVFiles(files) {
    try {
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length) return;

      const existingMetrics = await loadMetrics();
      const metrics = {
        users: JSON.parse(JSON.stringify(existingMetrics.users || {}))
      };

      const stats = {
        postsAdded: 0,
        postsUpdated: 0,
        snapshotsAdded: 0,
        snapshotsSkipped: 0,
        followersAdded: 0,
        followersSkipped: 0,
        cameosAdded: 0,
        cameosSkipped: 0,
        usersAdded: 0,
        usersUpdated: 0
      };

      let anyImported = false;
      for (const file of list){
        const text = await file.text();
        const didImport = await importDataCSVText(text, metrics, stats);
        if (didImport) anyImported = true;
      }

      if (!anyImported) {
        alert('CSV file is empty.');
        return;
      }

      await saveMetrics(metrics, { userKeys: Object.keys(metrics.users || {}) });

      const message = `Import completed!\n\n` +
        `Posts: ${stats.postsAdded} added, ${stats.postsUpdated} updated\n` +
        `Snapshots: ${stats.snapshotsAdded} added, ${stats.snapshotsSkipped} skipped (duplicates)\n` +
        `Followers: ${stats.followersAdded} added, ${stats.followersSkipped} skipped (duplicates)\n` +
        `Cast in: ${stats.cameosAdded} added, ${stats.cameosSkipped} skipped (duplicates)\n` +
        `Users: ${stats.usersAdded} added, ${stats.usersUpdated} updated`;
      alert(message);
      window.location.reload();
    } catch (e) {
      alert('Import failed: ' + (e.message || 'Unknown error. Please try again.'));
    }
  }

  async function processSection(section, header, rows, metrics, stats) {
    if (!header || header.length === 0) return;
    
    // Create column index map
    const colIdx = {};
    header.forEach((col, idx) => {
      colIdx[col.toLowerCase()] = idx;
    });

    const getUserKeyIdx = () => colIdx['user key'] ?? colIdx['userkey'];
    const getHandleIdx = () => colIdx['user handle'] ?? colIdx['userhandle'];
    const getUserIdIdx = () => colIdx['user id'] ?? colIdx['userid'];
    const getPostIdIdx = () => colIdx['post id'] ?? colIdx['postid'];
    
    for (const row of rows) {
      if (!row || row.trim() === '') continue;
      
      const cols = parseCSVLine(row);
      if (cols.length < header.length) continue; // Skip incomplete rows
      
      const getCol = (name) => {
        const idx = colIdx[name.toLowerCase()];
        return idx != null && idx < cols.length ? cols[idx] : '';
      };
      
      const userKeyIdx = getUserKeyIdx();
      const handleIdx = getHandleIdx();
      const userIdIdx = getUserIdIdx();
      
      if (userKeyIdx == null) continue;
      
      const userKey = cols[userKeyIdx] || 'unknown';
      const handle = handleIdx != null ? cols[handleIdx] : '';
      const userId = userIdIdx != null ? cols[userIdIdx] : '';
      
      // Ensure user exists
      if (!metrics.users[userKey]) {
        metrics.users[userKey] = {
          handle: handle || null,
          id: userId || null,
          posts: {},
          followers: [],
          cameos: []
        };
        stats.usersAdded++;
      } else {
        // Update handle/id if missing
        if (!metrics.users[userKey].handle && handle) metrics.users[userKey].handle = handle;
        if (!metrics.users[userKey].id && userId) metrics.users[userKey].id = userId;
        stats.usersUpdated++;
      }
      
      const user = metrics.users[userKey];
      
      if (section === 'posts_summary') {
        const postIdIdx = getPostIdIdx();
        if (postIdIdx == null) continue;
        
        const postId = cols[postIdIdx];
        if (!postId) continue;
        
        const url = getCol('Post URL') || `${SITE_ORIGIN}/p/${postId}`;
        const caption = getCol('Caption') || '';
        const thumb = getCol('Thumbnail URL') || '';
        const postTimeISO = getCol('Post Time (ISO)') || getCol('Post Time');
        const postTime = parseTimestamp(postTimeISO);
        const ownerKey = getCol('Owner Key') || userKey;
        const ownerHandle = getCol('Owner Handle') || handle;
        const ownerId = getCol('Owner ID') || userId;
        const parentPostId = getCol('Parent Post ID') || '';
        const rootPostId = getCol('Root Post ID') || '';
        const lastSeenISO = getCol('Last Seen Timestamp');
        const lastSeen = parseTimestamp(lastSeenISO);
        
        // Latest snapshot data
        const snapshotTimeISO = getCol('Latest Snapshot Timestamp');
        const snapshotTime = parseTimestamp(snapshotTimeISO);
        const uv = getCol('Unique Views');
        const views = getCol('Total Views');
        const likes = getCol('Likes');
        const comments = getCol('Comments');
        const remixes = getCol('Remixes');
        
        if (!user.posts[postId]) {
          user.posts[postId] = {
            url: url,
            thumb: thumb,
            caption: caption || null,
            snapshots: [],
            ownerKey: ownerKey,
            ownerHandle: ownerHandle,
            ownerId: ownerId || null,
            parent_post_id: parentPostId || null,
            root_post_id: rootPostId || null,
            lastSeen: lastSeen || null
          };
          stats.postsAdded++;
        } else {
          // Update existing post metadata
          const post = user.posts[postId];
          if (!post.url && url) post.url = url;
          if (!post.thumb && thumb) post.thumb = thumb;
          if (!post.caption && caption) post.caption = caption;
          if (!post.ownerKey && ownerKey) post.ownerKey = ownerKey;
          if (!post.ownerHandle && ownerHandle) post.ownerHandle = ownerHandle;
          if (!post.ownerId && ownerId) post.ownerId = ownerId;
          if (!post.parent_post_id && parentPostId) post.parent_post_id = parentPostId;
          if (!post.root_post_id && rootPostId) post.root_post_id = rootPostId;
          if (!post.lastSeen && lastSeen) post.lastSeen = lastSeen;
          stats.postsUpdated++;
        }
        
        // Set post_time if available
        if (postTime && !user.posts[postId].post_time) {
          user.posts[postId].post_time = postTime;
        }
        
        // Add snapshot if timestamp and data available
        if (snapshotTime && (uv !== '' || views !== '' || likes !== '' || comments !== '' || remixes !== '')) {
          const post = user.posts[postId];
          const existingSnap = post.snapshots.find(s => s.t === snapshotTime);
          if (!existingSnap) {
            const snap = { t: snapshotTime };
            if (uv !== '') snap.uv = Number(uv) || 0;
            if (views !== '') snap.views = Number(views) || 0;
            if (likes !== '') snap.likes = Number(likes) || 0;
            if (comments !== '') snap.comments = Number(comments) || 0;
            if (remixes !== '') snap.remix_count = Number(remixes) || 0;
            post.snapshots.push(snap);
            stats.snapshotsAdded++;
          } else {
            stats.snapshotsSkipped++;
          }
        }
        
      } else if (section === 'snapshots') {
        const postIdIdx = getPostIdIdx();
        if (postIdIdx == null) continue;
        
        const postId = cols[postIdIdx];
        if (!postId) continue;
        
        // Ensure post exists
        if (!user.posts[postId]) {
          const url = getCol('Post URL') || `${SITE_ORIGIN}/p/${postId}`;
          const caption = getCol('Post Caption') || '';
          const postTimeISO = getCol('Post Time');
          const postTime = parseTimestamp(postTimeISO);
          const ownerKey = getCol('Owner Key') || userKey;
          const ownerHandle = getCol('Owner Handle') || handle;
          const ownerId = getCol('Owner ID') || userId;
          
          user.posts[postId] = {
            url: url,
            thumb: '',
            caption: caption || null,
            snapshots: [],
            ownerKey: ownerKey,
            ownerHandle: ownerHandle,
            ownerId: ownerId || null
          };
          if (postTime) user.posts[postId].post_time = postTime;
          stats.postsAdded++;
        }
        
        const snapshotTimeISO = getCol('Snapshot Timestamp (ISO)') || getCol('Snapshot Timestamp');
        const snapshotTime = parseTimestamp(snapshotTimeISO);
        if (!snapshotTime) continue;
        
        const post = user.posts[postId];
        const existingSnap = post.snapshots.find(s => s.t === snapshotTime);
        if (!existingSnap) {
          const snap = { t: snapshotTime };
          const uv = getCol('Unique Views');
          const views = getCol('Total Views');
          const likes = getCol('Likes');
          const comments = getCol('Comments');
          const remixes = getCol('Remixes');
          
          if (uv !== '') snap.uv = Number(uv) || 0;
          if (views !== '') snap.views = Number(views) || 0;
          if (likes !== '') snap.likes = Number(likes) || 0;
          if (comments !== '') snap.comments = Number(comments) || 0;
          if (remixes !== '') snap.remix_count = Number(remixes) || 0;
          
          post.snapshots.push(snap);
          stats.snapshotsAdded++;
        } else {
          stats.snapshotsSkipped++;
        }
        
      } else if (section === 'followers') {
        const timestampISO = getCol('Timestamp (ISO)') || getCol('Timestamp');
        const timestamp = parseTimestamp(timestampISO);
        if (!timestamp) continue;
        
        const count = getCol('Follower Count');
        if (count === '') continue;
        
        const existingEntry = user.followers.find(f => f.t === timestamp);
        if (!existingEntry) {
          user.followers.push({ t: timestamp, count: Number(count) || 0 });
          stats.followersAdded++;
        } else {
          stats.followersSkipped++;
        }
        
      } else if (section === 'cameos') {
        const timestampISO = getCol('Timestamp (ISO)') || getCol('Timestamp');
        const timestamp = parseTimestamp(timestampISO);
        if (!timestamp) continue;

        const count = getCol('Cast in Count') || getCol('Cast Count');
        if (count === '') continue;
        
        const existingEntry = user.cameos.find(c => c.t === timestamp);
        if (!existingEntry) {
          user.cameos.push({ t: timestamp, count: Number(count) || 0 });
          stats.cameosAdded++;
        } else {
          stats.cameosSkipped++;
        }
      }
      // Note: users_summary section is informational only, we don't need to process it
    }
    
    // Sort snapshots, followers, and cameos by timestamp after processing
    for (const user of Object.values(metrics.users)) {
      if (Array.isArray(user.followers)) {
        user.followers.sort((a, b) => (a.t || 0) - (b.t || 0));
      }
      if (Array.isArray(user.cameos)) {
        user.cameos.sort((a, b) => (a.t || 0) - (b.t || 0));
      }
      for (const post of Object.values(user.posts || {})) {
        if (Array.isArray(post.snapshots)) {
          post.snapshots.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
      }
    }
  }

  async function main(prefetchedCache){
    const perfBoot = perfStart('boot total');
    initSidebarResizer();
    initThemePicker();
    hoistChartTooltips();
    hoistToBody($('#purgeConfirmDialog'));
    hoistToBody($('#postPurgeConfirm'));
    const cached = prefetchedCache !== undefined ? prefetchedCache : loadInstantCache();
    const hasBootCache = !!cached;
    if (cached) {
      metrics = { users: { [cached.userKey]: cached.user } };
      usersIndex = cached.usersIndex;
      currentUserKey = cached.userKey;
      lastMetricsUpdatedAt = cached.metricsUpdatedAt || 0;
      isMetricsPartial = true;
      trackLastSelectedUserKey();
      hydrateCurrentUserPostsFromStorage();
    } else {
      const perfLoad = perfStart('load metrics');
      metrics = await loadMetrics();
      perfEnd(perfLoad);
      isMetricsPartial = false;
    }
    syncUserSelectHydrateIndicator();
    const perfUltra = perfStart('load ultra mode');
    let ultraModeEnabled = false;
    const ultraModePromise = loadUltraModePreference()
      .then((val)=>{
        ultraModeEnabled = val;
      })
      .catch(() => {});
    perfEnd(perfUltra);
    const modeTapEl = $('#dashboardModeTap');
    if (modeTapEl) {
      let tapCount = 0;
      let lastTapAt = 0;
      modeTapEl.addEventListener('click', async () => {
        const now = Date.now();
        if (now - lastTapAt > 1500) tapCount = 0;
        lastTapAt = now;
        tapCount += 1;
        if (tapCount >= ULTRA_MODE_TAP_COUNT) {
          tapCount = 0;
          ultraModeEnabled = !ultraModeEnabled;
          await saveUltraModePreference(ultraModeEnabled);
          showToast(ultraModeEnabled ? 'Ultra mode unlocked' : 'Ultra mode disabled');
        }
      });
    }
    // Build list and try to restore last user
    const defaultUserKey = buildUserOptions(metrics);
    if (!currentUserKey) currentUserKey = defaultUserKey;
    trackLastSelectedUserKey();
    const searchInput = $('#search');
    const suggestions = $('#suggestions');
    let zoomStates = {};
    let zoomStatesLoaded = false;
    const defaultInteractionZoomApplied = new Set();
    let customVisibilityByUser = {};
    let customFiltersByUser = {};
    let customFiltersReloaded = false;
    let lastFilterAction = (function(){
      try {
        return sessionStorage.getItem('sctLastFilterAction')
          || localStorage.getItem('sctLastFilterAction')
          || null;
      } catch { return null; }
    })();
    let lastFilterActionByUser = (function(){
      try {
        const raw = sessionStorage.getItem('sctLastFilterActionByUser')
          || localStorage.getItem('sctLastFilterActionByUser')
          || '{}';
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch { return {}; }
    })();
    const sessionCustomFiltersByUser = (function(){
      try { return JSON.parse(sessionStorage.getItem('customFiltersByUserSession') || '{}'); } catch { return {}; }
    })();
    const localCustomFiltersByUser = (function(){
      try { return JSON.parse(localStorage.getItem('sctCustomFiltersByUser') || '{}'); } catch { return {}; }
    })();
    customFiltersByUser = localCustomFiltersByUser;
    for (const [userKey, entry] of Object.entries(sessionCustomFiltersByUser)){
      const existing = customFiltersByUser[userKey];
      const existingCount = Array.isArray(existing?.filters) ? existing.filters.length : 0;
      const sessionCount = Array.isArray(entry?.filters) ? entry.filters.length : 0;
      if (!existing || sessionCount > existingCount) {
        customFiltersByUser[userKey] = entry;
      }
    }
    const prefsPromise = chrome.storage.local
      .get([
        'lastUserKey',
        'zoomStates',
        'customVisibilityByUser',
        'customFiltersByUser',
        'lastFilterAction',
        'lastFilterActionByUser',
        VIEWS_TYPE_STORAGE_KEY,
        BEST_TIME_PREFS_KEY,
        CHART_MODE_STORAGE_KEY,
        STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
        STACKED_WINDOW_STORAGE_MIN_KEYS.views,
        STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
        STACKED_WINDOW_STORAGE_KEYS.interaction,
        STACKED_WINDOW_STORAGE_KEYS.views,
        STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson,
        LEGACY_CHART_MODE_KEYS.interaction,
        LEGACY_CHART_MODE_KEYS.views,
        LEGACY_CHART_MODE_KEYS.viewsPerPerson
      ])
      .catch(() => ({}));
    syncUserSelectionUI();
    const initialViewsChartType = loadViewsChartType();
    const initialChartsMode = loadChartMode(CHART_MODE_STORAGE_KEY);
    const legacyChartModes = {
      interaction: loadChartMode(LEGACY_CHART_MODE_KEYS.interaction),
      views: loadChartMode(LEGACY_CHART_MODE_KEYS.views),
      viewsPerPerson: loadChartMode(LEGACY_CHART_MODE_KEYS.viewsPerPerson)
    };
    const legacyChartsMode = resolveLegacyChartMode(legacyChartModes);
    let viewsChartType = initialViewsChartType || 'total'; // 'unique' or 'total'
    let viewsChartTypeLoaded = !!initialViewsChartType;
    let compareViewsChartType = viewsChartType;
    const viewsAxisLabel = viewsChartType === 'unique' ? 'Viewers' : 'Total Views';
    const shouldPersistLegacyChartMode = !initialChartsMode && !!legacyChartsMode;
    let chartsMode = initialChartsMode || legacyChartsMode || 'linear';
    let chartModeLoaded = !!initialChartsMode || !!legacyChartsMode;
    let chart = makeChart($('#chart'), viewsAxisLabel, viewsAxisLabel);
    let interactionRateStackedChart = makeFirst24HoursChart(
      $('#interactionRateStackedChart'),
      '#interactionRateStackedTooltip',
      'Interaction Rate',
      (v) => `${Number(v).toFixed(1)}%`
    );
    let viewsPerPersonChart = makeFirst24HoursChart($('#viewsPerPersonChart'), '#viewsPerPersonTooltip', 'Views Per Person', (v) => Number(v).toFixed(2));
    let viewsPerPersonTimeChart = makeTimeChart($('#viewsPerPersonTimeChart'), '#viewsPerPersonTimeTooltip', 'Views Per Person', (v) => Number(v).toFixed(2));
    let viewsChart = makeTimeChart($('#viewsChart'), '#viewsTooltip', viewsAxisLabel, fmt);
    let first24HoursChart = makeFirst24HoursChart($('#first24HoursChart'), '#first24HoursTooltip', viewsAxisLabel, fmt);
    const followersChart = makeFollowersChart($('#followersChart'));
    let allViewsChart = makeTimeChart($('#allViewsChart'), '#allViewsTooltip', viewsAxisLabel, fmt2);
    const allLikesChart = makeTimeChart($('#allLikesChart'), '#allLikesTooltip', 'Likes', fmt2);
    const cameosChart = makeTimeChart($('#cameosChart'), '#cameosTooltip', 'Cast in', fmt2);
    const PRESET_VISIBILITY_ACTIONS = new Set(['pastDay','pastWeek','last5','last10','top5','top10','bottom5','bottom10','stale']);
    const visibleSet = new Set();
    const sessionCustomVisibilityByUser = (function(){
      try { return JSON.parse(sessionStorage.getItem('customVisibilityByUserSession') || '{}'); } catch { return {}; }
    })();
    function normalizeFilterAction(action){
      if (!action) return null;
      if (isCustomFilterAction(action)) return action;
      if (action === 'showAll' || action === 'hideAll' || action === 'custom') return action;
      if (isPresetVisibilitySource(action)) return action;
      return null;
    }
    function setLastFilterAction(action){
      const next = normalizeFilterAction(action);
      if (!next) return;
      lastFilterAction = next;
      try { sessionStorage.setItem('sctLastFilterAction', next); } catch {}
      try { localStorage.setItem('sctLastFilterAction', next); } catch {}
      if (currentUserKey) {
        lastFilterActionByUser[currentUserKey] = next;
        try { sessionStorage.setItem('sctLastFilterActionByUser', JSON.stringify(lastFilterActionByUser)); } catch {}
        try { localStorage.setItem('sctLastFilterActionByUser', JSON.stringify(lastFilterActionByUser)); } catch {}
      }
      try { chrome.storage.local.set({ lastFilterAction: next, lastFilterActionByUser }); } catch {}
    }
    function getSavedFilterActionForUser(userKey){
      if (!userKey) return null;
      return normalizeFilterAction(lastFilterActionByUser?.[userKey]);
    }
    function getSessionFilterAction(userKey = currentUserKey){
      const byUser = getSavedFilterActionForUser(userKey);
      if (byUser) return byUser;
      const normalized = normalizeFilterAction(lastFilterAction);
      if (!normalized) return 'showAll';
      return normalized;
    }
    let currentVisibilitySource = 'showAll';
    let pendingPostPurge = null;
    let currentListActionId = null;
    
    // Compare users state
    const compareUsers = new Set();
    const MAX_COMPARE_USERS = 10;

    function getCustomVisibilityEntry(userKey){
      const entry = sessionCustomVisibilityByUser?.[userKey] || customVisibilityByUser?.[userKey];
      if (!entry) return null;
      const ids = Array.isArray(entry.ids) ? entry.ids : [];
      return { ids };
    }
    function isCustomFilterAction(action){
      return typeof action === 'string' && action.startsWith(CUSTOM_FILTER_PREFIX);
    }
    function getCustomFilterId(action){
      if (!isCustomFilterAction(action)) return null;
      return action.slice(CUSTOM_FILTER_PREFIX.length);
    }
    function isCoreVisibilitySource(source){
      return source === 'showAll' || source === 'hideAll' || isPresetVisibilitySource(source);
    }
    function getCustomFiltersForUser(userKey){
      const entry = customFiltersByUser?.[userKey];
      const filters = Array.isArray(entry?.filters) ? entry.filters : [];
      return filters;
    }
    function setCustomFiltersForUser(userKey, filters){
      if (!userKey) return;
      customFiltersByUser[userKey] = { filters: Array.isArray(filters) ? filters : [] };
      try { sessionStorage.setItem('customFiltersByUserSession', JSON.stringify(customFiltersByUser)); } catch {}
      try { localStorage.setItem('sctCustomFiltersByUser', JSON.stringify(customFiltersByUser)); } catch {}
      try { chrome.storage.local.set({ customFiltersByUser }); } catch {}
    }
    function createAutoCustomFilterForUser(userKey, ids){
      if (!userKey) return null;
      const filters = getCustomFiltersForUser(userKey).slice();
      const id = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      filters.push({ id, name: 'Custom', ids: Array.from(ids || []) });
      setCustomFiltersForUser(userKey, filters);
      return id;
    }
    function updateCustomFilterIdsForUser(userKey, filterId, ids){
      if (!userKey || !filterId) return;
      const filters = getCustomFiltersForUser(userKey).slice();
      const idx = filters.findIndex(f => f.id === filterId);
      if (idx < 0) return;
      filters[idx] = { ...filters[idx], ids: Array.from(ids || []) };
      setCustomFiltersForUser(userKey, filters);
    }
    function setCustomFilterActive(filterId){
      const wrap = $('#customFiltersWrap');
      if (!wrap) return;
      $$('.custom-filter-btn', wrap).forEach(btn=>{
        if (filterId && btn.dataset.filterId === filterId) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }
    function wireCustomFilterInput(input){
      if (!input) return;
      let committed = false;
      const syncWidth = ()=>{
        input.style.width = '1px';
        const nextWidth = input.scrollWidth || 1;
        input.style.width = `${nextWidth + 2}px`;
      };
      const finalize = (commit)=>{
        const name = input.value.trim().slice(0, 16);
        if (committed) return;
        committed = true;
        input.remove();
        if (!commit || !name) return;
        if (!currentUserKey) return;
        const filters = getCustomFiltersForUser(currentUserKey).slice();
        const id = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        filters.push({ id, name, ids: Array.from(visibleSet) });
        setCustomFiltersForUser(currentUserKey, filters);
        renderCustomFilters(currentUserKey);
        setCustomFilterActive(id);
        const user = resolveUserForKey(metrics, currentUserKey);
        if (user) {
          const actionId = `${CUSTOM_FILTER_PREFIX}${id}`;
          requestAnimationFrame(()=>{
            applyUserFilterState(currentUserKey, user, actionId);
            refreshUserUI({ preserveEmpty: true });
            persistVisibility();
          });
        }
      };
      input.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') { e.preventDefault(); finalize(true); }
        if (e.key === 'Escape') { e.preventDefault(); finalize(false); }
      });
      input.addEventListener('input', syncWidth);
      input.addEventListener('blur', ()=> { if (!committed) finalize(false); });
      syncWidth();
    }
    function wireCustomFilterRenameInput(input, userKey, filterId, fallbackName){
      if (!input) return;
      let committed = false;
      const syncWidth = ()=>{
        input.style.width = '1px';
        const nextWidth = input.scrollWidth || 1;
        input.style.width = `${nextWidth + 2}px`;
      };
      const finalize = (commit)=>{
        if (committed) return;
        committed = true;
        const name = input.value.trim().slice(0, 16) || fallbackName;
        input.remove();
        if (!commit || !name) { renderCustomFilters(userKey); return; }
        if (!userKey) { renderCustomFilters(userKey); return; }
        const filters = getCustomFiltersForUser(userKey).slice();
        const idx = filters.findIndex(f => f.id === filterId);
        if (idx < 0) { renderCustomFilters(userKey); return; }
        filters[idx] = { ...filters[idx], name };
        setCustomFiltersForUser(userKey, filters);
        renderCustomFilters(userKey);
      };
      input.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') { e.preventDefault(); finalize(true); }
        if (e.key === 'Escape') { e.preventDefault(); finalize(false); }
      });
      input.addEventListener('input', syncWidth);
      input.addEventListener('blur', ()=> { if (!committed) finalize(true); });
      syncWidth();
      requestAnimationFrame(()=>input.select());
    }
    function beginCustomFilterRename(userKey, filterId, currentName, button){
      if (!userKey || !filterId || !button) return;
      const wrap = $('#customFiltersWrap');
      if (!wrap) return;
      const existing = wrap.querySelector('.custom-filter-input--rename');
      if (existing) { existing.focus(); return; }
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.className = 'custom-filter-input custom-filter-input--rename';
      input.value = currentName;
      input.dataset.filterId = filterId;
      if (button.classList.contains('active')) input.classList.add('active');
      wrap.replaceChild(input, button);
      wireCustomFilterRenameInput(input, userKey, filterId, currentName);
      input.focus();
    }
    function renderCustomFilters(userKey){
      const wrap = $('#customFiltersWrap');
      if (!wrap) return;
      document.querySelectorAll('.custom-filter-tooltip').forEach((el)=>el.remove());
      const pendingInput = wrap.querySelector('.custom-filter-input--new');
      const pendingValue = pendingInput ? pendingInput.value : '';
      const wasFocused = pendingInput ? document.activeElement === pendingInput : false;
      const pendingRenameInput = wrap.querySelector('.custom-filter-input--rename');
      const pendingRenameValue = pendingRenameInput ? pendingRenameInput.value : '';
      const pendingRenameId = pendingRenameInput ? pendingRenameInput.dataset.filterId : '';
      const renameWasFocused = pendingRenameInput ? document.activeElement === pendingRenameInput : false;
      wrap.innerHTML = '';
      if (!userKey) return;
      let filters = getCustomFiltersForUser(userKey);
      if (!filters.length && !customFiltersReloaded) {
        customFiltersReloaded = true;
        try {
          chrome.storage.local.get('customFiltersByUser').then((st)=>{
            const raw = st?.customFiltersByUser;
            if (raw && typeof raw === 'object') {
              customFiltersByUser = raw;
              renderCustomFilters(userKey);
            }
          });
        } catch {}
      }
      const activeId = getCustomFilterId(currentVisibilitySource);
      let tooltipTimer = null;
      let tooltipEl = null;
      let lastMouse = null;
      let renameTimer = null;
      const hideTooltip = ()=>{
        if (tooltipTimer) {
          clearTimeout(tooltipTimer);
          tooltipTimer = null;
        }
        if (tooltipEl) tooltipEl.style.display = 'none';
      };
      const clearRenameTimer = ()=>{
        if (renameTimer) {
          clearTimeout(renameTimer);
          renameTimer = null;
        }
      };
      const positionTooltip = (x, y)=>{
        if (!tooltipEl) return;
        const width = tooltipEl.offsetWidth || 0;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2));
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = (y + 8) + 'px';
      };
      const showTooltip = (target, text, className = 'tooltip', point)=>{
        if (!target || !target.isConnected) {
          hideTooltip();
          return;
        }
        if (!tooltipEl) {
          tooltipEl = document.createElement('div');
          tooltipEl.className = className;
          document.body.appendChild(tooltipEl);
        } else {
          tooltipEl.className = className;
        }
        tooltipEl.textContent = text;
        tooltipEl.style.display = 'block';
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
          positionTooltip(point.x, point.y);
        } else {
          const r = target.getBoundingClientRect();
          positionTooltip(r.left + r.width / 2, r.bottom);
        }
      };
      const startHoverTooltip = (el, text, className, shouldShow)=>{
        if (!el) return;
        if (typeof shouldShow === 'function' && !shouldShow(el)) return;
        const tooltipText = typeof text === 'function' ? text(el) : text;
        if (!tooltipText) return;
        if (tooltipTimer) clearTimeout(tooltipTimer);
        tooltipTimer = setTimeout(()=>showTooltip(el, tooltipText, className, lastMouse), 500);
      };
      const wireTooltip = (el, text, className, shouldShow)=>{
        if (!el) return;
        el.addEventListener('mouseenter', (e)=>{
          el._sctHovering = true;
          lastMouse = { x: e.clientX, y: e.clientY };
          startHoverTooltip(el, text, className, shouldShow);
        });
        el.addEventListener('mousemove', (e)=>{
          lastMouse = { x: e.clientX, y: e.clientY };
          if (tooltipEl && tooltipEl.style.display === 'block') {
            positionTooltip(e.clientX, e.clientY);
          }
        });
        el.addEventListener('mouseleave', ()=>{
          el._sctHovering = false;
          hideTooltip();
        });
        el.addEventListener('blur', hideTooltip);
      };
      filters.forEach((f)=>{
        if (pendingRenameId && pendingRenameId === f.id) {
          const input = document.createElement('input');
          input.type = 'text';
          input.maxLength = 16;
          input.className = 'custom-filter-input custom-filter-input--rename';
          input.value = pendingRenameValue || f.name;
          input.dataset.filterId = f.id;
          if (activeId && activeId === f.id) input.classList.add('active');
          wrap.appendChild(input);
          wireCustomFilterRenameInput(input, userKey, f.id, f.name);
          if (renameWasFocused) input.focus();
          return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'custom-filter-btn';
        btn.textContent = f.name;
        btn.dataset.filterId = f.id;
        if (activeId && activeId === f.id) btn.classList.add('active');
        const getCustomFilterTooltipText = (el)=>(
          el && el.classList.contains('active')
            ? 'Click to Rename\nDouble Click to Reset'
            : 'A filter you created'
        );
        btn.addEventListener('click', ()=>{
          clearRenameTimer();
          const wasActive = btn.classList.contains('active');
          if (!userKey) return;
          const user = resolveUserForKey(metrics, userKey);
          if (!user) return;
          const actionId = `${CUSTOM_FILTER_PREFIX}${f.id}`;
          applyUserFilterState(userKey, user, actionId);
          setCustomFilterActive(f.id);
          refreshUserUI({ preserveEmpty: true });
          persistVisibility();
          if (btn._sctHovering) {
            startHoverTooltip(
              btn,
              getCustomFilterTooltipText,
              'tooltip custom-filter-tooltip'
            );
          }
          if (wasActive) {
            renameTimer = setTimeout(()=>{
              beginCustomFilterRename(userKey, f.id, f.name, btn);
            }, 350);
          }
        });
        btn.addEventListener('dblclick', ()=>{
          clearRenameTimer();
          const next = getCustomFiltersForUser(userKey).filter(it=>it.id !== f.id);
          setCustomFiltersForUser(userKey, next);
          if (getCustomFilterId(currentVisibilitySource) === f.id){
            currentVisibilitySource = 'showAll';
            setListActionActive('showAll');
            triggerFilterClick('showAll');
          }
          renderCustomFilters(userKey);
        });
        wireTooltip(btn, getCustomFilterTooltipText, 'tooltip custom-filter-tooltip');
        wrap.appendChild(btn);
      });
      setCustomFilterActive(activeId);
      if (pendingInput) {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 16;
        input.placeholder = 'Name your filter...';
        input.className = 'custom-filter-input custom-filter-input--new';
        input.value = pendingValue;
        wrap.appendChild(input);
        wireCustomFilterInput(input);
        if (wasFocused) input.focus();
      }
    }
    function isPresetVisibilitySource(source){
      return PRESET_VISIBILITY_ACTIONS.has(source);
    }
  function buildPresetIds(action, user){
    if (!user) return [];
    const isVirtual = isVirtualUser(user);
      if (action === 'pastDay' || action === 'pastWeek'){
        const now = Date.now();
        const windowMs = action === 'pastDay' ? (24 * 60 * 60 * 1000) : (7 * 24 * 60 * 60 * 1000);
        const cutoff = now - windowMs;
        const mapped = Object.entries(user.posts||{}).map(([pid,p])=>({
          pid,
        postTime: (isVirtual ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
          pidBI: pidBigInt(pid)
        }));
        const sorted = mapped.filter(x=>x.postTime>0 && x.postTime >= cutoff).sort((a,b)=>{
          const dt = b.postTime - a.postTime;
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        return sorted.map(it=>it.pid);
      }
      if (action === 'last5' || action === 'last10'){
        const mapped = Object.entries(user.posts||{}).map(([pid,p])=>({
          pid,
        postTime: (isVirtual ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
          pidBI: pidBigInt(pid)
        }));
        const withTs = mapped.filter(x=>x.postTime>0).sort((a,b)=>b.postTime - a.postTime);
        const noTs = mapped.filter(x=>x.postTime<=0).sort((a,b)=>{
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        const sorted = withTs.concat(noTs);
        return sorted.slice(0, action === 'last5' ? 5 : 10).map(it=>it.pid);
      }
      if (action === 'top5' || action === 'top10'){
        const mapped = Object.entries(user.posts||{}).map(([pid,p])=>{
          const last = latestSnapshot(p.snapshots);
          return {
            pid,
            views: num(last?.views),
            likes: num(last?.likes),
            postTime: getPostTimeStrict(p) || 0,
            pidBI: pidBigInt(pid)
          };
      });
      const sorted = mapped.sort((a,b)=>{
        if (!a || !b) return !a && !b ? 0 : (!a ? 1 : -1);
        const dl = b.likes - a.likes;
        if (dl !== 0) return dl;
        const dv = b.views - a.views;
        if (dv !== 0) return dv;
          const dt = (b.postTime || 0) - (a.postTime || 0);
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return b.pid.localeCompare(a.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        return sorted.slice(0, action === 'top5' ? 5 : 10).map(it=>it.pid);
      }
      if (action === 'bottom5' || action === 'bottom10'){
        const now = Date.now();
        const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
        const mapped = Object.entries(user.posts||{}).map(([pid,p])=>{
          const postTime = (isTopToday ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0;
          const ageMs = postTime ? now - postTime : Infinity;
          const last = latestSnapshot(p.snapshots);
          return {
            pid,
            postTime,
            views: num(last?.views),
            likes: num(last?.likes),
            ageMs,
            pidBI: pidBigInt(pid)
          };
        });
        const bottomComparator = (a,b)=>{
          const dl = a.likes - b.likes;
          if (dl !== 0) return dl;
          const dv = a.views - b.views;
          if (dv !== 0) return dv;
          const dt = (a.postTime || 0) - (b.postTime || 0);
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? -1 : 1;
        };
        const picked = (function(){
          if (isTopToday){
            const sorted = mapped.slice().sort(bottomComparator);
            return sorted.slice(0, action === 'bottom5' ? 5 : 10);
          }
          const olderThan24h = mapped.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
          const sortedOlder = olderThan24h.sort(bottomComparator);
          const sortedAll = mapped.slice().sort(bottomComparator);
          const need = action === 'bottom5' ? 5 : 10;
          const out = [];
          for (const it of sortedOlder){
            if (out.length >= need) break;
            out.push(it);
          }
          if (out.length < need){
            const seen = new Set(out.map(p=>p.pid));
            for (const it of sortedAll){
              if (out.length >= need) break;
              if (seen.has(it.pid)) continue;
              out.push(it);
            }
          }
          return out;
        })();
        return picked.map(it=>it.pid);
      }
      if (action === 'stale'){
        const now = Date.now();
        const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
        const stale = Object.entries(user.posts||{}).map(([pid,p])=>{
          const lastRefresh = lastRefreshMsForPost(p);
          const ageMs = lastRefresh ? now - lastRefresh : Infinity;
          return { pid, ageMs };
        }).filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
        return stale.map(it=>it.pid);
      }
      return [];
    }
    function deriveVisibilitySource(user, ids){
      if (!user) return 'custom';
      const idsSet = new Set((ids||[]).filter(Boolean));
      const allPids = Object.keys(user.posts||{});
      if (idsSet.size === 0) return 'hideAll';
      if (idsSet.size === allPids.length && allPids.every(pid=>idsSet.has(pid))) return 'showAll';
      for (const action of PRESET_VISIBILITY_ACTIONS){
        const presetIds = buildPresetIds(action, user);
        if (!presetIds.length) continue;
        if (presetIds.length === idsSet.size && presetIds.every(pid=>idsSet.has(pid))) return action;
      }
      return 'custom';
    }
    function persistVisibility(){
      const source = currentVisibilitySource || currentListActionId || 'showAll';
      setLastFilterAction(source);
    }
    function persistCustomVisibilityForUser(userKey, ids){
      if (!userKey) return;
      const payload = { ids: Array.from(ids || []) };
      customVisibilityByUser[userKey] = payload;
      try { sessionCustomVisibilityByUser[userKey] = payload; sessionStorage.setItem('customVisibilityByUserSession', JSON.stringify(sessionCustomVisibilityByUser)); } catch {}
      try { chrome.storage.local.set({ customVisibilityByUser }); } catch {}
    }

    function updateCustomButtonLabel(userKey){
      const btn = $('#custom');
      if (!btn) return;
      const entry = getCustomVisibilityEntry(userKey);
      const hasCustom = Array.isArray(entry?.ids) && entry.ids.length > 0;
      btn.textContent = hasCustom ? 'Custom' : 'Save';
    }

    function applySavedVisibilityForUser(userKey, user, overrideAction, opts={}){
      if (!userKey || !user) return;
      const { seedAll = false } = opts;
      const rawSource = normalizeFilterAction(overrideAction) || getSessionFilterAction();
      let source = rawSource;
      const isCustomSource = source === 'custom' || isCustomFilterAction(source);
      currentVisibilitySource = source;
      currentListActionId = (source === 'showAll' || source === 'hideAll' || isPresetVisibilitySource(source) || isCustomSource) ? (isCustomSource ? 'custom' : source) : null;
      setListActionActive(currentListActionId || source);
      visibleSet.clear();
      if (seedAll) {
        Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
      }
      if (source === 'showAll') {
        if (!seedAll) Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
      } else if (source === 'hideAll') {
        visibleSet.clear();
      } else if (isPresetVisibilitySource(source)) {
        visibleSet.clear();
        const nextSet = computeVisibleSetForAction(user, source);
        if (nextSet) {
          for (const pid of nextSet) visibleSet.add(pid);
        }
      } else if (source === 'custom' || isCustomFilterAction(source)) {
        const filterId = getCustomFilterId(source);
        if (filterId) {
          const f = getCustomFiltersForUser(userKey).find(it=>it.id === filterId);
          if (!f) {
            currentVisibilitySource = 'showAll';
            currentListActionId = 'showAll';
            setListActionActive('showAll');
            source = 'showAll';
            visibleSet.clear();
            Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
          } else {
            visibleSet.clear();
            (f.ids || []).forEach(pid=>{
              if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
            });
          }
        } else {
          const customEntry = getCustomVisibilityEntry(userKey);
          const ids = Array.isArray(customEntry?.ids) ? customEntry.ids : [];
          if (ids.length) {
            visibleSet.clear();
            ids.forEach(pid=>{
              if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
            });
          }
        }
      }
      if (!normalizeFilterAction(lastFilterAction) || lastFilterAction === 'custom' || lastFilterAction !== source) setLastFilterAction(source);
      updateCustomButtonLabel(userKey);
      if (isCustomFilterAction(source)) setCustomFilterActive(getCustomFilterId(source));
      else setCustomFilterActive(null);
    }

    function applyUserFilterState(userKey, user, actionId){
      if (!userKey || !user) return;
      const rawSource = normalizeFilterAction(actionId) || getSessionFilterAction();
      let source = rawSource;
      const isCustomSource = source === 'custom' || isCustomFilterAction(source);
      currentVisibilitySource = source;
      currentListActionId = (source === 'showAll' || source === 'hideAll' || isPresetVisibilitySource(source) || isCustomSource) ? (isCustomSource ? 'custom' : source) : null;
      setListActionActive(currentListActionId || source);
      visibleSet.clear();
      Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
      if (source === 'hideAll') {
        visibleSet.clear();
      } else if (isPresetVisibilitySource(source)) {
        const nextSet = computeVisibleSetForAction(user, source);
        visibleSet.clear();
        if (nextSet) {
          for (const pid of nextSet) visibleSet.add(pid);
        }
      } else if (source === 'custom' || isCustomFilterAction(source)) {
        const filterId = getCustomFilterId(source);
        if (filterId) {
          const f = getCustomFiltersForUser(userKey).find(it=>it.id === filterId);
          if (!f) {
            currentVisibilitySource = 'showAll';
            currentListActionId = 'showAll';
            setListActionActive('showAll');
            source = 'showAll';
            visibleSet.clear();
            Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
          } else {
            visibleSet.clear();
            (f.ids || []).forEach(pid=>{
              if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
            });
          }
        } else {
          const customEntry = getCustomVisibilityEntry(userKey);
          const ids = Array.isArray(customEntry?.ids) ? customEntry.ids : [];
          if (ids.length) {
            visibleSet.clear();
            ids.forEach(pid=>{
              if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
            });
          }
        }
      }
      updateCustomButtonLabel(userKey);
      if (isCustomFilterAction(source)) setCustomFilterActive(getCustomFilterId(source));
      else setCustomFilterActive(null);
    }

    function triggerFilterClick(actionId){
      const id = normalizeFilterAction(actionId) || getSessionFilterAction() || 'showAll';
      if (id === 'custom' || isCustomFilterAction(id)) return false;
      const btn = document.getElementById(id);
      if (!btn || typeof btn.click !== 'function') return false;
      btn.click();
      return true;
    }

    function renderComparePills(){
      const container = $('#comparePills');
      if (!container) return;
      container.innerHTML = '';
      const users = Array.from(compareUsers);
      setCompareNextColor(getCompareSeriesColor(users.length));
      users.forEach((userKey, idx)=>{
        const user = resolveUserForKey(metrics, userKey);
        const handle = getUserDisplayLabel(userKey, user);
        const pill = document.createElement('div');
        pill.className = 'compare-pill';
        pill.dataset.userKey = userKey;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'compare-pill-name';
        nameSpan.textContent = handle;
        const removeBtn = document.createElement('span');
        removeBtn.className = 'compare-pill-remove';
        removeBtn.textContent = '×';
        removeBtn.style.backgroundColor = getCompareSeriesColor(idx);
        pill.title = 'Remove';
        pill.onclick = ()=>{
          compareUsers.delete(userKey);
          // If compare section becomes empty, add current user to show who we're looking at
          if (compareUsers.size === 0 && currentUserKey && resolveUserForKey(metrics, currentUserKey)){
            addCompareUser(currentUserKey);
          } else {
            renderComparePills();
            updateCompareCharts();
          }
        };
        pill.appendChild(nameSpan);
        pill.appendChild(removeBtn);
        container.appendChild(pill);
      });
      if (compareUsers.size < MAX_COMPARE_USERS){
        const addBtn = document.createElement('button');
        addBtn.className = 'compare-add-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Add user';
        addBtn.onclick = ()=>{
          $('#compareSearch').focus();
        };
        container.appendChild(addBtn);
      }
      const searchInput = $('#compareSearch');
      if (searchInput) searchInput.disabled = compareUsers.size >= MAX_COMPARE_USERS;
    }

    function addCompareUser(userKey){
      if (isTopTodayKey(userKey)) return;
      if (compareUsers.size >= MAX_COMPARE_USERS) return;
      if (isMetricsPartial && !resolveUserForKey(metrics, userKey)) {
        refreshData({ skipPostListRebuild: false, skipRestoreZoom: true })
          .then(() => addCompareUser(userKey))
          .catch(() => {});
        return;
      }
      if (!resolveUserForKey(metrics, userKey)) return;
      if (compareUsers.has(userKey)) return;
      compareUsers.add(userKey);
      renderComparePills();
      updateCompareCharts();
      $('#compareSearch').value = '';
      $('#compareSuggestions').style.display = 'none';
    }

    async function updateCompareCharts(){
      const userKeys = Array.from(compareUsers);
      if (userKeys.length === 0){
        refreshUserUI();
        return;
      }
      await ensureFullSnapshots();

      // Update allViewsChart
      try {
        const useUnique = compareViewsChartType === 'unique';
        const allSeries = [];
        userKeys.forEach((userKey, idx)=>{
          const user = resolveUserForKey(metrics, userKey);
          if (!user) return;
          const pts = (function(){
            const events = [];
            for (const [pid, p] of Object.entries(user.posts||{})){
              for (const s of (p.snapshots||[])){
                const t = Number(s.t);
                const v = useUnique ? Number(s.uv) : Number(s.views);
                if (isFinite(t) && isFinite(v)) events.push({ t, v, pid });
              }
            }
            events.sort((a,b)=> a.t - b.t);
            const latest = new Map();
            let total = 0;
            const out = [];
            for (const e of events){
              const prev = latest.get(e.pid) || 0;
              if (e.v !== prev){
                latest.set(e.pid, e.v);
                total += (e.v - prev);
                out.push({ x: e.t, y: total, t: e.t });
              }
            }
            return out;
          })();
          if (pts.length){
            const color = getCompareSeriesColor(idx);
            const handle = getUserHandleLabel(userKey, user);
            const profileUrl = handle ? `${SITE_ORIGIN}/profile/${handle}` : null;
            const isTopToday = isTopTodayKey(userKey);
            const label = isTopToday
              ? (useUnique ? 'Top Today • Viewers' : 'Top Today • Total Views')
              : (useUnique ? `@${handle}'s Viewers` : `@${handle}'s Total Views`);
            allSeries.push({ id: userKey, label, color, points: pts, profileUrl: isTopToday ? null : profileUrl });
          }
        });
        const yAxisLabel = useUnique ? 'Viewers' : 'Total Views';
        allViewsChart.setYAxisLabel(yAxisLabel);
        allViewsChart.setData(allSeries);
      } catch {}

      // Update allLikesChart
      try {
        const allSeries = [];
        userKeys.forEach((userKey, idx)=>{
          const user = resolveUserForKey(metrics, userKey);
          if (!user) return;
          const ptsLikes = (function(){
            const events = [];
            for (const [pid, p] of Object.entries(user.posts||{})){
              for (const s of (p.snapshots||[])){
                const t = Number(s.t), v = Number(s.likes);
                if (isFinite(t) && isFinite(v)) events.push({ t, v, pid });
              }
            }
            events.sort((a,b)=> a.t - b.t);
            const latest = new Map();
            let total = 0;
            const out = [];
            for (const e of events){
              const prev = latest.get(e.pid) || 0;
              if (e.v !== prev){
                latest.set(e.pid, e.v);
                total += (e.v - prev);
                out.push({ x: e.t, y: total, t: e.t });
              }
            }
            return out;
          })();
          if (ptsLikes.length){
            const color = getCompareSeriesColor(idx);
            const handle = getUserHandleLabel(userKey, user);
            const profileUrl = handle ? `${SITE_ORIGIN}/profile/${handle}` : null;
            const isTopToday = isTopTodayKey(userKey);
            allSeries.push({ id: userKey, label: isTopToday ? 'Top Today • Likes' : `@${handle}'s Likes`, color, points: ptsLikes, profileUrl: isTopToday ? null : profileUrl });
          }
        });
        allLikesChart.setData(allSeries);
      } catch {}

      // Update cameosChart
      try {
        const allSeries = [];
        userKeys.forEach((userKey, idx)=>{
          const user = resolveUserForKey(metrics, userKey);
          if (!user) return;
          let arr = Array.isArray(user.cameos) ? user.cameos : [];
          if ((!arr || !arr.length) && isCameoKey(userKey)) {
            const fallbackUser = findUserByHandle(metrics, user?.handle || cameoNameFromKey(userKey));
            arr = Array.isArray(fallbackUser?.cameos) ? fallbackUser.cameos : arr;
          }
          const pts = arr.map(it=>({ x:Number(it.t), y:Number(it.count), t:Number(it.t) })).filter(p=>isFinite(p.x)&&isFinite(p.y));
          if (pts.length){
            const color = getCompareSeriesColor(idx);
            const handle = getUserHandleLabel(userKey, user);
            const profileUrl = handle ? `${SITE_ORIGIN}/profile/${handle}` : null;
            const isTopToday = isTopTodayKey(userKey);
            allSeries.push({ id: userKey, label: isTopToday ? 'Top Today • Cast in' : `@${handle}'s Cast in`, color, points: pts, profileUrl: isTopToday ? null : profileUrl });
          }
        });
        cameosChart.setData(allSeries);
      } catch {}

      // Update followersChart
      try {
        const allSeries = [];
        userKeys.forEach((userKey, idx)=>{
          const user = resolveUserForKey(metrics, userKey);
          if (!user) return;
          const arr = getFollowersSeriesForUser(userKey, user);
          const pts = arr.map(it=>({ x:Number(it.t), y:Number(it.count), t:Number(it.t) })).filter(p=>isFinite(p.x)&&isFinite(p.y));
          if (pts.length){
            const color = getCompareSeriesColor(idx);
            const handle = getUserHandleLabel(userKey, user);
            const profileUrl = handle ? `${SITE_ORIGIN}/profile/${handle}` : null;
            const isTopToday = isTopTodayKey(userKey);
            allSeries.push({ id: userKey, label: isTopToday ? 'Top Today • Followers' : `@${handle}'s Followers`, color, points: pts, profileUrl: isTopToday ? null : profileUrl });
          }
        });
        followersChart.setData(allSeries);
      } catch {}

      // Update metric cards with aggregated totals across all compared users
      try {
        const totals = (function(){
          const res = { views:0, uniqueViews:0, likes:0, replies:0, remixes:0, interactions:0, cameos:0, followers:0 };
          for (const userKey of userKeys){
            const user = resolveUserForKey(metrics, userKey);
            if (!user) continue;
            const userTotals = computeTotalsForUser(user);
            res.views += userTotals.views;
            res.uniqueViews += userTotals.uniqueViews;
            res.likes += userTotals.likes;
            res.replies += userTotals.replies;
            res.remixes += userTotals.remixes;
            res.interactions += userTotals.interactions;
            const cameosArr = Array.isArray(user.cameos) ? user.cameos : [];
            if (cameosArr.length > 0){
              const lastCameo = cameosArr[cameosArr.length - 1];
              res.cameos += num(lastCameo?.count);
            }
            const followersArr = getFollowersSeriesForUser(userKey, user);
            if (followersArr.length > 0){
              const lastFollower = followersArr[followersArr.length - 1];
              res.followers += num(lastFollower?.count);
            }
          }
          return res;
        })();
        const allTotalViewsEl = $('#allTotalViewsTotal'); if (allTotalViewsEl) allTotalViewsEl.textContent = fmt2(totals.views);
        const allUniqueViewsEl = $('#allUniqueViewsTotal'); if (allUniqueViewsEl) allUniqueViewsEl.textContent = fmt2(totals.uniqueViews);
        const allLikesEl = $('#allLikesTotal'); if (allLikesEl) allLikesEl.textContent = fmt2(totals.likes);
        const allRepliesEl = $('#allRepliesTotal'); if (allRepliesEl) allRepliesEl.textContent = fmtK2OrInt(totals.replies);
        const allRemixesEl = $('#allRemixesTotal'); if (allRemixesEl) allRemixesEl.textContent = fmt2(totals.remixes);
        const allInterEl = $('#allInteractionsTotal'); if (allInterEl) allInterEl.textContent = fmt2(totals.interactions);
        const allCameosEl = $('#allCameosTotal'); if (allCameosEl) allCameosEl.textContent = fmtK2OrInt(totals.cameos);
        const followersEl = $('#followersTotal'); if (followersEl) followersEl.textContent = fmtK2OrInt(totals.followers);
      } catch {}
    }

    try {
      window.addEventListener('sct-theme-change', ()=>{
        renderComparePills();
        refreshUserUI({ preserveEmpty: true, skipPostListRebuild: true, skipRestoreZoom: true });
      });
    } catch {}


    // Function to calculate best time to post for LIKES from ALL users' data
    function calculateBestPostTimeForLikes(){
      if (!metrics || !metrics.users) return { year: null, month: null, week: null };

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const now = Date.now();
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const MS_48H = 48 * 60 * 60 * 1000;

      const HEATMAP_START_HOUR = 0;
      const HEATMAP_END_HOUR = 24;
      const HEATMAP_BUCKETS = HEATMAP_END_HOUR - HEATMAP_START_HOUR;

      const bucketSizeMinutes = 15;

      const cutoffs = {
        year: now - 365 * MS_PER_DAY,
        month: now - 30 * MS_PER_DAY,
        week: now - 7 * MS_PER_DAY
      };

      const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

      // Cache per run
      const followerSeriesCache = new Map(); // userKey -> [{t,count}] sorted asc
      const likes48Cache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

      function getFollowerSeries(userKey, user){
        let series = followerSeriesCache.get(userKey);
        if (series) return series;

        const arr = Array.isArray(user?.followers) ? user.followers : [];
        series = arr
          .map(it => ({ t: toTs(it?.t), count: Number(it?.count) }))
          .filter(it => isFinite(it.t) && it.t > 0 && isFinite(it.count) && it.count > 0)
          .sort((a, b) => a.t - b.t);

        followerSeriesCache.set(userKey, series);
        return series;
      }

      // Nearest follower count to postTime (binary search in sorted series)
      function getFollowersAtTime(userKey, user, postTime){
        const series = getFollowerSeries(userKey, user);
        if (!series.length) return 0;

        let lo = 0, hi = series.length - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (series[mid].t <= postTime) { idx = mid; lo = mid + 1; }
          else { hi = mid - 1; }
        }

        const before = idx >= 0 ? series[idx] : null;
        const after = (idx + 1) < series.length ? series[idx + 1] : null;

        if (!before) return after ? after.count : 0;
        if (!after) return before.count;

        const dtBefore = Math.abs(postTime - before.t);
        const dtAfter = Math.abs(after.t - postTime);
        return (dtAfter < dtBefore) ? after.count : before.count;
      }

      // Prefer likes at (>= postTime + 48h) if we have a snapshot at/after that time.
      // Fallback: if post is older than 48h but we don't have an after-48h snapshot, use max likes seen.
      function getLikesAt48h(post, postTime){
        if (!post || !postTime) return 0;

        if (likes48Cache) {
          const cached = likes48Cache.get(post);
          if (cached != null) return cached;
        }

        const snaps = Array.isArray(post?.snapshots) ? post.snapshots : [];
        if (!snaps.length) {
          if (likes48Cache) likes48Cache.set(post, 0);
          return 0;
        }

        const t48 = postTime + MS_48H;

        let bestAfterT = Infinity;
        let bestAfterLikes = null;

        let maxLikes = 0;
        let sawAnyLikes = false;

        for (const s of snaps){
          const t = toTs(s?.t);
          const l = Number(s?.likes);
          if (!Number.isFinite(l)) continue;

          sawAnyLikes = true;
          if (l > maxLikes) maxLikes = l;

          if (t && t >= t48 && t < bestAfterT) {
            bestAfterT = t;
            bestAfterLikes = l;
          }
        }

        let out = 0;
        if (bestAfterLikes != null) out = bestAfterLikes;
        else if (now >= t48 && sawAnyLikes) out = maxLikes;
        else out = 0;

        if (likes48Cache) likes48Cache.set(post, out);
        return out;
      }

      // Weighted quantiles over discrete time buckets (no per-post times array)
      function weightedQuantile(sortedEntries, totalCount, q){
        if (!sortedEntries.length || totalCount <= 0) return null;
        const target = q * totalCount;
        let acc = 0;
        for (const e of sortedEntries){
          acc += e.count;
          if (acc >= target) return e;
        }
        return sortedEntries[sortedEntries.length - 1] || null;
      }
      function weightedQuantileContinuous(sortedEntries, totalCount, q){
        if (!sortedEntries.length || totalCount <= 0) return null;
        const target = q * totalCount;
        let acc = 0;
        for (const e of sortedEntries){
          const count = Number(e.count) || 0;
          if (count <= 0) continue;
          const next = acc + count;
          if (next >= target) {
            const frac = (target - acc) / count;
            const clamped = Math.max(0, Math.min(1, frac));
            return e.minutes + clamped * bucketSizeMinutes;
          }
          acc = next;
        }
        const last = sortedEntries[sortedEntries.length - 1];
        return last ? last.minutes + bucketSizeMinutes : null;
      }

      function formatTime(hour, minute){
        const hour12 = hour % 12 || 12;
        const minuteStr = String(minute).padStart(2, '0');
        const ampm = hour >= 12 ? 'PM' : 'AM';
        return `${hour12}:${minuteStr} ${ampm}`;
      }
      function formatTimeRangeByMinutes(startMinutes, endMinutes){
        const startClamped = Math.max(0, Math.min(1439, Math.floor(startMinutes)));
        let endClamped = Math.max(0, Math.min(1439, Math.ceil(endMinutes)));
        if (endClamped <= startClamped) endClamped = Math.min(1439, startClamped + 1);
        const startHour = Math.floor(startClamped / 60) % 24;
        const startMin = startClamped % 60;
        const endHour = Math.floor(endClamped / 60) % 24;
        const endMin = endClamped % 60;
        return `${formatTime(startHour, startMin)} - ${formatTime(endHour, endMin)}`;
      }

      function buildRecommendation(buckets, totalPostsUsed){
        if (!buckets || !buckets.length) return null;

        // Build weighted distribution of (hour, minuteBucket) using bucket.count
        const dist = buckets
          .map(b => ({
            hour: Number(b?.stats?.hour),
            minute: Number(b?.stats?.minute),
            count: Number(b?.count) || 0
          }))
          .filter(e => isFinite(e.hour) && isFinite(e.minute) && e.count > 0)
          .map(e => ({ ...e, minutes: e.hour * 60 + e.minute }))
          .sort((a, b) => a.minutes - b.minutes);

        const totalCount = dist.reduce((s, e) => s + e.count, 0);
        if (!dist.length || totalCount <= 0) return null;

        const med = weightedQuantile(dist, totalCount, 0.50);
        const q1 = weightedQuantile(dist, totalCount, 0.25);
        const q3 = weightedQuantile(dist, totalCount, 0.75);
        const medMinutes = weightedQuantileContinuous(dist, totalCount, 0.50);
        const q1Minutes = weightedQuantileContinuous(dist, totalCount, 0.25);
        const q3Minutes = weightedQuantileContinuous(dist, totalCount, 0.75);
        if (!med || !q1 || !q3) return null;

        const bestHour = med.hour;
        const bestMinute = med.minute;
        const recommendMinute = bestMinute < 30 ? 1 : 31;

        let timeRangeStr;
        if (totalCount <= 5) {
          const startMinutes = Number.isFinite(medMinutes) ? medMinutes : (bestHour * 60 + bestMinute);
          const endMinutes = startMinutes + bucketSizeMinutes;
          timeRangeStr = formatTimeRangeByMinutes(startMinutes, endMinutes);
        } else {
          const rangeMinutes = (Number.isFinite(q3Minutes) && Number.isFinite(q1Minutes))
            ? (q3Minutes - q1Minutes)
            : (q3.minutes - q1.minutes);
          if (rangeMinutes > 180) {
            const medianMinutes = Number.isFinite(medMinutes) ? medMinutes : (bestHour * 60 + bestMinute);
            const startMinutes = Math.max(0, medianMinutes - 60);
            const endMinutes = Math.min(1439, medianMinutes + 60);
            timeRangeStr = formatTimeRangeByMinutes(startMinutes, endMinutes);
          } else {
            const startMinutes = Number.isFinite(q1Minutes) ? q1Minutes : q1.minutes;
            let endMinutes = Number.isFinite(q3Minutes) ? q3Minutes : q3.minutes;
            if (endMinutes <= startMinutes) {
              endMinutes = startMinutes + bucketSizeMinutes;
            }
            timeRangeStr = formatTimeRangeByMinutes(startMinutes, endMinutes);
          }
        }

        const recommendTimeStr = formatTime(bestHour, recommendMinute);

        const dayOfWeekMap = new Map();
        for (const bucket of buckets) {
          const m = bucket?.stats?.dayOfWeek;
          if (!(m instanceof Map)) continue;
          for (const [day, count] of m.entries()) {
            dayOfWeekMap.set(day, (dayOfWeekMap.get(day) || 0) + count);
          }
        }

        let bestDayOfWeek = null;
        let bestDayCount = 0;
        for (const [day, count] of dayOfWeekMap.entries()){
          if (count > bestDayCount){
            bestDayCount = count;
            bestDayOfWeek = day;
          }
        }

        const date = new Date();
        date.setHours(bestHour, bestMinute, 0, 0);
        const tzStr = date.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();

        const dayStr = bestDayOfWeek != null ? dayNames[bestDayOfWeek] : '';
        const postCount = buckets.reduce((sum, bucket)=> sum + (Number(bucket?.count) || 0), 0);
        const liftValues = buckets
          .map((bucket)=>{
            const lift = Number(bucket?.lift);
            if (Number.isFinite(lift)) return lift;
            const score = Number(bucket?.score);
            if (Number.isFinite(score)) return Math.exp(score);
            return null;
          })
          .filter((v)=> Number.isFinite(v) && v > 0);
        const expectedLift = liftValues.length ? Math.max(...liftValues) : null;

        return {
          timeStr: `${timeRangeStr} ${tzStr}`,
          recommendTimeStr: `${recommendTimeStr} ${tzStr}`,
          dayStr: dayStr ? ` on ${dayStr}` : '',
          postCount,
          totalPostsUsed,
          bestHour,
          bestMinute,
          bestDayOfWeek,
          expectedLift: Number.isFinite(expectedLift) ? expectedLift : null
        };
      }

      // --- Model:
      // y = log(1+likes48) ~ alpha + beta*log(1+followers) + time_bucket_effect
      // time_bucket_effect is computed as residual and EB-shrunk toward 0
      const rangeKeys = ['year', 'month', 'week'];

      const reg = {
        year: { n: 0, sumX: 0, sumY: 0, sumXX: 0, sumXY: 0 },
        month: { n: 0, sumX: 0, sumY: 0, sumXX: 0, sumXY: 0 },
        week: { n: 0, sumX: 0, sumY: 0, sumXX: 0, sumXY: 0 }
      };

      // First pass: regression sums (same post can feed multiple ranges)
      for (const [userKey, user] of Object.entries(metrics.users || {})){
        for (const [, p] of Object.entries(user.posts || {})){
          const postTime = getPostTimeStrict(p);
          if (!postTime || postTime < cutoffs.year) continue;

          const likes48 = getLikesAt48h(p, postTime);
          if (!(likes48 > 0)) continue;

          const followers = getFollowersAtTime(userKey, user, postTime);
          if (!(followers > 0)) continue;

          const x = Math.log1p(followers);
          const y = Math.log1p(likes48);
          if (!isFinite(x) || !isFinite(y)) continue;

          // year always (within cutoff)
          {
            const r = reg.year;
            r.n++; r.sumX += x; r.sumY += y; r.sumXX += x * x; r.sumXY += x * y;
          }
          if (postTime >= cutoffs.month) {
            const r = reg.month;
            r.n++; r.sumX += x; r.sumY += y; r.sumXX += x * x; r.sumXY += x * y;
          }
          if (postTime >= cutoffs.week) {
            const r = reg.week;
            r.n++; r.sumX += x; r.sumY += y; r.sumXX += x * x; r.sumXY += x * y;
          }
        }
      }

      const model = { year: null, month: null, week: null };
      for (const k of rangeKeys){
        const r = reg[k];
        if (!r || r.n <= 0) continue;

        const n = r.n;
        const meanX = r.sumX / n;
        const meanY = r.sumY / n;

        const denom = r.sumXX - n * meanX * meanX;
        let beta = 1;
        if (denom > 1e-9) {
          beta = (r.sumXY - n * meanX * meanY) / denom;
          if (!isFinite(beta)) beta = 1;
        }
        let alpha = meanY - beta * meanX;
        if (!isFinite(alpha)) alpha = 0;

        model[k] = { alpha, beta, n };
      }

      // Second pass: residual aggregation into:
      // - time-of-day buckets (15-min)
      // - day x hour heatmap buckets (1-hour)
      const agg = {};
      for (const k of rangeKeys){
        agg[k] = {
          totalPostsUsed: 0,
          timeStats: new Map(), // key "H:minuteBucket" -> {count,sumRes,dayOfWeek:Map,hour,minute}
          heatSum: Array.from({ length: 7 }, () => Array(HEATMAP_BUCKETS).fill(0)),
          heatCount: Array.from({ length: 7 }, () => Array(HEATMAP_BUCKETS).fill(0)),
          heatLikesSum: Array.from({ length: 7 }, () => Array(HEATMAP_BUCKETS).fill(0))
        };
      }

      const RESID_CLIP = 3.0;

      for (const [userKey, user] of Object.entries(metrics.users || {})){
        for (const [, p] of Object.entries(user.posts || {})){
          const postTime = getPostTimeStrict(p);
          if (!postTime || postTime < cutoffs.year) continue;

          const likes48 = getLikesAt48h(p, postTime);
          if (!(likes48 > 0)) continue;

          const followers = getFollowersAtTime(userKey, user, postTime);
          if (!(followers > 0)) continue;

          const x = Math.log1p(followers);
          const y = Math.log1p(likes48);
          if (!isFinite(x) || !isFinite(y)) continue;

          const d = new Date(postTime);
          const dayOfWeek = d.getDay();
          const hour = d.getHours();
          const minute = d.getMinutes();
          const minuteBucket = Math.floor(minute / bucketSizeMinutes) * bucketSizeMinutes;
          const col = hour - HEATMAP_START_HOUR;
          if (dayOfWeek < 0 || dayOfWeek > 6) continue;
          if (col < 0 || col >= HEATMAP_BUCKETS) continue;

          const timeKey = `${hour}:${minuteBucket}`;

          function addToRange(rangeKey){
            const m = model[rangeKey];
            if (!m) return;

            let resid = y - (m.alpha + m.beta * x);
            if (!isFinite(resid)) return;
            resid = clamp(resid, -RESID_CLIP, RESID_CLIP);

            const a = agg[rangeKey];
            a.totalPostsUsed++;

            // heatmap cell (day x hour)
            a.heatSum[dayOfWeek][col] += resid;
            a.heatCount[dayOfWeek][col] += 1;
            a.heatLikesSum[dayOfWeek][col] += likes48;

            // time-of-day bucket (15-min)
            let stats = a.timeStats.get(timeKey);
            if (!stats) {
              stats = { count: 0, sumRes: 0, dayOfWeek: new Map(), hour, minute: minuteBucket };
              a.timeStats.set(timeKey, stats);
            }
            stats.count++;
            stats.sumRes += resid;
            stats.dayOfWeek.set(dayOfWeek, (stats.dayOfWeek.get(dayOfWeek) || 0) + 1);
          }

          // year always
          addToRange('year');
          if (postTime >= cutoffs.month) addToRange('month');
          if (postTime >= cutoffs.week) addToRange('week');
        }
      }

      function finalizeRange(rangeKey){
        const a = agg[rangeKey];
        if (!a) return { primary: null, secondary: null, heatmap: { matrix: Array.from({ length: 7 }, ()=>Array(24).fill(0)), counts: Array.from({ length: 7 }, ()=>Array(24).fill(0)), avgLikes: Array.from({ length: 7 }, ()=>Array(24).fill(0)), max: 0, min: 0 } };

        const totalPostsUsed = a.totalPostsUsed || 0;

        // Prior strength for EB shrinkage (tuneable, capped)
        const PRIOR = Math.max(20, Math.min(200, Math.round(totalPostsUsed / 500)));

        // Heatmap: lift = exp( shrunk_residual )
        const matrix = Array.from({ length: 7 }, ()=>Array(HEATMAP_BUCKETS).fill(0));
        const avgLikes = Array.from({ length: 7 }, ()=>Array(HEATMAP_BUCKETS).fill(0));
        let maxLift = 0;
        let minLift = Infinity;

        for (let day = 0; day < 7; day++){
          for (let h = 0; h < HEATMAP_BUCKETS; h++){
            const c = a.heatCount[day][h] || 0;
            if (c <= 0) { matrix[day][h] = 0; continue; }
            const sumRes = a.heatSum[day][h] || 0;
            const shrunk = sumRes / (c + PRIOR); // EB shrink toward 0
            const lift = Math.exp(shrunk);
            matrix[day][h] = lift;
            const likesSum = a.heatLikesSum[day][h] || 0;
            avgLikes[day][h] = likesSum / c;
            if (lift > 0) {
              maxLift = Math.max(maxLift, lift);
              minLift = Math.min(minLift, lift);
            }
          }
        }
        if (!isFinite(minLift)) minLift = 0;

        const pickBestDayForHour = (hour)=>{
          if (!Number.isFinite(hour) || !Array.isArray(matrix)) return null;
          let bestDay = null;
          let bestLift = 0;
          for (let day = 0; day < matrix.length; day++){
            const row = matrix[day];
            const lift = Number(row?.[hour]);
            if (!Number.isFinite(lift)) continue;
            if (lift > bestLift) {
              bestLift = lift;
              bestDay = day;
            }
          }
          return bestDay;
        };
        const applyHeatmapDay = (rec)=>{
          if (!rec) return;
          const bestDay = pickBestDayForHour(rec.bestHour);
          if (bestDay == null) return;
          rec.bestDayOfWeek = bestDay;
          rec.dayStr = ` on ${dayNames[bestDay]}`;
        };

        // Rank time buckets by lift (or equivalently by shrunk residual)
        const allBuckets = Array.from(a.timeStats.entries())
          .map(([timeKey, stats]) => {
            const count = Number(stats?.count) || 0;
            if (count <= 0) return null;
            const sumRes = Number(stats?.sumRes) || 0;
            const shrunk = sumRes / (count + PRIOR);
            const score = shrunk; // rank in log-space
            const lift = Math.exp(shrunk);
            return { timeKey, score, lift, count, stats };
          })
          .filter(Boolean)
          .sort((x, y) => (y.score - x.score) || (y.count - x.count));

        const primary = buildRecommendation(allBuckets.slice(0, 3), totalPostsUsed);
        if (primary) applyHeatmapDay(primary);

        let secondary = null;
        if (primary && allBuckets.length > 0) {
          const minHourDistance = 6;
          const primaryHour = primary.bestHour;
          const primaryDayStr = primary.dayStr ? primary.dayStr.replace(' on ', '') : '';

          const getHourDistance = (hour)=>{
            const diff = Math.abs(hour - primaryHour);
            return Math.min(diff, 24 - diff);
          };

          const eligibleBuckets = allBuckets.filter((bucket)=>{
            const dayCounts = bucket.stats?.dayOfWeek;
            let topDay = null;
            let topCount = 0;
            if (dayCounts instanceof Map) {
              for (const [day, count] of dayCounts.entries()){
                if (count > topCount){
                  topCount = count;
                  topDay = day;
                }
              }
            }
            const dayStr = topDay != null ? dayNames[topDay] : '';
            return (!primaryDayStr || dayStr !== primaryDayStr);
          });

          const farBucket = eligibleBuckets.find((bucket)=>{
            const hr = Number(bucket?.stats?.hour);
            if (!isFinite(hr)) return false;
            return getHourDistance(hr) > minHourDistance;
          }) || eligibleBuckets[0];

          secondary = farBucket ? buildRecommendation([farBucket], totalPostsUsed) : null;
        }

        return {
          primary: primary || null,
          secondary: secondary || null,
          heatmap: {
            matrix,
            counts: a.heatCount.map((row)=> row.map((v)=> Math.max(0, Math.floor(Number(v) || 0)))),
            avgLikes,
            max: maxLift || 0,
            min: (minLift && isFinite(minLift)) ? minLift : 0
          }
        };
      }

      return {
        year: finalizeRange('year'),
        month: finalizeRange('month'),
        week: finalizeRange('week')
      };
    }


  // Function to update best time to post section
    function scheduleBestTimeRefresh(){
      if (bestTimeRefreshInFlight) {
        bestTimeRefreshQueued = true;
        return;
      }
      bestTimeRefreshInFlight = true;
      const metricsStamp = lastMetricsUpdatedAt || 0;
      const run = async () => {
        try {
          await ensureFullSnapshots();
          bestTimeData = calculateBestPostTimeForLikes();
          lastBestTimeUpdate = Date.now();
          if (metricsStamp) lastBestTimeMetricsUpdatedAt = metricsStamp;
          saveBestTimeCache(bestTimeData);
          saveSessionCache();
          renderBestTimeWidget(bestTimeData, bestTimeRange);
        } finally {
          bestTimeRefreshInFlight = false;
          if (bestTimeRefreshQueued) {
            bestTimeRefreshQueued = false;
            scheduleBestTimeRefresh();
          }
        }
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 1500 });
      } else {
        setTimeout(run, 0);
      }
    }
    function openTopFeedGatherWindow(){
      const url = 'https://sora.chatgpt.com/explore?feed=top&gather=1';
      try {
        if (chrome?.windows?.create) {
          chrome.windows.create({ url, focused: true });
          return;
        }
      } catch {}
      try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
    }
    function openProfileGatherWindow(handle){
      const cleanHandle = (handle || '').replace(/^@/, '').trim();
      if (!cleanHandle) return;
      const url = `${SITE_ORIGIN}/profile/${encodeURIComponent(cleanHandle)}?gather=1`;
      try {
        if (chrome?.windows?.create) {
          chrome.windows.create({ url, focused: true });
          return;
        }
      } catch {}
      try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
    }
    function initBestTimeGatherLink(){
      const link = $('#bestTimeGatherLink');
      if (!link) return;
      link.addEventListener('click', (e)=>{
        e.preventDefault();
        openTopFeedGatherWindow();
      });
    }
    function initBestTimeInfoTooltip(){
      const infoEl = $('#bestTimeLiftInfo');
      if (!infoEl) return;
      bindBestTimeInfoTooltip(infoEl);
    }
    function initMetricsGatherLink(){
      const link = $('#metricsGatherLink');
      if (!link) return;
      link.addEventListener('click', (e)=>{
        e.preventDefault();
        if (!currentUserKey) return;
        if (isTopTodayKey(currentUserKey)) {
          openTopFeedGatherWindow();
          return;
        }
        const user = resolveUserForKey(metrics, currentUserKey);
        const handle = getProfileHandleFromKey(currentUserKey, user);
        if (!handle) return;
        openProfileGatherWindow(handle);
      });
    }
    function bindBestTimeHeatmapTooltip(heatmapEl){
      if (!heatmapEl || heatmapEl.dataset.tooltipBound === '1') return;
      heatmapEl.dataset.tooltipBound = '1';
      if (!bestTimeHeatmapTooltip) {
        bestTimeHeatmapTooltip = document.createElement('div');
        bestTimeHeatmapTooltip.className = 'tooltip best-time-tooltip';
        bestTimeHeatmapTooltip.style.display = 'none';
        document.body.appendChild(bestTimeHeatmapTooltip);
      }
      let activeCell = null;
      const hide = ()=>{
        if (bestTimeHeatmapTooltip) bestTimeHeatmapTooltip.style.display = 'none';
        activeCell = null;
      };
      const showAt = (cell, clientX, clientY)=>{
        const text = cell?.dataset?.tooltip || '';
        if (!text || !bestTimeHeatmapTooltip) return;
        bestTimeHeatmapTooltip.textContent = text;
        bestTimeHeatmapTooltip.style.display = 'block';
        const width = bestTimeHeatmapTooltip.offsetWidth || 0;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, clientX - width / 2));
        bestTimeHeatmapTooltip.style.left = left + 'px';
        bestTimeHeatmapTooltip.style.top = (clientY + 8) + 'px';
      };
      heatmapEl.addEventListener('mousemove', (e)=>{
        const cell = e.target.closest('.best-time-heatmap-cell');
        if (!cell) { hide(); return; }
        if (heatmapEl.dataset.todayMode === '1' && cell.classList.contains('today-inactive')) {
          hide();
          return;
        }
        activeCell = cell;
        showAt(cell, e.clientX, e.clientY);
      });
      heatmapEl.addEventListener('mouseleave', hide);
      heatmapEl.addEventListener('blur', hide, true);
    }
    function bindBestTimeInfoTooltip(infoEl){
      if (!infoEl || infoEl.dataset.tooltipBound === '1') return;
      infoEl.dataset.tooltipBound = '1';
      if (!bestTimeInfoTooltip) {
        bestTimeInfoTooltip = document.createElement('div');
        bestTimeInfoTooltip.className = 'tooltip best-time-info-tooltip';
        bestTimeInfoTooltip.style.display = 'none';
        document.body.appendChild(bestTimeInfoTooltip);
      }
      let showTimer = null;
      let lastPoint = null;
      const hide = ()=>{
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
        }
        if (bestTimeInfoTooltip) bestTimeInfoTooltip.style.display = 'none';
      };
      const showAt = (clientX, clientY)=>{
        const text = infoEl?.dataset?.tooltip || '';
        if (!text || !bestTimeInfoTooltip) return;
        bestTimeInfoTooltip.textContent = text;
        bestTimeInfoTooltip.style.display = 'block';
        const width = bestTimeInfoTooltip.offsetWidth || 0;
        let left = clientX - width / 2;
        left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
        bestTimeInfoTooltip.style.left = left + 'px';
        bestTimeInfoTooltip.style.top = (clientY + 10) + 'px';
      };
      const show = (e)=>{
        const rect = infoEl.getBoundingClientRect();
        const x = (e && typeof e.clientX === 'number') ? e.clientX : (rect.left + rect.width / 2);
        const y = (e && typeof e.clientY === 'number') ? e.clientY : rect.bottom;
        lastPoint = { x, y };
        if (bestTimeInfoTooltip && bestTimeInfoTooltip.style.display === 'block') {
          showAt(x, y);
          return;
        }
        if (showTimer) return;
        showTimer = setTimeout(()=>{
          showTimer = null;
          if (!lastPoint) return;
          showAt(lastPoint.x, lastPoint.y);
        }, 500);
      };
      infoEl.addEventListener('mouseenter', show);
      infoEl.addEventListener('mousemove', show);
      infoEl.addEventListener('mouseleave', hide);
      infoEl.addEventListener('focus', show);
      infoEl.addEventListener('blur', hide);
    }
    function formatBestTime(hour, minute){
      const hour12 = hour % 12 || 12;
      const minuteStr = String(minute).padStart(2, '0');
      const ampm = hour >= 12 ? 'PM' : 'AM';
      return `${hour12}:${minuteStr} ${ampm}`;
    }
    function buildTodayRecommendation(heatmap, totalPostsUsed){
      if (!heatmap || !Array.isArray(heatmap.matrix)) return null;
      if (!heatmap.max || heatmap.max <= 0) return null;
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const now = new Date();
      const day = now.getDay();
      const scores = heatmap.matrix?.[day] || [];
      const candidates = scores
        .map((score, hour)=>({ hour, score }))
        .filter((entry)=> entry.score > 0)
        .sort((a, b)=> (b.score - a.score) || (a.hour - b.hour));
      if (!candidates.length) return null;
      const tzStr = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
      const nowMs = now.getTime();
      const buildForHour = (hour, expectedLift)=>{
        const start = new Date(now);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(now);
        end.setHours(hour + 1, 0, 0, 0);
        if (nowMs >= end.getTime()) return null;
        let recommendMinute = 1;
        let recommendTime = new Date(start);
        recommendTime.setMinutes(recommendMinute, 0, 0);
        if (nowMs > recommendTime.getTime()) {
          const secondMark = new Date(start);
          secondMark.setMinutes(31, 0, 0);
          if (nowMs <= secondMark.getTime()) {
            recommendMinute = 31;
            recommendTime = secondMark;
          } else {
            return null;
          }
        }
        const endHour = (hour + 1) % 24;
        return {
          timeStr: `${formatBestTime(hour, 0)} - ${formatBestTime(endHour, 0)} ${tzStr}`,
          recommendTimeStr: `${formatBestTime(hour, recommendMinute)} ${tzStr}`,
          dayStr: ` on ${dayNames[day]}`,
          postCount: 0,
          totalPostsUsed,
          bestHour: hour,
          bestMinute: recommendMinute,
          bestDayOfWeek: day,
          expectedLift: Number.isFinite(expectedLift) ? expectedLift : null
        };
      };
      let picked = null;
      for (const candidate of candidates){
        const candidateRec = buildForHour(candidate.hour, candidate.score);
        if (candidateRec) { picked = candidateRec; break; }
      }
      if (!picked) {
        const fallback = candidates[0];
        const endHour = (fallback.hour + 1) % 24;
        picked = {
          timeStr: `${formatBestTime(fallback.hour, 0)} - ${formatBestTime(endHour, 0)} ${tzStr}`,
          recommendTimeStr: `${formatBestTime(fallback.hour, 1)} ${tzStr}`,
          dayStr: ` on ${dayNames[day]}`,
          postCount: 0,
          totalPostsUsed,
          bestHour: fallback.hour,
          bestMinute: 1,
          bestDayOfWeek: day,
          expectedLift: Number.isFinite(fallback?.score) ? fallback.score : null
        };
      }
      return picked;
    }
    function pickPreferredTodayRec(data){
      if (!data) return null;
      const today = new Date().getDay();
      if (Number.isFinite(data.primary?.bestDayOfWeek) && data.primary.bestDayOfWeek === today) {
        return data.primary;
      }
      if (Number.isFinite(data.secondary?.bestDayOfWeek) && data.secondary.bestDayOfWeek === today) {
        return data.secondary;
      }
      return null;
    }
    function renderBestTimeWidget(bestTimes, range){
      if (!bestTimes) return;
      const data = bestTimes[range];
      const heroEl = $('.best-time-hero');
      const dayEl = $('#bestTimeDay');
      const timeEl = $('#bestTimeTime');
      const windowEl = $('#bestTimeWindow');
      const countEl = $('#bestTimeCount');
      const liftEl = $('#bestTimeLift');
      const heatmapEl = $('#bestTimeHeatmap');
      const tabWeek = $('#bestTimeTabWeek');
      const tabMonth = $('#bestTimeTabMonth');
      const tabYear = $('#bestTimeTabYear');
      [tabWeek, tabMonth, tabYear].forEach((btn)=>{
        if (!btn) return;
        const id = btn.id === 'bestTimeTabWeek' ? 'week' : (btn.id === 'bestTimeTabMonth' ? 'month' : 'year');
        if (id === range) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      const parseTimeStrings = (timeStr, recommendTimeStr)=>{
        if (!timeStr && !recommendTimeStr) return { primary: '—', window: '—' };
        const primary = recommendTimeStr || timeStr || '—';
        if (timeStr && timeStr.includes(' - ')) {
          return { primary, window: timeStr };
        }
        return { primary, window: timeStr || primary };
      };
      const recLabel = $('#bestTimeRecLabel');
      const recPrimaryBtn = $('#bestTimeRecPrimary');
      const recSecondaryBtn = $('#bestTimeRecSecondary');
      const recTodayBtn = $('#bestTimeRecToday');
      const isSecondary = bestTimeRec === 'secondary';
      const isToday = bestTimeRec === 'today';
      const applyRecUi = ()=>{
        if (recLabel) {
          recLabel.textContent = isSecondary ? 'Next Recommendation' : (isToday ? "Today's Recommendation" : 'Top Recommendation');
        }
        if (recPrimaryBtn) {
          recPrimaryBtn.classList.toggle('active', bestTimeRec === 'primary');
        }
        if (recSecondaryBtn) {
          recSecondaryBtn.classList.toggle('active', isSecondary);
        }
        if (recTodayBtn) {
          recTodayBtn.classList.toggle('active', isToday);
        }
      };
      if (!data) {
        if (heroEl) heroEl.classList.remove('secondary');
        if (dayEl) dayEl.textContent = '—';
        if (timeEl) timeEl.textContent = '—';
        if (windowEl) windowEl.textContent = '—';
        if (countEl) countEl.textContent = '0 posts';
        if (liftEl) liftEl.textContent = '—';
        if (heatmapEl) heatmapEl.innerHTML = '';
        applyRecUi();
        return;
      }
      const preferredTodayRec = bestTimeRec === 'today' ? pickPreferredTodayRec(data) : null;
      const todayRec = bestTimeRec === 'today' ? buildTodayRecommendation(data.heatmap, data.primary?.totalPostsUsed ?? data.secondary?.totalPostsUsed ?? 0) : null;
      const selected = bestTimeRec === 'today'
        ? (todayRec || preferredTodayRec || data.primary)
        : (bestTimeRec === 'secondary' && data.secondary ? data.secondary : data.primary);
      const dayStr = selected?.dayStr ? selected.dayStr.replace(' on ', '') : 'No strong preference';
      const timeParts = parseTimeStrings(selected?.timeStr, selected?.recommendTimeStr);
      if (dayEl) dayEl.textContent = dayStr;
      if (timeEl) timeEl.textContent = timeParts.primary;
      if (windowEl) windowEl.textContent = timeParts.window;
      const totalPosts = selected?.totalPostsUsed ?? selected?.postCount ?? 0;
      const rangeLabel = range === 'week' ? 'this week' : (range === 'year' ? 'this year' : 'this month');
      if (countEl) countEl.textContent = `${(totalPosts || 0).toLocaleString()} posts ${rangeLabel}`;
      let liftText = '—';
      const expectedLift = Number(selected?.expectedLift);
      if (Number.isFinite(expectedLift) && expectedLift > 0) {
        liftText = `${expectedLift.toFixed(2)}x usual likes`;
      }
      if (liftEl) liftEl.textContent = liftText;
      applyRecUi();
      if (heatmapEl) heatmapEl.dataset.todayMode = isToday ? '1' : '0';
      if (heatmapEl && data.heatmap) {
        const dayNamesShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayNamesFull = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const tz = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
        const todayActiveHours = isToday ? new Set() : null;
        if (todayActiveHours) {
          const now = new Date();
          for (let i = 0; i < 24; i++){
            const d = new Date(now.getTime() + i * 60 * 60 * 1000);
            todayActiveHours.add(`${d.getDay()}-${d.getHours()}`);
          }
        }
        const formatRangeShort = (startHour, endHour)=>{
          const normStart = startHour % 24;
          const normEnd = endHour % 24;
          const start12 = normStart % 12 || 12;
          const end12 = normEnd % 12 || 12;
          const startAmpm = normStart >= 12 ? 'PM' : 'AM';
          const endAmpm = normEnd >= 12 ? 'PM' : 'AM';
          if (startAmpm === endAmpm) {
            return `${start12}-${end12}${endAmpm}`;
          }
          return `${start12}${startAmpm}-${end12}${endAmpm}`;
        };
        heatmapEl.innerHTML = '';
        let max = data.heatmap.max || 0;
        let min = isFinite(data.heatmap.min) ? data.heatmap.min : 0;
        const RANGE_FLOOR = 0.12;
        const DEADBAND = 0.03;
        const BASE_ALPHA = 0.16;
        const aboveRange = Math.max(RANGE_FLOOR, max - 1);
        const belowRange = Math.max(RANGE_FLOOR, 1 - min);
        const OVER_ALPHA_MIN = 0.18;
        const OVER_ALPHA_MAX = 0.95;
        const UNDER_ALPHA_MIN = 0.06;
        const UNDER_ALPHA_MAX = 0.36;
        data.heatmap.matrix.forEach((row, dayIdx)=>{
          const rowEl = document.createElement('div');
          rowEl.className = 'best-time-heatmap-row';
          const dayWrap = document.createElement('div');
          dayWrap.className = 'best-time-heatmap-day-wrap';
          const dayEl = document.createElement('div');
          dayEl.className = 'best-time-heatmap-day';
          dayEl.textContent = dayNamesShort[dayIdx];
          if (dayStr.startsWith(dayNamesShort[dayIdx])) dayEl.classList.add('highlight');
          dayWrap.appendChild(dayEl);
          rowEl.appendChild(dayWrap);
          const cells = document.createElement('div');
          cells.className = 'best-time-heatmap-cells';
          row.forEach((v, colIdx)=>{
            const cell = document.createElement('div');
            cell.className = 'best-time-heatmap-cell';
            let isTodayActive = true;
            if (todayActiveHours) {
              const key = `${dayIdx}-${colIdx}`;
              isTodayActive = todayActiveHours.has(key);
              cell.classList.add(isTodayActive ? 'today-active' : 'today-inactive');
            }
            const startHour = colIdx;
            const endHour = startHour + 1;
            const lift = Number(v) || 0;
            const hasCounts = Array.isArray(data.heatmap.counts);
            const hasAvgLikes = Array.isArray(data.heatmap.avgLikes);
            const count = Number(data.heatmap.counts?.[dayIdx]?.[colIdx]) || 0;
            const avgLikes = Number(data.heatmap.avgLikes?.[dayIdx]?.[colIdx]) || 0;
            const timeStr = formatRangeShort(startHour, endHour);
            const tooltip = lift > 0
              ? (hasCounts || hasAvgLikes
                ? `${hasCounts ? fmt0(count) : '—'} posts avg ${hasAvgLikes ? fmt0(avgLikes) : '—'} likes on ${dayNamesShort[dayIdx]} ${timeStr} ${tz}`
                : `${dayNamesShort[dayIdx]} ${timeStr} ${tz}`)
              : `${dayNamesShort[dayIdx]} ${timeStr} ${tz} has no data`;
            if (!isToday || isTodayActive) {
              cell.dataset.tooltip = tooltip;
              cell.setAttribute('aria-label', tooltip);
            } else {
              cell.dataset.tooltip = '';
              cell.setAttribute('aria-label', '');
            }
            if (!isToday || isTodayActive) {
              if (lift > 0) {
                cell.style.background = `rgba(var(--heatmap-accent-rgb), ${BASE_ALPHA.toFixed(3)})`;
              }
              const delta = lift - 1;
              if (Math.abs(delta) > DEADBAND) {
                if (delta > 0 && aboveRange > 0) {
                  const pct = Math.max(0, Math.min(1, delta / aboveRange));
                  const alpha = OVER_ALPHA_MIN + pct * (OVER_ALPHA_MAX - OVER_ALPHA_MIN);
                  cell.style.background = `rgba(var(--heatmap-accent-rgb), ${alpha.toFixed(3)})`;
                } else if (delta < 0 && belowRange > 0) {
                  const pct = Math.max(0, Math.min(1, (-delta) / belowRange));
                  const alpha = UNDER_ALPHA_MIN + pct * (UNDER_ALPHA_MAX - UNDER_ALPHA_MIN);
                  cell.style.background = `rgba(var(--heatmap-under-rgb), ${alpha.toFixed(3)})`;
                }
              }
            }
            cells.appendChild(cell);
          });
          rowEl.appendChild(cells);
          heatmapEl.appendChild(rowEl);
        });
        bindBestTimeHeatmapTooltip(heatmapEl);
      }
    }
    function updateBestTimeToPostSection(){
      if (isMetricsPartial) {
        if (bestTimeData) renderBestTimeWidget(bestTimeData, bestTimeRange);
        return;
      }
      if (bestTimeData) renderBestTimeWidget(bestTimeData, bestTimeRange);
      const now = Date.now();
      const metricsChanged = !!(lastMetricsUpdatedAt && lastMetricsUpdatedAt !== lastBestTimeMetricsUpdatedAt);
      const shouldRefresh = metricsChanged || !bestTimeData || !lastBestTimeUpdate || now - lastBestTimeUpdate >= 60000;
      if (!shouldRefresh) return;
      scheduleBestTimeRefresh();
    }
    function initBestTimeTabs(){
      const weekBtn = $('#bestTimeTabWeek');
      const monthBtn = $('#bestTimeTabMonth');
      const yearBtn = $('#bestTimeTabYear');
      if (weekBtn) weekBtn.addEventListener('click', ()=>{
        bestTimeRange = 'week';
        saveBestTimePrefs();
        renderBestTimeWidget(bestTimeData, bestTimeRange);
      });
      if (monthBtn) monthBtn.addEventListener('click', ()=>{
        bestTimeRange = 'month';
        saveBestTimePrefs();
        renderBestTimeWidget(bestTimeData, bestTimeRange);
      });
      if (yearBtn) yearBtn.addEventListener('click', ()=>{
        bestTimeRange = 'year';
        saveBestTimePrefs();
        renderBestTimeWidget(bestTimeData, bestTimeRange);
      });
      const recPrimaryBtn = $('#bestTimeRecPrimary');
      const recSecondaryBtn = $('#bestTimeRecSecondary');
      const recTodayBtn = $('#bestTimeRecToday');
      if (recPrimaryBtn) recPrimaryBtn.addEventListener('click', ()=>{
        bestTimeRec = 'primary';
        saveBestTimePrefs();
        renderBestTimeWidget(bestTimeData, bestTimeRange);
      });
      if (recSecondaryBtn) recSecondaryBtn.addEventListener('click', ()=>{
        bestTimeRec = 'secondary';
        saveBestTimePrefs();
        renderBestTimeWidget(bestTimeData, bestTimeRange);
      });
      if (recTodayBtn) recTodayBtn.addEventListener('click', ()=>{
        bestTimeRec = 'today';
        saveBestTimePrefs();
        renderBestTimeWidget(bestTimeData, bestTimeRange);
      });
    }

    // Function to update first 24 hours chart
    function updateFirst24HoursChart(minMinutes, maxMinutes){
      const user = resolveUserForKey(metrics, currentUserKey);
      if (!user) return false;
      const colorFor = makeColorMap(user);
      const isVirtual = isVirtualUser(user);
      const useUnique = viewsChartType === 'unique';
      let hasPoints = false;
      const f24Series = (function(){
        const out=[]; for (const [pid,p] of Object.entries(user.posts||{})){
          if (!visibleSet.has(pid)) continue;
          const postTime = getPostTimeStrict(p) || getPostTimeForRecency(p);
          if (!postTime) continue; // Skip posts without any time reference
          const pts=[]; for (const s of (p.snapshots||[])){ 
            const t=s.t; 
            const v=useUnique ? s.uv : s.views; 
            if (t!=null && v!=null) pts.push({ x:Number(t), y:Number(v), t:Number(t) }); 
          }
          if (!hasPoints && pts.length) {
            hasPoints = pts.some((pt)=>{
              const minutesSinceCreation = (pt.t - postTime) / (60 * 1000);
              return minutesSinceCreation >= minMinutes && minutesSinceCreation <= maxMinutes;
            });
          }
          const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
          const color=colorFor(pid); const label = buildPostLabel({ ...p, id: pid }, owner);
          // Include all posts with post_time, even if they have no snapshots or no snapshots in the time window
          out.push({ id: pid, label, color, points: pts, url: absUrl(p.url, pid), postTime: postTime }); }
        return out; })();
      const yAxisLabel = useUnique ? 'Viewers' : 'Total Views';
      first24HoursChart.setData(f24Series, minMinutes, maxMinutes);
      // Update chart label by recreating it with new label
      const canvas = $('#first24HoursChart');
      if (canvas) {
        // The chart function doesn't expose a way to change the label, so we need to update it internally
        // For now, we'll just update the data and the chart will use the label from when it was created
        // We'll need to recreate the chart or modify makeFirst24HoursChart to accept label updates
      }
      return hasPoints;
    }

    function updateViewsPerPersonChart(minMinutes, maxMinutes){
      const user = resolveUserForKey(metrics, currentUserKey);
      if (!user) return false;
      const colorFor = makeColorMap(user);
      const isVirtual = isVirtualUser(user);
      let hasPoints = false;
      const vppSeries = (function(){
        const out=[]; for (const [pid,p] of Object.entries(user.posts||{})){
          if (!visibleSet.has(pid)) continue;
          const postTime = getPostTimeStrict(p) || getPostTimeForRecency(p);
          if (!postTime) continue; // Skip posts without any time reference
          const pts=[]; for (const s of (p.snapshots||[])){ 
            const t=s.t; 
            const totalViews = num(s.views);
            const uniqueViews = num(s.uv);
            // Only include if we have both values and unique views > 0
            if (t!=null && totalViews!=null && uniqueViews!=null && uniqueViews > 0) {
              const vpp = Number((totalViews / uniqueViews).toFixed(2));
              pts.push({ x:Number(t), y:vpp, t:Number(t) }); 
            }
          }
          if (!hasPoints && pts.length) {
            hasPoints = pts.some((pt)=>{
              const minutesSinceCreation = (pt.t - postTime) / (60 * 1000);
              return minutesSinceCreation >= minMinutes && minutesSinceCreation <= maxMinutes;
            });
          }
          const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
          const color=colorFor(pid); const label = buildPostLabel({ ...p, id: pid }, owner);
          // Include all posts with post_time, even if they have no snapshots or no snapshots in the time window
          out.push({ id: pid, label, color, points: pts, url: absUrl(p.url, pid), postTime: postTime }); }
        return out; })();
      viewsPerPersonChart.setData(vppSeries, minMinutes, maxMinutes);
      return hasPoints;
    }

    function updateViewsPerPersonTimeChart(){
      const user = resolveUserForKey(metrics, currentUserKey);
      if (!user) return;
      const colorFor = makeColorMap(user);
      const isVirtual = isVirtualUser(user);
      const vppSeries = (function(){
        const out=[]; for (const [pid,p] of Object.entries(user.posts||{})){
          if (!visibleSet.has(pid)) continue;
          const pts=[]; for (const s of (p.snapshots||[])){
            const t=s.t;
            const totalViews = num(s.views);
            const uniqueViews = num(s.uv);
            if (t!=null && totalViews!=null && uniqueViews!=null && uniqueViews > 0) {
              const vpp = Number((totalViews / uniqueViews).toFixed(2));
              pts.push({ x:Number(t), y:vpp, t:Number(t) });
            }
          }
          if (!pts.length) continue;
          const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
          const color = colorFor(pid);
          const label = buildPostLabel({ ...p, id: pid }, owner);
          out.push({ id: pid, label, color, points: pts, url: absUrl(p.url, pid) });
        }
        return out;
      })();
      viewsPerPersonTimeChart.setData(vppSeries);
    }

    function updateInteractionRateStackedChart(minMinutes, maxMinutes){
      const user = resolveUserForKey(metrics, currentUserKey);
      if (!user) return false;
      const colorFor = makeColorMap(user);
      const isVirtual = isVirtualUser(user);
      let hasPoints = false;
      const stackedSeries = (function(){
        const out=[]; for (const [pid,p] of Object.entries(user.posts||{})){
          if (!visibleSet.has(pid)) continue;
          const postTime = getPostTimeStrict(p) || getPostTimeForRecency(p);
          if (!postTime) continue;
          const pts=[]; for (const s of (p.snapshots||[])){
            const t=s.t;
            const rate = interactionRate(s);
            if (t!=null && rate!=null) pts.push({ x:Number(t), y:Number(rate), t:Number(t) });
          }
          if (!hasPoints && pts.length) {
            hasPoints = pts.some((pt)=>{
              const minutesSinceCreation = (pt.t - postTime) / (60 * 1000);
              return minutesSinceCreation >= minMinutes && minutesSinceCreation <= maxMinutes;
            });
          }
          const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
          const color=colorFor(pid);
          const label = buildPostLabel({ ...p, id: pid }, owner);
          out.push({ id: pid, label, color, points: pts, url: absUrl(p.url, pid), postTime: postTime });
        }
        return out;
      })();
      interactionRateStackedChart.setData(stackedSeries, minMinutes, maxMinutes);
      return hasPoints;
    }

    function updateStaleButtonCount(user){
      const staleBtn = $('#stale');
      if (!staleBtn) return;
      if (!user) {
        staleBtn.style.display = 'none';
        return;
      }
      const now = Date.now();
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
      const count = Object.entries(user.posts||{}).reduce((acc, [,p])=>{
        const lastRefresh = lastRefreshMsForPost(p);
        const ageMs = lastRefresh ? now - lastRefresh : Infinity;
        return acc + (ageMs > TWENTY_FOUR_HOURS_MS ? 1 : 0);
      }, 0);
      staleBtn.textContent = `Stale (${count})`;
      staleBtn.style.display = count > 0 ? '' : 'none';
    }

    function hydrateCurrentUserPostsFromStorage(){
      if (!currentUserKey || isVirtualUserKey(currentUserKey)) return;
      const hydrateKey = currentUserKey;
      const hydrateToken = ++postHydrationToken;
      const currentUser = resolveUserForKey(metrics, hydrateKey);
      snapLog('hydrateCurrentUserPosts:start', {
        hydrateKey,
        hydrateToken,
        snapshotsHydrated,
        beforeSummary: summarizeUserSnapshots(currentUser)
      });
      setPostsHydrateState(true);
      const chunkSize = 200;
      const chunkBudgetMs = 14;
      const uiThrottleMs = 450;
      let lastUiAt = 0;
      let entries = null;
      let storedUser = null;
      let targetUser = null;
      let idx = 0;
      let postCount = 0;
      let queuedRefreshOpts = null;
      let refreshScheduled = false;
      let refreshInFlight = false;

      const scheduleQueuedRefresh = () => {
        if (refreshScheduled || refreshInFlight || !queuedRefreshOpts) return;
        refreshScheduled = true;
        setTimeout(() => {
          refreshScheduled = false;
          if (postHydrationToken !== hydrateToken || currentUserKey !== hydrateKey) {
            queuedRefreshOpts = null;
            return;
          }
          const opts = queuedRefreshOpts;
          queuedRefreshOpts = null;
          if (!opts) return;
          refreshInFlight = true;
          Promise.resolve(refreshUserUI(opts))
            .catch(() => {})
            .finally(() => {
              refreshInFlight = false;
              scheduleQueuedRefresh();
            });
        }, 0);
      };
      const queueRefresh = (opts) => {
        queuedRefreshOpts = opts;
        scheduleQueuedRefresh();
      };

      const tick = () => {
        if (postHydrationToken !== hydrateToken) return;
        if (!entries || !targetUser || currentUserKey !== hydrateKey) return;
        const posts = targetUser.posts || (targetUser.posts = {});
        const start = performance.now();
        let processed = 0;
        while (idx < entries.length) {
          const [pid, post] = entries[idx++];
          if (!Object.prototype.hasOwnProperty.call(posts, pid)) postCount++;
          posts[pid] = post;
          processed++;
          if (processed >= chunkSize || (performance.now() - start) >= chunkBudgetMs) break;
        }
        const now = performance.now();
        if (processed && (now - lastUiAt >= uiThrottleMs || idx >= entries.length)) {
          syncUserOptionCount(hydrateKey, postCount);
          queueRefresh({ preserveEmpty: true, skipRestoreZoom: true, autoRefresh: true, skipCharts: true, skipPostListRebuild: true });
          lastUiAt = now;
        }
        if (idx < entries.length) {
          setTimeout(tick, 0);
        } else {
          if (Array.isArray(storedUser.followers)) targetUser.followers = storedUser.followers;
          if (Array.isArray(storedUser.cameos)) targetUser.cameos = storedUser.cameos;
          syncUserOptionCount(hydrateKey, postCount);
          setPostsHydrateState(false);
          snapLog('hydrateCurrentUserPosts:done', {
            hydrateKey,
            hydrateToken,
            postCount,
            afterSummary: summarizeUserSnapshots(targetUser)
          });
          queueRefresh({ preserveEmpty: true, skipRestoreZoom: true, autoRefresh: true });
        }
      };

      setTimeout(async () => {
        if (postHydrationToken !== hydrateToken || currentUserKey !== hydrateKey) return;
        try {
          const { metrics: storedMetrics } = await chrome.storage.local.get('metrics');
          storedUser = storedMetrics?.users?.[hydrateKey] || null;
          if (!storedUser && typeof hydrateKey === 'string' && hydrateKey.startsWith('h:')) {
            storedUser = findUserByHandle(storedMetrics, hydrateKey.slice(2));
          } else if (!storedUser && typeof hydrateKey === 'string' && hydrateKey.startsWith('id:')) {
            storedUser = findUserById(storedMetrics, hydrateKey.slice(3));
          }
          targetUser = resolveUserForKey(metrics, hydrateKey);
          const storedPosts = storedUser?.posts;
          if (!storedPosts || !targetUser) {
            setPostsHydrateState(false);
            snapLog('hydrateCurrentUserPosts:skip', {
              hydrateKey,
              hydrateToken,
              reason: 'missing_user_or_posts',
              hasStoredUser: !!storedUser,
              hasTargetUser: !!targetUser
            });
            return;
          }
          postCount = Object.keys(targetUser.posts || {}).length;
          entries = Object.entries(storedPosts);
          if (!entries.length) {
            setPostsHydrateState(false);
            snapLog('hydrateCurrentUserPosts:skip', {
              hydrateKey,
              hydrateToken,
              reason: 'no_stored_posts'
            });
            return;
          }
          // We are about to overwrite in-memory posts with hot storage rows (latest-only).
          // Force a cold-shard re-hydrate on the next full UI refresh.
          invalidateSnapshotHydration('hydrateCurrentUserPosts:overwriteFromHotStorage', {
            hydrateKey,
            hydrateToken,
            storedPostCount: entries.length
          });
          snapLog('hydrateCurrentUserPosts:overwriteFromHotStorage', {
            hydrateKey,
            hydrateToken,
            storedPostCount: entries.length,
            snapshotsHydrated
          });
          tick();
        } catch (err) {
          snapLog('hydrateCurrentUserPosts:failed', {
            hydrateKey,
            hydrateToken,
            message: String(err?.message || err || 'unknown')
          });
        }
      }, 0);
    }

    function hydrateMetricsFromStorageInChunks(){
      if (!isMetricsPartial || isHydratingMetrics) return Promise.resolve(false);
      const hydrateToken = ++metricsHydrationToken;
      snapLog('hydrateMetrics:start', {
        hydrateToken,
        isMetricsPartial,
        snapshotsHydrated,
        beforeSummary: summarizeMetricsSnapshots(metrics)
      });
      setMetricsHydrateState(true);
      const chunkSize = 60;
      const chunkBudgetMs = 14;
      const uiThrottleMs = 600;
      let lastUiAt = 0;

      return new Promise((resolve) => {
        setTimeout(async () => {
          if (metricsHydrationToken !== hydrateToken || !isMetricsPartial) {
            setMetricsHydrateState(false);
            resolve(false);
            return;
          }
          try {
            const stored = await chrome.storage.local.get(['metrics', 'metricsUpdatedAt', USERS_INDEX_STORAGE_KEY]);
            if (metricsHydrationToken !== hydrateToken || !isMetricsPartial) {
              setMetricsHydrateState(false);
              resolve(false);
              return;
            }
            const storedMetrics = stored.metrics || { users: {} };
            const entries = Object.entries(storedMetrics.users || {});
            if (!entries.length) {
              setMetricsHydrateState(false);
              snapLog('hydrateMetrics:skip', { hydrateToken, reason: 'no_stored_users' });
              resolve(false);
              return;
            }
            // Chunk hydration replaces in-memory users from hot storage; ensure cold snapshots
            // are merged again once hydration completes.
            snapLog('hydrateMetrics:overwriteFromHotStorage', {
              hydrateToken,
              storedUserCount: entries.length,
              storedSummary: summarizeMetricsSnapshots(storedMetrics),
              snapshotsHydrated
            });
            const storedIndex = normalizeUsersIndex(stored[USERS_INDEX_STORAGE_KEY]);
            if ((!Array.isArray(usersIndex) || !usersIndex.length) && storedIndex?.length) {
              usersIndex = storedIndex;
              const def = buildUserOptions(metrics);
              if (!currentUserKey && def) currentUserKey = def;
              syncUserSelectionUI();
            }
            const targetUsers = metrics.users || (metrics.users = {});
            let idx = 0;
            const tick = async () => {
              if (metricsHydrationToken !== hydrateToken || !isMetricsPartial) {
                setMetricsHydrateState(false);
                resolve(false);
                return;
              }
              const start = performance.now();
              let processed = 0;
              while (idx < entries.length) {
                const [userKey, user] = entries[idx++];
                targetUsers[userKey] = user;
                processed++;
                if (processed >= chunkSize || (performance.now() - start) >= chunkBudgetMs) break;
              }
              const now = performance.now();
              if (processed && (now - lastUiAt >= uiThrottleMs || idx >= entries.length)) {
                syncUserOptionCounts();
                lastUiAt = now;
              }
              if (idx < entries.length) {
                setTimeout(tick, 0);
              } else {
                if (stored.metricsUpdatedAt != null) {
                  const next = Number(stored.metricsUpdatedAt);
                  if (Number.isFinite(next)) lastMetricsUpdatedAt = next;
                }
                metrics.users = storedMetrics.users;
                invalidateSnapshotHydration('hydrateMetrics:chunkingDoneReplaceUsers', {
                  hydrateToken,
                  storedUserCount: Object.keys(storedMetrics.users || {}).length
                });
                usersIndex = storedIndex && storedIndex.length ? storedIndex : buildUsersIndexFromMetrics(metrics);
                isMetricsPartial = false;
                snapLog('hydrateMetrics:chunkingDone', {
                  hydrateToken,
                  summaryAfterReplace: summarizeMetricsSnapshots(metrics),
                  currentUserKey
                });
                syncUserSelectHydrateIndicator();
                syncUserSelectionUI();
                syncUserOptionCounts();
                await refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true, autoRefresh: true });
                saveSessionCache();
                setMetricsHydrateState(false);
                snapLog('hydrateMetrics:done', {
                  hydrateToken,
                  snapshotsHydrated,
                  finalSummary: summarizeMetricsSnapshots(metrics)
                });
                resolve(true);
              }
            };
            tick();
          } catch (err) {
            setMetricsHydrateState(false);
            snapLog('hydrateMetrics:failed', {
              hydrateToken,
              message: String(err?.message || err || 'unknown')
            });
            resolve(false);
          }
        }, 0);
      });
    }

    async function refreshUserUI(opts={}){
      const perfUI = perfStart('refreshUserUI total');
      try {
        const { preserveEmpty=false, skipRestoreZoom=false, skipPostListRebuild=false, autoRefresh=false, skipCharts=false } = opts;
        const user = resolveUserForKey(metrics, currentUserKey);
        snapLog('refreshUserUI:start', {
          currentUserKey,
          preserveEmpty,
          skipRestoreZoom,
          skipPostListRebuild,
          autoRefresh,
          skipCharts,
          snapshotsHydrated,
          isMetricsPartial,
          userSummary: summarizeUserSnapshots(user)
        });
        if (!user){
          snapLog('refreshUserUI:noUser', { currentUserKey, snapshotsHydrated, isMetricsPartial });
          updateMetricsHeader(currentUserKey, null);
          updateMetricsGatherNote(currentUserKey, null);
          setListActionActive('showAll');
          currentVisibilitySource = 'showAll';
          buildPostsList(null, ()=>getPaletteColor(0), new Set());
          chart.setData([]);
          interactionRateStackedChart.setData([]);
          viewsChart.setData([]);
          first24HoursChart.setData([]);
          viewsPerPersonChart.setData([]);
          viewsPerPersonTimeChart.setData([]);
          return;
        }
        // No precompute needed for IR; use latest available remix count only for cards
        // Integrity check: remove posts incorrectly attributed to this user
        // Reconcile ownership (selected user only), then reclaim, then remove empty posts
        if (!isVirtualUserKey(currentUserKey) && !isMetricsPartial){
          const now = Date.now();
          const lastPruneAt = lastPruneAtByUser.get(currentUserKey) || 0;
          const shouldPrune = !autoRefresh || (now - lastPruneAt >= PRUNE_THROTTLE_MS);
          if (shouldPrune) {
            lastPruneAtByUser.set(currentUserKey, now);
            const perfPrune = perfStart('prune posts');
            try {
              await pruneMismatchedPostsForUser(metrics, currentUserKey, { log: !autoRefresh });
              await reclaimFromUnknownForUser(metrics, currentUserKey);
              await pruneEmptyPostsForUser(metrics, currentUserKey);
            } finally {
              perfEnd(perfPrune);
            }
          }
        }
        const colorFor = makeColorMap(user);
        const isTopToday = isTopTodayKey(currentUserKey);
        updateMetricsHeader(currentUserKey, user);
        updateMetricsGatherNote(currentUserKey, user);
        if (!normalizeFilterAction(currentVisibilitySource)) {
          const sessionAction = getSessionFilterAction();
          currentVisibilitySource = sessionAction;
          currentListActionId = (sessionAction === 'showAll' || sessionAction === 'hideAll' || isPresetVisibilitySource(sessionAction)) ? sessionAction : null;
        }
        if (currentVisibilitySource === 'showAll' || currentVisibilitySource === 'hideAll' || isPresetVisibilitySource(currentVisibilitySource)) {
          currentListActionId = currentVisibilitySource;
        } else if (currentVisibilitySource === 'custom' || isCustomFilterAction(currentVisibilitySource)) {
          currentListActionId = 'custom';
        }
        if (visibleSet.size) {
          for (const pid of Array.from(visibleSet)) {
            if (!Object.prototype.hasOwnProperty.call(user.posts || {}, pid)) {
              visibleSet.delete(pid);
            }
          }
        }
        if (autoRefresh) {
          if (isCustomFilterAction(currentVisibilitySource)) {
            const filterId = getCustomFilterId(currentVisibilitySource);
            const f = filterId ? getCustomFiltersForUser(currentUserKey).find(it=>it.id === filterId) : null;
            if (f) {
              visibleSet.clear();
              (f.ids || []).forEach(pid=>{
                if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
              });
            }
          } else if (currentVisibilitySource === 'custom') {
            const customEntry = getCustomVisibilityEntry(currentUserKey);
            const ids = Array.isArray(customEntry?.ids) ? customEntry.ids : [];
            if (ids.length) {
              visibleSet.clear();
              ids.forEach(pid=>{
                if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
              });
            }
          }
        }
        if (!preserveEmpty && visibleSet.size === 0) {
          if (currentVisibilitySource === 'showAll') {
            visibleSet.clear();
            Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
          } else if (isPresetVisibilitySource(currentVisibilitySource)) {
            const nextSet = computeVisibleSetForAction(user, currentVisibilitySource);
            if (nextSet) {
              visibleSet.clear();
              for (const pid of nextSet) visibleSet.add(pid);
            }
          } else if (currentVisibilitySource === 'custom') {
            const customEntry = getCustomVisibilityEntry(currentUserKey);
            const ids = Array.isArray(customEntry?.ids) ? customEntry.ids : [];
            if (ids.length) {
              visibleSet.clear();
              ids.forEach(pid=>{
                if (pid && Object.prototype.hasOwnProperty.call(user.posts||{}, pid)) visibleSet.add(pid);
              });
            }
          }
        }

        // Top Today is a dynamic, virtual user: keep selections, but reconcile against the live post set.
        if (isTopToday){
          const allPids = Object.keys(user.posts||{});
          const valid = new Set(allPids);
          for (const pid of Array.from(visibleSet)){
            if (!valid.has(pid)) visibleSet.delete(pid);
          }
          if (visibleSet.size === 0 && !preserveEmpty){
            visibleSet.clear();
            allPids.forEach(pid=>visibleSet.add(pid));
            setListActionActive('showAll');
            currentVisibilitySource = 'showAll';
          }
        } else if (visibleSet.size === 0 && !preserveEmpty && currentVisibilitySource === 'showAll'){
          visibleSet.clear();
          Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
          setListActionActive('showAll');
          currentVisibilitySource = 'showAll';
          persistVisibility();
        }
        const uiActionId = currentListActionId || currentVisibilitySource;
        const isValidAction = uiActionId === 'showAll' || uiActionId === 'hideAll' || uiActionId === 'custom' || isPresetVisibilitySource(uiActionId) || isCustomFilterAction(uiActionId);
        if (isValidAction) {
          setListActionActive(isCustomFilterAction(uiActionId) ? 'custom' : uiActionId);
        } else {
          currentVisibilitySource = 'showAll';
          currentListActionId = 'showAll';
          visibleSet.clear();
          Object.keys(user.posts||{}).forEach(pid=>visibleSet.add(pid));
          setListActionActive('showAll');
          persistVisibility();
        }
        updateCustomButtonLabel(currentUserKey);
        const visibilityActionId = currentListActionId || currentVisibilitySource;
        const listActionId = (function(){
          if (currentListActionId === 'showAll' || currentListActionId === 'hideAll' || currentListActionId === 'custom') return currentListActionId;
          if (isPresetVisibilitySource(currentListActionId)) return currentListActionId;
          if (currentVisibilitySource === 'showAll' || currentVisibilitySource === 'hideAll') return currentVisibilitySource;
          if (isPresetVisibilitySource(currentVisibilitySource)) return currentVisibilitySource;
          if (currentVisibilitySource === 'custom') return 'custom';
          return null;
        })();
        if (autoRefresh && !(currentVisibilitySource === 'custom' || isCustomFilterAction(currentVisibilitySource))) {
          const nextSet = computeVisibleSetForAction(user, visibilityActionId);
          if (nextSet) {
            visibleSet.clear();
            for (const pid of nextSet) visibleSet.add(pid);
          }
        }
        const listOpts = {
          activeActionId: listActionId,
          onHover: (pid)=> {
            chart.setHoverSeries(pid);
            interactionRateStackedChart.setHoverSeries(pid);
            viewsChart.setHoverSeries(pid);
            first24HoursChart.setHoverSeries(pid);
            viewsPerPersonChart.setHoverSeries(pid);
            viewsPerPersonTimeChart.setHoverSeries(pid);
          },
          onPurge: (pid, snippet) => showPostPurgeConfirm(snippet, pid)
        };
        const perfList = perfStart('render posts list');
        try {
          if (skipPostListRebuild && updatePostsListRows(user, colorFor, visibleSet, listOpts)) {
            // keep existing list to avoid flicker
          } else {
            buildPostsList(user, colorFor, visibleSet, listOpts);
          }
        } finally {
          perfEnd(perfList);
        }
        updateStaleButtonCount(user);
        if (!skipCharts) {
          snapLog('refreshUserUI:ensureFullSnapshots:before', {
            currentUserKey,
            snapshotsHydrated,
            userSummary: summarizeUserSnapshots(user)
          });
          await ensureFullSnapshots();
          snapLog('refreshUserUI:ensureFullSnapshots:after', {
            currentUserKey,
            snapshotsHydrated,
            userSummary: summarizeUserSnapshots(user)
          });
          const perfCharts = perfStart('charts + summaries');
          try {
            const useUnique = viewsChartType === 'unique';
            const isVirtual = isVirtualUser(user);
            clampStackedSliderToData({
              minId: '#interactionRateSliderMin',
              maxId: '#interactionRateSliderMax',
              trackId: '#interactionRateSliderTrack',
              labelId: '#interactionRateSliderValue',
              minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
              maxKey: STACKED_WINDOW_STORAGE_KEYS.interaction,
              getMaxMinutes: () => computeStackedMaxMinutes(user, visibleSet, (s)=> {
                const t = s.t;
                const rate = interactionRate(s);
                return t != null && rate != null;
              })
            });
            clampStackedSliderToData({
              minId: '#first24HoursSliderMin',
              maxId: '#first24HoursSliderMax',
              trackId: '#first24HoursSliderTrack',
              labelId: '#first24HoursSliderValue',
              minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.views,
              maxKey: STACKED_WINDOW_STORAGE_KEYS.views,
              getMaxMinutes: () => computeStackedMaxMinutes(user, visibleSet, (s)=> {
                const t = s.t;
                const v = useUnique ? s.uv : s.views;
                return t != null && v != null;
              })
            });
            clampStackedSliderToData({
              minId: '#viewsPerPersonSliderMin',
              maxId: '#viewsPerPersonSliderMax',
              trackId: '#viewsPerPersonSliderTrack',
              labelId: '#viewsPerPersonSliderValue',
              minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
              maxKey: STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson,
              getMaxMinutes: () => computeStackedMaxMinutes(user, visibleSet, (s)=> {
                const t = s.t;
                const totalViews = num(s.views);
                const uniqueViews = num(s.uv);
                return t != null && totalViews != null && uniqueViews != null && uniqueViews > 0;
              })
            });
            const series = computeSeriesForUser(user, [], colorFor, useUnique)
              .filter(s=>visibleSet.has(s.id))
              .map(s=>({ ...s, url: absUrl(user.posts?.[s.id]?.url, s.id) }));
            chart.setData(series);
            {
              const range = getStackedRangeFromInputs('#interactionRateSliderMin', '#interactionRateSliderMax');
              updateInteractionRateStackedChart(range.min, range.max);
            }
            // Time chart: cumulative views by time
            const vSeries = (function(){
              const out=[]; for (const [pid,p] of Object.entries(user.posts||{})){
                if (!visibleSet.has(pid)) continue; 
                const pts=[]; 
                for (const s of (p.snapshots||[])){ 
                  const t=s.t; 
                  const v=useUnique ? s.uv : s.views; 
                  if (t!=null && v!=null) pts.push({ x:Number(t), y:Number(v), t:Number(t) }); 
                }
                const color=colorFor(pid); 
                const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
                const label = buildPostLabel({ ...p, id: pid }, owner); 
                if (pts.length) out.push({ id: pid, label, color, points: pts, url: absUrl(p.url, pid) }); 
              }
              return out; })();
            viewsChart.setData(vSeries);
            // Views Per Person time chart: ratio over absolute time
            updateViewsPerPersonTimeChart();
            // Views Per Person chart: total views / unique views over time since post creation
            {
              const range = getStackedRangeFromInputs('#viewsPerPersonSliderMin', '#viewsPerPersonSliderMax');
              updateViewsPerPersonChart(range.min, range.max);
            }
            // First 24 hours chart: views over time since post creation
            {
              const range = getStackedRangeFromInputs('#first24HoursSliderMin', '#first24HoursSliderMax');
              updateFirst24HoursChart(range.min, range.max);
            }
            // Only update compare charts if no compare users are selected
            if (compareUsers.size === 0){
              // Update unfiltered totals cards for single user
              try {
                const t = computeTotalsForUser(user);
                const allTotalViewsEl = $('#allTotalViewsTotal'); if (allTotalViewsEl) allTotalViewsEl.textContent = fmt2(t.views);
                const allUniqueViewsEl = $('#allUniqueViewsTotal'); if (allUniqueViewsEl) allUniqueViewsEl.textContent = fmt2(t.uniqueViews);
                const allLikesEl = $('#allLikesTotal'); if (allLikesEl) allLikesEl.textContent = fmt2(t.likes);
                const allRepliesEl = $('#allRepliesTotal'); if (allRepliesEl) allRepliesEl.textContent = fmtK2OrInt(t.replies);
                const allRemixesEl = $('#allRemixesTotal'); if (allRemixesEl) allRemixesEl.textContent = fmt2(t.remixes);
                const allInterEl = $('#allInteractionsTotal'); if (allInterEl) allInterEl.textContent = fmt2(t.interactions);
                const allCameosEl = $('#allCameosTotal');
                if (allCameosEl) {
                  const arr = Array.isArray(user.cameos) ? user.cameos : [];
                  const last = arr[arr.length - 1];
                  allCameosEl.textContent = last ? fmtK2OrInt(last.count) : '0';
                }
                const followersEl = $('#followersTotal');
                if (followersEl){
                  const arr = getFollowersSeriesForUser(currentUserKey, user);
                  const last = arr[arr.length - 1];
                  followersEl.textContent = last ? fmtK2OrInt(last.count) : '0';
                }
              } catch {}
              // All posts cumulative likes (unfiltered): aggregate across all posts
              try {
                const ptsLikes = (function(){
                  const events = [];
                  for (const [pid, p] of Object.entries(user.posts||{})){
                    for (const s of (p.snapshots||[])){
                      const t = Number(s.t), v = Number(s.likes);
                      if (isFinite(t) && isFinite(v)) events.push({ t, v, pid });
                    }
                  }
                  events.sort((a,b)=> a.t - b.t);
                  const latest = new Map();
                  let total = 0;
                  const out = [];
                  for (const e of events){
                    const prev = latest.get(e.pid) || 0;
                    if (e.v !== prev){
                      latest.set(e.pid, e.v);
                      total += (e.v - prev);
                      out.push({ x: e.t, y: total, t: e.t });
                    }
                  }
                  return out;
                })();
                const colorLikes = '#ff8a7a';
                const seriesLikes = ptsLikes.length ? [{ id: 'all_posts_likes', label: 'Likes', color: colorLikes, points: ptsLikes }] : [];
                allLikesChart.setData(seriesLikes);
              } catch {}
              // All posts cumulative views (unfiltered): aggregate across all posts
              try {
                const useUnique = compareViewsChartType === 'unique';
                const pts = (function(){
                  const events = [];
                  for (const [pid, p] of Object.entries(user.posts||{})){
                    for (const s of (p.snapshots||[])){
                      const t = Number(s.t);
                      const v = useUnique ? Number(s.uv) : Number(s.views);
                      if (isFinite(t) && isFinite(v)) events.push({ t, v, pid });
                    }
                  }
                  events.sort((a,b)=> a.t - b.t);
                  const latest = new Map();
                  let total = 0;
                  const out = [];
                  for (const e of events){
                    const prev = latest.get(e.pid) || 0;
                    if (e.v !== prev){
                      latest.set(e.pid, e.v);
                      total += (e.v - prev);
                      out.push({ x: e.t, y: total, t: e.t });
                    }
                  }
                  return out;
                })();
                const color = '#7dc4ff';
                const label = useUnique ? 'Viewers' : 'Total Views';
                const series = pts.length ? [{ id: 'all_posts', label, color, points: pts }] : [];
                const yAxisLabel = useUnique ? 'Viewers' : 'Total Views';
                allViewsChart.setYAxisLabel(yAxisLabel);
                allViewsChart.setData(series);
              } catch {}
              // Cast in chart: use user-level cast in count history when available
              const cSeries = (function(){
                const arr = Array.isArray(user.cameos) ? user.cameos : [];
                const pts = arr.map(it=>({ x:Number(it.t), y:Number(it.count), t:Number(it.t) })).filter(p=>isFinite(p.x)&&isFinite(p.y));
                const color = '#95e06c';
                return pts.length ? [{ id: 'cameos', label: 'Cast in', color, points: pts }] : [];
              })();
              cameosChart.setData(cSeries);
              // Followers chart: use user-level follower history when available
              const fSeries = (function(){
                const arr = getFollowersSeriesForUser(currentUserKey, user);
                const pts = arr.map(it=>({ x:Number(it.t), y:Number(it.count), t:Number(it.t) })).filter(p=>isFinite(p.x)&&isFinite(p.y));
                const color = '#ffd166';
                return pts.length ? [{ id: 'followers', label: 'Followers', color, points: pts }] : [];
              })();
              followersChart.setData(fSeries);
            } else {
              updateCompareCharts();
            }
          } finally {
            perfEnd(perfCharts);
          }
        }
      // Restore any saved zoom for this user (unless skipRestoreZoom is true)
      if (!skipRestoreZoom) {
        try {
          const z = zoomStates[currentUserKey] || {};
          if (z.viewsPerPerson) viewsPerPersonChart.setZoom(z.viewsPerPerson);
          if (z.viewsPerPersonTime) viewsPerPersonTimeChart.setZoom(z.viewsPerPersonTime);
          if (z.views) viewsChart.setZoom(z.views);
          if (z.first24Hours) first24HoursChart.setZoom(z.first24Hours);
          if (z.likesAll) allLikesChart.setZoom(z.likesAll);
          if (z.cameos) cameosChart.setZoom(z.cameos);
          if (z.followers) followersChart.setZoom(z.followers);
          if (z.viewsAll) allViewsChart.setZoom(z.viewsAll);
        } catch {}
      }
      applyDefaultInteractionRateZoom(currentUserKey);
      // Sync chart hover back to list - use current chart instances
      const hoverCharts = [
        chart,
        interactionRateStackedChart,
        viewsPerPersonChart,
        viewsPerPersonTimeChart,
        viewsChart,
        first24HoursChart
      ];
      const syncHoverCharts = (pid)=>{
        hoverCharts.forEach((c)=> c.setHoverSeries(pid));
      };
      const handleChartHover = (pid)=>{
        const wrap = $('#posts');
        if (!wrap) return;
        if (pid){
          wrap.classList.add('is-hovering');
          $$('.post', wrap).forEach(r=>{ if (r.dataset.pid===pid) r.classList.add('hover'); else r.classList.remove('hover'); });
        } else {
          wrap.classList.remove('is-hovering');
          $$('.post', wrap).forEach(r=>r.classList.remove('hover'));
        }
        syncHoverCharts(pid);
      };
      hoverCharts.forEach((c)=> c.onHover(handleChartHover));
      // wire visibility toggles (delegated)
      const postsWrap = $('#posts');
      if (postsWrap) {
        postsWrap._sctOnToggle = (pid, row, btn)=>{
          if (!user || !user.posts || !pid) return;
          const isVirtual = isVirtualUser(user);
          let isCustomMode = currentVisibilitySource === 'custom' || isCustomFilterAction(currentVisibilitySource) || currentListActionId === 'custom' || listOpts?.activeActionId === 'custom';
          const shouldAutoCustom = !isCustomMode && isCoreVisibilitySource(currentVisibilitySource);
          if (isCustomMode) {
            if (currentVisibilitySource !== 'custom' && !isCustomFilterAction(currentVisibilitySource)) {
              currentVisibilitySource = 'custom';
            }
            setListActionActive('custom');
            if (listOpts) listOpts.activeActionId = 'custom';
          }
          if (visibleSet.has(pid)) {
            visibleSet.delete(pid);
            if (row) row.classList.add('hidden');
            if (btn) btn.textContent = 'Show';
          } else {
            visibleSet.add(pid);
            if (row) row.classList.remove('hidden');
            if (btn) btn.textContent = 'Hide';
          }
          if (shouldAutoCustom) {
            const autoId = createAutoCustomFilterForUser(currentUserKey, visibleSet);
            if (autoId) {
              currentVisibilitySource = `${CUSTOM_FILTER_PREFIX}${autoId}`;
              setListActionActive('custom');
              renderCustomFilters(currentUserKey);
              setCustomFilterActive(autoId);
              isCustomMode = true;
            }
          }
          const nextOpts = listOpts || {};
          if (isCustomMode) nextOpts.activeActionId = 'custom';
          updatePostsListRows(user, colorFor, visibleSet, nextOpts);
          // Fit to visible
          chart.resetZoom();
          interactionRateStackedChart.resetZoom();
          viewsPerPersonChart.resetZoom();
          viewsPerPersonTimeChart.resetZoom();
          clampStackedSliderToData({
            minId: '#interactionRateSliderMin',
            maxId: '#interactionRateSliderMax',
            trackId: '#interactionRateSliderTrack',
            labelId: '#interactionRateSliderValue',
            minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
            maxKey: STACKED_WINDOW_STORAGE_KEYS.interaction,
            getMaxMinutes: () => computeStackedMaxMinutes(user, visibleSet, (s)=> {
              const t = s.t;
              const rate = interactionRate(s);
              return t != null && rate != null;
            })
          });
          clampStackedSliderToData({
            minId: '#first24HoursSliderMin',
            maxId: '#first24HoursSliderMax',
            trackId: '#first24HoursSliderTrack',
            labelId: '#first24HoursSliderValue',
            minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.views,
            maxKey: STACKED_WINDOW_STORAGE_KEYS.views,
            getMaxMinutes: () => computeStackedMaxMinutes(user, visibleSet, (s)=> {
              const t = s.t;
              const v = viewsChartType === 'unique' ? s.uv : s.views;
              return t != null && v != null;
            })
          });
          clampStackedSliderToData({
            minId: '#viewsPerPersonSliderMin',
            maxId: '#viewsPerPersonSliderMax',
            trackId: '#viewsPerPersonSliderTrack',
            labelId: '#viewsPerPersonSliderValue',
            minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
            maxKey: STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson,
            getMaxMinutes: () => computeStackedMaxMinutes(user, visibleSet, (s)=> {
              const t = s.t;
              const totalViews = num(s.views);
              const uniqueViews = num(s.uv);
              return t != null && totalViews != null && uniqueViews != null && uniqueViews > 0;
            })
          });
          const useUnique = viewsChartType === 'unique';
          chart.setData(computeSeriesForUser(user, [], colorFor, useUnique).filter(s=>visibleSet.has(s.id)).map(s=>({ ...s, url: absUrl(user.posts?.[s.id]?.url, s.id) })));
          {
            const range = getStackedRangeFromInputs('#interactionRateSliderMin', '#interactionRateSliderMax');
            updateInteractionRateStackedChart(range.min, range.max);
          }
          // Refresh the cumulative views time series to reflect current visibility
          const vSeries = (function(){
            const out=[]; for (const [vpid,p] of Object.entries(user.posts||{})){
              if (!visibleSet.has(vpid)) continue; const pts=[];
              for (const s of (p.snapshots||[])){
                const t=s.t; const v=useUnique ? s.uv : s.views; if (t!=null && v!=null) pts.push({ x:Number(t), y:Number(v), t:Number(t) });
              }
              const owner = isVirtual ? (p?.ownerHandle || '') : (user?.handle || '');
              const color=colorFor(vpid); const label=buildPostLabel({ ...p, id: vpid }, owner); if (pts.length) out.push({ id: vpid, label, color, points: pts, url: absUrl(p.url, vpid) });
            }
            return out; })();
          viewsChart.setData(vSeries);
          updateViewsPerPersonTimeChart();
          // Refresh Views Per Person chart
          {
            const range = getStackedRangeFromInputs('#viewsPerPersonSliderMin', '#viewsPerPersonSliderMax');
            updateViewsPerPersonChart(range.min, range.max);
          }
          // Update first 24 hours chart
          {
            const range = getStackedRangeFromInputs('#first24HoursSliderMin', '#first24HoursSliderMax');
            updateFirst24HoursChart(range.min, range.max);
          }
          // (likes total chart is unfiltered; no need to refresh here)
          updateSummaryMetrics(user, visibleSet);
          try {
            const followersEl = $('#followersTotal');
            if (followersEl) {
              const followersArr = Array.isArray(user.followers) ? user.followers : [];
              const lastFollower = followersArr.length > 0 ? followersArr[followersArr.length - 1] : null;
              followersEl.textContent = lastFollower ? fmtK2OrInt(lastFollower.count) : '0';
            }
          } catch {}
          persistVisibility();
          if (isCustomMode) {
            if (isCustomFilterAction(currentVisibilitySource)) {
              updateCustomFilterIdsForUser(currentUserKey, getCustomFilterId(currentVisibilitySource), visibleSet);
            } else {
              persistCustomVisibilityForUser(currentUserKey, visibleSet);
              updateCustomButtonLabel(currentUserKey);
            }
          }
        };
        if (!postsWrap._sctToggleBound){
          postsWrap._sctToggleBound = true;
          postsWrap.addEventListener('click', (e)=>{
            const btn = e.target.closest('.toggle');
            if (!btn || !postsWrap.contains(btn)) return;
            e.preventDefault();
            e.stopPropagation();
            const row = btn.closest('.post');
            const pid = btn.dataset.pid || (row && row.dataset.pid);
            if (!pid) return;
            if (postsWrap._sctOnToggle) postsWrap._sctOnToggle(pid, row, btn);
          });
        }
      }
      snapLog('refreshUserUI:done', {
        currentUserKey,
        snapshotsHydrated,
        isMetricsPartial,
        userSummary: summarizeUserSnapshots(resolveUserForKey(metrics, currentUserKey))
      });
      } finally {
        perfEnd(perfUI);
      }
    }

    function clearListActionActiveUI(){
      try {
        const wrap = document.querySelector('.list-actions');
        if (!wrap) return;
        wrap.querySelectorAll('button').forEach(btn=>btn.classList.remove('active'));
      } catch {}
    }

    function syncUserSelectionUI(){
      const selEl = $('#userSelect');
      if (selEl) selEl.value = currentUserKey || '';
      if (!searchInput) return;
      const user = resolveUserForKey(metrics, currentUserKey);
      const label = formatUserSelectionLabel(currentUserKey, user);
      if (label) {
        searchInput.value = label;
        searchInput.dataset.selectedKey = currentUserKey || '';
        searchInput.dataset.selectedLabel = label;
      } else {
        searchInput.value = '';
        delete searchInput.dataset.selectedKey;
        delete searchInput.dataset.selectedLabel;
      }
      updateUserSelectHydrateIndicatorPosition();
    }

    function syncUserOptionCount(userKey, count){
      if (!userKey) return;
      const selEl = $('#userSelect');
      const entry = findUserIndexEntry(userKey);
      if (entry) entry.postCount = count;
      if (selEl) {
        for (const opt of Array.from(selEl.options || [])){
          if (opt.value !== userKey) continue;
          const user = metrics?.users?.[userKey];
          const name = entry?.handle || user?.handle || userKey;
          opt.textContent = formatUserOptionLabel(name, count);
          break;
        }
      }
      if (currentUserKey === userKey) syncUserSelectionUI();
    }

    function syncUserOptionCounts(){
      const selEl = $('#userSelect');
      if (!selEl) return;
      let topToday = null;
      const useIndex = Array.isArray(usersIndex) && usersIndex.length > 0;
      const indexByKey = useIndex ? new Map(usersIndex.map((entry)=>[entry.key, entry])) : null;
      for (const opt of Array.from(selEl.options || [])){
        const key = opt.value;
        if (!key) continue;
        if (key === TOP_TODAY_KEY) {
          if (isMetricsPartial) continue;
          topToday = topToday || buildTopTodayUser(metrics);
          const count = Object.keys(topToday.posts || {}).length;
          opt.textContent = formatUserOptionLabel(topToday.handle, count);
          continue;
        }
        const entry = indexByKey ? indexByKey.get(key) : null;
        const user = metrics?.users?.[key];
        const name = entry?.handle || user?.handle || key;
        const count = entry ? (Number(entry.postCount) || 0) : Object.keys(user?.posts || {}).length;
        opt.textContent = formatUserOptionLabel(name, count);
      }
      syncUserSelectionUI();
    }

    function reconcileCompareUsers(){
      for (const key of Array.from(compareUsers)){
        if (!(metrics.users[key] || isVirtualUserKey(key))) compareUsers.delete(key);
      }
      const hasCurrent = currentUserKey && resolveUserForKey(metrics, currentUserKey);
      if (compareUsers.size === 1 && hasCurrent){
        compareUsers.clear();
        compareUsers.add(currentUserKey);
      } else if (compareUsers.size === 0 && hasCurrent){
        compareUsers.add(currentUserKey);
      }
      renderComparePills();
    }

    async function switchUserSelection(nextUserKey, opts = {}){
      const forceCache = !!opts.forceCache;
      const useStoredFilter = !!opts.useStoredFilter;
      const keepCurrentFilter = !!opts.keepCurrentFilter;
      postHydrationToken++;
      setPostsHydrateState(false);
      if (isMetricsPartial && nextUserKey && (isVirtualUserKey(nextUserKey) || !metrics.users?.[nextUserKey])) {
        await refreshData({ skipPostListRebuild: false, skipRestoreZoom: true });
      }
      const currentAction = normalizeFilterAction(currentVisibilitySource)
        || normalizeFilterAction(currentListActionId)
        || getSessionFilterAction(currentUserKey);
      const safeCurrentAction = (currentAction === 'custom' || isCustomFilterAction(currentAction)) ? 'showAll' : currentAction;
      const storedAction = useStoredFilter ? getSavedFilterActionForUser(nextUserKey) : null;
      const nextAction = keepCurrentFilter
        ? (safeCurrentAction || 'showAll')
        : (storedAction || safeCurrentAction || getSessionFilterAction(nextUserKey));
      currentUserKey = nextUserKey;
      trackLastSelectedUserKey();
      visibleSet.clear();
      currentVisibilitySource = null;
      currentListActionId = null;

      const def = buildUserOptions(metrics);
      if (!(metrics.users[currentUserKey] || isVirtualUserKey(currentUserKey))) currentUserKey = def;
      syncUserSelectionUI();
      try { await chrome.storage.local.set({ lastUserKey: currentUserKey }); } catch {}
      updateBestTimeToPostSection();
      reconcileCompareUsers();
      renderCustomFilters(currentUserKey);

      const u = resolveUserForKey(metrics, currentUserKey);
      if (u) {
        setListActionActive(normalizeFilterAction(nextAction) || getSessionFilterAction(nextUserKey) || 'showAll');
        const didClick = triggerFilterClick(nextAction);
        if (!didClick) {
          applyUserFilterState(currentUserKey, u, nextAction);
          await refreshUserUI({ preserveEmpty: true });
          persistVisibility();
        }
        saveSessionCache({ force: forceCache });
        return;
      }
      await refreshUserUI({ preserveEmpty: true });
      persistVisibility();
      saveSessionCache({ force: forceCache });
    }

    $('#userSelect').addEventListener('change', async (e)=>{
      await switchUserSelection(e.target.value, { forceCache: true, keepCurrentFilter: true });
    });

    // Views type toggle pills
    let isUpdatingViewsType = false; // Prevent recursive calls
    function syncViewsHeaders(type = viewsChartType){
      const prefix = type === 'unique' ? 'Viewers' : 'Total Views';
      const interactionTitle = $('#interactionRateTitle');
      if (interactionTitle) {
        const isStacked = chartsMode === 'stacked';
        interactionTitle.textContent = isStacked
          ? 'Interaction Rate over Time'
          : `Interaction Rate vs. ${prefix}`;
      }
      const viewsTitle = $('#viewsChartTitle');
      if (viewsTitle) {
        viewsTitle.textContent = `${prefix} over Time`;
      }
      const viewsPerPersonTitle = $('#viewsPerPersonTitle');
      if (viewsPerPersonTitle) {
        viewsPerPersonTitle.textContent = 'Views Per Person over Time';
      }
      const allOverTimeTitle = $('#allViewsOverTimeTitle');
      if (allOverTimeTitle) allOverTimeTitle.textContent = `${prefix} over Time`;
    }

    function syncYAxisLabels(type = viewsChartType){
      const viewsLabel = type === 'unique' ? 'Viewers' : 'Total Views';
      document.querySelectorAll('[data-axis="views"]').forEach((label)=>{
        label.textContent = viewsLabel;
      });
    }

    function applyDefaultInteractionRateZoom(userKey){
      if (!userKey || !chart || !interactionRateStackedChart) return;
      if (defaultInteractionZoomApplied.has(userKey)) return;
      chart.resetZoom();
      interactionRateStackedChart.resetZoom();
      chart.setZoom({ y: [0, INTERACTION_RATE_DEFAULT_ZOOM_Y_MAX] });
      interactionRateStackedChart.setZoom({ y: [0, INTERACTION_RATE_DEFAULT_ZOOM_Y_MAX] });
      defaultInteractionZoomApplied.add(userKey);
    }

    function syncViewsPills(type){
      const uniquePill = $('#uniqueViewsPill');
      const totalPill = $('#totalViewsPill');
      if (uniquePill) {
        const isActive = type === 'unique';
        uniquePill.classList.toggle('active', isActive);
        uniquePill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
      if (totalPill) {
        const isActive = type !== 'unique';
        totalPill.classList.toggle('active', isActive);
        totalPill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
    }

    function updateViewsType(type){
      // Prevent accidental calls or recursive updates
      if (isUpdatingViewsType || viewsChartType === type) return;
      isUpdatingViewsType = true;
      
      try {
        viewsChartType = type;
        compareViewsChartType = type;
        saveViewsChartType(type);
        viewsChartTypeLoaded = true;
        syncViewsPills(type);
        // Update chart labels
        const yAxisLabel = type === 'unique' ? 'Viewers' : 'Total Views';
        const xAxisLabel = type === 'unique' ? 'Viewers' : 'Total Views';
        const tooltipLabel = type === 'unique' ? 'Viewers' : 'Total Views';
        
        chart.setAxisLabels(xAxisLabel, tooltipLabel);
        viewsChart.setYAxisLabel(yAxisLabel);
        first24HoursChart.setYAxisLabel(yAxisLabel);
        syncViewsHeaders(type);
        syncYAxisLabels(type);
        
        // Immediately clear data to prevent hovering over stale data from wrong mode
        chart.setData([]);
        viewsChart.setData([]);
        first24HoursChart.setData([]);
        
        // Refresh the UI to update chart data
        refreshUserUI({ skipRestoreZoom: true });
      } finally {
        isUpdatingViewsType = false;
      }
    }

    let isUpdatingChartMode = false;
    function setToggleState(btn, isActive){
      if (!btn) return;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    function setCanvasVisible(canvas, isVisible){
      if (!canvas) return;
      canvas.classList.toggle('is-canvas-hidden', !isVisible);
    }

    function setSliderVisible(el, isVisible){
      if (!el) return;
      el.classList.toggle('is-hidden', !isVisible);
    }

    function hideTooltips(ids){
      ids.forEach((id)=>{
        const el = $(id);
        if (el) el.style.display = 'none';
      });
    }

    function fmtStackedWindow(minutes){
      if (minutes < 60) return `${minutes}m`;
      const totalMinutes = Math.round(minutes);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const mins = totalMinutes % 60;
      if (days > 0) {
        if (hours === 0 && mins === 0) return `${days}d`;
        if (mins === 0) return `${days}d ${hours}h`;
        if (hours === 0) return `${days}d ${mins}m`;
        return `${days}d ${hours}h ${mins}m`;
      }
      if (mins === 0) return `${hours}h`;
      return `${hours}h ${mins}m`;
    }

    function normalizeStackedWindowMinutes(value, fallback = STACKED_WINDOW_MINUTES_DEFAULT){
      const raw = Number(value);
      if (!Number.isFinite(raw) || raw <= 0) return fallback;
      const rounded = Math.round(raw);
      return clamp(rounded, 1, STACKED_WINDOW_MINUTES_MAX);
    }

    function normalizeStackedWindowStartMinutes(value, fallback = 0){
      const raw = Number(value);
      if (!Number.isFinite(raw) || raw < 0) return fallback;
      const rounded = Math.round(raw);
      return clamp(rounded, 0, STACKED_WINDOW_MINUTES_MAX - 1);
    }

    function normalizeStackedWindowRange(minMinutes, maxMinutes){
      let min = normalizeStackedWindowStartMinutes(minMinutes, 0);
      let max = normalizeStackedWindowMinutes(maxMinutes);
      if (max < min + STACKED_WINDOW_MIN_GAP_MINUTES) {
        max = clamp(min + STACKED_WINDOW_MIN_GAP_MINUTES, STACKED_WINDOW_MIN_GAP_MINUTES, STACKED_WINDOW_MINUTES_MAX);
      }
      if (min > max - STACKED_WINDOW_MIN_GAP_MINUTES) {
        min = clamp(max - STACKED_WINDOW_MIN_GAP_MINUTES, 0, STACKED_WINDOW_MINUTES_MAX - STACKED_WINDOW_MIN_GAP_MINUTES);
      }
      return { min, max };
    }

    function loadStackedWindowRange(minKey, maxKey){
      let min = 0;
      let max = STACKED_WINDOW_MINUTES_DEFAULT;
      try {
        min = normalizeStackedWindowStartMinutes(localStorage.getItem(minKey), 0);
        const storedMax = localStorage.getItem(maxKey);
        if (storedMax !== null && storedMax !== undefined) {
          max = normalizeStackedWindowMinutes(storedMax);
        }
      } catch {}
      return normalizeStackedWindowRange(min, max);
    }

    function saveStackedWindowRange(minKey, maxKey, minMinutes, maxMinutes){
      const { min, max } = normalizeStackedWindowRange(minMinutes, maxMinutes);
      try { localStorage.setItem(minKey, String(min)); } catch {}
      try { localStorage.setItem(maxKey, String(max)); } catch {}
      try { chrome.storage.local.set({ [minKey]: min, [maxKey]: max }); } catch {}
      return { min, max };
    }

    function setStackedRangeUI(trackEl, labelEl, minMinutes, maxMinutes){
      if (!trackEl || !labelEl) return;
      const startPct = clamp((minMinutes / STACKED_WINDOW_MINUTES_MAX) * 100, 0, 100);
      const endPct = clamp((maxMinutes / STACKED_WINDOW_MINUTES_MAX) * 100, 0, 100);
      trackEl.style.setProperty('--range-start', `${startPct}%`);
      trackEl.style.setProperty('--range-end', `${endPct}%`);
      labelEl.textContent = fmtStackedWindow(maxMinutes);
    }

    function getStackedRangeFromInputs(minSelector, maxSelector){
      const minEl = $(minSelector);
      const maxEl = $(maxSelector);
      const rawMin = parseInt(minEl?.value);
      const rawMax = parseInt(maxEl?.value);
      return normalizeStackedWindowRange(rawMin, rawMax);
    }

    function computeStackedMaxMinutes(user, visibleSet, shouldIncludeSnapshot){
      if (!user || !shouldIncludeSnapshot) return null;
      let maxMinutes = null;
      for (const [pid, p] of Object.entries(user.posts || {})){
        if (!visibleSet.has(pid)) continue;
        const postTime = getPostTimeStrict(p) || getPostTimeForRecency(p);
        if (!postTime) continue;
        for (const s of (p.snapshots || [])){
          const t = s.t;
          if (t == null || !shouldIncludeSnapshot(s)) continue;
          const minutes = (Number(t) - Number(postTime)) / (60 * 1000);
          if (!Number.isFinite(minutes) || minutes < 0) continue;
          if (maxMinutes == null || minutes > maxMinutes) maxMinutes = minutes;
        }
      }
      return maxMinutes;
    }

    function clampStackedSliderToData(opts){
      const maxMinutesRaw = opts.getMaxMinutes?.();
      if (!Number.isFinite(maxMinutesRaw)) return false;
      const maxMinutes = clamp(Math.max(1, Math.floor(maxMinutesRaw)), 1, STACKED_WINDOW_MINUTES_MAX);
      const minEl = $(opts.minId);
      const maxEl = $(opts.maxId);
      const trackEl = $(opts.trackId);
      const labelEl = $(opts.labelId);
      if (!minEl || !maxEl || !trackEl || !labelEl) return false;
      const currentMax = parseInt(maxEl.value);
      if (!Number.isFinite(currentMax) || currentMax <= maxMinutes) return false;
      const currentMin = parseInt(minEl.value);
      const range = saveStackedWindowRange(opts.minKey, opts.maxKey, currentMin, maxMinutes);
      minEl.value = String(range.min);
      maxEl.value = String(range.max);
      setStackedRangeUI(trackEl, labelEl, range.min, range.max);
      return true;
    }

    function applyStackedWindowDefaults(){
      const interactionRange = loadStackedWindowRange(
        STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
        STACKED_WINDOW_STORAGE_KEYS.interaction
      );
      const viewsRange = loadStackedWindowRange(
        STACKED_WINDOW_STORAGE_MIN_KEYS.views,
        STACKED_WINDOW_STORAGE_KEYS.views
      );
      const vppRange = loadStackedWindowRange(
        STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
        STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson
      );
      const interactionMin = $('#interactionRateSliderMin');
      const interactionMax = $('#interactionRateSliderMax');
      const interactionTrack = $('#interactionRateSliderTrack');
      const interactionLabel = $('#interactionRateSliderValue');
      if (interactionMin) interactionMin.value = String(interactionRange.min);
      if (interactionMax) interactionMax.value = String(interactionRange.max);
      setStackedRangeUI(interactionTrack, interactionLabel, interactionRange.min, interactionRange.max);
      const viewsMin = $('#first24HoursSliderMin');
      const viewsMax = $('#first24HoursSliderMax');
      const viewsTrack = $('#first24HoursSliderTrack');
      const viewsLabel = $('#first24HoursSliderValue');
      if (viewsMin) viewsMin.value = String(viewsRange.min);
      if (viewsMax) viewsMax.value = String(viewsRange.max);
      setStackedRangeUI(viewsTrack, viewsLabel, viewsRange.min, viewsRange.max);
      const vppMin = $('#viewsPerPersonSliderMin');
      const vppMax = $('#viewsPerPersonSliderMax');
      const vppTrack = $('#viewsPerPersonSliderTrack');
      const vppLabel = $('#viewsPerPersonSliderValue');
      if (vppMin) vppMin.value = String(vppRange.min);
      if (vppMax) vppMax.value = String(vppRange.max);
      setStackedRangeUI(vppTrack, vppLabel, vppRange.min, vppRange.max);
    }

    function ensureStackedWindowHasData(){
      const interactionMin = parseInt($('#interactionRateSliderMin')?.value) || 0;
      const interactionMax = parseInt($('#interactionRateSliderMax')?.value) || STACKED_WINDOW_MINUTES_DEFAULT;
      if (!updateInteractionRateStackedChart(interactionMin, interactionMax) && interactionMax < STACKED_WINDOW_MINUTES_MAX) {
        const range = saveStackedWindowRange(
          STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
          STACKED_WINDOW_STORAGE_KEYS.interaction,
          interactionMin,
          STACKED_WINDOW_MINUTES_MAX
        );
        const minEl = $('#interactionRateSliderMin');
        const maxEl = $('#interactionRateSliderMax');
        const trackEl = $('#interactionRateSliderTrack');
        const labelEl = $('#interactionRateSliderValue');
        if (minEl) minEl.value = String(range.min);
        if (maxEl) maxEl.value = String(range.max);
        setStackedRangeUI(trackEl, labelEl, range.min, range.max);
        updateInteractionRateStackedChart(range.min, range.max);
      }
      const viewsMin = parseInt($('#first24HoursSliderMin')?.value) || 0;
      const viewsMax = parseInt($('#first24HoursSliderMax')?.value) || STACKED_WINDOW_MINUTES_DEFAULT;
      if (!updateFirst24HoursChart(viewsMin, viewsMax) && viewsMax < STACKED_WINDOW_MINUTES_MAX) {
        const range = saveStackedWindowRange(
          STACKED_WINDOW_STORAGE_MIN_KEYS.views,
          STACKED_WINDOW_STORAGE_KEYS.views,
          viewsMin,
          STACKED_WINDOW_MINUTES_MAX
        );
        const minEl = $('#first24HoursSliderMin');
        const maxEl = $('#first24HoursSliderMax');
        const trackEl = $('#first24HoursSliderTrack');
        const labelEl = $('#first24HoursSliderValue');
        if (minEl) minEl.value = String(range.min);
        if (maxEl) maxEl.value = String(range.max);
        setStackedRangeUI(trackEl, labelEl, range.min, range.max);
        updateFirst24HoursChart(range.min, range.max);
      }
      const vppMin = parseInt($('#viewsPerPersonSliderMin')?.value) || 0;
      const vppMax = parseInt($('#viewsPerPersonSliderMax')?.value) || STACKED_WINDOW_MINUTES_DEFAULT;
      if (!updateViewsPerPersonChart(vppMin, vppMax) && vppMax < STACKED_WINDOW_MINUTES_MAX) {
        const range = saveStackedWindowRange(
          STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
          STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson,
          vppMin,
          STACKED_WINDOW_MINUTES_MAX
        );
        const minEl = $('#viewsPerPersonSliderMin');
        const maxEl = $('#viewsPerPersonSliderMax');
        const trackEl = $('#viewsPerPersonSliderTrack');
        const labelEl = $('#viewsPerPersonSliderValue');
        if (minEl) minEl.value = String(range.min);
        if (maxEl) maxEl.value = String(range.max);
        setStackedRangeUI(trackEl, labelEl, range.min, range.max);
        updateViewsPerPersonChart(range.min, range.max);
      }
    }

    function setGlobalChartMode(mode, opts = {}){
      const normalized = normalizeChartMode(mode) || 'linear';
      if (isUpdatingChartMode) return;
      isUpdatingChartMode = true;
      try {
        const persist = opts.persist !== false;
        chartsMode = normalized;
        if (persist) {
          saveChartMode(CHART_MODE_STORAGE_KEY, normalized);
          chartModeLoaded = true;
        }
        setToggleState($('#chartModeLinear'), normalized === 'linear');
        setToggleState($('#chartModeStacked'), normalized === 'stacked');
        const isStacked = normalized === 'stacked';
        setCanvasVisible($('#chart'), !isStacked);
        setCanvasVisible($('#interactionRateStackedChart'), isStacked);
        setSliderVisible($('#interactionRateSliderWrap'), isStacked);
        setCanvasVisible($('#viewsChart'), !isStacked);
        setCanvasVisible($('#first24HoursChart'), isStacked);
        setSliderVisible($('#viewsStackedSliderWrap'), isStacked);
        setCanvasVisible($('#viewsPerPersonTimeChart'), !isStacked);
        setCanvasVisible($('#viewsPerPersonChart'), isStacked);
        setSliderVisible($('#viewsPerPersonSliderWrap'), isStacked);
        hideTooltips([
          '#tooltip',
          '#interactionRateStackedTooltip',
          '#viewsTooltip',
          '#first24HoursTooltip',
          '#viewsPerPersonTimeTooltip',
          '#viewsPerPersonTooltip'
        ]);
        if (isStacked) ensureStackedWindowHasData();
        syncViewsHeaders();
      } finally {
        isUpdatingChartMode = false;
      }
    }

    $('#uniqueViewsPill').addEventListener('click', (e)=>{
      e.stopPropagation();
      if (viewsChartType !== 'unique') updateViewsType('unique');
    });
    $('#totalViewsPill').addEventListener('click', (e)=>{
      e.stopPropagation();
      if (viewsChartType !== 'total') updateViewsType('total');
    });
    const chartModeLinearBtn = $('#chartModeLinear');
    const chartModeStackedBtn = $('#chartModeStacked');
    if (chartModeLinearBtn) chartModeLinearBtn.addEventListener('click', ()=> setGlobalChartMode('linear'));
    if (chartModeStackedBtn) chartModeStackedBtn.addEventListener('click', ()=> setGlobalChartMode('stacked'));
    applyStackedWindowDefaults();
    setGlobalChartMode(chartsMode, { persist: shouldPersistLegacyChartMode });
    syncViewsHeaders(viewsChartType);
    syncViewsPills(viewsChartType);
    syncYAxisLabels(viewsChartType);


    // Typeahead suggestions
    function renderUserSuggestions(query){
      if (!suggestions) return;
      const list = buildUserSuggestionItems(metrics, query);
      if (!list.length) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
        return;
      }
      suggestions.innerHTML = list.map((item)=>{
        const meta = formatPostCount(item.count);
        return `<div class="item" data-key="${esc(item.key)}"><span>${esc(item.label)}</span><span style="color:#7d8a96">${esc(meta)}</span></div>`;
      }).join('');
      suggestions.style.display = 'block';
      $$('.item', suggestions).forEach(it=>{
        it.addEventListener('click', async ()=>{
          suggestions.style.display='none';
          await switchUserSelection(it.dataset.key, { forceCache: true, keepCurrentFilter: true });
        });
      });
    }

    function getUserSearchQuery(){
      if (!searchInput) return '';
      if (searchInput.dataset.selectedLabel && searchInput.value === searchInput.dataset.selectedLabel) return '';
      return searchInput.value || '';
    }

    function showUserSuggestions(){
      renderUserSuggestions(getUserSearchQuery());
    }

    function maybeSelectSearchText(){
      if (!searchInput) return;
      if (searchInput.dataset.selectedLabel && searchInput.value === searchInput.dataset.selectedLabel) {
        searchInput.select();
      }
    }

    function restoreSearchSelection(){
      if (!searchInput) return;
      if (!searchInput.dataset.selectedLabel) return;
      if (searchInput.value === searchInput.dataset.selectedLabel) return;
      syncUserSelectionUI();
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e)=>{
        renderUserSuggestions(e.target.value);
        updateUserSelectHydrateIndicatorPosition();
      });
      searchInput.addEventListener('focus', ()=>{
        showUserSuggestions();
        maybeSelectSearchText();
      });
      searchInput.addEventListener('click', ()=>{
        showUserSuggestions();
        maybeSelectSearchText();
      });
      window.addEventListener('resize', ()=>{
        updateUserSelectHydrateIndicatorPosition();
      });
    }
    document.addEventListener('click', (e)=>{
      if (!e.target.closest('.user-picker')) {
        if (suggestions) suggestions.style.display='none';
        restoreSearchSelection();
      }
    });

    // Compare search typeahead (dropdown-style, like main user search)
    const compareSearchInput = $('#compareSearch');
    function renderCompareSuggestions(query){
      const suggestions = $('#compareSuggestions');
      if (!suggestions) return;
      const list = buildUserSuggestionItems(metrics, query)
        .filter((item)=>!isTopTodayKey(item.key) && !compareUsers.has(item.key));
      if (!list.length) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
        return;
      }
      suggestions.innerHTML = list.map((item)=>{
        const meta = formatPostCount(item.count);
        return `<div class="item" data-key="${esc(item.key)}"><span>${esc(item.label)}</span><span style="color:#7d8a96">${esc(meta)}</span></div>`;
      }).join('');
      suggestions.style.display = 'block';
      $$('#compareSuggestions .item').forEach(it=>{
        it.addEventListener('click', ()=>{
          addCompareUser(it.dataset.key);
        });
      });
    }
    if (compareSearchInput) {
      compareSearchInput.addEventListener('input', (e)=>{
        renderCompareSuggestions(e.target.value);
      });
      compareSearchInput.addEventListener('focus', ()=>{
        renderCompareSuggestions(compareSearchInput.value);
      });
      compareSearchInput.addEventListener('click', ()=>{
        renderCompareSuggestions(compareSearchInput.value);
      });
    }
    document.addEventListener('click', (e)=>{ if (!e.target.closest('.user-picker-compare')) $('#compareSuggestions').style.display='none'; });

    // Initialize compare pills and dropdown
    renderComparePills();

    // Purge Menu functionality
    const purgeModal = $('#purgeModal');
    const purgeConfirmDialog = $('#purgeConfirmDialog');
    const dateRangeSlider = $('#dateRangeSlider');
    const postCountSlider = $('#postCountSlider');
    const followerCountSlider = $('#followerCountSlider');
    const dateRangeValue = $('#dateRangeValue');
    const postCountValue = $('#postCountValue');
    const followerCountValue = $('#followerCountValue');
    const purgeReviewText = $('#purgeReviewText');
    const purgeConfirmText = $('#purgeConfirmText');
    const purgeStorageSize = $('#purgeStorageSize');
    const dateRangeFill = $('#dateRangeFill');
    const postCountFill = $('#postCountFill');
    const followerCountFill = $('#followerCountFill');
    const postPurgeConfirmDialog = $('#postPurgeConfirm');
    const postPurgeConfirmText = $('#postPurgeConfirmText');
    const postPurgeConfirmYes = $('#postPurgeConfirmYes');
    const postPurgeConfirmNo = $('#postPurgeConfirmNo');
    const purgeResetPrefs = $('#purgeResetPrefs');
    const purgeClearCache = $('#purgeClearCache');
    
    function setPurgeConfirmOpen(isOpen){
      document.body.classList.toggle('is-purge-confirm-open', isOpen);
    }

    function showPostPurgeConfirm(snippet, pid){
      pendingPostPurge = { pid, userKey: currentUserKey, caption: snippet };
      if (postPurgeConfirmText) postPurgeConfirmText.textContent = `Are you sure you want to purge data tied to "${snippet}"?`;
      if (postPurgeConfirmDialog){
        setPurgeConfirmOpen(true);
        postPurgeConfirmDialog.style.display = 'flex';
      } else {
        alert(`Are you sure you want to purge data tied to "${snippet}"?`);
      }
    }

	    // Exceptions state
	    const exceptedUsers = new Set();
	    const MAX_EXCEPTED_USERS = 50;
	    const EXCEPTIONS_STORAGE_KEY = 'purgeExceptions';
	    const COMB_MODE_STORAGE_KEY = 'combModeEnabled';
	    const COMB_MODE_LAST_RUN_KEY = 'combModeLastRun';
	    let combModeEnabled = true; // Default to enabled
	    let combModeDailyTimer = null;
	    let combModeCheckedThisSession = false;

    async function loadExceptedUsers(){
      try {
        const { [EXCEPTIONS_STORAGE_KEY]: saved = [] } = await chrome.storage.local.get(EXCEPTIONS_STORAGE_KEY);
        if (Array.isArray(saved)) {
          // Validate that users still exist in metrics
          const valid = saved.filter(userKey => metrics.users && metrics.users[userKey]);
          return new Set(valid);
        }
      } catch {}
      return new Set();
    }

    async function saveExceptedUsers(){
      try {
        await chrome.storage.local.set({ [EXCEPTIONS_STORAGE_KEY]: Array.from(exceptedUsers) });
      } catch {}
    }

    async function loadCombModePreference(){
      try {
        const { [COMB_MODE_STORAGE_KEY]: saved } = await chrome.storage.local.get(COMB_MODE_STORAGE_KEY);
        if (typeof saved === 'boolean') {
          combModeEnabled = saved;
        }
      } catch {}
      return combModeEnabled;
    }

	    async function saveCombModePreference(){
	      try {
	        await chrome.storage.local.set({ [COMB_MODE_STORAGE_KEY]: combModeEnabled });
	      } catch {}
	    }

    function closePurgeModal(opts = {}){
      if (purgeModal) purgeModal.style.display = 'none';
      if (purgeConfirmDialog) purgeConfirmDialog.style.display = 'none';
      setPurgeConfirmOpen(false);
      const shouldRunComb = opts.runCombOnClose && combModeCheckedThisSession && combModeEnabled;
      combModeCheckedThisSession = false;
      if (shouldRunComb) {
        setTimeout(() => {
          runCombModePurge();
        }, 0);
      }
    }

    async function updateStorageSizeDisplay(){
      try {
        let bytes = null;
        try {
          if (chrome?.storage?.local?.getBytesInUse) {
            bytes = await new Promise((resolve)=> {
              try { chrome.storage.local.getBytesInUse(null, (b)=> resolve(b)); } catch { resolve(null); }
            });
          }
        } catch {}
        if (bytes == null) {
          // Fallback: estimate from JSON size
          const allData = await chrome.storage.local.get(null);
          const jsonString = JSON.stringify(allData);
          bytes = new Blob([jsonString]).size;
        }
        // Convert to MB with 2 decimal places
        const mb = (bytes / (1024 * 1024)).toFixed(2);
        if (purgeStorageSize) {
          purgeStorageSize.textContent = `Sora Creator Tools uses ${mb}MB of storage.\nExported data file will be larger because it's less overlapping.`;
        }
      } catch {
        if (purgeStorageSize) {
          purgeStorageSize.textContent = 'Sora Creator Tools uses 0.00MB of storage.';
        }
      }
    }

    async function runCombModePurge(){
      if (!combModeEnabled) return;

      await chrome.storage.local.set({ purgeLock: Date.now() });
      try {
        const now = Date.now();
        const sixtyMinutesMs = 60 * 60 * 1000;

        let purgedSnapshots = 0;
        let purgedUsers = 0;
        let purgedPosts = 0;
        metrics = await loadMetrics();
        await ensureFullSnapshots();
        
        // Process each user
        for (const [userKey, user] of Object.entries(metrics.users || {})){
          if (userKey === 'unknown') {
            const postCount = Object.keys(user?.posts || {}).length;
            purgedUsers++;
            purgedPosts += postCount;
            delete metrics.users[userKey];
            continue;
          }
          // Skip excepted users
          if (exceptedUsers.has(userKey)) continue;
          const postCount = Object.keys(user.posts || {}).length;
          if (postCount <= 1) {
            purgedUsers++;
            purgedPosts += postCount;
            delete metrics.users[userKey];
            continue;
          }
          
          // Process each post
          for (const [postId, post] of Object.entries(user.posts || {})){
            if (!Array.isArray(post.snapshots) || post.snapshots.length === 0) continue;
            
            // Sort snapshots by timestamp
            const sortedSnapshots = [...post.snapshots].sort((a, b) => (a.t || 0) - (b.t || 0));
            const snapshotsToKeep = [];
            let lastKeptTime = null;
            
            // Process snapshots from oldest to newest
            for (let i = 0; i < sortedSnapshots.length; i++){
              const snap = sortedSnapshots[i];
              const snapTime = snap.t || 0;
              
              // Keep only if it's been at least 60 minutes since the last kept snapshot.
              // This "combs out" detailed/frequent snapshots, keeping only spaced-out ones.
              if (lastKeptTime === null || (snapTime - lastKeptTime) >= sixtyMinutesMs) {
                snapshotsToKeep.push(snap);
                lastKeptTime = snapTime;
              } else {
                // This snapshot is within 60 minutes of another, delete it (detailed data).
                purgedSnapshots++;
              }
            }
            
            // Update post with filtered snapshots
            post.snapshots = snapshotsToKeep;
          }
        }
        
        // Save purged metrics
        if (purgedSnapshots > 0 || purgedUsers > 0) {
          await saveMetrics(metrics, { userKeys: Object.keys(metrics.users || {}) });
          // Update last run time
          await chrome.storage.local.set({ [COMB_MODE_LAST_RUN_KEY]: now });
          // Update storage size display if purge modal is open
          if (purgeModal && purgeModal.style.display !== 'none') {
            await updateStorageSizeDisplay();
          }
        }
      } catch {} finally {
        await chrome.storage.local.remove('purgeLock');
      }
    }

    function scheduleCombModeDaily(){
      // Clear existing timer if any
      if (combModeDailyTimer) {
        clearTimeout(combModeDailyTimer);
        combModeDailyTimer = null;
      }
      
      if (!combModeEnabled) return;
      
      async function scheduleNextRun(){
        try {
          const now = Date.now();
          const { [COMB_MODE_LAST_RUN_KEY]: lastRun } = await chrome.storage.local.get(COMB_MODE_LAST_RUN_KEY);
          
          // Calculate next run time (24 hours from last run, or immediately if never run)
          const nextRunTime = lastRun ? lastRun + (24 * 60 * 60 * 1000) : now;
          const delay = Math.max(0, nextRunTime - now);
          
          combModeDailyTimer = setTimeout(async () => {
            await runCombModePurge();
            // Schedule next run
            scheduleNextRun();
          }, delay);
        } catch {}
      }
      
      scheduleNextRun();
    }

    function clearTemporaryCaches(){
      try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch {}
      try { localStorage.removeItem(BOOT_CACHE_KEY); } catch {}
      try { localStorage.removeItem(BEST_TIME_CACHE_KEY); } catch {}
      try { chrome.storage.local.remove([USERS_INDEX_STORAGE_KEY]); } catch {}
    }

    function resetStoredPreferences(){
      const localPrefKeys = [
        THEME_STORAGE_KEY,
        THEME_TOGGLE_SEEN_KEY,
        SIDEBAR_WIDTH_KEY,
        VIEWS_TYPE_STORAGE_KEY,
        CHART_MODE_STORAGE_KEY,
        BEST_TIME_PREFS_KEY,
        'sctLastFilterAction',
        'sctLastFilterActionByUser'
      ];
      localPrefKeys
        .concat(Object.values(STACKED_WINDOW_STORAGE_KEYS))
        .concat(Object.values(STACKED_WINDOW_STORAGE_MIN_KEYS))
        .concat(Object.values(LEGACY_CHART_MODE_KEYS))
        .forEach((key)=>{
          try { localStorage.removeItem(key); } catch {}
        });
      const chromePrefKeys = [
        BEST_TIME_PREFS_KEY,
        VIEWS_TYPE_STORAGE_KEY,
        CHART_MODE_STORAGE_KEY,
        'lastFilterAction',
        'lastFilterActionByUser',
        'lastUserKey',
        'zoomStates',
        ULTRA_MODE_STORAGE_KEY,
        COMB_MODE_STORAGE_KEY
      ]
        .concat(Object.values(STACKED_WINDOW_STORAGE_KEYS))
        .concat(Object.values(STACKED_WINDOW_STORAGE_MIN_KEYS))
        .concat(Object.values(LEGACY_CHART_MODE_KEYS));
      try { chrome.storage.local.remove(chromePrefKeys); } catch {}
    }

    function getPurgeDescription(){
      const days = Number(dateRangeSlider.value);
      const minPosts = Number(postCountSlider.value);
      const minFollowers = Number(followerCountSlider.value);
      
      let description = '';
      const daysText = days === 365 ? '1 year' : `${days} ${days === 1 ? 'day' : 'days'}`;
      
      const postsText = minPosts === 1 ? `${minPosts} post` : `${minPosts} posts`;
      const followersText = fmt(minFollowers);
      const scope = (function(){
        if (minPosts > 0 && minFollowers > 0) {
          return `for users with fewer than ${postsText} and fewer than ${followersText} followers`;
        }
        if (minPosts > 0) return `for users with fewer than ${postsText}`;
        if (minFollowers > 0) return `for users with fewer than ${followersText} followers`;
        return 'for everyone';
      })();
      description = `all data older than ${daysText} ${scope}`;
      
      // Add exceptions clause
      if (exceptedUsers.size > 0) {
        const exceptedHandles = Array.from(exceptedUsers).map(userKey => {
          const user = metrics.users[userKey];
          return user?.handle || userKey;
        });
        let exceptText = '';
        if (exceptedHandles.length === 1) {
          exceptText = `except for any data from ${exceptedHandles[0]}`;
        } else if (exceptedHandles.length === 2) {
          exceptText = `except for any data from ${exceptedHandles[0]} and ${exceptedHandles[1]}`;
        } else {
          exceptText = `except for any data from ${exceptedHandles.slice(0, -1).join(', ')}, and ${exceptedHandles[exceptedHandles.length - 1]}`;
        }
        description += ' ' + exceptText;
      }
      
      return description;
    }

    function updatePurgeReview(){
      const description = getPurgeDescription();
      purgeReviewText.textContent = 'You are about to purge ' + description + '.';
    }

    function updateSliderFills(){
      const days = Number(dateRangeSlider.value);
      const minPosts = Number(postCountSlider.value);
      const minFollowers = Number(followerCountSlider.value);
      
      // Date range: fill represents how much we're keeping (higher = more kept)
      const datePct = (days / 365) * 100;
      dateRangeFill.style.width = Math.min(100, Math.max(0, datePct)) + '%';
      
      // Post count: fill represents threshold (higher = more kept)
      const postPct = (minPosts / 100) * 100;
      postCountFill.style.width = Math.min(100, Math.max(0, postPct)) + '%';
      
      // Follower count: fill represents threshold (higher = more kept)
      const followerPct = (minFollowers / 10000) * 100;
      followerCountFill.style.width = Math.min(100, Math.max(0, followerPct)) + '%';
    }

    function updateSliderValues(){
      const days = Number(dateRangeSlider.value);
      const minPosts = Number(postCountSlider.value);
      const minFollowers = Number(followerCountSlider.value);
      
      dateRangeValue.textContent = days === 365 ? '1 year' : `${days} ${days === 1 ? 'day' : 'days'}`;
      postCountValue.textContent = `${minPosts} ${minPosts === 1 ? 'post' : 'posts'}`;
      followerCountValue.textContent = `${fmt(minFollowers)} followers`;
      
      updateSliderFills();
      updatePurgeReview();
    }

    $('#purgeModalClose').addEventListener('click', ()=>{
      closePurgeModal({ runCombOnClose: true });
    });

    purgeModal.addEventListener('mousedown', (e)=>{
      if (e.target === purgeModal) {
        closePurgeModal({ runCombOnClose: true });
      }
    });

    dateRangeSlider.addEventListener('input', updateSliderValues);
    postCountSlider.addEventListener('input', updateSliderValues);
    followerCountSlider.addEventListener('input', updateSliderValues);

	    // Comb Mode checkbox handler
	    const combModeCheckbox = $('#combModeCheckbox');
	    if (combModeCheckbox) {
	      combModeCheckbox.addEventListener('change', async (e) => {
	        const nextChecked = e.target.checked;
	        const wasChecked = combModeEnabled;
	        combModeEnabled = nextChecked;
	        if (nextChecked && !wasChecked) combModeCheckedThisSession = true;
	        await saveCombModePreference();
	        // Reschedule daily timer based on new preference
	        scheduleCombModeDaily();
	      });
	    }

    // Exceptions functionality
    function buildExceptionsDropdown(){
      const sel = $('#exceptionsUserSelect');
      if (!sel) return;
      sel.innerHTML = '<option value="">Select user to except…</option>';
      const useIndex = Array.isArray(usersIndex) && usersIndex.length > 0;
      const entries = useIndex ? usersIndex.map((entry)=>[entry.key, entry]) : Object.entries(metrics.users);
      const users = entries
        .filter(([key])=>!exceptedUsers.has(key) && !isVirtualUserKey(key))
        .sort((a,b)=>{
          const aCount = countUserPosts(a[1]);
          const bCount = countUserPosts(b[1]);
          if (aCount !== bCount) return bCount - aCount; // Descending order
          // If same post count, sort alphabetically
          const A = (a[1].handle||a[0]||'').toLowerCase();
          const B = (b[1].handle||b[0]||'').toLowerCase();
          return A.localeCompare(B);
        });
      users.forEach(([key, u])=>{
        const opt = document.createElement('option');
        opt.value = key;
        const postCount = countUserPosts(u);
        const name = u.handle || key;
        opt.textContent = formatUserOptionLabel(name, postCount);
        sel.appendChild(opt);
      });
      sel.disabled = exceptedUsers.size >= MAX_EXCEPTED_USERS || users.length === 0;
    }

    function renderExceptionPills(){
      const container = $('#exceptionsPills');
      if (!container) return;
      container.innerHTML = '';
      const users = Array.from(exceptedUsers);
      users.forEach((userKey)=>{
        const user = metrics.users[userKey];
        const handle = user?.handle || userKey;
        const pill = document.createElement('div');
        pill.className = 'exception-pill';
        pill.dataset.userKey = userKey;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'exception-pill-name';
        nameSpan.textContent = handle;
        const removeBtn = document.createElement('span');
        removeBtn.className = 'exception-pill-remove';
        removeBtn.textContent = '×';
        removeBtn.onclick = async (e)=>{
          e.stopPropagation();
          exceptedUsers.delete(userKey);
          await saveExceptedUsers();
          renderExceptionPills();
          buildExceptionsDropdown();
          updatePurgeReview();
        };
        pill.appendChild(nameSpan);
        pill.appendChild(removeBtn);
        container.appendChild(pill);
      });
      if (exceptedUsers.size < MAX_EXCEPTED_USERS){
        const addBtn = document.createElement('button');
        addBtn.className = 'exceptions-add-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Add user';
        addBtn.onclick = ()=>{
          $('#exceptionsSearch').focus();
        };
        container.appendChild(addBtn);
      }
      const searchInput = $('#exceptionsSearch');
      if (searchInput) searchInput.disabled = exceptedUsers.size >= MAX_EXCEPTED_USERS;
    }

    async function addExceptedUser(userKey){
      if (exceptedUsers.size >= MAX_EXCEPTED_USERS) return;
      if (!metrics.users[userKey]) return;
      if (exceptedUsers.has(userKey)) return;
      exceptedUsers.add(userKey);
      await saveExceptedUsers();
      renderExceptionPills();
      buildExceptionsDropdown();
      updatePurgeReview();
      $('#exceptionsSearch').value = '';
      $('#exceptionsSuggestions').style.display = 'none';
    }

    $('#exceptionsUserSelect').addEventListener('change', async (e)=>{
      const userKey = e.target.value;
      if (userKey && !exceptedUsers.has(userKey)){
        await addExceptedUser(userKey);
        e.target.value = '';
      }
    });

    const exceptionsSearchInput = $('#exceptionsSearch');
    function renderExceptionsSuggestions(query){
      const suggestions = $('#exceptionsSuggestions');
      if (!suggestions) return;
      const raw = filterUsersByQuery(metrics, query || '');
      const seen = new Set();
      const list = [];
      for (const [key, u] of raw){
        if (exceptedUsers.has(key) || isVirtualUserKey(key)) continue;
        const label = u?.handle || key;
        const norm = normalizeMenuName(label || key);
        if (norm && seen.has(norm)) continue;
        list.push({ key, label, count: countUserPosts(u) });
        if (norm) seen.add(norm);
        if (list.length >= 20) break;
      }
      suggestions.innerHTML = list.map((item)=>{
        return `<div class="item" data-key="${esc(item.key)}"><span>${esc(item.label)}</span><span style="color:#7d8a96">${esc(formatPostCount(item.count))}</span></div>`;
      }).join('');
      suggestions.style.display = list.length ? 'block' : 'none';
      $$('#exceptionsSuggestions .item').forEach(it=>{
        it.addEventListener('click', async ()=>{
          await addExceptedUser(it.dataset.key);
        });
      });
    }
    if (exceptionsSearchInput) {
      exceptionsSearchInput.addEventListener('input', (e)=>{
        renderExceptionsSuggestions(e.target.value);
      });
      exceptionsSearchInput.addEventListener('focus', ()=>{
        renderExceptionsSuggestions(exceptionsSearchInput.value);
      });
      exceptionsSearchInput.addEventListener('click', ()=>{
        renderExceptionsSuggestions(exceptionsSearchInput.value);
      });
    }
    document.addEventListener('click', (e)=>{ if (!e.target.closest('.user-picker-exceptions')) $('#exceptionsSuggestions').style.display='none'; });

    $('#purgeMenu').addEventListener('click', async ()=>{
      combModeCheckedThisSession = false;
      purgeModal.style.display = 'block';
      if (purgeResetPrefs) purgeResetPrefs.checked = false;
      if (purgeClearCache) purgeClearCache.checked = false;
      // Load saved exceptions
      const saved = await loadExceptedUsers();
      exceptedUsers.clear();
      saved.forEach(key => exceptedUsers.add(key));
      renderExceptionPills();
      buildExceptionsDropdown();
	      updateSliderValues();
	      // Load comb mode preference
	      await loadCombModePreference();
	      const combModeCheckbox = $('#combModeCheckbox');
	      if (combModeCheckbox) {
	        combModeCheckbox.checked = combModeEnabled;
	      }
	      // Update storage size display
	      await updateStorageSizeDisplay();
	    });

    $('#purgeExecute').addEventListener('click', ()=>{
      const description = getPurgeDescription();
      purgeConfirmText.textContent = `Are you sure you want to purge ${description}?`;
      setPurgeConfirmOpen(true);
      purgeConfirmDialog.style.display = 'flex';
    });
    const purgeExportBtn = $('#purgeExport');
    if (purgeExportBtn) {
      purgeExportBtn.addEventListener('click', async ()=>{
        await exportAllDataCSV();
      });
    }

    $('#purgeConfirmNo').addEventListener('click', ()=>{
      purgeConfirmDialog.style.display = 'none';
      setPurgeConfirmOpen(false);
    });

    function setPurgeSidebarHidden(hidden){
      document.body.classList.toggle('is-purging', hidden);
    }

    function scheduleAfterPaint(fn){
      requestAnimationFrame(() => {
        requestAnimationFrame(fn);
      });
    }

    function scheduleIdle(fn){
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(fn, { timeout: 1000 });
      } else {
        setTimeout(fn, 0);
      }
    }

    function applyPurgeToMetrics(targetMetrics, opts){
      const days = Number(opts.days);
      const minPosts = Number(opts.minPosts);
      const minFollowers = Number(opts.minFollowers);
      const cutoffTime = Number(opts.cutoffTime);
      let purgedUsers = 0;
      let purgedPosts = 0;

      // Helper to get post time with snapshot fallback for purge
      function getPostTimeForPurge(post) {
        // First try explicit post time fields
        let t = getPostTimeStrict(post);
        if (t > 0) return t;

        // Fallback: use the earliest snapshot timestamp
        if (Array.isArray(post.snapshots) && post.snapshots.length > 0) {
          const times = post.snapshots.map(s => s.t || 0).filter(t => t > 0);
          if (times.length > 0) {
            return Math.min(...times); // Return earliest snapshot time
          }
        }

        // No timestamp available
        return 0;
      }

      function trimHistoryByCutoff(arr, keepAll){
        if (!Array.isArray(arr) || days > 365 || keepAll) return Array.isArray(arr) ? arr : [];
        return arr.filter((entry)=>{
          const t = Number(entry?.t);
          return Number.isFinite(t) && t >= cutoffTime;
        });
      }

      // Process each user
      for (const [userKey, user] of Object.entries(targetMetrics.users || {})){
        const hasPosts = user?.posts && Object.keys(user.posts).length > 0;
        if (!hasPosts) {
          delete targetMetrics.users[userKey];
          purgedUsers++;
          continue;
        }
        // Skip excepted users
        if (exceptedUsers.has(userKey)) continue;

        // Ensure posts object exists
        if (!user.posts) user.posts = {};

        // Get follower count for later use
        const followersArr = Array.isArray(user.followers) ? user.followers : [];
        const latestFollowers = followersArr.length > 0 ? Number(followersArr[followersArr.length - 1]?.count) : 0;
        const prePurgePostCount = Object.keys(user.posts || {}).length;
        const hasLowFollowers = minFollowers > 0 && (!isFinite(latestFollowers) || latestFollowers < minFollowers);
        const hasLowPosts = minPosts > 0 && prePurgePostCount < minPosts;
        let shouldApplyDatePurge = days <= 365;
        if (shouldApplyDatePurge && (minPosts > 0 || minFollowers > 0)) {
          if (minPosts > 0 && minFollowers > 0) {
            shouldApplyDatePurge = hasLowPosts && hasLowFollowers;
          } else {
            shouldApplyDatePurge = hasLowPosts || hasLowFollowers;
          }
        }

        let postsToKeep = {};
        const originalPostCount = prePurgePostCount;
        if (shouldApplyDatePurge) {
          // Purge posts older than cutoff time
          for (const [pid, post] of Object.entries(user.posts || {})){
            const postTime = getPostTimeForPurge(post);
            // Keep posts that have a timestamp AND are within the cutoff time
            // Posts without timestamps are purged (considered old/unknown)
            if (postTime > 0 && postTime >= cutoffTime){
              postsToKeep[pid] = post;
            } else {
              purgedPosts++;
            }
          }
          const purgedCount = originalPostCount - Object.keys(postsToKeep).length;
          if (purgedCount > 0) {
          }
        } else {
          // Keep all posts (no date-based purging for this user)
          postsToKeep = { ...user.posts };
        }

        // Update user's posts with purged list
        user.posts = postsToKeep;
        if (shouldApplyDatePurge) {
          for (const post of Object.values(user.posts || {})){
            if (!Array.isArray(post?.snapshots)) continue;
            post.snapshots = post.snapshots.filter((s)=>{
              const t = Number(s?.t);
              return Number.isFinite(t) && t >= cutoffTime;
            });
          }
        }

        if (shouldApplyDatePurge) {
          user.followers = trimHistoryByCutoff(user.followers, latestFollowers >= 50);
          user.cameos = trimHistoryByCutoff(user.cameos);
        }

        // Now check if user should be kept based on minPosts/minFollowers criteria
        const postCountAfterPurge = Object.keys(postsToKeep).length;

        // ALWAYS remove users with no posts left after purge, regardless of other criteria
        if (postCountAfterPurge === 0) {
          delete targetMetrics.users[userKey];
          purgedUsers++;
          continue;
        }
      }

      return { purgedUsers, purgedPosts };
    }

    $('#purgeConfirmYes').addEventListener('click', async ()=>{
      closePurgeModal({ runCombOnClose: true });
      setPurgeSidebarHidden(true);
      // Set purge lock to prevent concurrent writes from content script
      const purgeLockPromise = chrome.storage.local.set({ purgeLock: Date.now() });

      const days = Number(dateRangeSlider.value);
      const minPosts = Number(postCountSlider.value);
      const minFollowers = Number(followerCountSlider.value);
      const shouldResetPrefs = purgeResetPrefs?.checked;
      const shouldClearCache = purgeClearCache?.checked;
      
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      const purgeOpts = { days, minPosts, minFollowers, cutoffTime };
      
      scheduleAfterPaint(() => {
        scheduleIdle(() => {
          try {
            applyPurgeToMetrics(metrics, purgeOpts);
            const prev = currentUserKey;
            const def = buildUserOptions(metrics);
            if (!(metrics.users[prev] || isVirtualUserKey(prev))) currentUserKey = def;
            syncUserSelectionUI();

            // Clean up compare users that no longer exist
            for (const key of Array.from(compareUsers)){
              if (!(metrics.users[key] || isVirtualUserKey(key))) compareUsers.delete(key);
            }
            renderComparePills();
            refreshUserUI();
            updateBestTimeToPostSection();
          } catch {} finally {
            setPurgeSidebarHidden(false);
          }
        });
      });

      setTimeout(async () => {
        try {
          await purgeLockPromise;
          const loadedMetrics = await loadMetrics();
          await ensureFullSnapshots();
          const { purgedUsers, purgedPosts } = applyPurgeToMetrics(loadedMetrics, purgeOpts);
          await saveMetrics(loadedMetrics, { userKeys: Object.keys(loadedMetrics.users || {}) });
          await updateStorageSizeDisplay();
          if (shouldClearCache) clearTemporaryCaches();
          if (shouldResetPrefs) resetStoredPreferences();
          if (shouldClearCache || shouldResetPrefs) {
            await updateStorageSizeDisplay();
          }
          alert(`Purge complete!\n\nRemoved ${purgedUsers} user(s) and ${purgedPosts} post(s).`);
        } catch (e) {
          alert('Purge failed. Please try again.');
        } finally {
          await chrome.storage.local.remove('purgeLock');
        }
      }, 0);
    });

    // Per-post purge confirmation handlers
    if (postPurgeConfirmNo) {
      postPurgeConfirmNo.addEventListener('click', ()=>{
        pendingPostPurge = null;
        if (postPurgeConfirmDialog) postPurgeConfirmDialog.style.display = 'none';
        setPurgeConfirmOpen(false);
      });
    }

    function removePostFromMetrics(targetMetrics, pid){
      const users = targetMetrics?.users || {};
      let removedAny = false;
      const affectedKeys = new Set();
      for (const [uKey, user] of Object.entries(users)){
        if (!user?.posts || !user.posts[pid]) continue;
        delete user.posts[pid];
        removedAny = true;
        affectedKeys.add(uKey);
        if (Object.keys(user.posts).length === 0){
          delete users[uKey];
        }
      }
      return { removedAny, affectedKeys };
    }

    function applyPostPurgeToUI(pid){
      const { removedAny } = removePostFromMetrics(metrics, pid);
      if (!removedAny) return false;
      const safePid = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(pid) : String(pid).replace(/"/g, '\\"');
      const row = document.querySelector(`.post[data-pid="${safePid}"]`);
      if (row) row.remove();
      visibleSet.delete(pid);
      const prev = currentUserKey;
      const def = buildUserOptions(metrics);
      if (!(metrics.users[prev] || isVirtualUserKey(prev))) currentUserKey = def;
      syncUserSelectionUI();
      for (const key of Array.from(compareUsers)){
        if (!(metrics.users[key] || isVirtualUserKey(key))) compareUsers.delete(key);
      }
      renderComparePills();
      refreshUserUI({ preserveEmpty: true });
      persistVisibility();
      updateBestTimeToPostSection();
      return true;
    }

    if (postPurgeConfirmYes) {
      postPurgeConfirmYes.addEventListener('click', async ()=>{
        if (!pendingPostPurge){
          if (postPurgeConfirmDialog) postPurgeConfirmDialog.style.display = 'none';
          return;
        }
        const { pid } = pendingPostPurge;
        pendingPostPurge = null;
        if (postPurgeConfirmDialog) postPurgeConfirmDialog.style.display = 'none';
        setPurgeConfirmOpen(false);
        applyPostPurgeToUI(pid);
        await chrome.storage.local.set({ purgeLock: Date.now() });
        try {
          const loadedMetrics = await loadMetrics();
          await ensureFullSnapshots();
          const { removedAny, affectedKeys } = removePostFromMetrics(loadedMetrics, pid);
          if (removedAny) await saveMetrics(loadedMetrics, { userKeys: Array.from(affectedKeys) });
        } catch (e) {
          alert('Failed to purge this post. Please try again.');
          try {
            metrics = await loadMetrics();
            refreshUserUI({ preserveEmpty: true });
          } catch {}
        } finally {
          await chrome.storage.local.remove('purgeLock');
        }
      });
    }

    const refreshData = async (opts = {}) => {
      const perfRefresh = perfStart('refreshData total');
      metricsHydrationToken++;
      setMetricsHydrateState(false);
      postHydrationToken++;
      setPostsHydrateState(false);
      const isAutoRefresh = !!opts.autoRefresh;
      snapLog('refreshData:start', {
        opts,
        isAutoRefresh,
        currentUserKey,
        snapshotsHydrated,
        isMetricsPartial,
        beforeSummary: summarizeMetricsSnapshots(metrics),
        currentUserSummary: summarizeUserSnapshots(resolveUserForKey(metrics, currentUserKey))
      });
      const skipRestoreZoom = !!opts.skipRestoreZoom || isAutoRefresh;
      const userSelect = $('#userSelect');
      const userSelectScrollTop = isAutoRefresh && userSelect ? userSelect.scrollTop : null;
      const prevDomains = isAutoRefresh ? {
        views: safeGetDomain(viewsChart),
        first24Hours: safeGetDomain(first24HoursChart),
        viewsPerPerson: safeGetDomain(viewsPerPersonChart),
        viewsPerPersonTime: safeGetDomain(viewsPerPersonTimeChart),
        followers: safeGetDomain(followersChart),
        allViews: safeGetDomain(allViewsChart),
        allLikes: safeGetDomain(allLikesChart),
        cameos: safeGetDomain(cameosChart),
      } : null;
      if (isAutoRefresh) {
        const perfMeta = perfStart('storage.get metricsUpdatedAt');
        const nextUpdatedAt = await getMetricsUpdatedAt();
        perfEnd(perfMeta);
      if (!isMetricsPartial && nextUpdatedAt && lastMetricsUpdatedAt && nextUpdatedAt === lastMetricsUpdatedAt) {
        snapLog('refreshData:skipNoChange', {
          currentUserKey,
          nextUpdatedAt,
          lastMetricsUpdatedAt,
          snapshotsHydrated
        });
        const user = resolveUserForKey(metrics, currentUserKey);
        updateStaleButtonCount(user);
        perfEnd(perfRefresh);
        perfFlush('auto refresh', PERF_AUTO_ENABLED);
        return;
      }
      }
      // capture zoom states
      const zScatter = chart.getZoom();
      const zInteractionStacked = interactionRateStackedChart.getZoom();
      const zViews = viewsChart.getZoom();
      const zFirst24Hours = first24HoursChart.getZoom();
      const zViewsPerPersonTime = viewsPerPersonTimeChart.getZoom();
      const zLikesAll = allLikesChart.getZoom();
      const zCameos = cameosChart.getZoom();
      const zFollowers = followersChart.getZoom();
      const zViewsAll = allViewsChart.getZoom();
      const perfLoad = perfStart('load metrics');
      metrics = await loadMetrics();
      isMetricsPartial = false;
      syncUserSelectHydrateIndicator();
      perfEnd(perfLoad);
      snapLog('refreshData:afterLoadMetrics', {
        currentUserKey,
        snapshotsHydrated,
        isMetricsPartial,
        loadedSummary: summarizeMetricsSnapshots(metrics)
      });
      if (!isAutoRefresh) {
        const prev = currentUserKey; const def = buildUserOptions(metrics);
        if (!(metrics.users[prev] || isVirtualUserKey(prev))) currentUserKey = def;
        syncUserSelectionUI();
      } else if (userSelect && userSelectScrollTop != null) {
        userSelect.scrollTop = userSelectScrollTop;
      }
      syncUserOptionCounts();
      try { await chrome.storage.local.set({ lastUserKey: currentUserKey }); } catch {}
      
      // Clean up compare users that no longer exist
      for (const key of Array.from(compareUsers)){
        if (!(metrics.users[key] || isVirtualUserKey(key))) compareUsers.delete(key);
      }
      renderComparePills();
      renderCustomFilters(currentUserKey);
      const perfRefreshUI = perfStart('refreshUserUI await');
      await refreshUserUI({ skipPostListRebuild: !!opts.skipPostListRebuild, skipRestoreZoom, autoRefresh: isAutoRefresh });
      perfEnd(perfRefreshUI);
      updateBestTimeToPostSection();
      saveSessionCache();
      // restore zoom states
      try { if (zScatter) chart.setZoom(zScatter); } catch {}
      try { if (zInteractionStacked) interactionRateStackedChart.setZoom(zInteractionStacked); } catch {}
      try { if (zViews) viewsChart.setZoom(zViews); } catch {}
      try { if (zFirst24Hours) first24HoursChart.setZoom(zFirst24Hours); } catch {}
      try { if (zViewsPerPersonTime) viewsPerPersonTimeChart.setZoom(zViewsPerPersonTime); } catch {}
      try { if (zLikesAll) allLikesChart.setZoom(zLikesAll); } catch {}
      try { if (zCameos) cameosChart.setZoom(zCameos); } catch {}
      try { if (zFollowers) followersChart.setZoom(zFollowers); } catch {}
      try { if (zViewsAll) allViewsChart.setZoom(zViewsAll); } catch {}
      if (isAutoRefresh && prevDomains) {
        expandZoomRightIfAtEdge(viewsChart, prevDomains.views, safeGetDomain(viewsChart));
        expandZoomRightIfAtEdge(first24HoursChart, prevDomains.first24Hours, safeGetDomain(first24HoursChart));
        expandZoomRightIfAtEdge(viewsPerPersonChart, prevDomains.viewsPerPerson, safeGetDomain(viewsPerPersonChart));
        expandZoomRightIfAtEdge(viewsPerPersonTimeChart, prevDomains.viewsPerPersonTime, safeGetDomain(viewsPerPersonTimeChart));
        expandZoomRightIfAtEdge(followersChart, prevDomains.followers, safeGetDomain(followersChart));
        expandZoomRightIfAtEdge(allViewsChart, prevDomains.allViews, safeGetDomain(allViewsChart));
        expandZoomRightIfAtEdge(allLikesChart, prevDomains.allLikes, safeGetDomain(allLikesChart));
        expandZoomRightIfAtEdge(cameosChart, prevDomains.cameos, safeGetDomain(cameosChart));
      }
      if (!isAutoRefresh) {
        saveSessionCache();
      }
      snapLog('refreshData:done', {
        currentUserKey,
        snapshotsHydrated,
        isMetricsPartial,
        afterSummary: summarizeMetricsSnapshots(metrics),
        currentUserSummary: summarizeUserSnapshots(resolveUserForKey(metrics, currentUserKey))
      });
      perfEnd(perfRefresh);
      perfFlush(isAutoRefresh ? 'auto refresh' : 'refresh', !isAutoRefresh || PERF_AUTO_ENABLED);
    };

    const refreshBtn = $('#refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await refreshData();
      });
    }
    const importFileInput = $('#importFile');
    const purgeImportBtn = $('#purgeImport');
    if (purgeImportBtn && importFileInput) {
      purgeImportBtn.addEventListener('click', ()=>{
        importFileInput.click();
      });
    }
    if (importFileInput) {
      importFileInput.addEventListener('change', async (e)=>{
        const files = e.target.files;
        if (files && files.length) {
          await importDataCSVFiles(files);
          // Reset file input so same file(s) can be imported again if needed
          e.target.value = '';
        }
      });
    }
    
    // Initialize Comb Mode
    (async () => {
      await loadCombModePreference();
      scheduleCombModeDaily();
    })();
    
    // Persist zoom on full page reload/navigation
    function persistZoom(){
      const z = zoomStates[currentUserKey] || (zoomStates[currentUserKey] = {});
      delete z.scatter;
      delete z.interactionStacked;
      z.viewsPerPerson = viewsPerPersonChart.getZoom();
      z.viewsPerPersonTime = viewsPerPersonTimeChart.getZoom();
      z.views = viewsChart.getZoom();
      z.first24Hours = first24HoursChart.getZoom();
      z.likesAll = allLikesChart.getZoom();
      z.cameos = cameosChart.getZoom();
      z.followers = followersChart.getZoom();
      z.viewsAll = allViewsChart.getZoom();
      try { chrome.storage.local.set({ zoomStates }); } catch {}
    }
    function resetAllCharts(){
      chart.resetZoom();
      interactionRateStackedChart.resetZoom();
      viewsPerPersonChart.resetZoom();
      viewsPerPersonTimeChart.resetZoom();
      viewsChart.resetZoom();
      first24HoursChart.resetZoom();
      followersChart.resetZoom();
      allViewsChart.resetZoom();
      allLikesChart.resetZoom();
      cameosChart.resetZoom();
    }
    window.addEventListener('beforeunload', persistZoom);
    window.addEventListener('beforeunload', saveSessionCache);

    function setListActionActive(activeId){
      currentListActionId = activeId || null;
      try{
        const wrap = document.querySelector('.list-actions');
        if (!wrap) return;
        wrap.querySelectorAll('button').forEach(btn=>{
          if (btn.classList.contains('custom-filter-btn')) return;
          if (btn.id === activeId) btn.classList.add('active');
          else btn.classList.remove('active');
        });
      } catch {}
      if (activeId !== 'custom') setCustomFilterActive(null);
    }

      function setupFilterTooltips(){
        const tooltipCopy = {
          showAll: 'Show all posts',
          hideAll: 'Hide all posts',
          pastDay: 'Only posts from the last 24 hours',
          pastWeek: 'Only posts from the last 7 days',
          last5: 'Most recent five posts',
          last10: 'Most recent ten posts',
          top5: 'Five most-liked posts',
          top10: 'Ten most-liked posts',
          bottom5: 'Five least-liked posts outside last 24 hours',
          bottom10: 'Ten least-liked posts outside last 24 hours',
          stale: 'Posts missing data from last 24 hours'
        };
        let tooltipTimer = null;
        let tooltipEl = null;
        let lastMouse = null;
        const hideTooltip = ()=>{
          if (tooltipTimer) {
            clearTimeout(tooltipTimer);
            tooltipTimer = null;
          }
          if (tooltipEl) tooltipEl.style.display = 'none';
        };
        const showTooltip = (target, text, clientX, clientY)=>{
          if (!target || !text) return;
          if (!tooltipEl || !tooltipEl.isConnected) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'tooltip custom-filter-tooltip';
            document.body.appendChild(tooltipEl);
          }
          tooltipEl.textContent = text;
          tooltipEl.style.display = 'block';
          const width = tooltipEl.offsetWidth || 0;
          const left = Math.max(8, Math.min(window.innerWidth - width - 8, clientX - width / 2));
          tooltipEl.style.left = left + 'px';
          tooltipEl.style.top = (clientY + 8) + 'px';
        };
        Object.entries(tooltipCopy).forEach(([id, text])=>{
          const btn = document.getElementById(id);
          if (!btn || btn.dataset.tooltipBound === '1') return;
          btn.dataset.tooltipBound = '1';
          btn.addEventListener('mouseenter', (e)=>{
            if (tooltipTimer) clearTimeout(tooltipTimer);
            lastMouse = { x: e.clientX, y: e.clientY };
            tooltipTimer = setTimeout(()=>{
              const point = lastMouse || btn.getBoundingClientRect();
              const x = lastMouse ? lastMouse.x : (point.left + point.width / 2);
              const y = lastMouse ? lastMouse.y : point.bottom;
              showTooltip(btn, text, x, y);
            }, 500);
          });
          btn.addEventListener('mousemove', (e)=>{
            lastMouse = { x: e.clientX, y: e.clientY };
            if (tooltipEl && tooltipEl.style.display === 'block') {
              showTooltip(btn, text, e.clientX, e.clientY);
            }
          });
          btn.addEventListener('mouseleave', hideTooltip);
          btn.addEventListener('blur', hideTooltip);
        });
      }

      setupFilterTooltips();

      $('#showAll').addEventListener('click', ()=>{
        currentVisibilitySource = 'showAll';
        setListActionActive('showAll');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        visibleSet.clear();
        Object.keys(u.posts||{}).forEach(pid=>visibleSet.add(pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true });
        persistVisibility();
      });
      $('#hideAll').addEventListener('click', ()=>{
        currentVisibilitySource = 'hideAll';
        setListActionActive('hideAll');
        visibleSet.clear();
        resetAllCharts();
        refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true });
        persistVisibility();
      });
      $('#pastDay').addEventListener('click', ()=>{
        currentVisibilitySource = 'pastDay';
        setListActionActive('pastDay');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const now = Date.now();
        const cutoff = now - (24 * 60 * 60 * 1000);
        const useRecencyFallback = isVirtualUserKey(currentUserKey);
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>({
          pid,
          postTime: (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
          pidBI: pidBigInt(pid)
        }));
        const sorted = mapped.filter(x=>x.postTime>0 && x.postTime >= cutoff).sort((a,b)=>{
          const dt = b.postTime - a.postTime;
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        visibleSet.clear();
        sorted.forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true }); persistVisibility();
      });
      $('#pastWeek').addEventListener('click', ()=>{
        currentVisibilitySource = 'pastWeek';
        setListActionActive('pastWeek');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const now = Date.now();
        const cutoff = now - (7 * 24 * 60 * 60 * 1000);
        const useRecencyFallback = isVirtualUserKey(currentUserKey);
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>({
          pid,
          postTime: (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
          pidBI: pidBigInt(pid)
        }));
        const sorted = mapped.filter(x=>x.postTime>0 && x.postTime >= cutoff).sort((a,b)=>{
          const dt = b.postTime - a.postTime;
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        visibleSet.clear();
        sorted.forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true }); persistVisibility();
      });
      // Stacked view sliders
    function wireStackedRangeSlider(opts){
      const minEl = $(opts.minId);
      const maxEl = $(opts.maxId);
      const trackEl = $(opts.trackId);
      const labelEl = $(opts.labelId);
      if (!minEl || !maxEl || !trackEl || !labelEl) return;
      minEl.max = String(STACKED_WINDOW_MINUTES_MAX);
      maxEl.max = String(STACKED_WINDOW_MINUTES_MAX);
      const setThumbZ = (minTop)=>{
        if (minTop) {
          minEl.style.zIndex = '6';
          maxEl.style.zIndex = '5';
        } else {
          minEl.style.zIndex = '5';
          maxEl.style.zIndex = '6';
        }
      };
      const updateThumbPriority = ()=>{
        if (minEl.classList.contains('is-active') || maxEl.classList.contains('is-active')) return;
        setThumbZ(true);
      };
      const syncThumbZForPointer = (clientX)=>{
        const rect = trackEl.getBoundingClientRect();
        if (!rect.width) return;
        const minVal = parseInt(minEl.value);
        const maxVal = parseInt(maxEl.value);
        const minX = rect.left + (minVal / STACKED_WINDOW_MINUTES_MAX) * rect.width;
        const maxX = rect.left + (maxVal / STACKED_WINDOW_MINUTES_MAX) * rect.width;
        const minTop = Math.abs(clientX - minX) <= Math.abs(clientX - maxX);
        setThumbZ(minTop);
      };
      const setActiveThumb = (activeEl, otherEl)=>{
        activeEl.classList.add('is-active');
        otherEl.classList.remove('is-active');
        setThumbZ(activeEl === minEl);
      };
      const clearActiveThumb = ()=>{
        minEl.classList.remove('is-active');
        maxEl.classList.remove('is-active');
        updateThumbPriority();
      };
      const onInput = (isMin)=>{
        const rawMin = parseInt(minEl.value);
        const rawMax = parseInt(maxEl.value);
        let min = normalizeStackedWindowStartMinutes(rawMin, 0);
        let max = Number.isFinite(rawMax) ? Math.round(rawMax) : STACKED_WINDOW_MINUTES_DEFAULT;
        max = clamp(max, STACKED_WINDOW_MIN_GAP_MINUTES, STACKED_WINDOW_MINUTES_MAX);
        if (isMin) {
          if (min >= max) min = clamp(max - STACKED_WINDOW_MIN_GAP_MINUTES, 0, STACKED_WINDOW_MINUTES_MAX - STACKED_WINDOW_MIN_GAP_MINUTES);
        } else {
          if (max <= min) max = clamp(min + STACKED_WINDOW_MIN_GAP_MINUTES, STACKED_WINDOW_MIN_GAP_MINUTES, STACKED_WINDOW_MINUTES_MAX);
        }
        if (isMin && min !== rawMin) minEl.value = String(min);
        if (!isMin && max !== rawMax) maxEl.value = String(max);
        const persisted = saveStackedWindowRange(opts.minKey, opts.maxKey, min, max);
        minEl.value = String(persisted.min);
        maxEl.value = String(persisted.max);
        setStackedRangeUI(trackEl, labelEl, persisted.min, persisted.max);
        updateThumbPriority();
        opts.onChange(persisted.min, persisted.max);
      };
      minEl.addEventListener('focus', ()=> setActiveThumb(minEl, maxEl));
      maxEl.addEventListener('focus', ()=> setActiveThumb(maxEl, minEl));
      minEl.addEventListener('blur', clearActiveThumb);
      maxEl.addEventListener('blur', clearActiveThumb);
      trackEl.addEventListener('pointerdown', (e)=> syncThumbZForPointer(e.clientX), true);
      trackEl.addEventListener('pointermove', (e)=> syncThumbZForPointer(e.clientX), true);
      trackEl.addEventListener('pointerleave', updateThumbPriority);
      minEl.addEventListener('input', ()=> onInput(true));
      maxEl.addEventListener('input', ()=> onInput(false));
      const initialRange = normalizeStackedWindowRange(parseInt(minEl.value), parseInt(maxEl.value));
      minEl.value = String(initialRange.min);
      maxEl.value = String(initialRange.max);
      setStackedRangeUI(trackEl, labelEl, initialRange.min, initialRange.max);
      updateThumbPriority();
    }
      wireStackedRangeSlider({
        minId: '#interactionRateSliderMin',
        maxId: '#interactionRateSliderMax',
        trackId: '#interactionRateSliderTrack',
        labelId: '#interactionRateSliderValue',
        minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
        maxKey: STACKED_WINDOW_STORAGE_KEYS.interaction,
        onChange: (minMinutes, maxMinutes)=> updateInteractionRateStackedChart(minMinutes, maxMinutes)
      });
      wireStackedRangeSlider({
        minId: '#first24HoursSliderMin',
        maxId: '#first24HoursSliderMax',
        trackId: '#first24HoursSliderTrack',
        labelId: '#first24HoursSliderValue',
        minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.views,
        maxKey: STACKED_WINDOW_STORAGE_KEYS.views,
        onChange: (minMinutes, maxMinutes)=> updateFirst24HoursChart(minMinutes, maxMinutes)
      });
      wireStackedRangeSlider({
        minId: '#viewsPerPersonSliderMin',
        maxId: '#viewsPerPersonSliderMax',
        trackId: '#viewsPerPersonSliderTrack',
        labelId: '#viewsPerPersonSliderValue',
        minKey: STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
        maxKey: STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson,
        onChange: (minMinutes, maxMinutes)=> updateViewsPerPersonChart(minMinutes, maxMinutes)
      });
      $('#last5').addEventListener('click', ()=>{
        currentVisibilitySource = 'last5';
        setListActionActive('last5');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const useRecencyFallback = isVirtualUserKey(currentUserKey);
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>({
          pid,
          postTime: (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
          pidBI: pidBigInt(pid)
        }));
        const withTs = mapped.filter(x=>x.postTime>0).sort((a,b)=>b.postTime - a.postTime);
        const noTs = mapped.filter(x=>x.postTime<=0).sort((a,b)=>{
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        const sorted = withTs.concat(noTs);
        visibleSet.clear();
        sorted.slice(0, 5).forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true }); persistVisibility();
      });
      $('#last10').addEventListener('click', ()=>{
        currentVisibilitySource = 'last10';
        setListActionActive('last10');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const useRecencyFallback = isVirtualUserKey(currentUserKey);
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>({
          pid,
          postTime: (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0,
          pidBI: pidBigInt(pid)
        }));
        const withTs = mapped.filter(x=>x.postTime>0).sort((a,b)=>b.postTime - a.postTime);
        const noTs = mapped.filter(x=>x.postTime<=0).sort((a,b)=>{
          if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        const sorted = withTs.concat(noTs);
        visibleSet.clear();
        sorted.slice(0, 10).forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true }); persistVisibility();
      });
      $('#top5').addEventListener('click', ()=>{
        currentVisibilitySource = 'top5';
        setListActionActive('top5');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>{
          const last = latestSnapshot(p.snapshots);
          return {
            pid,
            views: num(last?.views),
            likes: num(last?.likes),
            postTime: getPostTimeStrict(p) || 0,
            pidBI: pidBigInt(pid)
          };
        });
        const sorted = mapped.sort((a,b)=>{
          if (!a || !b) return !a && !b ? 0 : (!a ? 1 : -1);
          const dl = b.likes - a.likes;
          if (dl !== 0) return dl;
          const dv = b.views - a.views;
          if (dv !== 0) return dv;
          const dt = (b.postTime || 0) - (a.postTime || 0);
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return b.pid.localeCompare(a.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        visibleSet.clear();
        sorted.slice(0, 5).forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true }); persistVisibility();
      });
      $('#top10').addEventListener('click', ()=>{
        currentVisibilitySource = 'top10';
        setListActionActive('top10');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>{
          const last = latestSnapshot(p.snapshots);
          return {
            pid,
            views: num(last?.views),
            likes: num(last?.likes),
            postTime: getPostTimeStrict(p) || 0,
            pidBI: pidBigInt(pid)
          };
        });
        const sorted = mapped.sort((a,b)=>{
          if (!a || !b) return !a && !b ? 0 : (!a ? 1 : -1);
          const dl = b.likes - a.likes;
          if (dl !== 0) return dl;
          const dv = b.views - a.views;
          if (dv !== 0) return dv;
          const dt = (b.postTime || 0) - (a.postTime || 0);
          if (dt !== 0) return dt;
          if (a.pidBI === b.pidBI) return b.pid.localeCompare(a.pid);
          return a.pidBI < b.pidBI ? 1 : -1;
        });
        visibleSet.clear();
        sorted.slice(0, 10).forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true }); persistVisibility();
      });
      $('#bottom5').addEventListener('click', ()=>{
        currentVisibilitySource = 'bottom5';
        setListActionActive('bottom5');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const isTopToday = isTopTodayKey(currentUserKey);
        const useRecencyFallback = isVirtualUserKey(currentUserKey);
        const now = Date.now();
        const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>{
          const postTime = (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0;
          const ageMs = postTime ? now - postTime : Infinity;
          const last = latestSnapshot(p.snapshots);
          return {
            pid,
            postTime,
            views: num(last?.views),
            likes: num(last?.likes),
            ageMs,
            pidBI: pidBigInt(pid)
          };
        });
        const picked = (function(){
          if (isTopToday){
            const sorted = mapped.slice().sort((a,b)=>{
              const dl = a.likes - b.likes;
              if (dl !== 0) return dl;
              const dv = a.views - b.views;
              if (dv !== 0) return dv;
              const dt = (a.postTime || 0) - (b.postTime || 0);
              if (dt !== 0) return dt;
              if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
              return a.pidBI < b.pidBI ? -1 : 1;
            });
            return sorted.slice(0, 5);
          }
          const olderThan24h = mapped.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
          const sortedOlder = olderThan24h.sort((a,b)=>{
            const dl = a.likes - b.likes;
            if (dl !== 0) return dl;
            const dv = a.views - b.views;
            if (dv !== 0) return dv;
            const dt = (a.postTime || 0) - (b.postTime || 0); // tie-break oldest first
            if (dt !== 0) return dt;
            if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
            return a.pidBI < b.pidBI ? -1 : 1; // final tie-break oldest-ish first
          });
          const sortedAll = mapped.slice().sort((a,b)=>{
            const dl = a.likes - b.likes;
            if (dl !== 0) return dl;
            const dv = a.views - b.views;
            if (dv !== 0) return dv;
            const dt = (a.postTime || 0) - (b.postTime || 0);
            if (dt !== 0) return dt;
            if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
            return a.pidBI < b.pidBI ? -1 : 1;
          });
          const out = [];
          for (const it of sortedOlder) {
            if (out.length >= 5) break;
            out.push(it);
          }
          if (out.length < 5) {
            const seen = new Set(out.map(p=>p.pid));
            for (const it of sortedAll) {
              if (out.length >= 5) break;
              if (seen.has(it.pid)) continue;
              out.push(it);
            }
          }
          return out;
        })();
        visibleSet.clear();
        picked.forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true }); persistVisibility();
      });
      $('#bottom10').addEventListener('click', ()=>{
        currentVisibilitySource = 'bottom10';
        setListActionActive('bottom10');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const isTopToday = isTopTodayKey(currentUserKey);
        const useRecencyFallback = isVirtualUserKey(currentUserKey);
        const now = Date.now();
        const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>{
          const postTime = (useRecencyFallback ? (getPostTimeStrict(p) || getPostTimeForRecency(p)) : getPostTimeStrict(p)) || 0;
          const ageMs = postTime ? now - postTime : Infinity;
          const last = latestSnapshot(p.snapshots);
          return {
            pid,
            postTime,
            views: num(last?.views),
            likes: num(last?.likes),
            ageMs,
            pidBI: pidBigInt(pid)
          };
        });
        const picked = (function(){
          if (isTopToday){
            const sorted = mapped.slice().sort((a,b)=>{
              const dl = a.likes - b.likes;
              if (dl !== 0) return dl;
              const dv = a.views - b.views;
              if (dv !== 0) return dv;
              const dt = (a.postTime || 0) - (b.postTime || 0);
              if (dt !== 0) return dt;
              if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
              return a.pidBI < b.pidBI ? -1 : 1;
            });
            return sorted.slice(0, 10);
          }
          const olderThan24h = mapped.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
          const sortedOlder = olderThan24h.sort((a,b)=>{
            const dl = a.likes - b.likes;
            if (dl !== 0) return dl;
            const dv = a.views - b.views;
            if (dv !== 0) return dv;
            const dt = (a.postTime || 0) - (b.postTime || 0);
            if (dt !== 0) return dt;
            if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
            return a.pidBI < b.pidBI ? -1 : 1;
          });
          const sortedAll = mapped.slice().sort((a,b)=>{
            const dl = a.likes - b.likes;
            if (dl !== 0) return dl;
            const dv = a.views - b.views;
            if (dv !== 0) return dv;
            const dt = (a.postTime || 0) - (b.postTime || 0);
            if (dt !== 0) return dt;
            if (a.pidBI === b.pidBI) return a.pid.localeCompare(b.pid);
            return a.pidBI < b.pidBI ? -1 : 1;
          });
          const out = [];
          for (const it of sortedOlder) {
            if (out.length >= 10) break;
            out.push(it);
          }
          if (out.length < 10) {
            const seen = new Set(out.map(p=>p.pid));
            for (const it of sortedAll) {
              if (out.length >= 10) break;
              if (seen.has(it.pid)) continue;
              out.push(it);
            }
          }
          return out;
        })();
        visibleSet.clear();
        picked.forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ skipRestoreZoom: true }); persistVisibility();
      });

      const staleBtn = $('#stale');
      if (staleBtn) staleBtn.addEventListener('click', ()=>{
        currentVisibilitySource = 'stale';
        setListActionActive('stale');
        const u = resolveUserForKey(metrics, currentUserKey);
        if (!u) return;
        const now = Date.now();
        const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
        const mapped = Object.entries(u.posts||{}).map(([pid,p])=>{
          const lastRefresh = lastRefreshMsForPost(p);
          const ageMs = lastRefresh ? now - lastRefresh : Infinity;
          return { pid, ageMs };
        });
        const stale = mapped.filter(x=>x.ageMs > TWENTY_FOUR_HOURS_MS);
        visibleSet.clear();
        stale.forEach(it=>visibleSet.add(it.pid));
        resetAllCharts();
        refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true }); persistVisibility();
      });

    // If compare section is empty on initial load, add current user to show who we're looking at
    if (compareUsers.size === 0 && currentUserKey && resolveUserForKey(metrics, currentUserKey)){
      addCompareUser(currentUserKey);
    }
    const initialUser = resolveUserForKey(metrics, currentUserKey);
    if (initialUser) {
      const initAction = normalizeFilterAction(getSessionFilterAction(currentUserKey))
        || normalizeFilterAction(currentVisibilitySource)
        || normalizeFilterAction(currentListActionId);
      setListActionActive(initAction || 'showAll');
      const didClick = triggerFilterClick(initAction);
      if (!didClick) {
        applyUserFilterState(currentUserKey, initialUser, initAction);
      }
      if (isMetricsPartial) {
        await refreshUserUI({ preserveEmpty: true });
      } else {
        await nextPaint();
        await refreshUserUI({ preserveEmpty: true });
      }
    } else {
      if (isMetricsPartial) {
        await refreshUserUI();
      } else {
        await nextPaint();
        await refreshUserUI();
      }
    }
    if (hasBootCache) {
      document.documentElement.classList.remove('is-booting');
    }

    try {
      const st = await prefsPromise;
      const prevUserKey = currentUserKey;
      if (st.lastUserKey && (metrics.users[st.lastUserKey] || isVirtualUserKey(st.lastUserKey))) {
        currentUserKey = st.lastUserKey;
      }
      zoomStates = st.zoomStates || {};
      zoomStatesLoaded = true;
      applyDefaultInteractionRateZoom(currentUserKey);
      if (st.lastFilterAction && (!lastFilterAction || lastFilterAction === 'showAll')) {
        lastFilterAction = st.lastFilterAction;
      }
      if (st.lastFilterActionByUser && typeof st.lastFilterActionByUser === 'object') {
        for (const [userKey, action] of Object.entries(st.lastFilterActionByUser)) {
          if (!lastFilterActionByUser[userKey]) lastFilterActionByUser[userKey] = action;
        }
      }
      const storedViewsType = normalizeViewsChartType(st?.[VIEWS_TYPE_STORAGE_KEY]);
      if (storedViewsType) {
        if (!viewsChartTypeLoaded && storedViewsType !== viewsChartType) {
          updateViewsType(storedViewsType);
        }
        viewsChartTypeLoaded = true;
      }
      const storedChartMode = normalizeChartMode(st?.[CHART_MODE_STORAGE_KEY]);
      if (storedChartMode) {
        if (!chartModeLoaded && storedChartMode !== chartsMode) {
          setGlobalChartMode(storedChartMode, { persist: false });
        }
        chartModeLoaded = true;
      } else {
        const legacyStoredMode = resolveLegacyChartMode({
          interaction: st?.[LEGACY_CHART_MODE_KEYS.interaction],
          views: st?.[LEGACY_CHART_MODE_KEYS.views],
          viewsPerPerson: st?.[LEGACY_CHART_MODE_KEYS.viewsPerPerson]
        });
        if (legacyStoredMode) {
          if (!chartModeLoaded && legacyStoredMode !== chartsMode) {
            setGlobalChartMode(legacyStoredMode, { persist: true });
          }
          chartModeLoaded = true;
        }
      }
      const storedInteractionMin = normalizeStackedWindowStartMinutes(st?.[STACKED_WINDOW_STORAGE_MIN_KEYS.interaction], null);
      const storedInteractionMax = normalizeStackedWindowMinutes(st?.[STACKED_WINDOW_STORAGE_KEYS.interaction], null);
      const storedViewsMin = normalizeStackedWindowStartMinutes(st?.[STACKED_WINDOW_STORAGE_MIN_KEYS.views], null);
      const storedViewsMax = normalizeStackedWindowMinutes(st?.[STACKED_WINDOW_STORAGE_KEYS.views], null);
      const storedVppMin = normalizeStackedWindowStartMinutes(st?.[STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson], null);
      const storedVppMax = normalizeStackedWindowMinutes(st?.[STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson], null);
      if (storedInteractionMin !== null || storedInteractionMax !== null) {
        const range = normalizeStackedWindowRange(
          storedInteractionMin ?? 0,
          storedInteractionMax ?? STACKED_WINDOW_MINUTES_DEFAULT
        );
        const minEl = $('#interactionRateSliderMin');
        const maxEl = $('#interactionRateSliderMax');
        const trackEl = $('#interactionRateSliderTrack');
        const labelEl = $('#interactionRateSliderValue');
        if (minEl) minEl.value = String(range.min);
        if (maxEl) maxEl.value = String(range.max);
        setStackedRangeUI(trackEl, labelEl, range.min, range.max);
        saveStackedWindowRange(
          STACKED_WINDOW_STORAGE_MIN_KEYS.interaction,
          STACKED_WINDOW_STORAGE_KEYS.interaction,
          range.min,
          range.max
        );
      }
      if (storedViewsMin !== null || storedViewsMax !== null) {
        const range = normalizeStackedWindowRange(
          storedViewsMin ?? 0,
          storedViewsMax ?? STACKED_WINDOW_MINUTES_DEFAULT
        );
        const minEl = $('#first24HoursSliderMin');
        const maxEl = $('#first24HoursSliderMax');
        const trackEl = $('#first24HoursSliderTrack');
        const labelEl = $('#first24HoursSliderValue');
        if (minEl) minEl.value = String(range.min);
        if (maxEl) maxEl.value = String(range.max);
        setStackedRangeUI(trackEl, labelEl, range.min, range.max);
        saveStackedWindowRange(
          STACKED_WINDOW_STORAGE_MIN_KEYS.views,
          STACKED_WINDOW_STORAGE_KEYS.views,
          range.min,
          range.max
        );
      }
      if (storedVppMin !== null || storedVppMax !== null) {
        const range = normalizeStackedWindowRange(
          storedVppMin ?? 0,
          storedVppMax ?? STACKED_WINDOW_MINUTES_DEFAULT
        );
        const minEl = $('#viewsPerPersonSliderMin');
        const maxEl = $('#viewsPerPersonSliderMax');
        const trackEl = $('#viewsPerPersonSliderTrack');
        const labelEl = $('#viewsPerPersonSliderValue');
        if (minEl) minEl.value = String(range.min);
        if (maxEl) maxEl.value = String(range.max);
        setStackedRangeUI(trackEl, labelEl, range.min, range.max);
        saveStackedWindowRange(
          STACKED_WINDOW_STORAGE_MIN_KEYS.viewsPerPerson,
          STACKED_WINDOW_STORAGE_KEYS.viewsPerPerson,
          range.min,
          range.max
        );
      }
      const storedBestTimePrefs = normalizeBestTimePrefs(st?.[BEST_TIME_PREFS_KEY]);
      if (storedBestTimePrefs) {
        bestTimePrefsFromStorage = storedBestTimePrefs;
        if (!bestTimePrefsLoaded) {
          if (storedBestTimePrefs.range) bestTimeRange = storedBestTimePrefs.range;
          if (storedBestTimePrefs.rec) bestTimeRec = storedBestTimePrefs.rec;
          bestTimePrefsLoaded = true;
          saveBestTimePrefs();
          if (bestTimeData) renderBestTimeWidget(bestTimeData, bestTimeRange);
        }
      }
      customVisibilityByUser = (function(raw){
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const [userKey, entry] of Object.entries(raw)){
          if (Array.isArray(entry)) out[userKey] = { ids: entry };
          else if (entry && typeof entry === 'object'){
            const ids = Array.isArray(entry.ids) ? entry.ids : [];
            out[userKey] = { ids };
          }
        }
        return out;
      })(st.customVisibilityByUser);
      const storageFilters = (function(raw){
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const [userKey, entry] of Object.entries(raw)){
          const filters = Array.isArray(entry?.filters) ? entry.filters : [];
          const normalized = [];
          for (const f of filters){
            if (!f || typeof f !== 'object') continue;
            const id = typeof f.id === 'string' && f.id ? f.id : null;
            const name = typeof f.name === 'string' && f.name ? f.name : null;
            const ids = Array.isArray(f.ids) ? f.ids.filter(Boolean) : [];
            if (!id || !name) continue;
            normalized.push({ id, name, ids });
          }
          out[userKey] = { filters: normalized };
        }
        return out;
      })(st.customFiltersByUser);
      const sessionFilters = (function(raw){
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const [userKey, entry] of Object.entries(raw)){
          const filters = Array.isArray(entry?.filters) ? entry.filters : [];
          const normalized = [];
          for (const f of filters){
            if (!f || typeof f !== 'object') continue;
            const id = typeof f.id === 'string' && f.id ? f.id : null;
            const name = typeof f.name === 'string' && f.name ? f.name : null;
            const ids = Array.isArray(f.ids) ? f.ids.filter(Boolean) : [];
            if (!id || !name) continue;
            normalized.push({ id, name, ids });
          }
          out[userKey] = { filters: normalized };
        }
        return out;
      })(sessionCustomFiltersByUser);
      const localFilters = (function(raw){
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const [userKey, entry] of Object.entries(raw)){
          const filters = Array.isArray(entry?.filters) ? entry.filters : [];
          const normalized = [];
          for (const f of filters){
            if (!f || typeof f !== 'object') continue;
            const id = typeof f.id === 'string' && f.id ? f.id : null;
            const name = typeof f.name === 'string' && f.name ? f.name : null;
            const ids = Array.isArray(f.ids) ? f.ids.filter(Boolean) : [];
            if (!id || !name) continue;
            normalized.push({ id, name, ids });
          }
          out[userKey] = { filters: normalized };
        }
        return out;
      })(localCustomFiltersByUser);
      customFiltersByUser = storageFilters;
      for (const [userKey, entry] of Object.entries(sessionFilters)){
        const existing = storageFilters[userKey];
        const existingCount = Array.isArray(existing?.filters) ? existing.filters.length : 0;
        const sessionCount = Array.isArray(entry?.filters) ? entry.filters.length : 0;
        if (!existing || sessionCount > existingCount) {
          customFiltersByUser[userKey] = entry;
        }
      }
      for (const [userKey, entry] of Object.entries(localFilters)){
        const existing = customFiltersByUser[userKey];
        const existingCount = Array.isArray(existing?.filters) ? existing.filters.length : 0;
        const localCount = Array.isArray(entry?.filters) ? entry.filters.length : 0;
        if (!existing || localCount > existingCount) {
          customFiltersByUser[userKey] = entry;
        }
      }
      if (currentUserKey !== prevUserKey) {
        await switchUserSelection(currentUserKey, { useStoredFilter: true });
      } else {
        refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true });
      }
      const restoreAction = normalizeFilterAction(getSessionFilterAction(currentUserKey));
      if (restoreAction && restoreAction !== normalizeFilterAction(currentVisibilitySource)) {
        const user = resolveUserForKey(metrics, currentUserKey);
        if (user) {
          const shouldRestore = (function(){
            if (restoreAction === 'custom') {
              const entry = getCustomVisibilityEntry(currentUserKey);
              return Array.isArray(entry?.ids) && entry.ids.length > 0;
            }
            if (isCustomFilterAction(restoreAction)) {
              const filterId = getCustomFilterId(restoreAction);
              if (!filterId) return false;
              return getCustomFiltersForUser(currentUserKey).some((f)=>f.id === filterId);
            }
            return true;
          })();
          if (shouldRestore) {
            applyUserFilterState(currentUserKey, user, restoreAction);
            await refreshUserUI({ preserveEmpty: true, skipRestoreZoom: true });
            persistVisibility();
          }
        }
      }
    } catch {}
    if (!isMetricsPartial) {
      saveSessionCache();
    }
    if (isMetricsPartial && !bestTimeData) {
      refreshData({ skipPostListRebuild: true, skipRestoreZoom: true })
        .catch(() => {});
    } else if (isMetricsPartial) {
      hydrateMetricsFromStorageInChunks();
    }
    await ultraModePromise;
    renderCustomFilters(currentUserKey);
    updateBestTimeToPostSection();
    initBestTimeTabs();
    initBestTimeGatherLink();
    initBestTimeInfoTooltip();
    initMetricsGatherLink();
    let autoRefreshInFlight = false;
    let autoRefreshTimer = null;
    const scheduleAutoRefresh = (delayMs, opts = {}) => {
      const { resetCountdown = true } = opts;
      if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
      if (resetCountdown) {
        nextAutoRefreshAt = Date.now() + delayMs;
        updateAutoRefreshCountdown(currentUserKey);
      }
      autoRefreshTimer = setTimeout(runAutoRefresh, delayMs);
    };
    const runAutoRefresh = () => {
      if (document.hidden) {
        scheduleAutoRefresh(1000, { resetCountdown: false });
        return;
      }
      if (autoRefreshInFlight) {
        scheduleAutoRefresh(1000, { resetCountdown: false });
        return;
      }
      autoRefreshInFlight = true;
      refreshData({ skipPostListRebuild: true, autoRefresh: true })
        .catch(() => {})
        .finally(() => {
          autoRefreshInFlight = false;
          scheduleAutoRefresh(AUTO_REFRESH_MS, { resetCountdown: true });
        });
    };
    startAutoRefreshCountdown();
    scheduleAutoRefresh(AUTO_REFRESH_MS, { resetCountdown: true });
    perfEnd(perfBoot);
    perfFlush('boot');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const bootCache = loadInstantCache();
    const bootApplied = hydrateBestTimeFromCache(bootCache);
    if (bootApplied) {
      document.documentElement.classList.remove('is-booting');
    }
    Promise.resolve(main(bootCache)).finally(() => {
      document.documentElement.classList.remove('is-booting');
    });
  }, { once:true });
})();
