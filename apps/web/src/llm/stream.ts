/** Parse one SSE / NDJSON line from OpenAI-compat or Anthropic streams. */
export function streamDeltaText(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("event:")) return "";
  const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!data || data === "[DONE]") return "";
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
      delta?: { text?: string };
      type?: string;
    };
    const choice = parsed.choices?.[0]?.delta?.content;
    if (typeof choice === "string" && choice) return choice;
    if (parsed.type === "content_block_delta" && typeof parsed.delta?.text === "string") {
      return parsed.delta.text;
    }
    if (typeof parsed.delta?.text === "string") return parsed.delta.text;
  } catch {
    return "";
  }
  return "";
}

function jsonStringAfterKey(raw: string, field: string): { value: string; complete: boolean } | null {
  const key = `"${field}"`;
  const at = raw.indexOf(key);
  if (at < 0) return null;
  let i = at + key.length;
  while (i < raw.length && /\s/.test(raw[i] || "")) i++;
  if (i >= raw.length) return { value: "", complete: false };
  if (raw[i] !== ":") return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i] || "")) i++;
  if (i >= raw.length) return { value: "", complete: false };
  if (raw[i] !== '"') return null;
  i++;
  let out = "";
  for (; i < raw.length; i++) {
    const ch = raw[i] || "";
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next == null) return { value: out, complete: false };
      if (next === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4) return { value: out, complete: false };
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 5;
        continue;
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
      out += map[next] ?? next;
      i += 1;
      continue;
    }
    if (ch === '"') return { value: out, complete: true };
    out += ch;
  }
  return { value: out, complete: false };
}

function looksLikeJson(raw: string): boolean {
  const t = raw.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** New visible description text between two accumulated model buffers. */
export function descriptionDelta(prevRaw: string, nextRaw: string): string {
  const nextField = jsonStringAfterKey(nextRaw, "description");
  if (nextField) {
    const prevField = jsonStringAfterKey(prevRaw, "description");
    const old = prevField?.value || "";
    if (nextField.value.startsWith(old)) return nextField.value.slice(old.length);
    return nextField.value;
  }
  if (looksLikeJson(nextRaw)) return "";
  if (looksLikeJson(prevRaw) && !looksLikeJson(nextRaw)) return nextRaw;
  return nextRaw.slice(prevRaw.length);
}

export function finishStreamedDraft(
  raw: string,
  streamedDesc: string,
): { title?: string; description: string } {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { title?: unknown; description?: unknown };
      const title = typeof parsed.title === "string" ? parsed.title : undefined;
      const description = typeof parsed.description === "string" ? parsed.description : streamedDesc;
      return title ? { title, description: description.trim() } : { description: description.trim() };
    }
  } catch {
    /* plain text draft */
  }
  return { description: (streamedDesc || raw).trim() };
}

export async function* pulseAsyncIterable<T>(
  src: AsyncIterable<T>,
  onPulse: () => Promise<void>,
  ms = 2200,
): AsyncGenerator<T> {
  const iter = src[Symbol.asyncIterator]();
  let pending = iter.next();
  for (;;) {
    const raced = await Promise.race([
      pending.then((value) => ({ value })),
      new Promise<{ pulse: true }>((resolve) => {
        setTimeout(() => resolve({ pulse: true }), ms);
      }),
    ]);
    if ("pulse" in raced) {
      await onPulse();
      continue;
    }
    if (raced.value.done) return;
    yield raced.value.value;
    pending = iter.next();
  }
}

export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let yielded = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || "";
    for (const line of lines) {
      const text = streamDeltaText(line);
      if (text) {
        yielded = true;
        yield text;
      }
    }
  }
  const tail = streamDeltaText(buf);
  if (tail) {
    yielded = true;
    yield tail;
  }
  if (!yielded && buf.trim()) {
    const leftover = buf.trim();
    try {
      const parsed = JSON.parse(leftover) as {
        choices?: Array<{ message?: { content?: string } }>;
        content?: Array<{ text?: string }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content === "string" && content) {
        yield content;
        return;
      }
      const block = parsed.content?.find((row) => row.text)?.text;
      if (typeof block === "string" && block) yield block;
    } catch {
      /* not a buffered JSON completion */
    }
  }
}
