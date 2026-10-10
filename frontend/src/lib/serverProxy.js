import { NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backendUrl";

// Shared by every Next.js API route that proxies to the Laravel backend.
// Forwards the browser's Bearer token through to Laravel — without this,
// every proxied request would look unauthenticated no matter what the
// client sent, since Next.js route handlers run server-side and don't
// share the browser's localStorage.
/**
 * The visitor's address, for the backend's per-IP rate limits. Laravel only ever sees this Next.js
 * server as the caller, so without it every visitor would share one IP bucket. Prefers x-real-ip,
 * else the LAST x-forwarded-for entry (the one our own proxy added; earlier ones can be typed by the visitor).
 */
export function clientIpHeader(request) {
  const real = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).pop();
  const ip = real || forwarded;
  return ip ? { "X-Client-IP": ip } : {};
}

export function forwardHeaders(request, extra = {}) {
  const headers = { Accept: "application/json", ...clientIpHeader(request), ...extra };
  const auth = request.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  return headers;
}

/**
 * Route handlers that pass every request under /api/<prefix>/... straight
 * through to the same path on the Laravel backend — one implementation for
 * the per-role catch-all routes instead of a copy in each.
 */
export function createApiProxy(prefix) {
  async function proxy(request, params, method) {
    const path = (Array.isArray(params?.path) ? params.path : []).join("/");
    const { search } = new URL(request.url);
    const base = `${BACKEND_URL}/api/${prefix}`;
    const upstream = `${path ? `${base}/${path}` : base}${search}`;

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");
    const init = {
      method,
      headers: forwardHeaders(request, isMultipart ? {} : { "Content-Type": "application/json" }),
    };
    if (method !== "GET" && method !== "HEAD") {
      init.body = isMultipart ? await request.formData() : await request.text();
    }

    const response = await fetch(upstream, init);

    // File downloads (e.g. the Word narrative report) pass through untouched.
    const upstreamType = response.headers.get("content-type") || "";
    if (response.ok && upstreamType && !upstreamType.includes("json")) {
      const headers = new Headers();
      headers.set("Content-Type", upstreamType);
      const disposition = response.headers.get("content-disposition");
      if (disposition) headers.set("Content-Disposition", disposition);
      return new NextResponse(await response.arrayBuffer(), { status: response.status, headers });
    }

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  }

  const handler = (method) => async (request, { params }) => proxy(request, await params, method);
  return { GET: handler("GET"), POST: handler("POST"), PUT: handler("PUT"), PATCH: handler("PATCH"), DELETE: handler("DELETE") };
}
