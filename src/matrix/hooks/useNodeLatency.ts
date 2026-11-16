import { useMemo, useState } from "react";
import type { NodeWithStatus } from "@/services/api";
import { useMinuteClock } from "@/matrix/hooks/useClock";
import { useMatrixNodeSync } from "@/matrix/hooks/useNode";
import {
  buildPingBuckets,
  readPingSnapshot,
  useHomepagePingOverview,
  useNodePingOverview,
  useNodePingOverviewLines,
} from "@/matrix/hooks/usePingOverview";
import { useThemeSettings } from "@/matrix/hooks/useThemeSettings";
import { isMatrixStoreEmpty, syncMatrixNodes } from "@/matrix/services/nodeStore";
import type { PingOverviewBucket, PingOverviewItem } from "@/matrix/types/komari";
import { resolvePingSampleCounts } from "@/matrix/utils/pingMetrics";
import {
  HOMEPAGE_MULTI_PING_TASK_COUNT,
  hasHomepagePingTaskBinding,
  resolveHomepageMultiPingTaskIds,
} from "@/matrix/utils/pingTasks";
import type { ResolvedThemeSettings } from "@/matrix/utils/themeSettings";

/*
 * One latency source for the card and table views: the store, settings and selection rules the
 * matrix view uses, so every view shows the same numbers for a node.
 *
 * - Three-line mode with three tasks resolved for the node: its first line.
 * - Otherwise: the node's single-line binding.
 * - Neither: "not configured". Nothing is ever simulated.
 */

type LatencySettings = Pick<
  ResolvedThemeSettings,
  | "showLatency"
  | "homepagePingBindings"
  | "enableHomepageMultiPing"
  | "homepageMultiPingTaskIds"
  | "homepageMultiPingNodeTaskIds"
>;

export interface LatencySource {
  configured: boolean;
  multi: boolean;
  /** Task shown in three-line mode (line 1). */
  taskId: number | null;
}

const NOT_CONFIGURED: LatencySource = { configured: false, multi: false, taskId: null };

/** Mirrors the matrix card and the store's request selection (`resolveHomepagePingSelections`). */
export function resolveLatencySource(uuid: string, settings: LatencySettings): LatencySource {
  if (!uuid || !settings.showLatency) return NOT_CONFIGURED;
  if (settings.enableHomepageMultiPing) {
    const ids = resolveHomepageMultiPingTaskIds(
      uuid,
      settings.homepageMultiPingTaskIds,
      settings.homepageMultiPingNodeTaskIds,
    );
    if (ids.length === HOMEPAGE_MULTI_PING_TASK_COUNT) return { configured: true, multi: true, taskId: ids[0] };
  }
  return hasHomepagePingTaskBinding(uuid, settings.homepagePingBindings)
    ? { configured: true, multi: false, taskId: null }
    : NOT_CONFIGURED;
}

export interface NodeLatencySummary {
  /** Latency is shown at all (master switch). */
  enabled: boolean;
  /** A probe is assigned to this node. */
  configured: boolean;
  loading: boolean;
  error: boolean;
  /** Task name in three-line mode. */
  taskName: string | null;
  /** Latest latency (ms). */
  latest: number | null;
  /** Last hour's latency, weighted by successful samples (ms). */
  avgLatency: number | null;
  /** Last hour's packet loss (%). */
  loss: number | null;
  /** Time-ordered buckets covering the last hour. */
  buckets: PingOverviewBucket[];
}

const EMPTY_BUCKETS: PingOverviewBucket[] = [];

export function summarizeSamples(samples: PingOverviewItem["samples"], now: number): {
  avgLatency: number | null;
  loss: number | null;
} {
  let weighted = 0;
  let weight = 0;
  let total = 0;
  let lost = 0;
  // Display buckets may repeat a rollup point; only source samples carry unique counts.
  const windowStart = now - 60 * 60 * 1000;
  const seen = new Set<number>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.time) || sample.time < windowStart || sample.time > now) continue;
    if (seen.has(sample.time)) continue;
    seen.add(sample.time);
    const counts = resolvePingSampleCounts(sample);
    total += counts.total;
    lost += counts.lost;
    if (sample.value >= 0 && Number.isFinite(sample.value) && counts.valid > 0) {
      weighted += sample.value * counts.valid;
      weight += counts.valid;
    }
  }
  return {
    avgLatency: weight > 0 ? weighted / weight : null,
    loss: total > 0 ? (lost / total) * 100 : null,
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Latest latency for sorting (undefined = no value, sorts last). Reads the store directly. */
export function readNodeLatestLatency(uuid: string, settings: LatencySettings): number | undefined {
  const source = resolveLatencySource(uuid, settings);
  if (!source.configured) return undefined;
  const { single, lines } = readPingSnapshot(uuid);
  const item = source.multi ? lines.find((line) => line.taskId === source.taskId) : single;
  return finiteOrNull(item?.lastValue) ?? undefined;
}

export function useNodeLatency(uuid: string, bucketCount = 24): NodeLatencySummary {
  const settings = useThemeSettings();
  const source = useMemo(() => resolveLatencySource(uuid, settings), [uuid, settings]);
  const single = useNodePingOverview(uuid, source.configured && !source.multi);
  const lines = useNodePingOverviewLines(uuid, source.multi);
  const now = useMinuteClock(source.configured);

  const line = source.multi ? lines.find((entry) => entry.taskId === source.taskId) : undefined;
  const item: PingOverviewItem | null = source.multi ? line ?? null : source.configured ? single : null;

  const buckets = useMemo(
    () => (item ? buildPingBuckets(item, bucketCount, now) : EMPTY_BUCKETS),
    [item, bucketCount, now],
  );

  return useMemo<NodeLatencySummary>(() => {
    if (!source.configured) {
      return {
        enabled: settings.showLatency,
        configured: false,
        loading: false,
        error: false,
        taskName: null,
        latest: null,
        avgLatency: null,
        loss: null,
        buckets: EMPTY_BUCKETS,
      };
    }
    const stats = summarizeSamples(item?.samples ?? [], now);
    const loadState = item?.loadState ?? "pending";
    return {
      enabled: true,
      configured: true,
      loading: loadState === "pending",
      error: loadState === "error",
      taskName: line?.taskName ?? null,
      latest: finiteOrNull(item?.lastValue),
      avgLatency: stats.avgLatency,
      loss: stats.loss,
      buckets,
    };
  }, [buckets, item, line?.taskName, now, settings.showLatency, source.configured]);
}

/**
 * Keep the shared latency store fed while a card / table view is mounted: the matrix node store
 * (the poller's list of nodes) follows the app's node list, and one poller serves every view.
 */
export function useLatencyFeed(allNodes: readonly NodeWithStatus[]) {
  // Fill the store before the first row renders; later updates go through the layout effect.
  useState(() => {
    if (isMatrixStoreEmpty()) syncMatrixNodes(allNodes);
  });
  useMatrixNodeSync(allNodes);
  useHomepagePingOverview("large");
}
