import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  devIndicators: false,
  reactStrictMode: true,
  // Scene generation returns after a bounded model call and database commit.
  experimental: { proxyTimeout: 660_000 },
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000"}/:path*`,
    }];
  },
};

export default nextConfig;
