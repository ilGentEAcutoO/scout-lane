import { describe, expect, it } from "vitest";
import { interviewPatchSchema, interviewSchema } from "@scout-lane/core";

describe("interview schemas", () => {
  it("books with a default length of 45 minutes", () => {
    const parsed = interviewSchema.parse({
      candidateId: "11111111-1111-4111-8111-111111111111",
      startsAt: "2026-08-22T10:00:00.000Z",
    });
    expect(parsed.minutes).toBe(45);
  });

  it("lets HR patch time, length, or interviewer", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(interviewPatchSchema.parse({ startsAt: "2026-08-23T04:00:00.000Z" }).startsAt).toBe(
      "2026-08-23T04:00:00.000Z",
    );
    expect(interviewPatchSchema.parse({ minutes: 60 }).minutes).toBe(60);
    expect(interviewPatchSchema.parse({ interviewerId: id }).interviewerId).toBe(id);
    expect(interviewPatchSchema.parse({ interviewerId: "" }).interviewerId).toBe("");
  });

  it("rejects an empty patch", () => {
    expect(() => interviewPatchSchema.parse({})).toThrow();
  });
});
