// The bodies a cancelled booking produces, and the figures they must state
// exactly.
//
// Three things are being held here. The first is that the amount the caller
// hands over reaches the guest unchanged and in both bodies: a charge stated in
// the HTML only is a guest in a text client who never learns what the stay cost
// them. The second is that a penalty of nothing is said in words rather than
// shown as a zero on a line labelled "charge" — the two cases that produce it,
// §4's free window and a manager's waiver, are both good news. The third is that
// no body promises money back, whatever was charged: §4's entitlement stands,
// but returning it is a staff act taken out of band and nothing in this process
// performs one, so a refund sentence here would be an undertaking the product
// does not keep.
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
} as const;

describe("a cancellation that cost the guest a night", () => {
  const email = bookingCancellation({ ...CANCELLATION, penalty: 1_850_000n });

  it("states the charge in both bodies", () => {
    // The grouped form the property quotes prices in, not the raw integer.
    expect(email.text).toContain("1.850.000");
    expect(email.html).toContain("1.850.000");
  });

  it("does not claim there was no charge", () => {
    expect(email.text).not.toContain("no cancellation charge");
    expect(email.html).not.toContain("no cancellation charge");
  });
});

describe("a cancellation that cost the guest nothing", () => {
  const email = bookingCancellation(CANCELLATION);

  it("says so in words rather than printing a zero", () => {
    expect(email.text).toContain("no cancellation charge");
    expect(email.html).toContain("no cancellation charge");
    expect(email.text).not.toContain("Cancellation charge:");
  });
});

describe("any cancellation, charged or free", () => {
  // Once the universal case rather than the empty one. Money going back is a
  // staff act taken at the desk and out of band; no code path returns it, so no
  // body may say it is coming — for a stay that paid nothing, for one whose
  // penalty stands against the whole of what it paid, and equally for one that
  // is owed the lot. A guest waiting on a refund this system will never start is
  // worse off than one who was told to ask for it.
  // A charge that stands, and one §4's window or a manager waived.
  const penalties = [500_000n, 0n] as const;

  it("promises no refund, whatever the charge was", () => {
    for (const penalty of penalties) {
      const email = bookingCancellation({ ...CANCELLATION, penalty });

      expect(email.text).not.toMatch(/refund/i);
      expect(email.html).not.toMatch(/refund/i);
    }
  });

  it("still states what §4 charged, which is the fact the mail exists for", () => {
    for (const penalty of penalties) {
      const email = bookingCancellation({ ...CANCELLATION, penalty });

      expect(email.text).toMatch(/cancellation charge/i);
      expect(email.html).toMatch(/cancellation charge/i);
    }
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
