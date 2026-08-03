// What the guest declarations say, and what is left to a database.
//
// The claim this file exists to hold is the storage decision: the CCCD is kept
// once, as it was read, and the masked form is produced by the read path. A
// second column carrying the asterisks is the shape being rejected, and it is
// the kind of thing that gets added back by a well-meaning change that finds
// masking "expensive" — so it is asserted here as an absence rather than left
// to the header comment to argue.
//
// Whether Postgres actually refuses a second guest on one CCCD, a booking with
// two primary registrations or an unmask naming nobody is a question about the
// migration, and it is answered in `test/guest-storage.e2e-spec.ts` against a
// real database.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { cccdUnmaskAudit, guest, registration } from "./guest.js";
import type { GuestRow } from "./guest.js";

describe("the guest record", () => {
  it("keeps the CCCD once and derives the mask from it", () => {
    // `FR-GST-03` masks by default and makes unmasking a distinct, audited
    // capability. Masking is therefore an answer the read path gives, not a
    // storage format — and a stored mask beside the number it was computed from
    // is one fact in two places, which drifts the first time an update touches
    // one of them.
    const columns = Object.keys(guest);

    expect(columns).toContain("cccdNumber");
    expect(columns).not.toContain("cccdMasked");
    expect(columns).not.toContain("cccdCiphertext");
  });

  it("requires a name and nothing else about a person", () => {
    // The check-in desk described rather than the schema being lax: a domestic
    // guest hands over a CCCD and no passport, a foreign guest the reverse, and
    // a second occupant may be registered on the first guest's word. A NOT NULL
    // on any of those is met by the receptionist typing a placeholder, which
    // cannot afterwards be told from real data.
    expect(guest.fullName.notNull).toBe(true);

    for (const optional of [
      guest.phone,
      guest.email,
      guest.cccdNumber,
      guest.dateOfBirth,
      guest.nationality,
    ]) {
      expect(optional.notNull).toBe(false);
    }
  });

  it("dates a birthday by the calendar and never by the clock", () => {
    // `booking.check_in_date`'s argument, applied to a person: a birthday is a
    // day in a place, and a timestamp rebuilt at UTC midnight moves it back one
    // in UTC+7.
    expect(guest.dateOfBirth.getSQLType()).toBe("date");

    const born: GuestRow["dateOfBirth"] = "1993-01-04";

    expect(born).toBe("1993-01-04");
  });

  it("declares the checks that leave an unidentifiable guest unrepresentable", () => {
    const declared = getTableConfig(guest)
      .checks.map((check) => check.name)
      .sort();

    expect(declared).toEqual([
      "guest_cccd_present_when_set",
      "guest_has_a_name",
    ]);
  });

  it("gives one CCCD to one person, and leaves the rest uncounted", () => {
    // Unique so a returning guest is found rather than duplicated — a split
    // guest is a split stay history (`FR-GST-01`) and a rolling-12-month count
    // (`FR-GST-04`) that undercounts. Partial because most rows have no CCCD,
    // and a plain unique index would collapse every one of them into a single
    // guest.
    const unique = indexNamed(guest, "guest_cccd_number_key");

    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.where).toBeDefined();
  });
});

describe("the registration", () => {
  it("records the fact and never revises it", () => {
    // The statutory residence record — `ASM-02` is still waiting on written
    // legal advice for how long it must be kept. A record with an update path
    // is not a record of anything, so there is no column to update: an entry
    // made in error is corrected by registering the right guest, leaving both
    // facts visible.
    const columns = Object.keys(registration);

    expect(columns).toContain("registeredAt");
    expect(columns).not.toContain("updatedAt");
    expect(columns).not.toContain("deletedAt");
  });

  it("registers a person on a stay once", () => {
    const unique = indexNamed(registration, "registration_booking_guest_key");

    expect(unique?.config.unique).toBe(true);
    expect(columnNamesOf(unique)).toEqual(["booking_id", "guest_id"]);
  });

  it("gives a booking at most one holder", () => {
    // Two rows claiming to be primary is a folio with two addressees and no
    // rule for choosing between them, which surfaces at M6 as an invoice made
    // out to whichever row was read first.
    const unique = indexNamed(
      registration,
      "registration_one_primary_per_booking_key",
    );

    expect(unique?.config.unique).toBe(true);
    expect(columnNamesOf(unique)).toEqual(["booking_id"]);
    // Partial on `is_primary` — the non-primary occupants of a room are many
    // and are not constrained by this.
    expect(unique?.config.where).toBeDefined();
  });
});

describe("the unmask audit", () => {
  it("attributes every reveal to a named member of staff", () => {
    // `FR-GST-03` audits per call. The question the table answers is who read
    // which guest's number and when, and a nullable actor would make the
    // interesting reads the unattributable ones.
    expect(cccdUnmaskAudit.unmaskedBy.notNull).toBe(true);
    expect(cccdUnmaskAudit.guestId.notNull).toBe(true);
  });

  it("leaves the reason optional, because a required one gets filled in", () => {
    // A mandatory free-text field produces a column full of "check in". The
    // attribution above is what makes the read accountable.
    expect(cccdUnmaskAudit.reason.notNull).toBe(false);
  });

  it("appends and never amends", () => {
    const columns = Object.keys(cccdUnmaskAudit);

    expect(columns).toContain("unmaskedAt");
    expect(columns).not.toContain("updatedAt");
  });

  it("answers both questions the audit viewer asks", () => {
    // Everything read about this guest, and everything this member of staff
    // read. Neither index answers the other's question.
    const byGuest = indexNamed(
      cccdUnmaskAudit,
      "cccd_unmask_audit_guest_id_idx",
    );
    const byStaff = indexNamed(
      cccdUnmaskAudit,
      "cccd_unmask_audit_unmasked_by_idx",
    );

    expect(columnNamesOf(byGuest)).toEqual(["guest_id", "unmasked_at"]);
    expect(columnNamesOf(byStaff)).toEqual(["unmasked_by", "unmasked_at"]);
  });
});

/** The declared index of that name, or `undefined` if the table has none. */
function indexNamed(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): ReturnType<typeof getTableConfig>["indexes"][number] | undefined {
  return getTableConfig(table).indexes.find(
    (declared) => declared.config.name === name,
  );
}

/** The column names an index covers, in order. Expressions read as
 *  `(expression)` — none of the indexes here use one, and a rename that turned
 *  a column into one would show up as that rather than as a pass. */
function columnNamesOf(
  declared: ReturnType<typeof indexNamed>,
): readonly string[] {
  return (declared?.config.columns ?? []).map((column) =>
    "name" in column && typeof column.name === "string"
      ? column.name
      : "(expression)",
  );
}
