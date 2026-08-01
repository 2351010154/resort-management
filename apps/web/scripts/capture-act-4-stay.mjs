// Filmstrip of Act 4's three movements, for eyeballing the corridor lag, the
// arch opening and the room deck.
//
// The act is one pinned scrub after another, so a single screenshot says
// nothing about it. This walks the act's whole scroll range in even steps and
// writes one frame per step.
//
// Usage: node apps/web/scripts/capture-act-4-stay.mjs [baseUrl] [steps] [movement]
//   default baseUrl http://localhost:3000, 20 steps (5% of the act each)
//   movement: act (default) | corridor | threshold | rooms — the whole act at
//   5% steps is too coarse to read one movement, so each is addressable on its
//   own scroll range.
// Output: plans/reports/screenshots/act-4-stay[-<movement>]/<vp>-NN-pPP.png

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const STEPS = Number(process.argv[3] ?? 20);
const MOVEMENT = process.argv[4] ?? "act";
const SELECTOR =
  MOVEMENT === "act" ? '[data-act="4"]' : `[data-movement="${MOVEMENT}"]`;
const OUT = screenshotDir(
  MOVEMENT === "act" ? "act-4-stay" : `act-4-stay-${MOVEMENT}`,
);
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  // Act 1 has to finish its distance-field build before ScrollTrigger settles.
  await page.waitForTimeout(3500);

  const range = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const top = el.getBoundingClientRect().top + window.scrollY;
    return { top, span: el.offsetHeight - window.innerHeight };
  }, SELECTOR);
  if (!range) throw new Error(`no ${SELECTOR} on the page`);

  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    await page.evaluate((y) => window.scrollTo(0, y), range.top + p * range.span);
    // Lenis syncs to a native jump on its next frame; the extra beat is for the
    // deck's own ticker and for video frames to land.
    await page.waitForTimeout(600);
    const name = `${vp.name}-${String(i).padStart(2, "0")}-p${String(Math.round(p * 100)).padStart(3, "0")}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
  }
  console.log(`${vp.name}: ${STEPS + 1} frames`);
  await page.close();

  // The reduced-motion branch mounts no pins at all, so it is a different
  // composition rather than a frozen frame of this one — it needs its own shot.
  const still = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: "reduce",
  });
  await still.goto(BASE_URL, { waitUntil: "networkidle" });
  await still.waitForTimeout(2500);
  // Twice: the static variants size to their images, so lazy images finishing
  // above the act move it out from under the first scroll.
  for (let i = 0; i < 2; i++) {
    await still.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
    }, SELECTOR);
    await still.waitForTimeout(1200);
  }
  await still.screenshot({ path: path.join(OUT, `${vp.name}-reduced-motion.png`) });
  await still.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
