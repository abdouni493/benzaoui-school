import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (a stray lockfile exists in the
  // user's home dir, which otherwise confuses Next's root inference).
  turbopack: {
    root: path.resolve(),
  },
};

export default nextConfig;
