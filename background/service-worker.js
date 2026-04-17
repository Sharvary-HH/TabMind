// TabMind Service Worker
// Tracks tab activity, usage recency, and manages background state

const TAB_METADATA_KEY = 'tabmind_metadata';
const SETTINGS_KEY = 'tabmind_settings';
const WORKSPACES_KEY = 'tabmind_workspaces';
const CUSTOM_GROUPS_KEY = 'tabmind_custom_groups';

const DEFAULT_SETTINGS = {
  autoSuspendDays: 7,
  aiProvider: 'local',
  anthropicKey: '',
  geminiKey: '',
  showDuplicateWarning: true,
  trackHistory: true,
};

// --- Tab metadata tracking ---
// We store: { [tabId]: { lastActive: timestamp, openedFrom: tabId|null, createdAt: timestamp } }

async function getMetadata() {
  const result = await chrome.storage.local.get(TAB_METADATA_KEY);
  return result[TAB_METADATA_KEY] || {};
}

async function saveMetadata(meta) {
  await chrome.storage.local.set({ [TAB_METADATA_KEY]: meta });
}

async function getSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

// Track when a tab is created
chrome.tabs.onCreated.addListener(async (tab) => {
  const meta = await getMetadata();
  meta[tab.id] = {
    createdAt: Date.now(),
    lastActive: Date.now(),
    openedFrom: null,
  };
  await saveMetadata(meta);
});

// Track when a tab is activated (user switches to it)
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const meta = await getMetadata();
  if (!meta[tabId]) meta[tabId] = { createdAt: Date.now() };
  meta[tabId].lastActive = Date.now();
  await saveMetadata(meta);
});

// Clean up metadata when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const meta = await getMetadata();
  delete meta[tabId];
  await saveMetadata(meta);
});

// --- Alarm for periodic cleanup ---
chrome.alarms.create('tabmind_cleanup', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tabmind_cleanup') return;
  
  const settings = await getSettings();
  const meta = await getMetadata();
  const cutoff = Date.now() - (settings.autoSuspendDays * 24 * 60 * 60 * 1000);
  
  const tabs = await chrome.tabs.query({});
  const tabIds = new Set(tabs.map(t => t.id));

  // Remove metadata for tabs that no longer exist
  let changed = false;
  for (const id of Object.keys(meta)) {
    if (!tabIds.has(parseInt(id))) {
      delete meta[id];
      changed = true;
    }
  }
  if (changed) await saveMetadata(meta);
});

// --- Message handler for popup ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep channel open for async
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_ALL_TABS': {
      const tabs = await chrome.tabs.query({});
      const meta = await getMetadata();
      return tabs.map(tab => ({
        id: tab.id,
        title: tab.title || 'Untitled',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        active: tab.active,
        windowId: tab.windowId,
        lastActive: meta[tab.id]?.lastActive || 0,
        createdAt: meta[tab.id]?.createdAt || 0,
        manualGroupId: meta[tab.id]?.manualGroupId || null,
        pinned: tab.pinned,
      }));
    }

    case 'FOCUS_TAB': {
      const { tabId, windowId } = message;
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { ok: true };
    }

    case 'CLOSE_TABS': {
      await chrome.tabs.remove(message.tabIds);
      return { ok: true };
    }

    case 'CLOSE_DUPLICATES': {
      const tabs = await chrome.tabs.query({});
      const seen = new Map();
      const toClose = [];
      for (const tab of tabs) {
        const key = tab.url;
        if (seen.has(key)) {
          toClose.push(tab.id);
        } else {
          seen.set(key, tab.id);
        }
      }
      if (toClose.length) await chrome.tabs.remove(toClose);
      return { closed: toClose.length };
    }

    case 'SUSPEND_OLD_TABS': {
      const { days } = message;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const meta = await getMetadata();
      const tabs = await chrome.tabs.query({ active: false, pinned: false });
      const toDiscard = tabs.filter(t => {
        const lastActive = meta[t.id]?.lastActive || 0;
        return lastActive < cutoff && lastActive > 0;
      });
      for (const tab of toDiscard) {
        try { await chrome.tabs.discard(tab.id); } catch {}
      }
      return { suspended: toDiscard.length };
    }

    case 'OPEN_URLS': {
      for (const url of message.urls) {
        await chrome.tabs.create({ url });
      }
      return { ok: true };
    }

    case 'GET_SETTINGS': {
      return await getSettings();
    }

    case 'SAVE_SETTINGS': {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: message.settings });
      return { ok: true };
    }

    case 'GET_WORKSPACES': {
      const result = await chrome.storage.sync.get(WORKSPACES_KEY);
      return result[WORKSPACES_KEY] || [];
    }

    case 'SAVE_WORKSPACE': {
      const result = await chrome.storage.sync.get(WORKSPACES_KEY);
      const workspaces = result[WORKSPACES_KEY] || [];
      const idx = workspaces.findIndex(w => w.id === message.workspace.id);
      if (idx >= 0) workspaces[idx] = message.workspace;
      else workspaces.push(message.workspace);
      await chrome.storage.sync.set({ [WORKSPACES_KEY]: workspaces });
      return { ok: true };
    }

    case 'DELETE_WORKSPACE': {
      const result = await chrome.storage.sync.get(WORKSPACES_KEY);
      const workspaces = (result[WORKSPACES_KEY] || []).filter(w => w.id !== message.id);
      await chrome.storage.sync.set({ [WORKSPACES_KEY]: workspaces });
      return { ok: true };
    }

    case 'GET_TAB_METADATA': {
      return await getMetadata();
    }

    case 'SET_TAB_MANUAL_GROUP': {
      const meta = await getMetadata();
      if (!meta[message.tabId]) meta[message.tabId] = { createdAt: Date.now() };
      meta[message.tabId].manualGroupId = message.groupId;
      await saveMetadata(meta);
      return { ok: true };
    }

    case 'GET_CUSTOM_GROUPS': {
      const result = await chrome.storage.local.get(CUSTOM_GROUPS_KEY);
      return result[CUSTOM_GROUPS_KEY] || [];
    }

    case 'SAVE_CUSTOM_GROUP': {
      const result = await chrome.storage.local.get(CUSTOM_GROUPS_KEY);
      const cgs = result[CUSTOM_GROUPS_KEY] || [];
      cgs.push(message.group);
      await chrome.storage.local.set({ [CUSTOM_GROUPS_KEY]: cgs });
      return { ok: true };
    }

    case 'DELETE_CUSTOM_GROUP': {
      const result = await chrome.storage.local.get(CUSTOM_GROUPS_KEY);
      const cgs = (result[CUSTOM_GROUPS_KEY] || []).filter(g => g.id !== message.id);
      await chrome.storage.local.set({ [CUSTOM_GROUPS_KEY]: cgs });
      
      const meta = await getMetadata();
      for (const t of Object.values(meta)) {
        if (t.manualGroupId === message.id) delete t.manualGroupId;
      }
      await saveMetadata(meta);
      return { ok: true };
    }

    case 'SAVE_AI_CLUSTERS': {
      await chrome.storage.local.set({ 'tabmind_ai_clusters': message.groups });
      return { ok: true };
    }

    case 'GET_AI_CLUSTERS': {
      const res = await chrome.storage.local.get('tabmind_ai_clusters');
      return res['tabmind_ai_clusters'] || null;
    }

    case 'DELETE_AI_GROUP': {
      const res = await chrome.storage.local.get('tabmind_ai_clusters');
      const groups = (res['tabmind_ai_clusters'] || []).filter(g => g.id !== message.id);
      await chrome.storage.local.set({ 'tabmind_ai_clusters': groups });
      return { ok: true };
    }

    case 'REMOVE_TAB_FROM_AI': {
      const res = await chrome.storage.local.get('tabmind_ai_clusters');
      const groups = res['tabmind_ai_clusters'];
      if (!groups) return { ok: true };
      for (const g of groups) {
        g.urls = g.urls.filter(u => u !== message.url);
      }
      await chrome.storage.local.set({ 'tabmind_ai_clusters': groups });
      return { ok: true };
    }

    case 'ADD_TAB_TO_AI': {
      const res = await chrome.storage.local.get('tabmind_ai_clusters');
      const groups = res['tabmind_ai_clusters'];
      if (!groups) return { ok: true };
      // Remove from all existing AI groups
      for (const g of groups) {
        g.urls = g.urls.filter(u => u !== message.url);
      }
      // Add to target AI group
      const target = groups.find(g => g.id === message.id);
      if (target) {
        target.urls.push(message.url);
      }
      await chrome.storage.local.set({ 'tabmind_ai_clusters': groups });
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}
