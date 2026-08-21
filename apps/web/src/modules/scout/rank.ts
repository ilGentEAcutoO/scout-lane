import {
  CANDIDATE_SOURCES,
  craftFitsJd,
  inThailand,
  looksCjkName,
  looksLikeEngineer,
  looksLikeMarketing,
  thaiSignal,
  wantsThai,
} from "./engine";
import type { CandidateHit, SourceId } from "./types";

export type HitKind = "person" | "org" | "package";

export type RankItem = {
  externalId: string;
  fitScore: number;
  reason: string;
  kind?: HitKind;
};

export type ScoredHit = CandidateHit & {
  kind: HitKind;
  fitScore: number;
  reason: string;
};

export const RANK_BATCH = 30;
export const RANK_CAP = 150;
export const SHORTLIST_MAX = 150;

export const SCOUT_RANK_PROMPT = `You are an HR sourcer. Score each candidate for the job description in the user JSON (field jd), not for a generic tech role.

Score ONLY people who could be hired for THAT jd. Organizations, SDKs, packages, and bots get 0.

Priority, in order:
1. Publicly looking (SEEKING WORK, open to work, เปิดรับงาน) beats a strong profile with no looking signal.
2. Overlap with the jd craft, skills, and seniority beats a famous-but-wrong-field profile.
3. Bangkok or Thailand hybrid is a plus when the jd is Thai/Bangkok — not enough alone.
4. Intern or student: max 4 unless the jd is junior/intern.

Rubric relative to THIS jd:
0 = not a person
1-2 = wrong craft for the jd
3-4 = intern/junior, or senior with no overlap
5-6 = some overlap but not looking, or looking with weak overlap
7-8 = looking + clear craft overlap
9-10 = looking + strong craft/seniority overlap, and can work where the jd needs

Return JSON {items:[{externalId, fitScore, kind, reason}]}.
reason is one Thai sentence citing the card against the jd. Never invent email or phone.
Never give every card the same score.`;

const PACKAGE_SOURCES = new Set<SourceId>([
  "npm",
  "pypi",
  "crates",
  "rubygems",
  "packagist",
  "hex",
  "pubdev",
  "openvsx",
]);

const ORG_NAMES = new Set([
  "microsoft",
  "langchain-ai",
  "flowiseai",
  "berriai",
  "reworkd",
  "wordpress",
  "laravel",
  "symfony",
  "elysiajs",
  "thaitype",
  "mcpbundles",
  "chatchat-space",
  "headroomlabs-ai",
]);

export function classifyHit(hit: CandidateHit): HitKind {
  if (hit.kind) return hit.kind;
  const name = hit.displayName.trim().toLowerCase();
  if (ORG_NAMES.has(name)) return "org";
  if (PACKAGE_SOURCES.has(hit.source)) return "package";
  if (/gitlab\.com\/groups\//i.test(hit.profileUrl)) return "org";
  if (/\borganization\b|\bofficial org\b|inc\.|ltd\./i.test(hit.headline)) return "org";
  return "person";
}

const STACK = ["typescript", "react", "node", "next.js", "express", "postgresql", "mongodb"] as const;
const AI_BITS = ["mcp", "rag", "llm", "langchain", "automation", "workflow", "openai", "claude"] as const;

export function isLooking(text: string): boolean {
  return /seeking work|open to work|open for work|hireable|available for hire|เปิดรับงาน/i.test(text);
}

export function isJuniorCard(text: string): boolean {
  return /intern|ฝึกงาน|junior \(1-2|นักศึกษา|student|fresh grad/i.test(text);
}

export function heuristicScore(
  hit: CandidateHit,
  jd = "",
): { fitScore: number; reason: string; kind: HitKind } {
  const kind = classifyHit(hit);
  if (kind === "org") {
    return { fitScore: 0, kind, reason: "องค์กร ไม่ใช่คนที่เรียกสัมภาษณ์ได้" };
  }
  if (kind === "package") {
    return { fitScore: 0, kind, reason: "แพ็กเกจหรือส่วนขยาย ไม่ใช่โปรไฟล์คนสมัคร" };
  }

  const blob = `${hit.displayName} ${hit.headline} ${hit.location ?? ""}`.toLowerCase();
  const jdBlob = jd.toLowerCase();
  let score = 2;
  const reasons: string[] = [];

  if (isLooking(blob)) {
    score += 2.5;
    reasons.push("เปิดรับงาน");
  }
  if (/seeking work/i.test(blob)) {
    score += 0.5;
    reasons.push("ประกาศหางานเอง");
  }

  if (/bangkok|กรุงเทพ/.test(blob)) {
    score += 1;
    reasons.push("อยู่กรุงเทพ");
  } else if (/thailand|ไทย/.test(blob)) {
    score += 0.5;
    reasons.push("อยู่ไทย");
  }

  if (looksLikeMarketing(jdBlob)) {
    if (looksLikeMarketing(blob)) {
      score += 2;
      reasons.push("งานการตลาด/แบรนด์");
    }
  } else {
    const stackHits = STACK.filter((key) => blob.includes(key) && (!jdBlob || jdBlob.includes(key)));
    if (stackHits.length) {
      score += Math.min(1.5, stackHits.length * 0.5);
      reasons.push(`สแตก ${stackHits.slice(0, 3).join("/")}`);
    }
    const aiHits = AI_BITS.filter((key) => blob.includes(key));
    if (aiHits.length) {
      score += Math.min(2.5, aiHits.length);
      reasons.push(`AI ${aiHits.slice(0, 2).join("/")}`);
    }
    if (/\brag\b|\bmcp\b/.test(blob)) {
      score += 1;
      reasons.push("มี RAG/MCP");
    }
  }

  if (/senior|tech lead|\blead\b|architect/i.test(blob)) {
    score += 1;
    reasons.push("สัญญาณอาวุโส");
  }
  if (isJuniorCard(blob)) {
    score -= 2.5;
    reasons.push("ฝึกงาน/จูเนียร์");
  }
  if (thaiSignal(`${hit.displayName} ${hit.headline} ${hit.location ?? ""}`)) {
    score += 0.5;
    reasons.push("สัญญาณคนไทย/สื่อสารไทย");
  }
  if (/jailbreak|ios tweak|java trainer|html\/css/.test(blob)) {
    score -= 2.5;
    reasons.push("งานหลักไม่ตรงตำแหน่ง");
  }

  score = Math.max(1, Math.min(9.5, Math.round(score * 2) / 2));
  return {
    fitScore: score,
    kind,
    reason: reasons.length ? `คนสมัคร — ${reasons.join(" · ")}` : "คนสมัคร แต่หลักฐานในบัตรยังบาง",
  };
}

export function scoreLocally(hits: CandidateHit[], jd = ""): ScoredHit[] {
  return hits.map((hit) => {
    const extra = heuristicScore(hit, jd);
    return { ...hit, ...extra };
  });
}

const PAPER_SOURCES = new Set<SourceId>(["s2", "openalex", "dblp"]);

export type ScoutOrigin = "any" | "thai" | "foreign";

export function hitThai(hit: CandidateHit): boolean {
  const name = hit.displayName || "";
  if (looksCjkName(name)) return false;
  if (thaiSignal(name)) return true;
  if (
    /คนไทย|ชาวไทย|native to bangkok|native to thailand|i'?m thai|i am thai|คนกรุงเทพ/i.test(
      hit.headline || "",
    )
  ) {
    return true;
  }
  // LinkedIn in Thailand: Thai script first, English names are the fallback.
  if (hit.source === "linkedin" && (!hit.location || inThailand(hit.location))) return true;
  return false;
}

export function hasPublicLink(hit: CandidateHit): boolean {
  return /^https:\/\//i.test(hit.profileUrl || "");
}

const GEO_SOURCES = new Set<SourceId>(["linkedin", "github_th", "github_bkk", "apify_web"]);

export function isJobCandidate(hit: CandidateHit, jd = "", origin: ScoutOrigin = "any"): boolean {
  if (classifyHit(hit) !== "person") return false;
  if (!CANDIDATE_SOURCES.has(hit.source)) return false;
  if (!hasPublicLink(hit)) return false;
  if (PAPER_SOURCES.has(hit.source)) return false;
  if (looksCjkName(hit.displayName)) return false;
  const blob = `${hit.displayName} ${hit.headline} ${hit.location ?? ""}`.toLowerCase();
  const fromLinkedin = hit.source === "linkedin";
  if (fromLinkedin && hit.location && !inThailand(hit.location)) return false;
  if (!fromLinkedin && blob.length < 24) return false;
  const wantsBkk = /bangkok|กรุงเทพ|thailand|ไทย/i.test(jd);
  if (!GEO_SOURCES.has(hit.source) && wantsBkk && !/bangkok|กรุงเทพ|thailand|ไทย/.test(blob)) return false;
  if (wantsThai(jd) && !hitThai(hit)) return false;
  if (origin === "foreign" && hitThai(hit)) return false;
  return true;
}

export function hireableShortlist(
  scored: ScoredHit[],
  limit = SHORTLIST_MAX,
  jd = "",
  origin: ScoutOrigin = "any",
): ScoredHit[] {
  return scored
    .filter((hit) => isJobCandidate(hit, jd, origin) && hit.fitScore > 0)
    .sort((a, b) => {
      const li = (h: ScoredHit) => (h.source === "linkedin" ? 1 : 0);
      if (li(a) !== li(b)) return li(b) - li(a);
      const blob = (h: ScoredHit) => `${h.displayName} ${h.headline} ${h.location ?? ""}`;
      const craft = (h: ScoredHit) => (craftFitsJd(blob(h), jd) ? 1 : 0);
      if (craft(a) !== craft(b)) return craft(b) - craft(a);
      if (origin === "thai" || wantsThai(jd)) {
        const aThai = hitThai(a);
        const bThai = hitThai(b);
        if (aThai !== bThai) return aThai ? -1 : 1;
      }
      const rank = (h: ScoredHit) => {
        const text = `${h.headline} ${h.reason}`;
        let n = h.fitScore;
        if (isLooking(text)) n += 20;
        if (/\brag\b|\bmcp\b/i.test(text)) n += 8;
        else if (/llm|automation/i.test(text)) n += 3;
        if (isJuniorCard(text)) n -= 12;
        return n;
      };
      return rank(b) - rank(a);
    })
    .slice(0, limit);
}

export function peopleForModel(hits: CandidateHit[], limit = RANK_BATCH): CandidateHit[] {
  return hits
    .filter((hit) => classifyHit(hit) === "person")
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, limit);
}

export function overlayModelScores(local: ScoredHit[], items: RankItem[] | undefined): ScoredHit[] {
  const byId = new Map((items ?? []).map((item) => [item.externalId, item]));
  return local
    .map((hit) => {
      const ai = byId.get(hit.externalId);
      if (!ai || typeof ai.fitScore !== "number") return hit;
      return {
        ...hit,
        fitScore: clampScore(ai.fitScore),
        reason: ai.reason || hit.reason,
        kind: ai.kind ?? hit.kind,
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore || a.displayName.localeCompare(b.displayName));
}

function weight(hit: CandidateHit): number {
  const blob = `${hit.headline} ${hit.location ?? ""}`.toLowerCase();
  let n = 0;
  if (isLooking(blob)) n += 6;
  if (/\brag\b|\bmcp\b/.test(blob)) n += 4;
  if (/llm|automation|workflow/.test(blob)) n += 2;
  if (isJuniorCard(blob)) n -= 5;
  if (/senior|tech lead|\blead\b|architect/.test(blob)) n += 2;
  if (/bangkok|กรุงเทพ/.test(blob)) n += 2;
  if (/thailand|ไทย/.test(blob)) n += 1;
  if (/typescript|react|node/.test(blob)) n += 1;
  return n;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 2) / 2));
}
