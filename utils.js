/**
 * Cookie Manager Utilities
 * Helper functions for cookie parsing, formatting, and validation
 */

const Utils = {
  /**
   * Parse a cookie string in 'name=value; name2=value2' format
   * @param {string} str - Cookie string to parse
   * @returns {Array<{name: string, value: string}>} Array of cookie objects
   */
  parseCookieString(str) {
    if (!str || typeof str !== 'string') {
      return [];
    }

    const cookies = [];
    const pairs = str.split(';');

    for (const pair of pairs) {
      const trimmed = pair.trim();
      if (!trimmed) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        // Cookie with no value
        cookies.push({ name: trimmed, value: '' });
      } else {
        const name = trimmed.substring(0, separatorIndex).trim();
        const value = trimmed.substring(separatorIndex + 1).trim();
        cookies.push({ name, value });
      }
    }

    return cookies;
  },

  /**
   * Format a timestamp to human readable date
   * @param {number} timestamp - Unix timestamp in seconds or milliseconds
   * @returns {string} Human readable date string
   */
  formatExpiry(timestamp) {
    if (!timestamp) {
      return 'Session';
    }

    // Handle both seconds and milliseconds
    let ms = timestamp;
    if (timestamp < 10000000000) {
      // Likely seconds, convert to milliseconds
      ms = timestamp * 1000;
    }

    const date = new Date(ms);

    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }

    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    };

    return date.toLocaleDateString('en-US', options);
  },

  /**
   * Extract domain from a URL
   * @param {string} url - Full URL
   * @returns {string} Domain name
   */
  getDomainFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      // Try to extract domain without protocol
      const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/:]+)/i);
      return match ? match[1] : '';
    }
  },

  /**
   * Generate a unique identifier for a cookie
   * @param {Object} cookie - Cookie object
   * @returns {string} Unique identifier string
   */
  generateCookieId(cookie) {
    if (!cookie) {
      return '';
    }

    const parts = [
      cookie.name || '',
      cookie.domain || '',
      cookie.path || '/'
    ];

    // Include secure and httpOnly flags for uniqueness
    const flags = [
      cookie.secure ? 'S' : '',
      cookie.httpOnly ? 'H' : ''
    ].filter(Boolean).join('');

    const baseId = parts.join('|');
    return flags ? `${baseId}|${flags}` : baseId;
  },

  /**
   * Validate a cookie object has required fields
   * @param {Object} cookie - Cookie object to validate
   * @returns {{valid: boolean, errors: string[]}} Validation result
   */
  validateCookie(cookie) {
    const errors = [];

    if (!cookie || typeof cookie !== 'object') {
      return { valid: false, errors: ['Cookie must be an object'] };
    }

    // Name is required
    if (!cookie.name || typeof cookie.name !== 'string') {
      errors.push('Cookie name is required and must be a string');
    }

    // Value is required (can be empty string)
    if (cookie.value === undefined || cookie.value === null) {
      errors.push('Cookie value is required');
    }

    // Domain is required for setting
    if (!cookie.domain && !cookie.url) {
      errors.push('Cookie domain or url is required');
    }

    // Validate expiration if present
    if (cookie.expirationDate !== undefined) {
      if (typeof cookie.expirationDate !== 'number') {
        errors.push('Expiration date must be a number (Unix timestamp)');
      } else if (cookie.expirationDate < Date.now() / 1000) {
        errors.push('Expiration date is in the past');
      }
    }

    // Validate path if present
    if (cookie.path !== undefined && typeof cookie.path !== 'string') {
      errors.push('Path must be a string');
    }

    // Validate boolean fields
    if (cookie.secure !== undefined && typeof cookie.secure !== 'boolean') {
      errors.push('Secure must be a boolean');
    }

    if (cookie.httpOnly !== undefined && typeof cookie.httpOnly !== 'boolean') {
      errors.push('httpOnly must be a boolean');
    }

    // Validate sameSite if present
    if (cookie.sameSite !== undefined) {
      const validSameSite = ['no_restriction', 'lax', 'strict', 'unspecified'];
      if (!validSameSite.includes(cookie.sameSite)) {
        errors.push(`sameSite must be one of: ${validSameSite.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * Get the URL for setting a cookie (required by chrome.cookies.set)
   * @param {Object} cookie - Cookie object
   * @returns {string} Full URL for the cookie
   */
  getCookieUrl(cookie) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    return `${protocol}://${domain}${cookie.path || '/'}`;
  },

  /**
   * Check if a cookie matches a domain
   * @param {Object} cookie - Cookie object
   * @param {string} domain - Domain to check against
   * @returns {boolean} True if cookie matches domain
   */
  cookieMatchesDomain(cookie, domain) {
    if (!cookie || !cookie.domain || !domain) {
      return false;
    }

    const cookieDomain = cookie.domain.toLowerCase();
    const targetDomain = domain.toLowerCase();

    // Exact match
    if (cookieDomain === targetDomain) {
      return true;
    }

    // Handle domain cookies (starting with .)
    if (cookieDomain.startsWith('.')) {
      return targetDomain.endsWith(cookieDomain.slice(1)) ||
             targetDomain === cookieDomain.slice(1);
    }

    // Subdomain matching
    return targetDomain.endsWith(cookieDomain) ||
           cookieDomain.endsWith(targetDomain);
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
