import { describe, expect, it } from 'vitest';
import { separatorPriority } from './footerSegments';

describe('separatorPriority', () => {
  it('has no separator before the first segment', () => {
    expect(separatorPriority([{ pri: 2 }, { pri: null }], 0)).toBeUndefined();
  });

  it('hides a separator together with the earlier credit segments', () => {
    // powered-by (2), version (2), theme credit (1), custom footer (always)
    const segments = [{ pri: 2 }, { pri: 2 }, { pri: 1 }, { pri: null }];
    expect(separatorPriority(segments, 1)).toBe(2);
    expect(separatorPriority(segments, 2)).toBe(1);
    // The custom footer stays, but its separator goes once every credit segment is gone.
    expect(separatorPriority(segments, 3)).toBe(2);
  });

  it('keeps the separator between two always-visible segments', () => {
    expect(separatorPriority([{ pri: null }, { pri: null }], 1)).toBeNull();
  });
});
