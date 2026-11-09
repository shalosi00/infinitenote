import { createWorker } from "tesseract.js";
const WORDS = ["MÜNCHEN","STRAßE","GRÜßE","SCHÖN","ÜBUNG","ÄPFEL","ÖFFNEN","ZÜRICH","GÄSTEBUCH"];
const worker = await createWorker("deu", 1, {
  langPath: "/tmp/ocr-verify/lang", gzip: true, cacheMethod: "none",
});
try {
  for (const w of WORDS) {
    const { data } = await worker.recognize(`/tmp/ocr-verify/words/${w}.png`);
    const out = data.text.replace(/\s+/g, " ").trim();
    console.log(`${w.padEnd(10)} => ${JSON.stringify(out)}  ${out === w ? "OK" : "MISS"}`);
  }
  // and German model on English fixture (regression risk for OCR-E02)
  const en = await worker.recognize("/home/z/my-project/e2e/fixtures/ocr-text.png");
  console.log("english fixture =>", JSON.stringify(en.data.text.replace(/\s+/g," ").trim()));
} finally {
  await worker.terminate();
}
