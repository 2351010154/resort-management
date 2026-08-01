// Frames of Act 2's three chapters, which stack: each panel pins to the top of
// the viewport, holds for a dwell, and is then covered by the next one.
//
// Per chapter on desktop: the panel two-thirds of the way up — where it leads
// its own sticky position the most, which is what the landing is a settle out
// of — the panel just landed, and the next one halfway up over it (the last
// chapter's closing shot is the Act 2 -> Act 3 seam instead). Mobile does not
// stack, so it gets the type and the photographs of each chapter as they
// scroll past.
//
// Usage: node apps/web/scripts/capture-welcome-chapters.mjs [baseUrl]
// Output: plans/reports/screenshots/welcome-chapters/<vp>-NN-<beat>.png

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = screenshotDir("welcome-chapters");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

/** Share of a panel's rise still to go at the frame that catches it mid-flight:
 *  the rise runs the panel's mark from the bottom of the viewport to the top,
 *  so this is also how far below the top of the page the scroll sits. */
const RISING = 0.4;

/** Lenis catches up to a native jump, then the reveal plays out. */
const SETTLE = 2600;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
  });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // The panels are sticky and lie about where they are; the zero-height marks
  // sit at each panel's static top, which is what the act's own triggers use.
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('[data-act="2"] [data-chapter-mark]')].map(
      (el) => el.getBoundingClientRect().top + window.scrollY,
    ),
  );
  if (marks.length < 2) throw new Error("no chapter marks under [data-act=2]");

  // Measured rather than assumed: the dwell is one figure for all three
  // chapters, and a capture that hard-codes it goes stale the moment it is not.
  const dwells = await page.evaluate(() =>
    [...document.querySelectorAll('[data-act="2"] [data-chapter-dwell]')].map(
      (el) => el.getBoundingClientRect().height,
    ),
  );
  const stacks = vp.name === "desktop";

  const shot = (index, beat) =>
    page.screenshot({
      path: path.join(OUT, `${vp.name}-${index}-${beat}.png`),
    });
  const scrollTo = async (y, waitMs) => {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(waitMs);
  };

  let frames = 0;
  for (const [i, top] of marks.entries()) {
    const index = `${i + 1}`.padStart(2, "0");

    if (!stacks) {
      await scrollTo(top - vp.height * 0.1, SETTLE);
      await shot(index, "type");
      await scrollTo(top + vp.height * 0.7, SETTLE);
      await shot(index, "stack");
      frames += 2;
      continue;
    }

    await scrollTo(top - vp.height * RISING, SETTLE);
    await shot(index, "rising");

    // A hair above the landing point: the panel reads as pinned, and it got
    // there with no speed left rather than by stopping.
    await scrollTo(top - 24, SETTLE);
    await shot(index, "landed");

    await scrollTo(top + dwells[i] + vp.height * 0.5, SETTLE);
    await shot(index, "cover");
    frames += 3;
  }

  console.log(
    `${vp.name}: ${frames} frames${
      stacks ? `, dwells ${dwells.map((d) => Math.round(d)).join("/")}px` : ""
    }`,
  );
  await page.close();
}

await browser.close();
