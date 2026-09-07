// Frames of Act 2's six chapters, which are one continuous passage: each
// chapter is a block taller than the screen that scrolls through at its own
// height; the window holds for a beat and the strip pins to travel sideways
// and open its lens. The bleed starts under the strip, so its "entering"
// frame is the strip's stage with the lens part open.
//
// Per chapter on desktop, three beats on the chapter's own scale — the top
// mark's travel in viewport heights up from the foot of the screen: the
// chapter entering (0.45), the reading holding while the photographs pass
// (1.0), and the chapter leaving with the next one already showing under it
// (its travel and a little more, so the last of it fills most of the screen
// and the next chapter's top is in the foot). Mobile does not hold anything,
// so it gets the type and the photographs of each chapter as they scroll past.
//
// Usage: node apps/web/scripts/capture-welcome-chapters.mjs [baseUrl]
// Output: plans/reports/screenshots/welcome-chapters/<vp>-NN-<beat>.png

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = screenshotDir("welcome-chapters");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

/** Lenis catches up to a native jump, then the entrances play out. */
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

  // The rails and the readings stick and lie about where they are; the
  // zero-height marks sit at each chapter's static top, which is what the act's
  // own triggers measure from. The travel is read off the chapter rather than
  // assumed: it is one figure per chapter, and a capture that hard-codes it
  // goes stale the moment one is retuned.
  const chapters = await page.evaluate(() =>
    [...document.querySelectorAll('[data-act="2"] [data-chapter-mark]')].map(
      (mark) => ({
        top: mark.getBoundingClientRect().top + window.scrollY,
        travel: Number(
          getComputedStyle(mark.closest("article")).getPropertyValue(
            "--travel",
          ),
        ),
      }),
    ),
  );
  if (chapters.length < 2)
    throw new Error("no chapter marks under [data-act=2]");

  const flows = vp.name === "desktop";

  const shot = (index, beat) =>
    page.screenshot({
      path: path.join(OUT, `${vp.name}-${index}-${beat}.png`),
    });
  /** Scroll so the chapter's top mark has travelled `p` viewport heights up
   *  from the foot of the screen — the unit every range in the act is on. */
  const scrollTo = async (top, p) => {
    await page.evaluate(
      ([to, travelled, h]) => window.scrollTo(0, to - h * (1 - travelled)),
      [top, p, vp.height],
    );
    await page.waitForTimeout(SETTLE);
  };

  let frames = 0;
  for (const [i, { top, travel }] of chapters.entries()) {
    const index = `${i + 1}`.padStart(2, "0");

    if (!flows) {
      await scrollTo(top, 0.9);
      await shot(index, "type");
      await scrollTo(top, 1.7);
      await shot(index, "stack");
      frames += 2;
      continue;
    }

    await scrollTo(top, 0.45);
    await shot(index, "entering");
    await scrollTo(top, 1);
    await shot(index, "holding");
    await scrollTo(top, travel + 0.15);
    await shot(index, "leaving");
    frames += 3;
  }

  console.log(
    `${vp.name}: ${frames} frames${
      flows
        ? `, travel ${chapters.map((c) => c.travel).join("/")} viewports`
        : ""
    }`,
  );
  await page.close();
}

await browser.close();
