// Frames of Act 2's three chapters, for checking the mirrored stack layouts.
//
// One shot per chapter with the panel parked in the middle of the viewport, so
// the reveal has played and the whole composition — rail, ragged line, and the
// three overlapping tiles — is in frame.
//
// Usage: node scripts/capture-welcome-chapters.mjs [baseUrl]
// Output: plans/reports/screenshots/welcome-chapters/<vp>-NN.png

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(
  import.meta.dirname, "..", "plans", "reports", "screenshots", "welcome-chapters",
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
  await page.waitForTimeout(2000);

  const count = await page.evaluate(
    () => document.querySelectorAll('[data-act="2"] article').length,
  );
  if (!count) throw new Error("no chapters under [data-act=2]");

  for (let i = 0; i < count; i++) {
    await page.evaluate((index) => {
      const el = document.querySelectorAll('[data-act="2"] article')[index];
      const rect = el.getBoundingClientRect();
      window.scrollTo(0, rect.top + window.scrollY - (window.innerHeight - rect.height) / 2);
    }, i);
    // Lenis catches up to the native jump, then the reveal plays out.
    await page.waitForTimeout(2600);
    await page.screenshot({
      path: path.join(OUT, `${vp.name}-${String(i + 1).padStart(2, "0")}.png`),
    });
  }
  console.log(`${vp.name}: ${count} chapters`);
  await page.close();
}

await browser.close();
