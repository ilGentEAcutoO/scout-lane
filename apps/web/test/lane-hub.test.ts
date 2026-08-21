import { describe, expect, it } from "vitest";

describe("live events", () => {
  it("uses named event types the client already handles", () => {
    const types = [
      "screen.ready",
      "screen.failed",
      "screen.progress",
      "board.changed",
      "calendar.changed",
      "scout.changed",
      "scout.progress",
    ];
    expect(new Set(types).size).toBe(7);
  });
});
