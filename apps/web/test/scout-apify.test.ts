import { describe, expect, it } from "vitest";
import { buildSourceLanes, laneHas, sourceLabel } from "../src/modules/scout/catalog";
import { CANDIDATE_SOURCES } from "../src/modules/scout/engine";
import {
  A_PUBLIC_HOSTS,
  C_PUBLIC_HOSTS,
  assertActorAllowed,
  hitsFromPublicSearch,
  publicSearchQueries,
} from "../src/modules/scout/apify";

describe("apify actor allowlist", () => {
  it("allows only the public Google search actor", () => {
    expect(assertActorAllowed("apify/google-search-scraper")).toBe("apify~google-search-scraper");
    expect(assertActorAllowed("apify~google-search-scraper")).toBe("apify~google-search-scraper");
  });

  it("rejects walled-garden and unknown actors", () => {
    expect(() => assertActorAllowed("curious_coder/linkedin-profile-scraper")).toThrow(/actor_not_allowed/);
    expect(() => assertActorAllowed("apify/facebook-posts-scraper")).toThrow(/actor_not_allowed/);
    expect(() => assertActorAllowed("clockworks/tiktok-scraper")).toThrow(/actor_not_allowed/);
    expect(() => assertActorAllowed("someone/jobsdb-people")).toThrow(/actor_not_allowed/);
  });
});

describe("public search hits", () => {
  it("keeps public profile URLs and drops login walls", () => {
    const hits = hitsFromPublicSearch(
      [
        {
          organicResults: [
            {
              title: "dtinth (Thai) · GitHub",
              url: "https://github.com/dtinth",
              description: "Bangkok · RAG MCP TypeScript",
            },
            {
              title: "Secret profile",
              url: "https://www.linkedin.com/in/someone",
              description: "Tech Lead",
            },
            {
              title: "JobsDB listing",
              url: "https://th.jobsdb.com/job/123",
              description: "hiring",
            },
            {
              title: "microsoft · GitHub",
              url: "https://github.com/microsoft",
              description: "org",
            },
            {
              title: "Chatbordin on DevHub",
              url: "https://devhub.in.th/en/developers/webdevbyboom/",
              description: "Open to Work Thailand",
            },
          ],
        },
      ],
      "C",
    );
    expect(hits.map((hit) => hit.profileUrl)).toEqual([
      "https://github.com/dtinth",
      "https://devhub.in.th/en/developers/webdevbyboom/",
    ]);
    expect(hits.every((hit) => hit.source === "apify_web")).toBe(true);
    expect(hits[0]?.displayName).toMatch(/dtinth/i);
  });

  it("phase A adds extra public hosts without unlocking LinkedIn", () => {
    expect(C_PUBLIC_HOSTS.has("sessionize.com")).toBe(false);
    expect(A_PUBLIC_HOSTS.has("sessionize.com")).toBe(true);
    const wide = hitsFromPublicSearch(
      [
        {
          url: "https://sessionize.com/somkiat",
          title: "Somkiat · Sessionize",
          description: "Bangkok speaker MCP",
        },
        {
          url: "https://facebook.com/groups/thaidev",
          title: "group",
          description: "dev",
        },
      ],
      "A",
    );
    expect(wide).toHaveLength(1);
    expect(wide[0]?.profileUrl).toContain("sessionize.com");
  });

  it("builds site-restricted queries only", () => {
    const q = publicSearchQueries("Tech Lead MCP Bangkok", "C").join("\n");
    expect(q).toMatch(/site:github\.com/);
    expect(q).toMatch(/site:devhub\.in\.th/);
    expect(q).not.toMatch(/site:linkedin/);
    expect(q).not.toMatch(/site:facebook/);
  });
});

describe("apify source lane", () => {
  it("is a shortlist source and labelled as a vendor lane", () => {
    expect(CANDIDATE_SOURCES.has("apify_web")).toBe(true);
    expect(sourceLabel("apify_web")).toBe("ร้านค้นสาธารณะ");
  });

  it("stays blocked without a token and live when marked live", () => {
    const off = buildSourceLanes({
      adapters: [{ id: "apify_web", status: "needs_authorization" }],
    });
    expect(laneHas(off.lanes, "apify_web")).toBe("blocked");

    const on = buildSourceLanes({
      adapters: [{ id: "apify_web", status: "live" }],
    });
    expect(laneHas(on.lanes, "apify_web")).toBe("live");
  });
});
