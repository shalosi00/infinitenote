# Handwriting Recognition — Research Write-up

> Status: **research shipped, no UI implemented** (issue #133, v1.12.0
> milestone). This document is the decision basis for any handwriting
> recognition (HTR) work; it makes a recommendation and, because that
> recommendation is "pursue", defines a phased plan. All file sizes and
> licenses below were verified against the primary sources on **2026-11-10**
> (Hugging Face repo API, vendor pages, specs); claims that could not be
> verified at writing time are deliberately qualitative and marked as such.

## 1. Where we start from

InfiniteNote stores freehand ink the same way the Excalidraw engine does:
native **freedraw elements** — vector stroke traces (`points[]` with x/y and
pressure) serialized inside the page scene. Nothing is rasterized unless it
is rendered for display or export. That means InfiniteNote has *online* ink
(stroke order, timing, pressure), which is exactly the input class that
dedicated handwriting engines like MyScript or ML Kit Digital Ink consume —
and also exactly the input class that most open, browser-runnable HTR
models do **not** consume (they are image-based, see §3.1).

What InfiniteNote already has that matters here:

- **An on-device OCR precedent.** v1.11 ships tesseract.js image/PDF-printout
  OCR that runs fully on-device (English + German), stores the recognized
  text and feeds it into full-text search. The pipeline
  *render → recognize → store → index* exists, is tested
  (`docs/test-plans/ocr.md`), and is the template Phase A would reuse.
- **A search surface that ignores ink.** `Ctrl+K` full-text search covers
  typed text, imported text/Markdown, image OCR text and PDF printout OCR
  text — but handwritten strokes are invisible to it. Handwriting is the
  last major content class a user cannot search.

The ask, in OneNote terms: OneNote keeps ink as first-class objects and
offers optional handwriting recognition on top. InfiniteNote should be able
to search handwriting without betraying the local-first stance.

## 2. Why the obvious shortcuts do not work

### 2.1 tesseract.js (already bundled) is not a handwriting engine

The Tesseract FAQ is explicit: *"Can I use Tesseract for handwriting
recognition? You can, but it won't work very well, as Tesseract is designed
for printed text."* (tesseract-ocr.github.io FAQ, retrieved 2026-11-10).
Tesseract is a printed-text OCR engine with a layout analyzer tuned to
document imagery; cursive, freeform canvas ink is outside its design
envelope. Reusing the bundled tesseract models for handwriting would burn
engineering time on an engine whose vendor says it is the wrong tool.

### 2.2 Cloud ink APIs violate the local-first stance by construction

Microsoft's cloud is the reference point (OneNote does its handwriting OCR
in the cloud: the OneNote/Microsoft Graph API extracts recognized text from
ink server-side — see learn.microsoft.com, "Does OneNote API in Microsoft
Graph provide OCR function"). Cloud HTR quality is genuinely excellent —
the Aimultiple 2026 benchmark of 14 engines on 100 naturally-written cursive
samples scored Gemini 3 Pro Preview at 100% and DeepSeek OCR at 79%
(cosine-similarity scoring, 10 writers) — but every engine in that benchmark
is a cloud service or a multi-billion-parameter LLM. A cloud path would mean:

- ink leaves the device (privacy stance broken — the current OCR feature
  advertises "runs fully on-device");
- an account and network access are required, which contradicts the
  offline PWA and the Android airplane-mode first-run requirement;
- per-call cost and vendor lock-in.

**Rejected as a dependency.** At most, a far-future opt-in cloud provider
could sit *beside* an on-device path; it can never be the only path.

### 2.3 The WICG Handwriting Recognition API is not usable for our target

The Web Platform Incubator Community Group publishes a Handwriting
Recognition API draft (WICG Draft Community Group Report, July 9 2025,
editor: Jiewei Qian, Google). It is well-designed for our exact data shape
(`addStroke()`/`addPoint()` — online ink), but its recognition contract is
"expose existing operating system capabilities": the spec targets Windows
Ink (UWP), Apple PencilKit and ChromeOS ML Service. Two blockers for
InfiniteNote:

1. **There is no Linux desktop handwriting engine** for the API to expose —
   our primary PWA target (Linux desktop) would always fall through to
   `queryHandwritingRecognizer() === null`.
2. It is a **Draft CG Report, not a W3C standard**, and the draft itself
   does not establish which browsers implement it.

**Verdict: not a primary path.** If it ever ships broadly, it is a graceful
enhancement slot (recognizer query → fall back to Phase A), not a
foundation.

### 2.4 MyScript iink SDK: best-in-class, but proprietary and per-device

MyScript's Interactive Ink SDK is the commercial gold standard for online
handwriting recognition. Its licensing posture is incompatible with this
project:

- the engine requires a **certificate per device** (MyScript "On-device API
  license management");
- pricing is **per-device license packs, starting at 100 licenses at €12
  each**; the free "Build" tier covers only 25 development/testing devices;
- the engine is closed-source and proprietary.

A closed engine cannot ship in an MIT-licensed open-source project, cannot
pass F-Droid's free-dependency policy, and would put a hard per-user cost
on a free app. **Rejected.**

## 3. On-device options that fit

### 3.1 TrOCR via Transformers.js / ONNX Runtime Web (recommended building block)

Microsoft's TrOCR (transformer-based OCR) ships pretrained
**handwriting-recognized** variants: `microsoft/trocr-base-handwritten`
(334M-parameter vision-encoder-decoder, **MIT** license per its Hugging Face
model card) and a smaller `trocr-small-handwritten`. The Transformers.js
ecosystem (Apache-2.0, ~16.4k stars) runs these as ONNX in the browser via
ONNX Runtime Web — WebGPU where available, WASM fallback.

Verified model sizes (Hugging Face repo API, 2026-11-10):

| Variant | File | Size |
|---|---|---|
| base | `encoder_model_quantized.onnx` | 88,082,928 B (≈88 MB) |
| base | `decoder_model_merged_quantized.onnx` | 249,597,124 B (≈250 MB) |
| base | **quantized total** | **≈337 MB** |
| base | fp32 total (`encoder_model.onnx` + `decoder_model_merged.onnx`) | ≈1.33 GB |
| base | fp16 total | ≈668 MB |
| small | `encoder_model_quantized.onnx` | 23,082,942 B (≈23 MB) |
| small | `decoder_model_merged_quantized.onnx` | 40,527,613 B (≈41 MB) |
| small | **quantized total** | **≈64 MB** |

Takeaways:

- The **base** variant is not shippable: ≈337 MB quantized dwarfs anything a
  note app can ask a user to download lazily (for comparison, the
  tesseract.js fast OCR models already shipped are a multi-MB class).
- The **small** variant at **≈64 MB** quantized is in the same order of
  magnitude as a large asset download; acceptable *only* as an explicit,
  per-user opt-in lazy download (same pattern as OCR models: fetched on
  first use, cached by the browser).
- LocalMode's Transformers.js model directory independently lists the TrOCR
  family at "≈120 MB" class with a ~62M-parameter small variant and rates
  the handwritten variant "Good" for handwritten notes/forms — consistent
  with the raw file math above.
- Latency: TrOCR's decoder is autoregressive (per-line generation). LocalMode
  publishes no latency figures; real per-line latency on WASM/WebGPU —
  especially on mid-range Android — is **unverified** and must be measured
  with a prototype before any UX commitment (open question, §7).
- Language: the published handwritten variants are **English** (trained on
  IAM-class English handwriting data). There is no on-device open CJK
  handwriting path in this family — CJK is deferred, see §6.

### 3.2 Open online (stroke-based) engines in the browser — none viable today

Stroke-based (online) recognition would fit InfiniteNote's freedraw data
natively and would need no rasterization. However, there is **no maintained,
open-source, browser-packaged online HTR engine** today: research systems
exist (e.g. sequence-to-sequence and convolutional models trained on
IAM/CMUDB-class English datasets), but none ship as a maintained WASM/ONNX
runtime artifact with a stable API. Adopting one would mean porting and
hosting a research model in-house — high effort, unproven accuracy, no
community support. **Not viable at current project capacity; revisit if one
appears.**

### 3.3 The Android wrapper path: ML Kit Digital Ink (TWA-side experiment only)

Google's ML Kit Digital Ink Recognition is on-device, works offline, and
covers **300+ languages, emojis and basic shapes** (developers.google.com,
retrieved 2026-11-10) on Android/iOS — including the CJK families our
English-only gap leaves out. It consumes exactly the online-ink data shape
InfiniteNote already stores. It is, however, a **native platform library**:
it cannot run inside the PWA, only inside the Android TWA wrapper
(`android-twa/`), and it is governed by Google's ML Kit terms rather than an
open-source license.

If Phase A proves the product value, a Phase C experiment could bridge the
TWA's native layer to recognition results written back into the page store
as metadata — but this creates platform-divergent behavior (Android-only
recognition) and a data contract to maintain. **Kept as an option, not a
commitment.**

## 4. Data flow (Phase A): strokes → searchable metadata

Design for the recommended first phase. Nothing here sends ink anywhere;
everything runs in the browser after an explicit user action.

```
freedraw stroke group(s)          user action: "Recognize handwriting"
   (Excalidraw elements)                  │
        │                                 ▼
        ▼                     group nearby strokes into lines
rasterize group(s) to         (geometry + projection on the rendered
canvas bitmap(s)              bitmap; freedraw points give the boxes)
        │                                 │
        ▼                                 ▼
line crops (PNG)  ───────────▶  trocr-small-handwritten (ONNX, lazy,
                                ≈64 MB first use, cached; WASM/WebGPU)
                                          │
                                          ▼
                              recognized text per line/page, marked
                              machine-generated, stored as page metadata
                                          │
                                          ▼
                              existing full-text search (Ctrl+K) indexes
                              it — handwriting is now findable
```

Key decisions embedded in this flow:

1. **Explicit, per-page action — never background processing.** A 64 MB
   download and a multi-second recognition must be opt-in, mirroring the
   image-OCR UX ("Recognize text in images" already behaves this way).
2. **Metadata-only, not canvas mutation.** Phase A stores recognized strings
   as machine-generated page metadata (same stance as OCR text today). The
   user's ink is untouched; deleting recognition is trivial; re-running
   recognition is idempotent.
3. **Rasterize, don't trace.** The recommended model is image-based (§3.1);
   freedraw vector boxes are used to segment and crop lines, then each line
   is recognized as an image crop. Our stroke data (order, pressure) is not
   wasted — it defines the crops — but the model does not consume it.
4. **Model delivery.** Lazy-loaded on first use and cached. The in-repo
   precedent is the OCR feature: tesseract models ship as repo assets in
   `public/ocr/` — no CDN, offline after first use, sha256-pinned. A ≈64 MB
   HTR model bundled the same way is the default Phase A choice (repo
   grows accordingly); a CDN fallback is an implementation decision to
   weigh there, not a research blocker.

Phase B (**ink-to-text**, later): a user-invoked "Convert to text" inserts a
real text element above the ink and keeps the original strokes (OneNote
behavior). It reuses Phase A's recognition entirely and only adds canvas
mutation + UX. It is deliberately **gated on Phase A accuracy proving out in
dogfooding** — converting to text the user must then trust is a higher bar
than making handwriting findable.

## 5. Cost and size budget

| Item | Budget | Notes |
|---|---|---|
| Model download (first use) | ≈64 MB (small, quantized: 23 MB encoder + 41 MB decoder) | Verified HF API sizes; lazy + cached; explicit opt-in |
| Variant NOT shipped | base ≈337 MB quantized / 1.33 GB fp32 | Verified; exceeds any sane note-app budget |
| Runtime memory | qualitative risk: hundreds of MB under WASM for a 62M-param transformer | Must be measured on low-end Android before Phase B |
| Engineering, Phase A | ~1 cycle | Reuses the proven OCR pipeline (render → recognize → store → index) + line segmentation as the new part |
| Engineering, Phase B | ~1 cycle | Canvas text insertion + UX only; recognition already done |
| Monetary cost | €0 | MIT model + Apache-2.0 runtime; no per-device certificates (MyScript: €12/device, 100-pack minimum) |

## 6. Recommendation — pursue, phased; CJK deferred

**Pursue**, in this order:

- **Phase A (candidate for the next feature milestone): handwriting search.**
  English-only, explicit per-page action, `trocr-small-handwritten` ONNX
  ≈64 MB lazy download, recognized text stored as metadata and indexed by
  the existing search. This unlocks the actual user pain (handwriting is
  unsearchable) at the smallest scope that is honest about the model's
  limits.
- **Phase B: ink-to-text conversion**, only after Phase A accuracy proves
  out on real notes in dogfooding.
- **CJK handwriting: deferred.** No open on-device CJK HTR model exists in
  the browser-runnable class surveyed. The honest interim answer is the
  same one the OCR feature used before German support shipped: be explicit
  in the UI that handwriting recognition is English-only, and revisit ML
  Kit (TWA bridge, §3.3) or future open models.

**Never:**

- cloud recognition as a dependency (§2.2);
- proprietary engines (MyScript, §2.4) — incompatible with MIT + F-Droid;
- OS-API-only paths (WICG, §2.3) as the foundation — no Linux engine.

This mirrors the OCR rollout pattern (research → metadata-only → search
integration), which is the project's proven template for on-device ML.

## 7. Open questions

1. **Per-line latency of `trocr-small-handwritten`** under ONNX Runtime Web
   (WASM vs WebGPU) on a mid-range Android device — unverified; prototype
   and measure before committing to Phase A UX (progress-per-line design
   already assumed).
2. **Line segmentation robustness** on InfiniteNote pages: canvas ink is
   freeform (mixed orientations, drawings mixed with text) — geometry +
   projection segmentation needs a real-world accuracy check.
3. **Model hosting**: a ≈64 MB asset bundled repo-side like the OCR models
   (`public/ocr/`, sha256-pinned, offline after first use) makes the repo
   ~64 MB heavier; confirm whether that is acceptable or whether a
   lazy/CDN fallback is wanted, and keep offline-first behavior intact.
4. **CJK path**: exact ML Kit language catalog for zh-Hans/zh-Hant/ja/ko and
   whether a TWA-side bridge can write recognized text back into the page
   store without forking the PWA data model.
5. **Watchlist**: WICG Handwriting Recognition API maturity (§2.3); WebGPU
   rollout breadth in ONNX Runtime Web; any new open online-HTR engine
   shipping a browser artifact.

## Sources (all retrieved 2026-11-10)

- Tesseract FAQ — "Can I use Tesseract for handwriting recognition?":
  https://tesseract-ocr.github.io/tessdoc/FAQ.html
- `Xenova/trocr-base-handwritten` ONNX weights (file sizes via HF API):
  https://huggingface.co/Xenova/trocr-base-handwritten
- `Xenova/trocr-small-handwritten` ONNX weights (file sizes via HF API):
  https://huggingface.co/Xenova/trocr-small-handwritten
- `microsoft/trocr-base-handwritten` (MIT model card):
  https://huggingface.co/microsoft/trocr-base-handwritten
- Transformers.js (Apache-2.0; ONNX Runtime Web, WebGPU/WASM):
  https://github.com/huggingface/transformers.js
- LocalMode, "TrOCR OCR Models in the Browser" (sizes/quality table):
  https://localmode.dev/blog/models/trocr-ocr
- WICG Handwriting Recognition API, Draft CG Report 2025-07-09:
  https://wicg.github.io/handwriting-recognition
- Aimultiple, "Handwriting Recognition Benchmark with 14 LLMs & OCRs":
  https://aimultiple.com/handwriting-recognition
- MyScript on-device license management (per-device certificate):
  https://developer.myscript.com/support/on-device/on-device-license-management
- MyScript pricing (per-device packs, 100 × €12; free 25 dev devices):
  https://developer.myscript.com/pricing
- ML Kit Digital Ink Recognition (on-device, offline, 300+ languages):
  https://developers.google.com/ml-kit/vision/digital-ink/recognition
- Microsoft Q&A, OneNote Graph API OCR (cloud-side recognition):
  https://learn.microsoft.com/en-us/answers/questions/1854951/does-onenote-api-in-microsoft-graph-provide-ocr-fu
