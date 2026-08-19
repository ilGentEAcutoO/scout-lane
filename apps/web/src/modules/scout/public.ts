import type { CandidateHit, SourceAdapter } from "./types";

const UA = { accept: "application/json", "user-agent": "scout-lane" };

async function getJson(url: string, extra: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { ...UA, ...extra } });
  if (!res.ok) return null;
  return res.json();
}

export const huggingfaceAdapter: SourceAdapter = {
  id: "huggingface",
  status: "live",
  async search(query) {
    const body = (await getJson(
      `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=8&full=false`,
    )) as Array<{ id?: string; modelId?: string; author?: string; pipeline_tag?: string }> | null;
    if (!Array.isArray(body)) return [];
    const hits: CandidateHit[] = [];
    const seen = new Set<string>();
    for (const row of body) {
      const author = row.author || (row.id ?? row.modelId ?? "").split("/")[0];
      if (!author || seen.has(author)) continue;
      seen.add(author);
      hits.push({
        source: "huggingface",
        externalId: author,
        displayName: author,
        headline: row.pipeline_tag ? `${row.pipeline_tag} · ${row.id ?? ""}` : (row.id ?? "HF author"),
        profileUrl: `https://huggingface.co/${author}`,
        location: null,
      });
    }
    return hits.slice(0, 6);
  },
};

export const npmAdapter: SourceAdapter = {
  id: "npm",
  status: "live",
  async search(query) {
    const body = (await getJson(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=8`,
    )) as { objects?: Array<{ package?: { name?: string; description?: string; links?: { npm?: string }; publisher?: { username?: string } } }> } | null;
    const hits: CandidateHit[] = [];
    for (const obj of body?.objects ?? []) {
      const pkg = obj.package;
      const user = pkg?.publisher?.username;
      if (!user || /bot|actions|dependabot/i.test(user)) continue;
      hits.push({
        source: "npm",
        externalId: `${user}:${pkg?.name ?? ""}`,
        displayName: user,
        headline: [pkg?.name, pkg?.description].filter(Boolean).join(" · ").slice(0, 220),
        profileUrl: `https://www.npmjs.com/~${user}`,
        location: null,
      });
    }
    return hits.slice(0, 6);
  },
};

export const gitlabAdapter: SourceAdapter = {
  id: "gitlab",
  status: "live",
  async search(query) {
    const body = (await getJson(
      `https://gitlab.com/api/v4/users?search=${encodeURIComponent(query)}&per_page=6`,
    )) as Array<{ id?: number; username?: string; name?: string; web_url?: string; bio?: string; location?: string }> | null;
    if (!Array.isArray(body)) return [];
    return body
      .filter((u) => u.username && u.web_url)
      .map((u) => ({
        source: "gitlab" as const,
        externalId: String(u.id ?? u.username),
        displayName: u.name || u.username || "gitlab",
        headline: u.bio || "GitLab public profile",
        profileUrl: u.web_url as string,
        location: u.location ?? null,
      }));
  },
};
