// The two bodies a confirmed booking can produce, and the one thing neither may
// ever do.
//
// The variant assertions are the contract with the caller: which body a guest
// receives is decided entirely by whether `createAccountUrl` was handed in, and
// nothing else in the template may start deciding it. The sign-in variant is
// asserted negatively — the create URL must not appear — because the failure
// this guards is a body that leaks a credential to an address that already has
// an account.
//
// The escaping case is not decoration. A booking's contact name is typed by an
// anonymous, unauthenticated caller creating a hold; it reaches this template
// without ever passing an authenticated user. The assertion is that the raw
// payload does not survive into the HTML, which is stronger than checking that
// an escaped form appears somewhere — a body can contain both.

import { describe, expect, it } from "vitest";
import { bookingConfirmation } from "./booking-confirmation-email.js";

const STAY_URL = "https://mariva.test/bookings/abc?t=stay-token";
const CREATE_URL = "https://mariva.test/account/create?t=create-token";

const BOOKING = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  stayUrl: STAY_URL,
};

describe("the confirmation for an address with no account yet", () => {
  const email = bookingConfirmation({ ...BOOKING, createAccountUrl: CREATE_URL });

  it("carries the create link in both bodies", () => {
    expect(email.text).toContain(CREATE_URL);
    expect(email.html).toContain(CREATE_URL);
  });

  it("says the create link expires in an hour and works once", () => {
    expect(email.text).toContain("1 hour");
    expect(email.text).toContain("once");
    expect(email.html).toContain("1 hour");
    expect(email.html).toContain("once");
  });

  it("still carries the stay link, which is the half that is always sent", () => {
    expect(email.text).toContain(STAY_URL);
    expect(email.html).toContain(STAY_URL);
  });
});

describe("the confirmation for an address that already has an account", () => {
  const email = bookingConfirmation(BOOKING);

  it("carries no create link anywhere", () => {
    expect(email.text).not.toContain(CREATE_URL);
    expect(email.html).not.toContain(CREATE_URL);
  });

  it("offers no account creation, only signing in", () => {
    // The wording matters as much as the missing URL: "create an account" in a
    // body sent to an address that has one is a contradiction the guest has to
    // resolve, and the point of this branch is that they never see it.
    expect(email.text.toLowerCase()).not.toContain("create");
    expect(email.html.toLowerCase()).not.toContain("create");
    expect(email.text.toLowerCase()).toContain("sign in");
  });

  it("carries the stay link", () => {
    expect(email.text).toContain(STAY_URL);
    expect(email.html).toContain(STAY_URL);
  });
});

describe("every confirmation", () => {
  const variants = [
    bookingConfirmation(BOOKING),
    bookingConfirmation({ ...BOOKING, createAccountUrl: CREATE_URL }),
  ];

  it("names the reference in the subject, the text and the HTML", () => {
    for (const email of variants) {
      expect(email.subject).toContain(BOOKING.reference);
      expect(email.text).toContain(BOOKING.reference);
      expect(email.html).toContain(BOOKING.reference);
    }
  });

  it("is addressed to the booking's contact and has both bodies filled", () => {
    for (const email of variants) {
      expect(email.to).toBe(BOOKING.to);
      expect(email.text.trim()).not.toBe("");
      expect(email.html.trim()).not.toBe("");
    }
  });

  it("greets the guest by the name on the booking", () => {
    for (const email of variants) {
      expect(email.text).toContain(BOOKING.guestName);
      expect(email.html).toContain(BOOKING.guestName);
    }
  });
});

describe("a contact name that is trying to be markup", () => {
  // Nobody authenticated typed this. It arrived on an anonymous hold.
  const payload = '<img src=x onerror="alert(1)">';
  const email = bookingConfirmation({
    ...BOOKING,
    guestName: payload,
    createAccountUrl: CREATE_URL,
  });

  it("does not survive into the HTML in a form a client would execute", () => {
    expect(email.html).not.toContain(payload);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('onerror="');
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("is escaped in the subject-adjacent HTML heading too, not only in the body", () => {
    // The name is interpolated into the `<h1>`; an escaper applied to the
    // paragraphs and forgotten on the heading passes every other case here.
    expect(email.html).toContain(
      `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">Your stay is confirmed, &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1>`,
    );
  });
});

describe("a reference that is trying to be markup", () => {
  const email = bookingConfirmation({ ...BOOKING, reference: 'MRV<script>"&' });

  it("is escaped in the HTML and left alone in the text", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("MRV&lt;script&gt;&quot;&amp;");
    expect(email.text).toContain('MRV<script>"&');
  });
});
