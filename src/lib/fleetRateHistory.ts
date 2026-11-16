import { useSyncExternalStore } from 'react';

/**
 * Rolling fleet-wide bandwidth samples for the cluster panel charts.
 *
 * Fed by the app from live polls only (never from the offline cache), so every point is a real
 * reading. Nothing is back-filled: the chart starts with the first sample and grows to MAX points.
 */
export interface FleetRatePoint {
  time: number;
  up: number;
  down: number;
}

export const FLEET_RATE_MAX_POINTS = 16;
/** Two pushes closer than this are the same tick (e.g. a node-list refresh right after a poll). */
const SAME_TICK_MS = 1_000;

let points: FleetRatePoint[] = [];
const listeners = new Set<() => void>();

export function pushFleetRate(up: number, down: number, time = Date.now()) {
  const sample: FleetRatePoint = {
    time,
    up: Number.isFinite(up) && up > 0 ? up : 0,
    down: Number.isFinite(down) && down > 0 ? down : 0,
  };
  const last = points[points.length - 1];
  if (last && time - last.time < SAME_TICK_MS) {
    if (last.up === sample.up && last.down === sample.down) return;
    points = [...points.slice(0, -1), sample];
  } else {
    points = [...points, sample].slice(-FLEET_RATE_MAX_POINTS);
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => points;

export function useFleetRateHistory(): FleetRatePoint[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test helper. */
export function resetFleetRateHistory() {
  points = [];
}
