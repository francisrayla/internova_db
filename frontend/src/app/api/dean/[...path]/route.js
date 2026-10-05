import { createApiProxy } from "@/lib/serverProxy";

// Everything under /api/dean/* is forwarded to the backend as-is.
const proxy = createApiProxy("dean");
export const GET = proxy.GET;
export const POST = proxy.POST;
export const PATCH = proxy.PATCH;
export const DELETE = proxy.DELETE;
