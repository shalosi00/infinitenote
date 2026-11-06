import type { NextConfig } from "next";

// Two build modes:
// - default ("standalone"): the web PWA. CI build-smoke and `bun run start`
//   boot the standalone Node server from this output.
// - NEXT_OUTPUT_MODE=export: a fully static bundle in ./out consumed by the
//   Tauri desktop shell (src-tauri/tauri.conf.json → build.frontendDist).
//   Triggered only by `bun run build:desktop`, so the web CI pipeline is
//   unaffected.
const isDesktopExport = process.env.NEXT_OUTPUT_MODE === "export";

const nextConfig: NextConfig = {
  output: isDesktopExport ? "export" : "standalone",
  // Static export has no image-optimization server available.
  images: isDesktopExport ? { unoptimized: true } : undefined,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
