/**
 * Cookie Manager – popup.js
 *
 * Responsibilities:
 *  - Load cookies for the active tab on popup open
 *  - Render, filter, and search cookie cards
 *  - Handle Refresh, Delete Selected, Copy All, Clear All, Delete Single actions
 *  - Populate source/target tab dropdowns for the transfer section
 *  - Communicate complex operations to the background service worker via
 *    chrome.runtime.sendMessage (delegates to cookieManager.js + transferManager.js)
 *  - Persist dark-mode preference in chrome.storage.local
 */

'use strict';

/* =========================================================
   STATE
   ========================================================= */
const state = {
  /** @type {chrome.cookies.Cookie[]} */
  allCookies: [],
  /** @type {chrome.cookies.Cookie[]} */
  filteredCookies: [],
  /** @type {string} */
  currentUrl: '',
  /** @type {string} */
  currentDomain: '',
  /** @type {boolean} */
  allSelected: false,
  /** @type {string} */
  searchQuery: '',
  /** @type {string} */
  domainFilterValue: '',
};

/* =========================================================
   DOM REFS
   ========================================================= */
const $ = id => document.getElementById(id);

const dom = {
  // Header
  themeToggleBtn: $('themeToggleBtn'),
  refreshBtn:     $('refreshBtn'),

  // Tab info
  currentDomain:  $('currentDomain'),
  cookieCount:    $('cookieCount'),

  // Filters
  searchInput:    $('searchInput'),
  clearSearchBtn: $('clearSearchBtn'),
  domainFilter:   $('domainFilter'),

  // Actions
  selectAllBtn:      $('selectAllBtn'),
  deleteSelectedBtn: $('deleteSelectedBtn'),
  copyAllBtn:        $('copyAllBtn'),
  exportBtn:         $('exportBtn'),
  exportPanel:       $('exportPanel'),
  clearAllBtn:       $('clearAllBtn'),

  // List & states
  cookieList:    $('cookieList'),
  emptyState:    $('emptyState'),
  emptySubtitle: $('emptySubtitle'),
  loadingState:  $('loadingState'),

  // Transfer
  transferToggle: $('transferToggle'),
  transferBody:   $('transferBody'),
  sourceTab:      $('sourceTab'),
  targetTab:      $('targetTab'),
  transferBtn:    $('transferBtn'),

  // Status
  statusBar: $('statusBar'),
};

/* =========================================================
   ENTRY POINT
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  await loadThemePreference();
  bindEvents();
  await initPopup();
});

/* =========================================================
   INIT
   ========================================================= */
async function initPopup() {
  showLoading(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      showEmpty('No active tab URL detected.');
      return;
    }

    state.currentUrl = tab.url;
    state.currentDomain = extractDomain(tab.url);
    dom.currentDomain.textContent = state.currentDomain || 'unknown';

    await loadCookies();
    await populateTabDropdowns();
  } catch (err) {
    console.error('[CookieManager] initPopup error:', err);
    showEmpty(`Error: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

/* =========================================================
   COOKIES – LOAD
   ========================================================= */
async function loadCookies() {
  try {
    // Ask background to load cookies (protocol: GET_COOKIES)
    // Falls back to direct API if background not ready yet
    let cookies;
    try {
      const response = await sendToBackground('GET_COOKIES', { url: state.currentUrl });
      cookies = response?.cookies ?? [];
    } catch {
      // Fallback: query directly via chrome.cookies API
      cookies = await chrome.cookies.getAll({ url: state.currentUrl });
    }

    state.allCookies = cookies;
    applyFilters();
    renderCookieList();
    updateDomainFilterOptions();
    updateCookieCount();
  } catch (err) {
    console.error('[CookieManager] loadCookies error:', err);
    showStatus(`Failed to load cookies: ${err.message}`, 'error');
    showEmpty('Could not load cookies for this page.');
  }
}

/* =========================================================
   COOKIES – RENDER
   ========================================================= */
function renderCookieList() {
  dom.cookieList.innerHTML = '';

  if (state.filteredCookies.length === 0) {
    const hasQuery = state.searchQuery || state.domainFilterValue;
    dom.emptySubtitle.textContent = hasQuery
      ? 'No cookies match your current filters.'
      : 'This page has no cookies for the current domain.';
    showEmpty(null, true);
    return;
  }

  showEmpty(null, false);

  const fragment = document.createDocumentFragment();
  state.filteredCookies.forEach((cookie, index) => {
    fragment.appendChild(createCookieCard(cookie, index));
  });
  dom.cookieList.appendChild(fragment);
}

/**
 * Build a single cookie card element.
 * @param {chrome.cookies.Cookie} cookie
 * @param {number} index
 * @returns {HTMLElement}
 */
function createCookieCard(cookie, index) {
  const card = document.createElement('div');
  card.className = 'cookie-card';
  card.setAttribute('role', 'listitem');
  card.dataset.index = index;

  // ---- Checkbox ----
  const checkboxWrapper = document.createElement('div');
  checkboxWrapper.className = 'cookie-checkbox';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('aria-label', `Select cookie ${cookie.name}`);
  checkbox.addEventListener('change', () => {
    card.classList.toggle('selected', checkbox.checked);
    updateDeleteSelectedBtn();
  });
  checkboxWrapper.appendChild(checkbox);

  // ---- Content ----
  const content = document.createElement('div');
  content.className = 'cookie-content';

  // Header row (name + inline actions)
  const headerRow = document.createElement('div');
  headerRow.className = 'cookie-header-row';

  const nameEl = document.createElement('span');
  nameEl.className = 'cookie-name';
  nameEl.textContent = cookie.name || '(empty name)';
  nameEl.title = cookie.name;

  const inlineActions = document.createElement('div');
  inlineActions.className = 'cookie-actions-inline';

  // Copy value button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'cookie-action-btn';
  copyBtn.title = 'Copy value';
  copyBtn.setAttribute('aria-label', `Copy value of ${cookie.name}`);
  copyBtn.innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(cookie.value);
    showStatus(`Copied value of "${cookie.name}"`, 'success');
  });

  // Delete single cookie button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'cookie-action-btn delete-btn';
  deleteBtn.title = 'Delete this cookie';
  deleteBtn.setAttribute('aria-label', `Delete cookie ${cookie.name}`);
  deleteBtn.innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
  </svg>`;
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteSingleCookie(cookie);
  });

  inlineActions.appendChild(copyBtn);
  inlineActions.appendChild(deleteBtn);
  headerRow.appendChild(nameEl);
  headerRow.appendChild(inlineActions);

  // Value
  const valueEl = document.createElement('div');
  valueEl.className = 'cookie-value';
  valueEl.textContent = cookie.value ? truncate(cookie.value, 60) : '(empty)';
  valueEl.title = cookie.value;

  // Meta row
  const metaRow = document.createElement('div');
  metaRow.className = 'cookie-meta';

  // Domain chip
  if (cookie.domain) {
    const domainChip = document.createElement('span');
    domainChip.className = 'cookie-meta-item';
    domainChip.title = `Domain: ${cookie.domain}`;
    domainChip.innerHTML = `<svg class="icon" style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;
    domainChip.appendChild(document.createTextNode(truncate(cookie.domain, 28)));
    metaRow.appendChild(domainChip);
  }

  // Expiry chip
  const expiryChip = document.createElement('span');
  expiryChip.className = 'cookie-meta-item';
  if (cookie.session) {
    expiryChip.textContent = 'Session';
  } else if (cookie.expirationDate) {
    const date = new Date(cookie.expirationDate * 1000);
    const isExpired = date < new Date();
    expiryChip.textContent = isExpired
      ? `Expired ${formatDate(date)}`
      : `Exp ${formatDate(date)}`;
    if (isExpired) expiryChip.style.color = 'var(--color-danger)';
  }
  metaRow.appendChild(expiryChip);

  // Tags
  if (cookie.secure) {
    const tag = document.createElement('span');
    tag.className = 'cookie-tag secure';
    tag.textContent = 'Secure';
    metaRow.appendChild(tag);
  }
  if (cookie.httpOnly) {
    const tag = document.createElement('span');
    tag.className = 'cookie-tag httponly';
    tag.textContent = 'HttpOnly';
    metaRow.appendChild(tag);
  }
  if (cookie.session) {
    const tag = document.createElement('span');
    tag.className = 'cookie-tag session';
    tag.textContent = 'Session';
    metaRow.appendChild(tag);
  }

  content.appendChild(headerRow);
  content.appendChild(valueEl);
  content.appendChild(metaRow);

  card.appendChild(checkboxWrapper);
  card.appendChild(content);

  // Click card to toggle checkbox
  card.addEventListener('click', (e) => {
    if (e.target === checkbox || e.target.closest('.cookie-action-btn')) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
  });

  return card;
}

/* =========================================================
   FILTERS
   ========================================================= */
function applyFilters() {
  let result = state.allCookies;

  if (state.domainFilterValue) {
    result = result.filter(c => c.domain === state.domainFilterValue);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.value.toLowerCase().includes(q) ||
      (c.domain && c.domain.toLowerCase().includes(q))
    );
  }

  state.filteredCookies = result;
}

function updateDomainFilterOptions() {
  const domains = [...new Set(state.allCookies.map(c => c.domain).filter(Boolean))].sort();
  const currentVal = dom.domainFilter.value;

  dom.domainFilter.innerHTML = '<option value="">All domains</option>';
  domains.forEach(domain => {
    const opt = document.createElement('option');
    opt.value = domain;
    opt.textContent = truncate(domain, 30);
    opt.selected = domain === currentVal;
    dom.domainFilter.appendChild(opt);
  });
}

function updateCookieCount() {
  const total = state.allCookies.length;
  const filtered = state.filteredCookies.length;
  dom.cookieCount.textContent = state.searchQuery || state.domainFilterValue
    ? `${filtered}/${total}`
    : String(total);
}

/* =========================================================
   DELETE OPERATIONS
   ========================================================= */
async function deleteSingleCookie(cookie) {
  try {
    const url = buildCookieUrl(cookie);
    await chrome.cookies.remove({ url, name: cookie.name });
    showStatus(`Deleted cookie "${cookie.name}"`, 'success');
    await loadCookies();
  } catch (err) {
    console.error('[CookieManager] deleteSingleCookie error:', err);
    showStatus(`Failed to delete "${cookie.name}": ${err.message}`, 'error');
  }
}

async function deleteSelectedCookies() {
  const checkboxes = dom.cookieList.querySelectorAll('input[type="checkbox"]:checked');
  if (checkboxes.length === 0) {
    showStatus('No cookies selected.', 'info');
    return;
  }

  const toDelete = [];
  checkboxes.forEach(cb => {
    const idx = Number(cb.closest('.cookie-card').dataset.index);
    toDelete.push(state.filteredCookies[idx]);
  });

  try {
    let deleted = 0;
    for (const cookie of toDelete) {
      try {
        const url = buildCookieUrl(cookie);
        await chrome.cookies.remove({ url, name: cookie.name });
        deleted++;
      } catch (e) {
        console.warn('[CookieManager] delete failed for', cookie.name, e);
      }
    }
    showStatus(`Deleted ${deleted} cookie${deleted !== 1 ? 's' : ''}.`, 'success');
    await loadCookies();
  } catch (err) {
    showStatus(`Delete operation failed: ${err.message}`, 'error');
  }
}

async function clearAllCookies() {
  if (state.allCookies.length === 0) {
    showStatus('No cookies to clear.', 'info');
    return;
  }

  const confirmed = confirm(
    `Delete all ${state.allCookies.length} cookie(s) for ${state.currentDomain}?\n\nThis cannot be undone.`
  );
  if (!confirmed) return;

  try {
    // Delegate to background (protocol: DELETE_ALL_COOKIES)
    let count;
    try {
      const response = await sendToBackground('DELETE_ALL_COOKIES', { url: state.currentUrl });
      count = response?.count ?? 0;
    } catch {
      // Fallback: clear directly via chrome.cookies API
      count = 0;
      for (const cookie of state.allCookies) {
        try {
          await chrome.cookies.remove({ url: buildCookieUrl(cookie), name: cookie.name });
          count++;
        } catch { /* skip */ }
      }
    }

    showStatus(`Cleared ${count} cookie${count !== 1 ? 's' : ''} for ${state.currentDomain}.`, 'success');
    await loadCookies();
  } catch (err) {
    showStatus(`Clear failed: ${err.message}`, 'error');
  }
}

/* =========================================================
   COPY ALL
   ========================================================= */
async function copyAllCookies() {
  if (state.filteredCookies.length === 0) {
    showStatus('No cookies to copy.', 'info');
    return;
  }

  const cookieObj = state.filteredCookies.reduce((acc, c) => {
    acc[c.name] = c.value;
    return acc;
  }, {});

  const json = JSON.stringify(cookieObj, null, 2);
  await copyToClipboard(json);
  showStatus(`Copied ${state.filteredCookies.length} cookie${state.filteredCookies.length !== 1 ? 's' : ''} to clipboard.`, 'success');
}

/* =========================================================
   EXPORT
   ========================================================= */
function toggleExportPanel() {
  const panel = dom.exportPanel;
  panel.hidden = !panel.hidden;
}

async function exportCookies(format) {
  if (state.filteredCookies.length === 0) {
    showStatus('No cookies to export.', 'info');
    return;
  }

  let output;
  let label;
  switch (format) {
    case 'json':
      output = ExportFormats.toJSON(state.filteredCookies);
      label = 'JSON';
      break;
    case 'netscape':
      output = ExportFormats.toNetscape(state.filteredCookies);
      label = 'Netscape';
      break;
    case 'header':
      output = ExportFormats.toHeaderString(state.filteredCookies);
      label = 'Header';
      break;
    case 'pairs':
      output = ExportFormats.toPairs(state.filteredCookies);
      label = 'Pairs';
      break;
    default:
      output = ExportFormats.toJSON(state.filteredCookies);
      label = 'JSON';
  }

  await copyToClipboard(output);
  dom.exportPanel.hidden = true;
  showStatus(`Exported ${state.filteredCookies.length} cookie${state.filteredCookies.length !== 1 ? 's' : ''} as ${label} to clipboard.`, 'success');
}

/* =========================================================
   SELECT ALL
   ========================================================= */
function toggleSelectAll() {
  state.allSelected = !state.allSelected;
  const checkboxes = dom.cookieList.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = state.allSelected;
    cb.closest('.cookie-card').classList.toggle('selected', state.allSelected);
  });
  const label = dom.selectAllBtn.querySelector('.toolbar-btn-label');
  if (label) {
    label.textContent = state.allSelected ? 'Deselect All' : 'Select All';
  }
  dom.selectAllBtn.title = state.allSelected ? 'Deselect all' : 'Select all';
  updateDeleteSelectedBtn();
}

function updateDeleteSelectedBtn() {
  const count = dom.cookieList.querySelectorAll('input[type="checkbox"]:checked').length;
  dom.deleteSelectedBtn.disabled = count === 0;
  if (count > 0) {
    dom.deleteSelectedBtn.title = `Delete ${count} selected cookie${count !== 1 ? 's' : ''}`;
  } else {
    dom.deleteSelectedBtn.title = 'Delete selected cookies';
  }
}

/* =========================================================
   TRANSFER SECTION
   ========================================================= */
async function populateTabDropdowns() {
  try {
    const tabs = await chrome.tabs.query({});
    const options = tabs
      .filter(t => t.url && (t.url.startsWith('http') || t.url.startsWith('https')))
      .map(t => ({ id: t.id, title: truncate(t.title || t.url, 40), url: t.url }));

    [dom.sourceTab, dom.targetTab].forEach((select, idx) => {
      const currentVal = select.value;
      select.innerHTML = `<option value="">Select ${idx === 0 ? 'source' : 'target'} tab…</option>`;
      options.forEach(({ id, title }) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = title;
        if (String(id) === currentVal) opt.selected = true;
        select.appendChild(opt);
      });
    });

    // Pre-select current tab as source
    if (dom.sourceTab.options.length > 1) {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab) {
        const opt = [...dom.sourceTab.options].find(o => Number(o.value) === currentTab.id);
        if (opt) opt.selected = true;
      }
    }
  } catch (err) {
    console.warn('[CookieManager] populateTabDropdowns error:', err);
  }
}

async function transferCookies() {
  const sourceTabId = Number(dom.sourceTab.value);
  const targetTabId = Number(dom.targetTab.value);

  if (!sourceTabId || !targetTabId) {
    showStatus('Please select both source and target tabs.', 'error');
    return;
  }

  if (sourceTabId === targetTabId) {
    showStatus('Source and target tabs must be different.', 'error');
    return;
  }

  const overwrite = $('transferOverwrite').checked;
  const moveMode = $('transferMoveMode').checked;

  try {
    dom.transferBtn.disabled = true;
    dom.transferBtn.textContent = 'Transferring…';

    // Resolve tab URLs for both source and target
    const [sourceTabInfo, targetTabInfo] = await Promise.all([
      chrome.tabs.get(sourceTabId),
      chrome.tabs.get(targetTabId),
    ]);

    const sourceUrl = sourceTabInfo.url;
    const targetUrl = targetTabInfo.url;

    if (!sourceUrl || !targetUrl) {
      throw new Error('Could not determine URLs for selected tabs.');
    }

    // Fetch cookies from the source tab
    let sourceCookies;
    try {
      const res = await sendToBackground('GET_COOKIES', { url: sourceUrl });
      sourceCookies = res?.cookies ?? [];
    } catch {
      sourceCookies = await chrome.cookies.getAll({ url: sourceUrl });
    }

    if (sourceCookies.length === 0) {
      showStatus('Source tab has no cookies to transfer.', 'info');
      return;
    }

    // If not overwriting, filter out cookies that already exist on target
    if (!overwrite) {
      let targetCookies;
      try {
        const res = await sendToBackground('GET_COOKIES', { url: targetUrl });
        targetCookies = res?.cookies ?? [];
      } catch {
        targetCookies = await chrome.cookies.getAll({ url: targetUrl });
      }
      const targetNames = new Set(targetCookies.map(c => c.name));
      sourceCookies = sourceCookies.filter(c => !targetNames.has(c.name));
    }

    // Transfer via background (protocol: TRANSFER_COOKIES)
    const response = await sendToBackground('TRANSFER_COOKIES', {
      sourceUrl,
      targetUrl,
      cookies: sourceCookies,
    });

    const results = response?.results ?? [];
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      console.warn('[CookieManager] Transfer partial failures:', failed);
    }

    // If move mode: delete from source
    if (moveMode) {
      for (const cookie of sourceCookies) {
        try {
          await chrome.cookies.remove({ url: buildCookieUrl(cookie), name: cookie.name });
        } catch { /* skip */ }
      }
    }

    showStatus(
      `Transferred ${succeeded} cookie${succeeded !== 1 ? 's' : ''} ${moveMode ? '(moved)' : ''} to ${extractDomain(targetUrl)}.`,
      'success'
    );

    await loadCookies();
  } catch (err) {
    showStatus(`Transfer failed: ${err.message}`, 'error');
  } finally {
    dom.transferBtn.disabled = false;
    dom.transferBtn.innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg> Transfer Cookies`;
  }
}

/* =========================================================
   DARK MODE
   ========================================================= */
async function loadThemePreference() {
  try {
    const result = await chrome.storage.local.get('darkMode');
    if (result.darkMode) {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch {
    // storage not available in some contexts
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  }
}

async function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  if (isDark) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = 'dark';
  }
  try {
    await chrome.storage.local.set({ darkMode: !isDark });
  } catch { /* ignore */ }
}

/* =========================================================
   EVENT BINDINGS
   ========================================================= */
function bindEvents() {
  // Header
  dom.themeToggleBtn.addEventListener('click', toggleTheme);
  dom.refreshBtn.addEventListener('click', async () => {
    dom.refreshBtn.classList.add('spinning');
    await loadCookies();
    dom.refreshBtn.classList.remove('spinning');
  });

  // Search
  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value.trim();
    dom.clearSearchBtn.hidden = !state.searchQuery;
    applyFilters();
    renderCookieList();
    updateCookieCount();
  });

  dom.clearSearchBtn.addEventListener('click', () => {
    dom.searchInput.value = '';
    state.searchQuery = '';
    dom.clearSearchBtn.hidden = true;
    applyFilters();
    renderCookieList();
    updateCookieCount();
    dom.searchInput.focus();
  });

  // Domain filter
  dom.domainFilter.addEventListener('change', () => {
    state.domainFilterValue = dom.domainFilter.value;
    applyFilters();
    renderCookieList();
    updateCookieCount();
  });

  // Actions
  dom.selectAllBtn.addEventListener('click', toggleSelectAll);
  dom.deleteSelectedBtn.addEventListener('click', deleteSelectedCookies);
  dom.copyAllBtn.addEventListener('click', copyAllCookies);
  dom.exportBtn.addEventListener('click', toggleExportPanel);
  document.querySelectorAll('.export-format-btn').forEach((btn) => {
    btn.addEventListener('click', () => exportCookies(btn.dataset.format));
  });
  dom.clearAllBtn.addEventListener('click', clearAllCookies);

  // Transfer toggle
  dom.transferToggle.addEventListener('click', () => {
    const expanded = dom.transferToggle.getAttribute('aria-expanded') === 'true';
    dom.transferToggle.setAttribute('aria-expanded', String(!expanded));
    dom.transferBody.hidden = expanded;
  });

  dom.transferBtn.addEventListener('click', transferCookies);
}

/* =========================================================
   HELPERS
   ========================================================= */

/**
 * Send a message to the background service worker.
 * Uses the protocol: { type: 'MESSAGE_TYPE', data: { ...payload } }
 * Background responds with { success: true, ...data } or { success: false, error: string }
 *
 * @param {string} type  - One of the MSG constants from background.js
 * @param {object} [data] - Optional payload
 * @returns {Promise<object>}
 */
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

/**
 * Build a URL suitable for the chrome.cookies API from a cookie object.
 * @param {chrome.cookies.Cookie} cookie
 * @returns {string}
 */
function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? 'https' : 'http';
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return `${scheme}://${domain}${cookie.path || '/'}`;
}

/**
 * Extract the hostname from a URL string.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Truncate a string to maxLen with ellipsis.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

/**
 * Format a Date as a short human-readable string.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const now = new Date();
  const diff = date - now;
  const absDiff = Math.abs(diff);

  if (absDiff < 60_000) return 'just now';
  if (absDiff < 3_600_000) return `${Math.round(absDiff / 60_000)}m`;
  if (absDiff < 86_400_000) return `${Math.round(absDiff / 3_600_000)}h`;
  if (absDiff < 2_592_000_000) return `${Math.round(absDiff / 86_400_000)}d`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

/**
 * Copy text to the clipboard.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older Chrome
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

/* =========================================================
   UI STATE HELPERS
   ========================================================= */
function showLoading(visible) {
  dom.loadingState.hidden = !visible;
  dom.cookieList.hidden = visible;
  dom.emptyState.hidden = true;
}

function showEmpty(message, visible = true) {
  dom.emptyState.hidden = !visible;
  dom.cookieList.hidden = false;
  dom.loadingState.hidden = true;
  if (message) dom.emptySubtitle.textContent = message;
}

let statusTimer = null;
/**
 * Show a status message in the status bar.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} [duration=3000]
 */
function showStatus(message, type = 'info', duration = 3000) {
  dom.statusBar.textContent = message;
  dom.statusBar.className = `status-bar ${type}`;
  dom.statusBar.hidden = false;

  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    dom.statusBar.hidden = true;
  }, duration);
}
