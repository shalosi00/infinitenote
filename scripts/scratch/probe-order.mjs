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
  ["/tmp/ocr-verify/words/GRÜßE.png", "GRÜßE-word"],
  ["/tmp/ocr-verify/words/GÄSTEBUCH.png", "GÄSTEBUCH-word"],
  ["/home/z/my-project/e2e/fixtures/ocr-text.png", "english-fixture"],
];
for (const langs of ["deu+eng", "eng+deu"]) {
  await withWorker(langs, async (worker) => {
    const outs = [];
    for (const [img, label] of CASES) {
      const { data } = await worker.recognize(img);
      outs.push(`${label}: ${JSON.stringify(data.text.replace(/\s+/g, " ").trim())}`);
    }
    console.log(`[${langs}]`);
    for (const o of outs) console.log("   ", o);
  });
}
