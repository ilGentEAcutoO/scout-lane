export async function limit(
  kv: KVNamespace,
  key: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const current = Number((await kv.get(bucket)) ?? "0");
  if (current >= max) return false;
  await kv.put(bucket, String(current + 1), { expirationTtl: windowSec * 2 });
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
