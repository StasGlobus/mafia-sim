import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./supabase/migrations/**"],
  },
};

export default nextConfig;
