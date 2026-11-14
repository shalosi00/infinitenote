import type { NextConfig } from "next";

// Two build modes:
// - default ("standalone"): the web PWA. CI build-smoke and `bun run start`
//   boot the standalone Node server from this output.
// - NEXT_OUTPUT_MODE=export: a fully static bundle in ./out consumed by the
//   Tauri desktop shell (src-tauri/tauri.conf.json → build.frontendDist).
//   Triggered only by `bun run build:desktop`, so the web CI pipeline is
//   unaffected.
const isDesktopExport = process.env.NEXT_OUTPUT_MODE === "export";

// Baseline hardening headers for the web app (security audit, 2026-11-13).
// The app is a client-only local-first PWA: it serves no user-controlled
// HTML from other origins, embeds nothing, and needs no framing — so the
// safe defaults are deny/no-referrer-when-downgrade. The audio note
// recorder is the one feature that needs a device permission
// (getUserMedia({audio:true}) in note-app.tsx), so microphone stays
// allowed (self) while camera/geolocation stay denied. These apply to the
// standalone server; the Tauri shell serves the static export and sets its
// own webview context (CSP there is issue #NNN).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer-when-downgrade" },
  // `unload=(self)`: the vendored Excalidraw bundle registers an `unload`
  // cleanup handler; Chromium 159+ denies unload by default and logs a
  // permissions-policy violation on every page load. Allowing same-origin
  // unload keeps the intentional cleanup working (issue #223).
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), unload=(self)" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

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
  async headers() {
    // Static export has no server to attach headers to; the Tauri shell
    // governs its own webview context. Serve headers on the web build only.
    if (isDesktopExport) return [];
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
