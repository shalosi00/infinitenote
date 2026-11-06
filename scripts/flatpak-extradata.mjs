#!/usr/bin/env node
// Pins the real AppImage asset into the flatpak extra-data manifest.
//
// The manifest packaging/flatpak/com.infinitenote.app.json ships the release
// AppImage via flatpak-builder's `extra-data` source, which requires the exact
// download URL, SHA-256 and byte size. Those are only knowable once the
// Desktop workflow has attached artifacts to a tagged release — this tool
// reads them from the GitHub release API, downloads the asset, and writes the
// real values into the manifest (url + sha256 + size).
//
// Usage:
//   bun scripts/flatpak-extradata.mjs --tag v1.6.0
//   bun scripts/flatpak-extradata.mjs --tag v1.6.0 --check   # verify only
//
// Run with Bun (uses fetch + writes JSON). Docs: docs/flathub.md.

import { readFileSync, writeFileSync } from "node:fs";

const REPO = "shalosi00/infinitenote";
const MANIFEST = "packaging/flatpak/com.infinitenote.app.json";

function parseArgs(argv) {
  const args = { manifest: MANIFEST, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") args.tag = argv[++i];
    else if (argv[i] === "--manifest") args.manifest = argv[++i];
    else if (argv[i] === "--check") args.check = true;
  }
  if (!args.tag || !/^v\d+\.\d+\.\d+$/.test(args.tag)) {
    console.error("Usage: bun scripts/flatpak-extradata.mjs --tag vX.Y.Z [--manifest path] [--check]");
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const headers = { "Accept": "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;

const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${args.tag}`, { headers });
if (!releaseRes.ok) {
  console.error(`error: release ${args.tag} not reachable (HTTP ${releaseRes.status}). ` +
    "Tag the release and wait for the Desktop workflow to attach artifacts first.");
  process.exit(1);
}
const release = await releaseRes.json();
const appimages = release.assets.filter((a) => a.name.endsWith(".AppImage"));
if (appimages.length !== 1) {
  console.error(`error: expected exactly one .AppImage asset on ${args.tag}, found ${appimages.length}: ` +
    release.assets.map((a) => a.name).join(", "));
  process.exit(1);
}
const asset = appimages[0];
console.log(`asset: ${asset.name} (${asset.size} bytes)`);

const manifestPath = process.cwd() + "/" + args.manifest;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const module = manifest.modules?.[0];
const extra = module?.sources?.find((s) => s.type === "extra-data");
if (!extra) {
  console.error(`error: no extra-data source in ${args.manifest}`);
  process.exit(1);
}

const isPinned = typeof extra.sha256 === "string" && /^[0-9a-f]{64}$/.test(extra.sha256) && extra.size > 0;

if (args.check) {
  if (!isPinned) {
    console.error("check FAILED: extra-data sha256/size are not pinned. " +
      "Run: bun scripts/flatpak-extradata.mjs --tag " + args.tag);
    process.exit(1);
  }
  console.log(`check OK: ${extra.url}`);
  console.log(`  sha256: ${extra.sha256}`);
  console.log(`  size:   ${extra.size}`);
  process.exit(0);
}

// Download the asset and compute the real checksum + size.
console.log(`downloading ${asset.browser_download_url} ...`);
const fileRes = await fetch(asset.browser_download_url, { redirect: "follow" });
if (!fileRes.ok) {
  console.error(`error: download failed (HTTP ${fileRes.status})`);
  process.exit(1);
}
const bytes = Buffer.from(await fileRes.arrayBuffer());
const { createHash } = await import("node:crypto");
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (bytes.length !== asset.size) {
  console.error(`error: downloaded ${bytes.length} bytes but the API reported ${asset.size}`);
  process.exit(1);
}

extra.url = asset.browser_download_url;
extra.sha256 = sha256;
extra.size = bytes.length;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`pinned ${args.manifest}:`);
console.log(`  url:    ${extra.url}`);
console.log(`  sha256: ${sha256}`);
console.log(`  size:   ${bytes.length}`);
console.log("Next: commit the change, then follow docs/flathub.md for the submission build.");
