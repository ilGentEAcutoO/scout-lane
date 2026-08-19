import { inThailand } from "./engine";
import { githubHeaders, githubQueue, readGithubUser } from "./github";
import type { CandidateHit, SourceAdapter } from "./types";

const UA = { accept: "application/json", "user-agent": "scout-lane" };

async function getJson(url: string, extra: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { ...UA, ...extra } });
  if (!res.ok) return null;
  return res.json();
}

function skill(query: string): string {
  return query.replace(/location:\S+/gi, "").trim().split(/\s+/).slice(0, 3).join(" ") || "MCP";
}

export const githubThailandAdapter: SourceAdapter = {
  id: "github_th",
  status: "live",
  async search(_query, env) {
    const headers = githubHeaders(env);
    const queries = ["location:Thailand language:TypeScript", "open to work location:Thailand"];
    const items: Array<{ id: number; login: string; html_url: string; url?: string; type?: string }> = [];
    const seenId = new Set<number>();
    for (const q of queries) {
      const url = new URL("https://api.github.com/search/users");
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "8");
      const body = (await githubQueue(() => getJson(url.toString(), headers))) as {
        items?: Array<{ id: number; login: string; html_url: string; url?: string; type?: string }>;
      } | null;
      for (const u of body?.items ?? []) {
        if (seenId.has(u.id)) continue;
        seenId.add(u.id);
        items.push(u);
      }
    }
    const hits: CandidateHit[] = [];
    for (const u of items.slice(0, 10)) {
      if (u.type === "Organization") continue;
      let headline = `${u.login} · GitHub · Thailand`;
      let location: string | null = "Thailand";
      let portfolioUrl: string | undefined;
      try {
        const profile = await githubQueue(() =>
          readGithubUser(u.url || `https://api.github.com/users/${u.login}`, headers),
        );
        if (profile.kind === "org") continue;
        headline = profile.headline;
        location = profile.location || "Thailand";
        if (profile.portfolioUrl) portfolioUrl = profile.portfolioUrl;
      } catch {
        // keep the search hit — profile hydrate often 403 without a token
      }
      hits.push({
        source: "github_th",
        externalId: `th:${u.id}`,
        displayName: u.login,
        headline,
        profileUrl: u.html_url,
        location,
        kind: "person",
        ...(portfolioUrl ? { portfolioUrl } : {}),
      });
    }
    return hits;
  },
};

export const stackoverflowAdapter: SourceAdapter = {
  id: "stackoverflow",
  status: "live",
  async search() {
    const urls = [
      "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=thailand%20typescript&site=stackoverflow&pagesize=15",
      "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=bangkok%20javascript&site=stackoverflow&pagesize=15",
      "https://api.stackexchange.com/2.3/tags/typescript/top-answerers/all_time?site=stackoverflow&pagesize=8",
    ];
    const ids = new Set<number>();
    for (const url of urls) {
      const body = (await getJson(url)) as {
        items?: Array<{
          owner?: { user_id?: number };
          user?: { user_id?: number };
        }>;
      } | null;
      for (const item of body?.items ?? []) {
        const id = item.owner?.user_id ?? item.user?.user_id;
        if (id) ids.add(id);
      }
    }
    const list = [...ids].slice(0, 20);
    if (!list.length) return [];
    const users = (await getJson(
      `https://api.stackexchange.com/2.3/users/${list.join(";")}?site=stackoverflow`,
    )) as {
      items?: Array<{
        user_id?: number;
        display_name?: string;
        location?: string;
        link?: string;
        reputation?: number;
        website_url?: string;
      }>;
    } | null;
    const hits: CandidateHit[] = [];
    for (const user of users?.items ?? []) {
      if (!user.user_id || !user.display_name) continue;
      if (!inThailand(user.location) && !inThailand(user.website_url)) continue;
      hits.push({
        source: "stackoverflow",
        externalId: `so:${user.user_id}`,
        displayName: user.display_name,
        headline: `Stack Overflow · ${user.reputation ?? 0} rep`,
        profileUrl: user.link || `https://stackoverflow.com/users/${user.user_id}`,
        location: user.location ?? null,
        kind: "person",
      });
    }
    return hits.slice(0, 8);
  },
};

export const cratesAdapter: SourceAdapter = {
  id: "crates",
  status: "live",
  async search(query) {
    const q = /\bmcp\b/i.test(query) ? "mcp" : skill(query).split(" ")[0] || "mcp";
    const body = (await getJson(`https://crates.io/api/v1/crates?q=${encodeURIComponent(q)}&per_page=5`)) as {
      crates?: Array<{ id?: string; name?: string; description?: string }>;
    } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const crate of (body?.crates ?? []).slice(0, 4)) {
      const name = crate.id || crate.name;
      if (!name) continue;
      const owners = (await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}/owners`)) as {
        users?: Array<{ login?: string; url?: string; name?: string }>;
      } | null;
      for (const user of owners?.users ?? []) {
        const login = user.login;
        if (!login || seen.has(login)) continue;
        seen.add(login);
        hits.push({
          source: "crates",
          externalId: `crates:${login}`,
          displayName: user.name || login,
          headline: `crates.io · ${name}${crate.description ? ` · ${crate.description}` : ""}`.slice(0, 220),
          profileUrl: user.url || `https://crates.io/users/${login}`,
          location: null,
        });
      }
    }
    return hits.slice(0, 8);
  },
};

export const pypiAdapter: SourceAdapter = {
  id: "pypi",
  status: "live",
  async search() {
    const pkgs = ["mcp", "langchain", "llama-index", "chromadb", "openai"];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const pkg of pkgs) {
      const body = (await getJson(`https://pypi.org/pypi/${pkg}/json`)) as {
        info?: { author?: string; home_page?: string; package_url?: string; summary?: string };
      } | null;
      const author = body?.info?.author?.trim();
      if (!author || /unknown|none|project/i.test(author) || seen.has(author)) continue;
      seen.add(author);
      const home = body?.info?.home_page || "";
      hits.push({
        source: "pypi",
        externalId: `pypi:${pkg}:${author}`,
        displayName: author.slice(0, 80),
        headline: `PyPI · ${pkg}${body?.info?.summary ? ` · ${body.info.summary}` : ""}`.slice(0, 220),
        profileUrl: home.startsWith("https://") ? home : `https://pypi.org/project/${pkg}/`,
        location: null,
      });
    }
    return hits;
  },
};

export const rubygemsAdapter: SourceAdapter = {
  id: "rubygems",
  status: "live",
  async search(query) {
    const q = /\bmcp\b/i.test(query) ? "mcp" : "llm";
    const body = (await getJson(`https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(q)}`)) as Array<{
      name?: string;
      info?: string;
      authors?: string;
      project_uri?: string;
    }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const gem of body.slice(0, 10)) {
      const author = (gem.authors || "").split(",")[0]?.trim();
      if (!author || seen.has(author.toLowerCase())) continue;
      seen.add(author.toLowerCase());
      hits.push({
        source: "rubygems",
        externalId: `gem:${author}`,
        displayName: author,
        headline: [gem.name, gem.info].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: gem.project_uri || `https://rubygems.org/gems/${gem.name}`,
        location: null,
      });
    }
    return hits.slice(0, 6);
  },
};

export const hfSpacesAdapter: SourceAdapter = {
  id: "hf_spaces",
  status: "live",
  async search(query) {
    const q = /\bmcp\b/i.test(query) ? "mcp" : "rag";
    const body = (await getJson(`https://huggingface.co/api/spaces?search=${encodeURIComponent(q)}&limit=10`)) as Array<{
      id?: string;
      author?: string;
    }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const row of body) {
      const author = row.author || (row.id ?? "").split("/")[0];
      if (!author || seen.has(author)) continue;
      seen.add(author);
      hits.push({
        source: "hf_spaces",
        externalId: `space:${author}`,
        displayName: author,
        headline: `Hugging Face Space · ${row.id ?? ""}`,
        profileUrl: `https://huggingface.co/${author}`,
        location: null,
      });
    }
    return hits.slice(0, 6);
  },
};
