// Visual regression capture for the paced ivory ribbon.
// node apps/web/scripts/capture-act-2-ribbon.mjs [baseUrl] [--no-video]
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { screenshotDir } from "./screenshot-dir.mjs";

const args = process.argv.slice(2);
const base =
  args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000";
const out = screenshotDir("act-2-ribbon");
await mkdir(out, { recursive: true });
// Scroll positions on the 1480vh desktop track; the final value is the
// corresponding camera position for native reduced-motion scrolling.
const moments = [
  ["light", 70, 0],
  ["rooms", 340, 86],
  ["water", 625, 179],
  ["table", 895, 279],
  ["stay", 1160, 382],
  ["horizon", 1280, 492],
];
const browser = await chromium.launch();
for (const profile of [
  { name: "desktop", width: 1440, height: 900, reducedMotion: "no-preference" },
  { name: "mobile", width: 375, height: 812, reducedMotion: "no-preference" },
  { name: "reduced", width: 1440, height: 900, reducedMotion: "reduce" },
]) {
  const page = await browser.newPage({
    viewport: profile,
    reducedMotion: profile.reducedMotion,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  const section = page.locator('[data-act="2"]');
  const act = await section.evaluate((element) => ({
    top: element.getBoundingClientRect().top + window.scrollY,
    length: Number(element.style.getPropertyValue("--length")),
  }));
  for (const [name, position, scene] of moments) {
    const offset =
      profile.reducedMotion === "reduce"
        ? scene + 100
        : (position * (act.length - 100)) / 1380;
    await page.evaluate(
      (y) => window.scrollTo(0, y),
      act.top + (offset * profile.height) / 100,
    );
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(out, `${profile.name}-${name}.png`),
    });
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow || errors.length)
    throw new Error(`${profile.name}: ${JSON.stringify({ overflow, errors })}`);
  console.log(
    `${profile.name}: six compositions captured, no overflow or page errors`,
  );
  await page.close();
}
if (!args.includes("--no-video")) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: out, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  const top = await page
    .locator('[data-act="2"]')
    .evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    );
  for (let position = -80; position <= 1380; position += 8) {
    await page.evaluate((y) => window.scrollTo(0, y), top + position * 9);
    await page.waitForTimeout(90);
  }
  const video = page.video();
  await page.close();
  await video.saveAs(path.join(out, "desktop-scroll-through.webm"));
  await context.close();
}
await browser.close();
console.log(out);
