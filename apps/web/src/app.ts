import { Hono } from "hono";
import { ValidationError } from "@scout-lane/core";
import { HttpError, jsonError } from "./http/errors";
import { logError } from "./security/log";
import { applySecurityHeaders } from "./security/headers";
import { assertSameOrigin } from "./security/csrf";
import { oauth } from "./modules/oauth";
import { auth } from "./modules/auth";
import { users } from "./modules/users";
import { jobs } from "./modules/jobs";
import { scout } from "./modules/scout";
import { screen } from "./modules/screen";
import { track } from "./modules/track";
import { schedule } from "./modules/schedule";
import { settings } from "./modules/settings";

export const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  assertSameOrigin(c.req.raw);
  await next();
});

app.onError((err, c) => {
  if (err instanceof ValidationError) return jsonError(400, "invalid_body");
  if (err instanceof HttpError) return jsonError(err.status, err.code);
  logError("unhandled", {
    path: new URL(c.req.url).pathname,
    error: err instanceof Error ? err.message : "unknown",
  });
  return jsonError(500, "internal_error");
});

app.get("/api/health", (c) => c.json({ ok: true, name: c.env.APP_NAME }));

app.route("/", oauth);
app.route("/", auth);
app.route("/", users);
app.route("/", jobs);
app.route("/", scout);
app.route("/", screen);
app.route("/", track);
app.route("/", schedule);
app.route("/", settings);

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) return jsonError(404, "not_found");
  return c.env.ASSETS.fetch(c.req.raw);
});

export function withSecurity(request: Request, response: Response): Response {
  return applySecurityHeaders(response, new URL(request.url));
}
