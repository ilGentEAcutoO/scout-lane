import { Hono } from "hono";
import {
  capabilities,
  ensureBootstrapUser,
  issuePat,
  LIMITS,
  listPats,
  loginSchema,
  parseBody,
  revokePat,
  tokenNameSchema,
  verifyUser,
} from "@scout-lane/core";
import { readJson } from "../security/body";
import { clientIp, rateLimit } from "../security/rate-limit";
import { createSession, destroySession, readSession } from "../security/session";
import { requireActor, requirePerm } from "../security/actor";
import { HttpError } from "../http/errors";
import { logInfo } from "../security/log";
import { loadProvider, secretFor } from "../llm/providers";

export const auth = new Hono<{ Bindings: Env }>();

auth.use("*", async (c, next) => {
  await ensureBootstrapUser(c.env.DB_MAIN, c.env.BOOTSTRAP_USERNAME, c.env.BOOTSTRAP_PASSWORD);
  return next();
});

auth.get("/api/session", async (c) => {
  c.header("x-has-cookie", c.req.header("cookie") ? "1" : "0");
  const session = await readSession(c.req.raw, c.env);
  c.header("x-has-session", session ? "1" : "0");
  if (!session) return c.json({ authenticated: false, limits: LIMITS });
  try {
    const actor = await requireActor(c.req.raw, c.env);
    const provider = await loadProvider(c.env);
    const { key } = await secretFor(c.env, provider);
    return c.json({
      authenticated: true,
      userId: actor.userId,
      username: actor.username,
      role: actor.role,
      can: capabilities(actor.role),
      limits: LIMITS,
      aiReady: Boolean(key),
    });
  } catch {
    return c.json({ authenticated: false, limits: LIMITS });
  }
});

auth.post("/api/login", async (c) => {
  await rateLimit(c.env.KV_SESSIONS, `login:${clientIp(c.req.raw)}`, 5, 60);
  const ct = c.req.header("content-type") || "";
  let parsed: { username: string; password: string };
  let nextField = "";
  if (ct.includes("application/json")) {
    parsed = parseBody(loginSchema, await readJson(c.req.raw));
  } else {
    const form = await c.req.parseBody();
    nextField = String(form.next ?? "");
    parsed = parseBody(loginSchema, {
      username: String(form.username ?? ""),
      password: String(form.password ?? ""),
    });
  }
  const user = await verifyUser(c.env.DB_MAIN, parsed.username, parsed.password);
  const asForm = !(c.req.header("content-type") || "").includes("application/json");
  if (!user) {
    logInfo("login_failed", { ip: clientIp(c.req.raw) });
    if (asForm) return c.redirect("/?e=1", 303);
    throw new HttpError(401, "invalid_credentials");
  }
  const cookie = await createSession(c.env, new URL(c.req.url), user);
  logInfo("login_ok", { ip: clientIp(c.req.raw) });
  if (asForm) {
    const { safeNextPath } = await import("./oauth");
    const next = safeNextPath(nextField) || "/app/";
    return new Response(
      `<!doctype html><meta http-equiv="refresh" content="0;url=${next}"><a href="${next}">เปิดแอป</a>`,
      {
        status: 302,
        headers: {
          "content-type": "text/html; charset=utf-8",
          location: next,
          "set-cookie": cookie,
        },
      },
    );
  }
  return new Response(JSON.stringify({ ok: true, username: user.username, role: user.role }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": cookie,
    },
  });
});

auth.post("/api/logout", async (c) => {
  const cookie = await destroySession(c.req.raw, c.env, new URL(c.req.url));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": cookie,
    },
  });
});

auth.get("/api/tokens", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "tokens.write");
  return c.json({
    tokens: await listPats(c.env.DB_MAIN, actor.userId),
    mcpUrl: c.env.MCP_PUBLIC_URL || "",
  });
});

auth.post("/api/tokens", async (c) => {
  await rateLimit(c.env.KV_SESSIONS, `pat:${clientIp(c.req.raw)}`, 10, 60);
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "tokens.write");
  const parsed = parseBody(tokenNameSchema, (await readJson(c.req.raw).catch(() => ({ name: "mcp" }))) ?? { name: "mcp" });
  const token = await issuePat(c.env.DB_MAIN, { id: actor.userId }, parsed.name);
  return c.json({ token, name: parsed.name });
});

auth.delete("/api/tokens/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "tokens.write");
  const ok = await revokePat(c.env.DB_MAIN, actor.userId, c.req.param("id"));
  if (!ok) throw new HttpError(404, "not_found");
  return c.json({ ok: true });
});
