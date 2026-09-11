// Frames of Act 1's opening: the two windows separating out of the ivory, the
// morph closing them into one photograph, the hold, and the push to full frame.
//
// The beats are read off the act's own scroll extent rather than typed as page
// offsets, so the capture keeps pointing at the same moments when ACT_HEIGHT
// changes. Progress is the fraction of the pinned run, matching the numbers the
// component reasons in: 0 rest, 0.46 joined, 0.54 push starts, 1 full frame.
//
// Usage: node apps/web/scripts/capture-arrival-opening.mjs [baseUrl]
// Output: plans/reports/screenshots/arrival-opening/<vp>-NN-<beat>.png

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = screenshotDir("arrival-opening");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

/** The moments worth looking at, as progress through the pinned act. */
const BEATS = [
  { at: 0, name: "rest" },
  { at: 0.24, name: "morph" },
  { at: 0.46, name: "joined" },
  { at: 0.54, name: "hold" },
  { at: 0.78, name: "push" },
  { at: 1, name: "full" },
];

/**
 * Lenis catches up to a native jump, then the frame has to raster. Long,
 * because a scrubbed photograph that has not finished decoding at its new scale
 * photographs as a black field and reads as a bug that is not there.
 */
const SETTLE = 3200;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
  });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  // The entrance runs on mount: a curtain, then the windows unsealing under a
  // stagger. It owns the first ~3.5s, and a beat shot inside it is a window
  // caught half open rather than the rest geometry this is meant to record.
  await page.waitForTimeout(4200);

  const act = await page.evaluate(() => {
    const el = document.querySelector('[data-act="1"]');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { top: box.top + window.scrollY, height: box.height };
  });
  if (!act) throw new Error("no [data-act=1] on the page");

  // The act is pinned from its top to its bottom, so the scroll it is scrubbed
  // over is its height less the viewport the pin holds.
  const run = act.height - vp.height;

  for (const [i, beat] of BEATS.entries()) {
    const index = `${i + 1}`.padStart(2, "0");
    await page.evaluate(
      (to) => window.scrollTo(0, to),
      act.top + run * beat.at,
    );
    await page.waitForTimeout(SETTLE);
    await page.screenshot({
      path: path.join(OUT, `${vp.name}-${index}-${beat.name}.png`),
    });
  }

  console.log(`${vp.name}: ${BEATS.length} frames`);
  await page.close();
}

await browser.close();
console.log(`wrote ${OUT}`);
