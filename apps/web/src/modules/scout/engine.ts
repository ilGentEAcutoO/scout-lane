import type { SourceId } from "./types";

/** Person adapters that may put people on the shortlist when their group is on. */
export const CANDIDATE_SOURCES = new Set<SourceId>([
  "github",
  "github_repos",
  "github_th",
  "github_bkk",
  "github_langchain",
  "gitlab",
  "gitlab_projects",
  "huggingface",
  "hf_spaces",
  "stackoverflow",
  "stack_ai",
  "stack_ds",
  "devto",
  "devhub",
  "hn",
  "reddit",
  "lobsters",
  "hf_forum",
  "openai_forum",
  "apify_web",
  "linkedin",
]);

export function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSeeking(html: string): {
  location: string | null;
  headline: string;
  looking: boolean;
  portfolioUrl: string | null;
} {
  const text = stripHtml(html);
  const looking = /seeking work|available for|open to (work|hire)|for hire/i.test(text);
  const locRaw =
    /location:\s*([^|\n]+?)(?=\s{2,}|technologies:|résumé|resume|email:|$)/i.exec(text)?.[1]?.trim() ||
    (/(bangkok[^|,.]{0,40}|thailand)/i.exec(text)?.[0] ?? null);
  const loc = locRaw ? locRaw.replace(/\s+/g, " ").slice(0, 80) : null;
  const tech = /technologies:\s*([^|\n]+?)(?=\s{2,}|résumé|resume|email:|$)/i.exec(text)?.[1]?.trim();
  const portfolioUrl = firstPersonalUrl(html);
  const site = portfolioUrl ? new URL(portfolioUrl).hostname.replace(/^www\./, "") : "";
  const headline = ["SEEKING WORK", loc, tech, site ? `พอร์ต ${site}` : ""].filter(Boolean).join(" · ").slice(0, 220);
  return { location: loc, headline: headline || text.slice(0, 220), looking, portfolioUrl };
}

export function looksLikeEngineer(text: string): boolean {
  return /typescript|javascript|react|node\.?js|python|full.?stack|software engineer|developer|devops|llm|rag|mcp/i.test(
    text,
  );
}

export function looksLikeMarketing(text: string): boolean {
  return /market(ing|er)?|brand|content|campaign|social media|growth|seo|\bads\b|creative|\bpr\b|สื่อ|การตลาด|นักการตลาด|แบรนด์|คอนเทนต์|โฆษณา|ประชาสัมพันธ์/i.test(
    text,
  );
}

export function craftFitsJd(profile: string, jd: string): boolean {
  if (looksLikeMarketing(jd)) return looksLikeMarketing(profile);
  if (looksLikeEngineer(jd)) return looksLikeEngineer(profile);
  return true;
}

export function fallbackQuery(jd: string): string {
  const text = jd.replace(/\s+/g, " ").trim();
  const loc = /bangkok|กรุงเทพ/i.test(text)
    ? "location:Bangkok"
    : /thailand|ไทย/i.test(text)
      ? "location:Thailand"
      : "location:Bangkok";
  const keys = [
    "performance",
    "growth",
    "social",
    "marketing",
    "brand",
    "content",
    "campaign",
    "การตลาด",
    "แบรนด์",
    "คอนเทนต์",
    "โซเชียล",
    "จ่ายสื่อ",
    "typescript",
    "javascript",
    "react",
    "python",
    "MCP",
    "RAG",
    "LLM",
    "automation",
  ];
  const picked: string[] = [];
  for (const key of keys) {
    if (new RegExp(key, "i").test(text) && !picked.some((row) => row.toLowerCase() === key.toLowerCase())) {
      picked.push(key);
    }
    if (picked.length >= 4) break;
  }
  if (!picked.length) {
    const tokens = text.split(/[^\p{L}\p{N}+]+/u).filter((token) => token.length >= 4).slice(0, 4);
    picked.push(...tokens);
  }
  return `${picked.join(" ") || "hiring"} ${loc}`.slice(0, 80);
}

export function inThailand(text: string | null | undefined): boolean {
  return /bangkok|กรุงเทพ|thailand|ไทย|chiang mai|เชียงใหม่|phuket|ภูเก็ต|pattaya|nonthaburi|นนทบุรี|khon kaen|ขอนแก่น|hat yai|หาดใหญ่/i.test(
    text || "",
  );
}

const CJK_NAME = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;

/** Han / kana / hangul in the display name — not a Thai or English card. */
export function looksCjkName(text: string | null | undefined): boolean {
  return CJK_NAME.test(text || "");
}

/** Public signal they are Thai or work in Thai — not a nationality check. */
export function thaiSignal(text: string | null | undefined): boolean {
  const raw = text || "";
  if (/คนไทย|ชาวไทย|native to bangkok|native to thailand|thai developer|i'?m thai|i am thai|คนกรุงเทพ/i.test(raw)) {
    return true;
  }
  const stripped = raw.replace(/กรุงเทพมหานคร|กรุงเทพฯ?|ประเทศไทย/g, "");
  const thaiChars = stripped.match(/[\u0E00-\u0E7F]/g);
  if (thaiChars && thaiChars.length >= 3) return true;
  return /\b(thanaphoom|thanawin|thanakrit|thanaphon|thanawat|kittipong|kittipot|natthachai|nattaphon|wanichanon|jinnawat|chatbordin|webdevbyboom|krittimet|sirichai|sirikan|boonyarit|teerapat|teerayut|nattawut|panupong|surapat|mongkhon|natdhanai|ekkawit|phoomparin|manassarn|somkiat|kawin|chayoot|supakorn|pangsakulyanont|thongjan|babparn|kosiwanich|thongtra|puisungnoen|sirn|pattreeya|preecha|korakot|passakorn|satang|chalee|zacksiri|wizarud|tempkaew|tiekungsos|beer_devx|spped2000|lexthai24|devkim)\b/i.test(
    raw,
  );
}

export function wantsThai(jd: string): boolean {
  return /คนไทย|ภาษาไทย|thai speaker|native thai/i.test(jd);
}

const NOT_PERSONAL = /github\.com|gitlab\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|fb\.me|instagram\.com|youtube\.com|reddit\.com|news\.ycombinator|stackoverflow\.com|dev\.to|devhub\.in\.th|contentmastery\.io|medium\.com|notion\.so/i;

export function isPersonalSite(url: string): boolean {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return !NOT_PERSONAL.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function firstPersonalUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s)\]>'"]+/gi) ?? [];
  for (const raw of matches) {
    const clean = raw.replace(/[.,;]+$/, "");
    if (isPersonalSite(clean)) return clean;
  }
  return null;
}
