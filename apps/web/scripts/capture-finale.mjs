// Frames of the finale: Act 5's invitation (held screen, then the hand-over) and
// the footer riding up off the wordmark reveal.
//
// The invitation shots are taken off [data-act="5"]'s own top; the reveal shots
// are taken off the band's static top and the end of the page, which is where
// its uncovering starts and finishes.
//
// Usage: node apps/web/scripts/capture-finale.mjs [baseUrl]
// Output: plans/reports/screenshots/finale/<vp>-NN-<beat>.png

import { chromium } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = screenshotDir("finale");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

/**
 * Playwright's own screenshot waits for a stable frame, which the WebGL acts
 * earlier in the page do not always hand over in dev. Retry, then fall back to
 * the raw CDP capture, which does not wait.
 */
async function shoot(page, file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path: file, timeout: 20_000 });
      return;
    } catch {
      /* fall through */
    }
  }
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach();
  await writeFile(file, Buffer.from(data, "base64"));
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const geometry = await page.evaluate(() => {
    const top = (selector) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el.getBoundingClientRect().top + window.scrollY;
    };
    return {
      invitation: top('[data-act="5"]'),
      footer: top('[data-act="6"]'),
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    };
  });

  const { invitation, footer, maxScroll } = geometry;
  // Act 5's first screen is Act 4's veil wiping up off the frame, so the address
  // is not expected until a viewport in (see the component's entry trigger).
  const shots = [
    ["01", "veil-wipe", invitation + vp.height * 0.5],
    ["02", "address", invitation + vp.height * 1.15],
    ["03", "invite-held", invitation + vp.height * 1.7],
    ["04", "invite-handover", footer - vp.height * 0.7],
    ["05", "footer", footer - vp.height * 0.1],
    ["06", "reveal-half", (footer + maxScroll) / 2],
    ["07", "reveal-end", maxScroll],
  ];

  for (const [index, beat, y] of shots) {
    await page.evaluate((to) => window.scrollTo(0, to), Math.max(0, Math.round(y)));
    // Lenis catches up to the native jump, then the reveal plays out.
    await page.waitForTimeout(2600);
    // Dev-mode WebGL acts keep painting and the compositor intermittently misses
    // its window to hand a frame over — one retry clears it.
    const file = path.join(OUT, `${vp.name}-${index}-${beat}.png`);
    await shoot(page, file);
    console.log(`  ${vp.name}-${index}-${beat}`);
  }
  console.log(`${vp.name}: ${shots.length} frames, page ${Math.round(maxScroll)}px`);
  await page.close();
}

await browser.close();
