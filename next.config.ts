import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  ...(basePath ? { basePath, assetPrefix: `${basePath}/` } : {}),
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.wasm$/i,
      type: "asset/resource",
    });
    config.resolve.alias = {
      ...config.resolve.alias,
      "@duckdb/duckdb-wasm/dist/duckdb-node.cjs": false,
    };
    return config;
  },
};

export default nextConfig;
