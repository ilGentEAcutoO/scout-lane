import { Hono } from "hono";
import { finishAuthorize } from "../../../mcp/src/oauth";
import { requireActor } from "../security/actor";
import { readSession } from "../security/session";

export const oauth = new Hono<{ Bindings: Env }>();

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (raw.startsWith("/oauth/authorize") || raw.startsWith("/app/")) return raw;
  return null;
}

oauth.get("/oauth/authorize", async (c) => {
  const url = new URL(c.req.url);
  const session = await readSession(c.req.raw, c.env);
  if (!session) {
    const next = `/oauth/authorize${url.search}`;
    return c.redirect(`/?next=${encodeURIComponent(next)}`, 302);
  }
  const actor = await requireActor(c.req.raw, c.env);
  return finishAuthorize(c.env, url, {
    id: actor.userId,
    username: actor.username,
    role: actor.role,
  });
});
