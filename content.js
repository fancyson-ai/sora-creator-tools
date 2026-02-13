/*
 * Copyright (c) 2025 Will (fancyson-ai), Topher (cameoed), Skye (thecosmicskye)
 * Licensed under the MIT License. See the LICENSE file for details.
 */

(() => {
  const p = String(location.pathname || '');
  const isDraftDetail = p === '/d' || p.startsWith('/d/');
  const ULTRA_MODE_KEY = 'SCT_ULTRA_MODE_V1';
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
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.action === 'ultra_mode_changed') syncUltraModePreference();
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
    injectPageScript('uv-drafts-logic.js', () => {
      injectPageScript('uv-drafts-page.js', () => {
        injectPageScript('inject.js');
      });
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

  // Relay metrics batches from inject.js to background service worker (fire-and-forget).
  window.addEventListener('message', function(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'metrics_batch' || !Array.isArray(d.items)) return;
    try {
      chrome.runtime.sendMessage({ action: 'metrics_batch', items: d.items });
    } catch {}
  });

  // Relay metrics requests from inject.js to background and return the response.
  window.addEventListener('message', function(ev) {
    if (ev?.source !== window) return;
    const d = ev?.data;
    if (!d || d.__sora_uv__ !== true || d.type !== 'metrics_request') return;
    const req = d.req;
    try {
      chrome.runtime.sendMessage({
        action: 'metrics_request',
        scope: d.scope,
        postId: d.postId,
        windowHours: d.windowHours,
        snapshotMode: d.snapshotMode,
      }, (response) => {
        if (chrome.runtime.lastError || !response) {
          window.postMessage({ __sora_uv__: true, type: 'metrics_response', req, metrics: { users: {} }, metricsUpdatedAt: 0 }, '*');
          return;
        }
        window.postMessage({ __sora_uv__: true, type: 'metrics_response', req, metrics: response.metrics, metricsUpdatedAt: response.metricsUpdatedAt }, '*');
      });
    } catch {
      window.postMessage({ __sora_uv__: true, type: 'metrics_response', req, metrics: { users: {} }, metricsUpdatedAt: 0 }, '*');
    }
  });
})();
