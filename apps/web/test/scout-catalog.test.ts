import { describe, expect, it } from "vitest";
import { buildSourceLanes, laneHas, sourceLabel } from "../src/modules/scout/catalog";
import { officialSearchUrls } from "../src/modules/scout/links";

const adapters = [
  { id: "github", status: "live" as const },
  { id: "reddit", status: "live" as const },
  { id: "stackoverflow", status: "live" as const },
  { id: "linkedin", status: "needs_authorization" as const },
  { id: "facebook", status: "needs_authorization" as const },
  { id: "jobsdb", status: "inbound_only" as const },
  { id: "jobthai", status: "inbound_only" as const },
  { id: "jobbkk", status: "inbound_only" as const },
];

describe("source lanes", () => {
  const { lanes, analysis } = buildSourceLanes({
    adapters,
    links: officialSearchUrls("Tech Lead MCP Bangkok"),
    counts: { github: 8, reddit: 0 },
  });

  it("never treats LinkedIn as a live fetch", () => {
    expect(laneHas(lanes, "linkedin")).toBe("blocked");
    expect(lanes.live.some((row) => row.id === "linkedin")).toBe(false);
    expect(lanes.blocked.find((row) => row.id === "linkedin")?.url).toMatch(/^https:\/\/www\.linkedin\.com\//);
  });

  it("keeps login walls and inbound job boards out of shortlist sources", () => {
    expect(laneHas(lanes, "facebook")).toBe("blocked");
    expect(laneHas(lanes, "jobsdb")).toBe("blocked");
    expect(laneHas(lanes, "jobthai")).toBe("blocked");
    expect(laneHas(lanes, "jobbkk")).toBe("blocked");
  });

  it("puts public APIs in live and leftover official URLs in hr_click", () => {
    expect(laneHas(lanes, "github")).toBe("live");
    expect(laneHas(lanes, "meetup")).toBe("hr_click");
    expect(laneHas(lanes, "kaggle")).toBe("hr_click");
    expect(lanes.live.find((row) => row.id === "github")?.count).toBe(8);
  });

  it("gives each source exactly one lane", () => {
    const ids = [...lanes.live, ...lanes.hr_click, ...lanes.blocked].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("explains that LinkedIn is not fetched", () => {
    expect(analysis.headline).toMatch(/LinkedIn ไม่ดึง/);
    expect(sourceLabel("linkedin")).toBe("LinkedIn People");
  });

  it("puts official people-search landings in hr_click", () => {
    expect(laneHas(lanes, "jobsdb_people")).toBe("hr_click");
    expect(laneHas(lanes, "jobthai_resume")).toBe("hr_click");
    expect(laneHas(lanes, "jobbkk_resume")).toBe("hr_click");
    expect(laneHas(lanes, "hosco")).toBe("hr_click");
    expect(laneHas(lanes, "jobtopgun")).toBe("hr_click");
    expect(laneHas(lanes, "seek_talent")).toBe("hr_click");
    expect(lanes.hr_click.find((row) => row.id === "jobsdb_people")?.url).toContain("/profiles/search");
  });
});
