import { can, capabilities, getUserById, type Perm } from "@scout-lane/core";
import { HttpError } from "../http/errors";
import { requireSession, type SessionRecord } from "./session";

export type Actor = SessionRecord & { disabled: boolean };

export async function requireActor(request: Request, env: Env): Promise<Actor> {
  const session = await requireSession(request, env);
  const live = await getUserById(env.DB_MAIN, session.userId);
  if (!live || live.disabled) throw new HttpError(401, "unauthorized");
  return {
    ...session,
    username: live.username,
    role: live.role,
    disabled: live.disabled,
  };
}

export function requirePerm(actor: Actor, perm: Perm): void {
  if (!can(actor.role, perm)) throw new HttpError(403, "forbidden");
}

export function actorPublic(actor: Actor) {
  return {
    authenticated: true,
    username: actor.username,
    role: actor.role,
    can: capabilities(actor.role),
  };
}
