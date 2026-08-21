import type { OfficialLink } from "./links";
import { groupFor, type SourceGroupId, type SourceMode } from "./modes";
import type { SourceStatus } from "./types";

export type LaneId = "live" | "hr_click" | "blocked";

export type SourceCard = {
  id: string;
  label: string;
  lane: LaneId;
  status: SourceStatus | "link_only";
  family: string;
  why: string;
  url?: string;
  count?: number;
};

export type SourceLanes = {
  live: SourceCard[];
  hr_click: SourceCard[];
  blocked: SourceCard[];
};

export const SOURCE_ANALYSIS = {
  headline: "LinkedIn ดึงผ่าน Apify เมื่อมีคีย์ · ไม่ใช้คุกกี้",
  body: "LinkedIn ใช้ตัวค้นโปรไฟล์ในรายการอนุญาตผ่าน Apify เท่านั้น ไม่ดึงเอง ไม่รับคุกกี้ และไม่ส่งหน้าค้นให้ HR กด. แหล่งไทย (GitHub, DevHub, ชุมชนเปิด) ดึงด้วย API สาธารณะ. ค้นเว็บสาธารณะครอบคลุม GitHub / HF / GitLab / DEV / DevHub / Kaggle / Speaker Deck / Codeberg. JobsDB / JobThai / JobBKK เป็นลิงก์สมัครเข้า ไม่ดึงรายชื่อ. Facebook ไม่ดึง.",
};

export function analysisFor(modes?: Record<SourceGroupId, SourceMode>): typeof SOURCE_ANALYSIS {
  const li = modes?.linkedin ?? "shop";
  if (li === "off") {
    return {
      headline: "LinkedIn ปิด · แหล่งไทยดึงเอง",
      body: SOURCE_ANALYSIS.body,
    };
  }
  return SOURCE_ANALYSIS;
}

type Meta = { label: string; family: string; why: string };

const META: Record<string, Meta> = {
  github: { label: "GitHub ผู้ใช้", family: "code", why: "GitHub Search API สาธารณะ" },
  github_repos: { label: "GitHub รีโป", family: "code", why: "ค้นรีโปสาธารณะ แล้วเก็บเจ้าของ" },
  github_th: { label: "GitHub ไทย", family: "code", why: "location:Thailand บน Search API" },
  github_bkk: { label: "GitHub กรุงเทพ", family: "code", why: "location:Bangkok บน Search API" },
  github_langchain: { label: "GitHub LangChain", family: "code", why: "ค้นรีโป topic สาธารณะ" },
  gitlab: { label: "GitLab ผู้ใช้", family: "code", why: "GitLab REST ผู้ใช้สาธารณะ" },
  gitlab_projects: { label: "GitLab โปรเจกต์", family: "code", why: "GitLab projects API สาธารณะ" },
  huggingface: { label: "Hugging Face", family: "code", why: "Hub models API สาธารณะ" },
  hf_spaces: { label: "HF Spaces", family: "code", why: "Hub spaces API สาธารณะ" },
  npm: { label: "npm", family: "packages", why: "registry search สาธารณะ" },
  pypi: { label: "PyPI", family: "packages", why: "JSON ของแพ็กเกจสาธารณะ" },
  crates: { label: "crates.io", family: "packages", why: "API เจ้าของคราทสาธารณะ" },
  rubygems: { label: "RubyGems", family: "packages", why: "search.json สาธารณะ" },
  packagist: { label: "Packagist", family: "packages", why: "search.json ของ Composer" },
  hex: { label: "Hex", family: "packages", why: "hex.pm API สาธารณะ" },
  pubdev: { label: "pub.dev", family: "packages", why: "Dart pub API สาธารณะ" },
  openvsx: { label: "Open VSX", family: "packages", why: "ตลาดส่วนขยายสาธารณะ" },
  stackoverflow: { label: "Stack Overflow", family: "community", why: "Stack Exchange API" },
  stack_ai: { label: "Stack AI", family: "community", why: "AI site บน Stack Exchange API" },
  stack_ds: { label: "Stack Data", family: "community", why: "Data Science site บน Stack Exchange API" },
  devto: { label: "DEV", family: "community", why: "dev.to articles API สาธารณะ" },
  devhub: {
    label: "DevHub",
    family: "community",
    why: "ไดเรกทอรีสาธารณะที่ทำไว้ให้ค้นคนหางาน · robots.txt อนุญาตให้ครอว์ลทั้งไซต์ (Allow: /) · ดึงเฉพาะหน้าโปรไฟล์ที่เปิด ไม่เก็บอีเมล",
  },
  hn: { label: "Hacker News", family: "community", why: "Algolia HN API สาธารณะ — รวม SEEKING WORK + RAG/MCP" },
  reddit: { label: "Reddit", family: "community", why: "JSON สาธารณะ ปริมาณต่ำ — ขยายต้องขอ API" },
  lobsters: { label: "Lobsters", family: "community", why: "search.json สาธารณะ" },
  hf_forum: { label: "HF Forum", family: "community", why: "Discourse search.json สาธารณะ" },
  openai_forum: { label: "OpenAI Forum", family: "community", why: "Discourse search.json สาธารณะ" },
  dblp: { label: "DBLP", family: "research", why: "author API งานวิจัยสาธารณะ" },
  s2: { label: "Semantic Scholar", family: "research", why: "paper/author API สาธารณะ" },
  openalex: { label: "OpenAlex", family: "research", why: "works API สาธารณะ" },
  apify_web: {
    label: "ค้นสาธารณะ",
    family: "community",
    why: "ผู้ให้บริการที่อนุญาตเฉพาะเว็บเปิด (GitHub, HF, GitLab, DEV, DevHub, Kaggle, Speaker Deck, Codeberg) — ไม่ดึง Facebook / บอร์ดสมัคร",
  },
  linkedin: {
    label: "LinkedIn People",
    family: "people",
    why: "ดึงโปรไฟล์สาธารณะผ่าน Apify เท่านั้น · ไม่ใช้คุกกี้",
  },
  jobsdb_people: {
    label: "JobsDB People",
    family: "people",
    why: "หน้า People Search ทางการ — HR กดเอง ไม่ดึงโปรไฟล์",
  },
  jobthai_resume: {
    label: "JobThai ค้นประวัติ",
    family: "people",
    why: "ค้นเรซูเม่ฝั่งนายจ้าง — ต้องลงชื่อ ไม่ดึงเข้าเอนจิน",
  },
  jobbkk_resume: {
    label: "JobBKK Resume Search",
    family: "people",
    why: "Resume Search Talent ทางการ — ต้องลงชื่อ ไม่ดึงเข้าเอนจิน",
  },
  hosco: {
    label: "Hosco",
    family: "people",
    why: "ไดเรกทอรีคนโรงแรม — HR เปิดเอง robots บล็อก /members",
  },
  jobtopgun: {
    label: "JobTOPGUN",
    family: "people",
    why: "บอร์ดไทย + SuperResume — เปิดหน้าทางการให้ HR",
  },
  seek_talent: {
    label: "SEEK Talent Search",
    family: "people",
    why: "ช่องทางนายจ้างของครอบครัว JobsDB — ใช้ตามสัญญา ไม่ดึง",
  },
  facebook: {
    label: "Facebook",
    family: "walled",
    why: "กำแพงล็อกอิน ไม่มี Graph API สำหรับค้นคนสมัครงานแบบนี้",
  },
  jobsdb: { label: "JobsDB ใบงาน", family: "jobs", why: "บอร์ดสมัครเข้า — ไม่ดึงรายชื่อจากประกาศ" },
  jobthai: { label: "JobThai ใบงาน", family: "jobs", why: "บอร์ดสมัครเข้า — ไม่ดึงรายชื่อจากประกาศ" },
  jobbkk: { label: "JobBKK ใบงาน", family: "jobs", why: "บอร์ดสมัครเข้า — ไม่ดึงรายชื่อจากประกาศ" },
  meetup: { label: "Meetup / GDG", family: "events", why: "หน้าค้นทางการ ไม่ดึงรายชื่อสมาชิก" },
  wellfound: { label: "Wellfound", family: "jobs", why: "ต้องล็อกอินถึงเห็นโปรไฟล์" },
  x: { label: "X", family: "walled", why: "ไม่มี API ค้นคนฟรีที่ถูกสัญญา" },
  blognone: { label: "Blognone", family: "community", why: "ค้นผ่าน Google site: ไม่ดึงโปรไฟล์" },
  sessionize: { label: "Sessionize", family: "events", why: "หน้าค้นสปีกเกอร์ทางการ" },
  gdg: { label: "GDG Bangkok", family: "events", why: "หน้าชมรมทางการ" },
  thaiprogrammer: { label: "Thai Programmer", family: "community", why: "ค้นผ่าน Google site: ไม่ดึงโปรไฟล์" },
  codeberg: { label: "Codeberg", family: "code", why: "หน้าค้นผู้ใช้ทางการ ไม่มีโทเคนของเรา" },
  remoteok: { label: "RemoteOK", family: "jobs", why: "หน้าประกาศงาน ไม่ดึงผู้สมัคร" },
  remotive: { label: "Remotive", family: "jobs", why: "หน้าประกาศงาน ไม่ดึงผู้สมัคร" },
  weworkremotely: { label: "We Work Remotely", family: "jobs", why: "หน้าประกาศงาน ไม่ดึงผู้สมัคร" },
  hnjobs: { label: "HN Who is hiring", family: "jobs", why: "หน้าค้นกระทู้จ้างงาน" },
  redditjobs: { label: "Reddit forhire", family: "jobs", why: "หน้าค้น subreddit ไม่ดึง inbox" },
  medium: { label: "Medium", family: "community", why: "หน้าค้นทางการ ไม่ดึงโปรไฟล์ลับ" },
  langchainhub: { label: "LangChain Hub", family: "code", why: "หน้าค้น prompt สาธารณะ" },
  mcpgithub: { label: "Awesome MCP", family: "code", why: "หน้าค้นรีโป GitHub ทางการ" },
  kaggle: { label: "Kaggle", family: "research", why: "หน้าค้นทางการ — โปรไฟล์เปิดมาทางผู้ให้บริการ" },
  speakerdeck: { label: "Speaker Deck", family: "events", why: "สไลด์สปีกเกอร์สาธารณะ — โปรไฟล์เปิดมาทางผู้ให้บริการ" },
  paperswithcode: { label: "Papers with Code", family: "research", why: "หน้าค้นทางการ — author API ใช้ไม่ได้" },
};

export function sourceLabel(id: string): string {
  return META[id]?.label ?? id.replaceAll("_", " ");
}

export function sourceWhy(id: string): string {
  return META[id]?.why ?? "แหล่งภายนอก";
}

function card(
  id: string,
  lane: LaneId,
  status: SourceCard["status"],
  url?: string,
  count?: number,
): SourceCard {
  const meta = META[id] ?? { label: sourceLabel(id), family: "other", why: sourceWhy(id) };
  const row: SourceCard = {
    id,
    label: meta.label,
    lane,
    status,
    family: meta.family,
    why: meta.why,
  };
  if (url) row.url = url;
  if (typeof count === "number") row.count = count;
  return row;
}

function laneOf(
  adapter: { id: string; status: SourceStatus },
  modes?: Record<SourceGroupId, SourceMode>,
): LaneId {
  if (adapter.status === "live") return "live";
  if (modes) {
    const group = groupFor(adapter.id);
    if (group && modes[group] === "link") return "hr_click";
  }
  return "blocked";
}

export function buildSourceLanes(input: {
  adapters: Array<{ id: string; status: SourceStatus }>;
  links?: OfficialLink[];
  counts?: Record<string, number>;
  modes?: Record<SourceGroupId, SourceMode>;
}): { lanes: SourceLanes; analysis: typeof SOURCE_ANALYSIS } {
  const links = input.links ?? [];
  const urlById = new Map(links.map((item) => [item.id, item.url]));
  const seen = new Set<string>();
  const live: SourceCard[] = [];
  const blocked: SourceCard[] = [];
  const hrClick: SourceCard[] = [];

  const liMode = input.modes?.linkedin ?? "shop";
  for (const adapter of input.adapters) {
    seen.add(adapter.id);
    const lane = laneOf(adapter, input.modes);
    const url = adapter.id === "linkedin" && liMode !== "link" ? undefined : urlById.get(adapter.id);
    const next = card(adapter.id, lane, adapter.status, url, input.counts?.[adapter.id]);
    if (lane === "live") live.push(next);
    else if (lane === "hr_click") hrClick.push(next);
    else blocked.push(next);
  }

  for (const link of links) {
    if (seen.has(link.id)) continue;
    if (link.id === "linkedin" && liMode !== "link") continue;
    seen.add(link.id);
    hrClick.push(card(link.id, "hr_click", "link_only", link.url));
  }

  return {
    lanes: { live, hr_click: hrClick, blocked },
    analysis: analysisFor(input.modes),
  };
}

export function laneHas(lanes: SourceLanes, id: string): LaneId | null {
  if (lanes.live.some((row) => row.id === id)) return "live";
  if (lanes.hr_click.some((row) => row.id === id)) return "hr_click";
  if (lanes.blocked.some((row) => row.id === id)) return "blocked";
  return null;
}
