// The refusals that happen before any SQL does.
//
// Every one of them is asserted against an executor that throws on first touch,
// because the claim is not only "this is rejected" but "this is rejected without
// a round trip". A guard paid after the insert has begun is one that depends on
// the transaction being rolled back afterwards, and the rollback is not what the
// rule is.
//
// The booking lookup is stood in for rather than mocked away in spirit: what it
// hands back — a stay in some state, or a refusal — is the only thing these two
// methods branch on, and both branches are exercised. What the real lookup does
// with an account and a `where` clause is `test/guest-own-booking.e2e-spec.ts`'s
// claim against a real Postgres, and re-asserting it here would be this file
// agreeing with a stub.
//
// Everything the service does once a stay is rateable is a statement, and is
// asserted end to end in `test/feedback.e2e-spec.ts`.

import { parseDate } from "@internationalized/date";
import type { BookingState } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import type { Booking, BookingService } from "../booking/booking.service.js";
import { FeedbackService } from "./feedback.service.js";

// Any property read off it fails the test, so "the database was not reached" is
// a fact the assertion holds rather than something the test hopes for.
const NO_DATABASE = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(
        `the refusal reached the database — it read ${String(property)}`,
      );
    },
  },
) as DbExecutor;

const ANH = { kind: "account", userId: "anh-account" } as const;

const A_STAY = { reference: "ABCD-1234", owner: ANH } as const;

/** A stay in the state under test, and otherwise unremarkable. */
function stayIn(state: BookingState): Booking {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    reference: A_STAY.reference,
    userId: ANH.userId,
    contactEmail: null,
    contactName: null,
    state,
    cancellationReason: null,
    roomType: "DELUXE",
    checkIn: parseDate("2027-06-07"),
    checkOut: parseDate("2027-06-09"),
    plan: "STANDARD",
    adults: 2,
    childAges: [],
    stayTotalGross: 2_000_000n,
    holdExpiresAt: null,
  };
}

/** A service whose booking lookup answers with this stay. */
function serving(stay: Booking): FeedbackService {
  return new FeedbackService({
    ownBooking: async () => stay,
  } as unknown as BookingService);
}

/** A service whose booking lookup refuses, the way it refuses a stay that is
 *  not the caller's and a reference nobody holds alike. */
function refusing(): FeedbackService {
  return new FeedbackService({
    ownBooking: async () => {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking of yours has that reference",
      });
    },
  } as unknown as BookingService);
}

/** The refusal a call provoked. Fails the test if the service accepted it. */
async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the service accepted a call it should have refused");
}

describe("leaving feedback on a stay", () => {
  it.each(["HELD", "CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"] as const)(
    "refuses a stay that is still %s",
    async (state) => {
      // The requirement's other half: feedback is tied to a stay that ended, so
      // a booking still running, and one that ended without anybody arriving,
      // are both refused. A conflict rather than a bad request — nothing about
      // what the guest sent is wrong, and the same body would be accepted once
      // they have left.
      const refusal = await refused(
        serving(stayIn(state)).submit(NO_DATABASE, { ...A_STAY, rating: 5 }),
      );

      expect(refusal.code).toBe("CONFLICT");
    },
  );

  it("lets the refusal for somebody else's stay stand as it was made", async () => {
    // `NOT_FOUND`, and not a conflict about a state this service never got to
    // see. Telling "not yours" from "no such stay" would hand a caller an
    // oracle over which references the property has issued, and a service that
    // caught the lookup's refusal to re-answer it would be building one.
    const refusal = await refused(
      refusing().submit(NO_DATABASE, { ...A_STAY, rating: 5 }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("reading the feedback on a stay", () => {
  it("refuses a stay that is not over, rather than answering nothing", async () => {
    // The distinction the screen is drawn from. A stay with no feedback on it
    // answers `null` and the guest is offered the form; a stay that is not
    // finished is refused, and there is nothing to offer. Folding the second
    // into the first would leave the screen unable to tell them apart without
    // reading the booking a second time.
    const refusal = await refused(
      serving(stayIn("CONFIRMED")).own(NO_DATABASE, A_STAY),
    );

    expect(refusal.code).toBe("CONFLICT");
  });

  it("lets the refusal for somebody else's stay stand as it was made", async () => {
    const refusal = await refused(refusing().own(NO_DATABASE, A_STAY));

    expect(refusal.code).toBe("NOT_FOUND");
  });
});
