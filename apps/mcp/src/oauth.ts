import { ensureBootstrapUser, issuePat, verifyUser } from "@scout-lane/core";
import { clientIp, limit } from "./rate";

function issuer(url: URL): string {
  return url.origin;
}

export function cors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET, POST, OPTIONS");
  h.set("access-control-allow-headers", "authorization, content-type, mcp-protocol-version");
  h.set("access-control-expose-headers", "www-authenticate, mcp-protocol-version");
  h.set("access-control-max-age", "86400");
  return h;
}

export function withCors(res: Response): Response {
  const headers = cors(res.headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    }),
  });
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function unauthorized(origin: string): Response {
  const metadata = resourceMetadataUrl(origin);
  return json(
    { error: "unauthorized" },
    401,
    {
      "www-authenticate": `Bearer realm="scout-lane", resource_metadata="${metadata}", as_uri="${origin}/.well-known/oauth-authorization-server"`,
      link: `<${metadata}>; rel="oauth-protected-resource"`,
    },
  );
}

export function authorizationServerMeta(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["scout-lane"],
    resource_parameter_supported: true,
    authorization_response_iss_parameter_supported: true,
    require_pkce: true,
  };
}

export function protectedResourceMeta(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["scout-lane"],
    resource_documentation: origin,
  };
}

export function isAsMetadataPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-authorization-server/mcp" ||
    pathname === "/.well-known/openid-configuration" ||
    pathname === "/.well-known/openid-configuration/mcp"
  );
}

export function isProtectedResourcePath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname.startsWith("/.well-known/oauth-protected-resource/")
  );
}

function metadata(url: URL): Response {
  const base = issuer(url);
  if (isAsMetadataPath(url.pathname)) return json(authorizationServerMeta(base));
  if (isProtectedResourcePath(url.pathname)) return json(protectedResourceMeta(base));
  return new Response("not found", { status: 404, headers: cors() });
}

export async function handleOAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  await ensureBootstrapUser(env.DB_MAIN, env.BOOTSTRAP_USERNAME, env.BOOTSTRAP_PASSWORD);

  if (request.method === "OPTIONS" && isOAuthPath(url.pathname)) {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (url.pathname.startsWith("/.well-known/")) return metadata(url);

  if (url.pathname === "/register" && request.method === "POST") {
    if (!(await limit(env.KV_SESSIONS, `reg:${clientIp(request)}`, 10, 60))) {
      return json({ error: "slow_down" }, 429);
    }
    const body = (await request.json().catch(() => ({}))) as {
      client_name?: string;
      redirect_uris?: string[];
    };
    const redirects = (body.redirect_uris ?? []).filter((u) => allowedRedirect(u));
    if (!redirects.length) return json({ error: "invalid_redirect_uri" }, 400);
    const clientId = crypto.randomUUID();
    await env.KV_SESSIONS.put(
      `oauth:client:${clientId}`,
      JSON.stringify({ clientId, name: body.client_name ?? "mcp", redirects }),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    return json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: body.client_name ?? "mcp",
    });
  }

  if (url.pathname === "/authorize" && request.method === "GET") {
    return authorizePage(url);
  }

  if (url.pathname === "/authorize" && request.method === "POST") {
    return completeAuthorize(request, env);
  }

  if (url.pathname === "/token" && request.method === "POST") {
    return issueToken(request, env);
  }

  return null;
}

function isOAuthPath(pathname: string): boolean {
  return (
    pathname.startsWith("/.well-known/") ||
    pathname === "/register" ||
    pathname === "/authorize" ||
    pathname === "/token" ||
    pathname === "/mcp"
  );
}

export function allowedRedirect(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function authorizePage(url: URL, error = ""): Response {
  const q = url.searchParams;
  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>เข้าสู่ระบบ · Scout Lane MCP</title>
<style>
  html{color-scheme:light only}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F4F5;font-family:Sarabun,Segoe UI,sans-serif;color:#18181B}
  form{width:min(380px,92vw);background:#fff;border:1px solid #E4E4E7;border-radius:16px;padding:28px 24px;box-shadow:0 12px 40px -20px rgba(0,0,0,.2)}
  .brand{display:flex;gap:10px;align-items:center;margin-bottom:18px}
  .mark{width:36px;height:36px;border-radius:10px;background:#18181B;color:#fff;display:grid;place-items:center;font-weight:700}
  h1{font-size:20px;margin:0}
  p{color:#71717A;font-size:14px;margin:4px 0 16px}
  .err{background:#FEF2F2;color:#991B1B;border-radius:10px;padding:8px 10px;font-size:13px;margin:0 0 12px}
  label{display:block;font-size:13px;margin:10px 0 4px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #E4E4E7;border-radius:10px;font:inherit}
  button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:999px;background:#18181B;color:#fff;font:inherit;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<form method="post" action="/authorize">
  <div class="brand"><div class="mark">S</div><div><h1>Scout Lane</h1></div></div>
  <p>คอนเนกเตอร์ขอเข้าพื้นที่ทำงาน — เข้าสู่ระบบเพื่ออนุญาต</p>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
  <input type="hidden" name="client_id" value="${esc(q.get("client_id") ?? "")}">
  <input type="hidden" name="redirect_uri" value="${esc(q.get("redirect_uri") ?? "")}">
  <input type="hidden" name="state" value="${esc(q.get("state") ?? "")}">
  <input type="hidden" name="code_challenge" value="${esc(q.get("code_challenge") ?? "")}">
  <input type="hidden" name="code_challenge_method" value="${esc(q.get("code_challenge_method") ?? "S256")}">
  <input type="hidden" name="resource" value="${esc(q.get("resource") ?? "")}">
  <label>ชื่อผู้ใช้</label>
  <input name="username" autocomplete="username" required>
  <label>รหัสผ่าน</label>
  <input name="password" type="password" autocomplete="current-password" required>
  <button type="submit">เข้าสู่ระบบและอนุญาต</button>
</form>
</body>
</html>`;
  return new Response(html, {
    headers: cors({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "cache-control": "no-store",
    }),
  });
}

async function completeAuthorize(request: Request, env: Env): Promise<Response> {
  if (!(await limit(env.KV_SESSIONS, `authz:${clientIp(request)}`, 8, 60))) {
    return new Response("slow down", { status: 429, headers: cors() });
  }
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const challenge = String(form.get("code_challenge") ?? "");
  const method = String(form.get("code_challenge_method") ?? "S256");
  const replay = new URL(request.url);
  replay.searchParams.set("client_id", clientId);
  replay.searchParams.set("redirect_uri", redirectUri);
  replay.searchParams.set("state", state);
  replay.searchParams.set("code_challenge", challenge);
  replay.searchParams.set("code_challenge_method", method);
  replay.searchParams.set("resource", String(form.get("resource") ?? ""));

  if (method !== "S256" || !challenge) return authorizePage(replay, "ต้องใช้ PKCE S256");

  const clientRaw = await env.KV_SESSIONS.get(`oauth:client:${clientId}`);
  if (!clientRaw) return authorizePage(replay, "ไม่รู้จักคอนเนกเตอร์นี้");
  const client = JSON.parse(clientRaw) as { redirects: string[] };
  if (!client.redirects.includes(redirectUri)) return authorizePage(replay, "redirect ไม่ตรงที่ลงทะเบียน");

  const user = await verifyUser(env.DB_MAIN, username, password);
  if (!user) return authorizePage(replay, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูก");

  const code = crypto.randomUUID();
  await env.KV_SESSIONS.put(
    `oauth:code:${code}`,
    JSON.stringify({
      userId: user.id,
      username: user.username,
      role: user.role,
      clientId,
      redirectUri,
      challenge,
    }),
    { expirationTtl: 90 },
  );
  const next = new URL(redirectUri);
  next.searchParams.set("code", code);
  if (state) next.searchParams.set("state", state);
  next.searchParams.set("iss", issuer(new URL(request.url)));
  return new Response(null, { status: 302, headers: cors({ location: next.toString() }) });
}

async function issueToken(request: Request, env: Env): Promise<Response> {
  if (!(await limit(env.KV_SESSIONS, `token:${clientIp(request)}`, 15, 60))) {
    return json({ error: "slow_down" }, 429);
  }
  const ctype = request.headers.get("content-type") ?? "";
  const params = ctype.includes("json")
    ? ((await request.json()) as Record<string, string>)
    : Object.fromEntries(new URLSearchParams(await request.text()));

  if (params.grant_type === "refresh_token") {
    const packed = await env.KV_SESSIONS.get(`oauth:refresh:${params.refresh_token ?? ""}`);
    if (!packed) return json({ error: "invalid_grant" }, 400);
    await env.KV_SESSIONS.delete(`oauth:refresh:${params.refresh_token}`);
    const grant = JSON.parse(packed) as { userId: string; clientId: string };
    const token = await issuePat(env.DB_MAIN, { id: grant.userId }, `oauth-refresh:${grant.clientId}`);
    const refresh = crypto.randomUUID();
    await env.KV_SESSIONS.put(
      `oauth:refresh:${refresh}`,
      JSON.stringify(grant),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    return json({
      access_token: token,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 60 * 60 * 24 * 30,
      scope: "scout-lane",
    });
  }

  if (params.grant_type !== "authorization_code") {
    return json({ error: "unsupported_grant_type" }, 400);
  }
  const packed = await env.KV_SESSIONS.get(`oauth:code:${params.code}`);
  if (!packed) return json({ error: "invalid_grant" }, 400);
  await env.KV_SESSIONS.delete(`oauth:code:${params.code}`);
  const grant = JSON.parse(packed) as {
    userId: string;
    username: string;
    role: string;
    clientId: string;
    redirectUri: string;
    challenge: string;
  };
  if (grant.redirectUri !== params.redirect_uri) return json({ error: "invalid_grant" }, 400);
  if (!(await verifyPkce(params.code_verifier ?? "", grant.challenge))) {
    return json({ error: "invalid_grant" }, 400);
  }
  const token = await issuePat(env.DB_MAIN, { id: grant.userId }, `oauth:${grant.clientId}`);
  const refresh = crypto.randomUUID();
  await env.KV_SESSIONS.put(
    `oauth:refresh:${refresh}`,
    JSON.stringify({ userId: grant.userId, clientId: grant.clientId }),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );
  return json({
    access_token: token,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: 60 * 60 * 24 * 30,
    scope: "scout-lane",
  });
}

async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || verifier.length < 43) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return b64 === challenge;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}
