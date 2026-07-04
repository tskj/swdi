import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared workspace package ships plain TypeScript source (its `main` points at
  // src/index.ts), so Next must compile it as part of the app bundle.
  transpilePackages: ["@swdi/shared"],
};

export default nextConfig;
