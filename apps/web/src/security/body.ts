import { HttpError } from "../http/errors";

const MAX_JSON_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function readJson<T>(request: Request, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new HttpError(413, "payload_too_large");

  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, "payload_too_large");
  if (buf.byteLength === 0) throw new HttpError(400, "empty_body");

  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export { MAX_JSON_BYTES, MAX_UPLOAD_BYTES };
