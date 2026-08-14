// The message the desk causes to be sent, and the three things it must not
// carry.
//
// What separates this template from the confirmation beside it is subtraction,
// so the negative assertions are the subject rather than the trimmings: no stay
// credential, no money, and nothing that reads as a receipt. A body that grew
// any of them would be a second live key mailed to an address whose owner has
// just said they cannot find the first one, or a price quoted to somebody who
// asked for a way into their account.
//
// The escaping case is not decoration, for `booking-confirmation-email.spec.ts`'s
// reason: a booking's contact name is typed by an anonymous, unauthenticated
// caller creating a hold, and it reaches this template without ever passing an
// authenticated user.

import { describe, expect, it } from "vitest";
import { accountLinkEmail } from "./account-link-email.js";

const CREATE_URL = "https://mariva.test/bookings/MRV-2027-0042/account#invitation=create-token";

const BOOKING = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  createAccountUrl: CREATE_URL,
};

describe("the account link the desk sends again", () => {
  const email = accountLinkEmail(BOOKING);

  it("carries the account link in both bodies", () => {
    expect(email.text).toContain(CREATE_URL);
    expect(email.html).toContain(CREATE_URL);
  });

  it("says the link expires in an hour and works once", () => {
    expect(email.text).toContain("1 hour");
    expect(email.text).toContain("once");
    expect(email.html).toContain("1 hour");
    expect(email.html).toContain("once");
  });

  it("names the reference in the subject and both bodies", () => {
    expect(email.subject).toContain(BOOKING.reference);
    expect(email.text).toContain(BOOKING.reference);
    expect(email.html).toContain(BOOKING.reference);
  });

  it("is addressed to the booking's contact and greets them by name", () => {
    expect(email.to).toBe(BOOKING.to);
    expect(email.text).toContain(BOOKING.guestName);
    expect(email.html).toContain(BOOKING.guestName);
  });

  it("says the property was asked for it, and what to do if nobody asked", () => {
    // The one defence against the failure this whole flow accepts — a member of
    // staff talked into sending it — is that the guest who never rang can tell.
    expect(email.text.toLowerCase()).toContain("was asked to send you this");
    expect(email.text.toLowerCase()).toContain("if you did not ask for it");
    expect(email.html.toLowerCase()).toContain("if you did not ask for it");
  });

  it("carries no second link of any kind", () => {
    // Exactly one URL in the text body. A stay link mailed beside this one
    // would be seven days of access handed to a mailbox on a telephone call's
    // authority, which is the thing the template exists to leave out.
    const urls = email.text.match(/https?:\/\/\S+/g) ?? [];

    expect(urls).toEqual([CREATE_URL]);
  });

  it("quotes no money", () => {
    for (const body of [email.text, email.html]) {
      expect(body).not.toMatch(/\d[\d.,]*\s*(₫|VND|đ\b)/i);
      expect(body.toLowerCase()).not.toContain("total");
      expect(body.toLowerCase()).not.toContain("paid");
    }
  });
});

describe("a contact name that is trying to be markup", () => {
  // Nobody authenticated typed this. It arrived on an anonymous hold.
  const payload = '<img src=x onerror="alert(1)">';
  const email = accountLinkEmail({ ...BOOKING, guestName: payload });

  it("does not survive into the HTML in a form a client would execute", () => {
    expect(email.html).not.toContain(payload);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('onerror="');
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("is escaped in the HTML heading too, not only in the body", () => {
    expect(email.html).toContain(
      `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">Set up your account, &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1>`,
    );
  });
});

describe("a reference that is trying to be markup", () => {
  const email = accountLinkEmail({ ...BOOKING, reference: 'MRV<script>"&' });

  it("is escaped in the HTML and left alone in the text", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("MRV&lt;script&gt;&quot;&amp;");
    expect(email.text).toContain('MRV<script>"&');
  });
});
