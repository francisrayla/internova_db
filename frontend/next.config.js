// Same backend-location logic as src/lib/backendUrl.js, duplicated here
// because next.config.js is loaded outside the app's module graph and
// can't import from src/. Locally the backend is 127.0.0.1:8000; in
// production BACKEND_URL points at the deployed backend service.
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const nextConfig = {
  // Next.js adds "X-Powered-By: Next.js" to every response; nothing needs it.
  poweredByHeader: false,
  // Uploaded files (chat attachments, documents, photos...) are served from our own origin through the
  // /storage rewrite below. These headers make sure a file that is somehow not what it claims to be
  // (an html/svg uploaded in the past, or a future validation gap) can never run script on our domain:
  // no content sniffing, and a CSP that forbids scripts, plugins, forms and base changes on the file itself.
  async headers() {
    return [
      // Every page and API response: no content sniffing, never framed by another site (clickjacking),
      // referrer trimmed to the origin, and only this site may use the camera / location (attendance selfie).
      // No Content-Security-Policy here on purpose: the app relies on inline scripts (theme init, Next.js
      // bootstrap) and a policy needs nonces first. The /storage rule below is listed after this one so its
      // stricter Referrer-Policy wins for uploaded files.
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=()' },
        ],
      },
      {
        source: '/storage/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/superadmin/:path*',
        destination: `${BACKEND_URL}/api/superadmin/:path*`,
      },
      // /storage/* is served by the route handler in src/app/storage/[...path]/route.js (a rewrite would drop
      // the security headers above).
    ];
  },
};

export default nextConfig;
