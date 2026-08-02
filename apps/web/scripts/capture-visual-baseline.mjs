// Deterministic per-act screenshots — the regression net for the arrival.
//
// The other capture-* scripts in this folder are filmstrips for eyeballing a
// single effect: they sample on wall-clock time while everything keeps moving,
// so no two runs agree. This one exists to be compared byte-for-byte across a
// dependency change, which needs the opposite property.
//
// What is pinned:
//   - the clock (see visual-baseline-clock.mjs) — rAF, performance.now and
//     Date.now are virtual, so frame count is the only time input;
//   - video, which is seeked to a fixed time and never allowed to play;
//   - the viewport, at the two sizes the layout actually branches on;
//   - scroll, at fixed fractions of each act's own range rather than at
//     absolute offsets, so a layout that grows by a pixel does not shift
//     every later act's frame;
//   - fonts and images, waited for before the first frame is stepped.
//
// Run it against a production server. `next dev` recompiles between captures
// and mounts the dev overlay, neither of which survives a byte comparison.
//
// The output is untracked, like its neighbours', but for a different reason.
// A filmstrip is a planning artifact read once and thrown away. These frames
// are a fixture — except a fixture only means something between two captures
// on the same machine, so a committed one is a 27 MB file nobody else can
// compare against. Capture the merge base, capture the branch, diff those.
//
// Usage: node apps/web/scripts/capture-visual-baseline.mjs [baseUrl] [outDir]
//   default baseUrl http://localhost:3000
//   default outDir  apps/web/tests/visual-baseline
// Output: <outDir>/<viewport>/act-<n>-p<PP>.png, .../nav-<state>.png
//         and .../booking-<view>.png
//
// The frames are the *record*. For `/booking` the *gate* is
// `check-booking-screen.mjs`, which measures the 3:2 box, the accessible names
// and the scroll restoration in a browser rather than comparing pixels over a
// photograph — see design-foundations.md §10 on why a diff of these files only
// means something between two captures on the same machine.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { VIRTUAL_CLOCK } from "./visual-baseline-clock.mjs";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(import.meta.dirname, "..", "tests", "visual-baseline");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

/** Fractions of each act's own scroll range. The ends matter as much as the
 *  middle: a pinned act's first and last frame are where a scrub that changed
 *  its easing shows up. */
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

const ACTS = [1, 2, 3, 4, 5, 6];

/** Virtual frames to step after the page loads: the distance-field build, the
 *  curtain lift and the mark opening out of its dot, with room to spare. */
const WARMUP_FRAMES = 420;
/** Virtual frames to step after a scroll, for Lenis to catch up to the native
 *  jump and for the act's own scrub to settle on the new position. */
const SETTLE_FRAMES = 150;
/** Where every video is parked. Zero is the one offset every decoder agrees
 *  on: it is a keyframe in every encode, so the seek lands on the same frame
 *  rather than on whichever one is nearest. */
const VIDEO_TIME = 0;
/** Offset every CSS animation and transition is pinned to before a shot. */
const CSS_ANIMATION_TIME = 1000;
/** Real milliseconds to leave between a scroll and the frames that follow it.
 *
 *  Not everything the acts react to arrives on a frame callback. Intersection
 *  observers — which decide the nav's dark state, which videos are allowed to
 *  run, and when several acts mount at all — are delivered on the browser's
 *  own rendering schedule, which the virtual clock does not reach. Waiting in
 *  real time lets them land without moving anything: the animation clock is
 *  stopped throughout, so this costs wall time and nothing else. */
const OBSERVER_SETTLE_MS = 400;

await rm(OUT, { recursive: true, force: true });

// SwiftShader gives headless chromium a real WebGL2 context, so the lens and
// the gobo take the same branch they take on a machine with a GPU, and take it
// through a software rasteriser that renders the same pixels every run.
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

/** Park every video at a fixed frame. Re-run before each shot: the acts mount
 *  their media lazily, so later scrolls introduce elements the last pass had
 *  no way to see. */
async function freezeMedia(page, at) {
  await page.evaluate(async (time) => {
    const deadline = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const once = (target, event, ms) =>
      Promise.race([
        new Promise((resolve) =>
          target.addEventListener(event, resolve, { once: true }),
        ),
        deadline(ms),
      ]);

    await Promise.all(
      [...document.querySelectorAll("video")].map(async (video) => {
        // HAVE_CURRENT_DATA. Seeking before the decoder has a frame leaves the
        // element showing whatever it had — which for a video the page has not
        // played yet is nothing at all, and a video texture with nothing in it
        // renders black over whatever it was supposed to be tinting.
        if (video.readyState < 2) {
          video.load();
          await Promise.race([once(video, "loadeddata", 3000), deadline(3000)]);
        }
        video.pause();
        video.autoplay = false;
        video.loop = false;
        if (video.readyState < 2) return;

        if (Math.abs(video.currentTime - time) < 0.001) return;
        video.currentTime = time;
        // A seek to a position the decoder is already parked on can resolve
        // without ever firing the event, so do not wait on it forever.
        await once(video, "seeked", 1500);
      }),
    );
  }, at);
}

/** Wait for the images the current scroll position actually shows.
 *
 *  Most of the arrival's images are lazy, so waiting for every img on the page
 *  to report complete never returns — two thirds of them are not fetched until
 *  something scrolls them into view. Only the ones near the viewport can be
 *  waited on, and only for as long as a slow decode is plausible. */
async function awaitVisibleImages(page, timeout = 4000) {
  await page.evaluate(async (limit) => {
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
    if (!pending.length) return;
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => setTimeout(resolve, limit)),
    ]);
  }, timeout);
}

const step = (page, frames) =>
  page.evaluate((n) => window.__baselineClock.step(n), frames);

/** Capture through CDP rather than page.screenshot.
 *
 *  page.screenshot waits for the page to hand over two identical frames before
 *  it fires, and the WebGL acts never do — they are still painting whenever
 *  they are on screen, which is why capture-finale.mjs already carries a
 *  fallback for this. That wait is also redundant here: the clock is stopped,
 *  so the frame on screen is already the frame that was asked for.
 *
 *  CSS animations and transitions run off the document timeline, which the
 *  virtual clock does not reach, so they are pinned separately — paused at a
 *  fixed offset rather than removed, so a bar that animates into place is
 *  still photographed in a real state of itself. */
async function shoot(cdp, page, file, clip) {
  await page.evaluate((at) => {
    for (const animation of document.getAnimations()) {
      try {
        animation.pause();
        animation.currentTime = at;
      } catch {
        // Some animations refuse a seek once finished; theirs is already a
        // fixed state, which is all this needs.
      }
    }
  }, CSS_ANIMATION_TIME);

  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  await writeFile(file, Buffer.from(data, "base64"));
}

/** Page-absolute box of a selector, in the coordinates CDP's clip expects. */
const boxOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }, selector);

for (const vp of VIEWPORTS) {
  const dir = path.join(OUT, vp.name);
  await mkdir(dir, { recursive: true });

  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
  });
  await page.addInitScript(VIRTUAL_CLOCK);
  const cdp = await page.context().newCDPSession(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  await page.evaluate(() => document.fonts.ready);
  await awaitVisibleImages(page);
  // Act 1's lens only mounts its canvas once the distance field is built and
  // the backdrop video has decoded, neither of which is on the frame clock.
  // Stepping before it is up photographs an act that has not started.
  await page
    .waitForSelector('[data-act="1"] canvas', { timeout: 30_000 })
    .catch(() => console.warn("  act 1 canvas never mounted"));
  await freezeMedia(page, VIDEO_TIME);
  await page.waitForTimeout(OBSERVER_SETTLE_MS);
  await step(page, WARMUP_FRAMES);
  await freezeMedia(page, VIDEO_TIME);

  let shots = 0;
  for (const act of ACTS) {
    const range = await page.evaluate((n) => {
      const el = document.querySelector(`[data-act="${n}"]`);
      if (!el) return null;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // A pinned act is taller than the viewport and scrubs across the
      // difference; an unpinned one has no range of its own, so its fractions
      // all land on the same frame, which is the honest answer for it.
      return { top, span: Math.max(0, el.offsetHeight - window.innerHeight) };
    }, act);
    if (!range) throw new Error(`no [data-act="${act}"] on the page`);

    for (const fraction of FRACTIONS) {
      const y = Math.round(range.top + fraction * range.span);
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(OBSERVER_SETTLE_MS);
      // Half the settle first, so the lazy images this position uncovers have
      // been asked for before anything waits on them.
      await step(page, Math.round(SETTLE_FRAMES / 2));
      await awaitVisibleImages(page);
      await step(page, Math.round(SETTLE_FRAMES / 2));
      await freezeMedia(page, VIDEO_TIME);
      // Media seeks land outside the virtual clock, so give the compositor the
      // frame that shows them before the shutter.
      await page.waitForTimeout(OBSERVER_SETTLE_MS);
      await step(page, 2);

      const pct = String(Math.round(fraction * 100)).padStart(3, "0");
      await shoot(cdp, page, path.join(dir, `act-${act}-p${pct}.png`));
      shots++;
    }
  }

  // The nav is the one thing that is not inside an act: it reads the act under
  // the viewport centre and changes colour and shape as that changes. Its
  // states are worth their own frames.
  const NAV = "[data-phase]";
  for (const [state, act] of [
    ["light", 1],
    ["dark", 4],
  ]) {
    const y = await page.evaluate((n) => {
      const el = document.querySelector(`[data-act="${n}"]`);
      return (
        el.getBoundingClientRect().top +
        window.scrollY +
        window.innerHeight * 0.5
      );
    }, act);
    await page.evaluate((to) => window.scrollTo(0, Math.round(to)), y);
    await page.waitForTimeout(OBSERVER_SETTLE_MS);
    await step(page, SETTLE_FRAMES);
    await page.waitForTimeout(OBSERVER_SETTLE_MS);
    await shoot(
      cdp,
      page,
      path.join(dir, `nav-${state}.png`),
      await boxOf(page, NAV),
    );
    shots++;
  }

  // Menu open is a different composition rather than a state of the bar, so it
  // is shot full-frame.
  await page.locator("#nav-menu-button").click();
  await page.waitForTimeout(OBSERVER_SETTLE_MS);
  await step(page, SETTLE_FRAMES);
  await freezeMedia(page, VIDEO_TIME);
  await page.waitForTimeout(OBSERVER_SETTLE_MS);
  await step(page, 2);
  await shoot(cdp, page, path.join(dir, "nav-menu-open.png"));
  shots++;

  // `/booking` asks two questions in sequence and only one of them is mounted at
  // a time, so it is **two baselines per viewport, not one**. Each is loaded as
  // its own page rather than reached by pressing through the first: the
  // inactive view is unmounted, the transition between them runs under Motion,
  // and a frame taken mid-crossfade is a frame that cannot be compared.
  //
  // The range is fixed rather than found. Under the virtual clock `Date.now` is
  // 2025-01-01, which is what the property's `today()` reads, and the rate
  // fixture derives every price and every sold-out night from the date itself —
  // so these two dates are the same search on every machine and every run.
  for (const [name, query, view] of [
    ["booking-when", "", "when"],
    ["booking-rooms", "?from=2025-01-05&to=2025-01-07", "rooms"],
  ]) {
    await page.goto(`${BASE_URL}/booking${query}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(`[data-view="${view}"]`);
    await page.evaluate(() => document.fonts.ready);
    // The card cascade is Motion's, so it runs on the frame clock the harness
    // owns. Without stepping it, every card is photographed at opacity 0.
    await step(page, SETTLE_FRAMES);
    await awaitVisibleImages(page);
    await step(page, SETTLE_FRAMES);
    await page.waitForTimeout(OBSERVER_SETTLE_MS);
    await shoot(cdp, page, path.join(dir, `${name}.png`));
    shots++;
  }

  console.log(`${vp.name}: ${shots} frames`);
  await page.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
