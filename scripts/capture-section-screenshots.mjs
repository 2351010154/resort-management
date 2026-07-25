// Playwright self-verification harness — captures every [data-act] section at
// desktop + mobile viewports against a running dev server.
//
// Usage: node scripts/capture-section-screenshots.mjs [baseUrl]
//   default baseUrl http://localhost:3000
// Output: plans/reports/screenshots/act-<n>-<viewport>.png

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(import.meta.dirname, "..", "plans", "reports", "screenshots");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const actCount = await page.locator("[data-act]").count();
  for (let i = 0; i < actCount; i++) {
    const section = page.locator("[data-act]").nth(i);
    const act = await section.getAttribute("data-act");
    // Instant native jump (bypasses Lenis smoothing), then settle for lazy media.
    await section.evaluate((el) => el.scrollIntoView({ behavior: "instant", block: "start" }));
    await page.waitForTimeout(600);
    const file = path.join(OUT, `act-${act}-${vp.name}.png`);
    await page.screenshot({ path: file });
    console.log(`captured ${path.basename(file)}`);
  }
  await page.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
