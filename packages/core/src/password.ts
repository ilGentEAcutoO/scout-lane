/** Workers WebCrypto rejects PBKDF2 above 100_000 iterations. */
const ITERATIONS = 100_000;
const MAX_ITERATIONS = 100_000;
const encoder = new TextEncoder();

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = new Uint8Array(await pbkdf2(password, salt, ITERATIONS));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterRaw, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterRaw || !saltB64 || !hashB64) return false;
  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > MAX_ITERATIONS) return false;
  const salt = fromB64(saltB64);
  const expected = fromB64(hashB64);
  const actual = new Uint8Array(await pbkdf2(password, salt, iterations));
  if (actual.byteLength !== expected.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < actual.byteLength; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuf = new Uint8Array(salt);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuf, iterations },
    key,
    256,
  );
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
