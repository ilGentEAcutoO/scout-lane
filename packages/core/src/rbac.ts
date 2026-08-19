export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const PERMS = {
  "users.read": ["admin"],
  "users.write": ["admin"],
  "settings.read": ["admin"],
  "settings.write": ["admin"],
  "jobs.read": ["admin", "member"],
  "jobs.write": ["admin", "member"],
  "candidates.read": ["admin", "member"],
  "candidates.write": ["admin", "member"],
  "candidates.delete": ["admin", "member"],
  "scout.run": ["admin", "member"],
  "screen.run": ["admin", "member"],
  "interviews.read": ["admin", "member"],
  "interviews.write": ["admin", "member"],
  "tokens.write": ["admin", "member"],
} as const;

export type Perm = keyof typeof PERMS;

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Role is re-read from D1 on every request. Cookie/PAT role is never trusted alone. */
export function can(role: string, perm: Perm): boolean {
  return (PERMS[perm] as readonly string[]).includes(role);
}

export function capabilities(role: string): Record<Perm, boolean> {
  const out = {} as Record<Perm, boolean>;
  for (const perm of Object.keys(PERMS) as Perm[]) out[perm] = can(role, perm);
  return out;
}
