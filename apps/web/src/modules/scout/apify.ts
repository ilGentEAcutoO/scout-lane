import type { CandidateHit, SourceAdapter, SourceStatus } from "./types";

export const GOOGLE_SEARCH_ACTOR = "apify/google-search-scraper";
export const LINKEDIN_SEARCH_ACTOR = "harvestapi/linkedin-profile-search";

const ALLOWED_ACTORS = new Set([GOOGLE_SEARCH_ACTOR, LINKEDIN_SEARCH_ACTOR]);

export const C_PUBLIC_HOSTS = new Set([
  "github.com",
  "huggingface.co",
  "gitlab.com",
  "dev.to",
  "devhub.in.th",
  "kaggle.com",
  "speakerdeck.com",
  "codeberg.org",
]);

export const A_PUBLIC_HOSTS = new Set(["sessionize.com", "hashnode.dev", "hashnode.com"]);

const GITHUB_RESERVED = new Set([
  "topics",
  "orgs",
  "search",
  "settings",
  "marketplace",
  "features",
  "pricing",
  "about",
  "login",
  "collections",
  "events",
  "sponsors",
  "explore",
  "codespaces",
  "copilot",
  "pulls",
  "issues",
  "notifications",
  "new",
  "organizations",
  "account",
  "teams",
  "enterprise",
  "readme",
  "apps",
  "marketplace",
  "user",
  "assets",
  "attachments",
]);

export type VendorPhase = "C" | "A";

export function assertActorAllowed(actorId: string): string {
  const id = actorId.trim().replace("~", "/").toLowerCase();
  if (!id || !ALLOWED_ACTORS.has(id)) {
    throw new Error("actor_not_allowed");
  }
  return id.replace("/", "~");
}

function hostsFor(phase: VendorPhase): Set<string> {
  if (phase === "A") return new Set([...C_PUBLIC_HOSTS, ...A_PUBLIC_HOSTS]);
  return C_PUBLIC_HOSTS;
}

export function publicSearchQueries(query: string, phase: VendorPhase): string[] {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80) || "Tech Lead MCP Bangkok";
  return [...hostsFor(phase)].map((host) => `site:${host} ${q}`);
}

type Organic = { title?: string; url?: string; description?: string };
type SearchItem = Organic & { organicResults?: Organic[] };

function flattenItems(items: SearchItem[]): Organic[] {
  const out: Organic[] = [];
  for (const item of items) {
    if (Array.isArray(item.organicResults)) out.push(...item.organicResults);
    else out.push(item);
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathParts(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function isPublicProfile(url: string, phase: VendorPhase): boolean {
  const host = hostOf(url);
  if (!host || !hostsFor(phase).has(host)) return false;
  const parts = pathParts(url);
  if (
    host === "github.com" ||
    host === "gitlab.com" ||
    host === "huggingface.co" ||
    host === "dev.to" ||
    host === "codeberg.org"
  ) {
    const slug = parts[0]?.toLowerCase() ?? "";
    if (!slug || parts.length > 2 || GITHUB_RESERVED.has(slug)) return false;
    if (host === "github.com" && (slug === "microsoft" || slug.endsWith("inc") || slug.endsWith("org"))) {
      if (slug === "microsoft") return false;
    }
    return true;
  }
  if (host === "devhub.in.th") {
    return parts.includes("developers") && parts.length >= 2;
  }
  if (host === "kaggle.com") {
    const slug = parts[0]?.toLowerCase() ?? "";
    if (!slug || parts.length > 2) return false;
    return !["competitions", "datasets", "code", "discussions", "learn", "models"].includes(slug);
  }
  if (host === "speakerdeck.com") {
    const slug = parts[0]?.toLowerCase() ?? "";
    if (!slug || parts.length !== 1) return false;
    return !["p", "embed", "search", "login", "signup", "pro"].includes(slug);
  }
  if (host === "sessionize.com") return parts.length >= 1 && parts[0] !== "s";
  if (host === "hashnode.dev" || host === "hashnode.com") return parts.length >= 1;
  return false;
}

function displayName(title: string, url: string): string {
  const cleaned = title
    .replace(
      /\s+[·|—–-]\s+(GitHub|Hugging Face|GitLab|DEV Community|DevHub|Sessionize|Hashnode|Kaggle|Speaker Deck|Codeberg).*$/i,
      "",
    )
    .replace(/\s+\(.*\)$/, "")
    .trim();
  if (cleaned) return cleaned.slice(0, 80);
  const parts = pathParts(url);
  return (parts[parts.length - 1] || "unknown").slice(0, 80);
}

export function hitsFromPublicSearch(items: SearchItem[], phase: VendorPhase): CandidateHit[] {
  const hits: CandidateHit[] = [];
  const seen = new Set<string>();
  for (const row of flattenItems(items)) {
    const url = row.url?.trim();
    if (!url || !/^https:\/\//i.test(url) || !isPublicProfile(url, phase)) continue;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      source: "apify_web",
      externalId: `apify:${key}`,
      displayName: displayName(row.title || "", url),
      headline: (row.description || "").replace(/\s+/g, " ").trim().slice(0, 220),
      profileUrl: url.split("#")[0] ?? url,
      location: /bangkok|thailand|ไทย|กรุงเทพ/i.test(`${row.title} ${row.description}`) ? "Thailand" : null,
    });
  }
  return hits.slice(0, 12);
}

export function vendorPhase(env: Env): VendorPhase {
  return env.APIFY_WIDE === "1" ? "A" : "C";
}

export function apifyStatus(env: Env): SourceStatus {
  return env.APIFY_TOKEN?.trim() ? "live" : "needs_authorization";
}

export function withVendorStatus(list: SourceAdapter[], env: Env): SourceAdapter[] {
  const status = apifyStatus(env);
  return list.map((row) => (row.id === "apify_web" ? { ...row, status } : row));
}

type LinkedinRow = {
  firstName?: string;
  lastName?: string;
  headline?: string;
  linkedinUrl?: string;
  publicIdentifier?: string;
  location?: { linkedinText?: string } | string;
};

export function hitsFromLinkedinSearch(rows: LinkedinRow[]): CandidateHit[] {
  const hits: CandidateHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row.linkedinUrl?.trim() || "";
    if (!/^https:\/\/(www\.)?linkedin\.com\/in\//i.test(raw)) continue;
    const url = raw.split("?")[0]?.replace(/\/+$/, "") ?? "";
    const key = url.toLowerCase();
    if (!url || seen.has(key)) continue;
    seen.add(key);
    const name = `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.publicIdentifier || "unknown";
    const loc = typeof row.location === "string" ? row.location : row.location?.linkedinText || null;
    hits.push({
      source: "linkedin",
      externalId: `linkedin:${row.publicIdentifier || key}`,
      displayName: name.slice(0, 80),
      headline: (row.headline || "").replace(/\s+/g, " ").trim().slice(0, 220),
      profileUrl: url.startsWith("https://www.") ? url : url.replace("https://linkedin.com", "https://www.linkedin.com"),
      location: loc ? loc.slice(0, 80) : null,
    });
  }
  return hits.slice(0, 15);
}

export const linkedinShopAdapter: SourceAdapter = {
  id: "linkedin",
  status: "needs_authorization",
  async search(query, env) {
    const token = env.APIFY_TOKEN?.trim();
    if (!token) return [];
    const actor = assertActorAllowed(LINKEDIN_SEARCH_ACTOR);
    const url = new URL(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`);
    url.searchParams.set("timeout", "25");
    url.searchParams.set("memory", "1024");
    url.searchParams.set("limit", "15");
    url.searchParams.set("format", "json");
    url.searchParams.set("clean", "1");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        searchQuery: query.slice(0, 120) || "Tech Lead",
        profileScraperMode: "Short",
        locations: ["Bangkok, Thailand", "Thailand"],
        maxItems: 15,
        takePages: 1,
      }),
      signal: AbortSignal.timeout(28_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return [];
    return hitsFromLinkedinSearch(body as LinkedinRow[]);
  },
};

export const apifyWebAdapter: SourceAdapter = {
  id: "apify_web",
  status: "needs_authorization",
  async search(query, env) {
    const token = env.APIFY_TOKEN?.trim();
    if (!token) return [];
    const actor = assertActorAllowed(GOOGLE_SEARCH_ACTOR);
    const phase = vendorPhase(env);
    const url = new URL(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`);
    url.searchParams.set("timeout", "20");
    url.searchParams.set("memory", "1024");
    url.searchParams.set("limit", "20");
    url.searchParams.set("format", "json");
    url.searchParams.set("clean", "1");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        queries: publicSearchQueries(query, phase).join("\n"),
        maxPagesPerQuery: 1,
        resultsPerPage: 10,
        mobileResults: false,
        languageCode: "en",
      }),
      signal: AbortSignal.timeout(22_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return [];
    return hitsFromPublicSearch(body as SearchItem[], phase);
  },
};
