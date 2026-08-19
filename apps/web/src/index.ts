import { app, withSecurity } from "./app";
import { consumeScreenBatch, type ScreenJob } from "./queue/screen";
import { requireActor } from "./security/actor";
import { jsonError } from "./http/errors";

export { SlotLock } from "./do/slot-lock";
export { LaneHub } from "./do/lane-hub";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
    await consumeScreenBatch(batch as MessageBatch<ScreenJob>, env);
  },
} satisfies ExportedHandler<Env>;
