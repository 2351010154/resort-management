// Handing money back — `FR-PAY-04`, against a real Postgres.
//
// `folio-service.e2e-spec.ts` asserts what a gross figure becomes and what a
// payment does to the balance. This asserts the two ways money leaves: the one
// §4's grid decides, and the one a manager decides.
//
// What is under test here is arithmetic and refusal, which is why the stays
// below are inserted rather than booked through the routes. Every row of §4's
// grid turns on a fact about the stay — the plan it was sold on, the state it
// ended in, and for a cancellation the *instant* it arrived against an 18:00
// deadline — and a suite that reached those states through the API would be
// asserting the grid against whatever the wall clock happened to be on the day
// it ran. Written directly, each case names the one fact it is about.
// `folio-refunds.e2e-spec.ts` is the file that proves the routes, the
// capabilities and the attribution.
//
// The claims:
//
// 1. **The amount is the grid's, computed off the nights the booking froze.**
//    Every expected figure below is worked by hand from three unequal nights —
//    §4 charges "the first night" and "the remaining nights at 50%", and neither
//    may be approximated by dividing a total by a count. A grid that divided
//    would agree with a fixture of three equal nights and with nothing else.
// 2. **The basis is on the charge and only on the charge.**
//    `folio_posting_names_a_basis_exactly_when_a_policy_charge` permits the
//    column on one type, so what the grid decided is recorded on the
//    `POLICY_CHARGE` row and the `REFUND` beside it carries money and no
//    classification.
// 3. **The refund is what the account is over-paid by once the charge stands**,
//    which is §4's own wording: every cell is a penalty on top of what the folio
//    already carries, never a settlement total.
// 4. **`NFR-02` survives both.** Σ postings = Σ payments + outstanding is the
//    plain sum of the rows, asserted after each refund against the ledger itself
//    rather than against the service's own reading of it.
// 5. **A stay that has not ended is refused**, and so is a second application of
//    a grid that prices the whole of what ended the stay.
//
// The rows are committed rather than rolled back, and the ledger is truncated on
// the way in and out — `folio-service.e2e-spec.ts` gives the reason and pays the
// same cost.
//
// The tax figures are deliberately unreal — 12.34% VAT over a 3.21% service
// charge. §8 forbids the tree from carrying a real rate. Nothing here asserts
// the split; the room charges exist only so that an early departure has nights
// already posted to count.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type {
  BookingState,
  CancellationReason,
  RatePlanCode,
  VndAmount,
} from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folioPosting } from "../src/database/schema/folio.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

const CHECK_IN = "2027-09-05";
const CHECK_OUT = "2027-09-08";

/**
 * Where an early departure leaves the stay: one night slept and two given back.
 *
 * The date is what makes the stay *shortened* rather than merely in progress —
 * the released nights keep their `booking_night` rows, so the gap between the
 * three sold and the one still covered is the only record that a departure was
 * brought forward at all.
 */
const DEPARTED_AFTER_ONE_NIGHT = "2027-09-06";

/** The trading day every line below is filed under. */
const BUSINESS_DATE = parseDate("2027-09-02");

/**
 * Three nights, no two alike and none a multiple of another.
 *
 * §4 charges the first night and half of what is left, and both are selections
 * over these amounts rather than fractions of their total. Equal nights would
 * let a grid that divided the stay total by three pass every case here.
 */
const NIGHTS: readonly VndAmount[] = [1_200_000n, 1_000_000n, 1_500_000n];

const FIRST_NIGHT = 1_200_000n;
const FULL_STAY = 3_700_000n;

/** What is left after one night, and half of it — the early-departure row's two
 *  columns, worked by hand. */
const REMAINING_AFTER_ONE_NIGHT = 2_500_000n;
const HALF_OF_REMAINING = 1_250_000n;

/**
 * 18:00 ICT on the third day before arrival — §4's deadline for the stay above,
 * written out rather than derived, so this suite and the calculator agree by
 * both being right rather than by sharing a function.
 */
const ON_THE_DEADLINE = new Date("2027-09-02T18:00:00+07:00");
const AFTER_THE_DEADLINE = new Date(ON_THE_DEADLINE.getTime() + 1);

const A_MANAGER = {
  email: "quan.ly@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
} as const;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let deskId: string;
let roomTypeId: string;

// References are unique and every case here opens a stay of its own. Counted
// rather than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
  );

  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  const [created] = await db
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

  roomTypeId = created!.id;

  const [staff] = await db
    .insert(staffUser)
    .values({
      ...A_MANAGER,
      role: "MANAGER",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  deskId = staff!.id;

  folios = new FolioService(db, new SystemConfigService());
});

afterAll(async () => {
  await clearTheLedger();
  await pool?.end();
});

describe("§4's grid, as the lines it becomes", () => {
  it("charges nothing and says which row that was, inside the free window", async () => {
    // On the deadline is inside it — §4 reads "by 18:00", not "before" — and
    // `NONE` is a row of the grid rather than the absence of one. A refund that
    // posted no line here would leave a guest asking why they were not charged.
    const { bookingId } = await aCancelledStay({ at: ON_THE_DEADLINE });

    const posted = await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(posted).toHaveLength(1);
    expect(charge.amount).toBe(0n);
    expect(charge.chargeBasis).toBe("NONE");
  });

  it("charges the first night for a cancellation past the deadline", async () => {
    // A millisecond past it, which is the whole of the difference between this
    // case and the one above.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(FIRST_NIGHT);
    expect(charge.chargeBasis).toBe("FIRST_NIGHT");
  });

  it("charges the first night for a no-show", async () => {
    const bookingId = await aStay({ state: "NO_SHOW" });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(FIRST_NIGHT);
    expect(charge.chargeBasis).toBe("FIRST_NIGHT");
  });

  it("charges a NONREF stay the whole of it, deadline or not", async () => {
    // The plan's column of the grid has one answer for all three rows above.
    const { bookingId } = await aCancelledStay({
      at: ON_THE_DEADLINE,
      plan: "NONREF",
    });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(FULL_STAY);
    expect(charge.chargeBasis).toBe("FULL_STAY");
  });

  it("charges an early departure half of the nights it did not take", async () => {
    // The guest slept one night, which the folio has been charged for. §4 puts
    // what is left at 50% on a refundable plan — over the two remaining nights
    // as they were priced, never over half the stay total.
    const bookingId = await aStay({
      state: "CHECKED_IN",
      departsOn: DEPARTED_AFTER_ONE_NIGHT,
    });

    await aNightPosted(bookingId);

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(HALF_OF_REMAINING);
    expect(charge.chargeBasis).toBe("REMAINING_NIGHTS_HALF");
  });

  it("refuses a guest who is in the building and gave no night back", async () => {
    // `CHECKED_IN` alone is not an early departure. A stay that still covers
    // every night it was sold is a guest mid-stay, and pricing them would post
    // a penalty, settle the account to nothing while they are still in the
    // room, and spend the one application the real departure needs.
    const bookingId = await aStay({ state: "CHECKED_IN" });

    await aNightPosted(bookingId);
    await paid(bookingId, FULL_STAY);

    const refusal = await refused(refundToPolicy(bookingId));

    expect(refusal.code).toBe("CONFLICT");
    expect(await linesOn(bookingId)).not.toContainEqual(
      expect.objectContaining({ type: "POLICY_CHARGE" }),
    );
  });

  it("charges a NONREF early departure all of them", async () => {
    // Not "100% of stay": the night already slept is on the folio, and charging
    // the stay again would bill it twice.
    const bookingId = await aStay({
      state: "CHECKED_IN",
      plan: "NONREF",
      departsOn: DEPARTED_AFTER_ONE_NIGHT,
    });

    await aNightPosted(bookingId);

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(REMAINING_AFTER_ONE_NIGHT);
    expect(charge.chargeBasis).toBe("REMAINING_NIGHTS_FULL");
  });

  it("counts the nights the folio still stands charged for, not the rows it holds", async () => {
    // Two nights posted and one of them reversed is a night the property has
    // agreed did not happen, so one night is spent and two remain — the same
    // answer as the case above, reached through a corrected account. Counting
    // the reversed line would charge for one remaining night instead of two.
    const bookingId = await aStay({
      state: "CHECKED_IN",
      departsOn: DEPARTED_AFTER_ONE_NIGHT,
    });

    await aNightPosted(bookingId);

    const undone = await aNightPosted(bookingId);

    await folios.reversePosting(db, {
      postingId: undone,
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(HALF_OF_REMAINING);
    expect(charge.chargeBasis).toBe("REMAINING_NIGHTS_HALF");
  });

  it("attributes both lines to the member of staff who applied the grid", async () => {
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await paid(bookingId, FULL_STAY);
    await refundToPolicy(bookingId);

    for (const line of await linesOn(bookingId)) {
      expect(line.postedBy).toBe(deskId);
    }
  });

  it("dates the lines by the business date it was handed", async () => {
    // The day the refund was decided, not the day the stay was sold or ended.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.businessDate).toBe(BUSINESS_DATE.toString());
  });
});

describe("a penalty a manager set aside", () => {
  it("posts the grid's line at nothing, and says the grid decided nothing", async () => {
    // The bug this pair of columns exists to close. The waiver is granted under
    // `booking.cancel-waiver` and the grid is applied later under
    // `folio.refund-policy`, by somebody else, in another request — so the
    // booking row is the only thing that can carry the first decision to the
    // second. Without it the penalty landed in full, on a route whose holder has
    // no `folio.reverse-posting` to take it back.
    //
    // A line still goes on. `NONE` is a row of §4's grid rather than the absence
    // of one, and an account that recorded nothing could not tell a waived stay
    // from one nobody ever priced.
    const { bookingId } = await aCancelledStay({
      at: AFTER_THE_DEADLINE,
      waived: true,
    });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(0n);
    expect(charge.chargeBasis).toBe("NONE");
  });

  it("charges the same stay in full when nobody waived it", async () => {
    // The other side of the case above, and the regression guard: identical in
    // every fact except the waiver, so the difference in the figure is the
    // waiver and cannot be anything else.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(FIRST_NIGHT);
    expect(charge.chargeBasis).toBe("FIRST_NIGHT");
  });

  it("waives a guest's change of mind, because the reason prices nothing", async () => {
    // The case a reason-gated design could not express. §4's grid is keyed on
    // the event and the rate plan and has no reason column, so waiving is
    // orthogonal to why the stay ended: a manager may set the penalty aside on
    // a `GUEST_REQUEST`, which is the reason a property would least expect to
    // forgive and precisely the one a "waive only our own faults" rule would
    // have refused.
    const { bookingId } = await aCancelledStay({
      at: AFTER_THE_DEADLINE,
      reason: "GUEST_REQUEST",
      waived: true,
    });

    await refundToPolicy(bookingId);

    expect((await policyChargeOn(bookingId)).amount).toBe(0n);
  });

  it("waives the plan that has no free window either", async () => {
    // `NONREF` charges the whole stay in every row of the grid, so a waiver that
    // only reached the refundable column would leave the largest penalty in the
    // table unwaivable — and `property-and-tariff.md` §4 says every cell.
    const { bookingId } = await aCancelledStay({
      at: AFTER_THE_DEADLINE,
      plan: "NONREF",
      waived: true,
    });

    await refundToPolicy(bookingId);
    const charge = await policyChargeOn(bookingId);

    expect(charge.amount).toBe(0n);
    expect(charge.chargeBasis).toBe("NONE");
  });

  it("hands back the whole prepayment, and settles the account", async () => {
    // What a waiver means in money. The charge is nothing, so what the account
    // is over-paid by is everything the guest handed over — computed by the
    // ledger's own subtraction, exactly as an unwaived refund is.
    const { bookingId } = await aCancelledStay({
      at: AFTER_THE_DEADLINE,
      waived: true,
    });

    await paid(bookingId, FULL_STAY);

    const posted = await refundToPolicy(bookingId);

    expect(posted).toHaveLength(2);
    expect((await refundOn(bookingId)).amount).toBe(FULL_STAY);
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });
});

describe("what the account is over-paid by, once §4's charge stands", () => {
  it("hands back the difference between the payment and the penalty", async () => {
    // §4's cell is a penalty and not a settlement total, so the money returned
    // is the ledger's own subtraction rather than a second figure computed
    // beside it.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await paid(bookingId, FULL_STAY);

    const posted = await refundToPolicy(bookingId);
    const refund = await refundOn(bookingId);

    expect(posted).toHaveLength(2);
    expect(refund.amount).toBe(FULL_STAY - FIRST_NIGHT);
    // Positive, undoing the payment it hands back — `schema/folio.ts`'s sign
    // convention, which is what leaves the settled account at nothing.
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("hands back the whole prepayment when the grid charges nothing", async () => {
    const { bookingId } = await aCancelledStay({ at: ON_THE_DEADLINE });

    await paid(bookingId, FULL_STAY);
    await refundToPolicy(bookingId);

    expect((await refundOn(bookingId)).amount).toBe(FULL_STAY);
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("hands back nothing at all when the stay still owes", async () => {
    // A cancellation nobody prepaid for owes the penalty, and there is no money
    // to return. The charge alone is the honest answer; a `REFUND` of nothing
    // would read as money that moved.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    const posted = await refundToPolicy(bookingId);

    expect(posted).toHaveLength(1);
    expect(
      (await linesOn(bookingId)).filter((line) => line.type === "REFUND"),
    ).toHaveLength(0);
    expect(await folios.getBalance(bookingId)).toBe(FIRST_NIGHT);
  });

  it("returns what is left over the whole account, not what the guest paid", async () => {
    // The stay prepaid in full and carries a charge of its own. What comes back
    // is the credit standing after both that charge and the penalty — which is
    // the figure a refund computed as "payment less penalty" would overstate by
    // exactly the charge, and hand the guest money the property is owed.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });
    const folioId = await folios.ensureFolio(db, bookingId);

    await paid(bookingId, FULL_STAY);
    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: 500_000n,
      businessDate: BUSINESS_DATE,
      description: "A night taken before the stay came apart",
      postedBy: deskId,
    });

    await refundToPolicy(bookingId);

    expect((await refundOn(bookingId)).amount).toBe(
      FULL_STAY - FIRST_NIGHT - 500_000n,
    );
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("leaves NFR-02's identity holding over the rows themselves", async () => {
    // Σ postings = Σ payments + outstanding, summed in SQL rather than through
    // the service, so the identity is checked against the ledger and not against
    // the reading of it.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await paid(bookingId, 2_000_000n);
    await refundToPolicy(bookingId);

    const lines = await linesOn(bookingId);
    const postings = lines
      .filter((line) => line.amount > 0n)
      .reduce<VndAmount>((total, line) => total + line.amount, 0n);
    const payments = lines
      .filter((line) => line.amount < 0n)
      .reduce<VndAmount>((total, line) => total - line.amount, 0n);
    const outstanding = await sumOf(bookingId);

    expect(postings).toBe(payments + outstanding);
    expect(outstanding).toBe(await folios.getBalance(bookingId));
  });
});

describe("a grid that prices what ended the stay, once", () => {
  it("refuses a second application of it", async () => {
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await refundToPolicy(bookingId);

    const refusal = await refused(refundToPolicy(bookingId));

    expect(refusal.code).toBe("CONFLICT");
    // The account is left exactly as the first application wrote it — one
    // charge, and no second line added on the way to the refusal.
    expect(
      (await linesOn(bookingId)).filter(
        (line) => line.type === "POLICY_CHARGE",
      ),
    ).toHaveLength(1);
  });

  it("takes the grid again once the charge has been reversed", async () => {
    // The desk took the charge back, so the account is open to §4 again. A
    // refusal that read the reversed line as a charge still standing would leave
    // the only way forward a discretionary refund, under a capability the desk
    // does not hold.
    const { bookingId } = await aCancelledStay({ at: AFTER_THE_DEADLINE });

    await refundToPolicy(bookingId);

    const [charged] = await folios.reversePosting(db, {
      postingId: (await policyChargeOn(bookingId)).id,
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    expect(charged).toBeDefined();
    await expect(refundToPolicy(bookingId)).resolves.toHaveLength(1);
  });

  it("refuses a stay that has not ended", async () => {
    const bookingId = await aStay({ state: "CONFIRMED" });

    const refusal = await refused(refundToPolicy(bookingId));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain("CONFIRMED");
  });

  it("refuses a stay that was slept out and left on the day", async () => {
    // §4 has no cell for it: the nights were sold, slept and posted, and a
    // credit owed for any other reason is a manager's to give.
    const bookingId = await aStay({ state: "CHECKED_OUT" });

    const refusal = await refused(refundToPolicy(bookingId));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain("CHECKED_OUT");
  });

  it("refuses a stay whose night prices are missing", async () => {
    // The grid scales stored nights and cannot invent them. Answered as a
    // refusal that names the stay rather than as the calculator's `RangeError`
    // arriving at a route as a 500.
    const bookingId = await aStay({ state: "NO_SHOW", nights: [] });

    const refusal = await refused(refundToPolicy(bookingId));

    expect(refusal.code).toBe("CONFLICT");
  });
});

describe("money handed back outside the grid", () => {
  it("posts the manager's figure, with the reason on the line", async () => {
    const bookingId = await aStay({ state: "CHECKED_OUT" });
    const folioId = await folios.ensureFolio(db, bookingId);

    await paid(bookingId, FULL_STAY);

    const postingId = await folios.postOverrideRefund(db, {
      folioId,
      amount: 750_000n,
      reason: "Air conditioning failed on the second night",
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    const refund = await refundOn(bookingId);

    expect(refund.id).toBe(postingId);
    expect(refund.amount).toBe(750_000n);
    expect(refund.description).toContain(
      "Air conditioning failed on the second night",
    );
    expect(refund.postedBy).toBe(deskId);
    // No basis. The column is permitted on a policy charge and on nothing else,
    // and a discretionary refund is precisely a figure the grid did not decide.
    expect(refund.chargeBasis).toBeNull();
  });

  it("moves the balance by exactly what it handed back", async () => {
    const bookingId = await aStay({ state: "CHECKED_OUT" });
    const folioId = await folios.ensureFolio(db, bookingId);

    await paid(bookingId, FULL_STAY);

    const before = await folios.getBalance(bookingId);

    await folios.postOverrideRefund(db, {
      folioId,
      amount: 750_000n,
      reason: "Goodwill",
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    expect(await folios.getBalance(bookingId)).toBe(before + 750_000n);
  });

  it("refuses an amount that is not money going out", async () => {
    // A refund of nothing is a line that says something happened, and a negative
    // one is a payment — a different type with a different sign and its own
    // route. The `CHECK` would refuse the second as a fault; this refuses both
    // as an answer the desk can act on.
    const bookingId = await aStay({ state: "CHECKED_OUT" });
    const folioId = await folios.ensureFolio(db, bookingId);

    for (const amount of [0n, -1n]) {
      const refusal = await refused(
        folios.postOverrideRefund(db, {
          folioId,
          amount,
          reason: "Goodwill",
          businessDate: BUSINESS_DATE,
          postedBy: deskId,
        }),
      );

      expect(refusal.code).toBe("BAD_REQUEST");
    }
  });
});

/** §4's grid, applied to a stay by the manager above. */
async function refundToPolicy(bookingId: string): Promise<readonly string[]> {
  return await folios.postPolicyRefund(db, {
    folioId: await folios.ensureFolio(db, bookingId),
    bookingId,
    businessDate: BUSINESS_DATE,
    postedBy: deskId,
  });
}

/** Money the guest handed over before the stay came apart. */
async function paid(bookingId: string, amount: VndAmount): Promise<void> {
  await folios.postPayment(db, {
    folioId: await folios.ensureFolio(db, bookingId),
    amount,
    businessDate: BUSINESS_DATE,
    description: "Prepayment, card",
    postedBy: deskId,
  });
}

/** One night the audit has already put on the account, as the three lines
 *  `FR-FOL-02` decomposes it into. Answers with the charge's id. */
async function aNightPosted(bookingId: string): Promise<string> {
  return await folios.postRoomCharge(db, {
    folioId: await folios.ensureFolio(db, bookingId),
    grossAmount: 1_000_000n,
    businessDate: BUSINESS_DATE,
    description: "One night, already slept",
  });
}

async function linesOn(
  bookingId: string,
): Promise<readonly (typeof folioPosting.$inferSelect)[]> {
  const folioId = await folios.ensureFolio(db, bookingId);

  return await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId))
    .orderBy(folioPosting.postedAt, folioPosting.id);
}

/** The one line of a type the case under test posted. */
async function oneLineOf(
  bookingId: string,
  type: (typeof folioPosting.$inferSelect)["type"],
): Promise<typeof folioPosting.$inferSelect> {
  const found = (await linesOn(bookingId)).filter((line) => line.type === type);

  if (found.length !== 1) {
    throw new Error(`expected one ${type} line, found ${found.length}`);
  }

  return found[0]!;
}

const policyChargeOn = (bookingId: string) =>
  oneLineOf(bookingId, "POLICY_CHARGE");

const refundOn = (bookingId: string) => oneLineOf(bookingId, "REFUND");

/**
 * The balance the long way round: summed in SQL from the rows themselves, so
 * `NFR-02` is checked against the database rather than against the service's own
 * query. `sum(bigint)` widens to `numeric` and the driver hands it back as text,
 * which is the one route that cannot lose a đồng.
 */
async function sumOf(bookingId: string): Promise<VndAmount> {
  const folioId = await folios.ensureFolio(db, bookingId);

  const [summed] = await db
    .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  return BigInt(summed?.balance ?? "0");
}

/** A stay in the state the case is about, with the nights it was sold on. */
async function aStay(stay: {
  state: BookingState;
  plan?: RatePlanCode;
  endedAt?: Date;
  reason?: CancellationReason;
  /** Set when a manager put §4's grid aside, which is a fact about the row and
   *  never about the reason code beside it. */
  waived?: boolean;
  nights?: readonly VndAmount[];
  /**
   * The departure the stay currently claims, where an early one has moved it
   * back. Written the way `assignment.service.ts` writes it — the date shortens
   * and the `booking_night` rows of the released nights stay, because they are
   * the basis of the charge. A case that leaves this alone is a stay nobody
   * shortened, which is what §4's last row is refused for.
   */
  departsOn?: string;
}): Promise<string> {
  bookingOrdinal += 1;

  const cancelled = stay.state === "CANCELLED";
  // The moment the cancellation arrived, which is the one fact §4's deadline is
  // measured against. Its own column rather than `updated_at`, so a case that
  // writes an instant here is stating the fact rather than leaning on the row
  // not having been touched since.
  const cancelledAt = cancelled ? (stay.endedAt ?? new Date()) : null;
  // Both waiver columns or neither —
  // `booking_names_a_waiver_authority_exactly_when_waived`. The manager is the
  // one this suite opened.
  const waivedAt = stay.waived ? cancelledAt : null;

  const [created] = await db
    .insert(booking)
    .values({
      reference: `MRV-REFUND-${String(bookingOrdinal).padStart(4, "0")}`,
      state: stay.state,
      // `booking_reason_exactly_when_cancelled` makes the pair a biconditional.
      cancellationReason: cancelled
        ? (stay.reason ?? "GUEST_REQUEST")
        : null,
      cancelledAt,
      penaltyWaivedAt: waivedAt,
      penaltyWaivedBy: waivedAt === null ? null : deskId,
      roomTypeId,
      checkInDate: CHECK_IN,
      checkOutDate: stay.departsOn ?? CHECK_OUT,
      ratePlanCode: stay.plan ?? "STANDARD",
      adults: 2,
      quotedStayTotalGross: FULL_STAY,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const bookingId = created!.id;
  const nights = stay.nights ?? NIGHTS;

  if (nights.length > 0) {
    await db.insert(bookingNight).values(
      nights.map((standardGross, offset) => ({
        bookingId,
        stayDate: parseDate(CHECK_IN).add({ days: offset }).toString(),
        standardGross,
      })),
    );
  }

  return bookingId;
}

/** A stay a guest cancelled at a stated instant — the one row of the grid that
 *  turns on a clock rather than on a state. */
async function aCancelledStay(cancellation: {
  at: Date;
  plan?: RatePlanCode;
  reason?: CancellationReason;
  waived?: boolean;
}): Promise<{ bookingId: string }> {
  return {
    bookingId: await aStay({
      state: "CANCELLED",
      plan: cancellation.plan,
      reason: cancellation.reason,
      waived: cancellation.waived,
      endedAt: cancellation.at,
    }),
  };
}

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is
 *  the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}

/** The refusal a call provoked. Fails the case if the service accepted it. */
async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the service accepted a call it should have refused");
}
