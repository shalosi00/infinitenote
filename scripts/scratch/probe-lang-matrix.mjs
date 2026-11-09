import { createWorker } from "tesseract.js";

async function withWorker(langs, fn) {
  const worker = await createWorker(langs, 1, {
    langPath: "/tmp/ocr-verify/lang", gzip: true, cacheMethod: "none",
  });
  try { return await fn(worker); } finally { await worker.terminate(); }
}

const CASES = [
  ["/tmp/ocr-verify/english-passage.png", "english-passage"],
  ["/tmp/ocr-verify/mixed.png", "mixed"],
  ["/tmp/ocr-verify/ocr-text-de.png", "german-fixture"],
];
for (const langs of ["eng", "deu"]) {
  await withWorker(langs, async (worker) => {
    for (const [img, label] of CASES) {
      const { data } = await worker.recognize(img);
      console.log(`[${langs}] ${label} => ${JSON.stringify(data.text.replace(/\s+/g, " ").trim())}`);
    }
  });
}
