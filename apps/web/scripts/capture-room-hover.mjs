// The room deck's hover state, which the act-4 filmstrip cannot reach: it never
// moves a pointer, so every frame it captures is the resting composition.
//
// Writes a before/after pair per position — pointer parked clear of the cards,
// then parked on the largest whole card — so the pull, the scrim coming off and
// the caption can be read against the frame they came from.
//
// Usage: node apps/web/scripts/capture-room-hover.mjs [baseUrl] [progress...]
//   default baseUrl http://localhost:3000, progresses 0.15 0.85
// Output: plans/reports/screenshots/room-hover/<vp>-p<PP>-<rest|hover>.png

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { screenshotDir } from "./screenshot-dir.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const AT = process.argv.slice(3).map(Number);
const PROGRESS = AT.length ? AT : [0.15, 0.85];
const OUT = screenshotDir("room-hover");
const VIEWPORTS = [{ name: "desktop", width: 1440, height: 900 }];

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
  await page.waitForTimeout(3500);

  const range = await page.evaluate(() => {
    const el = document.querySelector('[data-movement="rooms"]');
    const top = el.getBoundingClientRect().top + window.scrollY;
    return { top, span: el.offsetHeight - window.innerHeight };
  });

  for (const p of PROGRESS) {
    const tag = `p${String(Math.round(p * 100)).padStart(3, "0")}`;
    await page.evaluate(
      (y) => window.scrollTo(0, y),
      range.top + p * range.span,
    );
    // Park the pointer off the cascade first, so the rest frame is a true rest.
    await page.mouse.move(vp.width / 2, vp.height - 24);
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(OUT, `${vp.name}-${tag}-rest.png`),
    });

    const target = await page.evaluate((atProgress) => {
      // Day's pool is the first POOL nodes, night's the second. The covered
      // half is clipped to zero width but its cards keep their boxes, so
      // querying all of them hands back a card that is not on screen — which
      // is how the first version of this hovered empty air.
      const all = [...document.querySelectorAll("[data-card]")];
      const pool = all.length / 2;
      const half = atProgress < 0.5 ? all.slice(0, pool) : all.slice(pool);
      const best = half
        .map((c) => ({
          r: c.getBoundingClientRect(),
          o: Number(c.style.opacity || 0),
        }))
        .filter(
          (c) =>
            c.o > 0.9 &&
            c.r.left > 0 &&
            c.r.right < innerWidth &&
            c.r.top > 0 &&
            c.r.bottom < innerHeight,
        )
        .sort((a, b) => b.r.width - a.r.width)[0];
      return best
        ? {
            x: best.r.left + best.r.width / 2,
            y: best.r.top + best.r.height / 2,
          }
        : null;
    }, p);
    if (!target) {
      console.log(`${tag}: no whole card in frame to hover`);
      continue;
    }
    await page.mouse.move(target.x, target.y);
    // The pull eases over PULL_TAU and the caption fades over 0.28s.
    await page.waitForTimeout(1100);
    await page.screenshot({
      path: path.join(OUT, `${vp.name}-${tag}-hover.png`),
    });
    console.log(
      `${tag}: hovered at ${Math.round(target.x)},${Math.round(target.y)}`,
    );
  }
  await page.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
