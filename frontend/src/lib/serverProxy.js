// Shared by every Next.js API route that proxies to the Laravel backend.
// Forwards the browser's Bearer token through to Laravel — without this,
// every proxied request would look unauthenticated no matter what the
// client sent, since Next.js route handlers run server-side and don't
// share the browser's localStorage.
export function forwardHeaders(request, extra = {}) {
  const headers = { Accept: "application/json", ...extra };
  const auth = request.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  return headers;
}
