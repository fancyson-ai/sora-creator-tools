/*
 * Cross-browser background worker:
 * - Chrome: uses `chrome.*`
 * - Firefox: uses `browser.*` (through the same alias)
 */
const chrome = globalThis.browser || globalThis.chrome;

const actionApi = chrome?.action || chrome?.browserAction;
if (actionApi?.onClicked) {
  actionApi.onClicked.addListener(() => {
    const url = chrome.runtime.getURL('dashboard.html');
    chrome.tabs.create({ url });
  });
}

/* Listen for dashboard open requests from content script */
if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== 'open_dashboard') return false;
    const url = chrome.runtime.getURL('dashboard.html');
    const isBrowserApi = !!globalThis.browser && chrome === globalThis.browser;

    try {
      if (isBrowserApi) {
        Promise.resolve(chrome.tabs.create({ url }))
          .then((tab) => {
            try {
              sendResponse({ success: true, tabId: tab?.id ?? null });
            } catch {}
          })
          .catch((err) => {
            try {
              sendResponse({ success: false, error: err?.message || String(err || '') });
            } catch {}
          });
        return true;
      }

      chrome.tabs.create({ url }, (tab) => {
        const err = chrome.runtime.lastError;
        if (err) sendResponse({ success: false, error: err.message || String(err) });
        else sendResponse({ success: true, tabId: tab?.id ?? null });
      });
      return true;
    } catch (err) {
      try {
        sendResponse({ success: false, error: err?.message || String(err || '') });
      } catch {}
      return true;
    }
  });
}
