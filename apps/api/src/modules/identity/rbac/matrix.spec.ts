// The matrix is a mirror of docs/architecture/rbac-matrix.md, and a mirror can
// be wrong in ways a compiler cannot see: a duplicated key, a row that grants
// `ADMIN` less than `MANAGER`, a row nobody can reach that nobody meant to make
// unreachable. Those are the checks here.
//
// What this file cannot check is that a row exists for every row of the
// document — no test can read prose and be sure. What it can do is make every
// *structural* rule in §2 mechanical, so the only thing left to human review is
// whether the grants themselves match, which is a line-by-line comparison a
// reviewer can actually perform.

import { describe, expect, it } from "vitest";
import { CAPABILITIES, capability } from "./matrix.js";
import { GRANTS, STAFF_ROLES } from "./roles.js";

describe("the RBAC matrix", () => {
  it("gives every capability a unique key", () => {
    const keys = CAPABILITIES.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every capability a section and a row label from the document", () => {
    for (const row of CAPABILITIES) {
      expect(row.section.length, row.key).toBeGreaterThan(0);
      expect(row.row.length, row.key).toBeGreaterThan(0);
    }
  });

  it("uses only the four defined grants", () => {
    for (const row of CAPABILITIES) {
      expect(GRANTS).toContain(row.guest);

      for (const role of STAFF_ROLES) {
        expect(GRANTS, `${row.key} / ${role}`).toContain(row.staff[role]);
      }
    }
  });

  // §2: "`ADMIN` ⊇ `MANAGER`." Fifty-four rows typed by hand is fifty-four
  // chances to break that quietly, and the break would only surface as a
  // manager doing something an administrator cannot.
  it("never gives MANAGER something ADMIN lacks", () => {
    for (const row of CAPABILITIES) {
      if (row.staff.MANAGER !== "denied") {
        expect(row.staff.ADMIN, row.key).not.toBe("denied");
      }
    }
  });

  // Two rows are public, and they are the two a stranger needs before they have
  // any reason to have an account: finding a room, and holding it. Naming them
  // rather than counting them is the point — a third appearing is worth a
  // conversation, and so is one of these two being swapped for something else.
  //
  // The second is a write, and the only public one. It reserves inventory, so
  // the route behind it is rate-limited; that limit is not a matrix row and is
  // asserted where it lives, but this is the row that makes it necessary.
  it("marks the search and the hold reachable without a session, and nothing else", () => {
    const open = CAPABILITIES.filter((row) => row.unauthenticated);

    expect(open.map((row) => row.key)).toEqual([
      "availability.search",
      "booking.create-own",
    ]);
  });

  // Viewing and deleting a scan image are absent rather than denied: the scan
  // is read for its particulars and never stored, so there is no object for a
  // role to reach. Asserting the absence keeps somebody from restoring the rows
  // as though the matrix had simply forgotten them.
  it("carries no capability over a stored scan image", () => {
    const scanRows = CAPABILITIES.filter((row) =>
      row.key.startsWith("guest.id-scan."),
    );

    expect(scanRows.map((row) => row.key)).toEqual([
      "guest.id-scan.upload-own",
      "guest.id-scan.upload",
    ]);
  });

  it("refuses to look up a capability that does not exist", () => {
    // @ts-expect-error — the point of the key union is that this is a compile
    // error; the runtime throw is the second line of defence for a key that
    // arrives as a string from somewhere the compiler cannot see.
    expect(() => capability("booking.invented")).toThrow(/Unknown capability/);
  });
});
