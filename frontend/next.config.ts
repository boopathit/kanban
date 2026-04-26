import type { NextConfig } from "next";

const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: false,
  ...(isDev
    ? {
        async rewrites() {
          // Dev-only API proxy so `npm run dev` on :3000 can talk to the FastAPI
          // backend on :8000 while keeping frontend fetch calls at `/api/*`.
          return [
            {
              source: "/api/:path*",
              destination: `${backendOrigin}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
