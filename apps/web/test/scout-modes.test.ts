import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODES,
  GROUP_HINTS,
  applySourceModes,
  clampShopModes,
  modeFor,
  normalizeModes,
  onModeFor,
  parseModesJson,
  shopGroups,
  statusForMode,
} from "../src/modules/scout/modes";
import { hitsFromLinkedinSearch } from "../src/modules/scout/apify";
import type { SourceAdapter } from "../src/modules/scout/types";

const dummy: SourceAdapter = { id: "github", status: "live", async search() { return []; } };
const linkedin: SourceAdapter = { id: "linkedin", status: "needs_authorization", async search() { return []; } };
const shop: SourceAdapter = { id: "linkedin", status: "needs_authorization", async search() { return []; } };

describe("source modes", () => {
  it("defaults LinkedIn to Apify shop and Thai code to self", () => {
    expect(DEFAULT_MODES.linkedin).toBe("shop");
    expect(DEFAULT_MODES.thai_code).toBe("self");
    expect(modeFor("github_th", DEFAULT_MODES)).toBe("self");
    expect(modeFor("linkedin", DEFAULT_MODES)).toBe("shop");
    expect(onModeFor("thai_code", false)).toBe("self");
    expect(onModeFor("linkedin", false)).toBe("shop");
    expect(onModeFor("linkedin", true)).toBe("shop");
  });

  it("drops illegal combinations", () => {
    const next = normalizeModes({ linkedin: "self", job_boards: "shop", thai_code: "shop", community: "link" });
    expect(next.linkedin).toBe("shop");
    expect(next.job_boards).toBe("link");
    expect(next.thai_code).toBe("self");
    expect(next.community).toBe("self");
  });

  it("upgrades a stored LinkedIn HR-link mode to shop", () => {
    expect(parseModesJson(JSON.stringify({ linkedin: "link" })).linkedin).toBe("shop");
  });

  it("parses stored JSON and ignores junk", () => {
    expect(parseModesJson("{not json")).toEqual(DEFAULT_MODES);
    expect(parseModesJson(JSON.stringify({ linkedin: "shop" })).linkedin).toBe("shop");
  });

  it("marks LinkedIn shop live only with a token", () => {
    expect(statusForMode("linkedin", "shop", false, "needs_authorization")).toBe("needs_authorization");
    expect(statusForMode("linkedin", "shop", true, "needs_authorization")).toBe("live");
    expect(statusForMode("github", "off", true, "live")).toBe("inbound_only");
  });

  it("swaps in the shop LinkedIn adapter when that mode is on", () => {
    const ready = applySourceModes([dummy, linkedin], { ...DEFAULT_MODES, linkedin: "shop" }, {
      hasToken: true,
      shopLinkedin: shop,
    });
    expect(ready.find((row) => row.id === "linkedin")?.status).toBe("live");
    expect(ready.find((row) => row.id === "github")?.status).toBe("live");
  });

  it("explains where each source group actually pulls from", () => {
    expect(GROUP_HINTS.thai_code).toMatch(/GitHub/);
    expect(GROUP_HINTS.community).toMatch(/Dev\.to/);
    expect(GROUP_HINTS.apify_web).toMatch(/Kaggle/);
    expect(GROUP_HINTS.linkedin).toMatch(/LinkedIn/);
    expect(GROUP_HINTS.job_boards).toMatch(/JobsDB/);
  });

  it("keeps LinkedIn and web search off until an Apify key exists", () => {
    expect(shopGroups().sort()).toEqual(["apify_web", "linkedin"]);
    const closed = clampShopModes({ ...DEFAULT_MODES }, false);
    expect(closed.linkedin).toBe("off");
    expect(closed.apify_web).toBe("off");
    expect(closed.thai_code).toBe("self");
    expect(clampShopModes({ ...DEFAULT_MODES }, true).linkedin).toBe("shop");
  });

  it("turns GitHub off without touching LinkedIn shop mode", () => {
    const ready = applySourceModes([dummy, linkedin], { ...DEFAULT_MODES, thai_code: "off" }, {
      hasToken: false,
      shopLinkedin: shop,
    });
    expect(ready.find((row) => row.id === "github")?.status).toBe("inbound_only");
    expect(ready.find((row) => row.id === "linkedin")?.status).toBe("needs_authorization");
  });
});

describe("linkedin shop hits", () => {
  it("keeps public profile URLs and drops junk", () => {
    const hits = hitsFromLinkedinSearch([
      {
        firstName: "Somchai",
        lastName: "Dev",
        headline: "Tech Lead Bangkok",
        linkedinUrl: "https://www.linkedin.com/in/somchai-dev",
        location: { linkedinText: "Bangkok, Thailand" },
      },
      { firstName: "Nope", linkedinUrl: "https://facebook.com/x" },
      { publicIdentifier: "jane", firstName: "Jane", linkedinUrl: "http://linkedin.com/in/jane" },
    ]);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.source).toBe("linkedin");
    expect(hits[0]?.profileUrl).toBe("https://www.linkedin.com/in/somchai-dev");
    expect(hits[0]?.displayName).toMatch(/Somchai/);
    expect(hits[1]?.profileUrl).toBe("https://www.linkedin.com/in/jane");
  });
});
