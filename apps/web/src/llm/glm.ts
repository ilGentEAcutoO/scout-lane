import { HttpError } from "../http/errors";
import { logError, logInfo } from "../security/log";
import { completeProvider, loadProvider, secretFor } from "./providers";
import { readChatStream } from "./stream";

type ChatMessage = { role: "system" | "user"; content: string };

const DEFAULTS = {
  quality: "glm-5.2",
  efficient: "glm-4.7-flashx",
  free: "glm-4.7-flash",
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

export async function glmJson<T>(
  env: Env,
  messages: ChatMessage[],
  opts: { disableThinking?: boolean } = {},
): Promise<T> {
  const safe = messages.map((m) =>
    m.role === "user" ? { ...m, content: sanitizeForModel(m.content) } : m,
  );

  const provider = await loadProvider(env);
  const { key } = await secretFor(env, provider);
  if (!key) throw new HttpError(503, "llm_not_configured");

  const attempts = provider === "glm" ? modelLadder(env) : [""];
  let last = 502;
  for (const model of attempts) {
    const res = await completeProvider(env, provider, key, safe, model, {
      ...(opts.disableThinking ? { disableThinking: true } : {}),
    });
    if (res.ok) {
      logInfo("llm_ok", { provider });
      return parseJson<T>(await res.text());
    }
    last = res.status;
    logError("llm_http", { status: res.status, provider });
    if (!retryable(res.status)) continue;
  }

  throw new HttpError(last === 429 ? 429 : 502, last === 429 ? "llm_rate_limited" : `llm_upstream:${last}`);
}

export async function* glmStream(env: Env, messages: ChatMessage[]): AsyncGenerator<string> {
  const safe = messages.map((m) =>
    m.role === "user" ? { ...m, content: sanitizeForModel(m.content) } : m,
  );

  const provider = await loadProvider(env);
  const { key } = await secretFor(env, provider);
  if (!key) throw new HttpError(503, "llm_not_configured");

  const attempts = provider === "glm" ? [modelLadder(env)[0] || ""] : [""];
  let last = 502;
  for (const model of attempts) {
    try {
      const res = await completeProvider(env, provider, key, safe, model, { stream: true, disableThinking: true });
      if (res.ok && res.body) {
        logInfo("llm_stream_ok", { provider });
        yield* readChatStream(res.body);
        return;
      }
      last = res.status;
      logError("llm_http", { status: res.status, provider, stream: true });
    } catch (err) {
      last = 408;
      logError("llm_http", {
        status: 408,
        provider,
        stream: true,
        error: err instanceof Error ? err.name : "abort",
      });
    }
  }

  const drafted = await glmJson<unknown>(env, messages, { disableThinking: true });
  if (drafted && typeof drafted === "object") yield JSON.stringify(drafted);
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
  const row = parsed as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
    response?: string;
  };
  if (typeof row.response === "string") return row.response;
  const choice = row.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  const block = row.content?.find((item) => item.text)?.text;
  return typeof block === "string" ? block : null;
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
