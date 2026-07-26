// Frames of Act 2's wall, for eyeballing the foliage gobo.
//
// The shadow only reads over time — a single frame says nothing about whether
// the leaves flutter or twitch — so this parks the act's line in the middle of
// the viewport and shoots a burst at a fixed interval.
//
// Usage: node apps/web/scripts/capture-welcome-wall.mjs [baseUrl] [frames] [gapMs]
//   default baseUrl http://localhost:3000, 6 frames, 900ms apart
// Output: plans/reports/screenshots/welcome-wall/<vp>-NN.png

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const FRAMES = Number(process.argv[3] ?? 6);
const GAP = Number(process.argv[4] ?? 900);
const OUT = screenshotDir("welcome-wall");
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
  await page.waitForTimeout(2000);

  // Centre the act, which is where its sticky wall lines up with the viewport.
  const found = await page.evaluate(() => {
    const el = document.querySelector('[data-act="2"]');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    window.scrollTo(0, rect.top + window.scrollY + (el.offsetHeight - window.innerHeight) / 2);
    return true;
  });
  if (!found) throw new Error("no [data-act=2] on the page");
  // Lenis catches up to the native jump, then the reveal plays out.
  await page.waitForTimeout(2500);
  // A pointer sitting still: the gobo answers the pointer, and a phantom one at
  // 0,0 leans the whole spray.
  await page.mouse.move(vp.width * 0.5, vp.height * 0.5);
  await page.waitForTimeout(600);

  for (let i = 0; i < FRAMES; i++) {
    await page.screenshot({ path: path.join(OUT, `${vp.name}-${String(i).padStart(2, "0")}.png`) });
    await page.waitForTimeout(GAP);
  }
  console.log(`${vp.name}: ${FRAMES} frames`);
  await page.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
