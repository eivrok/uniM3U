import { parseM3U, parseGroup } from './playlist.js';
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
  favorites: new Set(),
  activeChannelId: null,
  epgData: {},
  searchQuery: '',
  activeFilter: 'all',        // 'all' | 'favorites'
  view: 'browse',             // 'browse' (country tree) | 'channels' (drilled into a group)
  activeGroup: null,          // group-title string when view === 'channels'
  expandedCountries: new Set(),
  visibleCountries: null,     // null = all visible; otherwise a Set of allowed country names
};

// --- DOM refs ---
const settingsScreen = document.getElementById('settings-screen');
const mainScreen = document.getElementById('main-screen');
const m3uInput = document.getElementById('m3u-url-input');
const epgInput = document.getElementById('epg-url-input');
const saveBtn = document.getElementById('save-settings-btn');
const settingsBtn = document.getElementById('settings-btn');
const countriesBtn = document.getElementById('countries-btn');
const searchInput = document.getElementById('search-input');
const channelList = document.getElementById('channel-list');
const loadingMsg = document.getElementById('loading-msg');
const categoryTabs = document.getElementById('category-tabs');
const emptyState = document.getElementById('empty-state');
const epgBar = document.getElementById('epg-bar');
const channelNameEl = document.getElementById('channel-name');
const epgNowEl = document.getElementById('epg-now');
const epgNextEl = document.getElementById('epg-next');

// Countries modal refs
const countriesModal = document.getElementById('countries-modal');
const countriesClose = document.getElementById('countries-close');
const countriesSearch = document.getElementById('countries-search');
const countriesAllBtn = document.getElementById('countries-all');
const countriesNoneBtn = document.getElementById('countries-none');
const countriesChecklist = document.getElementById('countries-checklist');
const countriesSave = document.getElementById('countries-save');

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
  const vis = await api.storeGet('visibleCountries');
  const exp = await api.storeGet('expandedCountries');

  if (favs) state.favorites = new Set(favs);
  state.visibleCountries = Array.isArray(vis) ? new Set(vis) : null;
  if (Array.isArray(exp)) state.expandedCountries = new Set(exp);

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

    // Load EPG in background
    if (epgUrl) {
      loadEPG(epgUrl, api.fetchUrl).then((epgData) => {
        state.epgData = epgData;
        render();
      }).catch(() => {});
    }

    state.view = 'browse';
    state.activeGroup = null;
    render();
  } catch (err) {
    showMain();
    alert(`Failed to load playlist: ${err.message}`);
  } finally {
    loadingMsg.textContent = 'Loading channels…';
    loadingMsg.classList.add('hidden');
  }
}

// --- Country tree ---
function isCountryVisible(country) {
  return state.visibleCountries === null || state.visibleCountries.has(country);
}

/**
 * Groups channels into countries -> subcategories. Returns a sorted array:
 * [{ country, count, leaf, subs: [{ sub, group, count }] }]
 * A "leaf" country has a single group with no subcategory — clicking it
 * drills straight into channels instead of expanding.
 */
function buildCountryTree(channels) {
  const map = new Map();
  for (const c of channels) {
    const { country, sub } = parseGroup(c.group);
    if (!map.has(country)) map.set(country, { country, count: 0, subs: new Map() });
    const node = map.get(country);
    node.count++;
    const group = c.group || 'Uncategorized';
    if (!node.subs.has(group)) node.subs.set(group, { sub, group, count: 0 });
    node.subs.get(group).count++;
  }

  return [...map.values()]
    .sort((a, b) => a.country.localeCompare(b.country))
    .map((n) => {
      const subs = [...n.subs.values()].sort((a, b) => (a.sub || '').localeCompare(b.sub || ''));
      return {
        country: n.country,
        count: n.count,
        subs,
        leaf: subs.length === 1 && subs[0].sub === null,
      };
    });
}

// --- Render ---
const RENDER_LIMIT = 500;

function render() {
  channelList.innerHTML = '';
  const q = state.searchQuery.trim().toLowerCase();

  // Search cuts across all visible channels, ignoring drill/collapse state.
  if (q) {
    const results = state.channels.filter(
      (c) => isCountryVisible(parseGroup(c.group).country) && c.name.toLowerCase().includes(q)
    );
    renderChannelItems(results, 'No channels match your search');
    return;
  }

  // Favorites: flat list, shown regardless of country whitelist.
  if (state.activeFilter === 'favorites') {
    const favs = state.channels.filter((c) => state.favorites.has(c.id));
    renderChannelItems(favs, 'No favorites yet — tap ★ on a channel');
    return;
  }

  // Drilled into a subcategory.
  if (state.view === 'channels' && state.activeGroup) {
    renderBackHeader(state.activeGroup);
    const list = state.channels.filter((c) => (c.group || 'Uncategorized') === state.activeGroup);
    renderChannelItems(list, 'No channels here', true);
    return;
  }

  // Default: country tree.
  renderBrowse();
}

function renderBrowse() {
  const tree = buildCountryTree(state.channels).filter((n) => isCountryVisible(n.country));

  if (tree.length === 0) {
    renderHint('No countries selected — pick some with 🌐');
    return;
  }

  for (const node of tree) {
    const header = document.createElement('div');
    header.className = 'country-row';

    const expanded = state.expandedCountries.has(node.country);

    if (node.leaf) {
      header.classList.add('leaf');
      appendNameAndPill(header, node.country, node.count);
      header.addEventListener('click', () => drillInto(node.subs[0].group));
    } else {
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = expanded ? '▾' : '▸';
      header.appendChild(caret);
      appendNameAndPill(header, node.country, node.count);
      header.addEventListener('click', () => toggleCountry(node.country));
    }

    channelList.appendChild(header);

    if (expanded && !node.leaf) {
      for (const s of node.subs) {
        const row = document.createElement('div');
        row.className = 'sub-row';
        const name = document.createElement('span');
        name.className = 'sub-name';
        name.textContent = s.sub ?? node.country;
        const pill = document.createElement('span');
        pill.className = 'count-pill small';
        pill.textContent = s.count;
        row.append(name, pill);
        row.addEventListener('click', () => drillInto(s.group));
        channelList.appendChild(row);
      }
    }
  }
}

function appendNameAndPill(row, name, count) {
  const nameEl = document.createElement('span');
  nameEl.className = 'country-name';
  nameEl.textContent = name;
  const pill = document.createElement('span');
  pill.className = 'count-pill';
  pill.textContent = count;
  row.append(nameEl, pill);
}

function renderBackHeader(group) {
  const { country, sub } = parseGroup(group);
  const header = document.createElement('div');
  header.className = 'back-header';

  const arrow = document.createElement('span');
  arrow.className = 'back-arrow';
  arrow.textContent = '←';

  const crumb = document.createElement('span');
  crumb.className = 'back-crumb';
  crumb.textContent = sub ? `${country} · ${sub}` : country;

  header.append(arrow, crumb);
  header.addEventListener('click', goBack);
  channelList.appendChild(header);
}

function renderChannelItems(list, emptyMsg, append = false) {
  if (!append) channelList.innerHTML = '';

  if (list.length === 0) {
    renderHint(emptyMsg);
    return;
  }

  const visible = list.slice(0, RENDER_LIMIT);
  visible.forEach((c) => channelList.appendChild(buildChannelItem(c, state.epgData)));

  if (list.length > RENDER_LIMIT) {
    const note = document.createElement('div');
    note.className = 'list-hint';
    note.textContent = `${list.length - RENDER_LIMIT} more — search to filter`;
    channelList.appendChild(note);
  }
}

function renderHint(msg) {
  const hint = document.createElement('div');
  hint.className = 'list-hint';
  hint.textContent = msg;
  channelList.appendChild(hint);
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

// --- Navigation actions ---
function toggleCountry(country) {
  if (state.expandedCountries.has(country)) {
    state.expandedCountries.delete(country);
  } else {
    state.expandedCountries.add(country);
  }
  api.storeSet('expandedCountries', [...state.expandedCountries]);
  render();
}

function drillInto(group) {
  state.view = 'channels';
  state.activeGroup = group;
  render();
  channelList.parentElement.scrollTop = 0;
}

function goBack() {
  state.view = 'browse';
  state.activeGroup = null;
  render();
}

// --- Countries whitelist modal ---
function openCountriesModal() {
  const tree = buildCountryTree(state.channels);
  countriesChecklist.innerHTML = '';

  for (const node of tree) {
    const row = document.createElement('label');
    row.className = 'country-check';
    row.dataset.country = node.country.toLowerCase();

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = node.country;
    cb.checked = isCountryVisible(node.country);

    const name = document.createElement('span');
    name.textContent = node.country;

    const count = document.createElement('span');
    count.className = 'cc-count';
    count.textContent = node.count;

    row.append(cb, name, count);
    countriesChecklist.appendChild(row);
  }

  countriesSearch.value = '';
  countriesModal.classList.remove('hidden');
}

function closeCountriesModal() {
  countriesModal.classList.add('hidden');
}

function saveCountries() {
  const boxes = [...countriesChecklist.querySelectorAll('input[type=checkbox]')];
  const checked = boxes.filter((b) => b.checked).map((b) => b.value);

  // All checked => null (everything visible) keeps future-added countries visible too.
  state.visibleCountries = checked.length === boxes.length ? null : new Set(checked);
  api.storeSet('visibleCountries', state.visibleCountries ? [...state.visibleCountries] : null);

  closeCountriesModal();
  state.view = 'browse';
  state.activeGroup = null;
  render();
}

function filterCountriesList(q) {
  const needle = q.trim().toLowerCase();
  countriesChecklist.querySelectorAll('.country-check').forEach((row) => {
    row.classList.toggle('hidden', needle !== '' && !row.dataset.country.includes(needle));
  });
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
  if (state.activeFilter === 'favorites') render();
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
  render();
});

categoryTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  categoryTabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  state.activeFilter = tab.dataset.cat; // 'all' | 'favorites'
  state.view = 'browse';
  state.activeGroup = null;
  render();
});

// Countries modal wiring
countriesBtn.addEventListener('click', openCountriesModal);
countriesClose.addEventListener('click', closeCountriesModal);
countriesSave.addEventListener('click', saveCountries);
countriesModal.addEventListener('click', (e) => {
  if (e.target === countriesModal) closeCountriesModal();
});
countriesSearch.addEventListener('input', (e) => filterCountriesList(e.target.value));
countriesAllBtn.addEventListener('click', () => {
  countriesChecklist.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = true; });
});
countriesNoneBtn.addEventListener('click', () => {
  countriesChecklist.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; });
});

// Refresh EPG every minute
setInterval(() => {
  if (state.activeChannelId) {
    const ch = state.channels.find((c) => c.id === state.activeChannelId);
    if (ch) updateEPGOverlay(ch);
  }
}, 60_000);

init();
