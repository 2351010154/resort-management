// The two routes an accountant reaches for after being paged — `FR-PAY-05`,
// over HTTP against a real Postgres, the real capability guard and rows the
// sweep's own tables hold.
//
// `payment-reconciliation-sweep.e2e-spec.ts` proves the night: the comparison
// runs, the disagreements are written down and somebody's phone rings.
// `reconciliation.service.spec.ts` proves the classification from literals. What
// neither can assert is the half that only exists once the routes are mounted,
// and that is what this file is for:
//
// 1. **The routes are governed by the matrix row they declare**, driven off
//    `CAPABILITIES` rather than off a list written out here — `rbac-matrix.md`
//    §4's own instruction. `payment.reconcile` was a key nothing consumed until
//    these two routes, so this is the first assertion that the row governs
//    anything at all.
// 2. **A clean day and a day nobody swept are different answers.** This is the
//    distinction `schema/reconciliation.ts` gives the run table its whole
//    existence for, and it is only visible from outside: one is a 200 carrying
//    an empty list and an instant, the other is a 404. A route that answered
//    both with `{ discrepancies: [] }` would tell an accountant a night was
//    agreed when nobody had looked at it.
// 3. **The date range filters on the business date**, which is the day the money
//    belongs to and not the day the sweep happened to run — `property-and-
//    tariff.md` §2, and the column both tables are keyed on.
// 4. **Both đồng figures and the payment they name survive the crossing.** The
//    amounts are `bigint` columns and the wire carries decimal text, so a route
//    that let one through a `number` would round somebody's discrepancy into
//    agreement.
// 5. **The ceiling on the run list is reported rather than applied in
//    silence.** A range wider than it answers with the newest nights inside
//    that range, which a caller counting rows cannot tell from a complete
//    answer — so the truncation travels as a field, and this is where it is
//    driven true against a range that really does overflow.
//
// The rows are inserted directly rather than swept into place. The states worth
// reading back are states no happy path produces — money the gateway took that
// never reached an account, and two systems disagreeing about a figure — and
// driving them through the sweep would mean staging a gateway to produce them,
// which is the sweep suite's job and not this one's.
//
// Both reconciliation tables and the ledger under them are truncated on the way
// in and on the way out. A posting cannot be deleted, and a discrepancy left
// standing is a row the next file's counts would include.

import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { gte, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { folio } from "../src/database/schema/folio.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import {
  paymentDiscrepancy,
  paymentReconciliationRun,
} from "../src/database/schema/reconciliation.js";
import {
  capability,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import { permits } from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import { LONGEST_RUN_LIST } from "../src/modules/payment/reconciliation.service.js";

/** The day two reports disagreed on, and the subject of most of this file. */
const DISPUTED_DAY = "2027-09-14";

/** Reconciled, and found to agree. It is still a run, and still a row. */
const CLEAN_DAY = "2027-09-13";

/** Older, so the range filters have something to leave out. */
const EARLIER_DAY = "2027-09-10";

/** Never swept — the day the property is still trading. There is no run for it
 *  and there must not be, which is why it is the 404 case. */
const UNSWEPT_DAY = "2027-09-15";

/** References in the shape `payment.service.ts` mints them. Ordered so that the
 *  reference sort the route promises is visible: `4c…` precedes `8b…`. */
const UNPAID_HERE = "4c1f7a3e8d9b" + "0f6e5a4b3c2d1e0f".repeat(3);
const DISPUTED = "8b2e6d4c0a91" + "1a2b3c4d5e6f7081".repeat(3);
const LONG_AGO = "2f9a1c7b5e30" + "9182736455647382".repeat(3);

/** What this property recorded, and what the gateway's report claimed. Ten
 *  thousand đồng apart, which is the figure somebody has to explain. */
const ON_THE_LEDGER = 1_450_000n;
const AT_THE_GATEWAY = 1_460_000n;

/** Money the gateway says it took under an attempt with no payment here. */
const NEVER_LANDED = 980_000n;

/** Where the run rows that prove the ceiling start, far enough from the three
 *  named days above that no assertion about them can see one. */
const BULK_FIRST_DAY = "2029-01-01";

/** A route known to be guarded, so a 401 below is the guard running rather than
 *  a path that answers nobody. */
const A_GUARDED_PATH = "/housekeeping/board";

const ARRIVAL_DATE = "2027-09-12";
const DEPARTURE_DATE = "2027-09-15";

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because the row is asserted against all five. */
const STAFF = {
  MANAGER: {
    email: "quan.ly.doi.soat@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "le.tan.doi.soat@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "buong.phong.doi.soat@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "ke.toan.doi.soat@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "quan.tri.doi.soat@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

let app: INestApplication;
let db: Database;
/** The payment the disputed day's mismatch names. */
let disputedPaymentId: string;
const tokens = new Map<StaffRole, string>();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheRecord();

  // The five accounts are created by email and the column is unique, so they
  // have to be the only five — no seed owns this table.
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_user, staff_session restart identity cascade`,
  );

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  disputedPaymentId = await aPaymentOnFile();

  await threeNightsOnFile();
}, 120_000);

afterAll(async () => {
  await clearTheRecord();
  await app?.close();
});

describe("the capability the two reconciliation routes declare", () => {
  // §4's obligation for the row these routes are the first consumers of. Both
  // are reads, so the grant is asked about as a read — a role holding 👁 over
  // this row must reach them, and the declaration is what decides that.
  for (const role of STAFF_ROLES) {
    const admitted = permits(staffGrant("payment.reconcile", role), "read");

    it(`${admitted ? "admits" : "refuses"} ${role} on both`, async () => {
      const list = await as(role).get(runsPath());
      const day = await as(role).get(dayPath(DISPUTED_DAY));

      if (admitted) {
        expect(list.status).toBe(200);
        expect(day.status).toBe(200);
      } else {
        expect(list.status).toBe(403);
        expect(day.status).toBe(403);
      }
    });
  }

  it("sits under the section the folio rows sit under", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that the row
    // is the one the routes are meant to be under, and not a key some later edit
    // renamed out from under routes that still answer.
    expect(capability("payment.reconcile").section).toBe("Folio and money");
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused. The control case is the proof that the
    // guard is installed at all.
    expect((await http().get(A_GUARDED_PATH)).status).toBe(401);

    expect((await http().get(runsPath())).status).toBe(401);
    expect((await http().get(dayPath(DISPUTED_DAY))).status).toBe(401);
  });
});

describe("the nights that were looked at", () => {
  it("lists every run newest first, counting what each one found", async () => {
    const response = await as("ACCOUNTANT").get(runsPath()).expect(200);

    expect(response.body.runs.map((run: { businessDate: string }) => run.businessDate)).toEqual([
      DISPUTED_DAY,
      CLEAN_DAY,
      EARLIER_DAY,
    ]);

    expect(
      response.body.runs.map(
        (run: { discrepancyCount: number }) => run.discrepancyCount,
      ),
    ).toEqual([2, 0, 1]);

    // Three nights is not a truncated answer, and the flag has to be capable of
    // saying so — otherwise the assertion below that it goes true proves only
    // that the field exists.
    expect(response.body.hasMore).toBe(false);
  });

  it("keeps the clean night on the list, saying it was looked at and found nothing", async () => {
    // The whole reason the run table exists. A list drawn from the
    // discrepancies would have dropped this day, and a night missing from it
    // could equally be one that agreed or one nobody swept.
    const response = await as("MANAGER").get(runsPath()).expect(200);

    const clean = response.body.runs.find(
      (run: { businessDate: string }) => run.businessDate === CLEAN_DAY,
    );

    expect(clean.discrepancyCount).toBe(0);
    expect(Date.parse(clean.reconciledAt)).not.toBeNaN();
  });

  it("names no night the sweep has not reached", async () => {
    const response = await as("ACCOUNTANT").get(runsPath()).expect(200);

    expect(
      response.body.runs.some(
        (run: { businessDate: string }) => run.businessDate === UNSWEPT_DAY,
      ),
    ).toBe(false);
  });

  it("filters on the business date, both ends included", async () => {
    const response = await as("ACCOUNTANT")
      .get(runsPath({ from: CLEAN_DAY, to: DISPUTED_DAY }))
      .expect(200);

    expect(response.body.runs.map((run: { businessDate: string }) => run.businessDate)).toEqual([
      DISPUTED_DAY,
      CLEAN_DAY,
    ]);
  });

  it("takes either end on its own", async () => {
    const since = await as("ACCOUNTANT")
      .get(runsPath({ from: CLEAN_DAY }))
      .expect(200);

    expect(since.body.runs).toHaveLength(2);

    const until = await as("ACCOUNTANT")
      .get(runsPath({ to: CLEAN_DAY }))
      .expect(200);

    expect(until.body.runs.map((run: { businessDate: string }) => run.businessDate)).toEqual([
      CLEAN_DAY,
      EARLIER_DAY,
    ]);
  });

  it("answers a range with nothing in it with an empty list rather than a refusal", async () => {
    // Nights nobody has traded yet are not an error. The question was asked and
    // the honest answer is that no day in it has been reconciled.
    const response = await as("ACCOUNTANT")
      .get(runsPath({ from: "2028-01-01", to: "2028-01-31" }))
      .expect(200);

    expect(response.body.runs).toEqual([]);
  });

  it("caps a range wider than the ceiling and says on the answer that it did", async () => {
    // One night past the ceiling, which is the only count that separates the
    // two things being asserted: a list of exactly `LONGEST_RUN_LIST` is what a
    // complete answer and a truncated one both look like, so the flag is the
    // whole of the difference a caller can read.
    const nights = consecutiveDays(BULK_FIRST_DAY, LONGEST_RUN_LIST + 1);

    await db
      .insert(paymentReconciliationRun)
      .values(nights.map((businessDate) => ({ businessDate })));

    // Removed whatever the assertions do, because every other case in this file
    // reads the unbounded list and counts what comes back. A failure here that
    // left these rows standing would be reported against the tests that ran
    // next rather than against this one.
    try {
      const response = await as("ACCOUNTANT")
        .get(runsPath({ from: nights[0], to: nights.at(-1) }))
        .expect(200);

      expect(response.body.runs).toHaveLength(LONGEST_RUN_LIST);
      expect(response.body.hasMore).toBe(true);

      // Newest first, so what the cap drops is the oldest night in the range
      // and not an arbitrary one — which is what makes a narrower range the
      // way to reach the rest.
      expect(response.body.runs[0].businessDate).toBe(nights.at(-1));
      expect(response.body.runs.at(-1).businessDate).toBe(nights[1]);
    } finally {
      await db
        .delete(paymentReconciliationRun)
        .where(gte(paymentReconciliationRun.businessDate, BULK_FIRST_DAY));
    }
  });

  it("refuses a range that ends before it starts", async () => {
    const response = await as("ACCOUNTANT").get(
      runsPath({ from: DISPUTED_DAY, to: EARLIER_DAY }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a date that is not one", async () => {
    // Caught by the contract, which parses the date rather than matching its
    // shape — 31 February has the shape and is not a day.
    expect(
      (await as("ACCOUNTANT").get(runsPath({ from: "2027-02-31" }))).status,
    ).toBe(400);
  });
});

describe("one night in full", () => {
  it("hands over both figures and the payment somebody has to look at", async () => {
    const response = await as("ACCOUNTANT")
      .get(dayPath(DISPUTED_DAY))
      .expect(200);

    expect(response.body.businessDate).toBe(DISPUTED_DAY);
    expect(Date.parse(response.body.reconciledAt)).not.toBeNaN();

    // Ordered by the attempt reference, which is `compare`'s own order — so the
    // same night read twice lists the same rows the same way.
    expect(
      response.body.discrepancies.map(
        (row: { attemptReference: string }) => row.attemptReference,
      ),
    ).toEqual([UNPAID_HERE, DISPUTED]);

    const [missing, mismatch] = response.body.discrepancies;

    // Money the gateway says it took against an attempt this property has no
    // payment for: one figure, and no row to point at.
    expect(missing).toMatchObject({
      kind: "MISSING_LOCALLY",
      gatewayAmount: NEVER_LANDED.toString(),
      ledgerAmount: null,
      paymentId: null,
    });

    // Both figures, to the đồng, and the payment they disagree about. Decimal
    // text on the wire — `money.ts` says why an amount is never a JSON number.
    expect(mismatch).toMatchObject({
      kind: "AMOUNT_MISMATCH",
      gatewayAmount: AT_THE_GATEWAY.toString(),
      ledgerAmount: ON_THE_LEDGER.toString(),
      paymentId: disputedPaymentId,
    });

    expect(Date.parse(mismatch.observedAt)).not.toBeNaN();
  });

  it("answers a night that agreed with an empty list and the moment it was checked", async () => {
    const response = await as("ACCOUNTANT").get(dayPath(CLEAN_DAY)).expect(200);

    expect(response.body.discrepancies).toEqual([]);
    expect(Date.parse(response.body.reconciledAt)).not.toBeNaN();
  });

  it("refuses a night nobody has reconciled, rather than reporting it clean", async () => {
    // The pair of answers this route exists to keep apart. A 200 with an empty
    // list here would tell an accountant the day was agreed when the property is
    // still trading it.
    const response = await as("ACCOUNTANT").get(dayPath(UNSWEPT_DAY));

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).toContain(UNSWEPT_DAY);
  });

  it("refuses a date that is not one", async () => {
    expect((await as("ACCOUNTANT").get(dayPath("2027-02-31"))).status).toBe(400);
    expect((await as("ACCOUNTANT").get(dayPath("last-tuesday"))).status).toBe(
      400,
    );
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

/** The call as one member of staff. */
function as(role: StaffRole): request.Agent {
  return request
    .agent(app.getHttpServer())
    .set("Authorization", `Bearer ${tokens.get(role)!}`);
}

function runsPath(range: { from?: string; to?: string } = {}): string {
  const query = new URLSearchParams(
    Object.entries(range).filter(([, value]) => value !== undefined),
  ).toString();

  return `/payments/reconciliations${query ? `?${query}` : ""}`;
}

const dayPath = (businessDate: string) =>
  `/payments/reconciliations/${businessDate}`;

/**
 * A run of consecutive calendar dates, as the wire spells them.
 *
 * Plain UTC day arithmetic, which is all this needs: these are rows in a `date`
 * column and nothing about them is a business date, so `BusinessDateService`'s
 * rollover hour has no bearing on either end.
 */
function consecutiveDays(first: string, count: number): string[] {
  const ONE_DAY_MS = 86_400_000;
  const start = Date.parse(`${first}T00:00:00Z`);

  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * ONE_DAY_MS).toISOString().slice(0, 10),
  );
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/**
 * The payment the disputed night's mismatch names.
 *
 * A discrepancy of that kind is required by
 * `payment_discrepancy_kind_matches_the_sides` to point at a payment row, so
 * the stay, the account and the money under it all have to exist for the row to
 * be insertable at all. Inserted rather than booked through the funnel: nothing
 * here depends on rates, inventory or a hold.
 */
async function aPaymentOnFile(): Promise<string> {
  const [type] = await db
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
    .returning({ id: roomType.id });

  const [stay] = await db
    .insert(booking)
    .values({
      reference: "MRV-RECON-0001",
      state: "CONFIRMED",
      roomTypeId: type!.id,
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 4_350_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const [account] = await db
    .insert(folio)
    .values({ bookingId: stay!.id })
    .returning({ id: folio.id });

  const [taken] = await db
    .insert(payment)
    .values({
      folioId: account!.id,
      method: "VNPAY",
      status: "SUCCESS",
      amount: ON_THE_LEDGER,
      attemptReference: DISPUTED,
      gatewayTransactionId: "14528901",
      paidAt: new Date(`${DISPUTED_DAY}T12:00:00+07:00`),
    })
    .returning({ id: payment.id });

  return taken!.id;
}

/**
 * Three nights on file: one with two disagreements, one that agreed, and an
 * older one that the range filters leave out.
 *
 * The instants are given rather than defaulted, so "newest first" is asserted
 * against dates this file chose and not against insertion order.
 */
async function threeNightsOnFile(): Promise<void> {
  await db.insert(paymentReconciliationRun).values([
    {
      businessDate: DISPUTED_DAY,
      reconciledAt: new Date(`${DISPUTED_DAY}T21:05:00Z`),
    },
    {
      businessDate: CLEAN_DAY,
      reconciledAt: new Date(`${CLEAN_DAY}T21:05:00Z`),
    },
    {
      businessDate: EARLIER_DAY,
      reconciledAt: new Date(`${EARLIER_DAY}T21:05:00Z`),
    },
  ]);

  await db.insert(paymentDiscrepancy).values([
    {
      businessDate: DISPUTED_DAY,
      attemptReference: UNPAID_HERE,
      kind: "MISSING_LOCALLY",
      gatewayAmount: NEVER_LANDED,
      ledgerAmount: null,
      paymentId: null,
    },
    {
      businessDate: DISPUTED_DAY,
      attemptReference: DISPUTED,
      kind: "AMOUNT_MISMATCH",
      gatewayAmount: AT_THE_GATEWAY,
      ledgerAmount: ON_THE_LEDGER,
      paymentId: disputedPaymentId,
    },
    {
      businessDate: EARLIER_DAY,
      attemptReference: LONG_AGO,
      kind: "MISSING_LOCALLY",
      gatewayAmount: NEVER_LANDED,
      ledgerAmount: null,
      paymentId: null,
    },
  ]);
}

/** Both reconciliation tables and the ledger under them, emptied. A posting
 *  cannot be deleted, so `truncate` is the only way back. */
async function clearTheRecord(): Promise<void> {
  await db.execute(
    sql`truncate payment_discrepancy, payment_reconciliation_run, payment, folio_posting, folio restart identity cascade`,
  );
}
