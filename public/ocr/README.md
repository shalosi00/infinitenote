# Vendored OCR engine

On-device OCR for images and PDF printouts (docs/test-plans/ocr.md).
Everything the engine needs is vendored here so the app never touches a
CDN — the same offline-first rule as the self-hosted Excalidraw fonts and
the pdf.js worker.

| File | What it is | License |
|---|---|---|
| `tesseract.min.js` | tesseract.js 6.0.1 browser UMD bundle | Apache-2.0 |
| `worker.min.js` | tesseract.js 6.0.1 web worker | Apache-2.0 |
| `core/tesseract-core-simd-lstm.wasm.js` | tesseract.js-core 6.0.0, WASM SIMD, LSTM-only | Apache-2.0 |
| `core/tesseract-core-lstm.wasm.js` | tesseract.js-core 6.0.0, non-SIMD fallback (older WebKitGTK) | Apache-2.0 |
| `lang/eng.traineddata.gz` | English fast model, tessdata 4.0.0_fast | Apache-2.0 |

`assets.json` pins sizes + sha256 for every file; unit tests
(`src/lib/__tests__/ocr-assets.test.ts`) fail when anything drifts.
Upgrade procedure: replace files, update the version fields + hashes in
`assets.json`, re-run `bun test src/lib/__tests__/ocr-assets.test.ts` and
the ocr e2e spec.
