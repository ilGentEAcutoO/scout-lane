import { describe, expect, it } from "vitest";
import { descriptionDelta, finishStreamedDraft, streamDeltaText } from "../src/llm/stream";

describe("streamDeltaText", () => {
  it("reads OpenAI-compat content deltas", () => {
    expect(streamDeltaText('data: {"choices":[{"delta":{"content":"Hello"}}]}')).toBe("Hello");
    expect(streamDeltaText("data: [DONE]")).toBe("");
    expect(streamDeltaText("event: message_start")).toBe("");
  });

  it("reads Anthropic text deltas", () => {
    expect(
      streamDeltaText('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}'),
    ).toBe("Hi");
  });
});

describe("descriptionDelta", () => {
  it("holds JSON until the description string starts", () => {
    expect(descriptionDelta("", '{"title":"Tech Lead"')).toBe("");
    expect(descriptionDelta('{"title":"Tech Lead"', '{"title":"Tech Lead","description":"H+')).toBe("H+");
  });

  it("unescapes JSON string chunks", () => {
    const prev = '{"description":"Line 1';
    const next = '{"description":"Line 1\\nLine 2';
    expect(descriptionDelta(prev, next)).toBe("\nLine 2");
  });

  it("streams plain text when the model skips JSON", () => {
    expect(descriptionDelta("", "วิเคราะห์ requirement")).toBe("วิเคราะห์ requirement");
    expect(descriptionDelta("วิเคราะห์ ", "วิเคราะห์ requirement")).toBe("requirement");
  });
});

describe("finishStreamedDraft", () => {
  it("prefers parsed JSON fields", () => {
    expect(
      finishStreamedDraft('{"title":"Tech Lead","description":"Full JD text here"}', "Full JD text here"),
    ).toEqual({ title: "Tech Lead", description: "Full JD text here" });
  });

  it("falls back to streamed plain text", () => {
    expect(finishStreamedDraft("plain job description body", "plain job description body")).toEqual({
      description: "plain job description body",
    });
  });
});
