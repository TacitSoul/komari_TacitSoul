/** Missing totals are normal for partial telemetry; do not turn them into NaN or a real 0%. */
export function resourceUsage(used: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null;
  const percentage = (used / total) * 100;
  return Number.isFinite(percentage) ? percentage : null;
}

export function formatResourceUsage(value: number | null, digits: number): string {
  return value === null ? '—' : `${value.toFixed(digits)}%`;
}
