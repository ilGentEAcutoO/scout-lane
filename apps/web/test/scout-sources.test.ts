import { describe, expect, it } from "vitest";
import { CANDIDATE_SOURCES, isPersonalSite, parseSeeking, thaiSignal } from "../src/modules/scout/engine";
import { HN_SEEKING_QUERIES } from "../src/modules/scout/extra";
import { parseDevhubList, parseDevhubProfile } from "../src/modules/scout/devhub";
import { isJobCandidate, scoreLocally } from "../src/modules/scout/rank";

const JD = "Tech Lead AI Workflow Hotel Plus Bangkok RAG MCP React TypeScript";

describe("HN seeking queries", () => {
  it("searches AI workflow terms the JD actually asks for", () => {
    const blob = HN_SEEKING_QUERIES.join("\n");
    expect(blob).toMatch(/RAG/i);
    expect(blob).toMatch(/MCP/i);
    expect(blob).toMatch(/SEEKING WORK Thailand/i);
  });

  it("parses a SEEKING WORK card with RAG/MCP and a personal site", () => {
    const html = `SEEKING WORK | Senior Django/Python & AI Engineer
Location: Thailand (UTC+7)
Technologies: Django, Python, PostgreSQL, RAG/MCP
Resume/CV: https://edwin.genego.io/about`;
    const parsed = parseSeeking(html);
    expect(parsed.looking).toBe(true);
    expect(parsed.location).toMatch(/Thailand/i);
    expect(parsed.portfolioUrl).toMatch(/edwin\.genego\.io/);
  });
});

describe("DevHub public pages", () => {
  it("reads names and slugs from the public ItemList", () => {
    const html = `<script type="application/ld+json">{"@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[
      {"@type":"ListItem","name":"Thanawin Padsamran","url":"https://devhub.in.th/en/developers/thanawin/"},
      {"@type":"ListItem","name":"peamz4","url":"https://devhub.in.th/en/developers/peamz4/"}
    ]}}</script>`;
    const rows = parseDevhubList(html);
    expect(rows).toEqual([
      { slug: "thanawin", name: "Thanawin Padsamran" },
      { slug: "peamz4", name: "peamz4" },
    ]);
  });

  it("keeps Open to Work people and their personal site, drops Not Open", () => {
    const open = parseDevhubProfile(
      `<h1>Chatbordin</h1><p>Full Stack Developer</p><span>Open to Work</span>
       <a href="https://chatbordin.com/">Portfolio</a>
       <a href="https://github.com/klinsc">GitHub</a>`,
      "webdevbyboom",
    );
    expect(open?.looking).toBe(true);
    expect(open?.portfolioUrl).toBe("https://chatbordin.com/");
    expect(open?.displayName).toMatch(/Chatbordin/i);

    expect(
      parseDevhubProfile(`<h1>King</h1><span>Not Open to Work</span><span>Not currently available</span>`, "kingggg5"),
    ).toBeNull();
  });
});

describe("shortlist sources", () => {
  it("lets DevHub people onto the shortlist and still blocks Facebook ids", () => {
    expect(CANDIDATE_SOURCES.has("devhub")).toBe(true);
    expect(CANDIDATE_SOURCES.has("linkedin")).toBe(true);
    expect(CANDIDATE_SOURCES.has("facebook")).toBe(false);
    const hit = {
      source: "devhub" as const,
      externalId: "devhub:webdevbyboom",
      displayName: "Chatbordin Klinsrisuk",
      headline: "Full Stack · Senior · Open to Work · พอร์ต chatbordin.com",
      profileUrl: "https://devhub.in.th/en/developers/webdevbyboom/",
      location: "Thailand",
      kind: "person" as const,
      portfolioUrl: "https://chatbordin.com/",
    };
    expect(isJobCandidate(hit, JD)).toBe(true);
    expect(scoreLocally([hit], JD)[0]?.fitScore).toBeGreaterThan(0);
    expect(thaiSignal("Thanawin Padsamran Thailand")).toBe(true);
    expect(isPersonalSite("https://chatbordin.com/")).toBe(true);
    expect(isPersonalSite("https://devhub.in.th/en/developers/webdevbyboom/")).toBe(false);
  });
});
