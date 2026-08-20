import { Hono } from "hono";
import { calendarSettingsSchema, parseBody, promptSaveSchema, sourceModesSchema } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { listPrompts, savePrompt } from "../llm/settings";
import {
  GROUP_ALLOWED,
  GROUP_HINTS,
  GROUP_LABELS,
  MODE_LABELS,
  SOURCE_GROUPS,
  loadSourceModes,
  normalizeModes,
  saveSourceModes,
} from "./scout/modes";
import { apifyStatus } from "./scout/apify";

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
  const modes = await loadSourceModes(c.env);
  return c.json({
    modes,
    hasShopKey: Boolean(c.env.APIFY_TOKEN?.trim()),
    shopStatus: apifyStatus(c.env),
    modeLabels: MODE_LABELS,
    groups: SOURCE_GROUPS.map((id) => ({
      id,
      label: GROUP_LABELS[id],
      hint: GROUP_HINTS[id],
      mode: modes[id],
      allowed: GROUP_ALLOWED[id],
    })),
  });
});

settings.put("/api/settings/sources", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "settings.write");
  const body = parseBody(sourceModesSchema, await readJson(c.req.raw));
  const modes = normalizeModes(body.modes);
  await saveSourceModes(c.env, modes);
  return c.json({ ok: true, modes });
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
