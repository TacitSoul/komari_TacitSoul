/** Availability is measured in milliseconds, independently of display slots. */
export type SlotStatus = 'online' | 'offline' | 'partial' | 'unknown';

export interface UptimeSlot {
  /** Slot start timestamp (ms) */
  start: number;
  /** Slot end timestamp (ms) */
  end: number;
  status: SlotStatus;
  onlineMs: number;
  offlineMs: number;
}

export interface UptimeResult {
  /** Per-slot breakdown */
  slots: UptimeSlot[];
  /** 0-100 uptime percentage (based on online / (online+offline)) */
  uptimePercent: number | null;
  /** Slots with no downtime */
  onlineSlots: number;
  /** Slots with any downtime, including partial slots */
  offlineSlots: number;
  /** Total slots analysed (excludes unknown) */
  totalSlots: number;
  offlineMs: number;
  lastIncident: number | null;
}

export interface UptimeMeasurement {
  result: UptimeResult | null;
  failed: boolean;
}

export interface LoadRecord {
  time: string;
  [key: string]: unknown;
}

/**
 * How many hours each display slot covers, keyed by the total display
 * range in hours.  E.g. for 720 h (30 days) each slot = 24 h so we
 * get 30 bars; for 24 h each slot = 1 h → 24 bars, etc.
 */
function slotHoursForRange(rangeHours: number): number {
  if (rangeHours <= 24) return 1;       // 24 slots
  if (rangeHours <= 168) return 6;      // 28 slots for 7d
  return 24;                            // 30 slots for 30d
}

export function observableStart(createdAt: string | undefined, retentionHours: number, now: number): number {
  const created = Date.parse(createdAt ?? '');
  return Math.max(Number.isFinite(created) ? created : -Infinity, now - retentionHours * 3600_000);
}

/** Align the grid inside the requested history window, clipping the current slot to now. */
export function computeUptime(
  records: LoadRecord[],
  rangeHours: number,
  observedFrom: number = -Infinity,
  now: number = Date.now(),
): UptimeResult {
  const rangeMs = rangeHours * 3600_000;
  const slotMs = slotHoursForRange(rangeHours) * 3600_000;
  const rangeEnd = Math.ceil(now / slotMs) * slotMs;
  const rangeStart = rangeEnd - rangeMs;
  const slotCount = Math.ceil(rangeMs / slotMs);
  const times = [...new Set(records.map(r => Date.parse(r.time)))]
    .filter(t => Number.isFinite(t) && t <= now)
    .sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const fallback = rangeHours <= 24 ? 300_000 : rangeHours <= 168 ? 3600_000 : 86400_000;
  const interval = gaps.length === 0 ? fallback : gaps.length % 2
    ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
  const coverage = times.map((start, i) => {
    const next = times[i + 1];
    // Small bucket jitter is not an outage; a real gap only gets one bucket of coverage.
    return { start, end: next !== undefined && next - start <= interval * 1.5 ? next : start + interval };
  });
  const newest = times.at(-1);
  const tailStart = newest === undefined ? Infinity : newest + interval;
  const tailEnd = newest === undefined ? Infinity : newest + interval * 1.5;
  const slots: UptimeSlot[] = [];
  let onlineMs = 0;
  let offlineMs = 0;
  let onlineSlots = 0;
  let offlineSlots = 0;
  let lastIncident: number | null = null;
  let cursor = 0;
  for (let i = 0; i < slotCount; i++) {
    const start = rangeStart + i * slotMs;
    const end = Math.min(start + slotMs, now);
    const observedStart = Math.min(end, Math.max(start, observedFrom));
    const unknownMs = Math.max(0, Math.min(end, tailEnd) - Math.max(observedStart, tailStart));
    let coveredMs = 0;
    let coveredUntil = observedStart;
    while (cursor < coverage.length && coverage[cursor].end <= observedStart) cursor++;
    for (let j = cursor; j < coverage.length && coverage[j].start < end; j++) {
      const from = Math.max(observedStart, coverage[j].start, coveredUntil);
      const to = Math.min(end, coverage[j].end);
      if (to <= from) continue;
      if (from > coveredUntil) lastIncident = from;
      coveredMs += to - from;
      coveredUntil = to;
    }
    const downMs = Math.max(0, end - observedStart - unknownMs - coveredMs);
    if (downMs > 0 && coveredUntil < end) {
      if (end > Math.max(coveredUntil, tailEnd)) lastIncident = end;
      else if (Math.min(end, tailStart) > coveredUntil) lastIncident = Math.min(end, tailStart);
    }
    const measuredMs = coveredMs + downMs;
    const status: SlotStatus = measuredMs === 0 ? 'unknown' : downMs === 0 ? 'online'
      : downMs > measuredMs / 2 ? 'offline' : 'partial';
    slots.push({ start, end, status, onlineMs: coveredMs, offlineMs: downMs });
    onlineMs += coveredMs;
    offlineMs += downMs;
    if (status === 'online') onlineSlots++;
    if (downMs > 0) offlineSlots++;
  }
  const measuredMs = onlineMs + offlineMs;
  return {
    slots,
    uptimePercent: measuredMs > 0 ? onlineMs / measuredMs * 100 : null,
    onlineSlots,
    offlineSlots,
    totalSlots: onlineSlots + offlineSlots,
    offlineMs,
    lastIncident,
  };
}

/** Ignore failed/deleted/unobservable nodes, and merge cells by timestamp rather than index. */
export function summarizeUptime(
  uuids: string[],
  measurements: Map<string, UptimeMeasurement>,
  sloThreshold: number,
) {
  let sum = 0;
  let measured = 0;
  let loaded = 0;
  let failed = 0;
  let atTarget = 0;
  let offlineMs = 0;
  let lastIncident: number | null = null;
  const fleet = new Map<number, { start: number; down: number; total: number; partial: boolean }>();
  for (const uuid of uuids) {
    const measurement = measurements.get(uuid);
    if (!measurement) continue;
    loaded++;
    if (measurement.failed) {
      failed++;
      continue;
    }
    const r = measurement.result;
    if (!r) continue;
    if (r.uptimePercent !== null) {
      sum += r.uptimePercent;
      measured++;
      if (r.uptimePercent >= sloThreshold) atTarget++;
    }
    offlineMs += r.offlineMs;
    if (r.lastIncident !== null) lastIncident = Math.max(lastIncident ?? -Infinity, r.lastIncident);
    for (const slot of r.slots) {
      let cell = fleet.get(slot.start);
      if (!cell) {
        cell = { start: slot.start, down: 0, total: 0, partial: false };
        fleet.set(slot.start, cell);
      }
      if (slot.status === 'unknown') continue;
      cell.total++;
      if (slot.offlineMs > 0) cell.down++;
      if (slot.status === 'partial') cell.partial = true;
    }
  }
  return {
    avg: measured > 0 ? sum / measured : null,
    measured, loaded, failed, atTarget,
    downtimeHours: offlineMs / 3600_000,
    lastIncident,
    fleet: [...fleet.values()].sort((a, b) => a.start - b.start),
  };
}

/** Seed the summary before mount effects, recomputing cached records on the shared grid. */
export function hydrateUptimeMeasurements(
  nodes: Array<{ uuid: string; created_at?: string }>,
  histories: ReadonlyMap<string, { records: LoadRecord[]; failed: boolean }>,
  rangeHours: number,
  retentionHours: number,
  now: number,
): Map<string, UptimeMeasurement> {
  const measurements = new Map<string, UptimeMeasurement>();
  for (const node of nodes) {
    const history = histories.get(node.uuid);
    if (!history) continue;
    measurements.set(node.uuid, {
      result: computeUptime(history.records, rangeHours, observableStart(node.created_at, retentionHours, now), now),
      failed: history.failed,
    });
  }
  return measurements;
}

export function sortUptimeNodes<T extends { uuid: string; weight?: number }>(nodes: T[]): T[] {
  // The API layer has already restored the backend list's tie order.
  // Keep that order stable rather than replacing it with a UUID tie-break.
  return [...nodes].sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
}

export function needsUptimeRefresh(fetchedAt: number | undefined, failed: boolean, now: number, interval: number): boolean {
  return failed || fetchedAt === undefined || now - fetchedAt >= interval;
}

/** Both queued and completed requests must still belong to the active cache generation. */
export function isCurrentUptimeRequest<T>(capturedCache: T, activeCache: T, cancelled: boolean): boolean {
  return !cancelled && capturedCache === activeCache;
}

/* ══════════════════════════════════════════════════════════════
   Incremental merge utilities
   ══════════════════════════════════════════════════════════════ */

/**
 * Merge old and new records, deduplicate by timestamp, and prune records
 * older than the sliding window.
 *
 * @param oldRecords  Previously cached records
 * @param newRecords  Freshly fetched records (incremental delta)
 * @param rangeHours  Current time range — records older than this are dropped
 * @returns Merged, deduplicated, pruned records
 */
export function mergeRecords(
  oldRecords: LoadRecord[],
  newRecords: LoadRecord[],
  rangeHours: number,
): LoadRecord[] {
  const cutoff = Date.now() - rangeHours * 3600_000;

  // Deduplicate by timestamp string
  const seen = new Set<string>();
  const merged: LoadRecord[] = [];

  // Process new records first (they take priority)
  for (const rec of newRecords) {
    if (!seen.has(rec.time)) {
      seen.add(rec.time);
      if (new Date(rec.time).getTime() >= cutoff) {
        merged.push(rec);
      }
    }
  }

  // Then old records
  for (const rec of oldRecords) {
    if (!seen.has(rec.time)) {
      seen.add(rec.time);
      if (new Date(rec.time).getTime() >= cutoff) {
        merged.push(rec);
      }
    }
  }

  return merged;
}

/**
 * Human-friendly label for a time range.
 */
export function rangeLabel(hours: number): string {
  if (hours <= 24) return '24h';
  if (hours <= 168) return '7d';
  if (hours <= 720) return '30d';
  if (hours <= 1440) return '60d';
  return `${Math.round(hours / 24)}d`;
}

/** All candidate ranges we might show */
const ALL_RANGES = [
  { hours: 24, label: '24H' },
  { hours: 168, label: '7D' },
  { hours: 720, label: '30D' },
  { hours: 1440, label: '60D' },
];

/**
 * Build uptime range options dynamically based on the backend's
 * `record_preserve_time` (hours).  Only includes ranges ≤ maxHours.
 * Falls back to the default 3 ranges if maxHours is not provided.
 */
export function buildUptimeRanges(maxHours?: number): Array<{ hours: number; label: string }> {
  const limit = maxHours && maxHours > 0 ? maxHours : 720;
  const filtered = ALL_RANGES.filter(r => r.hours <= limit);
  return filtered.length > 0 ? filtered : [ALL_RANGES[0]];
}

/** Default ranges (backward-compatible) */
export const UPTIME_RANGES = buildUptimeRanges();
