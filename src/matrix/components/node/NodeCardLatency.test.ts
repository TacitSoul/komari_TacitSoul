import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { NodeCard } from "./NodeCard";

const state = vi.hoisted(() => ({ showLatency: true, multi: false }));
vi.mock("@/matrix/hooks/useThemeSettings", () => ({
  useThemeSettings: () => ({ showLatency: state.showLatency, isReady: true, showConnections: false }),
}));
vi.mock("@/matrix/hooks/usePreferences", () => ({
  usePreferences: () => ({ resolvedAppearance: "dark" }),
}));
vi.mock("@/matrix/hooks/useNodeCardModel", () => ({
  useNodeCardModel: () => ({
    node: {
      uuid: "a", name: "Node A", os: "Linux", region: "US", cpu_cores: 1,
      cpuPct: 0, ramPct: 0, diskPct: 0, load1: 0, ramUsed: 0, ramTotal: 0,
      diskUsed: 0, diskTotal: 0, trafficUp: 0, trafficDown: 0, netUp: 0, netDown: 0,
    },
    traffic: { fraction: 0, remainingLabel: "∞", detail: "0 B / ∞", typeLabel: "total" },
    trafficReset: null,
    trafficTrend: { up: [], down: [] },
    ping: { lastValue: null, loss: null },
    pingBuckets: [],
    homepagePingLines: state.multi ? [1, 2, 3].map((taskId) => ({
      taskId, taskName: `Probe ${taskId}`, client: "a", isAssigned: true,
      lastValue: 10, loss: 0, samples: [], max: 10, buckets: [],
    })) : [],
    compactFooterTags: [],
    subtitle: "",
    expire: { value: "—", unit: "" },
    expireColor: "gray",
    uptime: { value: "0", unit: "d" },
    renewalPrice: null,
    latencyColor: "green",
    lossColor: "green",
    loadFraction: 0,
    upRate: { value: "0", unit: "B/s" },
    downRate: { value: "0", unit: "B/s" },
    hasRealHomepagePingBinding: false,
    shouldRenderPingBars: false,
    pingLoading: false,
    pingError: false,
    isOnline: true,
    isOffline: false,
    osName: "Linux",
  }),
}));

afterEach(() => {
  state.showLatency = true;
  state.multi = false;
});

function renderCard() {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(NodeCard, { uuid: "a", showTodayTraffic: false }),
  ));
}

describe("matrix card latency visibility", () => {
  it("renders the unconfigured health section when latency is enabled", () => {
    const html = renderCard();
    expect(html).toContain("server-health-grid");
    expect(html.match(/server-health-placeholder/g)).toHaveLength(2);
  });

  it.each([false, true])("omits both health variants and their section wrapper when hidden (multi=%s)", (multi) => {
    state.multi = multi;
    state.showLatency = false;
    const html = renderCard();
    expect(html).not.toContain("server-health");
    expect(html).not.toContain("multi-ping");
    expect(html.match(/class="card-metric-section/g)).toHaveLength(3);
    expect(html).toContain("server-card-footer");
  });

  it("still renders three-line latency when enabled", () => {
    state.multi = true;
    const html = renderCard();
    expect(html).toContain("multi-ping-metric-row");
    expect(html).toContain("Probe 1");
    expect(html).not.toContain("server-health-grid");
  });
});
