import { NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backendUrl";

// Uploaded files (selfies, avatars, documents, chat attachments...) are served from this same origin so the
// service worker can cache them (see public/sw.js). This used to be a next.config.js rewrite, but Next.js
// does not apply the headers() rules to a proxied (external) rewrite, so the nosniff + CSP headers meant to
// protect these files never reached the browser. A route handler sets them on every response.
const FORWARD = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];

async function serve(request, { params }, method) {
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [path];
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("\\") || /[\u0000-\u001f]/.test(s))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = {};
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const conditional = request.headers.get("if-none-match");
  if (conditional) headers["If-None-Match"] = conditional;

  let upstream;
  try {
    upstream = await fetch(`${BACKEND_URL}/storage/${segments.map(encodeURIComponent).join("/")}`, { method, headers, cache: "no-store" });
  } catch {
    return new NextResponse("File unavailable", { status: 502 });
  }

  const out = new Headers();
  for (const name of FORWARD) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  // Never hand the browser a type it could render as a page from our origin.
  if (/(html|svg|xml|javascript|ecmascript)/i.test(out.get("content-type") || "")) out.set("content-type", "application/octet-stream");
  out.set("X-Content-Type-Options", "nosniff");
  out.set(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
  );
  out.set("Referrer-Policy", "no-referrer");

  return new NextResponse(method === "HEAD" || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}

export function GET(request, context) {
  return serve(request, context, "GET");
}

export function HEAD(request, context) {
  return serve(request, context, "HEAD");
}
