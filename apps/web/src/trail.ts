export type TrailKind = "entered" | "moved" | "screened" | "booked" | "rescheduled" | "cancelled";

export async function logTrail(
  db: D1Database,
  candidateId: string,
  kind: TrailKind,
  extra: { stage?: string; from?: string; detail?: string } = {},
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO candidate_events (id, candidate_id, kind, stage, from_stage, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        candidateId,
        kind,
        extra.stage ?? null,
        extra.from ?? null,
        extra.detail ?? null,
      )
      .run();
  } catch {
    /* table may be pending migrate */
  }
}

export async function listTrail(db: D1Database, candidateId: string) {
  try {
    const rows = await db
      .prepare(
        "SELECT id, kind, stage, from_stage, detail, created_at FROM candidate_events WHERE candidate_id = ? ORDER BY created_at ASC",
      )
      .bind(candidateId)
      .all();
    return rows.results ?? [];
  } catch {
    return [];
  }
}

export async function listTrailFor(db: D1Database, ids: string[]) {
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  try {
    const rows = await db
      .prepare(
        `SELECT candidate_id, kind, stage, from_stage, detail, created_at
         FROM candidate_events WHERE candidate_id IN (${marks}) ORDER BY created_at ASC`,
      )
      .bind(...ids)
      .all();
    return rows.results ?? [];
  } catch {
    return [];
  }
}
