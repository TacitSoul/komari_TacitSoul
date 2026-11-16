import { describe, expect, it } from 'vitest';
import type { NodeWithStatus } from '@/services/api';
import { buildEarthRegions, buildHubArcs, hubRegionCode } from '@/components/earth/earthRegions';
import { markerClassName, regionCardPosition, regionsKey, type RegionCardLayout } from './globeState';

function node(uuid: string, region: string, status: 'online' | 'offline' = 'online'): NodeWithStatus {
  return { uuid, name: uuid, region, status } as NodeWithStatus;
}

describe('globe region cache', () => {
  it('invalidates equal-size regions when members swap, so the hub and arcs move', () => {
    const before = buildEarthRegions([node('hub', 'SG'), node('other', 'JP')]);
    const after = buildEarthRegions([node('hub', 'JP'), node('other', 'SG')]);
    expect(regionsKey(after)).not.toBe(regionsKey(before));
    expect(hubRegionCode(after, 'hub')).toBe('JP');
    expect(buildHubArcs(after, 'hub')[0]).toMatchObject({
      id: 'SG', endLat: after.find((region) => region.code === 'JP')!.lat,
    });
  });

  it('invalidates online counts even when the region stays mixed with the same members', () => {
    const before = buildEarthRegions([node('a', 'SG'), node('b', 'SG', 'offline'), node('c', 'SG', 'offline')]);
    const after = buildEarthRegions([node('a', 'SG'), node('b', 'SG'), node('c', 'SG', 'offline')]);
    expect(before[0].status).toBe(after[0].status);
    expect(regionsKey(after)).not.toBe(regionsKey(before));
    expect(after[0].online).toBe(2);
  });

  it('ignores traffic and display-name updates that do not affect markers or hub resolution', () => {
    const regions = buildEarthRegions([node('hub', 'SG')]);
    const updated = regions.map((region) => ({
      ...region, up: 100, down: 200, nodes: region.nodes.map((member) => ({ ...member, name: 'renamed' })),
    }));
    expect(regionsKey(updated)).toBe(regionsKey(regions));
  });
});

describe('rebuilt globe markers', () => {
  it('preserves selected and hub classes through status and style rebuilds', () => {
    for (const status of ['online', 'offline'] as const) {
      const region = buildEarthRegions([node('hub', 'SG', status)])[0];
      for (const style of ['rich', 'calm', 'lite'] as const) {
        const classes = markerClassName(region, style, 'SG', 'SG').split(' ');
        expect(classes).toContain('is-selected');
        expect(classes).toContain('is-hub');
        expect(classes).toContain(`status-${status}`);
        expect(classes.includes('is-lite')).toBe(style === 'lite');
        expect(classes.includes('is-rich')).toBe(style === 'rich');
      }
    }
  });

  it('does not highlight unrelated regions', () => {
    const region = buildEarthRegions([node('other', 'JP')])[0];
    expect(markerClassName(region, 'calm', 'SG', 'US')).toBe('dot-marker status-online');
  });
});

describe('region card projection', () => {
  const layout: RegionCardLayout = {
    slotWidth: 900, slotHeight: 600, globeSize: 600,
    markerWidth: 30, markerHeight: 20, cardWidth: 210, cardHeight: 160,
  };

  it('follows the projected flag, including the centred host offset and selected scale', () => {
    expect(regionCardPosition(300, 300, layout)).toEqual({ left: 487, top: 275 });
  });

  it('flips to the left of the flag near the right edge', () => {
    expect(regionCardPosition(580, 300, layout)).toEqual({ left: 484, top: 275 });
  });

  it('keeps the card inside the vertical margins', () => {
    expect(regionCardPosition(0, 0, layout).top).toBe(8);
    expect(regionCardPosition(300, 590, layout).top).toBe(432);
  });
});
