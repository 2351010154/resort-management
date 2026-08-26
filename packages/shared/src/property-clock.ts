// When the property opens a room and when it wants it back —
// `property-and-tariff.md` §2's operating clock.
//
// Two strings that no code path decides anything by, which is what makes them
// constants rather than configuration. Early arrival is
// `BOOKING_EARLY_CHECK_IN_ENABLED`, §4's arrival window is a comparison of
// business dates, and the night audit runs at a rollover that *is* configured.
// Nothing here is read by any of them: these are the published times the desk
// honours, and the only thing either is ever used for is printing.
//
// **Here rather than beside the address in `guest-auth-emails.ts`, which is
// where the check-in time used to live alone.** It stopped being one realm's
// fact the moment the booking funnel had to print it too: the review screen
// states both times on the stay it is reading back, and `design-foundations.md`
// §6 forbids a component inventing a hotel fact — a "14:00" typed into a
// stylesheet's neighbour in `apps/web` would be exactly that, and it would be
// the copy that did not move on the day the property changed its clock. The API
// still exports `CHECK_IN_TIME` from that module, because the templates that
// print it should not have to know it moved; it re-exports this.
//
// 24-hour, and stated as the property states them. The site is one locale and
// the desk writes them this way on the door.

/** When a room is opened to an arriving guest. */
export const CHECK_IN_TIME = "14:00";

/** When the property asks for it back. */
export const CHECK_OUT_TIME = "12:00";
