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
  // the handwriting engine is imported dynamically in the browser only —
  // keep it external in SSR bundles (never executed server-side) so the
  // native onnxruntime-node bits never enter a server bundle
  serverExternalPackages: ["@huggingface/transformers"],
  // Static export has no image-optimization server available.
  images: isDesktopExport ? { unoptimized: true } : undefined,
  // type errors FAIL the build (issue #104): the standalone tsc gate covers
  // PRs, but `next build` must never pass with broken types on its own
  reactStrictMode: false,
};

export default nextConfig;
