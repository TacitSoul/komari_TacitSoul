/**
 * Node store for the matrix components.
 *
 * The store is fed from the base theme's node list
 * (`syncMatrixNodes`, called by `useMatrixNodeSync`), so there is exactly one polling loop.
 * It keeps snapshots per node — static info, live metrics and an 18-sample
 * traffic trend — and notifies per-node subscribers only when their slice changed.
 */
import type { NodeWithStatus } from "@/services/api";
import { NodeInfoSchema, type NodeInfo, type NodeMetrics, type TrafficTrendSample } from "@/matrix/types/komari";

type Listener = () => void;

/** Shape consumed by the group / region filter helpers. */
export interface HomeNodeSummary {
  uuid: string;
  group: string;
  region: string;
  hidden: boolean;
  weight: number;
  online: boolean | null;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

interface TrafficTrendSeries {
  buffer: TrafficTrendSample[];
  start: number;
  size: number;
  signature: string;
  snapshot: TrafficTrendSample[];
}

interface NodeTrafficTrend {
  up: TrafficTrendSeries;
  down: TrafficTrendSeries;
  snapshot: { up: TrafficTrendSample[]; down: TrafficTrendSample[] };
}

export const TRAFFIC_TREND_SAMPLE_COUNT = 18;

const EMPTY_TRAFFIC_TREND_SAMPLE: TrafficTrendSample = { value: 0, level: 0.25, opacity: 0.52 };
const EMPTY_TRAFFIC_TREND_SNAPSHOT = Array.from(
  { length: TRAFFIC_TREND_SAMPLE_COUNT },
  () => EMPTY_TRAFFIC_TREND_SAMPLE,
);
const EMPTY_TRAFFIC_TREND_SERIES: TrafficTrendSeries = {
  buffer: [],
  start: 0,
  size: 0,
  signature: "",
  snapshot: EMPTY_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT = {
  up: EMPTY_TRAFFIC_TREND_SNAPSHOT,
  down: EMPTY_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_TRAFFIC_TREND: NodeTrafficTrend = {
  up: EMPTY_TRAFFIC_TREND_SERIES,
  down: EMPTY_TRAFFIC_TREND_SERIES,
  snapshot: EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_UUIDS: string[] = [];
const EMPTY_META: NodeInfo[] = [];

/** Cumulative traffic follows the backend counter; 0 means "no sample this frame", not a reset. */
export function resolveTrafficTotal(previous: number, raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : previous;
}

function materializeTrafficTrendSnapshot(buffer: TrafficTrendSample[], start: number, size: number) {
  if (size <= 0) return EMPTY_TRAFFIC_TREND_SNAPSHOT;
  const snapshot = new Array<TrafficTrendSample>(TRAFFIC_TREND_SAMPLE_COUNT);
  const padding = TRAFFIC_TREND_SAMPLE_COUNT - size;
  for (let i = 0; i < padding; i++) snapshot[i] = EMPTY_TRAFFIC_TREND_SAMPLE;
  for (let i = 0; i < size; i++) {
    snapshot[padding + i] = buffer[(start + i) % TRAFFIC_TREND_SAMPLE_COUNT]!;
  }
  return snapshot;
}

function updateTrafficTrendSeries(
  prevSeries: TrafficTrendSeries,
  value: number,
  updatedAt: number,
  online: boolean | null,
) {
  if (online === false) {
    if (!prevSeries.signature && prevSeries.size === 0) return { series: prevSeries, changed: false };
    return { series: EMPTY_TRAFFIC_TREND_SERIES, changed: true };
  }

  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const signature = `${updatedAt || 0}:${safeValue}`;
  if (signature === prevSeries.signature) return { series: prevSeries, changed: false };

  let visibleMax = safeValue > 0 ? safeValue : 1;
  for (let i = 0; i < prevSeries.size; i++) {
    const sample = prevSeries.buffer[(prevSeries.start + i) % TRAFFIC_TREND_SAMPLE_COUNT];
    if (sample && sample.value > visibleMax) visibleMax = sample.value;
  }

  const level = safeValue > 0 ? Math.max(0.2, Math.min(1, safeValue / visibleMax)) : 0.25;
  const nextSample: TrafficTrendSample = {
    value: safeValue,
    level,
    opacity: safeValue > 0 ? 0.4 + level * 0.48 : 0.52,
  };

  const full = prevSeries.size >= TRAFFIC_TREND_SAMPLE_COUNT;
  const buffer = new Array<TrafficTrendSample>(TRAFFIC_TREND_SAMPLE_COUNT);
  const nextSize = full ? TRAFFIC_TREND_SAMPLE_COUNT : prevSeries.size + 1;
  const nextStart = full ? (prevSeries.start + 1) % TRAFFIC_TREND_SAMPLE_COUNT : prevSeries.start;
  const insertIndex = full
    ? prevSeries.start
    : (prevSeries.start + prevSeries.size) % TRAFFIC_TREND_SAMPLE_COUNT;

  for (let i = 0; i < prevSeries.size; i++) {
    const index = (prevSeries.start + i) % TRAFFIC_TREND_SAMPLE_COUNT;
    buffer[index] = prevSeries.buffer[index]!;
  }
  buffer[insertIndex] = nextSample;

  return {
    series: {
      buffer,
      start: nextStart,
      size: nextSize,
      signature,
      snapshot: materializeTrafficTrendSnapshot(buffer, nextStart, nextSize),
    },
    changed: true,
  };
}

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === "number") return value > 1_000_000_000_000 ? value : value * 1000;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Static node info (zod-normalised). */
function toNodeInfo(node: NodeWithStatus): NodeInfo {
  return NodeInfoSchema.parse({
    uuid: node.uuid,
    name: node.name,
    group: node.group,
    region: node.region,
    hidden: node.hidden,
    cpu_name: node.cpu_name,
    cpu_cores: node.cpu_cores,
    arch: node.arch,
    virtualization: node.virtualization,
    os: node.os,
    kernel_version: node.kernel_version,
    gpu_name: node.gpu_name,
    mem_total: node.mem_total,
    swap_total: node.swap_total,
    disk_total: node.disk_total,
    weight: node.weight,
    price: node.price,
    billing_cycle: node.billing_cycle,
    auto_renewal: node.auto_renewal,
    currency: node.currency,
    expired_at: node.expired_at,
    tags: node.tags,
    public_remark: node.public_remark,
    traffic_limit: node.traffic_limit,
    traffic_limit_type: node.traffic_limit_type,
    ipv4: node.ipv4,
    ipv6: node.ipv6,
    created_at: node.created_at,
    updated_at: node.updated_at,
  }) as NodeInfo;
}

function metaSignature(node: NodeWithStatus): string {
  // `updated_at` is a heartbeat the cards never show; leaving it out keeps the info stable.
  return [
    node.name, node.group, node.region, node.hidden, node.cpu_name, node.cpu_cores, node.arch,
    node.virtualization, node.os, node.kernel_version, node.gpu_name, node.mem_total, node.swap_total,
    node.disk_total, node.weight, node.price, node.billing_cycle, node.auto_renewal, node.currency,
    node.expired_at, node.tags, node.public_remark, node.traffic_limit, node.traffic_limit_type,
    node.ipv4, node.ipv6, node.created_at,
  ].join("\u0001");
}

/**
 * Live metrics. While a node is offline the last known figures stay (the card greys them out),
 * but rates and the trend are cleared.
 */
function toMetrics(node: NodeWithStatus, info: NodeInfo, previous: NodeMetrics | undefined): NodeMetrics {
  const online = node.status === "online";
  const stats = online ? node.stats : node.lastStats;
  if (!stats) {
    return {
      online,
      cpuPct: 0,
      ramUsed: 0,
      ramTotal: info.mem_total,
      ramPct: 0,
      swapUsed: 0,
      swapTotal: info.swap_total,
      diskUsed: 0,
      diskTotal: info.disk_total,
      diskPct: 0,
      netUp: 0,
      netDown: 0,
      trafficUp: previous?.trafficUp ?? 0,
      trafficDown: previous?.trafficDown ?? 0,
      uptime: 0,
      load1: 0,
      load5: 0,
      load15: 0,
      process: 0,
      connectionsTcp: 0,
      connectionsUdp: 0,
      updatedAt: 0,
    };
  }

  const ramTotal = stats.ram.total || info.mem_total;
  const swapTotal = stats.swap.total || info.swap_total;
  const diskTotal = stats.disk.total || info.disk_total;
  return {
    online,
    cpuPct: stats.cpu.usage,
    ramUsed: stats.ram.used,
    ramTotal,
    ramPct: ramTotal > 0 ? (stats.ram.used / ramTotal) * 100 : 0,
    swapUsed: stats.swap.used,
    swapTotal,
    diskUsed: stats.disk.used,
    diskTotal,
    diskPct: diskTotal > 0 ? (stats.disk.used / diskTotal) * 100 : 0,
    netUp: online ? stats.network.up : 0,
    netDown: online ? stats.network.down : 0,
    trafficUp: resolveTrafficTotal(previous?.trafficUp ?? 0, stats.network.totalUp),
    trafficDown: resolveTrafficTotal(previous?.trafficDown ?? 0, stats.network.totalDown),
    uptime: stats.uptime,
    load1: stats.load.load1,
    load5: stats.load.load5,
    load15: stats.load.load15,
    process: stats.process,
    connectionsTcp: stats.connections.tcp,
    connectionsUdp: stats.connections.udp,
    updatedAt: toTimestamp(stats.updated_at),
  };
}

interface Entry {
  source: NodeWithStatus;
  metaSig: string;
  info: NodeInfo;
  metrics: NodeMetrics;
  trend: NodeTrafficTrend;
}

let entries = new Map<string, Entry>();
let order: string[] = EMPTY_UUIDS;
let visibleOrder: string[] = EMPTY_UUIDS;
let allMeta: NodeInfo[] = EMPTY_META;
let summaries: HomeNodeSummary[] = [];
let summariesDirty = false;

const listListeners = new Set<Listener>();
const summaryListeners = new Set<Listener>();
const metaListeners = new Map<string, Set<Listener>>();
const metricsListeners = new Map<string, Set<Listener>>();
const trendListeners = new Map<string, Set<Listener>>();

function sameOrder(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function emit(listeners: Iterable<Listener> | undefined) {
  if (!listeners) return;
  for (const listener of [...listeners]) listener();
}

/** Push the base theme's node list into the store. Cheap when nothing changed. */
export function syncMatrixNodes(nodes: readonly NodeWithStatus[]) {
  const next = new Map<string, Entry>();
  const touchedMeta: string[] = [];
  const touchedMetrics: string[] = [];
  const touchedTrend: string[] = [];
  let summaryChanged = false;

  for (const node of nodes) {
    const previous = entries.get(node.uuid);
    if (previous && previous.source === node) {
      next.set(node.uuid, previous);
      continue;
    }

    const metaSig = metaSignature(node);
    const info = previous && previous.metaSig === metaSig ? previous.info : toNodeInfo(node);
    if (info !== previous?.info) {
      touchedMeta.push(node.uuid);
      summaryChanged = true;
    }

    const metrics = toMetrics(node, info, previous?.metrics);
    const prevTrend = previous?.trend ?? EMPTY_TRAFFIC_TREND;
    const up = updateTrafficTrendSeries(prevTrend.up, metrics.netUp, metrics.updatedAt, metrics.online);
    const down = updateTrafficTrendSeries(prevTrend.down, metrics.netDown, metrics.updatedAt, metrics.online);
    let trend = prevTrend;
    if (up.changed || down.changed) {
      trend = {
        up: up.series,
        down: down.series,
        snapshot: { up: up.series.snapshot, down: down.series.snapshot },
      };
      touchedTrend.push(node.uuid);
    }

    touchedMetrics.push(node.uuid);
    if (
      !previous ||
      previous.metrics.online !== metrics.online ||
      previous.metrics.netUp !== metrics.netUp ||
      previous.metrics.netDown !== metrics.netDown ||
      previous.metrics.trafficUp !== metrics.trafficUp ||
      previous.metrics.trafficDown !== metrics.trafficDown
    ) {
      summaryChanged = true;
    }
    next.set(node.uuid, { source: node, metaSig, info, metrics, trend });
  }

  const removed = [...entries.keys()].filter((uuid) => !next.has(uuid));
  const nextOrder = nodes.map((node) => node.uuid);
  const orderChanged = !sameOrder(order, nextOrder);
  const listChanged = orderChanged || touchedMeta.length > 0 || removed.length > 0;

  entries = next;
  if (orderChanged) order = nextOrder.length > 0 ? nextOrder : EMPTY_UUIDS;
  if (listChanged) {
    const nextVisible = order.filter((uuid) => entries.get(uuid)?.info.hidden !== true);
    if (!sameOrder(visibleOrder, nextVisible)) visibleOrder = nextVisible.length > 0 ? nextVisible : EMPTY_UUIDS;
    allMeta = order.length > 0 ? order.map((uuid) => entries.get(uuid)!.info) : EMPTY_META;
  }
  if (summaryChanged || listChanged) summariesDirty = true;

  for (const uuid of touchedMeta) emit(metaListeners.get(uuid));
  for (const uuid of touchedMetrics) emit(metricsListeners.get(uuid));
  for (const uuid of touchedTrend) emit(trendListeners.get(uuid));
  for (const uuid of removed) {
    emit(metaListeners.get(uuid));
    emit(metricsListeners.get(uuid));
    emit(trendListeners.get(uuid));
  }
  if (listChanged) emit(listListeners);
  if (summaryChanged || listChanged) emit(summaryListeners);
}

function subscribeByKey(map: Map<string, Set<Listener>>, key: string, listener: Listener) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = map.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) map.delete(key);
  };
}

function subscribeTo(set: Set<Listener>, listener: Listener) {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export const subscribeToNodeMeta = (uuid: string, listener: Listener) => subscribeByKey(metaListeners, uuid, listener);
export const subscribeToNodeMetrics = (uuid: string, listener: Listener) => subscribeByKey(metricsListeners, uuid, listener);
export const subscribeToNodeTrafficTrend = (uuid: string, listener: Listener) => subscribeByKey(trendListeners, uuid, listener);
export const subscribeNodeList = (listener: Listener) => subscribeTo(listListeners, listener);
export const subscribeHomeNodeSummaries = (listener: Listener) => subscribeTo(summaryListeners, listener);

export const getNodeMetaSnapshot = (uuid: string): NodeInfo | undefined => entries.get(uuid)?.info;
export const getNodeMetricsSnapshot = (uuid: string): NodeMetrics | undefined => entries.get(uuid)?.metrics;
export const getNodeTrafficTrendSnapshot = (uuid: string) =>
  entries.get(uuid)?.trend.snapshot ?? EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT;
export const getAllNodeMetaSnapshot = (): NodeInfo[] => allMeta;

/** UUIDs in display order; guests never receive hidden nodes, admins may opt in. */
export function getVisibleNodeUuidsSnapshot(includeHidden = false): string[] {
  return includeHidden ? order : visibleOrder;
}

export function getHomeNodeSummariesSnapshot(): HomeNodeSummary[] {
  if (!summariesDirty) return summaries;
  summariesDirty = false;
  summaries = order.map((uuid) => {
    const { info, metrics } = entries.get(uuid)!;
    return {
      uuid,
      group: info.group,
      region: info.region,
      hidden: info.hidden,
      weight: info.weight,
      online: metrics.online,
      trafficUp: metrics.trafficUp,
      trafficDown: metrics.trafficDown,
      netUp: metrics.netUp,
      netDown: metrics.netDown,
    };
  });
  return summaries;
}

export function isMatrixStoreEmpty() {
  return entries.size === 0;
}

/** Test helper. */
export function resetMatrixNodeStore() {
  entries = new Map();
  order = EMPTY_UUIDS;
  visibleOrder = EMPTY_UUIDS;
  allMeta = EMPTY_META;
  summaries = [];
  summariesDirty = false;
}
