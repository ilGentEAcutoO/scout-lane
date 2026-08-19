import { firstPersonalUrl } from "./engine";
import type { CandidateHit, SourceAdapter } from "./types";

const UA = { accept: "text/html", "user-agent": "scout-lane" };
const SKIP = new Set(["roles", "list", "register", "privacy", "terms"]);

export type DevhubListRow = { slug: string; name: string };

export function parseDevhubList(html: string): DevhubListRow[] {
  const rows: DevhubListRow[] = [];
  const seen = new Set<string>();
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let block: RegExpExecArray | null;
  while ((block = ld.exec(html))) {
    const json = block[1];
    if (!json) continue;
    const items = [
      ...json.matchAll(
        /"name"\s*:\s*"([^"]+)"[\s\S]{0,180}?"url"\s*:\s*"https:\/\/devhub\.in\.th\/(?:en|th)\/developers\/([^"/]+)\/"/gi,
      ),
    ];
    for (const item of items) {
      const slug = item[2]?.toLowerCase();
      const name = item[1];
      if (!slug || !name || SKIP.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      rows.push({ slug, name });
    }
  }
  if (!rows.length) {
    for (const match of html.matchAll(/devhub\.in\.th\/(?:en|th)\/developers\/([a-zA-Z0-9_.-]+)\//g)) {
      const slug = match[1]?.toLowerCase();
      if (!slug || SKIP.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      rows.push({ slug, name: slug });
    }
  }
  return rows;
}

export function parseDevhubProfile(html: string, slug: string): (CandidateHit & { looking: boolean }) | null {
  if (/ยังไม่พร้อมรับงาน|not currently available/i.test(html)) return null;
  const looking = /<span>\s*Open to Work\s*<\/span>|เปิดรับงาน/i.test(html) && !/not open to work/i.test(html);
  if (!looking) return null;
  const name =
    /<h1[^>]*>([^<]{2,80})<\/h1>/i.exec(html)?.[1]?.trim() ||
    /<title>([^<|–—-]{2,80})/i.exec(html)?.[1]?.trim() ||
    slug;
  const role = /(full[\s-]?stack|front-?end|back-?end|ai\/ml|devops|tech lead)/i.exec(html)?.[1] || "developer";
  const years = /(lead \(10\+|senior \(6-9|mid-level \(3-5|junior \(1-2)/i.exec(html)?.[1] || "";
  const portfolioHref = /href="(https?:\/\/[^"]+)"[^>]*>\s*Portfolio/i.exec(html)?.[1];
  const portfolioUrl = portfolioHref ? firstPersonalUrl(portfolioHref) : null;
  const host = portfolioUrl ? new URL(portfolioUrl).hostname.replace(/^www\./, "") : "";
  return {
    source: "devhub",
    externalId: `devhub:${slug}`,
    displayName: name.replace(/\s+/g, " "),
    headline: [role, years, "Open to Work", host ? `พอร์ต ${host}` : ""].filter(Boolean).join(" · ").slice(0, 220),
    profileUrl: `https://devhub.in.th/en/developers/${encodeURIComponent(slug)}/`,
    location: "Thailand",
    kind: "person",
    looking: true,
    ...(portfolioUrl ? { portfolioUrl } : {}),
  };
}

const LISTS = [
  "https://devhub.in.th/en/developers/roles/ai-ml-engineers/",
  "https://devhub.in.th/en/developers/roles/full-stack-developers/",
  "https://devhub.in.th/en/developers/roles/full-stack-developers/?page=2",
  "https://devhub.in.th/en/developers/roles/full-stack-developers/?page=3",
  "https://devhub.in.th/en/developers/roles/frontend-developers/",
  "https://devhub.in.th/en/developers/roles/frontend-developers/?page=2",
  "https://devhub.in.th/en/developers/roles/backend-developers/",
];

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return "";
  return res.text();
}

export const devhubAdapter: SourceAdapter = {
  id: "devhub",
  status: "live",
  async search() {
    const pages = await Promise.all(LISTS.map((url) => getText(url)));
    const listed: DevhubListRow[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      for (const row of parseDevhubList(page)) {
        if (seen.has(row.slug)) continue;
        seen.add(row.slug);
        listed.push(row);
      }
    }
    const hits: CandidateHit[] = [];
    const queue = listed.slice(0, 36);
    const chunk = 4;
    for (let i = 0; i < queue.length; i += chunk) {
      const batch = await Promise.all(
        queue.slice(i, i + chunk).map(async (row) => {
          const html = await getText(`https://devhub.in.th/en/developers/${encodeURIComponent(row.slug)}/`);
          const parsed = html ? parseDevhubProfile(html, row.slug) : null;
          if (!parsed) return null;
          if (parsed.displayName === row.slug && row.name) parsed.displayName = row.name;
          return parsed;
        }),
      );
      for (const hit of batch) {
        if (!hit) continue;
        const { looking: _looking, ...card } = hit;
        hits.push(card);
      }
    }
    const rank = (h: CandidateHit) => {
      const t = h.headline.toLowerCase();
      if (/lead \(10/.test(t) || /senior \(6/.test(t)) return 3;
      if (/mid-level \(3/.test(t)) return 2;
      if (/junior/.test(t)) return 0;
      return 1;
    };
    return hits.sort((a, b) => rank(b) - rank(a)).slice(0, 20);
  },
};
