/**
 *
 * Design choices:
 * - Region coordinates and ISO numeric ids come from `world-countries` (all 250 regions), not a
 *   hand-written table of ~130.
 * - Arcs run from each online region to the configured hub node's region (the base theme's
 *   hub-and-spoke model), not to the visitor's IP location — no third-party IP lookups.
 * - Node status is the theme's own (`online` / `offline`).
 */
import countries from 'world-countries';
import type { NodeWithStatus } from '@/services/api';
import { getCountryCodeFromRegion } from '@/matrix/utils/geo';

export type RegionStatus = 'online' | 'mixed' | 'offline';

export interface EarthRegionNode {
  uuid: string;
  name: string;
  status: 'online' | 'offline';
}

export interface EarthRegion {
  /** ISO 3166-1 alpha-2, e.g. "SG". Stable id across updates. */
  code: string;
  lat: number;
  lng: number;
  nodes: EarthRegionNode[];
  online: number;
  offline: number;
  status: RegionStatus;
  /** Live upload / download of the region's online nodes (bytes per second). */
  up: number;
  down: number;
}

export interface EarthArc {
  /** Origin region code — stable id so arcs do not restart when another region changes. */
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export interface CountryInfo {
  lat: number;
  lng: number;
  /** ISO 3166-1 numeric, unpadded ("4", "156"), as used by world-atlas ids after Number(). */
  numeric: string | null;
}

let countryIndex: Map<string, CountryInfo> | null = null;

/**
 * Marker positions for countries whose geographic centroid lands in the sea (or far from where
 * servers are), so the flag would float between landmasses. Kept small on purpose.
 */
const MARKER_OVERRIDES: Record<string, [number, number]> = {
  MY: [3.6, 101.9], // peninsula (the centroid sits between the peninsula and Borneo)
  ID: [-6.6, 106.8], // Java
  PH: [14.6, 121.0], // Luzon
  JP: [36.2, 138.3], // Honshu
  GR: [38.6, 23.0], // mainland
  NZ: [-38.5, 175.6], // North Island
  US: [39.5, -98.35],
  CA: [52.5, -100.0], // populated south instead of the Arctic centroid
  RU: [56.0, 50.0], // European Russia, where most hosting is
  NO: [60.5, 9.5],
  CL: [-33.5, -70.7],
};

export function getCountryIndex(): Map<string, CountryInfo> {
  if (countryIndex) return countryIndex;
  countryIndex = new Map();
  for (const c of countries) {
    if (!c.cca2 || !Array.isArray(c.latlng) || c.latlng.length < 2) continue;
    const code = c.cca2.toUpperCase();
    const [lat, lng] = MARKER_OVERRIDES[code] ?? [c.latlng[0], c.latlng[1]];
    countryIndex.set(code, { lat, lng, numeric: c.ccn3 ? String(Number(c.ccn3)) : null });
  }
  return countryIndex;
}

/**
 * Coordinates of a region code (world-countries centroid), or null when the code is not a
 * mappable country / territory (e.g. "EU", "UN").
 */
export function regionCoords(code: string | null | undefined): [number, number] | null {
  if (!code) return null;
  const info = getCountryIndex().get(code.toUpperCase());
  return info ? [info.lat, info.lng] : null;
}

/** Region code of a node (flag emoji, ISO code, or alias), or null when it cannot be placed. */
export function nodeRegionCode(node: Pick<NodeWithStatus, 'region'>): string | null {
  const code = getCountryCodeFromRegion(node.region);
  return code && getCountryIndex().has(code) ? code : null;
}

function statusOf(online: number, offline: number): RegionStatus {
  if (online === 0) return 'offline';
  if (offline === 0) return 'online';
  return 'mixed';
}

/** One entry per region with at least one node, largest regions first. */
export function buildEarthRegions(nodes: readonly NodeWithStatus[]): EarthRegion[] {
  const groups = new Map<string, EarthRegion>();
  for (const node of nodes) {
    const code = nodeRegionCode(node);
    if (!code) continue;
    const coords = regionCoords(code)!;
    let region = groups.get(code);
    if (!region) {
      region = { code, lat: coords[0], lng: coords[1], nodes: [], online: 0, offline: 0, status: 'offline', up: 0, down: 0 };
      groups.set(code, region);
    }
    const online = node.status === 'online';
    region.nodes.push({ uuid: node.uuid, name: node.name, status: node.status });
    if (online) {
      region.online += 1;
      region.up += node.stats?.network.up ?? 0;
      region.down += node.stats?.network.down ?? 0;
    } else {
      region.offline += 1;
    }
  }
  const list = Array.from(groups.values());
  for (const region of list) region.status = statusOf(region.online, region.offline);
  return list.sort((a, b) => b.nodes.length - a.nodes.length || a.code.localeCompare(b.code));
}

/** Count of nodes whose region cannot be placed on the globe. */
export function countUnmappedNodes(nodes: readonly NodeWithStatus[]): number {
  let count = 0;
  for (const node of nodes) if (!nodeRegionCode(node)) count += 1;
  return count;
}

export const MAX_ARCS = 12;

/**
 * Hub-and-spoke arcs: from every other region with an online node to the hub node's region.
 * No hub, an unknown hub, or a hub whose region cannot be placed → no arcs.
 */
export function buildHubArcs(regions: readonly EarthRegion[], hubNodeUuid: string | null | undefined): EarthArc[] {
  if (!hubNodeUuid) return [];
  const hub = regions.find((region) => region.nodes.some((node) => node.uuid === hubNodeUuid));
  if (!hub) return [];
  const arcs: EarthArc[] = [];
  for (const origin of regions) {
    if (origin.code === hub.code || origin.status === 'offline') continue;
    arcs.push({ id: origin.code, startLat: origin.lat, startLng: origin.lng, endLat: hub.lat, endLng: hub.lng });
    if (arcs.length >= MAX_ARCS) break;
  }
  return arcs;
}

/** Region code of the hub node, if it can be placed. */
export function hubRegionCode(regions: readonly EarthRegion[], hubNodeUuid: string | null | undefined): string | null {
  if (!hubNodeUuid) return null;
  return regions.find((region) => region.nodes.some((node) => node.uuid === hubNodeUuid))?.code ?? null;
}
