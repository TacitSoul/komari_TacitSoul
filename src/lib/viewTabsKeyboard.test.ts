import { describe, expect, it } from 'vitest';
import { getViewTabIndex } from './viewTabsKeyboard';

describe('getViewTabIndex', () => {
  it.each(['ArrowRight', 'ArrowDown'])('moves forward and wraps with %s', key => {
    expect(getViewTabIndex(key, 0, 3)).toBe(1);
    expect(getViewTabIndex(key, 2, 3)).toBe(0);
  });

  it.each(['ArrowLeft', 'ArrowUp'])('moves backward and wraps with %s', key => {
    expect(getViewTabIndex(key, 2, 3)).toBe(1);
    expect(getViewTabIndex(key, 0, 3)).toBe(2);
  });

  it('jumps to the first and last tabs with Home and End', () => {
    expect(getViewTabIndex('Home', 1, 3)).toBe(0);
    expect(getViewTabIndex('End', 1, 3)).toBe(2);
  });

  it('leaves Tab, Enter, Space and unrelated keys to the browser', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a']) {
      expect(getViewTabIndex(key, 1, 3)).toBeNull();
    }
  });

  it('handles a single tab and an empty tab set', () => {
    expect(getViewTabIndex('ArrowRight', 0, 1)).toBe(0);
    expect(getViewTabIndex('End', 0, 0)).toBeNull();
  });
});
