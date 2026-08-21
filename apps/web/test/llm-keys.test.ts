import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, aiSettingsSchema, aiStatusSchema } from "@scout-lane/core";
import { openSecret, sealSecret } from "../src/llm/keys";
import { secretFor } from "../src/llm/providers";

const env = { SESSION_SECRET: "unit-test-session-secret-value" } as Env;

describe("llm key vault", () => {
  it("round-trips a secret and never stores the plaintext", async () => {
    const packed = await sealSecret(env, "sk-ant-secret-value");
    expect(packed.startsWith("v1:")).toBe(true);
    expect(packed).not.toMatch(/sk-ant-secret-value/);
    expect(await openSecret(env, packed)).toBe("sk-ant-secret-value");
  });

  it("returns null for tampered ciphertext", async () => {
    const packed = await sealSecret(env, "glm-key");
    expect(await openSecret(env, packed.slice(0, -2) + "xx")).toBeNull();
    expect(await openSecret(env, "not-a-blob")).toBeNull();
  });

  it("does not decrypt with a different wrapping secret", async () => {
    const packed = await sealSecret({ SESSION_SECRET: "wrap-one" } as Env, "sk-live");
    expect(await openSecret({ SESSION_SECRET: "wrap-two" } as Env, packed)).toBeNull();
  });

  it("prefers KEY_ENCRYPTION_KEY over SESSION_SECRET", async () => {
    const packed = await sealSecret(
      { SESSION_SECRET: "session-a", KEY_ENCRYPTION_KEY: "wrap-dedicated" } as Env,
      "sk-live",
    );
    expect(
      await openSecret({ SESSION_SECRET: "session-b", KEY_ENCRYPTION_KEY: "wrap-dedicated" } as Env, packed),
    ).toBe("sk-live");
    expect(await openSecret({ SESSION_SECRET: "session-a" } as Env, packed)).toBeNull();
  });
});

describe("secretFor", () => {
  it("ignores GLM_API_KEY in env and requires a stored settings key", async () => {
    const env = {
      GLM_API_KEY: "glm-from-env-must-not-be-used",
      ANTHROPIC_API_KEY: "sk-ant-from-env",
      SESSION_SECRET: "unit-test-session-secret-value",
      DB_MAIN: {
        prepare() {
          return {
            bind() {
              return { first: async () => null };
            },
          };
        },
      },
    } as unknown as Env;
    expect(await secretFor(env, "glm")).toEqual({ key: "", source: null });
    expect(await secretFor(env, "claude")).toEqual({ key: "", source: null });
  });
});

describe("ai settings schema", () => {
  it("keeps only provider and keys, drops extras that could leak tokens", () => {
    const parsed = aiSettingsSchema.parse({
      provider: "claude",
      keys: { claude: "sk-ant-new" },
      token: "apify_api_xxx",
      cookie: "session=1",
    });
    expect(parsed).toEqual({ provider: "claude", keys: { claude: "sk-ant-new" } });
    expect(JSON.stringify(parsed)).not.toMatch(/apify_api|session=/);
    expect(AI_PROVIDERS).toContain("openai");
    expect(AI_PROVIDERS).toContain("gemini");
  });

  it("strips keys from the public status payload", () => {
    const parsed = aiStatusSchema.parse({
      provider: "glm",
      keys: { glm: "sk-leak-plain" },
      providers: [
        {
          id: "glm",
          label: "GLM",
          hint: "Zhipu",
          keyFrom: "https://z.ai/manage-apikey/apikey-list",
          configured: true,
          source: "stored",
          key: "sk-leak-plain",
          ciphertext: "v1:aaa:bbb",
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/sk-leak|v1:aaa/);
    expect(parsed.providers[0]).toEqual({
      id: "glm",
      label: "GLM",
      hint: "Zhipu",
      keyFrom: "https://z.ai/manage-apikey/apikey-list",
      configured: true,
      source: "stored",
    });
  });
});
