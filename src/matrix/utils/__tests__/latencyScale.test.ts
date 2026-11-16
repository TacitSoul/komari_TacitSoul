import { describe, expect, it } from "vitest";
import { formatLatency, formatLoss, latencyTone } from "@/matrix/utils/latencyScale";

describe("shared latency scale", () => {
  it("uses the configured steps", () => {
    expect(latencyTone(null)).toBe("empty");
    expect(latencyTone(0)).toBe("excellent");
    expect(latencyTone(60)).toBe("excellent");
    expect(latencyTone(61)).toBe("good");
    expect(latencyTone(100)).toBe("good");
    expect(latencyTone(160)).toBe("moderate");
    expect(latencyTone(200)).toBe("elevated");
    expect(latencyTone(201)).toBe("critical");
  });

  it("formats values compactly and never invents a number", () => {
    expect(formatLatency(null)).toBe("—");
    expect(formatLatency(7.25)).toBe("7.3 ms");
    expect(formatLatency(42.4)).toBe("42 ms");
    expect(formatLatency(162.6)).toBe("163 ms");
    expect(formatLoss(undefined)).toBe("—");
    expect(formatLoss(0)).toBe("0.0%");
    expect(formatLoss(9.52)).toBe("9.5%");
    expect(formatLoss(77.8)).toBe("78%");
  });
});
