import { describe, expect, it } from "vitest";
import {
  allowedRedirect,
  authorizationServerMeta,
  isAsMetadataPath,
  isProtectedResourcePath,
  protectedResourceMeta,
  resourceMetadataUrl,
  unauthorized,
} from "../../mcp/src/oauth";

describe("oauth discovery", () => {
  const origin = "https://scoutlane-worker-mcp.example.workers.dev";

  it("points connectors at login and the mcp resource", () => {
    const as = authorizationServerMeta(origin);
    expect(as.authorization_endpoint).toBe(`${origin}/authorize`);
    expect(as.token_endpoint).toBe(`${origin}/token`);
    expect(as.registration_endpoint).toBe(`${origin}/register`);
    expect(as.code_challenge_methods_supported).toContain("S256");
    expect(as.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(as.require_pkce).toBe(true);
    expect(protectedResourceMeta(origin).resource).toBe(`${origin}/mcp`);
    expect(protectedResourceMeta(origin).authorization_servers).toEqual([origin]);
    expect(resourceMetadataUrl(origin)).toContain("oauth-protected-resource");
  });

  it("serves well-known paths that Claude ChatGPT Gemini and Grok probe", () => {
    expect(isAsMetadataPath("/.well-known/oauth-authorization-server")).toBe(true);
    expect(isAsMetadataPath("/.well-known/oauth-authorization-server/mcp")).toBe(true);
    expect(isAsMetadataPath("/.well-known/openid-configuration")).toBe(true);
    expect(isAsMetadataPath("/.well-known/openid-configuration/mcp")).toBe(true);
    expect(isProtectedResourcePath("/.well-known/oauth-protected-resource")).toBe(true);
    expect(isProtectedResourcePath("/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(isAsMetadataPath("/authorize")).toBe(false);
  });

  it("challenges unauthenticated MCP with resource_metadata so the client opens login", () => {
    const res = unauthorized(origin);
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
    expect(challenge).toContain("as_uri=");
    expect(res.headers.get("access-control-expose-headers")).toMatch(/www-authenticate/i);
    expect(res.headers.get("link")).toContain('rel="oauth-protected-resource"');
  });

  it("accepts https and loopback redirects used by desktop connectors", () => {
    expect(allowedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(allowedRedirect("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(allowedRedirect("http://127.0.0.1:1455/callback")).toBe(true);
    expect(allowedRedirect("http://evil.example/cb")).toBe(false);
  });
});
