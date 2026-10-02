import { NextResponse } from "next/server";

// The server's clock, for the attendance camera: the selfie stamp and
// offline clock-ins are timed from this, not from the phone's own clock
// (which the user can change). Never cached — see public/sw.js.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
