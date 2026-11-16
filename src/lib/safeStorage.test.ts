import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './safeStorage';
import { getInitialViewMode } from '@/contexts/ViewModeContext';

afterEach(() => vi.unstubAllGlobals());

describe('safeStorage', () => {
  it('gets, sets and removes values when storage is available', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(safeStorage.get('missing')).toBeNull();
    safeStorage.set('nodeViewMode', 'matrix');
    expect(safeStorage.get('nodeViewMode')).toBe('matrix');
    expect(getInitialViewMode()).toBe('matrix');
    safeStorage.remove('nodeViewMode');
    expect(safeStorage.get('nodeViewMode')).toBeNull();
    expect(getInitialViewMode()).toBe('globe');
  });

  it('survives a SecurityError from the storage getter during startup', () => {
    vi.stubGlobal('localStorage', undefined);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
    try {
      expect(safeStorage.get('nodeViewMode')).toBeNull();
      expect(getInitialViewMode()).toBe('globe');
      expect(() => safeStorage.set('nodeViewMode', 'table')).not.toThrow();
      expect(() => safeStorage.remove('nodeViewMode')).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor!);
    }
  });

  it('survives throwing storage methods and quota errors', () => {
    const blocked = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    vi.stubGlobal('localStorage', {
      getItem: blocked,
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); },
      removeItem: blocked,
    });
    expect(safeStorage.get('x')).toBeNull();
    expect(() => safeStorage.set('x', 'y')).not.toThrow();
    expect(() => safeStorage.remove('x')).not.toThrow();
  });

  it('falls back for invalid stored view names and unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'invalid' });
    expect(getInitialViewMode()).toBe('globe');
    vi.stubGlobal('localStorage', undefined);
    expect(getInitialViewMode()).toBe('globe');
  });
});
