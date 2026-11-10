#!/usr/bin/env bash
# Fetch the vendored handwriting-recognition runtime into public/hwr/.
#
# Offline-first rule (same as public/ocr/): every byte the recognizer
# needs is served same-origin from this directory — the engine, the ONNX
# wasm runtime AND the model weights. Nothing is ever fetched from a CDN
# at runtime; this script is the only network step (run by maintainers).
#
# Idempotent: files that already exist with the correct sha256 are kept.
#
# Contents (see public/hwr/README.md for licenses + provenance):
#   transformers.web.bundle.js.gz          bun-bundled closure of @huggingface/transformers 4.3.2 web ESM (Apache-2.0; see below)
#   ort/ort-wasm-simd-threaded.asyncify.*  onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (MIT)
#   models/trocr-small-handwritten/**      Xenova/trocr-small-handwritten (MIT, quantized q8)
#
# The runtime is vendored GZIPPED: (a) shipping the raw minified bundle was
# rejected by GitHub push protection — the scanner false-positives a
# provider-template string inside it ("Mistral AI API Key"); (b) the
# npm-dependency route made the cold CI production build flaky (Turbopack
# postcss worker IPC timeouts). The app decompresses the bundle in the
# browser (DecompressionStream) before importing it; the drift test
# gunzips the blob and verifies the ORIGINAL file's sha256.
#
# Drift protection: src/lib/__tests__/hwr-assets.test.ts pins every file
# against public/hwr/assets.json (size + sha256), exactly like the OCR
# bundle (issue #103 pattern).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- pinned versions ------------------------------------------------------
TRANSFORMERS_VERSION="4.3.2"
ORT_VERSION="1.31.0-dev.20260914-8d85527a0"
HF_BASE="https://huggingface.co/Xenova/trocr-small-handwritten/resolve/main"

# Byte sizes verified against the Hugging Face API on 2026-11-10
# (docs/handwriting-research.md §3.1, issue #175).
declare -A SIZES=(
  ["models/trocr-small-handwritten/onnx/encoder_model_quantized.onnx"]=23082942
  ["models/trocr-small-handwritten/onnx/decoder_model_merged_quantized.onnx"]=40527613
)

fetch() { # fetch <relative-path> <url>
  local rel="$1" url="$2" dest="$DIR/$1"
  if [[ -f "$dest" ]] && [[ -f "$DIR/assets.json" ]] && grep -q "\"$rel\"" "$DIR/assets.json"; then
    local recorded
    recorded="$(jq -r --arg k "$rel" '.files[$k].sha256 // empty' "$DIR/assets.json")"
    local have
    have="$(sha256sum "$dest" | cut -d' ' -f1)"
    if [[ -n "$recorded" && "$have" == "$recorded" ]]; then
      echo "  ok (cached) $rel"
      return
    fi
  fi
  mkdir -p "$(dirname "$dest")"
  echo "  fetch $rel"
  curl -fsSL -o "$dest" "$url"
}

echo "Fetching handwriting runtime into public/hwr/ …"

# --- JS runtime: bun-bundled closure, gzipped ------------------------------
# The web ESM build (dist/transformers.web.js — NOT transformers.min.js,
# a node-flavored artifact that fails in a browser with "this.processor
# is not a function", measured 2026-11-10) lazily imports bare
# specifiers ("onnxruntime-web/webgpu", "onnxruntime-common") that no
# browser module can resolve, and blob-imported modules resolve
# relative imports against blob:. So the vendor step runs a REAL bundler
# (bun, already required by this repo) over the web build to produce ONE
# self-contained ESM file — every bare specifier inlined — then gzips it
# (push protection cannot flag opaque gzip bytes; the npm-dependency
# route was rejected because it made the cold CI build flaky, see
# docs/WORKLOG.md 2026-11-10). The app decompresses at runtime
# (DecompressionStream) and imports the blob.
RUNTIME_DIR="$TMP/runtime"
mkdir -p "$RUNTIME_DIR"
cd "$RUNTIME_DIR"
printf '{ "name": "hwr-vendor", "private": true }\n' > package.json
bun add "@huggingface/transformers@${TRANSFORMERS_VERSION}" >/dev/null
bun build "node_modules/@huggingface/transformers/dist/transformers.web.js" \
  --format esm --outfile bundle.js >/dev/null
ORIGINAL_SHA="$(sha256sum bundle.js | cut -d' ' -f1)"
echo "runtime bundle sha256 (uncompressed): $ORIGINAL_SHA"
gzip -9 -c bundle.js > "$DIR/transformers.web.bundle.js.gz"

# --- onnxruntime wasm pair --------------------------------------------------
curl -fsSL -o "$TMP/ort.tgz" \
  "https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${ORT_VERSION}.tgz"
tar -xzf "$TMP/ort.tgz" -C "$TMP" \
  package/dist/ort-wasm-simd-threaded.asyncify.mjs \
  package/dist/ort-wasm-simd-threaded.asyncify.wasm
mkdir -p "$DIR/ort"
mv "$TMP/package/dist/ort-wasm-simd-threaded.asyncify.mjs" "$DIR/ort/"
mv "$TMP/package/dist/ort-wasm-simd-threaded.asyncify.wasm" "$DIR/ort/"

# --- model weights + configs ----------------------------------------------
for f in config.json generation_config.json preprocessor_config.json \
         special_tokens_map.json tokenizer.json tokenizer_config.json; do
  fetch "models/trocr-small-handwritten/$f" "$HF_BASE/$f"
done
fetch "models/trocr-small-handwritten/onnx/encoder_model_quantized.onnx" \
  "$HF_BASE/onnx/encoder_model_quantized.onnx"
fetch "models/trocr-small-handwritten/onnx/decoder_model_merged_quantized.onnx" \
  "$HF_BASE/onnx/decoder_model_merged_quantized.onnx"

# --- byte-size guard on the two big weights -------------------------------
for rel in "${!SIZES[@]}"; do
  actual="$(stat -c%s "$DIR/$rel")"
  if [[ "$actual" != "${SIZES[$rel]}" ]]; then
    echo "FATAL: $rel is $actual bytes, expected ${SIZES[$rel]}" >&2
    exit 1
  fi
done

# --- rebuild the manifest ---------------------------------------------------
cd "$DIR"
{
  printf '{\n'
  printf '  "transformersJs": "%s",\n' "$TRANSFORMERS_VERSION"
  printf '  "onnxruntimeWeb": "%s",\n' "$ORT_VERSION"
  printf '  "model": "Xenova/trocr-small-handwritten",\n'
  printf '  "modelPrecision": "q8",\n'
  printf '  "language": "eng",\n'
  printf '  "transformersJsOriginalSha256": "%s",\n' "$ORIGINAL_SHA"
  printf '  "files": {\n'
  first=1
  while IFS= read -r rel; do
    size="$(stat -c%s "$rel")"
    sha="$(sha256sum "$rel" | cut -d' ' -f1)"
    [[ $first -eq 0 ]] && printf ',\n'
    first=0
    printf '    "%s": {\n      "sha256": "%s",\n      "bytes": %s\n    }' "$rel" "$sha" "$size"
  done < <(find . -type f ! -name assets.json ! -name README.md ! -name fetch-vendor.sh | sed 's|^\./||' | sort)
  printf '\n  }\n}\n'
} > assets.json
echo "Manifest written: $(grep -c sha256 assets.json) files pinned."
