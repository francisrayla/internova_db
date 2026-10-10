import { NextResponse } from "next/server";
import { BACKEND_URL } from '@/lib/backendUrl';

// Streams a file from the Laravel backend's public storage back through
// this same origin, with a real Content-Disposition: attachment header —
// the browser can't fetch() the backend's storage URL directly (different
// origin, no CORS on it, and every other call in this app already goes
// through a same-origin proxy like this one for the same reason). Only
// ever proxies our own backend's storage paths, never an arbitrary URL, so
// this can't be turned into an open fetch-anything relay.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  const name = searchParams.get("name") || "download";

  if (!path || path.includes("..") || !/^storage\/[\w./-]+$/.test(path)) {
    return NextResponse.json({ success: false, message: "Invalid file path." }, { status: 400 });
  }

  const upstream = await fetch(`${BACKEND_URL}/${path}`);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ success: false, message: "File not found." }, { status: 404 });
  }

  // Never hand the browser a type it could render as a page from our origin, and never let it guess one.
  let contentType = (upstream.headers.get("content-type") || "application/octet-stream").toLowerCase();
  if (/(html|svg|xml|javascript|ecmascript)/.test(contentType)) contentType = "application/octet-stream";

  // The name goes into a header: strip quotes, slashes and control characters (no header injection),
  // and give non-ASCII names in the RFC 5987 form.
  const safeName = (name.replace(/[\u0000-\u001f\u007f"\\/]/g, "").trim().slice(0, 150)) || "download";
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
