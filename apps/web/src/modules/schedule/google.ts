import { randomToken } from "../../security/crypto";

const SCOPE =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";
const TEAM_TOKEN_KEY = "google:calendar:refresh";

export type OauthKind = "team" | "me";
export type CalendarMode = "share" | "personal" | "both";
export type OauthPayload = { kind: OauthKind; userId: string };

export function tokenKeyFor(kind: OauthKind, userId?: string): string {
  if (kind === "me" && userId) return `${TEAM_TOKEN_KEY}:user:${userId}`;
  return TEAM_TOKEN_KEY;
}

export function parseCalendarMode(raw: string | null | undefined): CalendarMode {
  if (raw === "personal" || raw === "both") return raw;
  return "share";
}

export function parseShareEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 200 || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 40) break;
  }
  return out;
}

export function sanitizeBusy(raw: unknown): { start: string; end: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { start: string; end: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const start = typeof rec.start === "string" ? rec.start : "";
    const end = typeof rec.end === "string" ? rec.end : "";
    if (!start || !end || start.length > 40 || end.length > 40) continue;
    out.push({ start, end });
  }
  return out;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

export function googleAuthUrl(env: Env, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function mintOauthState(env: Env, payload: OauthPayload): Promise<string> {
  const state = randomToken(16);
  await env.KV_SESSIONS.put(`gstate:${state}`, JSON.stringify(payload), { expirationTtl: 600 });
  return state;
}

export async function consumeOauthState(env: Env, state: string): Promise<OauthPayload | null> {
  if (!state || state.length > 80) return null;
  const key = `gstate:${state}`;
  const raw = await env.KV_SESSIONS.get(key);
  if (!raw) return null;
  await env.KV_SESSIONS.delete(key);
  try {
    const parsed = JSON.parse(raw) as OauthPayload;
    if (parsed.kind !== "team" && parsed.kind !== "me") return null;
    if (!parsed.userId || parsed.userId.length > 80) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function exchangeCode(env: Env, code: string, key: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error("google_token");
  const body = (await res.json()) as { refresh_token?: string };
  if (!body.refresh_token) throw new Error("google_refresh_missing");
  await env.KV_SESSIONS.put(key, body.refresh_token);
}

export async function hasRefreshToken(env: Env, key: string): Promise<boolean> {
  return Boolean(await env.KV_SESSIONS.get(key));
}

async function accessToken(env: Env, key = TEAM_TOKEN_KEY): Promise<string | null> {
  const refresh = await env.KV_SESSIONS.get(key);
  if (!refresh) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

export async function queryFreeBusy(
  env: Env,
  key: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<{ start: string; end: string }[]> {
  const ids = [...new Set(calendarIds.filter((id) => id && id.length <= 200))].slice(0, 40);
  if (!ids.length) return [];
  const token = await accessToken(env, key);
  if (!token) return [];
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: ids.map((id) => ({ id })),
    }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    calendars?: Record<string, { busy?: unknown }>;
  };
  const out: { start: string; end: string }[] = [];
  for (const cal of Object.values(body.calendars ?? {})) {
    out.push(...sanitizeBusy(cal.busy));
  }
  return out;
}

export async function createMeet(env: Env, input: {
  summary: string;
  description: string;
  start: string;
  end: string;
}, key = TEAM_TOKEN_KEY): Promise<{ eventId: string; meetUrl: string | null } | null> {
  if (!googleConfigured(env)) return null;
  const token = await accessToken(env, key);
  if (!token) return null;
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description.slice(0, 8000),
        start: { dateTime: input.start, timeZone: "Asia/Bangkok" },
        end: { dateTime: input.end, timeZone: "Asia/Bangkok" },
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  };
  const meet =
    body.hangoutLink ||
    body.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
    null;
  return body.id ? { eventId: body.id, meetUrl: meet } : null;
}

export async function updateMeet(
  env: Env,
  eventId: string,
  input: { summary?: string; description?: string; start: string; end: string },
  key = TEAM_TOKEN_KEY,
): Promise<{ eventId: string; meetUrl: string | null } | null> {
  if (!eventId || eventId === "local" || eventId === "mcp") return null;
  if (!googleConfigured(env)) return null;
  const token = await accessToken(env, key);
  if (!token) return null;
  const body: Record<string, unknown> = {
    start: { dateTime: input.start, timeZone: "Asia/Bangkok" },
    end: { dateTime: input.end, timeZone: "Asia/Bangkok" },
  };
  if (input.summary) body.summary = input.summary;
  if (input.description) body.description = input.description.slice(0, 8000);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  };
  const meet =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
    null;
  return data.id ? { eventId: data.id, meetUrl: meet } : null;
}

export async function deleteMeet(env: Env, eventId: string, key = TEAM_TOKEN_KEY): Promise<void> {
  if (!eventId || eventId === "local" || eventId === "mcp") return;
  const token = await accessToken(env, key);
  if (!token) return;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}
