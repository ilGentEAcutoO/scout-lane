import { apifySecretFor, linkedinShopAdapter, withVendorStatus } from "./apify";
import type { SourceAdapter, SourceId, SourceStatus } from "./types";

export const SOURCE_MODES = ["self", "shop", "link", "off"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

export const SOURCE_GROUPS = ["thai_code", "community", "apify_web", "linkedin", "job_boards"] as const;
export type SourceGroupId = (typeof SOURCE_GROUPS)[number];

export const GROUP_IDS: Record<SourceGroupId, SourceId[]> = {
  thai_code: [
    "github",
    "github_repos",
    "github_th",
    "github_bkk",
    "github_langchain",
    "gitlab",
    "gitlab_projects",
    "huggingface",
    "hf_spaces",
    "npm",
    "pypi",
    "crates",
    "rubygems",
    "packagist",
    "hex",
    "pubdev",
    "openvsx",
  ],
  community: [
    "devto",
    "devhub",
    "hn",
    "reddit",
    "stackoverflow",
    "stack_ai",
    "stack_ds",
    "lobsters",
    "hf_forum",
    "openai_forum",
    "dblp",
    "s2",
    "openalex",
  ],
  apify_web: ["apify_web"],
  linkedin: ["linkedin"],
  job_boards: ["jobsdb", "jobthai", "jobbkk"],
};

export const GROUP_LABELS: Record<SourceGroupId, string> = {
  thai_code: "GitHub / GitLab / คนบนโค้ด",
  community: "DevHub / HN / Stack / ชุมชนเปิด",
  apify_web: "ค้นเว็บสาธารณะ",
  linkedin: "LinkedIn People",
  job_boards: "JobsDB / JobThai / JobBKK",
};

export const GROUP_SHORT: Record<SourceGroupId, string> = {
  thai_code: "GitHub",
  community: "ชุมชน",
  apify_web: "เว็บเปิด",
  linkedin: "LinkedIn",
  job_boards: "บอร์ดงาน",
};

export const GROUP_HINTS: Record<SourceGroupId, string> = {
  thai_code: "ดึงโปรไฟล์สาธารณะจาก GitHub, GitLab, Hugging Face และแพ็กเกจ npm / PyPI / crates",
  community: "ดึงจาก Dev.to, DevHub, Hacker News, Stack Overflow, Reddit และฟอรัมเปิด",
  apify_web: "ต้องมีคีย์ Apify ถึงจะเปิดได้ · ค้นโฮสต์สาธารณะอย่าง Kaggle, Speaker Deck, Codeberg",
  linkedin: "ต้องมีคีย์ Apify ถึงจะเปิด LinkedIn ได้ · ดึงโปรไฟล์สาธารณะผ่าน Apify ไม่ใช้คุกกี้",
  job_boards: "เปิดประกาศ JobsDB / JobThai / JobBKK ให้สมัครเอง — ไม่ดึงรายชื่อจากบอร์ด",
};

export const GROUP_ALLOWED: Record<SourceGroupId, SourceMode[]> = {
  thai_code: ["self", "off"],
  community: ["self", "off"],
  apify_web: ["shop", "off"],
  linkedin: ["shop", "off"],
  job_boards: ["link", "off"],
};

export const MODE_LABELS: Record<SourceMode, string> = {
  self: "ดึงเอง",
  shop: "ผู้ให้บริการ",
  link: "เปิดลิงก์ให้ HR",
  off: "ปิด",
};

export const DEFAULT_MODES: Record<SourceGroupId, SourceMode> = {
  thai_code: "self",
  community: "self",
  apify_web: "shop",
  linkedin: "shop",
  job_boards: "link",
};

const ID_TO_GROUP = new Map<string, SourceGroupId>();
for (const group of SOURCE_GROUPS) {
  for (const id of GROUP_IDS[group]) ID_TO_GROUP.set(id, group);
}

export function groupFor(id: string): SourceGroupId | null {
  return ID_TO_GROUP.get(id) ?? null;
}

export function normalizeModes(raw: unknown): Record<SourceGroupId, SourceMode> {
  const out = { ...DEFAULT_MODES };
  if (!raw || typeof raw !== "object") return out;
  for (const group of SOURCE_GROUPS) {
    const value = (raw as Record<string, unknown>)[group];
    if (typeof value !== "string") continue;
    if ((GROUP_ALLOWED[group] as string[]).includes(value)) out[group] = value as SourceMode;
  }
  return out;
}

export function parseModesJson(text: string | null | undefined): Record<SourceGroupId, SourceMode> {
  if (!text) return { ...DEFAULT_MODES };
  try {
    return normalizeModes(JSON.parse(text));
  } catch {
    return { ...DEFAULT_MODES };
  }
}

export function modeFor(id: string, modes: Record<SourceGroupId, SourceMode>): SourceMode {
  const group = groupFor(id);
  return group ? modes[group] : "off";
}

export function statusForMode(
  id: string,
  mode: SourceMode,
  hasToken: boolean,
  current: SourceStatus,
): SourceStatus {
  if (mode === "off") return "inbound_only";
  if (mode === "link") return id === "jobsdb" || id === "jobthai" || id === "jobbkk" ? "inbound_only" : "needs_authorization";
  if (mode === "shop") return hasToken ? "live" : "needs_authorization";
  return current === "live" ? "live" : current;
}

export function applySourceModes(
  adapters: SourceAdapter[],
  modes: Record<SourceGroupId, SourceMode>,
  opts: { hasToken: boolean; shopLinkedin: SourceAdapter },
): SourceAdapter[] {
  return adapters.map((row) => {
    const mode = modeFor(row.id, modes);
    if (row.id === "linkedin" && mode === "shop") {
      return { ...opts.shopLinkedin, status: statusForMode(row.id, mode, opts.hasToken, row.status) };
    }
    return { ...row, status: statusForMode(row.id, mode, opts.hasToken, row.status) };
  });
}

export const SOURCE_MODES_KEY = "scout.source_modes";

export async function loadSourceModes(env: Env): Promise<Record<SourceGroupId, SourceMode>> {
  const row = await env.DB_MAIN.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(SOURCE_MODES_KEY)
    .first<{ value: string }>();
  return parseModesJson(row?.value);
}

export function onModeFor(group: SourceGroupId, _hasToken = false): SourceMode {
  const allowed = GROUP_ALLOWED[group];
  if (allowed.includes("self")) return "self";
  if (allowed.includes("shop")) return "shop";
  if (allowed.includes("link")) return "link";
  return "off";
}

export function shopGroups(): SourceGroupId[] {
  return SOURCE_GROUPS.filter((group) => GROUP_ALLOWED[group].includes("shop"));
}

export function clampShopModes(
  modes: Record<SourceGroupId, SourceMode>,
  hasToken: boolean,
): Record<SourceGroupId, SourceMode> {
  if (hasToken) return { ...modes };
  const next = { ...modes };
  for (const group of shopGroups()) next[group] = "off";
  return next;
}

export function readyFromModes(
  env: Env,
  adapters: SourceAdapter[],
  modes: Record<SourceGroupId, SourceMode>,
  shopToken?: string,
): { ready: SourceAdapter[]; modes: Record<SourceGroupId, SourceMode>; hasToken: boolean } {
  const hasToken = Boolean((shopToken ?? env.APIFY_TOKEN)?.trim());
  const next = normalizeModes(modes);
  const ready = applySourceModes(withVendorStatus(adapters, env), next, {
    hasToken,
    shopLinkedin: linkedinShopAdapter,
  });
  return { ready, modes: next, hasToken };
}

export async function readyAdapters(
  env: Env,
  adapters: SourceAdapter[],
): Promise<{ ready: SourceAdapter[]; modes: Record<SourceGroupId, SourceMode>; hasToken: boolean }> {
  const { key } = await apifySecretFor(env);
  return readyFromModes(env, adapters, await loadSourceModes(env), key);
}

export async function saveSourceModes(env: Env, modes: Record<SourceGroupId, SourceMode>): Promise<void> {
  const next = normalizeModes(modes);
  await env.DB_MAIN.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(SOURCE_MODES_KEY, JSON.stringify(next))
    .run();
}
