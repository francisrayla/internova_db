import { createApiProxy } from "@/lib/serverProxy";

// Everything under /api/intern/* is forwarded to the backend as-is.
const proxy = createApiProxy("intern");
export const GET = proxy.GET;
export const POST = proxy.POST;
export const PATCH = proxy.PATCH;
export const DELETE = proxy.DELETE;
