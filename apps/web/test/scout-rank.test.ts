import { describe, expect, it } from "vitest";
import { fallbackQuery, firstPersonalUrl, isPersonalSite, looksCjkName, looksLikeMarketing, parseSeeking, thaiSignal, wantsThai } from "../src/modules/scout/engine";
import {
  classifyHit,
  hasPublicLink,
  heuristicScore,
  hireableShortlist,
  isJobCandidate,
  hitThai,
  overlayModelScores,
  peopleForModel,
  scoreLocally,
} from "../src/modules/scout/rank";
import type { CandidateHit } from "../src/modules/scout/types";

function hit(partial: Partial<CandidateHit> & Pick<CandidateHit, "displayName" | "source">): CandidateHit {
  return {
    externalId: partial.externalId ?? partial.displayName,
    headline: partial.headline ?? "",
    profileUrl: partial.profileUrl ?? `https://example.com/${partial.displayName}`,
    location: partial.location ?? null,
    ...partial,
  };
}

describe("scout rank", () => {
  it("drops people without an https profile link", () => {
    const noLink = hit({
      displayName: "no-url",
      source: "github",
      profileUrl: "",
      headline: "TypeScript React Bangkok open to work",
      location: "Bangkok",
    });
    expect(hasPublicLink(noLink)).toBe(false);
    expect(isJobCandidate(noLink, "Tech Lead Bangkok TypeScript", "any")).toBe(false);
  });

  it("zeros organizations and packages", () => {
    expect(classifyHit(hit({ displayName: "microsoft", source: "github_langchain" }))).toBe("org");
    expect(classifyHit(hit({ displayName: "php-mcp", source: "packagist", headline: "php-mcp/server" }))).toBe("package");
    expect(
      classifyHit(
        hit({
          displayName: "ncz-os",
          source: "gitlab_projects",
          profileUrl: "https://gitlab.com/groups/ncz-os",
        }),
      ),
    ).toBe("org");
    expect(heuristicScore(hit({ displayName: "microsoft", source: "github_langchain" })).fitScore).toBe(0);
  });

  it("sends only people to the model and keeps Bangkok first", () => {
    const rows = [
      hit({ displayName: "microsoft", source: "github_langchain", headline: "org" }),
      hit({ displayName: "dtinth", source: "github_bkk", location: "Bangkok", headline: "TypeScript" }),
      hit({ displayName: "pkg", source: "npm", headline: "left-pad" }),
    ];
    const people = peopleForModel(rows);
    expect(people.map((row) => row.displayName)).toEqual(["dtinth"]);
  });

  it("lets the model overlay scores but never leaves a blank", () => {
    const local = scoreLocally([
      hit({ displayName: "dtinth", source: "github_bkk", location: "Bangkok", headline: "TypeScript automation" }),
      hit({ displayName: "microsoft", source: "github_langchain" }),
    ]);
    const merged = overlayModelScores(local, [
      { externalId: "dtinth", fitScore: 9, reason: "TypeScript กรุงเทพ" },
    ]);
    expect(merged[0]?.displayName).toBe("dtinth");
    expect(merged[0]?.fitScore).toBe(9);
    expect(merged.find((row) => row.displayName === "microsoft")?.fitScore).toBe(0);
    expect(hireableShortlist(merged, 40, "location:Bangkok").map((row) => row.displayName)).toEqual([
      "dtinth",
    ]);
  });

  it("keeps open-to-work Bangkok people and drops paper authors", () => {
    const rows = scoreLocally(
      [
        hit({
          displayName: "blueglasses1995",
          source: "github",
          location: "Bangkok",
          headline: "TypeScript React Tech Lead · open to work",
        }),
        hit({
          displayName: "John Halloran",
          source: "s2",
          headline: "MCP safety audit paper",
        }),
      ],
      "Tech Lead Bangkok TypeScript",
    );
    expect(hireableShortlist(rows, 40, "Tech Lead Bangkok TypeScript").map((row) => row.displayName)).toEqual([
      "blueglasses1995",
    ]);
  });

  it("reads HN seeking-work comments as Bangkok candidates", () => {
    const parsed = parseSeeking(
      "SEEKING WORK | Bangkok, Thailand | Remote Technologies: TypeScript, Node.js, React",
    );
    expect(parsed.looking).toBe(true);
    expect(parsed.location).toMatch(/Bangkok/i);
    expect(parsed.headline).toMatch(/TypeScript/);
  });

  it("keeps Thai-signal people when the JD asks for คนไทย", () => {
    expect(wantsThai("หา Tech Lead คนไทย ภาษาไทย")).toBe(true);
    expect(thaiSignal("I'm a web developer native to Bangkok, Thailand")).toBe(true);
    expect(thaiSignal("SEEKING WORK San Francisco")).toBe(false);
    expect(thaiSignal("Toshiki Matsukuma · Full-Stack Engineer · Bangkok, Thailand")).toBe(false);
    expect(thaiSignal("Swan Pyae Aung · React Next.js · กรุงเทพ, Thailand")).toBe(false);
    expect(
      hitThai(
        hit({
          displayName: "Swan Pyae Aung",
          source: "github",
          location: "Bangkok",
          headline: "Full-stack · React · ทำงานที่กรุงเทพมาหลายปี ชอบอาหารไทย",
        }),
      ),
    ).toBe(false);
    expect(hitThai(hit({ displayName: "Ekkawit P.", source: "devhub", headline: "Open to Work" }))).toBe(true);
    expect(
      hitThai(
        hit({
          displayName: "Somchai Dev",
          source: "linkedin",
          location: "Bangkok, Thailand",
          headline: "Senior Software Engineer",
          profileUrl: "https://www.linkedin.com/in/somchai-dev",
        }),
      ),
    ).toBe(true);
    const rows = scoreLocally(
      [
        hit({
          displayName: "sirn",
          source: "hn",
          location: "Bangkok",
          headline: "SEEKING WORK · native to Bangkok · Python",
        }),
        hit({
          displayName: "ammmir",
          source: "hn",
          location: "Bangkok",
          headline: "SEEKING WORK · TypeScript Node · 15 years",
        }),
      ],
      "หาคนไทย ภาษาไทย Bangkok",
    );
    expect(hireableShortlist(rows, 40, "หาคนไทย ภาษาไทย Bangkok").map((row) => row.displayName)).toEqual(["sirn"]);
    expect(
      hireableShortlist(rows, 40, "Tech Lead Bangkok TypeScript", "thai").map((row) => row.displayName),
    ).toEqual(["sirn", "ammmir"]);
    expect(
      hireableShortlist(rows, 40, "Tech Lead Bangkok TypeScript", "foreign").map((row) => row.displayName),
    ).toEqual(["ammmir"]);
  });

  it("keeps marketing people when the JD is marketing", () => {
    const rows = scoreLocally(
      [
        hit({
          displayName: "Nicha Brand",
          source: "linkedin",
          location: "Bangkok, Thailand",
          headline: "Marketing Manager · Brand Campaigns · Open to Work",
          profileUrl: "https://www.linkedin.com/in/nicha-brand",
        }),
        hit({
          displayName: "Somchai Dev",
          source: "github",
          location: "Bangkok",
          headline: "Senior Software Engineer · React Node",
          profileUrl: "https://github.com/somchai",
        }),
      ],
      "หาทีมการตลาด Brand Content Campaign กรุงเทพ",
    );
    expect(looksLikeMarketing("หาทีมการตลาด Brand Content")).toBe(true);
    expect(
      hireableShortlist(rows, 40, "หาทีมการตลาด Brand Content Campaign กรุงเทพ", "thai").map(
        (row) => row.displayName,
      ),
    ).toEqual(["Nicha Brand", "Somchai Dev"]);
    const lookingDev = scoreLocally(
      [
        hit({
          displayName: "Ekkawit P.",
          source: "devhub",
          location: "Thailand",
          headline: "Full Stack · Senior · Open to Work",
          profileUrl: "https://devhub.in.th/en/developers/lexthai24/",
        }),
        hit({
          displayName: "Nicha Brand",
          source: "linkedin",
          location: "Bangkok, Thailand",
          headline: "Marketing Manager · Brand Campaigns · Open to Work",
          profileUrl: "https://www.linkedin.com/in/nicha-brand",
        }),
      ],
      "หาทีมการตลาด Brand Content Campaign กรุงเทพ",
    );
    expect(
      hireableShortlist(lookingDev, 40, "หาทีมการตลาด Brand Content Campaign กรุงเทพ", "thai").map(
        (row) => row.displayName,
      ),
    ).toEqual(["Nicha Brand", "Ekkawit P."]);
  });

  it("drops CJK LinkedIn names even when the location is Bangkok", () => {
    expect(looksCjkName("淑婷 刘")).toBe(true);
    expect(looksCjkName("Nicha Srisuk")).toBe(false);
    const rows = scoreLocally(
      [
        hit({
          displayName: "淑婷 刘",
          source: "linkedin",
          location: "Bangkok, Thailand",
          headline: "Marketing Manager",
          profileUrl: "https://www.linkedin.com/in/liu-wei",
        }),
        hit({
          displayName: "Nicha Srisuk",
          source: "linkedin",
          location: "Bangkok, Thailand",
          headline: "Brand Manager",
          profileUrl: "https://www.linkedin.com/in/nicha-srisuk",
        }),
      ],
      "Brand Manager คนไทย กรุงเทพ",
    );
    expect(hireableShortlist(rows, 40, "Brand Manager คนไทย กรุงเทพ", "thai").map((row) => row.displayName)).toEqual([
      "Nicha Srisuk",
    ]);
  });

  it("keeps LinkedIn Short cards even when the headline is thin", () => {
    const card = hit({
      displayName: "Nicha S.",
      source: "linkedin",
      location: null,
      headline: "",
      profileUrl: "https://www.linkedin.com/in/nicha-s",
    });
    expect(isJobCandidate(card, "หาทีมการตลาด Brand กรุงเทพ", "thai")).toBe(true);
  });

  it("keeps Apify LinkedIn people on the Thai shortlist", () => {
    const rows = scoreLocally(
      [
        hit({
          displayName: "Somchai Dev",
          source: "linkedin",
          location: "Bangkok, Thailand",
          headline: "Senior Software Engineer · React Node",
          profileUrl: "https://www.linkedin.com/in/somchai-dev",
        }),
        hit({
          displayName: "Alex Smith",
          source: "github",
          location: "Berlin",
          headline: "TypeScript React",
          profileUrl: "https://github.com/alexsmith",
        }),
      ],
      "Tech Lead Bangkok TypeScript",
    );
    expect(
      hireableShortlist(rows, 40, "Tech Lead Bangkok TypeScript", "thai").map((row) => row.displayName),
    ).toEqual(["Somchai Dev"]);
  });

  it("puts SEEKING WORK + RAG above a Bangkok stack with no looking signal", () => {
    const rows = scoreLocally(
      [
        hit({
          displayName: "Toshiki",
          source: "github",
          location: "Bangkok",
          headline: "Full-Stack Engineer · TypeScript React GraphQL",
        }),
        hit({
          displayName: "Genego",
          source: "hn",
          location: "Thailand",
          headline: "SEEKING WORK · RAG/MCP · Django Python · hybrid Thailand",
        }),
        hit({
          displayName: "Kawin",
          source: "github",
          location: "Bangkok",
          headline: "Software Engineer Intern · React TypeScript",
        }),
      ],
      "Tech Lead AI Workflow Bangkok RAG MCP TypeScript",
    );
    const names = hireableShortlist(rows, 40, "Tech Lead AI Workflow Bangkok RAG MCP TypeScript").map(
      (row) => row.displayName,
    );
    expect(names[0]).toBe("Genego");
    expect(names.indexOf("Kawin")).toBeGreaterThan(names.indexOf("Genego"));
    expect(peopleForModel(rows).map((row) => row.displayName)[0]).toBe("Genego");
  });

  it("builds a fallback query from the JD instead of defaulting to TypeScript", () => {
    expect(fallbackQuery("หาทีมการตลาด Brand Content Campaign กรุงเทพ")).toMatch(/marketing|brand|content|การตลาด/i);
    expect(fallbackQuery("หาทีมการตลาด Brand Content Campaign กรุงเทพ")).toMatch(/Bangkok/i);
    expect(fallbackQuery("หาทีมการตลาด Brand Content Campaign กรุงเทพ")).not.toMatch(/TypeScript/i);
    expect(fallbackQuery("Tech Lead RAG MCP TypeScript Bangkok")).toMatch(/RAG|MCP|typescript/i);
  });

  it("picks personal portfolio URLs and ignores GitHub/LinkedIn", () => {
    expect(isPersonalSite("https://jairukchan.com")).toBe(true);
    expect(isPersonalSite("https://github.com/foo")).toBe(false);
    expect(firstPersonalUrl("CV https://verekia.com/resume and https://github.com/verekia")).toBe(
      "https://verekia.com/resume",
    );
  });
});
