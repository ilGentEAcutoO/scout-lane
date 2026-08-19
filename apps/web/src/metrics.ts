export function track(env: Env, blob: string, extra: number[] = []): void {
  try {
    env.METRICS.writeDataPoint({
      blobs: [blob],
      doubles: extra,
      indexes: [blob],
    });
  } catch {
    // analytics must never break the request
  }
}
