// Reducing a confirmation to what a job row may hold, and putting it back.
//
// One property carries the file: a mailed booking link's signature exists in no
// table, so whatever the queue stores must be enough to rebuild the message
// exactly and must not be enough to spend it. Both halves are asserted here
// against a real `BookingTokenService`, because a stand-in signer would agree
// with itself and prove neither.

import "reflect-metadata";

import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import {
  composeQueuedConfirmation,
  QUEUED_CONFIRMATION,
  queuedConfirmation,
  readQueuedConfirmation,
} from "./queued-confirmation.js";
import {
  bookingConfirmation,
  type BookingConfirmationEmailParams,
} from "./templates/booking-confirmation-email.js";

const SECRET = "a-secret-at-least-thirty-two-characters-long";

const links = new BookingTokenService({
  BETTER_AUTH_SECRET: SECRET,
  NODE_ENV: "test",
} as Env);

const STAY_LINK_ROW = "6b1f2c94-0d3a-4f57-9c21-8ac0e5f7b912";
const ACCOUNT_LINK_ROW = "0e4a77d2-51bb-4c8e-9f30-2d6c1a9e4471";

const REFERENCE = "MRV-20270510-0001";

/** The message as `booking.service.ts` hands it over: two absolute addresses,
 *  each carrying its credential in the fragment. */
function aConfirmation(): BookingConfirmationEmailParams {
  return {
    to: "khach@example.test",
    guestName: "Nguyễn An",
    reference: REFERENCE,
    stayUrl: `https://mariva.test/bookings/${REFERENCE}#stay=${encodeURIComponent(
      links.signLink(STAY_LINK_ROW),
    )}`,
    createAccountUrl: `https://mariva.test/bookings/${REFERENCE}/account#invitation=${encodeURIComponent(
      links.signLink(ACCOUNT_LINK_ROW),
    )}`,
  };
}

describe("what a confirmation reduces to", () => {
  it("keeps the row ids and drops both signatures", () => {
    const mail = aConfirmation();
    const job = queuedConfirmation(mail, links);
    const stored = JSON.stringify(job);

    expect(job.stay.linkId).toBe(STAY_LINK_ROW);
    expect(job.account?.linkId).toBe(ACCOUNT_LINK_ROW);

    expect(stored).not.toContain(links.signLink(STAY_LINK_ROW));
    expect(stored).not.toContain(links.signLink(ACCOUNT_LINK_ROW));
  });

  it("keeps enough of the address to land the guest on the right page", () => {
    const job = queuedConfirmation(aConfirmation(), links);

    expect(job.stay.url).toBe(`https://mariva.test/bookings/${REFERENCE}#stay=`);
    expect(job.account?.url).toBe(
      `https://mariva.test/bookings/${REFERENCE}/account#invitation=`,
    );
  });

  it("says there is no account link when the address already had an account", () => {
    const mail = { ...aConfirmation(), createAccountUrl: undefined };

    expect(queuedConfirmation(mail, links).account).toBeNull();
  });

  it("refuses a link whose credential is not in a fragment parameter", () => {
    const mail = {
      ...aConfirmation(),
      stayUrl: `https://mariva.test/bookings/${REFERENCE}`,
    };

    // Refusing is what sends the message from this process instead. Storing it
    // would put the only copy of a seven-day stay credential in the job table.
    expect(() => queuedConfirmation(mail, links)).toThrow(/fragment parameter/);
  });

  it("refuses a credential this deployment did not sign", () => {
    const mail = {
      ...aConfirmation(),
      stayUrl: `https://mariva.test/bookings/${REFERENCE}#stay=not-a-token`,
    };

    expect(() => queuedConfirmation(mail, links)).toThrow(/not signed/);
  });

  it("quotes neither the address nor the credential when it refuses", () => {
    const mail = {
      ...aConfirmation(),
      stayUrl: `https://mariva.test/bookings/${REFERENCE}#stay=not-a-token`,
    };

    try {
      queuedConfirmation(mail, links);
      expect.unreachable("the reduction should have refused");
    } catch (error) {
      // A refusal is logged, and a log is read by more people, for longer, than
      // the mailbox the link was addressed to.
      expect((error as Error).message).not.toContain("#stay=");
    }
  });
});

describe("what the worker composes from it", () => {
  it("is the message the composing process would have sent, whole", () => {
    const mail = aConfirmation();
    const job = queuedConfirmation(mail, links);

    expect(composeQueuedConfirmation(job, links)).toEqual(
      bookingConfirmation(mail),
    );
  });

  it("is the same after a round trip through JSON, which is what the queue is", () => {
    const mail = aConfirmation();
    const stored: unknown = JSON.parse(
      JSON.stringify(queuedConfirmation(mail, links)),
    );

    const read = readQueuedConfirmation(stored);

    expect(read).not.toBeNull();
    expect(composeQueuedConfirmation(read!, links)).toEqual(
      bookingConfirmation(mail),
    );
  });

  it("carries the account link only when the facts do", () => {
    const mail = { ...aConfirmation(), createAccountUrl: undefined };
    const job = queuedConfirmation(mail, links);
    const composed = composeQueuedConfirmation(job, links);

    expect(composed.text).not.toContain("invitation=");
    expect(composed.html).not.toContain("invitation=");
  });

  it("cannot be composed under a different secret", () => {
    const elsewhere = new BookingTokenService({
      BETTER_AUTH_SECRET: "a-different-secret-of-at-least-thirty-two",
      NODE_ENV: "test",
    } as Env);

    const job = queuedConfirmation(aConfirmation(), links);

    // The job row is not the credential. Rotating the realm's secret orphans
    // whatever is still queued rather than handing it out, which is the point:
    // what is stored opens nothing on its own.
    expect(composeQueuedConfirmation(job, elsewhere).text).not.toContain(
      links.signLink(STAY_LINK_ROW),
    );
  });
});

describe("reading a payload off the queue", () => {
  it("passes over a payload that is an ordinary message", () => {
    expect(
      readQueuedConfirmation({
        to: "khach@example.test",
        subject: "Confirm your email",
        text: "…",
        html: "…",
      }),
    ).toBeNull();
  });

  it("refuses one that claims the kind and then has holes in it", () => {
    expect(() =>
      readQueuedConfirmation({ kind: QUEUED_CONFIRMATION, to: "x@y.test" }),
    ).toThrow(/queued confirmation/i);
  });

  it("refuses one whose link is an address with no row id", () => {
    expect(() =>
      readQueuedConfirmation({
        kind: QUEUED_CONFIRMATION,
        to: "khach@example.test",
        guestName: "Nguyễn An",
        reference: REFERENCE,
        stay: { url: "https://mariva.test/bookings/x#stay=" },
        account: null,
      }),
    ).toThrow(/queued confirmation/i);
  });
});
