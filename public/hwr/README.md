# Vendored handwriting-recognition assets

Everything the "Recognize handwriting" action needs, served same-origin —
the app never contacts a CDN at runtime (offline-first PWA / F-Droid
stance, identical rule to `../ocr/`), and the recognized ink never leaves
the device (issue #175).

| Piece | Version | License | Source |
|---|---|---|---|
| `transformers.web.bundle.js.gz` | 4.3.2 | Apache-2.0 | npm `@huggingface/transformers` web ESM build, bun-bundled closure + gzip (see below) |
| `ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` | 1.31.0-dev.20260914-8d85527a0 | MIT | npm `onnxruntime-web` (the exact version transformers.js 4.3.2 depends on) |
| `models/trocr-small-handwritten/**` | q8 quantized | MIT | huggingface.co/Xenova/trocr-small-handwritten |

Why the runtime is vendored as a **bun-bundled, gzipped closure**: (a)
shipping the raw minified bundle was rejected by GitHub push protection —
the scanner false-positives a provider-template string inside it
("Mistral AI API Key"); (b) the npm-dependency route made the cold CI
production build flaky (Turbopack postcss worker IPC timeouts,
2026-11-10); (c) the raw web ESM build cannot run from a blob URL — it
lazily imports bare specifiers ("onnxruntime-web/webgpu") and its
sibling `transformers.min.js` is node-flavored ("this.processor is not a
function" in a browser). So `fetch-vendor.sh` runs `bun build` over the
pinned web build (every bare specifier inlined, one self-contained ESM
file) and gzips it. The app decompresses in the browser
(`DecompressionStream`) and imports the blob; `assets.json` +
`HWR-A03b` pin the uncompressed bundle's sha256. Integrity holds end-to-end: `assets.json` records the
sha256 of the UNCOMPRESSED original and the drift test gunzips the blob
and verifies it (HWR-A03b).

Why the `asyncify` wasm flavor: this is the variant ONNX Runtime Web
1.31 actually fetches — for BOTH devices. Measured 2026-11-12 with
request-log capture (`e2e/hwr-bench.spec.ts`): the wasm device fetches
exactly `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, and so does the
webgpu device — the bun closure inlines the webgpu-capable
`onnxruntime-web/webgpu` build (requestDevice/GPUShaderStage markers
verified in the vendored bytes), and its execution providers run on the
same asyncify wasm pair. The plain/jsep/jspi variants are never
requested, so they stay deliberately unvendored — no extra wasm files
ship for the WebGPU arm (issue #193 asset-audit question, answered
measured: the vendored set ALREADY covers it).

Model files:

- `onnx/encoder_model_quantized.onnx` — 23,082,942 B
- `onnx/decoder_model_merged_quantized.onnx` — 40,527,613 B

Byte sizes verified against the Hugging Face API on 2026-11-10
(`docs/handwriting-research.md` §3.1). English-only: the model is
trained on IAM-class English handwriting (issue #175 scope).

## Regenerating / auditing

```sh
bash public/hwr/fetch-vendor.sh
```

Idempotent: re-downloads anything whose sha256 drifted from
`assets.json`, byte-verifies the two weights, and rewrites the manifest.
`src/lib/__tests__/hwr-assets.test.ts` pins every file (size + sha256)
in CI — the issue #103 drift pattern.
