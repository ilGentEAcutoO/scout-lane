import { isPersonalSite } from "./engine";
import type { CandidateHit, SourceAdapter } from "./types";

export function githubHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "scout-lane",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

let githubTail: Promise<unknown> = Promise.resolve();

export function githubQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = githubTail.then(fn, fn);
  githubTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readGithubUser(
  url: string,
  headers: Record<string, string>,
): Promise<{ headline: string; location: string | null; kind: "person" | "org"; portfolioUrl: string | null }> {
  const profile = await fetch(url, { headers });
  if (!profile.ok) return { headline: "GitHub public profile", location: null, kind: "person", portfolioUrl: null };
  const user = (await profile.json()) as {
    bio?: string | null;
    location?: string | null;
    name?: string | null;
    hireable?: boolean | null;
    type?: string;
    blog?: string | null;
  };
  const portfolioUrl = user.blog && isPersonalSite(user.blog.startsWith("http") ? user.blog : `https://${user.blog}`)
    ? user.blog.startsWith("http")
      ? user.blog
      : `https://${user.blog}`
    : null;
  const host = portfolioUrl ? new URL(portfolioUrl).hostname.replace(/^www\./, "") : "";
  const headline =
    [user.name, user.bio, user.hireable ? "open to work" : "", host ? `พอร์ต ${host}` : ""]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 220) || "GitHub public profile";
  return {
    headline,
    location: user.location ?? null,
    kind: user.type === "Organization" ? "org" : "person",
    portfolioUrl,
  };
}

async function searchUsers(query: string, headers: Record<string, string>) {
  const url = new URL("https://api.github.com/search/users");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "30");
  const res = await fetch(url, { headers });
  if (!res.ok) return [] as Array<{ id: number; login: string; html_url: string; url: string; type?: string }>;
  const body = (await res.json()) as {
    items?: Array<{ id: number; login: string; html_url: string; url: string; type?: string }>;
  };
  return body.items ?? [];
}

export const githubAdapter: SourceAdapter = {
  id: "github",
  status: "live",
  async search(query, env) {
    const headers = githubHeaders(env);

    const items = await githubQueue(() => searchUsers(query, headers));
    if (items.length < 4 && !/location:/i.test(query)) {
      const extra = await githubQueue(() => searchUsers("location:Bangkok language:TypeScript", headers));
      const seen = new Set(items.map((i) => i.id));
      for (const row of extra) {
        if (seen.has(row.id)) continue;
        items.push(row);
        if (items.length >= 30) break;
      }
    }

    const hits: CandidateHit[] = [];
    for (const item of items) {
      if (item.type === "Organization") continue;
      let headline = "GitHub public profile";
      let location: string | null = null;
      let kind: "person" | "org" = "person";
      let portfolioUrl: string | undefined;
      try {
        const profile = await githubQueue(() => readGithubUser(item.url, headers));
        headline = profile.headline;
        location = profile.location;
        kind = profile.kind;
        if (profile.portfolioUrl) portfolioUrl = profile.portfolioUrl;
      } catch {
        // keep the search hit even if the profile fetch fails
      }
      if (kind === "org") continue;
      if (headline === "GitHub public profile") {
        headline = `${item.login} · GitHub developer`;
      }
      if (!location && /bangkok|thailand|ไทย|กรุงเทพ/i.test(query)) {
        location = /bangkok|กรุงเทพ/i.test(query) ? "Bangkok" : "Thailand";
      }
      hits.push({
        source: "github",
        externalId: String(item.id),
        displayName: item.login,
        headline,
        profileUrl: item.html_url,
        location,
        kind,
        ...(portfolioUrl ? { portfolioUrl } : {}),
      });
    }
    return hits;
  },
};
