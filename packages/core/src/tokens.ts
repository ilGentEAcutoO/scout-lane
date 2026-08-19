export type AccessPrincipal = {
  userId: string;
  username: string;
  role: string;
  kind: "pat" | "oauth";
};

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mintPat(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `slm_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function issuePat(
  db: D1Database,
  user: { id: string },
  name: string,
): Promise<string> {
  const token = mintPat();
  await db
    .prepare("INSERT INTO api_tokens (id, user_id, token_hash, name) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), user.id, await hashToken(token), name)
    .run();
  return token;
}

export async function resolvePat(db: D1Database, token: string): Promise<AccessPrincipal | null> {
  if (!token.startsWith("slm_")) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.role, u.disabled
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .bind(await hashToken(token))
    .first<{ id: string; username: string; role: string; disabled: number }>();
  if (!row || row.disabled) return null;
  return { userId: row.id, username: row.username, role: row.role, kind: "pat" };
}

export async function listPats(
  db: D1Database,
  userId: string,
): Promise<Array<{ id: string; name: string; createdAt: string }>> {
  const rows = await db
    .prepare("SELECT id, name, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<{ id: string; name: string; created_at: string }>();
  return (rows.results ?? []).map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

export async function revokePat(db: D1Database, userId: string, tokenId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM api_tokens WHERE id = ? AND user_id = ?")
    .bind(tokenId, userId)
    .first();
  if (!row) return false;
  await db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").bind(tokenId, userId).run();
  return true;
}

export function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
