/**
 * Maps Xtream Codes player_api payloads into the same channel objects
 * parseM3U() produces, so the country tree, search, favourites and player all
 * work unchanged regardless of which source the channels came from.
 */

// Xtream puts the kind segment before the credentials, so the three playable
// url forms differ structurally and each has to be built separately.
function liveUrl(creds, streamId) {
  return `${creds.origin}/${creds.username}/${creds.password}/${streamId}`;
}

function vodUrl(creds, streamId, ext) {
  return `${creds.origin}/movie/${creds.username}/${creds.password}/${streamId}.${ext || 'mp4'}`;
}

function episodeUrl(creds, episodeId, ext) {
  return `${creds.origin}/series/${creds.username}/${creds.password}/${episodeId}.${ext || 'mp4'}`;
}

// Category ids are only unique within a kind — two kinds can reuse id "1" for
// unrelated categories, so each kind gets its own lookup.
function categoryNames(categories) {
  return new Map((categories || []).map((c) => [String(c.category_id), c.category_name]));
}

function groupOf(names, categoryId) {
  return names.get(String(categoryId)) || 'Uncategorized';
}

// Providers occasionally ship a stream with no name. The M3U parser defaults
// these to 'Unknown', and the Xtream path bypasses the filter that would drop
// them, so search (which lowercases every name) would throw on the first one.
function nameOf(raw) {
  return raw || 'Unknown';
}

export function toChannels(payloads, creds) {
  const out = [];

  const liveNames = categoryNames(payloads.live?.categories);
  for (const s of payloads.live?.streams || []) {
    out.push({
      id: `xt-live-${s.stream_id}`,
      name: nameOf(s.name),
      tvgId: s.epg_channel_id || null,
      tvgName: nameOf(s.name),
      logo: s.stream_icon || null,
      group: groupOf(liveNames, s.category_id),
      url: liveUrl(creds, s.stream_id),
      kind: 'live',
      seriesId: null,
    });
  }

  const vodNames = categoryNames(payloads.vod?.categories);
  for (const s of payloads.vod?.streams || []) {
    out.push({
      id: `xt-movie-${s.stream_id}`,
      name: nameOf(s.name),
      tvgId: null,
      tvgName: nameOf(s.name),
      logo: s.stream_icon || null,
      group: groupOf(vodNames, s.category_id),
      url: vodUrl(creds, s.stream_id, s.container_extension),
      kind: 'movie',
      seriesId: null,
    });
  }

  const seriesNames = categoryNames(payloads.series?.categories);
  for (const s of payloads.series?.streams || []) {
    out.push({
      id: `xt-series-${s.series_id}`,
      name: nameOf(s.name),
      tvgId: null,
      tvgName: nameOf(s.name),
      logo: s.cover || null,
      group: groupOf(seriesNames, s.category_id),
      url: null, // a series is a container; its episodes are fetched on demand
      kind: 'series',
      seriesId: s.series_id,
    });
  }

  return out;
}

/**
 * Flattens one get_series_info response into playable episode rows, ordered by
 * season then episode. `group` is inherited from the series so the back header
 * still shows where the user came from.
 */
export function toEpisodes(seriesInfo, seriesGroup, creds) {
  const bySeason = seriesInfo?.episodes;
  if (!bySeason) return [];

  const seasons = Object.keys(bySeason).sort((a, b) => Number(a) - Number(b));
  const out = [];
  for (const season of seasons) {
    for (const ep of bySeason[season]) {
      out.push({
        id: `xt-episode-${ep.id}`,
        name: `S${ep.season ?? season}E${ep.episode_num} · ${nameOf(ep.title)}`,
        tvgId: null,
        tvgName: ep.title,
        logo: null,
        group: seriesGroup,
        url: episodeUrl(creds, ep.id, ep.container_extension),
        kind: 'episode',
        seriesId: null,
      });
    }
  }
  return out;
}
