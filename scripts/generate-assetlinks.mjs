#!/usr/bin/env node
// Writes public/.well-known/assetlinks.json for the Android TWA wrapper.
//
// Usage (run with Bun — it imports the TypeScript lib in src/lib/assetlinks.ts):
//   bun scripts/generate-assetlinks.mjs \
//     --package com.infinitenote.app \
//     --fingerprint "AA:BB:...:FF" \
//     [--out public/.well-known/assetlinks.json]
//
// The fingerprint is the SHA-256 digest of the signing certificate, e.g. from
// `keytool -list -v -keystore android-twa/upload-keystore.jks`. See
// docs/android-twa.md for the full runbook.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildAssetLinks } from "../src/lib/assetlinks.ts";

function parseArgs(argv) {
  const args = { out: "public/.well-known/assetlinks.json" };
  const keys = new Set(["--package", "--fingerprint", "--out"]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!keys.has(key) || i + 1 >= argv.length) {
      console.error("Usage: bun scripts/generate-assetlinks.mjs --package <name> --fingerprint <sha256> [--out <path>]");
      process.exit(2);
    }
    args[key.slice(2).replaceAll("-", "_")] = argv[i + 1];
  }
  if (!args.package || !args.fingerprint) {
    console.error("--package and --fingerprint are required");
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

let statements;
try {
  statements = buildAssetLinks(args.package, args.fingerprint);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(statements, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(`  package: ${args.package}`);
console.log(`  fingerprint: ${statements[0].target.sha256_cert_fingerprints[0]}`);
console.log("Next: commit the file, deploy it at https://<host>/.well-known/assetlinks.json,");
console.log("then verify: https://digitalassetlinks.googleapis.com/v1/statements:list?web.site=<host>&statement.android.package_name=<pkg>");
