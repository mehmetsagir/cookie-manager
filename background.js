/**
 * background.js
 * Service Worker for the Cookie Manager Chrome Extension (Manifest V3).
 *
 * Responsibilities:
 *   1. Track recent cookie changes via chrome.cookies.onChanged.
 *   2. Provide a message-passing interface for popup.js (chrome.runtime.onMessage).
 *   3. Register and handle context menu items.
 *
 * Design: self-contained — no external imports required so the service worker
 * initialises cleanly regardless of other agents' files being present.
 */

'use strict';

// ---------------------------------------------------------------------------
// Message type constants
// Protocol shared between background.js and popup.js.
// popup.js should use these same string values when calling
// chrome.runtime.sendMessage({ type: '...', data: { ... } }).
// ---------------------------------------------------------------------------
const MSG = {
  // Popup → Background requests
  GET_COOKIES:        'GET_COOKIES',        // { url }
  GET_ALL_COOKIES:    'GET_ALL_COOKIES',    // { domain? }
  DELETE_COOKIE:      'DELETE_COOKIE',      // { url, name }
  DELETE_ALL_COOKIES: 'DELETE_ALL_COOKIES', // { url }
  EXPORT_COOKIES:     'EXPORT_COOKIES',     // { url }
  IMPORT_COOKIES:     'IMPORT_COOKIES',     // { url, cookies[] }
  TRANSFER_COOKIES:   'TRANSFER_COOKIES',   // { sourceUrl, targetUrl, cookies[] }
  GET_RECENT_CHANGES: 'GET_RECENT_CHANGES', // { limit? }

  // Background → Popup push notifications
  COOKIE_CHANGED:     'COOKIE_CHANGED',     // { timestamp, removed, cause, cookie }
};

// ---------------------------------------------------------------------------
// Recent changes cache
// Holds the last N cookie change events. The popup can call
// GET_RECENT_CHANGES to read them on open, and also listens for live
// COOKIE_CHANGED pushes while it is visible.
// ---------------------------------------------------------------------------
const MAX_CHANGES = 50;
/** @type {Array<{timestamp:number, removed:boolean, cause:string, cookie:chrome.cookies.Cookie}>} */
const recentChanges = [];

// ---------------------------------------------------------------------------
// Context menu IDs
// ---------------------------------------------------------------------------
const CM = {
  COPY_ALL:   'cm-copy-all-cookies',
  DELETE_ALL: 'cm-delete-all-cookies',
  SEPARATOR:  'cm-separator',
};

// ===========================================================================
// 1. Cookie change listener
// ===========================================================================

chrome.cookies.onChanged.addListener((changeInfo) => {
  const entry = {
    timestamp: Date.now(),
    removed:   changeInfo.removed,
    cause:     changeInfo.cause,
    cookie:    changeInfo.cookie,
  };

  // Prepend so index 0 is always the most recent change.
  recentChanges.unshift(entry);

  // Enforce cache limit without reallocating the array.
  if (recentChanges.length > MAX_CHANGES) {
    recentChanges.length = MAX_CHANGES;
  }

  // Notify the popup if it is currently open; silently ignore if not.
  chrome.runtime
    .sendMessage({ type: MSG.COOKIE_CHANGED, data: entry })
    .catch(() => { /* popup not open — expected */ });
});

// ===========================================================================
// 2. Message-passing interface (popup ↔ background)
// ===========================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  processMessage(message)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ success: false, error: err?.message ?? String(err) })
    );

  // Return true to keep the message channel open for the async response.
  return true;
});

/**
 * Route an incoming message to the appropriate async handler.
 * Every case resolves with { success: true, ...data } or rejects with an Error.
 *
 * @param {{ type: string, data?: object }} message
 * @returns {Promise<object>}
 */
async function processMessage(message) {
  const { type, data = {} } = message;

  switch (type) {

    // -----------------------------------------------------------------------
    // Cookie queries
    // -----------------------------------------------------------------------
    case MSG.GET_COOKIES: {
      if (!data.url) throw new Error('GET_COOKIES: data.url is required');
      const cookies = await getCookiesForUrl(data.url);
      return { success: true, cookies };
    }

    case MSG.GET_ALL_COOKIES: {
      const cookies = await getAllCookies(data.domain);
      return { success: true, cookies };
    }

    // -----------------------------------------------------------------------
    // Cookie deletion
    // -----------------------------------------------------------------------
    case MSG.DELETE_COOKIE: {
      const { url, name } = data;
      if (!url || !name) throw new Error('DELETE_COOKIE: data.url and data.name are required');
      await removeCookie(url, name);
      return { success: true };
    }

    case MSG.DELETE_ALL_COOKIES: {
      if (!data.url) throw new Error('DELETE_ALL_COOKIES: data.url is required');
      const count = await deleteAllCookiesForUrl(data.url);
      return { success: true, count };
    }

    // -----------------------------------------------------------------------
    // Cookie export / import
    // -----------------------------------------------------------------------
    case MSG.EXPORT_COOKIES: {
      const cookies = await getCookiesForUrl(data.url || '');
      return { success: true, cookies };
    }

    case MSG.IMPORT_COOKIES: {
      const { url, cookies } = data;
      if (!url || !Array.isArray(cookies)) {
        throw new Error('IMPORT_COOKIES: data.url (string) and data.cookies (array) are required');
      }
      const results = await setCookies(url, cookies);
      return { success: true, results };
    }

    // -----------------------------------------------------------------------
    // Cookie transfer between tabs/sites
    // -----------------------------------------------------------------------
    case MSG.TRANSFER_COOKIES: {
      const { sourceUrl, targetUrl, cookies } = data;
      if (!sourceUrl || !targetUrl || !Array.isArray(cookies)) {
        throw new Error(
          'TRANSFER_COOKIES: data.sourceUrl, data.targetUrl, and data.cookies[] are required'
        );
      }
      const results = await setCookies(targetUrl, cookies);
      return { success: true, results };
    }

    // -----------------------------------------------------------------------
    // Recent changes cache
    // -----------------------------------------------------------------------
    case MSG.GET_RECENT_CHANGES: {
      const limit = typeof data.limit === 'number' ? data.limit : MAX_CHANGES;
      return { success: true, changes: recentChanges.slice(0, limit) };
    }

    default:
      throw new Error(`Unknown message type: "${type}"`);
  }
}

// ===========================================================================
// 3. Internal cookie helpers
// Thin wrappers around chrome.cookies.* so background.js stays self-contained
// and works even if cookieManager.js has not loaded yet.
// ===========================================================================

/**
 * Get all cookies for a given URL.
 * @param {string} url
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
function getCookiesForUrl(url) {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(cookies || []);
      }
    });
  });
}

/**
 * Get all cookies, optionally filtered by domain.
 * @param {string} [domain]
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
function getAllCookies(domain) {
  return new Promise((resolve, reject) => {
    const details = domain ? { domain } : {};
    chrome.cookies.getAll(details, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(cookies || []);
      }
    });
  });
}

/**
 * Remove a single cookie identified by URL and name.
 * @param {string} url
 * @param {string} name
 * @returns {Promise<chrome.cookies.Cookie|null>}
 */
function removeCookie(url, name) {
  return new Promise((resolve, reject) => {
    chrome.cookies.remove({ url, name }, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Delete every cookie accessible for a given URL.
 * @param {string} url
 * @returns {Promise<number>} Number of cookies successfully deleted.
 */
async function deleteAllCookiesForUrl(url) {
  const cookies = await getCookiesForUrl(url);

  const results = await Promise.allSettled(
    cookies.map((c) => {
      const scheme     = c.secure ? 'https' : 'http';
      const host       = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      const cookieUrl  = `${scheme}://${host}${c.path || '/'}`;
      return removeCookie(cookieUrl, c.name);
    })
  );

  return results.filter((r) => r.status === 'fulfilled').length;
}

/**
 * Set (create/overwrite) an array of cookies on the target URL.
 * @param {string} targetUrl
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {Promise<Array<{name:string, success:boolean, error?:string}>>}
 */
async function setCookies(targetUrl, cookies) {
  // Derive the target domain from the targetUrl so transferred cookies
  // are assigned to the correct host instead of keeping the source domain.
  let targetDomain;
  try {
    targetDomain = new URL(targetUrl).hostname;
  } catch {
    targetDomain = null;
  }

  const results = await Promise.allSettled(
    cookies.map((c) =>
      new Promise((resolve, reject) => {
        /** @type {chrome.cookies.SetDetails} */
        const details = {
          url:      targetUrl,
          name:     c.name,
          value:    c.value    || '',
          path:     c.path     || '/',
          secure:   Boolean(c.secure),
          httpOnly: Boolean(c.httpOnly),
          sameSite: c.sameSite || 'no_restriction',
        };

        // Use the target domain (derived from targetUrl) instead of the
        // source cookie's domain.  Preserve the leading-dot convention when
        // the original cookie was a subdomain/wildcard cookie.
        if (targetDomain) {
          if (c.domain && c.domain.startsWith('.')) {
            details.domain = '.' + targetDomain;
          } else {
            details.domain = targetDomain;
          }
        }
        if (c.expirationDate) details.expirationDate = c.expirationDate;

        chrome.cookies.set(details, (cookie) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(cookie);
          }
        });
      })
    )
  );

  return results.map((r, i) => ({
    name:    cookies[i].name,
    success: r.status === 'fulfilled',
    error:   r.status === 'rejected' ? r.reason?.message : undefined,
  }));
}

// ===========================================================================
// 4. Context menu
// ===========================================================================

/**
 * (Re-)create the extension's context menu entries.
 * Called on install, on startup, and on first script evaluation.
 */
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       CM.COPY_ALL,
      title:    'Copy cookies for this page',
      contexts: ['page', 'frame'],
    });

    chrome.contextMenus.create({
      id:       CM.SEPARATOR,
      type:     'separator',
      contexts: ['page', 'frame'],
    });

    chrome.contextMenus.create({
      id:       CM.DELETE_ALL,
      title:    'Delete all cookies for this site',
      contexts: ['page', 'frame'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = tab?.url;
  if (!url) return;

  try {
    switch (info.menuItemId) {
      case CM.COPY_ALL: {
        const cookies = await getCookiesForUrl(url);
        // Persist in session storage so popup.js can display or further process them.
        await chrome.storage.session.set({
          lastCopiedCookies: { url, cookies, timestamp: Date.now() },
        });
        break;
      }

      case CM.DELETE_ALL: {
        const count = await deleteAllCookiesForUrl(url);
        console.log(`[Cookie Manager] Deleted ${count} cookie(s) for ${url}`);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[Cookie Manager] Context menu action failed:', err);
  }
});

// ===========================================================================
// 5. Extension lifecycle
// ===========================================================================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Cookie Manager] Extension installed/updated. Reason:', details.reason);
  setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Cookie Manager] Service worker started');
  setupContextMenus();
});

// Initial setup also runs on dev-mode reloads where neither event fires.
setupContextMenus();

console.log('[Cookie Manager] Background service worker ready');
