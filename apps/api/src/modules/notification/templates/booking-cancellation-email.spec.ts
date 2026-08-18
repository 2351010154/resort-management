// The bodies a cancelled booking produces, and the figures they must state
// exactly.
//
// Two things are being held here. The first is that the two amounts the caller
// hands over reach the guest unchanged and in both bodies: a mail that printed
// the penalty and dropped the refund, or printed one of them in the HTML only, is
// a guest who believes the property kept money it is sending back. The second is
// that a penalty of nothing is said in words rather than shown as a zero on a
// line labelled "charge" — the two cases that produce it, §4's free window and a
// manager's waiver, are both good news.
//
// The escaping cases are the confirmation's and for the same reason: a contact
// name arrives from an unauthenticated hold, so the template is the last thing
// between a payload and a mail client.

import { describe, expect, it } from "vitest";
import { bookingCancellation } from "./booking-cancellation-email.js";

const CANCELLATION = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  reason: "GUEST_REQUEST",
  penalty: 0n,
  refund: null,
} as const;

describe("a cancellation that cost the guest a night", () => {
  const email = bookingCancellation({
    ...CANCELLATION,
    penalty: 1_850_000n,
    refund: 3_700_000n,
  });

  it("states the charge in both bodies", () => {
    // The grouped form the property quotes prices in, not the raw integer.
    expect(email.text).toContain("1.850.000");
    expect(email.html).toContain("1.850.000");
  });

  it("states the refund in both bodies", () => {
    expect(email.text).toContain("3.700.000");
    expect(email.html).toContain("3.700.000");
  });

  it("does not claim there was no charge", () => {
    expect(email.text).not.toContain("no cancellation charge");
    expect(email.html).not.toContain("no cancellation charge");
  });
});

describe("a cancellation that cost the guest nothing", () => {
  const email = bookingCancellation({ ...CANCELLATION, refund: 2_000_000n });

  it("says so in words rather than printing a zero", () => {
    expect(email.text).toContain("no cancellation charge");
    expect(email.html).toContain("no cancellation charge");
    expect(email.text).not.toContain("Cancellation charge:");
  });

  it("still states the refund, which is what a waiver means in money", () => {
    expect(email.text).toContain("2.000.000");
    expect(email.html).toContain("2.000.000");
  });
});

describe("a cancellation with nothing to hand back", () => {
  const email = bookingCancellation({ ...CANCELLATION, penalty: 500_000n });

  it("promises no refund at all", () => {
    // Absent rather than zero: a stay that paid nothing, or one whose penalty
    // stands against the whole of what it paid. "Refund: 0 ₫" is a sentence a
    // guest reads as a mistake.
    expect(email.text).not.toContain("Refund");
    expect(email.html).not.toContain("Refund");
  });
});

describe("every cancellation", () => {
  const email = bookingCancellation(CANCELLATION);

  it("is addressed to the booking's contact and has both bodies filled", () => {
    expect(email.to).toBe(CANCELLATION.to);
    expect(email.text.trim()).not.toBe("");
    expect(email.html.trim()).not.toBe("");
  });

  it("names the reference in the subject and in both bodies", () => {
    expect(email.subject).toContain(CANCELLATION.reference);
    expect(email.text).toContain(CANCELLATION.reference);
    expect(email.html).toContain(CANCELLATION.reference);
  });

  it("greets the guest by the name on the booking", () => {
    expect(email.text).toContain(CANCELLATION.guestName);
    expect(email.html).toContain(CANCELLATION.guestName);
  });

  it("carries no link, which is why the whole message may be queued", () => {
    expect(email.text).not.toContain("http");
    expect(email.html).not.toContain("href");
  });
});

describe("why the stay ended", () => {
  it("says it in words the guest recognises, never as the record's own code", () => {
    const cases = [
      ["GUEST_REQUEST", "you asked us"],
      ["STAFF_ERROR", "booking error"],
      ["PAYMENT_FAILED", "payment"],
      ["OVERBOOK_WALK", "could not honour"],
      ["FORCE_MAJEURE", "outside anyone's control"],
    ] as const;

    for (const [reason, words] of cases) {
      const email = bookingCancellation({ ...CANCELLATION, reason });

      expect(email.text).toContain(words);
      expect(email.text).not.toContain(reason);
      expect(email.html).not.toContain(reason);
    }
  });
});

describe("a contact name that is trying to be markup", () => {
  // Nobody authenticated typed this. It arrived on an anonymous hold and was
  // carried by the booking to its cancellation.
  const payload = '<img src=x onerror="alert(1)">';
  const email = bookingCancellation({ ...CANCELLATION, guestName: payload });

  it("does not survive into the HTML in a form a client would execute", () => {
    expect(email.html).not.toContain(payload);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('onerror="');
  });

  it("is escaped in the heading and not only in the paragraphs", () => {
    expect(email.html).toContain(
      `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">Your stay is cancelled, &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1>`,
    );
  });
});
