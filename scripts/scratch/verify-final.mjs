import { createWorker } from "tesseract.js";
const worker = await createWorker("deu", 1, {
  langPath: "/tmp/ocr-verify/lang", gzip: true, cacheMethod: "none",
});
try {
  const { data } = await worker.recognize("/tmp/ocr-verify/ocr-text-de-final.png");
  const text = data.text.replace(/\s+/g, " ").trim();
  console.log("[deu] final fixture =>", JSON.stringify(text));
  for (const w of ["GÄSTEBUCH", "MÜNCHEN", "STRAßE"]) {
    console.log(`  contains ${w}:`, text.includes(w));
  }
} finally { await worker.terminate(); }
