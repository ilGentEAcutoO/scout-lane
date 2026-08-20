import { describe, expect, it } from "vitest";
import { can, jobSchema, LIMITS, parseBody, sourceModesSchema, ValidationError } from "@scout-lane/core";

describe("rbac", () => {
  it("blocks members from user and prompt writes", () => {
    expect(can("member", "users.write")).toBe(false);
    expect(can("member", "settings.write")).toBe(false);
    expect(can("member", "jobs.write")).toBe(true);
    expect(can("admin", "users.write")).toBe(true);
  });
});

describe("shared schemas", () => {
  it("rejects a title longer than LIMITS.jobTitleMax", () => {
    expect(() =>
      parseBody(jobSchema, {
        title: "x".repeat(LIMITS.jobTitleMax + 1),
        description: "long enough job description",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a job description shorter than LIMITS.jobDescMin", () => {
    expect(() => parseBody(jobSchema, { title: "Tech Lead", description: "short" })).toThrow(
      ValidationError,
    );
  });
});

describe("source modes schema", () => {
  it("strips actor names, cookies, and tokens from the client payload", () => {
    const parsed = sourceModesSchema.parse({
      modes: { linkedin: "shop" },
      actorId: "curious_coder/linkedin-profile-scraper",
      cookie: "li_at=secret",
      token: "apify_api_xxx",
    });
    expect(parsed).toEqual({ modes: { linkedin: "shop" } });
    expect(JSON.stringify(parsed)).not.toMatch(/cookie|actorId|apify_api/i);
  });
});

describe("candidate profile url", () => {
  it("rejects http profile urls", async () => {
    const { candidateCreateSchema } = await import("@scout-lane/core");
    expect(() =>
      parseBody(candidateCreateSchema, {
        displayName: "Pat",
        source: "github",
        profileUrl: "http://example.com/p",
      }),
    ).toThrow(ValidationError);
  });
});
