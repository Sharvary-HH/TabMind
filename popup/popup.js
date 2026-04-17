// TabMind popup.js — main UI controller
import { heuristicCluster, aiCluster, findDuplicates, fuzzySearch, timeSince, getDomain } from './clustering.js';

// ===== State =====
let allTabs = [];
let allMeta = {};
let groups = [];
let customGroups = [];
let activeGroupId = '__all__';
let activeFilter = 'all';
let searchQuery = '';
let dupeIds = new Set();
let settings = {};
let workspaces = [];
let paletteSelectedIndex = 0;
let paletteFilteredTabs = [];

// ===== Boot =====
async function init() {
  settings = await msg('GET_SETTINGS');
  workspaces = await msg('GET_WORKSPACES');
  await reload();
  bindEvents();
}

async function reload() {
  allTabs = await msg('GET_ALL_TABS');
  allMeta = await msg('GET_TAB_METADATA');
  customGroups = await msg('GET_CUSTOM_GROUPS') || [];
  dupeIds = new Set(findDuplicates(allTabs));
  
  const manualMap = new Map();
  const autoTabs = [];
  
  for (const cg of customGroups) {
    manualMap.set(cg.id, { ...cg, tabs: [], source: 'manual' });
  }

  for (const t of allTabs) {
    const mId = t.manualGroupId;
    if (mId && manualMap.has(mId)) {
      manualMap.get(mId).tabs.push(t);
    } else {
      autoTabs.push(t);
    }
  }

  groups = [...manualMap.values()].filter(g => g.tabs.length > 0);
  groups.push(...heuristicCluster(autoTabs));

  renderSidebar();
  renderMain();
  renderStats();
}

// ===== Messaging helper =====
function msg(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

// ===== Stats =====
function renderStats() {
  const total = allTabs.length;
  const dupeCount = dupeIds.size;
  const oldCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const oldCount = allTabs.filter(t => {
    const la = allMeta[t.id]?.lastActive || 0;
    return la > 0 && la < oldCutoff;
  }).length;

  document.getElementById('topbar-stats').innerHTML = `
    <span class="stat-chip"><b>${total}</b> tabs</span>
    ${dupeCount > 0 ? `<span class="stat-chip danger"><b>${dupeCount}</b> dupes</span>` : ''}
    ${oldCount > 0 ? `<span class="stat-chip warn"><b>${oldCount}</b> old (7d+)</span>` : ''}
    <span class="stat-chip good"><b>${groups.length}</b> clusters</span>
  `;

  document.getElementById('action-stats').innerHTML = `
    <span><b>${total}</b> open</span>
    <span><b>${groups.length}</b> groups</span>
    ${dupeCount ? `<span style="color:var(--red)"><b>${dupeCount}</b> dupes</span>` : ''}
  `;
}

// ===== Sidebar =====
function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = '';

  // All tabs
  sidebar.appendChild(sidebarItem('__all__', null, 'All tabs', allTabs.length, activeGroupId === '__all__'));

  // Cluster section
  const clusterSection = document.createElement('div');
  clusterSection.className = 'sidebar-section';
  clusterSection.textContent = 'Clusters';
  sidebar.appendChild(clusterSection);

  for (const g of groups) {
    sidebar.appendChild(sidebarItem(g.id, g.color, g.label, g.tabs.length, activeGroupId === g.id));
  }

  // Workspaces section
  if (workspaces.length > 0) {
    const wsSection = document.createElement('div');
    wsSection.className = 'sidebar-section';
    wsSection.textContent = 'Workspaces';
    sidebar.appendChild(wsSection);

    for (const ws of workspaces) {
      const el = document.createElement('div');
      el.className = 'sidebar-workspace-btn';
      el.innerHTML = `
        <span style="font-size:11px">📌</span>
        <span class="sidebar-label" style="flex:1" title="Click to open">${esc(ws.name)}</span>
        <span class="sidebar-count">${ws.urls.length}</span>
        <button class="workspace-delete-btn" title="Delete session" data-id="${ws.id}">✕</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('workspace-delete-btn')) {
          e.stopPropagation();
          deleteWorkspace(ws.id);
        } else {
          restoreWorkspace(ws);
        }
      });
      sidebar.appendChild(el);
    }
  }

  const addWs = document.createElement('div');
  addWs.className = 'sidebar-workspace-btn';
  addWs.innerHTML = `<span>+</span> <span>Save session</span>`;
  addWs.addEventListener('click', saveCurrentSession);
  sidebar.appendChild(addWs);

  // Custom Groups section
  const addGroupBtn = document.createElement('div');
  addGroupBtn.className = 'sidebar-workspace-btn';
  addGroupBtn.innerHTML = `<span>+</span> <span style="color:var(--accent2)">New Custom Group</span>`;
  addGroupBtn.addEventListener('click', async () => {
    const name = prompt('Custom group name (e.g. My Project):');
    if (!name) return;
    const id = 'cg_' + Date.now();
    await msg('SAVE_CUSTOM_GROUP', { group: { id, label: name, color: '#7c6dfa' }});
    toast('Custom group created!', 'success');
    await reload();
  });
  sidebar.appendChild(addGroupBtn);
}

function sidebarItem(id, color, label, count, active) {
  const el = document.createElement('div');
  el.className = 'sidebar-item' + (active ? ' active' : '');
  el.innerHTML = `
    ${color ? `<span class="sidebar-dot" style="background:${color}"></span>` : `<span class="sidebar-dot" style="background:var(--text3)"></span>`}
    <span class="sidebar-label">${esc(label)}</span>
    <span class="sidebar-count">${count}</span>
  `;
  el.addEventListener('click', () => {
    activeGroupId = id;
    renderSidebar();
    renderMain();
  });
  return el;
}

// ===== Main panel =====
function renderMain() {
  const panel = document.getElementById('main-panel');
  panel.innerHTML = '';

  let tabsToShow = getFilteredTabs();

  if (tabsToShow.length === 0) {
    panel.innerHTML = `<div class="empty-state"><span class="icon">🔍</span><span>No tabs match your search</span></div>`;
    return;
  }

  if (searchQuery) {
    // Flat list during search
    const card = createGroupCard({
      id: 'search',
      label: `Results for "${searchQuery}"`,
      color: '#7c6dfa',
      tabs: tabsToShow,
    }, false);
    panel.appendChild(card);
    return;
  }

  const displayGroups = activeGroupId === '__all__' ? groups : groups.filter(g => g.id === activeGroupId);

  if (displayGroups.length === 0) {
    panel.innerHTML = `<div class="empty-state"><span class="icon">📂</span><span>No groups yet</span></div>`;
    return;
  }

  for (const g of displayGroups) {
    let tabs = g.tabs;
    if (activeFilter === 'recent') {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      tabs = tabs.filter(t => (allMeta[t.id]?.lastActive || 0) > cutoff);
    } else if (activeFilter === 'old') {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      tabs = tabs.filter(t => {
        const la = allMeta[t.id]?.lastActive || 0;
        return la > 0 && la < cutoff;
      });
    } else if (activeFilter === 'dupes') {
      tabs = tabs.filter(t => dupeIds.has(t.id));
    }
    if (tabs.length === 0) continue;
    const card = createGroupCard({ ...g, tabs }, false);
    panel.appendChild(card);
  }
}

function getFilteredTabs() {
  let tabs = activeGroupId === '__all__' ? allTabs : (groups.find(g => g.id === activeGroupId)?.tabs || []);

  if (searchQuery) {
    tabs = fuzzySearch(tabs, searchQuery);
  }
  if (activeFilter === 'recent') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    tabs = tabs.filter(t => (allMeta[t.id]?.lastActive || 0) > cutoff);
  } else if (activeFilter === 'old') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    tabs = tabs.filter(t => {
      const la = allMeta[t.id]?.lastActive || 0;
      return la > 0 && la < cutoff;
    });
  } else if (activeFilter === 'dupes') {
    tabs = tabs.filter(t => dupeIds.has(t.id));
  }
  return tabs;
}

function createGroupCard(group, collapsed = false) {
  const card = document.createElement('div');
  card.className = 'group-card' + (collapsed ? ' collapsed' : '');

  const header = document.createElement('div');
  header.className = 'group-header';
  header.innerHTML = `
    <span class="group-color-dot" style="background:${group.color}"></span>
    <span class="group-title">${esc(group.label)}</span>
    <span class="group-count">${group.tabs.length}</span>
    <span class="group-chevron">▾</span>
    <div class="group-actions">
      <button class="group-btn" data-action="open-all">Open all</button>
      <button class="group-btn" data-action="close-all">Close all</button>
      <button class="group-btn" data-action="save-group">Save</button>
    </div>
  `;

  header.querySelector('[data-action="open-all"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await msg('OPEN_URLS', { urls: group.tabs.map(t => t.url) });
    toast(`Opened ${group.tabs.length} tabs`);
  });
  header.querySelector('[data-action="close-all"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await msg('CLOSE_TABS', { tabIds: group.tabs.map(t => t.id) });
    toast(`Closed ${group.tabs.length} tabs`, 'success');
    await reload();
  });
  header.querySelector('[data-action="save-group"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const ws = { id: `ws_${Date.now()}`, name: group.label, urls: group.tabs.map(t => t.url), savedAt: Date.now() };
    await msg('SAVE_WORKSPACE', { workspace: ws });
    workspaces = await msg('GET_WORKSPACES');
    renderSidebar();
    toast(`Saved workspace: ${group.label}`, 'success');
  });

  header.addEventListener('click', () => {
    card.classList.toggle('collapsed');
  });

  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  for (const tab of group.tabs) {
    tabList.appendChild(createTabRow(tab));
  }

  card.appendChild(header);
  card.appendChild(tabList);
  return card;
}

function createTabRow(tab) {
  const row = document.createElement('div');
  row.className = 'tab-row' + (dupeIds.has(tab.id) ? ' is-dupe' : '');

  const age = timeSince(allMeta[tab.id]?.lastActive || 0);
  const domain = getDomain(tab.url);
  const titleHtml = searchQuery ? highlightMatch(tab.title, searchQuery) : esc(tab.title);

  row.innerHTML = `
    <span class="tab-favicon">${faviconHtml(tab)}</span>
    <span class="tab-title">${titleHtml}</span>
    <span class="tab-domain">${esc(domain)}</span>
    <span class="tab-age">${age}</span>
    <button class="tab-move" title="Move to custom group">⇲</button>
    <button class="tab-close" title="Close tab">✕</button>
  `;

  row.addEventListener('click', async (e) => {
    if (e.target.classList.contains('tab-close') || e.target.classList.contains('tab-move')) return;
    await msg('FOCUS_TAB', { tabId: tab.id, windowId: tab.windowId });
    window.close();
  });
  
  row.querySelector('.tab-move').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (customGroups.length === 0) {
      toast('Create a custom group first via the bottom of the sidebar!', 'warn');
      return;
    }
    const labels = customGroups.map((g, i) => `${i+1}: ${g.label}`).join('\n');
    const choice = prompt(`Move tab to custom group (enter number):\n${labels}\n\nType 0 to remove from manual group.`);
    if (choice === '0') {
       await msg('SET_TAB_MANUAL_GROUP', { tabId: tab.id, groupId: null });
       await reload();
       return;
    }
    const idx = parseInt(choice) - 1;
    if (customGroups[idx]) {
      await msg('SET_TAB_MANUAL_GROUP', { tabId: tab.id, groupId: customGroups[idx].id });
      await reload();
    }
  });

  row.querySelector('.tab-close').addEventListener('click', async (e) => {
    e.stopPropagation();
    await msg('CLOSE_TABS', { tabIds: [tab.id] });
    await reload();
  });
  return row;
}

function faviconHtml(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    return `<img src="${tab.favIconUrl}" onerror="this.parentElement.innerHTML=fallbackFavicon('${esc(tab.title)}')" />`;
  }
  return fallbackFavicon(tab.title);
}

window.fallbackFavicon = function(title) {
  const letter = (title || '?')[0].toUpperCase();
  return `<span class="tab-favicon-fallback">${letter}</span>`;
};

// ===== Command Palette =====
function openPalette() {
  paletteFilteredTabs = [...allTabs];
  paletteSelectedIndex = 0;
  document.getElementById('palette-overlay').classList.remove('hidden');
  document.getElementById('palette-input').value = '';
  renderPaletteResults(allTabs);
  document.getElementById('palette-input').focus();
}

function closePalette() {
  document.getElementById('palette-overlay').classList.add('hidden');
}

function renderPaletteResults(tabs) {
  const container = document.getElementById('palette-results');
  if (tabs.length === 0) {
    container.innerHTML = `<div class="palette-no-results">No tabs found</div>`;
    return;
  }
  container.innerHTML = '';
  const slice = tabs.slice(0, 40);
  slice.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'palette-result' + (i === paletteSelectedIndex ? ' selected' : '');
    const age = timeSince(allMeta[tab.id]?.lastActive || 0);
    const query = document.getElementById('palette-input').value;
    el.innerHTML = `
      <span class="palette-result-favicon">${faviconHtml(tab)}</span>
      <span class="palette-result-text">
        <span class="palette-result-title">${query ? highlightMatch(tab.title, query) : esc(tab.title)}</span>
        <span class="palette-result-url">${esc(tab.url.slice(0, 80))}</span>
      </span>
      <span class="palette-result-age">${age}</span>
    `;
    el.addEventListener('click', async () => {
      await msg('FOCUS_TAB', { tabId: tab.id, windowId: tab.windowId });
      window.close();
    });
    container.appendChild(el);
  });
  paletteFilteredTabs = slice;
}

// ===== AI Clustering =====
async function runAiCluster() {
  const provider = settings.aiProvider || 'local';
  
  if (provider === 'local' && (!window.ai || !window.ai.languageModel)) {
    toast('Local AI not found. Please enable chrome://flags/#prompt-api-for-extension', 'error');
    document.getElementById('settings-panel').classList.remove('hidden');
    return;
  }
  if (provider === 'anthropic' && !settings.anthropicKey) {
    toast('Add your Anthropic API key in Settings first', 'error');
    document.getElementById('settings-panel').classList.remove('hidden');
    return;
  }
  if (provider === 'gemini' && !settings.geminiKey) {
    toast('Add your Gemini API key in Settings first', 'error');
    document.getElementById('settings-panel').classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('btn-ai-cluster');
  btn.textContent = '✦ Clustering…';
  btn.classList.add('loading');

  try {
    const autoTabs = allTabs.filter(t => !t.manualGroupId || !customGroups.find(g => g.id === t.manualGroupId));
    const result = await aiCluster(autoTabs, settings);
    
    // Merge manual groups with AI results
    const manualMap = new Map();
    for (const cg of customGroups) manualMap.set(cg.id, { ...cg, tabs: [], source: 'manual' });
    for (const t of allTabs) {
      if (t.manualGroupId && manualMap.has(t.manualGroupId)) {
         manualMap.get(t.manualGroupId).tabs.push(t);
      }
    }
    
    groups = [...manualMap.values()].filter(g => g.tabs.length > 0);
    groups.push(...result);
    
    activeGroupId = '__all__';
    renderSidebar();
    renderMain();
    renderStats();
    toast(`AI created ${result.length} clusters ✨`, 'success');
  } catch (err) {
    console.error(err);
    toast('AI clustering failed: ' + err.message, 'error');
  } finally {
    btn.textContent = '✦ AI Cluster';
    btn.classList.remove('loading');
  }
}

// ===== Workspaces =====
async function saveCurrentSession() {
  const name = prompt('Workspace name:', `Session ${new Date().toLocaleDateString()}`);
  if (!name) return;
  const ws = { id: `ws_${Date.now()}`, name, urls: allTabs.map(t => t.url), savedAt: Date.now() };
  await msg('SAVE_WORKSPACE', { workspace: ws });
  workspaces = await msg('GET_WORKSPACES');
  renderSidebar();
  toast(`Saved: ${name}`, 'success');
}

async function restoreWorkspace(ws) {
  if (!confirm(`Open ${ws.urls.length} tabs from "${ws.name}"?`)) return;
  await msg('OPEN_URLS', { urls: ws.urls });
  toast(`Restored: ${ws.name}`, 'success');
}

async function deleteWorkspace(id) {
  if (!confirm('Delete this saved session?')) return;
  await msg('DELETE_WORKSPACE', { id });
  workspaces = await msg('GET_WORKSPACES');
  renderSidebar();
  toast('Session deleted', 'success');
}

// ===== Settings =====
function openSettings() {
  document.getElementById('setting-ai-provider').value = settings.aiProvider || 'local';
  document.getElementById('setting-anthropic-key').value = settings.anthropicKey || '';
  document.getElementById('setting-gemini-key').value = settings.geminiKey || '';
  document.getElementById('setting-suspend-days').value = settings.autoSuspendDays || 7;
  document.getElementById('setting-dupes-warn').checked = settings.showDuplicateWarning !== false;
  toggleApiFields();
  document.getElementById('settings-panel').classList.remove('hidden');
}

function toggleApiFields() {
  const provider = document.getElementById('setting-ai-provider').value;
  document.getElementById('row-anthropic-key').classList.toggle('hidden', provider !== 'anthropic');
  document.getElementById('row-gemini-key').classList.toggle('hidden', provider !== 'gemini');
}

async function saveSettings() {
  settings.aiProvider = document.getElementById('setting-ai-provider').value;
  settings.anthropicKey = document.getElementById('setting-anthropic-key').value.trim();
  settings.geminiKey = document.getElementById('setting-gemini-key').value.trim();
  settings.autoSuspendDays = parseInt(document.getElementById('setting-suspend-days').value) || 7;
  settings.showDuplicateWarning = document.getElementById('setting-dupes-warn').checked;
  await msg('SAVE_SETTINGS', { settings });
  document.getElementById('settings-panel').classList.add('hidden');
  toast('Settings saved', 'success');
}

// ===== Toast =====
let toastTimer;
function toast(message, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add('hidden'); }, 2800);
}

// ===== Utilities =====
function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function highlightMatch(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx)) + `<mark class="tab-highlight">${esc(text.slice(idx, idx + query.length))}</mark>` + esc(text.slice(idx + query.length));
}

// ===== Event bindings =====
function bindEvents() {
  // Search
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    searchClear.classList.toggle('hidden', !searchQuery);
    renderMain();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.add('hidden');
    renderMain();
  });

  // Filter pills
  document.getElementById('filter-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    renderMain();
  });

  // Command palette
  document.getElementById('btn-palette').addEventListener('click', openPalette);
  document.getElementById('palette-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePalette();
  });
  document.getElementById('palette-input').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    const filtered = q ? fuzzySearch(allTabs, q) : allTabs;
    paletteSelectedIndex = 0;
    renderPaletteResults(filtered);
  });
  document.getElementById('palette-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { closePalette(); return; }
    if (e.key === 'ArrowDown') {
      paletteSelectedIndex = Math.min(paletteSelectedIndex + 1, paletteFilteredTabs.length - 1);
      renderPaletteResults(paletteFilteredTabs);
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      paletteSelectedIndex = Math.max(paletteSelectedIndex - 1, 0);
      renderPaletteResults(paletteFilteredTabs);
      e.preventDefault();
    }
    if (e.key === 'Enter') {
      const tab = paletteFilteredTabs[paletteSelectedIndex];
      if (tab) {
        await msg('FOCUS_TAB', { tabId: tab.id, windowId: tab.windowId });
        window.close();
      }
    }
  });

  // Keyboard shortcut for palette
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openPalette();
    }
    if (e.key === 'Escape') {
      closePalette();
      document.getElementById('settings-panel').classList.add('hidden');
    }
  });

  // Action bar buttons
  document.getElementById('btn-suspend').addEventListener('click', async () => {
    const days = settings.autoSuspendDays || 7;
    const result = await msg('SUSPEND_OLD_TABS', { days });
    toast(`Suspended ${result.suspended} tabs older than ${days} days`, 'success');
    await reload();
  });

  document.getElementById('btn-close-dupes').addEventListener('click', async () => {
    if (dupeIds.size === 0) { toast('No duplicates found!'); return; }
    const result = await msg('CLOSE_DUPLICATES');
    toast(`Closed ${result.closed} duplicate tabs`, 'success');
    await reload();
  });

  document.getElementById('btn-save-session').addEventListener('click', saveCurrentSession);
  document.getElementById('btn-ai-cluster').addEventListener('click', runAiCluster);

  // Settings
  document.getElementById('setting-ai-provider').addEventListener('change', toggleApiFields);
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('hidden');
  });
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  
  // Pop-out button
  const btnPopout = document.getElementById('btn-popout');
  if (btnPopout) {
    btnPopout.addEventListener('click', () => {
      chrome.windows.create({
        url: 'popup/popup.html',
        type: 'popup',
        width: 780,
        height: 560
      });
      window.close();
    });
  }
}

// ===== Start =====
init();
