import { DurableObject } from "cloudflare:workers";

export type LaneEvent = {
  type:
    | "screen.ready"
    | "screen.failed"
    | "board.changed"
    | "calendar.changed"
    | "scout.changed"
    | "scout.progress";
  applicationId?: string;
  candidateId?: string;
  runId?: string;
  source?: string;
  state?: string;
  count?: number;
  message?: string;
  at: number;
};

export class LaneHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    for (const row of this.recent()) {
      server.send(row.payload);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(event: LaneEvent): Promise<void> {
    const payload = JSON.stringify(event);
    this.ctx.storage.sql.exec(
      "INSERT INTO events (id, payload, created_at) VALUES (?, ?, ?)",
      crypto.randomUUID(),
      payload,
      event.at,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY created_at DESC LIMIT 40)",
    );
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(payload);
    }
  }

  override async webSocketMessage(): Promise<void> {
    // clients only listen; keep-alives are protocol pings handled by the runtime
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  private recent(): Array<{ payload: string }> {
    return this.ctx.storage.sql
      .exec<{ payload: string }>("SELECT payload FROM events ORDER BY created_at ASC")
      .toArray();
  }
}

export async function publishLane(env: Env, event: Omit<LaneEvent, "at">): Promise<void> {
  await env.LANE_HUB.getByName("hq").publish({ ...event, at: Date.now() });
}
