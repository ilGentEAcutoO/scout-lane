import { app, withSecurity } from "./app";
import { consumeScreenBatch, type ScreenJob } from "./queue/screen";
import { consumeScoutBatch } from "./queue/scout";
import type { ScoutQueueJob } from "./modules/scout/task";
import { requireActor } from "./security/actor";
import { jsonError } from "./http/errors";

export { SlotLock } from "./do/slot-lock";
export { LaneHub } from "./do/lane-hub";

const APP_TABS = new Set(["home", "scout", "jobs", "screen", "board", "people", "schedule", "users", "profile", "settings"]);

function isAppTabPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  const match = /^\/app\/([a-z]+)$/.exec(path);
  return Boolean(match && APP_TABS.has(match[1] ?? ""));
}

async function appShell(env: Env, request: Request, url: URL): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("Location");
  for (const path of ["/app/index.html", "/app/"]) {
    const res = await env.ASSETS.fetch(
      new Request(new URL(path, url.origin), { method: "GET", headers, redirect: "manual" }),
    );
    if (res.status === 200) return withSecurity(request, res);
  }
  return withSecurity(request, await env.ASSETS.fetch(new Request(new URL("/app/index.html", url.origin), request)));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && isAppTabPath(url.pathname)) {
      return appShell(env, request, url);
    }
    if (url.pathname === "/api/live") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return jsonError(426, "expected_websocket");
      }
      try {
        await requireActor(request, env);
      } catch {
        return jsonError(401, "unauthorized");
      }
      return env.LANE_HUB.getByName("hq").fetch(request);
    }
    const response = await app.fetch(request, env, ctx);
    return withSecurity(request, response);
  },
  async queue(batch, env) {
    if (batch.queue === "scoutlane-queue-scout") {
      await consumeScoutBatch(batch as MessageBatch<ScoutQueueJob>, env);
      return;
    }
    await consumeScreenBatch(batch as MessageBatch<ScreenJob>, env);
  },
} satisfies ExportedHandler<Env>;
