import { AI_PROVIDERS } from "@scout-lane/core";
import { openSecret, sealSecret } from "./keys";

export type AiProviderId = (typeof AI_PROVIDERS)[number];

type ChatMessage = { role: "system" | "user"; content: string };

export const AI_PROVIDER_META: Record<
  AiProviderId,
  { label: string; hint: string; keyFrom: string }
> = {
  glm: { label: "GLM", hint: "Zhipu / z.ai", keyFrom: "https://z.ai/manage-apikey/apikey-list" },
  claude: { label: "Claude", hint: "Anthropic", keyFrom: "https://console.anthropic.com/settings/keys" },
  openai: { label: "ChatGPT", hint: "OpenAI", keyFrom: "https://platform.openai.com/api-keys" },
  gemini: { label: "Gemini", hint: "Google AI Studio", keyFrom: "https://aistudio.google.com/apikey" },
};

const SETTING_PROVIDER = "llm.provider";
const settingKey = (id: AiProviderId) => `llm.${id}.key`;

export async function storedSecret(env: Env, id: AiProviderId): Promise<string> {
  const row = await env.DB_MAIN.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(settingKey(id))
    .first<{ value: string }>();
  if (!row?.value) return "";
  return (await openSecret(env, row.value))?.trim() || "";
}

export async function secretFor(env: Env, id: AiProviderId): Promise<{ key: string; source: "stored" | "secret" | null }> {
  const stored = await storedSecret(env, id);
  if (stored) return { key: stored, source: "stored" };
  return { key: "", source: null };
}

export async function loadProvider(env: Env): Promise<AiProviderId> {
  const row = await env.DB_MAIN.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(SETTING_PROVIDER)
    .first<{ value: string }>();
  const raw = row?.value || env.LLM_PROVIDER || "glm";
  return (AI_PROVIDERS as readonly string[]).includes(raw) ? (raw as AiProviderId) : "glm";
}

export async function saveProvider(env: Env, id: AiProviderId): Promise<void> {
  await env.DB_MAIN.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(SETTING_PROVIDER, id)
    .run();
}

export async function saveProviderKey(env: Env, id: AiProviderId, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await env.DB_MAIN.prepare("DELETE FROM settings WHERE key = ?").bind(settingKey(id)).run();
    return;
  }
  const packed = await sealSecret(env, trimmed);
  await env.DB_MAIN.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(settingKey(id), packed)
    .run();
}

export async function listAiStatus(env: Env): Promise<{
  provider: AiProviderId;
  providers: Array<{
    id: AiProviderId;
    label: string;
    hint: string;
    keyFrom: string;
    configured: boolean;
    source: "stored" | "secret" | null;
  }>;
}> {
  const provider = await loadProvider(env);
  const providers = [];
  for (const id of AI_PROVIDERS) {
    const { source } = await secretFor(env, id);
    providers.push({
      id,
      label: AI_PROVIDER_META[id].label,
      hint: AI_PROVIDER_META[id].hint,
      keyFrom: AI_PROVIDER_META[id].keyFrom,
      configured: Boolean(source),
      source,
    });
  }
  return { provider, providers };
}

function modelFor(env: Env, id: AiProviderId): string {
  if (id === "glm") return env.GLM_MODEL || "glm-5.2";
  if (id === "claude") return env.CLAUDE_MODEL || "claude-sonnet-5";
  if (id === "openai") return env.OPENAI_MODEL || "gpt-5.6-terra";
  return env.GEMINI_MODEL || "gemini-3.5-flash";
}

function glmUrls(env: Env, stream = false): string[] {
  const urls: string[] = [];
  const account = env.CF_ACCOUNT_ID?.trim();
  const gateway = env.CF_AI_GATEWAY_ID?.trim() || "scoutlane-ai-gateway";
  const viaGw = account
    ? `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat/chat/completions`
    : "";
  const base = (env.GLM_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, "");
  const direct = `${base}/chat/completions`;
  if (stream) {
    urls.push(direct);
    if (viaGw) urls.push(viaGw);
  } else {
    if (viaGw) urls.push(viaGw);
    urls.push(direct);
  }
  return [...new Set(urls.filter(Boolean))];
}

async function completeOpenAi(
  url: string,
  key: string,
  model: string,
  messages: ChatMessage[],
  extraHeaders: Record<string, string> = {},
  opts: { stream?: boolean; disableThinking?: boolean } = {},
): Promise<Response> {
  const ctrl = opts.stream ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8_000) : 0;
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(opts.disableThinking || opts.stream
          ? { thinking: { type: "disabled" }, enable_thinking: false }
          : {}),
        ...(opts.stream ? { stream: true } : { response_format: { type: "json_object" } }),
        messages,
      }),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function completeClaude(
  key: string,
  model: string,
  messages: ChatMessage[],
  opts: { stream?: boolean } = {},
): Promise<Response> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      system: system || undefined,
      stream: Boolean(opts.stream) || undefined,
      messages: rest,
    }),
  });
}

export async function completeProvider(
  env: Env,
  id: AiProviderId,
  key: string,
  messages: ChatMessage[],
  modelOverride?: string,
  opts: { stream?: boolean; disableThinking?: boolean } = {},
): Promise<Response> {
  const model = modelOverride || modelFor(env, id);
  if (id === "claude") return completeClaude(key, model, messages, opts);
  if (id === "openai") {
    return completeOpenAi("https://api.openai.com/v1/chat/completions", key, model, messages, {}, opts);
  }
  if (id === "gemini") {
    return completeOpenAi(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key,
      model,
      messages,
      {},
      opts,
    );
  }
  let last: Response | null = null;
  for (const url of glmUrls(env, Boolean(opts.stream))) {
    const res = await completeOpenAi(url, key, model, messages, {}, opts);
    if (res.ok) return res;
    last = res;
  }
  return last || new Response("{}", { status: 502 });
}

export function readModelText(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ type?: string; text?: string }>;
      response?: string;
    };
    if (typeof parsed.response === "string") return parsed.response;
    const choice = parsed.choices?.[0]?.message?.content;
    if (typeof choice === "string") return choice;
    const block = parsed.content?.find((row) => row.type === "text" || row.text)?.text;
    if (typeof block === "string") return block;
  } catch {
    /* raw may already be the JSON payload */
  }
  return trimmed;
}
