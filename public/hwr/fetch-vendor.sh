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
#   ort/ort-wasm-simd-threaded.asyncify.*  onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (MIT)
#   models/trocr-small-handwritten/**      Xenova/trocr-small-handwritten (MIT, quantized q8)
#
# The runtime itself (@huggingface/transformers 4.3.2) ships as the pinned
# npm dependency — vendoring its minified bundle was rejected 2026-11-10:
# GitHub push protection false-positives on a provider-template string
# inside it ("Mistral AI API Key"). Only the heavy, pinning-worthy bytes
# (model weights + wasm runtime) are vendored here.
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

# --- onnxruntime web runtime (tarball, not node_modules) ------------------
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
