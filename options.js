/**
 * Cookie Manager – options.js
 *
 * Advanced options page providing:
 *   - Cross-domain cookie transfer between tabs
 *   - Cookie import from JSON / Netscape / pairs formats
 *   - Bulk export / delete per domain
 */

'use strict';

/* =========================================================
   STATE
   ========================================================= */
const state = {
  /** @type {chrome.tabs.Tab[]} */
  tabs: [],
  /** @type {chrome.cookies.Cookie[]} */
  sourceCookies: [],
  /** @type {chrome.cookies.Cookie[]} */
  targetCookies: [],
};

/* =========================================================
   DOM REFS
   ========================================================= */
const $ = (id) => document.getElementById(id);

const dom = {
  themeToggleBtn:      $('themeToggleBtn'),
  sourceTab:           $('sourceTab'),
  targetTab:           $('targetTab'),
  sourceCookies:       $('sourceCookies'),
  targetCookies:       $('targetCookies'),
  sourceCookieCount:   $('sourceCookieCount'),
  targetCookieCount:   $('targetCookieCount'),
  sourceSelectAll:     $('sourceSelectAll'),
  transferOverwrite:   $('transferOverwrite'),
  transferMoveMode:    $('transferMoveMode'),
  transferSelectedBtn: $('transferSelectedBtn'),
  transferAllBtn:      $('transferAllBtn'),
  importFormat:        $('importFormat'),
  targetDomain:        $('targetDomain'),
  importData:          $('importData'),
  importBtn:           $('importBtn'),
  bulkDomainSelect:    $('bulkDomainSelect'),
  bulkExportBtn:       $('bulkExportBtn'),
  bulkDeleteBtn:       $('bulkDeleteBtn'),
  statusBar:           $('statusBar'),
};

/* =========================================================
   ENTRY POINT
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  await loadThemePreference();
  bindEvents();
  await init();
});

async function init() {
  await loadTabs();
  renderTabSelects();
  await populateBulkDomains();
}

/* =========================================================
   TABS
   ========================================================= */
async function loadTabs() {
  state.tabs = (await chrome.tabs.query({}))
    .filter((t) => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
}

function renderTabSelects() {
  [dom.sourceTab, dom.targetTab].forEach((select, idx) => {
    const placeholder = idx === 0 ? 'Select source tab…' : 'Select target tab…';
    select.innerHTML = `<option value="">${placeholder}</option>`;
    state.tabs.forEach((tab) => {
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.textContent = truncate(`${extractDomain(tab.url)} – ${tab.title || tab.url}`, 60);
      select.appendChild(opt);
    });
  });
}

/* =========================================================
   LOAD COOKIES FOR A TAB
   ========================================================= */
async function loadCookiesForTab(tabId) {
  const tab = state.tabs.find((t) => t.id === Number(tabId));
  if (!tab) return [];
  try {
    const res = await sendToBackground('GET_COOKIES', { url: tab.url });
    return res?.cookies ?? [];
  } catch {
    return chrome.cookies.getAll({ url: tab.url });
  }
}

/* =========================================================
   RENDER COOKIE LISTS
   ========================================================= */
function renderCookieList(container, cookies, withCheckboxes) {
  container.innerHTML = '';
  if (cookies.length === 0) {
    container.innerHTML = '<div class="empty-msg">No cookies</div>';
    return;
  }
  cookies.forEach((cookie, i) => {
    const item = document.createElement('div');
    item.className = 'cookie-item';
    item.setAttribute('role', 'listitem');

    let inner = '';
    if (withCheckboxes) {
      inner += `<input type="checkbox" data-index="${i}" checked aria-label="Select cookie ${cookie.name}" />`;
    }
    inner += `<span class="cookie-item-name" title="${escapeHtml(cookie.name)}">${escapeHtml(truncate(cookie.name, 28))}</span>`;
    inner += `<span class="cookie-item-value" title="${escapeHtml(cookie.value)}">${escapeHtml(truncate(cookie.value, 24))}</span>`;
    inner += `<span class="cookie-item-domain">${escapeHtml(cookie.domain)}</span>`;
    item.innerHTML = inner;
    container.appendChild(item);
  });
}

/* =========================================================
   TRANSFER
   ========================================================= */
async function transferCookies(onlySelected) {
  const sourceTabId = Number(dom.sourceTab.value);
  const targetTabId = Number(dom.targetTab.value);

  if (!sourceTabId || !targetTabId) {
    showStatus('Please select both source and target tabs.', 'error');
    return;
  }
  if (sourceTabId === targetTabId) {
    showStatus('Source and target must be different tabs.', 'error');
    return;
  }

  const sourceTab = state.tabs.find((t) => t.id === sourceTabId);
  const targetTab = state.tabs.find((t) => t.id === targetTabId);
  if (!sourceTab?.url || !targetTab?.url) {
    showStatus('Could not determine tab URLs.', 'error');
    return;
  }

  let cookiesToTransfer = [...state.sourceCookies];

  // Filter to selected only
  if (onlySelected) {
    const checked = dom.sourceCookies.querySelectorAll('input[type="checkbox"]:checked');
    const indices = new Set(Array.from(checked).map((cb) => Number(cb.dataset.index)));
    cookiesToTransfer = cookiesToTransfer.filter((_, i) => indices.has(i));
  }

  if (cookiesToTransfer.length === 0) {
    showStatus('No cookies to transfer.', 'info');
    return;
  }

  // Filter out existing if not overwriting
  if (!dom.transferOverwrite.checked) {
    const targetNames = new Set(state.targetCookies.map((c) => c.name));
    cookiesToTransfer = cookiesToTransfer.filter((c) => !targetNames.has(c.name));
  }

  try {
    dom.transferSelectedBtn.disabled = true;
    dom.transferAllBtn.disabled = true;

    const response = await sendToBackground('TRANSFER_COOKIES', {
      sourceUrl: sourceTab.url,
      targetUrl: targetTab.url,
      cookies:   cookiesToTransfer,
    });

    const results = response?.results ?? [];
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      console.warn('[Options] Transfer partial failures:', failed);
    }

    // Move mode: delete from source
    if (dom.transferMoveMode.checked) {
      for (const cookie of cookiesToTransfer) {
        try {
          const url = buildCookieUrl(cookie);
          await chrome.cookies.remove({ url, name: cookie.name });
        } catch { /* skip */ }
      }
    }

    showStatus(
      `Transferred ${succeeded} cookie${succeeded !== 1 ? 's' : ''} to ${extractDomain(targetTab.url)}.`,
      'success',
    );

    // Reload both panels
    await refreshBothPanels();
  } catch (err) {
    showStatus(`Transfer failed: ${err.message}`, 'error');
  } finally {
    dom.transferSelectedBtn.disabled = false;
    dom.transferAllBtn.disabled = false;
  }
}

/* =========================================================
   IMPORT
   ========================================================= */
async function importCookies() {
  const rawData = dom.importData.value.trim();
  const format = dom.importFormat.value;
  const targetDomain = dom.targetDomain.value.trim();

  if (!rawData) {
    showStatus('Please paste cookie data to import.', 'error');
    return;
  }

  let parsed;
  try {
    parsed = ExportFormats.parse(rawData, format);
  } catch (err) {
    showStatus(`Parse error: ${err.message}`, 'error');
    return;
  }

  if (!parsed || parsed.length === 0) {
    showStatus('No valid cookies found in the pasted data.', 'error');
    return;
  }

  // If a target domain is given, override cookie domains
  if (targetDomain) {
    parsed.forEach((c) => { c.domain = targetDomain; });
  }

  // Build the URL for each cookie and set via background
  let imported = 0;
  const errors = [];

  for (const cookie of parsed) {
    try {
      const domain = cookie.domain || targetDomain;
      if (!domain) {
        errors.push(`Cookie "${cookie.name}" has no domain and no target domain set.`);
        continue;
      }
      const url = `https://${domain.startsWith('.') ? domain.slice(1) : domain}${cookie.path || '/'}`;
      const details = {
        url,
        name:     cookie.name,
        value:    cookie.value ?? '',
        domain:   domain,
        path:     cookie.path || '/',
        secure:   Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'lax',
      };
      if (cookie.expirationDate) {
        details.expirationDate = cookie.expirationDate;
      }
      await chrome.cookies.set(details);
      imported++;
    } catch (err) {
      errors.push(`"${cookie.name}": ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.warn('[Options] Import errors:', errors);
  }

  showStatus(
    `Imported ${imported} cookie${imported !== 1 ? 's' : ''}${errors.length ? ` (${errors.length} failed)` : ''}.`,
    imported > 0 ? 'success' : 'error',
  );

  dom.importData.value = '';
  await populateBulkDomains();
}

/* =========================================================
   BULK OPERATIONS
   ========================================================= */
async function populateBulkDomains() {
  try {
    const cookies = await chrome.cookies.getAll({});
    const domains = [...new Set(cookies.map((c) => c.domain).filter(Boolean))].sort();
    dom.bulkDomainSelect.innerHTML = '<option value="">Choose a domain…</option>';
    domains.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      dom.bulkDomainSelect.appendChild(opt);
    });
  } catch {
    /* ignore */
  }
}

async function bulkExport() {
  const domain = dom.bulkDomainSelect.value;
  if (!domain) {
    showStatus('Select a domain first.', 'error');
    return;
  }
  const cookies = await chrome.cookies.getAll({ domain });
  if (cookies.length === 0) {
    showStatus('No cookies found for this domain.', 'info');
    return;
  }
  const json = ExportFormats.toJSON(cookies);
  await copyToClipboard(json);
  showStatus(`Exported ${cookies.length} cookie${cookies.length !== 1 ? 's' : ''} to clipboard (JSON).`, 'success');
}

async function bulkDelete() {
  const domain = dom.bulkDomainSelect.value;
  if (!domain) {
    showStatus('Select a domain first.', 'error');
    return;
  }
  const cookies = await chrome.cookies.getAll({ domain });
  if (cookies.length === 0) {
    showStatus('No cookies to delete.', 'info');
    return;
  }
  const confirmed = confirm(`Delete all ${cookies.length} cookie(s) for "${domain}"?\n\nThis cannot be undone.`);
  if (!confirmed) return;

  let deleted = 0;
  for (const c of cookies) {
    try {
      const url = buildCookieUrl(c);
      await chrome.cookies.remove({ url, name: c.name });
      deleted++;
    } catch { /* skip */ }
  }
  showStatus(`Deleted ${deleted} cookie${deleted !== 1 ? 's' : ''} for ${domain}.`, 'success');
  await populateBulkDomains();
}

/* =========================================================
   THEME
   ========================================================= */
async function loadThemePreference() {
  try {
    const result = await chrome.storage.local.get('darkMode');
    if (result.darkMode) {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  }
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  if (isDark) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = 'dark';
  }
  try { chrome.storage.local.set({ darkMode: !isDark }); } catch { /* ignore */ }
}

/* =========================================================
   EVENT BINDINGS
   ========================================================= */
function bindEvents() {
  // Theme
  dom.themeToggleBtn.addEventListener('click', toggleTheme);

  // Source tab change → load source cookies
  dom.sourceTab.addEventListener('change', async () => {
    state.sourceCookies = dom.sourceTab.value ? await loadCookiesForTab(dom.sourceTab.value) : [];
    dom.sourceCookieCount.textContent = `${state.sourceCookies.length} cookies`;
    renderCookieList(dom.sourceCookies, state.sourceCookies, true);
  });

  // Target tab change → load target cookies
  dom.targetTab.addEventListener('change', async () => {
    state.targetCookies = dom.targetTab.value ? await loadCookiesForTab(dom.targetTab.value) : [];
    dom.targetCookieCount.textContent = `${state.targetCookies.length} cookies`;
    renderCookieList(dom.targetCookies, state.targetCookies, false);
  });

  // Select all source
  dom.sourceSelectAll.addEventListener('click', () => {
    const cbs = dom.sourceCookies.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(cbs).every((cb) => cb.checked);
    cbs.forEach((cb) => { cb.checked = !allChecked; });
    dom.sourceSelectAll.textContent = allChecked ? 'Select All' : 'Deselect All';
  });

  // Transfer
  dom.transferSelectedBtn.addEventListener('click', () => transferCookies(true));
  dom.transferAllBtn.addEventListener('click', () => transferCookies(false));

  // Import
  dom.importBtn.addEventListener('click', importCookies);

  // Bulk
  dom.bulkExportBtn.addEventListener('click', bulkExport);
  dom.bulkDeleteBtn.addEventListener('click', bulkDelete);
}

/* =========================================================
   HELPERS
   ========================================================= */
async function refreshBothPanels() {
  if (dom.sourceTab.value) {
    state.sourceCookies = await loadCookiesForTab(dom.sourceTab.value);
    dom.sourceCookieCount.textContent = `${state.sourceCookies.length} cookies`;
    renderCookieList(dom.sourceCookies, state.sourceCookies, true);
  }
  if (dom.targetTab.value) {
    state.targetCookies = await loadCookiesForTab(dom.targetTab.value);
    dom.targetCookieCount.textContent = `${state.targetCookies.length} cookies`;
    renderCookieList(dom.targetCookies, state.targetCookies, false);
  }
}

function sendToBackground(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success === false) {
        reject(new Error(response.error || 'Background operation failed'));
      } else {
        resolve(response);
      }
    });
  });
}

function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? 'https' : 'http';
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return `${scheme}://${domain}${cookie.path || '/'}`;
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

let statusTimer = null;
function showStatus(message, type = 'info', duration = 4000) {
  dom.statusBar.textContent = message;
  dom.statusBar.className = `status-bar ${type}`;
  dom.statusBar.hidden = false;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { dom.statusBar.hidden = true; }, duration);
}
