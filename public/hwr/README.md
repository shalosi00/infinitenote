# Vendored handwriting-recognition assets

Everything the "Recognize handwriting" action needs **except the JS
runtime**, served same-origin — the app never contacts a CDN at runtime
(offline-first PWA / F-Droid stance, identical rule to `../ocr/`), and
the recognized ink never leaves the device (issue #175).

The runtime itself is the pinned npm dependency
`@huggingface/transformers` 4.3.2 (Apache-2.0), loaded via dynamic import
into a lazy chunk. Vendoring its minified bundle file was rejected
2026-11-10: GitHub push protection false-positives on a provider-template
string inside it ("Mistral AI API Key"), and a mutated bundle would break
the sha256 pinning story. The heavy, pinning-worthy bytes are vendored
here:

| Piece | Version | License | Source |
|---|---|---|---|
| `ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` | 1.31.0-dev.20260914-8d85527a0 | MIT | npm `onnxruntime-web` (the exact version transformers.js 4.3.2 depends on) |
| `models/trocr-small-handwritten/**` | q8 quantized | MIT | huggingface.co/Xenova/trocr-small-handwritten |

Why the `asyncify` wasm flavor: this is the variant ONNX Runtime Web
1.31 actually fetches in a non-cross-origin-isolated page (measured
2026-11-10 — the request log contained exactly
`ort-wasm-simd-threaded.asyncify.{mjs,wasm}` and nothing else). The
plain/jsep/jspi variants are not loaded and deliberately not vendored;
`docs/test-plans/handwriting.md` records the WebGPU (jsep) measurement
that kept Phase A on WASM.

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
