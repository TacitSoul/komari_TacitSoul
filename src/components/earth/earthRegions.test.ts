import { describe, expect, it } from 'vitest';
import type { NodeWithStatus } from '@/services/api';
import { buildEarthRegions, buildHubArcs, countUnmappedNodes, hubRegionCode, regionCoords } from './earthRegions';

function node(uuid: string, region: string, status: 'online' | 'offline', up = 0, down = 0): NodeWithStatus {
  return {
    uuid,
    name: uuid,
    region,
    status,
    stats: status === 'online' ? ({ network: { up, down, totalUp: 0, totalDown: 0 } } as NodeWithStatus['stats']) : undefined,
  } as NodeWithStatus;
}

describe('earth data', () => {
  const nodes = [
    node('sg-1', '🇸🇬', 'online', 10, 20),
    node('sg-2', 'SG', 'offline'),
    node('us-1', '🇺🇸', 'online', 5, 5),
    node('us-2', 'United States', 'online', 1, 2),
    node('jp-1', 'JP', 'offline'),
    node('hk-1', '🇭🇰', 'online'),
    node('xx-1', 'Mars base', 'online'),
  ];

  it('groups nodes by region with status and live traffic of online nodes', () => {
    const regions = buildEarthRegions(nodes);
    const byCode = Object.fromEntries(regions.map((r) => [r.code, r]));
    expect(Object.keys(byCode).sort()).toEqual(['HK', 'JP', 'SG', 'US']);
    expect(byCode.SG).toMatchObject({ online: 1, offline: 1, status: 'mixed', up: 10, down: 20 });
    expect(byCode.JP.status).toBe('offline');
    expect(byCode.US.status).toBe('online');
    expect(countUnmappedNodes(nodes)).toBe(1);
  });

  it('places regions from world-countries, including small territories', () => {
    expect(regionCoords('HK')).toEqual([22.267, 114.188]);
    expect(regionCoords('SG')?.[0]).toBeCloseTo(1.3667, 3);
    expect(regionCoords('ZZ')).toBeNull();
    // centroid between the peninsula and Borneo → moved onto the peninsula
    expect(regionCoords('MY')).toEqual([3.6, 101.9]);
  });

  it('draws hub-and-spoke arcs only towards a known hub, from regions with online nodes', () => {
    const regions = buildEarthRegions(nodes);
    expect(buildHubArcs(regions, null)).toEqual([]);
    expect(buildHubArcs(regions, 'nobody')).toEqual([]);
    const arcs = buildHubArcs(regions, 'sg-2');
    expect(hubRegionCode(regions, 'sg-2')).toBe('SG');
    expect(arcs.map((a) => a.id).sort()).toEqual(['HK', 'US']);
    expect(arcs.every((a) => a.endLat === regionCoords('SG')![0])).toBe(true);
  });
});
