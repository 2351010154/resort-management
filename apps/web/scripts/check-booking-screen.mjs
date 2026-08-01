// The acceptance criteria for `/booking`, read by a real browser.
//
// `vitest.config.ts` is explicit about the division and it holds here: pure
// logic is tested in `features/booking/lib/*.spec.ts`, and everything whose
// answer is a *computed style*, an *accessible name* or a *scroll offset* is
// tested in Chromium, because jsdom is not evidence about any of the three.
//
// **A computed-style assertion is a stronger gate than a pixel diff** for this
// screen, and the report's own method says so. A band that has quietly stopped
// being the same box as the four under it is a defect a diff over a photograph
// will happily absorb; a number will not. The visual baselines still exist —
// they are the record, this is the gate.
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

/** One row's word budget: the name, the three facts, the figure. */
const ROW_WORD_CEILING = 12;
/**
 * Everything the room step says, with nothing pressed.
 *
 * **Higher than round 3's 110, and the rise is the point rather than a slip.**
 * That budget was measured over the list alone with five shut panels subtracted
 * from it, because the facts, the terms and the second price were all behind a
 * disclosure and a dialog. Nothing is behind a press now: what this counts is
 * the list *and* the room beside it, which is everything the old screen held in
 * three places. The number to watch is whether it climbs from here.
 *
 * **Round 5 did not move it.** Making the photograph the ground added the
 * concierge block — nine words and a phone number — and removed a sentence in
 * the same pass, because the extra bed had been printed twice, as a note under
 * the room's name and again as a fact in the strip.
 *
 * **Round 6 spent most of the slack and did not raise the ceiling**, which is
 * the whole use of having one. Opening the room's plate added two sentences of
 * description, four named facts and the twelve lines that are in every room, and
 * the step went from 92 words to 139. That is the budget doing its job: a change
 * this size is exactly what it exists to be measured against, and 139 still
 * clears it. The number to watch is whether it climbs from here — there are 26
 * words of room left and they are not there to be filled.
 */
const SCREEN_WORD_CEILING = 165;
/** The tap floor. 44 is the standard; this is the control the guest taps. */
const TAP_FLOOR = 48;
/** The gallery's arrows, which are furniture on a photograph rather than the
 *  decision — the standard floor, not the raised one. */
const ARROW_FLOOR = 44;

/** `room-types.ts`' five, so a name can be looked for in a sentence. */
const ROOM_NAMES = {
  SUPERIOR: "Superior",
  DELUXE: "Deluxe",
  PREMIER: "Premier",
  JUNIOR_SUITE: "Junior Suite",
  PANORAMA_SUITE: "Panorama Suite",
};

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

/**
 * A link that lands on the room list.
 *
 * **A range alone is no longer that link.** `bookingView()` opens the rooms only
 * for a complete range *at the room step*, because the dates step now ends with
 * the stay stated back in the panel beside the calendar rather than by replacing
 * the screen. A range with no `step` is View A with its panel open, which is
 * correct behaviour and was silently reported here as "no range in the next two
 * months has all five types free" for as long as this script asked for one.
 */
function roomsQuery(offset, nights) {
  const { from, to } = rangeParams(offset, nights);
  return `?from=${from}&to=${to}&step=rooms`;
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
    (await page.locator("[data-room-row]").count()) === 0,
    "View A holds no room row",
  );
  check(
    (await page.locator("[data-stage-continue]").count()) === 0,
    "View A holds no room to continue with",
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
    const rooms = roomsQuery(offset, 2);
    await open(rooms);
    if ((await page.locator('[data-view="rooms"]').count()) === 0) continue;

    const rows = await page.locator("[data-room-row]").count();
    if (rows === 5) query ??= rooms;
    else if (rows > 0) partial ??= rooms;
  }

  if (query === null) {
    console.error(
      "  FAIL  no range in the next two months has all five types free",
    );
    failures += 1;
    await page.close();
    continue;
  }

  // ---- Partly free: rows above, one sentence below ------------------------

  // **Demoted, never hidden**, and the register is what changed rather than the
  // rule. A guest who cannot see the Superior at all concludes the hotel has no
  // such room; a guest who reads its name in a sentence concludes it is not free
  // this week. So this no longer counts labelled lines — it checks that every
  // type the list did not draw is *named*, in prose, under it.
  if (partial === null) {
    console.log("  (no partly-free range in the next two months to check)");
  } else {
    await open(partial);
    await page.waitForSelector('[data-view="rooms"]');

    const split = await page.evaluate(() => ({
      shown: [...document.querySelectorAll("[data-room-row]")].map(
        (row) => row.dataset.roomRow,
      ),
      note: document.querySelector("[data-absent-note]")?.innerText ?? "",
      controls: document.querySelectorAll(
        "[data-absent-note] button, [data-absent-note] a, [data-absent-note] img",
      ).length,
    }));

    const missing = Object.keys(ROOM_NAMES).filter(
      (code) => !split.shown.includes(code),
    );

    check(missing.length > 0, "the partly-free range really is short a type");
    for (const code of missing) {
      check(
        split.note.includes(ROOM_NAMES[code]),
        `${code} is named rather than dropped`,
        split.note,
      );
    }
    check(
      split.controls === 0,
      "the sentence holds no control and no photograph",
      split.controls,
    );
    console.log(
      `  partly free ${partial}: ${split.shown.length} rows, ` +
        `${missing.length} named in prose`,
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
    (await page.locator("[data-room-row]").count()) === 5,
    "View B holds five rooms",
  );
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth)) ===
      viewport.width,
    "View B does not overflow its own viewport",
    await page.evaluate(() => document.documentElement.scrollWidth),
  );

  // **The dialog is gone, and this is the assertion that says so.**
  //
  // Round 3 answered "look closer" with a centred `role="dialog"` over a scrim,
  // and the thing a guest actually felt about it was the window's own scrollbar
  // running down the side of a box that was trying to be a room. There is no box
  // now — the room is the column beside the list — so nothing on this step may
  // reintroduce one.
  check(
    (await page.locator('[role="dialog"]').count()) === 0,
    "nothing on the room step opens a dialog",
  );

  // The page does not scroll at the width where the two columns sit side by
  // side. The list is five short rows and the stage is exactly one viewport, so
  // a page scrollbar here would mean one of the two has outgrown the window —
  // which is the defect this composition was built to remove. Below that width
  // the two stack into one scrolling column and the rule does not apply.
  if (viewport.width >= 1248) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    check(
      overflow <= 1,
      "the room step is the height of the window, and no taller",
      `${overflow}px past it`,
    );
  }

  // The thumbnails are a way of telling five rows apart, so what matters is that
  // they are the *same box* — a longer name must not change the size of the
  // picture beside it — and that the photograph fills it rather than sitting
  // letterboxed inside it.
  const thumbs = await page.evaluate(() =>
    [...document.querySelectorAll("[data-room-row] img")].map((img) => {
      const rect = img.getBoundingClientRect();
      const style = getComputedStyle(img);
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        fit: style.objectFit,
        alt: img.alt,
      };
    }),
  );
  check(thumbs.length === 5, "every room has a thumbnail", thumbs.length);
  const boxes = new Set(thumbs.map((t) => `${t.width}×${t.height}`));
  check(
    boxes.size === 1,
    "every thumbnail is the same box",
    [...boxes].join(", "),
  );
  check(
    thumbs.every((t) => t.fit === "cover"),
    "the photograph fills its thumbnail rather than fitting inside it",
    [...new Set(thumbs.map((t) => t.fit))].join(", "),
  );
  // Decorative here, and meaningful on the stage. The same picture is beside the
  // row at full size with a written description; an alt on both would make a
  // screen reader read a paragraph about lattice screens before it reached the
  // price.
  check(
    thumbs.every((t) => t.alt === ""),
    "a thumbnail is decorative, because the stage describes the same frame",
  );
  console.log(`  thumbnail ${thumbs[0].width}×${thumbs[0].height}`);

  // The row states the three facts that differ, in words.
  //
  // **Nothing that differs between the five types is behind a press.** That rule
  // outlived the disclosure it was written for, and this is where it is checked:
  // on what the guest reads without touching anything.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("[data-room-row]")].map((row) => ({
      code: row.dataset.roomRow,
      text: row.innerText,
    })),
  );
  for (const row of rows) {
    check(
      /\d+ guests?/.test(row.text),
      `${row.code}'s row states the occupancy`,
      row.text.replace(/\n/g, " | "),
    );
    check(
      /\d+ m²/.test(row.text),
      `${row.code}'s row states the size`,
      row.text.replace(/\n/g, " | "),
    );
    // Occupancy · size · aspect. The Junior Suite's aspect carries a dot of its
    // own, so three is the floor rather than the count.
    check(
      row.text.split("·").length >= 3,
      `${row.code}'s row states the aspect`,
      row.text.replace(/\n/g, " | "),
    );
    check(
      /a night/.test(row.text),
      `${row.code}'s row prices per night, for comparing`,
      row.text.replace(/\n/g, " | "),
    );

    const count = countWords(row.text);
    check(
      count <= ROW_WORD_CEILING,
      `${row.code}'s row is ${ROW_WORD_CEILING} words or fewer`,
      `${count}: ${row.text.replace(/\n/g, " | ")}`,
    );
  }

  // ---- One room selected, always, and never two ---------------------------

  // The room is the ground of the screen and it is never empty, so the list
  // opens with a room already on it. The first row is the smallest and the
  // cheapest, which is the only default that cannot be read as the screen
  // selling to the guest.
  const opening = await page.evaluate(() => {
    const picks = [...document.querySelectorAll("[data-room-pick]")];
    const stage = document.querySelector("[data-room-stage]");
    return {
      picks: picks.length,
      checked: picks.filter((pick) => pick.checked).map((pick) => pick.value),
      firstIsChecked: picks[0]?.checked === true,
      staged: stage?.dataset.roomStage ?? null,
      ground:
        document.querySelector("[data-room-ground]")?.dataset.roomGround ??
        null,
      name: stage?.getAttribute("name") ?? null,
      group: new Set(picks.map((pick) => pick.name)).size,
    };
  });

  check(opening.picks === 5, "every row is one control", opening.picks);
  check(
    opening.group === 1,
    "the five share one radio group, so exactly one can be picked",
    opening.group,
  );
  check(
    opening.checked.length === 1,
    "exactly one room is selected",
    opening.checked.join(", "),
  );
  check(opening.firstIsChecked, "the list opens on the first room");
  check(
    opening.staged === opening.checked[0],
    "the stage shows the room the list has selected",
    `${opening.staged} against ${opening.checked[0]}`,
  );
  // The photograph and the plate stating it are separate elements now — one is
  // the ground of the window, the other a box in its corner — so "they are the
  // same room" stopped being true by construction and has to be asserted. A
  // screen showing the Superior's price over a photograph of the Suite is the
  // worst defect this composition can produce and the hardest to see.
  check(
    opening.ground === opening.checked[0],
    "and so does the photograph behind it",
    `${opening.ground} against ${opening.checked[0]}`,
  );

  // ---- The gallery --------------------------------------------------------

  // The thing `View details` was pressed for, with nothing to press for it. The
  // counter is honest about the set: a room with one frame would draw "1 / 1"
  // over two arrows that go nowhere, and `room-images.spec.ts` is what stops
  // that set existing at all.
  // **The frames live under `[data-room-ground]`, not `[data-room-stage]`.**
  // The photograph is the ground of the whole step now — edge to edge, behind
  // the list as well as behind the room's own plates — so it is no longer inside
  // the box that states the room. The two are asserted to agree on which room
  // they are showing further down; here the ground is queried directly.
  const gallery = await page.evaluate(() => {
    const img = document.querySelector("[data-room-ground] img");
    return {
      count: document.querySelector("[data-frame-count]")?.innerText ?? "",
      alt: img?.alt ?? "",
      src: img?.currentSrc || img?.src || "",
      hidden:
        document
          .querySelector("[data-frame-count]")
          ?.getAttribute("aria-hidden") === "true",
    };
  });

  const total = Number(gallery.count.split("/")[1]);
  check(
    /^1 \/ \d+$/.test(gallery.count),
    "the gallery opens on the first frame",
    gallery.count,
  );
  check(total > 1, "the room has more than one photograph", gallery.count);
  check(
    gallery.hidden,
    "the counter is the picture's own, so it is aria-hidden",
  );
  // Content, so meaningful alt — never "". This is the description the thumbnail
  // gave up.
  check(
    gallery.alt.trim().length > 0,
    "the frame on the stage carries a description",
  );

  await page.locator("[data-frame-next]").click();
  await page.waitForFunction(
    () => !/^1 \//.test(document.querySelector("[data-frame-count]").innerText),
  );
  await page.waitForTimeout(600);

  const walked = await page.evaluate(() => {
    const img = document.querySelector("[data-room-ground] img");
    return {
      count: document.querySelector("[data-frame-count]").innerText,
      src: img?.currentSrc || img?.src || "",
      images: document.querySelectorAll("[data-room-ground] img").length,
    };
  });
  check(walked.count === `2 / ${total}`, "the counter advances", walked.count);
  check(
    walked.src !== gallery.src,
    "and so does the photograph",
    `${gallery.src} -> ${walked.src}`,
  );
  // The cross-fade is over by now. Two frames in the layer is correct mid-
  // dissolve and a leak afterwards.
  check(
    walked.images === 1,
    "the outgoing frame is gone once the dissolve is done",
    walked.images,
  );
  console.log(`  gallery ${walked.count}`);

  // ---- The peek -----------------------------------------------------------

  // Reaching for the arrows is answered by giving the photograph: the list rail
  // and the room's plates get out of the way while the pointer is on the gallery
  // control, and come back the moment it leaves.
  //
  // **Only where the photograph is the ground.** Below the stack width the
  // picture is a band at the top of a scrolling page and there is nothing laid
  // over it to lift, so the rule does not apply and neither does this check.
  const peekable = viewport.width >= 1248;

  // `visibility`, not just `opacity` — two invisible plates that still take
  // every press and every tab stop across two thirds of the window is the defect
  // the property was added for, and opacity alone would pass a check written
  // against opacity.
  const peekState = () =>
    page.evaluate(() => {
      const read = (el) =>
        el === null
          ? null
          : {
              opacity: Number(getComputedStyle(el).opacity),
              visible: getComputedStyle(el).visibility === "visible",
            };
      return {
        stage: read(document.querySelector("[data-room-stage]")?.parentElement),
        rail: read(
          document.querySelector('[data-view="rooms"]')?.closest("section")
            ?.parentElement?.parentElement?.parentElement,
        ),
        nav: read(document.querySelector("header")),
        walk: read(document.querySelector("[data-room-walk]")),
      };
    });

  if (peekable) {
    await page.locator("[data-room-walk]").hover();
    await page.waitForTimeout(700);
    const peeking = await peekState();

    check(
      peeking.stage?.visible === false && peeking.stage?.opacity === 0,
      "hovering the gallery hides the room's plates",
      JSON.stringify(peeking.stage),
    );
    // The bar is the way out of the funnel, and a way out that disappears when
    // the mouse moves is not one.
    check(
      peeking.nav?.visible === true && peeking.nav?.opacity === 1,
      "the bar stays while the guest looks at the room",
      JSON.stringify(peeking.nav),
    );
    // A control that vanishes under the cursor that summoned it takes the next
    // press with it, and the peek would end the instant it began.
    check(
      peeking.walk?.visible === true && peeking.walk?.opacity === 1,
      "and so does the control being pointed at",
      JSON.stringify(peeking.walk),
    );

    // Still usable while hidden: walking the gallery is the whole reason the
    // guest is over there.
    const at = await page.evaluate(
      () => document.querySelector("[data-frame-count]").innerText,
    );
    await page.locator("[data-frame-next]").click();
    await page.waitForTimeout(700);
    check(
      (await page.evaluate(
        () => document.querySelector("[data-frame-count]").innerText,
      )) !== at,
      "the arrows still walk the gallery while the plates are out of the way",
    );
  }

  // **Off the control, whether or not the peek was checked**, and this is a
  // requirement rather than test housekeeping. Clicking an arrow leaves focus on
  // it, and a peek keyed to `:focus-within` would stay open with nothing
  // hovering anything — a screen stuck with two thirds of itself invisible and
  // no way back but a click elsewhere. `booking-screen.module.css` keys it to
  // `:focus-visible` instead, which is the keyboard's focus and not the
  // pointer's; the restore asserted below is what proves it.
  await page.mouse.move(Math.round(viewport.width / 2), 4);
  await page.waitForTimeout(700);

  if (peekable) {
    const rested = await peekState();
    check(
      rested.stage?.visible === true && rested.stage?.opacity === 1,
      "the plates come back when the pointer leaves, after a press and not only a hover",
      JSON.stringify(rested.stage),
    );
  }

  // ---- The room's detail ---------------------------------------------------

  // **Nothing on this plate is behind a press, and this is where that is
  // enforced.** The facts were a `<details>`: a strip of two or three unlabelled
  // glyphs, and `View detail` to spell them. What that produced was the widest
  // plate on the screen holding a name, one clause and four fifths empty ivory,
  // which is what the disclosure was really hiding. So the four facts are open,
  // the twelve lines that are in every room are open, and the only press left on
  // the step is `Continue`.
  //
  // The count is exact rather than a floor. Every type has these four — occupancy,
  // size, bed, outlook — and the reason to assert four rather than "some" is the
  // failure this replaced: the traced icon set has no courtyard and no corner, so
  // the old strip silently dropped the outlook for two of the five types and the
  // Superior, which every guest lands on first, drew two marks in a box sized for
  // four. A grid that changes width by room is the defect; the number is the test.
  const facts = await page.evaluate(() => ({
    terms: [...document.querySelectorAll("[data-room-stage] dt")].map((t) =>
      t.innerText.trim(),
    ),
    values: [...document.querySelectorAll("[data-room-stage] dd")].map((d) =>
      d.innerText.trim(),
    ),
    icons: document.querySelectorAll(
      "[data-room-stage] dl [style*='--fact-icon']",
    ).length,
  }));

  check(
    facts.terms.length === 4,
    "the room states four facts, open, on every type",
    facts.terms.join(", "),
  );
  check(
    facts.values.every((value) => value.length > 0),
    "and every one of them has a value",
    facts.values.join(" | "),
  );
  // A glyph per fact, so the grid cannot come out four terms wide and two marks
  // wide — which is exactly what the strip did before it was opened.
  check(
    facts.icons === facts.terms.length,
    "every fact carries its own mark",
    `${facts.icons} marks against ${facts.terms.length} facts`,
  );

  check(
    (await page.locator("[data-stage-detail]").count()) === 0,
    "nothing on the plate is behind a disclosure any more",
  );

  // What is in every room, printed rather than sold. The register is the whole
  // argument for the list existing again (`room-types.ts`), and the two things
  // that would undo it are a heading over it and a control in it.
  const amenities = await page.evaluate(() => {
    const list = document.querySelector("[data-room-stage] ul");
    return {
      items: list ? list.querySelectorAll("li").length : 0,
      controls: list
        ? list.querySelectorAll("button, a, img, input, [role=button]").length
        : 0,
      headings: document.querySelectorAll(
        "[data-room-stage] h1, [data-room-stage] h3, [data-room-stage] h4",
      ).length,
    };
  });
  check(
    amenities.items === 12,
    "every room lists twelve lines",
    amenities.items,
  );
  check(
    amenities.controls === 0,
    "and none of them is a control",
    amenities.controls,
  );
  check(
    amenities.headings === 0,
    "and nothing on the plate heads them as features",
    amenities.headings,
  );

  // ---- Choosing another room ----------------------------------------------

  // Selecting is the whole interaction: there is no second press to commit, and
  // the room a guest walked to its second frame must not carry that index into
  // the next room's gallery.
  const third = rows[2].code;
  await page.locator(`[data-room-row="${third}"] label`).click();
  await page.waitForFunction(
    (code) =>
      document.querySelector("[data-room-stage]")?.dataset.roomStage === code,
    third,
  );
  await page.waitForTimeout(600);

  const swapped = await page.evaluate(() => {
    const picks = [...document.querySelectorAll("[data-room-pick]")];
    return {
      checked: picks.filter((pick) => pick.checked).map((pick) => pick.value),
      staged: document.querySelector("[data-room-stage]").dataset.roomStage,
      ground: document.querySelector("[data-room-ground]").dataset.roomGround,
      count: document.querySelector("[data-frame-count]").innerText,
    };
  });
  check(
    swapped.checked.length === 1 && swapped.checked[0] === third,
    "picking a room leaves exactly that one picked",
    swapped.checked.join(", "),
  );
  check(swapped.staged === third, "and the stage follows it", swapped.staged);
  check(
    swapped.ground === third,
    "and the photograph behind it follows too",
    swapped.ground,
  );
  check(
    /^1 \//.test(swapped.count),
    "a new room opens on its own lead, not the last room's index",
    swapped.count,
  );

  // ---- What the screen says at rest ---------------------------------------

  // **The budget is on everything, because nothing is behind a press.** Round 3
  // subtracted five shut panels from this count; there are none to subtract, and
  // the dialog that held the rest of the words does not exist.
  //
  // The concierge block is counted with them. It sits outside `[data-view]`
  // because it is pinned below the list's scroll rather than inside it, and a
  // budget that stopped at the scroll container would be a budget any new prose
  // could be moved out of.
  const words = await page.evaluate(() => {
    const text = (selector) =>
      document.querySelector(selector)?.innerText ?? "";
    return [
      text('[data-view="rooms"]'),
      text("[data-room-stage]"),
      text("[data-concierge]"),
    ].join("\n");
  });
  const resting = countWords(words);
  check(
    resting <= SCREEN_WORD_CEILING,
    `the room step is ${SCREEN_WORD_CEILING} words or fewer`,
    resting,
  );
  console.log(
    `  ${resting} words on the room step; ` +
      `${Math.max(...rows.map((row) => countWords(row.text)))} on the wordiest row`,
  );

  // ---- The controls the guest actually taps -------------------------------

  const taps = await page.evaluate(() => {
    const height = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.getBoundingClientRect().height : 0;
    };
    return {
      row: height("[data-room-row] label"),
      continue: height("[data-stage-continue]"),
      summary: height("[data-date-summary]"),
      arrow: height("[data-frame-next]"),
    };
  });
  check(taps.row >= TAP_FLOOR, "a room row clears the tap floor", taps.row);
  check(
    taps.continue >= TAP_FLOOR,
    "Continue clears the tap floor",
    taps.continue,
  );
  check(
    taps.summary >= TAP_FLOOR,
    "the date summary clears the tap floor",
    taps.summary,
  );
  check(
    taps.arrow >= ARROW_FLOOR,
    "the gallery arrows clear the standard floor",
    taps.arrow,
  );

  // ---- Changing the dates and coming back --------------------------------

  // The single requirement most likely to ship subtly broken, driven exactly the
  // way a guest drives it. Where the guest was only exists to be restored below
  // the width at which the step is pinned to the window — above it the page does
  // not scroll at all, which the check further up asserts outright.
  const scrolls = viewport.width < 1248;
  if (scrolls) {
    const bottom = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return window.scrollY;
    });
    check(bottom > 0, "the stacked room step is long enough to scroll", bottom);
  }

  // **Where the guest was is read at the press, not before it**, and that is the
  // difference between measuring the requirement and measuring the browser.
  //
  // The summary is a sticky control. Pressing one makes the browser scroll its
  // *layout* box into view, which on a pinned element is a few pixels above where
  // it is painted — so the page moves by the sticky offset between the last
  // assertion and the handler that records the offset. `booking-screen.tsx` reads
  // `window.scrollY` inside the press, so that nudged number is what it stores
  // and what the guest is genuinely looking at when the list unmounts. Comparing
  // the restore against a figure taken a moment earlier fails a screen that put
  // the guest back exactly where it left them.
  await page.evaluate(() => {
    document.querySelector("[data-date-summary]").addEventListener(
      "pointerdown",
      () => {
        window.__leftAt = window.scrollY;
      },
      { capture: true, once: true },
    );
  });

  await page.locator("[data-date-summary]").click();
  await page.waitForSelector('[data-view="when"]');
  const wanted = await page.evaluate(() => window.__leftAt ?? 0);
  check(
    (await page.locator("[data-room-row]").count()) === 0,
    "changing the dates unmounts the room list",
  );

  // Forward again, with the same nights.
  //
  // **One press, because going back keeps the range.** That is what `step` in the
  // URL bought: the guest lands on the calendar with their own stay still
  // selected and stated back beside it, so a guest who only wanted a second look
  // at the rooms presses Continue and is where they were. Re-selecting a range
  // from scratch is `stay-calendar.tsx`' own behaviour and belongs to the dates
  // step's checks, not to a round trip through this one.
  await page.locator("[data-continue]").click();
  await page.waitForSelector('[data-view="rooms"]');

  if (scrolls) {
    const restored = await page.evaluate(() => window.scrollY);
    check(
      Math.abs(restored - wanted) <= 4,
      "the list comes back where the guest left it",
      `${restored} against ${wanted}`,
    );
  }

  // The room survives the round trip, because nothing about it changed. A guest
  // who went back to read their dates and came straight forward again did not
  // un-choose anything, and a list that had quietly reset to its first row would
  // be the screen forgetting a decision the guest still holds. The reset that
  // *does* exist is on a new quote — a different range or a different party
  // re-prices every room, and `booking-screen.tsx` clears the pick there.
  check(
    await page.evaluate(
      (code) =>
        [...document.querySelectorAll("[data-room-pick]")].find(
          (pick) => pick.checked,
        )?.value === code,
      third,
    ),
    "the room is still picked after a look at the dates and back",
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
  await page.locator("[data-continue]").click();

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
