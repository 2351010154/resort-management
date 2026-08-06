// The folio and its postings, against a real Postgres.
//
// The claim under test is the one `FR-FOL-01` makes and no service can keep: a
// posting is written once. "A mistake is corrected by a reversing entry, never
// an `UPDATE` or `DELETE`" is a sentence about every client that will ever open
// this database, not about the one module that is supposed to write postings —
// so it is asserted the only way it can be, by issuing the forbidden statements
// against real rows and reading the refusal back.
//
// Everything here runs inside a transaction that is rolled back, and that is
// forced rather than tidy. A posting cannot be deleted, which is the property
// being proved, so a spec that committed its rows would leave a folio nothing
// can clear, a booking whose foreign keys nothing can release, and a
// `seedDatabase` failing three files later for a reason that looks nothing like
// this file. The transaction is the only cleanup a write-once table has. Each
// refusal is taken inside a savepoint, so the test can go on to check that the
// row it tried to rewrite is still exactly as it was.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies the
// migrations rather than pushing the schema: the trigger under test lives in
// `0011_folio_ledger.sql` and only migrating puts it there. No Nest application
// is booted — the subject is the storage layer itself.

import { randomUUID } from "node:crypto";
import { CHARGE_BASES } from "@mariva/shared";
import { eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { serviceCatalog } from "../src/database/schema/service.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// Raised by `folio_posting_refuse_rewrite()`. This system's own code, in a class
// the SQL standard leaves to implementations, so a route can tell an attempt to
// rewrite the ledger from every other error a function might raise.
const APPEND_ONLY_VIOLATION = "MV001";

const BUSINESS_DATE = "2027-09-02";
const DEPARTURE_DATE = "2027-09-05";

// A uuid no row has. Used where a test needs a key that resolves to nothing.
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// References are unique and this file opens a folio per test. Counted rather
// than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
});

afterAll(async () => {
  await pool?.end();
});

describe("one account per stay", () => {
  it("opens against a booking and starts at nothing", async () => {
    await onAFolio(async (tx, folioId) => {
      const [opened] = await tx
        .select()
        .from(folio)
        .where(eq(folio.id, folioId));

      expect(opened?.state).toBe("OPEN");
      expect(opened?.closedAt).toBeNull();
      // Not zero stored anywhere — zero because there is nothing to sum.
      expect(await balanceOf(tx, folioId)).toBe(0n);
    });
  });

  it("refuses a second folio for one booking", async () => {
    // `FR-FOL-01`: one folio per stay. Two accounts each summing to zero is not
    // the claim the check-out guard reads, and it would pass on whichever one
    // the query happened to find.
    await rolledBack(async (tx) => {
      const bookingId = await aBooking(tx);

      await tx.insert(folio).values({ bookingId });

      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folio).values({ bookingId }),
      );

      expect(refusal.code).toBe(UNIQUE_VIOLATION);
    });
  });

  it("refuses an account for a stay that does not exist", async () => {
    await rolledBack(async (tx) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folio).values({ bookingId: ABSENT_ID }),
      );

      expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  it("closes only together with the moment it closed", async () => {
    // Both directions, as the constraint states them. A closed folio with no
    // closing time cannot be invoiced or accrued against; a closing time on an
    // open one is a close somebody started and did not finish.
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .update(folio)
          .set({ state: "CLOSED" })
          .where(eq(folio.id, folioId)),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe("folio_closed_at_exactly_when_closed");

      await tx
        .update(folio)
        .set({ state: "CLOSED", closedAt: new Date() })
        .where(eq(folio.id, folioId));

      const [closed] = await tx
        .select()
        .from(folio)
        .where(eq(folio.id, folioId));

      expect(closed?.closedAt).toBeInstanceOf(Date);
    });
  });
});

describe("the balance is the postings and nothing else", () => {
  it("is what was charged less what was paid", async () => {
    // `NFR-02`: Σ postings = Σ payments + outstanding. Stated here as the sum
    // being the outstanding amount, which is the same identity with the payments
    // carried across as the negative rows they are stored as.
    await onAFolio(async (tx, folioId) => {
      // The charge first, because the two lines levied on it name it. One gross
      // figure of 1,134,000 ₫ decomposed the way `decomposeGross` decomposes it.
      const chargeId = await post(tx, aRoomCharge(folioId, {
        amount: 1_000_000n,
      }));

      await tx.insert(folioPosting).values([
        aRoomCharge(folioId, {
          type: "SERVICE_CHARGE_FEE",
          amount: 50_000n,
          description: "Service charge",
          parentPostingId: chargeId,
        }),
        aRoomCharge(folioId, {
          type: "VAT",
          amount: 84_000n,
          description: "VAT",
          parentPostingId: chargeId,
        }),
        aRoomCharge(folioId, {
          type: "PAYMENT",
          amount: -900_000n,
          description: "Card payment",
        }),
      ]);

      expect(await balanceOf(tx, folioId)).toBe(234_000n);
    });
  });

  it("goes negative when the guest has paid too much", async () => {
    // Signed, as `FolioPort.getBalance` says: "an over-payment awaiting refund
    // is a negative balance, and §4 refuses that too". A guest owed money at the
    // desk is as unsettled as one who owes it.
    await onAFolio(async (tx, folioId) => {
      await tx.insert(folioPosting).values([
        aRoomCharge(folioId, { amount: 1_000_000n }),
        aRoomCharge(folioId, {
          type: "PAYMENT",
          amount: -1_200_000n,
          description: "Card payment",
        }),
      ]);

      expect(await balanceOf(tx, folioId)).toBe(-200_000n);
    });
  });

  it("hands an amount back as the integer it was given", async () => {
    // `NFR-12`. The figure is one đồng above what a double can represent, so a
    // column or a driver that routed money through `number` would come back
    // even, and a folio that is wrong by one đồng fails `NFR-02` in a way that
    // is unprovable rather than merely visible.
    await onAFolio(async (tx, folioId) => {
      await tx
        .insert(folioPosting)
        .values(aRoomCharge(folioId, { amount: 9_007_199_254_740_993n }));

      const [stored] = await tx
        .select()
        .from(folioPosting)
        .where(eq(folioPosting.folioId, folioId));

      expect(stored?.amount).toBe(9_007_199_254_740_993n);
      expect(typeof stored?.amount).toBe("bigint");
    });
  });
});

describe("a posting is written once", () => {
  it("refuses to have its amount changed", async () => {
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(tx, aRoomCharge(folioId));

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .update(folioPosting)
          .set({ amount: 1n })
          .where(eq(folioPosting.id, postingId)),
      );

      expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
      expect(refusal.message).toContain("append-only");
      expect(refusal.message).toContain("update");
    });
  });

  it("refuses a change to a column that carries no money", async () => {
    // The rule is about the row and not about the amount. A description edited
    // after the fact rewrites what the guest was told they were charged for,
    // which is the same defect wearing a different column.
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(tx, aRoomCharge(folioId));

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .update(folioPosting)
          .set({ description: "Room 302, one night" })
          .where(eq(folioPosting.id, postingId)),
      );

      expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    });
  });

  it("refuses to be deleted", async () => {
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(tx, aRoomCharge(folioId));

      const refusal = await refused(tx, (savepoint) =>
        savepoint.delete(folioPosting).where(eq(folioPosting.id, postingId)),
      );

      expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
      expect(refusal.message).toContain("delete");
    });
  });

  it("refuses the same statements written as plain SQL", async () => {
    // Drizzle is not what refuses them. The same two statements, issued the way
    // a support script or a `psql` session would issue them, hit the same rule.
    await onAFolio(async (tx, folioId) => {
      await post(tx, aRoomCharge(folioId));

      const update = await refused(tx, (savepoint) =>
        savepoint.execute(sql`update folio_posting set amount = 1`),
      );

      expect(update.code).toBe(APPEND_ONLY_VIOLATION);

      const remove = await refused(tx, (savepoint) =>
        savepoint.execute(sql`delete from folio_posting`),
      );

      expect(remove.code).toBe(APPEND_ONLY_VIOLATION);
    });
  });

  it("is unchanged after the refusal", async () => {
    // The half a raised exception alone does not prove: nothing was written
    // before the trigger stopped it.
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(
        tx,
        aRoomCharge(folioId, { amount: 1_000_000n }),
      );

      await refused(tx, (savepoint) =>
        savepoint
          .update(folioPosting)
          .set({ amount: 1n, description: "edited" })
          .where(eq(folioPosting.id, postingId)),
      );

      const [stored] = await tx
        .select()
        .from(folioPosting)
        .where(eq(folioPosting.id, postingId));

      expect(stored?.amount).toBe(1_000_000n);
      expect(stored?.description).toBe("Room 301, one night");
    });
  });

  it("keeps the folio it belongs to from being deleted", async () => {
    // The way round the trigger that would otherwise exist: clear the account by
    // deleting the account. The key refuses it, because the postings that would
    // have to go first cannot.
    await onAFolio(async (tx, folioId) => {
      await post(tx, aRoomCharge(folioId));

      const refusal = await refused(tx, (savepoint) =>
        savepoint.delete(folio).where(eq(folio.id, folioId)),
      );

      expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("a correction is a new line", () => {
  it("undoes a charge with a row of its own", async () => {
    // `FR-FOL-01`'s reversing entry. The mistake and its correction both stay on
    // the account, which is the difference between a ledger and a total.
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(
        tx,
        aRoomCharge(folioId, { amount: 1_000_000n }),
      );

      await post(
        tx,
        aRoomCharge(folioId, {
          type: "REVERSAL",
          amount: -1_000_000n,
          description: "Reverses a night charged twice",
          reversesPostingId: postingId,
        }),
      );

      expect(await balanceOf(tx, folioId)).toBe(0n);

      const lines = await tx
        .select()
        .from(folioPosting)
        .where(eq(folioPosting.folioId, folioId));

      expect(lines).toHaveLength(2);
    });
  });

  it("refuses to undo the same line twice", async () => {
    // Two credits for one mistake. Nothing else would refuse the second row —
    // the correction is an insert, and inserts are what this table is for.
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(tx, aRoomCharge(folioId));

      await post(
        tx,
        aRoomCharge(folioId, {
          type: "REVERSAL",
          amount: -1_000_000n,
          description: "Reverses a night charged twice",
          reversesPostingId: postingId,
        }),
      );

      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            type: "REVERSAL",
            amount: -1_000_000n,
            description: "Reverses the same night again",
            reversesPostingId: postingId,
          }),
        ),
      );

      expect(refusal.code).toBe(UNIQUE_VIOLATION);
      expect(refusal.constraint).toBe("folio_posting_reversal_unique_key");
    });
  });

  it("refuses a reversal that names no line", async () => {
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            type: "REVERSAL",
            amount: -1_000_000n,
            description: "A credit with no mistake behind it",
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_reverses_exactly_when_reversal",
      );
    });
  });

  it("refuses an ordinary line that names one", async () => {
    // A reversal that did not say so. It would sit outside the uniqueness rule
    // being about reversals at all, and a second one could then be written.
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(tx, aRoomCharge(folioId));

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .insert(folioPosting)
          .values(aRoomCharge(folioId, { reversesPostingId: postingId })),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_reverses_exactly_when_reversal",
      );
    });
  });

  it("refuses a line that reverses itself", async () => {
    // The one cycle the foreign key cannot refuse on its own: every longer one
    // needs each row to exist before the other. Refusing this makes the reversal
    // graph acyclic, so "what corrected this line" always terminates.
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            id: ABSENT_ID,
            type: "REVERSAL",
            amount: -1_000_000n,
            description: "Its own correction",
            reversesPostingId: ABSENT_ID,
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_does_not_reverse_itself",
      );
    });
  });
});

describe("what a line says it is for", () => {
  it("names the catalog row a service line charged for", async () => {
    // `FR-FOL-03`: items post "with their tax class", and the class belongs to
    // the catalog row. The key is also what makes a sold item undeletable, which
    // is why `service_catalog` withdraws an item rather than removing it.
    await onAFolio(async (tx, folioId) => {
      const itemId = await aCatalogItem(tx);

      await post(
        tx,
        aRoomCharge(folioId, {
          type: "SERVICE_ITEM",
          amount: 350_000n,
          description: "Extra bed",
          serviceCatalogId: itemId,
        }),
      );

      const [line] = await tx
        .select()
        .from(folioPosting)
        .where(eq(folioPosting.folioId, folioId));

      expect(line?.serviceCatalogId).toBe(itemId);
    });
  });

  it("refuses a service line with no catalog row behind it", async () => {
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            type: "SERVICE_ITEM",
            amount: 350_000n,
            description: "Something the desk typed",
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_names_a_service_item_exactly_when_it_is_one",
      );
    });
  });

  it("refuses a catalog row on a line that is not a sale", async () => {
    await onAFolio(async (tx, folioId) => {
      const itemId = await aCatalogItem(tx);

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .insert(folioPosting)
          .values(aRoomCharge(folioId, { serviceCatalogId: itemId })),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_names_a_service_item_exactly_when_it_is_one",
      );
    });
  });

  it("names the grid row a policy charge came from", async () => {
    // `policy-charge.ts`: the amount cannot stand in for the reason, because a
    // free cancellation and an early departure on the final night both come to
    // zero.
    await onAFolio(async (tx, folioId) => {
      await post(
        tx,
        aRoomCharge(folioId, {
          type: "POLICY_CHARGE",
          amount: 1_000_000n,
          description: "Cancellation within 48 hours",
          chargeBasis: "FIRST_NIGHT",
        }),
      );

      const [line] = await tx
        .select()
        .from(folioPosting)
        .where(eq(folioPosting.folioId, folioId));

      expect(line?.chargeBasis).toBe("FIRST_NIGHT");
    });
  });

  it("refuses a policy charge with no basis", async () => {
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            type: "POLICY_CHARGE",
            amount: 1_000_000n,
            description: "A charge nobody can explain",
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_names_a_basis_exactly_when_a_policy_charge",
      );
    });
  });

  it("records a free cancellation as a line of nothing", async () => {
    // `NONE` is a row of §4's grid and not the absence of one — a cancellation
    // inside the free window is a decision the property made, and a folio that
    // said nothing would leave the guest asking why they were not charged.
    await onAFolio(async (tx, folioId) => {
      await post(
        tx,
        aRoomCharge(folioId, {
          type: "POLICY_CHARGE",
          amount: 0n,
          description: "Cancelled inside the free window",
          chargeBasis: "NONE",
        }),
      );

      expect(await balanceOf(tx, folioId)).toBe(0n);
      expect(CHARGE_BASES).toContain("NONE");
    });
  });
});

describe("the charge a tax line was levied on", () => {
  it("holds the three lines of one gross figure together", async () => {
    // `FR-FOL-02` decomposes one agreed figure into three, and §5 shows all
    // three. Without the parent, the two derived lines are loose amounts that
    // only happen to sit beside the charge they came from.
    await onAFolio(async (tx, folioId) => {
      const chargeId = await post(
        tx,
        aRoomCharge(folioId, { amount: 1_000_000n }),
      );

      await tx.insert(folioPosting).values([
        aRoomCharge(folioId, {
          type: "SERVICE_CHARGE_FEE",
          amount: 50_000n,
          description: "Service charge",
          parentPostingId: chargeId,
        }),
        aRoomCharge(folioId, {
          type: "VAT",
          amount: 84_000n,
          description: "VAT",
          parentPostingId: chargeId,
        }),
      ]);

      // What reversing the charge has to find, and the reason the column is a
      // parent rather than a group: one predicate reaches the sale and
      // everything levied on it.
      const wholeCharge = await tx
        .select()
        .from(folioPosting)
        .where(
          or(
            eq(folioPosting.id, chargeId),
            eq(folioPosting.parentPostingId, chargeId),
          ),
        );

      expect(wholeCharge).toHaveLength(3);
      expect(
        wholeCharge.reduce((sum, line) => sum + line.amount, 0n),
      ).toBe(1_134_000n);
    });
  });

  it("refuses a tax line with no charge behind it", async () => {
    // An amount nothing accounts for. It would sum into the balance and no
    // invoice could say what it was levied on.
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            type: "VAT",
            amount: 84_000n,
            description: "Tax on nothing",
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_derives_exactly_when_a_tax_line",
      );
    });
  });

  it("refuses a charge that claims to be levied on another", async () => {
    // The other direction. A room charge is a sale, not a percentage of one.
    await onAFolio(async (tx, folioId) => {
      const chargeId = await post(tx, aRoomCharge(folioId));

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .insert(folioPosting)
          .values(aRoomCharge(folioId, { parentPostingId: chargeId })),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_derives_exactly_when_a_tax_line",
      );
    });
  });

  it("refuses a tax line levied on itself", async () => {
    // The one cycle the key cannot refuse on its own, since a row may name an id
    // that already exists — including the one it is being written with.
    await onAFolio(async (tx, folioId) => {
      const id = randomUUID();

      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            id,
            type: "VAT",
            amount: 84_000n,
            description: "Tax on itself",
            parentPostingId: id,
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe(
        "folio_posting_does_not_derive_from_itself",
      );
    });
  });
});

describe("the sign the balance is read with", () => {
  it("refuses a payment that would add to what is owed", async () => {
    // The defect the constraint exists for: it would not throw anywhere else. A
    // payment stored positive doubles the balance and reads as a guest who owes
    // twice what they do.
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(folioPosting).values(
          aRoomCharge(folioId, {
            type: "PAYMENT",
            amount: 900_000n,
            description: "Card payment",
          }),
        ),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe("folio_posting_sign_matches_type");
    });
  });

  it("refuses a charge that would reduce it", async () => {
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .insert(folioPosting)
          .values(aRoomCharge(folioId, { amount: -1_000_000n })),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe("folio_posting_sign_matches_type");
    });
  });

  it("takes a refund as money going back out", async () => {
    // A refund undoes a payment, so it carries a charge's sign. A guest who
    // overpaid 200,000 ₫ and was refunded it is settled, not owed twice.
    await onAFolio(async (tx, folioId) => {
      await tx.insert(folioPosting).values([
        aRoomCharge(folioId, {
          type: "PAYMENT",
          amount: -200_000n,
          description: "Deposit",
        }),
        aRoomCharge(folioId, {
          type: "REFUND",
          amount: 200_000n,
          description: "Deposit returned",
        }),
      ]);

      expect(await balanceOf(tx, folioId)).toBe(0n);
    });
  });

  it("takes a reversal in whichever direction the line it undoes ran", async () => {
    // The one type the sign rule leaves free, and it has to be: reversing a
    // payment is positive and reversing a charge is negative, and both are the
    // same correction.
    await onAFolio(async (tx, folioId) => {
      const paymentId = await post(
        tx,
        aRoomCharge(folioId, {
          type: "PAYMENT",
          amount: -200_000n,
          description: "Deposit",
        }),
      );

      await post(
        tx,
        aRoomCharge(folioId, {
          type: "REVERSAL",
          amount: 200_000n,
          description: "Reverses a deposit posted to the wrong folio",
          reversesPostingId: paymentId,
        }),
      );

      expect(await balanceOf(tx, folioId)).toBe(0n);
    });
  });
});

describe("who wrote the line", () => {
  it("leaves the author unset on a system posting", async () => {
    // The night audit and the gateway's IPN both write rows no person authored,
    // and a placeholder staff account standing in for them would make an
    // automated posting indistinguishable from one somebody made.
    await onAFolio(async (tx, folioId) => {
      const postingId = await post(tx, aRoomCharge(folioId));

      const [stored] = await tx
        .select()
        .from(folioPosting)
        .where(eq(folioPosting.id, postingId));

      expect(stored?.postedBy).toBeNull();
    });
  });

  it("refuses an author who is not a staff account", async () => {
    await onAFolio(async (tx, folioId) => {
      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .insert(folioPosting)
          .values(aRoomCharge(folioId, { postedBy: ABSENT_ID })),
      );

      expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

/** A line the folio would accept. Each test overrides the one field it is
 *  about, so a refusal names the constraint under test and not a second one the
 *  fixture happened to break. */
function aRoomCharge(
  folioId: string,
  overrides: Partial<typeof folioPosting.$inferInsert> = {},
): typeof folioPosting.$inferInsert {
  return {
    folioId,
    type: "ROOM_CHARGE" as const,
    amount: 1_000_000n,
    description: "Room 301, one night",
    businessDate: BUSINESS_DATE,
    ...overrides,
  };
}

/** Writes a line and hands back its id. */
async function post(
  tx: Tx,
  values: typeof folioPosting.$inferInsert,
): Promise<string> {
  const [written] = await tx.insert(folioPosting).values(values).returning();

  return written!.id;
}

/** What the folio still owes, the way `FolioPort.getBalance` will answer it:
 *  summed from the rows, never read from a column. */
async function balanceOf(tx: Tx, folioId: string): Promise<bigint> {
  const [summed] = await tx
    .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  // Postgres widens `sum(bigint)` to numeric and the driver hands numerics back
  // as text, which is the one shape that cannot lose a đồng on the way here.
  return BigInt(summed?.balance ?? "0");
}

/**
 * Runs the body against an open folio on a booking of its own, and rolls the
 * whole thing back.
 *
 * The rollback is the file's cleanup, because the table under test has no other:
 * its rows cannot be deleted, and the booking underneath them cannot be released
 * while they exist.
 */
async function onAFolio(
  body: (tx: Tx, folioId: string) => Promise<void>,
): Promise<void> {
  await rolledBack(async (tx) => {
    const bookingId = await aBooking(tx);
    const [opened] = await tx.insert(folio).values({ bookingId }).returning();

    await body(tx, opened!.id);
  });
}

const ROLLBACK = Symbol("rollback");

async function rolledBack(body: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await body(tx);

      throw ROLLBACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLBACK) {
      throw thrown;
    }
  }
}

/** A stay to hang a folio on. */
async function aBooking(tx: Tx): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await tx
    .insert(booking)
    .values({
      reference: `MRV-FOLIO-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId: await someRoomType(tx),
      checkInDate: BUSINESS_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning();

  return stay!.id;
}

/** Whatever room type the database already holds, and one of its own only if it
 *  holds none. The five codes and the display orders are unique, so a file that
 *  is not the owner of the property cannot simply add a sixth. */
async function someRoomType(tx: Tx): Promise<string> {
  const [existing] = await tx.select({ id: roomType.id }).from(roomType).limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await tx
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning();

  return created!.id;
}

/** A catalog row for a service line to name. Written inside the transaction, so
 *  it leaves with everything else. */
async function aCatalogItem(tx: Tx): Promise<string> {
  const [item] = await tx
    .insert(serviceCatalog)
    .values({
      code: `EXTRA_BED_${bookingOrdinal}`,
      name: "Extra bed",
      unitPriceGross: 350_000n,
      taxClass: "STANDARD",
    })
    .returning();

  return item!.id;
}

type Refusal = { code: string; message: string; constraint?: string };

/**
 * The refusal a write provoked, taken inside a savepoint.
 *
 * The savepoint is what lets a test carry on after one: an aborted transaction
 * refuses every statement that follows, and half the point here is to look at
 * the row the database declined to change. Fails the test if the write was
 * accepted.
 */
async function refused(
  tx: Tx,
  write: (savepoint: Tx) => Promise<unknown>,
): Promise<Refusal> {
  try {
    await tx.transaction(async (savepoint) => {
      await write(savepoint);
    });
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE, message and constraint name out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed to
 * be one deep.
 */
function refusalOf(error: unknown): Refusal {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code, constraint } = current as Error & {
      code?: unknown;
      constraint?: unknown;
    };

    if (typeof code === "string") {
      return {
        code,
        message: current.message,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}
