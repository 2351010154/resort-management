// The photograph the dates step opens on.
//
// One frame, held here rather than in the component, for the same reason
// `room-images.ts` holds the five leads: the tier list, the intrinsic size and
// the alt are facts about a *file*, and a component that carried them would have
// to be edited every time the file was re-exported.
//
// **It is deliberately not one of the five room leads.** The guest is being
// asked when they are coming, not which room they want, and a photograph of the
// Junior Suite over that question is an answer to the next one. So the hero is
// the property itself — cut from the same shoot as the leads (one terracotta
// courtyard property, one photographer, one day, see `room-images.ts`) from a
// frame none of the five uses, so the screen holds one palette without showing
// anything a guest could mistake for a room they had chosen.
//
// **Encoded at 2:1 rather than the master's 4:3.** The band is a wide window and
// `object-fit: cover` would throw away half of a 4:3 file at every tier — which
// is bytes a guest pays for and never sees. The crop is taken from the master's
// middle third, where the door, the loungers and the pool edge are.

/** Available widths; swap the trailing `-<w>.webp` to pick one. */
export const HERO_TIERS = [1920, 1280, 640] as const;

export const BOOKING_HERO = {
  /** Path of the largest tier, under `public/`. */
  src: "/images/booking/hero/court-dusk-1920.webp",
  width: 1920,
  height: 960,
  tiers: HERO_TIERS,
  // Meaningful rather than "". The band is the only photograph on this step and
  // it is what the property looks like — which is a thing a guest choosing a
  // week of their year is entitled to, whether or not they can see it.
  alt: "The property at dusk: loungers along a pool, and an open door into the court.",
} as const;
