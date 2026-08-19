import { DurableObject } from "cloudflare:workers";
import { slotsOverlap } from "./overlap";

type Slot = { id: string; start: number; end: number };

export class SlotLock extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS slots (
          id TEXT PRIMARY KEY,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL
        )
      `);
    });
  }

  async reserve(id: string, start: number, end: number): Promise<{ ok: true } | { ok: false; reason: "conflict" }> {
    const existing = this.ctx.storage.sql
      .exec<{ id: string; start_ms: number; end_ms: number }>(
        "SELECT id, start_ms, end_ms FROM slots WHERE id != ?",
        id,
      )
      .toArray();
    if (existing.some((row) => slotsOverlap(start, end, row.start_ms, row.end_ms))) {
      return { ok: false, reason: "conflict" };
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO slots (id, start_ms, end_ms) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET start_ms = excluded.start_ms, end_ms = excluded.end_ms",
      id,
      start,
      end,
    );
    return { ok: true };
  }

  async release(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM slots WHERE id = ?", id);
  }

  async list(): Promise<Slot[]> {
    return this.ctx.storage.sql
      .exec<{ id: string; start_ms: number; end_ms: number }>("SELECT id, start_ms, end_ms FROM slots")
      .toArray()
      .map((row) => ({ id: row.id, start: row.start_ms, end: row.end_ms }));
  }
}
