// The two collaborators a confirmation is composed by, for the suites that
// must never compose one.
//
// A sweep, a check-in, a stay-length calculation and a folio close all reach
// `BookingService` on paths that make no `HELD → CONFIRMED` transition, so
// neither of these is called. What each file used to pass was
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
import type { BookingConfirmationService } from "../src/modules/notification/booking-confirmation.service.js";

/** The one thing either stub does, and it says why rather than what. */
function refuse(call: string): never {
  throw new Error(
    `${call} was reached from a suite that drives no HELD → CONFIRMED ` +
      "transition, so it should never announce anything. Either a path started " +
      "announcing a stay, or this suite now needs a real confirmation.",
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

/** Mints no mailed link, and says so by name if anything asks it to. */
export const noStayLinks = links as BookingTokenService;

/** Composes no confirmation, and says so by name if anything asks it to. */
export const noConfirmations = confirmations as BookingConfirmationService;
