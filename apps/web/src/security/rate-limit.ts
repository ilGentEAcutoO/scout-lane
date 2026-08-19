import { HttpError } from "../http/errors";

export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const current = Number((await kv.get(bucket)) ?? "0");
  if (current >= limit) throw new HttpError(429, "rate_limited");
  await kv.put(bucket, String(current + 1), { expirationTtl: windowSec * 2 });
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
