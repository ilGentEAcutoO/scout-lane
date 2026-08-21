import { describe, expect, it } from "vitest";
import { buildSourceLanes, laneHas, sourceLabel } from "../src/modules/scout/catalog";
import { CANDIDATE_SOURCES } from "../src/modules/scout/engine";
import {
  A_PUBLIC_HOSTS,
  C_PUBLIC_HOSTS,
  assertActorAllowed,
  hitsFromLinkedinSearch,
  hitsFromPublicSearch,
  linkedinPeopleQuery,
  linkedinProfileUrl,
  publicSearchQueries,
} from "../src/modules/scout/apify";

describe("apify actor allowlist", () => {
  it("allows the public Google search actor and HarvestAPI LinkedIn search", () => {
    expect(assertActorAllowed("apify/google-search-scraper")).toBe("apify~google-search-scraper");
    expect(assertActorAllowed("apify~google-search-scraper")).toBe("apify~google-search-scraper");
    expect(assertActorAllowed("harvestapi/linkedin-profile-search")).toBe("harvestapi~linkedin-profile-search");
  });

  it("rejects cookie-based LinkedIn, Facebook, and unknown actors", () => {
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
            {
              title: "somkiat · Kaggle",
              url: "https://www.kaggle.com/somkiat",
              description: "Bangkok notebooks",
            },
            {
              title: "Kaggle competitions",
              url: "https://www.kaggle.com/competitions/titanic",
              description: "contest",
            },
            {
              title: "Boom · Speaker Deck",
              url: "https://speakerdeck.com/webdevbyboom",
              description: "MCP talk Bangkok",
            },
          ],
        },
      ],
      "C",
    );
    expect(hits.map((hit) => hit.profileUrl)).toEqual([
      "https://github.com/dtinth",
      "https://devhub.in.th/en/developers/webdevbyboom/",
      "https://www.kaggle.com/somkiat",
      "https://speakerdeck.com/webdevbyboom",
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
    expect(q).toMatch(/site:kaggle\.com/);
    expect(q).toMatch(/site:speakerdeck\.com/);
    expect(q).toMatch(/site:codeberg\.org/);
    expect(q).not.toMatch(/site:linkedin/);
    expect(q).not.toMatch(/site:facebook/);
  });
});

describe("linkedin people query", () => {
  it("turns a JD / GitHub-style query into a HarvestAPI people phrase", () => {
    expect(linkedinPeopleQuery("การตลาด Brand Content location:Bangkok")).toBe("Content Marketing");
    expect(linkedinPeopleQuery("การตลาด Brand location:Bangkok")).toBe("Brand Manager");
    expect(linkedinPeopleQuery("Performance Marketing จ่ายสื่อ location:Thailand")).toBe("Performance Marketing");
    expect(linkedinPeopleQuery("Social Media Manager โซเชียล กรุงเทพ")).toBe("Social Media Manager");
    expect(linkedinPeopleQuery("หาทีมการตลาด กรุงเทพ")).toBe("Marketing Manager");
    expect(linkedinPeopleQuery("AI TypeScript location:Bangkok")).toBe("TypeScript");
    expect(linkedinPeopleQuery("Tech Lead MCP RAG location:Thailand")).toBe("Tech Lead");
  });

  it("builds /in/ URLs from publicIdentifier and http links", () => {
    expect(linkedinProfileUrl({ publicIdentifier: "nicha-brand" })).toBe("https://www.linkedin.com/in/nicha-brand");
    expect(linkedinProfileUrl({ linkedinUrl: "http://linkedin.com/in/jane" })).toBe("https://www.linkedin.com/in/jane");
    expect(linkedinProfileUrl({ url: "https://facebook.com/x" })).toBeNull();
  });

  it("keeps Short-mode rows that only have publicIdentifier and a current role", () => {
    const hits = hitsFromLinkedinSearch([
      {
        publicIdentifier: "nicha-brand",
        firstName: "Nicha",
        lastName: "Brand",
        currentPosition: { position: "Marketing Manager", companyName: "Grab" },
        location: { linkedinText: "Bangkok, Thailand" },
        openToWork: true,
      },
      { firstName: "Nope", url: "https://facebook.com/x" },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.profileUrl).toBe("https://www.linkedin.com/in/nicha-brand");
    expect(hits[0]?.headline).toMatch(/Marketing Manager at Grab/);
    expect(hits[0]?.headline).toMatch(/Open to Work/);
    expect(hits[0]?.location).toMatch(/Bangkok/);
  });

  it("keeps Thai or English names in Thailand and drops CJK / off-country cards", () => {
    const hits = hitsFromLinkedinSearch([
      {
        publicIdentifier: "nicha-brand",
        firstName: "Nicha",
        lastName: "Srisuk",
        location: { linkedinText: "Bangkok, Thailand", countryCode: "TH" },
      },
      {
        publicIdentifier: "liu-wei",
        fullName: "淑婷 刘",
        location: { linkedinText: "Bangkok, Thailand", countryCode: "TH" },
      },
      {
        publicIdentifier: "wei-shanghai",
        firstName: "Wei",
        lastName: "Zhang",
        location: { linkedinText: "Shanghai, China", countryCode: "CN" },
      },
      {
        publicIdentifier: "jane-th",
        firstName: "Jane",
        lastName: "Miller",
        location: { linkedinText: "Chiang Mai, Thailand", countryCode: "TH" },
      },
    ]);
    expect(hits.map((row) => row.displayName)).toEqual(["Nicha Srisuk", "Jane Miller"]);
  });
});

describe("apify source lane", () => {
  it("is a shortlist source and labelled as a vendor lane", () => {
    expect(CANDIDATE_SOURCES.has("apify_web")).toBe(true);
    expect(sourceLabel("apify_web")).toBe("ค้นสาธารณะ");
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
