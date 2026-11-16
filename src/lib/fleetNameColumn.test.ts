import { describe, expect, it } from 'vitest';
import { getFleetNameWidth } from './fleetNameColumn';

describe('shared fleet name column', () => {
  it('uses rendered width rather than character count', () => {
    const widths: Record<string, number> = { WWWW: 48.25, iiiiiiii: 24, '中文名称': 52 };
    expect(getFleetNameWidth(Object.keys(widths), name => widths[name])).toBe(54);
  });

  it('includes the longest name even if it is outside the rendered window', () => {
    const names = Array.from({ length: 100 }, (_, index) => `node-${index}`);
    names[99] = 'longest-offscreen-name';
    expect(getFleetNameWidth(names, name => name === 'longest-offscreen-name' ? 131.2 : 50)).toBe(134);
  });

  it('does not depend on node order or mutate its input', () => {
    const names = Object.freeze(['short', 'long']);
    const measure = (name: string) => name === 'long' ? 80 : 20;
    expect(getFleetNameWidth(names, measure)).toBe(getFleetNameWidth([...names].reverse(), measure));
    expect(names).toEqual(['short', 'long']);
  });

  it('returns no measured column for an empty list or unusable metrics', () => {
    expect(getFleetNameWidth([], () => 0)).toBe(0);
    expect(getFleetNameWidth(['a', 'b'], () => Number.NaN)).toBe(0);
  });
});
