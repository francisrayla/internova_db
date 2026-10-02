import { createApiProxy } from "@/lib/serverProxy";

// Everything under /api/supervisor/* is forwarded to the backend as-is.
const proxy = createApiProxy("supervisor");
export const GET = proxy.GET;
export const POST = proxy.POST;
export const PATCH = proxy.PATCH;
export const DELETE = proxy.DELETE;
