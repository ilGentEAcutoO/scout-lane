import { Hono } from "hono";
import {
  AI_PROVIDERS,
  aiSettingsSchema,
  aiStatusSchema,
  calendarSettingsSchema,
  parseBody,
  promptSaveSchema,
  sourceModesSchema,
} from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { clientIp, rateLimit } from "../security/rate-limit";
import { listPrompts, savePrompt } from "../llm/settings";
import {
  GROUP_ALLOWED,
  GROUP_HINTS,
  GROUP_LABELS,
  MODE_LABELS,
  SOURCE_GROUPS,
  clampShopModes,
  loadSourceModes,
  normalizeModes,
  onModeFor,
  saveSourceModes,
} from "./scout/modes";
import { apifySecretFor, saveApifyKey } from "./scout/apify";
import { listAiStatus, saveProvider, saveProviderKey } from "../llm/providers";

export const settings = new Hono<{ Bindings: Env }>();

settings.put("/api/settings/calendar", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.write");
  const body = parseBody(calendarSettingsSchema, await readJson(c.req.raw));
  for (const [key, value] of [
    ["calendar.mode", body.mode],
    ["calendar.share_emails", body.shareEmails ?? ""],
  ] as const) {
    await c.env.DB_MAIN.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(key, value)
      .run();
  }
  return c.json({ ok: true, mode: body.mode });
});

settings.get("/api/settings/sources", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.read");
  c.header("Cache-Control", "no-store");
  const stored = await loadSourceModes(c.env);
  const shop = await apifySecretFor(c.env);
  const hasShopKey = Boolean(shop.key);
  const modes = clampShopModes(stored, hasShopKey);
  return c.json({
    modes,
    hasShopKey,
    shopSource: shop.source,
    modeLabels: MODE_LABELS,
    groups: SOURCE_GROUPS.map((id) => {
      const needsKey = GROUP_ALLOWED[id].includes("shop");
      const locked = needsKey && !hasShopKey;
      return {
        id,
        label: GROUP_LABELS[id],
        hint: GROUP_HINTS[id],
        mode: locked ? "off" : modes[id],
        onMode: onModeFor(id, hasShopKey),
        allowed: GROUP_ALLOWED[id],
        needsKey,
        locked,
      };
    }),
  });
});

settings.put("/api/settings/sources", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.write");
  await rateLimit(c.env.KV_SESSIONS, `src-settings:${actor.userId}:${clientIp(c.req.raw)}`, 10, 60);
  const body = parseBody(sourceModesSchema, await readJson(c.req.raw));
  if (typeof body.shopKey === "string") await saveApifyKey(c.env, body.shopKey);
  const shop = await apifySecretFor(c.env);
  const hasShopKey = Boolean(shop.key);
  const modes = clampShopModes(normalizeModes(body.modes), hasShopKey);
  await saveSourceModes(c.env, modes);
  return c.json({
    ok: true,
    modes,
    hasShopKey,
    shopSource: shop.source,
  });
});

settings.get("/api/settings/ai", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.read");
  c.header("Cache-Control", "no-store");
  return c.json(aiStatusSchema.parse(await listAiStatus(c.env)));
});

settings.put("/api/settings/ai", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.write");
  await rateLimit(c.env.KV_SESSIONS, `ai-settings:${actor.userId}:${clientIp(c.req.raw)}`, 10, 60);
  const body = parseBody(aiSettingsSchema, await readJson(c.req.raw));
  if (body.provider) await saveProvider(c.env, body.provider);
  if (body.keys) {
    for (const id of AI_PROVIDERS) {
      if (!Object.prototype.hasOwnProperty.call(body.keys, id)) continue;
      const value = body.keys[id] ?? "";
      await saveProviderKey(c.env, id, value);
    }
  }
  return c.json({ ok: true, ...aiStatusSchema.parse(await listAiStatus(c.env)) });
});

settings.get("/api/settings/prompts", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.read");
  return c.json({ prompts: await listPrompts(c.env) });
});

settings.put("/api/settings/prompts", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.write");
  const body = parseBody(promptSaveSchema, await readJson(c.req.raw));
  await savePrompt(c.env, body.key, body.value);
  return c.json({ ok: true });
});
