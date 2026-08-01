// Filmstrip of Act 1's push, for eyeballing the monogram lens.
//
// Act 1 is a pinned scrub, so a single screenshot says nothing about it. This
// walks the act's scroll range in even steps and writes one frame per step.
//
// Usage: node apps/web/scripts/capture-intro-push.mjs [baseUrl] [steps]
//   default baseUrl http://localhost:3000, 10 steps
// Output: plans/reports/screenshots/intro-push/<vp>-NN-pPP.png

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const STEPS = Number(process.argv[3] ?? 10);
const OUT = screenshotDir("intro-push");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// SwiftShader gives headless chromium a real WebGL2 context, so the lens takes
// the same branch it takes on a machine with a GPU.
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  // distance field build, curtain lift, and the mark opening out of its dot
  await page.waitForTimeout(3500);

  const range = await page.evaluate(() => {
    const el = document.querySelector('[data-act="1"]');
    if (!el) return null;
    const top = el.getBoundingClientRect().top + window.scrollY;
    return { top, span: el.offsetHeight - window.innerHeight };
  });
  if (!range) throw new Error("no [data-act=1] on the page");

  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    await page.evaluate((y) => window.scrollTo(0, y), range.top + p * range.span);
    // Lenis syncs to a native jump on its next frame; the extra beat is for the
    // cards' own ticker and for video frames to land.
    await page.waitForTimeout(500);
    const name = `${vp.name}-${String(i).padStart(2, "0")}-p${String(Math.round(p * 100)).padStart(3, "0")}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
  }
  console.log(`${vp.name}: ${STEPS + 1} frames`);
  await page.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
