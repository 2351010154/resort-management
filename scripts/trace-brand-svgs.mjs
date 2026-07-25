// Trace the Mariva monogram + wordmark 04 mockup crops into clean SVGs with a
// single currentColor path, so CSS can theme them ivory/ink.
// Crops are prepared in the session scratchpad by ffmpeg (see phase-01 report).
//
// Usage: node scripts/trace-brand-svgs.mjs <monogram-crop.png> <wordmark-crop.png>

import potrace from "potrace";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const trace = promisify(potrace.trace);

const BRAND = path.resolve(import.meta.dirname, "..", "public", "brand");
const [monogramSrc, wordmarkSrc] = process.argv.slice(2);
if (!monogramSrc || !wordmarkSrc) {
  console.error("usage: trace-brand-svgs.mjs <monogram.png> <wordmark.png>");
  process.exit(1);
}

async function toCleanSvg(srcPng, destName, label) {
  const raw = await trace(srcPng, {
    threshold: 160, turdSize: 8, optTolerance: 0.35, alphaMax: 1,
  });
  const viewBox = raw.match(/viewBox="([^"]+)"/)[1];
  const paths = [...raw.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor" aria-label="${label}" role="img">
  <path fill-rule="evenodd" d="${paths.join(" ")}"/>
</svg>
`;
  const dest = path.join(BRAND, destName);
  await writeFile(dest, svg);
  console.log(`${destName}: viewBox ${viewBox}, ${paths.length} subpath group(s), ${svg.length} bytes`);
}

await mkdir(BRAND, { recursive: true });
await toCleanSvg(monogramSrc, "mariva-monogram.svg", "Mariva monogram");
await toCleanSvg(wordmarkSrc, "mariva-wordmark.svg", "Mariva");
