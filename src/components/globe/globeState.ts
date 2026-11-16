import type { EarthRegion } from '@/components/earth/earthRegions';
import type { EarthMarkerStyle } from '@/components/earth/earthPerformance';

/** Ignore traffic updates, but never reuse a region's old membership or online count. */
export function regionsKey(regions: readonly EarthRegion[]) {
  return JSON.stringify(regions.map((region) => [
    region.code,
    region.status,
    region.online,
    region.nodes.map((node) => [node.uuid, node.status]),
  ]));
}

export function markerClassName(region: EarthRegion, style: EarthMarkerStyle, selected: string | null, hub: string | null) {
  return `dot-marker status-${region.status}${style === 'lite' ? ' is-lite' : ''}${style === 'rich' ? ' is-rich' : ''}${region.code === selected ? ' is-selected' : ''}${region.code === hub ? ' is-hub' : ''}`;
}

export interface RegionCardLayout {
  slotWidth: number;
  slotHeight: number;
  globeSize: number;
  markerWidth: number;
  markerHeight: number;
  cardWidth: number;
  cardHeight: number;
}

/** The host is centred in the slot; selected flags are scaled to 1.5 in CSS. */
export function regionCardPosition(x: number, y: number, layout: RegionCardLayout) {
  const { slotWidth, slotHeight, globeSize, markerWidth, markerHeight, cardWidth, cardHeight } = layout;
  const markerX = (slotWidth - globeSize) / 2 + x;
  const markerY = (slotHeight - globeSize) / 2 + y;
  const halfWidth = markerWidth * 1.5 / 2;
  const halfHeight = markerHeight * 1.5 / 2;
  let left = markerX + halfWidth + 14;
  if (left + cardWidth > slotWidth - 8) left = markerX - halfWidth - cardWidth - 14;
  const top = Math.min(Math.max(8, markerY - halfHeight - 10), Math.max(8, slotHeight - cardHeight - 8));
  return { left: Math.max(8, Math.round(left)), top: Math.round(top) };
}
