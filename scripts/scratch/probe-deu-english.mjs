import { createWorker } from "tesseract.js";
const worker = await createWorker("deu", 1, {
  langPath: "/tmp/ocr-verify/lang", gzip: true, cacheMethod: "none",
});
try {
  const { data } = await worker.recognize("/tmp/ocr-verify/english-tricky.png");
  console.log("[deu] english-tricky =>");
  console.log(data.text.split("\n").map(l => "   |" + l).join("\n"));
} finally { await worker.terminate(); }
