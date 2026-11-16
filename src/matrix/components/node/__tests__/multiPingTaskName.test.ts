import { describe, expect, it } from "vitest";
import { shortTaskName } from "@/matrix/components/node/MultiPingStatus";

describe("three-line task label", () => {
  it("drops a trailing protocol note in brackets", () => {
    expect(shortTaskName("江苏电信省级线路（TCP 80）")).toBe("江苏电信省级线路");
    expect(shortTaskName("Shanghai CT (ICMP)")).toBe("Shanghai CT");
    expect(shortTaskName("广州移动 (tcp:443)")).toBe("广州移动");
  });

  it("keeps names whose brackets are not a protocol note, or that are only a note", () => {
    expect(shortTaskName("香港（CN2）")).toBe("香港（CN2）");
    expect(shortTaskName("Tokyo (Equinix TY8)")).toBe("Tokyo (Equinix TY8)");
    expect(shortTaskName("(TCP 80)")).toBe("(TCP 80)");
  });
});
