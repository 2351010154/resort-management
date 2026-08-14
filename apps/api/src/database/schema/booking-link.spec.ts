// What the link table declares, and the two things it deliberately does not
// hold.
//
// The absences are the point, as they are in `loyalty.spec.ts`. A link is a
// bearer credential mailed to an address, so the row that tracks it must not be
// a copy of it — a table support staff read is the wrong place for something
// that opens a stay. And the row must not carry a second copy of the deadline or
// the purpose in the token beside it, because the copy in a mailbox is the one
// nobody can correct.
//
// Whether Postgres actually refuses a link consumed after its deadline, and
// whether two simultaneous redemptions leave exactly one winner, are questions
// about the migration and about the statement that spends a link. Both are
// answered against a real database in
// `modules/auth/booking-token/booking-link.spec.ts`.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  BOOKING_LINK_PURPOSES,
  bookingLink,
  bookingLinkPurposeEnum,
} from "./booking-link.js";

describe("a mailed booking link", () => {
  it("serves both of the mail's links from one table", () => {
    // One re-issues the booking cookie, one creates the account the stay
    // attaches to. They differ in what they are for and in nothing else — same
    // signer, same deadline column, same single use — so a second table would be
    // this one under another name, with a second copy of the consumption race to
    // get right.
    expect(bookingLinkPurposeEnum.enumValues).toEqual([
      ...BOOKING_LINK_PURPOSES,
    ]);
    expect(BOOKING_LINK_PURPOSES).toHaveLength(2);
  });

  it("stores the address of a link and never the link itself", () => {
    // The signature is computed over this row's id, so the id is all the row
    // needs. A column holding the signed text would put a credential that opens
    // a paid stay into a table that reports and support tooling read.
    const columns = Object.keys(bookingLink);

    expect(columns).toContain("id");
    expect(columns).not.toContain("token");
    expect(columns).not.toContain("signature");
    expect(columns).not.toContain("secret");
  });

  it("keeps no copy of who the mail went to", () => {
    // `booking.contact_email` is where it was sent. A second copy here would be
    // a second thing to keep in step, and this table is not a delivery log.
    const columns = Object.keys(bookingLink);

    expect(columns).not.toContain("email");
    expect(columns).not.toContain("contactEmail");
    expect(columns).not.toContain("sentTo");
  });

  it("says it has been followed with an instant and not a flag", () => {
    // Null is the whole of "still spendable", which is what lets the redeeming
    // statement be `where consumed_at is null` — a null cannot be written twice,
    // and a boolean somebody flips could be flipped by two callers at once. The
    // instant is also the evidence of when the stay was opened.
    expect(bookingLink.consumedAt.notNull).toBe(false);
    expect(bookingLink.consumedAt.getSQLType()).toBe("timestamp with time zone");

    const columns = Object.keys(bookingLink);

    expect(columns).not.toContain("consumed");
    expect(columns).not.toContain("used");
  });

  it("times both lifetimes by the clock, because neither is a night", () => {
    // An hour for the create link and seven days past checkout for the re-issue
    // one. Neither is a calendar date, and a `date` here would round the hour to
    // a whole day.
    expect(bookingLink.expiresAt.getSQLType()).toBe("timestamp with time zone");
    expect(bookingLink.expiresAt.notNull).toBe(true);
  });

  it("points at the stay it opens, and requires one", () => {
    // A link with no booking behind it opens nothing and could not be redeemed,
    // which is why the column is `NOT NULL` and why a deleted stay takes its
    // links with it rather than leaving them to a cleanup nobody would write.
    expect(bookingLink.bookingId.notNull).toBe(true);

    const [key] = getTableConfig(bookingLink).foreignKeys;

    expect(key?.onDelete).toBe("cascade");
  });

  it("declares the checks that leave an unusable link unrepresentable", () => {
    const declared = getTableConfig(bookingLink)
      .checks.map((check) => check.name)
      .sort();

    expect(declared).toEqual([
      "booking_link_consumed_while_it_was_live",
      "booking_link_outlives_the_mail_that_carried_it",
    ]);
  });
});
