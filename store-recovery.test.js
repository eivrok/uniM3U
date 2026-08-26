import { describe, it, expect, vi } from 'vitest';
import { openStore } from './store-recovery.js';

// Mirrors what conf throws when it cannot deserialize config.json: the
// decrypt fails silently, then JSON.parse chokes on the ciphertext.
function deserializeFailure() {
  return new SyntaxError('Unexpected non-whitespace character after JSON at position 1');
}

describe('openStore', () => {
  it('returns the store when the config is readable', () => {
    const store = { name: 'ok' };
    const result = openStore({ createStore: () => store, quarantineConfig: () => '/bak' });
    expect(result.store).toBe(store);
  });

  it('reports no recovery when the config is readable', () => {
    const result = openStore({ createStore: () => ({}), quarantineConfig: () => '/bak' });
    expect(result.recovered).toBe(false);
  });

  it('leaves the config alone when it is readable', () => {
    const quarantineConfig = vi.fn(() => '/bak');
    openStore({ createStore: () => ({}), quarantineConfig });
    expect(quarantineConfig).not.toHaveBeenCalled();
  });

  it('still returns a store when the config cannot be deserialized', () => {
    const store = { name: 'fresh' };
    let calls = 0;
    const createStore = () => {
      calls += 1;
      if (calls === 1) throw deserializeFailure();
      return store;
    };
    const result = openStore({ createStore, quarantineConfig: () => '/bak' });
    expect(result.store).toBe(store);
  });

  it('quarantines the unreadable config', () => {
    const quarantineConfig = vi.fn(() => '/bak');
    let calls = 0;
    const createStore = () => {
      calls += 1;
      if (calls === 1) throw deserializeFailure();
      return {};
    };
    openStore({ createStore, quarantineConfig });
    expect(quarantineConfig).toHaveBeenCalledTimes(1);
  });

  it('reports the recovery so the app can tell the user', () => {
    let calls = 0;
    const createStore = () => {
      calls += 1;
      if (calls === 1) throw deserializeFailure();
      return {};
    };
    const result = openStore({ createStore, quarantineConfig: () => '/bak' });
    expect(result.recovered).toBe(true);
  });

  it('reports where the unreadable config was kept', () => {
    let calls = 0;
    const createStore = () => {
      calls += 1;
      if (calls === 1) throw deserializeFailure();
      return {};
    };
    const result = openStore({ createStore, quarantineConfig: () => '/kept/config.json' });
    expect(result.backupPath).toBe('/kept/config.json');
  });

  it('rethrows failures that are not a deserialize error', () => {
    const denied = new Error('EACCES: permission denied');
    const createStore = () => { throw denied; };
    expect(() => openStore({ createStore, quarantineConfig: () => '/bak' })).toThrow(denied);
  });

  it('does not discard the config for failures that are not a deserialize error', () => {
    const quarantineConfig = vi.fn(() => '/bak');
    const createStore = () => { throw new Error('EACCES: permission denied'); };
    try { openStore({ createStore, quarantineConfig }); } catch { /* asserted elsewhere */ }
    expect(quarantineConfig).not.toHaveBeenCalled();
  });

  it('propagates the error when a fresh store also fails', () => {
    const createStore = () => { throw deserializeFailure(); };
    expect(() => openStore({ createStore, quarantineConfig: () => '/bak' })).toThrow(SyntaxError);
  });
});
