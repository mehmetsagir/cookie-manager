/**
 * cookieManager.js
 * Core module for all Chrome cookie read/write/delete operations.
 * All functions return Promises and use chrome.cookies API.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a cookie URL from a cookie object.
 * chrome.cookies.remove requires a valid URL, not just a domain.
 * @param {chrome.cookies.Cookie} cookie
 * @returns {string}
 */
function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? 'https' : 'http';
  // Domain stored by Chrome may start with a leading dot; strip it for the URL.
  const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return `${scheme}://${host}${cookie.path || '/'}`;
}

/**
 * Wrap chrome.runtime.lastError into a rejected Promise.
 * Call inside a chrome API callback to surface errors uniformly.
 * @param {Function} resolve
 * @param {Function} reject
 * @param {*} value - Value to resolve with when there is no error.
 * @returns {Function} Chrome-API callback
 */
function makeCallback(resolve, reject, value) {
  return () => {
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message));
    } else {
      resolve(value !== undefined ? value : undefined);
    }
  };
}

// ---------------------------------------------------------------------------
// 1. getAllCookies
// ---------------------------------------------------------------------------

/**
 * Retrieve all cookies, optionally filtered by domain.
 *
 * @param {string} [domain] - Optional domain to filter cookies (e.g. "example.com").
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
function getAllCookies(domain) {
  return new Promise((resolve, reject) => {
    const details = domain ? { domain } : {};
    chrome.cookies.getAll(details, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(cookies || []);
    });
  });
}

// ---------------------------------------------------------------------------
// 2. getCookieDetails
// ---------------------------------------------------------------------------

/**
 * Get details of a specific cookie by name and domain.
 * Searches all matching cookies because a domain/name pair can exist on
 * multiple paths; returns the first match.
 *
 * @param {string} name   - Cookie name.
 * @param {string} domain - Domain the cookie belongs to.
 * @returns {Promise<chrome.cookies.Cookie|null>}
 */
function getCookieDetails(name, domain) {
  return new Promise((resolve, reject) => {
    if (!name || !domain) {
      reject(new Error('getCookieDetails: name and domain are required'));
      return;
    }
    chrome.cookies.getAll({ name, domain }, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve((cookies && cookies.length > 0) ? cookies[0] : null);
    });
  });
}

// ---------------------------------------------------------------------------
// 3. deleteCookie
// ---------------------------------------------------------------------------

/**
 * Remove a specific cookie.
 *
 * @param {string} name   - Cookie name.
 * @param {string} domain - Cookie domain.
 * @param {string} [url]  - Full URL (scheme + host + path). Derived from domain
 *                          when omitted, but providing it is more reliable.
 * @returns {Promise<chrome.cookies.Cookie|null>} The removed cookie, or null.
 */
function deleteCookie(name, domain, url) {
  return new Promise((resolve, reject) => {
    if (!name || !domain) {
      reject(new Error('deleteCookie: name and domain are required'));
      return;
    }

    // If no URL provided, build a best-guess URL from the domain.
    const targetUrl = url || (() => {
      const host = domain.startsWith('.') ? domain.slice(1) : domain;
      return `https://${host}/`;
    })();

    chrome.cookies.remove({ url: targetUrl, name }, (removedCookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(removedCookie);
    });
  });
}

// ---------------------------------------------------------------------------
// 4. deleteSelectedCookies
// ---------------------------------------------------------------------------

/**
 * Batch-delete an array of cookies.
 * Each element must have at minimum { name, domain } properties.
 * url is optional per element; will be derived from domain when absent.
 *
 * @param {Array<{name:string, domain:string, url?:string, secure?:boolean, path?:string}>} cookiesArray
 * @returns {Promise<{succeeded: chrome.cookies.Cookie[], failed: Array<{cookie: object, error: string}>}>}
 */
function deleteSelectedCookies(cookiesArray) {
  if (!Array.isArray(cookiesArray) || cookiesArray.length === 0) {
    return Promise.resolve({ succeeded: [], failed: [] });
  }

  const tasks = cookiesArray.map((cookie) => {
    const url = cookie.url || buildCookieUrl(cookie);
    return deleteCookie(cookie.name, cookie.domain, url)
      .then((removed) => ({ status: 'succeeded', removed, cookie }))
      .catch((error) => ({ status: 'failed', error: error.message, cookie }));
  });

  return Promise.all(tasks).then((results) => {
    const succeeded = results
      .filter((r) => r.status === 'succeeded')
      .map((r) => r.removed);
    const failed = results
      .filter((r) => r.status === 'failed')
      .map((r) => ({ cookie: r.cookie, error: r.error }));
    return { succeeded, failed };
  });
}

// ---------------------------------------------------------------------------
// 5. updateCookie
// ---------------------------------------------------------------------------

/**
 * Update (overwrite) an existing cookie with new property values.
 * chrome.cookies.set is used for both create and update.
 * The cookieDetails object should include at minimum: url, name, value.
 *
 * Supported properties mirror chrome.cookies.SetDetails:
 *   url, name, value, domain, path, secure, httpOnly, sameSite, expirationDate, storeId
 *
 * @param {object} cookieDetails
 * @returns {Promise<chrome.cookies.Cookie>}
 */
function updateCookie(cookieDetails) {
  return new Promise((resolve, reject) => {
    if (!cookieDetails || !cookieDetails.url || !cookieDetails.name) {
      reject(new Error('updateCookie: cookieDetails must include url and name'));
      return;
    }

    chrome.cookies.set(cookieDetails, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!cookie) {
        reject(new Error('updateCookie: cookie was not updated (null returned)'));
        return;
      }
      resolve(cookie);
    });
  });
}

// ---------------------------------------------------------------------------
// 6. createCookie
// ---------------------------------------------------------------------------

/**
 * Create (set) a new cookie.
 * Alias of updateCookie with a more semantically appropriate name.
 * details must include at minimum: url, name, value.
 *
 * @param {object} details - chrome.cookies.SetDetails-compatible object.
 * @returns {Promise<chrome.cookies.Cookie>}
 */
function createCookie(details) {
  return new Promise((resolve, reject) => {
    if (!details || !details.url || !details.name) {
      reject(new Error('createCookie: details must include url and name'));
      return;
    }

    chrome.cookies.set(details, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!cookie) {
        reject(new Error('createCookie: cookie was not created (null returned — check permissions)'));
        return;
      }
      resolve(cookie);
    });
  });
}

// ---------------------------------------------------------------------------
// 7. searchCookies
// ---------------------------------------------------------------------------

/**
 * Filter all cookies whose name, value, or domain contain the query string.
 * The search is case-insensitive.
 *
 * @param {string} query - Search term.
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
function searchCookies(query) {
  if (typeof query !== 'string') {
    return Promise.reject(new Error('searchCookies: query must be a string'));
  }

  return getAllCookies().then((cookies) => {
    if (!query.trim()) {
      // Empty query returns everything.
      return cookies;
    }

    const lowerQuery = query.toLowerCase();
    return cookies.filter((cookie) =>
      (cookie.name  || '').toLowerCase().includes(lowerQuery) ||
      (cookie.value || '').toLowerCase().includes(lowerQuery) ||
      (cookie.domain|| '').toLowerCase().includes(lowerQuery)
    );
  });
}

// ---------------------------------------------------------------------------
// 8. copyCookiesToClipboard
// ---------------------------------------------------------------------------

/**
 * Convert an array of cookies to both JSON and Netscape format strings,
 * then copy the combined text to the system clipboard.
 *
 * The returned object lets callers display or persist both formats.
 *
 * Netscape (cookies.txt) format:
 *   #HttpOnly_<domain>\t<subdomains>\t<path>\t<secure>\t<expires>\t<name>\t<value>
 *
 * @param {chrome.cookies.Cookie[]} cookies - Cookies to copy.
 * @returns {Promise<{json: string, netscape: string}>}
 */
function copyCookiesToClipboard(cookies) {
  if (!Array.isArray(cookies)) {
    return Promise.reject(new Error('copyCookiesToClipboard: cookies must be an array'));
  }

  const jsonString = formatCookiesAsJson(cookies);
  const netscapeString = formatCookiesAsNetscape(cookies);

  // Combine both formats in the clipboard text so the user has both.
  const clipboardText = [
    '### JSON Format ###',
    jsonString,
    '',
    '### Netscape Format ###',
    netscapeString,
  ].join('\n');

  return navigator.clipboard.writeText(clipboardText).then(() => ({
    json: jsonString,
    netscape: netscapeString,
  }));
}

// ---------------------------------------------------------------------------
// Format helpers (exported so popup.js can use them independently)
// ---------------------------------------------------------------------------

/**
 * Serialize cookies as a pretty-printed JSON string.
 *
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {string}
 */
function formatCookiesAsJson(cookies) {
  return JSON.stringify(cookies, null, 2);
}

/**
 * Serialize cookies in Netscape/cookies.txt format.
 * Each line: domain \t subdomains \t path \t secure \t expires \t name \t value
 *
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {string}
 */
function formatCookiesAsNetscape(cookies) {
  const header = [
    '# Netscape HTTP Cookie File',
    '# Generated by Cookie Manager Chrome Extension',
    '#',
  ].join('\n');

  const lines = cookies.map((cookie) => {
    const domain      = cookie.domain || '';
    // Chrome stores host-only cookies without a leading dot.
    // Netscape format uses TRUE for subdomains (leading dot present).
    const subdomains  = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path        = cookie.path || '/';
    const secure      = cookie.secure ? 'TRUE' : 'FALSE';
    // 0 means session cookie in Netscape format.
    const expires     = cookie.expirationDate ? Math.round(cookie.expirationDate) : 0;
    const name        = cookie.name  || '';
    const value       = cookie.value || '';

    // Prefix HttpOnly cookies per extended Netscape format.
    const domainField = cookie.httpOnly ? `#HttpOnly_${domain}` : domain;

    return [domainField, subdomains, path, secure, expires, name, value].join('\t');
  });

  return [header, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Support both ES module environments and plain Chrome extension content scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getAllCookies,
    getCookieDetails,
    deleteCookie,
    deleteSelectedCookies,
    updateCookie,
    createCookie,
    searchCookies,
    copyCookiesToClipboard,
    formatCookiesAsJson,
    formatCookiesAsNetscape,
  };
} else {
  // Attach to global scope so popup.js and background.js can access it
  // when loaded as plain <script> tags in the extension.
  globalThis.cookieManager = {
    getAllCookies,
    getCookieDetails,
    deleteCookie,
    deleteSelectedCookies,
    updateCookie,
    createCookie,
    searchCookies,
    copyCookiesToClipboard,
    formatCookiesAsJson,
    formatCookiesAsNetscape,
  };
}
