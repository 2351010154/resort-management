// Pixel comparison between two capture runs.
//
// Decoding happens in a headless chromium rather than through an image
// library, because the repo already depends on one browser and does not need
// to start depending on a PNG codec as well. Both files are drawn to a canvas
// and their ImageData compared channel by channel.
//
// Captures are not bit-exact. SwiftShader's rasteriser and the video decoder
// land a handful of pixels a channel step or two apart between runs, so a
// tolerance is needed or every comparison fails on its own noise.
//
// The default is where the floor was measured rather than guessed. Two
// consecutive runs of an unchanged tree differ by one channel step on most of
// the frames that move at all, by two on one, and by four on exactly one —
// mobile act-4-p075, which alternates between two states over the same 4188
// pixels every time. Four covers all of it.
//
// That is still a tight net. The differences a version bump actually produces
// are not subtle: a nav photographed in the wrong state measured 216, and an
// act whose canvas had not mounted measured 108.
//
// A stray pixel or two still lands above any channel tolerance, so the gate is
// a budget rather than a threshold: a frame fails when enough of it moved to
// mean something. Raising the channel tolerance until single pixels fit under
// it would blunt the whole comparison to hide a rounding artefact.
//
// Usage: node apps/web/scripts/compare-visual-baseline.mjs <baseDir> <headDir> [tolerance]
//   tolerance: largest per-channel difference treated as noise, default 4
// Exit code is 1 when any pair differs beyond tolerance, so it can gate a step.

import { chromium } from "playwright";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const [, , BASE_DIR, HEAD_DIR, TOLERANCE_ARG] = process.argv;
if (!BASE_DIR || !HEAD_DIR) {
  console.error("usage: compare-visual-baseline.mjs <baseDir> <headDir> [tolerance]");
  process.exit(2);
}
const TOLERANCE = Number(TOLERANCE_ARG ?? 4);

/** How many over-tolerance pixels a frame is allowed before it counts as
 *  changed: two hundredths of a percent, and never fewer than thirty-two, so
 *  the small nav crops are not held to a budget of three. */
const budgetFor = (total) => Math.max(32, Math.round(total * 0.0002));

/** Relative paths of every png under dir. */
async function pngs(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".png")) {
      found.push(path.relative(dir, path.join(entry.parentPath, entry.name)));
    }
  }
  return found.sort();
}

const base = await pngs(BASE_DIR);
const head = await pngs(HEAD_DIR);

const onlyBase = base.filter((f) => !head.includes(f));
const onlyHead = head.filter((f) => !base.includes(f));
for (const f of onlyBase) console.log(`MISSING  ${f}`);
for (const f of onlyHead) console.log(`ADDED    ${f}`);

const browser = await chromium.launch();
const page = await browser.newPage();

const dataUrl = async (file) =>
  `data:image/png;base64,${(await readFile(file)).toString("base64")}`;

let differing = 0;
let noisy = 0;
let noisiest = 0;
let noisiestShare = 0;
const shared = base.filter((f) => head.includes(f));

for (const file of shared) {
  const [a, b] = await Promise.all([
    dataUrl(path.join(BASE_DIR, file)),
    dataUrl(path.join(HEAD_DIR, file)),
  ]);

  const result = await page.evaluate(async ([srcA, srcB, tolerance]) => {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    const [imgA, imgB] = await Promise.all([load(srcA), load(srcB)]);
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      return {
        resized: `${imgA.width}x${imgA.height} -> ${imgB.width}x${imgB.height}`,
      };
    }
    const draw = (img) => {
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const dataA = draw(imgA);
    const dataB = draw(imgB);

    let touched = 0;
    let beyond = 0;
    let maxDelta = 0;
    for (let i = 0; i < dataA.length; i += 4) {
      let delta = 0;
      for (let c = 0; c < 4; c++) {
        delta = Math.max(delta, Math.abs(dataA[i + c] - dataB[i + c]));
      }
      if (delta > 0) {
        touched++;
        maxDelta = Math.max(maxDelta, delta);
        if (delta > tolerance) beyond++;
      }
    }
    return { touched, beyond, maxDelta, total: dataA.length / 4 };
  }, [a, b, TOLERANCE]);

  if (result.resized) {
    console.log(`RESIZED  ${file}  ${result.resized}`);
    differing++;
  } else if (result.beyond > budgetFor(result.total)) {
    const share = ((result.beyond / result.total) * 100).toFixed(3);
    console.log(
      `DIFF     ${file}  ${result.beyond}/${result.total} px (${share}%) over tolerance,` +
        ` maxChannelDelta=${result.maxDelta}`,
    );
    differing++;
  } else if (result.touched > 0) {
    noisy++;
    noisiest = Math.max(noisiest, result.maxDelta);
    noisiestShare = Math.max(noisiestShare, result.touched / result.total);
  }
}

await browser.close();

const clean = shared.length - differing - noisy;
console.log(
  `\n${clean}/${shared.length} identical, ${noisy} within tolerance ${TOLERANCE}` +
    (noisy
      ? ` (worst: ${(noisiestShare * 100).toFixed(3)}% of pixels, maxChannelDelta ${noisiest})`
      : "") +
    `, ${differing} changed` +
    (onlyBase.length || onlyHead.length
      ? `, ${onlyBase.length} missing, ${onlyHead.length} added`
      : ""),
);

process.exit(differing || onlyBase.length || onlyHead.length ? 1 : 0);
