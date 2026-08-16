import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // unpdf accesses `import.meta` in a way webpack cannot statically bundle
  // ("Critical dependency" build warning). It is server-only and works fine
  // loaded from node_modules at runtime, like better-sqlite3.
  serverExternalPackages: ["unpdf"],
  experimental: {
    serverActions: {
      // Objective import and the source library accept files up to 10 MB
      // (their forms and schemas enforce that cap); Next's 1 MB Server
      // Action default rejected those uploads with a 413 before any
      // application validation ran. 12mb leaves headroom for multipart
      // framing around a 10 MB file.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
