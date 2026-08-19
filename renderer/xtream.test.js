import { describe, it, expect } from 'vitest';
import { toChannels, toEpisodes } from './xtream.js';

const creds = { origin: 'http://ex.club:8080', username: 'alice', password: 's3cret' };

const payloads = {
  live: {
    categories: [{ category_id: '1', category_name: 'Norway - Sport' }],
    streams: [{
      stream_id: 310167,
      name: 'NO: V Sport 2 FHD',
      stream_icon: 'http://ex.club/logo.png',
      epg_channel_id: 'vsport2.no',
      category_id: '1',
    }],
  },
  vod: {
    categories: [{ category_id: '7', category_name: 'Movies: Action' }],
    streams: [{
      stream_id: 5501,
      name: 'Heat (1995)',
      stream_icon: 'http://ex.club/heat.jpg',
      category_id: '7',
      container_extension: 'mkv',
    }],
  },
  series: {
    categories: [{ category_id: '20', category_name: 'Series: Nordic Netflix' }],
    streams: [{
      series_id: 88,
      name: 'SE:Trespasses (2025)',
      cover: 'http://ex.club/tres.jpg',
      category_id: '20',
    }],
  },
};

describe('toChannels', () => {
  it('builds a live url identical to the m3u form', () => {
    const live = toChannels(payloads, creds).find((c) => c.kind === 'live');
    expect(live.url).toBe('http://ex.club:8080/alice/s3cret/310167');
  });

  it('builds a movie url with the kind segment before the credentials', () => {
    const movie = toChannels(payloads, creds).find((c) => c.kind === 'movie');
    expect(movie.url).toBe('http://ex.club:8080/movie/alice/s3cret/5501.mkv');
  });

  it('gives series rows no url because they are not directly playable', () => {
    const series = toChannels(payloads, creds).find((c) => c.kind === 'series');
    expect(series.url).toBe(null);
  });

  it('carries the series id on series rows so episodes can be fetched', () => {
    const series = toChannels(payloads, creds).find((c) => c.kind === 'series');
    expect(series.seriesId).toBe(88);
  });

  it('maps a live stream to the full channel shape', () => {
    const live = toChannels(payloads, creds).find((c) => c.kind === 'live');
    expect(live).toEqual({
      id: 'xt-live-310167',
      name: 'NO: V Sport 2 FHD',
      tvgId: 'vsport2.no',
      tvgName: 'NO: V Sport 2 FHD',
      logo: 'http://ex.club/logo.png',
      group: 'Norway - Sport',
      url: 'http://ex.club:8080/alice/s3cret/310167',
      kind: 'live',
      seriesId: null,
    });
  });

  it('uses cover as the logo for series rows', () => {
    const series = toChannels(payloads, creds).find((c) => c.kind === 'series');
    expect(series.logo).toBe('http://ex.club/tres.jpg');
  });

  it('defaults a movie with no container_extension to mp4', () => {
    const noExt = {
      ...payloads,
      vod: { ...payloads.vod, streams: [{ stream_id: 9, name: 'X', category_id: '7' }] },
    };
    const movie = toChannels(noExt, creds).find((c) => c.kind === 'movie');
    expect(movie.url).toBe('http://ex.club:8080/movie/alice/s3cret/9.mp4');
  });

  it('falls back to Uncategorized when the category id is unknown', () => {
    const orphan = {
      ...payloads,
      live: { ...payloads.live, streams: [{ stream_id: 1, name: 'Orphan', category_id: '999' }] },
    };
    const live = toChannels(orphan, creds).find((c) => c.kind === 'live');
    expect(live.group).toBe('Uncategorized');
  });

  it('does not merge kinds that share a category id', () => {
    const collide = {
      live: {
        categories: [{ category_id: '1', category_name: 'Football' }],
        streams: [{ stream_id: 1, name: 'A live', category_id: '1' }],
      },
      vod: {
        categories: [{ category_id: '1', category_name: 'Action' }],
        streams: [{ stream_id: 2, name: 'A movie', category_id: '1' }],
      },
      series: { categories: [], streams: [] },
    };
    const out = toChannels(collide, creds);
    expect(out.map((c) => c.group)).toEqual(['Football', 'Action']);
  });

  it('falls back to a placeholder name when a live stream has none', () => {
    const unnamed = {
      ...payloads,
      live: { ...payloads.live, streams: [{ stream_id: 3, category_id: '1' }] },
    };
    const live = toChannels(unnamed, creds).find((c) => c.kind === 'live');
    expect(live.name).toBe('Unknown');
  });

  it('falls back to a placeholder name when a movie has none', () => {
    const unnamed = {
      ...payloads,
      vod: { ...payloads.vod, streams: [{ stream_id: 4, category_id: '7' }] },
    };
    const movie = toChannels(unnamed, creds).find((c) => c.kind === 'movie');
    expect(movie.name).toBe('Unknown');
  });

  it('falls back to a placeholder name when a series has none', () => {
    const unnamed = {
      ...payloads,
      series: { ...payloads.series, streams: [{ series_id: 5, category_id: '20' }] },
    };
    const series = toChannels(unnamed, creds).find((c) => c.kind === 'series');
    expect(series.name).toBe('Unknown');
  });

  it('returns an empty array when every payload is empty', () => {
    const empty = { categories: [], streams: [] };
    expect(toChannels({ live: empty, vod: empty, series: empty }, creds)).toEqual([]);
  });
});

describe('toEpisodes', () => {
  const info = {
    episodes: {
      '1': [
        { id: '5001', title: 'Pilot', episode_num: 1, season: 1, container_extension: 'mkv' },
        { id: '5002', title: 'Second', episode_num: 2, season: 1, container_extension: 'mkv' },
      ],
    },
  };

  it('builds an episode url with the series segment', () => {
    const eps = toEpisodes(info, 'Series: Nordic Netflix', creds);
    expect(eps[0].url).toBe('http://ex.club:8080/series/alice/s3cret/5001.mkv');
  });

  it('labels an episode with its season and number', () => {
    const eps = toEpisodes(info, 'Series: Nordic Netflix', creds);
    expect(eps[0].name).toBe('S1E1 · Pilot');
  });

  it('keeps the parent group so the back header reads correctly', () => {
    const eps = toEpisodes(info, 'Series: Nordic Netflix', creds);
    expect(eps[0].group).toBe('Series: Nordic Netflix');
  });

  it('returns an empty array when a series has no episodes', () => {
    expect(toEpisodes({ episodes: {} }, 'G', creds)).toEqual([]);
  });

  it('returns an empty array when the episodes key is missing', () => {
    expect(toEpisodes({}, 'G', creds)).toEqual([]);
  });
});
