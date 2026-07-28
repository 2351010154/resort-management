// The acceptance criteria for `/booking`, read by a real browser.
//
// `vitest.config.ts` is explicit about the division and it holds here: pure
// logic is tested in `features/booking/lib/*.spec.ts`, and everything whose
// answer is a *computed style*, an *accessible name* or a *scroll offset* is
// tested in Chromium, because jsdom is not evidence about any of the three.
//
// **A computed-style assertion is a stronger gate than a pixel diff** for this
// screen, and the report's own method says so. A 3:2 box that has become 1.48
// is a defect a diff over a photograph will happily absorb; a number will not.
// The visual baselines still exist — they are the record, this is the gate.
//
// **This one runs on the real clock**, unlike `capture-visual-baseline.mjs`.
// That script replaces `requestAnimationFrame` with a queue only `step()`
// drains, which is exactly right for photographing a frozen frame and exactly
// wrong here: this screen's views leave under Motion, Motion runs on the frame
// loop, and a view that never finishes exiting never unmounts. So the dates are
// found rather than fixed — the script probes forward from today for a range
// where every type is free, which is also the only way to be sure such a range
// exists at all.
//
// Run it against a **production** server. `next dev` recompiles between
// navigations and mounts an overlay, and neither survives a measurement.
//
// Usage: node apps/web/scripts/check-booking-screen.mjs [baseUrl]
//   default baseUrl http://localhost:3000

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

/** The card's word budget. §3.2 measures 11–12; 15 is the budget it is under. */
const CARD_WORD_CEILING = 12;
/** View B's prose, with every type available. §3.13 measures about 100. */
const VIEW_WORD_CEILING = 110;
/** The tap floor. 44 is the standard; this is the control the guest taps. */
const TAP_FLOOR = 48;

let failures = 0;
let checks = 0;

function check(ok, label, detail) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(
    `  FAIL  ${label}${detail === undefined ? "" : ` — ${detail}`}`,
  );
}

/**
 * Words, as a reader counts them.
 *
 * Figures, currency marks and separators are data rather than prose — a price
 * is one thing to read whatever its digits are, and counting "5.513.000" as a
 * word would make the budget depend on the season. A token counts when it holds
 * a letter.
 */
function countWords(text) {
  return text.split(/\s+/).filter((token) => /[a-z]/i.test(token)).length;
}

/**
 * Today in the property's own zone, never the machine's.
 *
 * The screen's `minDate` is `today("Asia/Ho_Chi_Minh")`, so a script running in
 * Europe at 19:00 that used its own date would ask for a night the calendar has
 * already disabled. Same rule as the screen, same reason.
 */
const PROPERTY_TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
}).format(new Date());

/** A range starting `offset` days out, `nights` long, as booking's own params. */
function rangeParams(offset, nights) {
  const [year, month, day] = PROPERTY_TODAY.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) + offset * 86_400_000);
  const end = new Date(start.getTime() + nights * 86_400_000);
  const iso = (date) => date.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  console.log(`\n${viewport.name} — ${viewport.width}×${viewport.height}`);

  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });

  const open = async (query = "") => {
    await page.goto(`${BASE_URL}/booking${query}`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
  };

  // ---- View A: when ------------------------------------------------------

  await open();
  await page.waitForSelector('[data-view="when"]');

  check(
    (await page.locator("[data-room-card]").count()) === 0,
    "View A holds no room card",
  );
  check(
    (await page.locator("[data-choose]").count()) === 0,
    "View A holds no Choose button",
  );
  check(
    (await page.locator("[role=grid]").count()) > 0,
    "View A holds the calendar",
  );
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth)) ===
      viewport.width,
    "View A does not overflow its own viewport",
    await page.evaluate(() => document.documentElement.scrollWidth),
  );

  // An anchor without a departure is a guest mid-sentence, not a range.
  await open(`?from=${rangeParams(30, 2).from}`);
  check(
    (await page.locator('[data-view="when"]').count()) === 1,
    "an incomplete range keeps View A",
  );

  // ---- Find two ranges: one with every type free, one with some gone ------

  // Both are needed and neither can be hardcoded — availability derives from the
  // date, so "today plus three" is a different search every day. The partly-free
  // one matters as much as the full one: with five types and forty rooms it is
  // the common case, not the edge.
  let query = null;
  let partial = null;
  for (let offset = 3; offset < 60 && !(query && partial); offset += 1) {
    const { from, to } = rangeParams(offset, 2);
    await open(`?from=${from}&to=${to}`);
    if ((await page.locator('[data-view="rooms"]').count()) === 0) continue;

    const cards = await page.locator("[data-room-card]").count();
    if (cards === 5) query ??= `?from=${from}&to=${to}`;
    else if (cards > 0) partial ??= `?from=${from}&to=${to}`;
  }

  if (query === null) {
    console.error(
      "  FAIL  no range in the next two months has all five types free",
    );
    failures += 1;
    await page.close();
    continue;
  }

  // ---- Partly free: photographs above, one line each below ---------------

  if (partial === null) {
    console.log("  (no partly-free range in the next two months to check)");
  } else {
    await open(partial);
    await page.waitForSelector('[data-view="rooms"]');

    const split = await page.evaluate(() => ({
      cards: document.querySelectorAll("[data-room-card]").length,
      rows: document.querySelectorAll("[data-demoted-row]").length,
      controls: document.querySelectorAll(
        "[data-demoted-row] button, [data-demoted-row] img",
      ).length,
    }));

    check(
      split.cards + split.rows === 5,
      "every type is on the screen, as a card or as a line",
      `${split.cards} cards + ${split.rows} rows`,
    );
    check(split.rows > 0, "the unbuyable types are demoted, not hidden");
    check(
      split.controls === 0,
      "a demoted row holds no button and no photograph",
      split.controls,
    );
    console.log(
      `  partly free ${partial}: ${split.cards} cards, ${split.rows} rows`,
    );
  }

  await open(query);
  await page.waitForSelector('[data-view="rooms"]');
  console.log(`  range ${query}`);

  // ---- View B: which room ------------------------------------------------

  check(
    (await page.locator("[role=grid]").count()) === 0,
    "View B holds no calendar",
  );
  check(
    (await page.locator("[data-room-card]").count()) === 5,
    "View B holds five photo cards",
  );
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth)) ===
      viewport.width,
    "View B does not overflow its own viewport",
    await page.evaluate(() => document.documentElement.scrollWidth),
  );

  // The frame is 3:2 at this width, from computed style and from the box.
  const frames = await page.evaluate(() =>
    [...document.querySelectorAll("[data-frame]")].map((frame) => {
      const rect = frame.getBoundingClientRect();
      return {
        declared: getComputedStyle(frame).aspectRatio,
        measured: rect.width / rect.height,
        width: Math.round(rect.width),
      };
    }),
  );
  for (const [index, frame] of frames.entries()) {
    check(
      frame.declared.replace(/\s/g, "") === "3/2",
      `frame ${index} declares 3 / 2`,
      frame.declared,
    );
    check(
      Math.abs(frame.measured - 1.5) < 0.01,
      `frame ${index} measures 1.50`,
      frame.measured.toFixed(3),
    );
  }
  console.log(`  frame ${frames[0].width}px wide`);

  // Content images, so meaningful alt — never "".
  const alts = await page.evaluate(() =>
    [...document.querySelectorAll("[data-room-card] img")].map(
      (img) => img.alt,
    ),
  );
  check(alts.length === 5, "every card carries one image", alts.length);
  check(
    alts.every((alt) => alt.trim().length > 0),
    "no card image has an empty alt",
  );

  // The measure line: one role="img" per card, every glyph aria-hidden, and a
  // name that carries all three facts it draws.
  const measures = await page.evaluate(() =>
    [...document.querySelectorAll("[data-room-card]")].map((card) => {
      const lines = card.querySelectorAll('[role="img"]');
      const line = lines[0];
      const glyphs = line ? [...line.children] : [];
      return {
        count: lines.length,
        label: line?.getAttribute("aria-label") ?? "",
        allHidden: glyphs.every(
          (glyph) => glyph.getAttribute("aria-hidden") === "true",
        ),
        fills: [...card.querySelectorAll("[data-size-fill]")].map((fill) => ({
          percent: Number(fill.dataset.sizeFill),
          drawn: fill.getBoundingClientRect().width,
          track: fill.parentElement.getBoundingClientRect().width,
        })),
      };
    }),
  );
  for (const [index, measure] of measures.entries()) {
    check(
      measure.count === 1,
      `card ${index} has one role="img"`,
      measure.count,
    );
    check(measure.allHidden, `card ${index}'s glyphs are all aria-hidden`);
    check(
      /Sleeps \d/.test(measure.label),
      `card ${index}'s name states the occupancy`,
      measure.label,
    );
    check(
      /\d+ square metres/.test(measure.label),
      `card ${index}'s name states the size`,
      measure.label,
    );
    check(
      measure.label.trim().split(". ").length >= 3,
      `card ${index}'s name states the aspect`,
      measure.label,
    );
  }
  check(
    measures.some((measure) => measure.label.includes("extra bed available")),
    "an extra-bed type says so in its name",
  );
  const bars = measures.flatMap((measure) => measure.fills);
  check(
    Math.max(...bars.map((bar) => bar.percent)) === 100,
    "the largest room on screen fills the whole track",
  );

  // Comparable, or the slot means nothing. Cards sit in two columns above 45rem
  // and the two columns are the same width, so every track on the screen is the
  // same length — and a longer bar is therefore always a larger room. Measured
  // before this was fixed: a 76% bar and a 50% bar both drew 146px, because the
  // aspect column was `auto` and "corner · two aspects" is the longest word.
  const trackWidths = new Set(bars.map((bar) => Math.round(bar.track)));
  check(
    trackWidths.size === 1,
    "every size track is the same length",
    [...trackWidths].join(", "),
  );
  for (const bar of bars) {
    check(
      Math.abs(bar.drawn / bar.track - bar.percent / 100) < 0.01,
      `a ${bar.percent}% bar draws ${bar.percent}% of its track`,
      `${Math.round((bar.drawn / bar.track) * 100)}%`,
    );
  }
  const ordered = bars.map((bar) => Math.round(bar.drawn));
  check(
    ordered.every((width, index) => index === 0 || width > ordered[index - 1]),
    "the bars grow down the list, as the rooms do",
    ordered.join(" < "),
  );

  // Twelve words a card, and about a hundred in the view.
  const cardWords = await page.evaluate(() =>
    [...document.querySelectorAll("[data-room-card]")].map((card) => ({
      code: card.dataset.roomCard,
      text: card.innerText,
    })),
  );
  for (const card of cardWords) {
    const words = countWords(card.text);
    check(
      words <= CARD_WORD_CEILING,
      `${card.code} is ${CARD_WORD_CEILING} words or fewer`,
      `${words}: ${card.text.replace(/\n/g, " | ")}`,
    );
  }
  const viewWords = countWords(
    await page.evaluate(
      () => document.querySelector('[data-view="rooms"]').innerText,
    ),
  );
  check(
    viewWords <= VIEW_WORD_CEILING,
    `View B is ${VIEW_WORD_CEILING} words or fewer`,
    viewWords,
  );
  console.log(
    `  ${viewWords} words in View B; ` +
      `${Math.max(...cardWords.map((card) => countWords(card.text)))} on the wordiest card`,
  );

  // The two controls the guest actually taps.
  const taps = await page.evaluate(() => {
    const height = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.getBoundingClientRect().height : 0;
    };
    return {
      choose: height("[data-choose]"),
      summary: height("[data-date-summary]"),
    };
  });
  check(taps.choose >= TAP_FLOOR, "Choose clears the tap floor", taps.choose);
  check(
    taps.summary >= TAP_FLOOR,
    "the date summary clears the tap floor",
    taps.summary,
  );

  // ---- Looking closer ----------------------------------------------------

  // The part of a dialog that is always tested last and is the only part a
  // keyboard guest feels: where focus goes, and where it comes back to.
  await page.evaluate(() => {
    document.querySelector("[data-room-card] button").focus();
    window.__opener = document.activeElement;
  });
  await page.keyboard.press("Enter");
  await page.waitForSelector('[role="dialog"]');

  check(
    await page.evaluate(() =>
      document
        .querySelector('[role="dialog"]')
        .contains(document.activeElement),
    ),
    "opening the sheet moves focus into it",
  );
  check(
    (await page.locator('[role="dialog"] [data-frame]').count()) === 0 &&
      (await page.locator('[role="dialog"] img').count()) === 1,
    "the sheet shows one photograph",
  );
  check(
    !(await page.evaluate(() =>
      /\b1 \/ 1\b/.test(document.querySelector('[role="dialog"]').innerText),
    )),
    "a single-image gallery shows no counter",
  );

  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  check(
    await page.evaluate(() => document.activeElement === window.__opener),
    "closing the sheet returns focus to the photograph that opened it",
  );

  // ---- Changing the dates and coming back --------------------------------

  // The single requirement most likely to ship subtly broken, driven exactly
  // the way a guest drives it: scroll down the list, change the dates, pick the
  // same two nights again.
  const wanted = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    return window.scrollY;
  });
  check(wanted > 0, "View B is long enough to scroll", wanted);

  await page.locator("[data-date-summary]").click();
  await page.waitForSelector('[data-view="when"]');
  check(
    (await page.locator("[data-room-card]").count()) === 0,
    "changing the dates unmounts the room list",
  );

  const picked = new URLSearchParams(query);
  await page.locator(`[data-date="${picked.get("from")}"]`).click();
  await page.locator(`[data-date="${picked.get("to")}"]`).click();
  await page.waitForSelector('[data-view="rooms"]');

  const restored = await page.evaluate(() => window.scrollY);
  check(
    Math.abs(restored - wanted) <= 4,
    "the list comes back where the guest left it",
    `${restored} against ${wanted}`,
  );

  await page.close();
}

// ---- Reduced motion ------------------------------------------------------

// §9's rule, and the failure mode it guards against is not cosmetic. The views
// leave under Motion, and `AnimatePresence mode="wait"` will not mount the
// incoming view until the outgoing one has finished leaving — so a reduced
// path that never completes its exit is a screen that never moves at all.
console.log("\nreduced motion");

{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await page.goto(`${BASE_URL}/booking`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-view="when"]');

  const pickable = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-date]")]
        .filter((cell) => cell.getAttribute("aria-disabled") !== "true")
        .map((cell) => cell.dataset.date),
    );

  const first = (await pickable())[1];
  await page.locator(`[data-date="${first}"]`).click();
  const second = (await pickable()).find((date) => date > first);
  await page.locator(`[data-date="${second}"]`).click();

  let swapped = true;
  await page
    .waitForSelector('[data-view="rooms"]', { timeout: 5000 })
    .catch(() => {
      swapped = false;
    });
  check(swapped, "the views still swap under reduced motion");
  if (swapped) {
    check(
      (await page.locator("[role=grid]").count()) === 0,
      "the outgoing view is still unmounted under reduced motion",
    );
  }
  await page.close();
}

// ---- The budget ----------------------------------------------------------

// `design-foundations.md` §5: `app/(booking)` ships zero bytes of `three`,
// `gsap` or `lenis`. It is checked two ways, because either one alone can pass
// while the rule is broken: the *source* rule is that nothing under
// `features/booking/` imports `features/arrival/` — everything under it reaches
// the banned three eventually — and the *built* rule is that the chunks the
// route actually serves contain none of them.
console.log("\nthe bundle budget");

{
  const BANNED = [
    "gsap",
    "ScrollTrigger",
    "lenis",
    "WebGLRenderer",
    "react-three",
  ];

  const sourceRoot = path.join(
    import.meta.dirname,
    "..",
    "features",
    "booking",
  );
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) sources.push(full);
    }
  };
  walk(sourceRoot);

  const importsArrival = sources.filter((file) =>
    /^\s*(import|export)[^;]*["']@?\/?features\/arrival/m.test(
      readFileSync(file, "utf8"),
    ),
  );
  check(
    importsArrival.length === 0,
    "no source under features/booking imports features/arrival",
    importsArrival.join(", "),
  );

  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/booking`, { waitUntil: "networkidle" });
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")].map((tag) => tag.src),
  );
  check(scripts.length > 0, "the route serves script chunks", scripts.length);

  const found = new Set();
  for (const src of scripts) {
    const body = await (await fetch(src)).text();
    for (const banned of BANNED) if (body.includes(banned)) found.add(banned);
  }
  check(
    found.size === 0,
    "/booking's chunks carry none of three, gsap or lenis",
    [...found].join(", "),
  );
  console.log(`  ${scripts.length} chunks read`);
  await page.close();
}

await browser.close();

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures > 0 ? ` — ${failures} FAILED` : ""),
);
process.exit(failures > 0 ? 1 : 0);
