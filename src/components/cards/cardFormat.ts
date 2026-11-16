/**
 * Card formatting: usage thresholds, traffic bar maths and expiry classes. The table view
 * uses the same expiry rules so both views agree.
 */
import dayjs from 'dayjs';
import { formatSpeedParts } from '@/lib/utils';

/* ─────────────── resource usage ─────────────── */

export type UsageStatus = 'ok' | 'warn' | 'bad';

/** < 60 % success, < 80 % warning, else error. */
export function usageStatus(percentage: number): UsageStatus {
  if (!(percentage >= 0)) return 'ok';
  if (percentage < 60) return 'ok';
  if (percentage < 80) return 'warn';
  return 'bad';
}

export function percentOf(used: number, total: number): number {
  return total > 0 && Number.isFinite(used) ? Math.max(0, (used / total) * 100) : 0;
}

/* ─────────────── traffic ─────────────── */

export type TrafficLimitType = 'up' | 'down' | 'min' | 'max' | 'sum';

export function normalizeLimitType(value: string | null | undefined): TrafficLimitType {
  return value === 'up' || value === 'down' || value === 'min' || value === 'max' ? value : 'sum';
}

export function trafficUsed(up: number, down: number, type: TrafficLimitType): number {
  switch (type) {
    case 'up':
      return up;
    case 'down':
      return down;
    case 'min':
      return Math.min(up, down);
    case 'max':
      return Math.max(up, down);
    default:
      return up + down;
  }
}

export interface TrafficBarModel {
  /** `sum` shows upload and download as two segments; other types one segment. */
  dual: boolean;
  /** 0–100, share of the limit used (by the limit type). */
  totalPct: number;
  upPct: number;
  downPct: number;
  /** Which direction's colour the single segment uses. */
  singleColor: 'up' | 'down';
}

export function trafficBar(up: number, down: number, limit: number, type: TrafficLimitType): TrafficBarModel {
  const used = trafficUsed(up, down, type);
  if (!(limit > 0)) return { dual: type === 'sum', totalPct: 0, upPct: 0, downPct: 0, singleColor: 'up' };
  const totalPct = Math.min((used / limit) * 100, 100);
  // Over the limit in `sum` mode both segments shrink proportionally so they still fit.
  const scale = type === 'sum' && used > limit ? limit / used : 1;
  const upPct = Math.min((up / limit) * 100 * scale, 100);
  const downPct = Math.min((down / limit) * 100 * scale, 100);
  const singleColor: 'up' | 'down' =
    type === 'down'
      ? 'down'
      : type === 'min'
        ? up <= down
          ? 'up'
          : 'down'
        : type === 'max'
          ? up >= down
            ? 'up'
            : 'down'
          : 'up';
  return { dual: type === 'sum', totalPct, upPct, downPct, singleColor };
}

/* ─────────────── expiry ─────────────── */

export type ExpireStatus = 'none' | 'expired' | 'critical' | 'warning' | 'normal' | 'long_term';

const EXPIRE_CRITICAL_DAYS = 7;
const EXPIRE_WARNING_DAYS = 15;
const EXPIRE_LONG_TERM_DAYS = 36500;

/** Komari stores "no expiry" as year 0001; treat that and invalid dates as unset. */
export function hasExpiry(expiredAt: string | null | undefined): boolean {
  if (!expiredAt) return false;
  const date = dayjs(expiredAt);
  return date.isValid() && date.year() > 1;
}

/** Whole days until expiry, rounded up while in the future. */
export function daysUntil(expiredAt: string, now: number): number {
  const diff = dayjs(expiredAt).diff(dayjs(now), 'day', true);
  return diff >= 0 ? Math.ceil(diff) : Math.floor(diff);
}

export function expireStatus(expiredAt: string | null | undefined, now: number): ExpireStatus {
  if (!hasExpiry(expiredAt)) return 'none';
  const date = dayjs(expiredAt!);
  if (!date.isAfter(dayjs(now))) return 'expired';
  const days = daysUntil(expiredAt!, now);
  if (days <= EXPIRE_CRITICAL_DAYS) return 'critical';
  if (days <= EXPIRE_WARNING_DAYS) return 'warning';
  if (days > EXPIRE_LONG_TERM_DAYS) return 'long_term';
  return 'normal';
}

/** Colour role of an expiry status: expired / ≤7 d red, ≤15 d amber, later green, long-term muted. */
export function expireTone(status: ExpireStatus): 'bad' | 'warn' | 'ok' | 'muted' {
  if (status === 'expired' || status === 'critical') return 'bad';
  if (status === 'warning') return 'warn';
  if (status === 'normal') return 'ok';
  return 'muted';
}

/* ─────────────── compact rate ─────────────── */

/** Speed label of the cards (same rules as every other view, see formatSpeedParts). */
export function formatCompactRate(bytesPerSec: number | null | undefined): string {
  const { value, unit } = formatSpeedParts(bytesPerSec ?? 0);
  return `${value} ${unit}`;
}
