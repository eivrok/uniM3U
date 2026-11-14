import { describe, it, expect } from 'vitest';
import { withOpenCors } from './cors-policy.js';

describe('withOpenCors', () => {
  it('adds the header when the server sent none', () => {
    expect(withOpenCors({ 'content-type': ['video/mp2t'] })).toEqual({
      'content-type': ['video/mp2t'],
      'Access-Control-Allow-Origin': ['*'],
    });
  });

  it('replaces a lowercase header instead of sending a second one', () => {
    const headers = withOpenCors({ 'access-control-allow-origin': ['https://provider.example'] });
    expect(headers).toEqual({ 'Access-Control-Allow-Origin': ['*'] });
  });

  it('replaces a header in any other casing', () => {
    const headers = withOpenCors({ 'Access-control-Allow-origin': ['*'] });
    expect(Object.keys(headers)).toEqual(['Access-Control-Allow-Origin']);
  });

  it('copes with a response that has no headers', () => {
    expect(withOpenCors(undefined)).toEqual({ 'Access-Control-Allow-Origin': ['*'] });
  });
});
