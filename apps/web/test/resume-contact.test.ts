import { describe, expect, it } from "vitest";
import {
  extractResumeContact,
  mergeResumeContact,
  PLACEHOLDER_NAME,
  preferStoredContact,
} from "../src/resume-contact";
import { screenFieldsSchema } from "@scout-lane/core";

describe("resume contact", () => {
  it("pulls name email and phone from a typical header", () => {
    const got = extractResumeContact(`Somchai Jaidee
Tech Lead
somchai@example.com
081-234-5678

Experience
Built RAG systems.`);
    expect(got.name).toBe("Somchai Jaidee");
    expect(got.email).toBe("somchai@example.com");
    expect(got.phone).toMatch(/^081/);
    expect(got.missing).toEqual([]);
  });

  it("marks gaps when the file has no person header", () => {
    const got = extractResumeContact("Skills: TypeScript, RAG, MCP");
    expect(got.name).toBe(PLACEHOLDER_NAME);
    expect(got.missing).toContain("name");
    expect(got.missing).toContain("email");
  });

  it("lets the model fill a missing name without inventing email", () => {
    const merged = mergeResumeContact(extractResumeContact("Skills: Node"), {
      name: "Nicha Siri",
      email: "not-an-email",
    });
    expect(merged.name).toBe("Nicha Siri");
    expect(merged.email).toBe("");
    expect(merged.missing).toEqual(["email"]);
  });

  it("keeps a name HR typed in the gap modal over a later extract", () => {
    const extracted = extractResumeContact("Skills: TypeScript");
    const kept = preferStoredContact(
      { displayName: "สมชาย ใจดี", email: null, phone: "0811111111" },
      extracted,
    );
    expect(kept.name).toBe("สมชาย ใจดี");
    expect(kept.phone).toBe("0811111111");
    expect(kept.missing).toEqual(["email"]);
  });
});

describe("screen fields", () => {
  it("accepts a job plus empty name so HR can upload only a PDF", () => {
    const parsed = screenFieldsSchema.parse({
      jobId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.jobId).toBe("11111111-1111-4111-8111-111111111111");
  });
});
