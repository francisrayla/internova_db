import { createApiProxy } from "@/lib/serverProxy";

// Everything under /api/coordinator/* is forwarded to the backend as-is.
const proxy = createApiProxy("coordinator");
export const GET = proxy.GET;
export const POST = proxy.POST;
export const PUT = proxy.PUT;
export const PATCH = proxy.PATCH;
export const DELETE = proxy.DELETE;
