import { hashPassword, verifyPassword } from "./password";
import { isRole, type Role } from "./rbac";

export type User = {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  calendarEmail: string | null;
};

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function rowToUser(row: {
  id: string;
  username: string;
  role: string;
  disabled?: number | boolean;
  calendar_email?: string | null;
}): User | null {
  if (!isRole(row.role)) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
    calendarEmail: row.calendar_email ?? null,
  };
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db
    .prepare("SELECT id, username, role, disabled, calendar_email FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: string; username: string; role: string; disabled: number; calendar_email: string | null }>();
  return row ? rowToUser(row) : null;
}

export async function findUser(
  db: D1Database,
  username: string,
): Promise<(User & { password_hash: string }) | null> {
  const row = await db
    .prepare("SELECT id, username, role, disabled, password_hash FROM users WHERE username = ?")
    .bind(normalizeUsername(username))
    .first<{
      id: string;
      username: string;
      role: string;
      disabled: number;
      password_hash: string;
    }>();
  if (!row) return null;
  const user = rowToUser(row);
  if (!user) return null;
  return { ...user, password_hash: row.password_hash };
}

export async function verifyUser(
  db: D1Database,
  username: string,
  password: string,
): Promise<User | null> {
  const row = await findUser(db, username);
  if (!row) {
    await verifyPassword(password, "pbkdf2-sha256$100000$AAAA$AAAA");
    return null;
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok || row.disabled) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: false,
    calendarEmail: row.calendarEmail,
  };
}

export async function ensureBootstrapUser(
  db: D1Database,
  username: string | undefined,
  password: string | undefined,
): Promise<void> {
  const existing = await db.prepare("SELECT id FROM users LIMIT 1").first();
  if (existing) return;
  if (!username || !password) return;
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO users (id, username, password_hash, role, disabled) VALUES (?, ?, ?, 'admin', 0)")
    .bind(id, normalizeUsername(username), await hashPassword(password))
    .run();
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const rows = await db
    .prepare("SELECT id, username, role, disabled, calendar_email FROM users ORDER BY username")
    .all<{ id: string; username: string; role: string; disabled: number; calendar_email: string | null }>();
  return (rows.results ?? []).map(rowToUser).filter((u): u is User => Boolean(u));
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin' AND disabled = 0")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createUser(
  db: D1Database,
  username: string,
  password: string,
  role: Role = "member",
): Promise<User> {
  const id = crypto.randomUUID();
  const uname = normalizeUsername(username);
  await db
    .prepare("INSERT INTO users (id, username, password_hash, role, disabled) VALUES (?, ?, ?, ?, 0)")
    .bind(id, uname, await hashPassword(password), role)
    .run();
  return { id, username: uname, role, disabled: false, calendarEmail: null };
}

export async function updateUser(
  db: D1Database,
  id: string,
  patch: {
    role?: Role | undefined;
    disabled?: boolean | undefined;
    password?: string | undefined;
    calendarEmail?: string | undefined;
  },
): Promise<User> {
  const current = await getUserById(db, id);
  if (!current) throw new Error("not_found");

  const nextRole = patch.role ?? current.role;
  const nextDisabled = patch.disabled ?? current.disabled;
  if (current.role === "admin" && (nextRole !== "admin" || nextDisabled)) {
    const admins = await countAdmins(db);
    if (admins <= 1) throw new Error("last_admin");
  }

  if (patch.password) {
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(patch.password), id).run();
  }
  if (patch.calendarEmail !== undefined) {
    const email = patch.calendarEmail.trim().toLowerCase() || null;
    await db.prepare("UPDATE users SET calendar_email = ? WHERE id = ?").bind(email, id).run();
  }
  await db
    .prepare("UPDATE users SET role = ?, disabled = ? WHERE id = ?")
    .bind(nextRole, nextDisabled ? 1 : 0, id)
    .run();

  if (nextDisabled) {
    await db.prepare("DELETE FROM api_tokens WHERE user_id = ?").bind(id).run();
  }

  const updated = await getUserById(db, id);
  if (!updated) throw new Error("not_found");
  return updated;
}

export async function deleteUser(db: D1Database, id: string, actorId: string): Promise<void> {
  if (id === actorId) throw new Error("self");
  const current = await getUserById(db, id);
  if (!current) throw new Error("not_found");
  if (current.role === "admin" && !current.disabled) {
    const admins = await countAdmins(db);
    if (admins <= 1) throw new Error("last_admin");
  }
  await db.prepare("DELETE FROM api_tokens WHERE user_id = ?").bind(id).run();
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}
