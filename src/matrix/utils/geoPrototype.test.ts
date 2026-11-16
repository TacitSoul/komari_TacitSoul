import { describe, expect, it } from "vitest";
import { getCountryCodeFromRegion, getDisplayRegionCode } from "./geo";

describe("region aliases ignore inherited properties", () => {
  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "returns the unknown region for %s without breaking sorting",
    (region) => {
      expect(getCountryCodeFromRegion(region)).toBeNull();
      expect(getDisplayRegionCode(region)).toBe("UN");
      expect(() => [getDisplayRegionCode(region), "US"].sort((a, b) => a.localeCompare(b))).not.toThrow();
    },
  );
});
