import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import type { NodeWithStatus } from "@/services/api";
import {
  getAllNodeMetaSnapshot,
  getHomeNodeSummariesSnapshot,
  getNodeMetaSnapshot,
  getNodeMetricsSnapshot,
  getNodeTrafficTrendSnapshot,
  getVisibleNodeUuidsSnapshot,
  subscribeHomeNodeSummaries,
  subscribeNodeList,
  subscribeToNodeMeta,
  subscribeToNodeMetrics,
  subscribeToNodeTrafficTrend,
  syncMatrixNodes,
  type HomeNodeSummary,
} from "@/matrix/services/nodeStore";
import type { NodeInfo, NodeMetrics, TrafficTrendSample } from "@/matrix/types/komari";

/**
 * Feed the matrix node store from the app's node list. Call once, in the component that owns
 * the views reading the store. A layout effect keeps the store ahead of the children's paint.
 */
export function useMatrixNodeSync(nodes: readonly NodeWithStatus[]) {
  useLayoutEffect(() => {
    syncMatrixNodes(nodes);
  }, [nodes]);
}

function useNodeMetaSnapshot(uuid: string): NodeInfo | undefined {
  const subscribe = useCallback((callback: () => void) => subscribeToNodeMeta(uuid, callback), [uuid]);
  const getSnapshot = useCallback(() => getNodeMetaSnapshot(uuid), [uuid]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useNodeMetricsSnapshot(uuid: string): NodeMetrics | undefined {
  const subscribe = useCallback((callback: () => void) => subscribeToNodeMetrics(uuid, callback), [uuid]);
  const getSnapshot = useCallback(() => getNodeMetricsSnapshot(uuid), [uuid]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useNodeTrafficTrendSnapshot(uuid: string): { up: TrafficTrendSample[]; down: TrafficTrendSample[] } {
  const subscribe = useCallback((callback: () => void) => subscribeToNodeTrafficTrend(uuid, callback), [uuid]);
  const getSnapshot = useCallback(() => getNodeTrafficTrendSnapshot(uuid), [uuid]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useNodeMeta(uuid: string): NodeInfo | undefined {
  return useNodeMetaSnapshot(uuid);
}

export function useNodeMetrics(uuid: string): NodeMetrics | undefined {
  return useNodeMetricsSnapshot(uuid);
}

export function useNodeCardSnapshots(uuid: string) {
  return {
    meta: useNodeMetaSnapshot(uuid),
    metrics: useNodeMetricsSnapshot(uuid),
    trafficTrend: useNodeTrafficTrendSnapshot(uuid),
  };
}

/** UUIDs in display order. Hidden nodes are included only on request (logged-in admins). */
export function useVisibleNodeUuids(includeHidden = false): string[] {
  const getSnapshot = useCallback(() => getVisibleNodeUuidsSnapshot(includeHidden), [includeHidden]);
  return useSyncExternalStore(subscribeNodeList, getSnapshot, getSnapshot);
}

export function useAllNodeMeta(): NodeInfo[] {
  return useSyncExternalStore(subscribeNodeList, getAllNodeMetaSnapshot, getAllNodeMetaSnapshot);
}

export function useHomeNodeSummaries(): HomeNodeSummary[] {
  return useSyncExternalStore(
    subscribeHomeNodeSummaries,
    getHomeNodeSummariesSnapshot,
    getHomeNodeSummariesSnapshot,
  );
}
