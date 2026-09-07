// Captures full marketing screen page-to-page (viewport-by-viewport) at 1440×900,
// matching the reference capture in plans/reports/screenshots/era-reference/.
//
// Usage: node apps/web/scripts/capture-marketing-screen.mjs [baseUrl]
//   default baseUrl http://localhost:3000
// Output: plans/reports/screenshots/marketing-screen/y<NNNNN>.png

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = screenshotDir("marketing-screen");
const VIEWPORT = { width: 1440, height: 900 };

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

const page = await browser.newPage({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
});

await page.goto(BASE_URL, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
// Settle curtain lift, WebGL canvas, entrance animations
await page.waitForTimeout(4000);

const scrollHeight = await page.evaluate(
  () => document.documentElement.scrollHeight,
);
const innerHeight = VIEWPORT.height;
const maxScroll = Math.max(0, scrollHeight - innerHeight);

console.log(
  `Document scroll height: ${scrollHeight}px, max scroll: ${maxScroll}px`,
);

const positions = [];
for (let y = 0; y <= maxScroll; y += innerHeight) {
  positions.push(y);
}
if (positions.length === 0 || positions[positions.length - 1] !== maxScroll) {
  positions.push(maxScroll);
}

console.log(`Capturing ${positions.length} frames to ${OUT}...`);

for (let i = 0; i < positions.length; i++) {
  const y = positions[i];
  await page.evaluate((targetY) => {
    window.scrollTo({ top: targetY, behavior: "instant" });
    if (window.ScrollTrigger) window.ScrollTrigger.update();
  }, y);

  // Settle scrubbed animations, pinned sections, and wait for any visible images in viewport
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const margin = window.innerHeight;
    const pending = [...document.querySelectorAll("img")]
      .filter((img) => {
        if (img.complete) return false;
        const rect = img.getBoundingClientRect();
        return rect.bottom > -margin && rect.top < window.innerHeight + margin;
      })
      .map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }),
      );
    if (pending.length > 0) {
      await Promise.race([
        Promise.all(pending),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
  });

  await page.waitForTimeout(300);

  const pad = String(y).padStart(5, "0");
  const filename = `y${pad}.png`;
  const filePath = path.join(OUT, filename);

  await page.screenshot({ path: filePath });
  console.log(`[${i + 1}/${positions.length}] Captured ${filename} at y=${y}`);
}

await browser.close();
console.log(`Done! Captured ${positions.length} frames -> ${OUT}`);
