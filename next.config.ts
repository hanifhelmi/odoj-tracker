import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `output: "standalone"` hanya untuk self-host lokal (bun run start).
  // Di Vercel biarkan default agar build & bundling dikelola Vercel.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
