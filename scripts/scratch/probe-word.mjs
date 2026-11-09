/** Which German words survive eng+deu recognition reliably? */
import { createWorker } from "tesseract.js";
import { Image, ImageDraw, ImageFont } from "python" with { type: "python" };
