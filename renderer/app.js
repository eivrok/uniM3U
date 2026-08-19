import { parseM3U, parseM3UProgressive, parseGroup } from './playlist.js';
import { isCacheFresh, DEFAULT_TTL_HOURS } from './cache-policy.js';
import { migrateFavorites } from './favorites-migration.js';
import { toChannels, toEpisodes } from './xtream.js';
import { formatDownloadProgress } from './format.js';
import { loadEPG, getProgramsForChannel, getCurrentProgram, getNextProgram } from './epg.js';
import { Player } from './player.js';
import { clampIdleSeconds, formatIdleLabel, decideChrome } from './idle.js';

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
  activeSeries: null,         // the series channel object when view === 'episodes'
  expandedCountries: new Set(),
  visibleCountries: null,     // null = all visible; otherwise a Set of allowed country names
  tree: null,                 // memoized country tree; rebuilt only when channels reload
  idleHideSeconds: 5,         // seconds of inactivity before chrome hides; 0 = disabled
  xtreamCreds: null,          // {origin, username, password} when the source is Xtream
  episodeCache: new Map(),    // series_id -> episode channel rows, fetched on demand
  episodePending: new Set(),  // series_id currently being fetched — blocks duplicate in-flight requests
};

// --- DOM refs ---
const settingsScreen = document.getElementById('settings-screen');
const mainScreen = document.getElementById('main-screen');
const m3uInput = document.getElementById('m3u-url-input');
const epgInput = document.getElementById('epg-url-input');
const cacheTtlSelect = document.getElementById('cache-ttl-select');
const fastApiCheck = document.getElementById('fast-api-check');
const idleHideSlider = document.getElementById('idle-hide-slider');
const idleHideValue = document.getElementById('idle-hide-value');
const lastDownloadNote = document.getElementById('last-download-note');
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
const loadingText = document.getElementById('loading-text');
const categoryTabs = document.getElementById('category-tabs');
const emptyState = document.getElementById('empty-state');
const emptyStateText = document.getElementById('empty-state-text');
const updateToast = document.getElementById('update-toast');
const updateToastText = document.getElementById('update-toast-text');
const updateRestartBtn = document.getElementById('update-restart');
const updateLaterBtn = document.getElementById('update-later');
const EMPTY_STATE_IDLE = 'Select a channel to start watching';
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

// Brand logo — use assets/logo.png if it loads, otherwise fall back to the text.
const appLogo = document.getElementById('app-logo');
const brandText = document.getElementById('brand-text');
appLogo.addEventListener('load', () => {
  appLogo.style.display = 'block';
  brandText.style.display = 'none';
});
appLogo.addEventListener('error', () => { appLogo.style.display = 'none'; });
appLogo.src = 'assets/logo.png';

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

// --- Idle controller: reveal chrome on input, enter immersive after idle ---
// Folds in the old now-playing-overlay fade. A single ticking check uses the
// pure shouldHideChrome() so the timing rule stays testable in idle.test.js.
// (mainScreen is declared with the other DOM refs above.)
const playerOverlay = document.getElementById('player-overlay');
let lastInputAt = Date.now();
let idleTimer = null;
let wasImmersive = false;

function isPlaying() {
  return Boolean(state.activeChannelId);
}

function applyIdleState() {
  const { immersive, overlay } = decideChrome({
    playing: isPlaying(),
    settingsOpen: !settingsScreen.classList.contains('hidden'),
    idleHideSeconds: state.idleHideSeconds,
    idleElapsedMs: Date.now() - lastInputAt,
  });
  mainScreen.classList.toggle('immersive', immersive);
  playerOverlay.classList.toggle('show', overlay);

  // Snap the window to the video aspect on the way into immersive, restore it
  // on the way out. Only act on the transition, not every 500ms tick.
  if (immersive !== wasImmersive) {
    wasImmersive = immersive;
    if (immersive) {
      const aspect = videoEl.videoWidth / videoEl.videoHeight;
      if (Number.isFinite(aspect) && aspect > 0) api.immersiveFill(aspect);
    } else {
      api.immersiveFillClear();
    }
  }
}

function revealChrome() {
  lastInputAt = Date.now();
  // Act immediately only when input must change something: leaving immersive,
  // or re-showing a faded overlay. While the overlay is already up and we're
  // not immersive, continuous mouse movement is a no-op beyond the timestamp —
  // the 500ms loop owns the steady-state fade.
  if (mainScreen.classList.contains('immersive') || !playerOverlay.classList.contains('show')) {
    applyIdleState();
  }
}

// One timer drives the transition; 500ms resolution is fine for a multi-second
// delay. activeChannelId is never cleared once a channel starts, so the loop
// simply keeps running for the rest of the session after the first play.
function startIdleLoop() {
  if (idleTimer) return;
  idleTimer = setInterval(applyIdleState, 500);
}

document.addEventListener('mousemove', revealChrome);
document.addEventListener('keydown', revealChrome);

// --- Toast ---
const toast = document.createElement('div');
toast.id = 'toast';
document.body.appendChild(toast);

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// --- Auto-update toast ---
function showUpdateToast(version) {
  updateToastText.textContent = `Update ready (v${version})`;
  updateToast.classList.remove('hidden');
}

updateRestartBtn.addEventListener('click', () => api.restartToUpdate());
updateLaterBtn.addEventListener('click', () => updateToast.classList.add('hidden'));

api.onUpdateReady((version) => showUpdateToast(version));

// --- Version label ---
api.getVersion().then((version) => {
  document.getElementById('app-version').textContent = `v${version}`;
});

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// --- Init ---
async function init() {
  const {
    m3uUrl,
    epgUrl,
    favorites: favs,
    visibleCountries: vis,
    expandedCountries: exp,
    failedLogos: fl,
    cacheTtlHours: ttlH,
    idleHideSeconds: idleH,
    useXtreamApi,
  } = await api.storeGetMany([
    'm3uUrl', 'epgUrl', 'favorites', 'visibleCountries',
    'expandedCountries', 'failedLogos', 'cacheTtlHours', 'idleHideSeconds',
    'useXtreamApi',
  ]);

  if (favs) state.favorites = new Set(favs);
  state.visibleCountries = Array.isArray(vis) ? new Set(vis) : null;
  if (Array.isArray(exp)) state.expandedCountries = new Set(exp);
  if (Array.isArray(fl)) failedLogos = new Set(fl);
  cacheTtlSelect.value = String(ttlH == null ? DEFAULT_TTL_HOURS : ttlH);
  // Unset means on: the fast path is the default, the checkbox is an escape hatch.
  fastApiCheck.checked = useXtreamApi !== false;
  state.idleHideSeconds = clampIdleSeconds(idleH == null ? 5 : idleH);
  idleHideSlider.value = String(state.idleHideSeconds);
  idleHideValue.textContent = formatIdleLabel(state.idleHideSeconds);
  updateLastDownloadNote();

  if (m3uUrl) {
    m3uInput.value = m3uUrl;
    if (epgUrl) epgInput.value = epgUrl;
    showMain();
    await loadChannels(m3uUrl, epgUrl);
  } else {
    showSettings();
  }
}

// Saved playlist/EPG URLs as of when settings opened, so the Save button can
// tell whether saving will trigger a (re)download or just persist preferences.
let savedM3uUrl = '';
let savedEpgUrl = '';
let savedFastApi = true;

function refreshSaveLabel() {
  const willLoad =
    state.channels.length === 0 ||
    m3uInput.value.trim() !== savedM3uUrl ||
    (epgInput.value.trim() || '') !== savedEpgUrl ||
    fastApiCheck.checked !== savedFastApi;
  saveBtn.textContent = willLoad ? 'Save & Load Channels' : 'Save';
}

async function showSettings() {
  // Cancel only makes sense once channels are loaded — on first run there's
  // nothing to go back to.
  cancelBtn.classList.toggle('hidden', state.channels.length === 0);
  updateLastDownloadNote();
  const urls = await api.storeGetMany(['m3uUrl', 'epgUrl', 'useXtreamApi']);
  savedM3uUrl = urls.m3uUrl || '';
  savedEpgUrl = urls.epgUrl || '';
  savedFastApi = urls.useXtreamApi !== false;
  fastApiCheck.checked = savedFastApi;
  refreshSaveLabel();
  settingsScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

async function updateLastDownloadNote() {
  // The two sources keep separate clocks (#5) — an Xtream refetch must not
  // make a stale M3U cache file look freshly downloaded, or vice versa.
  // Show whichever is more recent so the note stays honest either way.
  const { playlistCachedAt, xtreamCachedAt } = await api.storeGetMany(['playlistCachedAt', 'xtreamCachedAt']);
  const at = Math.max(playlistCachedAt || 0, xtreamCachedAt || 0) || null;
  lastDownloadNote.textContent = at
    ? `Last full download: ${new Date(at).toLocaleString()}`
    : 'No playlist downloaded yet.';
}

function showMain() {
  settingsScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
}

// --- Load channels ---

/**
 * Downloads the playlist, first asking the server whether the cached copy is
 * still current. On a large playlist a 304 is the difference between a full
 * transfer and nothing at all. Returns the raw M3U text.
 */
async function downloadPlaylist(m3uUrl, validators, lap) {
  loadingText.textContent = validators
    ? 'Checking for playlist updates…'
    : 'Downloading playlist, hang tight…';
  const stopProgress = api.onFetchProgress(({ url, received, total }) => {
    if (url !== m3uUrl) return; // ignore the background EPG fetch
    loadingText.textContent = formatDownloadProgress(received, total);
  });
  let result;
  try {
    result = await api.fetchPlaylist(m3uUrl, validators);
  } finally {
    stopProgress();
  }
  lap(validators ? 'revalidate (network + IPC in)' : 'download (network + IPC in)');

  if (result.notModified) {
    // A 304 without validators means the server is misbehaving; treat it as an
    // error rather than retrying forever.
    if (!validators) throw new Error('Server sent 304 to an unconditional request');
    const cached = await api.cacheRead();
    if (cached) {
      // Confirmed current — restart the TTL clock without re-downloading.
      // Also reassert the format: reached while playlistFormat === 'xtream'
      // (a provider switch mid-flight), this is M3U content, and the store
      // must say so or the next launch serves stale xtream-cache.json.
      await api.storeSetMany({ playlistCachedAt: Date.now(), playlistFormat: 'm3u' });
      lap('cache reuse (304)');
      return cached;
    }
    // Validators outlived the cache file. Ask again, unconditionally.
    return downloadPlaylist(m3uUrl, null, lap);
  }

  await api.cacheWrite(result.body);
  await api.storeSetMany({
    playlistCachedAt: Date.now(),
    playlistEtag: result.etag,
    playlistLastModified: result.lastModified,
    playlistFormat: 'm3u',
  });
  lap('cache write (IPC out + fsync)');
  return result.body;
}

/**
 * Favourites saved before this release are positional `ch-N` ids from M3U parse
 * order. The normal migration only runs on the M3U path, but an Xtream user
 * takes that path once at most and then never again — so without this their
 * saved favourites would keep ids that match nothing, and every star would
 * silently disappear on upgrade.
 *
 * Resolves them against the old M3U cache still on disk. Runs at most once: the
 * flag is set even when nothing resolved, so a favourite whose channel has gone
 * from the playlist can't make every launch re-read a 70 MB file.
 */
async function migrateLegacyFavorites() {
  if (![...state.favorites].some((f) => /^ch-\d+$/.test(f))) return;
  if (await api.storeGet('favoritesLegacyMigrated')) return;

  const legacy = await api.cacheRead();
  if (legacy) {
    const migrated = migrateFavorites([...state.favorites], parseM3U(legacy));
    if (migrated.changed) {
      state.favorites = new Set(migrated.favorites);
      await api.storeSet('favorites', migrated.favorites);
    }
  }
  // Set even when the cache was missing: there is nothing left to resolve
  // against, so retrying on every launch would only burn a file read.
  await api.storeSet('favoritesLegacyMigrated', true);
}

/**
 * Loads the catalogue from an Xtream panel, using the cached copy when the TTL
 * still allows it. Throws when the panel cannot serve player_api.php, which is
 * the caller's signal to fall back to the M3U.
 */
async function loadXtream(m3uUrl, forceRefresh, xtreamCachedAt, ttlH, lap) {
  const format = await api.storeGet('playlistFormat');
  // playlistFormat is cleared to null whenever the saved url changes (see the
  // settings Save handler), so a stale value here can only mean "still the
  // same Xtream provider" — safe to trust for the cache-hit check below.

  // A cache written by the M3U source can never be read as Xtream JSON.
  if (!forceRefresh && format === 'xtream' && isCacheFresh(xtreamCachedAt, ttlH)) {
    const cached = await api.xtreamCacheRead();
    if (cached) {
      const payloads = JSON.parse(cached);
      lap('xtream cache read');
      return asCatalogue(payloads);
    }
  }

  loadingText.textContent = 'Loading catalogue…';
  const payloads = await api.fetchXtream(m3uUrl);
  if (!payloads) return null; // ordinary M3U url — caller uses the M3U path
  lap('xtream fetch (network + IPC in)');

  await api.xtreamCacheWrite(JSON.stringify(payloads));
  // Its own clock (#5): playlistCachedAt belongs to the M3U cache file, which
  // this write never touches. Sharing the key would make a stale
  // playlist-cache.m3u look freshly downloaded on every Xtream refetch.
  await api.storeSetMany({ xtreamCachedAt: Date.now(), playlistFormat: 'xtream' });
  lap('xtream cache write');

  return asCatalogue(payloads);
}

/**
 * A panel that answers every catalogue call with an empty list is answering,
 * but has nothing to serve. Treating that as success would leave the user
 * staring at an empty app while their M3U still works, so it is reported as
 * unavailable and the caller falls back.
 */
function asCatalogue(payloads) {
  const channels = toChannels(payloads, payloads.creds);
  if (channels.length === 0) throw new Error('XtreamUnavailable: catalogue is empty');
  return { channels, creds: payloads.creds };
}

async function loadChannels(m3uUrl, epgUrl, forceRefresh = false) {
  loadingMsg.classList.remove('hidden');
  emptyStateText.textContent = 'Loading your channels…';
  emptyStateText.classList.add('pulsing');
  channelList.innerHTML = '';

  // TEMPORARY perf instrumentation — strip once the refresh bottleneck is found.
  const perfLaps = [];
  const perfStart = performance.now();
  let perfLast = perfStart;
  const lap = (phase) => {
    const now = performance.now();
    perfLaps.push({ phase, ms: Math.round(now - perfLast) });
    perfLast = now;
  };

  try {
    const {
      playlistCachedAt: cachedAt,
      xtreamCachedAt,
      cacheTtlHours: ttlH,
      lastChannelUrl,
      playlistEtag,
      playlistLastModified,
      useXtreamApi,
    } = await api.storeGetMany([
      'playlistCachedAt', 'xtreamCachedAt', 'cacheTtlHours', 'lastChannelUrl',
      'playlistEtag', 'playlistLastModified', 'useXtreamApi',
    ]);
    lap('settings read');

    let raw = null;

    // An Xtream panel serves the same catalogue as JSON far more cheaply than
    // as a generated M3U. Fall back to the M3U whenever the API is unusable.
    // Unset means on. The escape hatch exists for panels whose API answers
    // successfully but incompletely — that degrades silently, so the app cannot
    // detect it and fall back on the user's behalf the way it does for a hard
    // failure.
    let fromXtream = false;
    try {
      const parsed = useXtreamApi === false
        ? null
        : await loadXtream(m3uUrl, forceRefresh, xtreamCachedAt, ttlH, lap);
      if (parsed) {
        state.channels = parsed.channels;
        state.xtreamCreds = parsed.creds;
        fromXtream = true;
      }
    } catch (err) {
      // A panel that cannot serve player_api.php is expected, not exceptional.
      console.warn('xtream api unavailable, falling back to the m3u:', err.message);
      showToast('Fast API unavailable — using the full playlist');
    }

    if (!fromXtream) {
      state.xtreamCreds = null;
      // Only pull the (large) cache file off disk when it would actually be
      // used — reached only once the Xtream path is ruled out, so a fresh
      // Xtream launch never reads and discards the 73.7 MB M3U cache.
      raw = !forceRefresh && isCacheFresh(cachedAt, ttlH)
        ? await api.cacheRead()
        : null;
      lap('cache read (file + IPC in)');

      if (!raw) {
        // Revalidate rather than re-download, but only when there is a cached
        // copy for the server to confirm against.
        const validators = cachedAt && (playlistEtag || playlistLastModified)
          ? { etag: playlistEtag, lastModified: playlistLastModified }
          : null;
        raw = await downloadPlaylist(m3uUrl, validators, lap);
      }
    }

    if (!fromXtream) {
      loadingText.textContent = 'Parsing channels…';
      const parsed = await parseM3UProgressive(raw, (n) => {
        loadingText.textContent = `Parsing channels… ${n.toLocaleString()} so far…`;
      });
      lap('parse');
      state.channels = parsed.filter((c) => c.url && !/^=+/.test(c.name.trim()));
      lap('filter');
    }
    loadingText.textContent = `Loaded ${state.channels.length.toLocaleString()} channels`;

    // Precompute country/sub once per channel (#4) so search and tree-building
    // don't re-run parseGroup on every render. Normalize group here too.
    for (const c of state.channels) {
      c.group = c.group || 'Uncategorized';
      const { country, sub } = parseGroup(c.group);
      c.country = country;
      c.sub = sub;
    }
    if (!fromXtream) {
      // `ch-N` is M3U parse order and matches nothing meaningful in the Xtream
      // id space, so migrating there would repoint favourites at random rows.
      const migrated = migrateFavorites([...state.favorites], state.channels);
      if (migrated.changed) {
        state.favorites = new Set(migrated.favorites);
        await api.storeSet('favorites', migrated.favorites);
      }
    } else {
      // An Xtream user never reaches the branch above, so their pre-upgrade
      // favourites have to be resolved against the old M3U cache instead.
      await migrateLegacyFavorites();
    }
    state.tree = null; // invalidate memoized tree (#3)
    // Episode rows carry urls built from the previous load's creds; a provider
    // switch (or even a same-provider reload) must not let a stale entry point
    // at the old host with the old credentials.
    state.episodeCache.clear();
    state.episodePending.clear();
    lap('precompute country/sub');

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
    lap('first render (browse)');
    console.table(perfLaps);
    console.log(`[perf] loadChannels total: ${Math.round(performance.now() - perfStart)} ms for ${state.channels.length} channels`);

    // Resume the last-played channel, matched by stable url (not the index id).
    // Drill into its group so the row is visible and highlighted.
    if (lastChannelUrl) {
      const last = state.channels.find((c) => c.url === lastChannelUrl);
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
    loadingText.textContent = 'Loading channels…';
    loadingMsg.classList.add('hidden');
    emptyStateText.textContent = EMPTY_STATE_IDLE;
    emptyStateText.classList.remove('pulsing');
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
    const favs = state.channels.filter((c) => c.url && state.favorites.has(c.url));
    renderChannelItems(favs, 'No favorites yet — tap ★ on a channel');
    return;
  }

  // Drilled into a series: its episodes, fetched on demand.
  if (state.view === 'episodes' && state.activeSeries) {
    renderBackHeader(state.activeSeries.group);
    const eps = state.episodeCache.get(state.activeSeries.seriesId);
    if (eps) {
      renderChannelItems(eps, 'This series has no episodes', true);
    } else {
      renderHint('Loading episodes…');
    }
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

  // A series is a container, not a stream: it has no url to favourite or play.
  // Favourites are keyed on url, and the fav-button below has no null guard —
  // routing a series row into it would call toggleFavorite(null) and persist
  // null into the user's saved favourites.
  if (channel.kind === 'series') {
    const chevron = document.createElement('span');
    chevron.className = 'series-chevron';
    chevron.textContent = '›';
    item.appendChild(chevron);
    item.addEventListener('click', () => openSeries(channel));
    return item;
  }

  // Fav button
  const favBtn = document.createElement('button');
  favBtn.className = 'fav-btn' + (state.favorites.has(channel.url) ? ' active' : '');
  favBtn.textContent = '★';
  favBtn.title = 'Favorite';
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(channel.url);
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

/**
 * Opens a series row. Episodes are ~11 KB per series, so they are fetched when
 * first opened and then kept in memory for the session.
 */
async function openSeries(series) {
  // loadChannels can spend up to ~97s downloading the M3U fallback after an
  // Xtream panel fails, and it nulls xtreamCreds first. During that window the
  // previous catalogue's series rows are still on screen and clickable, but
  // there are no creds to build an episode url from — decline rather than
  // handing toEpisodes a null creds object.
  if (!state.xtreamCreds) {
    showToast('Episodes unavailable right now — try again once channels finish loading');
    return;
  }

  // render()'s search branch runs before the episodes branch, so a series
  // opened from a search result would otherwise keep repainting the same
  // search results underneath it — the view flips to 'episodes' but the
  // still-truthy query swallows the navigation and nothing visibly happens.
  state.searchQuery = '';
  searchInput.value = '';

  state.view = 'episodes';
  state.activeSeries = series;
  render();
  channelList.parentElement.scrollTop = 0;

  if (state.episodeCache.has(series.seriesId) || state.episodePending.has(series.seriesId)) return;

  state.episodePending.add(series.seriesId);
  try {
    const m3uUrl = await api.storeGet('m3uUrl');
    const info = await api.fetchSeriesInfo(m3uUrl, series.seriesId);
    state.episodeCache.set(series.seriesId, toEpisodes(info, series.group, state.xtreamCreds));
  } catch (err) {
    console.warn('could not load episodes:', err.message);
    // Don't cache the failure — a transient blip must not make the series look
    // permanently empty. Dropping the key lets the next open retry.
    state.episodeCache.delete(series.seriesId);
    showToast('Could not load episodes for this series');
    if (state.view === 'episodes' && state.activeSeries?.seriesId === series.seriesId) goBack();
    return;
  } finally {
    state.episodePending.delete(series.seriesId);
  }

  // Only repaint if the user is still looking at this series.
  if (state.view === 'episodes' && state.activeSeries?.seriesId === series.seriesId) render();
}

function goBack() {
  // Episodes sit one level below a group, so back returns to that group first.
  if (state.view === 'episodes') {
    const group = state.activeSeries?.group ?? null;
    state.view = group ? 'channels' : 'browse';
    state.activeGroup = group;
    state.activeSeries = null;
    render();
    return;
  }
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
  revealChrome();
  startIdleLoop();

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
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
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
function toggleFavorite(channelUrl) {
  if (state.favorites.has(channelUrl)) {
    state.favorites.delete(channelUrl);
  } else {
    state.favorites.add(channelUrl);
  }
  api.storeSet('favorites', [...state.favorites]);
  if (state.activeFilter === 'favorites') render();
}

// --- Event listeners ---
saveBtn.addEventListener('click', async () => {
  const m3uUrl = m3uInput.value.trim();
  const epgUrl = epgInput.value.trim();
  if (!m3uUrl) { alert('Please enter an M3U URL'); return; }

  const saved = await api.storeGetMany(['m3uUrl', 'epgUrl', 'useXtreamApi']);
  const oldM3u = saved.m3uUrl || '';
  const oldEpg = saved.epgUrl || '';
  const m3uChanged = m3uUrl !== oldM3u;
  const epgChanged = (epgUrl || '') !== oldEpg;
  const apiChanged = fastApiCheck.checked !== (saved.useXtreamApi !== false);

  saveBtn.disabled = true;
  saveBtn.textContent = 'Loading…';

  try {
    state.idleHideSeconds = clampIdleSeconds(idleHideSlider.value);
    const settings = {
      m3uUrl,
      epgUrl: epgUrl || null,
      cacheTtlHours: Number(cacheTtlSelect.value),
      idleHideSeconds: state.idleHideSeconds,
      useXtreamApi: fastApiCheck.checked,
    };
    if (apiChanged) {
      // Switching source invalidates the Xtream side the same way a url change
      // does, or the next launch would read a cache the store no longer
      // describes. playlistCachedAt is deliberately left alone: turning the API
      // off should be able to reuse a still-valid M3U cache rather than forcing
      // a full re-download the user did not ask for.
      settings.playlistFormat = null;
      settings.xtreamCachedAt = null;
    }
    if (m3uChanged) {
      // The cached copy and its validators describe the old playlist. Keeping
      // them would let the server answer 304 and serve the wrong channels.
      settings.playlistEtag = null;
      settings.playlistLastModified = null;
      settings.playlistCachedAt = null;
      // A stale 'xtream' here would let loadXtream serve xtream-cache.json —
      // and the previous provider's stored username/password — for a url that
      // now points somewhere else entirely.
      settings.playlistFormat = null;
    }
    await api.storeSetMany(settings);
    // Snapshot the now-saved URLs so a reopen reflects "no change" correctly.
    savedM3uUrl = m3uUrl;
    savedEpgUrl = epgUrl || '';
    savedFastApi = fastApiCheck.checked;

    showMain();

    if (state.channels.length === 0 || m3uChanged) {
      // First load, or the playlist URL changed → re-download.
      await loadChannels(m3uUrl, epgUrl || null, true);
    } else if (apiChanged) {
      // Source switched. Not a forced refresh: the Xtream cache was just
      // invalidated above so that path refetches anyway, and the M3U path
      // should still honour the user's re-download preference.
      await loadChannels(m3uUrl, epgUrl || null, false);
    } else if (epgChanged) {
      // Only EPG changed → keep cached playlist, refetch EPG.
      await loadChannels(m3uUrl, epgUrl || null, false);
    }
    // Nothing changed → just return to the player, no download.
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    refreshSaveLabel();
  }
});

cancelBtn.addEventListener('click', () => {
  // Restore the inputs to the saved values, discard edits, return to player.
  api.storeGetMany(['m3uUrl', 'epgUrl', 'useXtreamApi']).then(({ m3uUrl, epgUrl, useXtreamApi }) => {
    m3uInput.value = m3uUrl || '';
    epgInput.value = epgUrl || '';
    fastApiCheck.checked = useXtreamApi !== false;
  });
  showMain();
});

settingsBtn.addEventListener('click', showSettings);

// Keep the Save button label honest as the user edits the URLs.
m3uInput.addEventListener('input', refreshSaveLabel);
epgInput.addEventListener('input', refreshSaveLabel);
fastApiCheck.addEventListener('change', refreshSaveLabel);

idleHideSlider.addEventListener('input', () => {
  idleHideValue.textContent = formatIdleLabel(Number(idleHideSlider.value));
});

// --- Reload (force re-download playlist), behind a confirmation ---
function openReloadModal() {
  reloadModal.classList.remove('hidden');
}
function closeReloadModal() {
  reloadModal.classList.add('hidden');
}

async function doReload() {
  closeReloadModal();
  const { m3uUrl, epgUrl } = await api.storeGetMany(['m3uUrl', 'epgUrl']);
  if (!m3uUrl) return;
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
