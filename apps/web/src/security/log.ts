const SECRET_KEYS = /password|secret|token|authorization|cookie|key|email|phone|resume/i;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 8 && SECRET_KEYS.test(value)) return "[redacted]";
    return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...redact(fields) as object }));
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...redact(fields) as object }));
}
