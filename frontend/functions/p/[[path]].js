/**
 * Cloudflare Pages Function: serve floguardfl.com/p/<token>[/before.png|/after.png] from the CRM
 * (crm.floguardfl.com, Vercel), so lead links read floguardfl.com/p/... . Only GET/HEAD, only the
 * lead-page paths, no cookies or client headers forwarded.
 */
const ORIGIN = "https://crm.floguardfl.com";
const PATH_RE = /^\/p\/[A-Za-z0-9_-]{1,90}(\/(before|after)\.png)?$/;

export async function onRequest({ request }) {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  if (!PATH_RE.test(url.pathname)) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
  const upstream = await fetch(`${ORIGIN}${url.pathname}`, {
    method: request.method,
    headers: {
      "User-Agent": "floguard-pages-proxy",
      "X-Forwarded-For": request.headers.get("CF-Connecting-IP") || "",
    },
    redirect: "manual",
  });
  const headers = new Headers();
  for (const k of ["content-type", "cache-control", "content-security-policy", "x-robots-tag", "referrer-policy", "retry-after"]) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("x-robots-tag")) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}
