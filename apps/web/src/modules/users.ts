import { Hono } from "hono";
import {
  createUser,
  createUserSchema,
  deleteUser,
  listUsers,
  parseBody,
  patchUserSchema,
  updateUser,
} from "@scout-lane/core";
import { readJson } from "../security/body";
import { requireActor, requirePerm } from "../security/actor";
import { HttpError } from "../http/errors";

export const users = new Hono<{ Bindings: Env }>();

users.get("/api/users", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "users.read");
  return c.json({ users: await listUsers(c.env.DB_MAIN) });
});

users.post("/api/users", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "users.write");
  const body = parseBody(createUserSchema, await readJson(c.req.raw));
  try {
    const user = await createUser(c.env.DB_MAIN, body.username, body.password, body.role);
    return c.json({ id: user.id, username: user.username, role: user.role }, 201);
  } catch {
    throw new HttpError(409, "username_taken");
  }
});

users.patch("/api/users/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  const id = c.req.param("id");
  const body = parseBody(patchUserSchema, await readJson(c.req.raw));
  const selfSafe =
    actor.userId === id && body.role === undefined && body.disabled === undefined;
  if (!selfSafe) requirePerm(actor, "users.write");
  try {
    const user = await updateUser(c.env.DB_MAIN, id, body);
    return c.json({ user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    if (msg === "last_admin") throw new HttpError(409, "last_admin");
    if (msg === "not_found") throw new HttpError(404, "not_found");
    throw new HttpError(400, msg);
  }
});

users.delete("/api/users/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "users.write");
  try {
    await deleteUser(c.env.DB_MAIN, c.req.param("id"), actor.userId);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    if (msg === "last_admin") throw new HttpError(409, "last_admin");
    if (msg === "self") throw new HttpError(409, "self");
    if (msg === "not_found") throw new HttpError(404, "not_found");
    throw new HttpError(400, msg);
  }
});
