const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
].join("; ");

export function securityHeaders(url: URL): Headers {
  const headers = new Headers();
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return headers;
}

export function applySecurityHeaders(response: Response, url: URL): Response {
  const next = new Response(response.body, response);
  const extra = securityHeaders(url);
  extra.forEach((value, key) => {
    if (!next.headers.has(key)) next.headers.set(key, value);
  });
  return next;
}
