import { describe, expect, it } from "vitest";
import { jobGenerateSchema, jobListQuerySchema, jobPatchSchema, PROMPT_KEYS } from "@scout-lane/core";
import { jobSearchNeedle, jobTitleKey, mergeGeneratedJob } from "../src/modules/jobs";

describe("job draft schema", () => {
  it("keeps title and notes, drops extras", () => {
    const parsed = jobGenerateSchema.parse({
      title: "Tech Lead",
      notes: "ทำ RAG MCP internal tools ที่กรุงเทพ",
      cookie: "session=1",
    });
    expect(parsed).toEqual({
      title: "Tech Lead",
      notes: "ทำ RAG MCP internal tools ที่กรุงเทพ",
    });
    expect(JSON.stringify(parsed)).not.toMatch(/session=/);
  });

  it("accepts an existing job id to update", () => {
    const parsed = jobGenerateSchema.parse({
      title: "Tech Lead",
      notes: "ทำ automation workflow ให้ทีม HR",
      jobId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.jobId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("lets HR patch only the reviewed description", () => {
    const parsed = jobPatchSchema.parse({ description: "Full stack + RAG. Hybrid Bangkok." });
    expect(parsed).toEqual({ description: "Full stack + RAG. Hybrid Bangkok." });
  });

  it("includes the job draft prompt key", () => {
    expect(PROMPT_KEYS).toContain("prompt.job_draft");
  });

  it("live-search query stays short and strips like wildcards", () => {
    expect(jobListQuerySchema.parse({ q: "  tech lead  " })).toEqual({ q: "tech lead", page: 1, pageSize: 20 });
    expect(jobListQuerySchema.parse({})).toEqual({ q: "", page: 1, pageSize: 20 });
    expect(jobSearchNeedle("")).toBeNull();
    expect(jobSearchNeedle("  RAG%_MCP  ")).toBe("%RAGMCP%");
  });

  it("treats the same job title as one position", () => {
    expect(jobTitleKey("  Tech Lead / Senior Developer  ")).toBe("tech lead / senior developer");
    expect(jobTitleKey("Tech  Lead")).toBe(jobTitleKey("tech lead"));
  });

  it("fills an empty job description and keeps an existing one as a draft", () => {
    expect(mergeGeneratedJob("", "New JD text here")).toEqual({
      description: "New JD text here",
      applied: true,
      draft: "New JD text here",
    });
    expect(mergeGeneratedJob("Current JD stays", "Replacement")).toEqual({
      description: "Current JD stays",
      applied: false,
      draft: "Replacement",
    });
  });
});
