import { describe, it, expect } from 'vitest';
import { parseXMLTV, decodeEntities, parseDate } from './epg-parse.js';

describe('parseDate', () => {
  it('returns null for an empty value', () => {
    expect(parseDate(null)).toBeNull();
  });

  it('parses a UTC XMLTV timestamp to epoch ms', () => {
    expect(parseDate('20240101120000 +0000')).toBe(Date.UTC(2024, 0, 1, 12, 0, 0));
  });

  it('applies a positive timezone offset', () => {
    expect(parseDate('20240101120000 +0200')).toBe(Date.UTC(2024, 0, 1, 10, 0, 0));
  });

  it('applies a negative timezone offset', () => {
    expect(parseDate('20240101120000 -0500')).toBe(Date.UTC(2024, 0, 1, 17, 0, 0));
  });

  it('returns null when the format is unrecognized', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes named entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });

  it('decodes decimal and hex numeric entities', () => {
    expect(decodeEntities('&#233; &#xe9;')).toBe('é é');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeEntities('a &nbsp; b')).toBe('a &nbsp; b');
  });
});

describe('parseXMLTV', () => {
  const XML = `
    <tv>
      <programme start="20240101120000 +0000" stop="20240101130000 +0000" channel="abc">
        <title lang="en">News &amp; Weather</title>
        <desc>Daily update</desc>
      </programme>
      <programme start="20240101130000 +0000" stop="20240101140000 +0000" channel="abc">
        <title>Movie</title>
      </programme>
      <programme start="20240101120000 +0000" stop="20240101130000 +0000">
        <title>No channel — skipped</title>
      </programme>
    </tv>`;

  it('groups programmes by channel id', () => {
    const result = parseXMLTV(XML);
    expect(Object.keys(result)).toEqual(['abc']);
  });

  it('skips programmes without a channel attribute', () => {
    const result = parseXMLTV(XML);
    expect(result.abc).toHaveLength(2);
  });

  it('decodes entities in titles', () => {
    const result = parseXMLTV(XML);
    expect(result.abc[0].title).toBe('News & Weather');
  });

  it('parses start/stop as epoch ms', () => {
    const result = parseXMLTV(XML);
    expect(result.abc[0].start).toBe(Date.UTC(2024, 0, 1, 12, 0, 0));
    expect(result.abc[0].stop).toBe(Date.UTC(2024, 0, 1, 13, 0, 0));
  });

  it('sorts each channel by start time', () => {
    const result = parseXMLTV(XML);
    const starts = result.abc.map((p) => p.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('defaults a missing desc to an empty string', () => {
    const result = parseXMLTV(XML);
    expect(result.abc[1].desc).toBe('');
  });
});
