import { describe, expect, it } from 'vitest';
import { buildEarthPolygons } from './earthPolygons';

describe('earth polygons', () => {
  it('outlines countries from the atlas and falls back to discs for small territories', () => {
    const polygons = buildEarthPolygons(['CN', 'SG', 'HK', 'CN', 'EU']);
    const byCode = Object.fromEntries(polygons.map((p) => [p.code, p]));
    expect(polygons.map((p) => p.code)).toEqual(['CN', 'HK', 'SG']);
    expect(byCode.CN.synthetic).toBe(false);
    expect(byCode.SG.synthetic).toBe(true);
    expect(byCode.HK.synthetic).toBe(true);
  });

  it('keeps object identity per region across different sets', () => {
    const a = buildEarthPolygons(['CN', 'US']);
    const b = buildEarthPolygons(['US', 'CN', 'JP']);
    expect(b.find((p) => p.code === 'CN')).toBe(a.find((p) => p.code === 'CN'));
    expect(buildEarthPolygons(['US', 'CN'])).toBe(a);
  });

  it('winds outer rings clockwise for globe.gl', () => {
    const [us] = buildEarthPolygons(['US']);
    const rings = us.geometry.type === 'Polygon' ? [us.geometry.coordinates] : us.geometry.coordinates;
    for (const polygon of rings) {
      const outer = polygon[0];
      let area = 0;
      for (let i = 0, j = outer.length - 1; i < outer.length; j = i, i += 1) area += outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
      expect(area).toBeLessThan(0);
    }
  });
});
