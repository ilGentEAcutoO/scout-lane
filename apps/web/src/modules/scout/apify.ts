import type { CandidateHit, SourceAdapter, SourceStatus } from "./types";
import { inThailand, looksCjkName } from "./engine";
import { openSecret, sealSecret } from "../../llm/keys";

const SHOP_SETTING = "shop.apify.key";

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
  return hits.slice(0, 40);
}

export function vendorPhase(env: Env): VendorPhase {
  return env.APIFY_WIDE === "1" ? "A" : "C";
}

export async function apifySecretFor(
  env: Env,
): Promise<{ key: string; source: "stored" | "secret" | null }> {
  const row = await env.DB_MAIN.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(SHOP_SETTING)
    .first<{ value: string }>();
  if (row?.value) {
    const opened = (await openSecret(env, row.value))?.trim() || "";
    if (opened) return { key: opened, source: "stored" };
  }
  const fromEnv = env.APIFY_TOKEN?.trim() || "";
  if (fromEnv) return { key: fromEnv, source: "secret" };
  return { key: "", source: null };
}

export async function saveApifyKey(env: Env, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await env.DB_MAIN.prepare("DELETE FROM settings WHERE key = ?").bind(SHOP_SETTING).run();
    return;
  }
  const packed = await sealSecret(env, trimmed);
  await env.DB_MAIN.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(SHOP_SETTING, packed)
    .run();
}

export function apifyStatus(env: Env): SourceStatus {
  return env.APIFY_TOKEN?.trim() ? "live" : "needs_authorization";
}

export function withVendorStatus(list: SourceAdapter[], env: Env): SourceAdapter[] {
  const status = apifyStatus(env);
  return list.map((row) => (row.id === "apify_web" ? { ...row, status } : row));
}

type LinkedinPosition = {
  position?: string;
  title?: string;
  companyName?: string;
};

type LinkedinRow = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  headline?: string;
  summary?: string;
  linkedinUrl?: string;
  url?: string;
  publicIdentifier?: string;
  openToWork?: boolean;
  location?: {
    linkedinText?: string;
    countryCode?: string;
    parsed?: { text?: string; city?: string; countryCode?: string; country?: string };
  } | string;
  currentPosition?: LinkedinPosition | LinkedinPosition[];
  currentPositions?: LinkedinPosition[];
};

/** HarvestAPI searchQuery is a LinkedIn people phrase, not a GitHub `location:` query. */
export function linkedinPeopleQuery(raw: string): string {
  const text = raw
    .replace(/\blocation:\S+/gi, " ")
    .replace(/\bsite:\S+/gi, " ")
    .replace(/[^\p{L}\p{M}\p{N}+\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/การตลาด|นักการตลาด|\bmarketing\b|\bmarketer\b|โซเชียล|จ่ายสื่อ/i.test(text)) {
    if (/performance|จ่ายสื่อ|media buyer|paid media/i.test(text)) return "Performance Marketing";
    if (/social|โซเชียล/i.test(text)) return "Social Media Manager";
    if (/content|คอนเทนต์/i.test(text)) return "Content Marketing";
    if (/growth/i.test(text)) return "Growth Marketing";
    if (/brand|แบรนด์/i.test(text)) return "Brand Manager";
    return "Marketing Manager";
  }
  if (/tech lead/i.test(text)) return "Tech Lead";
  if (/software|developer|engineer|typescript|javascript|python|\bmcp\b|\brag\b/i.test(text)) {
    const bits = text
      .split(" ")
      .filter((token) => /typescript|javascript|react|python|mcp|rag|llm|engineer|developer|lead|software/i.test(token));
    return (bits.slice(0, 4).join(" ") || "Software Engineer").slice(0, 80);
  }
  const tokens = text.split(" ").filter((token) => token.length >= 3).slice(0, 5);
  return (tokens.join(" ") || "Professional").slice(0, 80);
}

function normalizeLinkedinUrl(raw: string): string | null {
  const match = raw.trim().match(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
  const slug = match?.[1]?.replace(/\/+$/, "");
  return slug ? `https://www.linkedin.com/in/${slug}` : null;
}

export function linkedinProfileUrl(row: LinkedinRow): string | null {
  const fromUrl = normalizeLinkedinUrl(row.linkedinUrl || "") || normalizeLinkedinUrl(row.url || "");
  if (fromUrl) return fromUrl;
  const id = (row.publicIdentifier || "").trim();
  if (id && /^[A-Za-z0-9._-]+$/.test(id)) return `https://www.linkedin.com/in/${id}`;
  return null;
}

function linkedinLocation(row: LinkedinRow): string | null {
  if (typeof row.location === "string") return row.location.slice(0, 80) || null;
  const parsed = row.location && typeof row.location === "object" ? row.location : null;
  const text =
    parsed?.linkedinText ||
    parsed?.parsed?.text ||
    parsed?.parsed?.city ||
    "";
  return text.slice(0, 80) || null;
}

function linkedinCountry(row: LinkedinRow): string | null {
  if (!row.location || typeof row.location === "string") return null;
  const raw = row.location.countryCode || row.location.parsed?.countryCode || "";
  return raw.trim().toUpperCase() || null;
}

export function linkedinLivesInThailand(location: string | null, country: string | null): boolean {
  if (country) return country === "TH";
  if (!location) return true;
  return inThailand(location);
}

function positionLine(row: LinkedinPosition): string {
  const role = (row.position || row.title || "").trim();
  const company = (row.companyName || "").trim();
  if (role && company) return `${role} at ${company}`;
  return role || company;
}

function linkedinHeadline(row: LinkedinRow): string {
  const positions = [
    ...(Array.isArray(row.currentPosition) ? row.currentPosition : row.currentPosition ? [row.currentPosition] : []),
    ...(Array.isArray(row.currentPositions) ? row.currentPositions : []),
  ]
    .map(positionLine)
    .filter(Boolean);
  const parts = [
    row.headline,
    row.summary,
    positions.join(" · "),
    row.openToWork ? "Open to Work" : "",
  ]
    .map((part) => (part || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(" · ").slice(0, 220);
}

export function hitsFromLinkedinSearch(rows: LinkedinRow[]): CandidateHit[] {
  const hits: CandidateHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const url = linkedinProfileUrl(row);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    const name =
      (row.fullName || row.name || `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.publicIdentifier || "unknown").trim();
    if (looksCjkName(name)) continue;
    const location = linkedinLocation(row);
    if (!linkedinLivesInThailand(location, linkedinCountry(row))) continue;
    seen.add(key);
    hits.push({
      source: "linkedin",
      externalId: `linkedin:${row.publicIdentifier || key}`,
      displayName: name.slice(0, 80),
      headline: linkedinHeadline(row),
      profileUrl: url,
      location,
    });
  }
  return hits.slice(0, 40);
}

export const linkedinShopAdapter: SourceAdapter = {
  id: "linkedin",
  status: "needs_authorization",
  async search(query, env) {
    const token = (await apifySecretFor(env)).key;
    if (!token) return [];
    const actor = assertActorAllowed(LINKEDIN_SEARCH_ACTOR);
    const url = new URL(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`);
    url.searchParams.set("timeout", "50");
    url.searchParams.set("memory", "1024");
    url.searchParams.set("limit", "25");
    url.searchParams.set("format", "json");
    url.searchParams.set("clean", "1");
    const searchQuery = linkedinPeopleQuery(query);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        searchQuery,
        profileScraperMode: "Short",
        locations: ["Thailand"],
        maxItems: 25,
        takePages: 1,
        startPage: 1,
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!res.ok) throw new Error(`apify_http_${res.status}`);
    const body = (await res.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body) && "error" in body) {
      throw new Error(`apify_body_${String((body as { error: unknown }).error).slice(0, 40)}`);
    }
    const rows = Array.isArray(body)
      ? body
      : Array.isArray((body as { items?: unknown }).items)
        ? ((body as { items: LinkedinRow[] }).items)
        : [];
    return hitsFromLinkedinSearch(rows as LinkedinRow[]);
  },
};

export const apifyWebAdapter: SourceAdapter = {
  id: "apify_web",
  status: "needs_authorization",
  async search(query, env) {
    const token = (await apifySecretFor(env)).key;
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
