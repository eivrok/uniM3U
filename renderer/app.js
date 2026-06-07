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
  tree: null,                 // memoized country tree; rebuilt only when channels reload
};

// --- DOM refs ---
const settingsScreen = document.getElementById('settings-screen');
const mainScreen = document.getElementById('main-screen');
const m3uInput = document.getElementById('m3u-url-input');
const epgInput = document.getElementById('epg-url-input');
const saveBtn = document.getElementById('save-settings-btn');
const cancelBtn = document.getElementById('cancel-settings-btn');
const settingsBtn = document.getElementById('settings-btn');
const countriesBtn = document.getElementById('countries-btn');
const reloadBtn = document.getElementById('reload-btn');
const reloadModal = document.getElementById('reload-modal');
const reloadCancel = document.getElementById('reload-cancel');
const reloadConfirm = document.getElementById('reload-confirm');
const searchInput = document.getElementById('search-input');
const channelList = document.getElementById('channel-list');
const loadingMsg = document.getElementById('loading-msg');
const categoryTabs = document.getElementById('category-tabs');
const emptyState = document.getElementById('empty-state');
const epgBar = document.getElementById('epg-bar');
const nowPlayingInfo = document.getElementById('now-playing-info');
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

const videoEl = document.getElementById('video-player');
const player = new Player(videoEl);

// --- Channel-load spinner ---
const playerLoading = document.getElementById('player-loading');
let spinnerTimer = null;

function showSpinner() {
  playerLoading.classList.remove('hidden');
  clearTimeout(spinnerTimer);
  // Safety: a dead stream (or an mpegts.js error that never reaches the <video>
  // element) would otherwise spin forever.
  spinnerTimer = setTimeout(hideSpinner, 15000);
}

function hideSpinner() {
  clearTimeout(spinnerTimer);
  playerLoading.classList.add('hidden');
}

videoEl.addEventListener('playing', hideSpinner);
videoEl.addEventListener('waiting', () => playerLoading.classList.remove('hidden'));
videoEl.addEventListener('error', hideSpinner);

// --- Now-playing overlay: reveal on mouse move, fade after 3s idle ---
const playerWrapper = document.getElementById('player-wrapper');
const playerOverlay = document.getElementById('player-overlay');
let overlayTimer = null;

function revealOverlay() {
  if (!state.activeChannelId) return; // nothing playing → nothing to show
  playerOverlay.classList.add('show');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => playerOverlay.classList.remove('show'), 3000);
}

playerWrapper.addEventListener('mousemove', revealOverlay);
playerWrapper.addEventListener('mouseleave', () => {
  clearTimeout(overlayTimer);
  playerOverlay.classList.remove('show');
});

// --- Toast ---
const toast = document.createElement('div');
toast.id = 'toast';
document.body.appendChild(toast);

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// --- Init ---
async function init() {
  const m3uUrl = await api.storeGet('m3uUrl');
  const epgUrl = await api.storeGet('epgUrl');
  const favs = await api.storeGet('favorites');
  const vis = await api.storeGet('visibleCountries');
  const exp = await api.storeGet('expandedCountries');
  const fl = await api.storeGet('failedLogos');

  if (favs) state.favorites = new Set(favs);
  state.visibleCountries = Array.isArray(vis) ? new Set(vis) : null;
  if (Array.isArray(exp)) state.expandedCountries = new Set(exp);
  if (Array.isArray(fl)) failedLogos = new Set(fl);

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
  // Cancel only makes sense once channels are loaded — on first run there's
  // nothing to go back to.
  cancelBtn.classList.toggle('hidden', state.channels.length === 0);
  settingsScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

function showMain() {
  settingsScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
}

// --- Load channels ---
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
      loadingMsg.textContent = 'Downloading playlist, hang tight…';
      raw = await api.fetchUrl(m3uUrl);
      await api.storeSet('playlistCache', raw);
      await api.storeSet('playlistCachedAt', Date.now());
    }

    loadingMsg.textContent = 'Parsing channels, get ready…';
    state.channels = parseM3U(raw).filter((c) => c.url && !/^=+/.test(c.name.trim()));

    // Precompute country/sub once per channel (#4) so search and tree-building
    // don't re-run parseGroup on every render. Normalize group here too.
    for (const c of state.channels) {
      c.group = c.group || 'Uncategorized';
      const { country, sub } = parseGroup(c.group);
      c.country = country;
      c.sub = sub;
    }
    state.tree = null; // invalidate memoized tree (#3)

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

    // Resume the last-played channel, matched by stable url (not the index id).
    // Drill into its group so the row is visible and highlighted.
    const lastUrl = await api.storeGet('lastChannelUrl');
    if (lastUrl) {
      const last = state.channels.find((c) => c.url === lastUrl);
      if (last) {
        state.view = 'channels';
        state.activeGroup = last.group;
        render();
        playChannel(last);
      }
    }
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
    const country = c.country;
    if (!map.has(country)) map.set(country, { country, count: 0, subs: new Map() });
    const node = map.get(country);
    node.count++;
    if (!node.subs.has(c.group)) node.subs.set(c.group, { sub: c.sub, group: c.group, count: 0 });
    node.subs.get(c.group).count++;
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

// Memoized accessor — the tree only changes when channels reload (#3).
function getCountryTree() {
  if (!state.tree) state.tree = buildCountryTree(state.channels);
  return state.tree;
}

// --- Render ---
const CHUNK_SIZE = 100;        // channels rendered per incremental batch
let listObserver = null;       // IntersectionObserver appending the next batch on scroll
let failedLogos = new Set();   // logo URLs that 404'd — don't re-request on re-render
const persistFailedLogos = debounce(() => api.storeSet('failedLogos', [...failedLogos]), 1000);

let kbdIndex = -1; // keyboard-focused row in the channel list (-1 = none)

function render() {
  cleanupListObserver();
  kbdIndex = -1; // DOM is rebuilt below; drop stale keyboard focus
  channelList.innerHTML = '';
  const q = state.searchQuery.trim().toLowerCase();

  // Search cuts across all visible channels, ignoring drill/collapse state.
  if (q) {
    const results = state.channels.filter(
      (c) => isCountryVisible(c.country) && c.name.toLowerCase().includes(q)
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
    const list = state.channels.filter((c) => c.group === state.activeGroup);
    renderChannelItems(list, 'No channels here', true);
    return;
  }

  // Default: country tree.
  renderBrowse();
}

function renderBrowse() {
  const tree = getCountryTree().filter((n) => isCountryVisible(n.country));

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
  cleanupListObserver();

  if (list.length === 0) {
    renderHint(emptyMsg);
    return;
  }

  // Render the whole list incrementally: first batch now, the rest appended as a
  // bottom sentinel scrolls into view. Keeps upfront render cheap without capping.
  let rendered = 0;
  const sentinel = document.createElement('div');
  sentinel.className = 'list-sentinel';
  sentinel.style.height = '1px';

  function appendBatch() {
    const batch = list.slice(rendered, rendered + CHUNK_SIZE);
    const frag = document.createDocumentFragment();
    batch.forEach((c) => frag.appendChild(buildChannelItem(c, state.epgData)));
    channelList.insertBefore(frag, sentinel); // sentinel stays at the bottom
    rendered += batch.length;
    if (rendered >= list.length) cleanupListObserver();
  }

  channelList.appendChild(sentinel);
  appendBatch();

  if (rendered < list.length) {
    listObserver = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) appendBatch(); },
      { root: channelList.parentElement, rootMargin: '300px' }
    );
    listObserver.observe(sentinel);
  }
}

function cleanupListObserver() {
  if (listObserver) {
    listObserver.disconnect();
    listObserver = null;
  }
  const stale = channelList.querySelector('.list-sentinel');
  if (stale) stale.remove();
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

  // Logo — lazy + async so a 500-row category doesn't fire 500 remote
  // image fetches on render. width/height match the CSS box to avoid reflow.
  // Only http(s) URLs (skips garbage/relative tvg-logo values that would 404
  // against the file:// base), and skip URLs already known to fail so re-renders
  // (e.g. every search keystroke) don't re-request dead logos.
  if (channel.logo && /^https?:\/\//i.test(channel.logo) && !failedLogos.has(channel.logo)) {
    const img = document.createElement('img');
    img.className = 'channel-logo';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 36;
    img.height = 36;
    img.src = channel.logo;
    img.alt = '';
    img.onerror = () => {
      failedLogos.add(channel.logo);
      persistFailedLogos();
      img.replaceWith(logoPlaceholder());
    };
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
  const tree = getCountryTree();
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
  nowPlayingInfo.classList.remove('hidden');
  channelNameEl.textContent = channel.name;
  revealOverlay();

  showSpinner();
  player.load(channel.url);
  updateEPGOverlay(channel);

  api.storeSet('lastChannelUrl', channel.url); // resume this channel on next load
}

function updateEPGOverlay(channel) {
  const key = channel.tvgId || channel.name;
  const now = getCurrentProgram(state.epgData, key);
  const next = getNextProgram(state.epgData, key);

  epgNowEl.textContent = now ? now.title : '';
  epgNextEl.textContent = next ? `Up next: ${next.title} · ${formatTime(next.start)}` : '';

  epgBar.innerHTML = '';
  if (!now && !next) {
    epgBar.classList.add('hidden');
    return;
  }
  epgBar.classList.remove('hidden');
  if (now) epgBar.appendChild(buildEpgNow(now));
  if (next) epgBar.appendChild(buildEpgNext(next));
}

// Small DOM helper — text via textContent (never innerHTML) since EPG data is untrusted.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildEpgNow(p) {
  const wrap = el('div', 'epg-now');

  const head = el('div', 'epg-now-head');
  head.append(
    el('span', 'epg-label', 'Now'),
    el('span', 'epg-now-title', p.title || 'Unknown programme'),
    el('span', 'epg-now-time', timeRange(p))
  );
  wrap.appendChild(head);

  const pct = progressPct(p);
  if (pct !== null) {
    const track = el('div', 'epg-progress');
    const fill = el('div', 'epg-progress-fill');
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    wrap.appendChild(track);

    const left = timeRemaining(p);
    if (left) wrap.appendChild(el('div', 'epg-now-meta', left));
  }
  return wrap;
}

function buildEpgNext(p) {
  const row = el('div', 'epg-next-row');
  row.append(
    el('span', 'epg-label', 'Next'),
    el('span', 'epg-next-time', formatTime(p.start)),
    el('span', 'epg-next-title', p.title || 'Unknown programme')
  );
  return row;
}

function formatTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeRange(p) {
  if (!p.start && !p.stop) return '';
  return `${formatTime(p.start)} – ${formatTime(p.stop)}`;
}

// Percent elapsed through the current programme, or null if it can't be computed.
function progressPct(p) {
  if (!p.start || !p.stop || p.stop <= p.start) return null;
  const pct = ((Date.now() - p.start) / (p.stop - p.start)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function timeRemaining(p) {
  if (!p.stop) return '';
  const mins = Math.round((p.stop - Date.now()) / 60_000);
  if (mins <= 0) return '';
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m left` : `${h}h left`;
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

  const oldM3u = (await api.storeGet('m3uUrl')) || '';
  const oldEpg = (await api.storeGet('epgUrl')) || '';
  const m3uChanged = m3uUrl !== oldM3u;
  const epgChanged = (epgUrl || '') !== oldEpg;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Loading…';

  try {
    await api.storeSet('m3uUrl', m3uUrl);
    await api.storeSet('epgUrl', epgUrl || null);

    showMain();

    if (state.channels.length === 0 || m3uChanged) {
      // First load, or the playlist URL changed → re-download.
      await loadChannels(m3uUrl, epgUrl || null, true);
    } else if (epgChanged) {
      // Only EPG changed → keep cached playlist, refetch EPG.
      await loadChannels(m3uUrl, epgUrl || null, false);
    }
    // Nothing changed → just return to the player, no download.
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Load Channels';
  }
});

cancelBtn.addEventListener('click', () => {
  // Restore the inputs to the saved values, discard edits, return to player.
  api.storeGet('m3uUrl').then((v) => { m3uInput.value = v || ''; });
  api.storeGet('epgUrl').then((v) => { epgInput.value = v || ''; });
  showMain();
});

settingsBtn.addEventListener('click', showSettings);

// --- Reload (force re-download playlist), behind a confirmation ---
function openReloadModal() {
  reloadModal.classList.remove('hidden');
}
function closeReloadModal() {
  reloadModal.classList.add('hidden');
}

async function doReload() {
  closeReloadModal();
  const m3uUrl = await api.storeGet('m3uUrl');
  if (!m3uUrl) return;
  const epgUrl = await api.storeGet('epgUrl');
  reloadBtn.classList.add('spinning');
  try {
    await loadChannels(m3uUrl, epgUrl || null, true);
  } finally {
    reloadBtn.classList.remove('spinning');
  }
}

reloadBtn.addEventListener('click', openReloadModal);
reloadCancel.addEventListener('click', closeReloadModal);
reloadConfirm.addEventListener('click', doReload);
reloadModal.addEventListener('click', (e) => {
  if (e.target === reloadModal) closeReloadModal();
});

// Escape closes whichever overlay is open (reload confirm, then countries modal,
// then settings if channels are loaded).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!reloadModal.classList.contains('hidden')) {
    closeReloadModal();
  } else if (!countriesModal.classList.contains('hidden')) {
    closeCountriesModal();
  } else if (!settingsScreen.classList.contains('hidden') && state.channels.length > 0) {
    showMain();
  }
});

// Keyboard navigation of the channel/browse list: Up/Down move a highlight,
// Enter activates the row (play channel, drill in, expand, or go back).
function navigableRows() {
  return [...channelList.querySelectorAll('.channel-item, .country-row, .sub-row, .back-header')];
}

function moveKbdFocus(delta) {
  const rows = navigableRows();
  if (rows.length === 0) return;
  rows.forEach((r) => r.classList.remove('kbd-focus'));
  kbdIndex = kbdIndex < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, kbdIndex + delta));
  const row = rows[kbdIndex];
  row.classList.add('kbd-focus');
  row.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  // Only when the main screen is interactive and no overlay is capturing input.
  if (!settingsScreen.classList.contains('hidden')) return;
  if (!reloadModal.classList.contains('hidden') || !countriesModal.classList.contains('hidden')) return;
  // Don't steal keys from text fields (the single-line search has no use for
  // up/down, so we allow list nav from there).
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT' && ae.id !== 'search-input') return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveKbdFocus(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveKbdFocus(-1);
  } else if (e.key === 'Enter' && kbdIndex >= 0) {
    const rows = navigableRows();
    if (rows[kbdIndex]) {
      e.preventDefault();
      rows[kbdIndex].click();
    }
  }
});

const debouncedRender = debounce(render, 150);
searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value; // keep value current; defer the expensive render
  debouncedRender();
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
