/**
 * Pre-implementation verification: does the tessdata_fast German model
 * work with tesseract.js 6.0.1 in a combined "eng+deu" worker, and does
 * it recognize umlauts + Eszett on the generated fixture?
 *
 * Uses the SAME .traineddata.gz bytes that will be vendored into
 * public/ocr/lang (eng from the repo + deu gzipped with `gzip -9 -n`).
 */
import { createWorker } from "tesseract.js";
import { readFileSync } from "node:fs";

const engGz = readFileSync("/tmp/ocr-verify/lang/eng.traineddata.gz");
const deuGz = readFileSync("/tmp/ocr-verify/lang/deu.traineddata.gz");
console.log("eng.traineddata.gz bytes:", engGz.length);
console.log("deu.traineddata.gz bytes:", deuGz.length);

const worker = await createWorker("eng+deu", 1, {
  langPath: "/tmp/ocr-verify/lang",
  gzip: true,
  cacheMethod: "none",
});
try {
  const { data } = await worker.recognize("/tmp/ocr-verify/ocr-text-de.png");
  console.log("--- eng+deu output ---");
  console.log(JSON.stringify(data.text));
  const de = await worker.recognize("/tmp/ocr-verify/ocr-text-de.png");
  console.log("contains GÄSTEBUCH:", de.data.text.includes("GÄSTEBUCH"));
  console.log("contains GRÜßE:", de.data.text.includes("GRÜßE"));
  console.log("contains KÖLN:", de.data.text.includes("KÖLN"));
} finally {
  await worker.terminate();
}
