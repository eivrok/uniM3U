import { parseM3U } from './playlist.js';
import { loadEPG, getProgramsForChannel, getCurrentProgram, getNextProgram } from './epg.js';
import { Player } from './player.js';

const api = window.api;

if (!api) {
  document.body.innerHTML = '<div style="color:red;padding:40px;font-size:16px">ERROR: window.api is undefined — preload.js did not load. Check Electron DevTools console.</div>';
  throw new Error('window.api is undefined');
}

// --- State ---
const state = {
  channels: [],
  filteredChannels: [],
  categories: [],
  activeCategory: 'all',
  favorites: new Set(),
  activeChannelId: null,
  epgData: {},
  searchQuery: '',
};

// --- DOM refs ---
const settingsScreen = document.getElementById('settings-screen');
const mainScreen = document.getElementById('main-screen');
const m3uInput = document.getElementById('m3u-url-input');
const epgInput = document.getElementById('epg-url-input');
const saveBtn = document.getElementById('save-settings-btn');
const settingsBtn = document.getElementById('settings-btn');
const searchInput = document.getElementById('search-input');
const channelList = document.getElementById('channel-list');
const loadingMsg = document.getElementById('loading-msg');
const categoryTabs = document.getElementById('category-tabs');
const emptyState = document.getElementById('empty-state');
const epgBar = document.getElementById('epg-bar');
const channelNameEl = document.getElementById('channel-name');
const epgNowEl = document.getElementById('epg-now');
const epgNextEl = document.getElementById('epg-next');

const player = new Player(document.getElementById('video-player'));

// --- Toast ---
const toast = document.createElement('div');
toast.id = 'toast';
document.body.appendChild(toast);

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// --- Init ---
async function init() {
  const m3uUrl = await api.storeGet('m3uUrl');
  const epgUrl = await api.storeGet('epgUrl');
  const favs = await api.storeGet('favorites');

  if (favs) state.favorites = new Set(favs);

  if (m3uUrl) {
    m3uInput.value = m3uUrl;
    if (epgUrl) epgInput.value = epgUrl;
    showMain();
    await loadChannels(m3uUrl, epgUrl);
  } else {
    showSettings();
  }
}

function showSettings() {
  settingsScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

function showMain() {
  settingsScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
}

// --- Load channels ---
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function loadChannels(m3uUrl, epgUrl, forceRefresh = false) {
  loadingMsg.classList.remove('hidden');
  channelList.innerHTML = '';

  try {
    let raw;
    const cached = await api.storeGet('playlistCache');
    const cachedAt = await api.storeGet('playlistCachedAt');
    const cacheValid = cached && cachedAt && (Date.now() - cachedAt < CACHE_TTL_MS);

    if (!forceRefresh && cacheValid) {
      raw = cached;
    } else {
      loadingMsg.textContent = 'Downloading playlist…';
      raw = await api.fetchUrl(m3uUrl);
      await api.storeSet('playlistCache', raw);
      await api.storeSet('playlistCachedAt', Date.now());
    }

    loadingMsg.textContent = 'Parsing channels…';
    state.channels = parseM3U(raw).filter((c) => c.url && !/^=+/.test(c.name.trim()));

    // Build category list
    const cats = [...new Set(state.channels.map((c) => c.group).filter(Boolean))].sort();
    state.categories = cats;
    renderCategoryTabs(cats);

    // Load EPG in background
    if (epgUrl) {
      loadEPG(epgUrl, api.fetchUrl).then((epgData) => {
        state.epgData = epgData;
        renderChannels();
      }).catch(() => {});
    }

    renderChannels();
  } catch (err) {
    showMain();
    alert(`Failed to load playlist: ${err.message}`);
  } finally {
    loadingMsg.textContent = 'Loading channels…';
    loadingMsg.classList.add('hidden');
  }
}

// --- Render categories ---
function renderCategoryTabs(cats) {
  // Remove old dynamic tabs
  categoryTabs.querySelectorAll('.tab[data-cat]:not([data-cat="all"]):not([data-cat="favorites"])').forEach((t) => t.remove());

  cats.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    categoryTabs.appendChild(btn);
  });
}

// --- Render channel list ---
function renderChannels() {
  const { activeCategory, searchQuery, channels, favorites, epgData } = state;
  const q = searchQuery.toLowerCase();

  let list = channels;

  if (activeCategory === 'favorites') {
    list = list.filter((c) => favorites.has(c.id));
  } else if (activeCategory !== 'all') {
    list = list.filter((c) => c.group === activeCategory);
  }

  if (q) {
    list = list.filter((c) => c.name.toLowerCase().includes(q));
  }

  state.filteredChannels = list;
  channelList.innerHTML = '';

  if (activeCategory === 'all' && !q) {
    // Show category overview — each group header is clickable to drill in
    const groups = {};
    list.forEach((c) => {
      const g = c.group || 'Uncategorized';
      if (!groups[g]) groups[g] = 0;
      groups[g]++;
    });
    Object.entries(groups).forEach(([groupName, count]) => {
      const header = document.createElement('div');
      header.className = 'category-header category-nav';
      header.textContent = `${groupName}  (${count})`;
      header.title = 'Click to browse this category';
      header.addEventListener('click', () => {
        // Activate this category tab
        categoryTabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        let tab = categoryTabs.querySelector(`[data-cat="${CSS.escape(groupName)}"]`);
        if (tab) tab.classList.add('active');
        state.activeCategory = groupName;
        renderChannels();
      });
      channelList.appendChild(header);
    });
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:12px;color:var(--text3);font-size:12px;text-align:center';
    hint.textContent = 'Click a category above, or search to find channels';
    channelList.appendChild(hint);
    return;
  }

  // Render up to 500 channels for a single category or search result
  const RENDER_LIMIT = 500;
  const visible = list.slice(0, RENDER_LIMIT);
  visible.forEach((c) => channelList.appendChild(buildChannelItem(c, epgData)));

  if (list.length > RENDER_LIMIT) {
    const note = document.createElement('div');
    note.className = 'category-header';
    note.textContent = `${list.length - RENDER_LIMIT} more — search to filter`;
    channelList.appendChild(note);
  }
}

function buildChannelItem(channel, epgData) {
  const item = document.createElement('div');
  item.className = 'channel-item';
  if (channel.id === state.activeChannelId) item.classList.add('active');
  item.dataset.id = channel.id;

  // Logo
  if (channel.logo) {
    const img = document.createElement('img');
    img.className = 'channel-logo';
    img.src = channel.logo;
    img.alt = '';
    img.onerror = () => img.replaceWith(logoPlaceholder());
    item.appendChild(img);
  } else {
    item.appendChild(logoPlaceholder());
  }

  // Info
  const info = document.createElement('div');
  info.className = 'channel-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'channel-name';
  nameEl.textContent = channel.name;
  info.appendChild(nameEl);

  const prog = getCurrentProgram(epgData, channel.tvgId || channel.name);
  if (prog) {
    const epgEl = document.createElement('div');
    epgEl.className = 'channel-epg-now';
    epgEl.textContent = prog.title;
    info.appendChild(epgEl);
  }

  item.appendChild(info);

  // Fav button
  const favBtn = document.createElement('button');
  favBtn.className = 'fav-btn' + (state.favorites.has(channel.id) ? ' active' : '');
  favBtn.textContent = '★';
  favBtn.title = 'Favorite';
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(channel.id);
    favBtn.classList.toggle('active');
  });
  item.appendChild(favBtn);

  item.addEventListener('click', () => playChannel(channel));

  return item;
}

function logoPlaceholder() {
  const div = document.createElement('div');
  div.className = 'channel-logo-placeholder';
  div.textContent = '📺';
  return div;
}

// --- Play channel ---
function playChannel(channel) {
  state.activeChannelId = channel.id;

  // Update active class
  document.querySelectorAll('.channel-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === channel.id);
  });

  emptyState.style.display = 'none';
  channelNameEl.textContent = channel.name;

  player.load(channel.url);
  updateEPGOverlay(channel);
}

function updateEPGOverlay(channel) {
  const key = channel.tvgId || channel.name;
  const now = getCurrentProgram(state.epgData, key);
  const next = getNextProgram(state.epgData, key);

  epgNowEl.textContent = now ? `Now: ${now.title}` : '';
  epgNextEl.textContent = next ? `Next: ${next.title}` : '';

  epgBar.innerHTML = '';
  if (now || next) {
    epgBar.classList.remove('hidden');
    [now, next].filter(Boolean).forEach((p) => {
      const row = document.createElement('div');
      row.className = 'epg-program';
      row.innerHTML = `<span class="epg-time">${formatTime(p.start)}</span><span class="epg-title">${p.title}</span><span class="epg-desc">${p.desc || ''}</span>`;
      epgBar.appendChild(row);
    });
  } else {
    epgBar.classList.add('hidden');
  }
}

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Favorites ---
function toggleFavorite(channelId) {
  if (state.favorites.has(channelId)) {
    state.favorites.delete(channelId);
  } else {
    state.favorites.add(channelId);
  }
  api.storeSet('favorites', [...state.favorites]);
  if (state.activeCategory === 'favorites') renderChannels();
}

// --- Event listeners ---
saveBtn.addEventListener('click', async () => {
  const m3uUrl = m3uInput.value.trim();
  const epgUrl = epgInput.value.trim();
  if (!m3uUrl) { alert('Please enter an M3U URL'); return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Loading…';

  try {
    await api.storeSet('m3uUrl', m3uUrl);
    await api.storeSet('epgUrl', epgUrl || null);

    showMain();
    await loadChannels(m3uUrl, epgUrl || null, true); // force refresh on settings save
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Load Channels';
  }
});

settingsBtn.addEventListener('click', showSettings);

searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderChannels();
});

categoryTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  categoryTabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  state.activeCategory = tab.dataset.cat;
  renderChannels();
});

// Refresh EPG every minute
setInterval(() => {
  if (state.activeChannelId) {
    const ch = state.channels.find((c) => c.id === state.activeChannelId);
    if (ch) updateEPGOverlay(ch);
  }
}, 60_000);

init();
