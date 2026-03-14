/**
 * Cookie Transfer Manager
 * Advanced features for transferring, exporting, and importing cookies
 */

const TransferManager = {
  /**
   * Transfer cookies from one tab's domain to another
   * @param {number} sourceTabId - Source tab ID
   * @param {number} targetTabId - Target tab ID
   * @param {Array<string>} [cookieNames] - Optional array of cookie names to transfer (all if omitted)
   * @returns {Promise<{success: boolean, transferred: number, errors: string[]}>}
   */
  async transferCookies(sourceTabId, targetTabId, cookieNames = null) {
    const result = {
      success: false,
      transferred: 0,
      errors: []
    };

    try {
      // Get source and target tab info
      const sourceTab = await chrome.tabs.get(sourceTabId);
      const targetTab = await chrome.tabs.get(targetTabId);

      if (!sourceTab || !sourceTab.url) {
        result.errors.push('Source tab not found or has no URL');
        return result;
      }

      if (!targetTab || !targetTab.url) {
        result.errors.push('Target tab not found or has no URL');
        return result;
      }

      const sourceDomain = this._extractDomain(sourceTab.url);
      const targetDomain = this._extractDomain(targetTab.url);

      if (!sourceDomain || !targetDomain) {
        result.errors.push('Could not extract domains from tabs');
        return result;
      }

      // Get all cookies from source domain
      const sourceCookies = await chrome.cookies.getAll({ domain: sourceDomain });

      // Also get cookies with leading dot
      const sourceCookiesWithDot = await chrome.cookies.getAll({ domain: '.' + sourceDomain });
      const allSourceCookies = [...sourceCookies, ...sourceCookiesWithDot];

      // Filter by cookie names if specified
      let cookiesToTransfer = allSourceCookies;
      if (cookieNames && cookieNames.length > 0) {
        cookiesToTransfer = allSourceCookies.filter(cookie =>
          cookieNames.includes(cookie.name)
        );
      }

      // Remove duplicates based on name+domain+path
      const uniqueCookies = this._deduplicateCookies(cookiesToTransfer);

      // Transfer each cookie to target domain
      for (const cookie of uniqueCookies) {
        try {
          const cookieDetails = {
            url: this._buildCookieUrl(targetDomain, cookie.secure, cookie.path),
            name: cookie.name,
            value: cookie.value,
            domain: this._normalizeDomainForTarget(targetDomain, cookie.domain),
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'lax'
          };

          // Only include expiration if it exists and is valid
          if (cookie.expirationDate && cookie.expirationDate > Date.now() / 1000) {
            cookieDetails.expirationDate = cookie.expirationDate;
          }

          await chrome.cookies.set(cookieDetails);
          result.transferred++;
        } catch (error) {
          result.errors.push(`Failed to transfer cookie '${cookie.name}': ${error.message}`);
        }
      }

      result.success = result.transferred > 0 || result.errors.length === 0;
    } catch (error) {
      result.errors.push(`Transfer failed: ${error.message}`);
    }

    return result;
  },

  /**
   * Export cookies in various formats
   * @param {string} format - Export format: 'json', 'netscape', or 'pairs'
   * @param {Array<Object>} cookies - Array of cookie objects to export
   * @returns {string} Exported cookies in the specified format
   */
  exportCookies(format, cookies) {
    if (!cookies || !Array.isArray(cookies)) {
      return '';
    }

    switch (format.toLowerCase()) {
      case 'json':
        return this._exportAsJson(cookies);
      case 'netscape':
        return this._exportAsNetscape(cookies);
      case 'pairs':
        return this._exportAsPairs(cookies);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  },

  /**
   * Import cookies from various formats
   * @param {string} data - Cookie data to import
   * @param {string} format - Import format: 'json', 'netscape', or 'pairs'
   * @returns {Promise<{success: boolean, imported: number, cookies: Array, errors: string[]}>}
   */
  async importCookies(data, format) {
    const result = {
      success: false,
      imported: 0,
      cookies: [],
      errors: []
    };

    if (!data || typeof data !== 'string') {
      result.errors.push('No data provided for import');
      return result;
    }

    let parsedCookies = [];

    try {
      switch (format.toLowerCase()) {
        case 'json':
          parsedCookies = this._parseJsonFormat(data);
          break;
        case 'netscape':
          parsedCookies = this._parseNetscapeFormat(data);
          break;
        case 'pairs':
          parsedCookies = this._parsePairsFormat(data);
          break;
        default:
          result.errors.push(`Unsupported import format: ${format}`);
          return result;
      }
    } catch (error) {
      result.errors.push(`Failed to parse data: ${error.message}`);
      return result;
    }

    if (parsedCookies.length === 0) {
      result.errors.push('No valid cookies found in the data');
      return result;
    }

    // Set each cookie
    for (const cookie of parsedCookies) {
      try {
        // Validate cookie has required fields
        if (!cookie.name || cookie.value === undefined) {
          result.errors.push(`Skipping invalid cookie: missing name or value`);
          continue;
        }

        if (!cookie.domain && !cookie.url) {
          result.errors.push(`Skipping cookie '${cookie.name}': no domain specified`);
          continue;
        }

        const cookieDetails = {
          url: cookie.url || this._buildCookieUrl(cookie.domain, cookie.secure, cookie.path),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
          sameSite: cookie.sameSite || 'lax'
        };

        if (cookie.expirationDate) {
          cookieDetails.expirationDate = cookie.expirationDate;
        }

        const setCookie = await chrome.cookies.set(cookieDetails);
        result.cookies.push(setCookie);
        result.imported++;
      } catch (error) {
        result.errors.push(`Failed to import cookie '${cookie.name}': ${error.message}`);
      }
    }

    result.success = result.imported > 0;
    return result;
  },

  /**
   * Batch set multiple cookies to a domain
   * @param {string} domain - Target domain
   * @param {Array<Object>} cookies - Array of cookie objects to set
   * @returns {Promise<{success: boolean, set: number, cookies: Array, errors: string[]}>}
   */
  async autoSetCookies(domain, cookies) {
    const result = {
      success: false,
      set: 0,
      cookies: [],
      errors: []
    };

    if (!domain) {
      result.errors.push('Domain is required');
      return result;
    }

    if (!cookies || !Array.isArray(cookies)) {
      result.errors.push('Cookies array is required');
      return result;
    }

    const normalizedDomain = this._normalizeDomain(domain);

    for (const cookie of cookies) {
      try {
        // Handle string format 'name=value'
        let cookieObj = cookie;
        if (typeof cookie === 'string') {
          const parts = cookie.split('=');
          if (parts.length >= 2) {
            cookieObj = {
              name: parts[0].trim(),
              value: parts.slice(1).join('=').trim()
            };
          } else {
            result.errors.push(`Invalid cookie string: ${cookie}`);
            continue;
          }
        }

        if (!cookieObj.name) {
          result.errors.push('Cookie missing name');
          continue;
        }

        const cookieDetails = {
          url: this._buildCookieUrl(normalizedDomain, cookieObj.secure, cookieObj.path),
          name: cookieObj.name,
          value: cookieObj.value || '',
          domain: cookieObj.domain || normalizedDomain,
          path: cookieObj.path || '/',
          secure: cookieObj.secure || false,
          httpOnly: cookieObj.httpOnly || false,
          sameSite: cookieObj.sameSite || 'lax'
        };

        if (cookieObj.expirationDate) {
          cookieDetails.expirationDate = cookieObj.expirationDate;
        } else {
          // Default to 1 year if no expiration
          cookieDetails.expirationDate = Math.floor(Date.now() / 1000) + 31536000;
        }

        const setCookie = await chrome.cookies.set(cookieDetails);
        result.cookies.push(setCookie);
        result.set++;
      } catch (error) {
        result.errors.push(`Failed to set cookie '${cookie.name || cookie}': ${error.message}`);
      }
    }

    result.success = result.set > 0;
    return result;
  },

  // Private helper methods

  _extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return null;
    }
  },

  _buildCookieUrl(domain, secure = false, path = '/') {
    const protocol = secure ? 'https' : 'http';
    const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
    return `${protocol}://${cleanDomain}${path}`;
  },

  _normalizeDomain(domain) {
    if (!domain) return '';
    return domain.startsWith('.') ? domain.slice(1) : domain;
  },

  _normalizeDomainForTarget(targetDomain, sourceDomain) {
    // If source domain started with a dot, preserve that pattern
    if (sourceDomain && sourceDomain.startsWith('.')) {
      return '.' + targetDomain;
    }
    return targetDomain;
  },

  _deduplicateCookies(cookies) {
    const seen = new Map();
    for (const cookie of cookies) {
      const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
      if (!seen.has(key)) {
        seen.set(key, cookie);
      }
    }
    return Array.from(seen.values());
  },

  // Export format implementations

  _exportAsJson(cookies) {
    const exportData = cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate,
      hostOnly: cookie.hostOnly,
      session: cookie.session
    }));

    return JSON.stringify(exportData, null, 2);
  },

  _exportAsNetscape(cookies) {
    // Netscape cookies.txt format
    // domain    flag    path    secure    expiration    name    value
    let output = '# Netscape HTTP Cookie File\n';
    output += '# https://curl.haxx.se/rfc/cookie_spec.html\n';
    output += '# This is a generated file! Do not edit.\n\n';

    for (const cookie of cookies) {
      const domain = cookie.domain || '';
      const flag = cookie.domain && cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const path = cookie.path || '/';
      const secure = cookie.secure ? 'TRUE' : 'FALSE';
      const expiration = Math.floor(cookie.expirationDate || (Date.now() / 1000 + 31536000));
      const name = cookie.name || '';
      const value = cookie.value || '';

      output += `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}\n`;
    }

    return output;
  },

  _exportAsPairs(cookies) {
    // Simple name=value pairs, one per line
    return cookies
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('\n');
  },

  // Import format parsers

  _parseJsonFormat(data) {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return [parsed];
    }
    return parsed;
  },

  _parseNetscapeFormat(data) {
    const cookies = [];
    const lines = data.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse tab-separated values
      const parts = trimmed.split(/\t+/);
      if (parts.length >= 7) {
        cookies.push({
          domain: parts[0],
          path: parts[2],
          secure: parts[3].toUpperCase() === 'TRUE',
          expirationDate: parseInt(parts[4], 10),
          name: parts[5],
          value: parts[6]
        });
      }
    }

    return cookies;
  },

  _parsePairsFormat(data) {
    const cookies = [];
    const lines = data.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex > 0) {
        cookies.push({
          name: trimmed.substring(0, separatorIndex).trim(),
          value: trimmed.substring(separatorIndex + 1).trim()
        });
      }
    }

    return cookies;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TransferManager;
}
