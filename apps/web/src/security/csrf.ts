import { HttpError } from "../http/errors";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Same-origin mutations only. Rejects missing or foreign Origin. */
export function assertSameOrigin(request: Request): void {
  if (SAFE.has(request.method)) return;

  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    if (origin !== url.origin) throw new HttpError(403, "csrf_origin");
    return;
  }

  if (referer) {
    try {
      if (new URL(referer).origin !== url.origin) throw new HttpError(403, "csrf_referer");
      return;
    } catch {
      throw new HttpError(403, "csrf_referer");
    }
  }

  throw new HttpError(403, "csrf_missing");
}
