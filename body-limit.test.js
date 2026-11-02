import { describe, it, expect } from 'vitest';
import { byteBudget, BodyTooLargeError } from './body-limit.js';

describe('byteBudget', () => {
  it('accepts chunks that stay within the limit', () => {
    const take = byteBudget(10);
    take(4);
    expect(() => take(6)).not.toThrow();
  });

  it('refuses the chunk that goes over the limit', () => {
    const take = byteBudget(10);
    take(6);
    expect(() => take(5)).toThrow(BodyTooLargeError);
  });

  it('names the limit in megabytes in the error', () => {
    const take = byteBudget(256 * 1024 * 1024);
    expect(() => take(256 * 1024 * 1024 + 1)).toThrow('256 MB');
  });
});
