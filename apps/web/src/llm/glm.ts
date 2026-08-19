import { HttpError } from "../http/errors";
import { logError, logInfo } from "../security/log";

type ChatMessage = { role: "system" | "user"; content: string };

const DEFAULTS = {
  quality: "glm-5.2",
  efficient: "glm-4.7-flashx",
  free: "glm-4.7-flash",
  gateway: "scoutlane-ai-gateway",
} as const;

export function sanitizeForModel(text: string): string {
  return text
    .replace(/^\s*(system|assistant)\s*:/gim, "user:")
    .replace(/ignore (all|any|previous|prior) instructions/gi, "[redacted]")
    .replace(/reveal (the )?(api|secret|key|token)/gi, "[redacted]");
}

export function modelLadder(env: Env): string[] {
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
    m.role === "user" ? { ...m, content: sanitizeForModel(m.content) } : m,
  );

  if (!env.GLM_API_KEY) throw new HttpError(503, "llm_not_configured");

  let last = 502;
  for (const model of modelLadder(env)) {
    const res = await completeZai(env, model, safe);
    if (res.ok) {
      logInfo("glm_ok", { model });
      return parseJson<T>(await res.text());
    }
    last = res.status;
    logError("glm_http", { status: res.status, model });
    if (!retryable(res.status)) continue;
  }

  throw new HttpError(last === 429 ? 429 : 502, last === 429 ? "llm_rate_limited" : "llm_upstream");
}

async function completeZai(env: Env, model: string, messages: ChatMessage[]): Promise<Response> {
  const url = zaiUrl(env);
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GLM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
  });
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

export function parseJson<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = decodeObject(trimmed);
  const content = readChoiceContent(parsed);
  if (typeof content === "string" && content.trim()) {
    return decodeObject(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as T;
  }
  return parsed as T;
}

function readChoiceContent(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as { choices?: Array<{ message?: { content?: string } }>; response?: string };
  if (typeof row.response === "string") return row.response;
  const content = row.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

function decodeObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new HttpError(502, "llm_bad_json");
  }
}
