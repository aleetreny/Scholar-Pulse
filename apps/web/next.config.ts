import type { NextConfig } from "next";

// GitHub Pages serves project sites under "/<repo>/"; CI passes the prefix
// via PAGES_BASE_PATH (from actions/configure-pages). Local dev and builds
// use no prefix.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: {
    // Client code fetches its own static assets (feed snapshots) and needs
    // the prefix at runtime.
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
