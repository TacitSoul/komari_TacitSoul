import { useSyncExternalStore } from 'react';

/**
 * Group / region selection shared by the card, matrix and table views, so switching views keeps
 * the filter. `ALL` is the sentinel used by the filter-bar helpers.
 */
export const FLEET_ALL = '__all__';

export interface FleetFilterState {
  group: string;
  region: string;
}

let state: FleetFilterState = { group: FLEET_ALL, region: FLEET_ALL };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;

export function setFleetGroup(group: string) {
  if (state.group === group) return;
  state = { ...state, group };
  emit();
}

export function setFleetRegion(region: string) {
  if (state.region === region) return;
  state = { ...state, region };
  emit();
}

export function resetFleetFilter() {
  if (state.group === FLEET_ALL && state.region === FLEET_ALL) return;
  state = { group: FLEET_ALL, region: FLEET_ALL };
  emit();
}

export function useFleetFilter(): FleetFilterState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
