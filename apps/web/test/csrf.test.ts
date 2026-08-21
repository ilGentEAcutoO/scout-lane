import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "../src/security/csrf";
import { HttpError } from "../src/http/errors";

function req(headers: Record<string, string>, method = "POST") {
  return new Request("https://scout-lane.sornkan.workers.dev/api/login", { method, headers });
}

describe("csrf same origin", () => {
  it("allows a same-origin form post when Origin is null but Sec-Fetch-Site is same-origin", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "null", "sec-fetch-site": "same-origin" })),
    ).not.toThrow();
  });

  it("rejects a foreign Origin", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }))).toThrow(HttpError);
  });
});
