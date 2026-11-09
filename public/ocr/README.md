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
| `lang/deu.traineddata.gz` | German fast model, tessdata 4.0.0_fast | Apache-2.0 |

`assets.json` pins sizes + sha256 for every file; unit tests
(`src/lib/__tests__/ocr-assets.test.ts`) fail when anything drifts.
Upgrade procedure: replace files, update the version fields + hashes in
`assets.json`, re-run `bun test src/lib/__tests__/ocr-assets.test.ts` and
the ocr e2e spec.

## Why a German model (and no English one)?

Since 2026-11-09 the engine runs the **German** fast model only — it
recognizes German (umlauts, ß) AND English text. Measured with the real
tesseract.js 6.0.1 (evidence table in `docs/test-plans/ocr.md`): the
multi-language combinations `eng+deu` / `deu+eng` let the English model
outvote the umlauts away (`Ä→A`, `Ö→O`, `Ü→U`), failing German outright,
while `deu` alone aced all nine German probe words AND every English
probe (including `QUOKKA NOTEBOOK`, the committed English E2E fixture —
that spec is the English regression net). One model, one code path,
−1.98 MB. Source: <https://github.com/tesseract-ocr/tessdata_fast>
(`deu.traineddata`, gzipped with `gzip -9 -n` for reproducible bytes).
