export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function jsonError(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}
