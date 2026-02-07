/*
 * Copyright (c) 2025 Will (fancyson-ai), Topher (cameoed), Skye (thecosmicskye)
 * Licensed under the MIT License. See the LICENSE file for details.
 */

(function () {
  'use strict';

  // Idempotency guard (SPA + extension reload safety)
  if (window.__sct_api__?.installed) return;
  window.__sct_api__ = window.__sct_api__ || {};
  window.__sct_api__.installed = true;

  const DEBUG = false;
  const dlog = (...args) => {
    try {
      if (DEBUG) console.log('[SCT][api]', ...args);
    } catch {}
  };

  const NF_CREATE_RE = /\/backend\/nf\/create/i;
  const SUBSCRIPTIONS_RE = /\/backend\/billing\/subscriptions/i;
  const DURATION_OVERRIDE_KEY = 'SCT_DURATION_OVERRIDE_V1'; // stored in sora.chatgpt.com localStorage
  const GENS_COUNT_KEY = 'SCT_GENS_COUNT_V1'; // stored in sora.chatgpt.com localStorage
  const UV_TASK_TO_DRAFT_KEY = 'SORA_UV_TASK_TO_DRAFT_V1'; // task_id -> source draft ID (draft remix redo)
  const UV_REDO_PROMPT_KEY = 'SORA_UV_REDO_PROMPT';
  const PLAN_FREE_KEY = 'SCT_PLAN_FREE_V1';
  const COMPOSER_TEXTAREA_SELECTOR =
    'textarea[placeholder="Describe your video..."], textarea[placeholder^="Describe changes"], textarea[placeholder*="Describe changes"]';

  const isStoryboardRoute = () => {
    try {
      return /(^|\/)storyboard(\/|$)/i.test(String(location?.pathname || ''));
    } catch {
      return false;
    }
  };

  const isRemixEmptyQuery = () => {
    try {
      // Requirement: URL ends with `?remix=` AND path contains `/p/` (but not e.g. `/d/`).
      const search = String(location?.search || '');
      // Match `?remix`, `?remix=`, or `&remix`/`&remix=` as a query parameter.
      if (!/(?:[?&])remix(?:=|&|$)/i.test(search)) return false;
      return /\/p\//i.test(String(location?.pathname || ''));
    } catch {
      return false;
    }
  };

  const isRemixRoute = () => {
    try {
      return String(location?.search || '').includes('remix');
    } catch {
      return false;
    }
  };

  const getDraftIdFromDraftRoute = () => {
    try {
      const m = String(location?.pathname || '').match(/^\/d\/([A-Za-z0-9_-]+)/i);
      return m && m[1] ? String(m[1]) : null;
    } catch {
      return null;
    }
  };

  const isDraftRemixRoute = () => {
    return !!getDraftIdFromDraftRoute() && isRemixRoute();
  };

  function saveTaskToSourceDraft(taskId, sourceDraftId) {
    if (!taskId || !sourceDraftId) return;
    try {
      const raw = localStorage.getItem(UV_TASK_TO_DRAFT_KEY) || '{}';
      const data = safeJsonParse(raw) || {};
      if (!data || typeof data !== 'object') return;
      data[String(taskId)] = String(sourceDraftId);
      localStorage.setItem(UV_TASK_TO_DRAFT_KEY, JSON.stringify(data));
    } catch {}
  }

  function checkPendingRedoPrompt() {
    const pendingPrompt = sessionStorage.getItem(UV_REDO_PROMPT_KEY);
    if (!pendingPrompt) return;

    // Only apply on remix pages to avoid stomping the primary prompt box.
    if (!isRemixRoute()) return;

    // Clear it immediately to prevent re-triggering.
    sessionStorage.removeItem(UV_REDO_PROMPT_KEY);

    const attemptFill = (retries = 0) => {
      const textarea =
        document.querySelector('textarea[placeholder="Describe changes..."]') ||
        document.querySelector('textarea[placeholder^="Describe changes"]') ||
        document.querySelector('textarea[placeholder*="Describe changes"]');

      if (textarea) {
        try {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
            .set;
          nativeInputValueSetter.call(textarea, pendingPrompt);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          textarea.focus();
          textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {}
        return;
      }

      if (retries < 30) setTimeout(() => attemptFill(retries + 1), 100);
    };

    // Start attempting after a short delay for page render.
    setTimeout(() => attemptFill(), 300);
  }

  let __sct_videoGensRaf = 0;
  let __sct_keepSettingsOpenToken = 0;

  const unhideEl = (el) => {
    if (!el) return;
    try {
      el.hidden = false;
      el.removeAttribute('aria-hidden');
      if (el.style && el.style.display === 'none') el.style.display = '';
      if (el.style && el.style.visibility === 'hidden') el.style.visibility = '';
    } catch {}
  };

  const isVisibleEl = (el) => {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (!el.getClientRects || el.getClientRects().length === 0) return false;
      const style = window.getComputedStyle ? getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
      return true;
    } catch {
      return false;
    }
  };

  const getSettingsTriggerButtons = () => {
    try {
      return Array.from(document.querySelectorAll('button[aria-label="Settings"][aria-haspopup="menu"]'));
    } catch {
      return [];
    }
  };

  const isInSidebar = (el) => {
    try {
      if (!el || !el.closest) return false;
      return !!el.closest('[class*="w-[var(--sidebar-width)]"]');
    } catch {
      return false;
    }
  };

  const getComposerRoots = () => {
    try {
      const roots = new Set();
      const textareas = Array.from(document.querySelectorAll(COMPOSER_TEXTAREA_SELECTOR));
      for (const textarea of textareas) {
        let n = textarea;
        for (let i = 0; i < 16 && n; i++, n = n.parentElement) {
          if (n.querySelector && n.querySelector('.bg-token-bg-composer')) {
            roots.add(n);
            break;
          }
          if (n.querySelectorAll) {
            const settingsButtons = Array.from(
              n.querySelectorAll('button[aria-label="Settings"][aria-haspopup="menu"]')
            );
            if (settingsButtons.some((btn) => !isInSidebar(btn))) {
              roots.add(n);
              break;
            }
          }
        }
      }
      return Array.from(roots);
    } catch {
      return [];
    }
  };

  const isWithinComposer = (el, roots) => {
    try {
      if (!el || !roots || !roots.length) return false;
      return roots.some((root) => root && root.contains && root.contains(el));
    } catch {
      return false;
    }
  };

  const getComposerSettingsButtons = (roots) => {
    try {
      const list = [];
      (roots || []).forEach((root) => {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('button[aria-label="Settings"][aria-haspopup="menu"]').forEach((btn) => {
          if (!isInSidebar(btn)) list.push(btn);
        });
      });
      return list;
    } catch {
      return [];
    }
  };

  const findSettingsTriggerButton = () => {
    try {
      const allButtons = getSettingsTriggerButtons();
      if (!allButtons.length) return null;
      const roots = getComposerRoots();
      const buttons = roots.length ? getComposerSettingsButtons(roots) : allButtons;
      const candidates = buttons.length ? buttons : allButtons;
      const expanded = candidates.find((btn) => btn.getAttribute('aria-expanded') === 'true');
      if (expanded) return expanded;
      const visible = candidates.find((btn) => isVisibleEl(btn));
      return visible || candidates[0] || null;
    } catch {
      return null;
    }
  };

  const getSettingsRootMenuFromMenuEl = (menuEl) => {
    try {
      if (!menuEl) return null;
      if (menuEl.querySelector && menuEl.querySelector('[data-sct-duration-menuitem="1"]')) return menuEl;
      const labelledBy = menuEl.getAttribute && menuEl.getAttribute('aria-labelledby');
      if (!labelledBy) return null;
      const labelEl = document.getElementById(labelledBy);
      const parentMenu = labelEl && labelEl.closest && labelEl.closest('[data-radix-menu-content][role="menu"]');
      if (!parentMenu) return null;
      return getSettingsRootMenuFromMenuEl(parentMenu);
    } catch {
      return null;
    }
  };

  const keepSettingsMenuOpenSoon = () => {
    const trigger = findSettingsTriggerButton();
    if (!trigger) return;

    const token = Date.now();
    __sct_keepSettingsOpenToken = token;

    const ensure = () => {
      try {
        if (__sct_keepSettingsOpenToken !== token) return;
        if (trigger.getAttribute('aria-expanded') !== 'true') {
          trigger.click();
        } else {
          // Occasionally Radix leaves the menu mounted but hidden.
          const rootMenu = document.querySelector('[data-radix-menu-content][role="menu"][data-state="open"]');
          if (rootMenu) unhideEl(rootMenu);
        }
      } catch {}
    };

    // Run after Radix selection handling.
    setTimeout(ensure, 0);
    requestAnimationFrame(ensure);
  };

  const findOpenSettingsRootMenuEl = () => {
    try {
      const openMenus = Array.from(document.querySelectorAll('[data-radix-menu-content][role="menu"][data-state="open"]'));
      // Prefer the top-level settings menu (contains the Duration menu item).
      const preferred = openMenus.find((m) => m.querySelector && m.querySelector('[data-sct-duration-menuitem="1"]'));
      if (preferred) return preferred;
      return openMenus.find((m) => (m.textContent || '').includes('Duration')) || null;
    } catch {
      return null;
    }
  };

  const getSettingsValueText = (label, menuEl) => {
    try {
      const menu = menuEl || findOpenSettingsRootMenuEl();
      if (!menu) return null;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]'));
      const mi = items.find((el) => (el.textContent || '').includes(label));
      if (!mi) return null;
      const valueEl = findDurationMenuValueEl(mi);
      const t = (valueEl?.textContent || '').trim();
      return t || null;
    } catch {
      return null;
    }
  };

  const getSoraSettings = (menuEl) => {
    const modelText = getSettingsValueText('Model', menuEl) || '';
    const resolutionText = getSettingsValueText('Resolution', menuEl) || '';
    const model = /sora\s*2\s*pro/i.test(modelText) ? 'sora2pro' : /sora\s*2/i.test(modelText) ? 'sora2' : null;
    const resolution = /high/i.test(resolutionText) ? 'high' : /standard/i.test(resolutionText) ? 'standard' : null;
    return { model, resolution };
  };

  const getGenCost = (seconds, settings) => {
    const s = Number(seconds);
    if (!Number.isFinite(s)) return null;
    const model = settings?.model || null;
    const resolution = settings?.resolution || null;

    if (model === 'sora2') {
      const costs = { 5: 1, 10: 1, 15: 2, 25: 3 };
      return costs[s] ?? null;
    }

    if (model === 'sora2pro') {
      if (resolution === 'high') {
        const costs = { 5: 5, 10: 5, 15: 10, 25: null };
        return costs[s] ?? null;
      }
      // Default to Standard if not present/unknown.
      const costs = { 5: 2, 10: 2, 15: 4, 25: 12 };
      return costs[s] ?? null;
    }

    // Fallback: keep old behavior.
    if (s === 25) return 3;
    if (s === 15) return 2;
    return 1;
  };

  const shouldOffer25s = (settings) => {
    if (planIsFree === true) return false;
    // We allow 25s for all paid plans, including Sora 2 Pro + High (the backend may still reject
    // unsupported combinations; this controls UI injection + request rewriting only).
    void settings;
    return true;
  };

  function ensureVideoGensWarning(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    const menu = findOpenSettingsRootMenuEl();
    const settings = getSoraSettings(menu);
    const desiredCount = getGenCost(seconds, settings);
    const forceShow = true;

    const removeInjectedHelperFromMenu = (menu) => {
      if (!menu) return;
      try {
        const injected = menu.querySelectorAll('[data-sct-video-gens="1"],[data-sct-video-gens-sep="1"]');
        injected.forEach((el) => el.remove());
      } catch {}
    };

    const findNativeHelperRowInMenu = (menu) => {
      if (!menu) return null;
      try {
        const anchors = Array.from(menu.querySelectorAll('a')).filter((a) => {
          const href = String(a.getAttribute && a.getAttribute('href') ? a.getAttribute('href') : '');
          return /help\.openai\.com\/en\/articles\/12642688/i.test(href);
        });

        for (const a of anchors) {
          let n = a;
          for (let i = 0; i < 12 && n; i++, n = n.parentElement) {
            const t = (n.textContent || '').trim();
            if (!t) continue;
            if (!/video\s+gens\s+you're\s+using/i.test(t)) continue;
            const countEl = n.querySelector && n.querySelector('.font-medium');
            if (countEl) return n;
          }
        }
      } catch {}
      return null;
    };

    const ensureHelperRowInMenu = () => {
      if (!forceShow) return null;
      const menu = findOpenSettingsRootMenuEl();
      if (!menu) return null;

      try {
        const existingInjected = menu.querySelector && menu.querySelector('[data-sct-video-gens="1"]');
        if (existingInjected) {
          unhideEl(existingInjected);
          return existingInjected;
        }
      } catch {}

      try {
        // If Sora already rendered the native helper row, don't inject another.
        const native = findNativeHelperRowInMenu(menu);
        if (native) return null;
      } catch {}

      try {
        const sep = document.createElement('div');
        sep.setAttribute('role', 'separator');
        sep.setAttribute('aria-orientation', 'horizontal');
        sep.className = 'my-1.5 h-px bg-token-bg-light mx-3';
        sep.dataset.sctVideoGensSep = '1';

        const row = document.createElement('div');
        row.className = 'flex max-w-[250px] items-center gap-3 px-3 pb-1.5 pt-2 text-token-text-tertiary';
        row.dataset.sctVideoGens = '1';
        row.innerHTML = `
          <div class="flex-1 text-xs leading-[18px]">
            Video gens you're using with current settings.
            <a href="https://help.openai.com/en/articles/12642688" target="_blank" rel="noreferrer noopener" class="font-semibold hover:underline">Learn more</a>
          </div>
          <div class="flex shrink-0 flex-col items-end">
            <div class="flex items-center gap-[3px]">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" class="h-5 w-5">
                <path fill="currentColor" fill-rule="evenodd" d="M7.57 1.387c.9-.04 1.746.373 2.318 1.068 1.032-.36 2.204-.085 3.007.8.811.894 1.03 2.169.682 3.27.814.78 1.187 2.01.898 3.202-.288 1.181-1.165 2.057-2.235 2.303-.206 1.132-.976 2.129-2.112 2.465-.573.169-1.212.113-1.803.113a2.83 2.83 0 0 1-2.062-.902l-1.248-.025c-2.034 0-3.135-2.498-2.593-4.216-.813-.78-1.185-2.01-.896-3.2.288-1.184 1.169-2.063 2.242-2.307.714-2.307 1.943-2.522 3.801-2.575zM9.247 3.39c-.418-.704-1.162-1.055-1.89-.909l-.144.036c-.784.232-1.356 1.01-1.404 1.935a.53.53 0 0 1-.499.503c-.757.047-1.484.629-1.71 1.561-.229.938.139 1.876.802 2.354a.53.53 0 0 1 .173.653c-.374.816-.245 1.835.358 2.5.591.651 1.455.767 2.141.385l.097-.042a.53.53 0 0 1 .62.235c.446.75 1.263 1.1 2.034.873.784-.231 1.358-1.01 1.404-1.936a.533.533 0 0 1 .5-.504c.757-.046 1.484-.627 1.711-1.559.228-.938-.14-1.876-.805-2.355a.53.53 0 0 1-.172-.654c.374-.815.246-1.832-.357-2.496-.592-.652-1.457-.77-2.143-.387a.53.53 0 0 1-.716-.193" clip-rule="evenodd"></path>
              </svg>
              <div class="font-medium">${String(desiredCount ?? '')}</div>
            </div>
          </div>
        `;

        menu.appendChild(sep);
        menu.appendChild(row);
        return row;
      } catch {
        return null;
      }
    };

    const findWarningRoot = () => {
      try {
        const menu = findOpenSettingsRootMenuEl();
        if (menu) {
          // Prefer Sora's native helper row when available (prevents duplicates).
          const native = findNativeHelperRowInMenu(menu);
          if (native) return native;
          const injected = menu.querySelector && menu.querySelector('[data-sct-video-gens="1"]');
          if (injected) return injected;
        }

        const anchors = Array.from(document.querySelectorAll('a')).filter((a) => {
          const t = (a.textContent || '').trim();
          const href = String(a.getAttribute && a.getAttribute('href') ? a.getAttribute('href') : '');
          return /learn\s+more/i.test(t) || /help\.openai\.com\/en\/articles\/12642688/i.test(href);
        });

        for (const a of anchors) {
          let n = a;
          for (let i = 0; i < 14 && n; i++, n = n.parentElement) {
            const t = (n.textContent || '').trim();
            if (!t) continue;
            if (!/video\s+gens\s+you're\s+using/i.test(t)) continue;
            const countEl = n.querySelector && n.querySelector('.font-medium');
            if (countEl && /^\s*\d+\s*$/.test((countEl.textContent || '').trim())) return n;

            // If the immediate container is just the left text column, prefer a parent that also contains the count.
            const parent = n.parentElement;
            const parentCountEl = parent && parent.querySelector && parent.querySelector('.font-medium');
            if (parentCountEl && /^\s*\d+\s*$/.test((parentCountEl.textContent || '').trim())) return parent;
          }
        }

        // Fallback: find any node with the text and a count element.
        const candidates = Array.from(document.querySelectorAll('div')).filter((el) => {
          const t = (el.textContent || '').trim();
          if (!t) return false;
          if (!/video\s+gens\s+you're\s+using/i.test(t)) return false;
          const countEl = el.querySelector && el.querySelector('.font-medium');
          return !!(countEl && /^\s*\d+\s*$/.test((countEl.textContent || '').trim()));
        });
        return candidates[0] || null;
      } catch {
        return null;
      }
    };

    const applyToRoot = (root) => {
      if (!root) return false;
      try {
        // Ensure visible (20/25 should always show this helper row).
        if (forceShow) {
          let n = root;
          for (let i = 0; i < 10 && n; i++, n = n.parentElement) unhideEl(n);
        }

        const countEls = Array.from(root.querySelectorAll('.font-medium'));
        const countEl = countEls[countEls.length - 1];
        if (!countEl) return false;
        // If we can't estimate cost (new/unsupported durations), show a placeholder rather than
        // blanking or leaving a stale value from the last supported selection.
        if (desiredCount == null) {
          countEl.textContent = '?';
          return true;
        }
        countEl.textContent = String(desiredCount);
        return true;
      } catch {
        return false;
      }
    };

    const tryApply = () => applyToRoot(findWarningRoot());

    // If the native helper exists, ensure we don't have our injected one too.
    try {
      const menu = findOpenSettingsRootMenuEl();
      const native = menu && findNativeHelperRowInMenu(menu);
      if (native) removeInjectedHelperFromMenu(menu);
    } catch {}

    if (tryApply()) return true;

    // If Sora doesn't render the helper row for some selections, inject it.
    if (forceShow) {
      try {
        ensureHelperRowInMenu();
      } catch {}
      return tryApply();
    }

    return false;
  }

  function scheduleVideoGensWarning(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    try {
      if (__sct_videoGensRaf) cancelAnimationFrame(__sct_videoGensRaf);
    } catch {}

    ensureVideoGensWarning(seconds);
    __sct_videoGensRaf = requestAnimationFrame(() => {
      try {
        ensureVideoGensWarning(seconds);
      } catch {}
    });
  }

  // Duration override is enforced by rewriting `n_frames` on create requests.
  // Sora uses 30fps, so `frames = seconds * 30`.
  const SCT_FPS = 30;
  const DURATION_FRAMES_MIN = 5 * SCT_FPS;
  const DURATION_FRAMES_MAX = 60 * SCT_FPS;
  const DURATION_TICK_SECONDS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

  function clampInt(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    const i = Math.round(n);
    return i < min ? min : i > max ? max : i;
  }

  function framesToSeconds(frames) {
    const f = Number(frames);
    if (!Number.isFinite(f)) return 0;
    return f / SCT_FPS;
  }

  function secondsToFrames(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s)) return DURATION_FRAMES_MIN;
    return clampInt(s * SCT_FPS, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
  }

  function formatSecondsShort(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const roundedInt = Math.round(s);
    if (Math.abs(s - roundedInt) < 1e-6) return `${roundedInt}s`;
    const fixed = s.toFixed(2);
    return `${fixed.replace(/\.?0+$/, '')}s`;
  }

  function parseTimeToSeconds(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    // Accept mm:ss(.sss) / m:ss(.sss)
    const colon = raw.match(/^(\d+)\s*:\s*(\d+(?:\.\d+)?)\s*s?$/i);
    if (colon) {
      const m = Number(colon[1]);
      const s = Number(colon[2]);
      if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
      return m * 60 + s;
    }

    // Accept plain seconds with optional suffix.
    const simple = raw.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?$/i);
    if (simple) {
      const s = Number(simple[1]);
      return Number.isFinite(s) ? s : null;
    }

    return null;
  }

  const GENS_COUNT_MIN = 1;
  const GENS_COUNT_MAX_DEFAULT = 10;
  const GENS_COUNT_MAX_ULTRA = 40;
  const ULTRA_MODE_KEY = 'SCT_ULTRA_MODE_V1';

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  function loadPlanIsFree() {
    try {
      const raw = localStorage.getItem(PLAN_FREE_KEY);
      if (raw == null) return null;
      if (raw === '1' || raw === 'true') return true;
      if (raw === '0' || raw === 'false') return false;
      return null;
    } catch {
      return null;
    }
  }

  let planIsFree = loadPlanIsFree();
  function setPlanIsFree(next) {
    if (typeof next !== 'boolean') return;
    if (planIsFree === next) return;
    planIsFree = next;
    try {
      localStorage.setItem(PLAN_FREE_KEY, next ? '1' : '0');
    } catch {}
    try {
      window.dispatchEvent(new Event('sct_plan_status'));
    } catch {}
  }

  function extractPlanIsFree(json) {
    try {
      const data = json?.data;
      if (!Array.isArray(data)) return null;
      const isFree = data.some((sub) => {
        const planId = String(sub?.plan?.id || sub?.id || '');
        const title = String(sub?.plan?.title || '');
        return planId === 'chatgpt_free' || /chatgpt\s*free/i.test(title);
      });
      if (isFree) return true;
      if (data.length > 0) return false;
      return null;
    } catch {
      return null;
    }
  }

  function loadUltraModeFromStorage() {
    try {
      const raw = localStorage.getItem(ULTRA_MODE_KEY);
      if (!raw) return false;
      const parsed = safeJsonParse(raw);
      if (parsed && typeof parsed === 'object') return !!parsed.enabled;
      if (typeof raw === 'string') return raw === '1' || raw === 'true';
      return !!raw;
    } catch {
      return false;
    }
  }

  function getGensCountMax() {
    return loadUltraModeFromStorage() ? GENS_COUNT_MAX_ULTRA : GENS_COUNT_MAX_DEFAULT;
  }

  function clampGensCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return GENS_COUNT_MIN;
    const max = getGensCountMax();
    return Math.min(max, Math.max(GENS_COUNT_MIN, Math.round(n)));
  }

  function getGensFillPercent(value) {
    const n = clampGensCount(value);
    const range = getGensCountMax() - GENS_COUNT_MIN;
    if (range <= 0) return 100;
    const pct = ((n - GENS_COUNT_MIN) / range) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  function loadGensCountFromStorage() {
    try {
      const raw = localStorage.getItem(GENS_COUNT_KEY);
      if (!raw) return GENS_COUNT_MIN;
      const parsed = safeJsonParse(raw);
      const v = parsed && typeof parsed === 'object' ? parsed.count : raw;
      return clampGensCount(v);
    } catch {
      return GENS_COUNT_MIN;
    }
  }

  function syncGensControlUI() {
    try {
      const max = getGensCountMax();
      if (gensCount > max) {
        gensCount = max;
        try {
          localStorage.setItem(GENS_COUNT_KEY, JSON.stringify({ count: max, setAt: Date.now() }));
        } catch {}
      }
      const controls = document.querySelectorAll('[data-sct-gens-control="1"]');
      controls.forEach((control) => {
        const labelEl = control.querySelector('[data-sct-gens-label="1"]');
        if (labelEl) labelEl.textContent = `Gens ${gensCount}`;
        const valueEl = control.querySelector('[data-sct-gens-value="1"]');
        if (valueEl) valueEl.textContent = String(gensCount);
        const slider = control.querySelector('input[type="range"][data-sct-gens-slider="1"]');
        if (slider) {
          slider.max = String(max);
          slider.value = String(gensCount);
        }
        const maxLabel = control.querySelector('[data-sct-gens-max="1"]');
        if (maxLabel) maxLabel.textContent = String(max);
        const fill = control.querySelector('[data-sct-gens-fill="1"]');
        if (fill) fill.style.width = `${getGensFillPercent(gensCount)}%`;
      });
    } catch {}
  }

  function writeGensCount(next) {
    const clamped = clampGensCount(next);
    gensCount = clamped;
    try {
      localStorage.setItem(GENS_COUNT_KEY, JSON.stringify({ count: clamped, setAt: Date.now() }));
    } catch {}
    syncGensControlUI();
  }

  let gensCount = loadGensCountFromStorage();
  function getGensCount() {
    return gensCount;
  }

  function loadDurationOverrideFromStorage() {
    try {
      const raw = localStorage.getItem(DURATION_OVERRIDE_KEY);
      if (!raw) return null;
      const v = safeJsonParse(raw);
      if (!v || typeof v !== 'object') return null;
      const seconds = Number(v.seconds);
      const frames = Number(v.frames);
      if (!Number.isFinite(seconds) || !Number.isFinite(frames)) return null;
      if (seconds <= 0 || frames <= 0) return null;
      return { seconds, frames };
    } catch {
      return null;
    }
  }

  let durationOverride = loadDurationOverrideFromStorage();
  function getDurationOverride() {
    return durationOverride;
  }

  function writeDurationOverride(next) {
    try {
      localStorage.setItem(
        DURATION_OVERRIDE_KEY,
        JSON.stringify({ seconds: next.seconds, frames: next.frames, setAt: Date.now() })
      );
    } catch {}
    durationOverride = { seconds: next.seconds, frames: next.frames };
  }

  function clearDurationOverride() {
    try {
      localStorage.removeItem(DURATION_OVERRIDE_KEY);
    } catch {}
    durationOverride = null;
  }

  function rewriteNFramesInBodyString(bodyString, frames) {
    if (typeof bodyString !== 'string') return bodyString;

    // Common case: JSON string body containing `n_frames`
    const parsed = safeJsonParse(bodyString);
    if (parsed && typeof parsed === 'object') {
      // Direct payload: { ..., n_frames: 300, ... }
      if (Object.prototype.hasOwnProperty.call(parsed, 'n_frames')) {
        parsed.n_frames = frames;
        return JSON.stringify(parsed);
      }

      // Wrapped payload: { body: "{\"n_frames\":300,...}", ... }
      if (typeof parsed.body === 'string') {
        const inner = safeJsonParse(parsed.body);
        if (inner && typeof inner === 'object' && Object.prototype.hasOwnProperty.call(inner, 'n_frames')) {
          inner.n_frames = frames;
          parsed.body = JSON.stringify(inner);
          return JSON.stringify(parsed);
        }
      }
    }

    // Fallback: best-effort replacement
    try {
      const replaced = bodyString.replace(/(\\?"n_frames\\?"\s*:\s*)\d+/i, `$1${frames}`);
      return replaced;
    } catch {
      return bodyString;
    }
  }

  let __sct_openGensControl = null;
  let __sct_gensListenersInstalled = false;

  function setGensControlOpen(control, open) {
    if (!control) return;
    try {
      const panel = control.querySelector('[data-sct-gens-panel="1"]');
      const button = control.querySelector('[data-sct-gens-button="1"]');
      if (!panel || !button) return;
      panel.hidden = !open;
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      panel.dataset.state = open ? 'open' : 'closed';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.dataset.state = open ? 'open' : 'closed';
      if (open) {
        requestAnimationFrame(() => positionGensPanel(control));
      }
    } catch {}
  }

  function ensureGensControlListeners() {
    if (__sct_gensListenersInstalled) return;
    __sct_gensListenersInstalled = true;

    document.addEventListener(
      'pointerdown',
      (ev) => {
        try {
          if (!__sct_openGensControl) return;
          if (!document.contains(__sct_openGensControl)) {
            __sct_openGensControl = null;
            return;
          }
          if (__sct_openGensControl.contains(ev.target)) return;
          setGensControlOpen(__sct_openGensControl, false);
          __sct_openGensControl = null;
        } catch {}
      },
      true
    );

    document.addEventListener(
      'keydown',
      (ev) => {
        try {
          if (!__sct_openGensControl) return;
          const key = ev && (ev.key || ev.code);
          if (key !== 'Escape' && key !== 'Esc') return;
          setGensControlOpen(__sct_openGensControl, false);
          __sct_openGensControl = null;
        } catch {}
      },
      true
    );

    window.addEventListener(
      'resize',
      () => {
        try {
          if (!__sct_openGensControl) return;
          positionGensPanel(__sct_openGensControl);
        } catch {}
      },
      { passive: true }
    );

    window.addEventListener(
      'sct_ultra_mode',
      () => {
        try {
          syncGensControlUI();
        } catch {}
      },
      false
    );
  }

  function ensureGensControlStyles() {
    if (document.getElementById('sct-gens-control-style')) return;
    const st = document.createElement('style');
    st.id = 'sct-gens-control-style';
    st.textContent = `
      [data-sct-gens-control="1"] input[type="range"] {
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        outline: none;
      }
      [data-sct-gens-control="1"] input[type="range"]::-webkit-slider-runnable-track {
        height: 8px;
        background: transparent;
        border: none;
      }
      [data-sct-gens-control="1"] input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: rgb(var(--bg-inverse));
        border: 2px solid rgba(var(--bg-inverse), 0.85);
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.24), 0 0 0 2px rgba(0, 0, 0, 0.08);
        margin-top: -5px;
      }
      [data-sct-gens-control="1"] input[type="range"]::-moz-range-track {
        height: 8px;
        background: transparent;
        border: none;
      }
      [data-sct-gens-control="1"] input[type="range"]::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: rgb(var(--bg-inverse));
        border: 2px solid rgba(var(--bg-inverse), 0.85);
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.24), 0 0 0 2px rgba(0, 0, 0, 0.08);
        cursor: pointer;
      }
    `;
    document.head.appendChild(st);
  }

  function positionGensPanel(control) {
    try {
      const panel = control.querySelector('[data-sct-gens-panel="1"]');
      if (!panel || panel.hidden) return;
      panel.style.transform = 'translateX(0)';
      panel.style.left = '0';
      panel.style.right = 'auto';

      const margin = 12;
      const rect = panel.getBoundingClientRect();
      let shift = 0;
      if (rect.right > window.innerWidth - margin) {
        shift -= rect.right - (window.innerWidth - margin);
      }
      if (rect.left + shift < margin) {
        shift += margin - (rect.left + shift);
      }
      if (shift) panel.style.transform = `translateX(${shift}px)`;
    } catch {}
  }

  function buildGensControl() {
    ensureGensControlStyles();

    const wrapper = document.createElement('div');
    wrapper.dataset.sctGensControl = '1';
    wrapper.className = 'relative flex items-center';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sctGensButton = '1';
    button.setAttribute('aria-label', 'Number of gens');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.dataset.state = 'closed';
    button.className =
      'justify-center whitespace-nowrap text-sm font-semibold focus-visible:outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50 group/button relative bg-token-bg-composer-button data-[disabled=false]:hover:bg-token-bg-active disabled:opacity-50 disabled:text-token-text-primary/40 px-3 py-2 h-9 rounded-full flex shrink-0 items-center gap-1';

    const label = document.createElement('span');
    label.dataset.sctGensLabel = '1';
    label.textContent = `Gens ${gensCount}`;
    label.style.display = 'inline-block';
    label.style.width = '6ch';
    label.style.textAlign = 'center';
    button.appendChild(label);

    const arrow = document.createElement('span');
    arrow.className = 'flex items-center';
    arrow.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
    button.appendChild(arrow);

    const panel = document.createElement('div');
    panel.dataset.sctGensPanel = '1';
    panel.className =
      'absolute bottom-full left-0 z-popover mb-2 min-w-[236px] max-w-[calc(100vw-24px)] rounded-[20px] bg-token-bg-popover p-2 shadow-popover popover-blur-nested popover-ring space-y-2';
    panel.style.width = '236px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-orientation', 'vertical');
    panel.dataset.side = 'top';
    panel.dataset.state = 'closed';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between text-base font-semibold text-token-text-primary px-3 pt-2 pb-1';
    header.textContent = 'Gens';

    const value = document.createElement('span');
    value.dataset.sctGensValue = '1';
    value.className = 'text-base font-semibold text-token-text-primary';
    value.textContent = String(gensCount);
    header.appendChild(value);

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'rounded-2xl px-3 pb-3 pt-2';

    const track = document.createElement('div');
    track.className = 'relative flex h-6 w-full items-center';

    const trackBar = document.createElement('div');
    trackBar.className = 'absolute left-0 right-0 h-2 rounded-full bg-token-bg-light';

    const fillBar = document.createElement('div');
    fillBar.dataset.sctGensFill = '1';
    fillBar.className = 'absolute left-0 h-2 rounded-full bg-token-bg-inverse opacity-30';
    fillBar.style.width = `${getGensFillPercent(gensCount)}%`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(GENS_COUNT_MIN);
    slider.max = String(getGensCountMax());
    slider.step = '1';
    slider.value = String(gensCount);
    slider.dataset.sctGensSlider = '1';
    slider.setAttribute('aria-label', 'Number of gens');
    slider.className = 'relative z-10 h-6 w-full cursor-pointer';

    const rangeLabels = document.createElement('div');
    rangeLabels.className = 'mt-2 flex justify-between text-sm text-token-text-secondary';

    const minLabel = document.createElement('span');
    minLabel.className = 'font-medium';
    minLabel.textContent = String(GENS_COUNT_MIN);
    const maxLabel = document.createElement('span');
    maxLabel.className = 'font-medium';
    maxLabel.dataset.sctGensMax = '1';
    maxLabel.textContent = String(getGensCountMax());
    rangeLabels.appendChild(minLabel);
    rangeLabels.appendChild(maxLabel);

    panel.appendChild(header);
    track.appendChild(trackBar);
    track.appendChild(fillBar);
    track.appendChild(slider);
    sliderWrap.appendChild(track);
    sliderWrap.appendChild(rangeLabels);
    panel.appendChild(sliderWrap);

    button.addEventListener('click', (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {}
      const isOpen = __sct_openGensControl === wrapper;
      if (__sct_openGensControl && __sct_openGensControl !== wrapper) {
        setGensControlOpen(__sct_openGensControl, false);
      }
      if (isOpen) {
        setGensControlOpen(wrapper, false);
        __sct_openGensControl = null;
      } else {
        __sct_openGensControl = wrapper;
        setGensControlOpen(wrapper, true);
      }
    });

    slider.addEventListener('input', () => {
      writeGensCount(slider.value);
    });

    wrapper.appendChild(button);
    wrapper.appendChild(panel);
    return wrapper;
  }

  function installGensCountControl() {
    let processScheduled = false;
    const scheduleProcess = () => {
      if (processScheduled) return;
      processScheduled = true;
      requestAnimationFrame(() => {
        processScheduled = false;
        process();
      });
    };

    const process = () => {
      try {
        const roots = getComposerRoots();
        const controls = Array.from(document.querySelectorAll('[data-sct-gens-control="1"]'));
        controls.forEach((control) => {
          if (isInSidebar(control)) {
            control.remove();
            return;
          }
          if (roots.length && !isWithinComposer(control, roots)) control.remove();
        });

        if (!roots.length) return;
        const triggers = getComposerSettingsButtons(roots);
        const targets = triggers.filter((btn) => isVisibleEl(btn));
        const candidates = targets.length ? targets : triggers;
        if (!candidates.length) return;

        for (const trigger of candidates) {
          const row = trigger.parentElement;
          if (!row) continue;
          if (row.querySelector('[data-sct-gens-control="1"]')) continue;
          const control = buildGensControl();
          if (trigger.nextSibling) row.insertBefore(control, trigger.nextSibling);
          else row.appendChild(control);
        }
        syncGensControlUI();
      } catch {}
    };

    const startObserver = () => {
      try {
        ensureGensControlListeners();
        if (!document.body) return;
        const isRelevantNode = (n) => {
          try {
            if (!n || n.nodeType !== 1) return false;
            if (n.matches?.('[data-sct-gens-control="1"]') || n.querySelector?.('[data-sct-gens-control="1"]')) return true;
            return (
              n.matches?.('button[aria-label="Settings"][aria-haspopup="menu"]') ||
              n.querySelector?.('button[aria-label="Settings"][aria-haspopup="menu"]')
            );
          } catch {
            return false;
          }
        };

        const obs = new MutationObserver((records) => {
          for (const r of records) {
            const added = r.addedNodes || [];
            const removed = r.removedNodes || [];
            for (const n of added) {
              if (isRelevantNode(n)) {
                scheduleProcess();
                return;
              }
            }
            for (const n of removed) {
              if (isRelevantNode(n)) {
                scheduleProcess();
                return;
              }
            }
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        scheduleProcess();
      } catch {}
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
      startObserver();
    }
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function') return;
    if (window.fetch.__sct_patched) return;

    const origFetch = window.fetch;
    function patchedFetch(input, init) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : input?.url || '';
      } catch {}
      const method = (init && init.method) || (typeof input === 'object' && input?.method) || 'GET';
      const isCreate = typeof url === 'string' && NF_CREATE_RE.test(url) && String(method).toUpperCase() === 'POST';

      // Draft remix task tracking (used by inject.js to enable correct redo behavior later).
      const sourceDraftId = isCreate && isRemixRoute() ? getDraftIdFromDraftRoute() : null;
      const shouldCaptureTaskId = !!sourceDraftId;

      const ctx = this;
      const attachTaskCapture = (promise) => {
        if (!shouldCaptureTaskId || !promise) return;
        try {
          promise
            .then((res) => {
              try {
                res
                  .clone()
                  .json()
                  .then((json) => {
                    const taskId = json?.id;
                    if (taskId) saveTaskToSourceDraft(taskId, sourceDraftId);
                  })
                  .catch(() => {});
              } catch {}
              return res;
            })
            .catch(() => {});
        } catch {}
      };

      const attachPlanCapture = (promise) => {
        if (!promise || !SUBSCRIPTIONS_RE.test(url)) return;
        try {
          promise
            .then((res) => {
              try {
                res
                  .clone()
                  .json()
                  .then((json) => {
                    const isFree = extractPlanIsFree(json);
                    if (isFree != null) setPlanIsFree(isFree);
                  })
                  .catch(() => {});
              } catch {}
              return res;
            })
            .catch(() => {});
        } catch {}
      };

      const buildInit = () => {
        let nextInit = init;
        try {
          if (isCreate && durationOverride) {
            const override = getDurationOverride();
            if (override && Number.isFinite(override.frames) && init && typeof init === 'object') {
              nextInit = { ...init };
              if (nextInit.body != null) {
                nextInit.body = rewriteNFramesInBodyString(nextInit.body, override.frames);
                dlog('fetch rewrite', { url, frames: override.frames });
              }
            }
          }
        } catch {}
        return nextInit;
      };

      const makeRequest = (reqInput) => origFetch.call(ctx, reqInput, buildInit());

      const desiredGens = isCreate ? getGensCount() : 1;
      if (!Number.isFinite(desiredGens) || desiredGens <= 1) {
        const p = makeRequest(input);
        attachTaskCapture(p);
        attachPlanCapture(p);
        return p;
      }

      let effectiveGens = desiredGens;
      let inputs = null;
      if (input && typeof input === 'object' && typeof input.clone === 'function') {
        inputs = [];
        try {
          for (let i = 0; i < desiredGens; i++) inputs.push(input.clone());
        } catch {
          inputs = null;
          effectiveGens = 1;
        }
      }

      if (effectiveGens <= 1) {
        const p = makeRequest(input);
        attachTaskCapture(p);
        attachPlanCapture(p);
        return p;
      }

      const getInputForIndex = (i) => {
        if (inputs) return inputs[i];
        return input;
      };

      const enqueue = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);
      const firstPromise = new Promise((resolve, reject) => {
        enqueue(() => {
          let p = null;
          try {
            p = makeRequest(getInputForIndex(0));
          } catch (err) {
            reject(err);
            return;
          }
          attachTaskCapture(p);
          attachPlanCapture(p);
          p.then(resolve, reject);
        });
      });

      for (let i = 1; i < effectiveGens; i++) {
        enqueue(() => {
          try {
            const p = makeRequest(getInputForIndex(i));
            attachTaskCapture(p);
            attachPlanCapture(p);
          } catch {}
        });
      }

      return firstPromise;
    }

    patchedFetch.__sct_patched = true;
    window.fetch = patchedFetch;
  }

  function patchXHR() {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto) return;
    if (proto.__sct_patched) return;
    proto.__sct_patched = true;

    const origOpen = proto.open;
    const origSend = proto.send;

    proto.open = function (method, url) {
      try {
        this.__sct_method = method;
        this.__sct_url = url;

        // Draft remix task tracking (XHR code path).
        const m = String(method || 'GET').toUpperCase();
        const u = String(url || '');
        const isCreate = m === 'POST' && NF_CREATE_RE.test(u);
        const sourceDraftId = isCreate && isRemixRoute() ? getDraftIdFromDraftRoute() : null;
        if (sourceDraftId) {
          this.addEventListener(
            'load',
            () => {
              try {
                const j = safeJsonParse(this.responseText);
                const taskId = j?.id;
                if (taskId) saveTaskToSourceDraft(taskId, sourceDraftId);
              } catch {}
            },
            { once: true }
          );
        }

        if (SUBSCRIPTIONS_RE.test(String(url || ''))) {
          this.addEventListener(
            'load',
            () => {
              try {
                const j = safeJsonParse(this.responseText);
                const isFree = extractPlanIsFree(j);
                if (isFree != null) setPlanIsFree(isFree);
              } catch {}
            },
            { once: true }
          );
        }
      } catch {}
      return origOpen.apply(this, arguments);
    };

    proto.send = function (body) {
      if (!durationOverride) return origSend.call(this, body);
      try {
        const url = String(this.__sct_url || '');
        const method = String(this.__sct_method || 'GET').toUpperCase();
        if (method === 'POST' && NF_CREATE_RE.test(url)) {
          const override = getDurationOverride();
          if (override && Number.isFinite(override.frames) && typeof body === 'string') {
            body = rewriteNFramesInBodyString(body, override.frames);
            dlog('xhr rewrite', { url, frames: override.frames });
          }
        }
      } catch {}
      return origSend.call(this, body);
    };
  }

  function findDurationMenuValueEl(durationMenuItemEl) {
    if (!durationMenuItemEl) return null;
    const preferred = durationMenuItemEl.querySelector('.text-token-text-tertiary');
    if (preferred) return preferred;

    try {
      const divs = Array.from(durationMenuItemEl.querySelectorAll('div'));
      for (let i = divs.length - 1; i >= 0; i--) {
        const t = (divs[i].textContent || '').trim();
        if (/^\d+\s*s$/.test(t) || /^\d+s$/.test(t)) return divs[i];
      }
    } catch {}
    return null;
  }

  function ensureDurationSliderStyles() {
    if (document.getElementById('sct-duration-slider-style')) return;
    const st = document.createElement('style');
    st.id = 'sct-duration-slider-style';
    st.textContent = `
      [data-sct-duration-slider="1"] input[type="range"] {
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        outline: none;
      }
      [data-sct-duration-slider="1"] input[type="range"]::-webkit-slider-runnable-track {
        height: 8px;
        border-radius: 9999px;
        background: var(--sct-duration-track-bg, rgba(var(--bg-inverse), 0.18));
      }
      [data-sct-duration-slider="1"] input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: rgb(var(--bg-inverse));
        border: 2px solid rgba(var(--bg-inverse), 0.85);
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.24), 0 0 0 2px rgba(0, 0, 0, 0.08);
        margin-top: -5px;
      }
      [data-sct-duration-slider="1"] input[type="range"]::-moz-range-track {
        height: 8px;
        border-radius: 9999px;
        background: var(--sct-duration-track-bg, rgba(var(--bg-inverse), 0.18));
        border: none;
      }
      [data-sct-duration-slider="1"] input[type="range"]::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: rgb(var(--bg-inverse));
        border: 2px solid rgba(var(--bg-inverse), 0.85);
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.24), 0 0 0 2px rgba(0, 0, 0, 0.08);
        cursor: pointer;
      }
      [data-sct-duration-slider="1"] [data-sct-duration-current="1"][data-unsupported="1"] {
        color: rgb(239, 68, 68);
      }
      [data-sct-duration-slider="1"] [data-sct-duration-subtext="1"][data-unsupported="1"] {
        color: rgb(239, 68, 68);
      }
      [data-sct-duration-slider="1"] [data-sct-duration-ticks="1"] {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 2px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      [data-sct-duration-slider="1"] [data-sct-duration-ticks="1"]::-webkit-scrollbar {
        width: 0;
        height: 0;
      }
      [data-sct-duration-slider="1"] button[data-sct-duration-tick="1"] {
        border-radius: 9999px;
        padding: 4px 8px;
        font-size: 12px;
        line-height: 16px;
        border: 1px solid rgba(var(--bg-inverse), 0.18);
        background: transparent;
        color: inherit;
        cursor: pointer;
        user-select: none;
      }
      [data-sct-duration-slider="1"] button[data-sct-duration-tick="1"][data-selected="1"] {
        background: rgba(var(--bg-inverse), 0.10);
        border-color: rgba(var(--bg-inverse), 0.30);
      }
      [data-sct-duration-slider="1"] button[data-sct-duration-tick="1"][data-unsupported="1"] {
        color: rgb(239, 68, 68);
        border-color: rgba(239, 68, 68, 0.35);
      }
      [data-sct-duration-slider="1"] button[data-sct-duration-tick="1"][data-selected="1"][data-unsupported="1"] {
        background: rgba(239, 68, 68, 0.12);
      }
      [data-sct-duration-slider="1"] input[data-sct-duration-time="1"],
      [data-sct-duration-slider="1"] input[data-sct-duration-frames="1"] {
        width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(var(--bg-inverse), 0.18);
        background: transparent;
        padding: 6px 8px;
        font-size: 12px;
        line-height: 16px;
        color: inherit;
      }
      [data-sct-duration-slider="1"] input[data-sct-duration-time="1"]:focus,
      [data-sct-duration-slider="1"] input[data-sct-duration-frames="1"]:focus {
        outline: none;
        border-color: rgba(var(--bg-inverse), 0.32);
        box-shadow: 0 0 0 2px rgba(var(--bg-inverse), 0.06);
      }
    `;
    document.head.appendChild(st);
  }

  function ensureExtraDurationItems(durationSubmenuEl) {
    if (!durationSubmenuEl) return;

    const group = durationSubmenuEl.querySelector('[role="group"]');
    if (!group) return;

    durationSubmenuEl.dataset.sctDurationMenu = '1';

    const settings = getSoraSettings();
    const allow25 = shouldOffer25s(settings);
    const allow5 = !isRemixEmptyQuery();
    const isSora2ProHigh = planIsFree !== true && settings?.model === 'sora2pro' && settings?.resolution === 'high';
    const supportedMaxSeconds = isSora2ProHigh ? 24 : 25;
    const supportedMaxFrames = supportedMaxSeconds * SCT_FPS;

    ensureDurationSliderStyles();

    // Remove legacy injected duration options from older builds.
    try {
      group.querySelectorAll('[data-sct-duration-option]').forEach((el) => el.remove());
    } catch {}

    const getMenuItemSeconds = (el) => {
      const label = (el?.querySelector?.('span.truncate')?.textContent || el?.textContent || '').trim();
      const m = label.match(/(\d+)\s*seconds?/i) || label.match(/(\d+)\s*s\b/i);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };

    const setDurationMenuValueLabel = (text) => {
      try {
        const durationMenuItems = Array.from(document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')).filter((mi) =>
          (mi.textContent || '').includes('Duration')
        );
        for (const mi of durationMenuItems) {
          const valueEl = findDurationMenuValueEl(mi);
          if (valueEl) valueEl.textContent = text;
        }
      } catch {}
    };

    const applyFrames = (frames) => {
      const f = clampInt(frames, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
      const seconds = framesToSeconds(f);
      writeDurationOverride({ seconds, frames: f });
      setDurationMenuValueLabel(formatSecondsShort(seconds));
      scheduleVideoGensWarning(seconds);
      return { frames: f, seconds };
    };

    // Remove 5s option when remix is active.
    if (!allow5) {
      try {
        const radios = Array.from(group.querySelectorAll('[role="menuitemradio"]'));
        radios.forEach((el) => {
          const sec = getMenuItemSeconds(el);
          if (sec === 5) el.remove();
        });
      } catch {}

      try {
        const override = getDurationOverride();
        if (override && Number.isFinite(override.frames) && override.frames === 5 * SCT_FPS) clearDurationOverride();
      } catch {}
    }

    // Remove 25s option when not allowed for the current plan/model.
    if (!allow25) {
      try {
        const radios = Array.from(group.querySelectorAll('[role="menuitemradio"]'));
        radios.forEach((el) => {
          const sec = getMenuItemSeconds(el);
          if (sec === 25) el.remove();
        });
      } catch {}

      // If >=25s was selected via override, clear it so we don't keep rewriting API requests.
      try {
        const override = getDurationOverride();
        if (override && Number.isFinite(override.frames) && override.frames >= 25 * SCT_FPS) {
          clearDurationOverride();
          // Best-effort: update the parent menu value label to whichever built-in option is selected.
          const checked = group.querySelector('[role="menuitemradio"][aria-checked="true"]');
          const sec = getMenuItemSeconds(checked);
          if (sec != null) setDurationMenuValueLabel(`${sec}s`);
        }
      } catch {}
    }

    // Inject a slider + inputs at the bottom of the duration menu.
    let sliderWrap = durationSubmenuEl.querySelector('[data-sct-duration-slider="1"]');
    let slider = null;
    let currentEl = null;
    let subtextEl = null;
    let ticksEl = null;
    let timeInput = null;
    let framesInput = null;

    if (!sliderWrap) {
      const sep = document.createElement('div');
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'horizontal');
      sep.className = 'my-1.5 h-px bg-token-bg-light mx-3';
      sep.dataset.sctDurationSliderSep = '1';

      sliderWrap = document.createElement('div');
      sliderWrap.dataset.sctDurationSlider = '1';
      sliderWrap.className = 'flex max-w-[280px] flex-col gap-2 px-3 pb-2 pt-2 text-token-text-tertiary';

      const header = document.createElement('div');
      header.className = 'flex items-baseline justify-between gap-2';

      const title = document.createElement('div');
      title.className = 'text-xs font-semibold text-token-text-secondary';
      title.textContent = 'Custom duration';

      currentEl = document.createElement('div');
      currentEl.dataset.sctDurationCurrent = '1';
      currentEl.className = 'text-xs font-semibold tabular-nums';

      header.appendChild(title);
      header.appendChild(currentEl);

      subtextEl = document.createElement('div');
      subtextEl.dataset.sctDurationSubtext = '1';
      subtextEl.className = 'text-[11px] leading-[14px] text-token-text-tertiary';
      subtextEl.textContent = '';

      const track = document.createElement('div');
      track.className = 'relative flex h-6 w-full items-center';

      slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(DURATION_FRAMES_MIN);
      slider.max = String(DURATION_FRAMES_MAX);
      slider.step = '1';
      slider.value = String(DURATION_FRAMES_MIN);
      slider.dataset.sctDurationRange = '1';
      slider.setAttribute('aria-label', 'Duration');
      slider.className = 'relative z-10 h-6 w-full cursor-pointer';
      track.appendChild(slider);

      ticksEl = document.createElement('div');
      ticksEl.dataset.sctDurationTicks = '1';
      ticksEl.className = 'mt-1';

      const inputs = document.createElement('div');
      inputs.className = 'mt-1 flex items-end gap-2';

      const timeWrap = document.createElement('div');
      timeWrap.className = 'flex-1';
      const timeLabel = document.createElement('div');
      timeLabel.className = 'mb-1 text-[11px] font-medium text-token-text-secondary';
      timeLabel.textContent = 'Time';
      timeInput = document.createElement('input');
      timeInput.type = 'text';
      timeInput.inputMode = 'decimal';
      timeInput.autocomplete = 'off';
      timeInput.spellcheck = false;
      timeInput.placeholder = 'e.g. 24.5s or 0:24.5';
      timeInput.dataset.sctDurationTime = '1';
      timeWrap.appendChild(timeLabel);
      timeWrap.appendChild(timeInput);

      const framesWrap = document.createElement('div');
      framesWrap.style.width = '96px';
      const framesLabel = document.createElement('div');
      framesLabel.className = 'mb-1 text-[11px] font-medium text-token-text-secondary';
      framesLabel.textContent = 'Frames';
      framesInput = document.createElement('input');
      framesInput.type = 'text';
      framesInput.inputMode = 'numeric';
      framesInput.autocomplete = 'off';
      framesInput.spellcheck = false;
      framesInput.placeholder = 'e.g. 750';
      framesInput.dataset.sctDurationFrames = '1';
      framesWrap.appendChild(framesLabel);
      framesWrap.appendChild(framesInput);

      inputs.appendChild(timeWrap);
      inputs.appendChild(framesWrap);

      sliderWrap.appendChild(header);
      sliderWrap.appendChild(subtextEl);
      sliderWrap.appendChild(track);
      sliderWrap.appendChild(ticksEl);
      sliderWrap.appendChild(inputs);

      durationSubmenuEl.appendChild(sep);
      durationSubmenuEl.appendChild(sliderWrap);

      // Wire up listeners once.
      slider.addEventListener('input', (ev) => {
        try {
          const v = clampInt(ev?.target?.value, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
          const seconds = framesToSeconds(v);
          const short = formatSecondsShort(seconds);
          if (currentEl) currentEl.textContent = short;
          if (subtextEl) subtextEl.textContent = `${v} frames`;

          const maxFrames = Number(sliderWrap?.dataset?.sctSupportedMaxFrames || '');
          const maxSeconds = Number(sliderWrap?.dataset?.sctSupportedMaxSeconds || '');
          const supportedFramesNow = Number.isFinite(maxFrames) ? maxFrames : supportedMaxFrames;
          const supportedSecondsNow = Number.isFinite(maxSeconds) ? maxSeconds : supportedMaxSeconds;

          const unsupported = v > supportedFramesNow;
          if (currentEl) currentEl.dataset.unsupported = unsupported ? '1' : '';
          if (subtextEl) subtextEl.dataset.unsupported = unsupported ? '1' : '';

          if (document.activeElement !== timeInput && timeInput) timeInput.value = short;
          if (document.activeElement !== framesInput && framesInput) framesInput.value = String(v);

          // Keep ticks selection in sync while dragging.
          try {
            const btns = sliderWrap.querySelectorAll('button[data-sct-duration-tick="1"]');
            btns.forEach((b) => {
              const sec = Number(b.dataset.sctTickSeconds || '');
              const f = Number(b.dataset.sctTickFrames || '');
              b.dataset.selected = Number.isFinite(f) && f === v ? '1' : '';
              const unsupportedTick = Number.isFinite(sec) && sec > supportedSecondsNow;
              b.dataset.unsupported = unsupportedTick ? '1' : '';
            });
          } catch {}
        } catch {}
      });
      slider.addEventListener('change', (ev) => {
        try {
          const v = clampInt(ev?.target?.value, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
          applyFrames(v);
          keepSettingsMenuOpenSoon();
        } catch {}
      });

      const commitTime = () => {
        try {
          const sec = parseTimeToSeconds(timeInput?.value);
          if (sec == null) return;
          const frames = secondsToFrames(sec);
          if (slider) {
            slider.value = String(frames);
            slider.dispatchEvent(new Event('input'));
          }
          applyFrames(frames);
          keepSettingsMenuOpenSoon();
        } catch {}
      };
      const commitFrames = () => {
        try {
          const raw = String(framesInput?.value || '').trim();
          const n = raw ? Number(raw) : NaN;
          if (!Number.isFinite(n)) return;
          const frames = clampInt(n, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
          if (slider) {
            slider.value = String(frames);
            slider.dispatchEvent(new Event('input'));
          }
          applyFrames(frames);
          keepSettingsMenuOpenSoon();
        } catch {}
      };

      timeInput.addEventListener('keydown', (ev) => {
        if ((ev?.key || '') === 'Enter') commitTime();
      });
      timeInput.addEventListener('blur', commitTime);
      framesInput.addEventListener('keydown', (ev) => {
        if ((ev?.key || '') === 'Enter') commitFrames();
      });
      framesInput.addEventListener('blur', commitFrames);

      // Prevent menu close on tap/click.
      const stop = (ev) => {
        try {
          ev.stopPropagation();
        } catch {}
      };
      sliderWrap.addEventListener('click', stop);
      sliderWrap.addEventListener('pointerdown', stop);
      sliderWrap.addEventListener('mousedown', stop);
      sliderWrap.addEventListener('touchstart', stop, { passive: true });
    } else {
      slider = sliderWrap.querySelector('input[type="range"][data-sct-duration-range="1"]');
      currentEl = sliderWrap.querySelector('[data-sct-duration-current="1"]');
      subtextEl = sliderWrap.querySelector('[data-sct-duration-subtext="1"]');
      ticksEl = sliderWrap.querySelector('[data-sct-duration-ticks="1"]');
      timeInput = sliderWrap.querySelector('input[data-sct-duration-time="1"]');
      framesInput = sliderWrap.querySelector('input[data-sct-duration-frames="1"]');
    }

    // Used by event listeners to keep "unsupported" styling correct when settings change.
    try {
      sliderWrap.dataset.sctSupportedMaxSeconds = String(supportedMaxSeconds);
      sliderWrap.dataset.sctSupportedMaxFrames = String(supportedMaxFrames);
    } catch {}

    // Track background gradient: supported range normal, unsupported range red.
    try {
      const denom = DURATION_FRAMES_MAX - DURATION_FRAMES_MIN;
      const boundaryFrames = Math.min(DURATION_FRAMES_MAX, supportedMaxFrames + 1);
      const pct = denom > 0 ? ((boundaryFrames - DURATION_FRAMES_MIN) / denom) * 100 : 100;
      const clampedPct = pct < 0 ? 0 : pct > 100 ? 100 : pct;
      const bg = `linear-gradient(to right, rgba(var(--bg-inverse), 0.18) 0%, rgba(var(--bg-inverse), 0.18) ${clampedPct}%, rgba(239, 68, 68, 0.45) ${clampedPct}%, rgba(239, 68, 68, 0.45) 100%)`;
      if (slider && slider.style) slider.style.setProperty('--sct-duration-track-bg', bg);
    } catch {}

    // Determine current value: prefer override, otherwise use the selected built-in option.
    let currentFrames = null;
    try {
      const override = getDurationOverride();
      if (override && Number.isFinite(override.frames)) currentFrames = clampInt(override.frames, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
    } catch {}
    if (currentFrames == null) {
      try {
        const checked = group.querySelector('[role="menuitemradio"][aria-checked="true"]');
        const sec = getMenuItemSeconds(checked);
        if (sec != null) currentFrames = secondsToFrames(sec);
      } catch {}
    }
    if (currentFrames == null) currentFrames = DURATION_FRAMES_MIN;

    // Ensure ticks exist and are correct for the current settings.
    try {
      const ticksKey = isSora2ProHigh ? 'prohigh' : 'default';
      if (ticksEl && sliderWrap.dataset.sctTicksKey !== ticksKey) {
        sliderWrap.dataset.sctTicksKey = ticksKey;
        ticksEl.innerHTML = '';
        const secondsList = Array.from(new Set([...(DURATION_TICK_SECONDS || []), ...(isSora2ProHigh ? [24] : [])])).sort((a, b) => a - b);
        for (const sec of secondsList) {
          const frames = sec * SCT_FPS;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.sctDurationTick = '1';
          btn.dataset.sctTickSeconds = String(sec);
          btn.dataset.sctTickFrames = String(frames);
          btn.textContent = `${sec}s`;
          const unsupportedTick = sec > supportedMaxSeconds;
          btn.dataset.unsupported = unsupportedTick ? '1' : '';
          btn.dataset.selected = frames === currentFrames ? '1' : '';
          btn.addEventListener('click', (ev) => {
            try {
              ev.preventDefault();
              ev.stopPropagation();
            } catch {}
            try {
              if (slider) {
                slider.value = String(frames);
                slider.dispatchEvent(new Event('input'));
              }
              applyFrames(frames);
              // Update selection styles.
              const btns = sliderWrap.querySelectorAll('button[data-sct-duration-tick="1"]');
              btns.forEach((b) => (b.dataset.selected = b === btn ? '1' : ''));
              keepSettingsMenuOpenSoon();
            } catch {}
          });
          ticksEl.appendChild(btn);
        }
      }
    } catch {}

    // Sync UI to current value.
    try {
      const seconds = framesToSeconds(currentFrames);
      const short = formatSecondsShort(seconds);
      if (slider) slider.value = String(currentFrames);
      if (currentEl) currentEl.textContent = short;
      if (subtextEl) subtextEl.textContent = `${currentFrames} frames`;
      const unsupported = currentFrames > supportedMaxFrames;
      if (currentEl) currentEl.dataset.unsupported = unsupported ? '1' : '';
      if (subtextEl) subtextEl.dataset.unsupported = unsupported ? '1' : '';
      if (timeInput && document.activeElement !== timeInput) timeInput.value = short;
      if (framesInput && document.activeElement !== framesInput) framesInput.value = String(currentFrames);
      try {
        const btns = sliderWrap.querySelectorAll('button[data-sct-duration-tick="1"]');
        btns.forEach((b) => {
          const sec = Number(b.dataset.sctTickSeconds || '');
          const f = Number(b.dataset.sctTickFrames || '');
          b.dataset.selected = Number.isFinite(f) && f === currentFrames ? '1' : '';
          const unsupportedTick = Number.isFinite(sec) && sec > supportedMaxSeconds;
          b.dataset.unsupported = unsupportedTick ? '1' : '';
        });
      } catch {}
    } catch {}
  }

  function installDurationDropdownEnhancer() {
    let processScheduled = false;
    const scheduleProcess = () => {
      if (processScheduled) return;
      processScheduled = true;
      requestAnimationFrame(() => {
        processScheduled = false;
        process();
      });
    };

    const process = () => {
      try {
        const durationMenuItems = Array.from(document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')).filter((el) =>
          (el.textContent || '').includes('Duration')
        );

        let override = getDurationOverride();
        const settings = getSoraSettings();
        const allow25 = shouldOffer25s(settings);

        // Normalize override to be frames-first (seconds derived), and keep it within slider bounds.
        try {
          if (override && Number.isFinite(override.frames)) {
            const clampedFrames = clampInt(override.frames, DURATION_FRAMES_MIN, DURATION_FRAMES_MAX);
            const seconds = framesToSeconds(clampedFrames);
            const secondsOk = Number.isFinite(override.seconds) && Math.abs(Number(override.seconds) - seconds) < 0.001;
            if (!secondsOk || clampedFrames !== override.frames) {
              writeDurationOverride({ seconds, frames: clampedFrames });
              override = { seconds, frames: clampedFrames };
            } else {
              override = { seconds: Number(override.seconds), frames: clampedFrames };
            }
          }
        } catch {}

        // Enforce plan gating: if 25s isn't allowed, drop >=25s overrides.
        if (!allow25 && override && Number.isFinite(override.frames) && override.frames >= 25 * SCT_FPS) {
          clearDurationOverride();
          override = null;
        }

        if (override) {
          scheduleVideoGensWarning(override.seconds);
        } else {
          // Ensure the credit usage helper stays correct even when using built-in durations.
          try {
            for (const mi of durationMenuItems) {
              const valueEl = findDurationMenuValueEl(mi);
              const t = (valueEl?.textContent || '').trim();
              const m = t.match(/(\d+)\s*s\b/i) || t.match(/(\d+)\s*seconds?\b/i);
              if (m) {
                const sec = Number(m[1]);
                if (Number.isFinite(sec)) {
                  scheduleVideoGensWarning(sec);
                  break;
                }
              }
            }
          } catch {}
        }
        for (const mi of durationMenuItems) {
          mi.dataset.sctDurationMenuitem = '1';

          if (override) {
            const valueEl = findDurationMenuValueEl(mi);
            if (valueEl) valueEl.textContent = formatSecondsShort(override.seconds);
          }

          const submenuId = mi.getAttribute('aria-controls');
          if (!submenuId) continue;
          const submenu = document.getElementById(submenuId);
          if (submenu) ensureExtraDurationItems(submenu);
        }
      } catch {}
    };

    // SPA route changes can update `location.search` without DOM mutations; reschedule when URL changes.
    try {
      window.addEventListener('popstate', scheduleProcess, true);
      window.addEventListener('sct_plan_status', scheduleProcess, false);
      const origPushState = history.pushState;
      const origReplaceState = history.replaceState;
      history.pushState = function () {
        const ret = origPushState.apply(this, arguments);
        try {
          scheduleProcess();
        } catch {}
        return ret;
      };
      history.replaceState = function () {
        const ret = origReplaceState.apply(this, arguments);
        try {
          scheduleProcess();
        } catch {}
        return ret;
      };
    } catch {}

    // Sync override when selecting any built-in duration option.
    document.addEventListener(
      'click',
      (ev) => {
        try {
          const radio = ev.target && ev.target.closest && ev.target.closest('[role="menuitemradio"]');
          if (!radio) return;
          const menu = radio.closest && radio.closest('[data-sct-duration-menu="1"]');
          if (!menu) return;
          if (radio.dataset && radio.dataset.sctDurationOption) return; // our injected items

          const labelText = (radio.querySelector('span.truncate')?.textContent || radio.textContent || '').trim();
          const m = labelText.match(/(\d+)\s*seconds?/i) || labelText.match(/(\d+)\s*s\b/i);
          const sec = m ? Number(m[1]) : null;
          if (Number.isFinite(sec)) {
            writeDurationOverride({ seconds: sec, frames: secondsToFrames(sec) });
          } else {
            clearDurationOverride();
          }

          // Ensure injected items no longer look selected.
          try {
            const group = radio.closest('[role="group"]');
            if (group) {
              const injected = group.querySelectorAll('[data-sct-duration-option]');
              injected.forEach((el) => {
                try {
                  el.setAttribute('aria-checked', 'false');
                  el.setAttribute('data-state', 'unchecked');
                } catch {}
              });
            }
          } catch {}

          // Update the Duration label to the selected built-in option immediately.
          try {
            if (Number.isFinite(sec)) {
              scheduleVideoGensWarning(sec);
              const durationMenuItems = Array.from(document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')).filter((mi) =>
                (mi.textContent || '').includes('Duration')
              );
              for (const mi of durationMenuItems) {
                const valueEl = findDurationMenuValueEl(mi);
                if (valueEl) valueEl.textContent = formatSecondsShort(sec);
              }
            }
          } catch {}

          scheduleProcess();
        } catch {}
      },
      true
    );

    // Keep the settings modal open when selecting items inside it (Radix sometimes closes it).
    document.addEventListener(
      'click',
      (ev) => {
        try {
          const item = ev.target && ev.target.closest && ev.target.closest('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]');
          if (!item) return;
          const menuEl = item.closest && item.closest('[data-radix-menu-content][role="menu"]');
          const rootMenu = getSettingsRootMenuFromMenuEl(menuEl);
          if (!rootMenu) return;
          keepSettingsMenuOpenSoon();
          scheduleProcess();
        } catch {}
      },
      true
    );

    // When the Duration menu item is opened, ensure we inject immediately (Radix can reuse portal roots).
    document.addEventListener(
      'pointerdown',
      (ev) => {
        try {
          const mi = ev.target && ev.target.closest && ev.target.closest('[role="menuitem"][aria-haspopup="menu"]');
          if (!mi) return;
          if (!(mi.textContent || '').includes('Duration')) return;
          scheduleProcess();
        } catch {}
      },
      true
    );

    // Only react to Radix portal mount/unmount (body direct children), not all subtree mutations.
    const startObserver = () => {
      try {
        if (!document.body) return;
        const RADIX_SEL = '[data-radix-popper-content-wrapper],[data-radix-menu-content]';
        const isRadixPortal = (n) => {
          try {
            return (
              n &&
              n.nodeType === 1 &&
              (n.matches?.(RADIX_SEL) || n.querySelector?.(RADIX_SEL))
            );
          } catch {
            return false;
          }
        };
        const obs = new MutationObserver((records) => {
          for (const r of records) {
            const added = r.addedNodes || [];
            for (const n of added) {
              if (isRadixPortal(n)) {
                scheduleProcess();
                return;
              }
            }
            const removed = r.removedNodes || [];
            for (const n of removed) {
              if (isRadixPortal(n)) {
                scheduleProcess();
                return;
              }
            }
          }
        });
        // Observe subtree, but only schedule work when nodes matching Radix portal/menu appear/disappear.
        obs.observe(document.body, { childList: true, subtree: true });
        scheduleProcess();
      } catch {}
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
      startObserver();
    }
  }

  // Install
  patchFetch();
  patchXHR();
  checkPendingRedoPrompt();
  installDurationDropdownEnhancer();
  installGensCountControl();
})();
