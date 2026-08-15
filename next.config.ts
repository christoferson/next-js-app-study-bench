import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // unpdf accesses `import.meta` in a way webpack cannot statically bundle
  // ("Critical dependency" build warning). It is server-only and works fine
  // loaded from node_modules at runtime, like better-sqlite3.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
