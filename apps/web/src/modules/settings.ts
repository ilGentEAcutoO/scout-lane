import { Hono } from "hono";
import { calendarSettingsSchema, parseBody, promptSaveSchema } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { listPrompts, savePrompt } from "../llm/settings";

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
