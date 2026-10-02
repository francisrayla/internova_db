// Same backend-location logic as src/lib/backendUrl.js, duplicated here
// because next.config.js is loaded outside the app's module graph and
// can't import from src/. Locally the backend is 127.0.0.1:8000; in
// production BACKEND_URL points at the deployed backend service.
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/superadmin/:path*',
        destination: `${BACKEND_URL}/api/superadmin/:path*`,
      },
      // Uploaded photos are served through this origin so the service
      // worker can cache them for offline viewing (see public/sw.js).
      {
        source: '/storage/:path*',
        destination: `${BACKEND_URL}/storage/:path*`,
      },
    ];
  },
};

export default nextConfig;
