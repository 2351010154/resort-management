// The service that writes the account and reads its balance — `FR-FOL-01`,
// `FR-FOL-02` and `NFR-02`, against a real Postgres.
//
// `folio-storage.e2e-spec.ts` asserts what the tables will and will not hold.
// This asserts what is done with them: that a gross figure becomes three lines
// summing back to it at the rates in force on the business date, that a payment
// is stored as the negation of what the guest handed over, that a correction is
// a new row and never twice, and that after every one of those the identity
// `NFR-02` states still holds over real rows.
//
// **The rows are committed rather than rolled back**, which is the opposite of
// the storage spec's arrangement and is deliberate. The claim under test here is
// `FolioPort.getBalance`, and the port takes a booking id and no executor: it
// reads on the pool, exactly as the check-out guard will call it. A suite that
// wrote its fixtures inside an open transaction would be asking that method to
// see rows no other connection can, so it would have to be tested through some
// other door than the one `booking` uses. The cost is cleanup, and this file
// pays it — `folio_posting` cannot be deleted, so the ledger is truncated on the
// way in and on the way out, and a later file's `seedDatabase` finds no folio
// standing between it and the bookings it clears.
//
// No Nest application is booted. Every write takes its executor as an argument,
// so the subject is reachable with a `new` and this file stays independent of
// where the module is registered — `folio-check-out.e2e-spec.ts` is the one that
// asserts the registration.
//
// The figures are deliberately unreal — 12.34% standard VAT against a 24.68%
// reduced one, over a 3.21% service charge, a day rolling at 11:00. §8 forbids
// the tree from carrying a rate, and a fixture that read like a property's real
// one would be that defect wearing a test's clothes. The reduced rate is the
// larger of the two on purpose, so a case asserting which rate a business date
// resolved to cannot pass by having them the right way round for the wrong
// reason.

import { noAccrual } from "./accrual.js";
import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
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

const BUSINESS_DATE = parseDate("2027-09-02");
const DEPARTURE_DATE = parseDate("2027-09-05");

/** One night at the price the guest agreed to, gross. */
const A_NIGHT = 1_000_000n;

// What the rates above decompose that night into, worked by hand rather than by
// calling the function under the service: an expectation computed the same way
// as the code would agree with it however wrong both were. These three are what
// tie the posting to the row in `system_config` — no other pair of rates
// produces them.
//
// The standard rate is the one in force here, because `CONFIGURED` names no
// relief window and every date therefore resolves to it.
const NET_CHARGE = 862_470n;
const SERVICE_CHARGE = 27_685n;
const VAT = 109_845n;

// The same night under the reduced rate, worked the same way. It is the triple
// the posting must produce on a business date the relief window covers, and no
// digit of it is shared with the standard one.
const NET_CHARGE_UNDER_RELIEF = 777_109n;
const SERVICE_CHARGE_UNDER_RELIEF = 24_945n;
const VAT_UNDER_RELIEF = 197_946n;

/** What an `ADMIN` moves the VAT rate to, in the case that watches for it. */
const EDITED_VAT_RATE_BPS = 4_321;

/** A relief window around the business date every case here posts on. */
const WINDOW_OPENS = "2027-07-01";
const WINDOW_CLOSES = "2027-12-31";

/** A relief window that has already lapsed by the time that date arrives. */
const LAPSED_WINDOW_OPENS = "2027-01-01";
const LAPSED_WINDOW_CLOSES = "2027-06-30";

const A_RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
} as const;

// A uuid no row has.
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let deskId: string;
let roomTypeId: string;

// References are unique and most cases here open an account of their own.
// Counted rather than drawn, so a failing run reproduces.
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

  await store(CONFIGURED);

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
      ...A_RECEPTIONIST,
      role: "RECEPTIONIST",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  deskId = staff!.id;

  folios = new FolioService(db, new SystemConfigService(), noAccrual);
});

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, a folio would hold a booking that the next file's
  // `seedDatabase` cannot clear, and the failure would surface three files away
  // from its cause.
  await clearTheLedger();
  await pool?.end();
});

describe("the account a stay runs up", () => {
  it("opens one for a booking that has none", async () => {
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    const [opened] = await db.select().from(folio).where(eq(folio.id, folioId));

    expect(opened?.bookingId).toBe(bookingId);
    expect(opened?.state).toBe("OPEN");
    expect(opened?.closedAt).toBeNull();
  });

  it("hands back the same account the second time it is asked", async () => {
    // `FR-FOL-01`: one folio per stay. Two accounts each summing to zero is not
    // the claim the check-out guard reads.
    const bookingId = await aBooking();

    const first = await folios.ensureFolio(db, bookingId);
    const second = await folios.ensureFolio(db, bookingId);

    expect(second).toBe(first);

    const accounts = await db
      .select({ id: folio.id })
      .from(folio)
      .where(eq(folio.bookingId, bookingId));

    expect(accounts).toHaveLength(1);
  });

  it("refuses a stay that does not exist", async () => {
    const refusal = await refused(folios.ensureFolio(db, ABSENT_ID));

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("the balance is the postings and nothing else", () => {
  it("answers nothing for a stay with no account at all", async () => {
    // The state every booking is in until something needs a folio, and the one
    // the check-out guard must not read as unsettled: `!== 0n` refuses in both
    // directions, so a stay that was never charged has to come back at zero.
    expect(await folios.getBalance(await aBooking())).toBe(0n);
  });

  it("answers nothing for an account with no lines", async () => {
    const bookingId = await aBooking();

    await folios.ensureFolio(db, bookingId);

    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("is what was charged less what was paid", async () => {
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
    });

    await folios.postPayment(db, {
      folioId,
      amount: 400_000n,
      businessDate: BUSINESS_DATE,
      description: "Card payment",
      postedBy: deskId,
    });

    expect(await folios.getBalance(bookingId)).toBe(600_000n);
    // The same figure the rows themselves add up to. The port is a `sum` and
    // there is no second place the answer could have come from.
    expect(await folios.getBalance(bookingId)).toBe(await sumOf(folioId));
  });

  it("goes negative when the guest has paid too much", async () => {
    // Signed, as `FolioPort.getBalance` says: an over-payment awaiting refund is
    // a negative balance, and §4 refuses that too.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
    });

    await folios.postPayment(db, {
      folioId,
      amount: 1_200_000n,
      businessDate: BUSINESS_DATE,
      description: "Card payment",
      postedBy: deskId,
    });

    expect(await folios.getBalance(bookingId)).toBe(-200_000n);
  });
});

describe("one agreed figure, three lines", () => {
  it("splits a night into the charge, the service charge and the tax", async () => {
    // §5: the guest is quoted gross and the folio shows the components
    // separately. The three amounts below are what the configured rates yield
    // and no others do, which is how this asserts the rates were read rather
    // than assumed.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    const chargeId = await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
      postedBy: deskId,
    });

    const lines = await linesOf(folioId);

    expect(lines).toHaveLength(3);
    expect(byType(lines, "ROOM_CHARGE")).toMatchObject({
      id: chargeId,
      amount: NET_CHARGE,
      description: "Room 301, one night",
      parentPostingId: null,
      postedBy: deskId,
      businessDate: BUSINESS_DATE.toString(),
    });
    expect(byType(lines, "SERVICE_CHARGE_FEE")).toMatchObject({
      amount: SERVICE_CHARGE,
      description: "Service charge on Room 301, one night",
      parentPostingId: chargeId,
    });
    expect(byType(lines, "VAT")).toMatchObject({
      amount: VAT,
      description: "VAT on Room 301, one night",
      parentPostingId: chargeId,
    });

    // The property of the decomposition `NFR-02` depends on: three lines that
    // came to a đồng under the figure the guest agreed to would fail it
    // silently, a little every night.
    expect(await folios.getBalance(bookingId)).toBe(A_NIGHT);
  });

  it("leaves the author unset on a line no person wrote", async () => {
    // The sweep and the gateway's IPN both post rows nobody authored, and a
    // placeholder account standing in for them would make an automated line
    // indistinguishable from one somebody made.
    const folioId = await folios.ensureFolio(db, await aBooking());

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
    });

    for (const line of await linesOf(folioId)) {
      expect(line.postedBy).toBeNull();
    }
  });

  it("reads the rate an ADMIN has just changed, not the one the last posting used", async () => {
    // `FR-FOL-02`: the rates are read at posting time. A value held between
    // postings is a rate somebody corrected and an invoice that did not notice.
    const folioId = await folios.ensureFolio(db, await aBooking());

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "The night before the correction",
    });

    await store({ ...CONFIGURED, standardVatRateBps: EDITED_VAT_RATE_BPS });

    try {
      await folios.postRoomCharge(db, {
        folioId,
        grossAmount: A_NIGHT,
        businessDate: BUSINESS_DATE,
        description: "The night after it",
      });

      const taxed = (await linesOf(folioId)).filter(
        (line) => line.type === "VAT",
      );

      expect(taxed).toHaveLength(2);
      expect(taxed.map((line) => line.amount)).toContain(VAT);
      expect(new Set(taxed.map((line) => line.amount)).size).toBe(2);

      // Both nights still sum to what each was quoted at, at whichever rate.
      expect(await sumOf(folioId)).toBe(A_NIGHT * 2n);
    } finally {
      await store(CONFIGURED);
    }
  });

  it("posts at the reduced rate on a business date the relief window covers", async () => {
    // `FR-FOL-02` resolves the rate against the business date being posted on,
    // not against today. The window is what makes this night's tax line differ
    // from the identical night in the case above, and every figure moves with
    // it: the VAT is larger, so the net charge — the residual — is smaller, and
    // the three still sum to what the guest agreed to pay.
    const folioId = await folios.ensureFolio(db, await aBooking());

    await store({
      ...CONFIGURED,
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    });

    try {
      await folios.postRoomCharge(db, {
        folioId,
        grossAmount: A_NIGHT,
        businessDate: BUSINESS_DATE,
        description: "A night inside the relief period",
      });

      const lines = await linesOf(folioId);

      expect(byType(lines, "ROOM_CHARGE").amount).toBe(NET_CHARGE_UNDER_RELIEF);
      expect(byType(lines, "SERVICE_CHARGE_FEE").amount).toBe(
        SERVICE_CHARGE_UNDER_RELIEF,
      );
      expect(byType(lines, "VAT").amount).toBe(VAT_UNDER_RELIEF);
      expect(await sumOf(folioId)).toBe(A_NIGHT);
    } finally {
      await store(CONFIGURED);
    }
  });

  it("posts at the standard rate on a business date the relief window has left behind, rather than stopping", async () => {
    // This used to be a refusal: with one rate behind the window there was
    // nothing to charge outside it, so a correctly configured window became a
    // scheduled outage at the front desk on the day relief lapsed. The rate
    // behind the window is now configured beside it, so the lapse is a rate
    // change — the desk keeps working and the guest is billed at the figure that
    // took over, not at the one that expired.
    const folioId = await folios.ensureFolio(db, await aBooking());

    await store({
      ...CONFIGURED,
      reducedVatFrom: LAPSED_WINDOW_OPENS,
      reducedVatTo: LAPSED_WINDOW_CLOSES,
    });

    try {
      await folios.postRoomCharge(db, {
        folioId,
        grossAmount: A_NIGHT,
        businessDate: BUSINESS_DATE,
        description: "A night after the relief lapsed",
      });

      // The standard-rate triple, and not the reduced one the row still holds.
      const lines = await linesOf(folioId);

      expect(byType(lines, "ROOM_CHARGE").amount).toBe(NET_CHARGE);
      expect(byType(lines, "SERVICE_CHARGE_FEE").amount).toBe(SERVICE_CHARGE);
      expect(byType(lines, "VAT").amount).toBe(VAT);
      expect(await sumOf(folioId)).toBe(A_NIGHT);
    } finally {
      await store(CONFIGURED);
    }
  });

  it("refuses a charge that would hand money back", async () => {
    // Money going the other way is a refund or a reversal, and both are lines
    // of their own. Refused here rather than at the sign constraint, which
    // cannot tell the caller which of the two they meant.
    const folioId = await folios.ensureFolio(db, await aBooking());

    const refusal = await refused(
      folios.postRoomCharge(db, {
        folioId,
        grossAmount: -A_NIGHT,
        businessDate: BUSINESS_DATE,
        description: "A night owed to the guest",
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
    expect(await linesOf(folioId)).toHaveLength(0);
  });

  it("refuses an account that does not exist", async () => {
    const refusal = await refused(
      folios.postRoomCharge(db, {
        folioId: ABSENT_ID,
        grossAmount: A_NIGHT,
        businessDate: BUSINESS_DATE,
        description: "A night on nobody's account",
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("money the property has received", () => {
  it("stores a payment as the negation of what the guest handed over", async () => {
    // The sign convention is applied in one place. A caller that had to
    // remember to negate is one that will one day forget, and the constraint
    // would report that as a fault rather than as an answer.
    const folioId = await folios.ensureFolio(db, await aBooking());

    await folios.postPayment(db, {
      folioId,
      amount: 900_000n,
      businessDate: BUSINESS_DATE,
      description: "Card payment",
      postedBy: deskId,
    });

    const [line] = await linesOf(folioId);

    expect(line).toMatchObject({ type: "PAYMENT", amount: -900_000n });
  });

  it("refuses a payment of nothing", async () => {
    const folioId = await folios.ensureFolio(db, await aBooking());

    const refusal = await refused(
      folios.postPayment(db, {
        folioId,
        amount: 0n,
        businessDate: BUSINESS_DATE,
        description: "A receipt nobody issued",
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
    expect(await linesOf(folioId)).toHaveLength(0);
  });

  it("refuses a payment written as the negative it will be stored as", async () => {
    const folioId = await folios.ensureFolio(db, await aBooking());

    const refusal = await refused(
      folios.postPayment(db, {
        folioId,
        amount: -900_000n,
        businessDate: BUSINESS_DATE,
        description: "Money going the other way",
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });
});

describe("a correction is a new line", () => {
  it("undoes a night and everything levied on it", async () => {
    // Reversing the charge alone would leave its service charge and its VAT
    // standing — tax on a night the property has agreed did not happen.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    const chargeId = await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
    });

    const corrections = await folios.reversePosting(db, {
      postingId: chargeId,
      businessDate: DEPARTURE_DATE,
      postedBy: deskId,
    });

    expect(corrections).toHaveLength(3);
    expect(await folios.getBalance(bookingId)).toBe(0n);

    const reversals = (await linesOf(folioId)).filter(
      (line) => line.type === "REVERSAL",
    );

    expect(ascending(reversals.map((line) => line.amount))).toEqual(
      ascending([-NET_CHARGE, -SERVICE_CHARGE, -VAT]),
    );
    // The correction is dated the day it was made, not the day of the mistake:
    // moving a figure into a trading day the property has already reconciled is
    // the thing a reversing entry exists to avoid.
    for (const line of reversals) {
      expect(line.businessDate).toBe(DEPARTURE_DATE.toString());
    }

    // The mistake is still on the account. That is the difference between a
    // ledger and a total.
    expect(byType(await linesOf(folioId), "ROOM_CHARGE").amount).toBe(
      NET_CHARGE,
    );
  });

  it("refuses to undo the same line twice", async () => {
    // Two credits for one mistake. The database refuses the second, and this
    // service does not look first — a read followed by an insert would pass
    // while two of them raced, which is the one arrangement under which a guest
    // is credited twice.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    const chargeId = await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
    });

    await folios.reversePosting(db, {
      postingId: chargeId,
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    const refusal = await refused(
      folios.reversePosting(db, {
        postingId: chargeId,
        businessDate: BUSINESS_DATE,
        postedBy: deskId,
      }),
    );

    expect(refusal.code).toBe("CONFLICT");

    // The refusal took the whole statement with it: three corrections, not
    // four, five or six, and the account still at nothing.
    const reversals = (await linesOf(folioId)).filter(
      (line) => line.type === "REVERSAL",
    );

    expect(reversals).toHaveLength(3);
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("undoes a payment in the direction the payment ran", async () => {
    // The one type the sign rule leaves free, and it has to: reversing a
    // payment is positive and reversing a charge is negative, and both are the
    // same act.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    const paymentId = await folios.postPayment(db, {
      folioId,
      amount: 200_000n,
      businessDate: BUSINESS_DATE,
      description: "Deposit taken against the wrong stay",
      postedBy: deskId,
    });

    await folios.reversePosting(db, {
      postingId: paymentId,
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    const [correction] = (await linesOf(folioId)).filter(
      (line) => line.type === "REVERSAL",
    );

    expect(correction?.amount).toBe(200_000n);
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("undoes a single derived line when that is what it is pointed at", async () => {
    // The narrower correction. A tax line has nothing levied on it, so the set
    // is that line alone and the sale it came from stands.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, one night",
    });

    const taxed = byType(await linesOf(folioId), "VAT");
    const corrections = await folios.reversePosting(db, {
      postingId: taxed.id,
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });

    expect(corrections).toHaveLength(1);
    expect(await folios.getBalance(bookingId)).toBe(A_NIGHT - VAT);
  });

  it("refuses a line nobody has", async () => {
    const refusal = await refused(
      folios.reversePosting(db, {
        postingId: ABSENT_ID,
        businessDate: BUSINESS_DATE,
        postedBy: deskId,
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("the ledger balances after every step", () => {
  it("holds through a stay charged, paid, corrected and settled", async () => {
    // `NFR-02`, stated as the requirement states it: Σ postings = Σ payments +
    // outstanding. Under the sign convention that is one addition over the rows
    // — what the guest owes equals what has been settled plus what is left —
    // and a reversal joins whichever side of it the line it corrects was on,
    // which is why the identity is taken over signs and not over types.
    const bookingId = await aBooking();
    const folioId = await folios.ensureFolio(db, bookingId);

    await balances(bookingId, folioId, 0n);

    const firstNight = await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, first night",
    });

    await balances(bookingId, folioId, A_NIGHT);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: BUSINESS_DATE,
      description: "Room 301, second night",
    });

    await balances(bookingId, folioId, A_NIGHT * 2n);

    await folios.postPayment(db, {
      folioId,
      amount: 1_500_000n,
      businessDate: BUSINESS_DATE,
      description: "Card payment",
      postedBy: deskId,
    });

    await balances(bookingId, folioId, 500_000n);

    // The first night was never slept. It comes off as three corrections, and
    // the guest is now owed the difference.
    await folios.reversePosting(db, {
      postingId: firstNight,
      businessDate: DEPARTURE_DATE,
      postedBy: deskId,
    });

    await balances(bookingId, folioId, -500_000n);

    // Handing that back settles the account, and the desk may close the stay —
    // §4 refuses a negative balance exactly as it refuses a positive one.
    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: 500_000n,
      businessDate: DEPARTURE_DATE,
      description: "Late checkout, charged at the desk",
      postedBy: deskId,
    });

    await balances(bookingId, folioId, 0n);
  });
});

/**
 * The identity `NFR-02` names, checked over the rows and against the port.
 *
 * Three claims at once, and each would fail differently: the balance the desk
 * reads is the sum of the lines; what the guest owes equals what has been
 * settled plus what is outstanding; and both agree with the figure the case
 * expected at this point in the stay.
 */
async function balances(
  bookingId: string,
  folioId: string,
  expected: VndAmount,
): Promise<void> {
  const lines = await linesOf(folioId);

  const owed = lines
    .filter((line) => line.amount > 0n)
    .reduce((total, line) => total + line.amount, 0n);
  const settled = lines
    .filter((line) => line.amount < 0n)
    .reduce((total, line) => total - line.amount, 0n);

  const outstanding = await folios.getBalance(bookingId);

  expect(outstanding).toBe(expected);
  expect(outstanding).toBe(await sumOf(folioId));
  expect(owed).toBe(settled + outstanding);
}

/** Amounts in order. `Array.prototype.sort` compares as text by default, which
 *  orders negative đồng by their digits rather than by their size. */
function ascending(amounts: readonly VndAmount[]): VndAmount[] {
  return [...amounts].sort((one, other) => (one < other ? -1 : one > other ? 1 : 0));
}

/** Every line on one account, oldest first. */
async function linesOf(
  folioId: string,
): Promise<readonly (typeof folioPosting.$inferSelect)[]> {
  return await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId))
    .orderBy(folioPosting.postedAt, folioPosting.id);
}

/** The one line of a type this case posted. */
function byType(
  lines: readonly (typeof folioPosting.$inferSelect)[],
  type: (typeof folioPosting.$inferSelect)["type"],
): typeof folioPosting.$inferSelect {
  const found = lines.filter((line) => line.type === type);

  if (found.length !== 1) {
    throw new Error(`expected one ${type} line, found ${found.length}`);
  }

  return found[0]!;
}

/**
 * The balance the long way round: summed in SQL from the rows themselves.
 *
 * Written here rather than reusing the service's own query, so the port is
 * checked against the database and not against itself. `sum(bigint)` widens to
 * `numeric` and the driver hands a numeric back as text, which is the one route
 * that cannot lose a đồng.
 */
async function sumOf(folioId: string): Promise<VndAmount> {
  const [summed] = await db
    .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  return BigInt(summed?.balance ?? "0");
}

/** A stay to hang an account on. */
async function aBooking(): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-FOLIOSVC-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: BUSINESS_DATE.toString(),
      checkOutDate: DEPARTURE_DATE.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 3_000_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/** The one configuration row, replaced. */
async function store(values: typeof systemConfig.$inferInsert): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(values);
}

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is
 *  the only way back — it needs rights over the table rather than over its rows,
 *  which is the distinction `schema/folio.ts` draws. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}

/** The refusal a call provoked. Fails the case if the service accepted it. */
async function refused(work: Promise<unknown>): Promise<ORPCError<string, unknown>> {
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
