import { describe, it, expect } from 'vitest';
import { parseChannelLabel } from './channel-label.js';

describe('parseChannelLabel', () => {
  it('strips the bracketed provider tag off the title', () => {
    expect(parseChannelLabel('[Viaplay NO] West Ham - Wolverhampton').tag).toBe('Viaplay NO');
  });

  it('keeps only the event name as the title', () => {
    const label = parseChannelLabel('[Viaplay NO] (1/9) 20:35 West Ham - Wolverhampton');
    expect(label.title).toBe('West Ham - Wolverhampton');
  });

  it('returns the kickoff time separately', () => {
    expect(parseChannelLabel('[Viaplay NO] (1/9) 20:35 Monza').time).toBe('20:35');
  });

  it('returns the event date separately', () => {
    expect(parseChannelLabel('[Viaplay NO] (1/9) 20:35 Monza').date).toBe('1/9');
  });

  it('treats a leading country code as the tag', () => {
    expect(parseChannelLabel('NO: Viaplay Event 20').tag).toBe('NO');
  });

  it('drops the country code from the title', () => {
    expect(parseChannelLabel('NO: Viaplay Event 20').title).toBe('Viaplay Event 20');
  });

  it('leaves a plain channel name untouched', () => {
    expect(parseChannelLabel('TV 2 Sport 1 HD')).toEqual({
      tag: null, date: null, time: null, title: 'TV 2 Sport 1 HD',
    });
  });

  it('does not mistake a leading clock time for a country tag', () => {
    expect(parseChannelLabel('20:35 Monza').tag).toBeNull();
  });

  it('reads a leading clock time as the time', () => {
    expect(parseChannelLabel('20:35 Monza').time).toBe('20:35');
  });

  it('reads a trailing ISO timestamp as the time', () => {
    expect(parseChannelLabel('Club Brugge vs. Aston Villa (2026-09-08 15:53:13)').time).toBe('15:53');
  });

  it('reads a trailing ISO timestamp as the date', () => {
    expect(parseChannelLabel('Club Brugge vs. Aston Villa (2026-09-08 15:53:13)').date).toBe('8/9');
  });

  it('drops the trailing ISO timestamp from the title', () => {
    expect(parseChannelLabel('Club Brugge vs. Aston Villa (2026-09-08 15:53:13)').title)
      .toBe('Club Brugge vs. Aston Villa');
  });

  it('accepts a trailing ISO timestamp with a T separator', () => {
    expect(parseChannelLabel('Dortmund vs. Villarreal (2026-09-08T17:23)').time).toBe('17:23');
  });

  it('keeps a leading time when the name also ends in an ISO timestamp', () => {
    expect(parseChannelLabel('20:35 Monza (2026-09-08 15:53:13)').time).toBe('20:35');
  });

  it('leaves a trailing year in parentheses alone', () => {
    expect(parseChannelLabel('Casablanca (1942)').title).toBe('Casablanca (1942)');
  });

  it('leaves a trailing non-timestamp parenthetical alone', () => {
    expect(parseChannelLabel('Match of the Day (repeat)').title).toBe('Match of the Day (repeat)');
  });

  it('keeps a name that is nothing but a timestamp as the title', () => {
    expect(parseChannelLabel('(2026-09-08 15:53:13)').title).toBe('(2026-09-08 15:53:13)');
  });

  it('keeps a name that is nothing but metadata as the title', () => {
    expect(parseChannelLabel('[Viaplay NO]').title).toBe('[Viaplay NO]');
  });

  it('returns an empty title for an empty name', () => {
    expect(parseChannelLabel('').title).toBe('');
  });

  it('returns an empty title when the name is not a string', () => {
    expect(parseChannelLabel(undefined).title).toBe('');
  });
});
