import { describe, it, expect } from 'vitest';
import { conditionalHeaders } from './http-cache-policy.js';

describe('conditionalHeaders', () => {
  it('sends no headers when there are no validators', () => {
    expect(conditionalHeaders(null)).toEqual({});
  });

  it('sends no headers when both validators are empty', () => {
    expect(conditionalHeaders({ etag: null, lastModified: null })).toEqual({});
  });

  it('sends If-None-Match for an etag', () => {
    expect(conditionalHeaders({ etag: '"abc123"' }))
      .toEqual({ 'If-None-Match': '"abc123"' });
  });

  it('sends If-Modified-Since for a last-modified date', () => {
    expect(conditionalHeaders({ lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT' }))
      .toEqual({ 'If-Modified-Since': 'Wed, 21 Oct 2026 07:28:00 GMT' });
  });

  it('sends both validators when both are known', () => {
    expect(conditionalHeaders({ etag: '"abc123"', lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT' }))
      .toEqual({
        'If-None-Match': '"abc123"',
        'If-Modified-Since': 'Wed, 21 Oct 2026 07:28:00 GMT',
      });
  });
});
