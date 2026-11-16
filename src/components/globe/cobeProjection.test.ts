import { describe, expect, it } from 'vitest';
import { geoOrthographic } from 'd3-geo';
import {
  anglesFor,
  arcPoints,
  d3Rotation,
  latLngToVector,
  nearestAngle,
  projectLatLng,
  screenRadius,
  toView,
  type CobeView,
} from './cobeProjection';

/** cobe 2.0.1 `O()` for a surface point (markerElevation 0, offset 0), in [0, 1] canvas units. */
function cobeAnchor(lat: number, lng: number, phi: number, theta: number, scale: number) {
  const r = (lat * Math.PI) / 180;
  const a = (lng * Math.PI) / 180 - Math.PI;
  const o = Math.cos(r);
  const t = [-o * Math.cos(a), Math.sin(r), o * Math.sin(a)].map((v) => v * 0.8);
  const c2 = Math.cos(phi) * t[0] + Math.sin(phi) * t[2];
  const s2 = Math.sin(phi) * Math.sin(theta) * t[0] + Math.cos(theta) * t[1] - Math.cos(phi) * Math.sin(theta) * t[2];
  return [(c2 * scale + 1) / 2, (-s2 * scale + 1) / 2];
}

describe('cobe projection', () => {
  const view: CobeView = { phi: 1.2, theta: 0.3, size: 600, scale: 1 };

  it("matches cobe's own anchor positions", () => {
    for (const [lat, lng] of [[35.7, 139.7], [1.35, 103.8], [52.5, 13.4], [-33.9, 151.2], [40.7, -74]]) {
      const [ax, ay] = cobeAnchor(lat, lng, view.phi, view.theta, view.scale);
      const p = projectLatLng(lat, lng, view);
      expect(p.x).toBeCloseTo(ax * view.size, 6);
      expect(p.y).toBeCloseTo(ay * view.size, 6);
    }
  });

  it('centres the place given by anglesFor()', () => {
    const { phi, theta } = anglesFor(35.7, 139.7);
    const p = projectLatLng(35.7, 139.7, { phi, theta, size: 400, scale: 1 });
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(200, 6);
    expect(p.z).toBeCloseTo(1, 6);
  });

  it('agrees with a d3 orthographic projection using d3Rotation()', () => {
    const r = screenRadius(view);
    const d3 = geoOrthographic().rotate(d3Rotation(view.phi, view.theta)).scale(r).translate([view.size / 2, view.size / 2]);
    for (const [lat, lng] of [[35.7, 139.7], [10, 120], [60, 90]]) {
      const p = projectLatLng(lat, lng, view);
      if (!p.visible || p.z < 0) continue;
      const q = d3([lng, lat])!;
      expect(q[0]).toBeCloseTo(p.x, 6);
      expect(q[1]).toBeCloseTo(p.y, 6);
    }
  });

  it('marks the far side as hidden', () => {
    const { phi, theta } = anglesFor(0, 0);
    expect(projectLatLng(0, 180, { phi, theta, size: 400, scale: 1 }).visible).toBe(false);
    expect(projectLatLng(0, 0, { phi, theta, size: 400, scale: 1 }).visible).toBe(true);
  });

  it('turns the short way round', () => {
    expect(nearestAngle(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.1, 9);
    // from an angle that has wound up several turns, the result stays within half a turn of it
    const from = 10;
    const result = nearestAngle(from, 0);
    expect(Math.abs(result - from)).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(Math.cos(result)).toBeCloseTo(1, 9);
  });

  it('lifts arcs off the surface and keeps their ends on it', () => {
    const { points } = arcPoints({ lat: 35.7, lng: 139.7 }, { lat: 1.35, lng: 103.8 });
    const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
    expect(len(points[0])).toBeCloseTo(1, 6);
    expect(len(points[points.length - 1])).toBeCloseTo(1, 6);
    expect(len(points[Math.floor(points.length / 2)])).toBeGreaterThan(1.03);
  });

  it('rotation is orthonormal', () => {
    const v = latLngToVector(20, 30);
    const w = toView(v, 0.7, -0.4);
    expect(Math.hypot(...w)).toBeCloseTo(1, 9);
  });
});
