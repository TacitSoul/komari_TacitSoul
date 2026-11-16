import { describe, expect, it } from "vitest";
import { resolveLatencySource, summarizeSamples } from "@/matrix/hooks/useNodeLatency";
import { buildPingBuckets } from "@/matrix/hooks/usePingOverview";
import type { PingOverviewItem } from "@/matrix/types/komari";

const base = {
  showLatency: true,
  homepagePingBindings: {},
  enableHomepageMultiPing: false,
  homepageMultiPingTaskIds: [] as number[],
  homepageMultiPingNodeTaskIds: {},
};

describe("shared latency source", () => {
  it("is not configured without a binding, and never when latency is switched off", () => {
    expect(resolveLatencySource("a", base).configured).toBe(false);
    const bound = { ...base, homepagePingBindings: { "7": ["a"] } };
    expect(resolveLatencySource("a", bound)).toEqual({ configured: true, multi: false, taskId: null });
    expect(resolveLatencySource("a", { ...bound, showLatency: false }).configured).toBe(false);
  });

  it("uses line 1 in three-line mode, with per-node overrides first", () => {
    const multi = { ...base, enableHomepageMultiPing: true, homepageMultiPingTaskIds: [3, 4, 5] };
    expect(resolveLatencySource("a", multi)).toEqual({ configured: true, multi: true, taskId: 3 });
    const override = { ...multi, homepageMultiPingNodeTaskIds: { a: [9, 8, 7] } };
    expect(resolveLatencySource("a", override).taskId).toBe(9);
  });

  it("falls back to the single binding when three-line mode is incomplete", () => {
    const partial = {
      ...base,
      enableHomepageMultiPing: true,
      homepageMultiPingTaskIds: [3, 4],
      homepagePingBindings: { "7": ["a"] },
    };
    expect(resolveLatencySource("a", partial)).toEqual({ configured: true, multi: false, taskId: null });
  });

  it("weights latency by successful samples and computes loss over all samples", () => {
    const stats = summarizeSamples([
      { time: 1, value: 10, count: 10, loss: 0 },
      { time: 2, value: 100, count: 2, loss: 50 },
      { time: 3, value: -1, count: 4 },
    ], 4);
    // (10*10 + 100*1) / 11
    expect(stats.avgLatency).toBeCloseTo(200 / 11);
    expect(stats.loss).toBeCloseTo((5 / 16) * 100);
    expect(summarizeSamples([], 4).avgLatency).toBeNull();
    expect(summarizeSamples([], 4).loss).toBeNull();
  });

  it("counts rollup samples once regardless of display bucket count or window phase", () => {
    const now = 7_200_000;
    const samples: PingOverviewItem["samples"] = [
      { time: now - 600_000, value: 10, count: 10, loss: 0 },
      { time: now - 300_000, value: 100, count: 10, loss: 50 },
    ];
    const item = { samples, metricIntervalMs: 240_000 };
    for (const phase of [0, 60_000, 120_000]) {
      for (const count of [12, 24, 60]) {
        const buckets = buildPingBuckets(item, count, now + phase);
        expect(buckets).toHaveLength(count);
        if (count === 60) expect(buckets.reduce((total, bucket) => total + bucket.total, 0)).toBeGreaterThan(20);
        expect(summarizeSamples(samples, now + phase)).toEqual({ avgLatency: 40, loss: 25 });
      }
    }
  });

  it("only includes source timestamps in the last-hour window, including both boundaries", () => {
    const now = 7_200_000;
    const samples = [
      { time: now - 3_600_001, value: 999, count: 100 },
      { time: now - 3_600_000, value: 10 },
      { time: now, value: 30 },
      { time: now + 1, value: -1, count: 100 },
      { time: NaN, value: 999 },
    ];
    expect(summarizeSamples(samples, now)).toEqual({ avgLatency: 20, loss: 0 });
    expect(summarizeSamples(samples.slice(0, 1), now)).toEqual({ avgLatency: null, loss: null });
  });

  it("deduplicates repeated timestamps without collapsing distinct samples of the same value", () => {
    const sample = { time: 1, value: 10, count: 4, loss: 25 };
    const samples = [sample, { ...sample }, { time: 2, value: 10 }, { time: 3, value: 100 }];
    const stats = summarizeSamples(samples, 3);
    expect(stats.avgLatency).toBe(28);
    expect(stats.loss).toBeCloseTo(100 / 6);
  });

  it("handles raw failures, zero latency, and all-lost rollups without inventing successes", () => {
    expect(summarizeSamples([{ time: 1, value: -1 }], 1)).toEqual({ avgLatency: null, loss: 100 });
    expect(summarizeSamples([{ time: 1, value: 50, count: 10, loss: 100 }], 1)).toEqual({ avgLatency: null, loss: 100 });
    expect(summarizeSamples([{ time: 1, value: 0 }, { time: 2, value: -1 }], 2)).toEqual({ avgLatency: 0, loss: 50 });
  });
});
