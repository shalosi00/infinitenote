/** Compare single-language vs combined recognition quality. */
import { createWorker } from "tesseract.js";

async function run(langs, image) {
  const worker = await createWorker(langs, 1, {
    langPath: "/tmp/ocr-verify/lang",
    gzip: true,
    cacheMethod: "none",
  });
  try {
    const { data } = await worker.recognize(image);
    console.log(`[${langs}] ${image.split("/").pop()} => ${JSON.stringify(data.text)}`);
  } finally {
    await worker.terminate();
  }
}

await run("deu", "/tmp/ocr-verify/ocr-text-de.png");
await run("eng+deu", "/home/z/my-project/e2e/fixtures/ocr-text.png");
await run("deu", "/home/z/my-project/e2e/fixtures/ocr-text.png");
