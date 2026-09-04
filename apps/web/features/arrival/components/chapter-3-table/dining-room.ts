// What the house can honestly say about its table today.
//
// ⚑ **There is no F&B authority.** `docs/architecture/property-and-tariff.md` §1
// places the food and beverage on the ground floor and stops there: it names no
// venue, no covers, no menu and no service windows, and §2's clock is the arrival
// and departure clock, not a kitchen's. So the venue carries a descriptive label
// rather than a name somebody would have had to invent, and the service times
// below are deliberately empty.
//
// Fill `DINING_SERVICE_TIMES` when the property file gains the rows — one entry
// per service, the label the desk uses and the window it keeps. Until then the
// chapter says where the hours do reach a guest, and links to the booking that
// carries them, rather than printing a breakfast hour no one has decided.

import { PROPERTY_ADDRESS_LINES } from "@mariva/shared";
import { ROOM_COUNT_IN_WORDS } from "@/features/arrival/content/house-facts";

export interface ServiceWindow {
  /** The service, as the desk names it. */
  readonly label: string;
  /** Its window, 24-hour, as `property-and-tariff.md` states its other times. */
  readonly hours: string;
}

export const DINING_SERVICE_TIMES: readonly ServiceWindow[] = [];

/**
 * What the row says while `DINING_SERVICE_TIMES` is empty.
 *
 * The same sentence chapter 5 prints for a ritual whose hours are unpublished,
 * because it is the same fact about the same house: the windows are not set on
 * the site, and the booking is where a guest is told them.
 */
export const DINING_SERVICE_UNPUBLISHED = "Hours published at booking";

/**
 * Every fact in these three sentences is `property-and-tariff.md` §1: the ground
 * floor holds the lobby, the F&B and the back of house; the forty rooms are on
 * guest floors 2–5. Neither the count nor the street is typed here — the count
 * is `house-facts.ts` and the street is the address `@mariva/shared` prints, so
 * the table's note cannot come apart from the footer's or the mail's.
 *
 * 47 words, inside the 35–50 the chapter is composed for.
 */
export const DINING_ROOM_NOTE = `The dining room stands on the ground floor at ${PROPERTY_ADDRESS_LINES[0]}, beside the lobby, with the kitchen and the back of house behind it. It serves the ${ROOM_COUNT_IN_WORDS.toLowerCase()} rooms above it. The guest floors begin one storey up, so nobody sleeps over the service.`;
