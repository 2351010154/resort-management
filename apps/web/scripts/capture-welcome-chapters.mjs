// Frames of Act 2's three chapters, which stack: each panel pins to the top of
// the viewport, holds for a dwell, and is then covered by the next one.
//
// Three desktop shots per chapter — the panel just landed, the tile flip
// mid-seam, and the next panel halfway up over it (the last chapter's third
// shot is the Act 2 -> Act 3 seam instead). Mobile does not stack, so it gets
// the type and the photographs of each chapter as they scroll past.
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

/** Where in the dwell the seam is halfway across (see FLIP_* in the component). */
const FLIP_MID = 0.46;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
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

  // Uniform by construction, where the panels stack: one viewport of cover
  // travel plus the dwell.
  const dwell = marks[1] - marks[0] - vp.height;
  const stacks = vp.name === "desktop";

  const shots = marks.flatMap((top, i) =>
    stacks
      ? [
          [`${i + 1}`.padStart(2, "0"), "landed", top],
          [`${i + 1}`.padStart(2, "0"), "flip", top + dwell * FLIP_MID],
          [`${i + 1}`.padStart(2, "0"), "cover", top + dwell + vp.height * 0.5],
        ]
      : [
          [`${i + 1}`.padStart(2, "0"), "type", top - vp.height * 0.1],
          [`${i + 1}`.padStart(2, "0"), "stack", top + vp.height * 0.7],
        ],
  );

  for (const [index, beat, y] of shots) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    // Lenis catches up to the native jump, then the reveal plays out.
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-${index}-${beat}.png`) });
  }
  console.log(
    `${vp.name}: ${shots.length} frames${stacks ? `, dwell ${Math.round(dwell)}px` : ""}`,
  );
  await page.close();
}

await browser.close();
