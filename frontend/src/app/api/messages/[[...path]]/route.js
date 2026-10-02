import { createApiProxy } from "@/lib/serverProxy";

// Everything under /api/messages (including the bare path) is forwarded to the backend as-is.
const proxy = createApiProxy("messages");
export const GET = proxy.GET;
export const POST = proxy.POST;
export const PATCH = proxy.PATCH;
