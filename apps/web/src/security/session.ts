import { HttpError } from "../http/errors";
import { randomToken, timingSafeEqualString } from "./crypto";

const COOKIE = "sl_session";
const TTL_SEC = 60 * 60 * 12;

export type SessionRecord = {
  id: string;
  userId: string;
  username: string;
  role: string;
  createdAt: number;
};

export async function readSession(request: Request, env: Env): Promise<SessionRecord | null> {
  const packed = parseCookie(request.headers.get("cookie") ?? "")[COOKIE];
  if (!packed || !env.SESSION_SECRET) return null;
  const token = await openSigned(packed, env.SESSION_SECRET);
  if (!token) return null;
  const raw = await env.KV_SESSIONS.get(`sess:${token}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionRecord;
}

export async function requireSession(request: Request, env: Env): Promise<SessionRecord> {
  const session = await readSession(request, env);
  if (!session) throw new HttpError(401, "unauthorized");
  return session;
}

export async function createSession(
  env: Env,
  url: URL,
  user: { id: string; username: string; role: string },
): Promise<string> {
  if (!env.SESSION_SECRET) throw new HttpError(500, "misconfigured");
  const token = randomToken(32);
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now(),
  };
  await env.KV_SESSIONS.put(`sess:${token}`, JSON.stringify(record), { expirationTtl: TTL_SEC });
  return serializeCookie(await signToken(token, env.SESSION_SECRET), url);
}

export async function destroySession(request: Request, env: Env, url: URL): Promise<string> {
  const packed = parseCookie(request.headers.get("cookie") ?? "")[COOKIE];
  if (packed && env.SESSION_SECRET) {
    const token = await openSigned(packed, env.SESSION_SECRET);
    if (token) await env.KV_SESSIONS.delete(`sess:${token}`);
  }
  return expireCookie(url);
}

async function signToken(token: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return `${token}.${toHex(sig)}`;
}

async function openSigned(packed: string, secret: string): Promise<string | null> {
  const dot = packed.lastIndexOf(".");
  if (dot < 1) return null;
  const token = packed.slice(0, dot);
  const expected = await signToken(token, secret);
  if (!(await timingSafeEqualString(packed, expected))) return null;
  return token;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function serializeCookie(token: string, url: URL): string {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${TTL_SEC}`,
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function expireCookie(url: URL): string {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}
