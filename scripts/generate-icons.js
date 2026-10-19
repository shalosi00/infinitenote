/**
 * Generate PWA icons from the master SVG using sharp.
 * - icon-192.png / icon-512.png (any purpose)
 * - maskable-512.png (icon shrunk to the 80% safe zone on solid bg)
 * - apple-touch-icon.png (180x180)
 */
const sharp = require("sharp");
const path = require("path");

const SRC = path.join(__dirname, "..", "public", "icons", "icon.svg");
const OUT = path.join(__dirname, "..", "public", "icons");

async function main() {
  const svg = require("fs").readFileSync(SRC);

  await sharp(svg, { density: 300 }).resize(192, 192).png().toFile(path.join(OUT, "icon-192.png"));
  await sharp(svg, { density: 300 }).resize(512, 512).png().toFile(path.join(OUT, "icon-512.png"));
  await sharp(svg, { density: 300 }).resize(180, 180).png().toFile(path.join(OUT, "apple-touch-icon.png"));

  // maskable: center 80% within full-bleed violet background
  const icon410 = await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#6d28d9" },
  })
    .composite([{ input: icon410, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, "maskable-512.png"));

  console.log("icons written to", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
