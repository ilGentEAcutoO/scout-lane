export async function embed(env: Env, text: string): Promise<number[]> {
  const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: text.slice(0, 4000),
  });
  const data = result as { data?: number[][]; shape?: number[] };
  if (Array.isArray(data.data?.[0])) return data.data[0];
  if (Array.isArray((result as { data?: number[] }).data)) {
    return (result as { data: number[] }).data;
  }
  throw new Error("embed_failed");
}

export async function indexCandidate(
  env: Env,
  id: string,
  text: string,
  meta: Record<string, string>,
): Promise<void> {
  try {
    const values = await embed(env, text);
    await env.VEC_CANDIDATES.upsert([{ id, values, metadata: meta }]);
  } catch {
    // vector index is an accelerator, never block hiring flow
  }
}
