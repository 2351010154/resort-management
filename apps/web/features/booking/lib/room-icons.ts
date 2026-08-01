// Which aspect words the icon set can draw, and which it cannot.
//
// The panel marks each of its rows with one glyph. Three of them — the floor
// area, the bed, the extra bed — are the same on every room, so they are bound
// to their rows in `room-type-list.module.css` and never come through here. The
// aspect is the one that varies, and it is the one the set only half covers.
//
// **`null` is an answer, not a gap to be filled.** The library has a sea, a
// garden and a city outlook. It has nothing for a courtyard and nothing for a
// corner with two aspects, and the nearest candidates — a terrace with a plant,
// a plain window — say something the property has not said.
// `design-foundations.md` §6 forbids a component inventing a hotel fact, and a
// guest who books "courtyard" on the strength of a picture of a terrace has been
// told something untrue by a stylesheet. So those two rows carry the word alone.
//
// **Keyed by the exact aspect string, so a new one is bare rather than wrong.**
// A prefix or keyword match would quietly give "city" to a "city, no view" the
// day someone writes it. An exact lookup fails closed, which is the only
// direction this may fail in: a missing glyph costs a guest nothing, and a wrong
// one costs them the room they thought they were booking.
//
// `property-and-tariff.md` §1 is the authority for the aspect words themselves,
// via `room-types.ts`. Nothing here invents one; this file only decides whether
// the set has a picture of it.

// **What changed: the glyph stopped being the only thing saying which aspect it
// is.** The rule above was written for a shut strip of unlabelled marks, where a
// picture of a terrace beside nothing *was* the claim — so a set with no
// courtyard had to draw nothing rather than draw something near. The facts are
// printed open now, each glyph beside the word it marks: "COURTYARD", spelled,
// with "View" under it. A mark in that position cannot make a claim of its own,
// because the claim is the word next to it.
//
// So a room the set has no picture of gets `view` — a window with a horizon in
// it, which says "this row is the outlook" and says nothing about what is out
// there. That is a category mark, not a fact, and it is the honest way to fill a
// grid that would otherwise have a hole in it for two of the five types.
//
// The specific glyphs stay where they are real: a sea, a garden and a city are
// pictures of those three aspects and are better than the generic one. The map
// is still exact rather than prefix-matched, so a new aspect word falls to the
// neutral mark instead of inheriting a picture that lies about it — the same
// fail-closed direction as before, with a floor under it.

/** Slug of a traced SVG under `public/images/booking/icons/aspect-<slug>.svg`. */
export type AspectIcon = "sea" | "garden" | "city";

const BY_ASPECT = new Map<string, AspectIcon>([
  ["sea", "sea"],
  ["garden", "garden"],
  ["city", "city"],
]);

/** The glyph for an aspect word, or `null` where the set has no picture of it. */
export function aspectIcon(aspect: string): AspectIcon | null {
  return BY_ASPECT.get(aspect) ?? null;
}

/**
 * The icon slug to mark the outlook row with — specific where the set has a
 * picture, neutral where it does not. Never `null`: the row is always drawn,
 * because the word beside the mark is what carries the fact.
 */
export function aspectMark(aspect: string): string {
  const icon = aspectIcon(aspect);
  return icon === null ? "view" : `aspect-${icon}`;
}
