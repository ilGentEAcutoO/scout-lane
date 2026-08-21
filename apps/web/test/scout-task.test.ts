import { describe, expect, it } from "vitest";
import { hashScoutKey, stepNext } from "../src/modules/scout/task";
import { RANK_CAP, SHORTLIST_MAX } from "../src/modules/scout/rank";

describe("scout background task", () => {
  it("hashes title+jd+modes so a new description is a new run", async () => {
    const a = await hashScoutKey("Tech Lead", "ทำ RAG MCP", { linkedin: "shop" });
    const b = await hashScoutKey("Tech Lead", "ทำ RAG MCP", { linkedin: "shop" });
    const c = await hashScoutKey("Tech Lead", "ทำ automation คนละ JD", { linkedin: "shop" });
    const d = await hashScoutKey("Other role", "ทำ RAG MCP", { linkedin: "shop" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the next pipeline step so the UI can show remaining work", () => {
    expect(stepNext("query")).toBe("ดึงโปรไฟล์จากแหล่งที่เปิด");
    expect(stepNext("fetch")).toBe("ตัดซ้ำและกรองคนที่จ้างได้");
    expect(stepNext("rank")).toBe("จัดอันดับผลค้นหา");
    expect(stepNext("save")).toBe("");
  });

  it("keeps a large unique shortlist instead of a handful", () => {
    expect(SHORTLIST_MAX).toBeGreaterThanOrEqual(100);
    expect(RANK_CAP).toBeGreaterThanOrEqual(100);
  });
});
