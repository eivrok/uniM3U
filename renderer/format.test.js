import { describe, it, expect } from 'vitest';
import { formatDownloadProgress } from './format.js';

describe('formatDownloadProgress', () => {
  it('shows received, total, and percent when total is known', () => {
    const text = formatDownloadProgress(4_404_019, 18_874_368);
    expect(text).toBe('Downloading playlist… 4.2 / 18.0 MB (23%)');
  });

  it('shows only received megabytes when total is zero', () => {
    expect(formatDownloadProgress(4_404_019, 0)).toBe('Downloading playlist… 4.2 MB');
  });

  it('reports 100% when received equals total', () => {
    const text = formatDownloadProgress(10_485_760, 10_485_760);
    expect(text).toBe('Downloading playlist… 10.0 / 10.0 MB (100%)');
  });
});
