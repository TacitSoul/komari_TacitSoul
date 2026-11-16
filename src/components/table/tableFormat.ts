/**
 * Tacit Soul's data: OS + arch label, traffic used / limit with the limit-type badge, usage tiers
 * and the expiry / billing cell.
 */
import { formatBytes } from '@/matrix/utils/format';
import { normalizeLimitType, trafficUsed, type TrafficLimitType } from '@/components/cards/cardFormat';

export const SEGMENTS = 10;
export const LATENCY_BLOCKS = SEGMENTS * 2;

/** "DEBIAN AMD64" — family name + architecture, upper case. */
export function osArchLabel(os: string | null | undefined, arch: string | null | undefined): string {
  const upper = (os ?? '').toUpperCase();
  const known = ['DEBIAN', 'UBUNTU', 'CENTOS', 'ALPINE', 'ROCKY', 'ORACLE', 'WINDOWS', 'MACOS'];
  let family = known.find((name) => upper.includes(name)) ?? '';
  // Match "REDHAT" too; agents report "Red Hat Enterprise Linux …" with a space.
  if (!family && (upper.includes('REDHAT') || upper.includes('RED HAT') || upper.includes('RHEL'))) family = 'RHEL';
  if (!family) family = (os ?? '').split(/[\s,._-]+/)[0]?.toUpperCase() || 'LINUX';
  let archKey = (arch ?? '').toUpperCase();
  if (archKey === 'AARCH64') archKey = 'ARM64';
  if (archKey === 'X86_64') archKey = 'AMD64';
  return archKey ? `${family} ${archKey}` : family;
}

/** Tiers: CPU warns above 40 %, alarms above 75 %; memory / disk at 50 % and 80 %. */
export type MetricTier = 'normal' | 'warn' | 'bad';

export function cpuTier(pct: number): MetricTier {
  return pct > 75 ? 'bad' : pct > 40 ? 'warn' : 'normal';
}

export function capacityTier(pct: number): MetricTier {
  return pct > 80 ? 'bad' : pct > 50 ? 'warn' : 'normal';
}

export function filledSegments(pct: number, segments = SEGMENTS): number {
  const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return Math.round((clamped / 100) * segments);
}

/** Short labels for the limit type: SUM / OUT / IN / MAX / MIN. */
export function limitTypeShort(type: TrafficLimitType): string {
  switch (type) {
    case 'up':
      return 'OUT';
    case 'down':
      return 'IN';
    case 'max':
      return 'MAX';
    case 'min':
      return 'MIN';
    default:
      return 'SUM';
  }
}

/** "2.44 / 1000 GB" when both sides share a unit, else "512 MB / 1.00 TB". */
export function compactPair(used: number, total: number): string {
  const a = formatBytes(used);
  const b = formatBytes(total);
  const unitA = a.split(' ')[1];
  const unitB = b.split(' ')[1];
  return unitA && unitA === unitB ? `${a.split(' ')[0]} / ${b}` : `${a} / ${b}`;
}

export interface TrafficCell {
  text: string;
  /** null = unlimited (∞ badge). */
  badge: string | null;
  type: TrafficLimitType;
  /** Used share of the limit, for sorting; used bytes when unlimited. */
  sortValue: number;
}

export function trafficCell(
  totalUp: number,
  totalDown: number,
  limit: number | null | undefined,
  limitType: string | null | undefined,
): TrafficCell {
  const type = normalizeLimitType(limitType);
  const used = trafficUsed(totalUp, totalDown, type);
  if (!limit || limit <= 0) {
    return { text: formatBytes(used), badge: null, type, sortValue: used };
  }
  return {
    text: compactPair(used, limit),
    badge: limitTypeShort(type),
    type,
    sortValue: used / limit,
  };
}
