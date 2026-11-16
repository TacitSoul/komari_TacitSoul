/**
 * world-atlas 2.0.2 `countries-110m.json` (ISC, © Mike Bostock; Natural Earth data); small
 * territories missing at 110m (HK, SG, …) get a small disc instead.
 */
import { feature } from 'topojson-client';
import worldCountries110m from '@/data/world-countries-110m.json';
import { getCountryIndex } from './earthRegions';

type Position = [number, number];
type Rings = Position[][];
type PolygonGeometry = { type: 'Polygon'; coordinates: Rings } | { type: 'MultiPolygon'; coordinates: Rings[] };

export interface EarthPolygon {
  code: string;
  geometry: PolygonGeometry;
  /** Small territories missing from the 110m outlines get a small disc instead. */
  synthetic: boolean;
}

let shapesById: Map<string, PolygonGeometry> | null = null;

function getShapesById(): Map<string, PolygonGeometry> {
  if (shapesById) return shapesById;
  // Types come from @types/topojson-client's own parameter types (topojson-specification is only
  // a transitive dependency, so it is not imported by name).
  type TopologyArg = Parameters<typeof feature>[0];
  type ObjectArg = Parameters<typeof feature>[1];
  const topology = worldCountries110m as unknown as TopologyArg & { objects: { countries: ObjectArg } };
  const collection = feature(topology, topology.objects.countries) as unknown as {
    features: Array<{ id?: string | number; geometry?: PolygonGeometry | null }>;
  };
  shapesById = new Map();
  for (const item of collection.features) {
    if (item.id === undefined || !item.geometry) continue;
    shapesById.set(String(Number(item.id)), item.geometry);
  }
  return shapesById;
}

function ringArea(ring: Position[]) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

/** globe.gl wants outer rings clockwise (negative area) and holes counter-clockwise. */
function orient(rings: Rings): Rings {
  return rings.map((ring, index) => {
    const copy = ring.map((p) => [p[0], p[1]] as Position);
    const positive = ringArea(copy) > 0;
    const wantPositive = index !== 0;
    return positive === wantPositive ? copy : copy.reverse();
  });
}

function rewind(geometry: PolygonGeometry): PolygonGeometry {
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: orient(geometry.coordinates) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map(orient) };
}

function disc(lat: number, lng: number): PolygonGeometry {
  const radius = 1.1;
  const lngRadius = radius / Math.max(Math.cos((lat * Math.PI) / 180), 0.35);
  const ring: Position[] = [];
  for (let i = 0; i <= 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2;
    ring.push([Number((lng + Math.cos(angle) * lngRadius).toFixed(4)), Number((lat + Math.sin(angle) * radius).toFixed(4))]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

// Per-code cache keeps object identity, so globe.gl reuses meshes when the set of regions changes.
const polygonByCode = new Map<string, EarthPolygon | null>();
const polygonSetCache = new Map<string, EarthPolygon[]>();

function polygonFor(code: string): EarthPolygon | null {
  if (polygonByCode.has(code)) return polygonByCode.get(code)!;
  const info = getCountryIndex().get(code);
  let polygon: EarthPolygon | null = null;
  if (info) {
    const shape = info.numeric ? getShapesById().get(info.numeric) : undefined;
    polygon = shape
      ? { code, geometry: rewind(shape), synthetic: false }
      : { code, geometry: rewind(disc(info.lat, info.lng)), synthetic: true };
  }
  polygonByCode.set(code, polygon);
  return polygon;
}

/** Outlines of the given regions (countries from the 110m atlas; small territories as discs). */
export function buildEarthPolygons(codes: readonly string[]): EarthPolygon[] {
  const sorted = Array.from(new Set(codes)).sort();
  const key = sorted.join('|');
  const cached = polygonSetCache.get(key);
  if (cached) return cached;
  const result = sorted.map(polygonFor).filter((p): p is EarthPolygon => p !== null);
  polygonSetCache.set(key, result);
  return result;
}
