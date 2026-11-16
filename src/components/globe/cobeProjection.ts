/**
 * Projection of the cobe globe (cobe 2.0.1, MIT © Shu Ding), reproduced so that overlays drawn
 * outside WebGL — flags, country outlines, arcs — land exactly where cobe draws the map.
 *
 * cobe's conventions (from its marker / arc shaders and `O()` / `U()` in dist/index.esm.js):
 * - a lat/lng becomes the unit vector `[cos(lat)·cos(lng), sin(lat), −cos(lat)·sin(lng)]`;
 * - `phi` / `theta` rotate world → view with the matrix below (z points at the viewer);
 * - the sphere has radius 0.8 × `scale` in units of half the canvas height, centred.
 *
 * The same view expressed for d3-geo: an orthographic projection centred on
 * (lng = −90° − phi, lat = theta), i.e. `rotate([90 + phi°, −theta°, 0])`.
 */

export const COBE_RADIUS = 0.8;

export type Vec3 = [number, number, number];

export interface CobeView {
  phi: number;
  theta: number;
  /** CSS size of the square canvas. */
  size: number;
  /** cobe `scale` option. */
  scale: number;
}

const RAD = Math.PI / 180;

/** cobe `U()`: latitude / longitude in degrees → unit vector in world space. */
export function latLngToVector(lat: number, lng: number): Vec3 {
  const la = lat * RAD;
  const lo = lng * RAD;
  const c = Math.cos(la);
  return [c * Math.cos(lo), Math.sin(la), -c * Math.sin(lo)];
}

/** cobe's world → view rotation (z towards the viewer). */
export function toView(v: Vec3, phi: number, theta: number): Vec3 {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [
    cp * v[0] + sp * v[2],
    sp * st * v[0] + ct * v[1] - cp * st * v[2],
    -sp * ct * v[0] + st * v[1] + cp * ct * v[2],
  ];
}

/** Sphere radius on screen, in CSS pixels. */
export function screenRadius(view: CobeView): number {
  return COBE_RADIUS * view.scale * (view.size / 2);
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** View-space depth in sphere radii (> 0: front). */
  z: number;
  /** Not hidden behind the sphere (cobe's rule: in front, or outside the disc). */
  visible: boolean;
}

/**
 * Screen position (CSS px, origin top-left) of a world-space point given in sphere radii
 * (|v| = 1 on the surface, > 1 above it).
 */
export function projectVector(v: Vec3, view: CobeView): ScreenPoint {
  const p = toView(v, view.phi, view.theta);
  const r = screenRadius(view);
  const half = view.size / 2;
  return {
    x: half + p[0] * r,
    y: half - p[1] * r,
    z: p[2],
    visible: p[2] >= 0 || p[0] * p[0] + p[1] * p[1] >= 1,
  };
}

export function projectLatLng(lat: number, lng: number, view: CobeView): ScreenPoint {
  return projectVector(latLngToVector(lat, lng), view);
}

/** cobe angles that put a place in the centre of the view. */
export function anglesFor(lat: number, lng: number): { phi: number; theta: number } {
  return { phi: (3 * Math.PI) / 2 - lng * RAD, theta: lat * RAD };
}

/** The same view as a d3-geo orthographic rotation. */
export function d3Rotation(phi: number, theta: number): [number, number, number] {
  return [90 + phi / RAD, -theta / RAD, 0];
}

/** Shortest equivalent of `target` as seen from `from` (so a turn never goes the long way). */
export function nearestAngle(from: number, target: number): number {
  const full = Math.PI * 2;
  let delta = (target - from) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return from + delta;
}

/**
 * Points of an arc between two places: along the great circle, lifted above the surface by a
 * smooth profile (peak `height` sphere radii at the middle), so long arcs never cut the globe.
 */
export function arcPoints(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  segments = 48,
): { points: Vec3[]; angle: number } {
  const a = latLngToVector(from.lat, from.lng);
  const b = latLngToVector(to.lat, to.lng);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  const height = Math.max(0.05, (angle / Math.PI) * 0.3);
  const sin = Math.sin(angle);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    let p: Vec3;
    if (sin < 1e-6) {
      p = [a[0], a[1], a[2]];
    } else {
      const wa = Math.sin((1 - t) * angle) / sin;
      const wb = Math.sin(t * angle) / sin;
      p = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
    }
    const lift = 1 + height * Math.sin(Math.PI * t);
    points.push([p[0] * lift, p[1] * lift, p[2] * lift]);
  }
  return { points, angle };
}
