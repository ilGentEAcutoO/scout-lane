import { githubHeaders, githubQueue, readGithubUser } from "./github";
import type { CandidateHit, SourceAdapter } from "./types";

const UA = { accept: "application/json", "user-agent": "scout-lane" };

async function getJson(url: string, extra: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { ...UA, ...extra } });
  if (!res.ok) return null;
  return res.json();
}

function uniq(hits: CandidateHit[]): CandidateHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = h.profileUrl || h.externalId;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const githubBangkokAdapter: SourceAdapter = {
  id: "github_bkk",
  status: "live",
  async search(_q, env) {
    const headers = githubHeaders(env);
    const body = (await githubQueue(() =>
      getJson("https://api.github.com/search/users?q=location:Bangkok+language:TypeScript&per_page=8", headers),
    )) as { items?: Array<{ id: number; login: string; html_url: string; url?: string; type?: string }> } | null;
    const hits: CandidateHit[] = [];
    for (const u of (body?.items ?? []).slice(0, 8)) {
      if (u.type === "Organization") continue;
      let headline = "GitHub · Bangkok · TypeScript";
      let location: string | null = "Bangkok";
      let portfolioUrl: string | undefined;
      try {
        const profile = await githubQueue(() =>
          readGithubUser(u.url || `https://api.github.com/users/${u.login}`, headers),
        );
        if (profile.kind === "org") continue;
        headline = profile.headline;
        location = profile.location || "Bangkok";
        if (profile.portfolioUrl) portfolioUrl = profile.portfolioUrl;
      } catch {
        // keep the Bangkok search hit even if hydrate is rate-limited
      }
      hits.push({
        source: "github_bkk",
        externalId: `bkk:${u.id}`,
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

export const githubLangchainAdapter: SourceAdapter = {
  id: "github_langchain",
  status: "live",
  async search(_q, env) {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "scout-lane",
      "x-github-api-version": "2022-11-28",
    };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const body = (await githubQueue(() =>
      getJson("https://api.github.com/search/repositories?q=topic:langchain+stars:>5&per_page=10", headers),
    )) as { items?: Array<{ owner?: { login?: string; html_url?: string; type?: string }; full_name?: string; description?: string }> } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const repo of body?.items ?? []) {
      const login = repo.owner?.login;
      if (!login || seen.has(login) || repo.owner?.type === "Organization") continue;
      seen.add(login);
      hits.push({
        source: "github_langchain",
        externalId: `lc:${login}`,
        displayName: login,
        headline: [repo.full_name, repo.description].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: repo.owner?.html_url || `https://github.com/${login}`,
        location: null,
        kind: repo.owner?.type === "Organization" ? "org" : "person",
      });
    }
    return hits.slice(0, 8);
  },
};

export const gitlabProjectsAdapter: SourceAdapter = {
  id: "gitlab_projects",
  status: "live",
  async search() {
    const body = (await getJson(
      "https://gitlab.com/api/v4/projects?search=mcp&order_by=last_activity_at&simple=true&per_page=10",
    )) as Array<{ namespace?: { name?: string; web_url?: string }; name?: string; description?: string; web_url?: string }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const row of body) {
      const name = row.namespace?.name;
      const url = row.namespace?.web_url;
      if (!name || !url || seen.has(url)) continue;
      seen.add(url);
      hits.push({
        source: "gitlab_projects",
        externalId: `glp:${name}`,
        displayName: name,
        headline: [row.name, row.description].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: url,
        location: null,
      });
    }
    return hits.slice(0, 8);
  },
};

function stackSite(id: CandidateHit["source"], site: string, q: string): SourceAdapter {
  return {
    id,
    status: "live",
    async search() {
      const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
      url.searchParams.set("order", "desc");
      url.searchParams.set("sort", "relevance");
      url.searchParams.set("q", q);
      url.searchParams.set("site", site);
      url.searchParams.set("pagesize", "10");
      const body = (await getJson(url.toString())) as {
        items?: Array<{ title?: string; owner?: { display_name?: string; user_id?: number; link?: string } }>;
      } | null;
      const hits: CandidateHit[] = [];
      const seen = new Set<number>();
      for (const item of body?.items ?? []) {
        const uid = item.owner?.user_id;
        const name = item.owner?.display_name;
        if (!uid || !name || seen.has(uid)) continue;
        seen.add(uid);
        hits.push({
          source: id,
          externalId: `${id}:${uid}`,
          displayName: name,
          headline: item.title || site,
          profileUrl: item.owner?.link || `https://${site}.com/users/${uid}`,
          location: null,
        });
      }
      return hits.slice(0, 8);
    },
  };
}

export const stackAiAdapter = stackSite("stack_ai", "ai", "LLM agent workflow");
export const stackDsAdapter = stackSite("stack_ds", "datascience", "RAG retrieval LLM");

export const packagistAdapter: SourceAdapter = {
  id: "packagist",
  status: "live",
  async search() {
    const body = (await getJson("https://packagist.org/search.json?q=mcp")) as {
      results?: Array<{ name?: string; description?: string; repository?: string; url?: string }>;
    } | null;
    return (body?.results ?? []).slice(0, 8).map((pkg) => ({
      source: "packagist" as const,
      externalId: `php:${pkg.name}`,
      displayName: (pkg.name || "packagist").split("/")[0] || "packagist",
      headline: [pkg.name, pkg.description].filter(Boolean).join(" · ").slice(0, 220),
      profileUrl: pkg.repository || pkg.url || `https://packagist.org/packages/${pkg.name}`,
      location: null,
    }));
  },
};

export const hexAdapter: SourceAdapter = {
  id: "hex",
  status: "live",
  async search() {
    const body = (await getJson("https://hex.pm/api/packages?search=mcp")) as Array<{
      name?: string;
      meta?: { description?: string };
      url?: string;
      owners?: Array<{ username?: string; url?: string }>;
    }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    for (const pkg of body.slice(0, 8)) {
      const owner = pkg.owners?.[0]?.username || pkg.name;
      if (!owner) continue;
      hits.push({
        source: "hex",
        externalId: `hex:${owner}:${pkg.name}`,
        displayName: owner,
        headline: [pkg.name, pkg.meta?.description].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: pkg.owners?.[0]?.url || pkg.url || `https://hex.pm/packages/${pkg.name}`,
        location: null,
      });
    }
    return uniq(hits).slice(0, 8);
  },
};

export const pubdevAdapter: SourceAdapter = {
  id: "pubdev",
  status: "live",
  async search() {
    const body = (await getJson("https://pub.dev/api/search?q=mcp")) as {
      packages?: Array<{ package?: string }>;
    } | null;
    const hits: CandidateHit[] = [];
    for (const row of (body?.packages ?? []).slice(0, 8)) {
      const name = row.package;
      if (!name) continue;
      const detail = (await getJson(`https://pub.dev/api/packages/${encodeURIComponent(name)}`)) as {
        latest?: { pubspec?: { description?: string; homepage?: string } };
        publisherId?: string | null;
      } | null;
      hits.push({
        source: "pubdev",
        externalId: `pub:${name}`,
        displayName: detail?.publisherId || name,
        headline: [name, detail?.latest?.pubspec?.description].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: detail?.latest?.pubspec?.homepage?.startsWith("https://")
          ? detail.latest.pubspec.homepage
          : `https://pub.dev/packages/${name}`,
        location: null,
      });
    }
    return hits;
  },
};

export const openvsxAdapter: SourceAdapter = {
  id: "openvsx",
  status: "live",
  async search() {
    const body = (await getJson("https://open-vsx.org/api/-/search?query=mcp&size=10")) as {
      extensions?: Array<{ namespace?: string; name?: string; displayName?: string; files?: { homepage?: string } }>;
    } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const ext of body?.extensions ?? []) {
      const ns = ext.namespace;
      if (!ns || seen.has(ns)) continue;
      seen.add(ns);
      hits.push({
        source: "openvsx",
        externalId: `ovsx:${ns}`,
        displayName: ns,
        headline: [ext.displayName || ext.name, "Open VSX"].filter(Boolean).join(" · "),
        profileUrl: `https://open-vsx.org/extension/${ns}/${ext.name}`,
        location: null,
      });
    }
    return hits.slice(0, 8);
  },
};

export const lobstersAdapter: SourceAdapter = {
  id: "lobsters",
  status: "live",
  async search() {
    const body = (await getJson("https://lobste.rs/search.json?q=mcp&what=stories&order=newest")) as Array<{
      submitter_user?: string;
      title?: string;
      url?: string;
    }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const row of body) {
      const user = row.submitter_user;
      if (!user || seen.has(user)) continue;
      seen.add(user);
      hits.push({
        source: "lobsters",
        externalId: `lob:${user}`,
        displayName: user,
        headline: row.title || "Lobsters",
        profileUrl: `https://lobste.rs/u/${encodeURIComponent(user)}`,
        location: null,
      });
    }
    return hits.slice(0, 8);
  },
};

function discourse(id: CandidateHit["source"], host: string, q: string): SourceAdapter {
  return {
    id,
    status: "live",
    async search() {
      const body = (await getJson(`https://${host}/search.json?q=${encodeURIComponent(q)}`)) as {
        users?: Array<{ id?: number; username?: string; name?: string }>;
        topics?: Array<{ title?: string }>;
      } | null;
      const hits: CandidateHit[] = [];
      for (const user of body?.users ?? []) {
        if (!user.username) continue;
        hits.push({
          source: id,
          externalId: `${id}:${user.username}`,
          displayName: user.name || user.username,
          headline: body?.topics?.[0]?.title || host,
          profileUrl: `https://${host}/u/${user.username}`,
          location: null,
        });
      }
      return hits.slice(0, 8);
    },
  };
}

export const hfForumAdapter = discourse("hf_forum", "discuss.huggingface.co", "mcp");
export const openaiForumAdapter = discourse("openai_forum", "community.openai.com", "mcp rag");

export const dblpAdapter: SourceAdapter = {
  id: "dblp",
  status: "live",
  async search() {
    const body = (await getJson(
      "https://dblp.org/search/author/api?q=retrieval+augmented+generation&format=json&h=10",
    )) as { result?: { hits?: { hit?: Array<{ info?: { author?: string; url?: string } }> } } } | null;
    const rows = body?.result?.hits?.hit ?? [];
    return rows.slice(0, 8).flatMap((row) => {
      const name = row.info?.author;
      const url = row.info?.url;
      if (!name || !url) return [];
      return [
        {
          source: "dblp" as const,
          externalId: `dblp:${url}`,
          displayName: name,
          headline: "DBLP · RAG / IR author",
          profileUrl: url,
          location: null,
        },
      ];
    });
  },
};

export const s2Adapter: SourceAdapter = {
  id: "s2",
  status: "live",
  async search() {
    const body = (await getJson(
      "https://api.semanticscholar.org/graph/v1/paper/search?query=model%20context%20protocol&limit=8&fields=title,authors",
    )) as { data?: Array<{ title?: string; authors?: Array<{ authorId?: string; name?: string }> }> } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const paper of body?.data ?? []) {
      for (const author of paper.authors ?? []) {
        const id = author.authorId || author.name;
        if (!id || !author.name || seen.has(id)) continue;
        seen.add(id);
        hits.push({
          source: "s2",
          externalId: `s2:${id}`,
          displayName: author.name,
          headline: paper.title || "Semantic Scholar",
          profileUrl: author.authorId
            ? `https://www.semanticscholar.org/author/${author.authorId}`
            : `https://www.semanticscholar.org/search?q=${encodeURIComponent(author.name)}`,
          location: null,
        });
      }
    }
    return hits.slice(0, 10);
  },
};

export const openalexAdapter: SourceAdapter = {
  id: "openalex",
  status: "live",
  async search() {
    const body = (await getJson(
      "https://api.openalex.org/works?search=model%20context%20protocol&per_page=8",
    )) as {
      results?: Array<{
        title?: string;
        authorships?: Array<{ author?: { id?: string; display_name?: string; orcid?: string } }>;
      }>;
    } | null;
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const work of body?.results ?? []) {
      for (const row of work.authorships ?? []) {
        const name = row.author?.display_name;
        const id = row.author?.id || name;
        if (!name || !id || seen.has(id)) continue;
        seen.add(id);
        hits.push({
          source: "openalex",
          externalId: `oa:${id}`,
          displayName: name,
          headline: work.title || "OpenAlex",
          profileUrl: row.author?.orcid || row.author?.id || `https://openalex.org/works?search=${encodeURIComponent(name)}`,
          location: null,
        });
      }
    }
    return hits.slice(0, 10);
  },
};
