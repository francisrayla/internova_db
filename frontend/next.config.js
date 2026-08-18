const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/superadmin/:path*',
        destination: 'http://127.0.0.1:8000/api/superadmin/:path*',
      },
    ];
  },
};

export default nextConfig;
