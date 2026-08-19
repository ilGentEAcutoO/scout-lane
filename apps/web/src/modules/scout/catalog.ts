import type { OfficialLink } from "./links";
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
  headline: "LinkedIn ไม่ดึง — เปิด People Search ให้ HR กดเอง · ร้านขูดใช้ได้แค่เว็บเปิด",
  body: "ไม่มี People Search API สาธารณะ และข้อตกลงของ LinkedIn/Facebook ห้ามดึงโปรไฟล์. JobsDB People / JobThai ค้นประวัติ / JobBKK Resume / Hosco / JobTOPGUN / SEEK Talent เป็นลิงก์ทางการให้ HR เปิดเอง ไม่ดึงเข้าเอนจิน. ใบงาน JobsDB JobThai JobBKK เป็นบอร์ดสมัครเข้า ไม่ดึงรายชื่อจากประกาศ. ช่องฟรีแลนซ์ (Fastwork, Behance, Dribbble) ไม่ใช่เป้าหมาย HR. ที่ดึงคือ GitHub, HN SEEKING WORK, Dev.to, DevHub (โปรไฟล์เปิด), GitLab, Stack Exchange และร้านขูดเฉพาะโฮสต์สาธารณะเมื่อมีคีย์.",
};

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
    label: "ร้านค้นสาธารณะ",
    family: "community",
    why: "ร้านขูดที่อนุญาตเฉพาะเว็บเปิด (GitHub, HF, GitLab, DEV, DevHub) — ไม่ดึง LinkedIn / Facebook / บอร์ดสมัคร",
  },
  linkedin: {
    label: "LinkedIn People",
    family: "people",
    why: "ไม่มี People Search API สาธารณะ และข้อตกลงห้ามดึงโปรไฟล์ — เปิดหน้าค้นให้ HR",
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
  kaggle: { label: "Kaggle", family: "research", why: "หน้าค้นทางการ ไม่ดึงโปรไฟล์ผ่าน API ของเรา" },
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

export function buildSourceLanes(input: {
  adapters: Array<{ id: string; status: SourceStatus }>;
  links?: OfficialLink[];
  counts?: Record<string, number>;
}): { lanes: SourceLanes; analysis: typeof SOURCE_ANALYSIS } {
  const links = input.links ?? [];
  const urlById = new Map(links.map((item) => [item.id, item.url]));
  const seen = new Set<string>();
  const live: SourceCard[] = [];
  const blocked: SourceCard[] = [];
  const hrClick: SourceCard[] = [];

  for (const adapter of input.adapters) {
    seen.add(adapter.id);
    const next = card(
      adapter.id,
      adapter.status === "live" ? "live" : "blocked",
      adapter.status,
      urlById.get(adapter.id),
      input.counts?.[adapter.id],
    );
    if (adapter.status === "live") live.push(next);
    else blocked.push(next);
  }

  for (const link of links) {
    if (seen.has(link.id)) continue;
    seen.add(link.id);
    hrClick.push(card(link.id, "hr_click", "link_only", link.url));
  }

  return {
    lanes: { live, hr_click: hrClick, blocked },
    analysis: SOURCE_ANALYSIS,
  };
}

export function laneHas(lanes: SourceLanes, id: string): LaneId | null {
  if (lanes.live.some((row) => row.id === id)) return "live";
  if (lanes.hr_click.some((row) => row.id === id)) return "hr_click";
  if (lanes.blocked.some((row) => row.id === id)) return "blocked";
  return null;
}
