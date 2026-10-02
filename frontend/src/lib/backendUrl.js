// Every /api/* route in this app is a Next.js server route that proxies to
// the real Laravel backend rather than the browser calling it directly (see
// each route.js for why — mostly CORS and keeping the auth token off the
// client). Locally that backend is always 127.0.0.1:8000; in production
// it's a separate deployed service, reached over Railway's private network
// via BACKEND_URL (e.g. http://backend.railway.internal:8080).
export const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
