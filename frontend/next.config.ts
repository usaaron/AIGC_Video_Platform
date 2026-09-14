import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Keep parent lockfiles and Unicode parent paths out of Turbopack chunk names.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
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
