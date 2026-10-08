// The light the house is in right now, for the account's stone to be lit by.
//
// The account's limestone is lit the way the property's own walls are lit at
// this moment: the guest reading their profile at midnight in Lisbon sees the
// afternoon sun on the stone in Nha Trang. Nothing on the page says so in
// words — the wall simply is in that light, the way a window is.
//
// **The property's clock, never the browser's.** The same rule
// `stay-history.ts` keeps for dates: a guest abroad must see the house's hour,
// so it is read in `PROPERTY_TIME_ZONE` whatever zone the runtime is in.
//
// **Four lights, cut at the town's own day.** Nha Trang sits at 12° north, so
// its sunrise moves only between about 05:25 and 06:05 across the year and its
// sunset between 17:15 and 17:55 — four fixed boundaries are true all year to
// within half an hour, and an astronomical calculation would buy a precision no
// one reading a wall can see. The boundaries are an estimate, rounded to the
// half hour: first light, the sun high enough to shorten every shadow, the low
// sun before dusk, and the lamps after it.

import { PROPERTY_TIME_ZONE } from "@mariva/shared";

/** What the wall is lit by. Also the value the stylesheets key the light on. */
export type HouseLight = "morning" | "daylight" | "golden" | "lamplight";

/**
 * Where each light begins, in minutes after midnight, in the order of a day.
 * Before the first boundary it is still the previous night's lamplight.
 */
const BEGINS: readonly (readonly [number, HouseLight])[] = [
  [5 * 60 + 30, "morning"],
  [9 * 60, "daylight"],
  [15 * 60 + 30, "golden"],
  [18 * 60, "lamplight"],
];

/**
 * The property's hour and minute.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, which some engines answer
 * with "24" at midnight; the numbers are read out of the parts, so no engine's
 * separator matters.
 */
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: PROPERTY_TIME_ZONE,
});

/** The light on the wall at a minute of the property's day. */
export function lightAt(minuteOfDay: number): HouseLight {
  let light: HouseLight = "lamplight";

  for (const [begins, name] of BEGINS) {
    if (minuteOfDay >= begins) {
      light = name;
    }
  }

  return light;
}

/** The light the house is in at an instant. */
export function houseLight(now: Date): HouseLight {
  const parts = CLOCK.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );

  return lightAt(hour * 60 + minute);
}
