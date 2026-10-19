#!/usr/bin/env node
/**
 * Microsoft Graph OneNote export — the missing "pro" path for large notebooks.
 *
 * Exports every page of every notebook you can see in OneNote into
 * self-contained HTML files (images inlined as data: URLs), which you can
 * then drag straight into InfiniteNote (Import → HTML, or just drop them
 * on the canvas).
 *
 * Requirements:
 *   - Node 18+ (built-in fetch)
 *   - A Graph access token with Notes.Read.
 *     Easiest: Graph Explorer (https://developer.microsoft.com/graph/graph-explorer)
 *     → sign in → "Access token" tab → copy. Tokens last ~1 hour.
 *
 * Usage:
 *   node scripts/graph-export.mjs --token <ACCESS_TOKEN> [--out onenote-export] [--notebooks "Work,Personal"]
 *
 * Output:
 *   <out>/<notebook>/<section>/<page title>.html   (one file per page)
 *
 * Rate limits: Graph throttling is common on bulk reads; this script retries
 * on 429/503 honoring Retry-After, with a small pause between pages.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/* --------------------------------- args --------------------------------- */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : fallback;
};

const TOKEN = flag("token", process.env.MS_GRAPH_TOKEN ?? "");
const OUT = flag("out", "onenote-export");
const ONLY = flag("notebooks", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.error(
    "Missing --token (or MS_GRAPH_TOKEN env).\n" +
      "Get one from https://developer.microsoft.com/graph/graph-explorer (Notes.Read).",
  );
  process.exit(1);
}

/* ------------------------------- graph http ------------------------------ */

const BASE = "https://graph.microsoft.com/v1.0/me/onenote";

async function graph(path, { asText = false, asBytes = false } = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1500 * attempt);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const wait = Number(res.headers.get("Retry-After") ?? 2 * attempt);
      console.warn(`  throttled (${res.status}) — waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Graph ${res.status} for ${url}: ${(await res.text()).slice(0, 300)}`);
    }
    if (asBytes) return new Uint8Array(await res.arrayBuffer());
    return asText ? await res.text() : await res.json();
  }
}

/** Walk a Graph collection, following @odata.nextLink. */
async function* collect(path) {
  let url = `${BASE}${path}`;
  while (url) {
    const page = await graph(url);
    for (const item of page.value ?? []) yield item;
    url = page["@odata.nextLink"] ?? null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ sanitization ----------------------------- */

const safe = (name) =>
  (name || "untitled")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "untitled";

/** Inline an HTML page's referenced image resources as data: URLs. */
async function inlinePageImages(html, pageResources, pageName) {
  let inlined = 0;
  const urls = [...html.matchAll(/data-original-src="([^"]+)"|src="([^"]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((u) => u && !u.startsWith("data:") && !u.startsWith("http"));
  for (const rel of [...new Set(urls)]) {
    const resource = pageResources.find((r) => r.name === rel || rel.endsWith(`/${r.name}`));
    if (!resource) continue;
    try {
      const bytes = Buffer.from(await graph(resource.contentUrl, { asBytes: true }));
      const mime =
        { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[
          (resource.name.split(".").pop() ?? "").toLowerCase()
        ] ?? "application/octet-stream";
      html = html.split(rel).join(`data:${mime};base64,${bytes.toString("base64")}`);
      inlined += 1;
    } catch (err) {
      console.warn(`    ! image "${rel}" on "${pageName}": ${err.message}`);
    }
  }
  return { html, inlined };
}

/* --------------------------------- main ---------------------------------- */

console.log(`OneNote Graph export → ${OUT}/`);
let exported = 0;
for await (const notebook of collect("/notebooks")) {
  if (ONLY.length && !ONLY.some((n) => notebook.displayName.toLowerCase().includes(n.toLowerCase()))) {
    continue;
  }
  console.log(`Notebook: ${notebook.displayName}`);
  for await (const section of collect(`/notebooks/${notebook.id}/sections`)) {
    console.log(`  Section: ${section.displayName}`);
    const sectionDir = join(OUT, safe(notebook.displayName), safe(section.displayName));
    await mkdir(sectionDir, { recursive: true });
    for await (const page of collect(`/sections/${section.id}/pages`)) {
      let html = await graph(`/pages/${page.id}/content`, { asText: true });
      let inlined = 0;
      try {
        const resources = [];
        for await (const r of collect(`/pages/${page.id}/resources`)) resources.push(r);
        ({ html, inlined } = await inlinePageImages(html, resources, page.title));
      } catch (err) {
        console.warn(`    ! resources for "${page.title}": ${err.message}`);
      }
      const file = join(sectionDir, `${safe(page.title)}.html`);
      if (dirname(file) !== sectionDir) continue; // paranoia — path stayed inside OUT
      await writeFile(file, html);
      exported += 1;
      console.log(`    ${page.title}.html${inlined ? ` (${inlined} image${inlined > 1 ? "s" : ""} inlined)` : ""}`);
      await sleep(350); // be a good citizen
    }
  }
}
console.log(`\nDone — ${exported} page(s) under ${OUT}/`);
console.log("Import them in InfiniteNote: open a page → Import → select the .html files (or drop them).");
