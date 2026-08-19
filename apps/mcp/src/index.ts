import { createMcpHandler } from "agents/mcp/server";
import { ensureBootstrapUser, readBearer, resolvePat } from "@scout-lane/core";
import { handleOAuth, unauthorized, withCors } from "./oauth";
import { buildServer } from "./tools";
import { clientIp, limit } from "./rate";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
    await ensureBootstrapUser(env.DB_MAIN, env.BOOTSTRAP_USERNAME, env.BOOTSTRAP_PASSWORD);

    const oauth = await handleOAuth(request, env);
    if (oauth) return oauth;

    if (url.pathname !== "/mcp") {
      return Response.json(
        {
          name: "scout-lane-mcp",
          mcp: `${url.origin}/mcp`,
          authorize: `${url.origin}/authorize`,
          authorization_server: `${url.origin}/.well-known/oauth-authorization-server`,
          protected_resource: `${url.origin}/.well-known/oauth-protected-resource`,
          docs: "Add this MCP URL as a custom connector. The client discovers OAuth and opens Scout Lane login.",
        },
        {
          headers: {
            "access-control-allow-origin": "*",
          },
        },
      );
    }

    if (!(await limit(env.KV_SESSIONS, `mcpgate:${clientIp(request)}`, 180, 60))) {
      return withCors(Response.json({ error: "rate_limited" }, { status: 429 }));
    }

    const token = readBearer(request);
    const user = token ? await resolvePat(env.DB_MAIN, token) : null;
    if (!user) {
      return unauthorized(url.origin);
    }

    const handled = await createMcpHandler(() => buildServer(env, user, request), {
      route: "/mcp",
      corsOptions: false,
    })(request, env, ctx);
    return withCors(handled);
    } catch (err) {
      return withCors(
        Response.json(
          { error: err instanceof Error ? err.message : "mcp_failed" },
          { status: 500 },
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
