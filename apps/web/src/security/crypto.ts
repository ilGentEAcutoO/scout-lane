const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

/** Hash both sides first so length cannot leak through timing. */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqualBytes(left, right);
}

function timingSafeEqualBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.byteLength !== right.byteLength) return false;

  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }

  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}
