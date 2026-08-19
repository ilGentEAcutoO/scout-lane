import { describe, expect, it } from "vitest";
import { slotsOverlap } from "../src/do/overlap";

describe("slotsOverlap", () => {
  it("detects overlapping interviews", () => {
    expect(slotsOverlap(10, 20, 15, 25)).toBe(true);
    expect(slotsOverlap(10, 20, 20, 30)).toBe(false);
    expect(slotsOverlap(10, 20, 0, 10)).toBe(false);
    expect(slotsOverlap(10, 20, 11, 12)).toBe(true);
  });
});
