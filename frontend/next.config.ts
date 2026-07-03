import type { NextConfig } from "next";

// Proxy /api/* to the FastAPI backend so the browser stays same-origin (no CORS in dev).
const API_TARGET = process.env.API_PROXY_TARGET || "http://localhost:8077";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
