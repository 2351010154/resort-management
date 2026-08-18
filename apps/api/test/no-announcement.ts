// The collaborators a booking's mail is composed by, for the suites that must
// never compose one.
//
// A sweep, a check-in, a stay-length calculation and a folio close all reach
// `BookingService` on paths that make no `HELD → CONFIRMED` transition and
// announce no cancellation, so none of these is called. What each file used to
// pass was
// `undefined as unknown as BookingTokenService`, which said the same thing and
// said it to nobody: the cast switched off checking at exactly the seam that
// had just moved, and the day a path did start announcing, the failure was
// `Cannot read properties of undefined (reading 'mintStayLink')` from inside a
// sweep rather than a sentence naming what had changed.
//
// These are typed through `Pick`, so the method names and their signatures are
// still checked against the real classes — a rename that leaves this file
// behind is a compile error rather than a runtime one. The widening that
// follows is to the class itself, which is as far as it can go: `BookingService`
// takes the concrete types, and a class with private members has no structural
// stand-in.

import type { BookingTokenService } from "../src/modules/auth/booking-token/booking-token.service.js";
import type { BookingCancellationService } from "../src/modules/notification/booking-cancellation.service.js";
import type { BookingConfirmationService } from "../src/modules/notification/booking-confirmation.service.js";

/** The one thing every stub here does, and it says why rather than what. */
function refuse(call: string): never {
  throw new Error(
    `${call} was reached from a suite that writes to no guest: it drives no ` +
      "HELD → CONFIRMED transition and cancels no stay that was confirmed and " +
      "named somebody to write to. Either a path started announcing, or this " +
      "suite now needs the real message.",
  );
}

const links: Pick<BookingTokenService, "mintStayLink" | "mintAccountLink"> = {
  mintStayLink: () => refuse("BookingTokenService.mintStayLink"),
  mintAccountLink: () => refuse("BookingTokenService.mintAccountLink"),
};

const confirmations: Pick<BookingConfirmationService, "send" | "enqueue"> = {
  send: () => refuse("BookingConfirmationService.send"),
  enqueue: () => refuse("BookingConfirmationService.enqueue"),
};

/**
 * The third message a `BookingService` is built with, for the suites that must
 * never send one.
 *
 * A cancellation is announced only for a stay that had reached `CONFIRMED` and
 * that names somebody to write to — `booking.service.ts` argues both gates — so
 * the suites here cancel freely and reach this only if one of those gates moved.
 * That is exactly the change worth a sentence rather than a `TypeError`.
 */
const cancellations: Pick<BookingCancellationService, "enqueue"> = {
  enqueue: () => refuse("BookingCancellationService.enqueue"),
};

/** Mints no mailed link, and says so by name if anything asks it to. */
export const noStayLinks = links as BookingTokenService;

/** Composes no confirmation, and says so by name if anything asks it to. */
export const noConfirmations = confirmations as BookingConfirmationService;

/** Composes no cancellation, and says so by name if anything asks it to. */
export const noCancellations = cancellations as BookingCancellationService;
