type ChatMessage = { role: "system" | "user"; content: string };

const DEFAULTS = {
  quality: "glm-5.2",
  efficient: "glm-4.7-flashx",
  free: "glm-4.7-flash",
  gateway: "scoutlane-ai-gateway",
} as const;

function sanitize(text: string): string {
  return text
    .replace(/^\s*(system|assistant)\s*:/gim, "user:")
    .replace(/ignore (all|any|previous|prior) instructions/gi, "[redacted]")
    .replace(/reveal (the )?(api|secret|key|token)/gi, "[redacted]");
}

function ladder(env: Env): string[] {
  return [
    env.GLM_MODEL || DEFAULTS.quality,
    env.GLM_MODEL_EFFICIENT || DEFAULTS.efficient,
    env.GLM_MODEL_FREE || DEFAULTS.free,
  ].filter((name, i, all) => name && all.indexOf(name) === i);
}

function retryable(status: number): boolean {
  return status === 402 || status === 408 || status === 429 || status >= 500;
}

export async function glmJson<T>(env: Env, messages: ChatMessage[]): Promise<T> {
  const safe = messages.map((m) =>
    m.role === "user" ? { ...m, content: sanitize(m.content) } : m,
  );
  if (!env.GLM_API_KEY) throw new Error("llm_not_configured");
  let last = 502;
  for (const model of ladder(env)) {
    const url = zaiUrl(env);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GLM_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: safe,
      }),
    });
    if (res.ok) return parseJson<T>(await res.text());
    last = res.status;
    if (!retryable(res.status)) continue;
  }
  throw new Error(last === 429 ? "llm_rate_limited" : "llm_upstream");
}

function zaiUrl(env: Env): string {
  const account = env.CF_ACCOUNT_ID?.trim();
  const gateway = env.CF_AI_GATEWAY_ID?.trim() || DEFAULTS.gateway;
  if (account) {
    return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat/chat/completions`;
  }
  const base = (env.GLM_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, "");
  return `${base}/chat/completions`;
}

function parseJson<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = decodeObject(trimmed);
  const envelope = parsed as { choices?: Array<{ message?: { content?: string } }>; response?: string };
  const content = typeof envelope.response === "string" ? envelope.response : envelope.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return decodeObject(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as T;
  }
  return parsed as T;
}

function decodeObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("llm_bad_json");
  }
}
