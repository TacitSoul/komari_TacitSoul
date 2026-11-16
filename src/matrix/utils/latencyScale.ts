/**
 * Shared latency / loss colour scale, used by every view.
 * Latency steps: ≤60 / ≤100 / ≤160 / ≤200 ms; loss ramps at 1 / 3 / 5 / 10 %.
 */
export { latencyHeatColor, lossHeatColor } from "@/matrix/utils/metricTone";

export type LatencyTone = "empty" | "excellent" | "good" | "moderate" | "elevated" | "critical";

export function latencyTone(ms: number | null | undefined): LatencyTone {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "empty";
  if (ms <= 60) return "excellent";
  if (ms <= 100) return "good";
  if (ms <= 160) return "moderate";
  if (ms <= 200) return "elevated";
  return "critical";
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  return ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(ms >= 10 ? 0 : 1)} ms`;
}

export function formatLoss(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct < 0) return "—";
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}
