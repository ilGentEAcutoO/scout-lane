const PREFIX = "v1";

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(raw: string): Uint8Array {
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function wrappingKey(env: Env): Promise<CryptoKey> {
  const secret = env.KEY_ENCRYPTION_KEY?.trim() || env.SESSION_SECRET;
  if (!secret) throw new Error("encryption_key_missing");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`scout-lane-llm:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSecret(env: Env, plain: string): Promise<string> {
  const key = await wrappingKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    new TextEncoder().encode(plain),
  );
  return `${PREFIX}:${bytesToB64(iv)}:${bytesToB64(ct)}`;
}

export async function openSecret(env: Env, packed: string): Promise<string | null> {
  const parts = packed.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  try {
    const key = await wrappingKey(env);
    const iv = asBuffer(b64ToBytes(parts[1] ?? ""));
    const ct = asBuffer(b64ToBytes(parts[2] ?? ""));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
