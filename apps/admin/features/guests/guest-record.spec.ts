import { describe, expect, it } from "vitest";

import type { SearchResults } from "@/features/bookings/booking-search";

import {
  type GuestHit,
  type GuestRecord,
  guestFacts,
  guestList,
  guestSearchCriteria,
  mayRevealCccd,
  NO_GUEST_SEARCH_FIELDS,
  revealAttempt,
  revealNotice,
} from "./guest-record";

/* The guests screen's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the markup: which typed pair is a
 * search the contract will accept, which answer is a list of people and which is
 * a refusal wearing one, what a half-empty record actually says, who is offered
 * the audited reading, and that no display helper anywhere can carry a plain
 * identity number.
 */

function hit(over: Partial<GuestHit> = {}): GuestHit {
  return {
    id: "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
    fullName: "Nguyễn Thị Mai",
    phone: "0912345678",
    cccdMasked: "0790******42",
    ...over,
  };
}

function record(over: Partial<GuestRecord> = {}): GuestRecord {
  return {
    id: "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
    fullName: "Nguyễn Thị Mai",
    phone: "0912345678",
    email: "mai@example.com",
    cccdMasked: "0790******42",
    dateOfBirth: "1991-03-15",
    nationality: "VN",
    createdAt: "2026-08-11T02:30:00.000Z",
    updatedAt: "2026-08-16T09:05:00.000Z",
    ...over,
  };
}

function found(guests: GuestHit[]): SearchResults {
  return { scope: "everything", rooms: [], bookings: [], guests };
}

describe("guestSearchCriteria", () => {
  it("refuses a search with nothing to go on, before it is sent", () => {
    // The contract refuses a criteria-less search too. Refusing it here is the
    // same sentence said where the operator can still fix it.
    const attempt = guestSearchCriteria(NO_GUEST_SEARCH_FIELDS);

    expect(attempt).toEqual({
      problem:
        "A search needs something to go on — a name, or a telephone number.",
    });
  });

  it("sends only the dimension that was typed", () => {
    expect(guestSearchCriteria({ fullName: "  Mai  ", phone: "" })).toEqual({
      criteria: { guestName: "Mai" },
    });

    expect(
      guestSearchCriteria({ fullName: "", phone: " 0912345678 " }),
    ).toEqual({ criteria: { guestPhone: "0912345678" } });
  });

  it("narrows on both when both were typed", () => {
    expect(guestSearchCriteria({ fullName: "Mai", phone: "0912" })).toEqual({
      criteria: { guestName: "Mai", guestPhone: "0912" },
    });
  });

  it("offers no way to search by identity number", () => {
    // Not an omission. A filter over the number would confirm one from outside
    // the audit trail a guess at a time, which is the disclosure the masking
    // exists to stop — so the field does not exist to be typed into.
    const attempt = guestSearchCriteria({ fullName: "Mai", phone: "" });

    expect("criteria" in attempt && Object.keys(attempt.criteria)).toEqual([
      "guestName",
    ]);
  });
});

describe("guestList", () => {
  it("runs the people by name, with the id breaking a tie", () => {
    const list = guestList(
      found([
        hit({ id: "b", fullName: "Trần Văn Bảo" }),
        hit({ id: "c", fullName: "Lê Thị An" }),
        hit({ id: "a", fullName: "Trần Văn Bảo" }),
      ]),
    );

    expect(list?.guests.map((one) => [one.fullName, one.id])).toEqual([
      ["Lê Thị An", "c"],
      ["Trần Văn Bảo", "a"],
      ["Trần Văn Bảo", "b"],
    ]);
  });

  it("says nothing rather than nobody when the answer had no people in it", () => {
    // A rooms-scoped answer is a grant that was narrowed, not a property with
    // no guests on file. Printing "nobody matches" over it would be the console
    // lying about the property.
    expect(guestList({ scope: "rooms", rooms: [] })).toBeNull();
  });

  it("distinguishes an answer with nobody in it from one it could not compute", () => {
    expect(guestList(found([]))).toEqual({ guests: [], truncated: false });
  });

  it("says so when the answer was cut at the search's own ceiling", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      hit({ id: `guest-${index}`, fullName: `Guest ${index}` }),
    );

    expect(guestList(found(many))?.truncated).toBe(true);
    expect(guestList(found(many.slice(0, 49)))?.truncated).toBe(false);
  });
});

describe("who is offered the reading", () => {
  it("offers it to the desk and to management", () => {
    expect(mayRevealCccd("RECEPTIONIST")).toBe(true);
    expect(mayRevealCccd("MANAGER")).toBe(true);
    expect(mayRevealCccd("ADMIN")).toBe(true);
  });

  it("offers it to nobody whose read stops at the masked record", () => {
    // The accountant reaches this screen under *Read guest record, CCCD masked*
    // and holds no grant on the row below it.
    expect(mayRevealCccd("ACCOUNTANT")).toBe(false);
    expect(mayRevealCccd("HOUSEKEEPING")).toBe(false);
  });
});

describe("guestFacts", () => {
  it("prints an instant in the property's own zone", () => {
    // 02:30 UTC is 09:30 in Ho Chi Minh City, which is the day the desk was
    // working — a record shown in the browser's zone would be a different date
    // for anybody reading it from elsewhere.
    const facts = guestFacts(record());

    expect(facts).toContainEqual({
      label: "Known since",
      value: "11 Aug 2026, 09:30",
    });
  });

  it("says a field is empty rather than dropping it", () => {
    // "No telephone number on file" and "this screen did not show you the
    // telephone number" are answers the desk must be able to tell apart.
    const facts = guestFacts(
      record({
        phone: null,
        email: null,
        dateOfBirth: null,
        nationality: null,
      }),
    );

    expect(
      facts
        .filter((fact) => fact.value === "None on file")
        .map((fact) => fact.label),
    ).toEqual(["Telephone", "Email", "Date of birth", "Nationality"]);
  });

  it("names no identity field a plain number could travel in", () => {
    // The module's confidentiality claim, asserted rather than described: a
    // screen drawing these facts cannot show a number, because none of them is
    // one — the masked value is drawn beside its own control instead.
    const labels = guestFacts(record()).map((fact) => fact.label);

    expect(labels).not.toContain("Identity number");
    expect(labels).toEqual([
      "Telephone",
      "Email",
      "Date of birth",
      "Nationality",
      "Known since",
      "Last changed",
    ]);
  });
});

describe("revealAttempt", () => {
  it("takes a reading with no reason at all", () => {
    // Optional, and it stays optional: requiring one produces a column full of
    // "check in", and the attribution is what makes the reading accountable.
    expect(
      revealAttempt("6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01", "   "),
    ).toEqual({ input: { guestId: "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01" } });
  });

  it("trims the reason it does send", () => {
    expect(
      revealAttempt(
        "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
        "  police request  ",
      ),
    ).toEqual({
      input: {
        guestId: "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
        reason: "police request",
      },
    });
  });

  it("refuses a reason longer than the audit log stores", () => {
    const attempt = revealAttempt(
      "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
      "x".repeat(201),
    );

    expect(attempt).toEqual({
      problem:
        "That reason is longer than the audit log stores. Shorten it to a line.",
    });
  });
});

describe("revealNotice", () => {
  it("says back the entry that was just written, in the property's zone", () => {
    // The response carries the audit row rather than a promise that one was
    // made, and the operator reads it at the moment they read the number.
    expect(
      revealNotice({
        guestId: "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
        cccdNumber: "079019004242",
        unmaskedBy: "0f4b1d0e-1c2a-4f3b-9a8d-7e6f5c4b3a20",
        unmaskedAt: "2026-08-16T09:05:00.000Z",
      }),
    ).toBe("Recorded against your account at 16 Aug 2026, 16:05.");
  });
});
