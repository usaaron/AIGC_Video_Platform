import type { NextConfig } from "next";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const hostApiUrl = (process.env.HOST_API_URL
  ?? (process.env.NODE_ENV !== "production" ? "http://localhost:8787" : "")).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Keep parent lockfiles and Unicode parent paths out of Turbopack chunk names.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  devIndicators: false,
  reactStrictMode: true,
  // Scene generation returns after a bounded model call and database commit.
  experimental: { proxyTimeout: 660_000 },
  async rewrites() {
    return [
      // The browser uses its own origin for host cookies. These exact host
      // endpoints must win over the independent FastAPI proxy in local dev.
      ...(hostApiUrl ? ["launch", "deliveries", "targets", "imports"].map((endpoint) => ({
        source: `/api/v1/script-master/${endpoint}`,
        destination: `${hostApiUrl}/api/v1/script-master/${endpoint}`,
        basePath: false as const,
      })) : []),
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
