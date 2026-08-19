import { firstPersonalUrl, inThailand, looksLikeEngineer, parseSeeking } from "./engine";
import type { CandidateHit, SourceAdapter } from "./types";

const UA = { accept: "application/json", "user-agent": "scout-lane" };

async function getJson(url: string, extra: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { ...UA, ...extra } });
  if (!res.ok) return null;
  return res.json();
}

function tokens(query: string): string {
  return query.replace(/location:\S+/gi, "").trim() || "MCP RAG";
}

export const githubReposAdapter: SourceAdapter = {
  id: "github_repos",
  status: "live",
  async search(query, env) {
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", `${tokens(query)} language:TypeScript`);
    url.searchParams.set("sort", "stars");
    url.searchParams.set("per_page", "8");
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "scout-lane",
      "x-github-api-version": "2022-11-28",
    };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const body = (await getJson(url.toString(), headers)) as {
      items?: Array<{
        full_name?: string;
        description?: string;
        html_url?: string;
        owner?: { login?: string; html_url?: string; id?: number; type?: string };
      }>;
    } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const repo of body?.items ?? []) {
      const login = repo.owner?.login;
      if (!login || seen.has(login) || repo.owner?.type === "Organization") continue;
      seen.add(login);
      hits.push({
        source: "github_repos",
        externalId: `repo:${login}`,
        displayName: login,
        headline: [repo.full_name, repo.description].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: repo.owner?.html_url || `https://github.com/${login}`,
        location: null,
      });
    }
    return hits.slice(0, 6);
  },
};

export const devtoAdapter: SourceAdapter = {
  id: "devto",
  status: "live",
  async search(query) {
    const tag = /\bmcp\b/i.test(query) ? "ai" : /\brag\b/i.test(query) ? "ai" : "typescript";
    const body = (await getJson(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=20`)) as Array<{
      user?: { username?: string; name?: string };
    }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const row of body) {
      const user = row.user?.username;
      if (!user || seen.has(user)) continue;
      seen.add(user);
      const profile = (await getJson(`https://dev.to/api/users/by_username?url=${encodeURIComponent(user)}`)) as {
        name?: string;
        username?: string;
        summary?: string;
        location?: string;
        looking_for_work?: boolean;
        website_url?: string;
      } | null;
      const loc = profile?.location || null;
      const looking = Boolean(profile?.looking_for_work);
      const near = /bangkok|thailand|ไทย|กรุงเทพ/i.test(`${loc} ${profile?.summary || ""}`);
      if (!looking && !near) continue;
      const portfolioUrl = profile?.website_url ? firstPersonalUrl(profile.website_url) : null;
      hits.push({
        source: "devto",
        externalId: `devto:${user}`,
        displayName: profile?.name || row.user?.name || user,
        headline: [profile?.summary, looking ? "open to work" : "", portfolioUrl ? `พอร์ต ${new URL(portfolioUrl).hostname}` : ""]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 220) || "DEV profile",
        profileUrl: `https://dev.to/${user}`,
        location: loc,
        kind: "person",
        ...(portfolioUrl ? { portfolioUrl } : {}),
      });
      if (hits.length >= 8) break;
    }
    return hits;
  },
};

export const HN_SEEKING_QUERIES = [
  "SEEKING WORK Bangkok",
  "SEEKING WORK Thailand",
  "SEEKING WORK TypeScript Bangkok",
  "SEEKING WORK native to Bangkok",
  "SEEKING WORK Thailand RAG",
  "SEEKING WORK MCP Thailand",
  "SEEKING WORK AI Thailand",
];

export const hnAdapter: SourceAdapter = {
  id: "hn",
  status: "live",
  async search() {
    const queries = HN_SEEKING_QUERIES;
    const batches = await Promise.all(
      queries.map((q) =>
        getJson(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=comment&hitsPerPage=12`,
        ) as Promise<{ hits?: Array<{ author?: string; comment_text?: string; objectID?: string; story_url?: string }> } | null>,
      ),
    );
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const body of batches) {
      for (const row of body?.hits ?? []) {
        const author = row.author;
        if (!author || author === "whoishiring" || seen.has(author)) continue;
        const parsed = parseSeeking(row.comment_text || "");
        if (!parsed.looking) continue;
        const blob = `${parsed.location} ${parsed.headline} ${row.comment_text}`;
        if (!inThailand(blob)) continue;
        if (!looksLikeEngineer(blob)) continue;
        const native = /native to bangkok|native to thailand|i'?m thai|คนไทย|ชาวไทย/i.test(row.comment_text || "");
        const headline = native ? `${parsed.headline} · คนไทย`.slice(0, 220) : parsed.headline;
        seen.add(author);
        hits.push({
          source: "hn",
          externalId: `hn:${author}`,
          displayName: author,
          headline,
          profileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(author)}`,
          location: parsed.location,
          kind: "person",
          ...(parsed.portfolioUrl ? { portfolioUrl: parsed.portfolioUrl } : {}),
        });
      }
    }
    return hits.slice(0, 12);
  },
};

export const redditAdapter: SourceAdapter = {
  id: "reddit",
  status: "live",
  async search(query) {
    const q = tokens(query).split(/\s+/).slice(0, 4).join(" ");
    const body = (await getJson(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=12&sort=relevance`,
      { accept: "application/json" },
    )) as {
      data?: { children?: Array<{ data?: { author?: string; title?: string; permalink?: string } }> };
    } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const child of body?.data?.children ?? []) {
      const author = child.data?.author;
      if (!author || author === "[deleted]" || author === "AutoModerator" || seen.has(author)) continue;
      seen.add(author);
      hits.push({
        source: "reddit",
        externalId: `reddit:${author}`,
        displayName: author,
        headline: child.data?.title || "Reddit post",
        profileUrl: `https://www.reddit.com/user/${encodeURIComponent(author)}`,
        location: null,
      });
    }
    return hits.slice(0, 6);
  },
};
