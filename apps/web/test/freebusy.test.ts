import { describe, expect, it } from "vitest";
import {
  parseCalendarMode,
  parseShareEmails,
  sanitizeBusy,
  tokenKeyFor,
} from "../src/modules/schedule/google";

describe("sanitizeBusy", () => {
  it("keeps only start and end", () => {
    const dirty = [
      {
        start: "2026-08-18T02:00:00Z",
        end: "2026-08-18T03:00:00Z",
        summary: "Dentist",
        description: "secret",
        attendees: [{ email: "x@y.com" }],
      },
    ];
    expect(sanitizeBusy(dirty)).toEqual([
      { start: "2026-08-18T02:00:00Z", end: "2026-08-18T03:00:00Z" },
    ]);
    expect(JSON.stringify(sanitizeBusy(dirty))).not.toContain("Dentist");
    expect(JSON.stringify(sanitizeBusy(dirty))).not.toContain("secret");
  });

  it("drops junk rows", () => {
    expect(sanitizeBusy(null)).toEqual([]);
    expect(sanitizeBusy([{ start: "", end: "x" }, "nope", { start: "a", end: "b" }])).toEqual([
      { start: "a", end: "b" },
    ]);
  });
});

describe("calendar settings", () => {
  it("defaults to share", () => {
    expect(parseCalendarMode(undefined)).toBe("share");
    expect(parseCalendarMode("weird")).toBe("share");
    expect(parseCalendarMode("personal")).toBe("personal");
    expect(parseCalendarMode("both")).toBe("both");
  });

  it("parses emails without keeping names", () => {
    expect(parseShareEmails("mint@hplus.com\njo@gmail.com, extra@x.com")).toEqual([
      "mint@hplus.com",
      "jo@gmail.com",
      "extra@x.com",
    ]);
  });

  it("splits team and personal token keys", () => {
    expect(tokenKeyFor("team")).toBe("google:calendar:refresh");
    expect(tokenKeyFor("me", "u1")).toBe("google:calendar:refresh:user:u1");
  });
});
