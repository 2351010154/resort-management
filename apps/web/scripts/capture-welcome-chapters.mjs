// Frames of Act 2's three chapters, which stack: each panel pins to the top of
// the viewport, holds for a dwell, and is then covered by the next one.
//
// Per chapter on desktop: the panel just landed, one frame mid-seam for every
// tile it turns over, and the next panel halfway up over it (the last chapter's
// closing shot is the Act 2 -> Act 3 seam instead). Mobile does not stack, so
// it gets the type and the photographs of each chapter as they scroll past.
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

/** Seconds into a chapter's flip run when a seam is halfway across: `at + dur/2`
 *  of every flip the chapter is written with (see CHAPTERS in the component).
 *  The run is fired by the panel landing and then plays on its own clock, so
 *  these are waits, not scroll offsets, and the frames they catch are close to
 *  mid-seam rather than exactly on it. One frame each, in the order the seams
 *  run — so the three-tile chapters get three and 02, which has two tiles, gets
 *  two. */
const FLIP_MIDS = [
  [0.775, 1.3, 1.7],
  [0.575, 1.1],
  [0.525, 1.11, 1.95],
];

/** Lenis catches up to a native jump, then the reveal plays out. */
const SETTLE = 2600;
/** Long enough for the longest flip run to rewind before it is replayed. */
const REWIND = 3400;

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

  // Not uniform: a panel's dwell is sized on how many seams it has to fit, so
  // each one is measured off its own spacer rather than off the mark spacing.
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

    // A hair above the landing point, which is also where the flip run is
    // armed: the panel reads as pinned and nothing has turned over yet.
    await scrollTo(top - 24, SETTLE);
    await shot(index, "landed");
    frames += 1;

    // One approach per seam. A screenshot of this page costs more wall clock
    // than the gaps between the seams do, so timing several off a single run
    // put every frame after the first at the end of the sequence; backing out
    // above the landing edge rewinds the run and coming down replays it.
    const mids = FLIP_MIDS[i] ?? [];
    for (const [f, mid] of mids.entries()) {
      await scrollTo(top - 200, REWIND);
      // Well past the trigger rather than onto it, so the jump crosses it
      // outright instead of leaving the last pixels to the smoothing; the
      // panel is pinned either way, so the frame is the same one. The run
      // starts on that jump — ScrollTrigger reads the native scroll, which
      // lands before Lenis has caught up to it — so the clock starts here.
      await page.evaluate((to) => window.scrollTo(0, to), top + 80);
      const started = Date.now();
      const wait = started + mid * 1000 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      await shot(index, mids.length > 1 ? `flip-${f + 1}` : "flip");
      frames += 1;
    }

    await scrollTo(top + dwells[i] + vp.height * 0.5, SETTLE);
    await shot(index, "cover");
    frames += 1;
  }

  console.log(
    `${vp.name}: ${frames} frames${
      stacks ? `, dwells ${dwells.map((d) => Math.round(d)).join("/")}px` : ""
    }`,
  );
  await page.close();
}

await browser.close();
