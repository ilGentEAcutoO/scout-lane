import { describe, expect, it } from "vitest";
import { randomToken, timingSafeEqualString } from "../src/security/crypto";

describe("crypto", () => {
  it("produces unique tokens", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken()).toHaveLength(64);
  });

  it("compares equal strings", async () => {
    expect(await timingSafeEqualString("alpha", "alpha")).toBe(true);
    expect(await timingSafeEqualString("alpha", "beta")).toBe(false);
  });
});
