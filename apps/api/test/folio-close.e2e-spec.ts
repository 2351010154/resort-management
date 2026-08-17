// Agreeing a stay's account, and the invoice drawn from it — `FR-FOL-01` and
// `FR-FOL-04`, against a real Postgres.
//
// Two acts and one seam between them, and the seam is what this file is mostly
// about. The close writes state and nothing else; `EInvoiceJob` reads the state
// it left and asks a provider for a number. Between them there is no queue table
// and no message, which is the design `e-invoice.job.ts` argues — so the claims
// that would ordinarily be a queue's are claims about these rows:
//
// - an account that does not come to nothing is not agreed, and stays open;
// - an account is agreed once, and a second attempt is refused rather than
//   quietly accepted;
// - a folio the desk agreed is invoiced exactly once, however often the job
//   runs, in the same transaction and in a later one;
// - a provider that fails leaves the stay checked out and the account closed,
//   because the close committed long before;
// - and once the account is agreed it takes no further lines, which is the half
//   of `FR-FOL-01` that could not exist until something could close a folio.
//
// **The rows are committed rather than rolled back**, for the reason
// `folio-service.e2e-spec.ts` gives about the same tables: the job reads the
// state the close committed, exactly as it will when the two are minutes apart
// rather than milliseconds, and fixtures inside an open transaction would prove
// nothing about that. The ledger is therefore truncated between cases and on the
// way out.
//
// No Nest application is booted for the behaviour — every act takes its executor
// as an argument, so the subjects are reachable with a `new`. One case boots the
// container, and only to answer what the wiring turns on: whether the job is in
// the registry at all. A job that works and is in nobody's list never runs.
//
// The rates are deliberately unreal — 12.34% VAT over a 3.21% service charge.
// §8 forbids the tree from carrying a real rate, and nothing below asserts the
// split anyway: what matters here is that the three lines sum to the figure the
// guest agreed to, so that a payment of that figure settles the account.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { Test } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { AppModule } from "../src/app.module.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { guest, registration } from "../src/database/schema/guest.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { JobRunner } from "../src/jobs/job-runner.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { EInvoiceJob } from "../src/modules/folio/e-invoice.job.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { LocalEInvoiceService } from "../src/modules/folio/local-e-invoice.service.js";
import type {
  EInvoicePort,
  IssuedInvoice,
  IssueInvoiceInput,
} from "../src/modules/folio/ports/e-invoice.port.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { accrualOn } from "./accrual.js";

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

/** The booking holder, by the name the invoice is addressed to. */
const A_GUEST = "Nguyễn Thị Hương";

/** A uuid no row has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

// Every run of the job may say something about a stay it could not invoice, and
// that warning is the only place such a stay is named. Collected so a case can
// assert it was said, and that the ordinary run says nothing.
const warnings: { detail: Record<string, unknown>; message: string }[] = [];

const log = {
  setContext: () => {},
  warn: (detail: Record<string, unknown>, message: string) => {
    warnings.push({ detail, message });
  },
} as unknown as PinoLogger;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let job: EInvoiceJob;
let roomTypeId: string;

// References and CCCDs are unique and every case takes a stay of its own.
// Counted rather than drawn, so a failing run reproduces.
let stayOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await clearTheLedger();

  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  const [existing] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .limit(1);

  roomTypeId = existing?.id ?? (await someRoomType());

  folios = new FolioService(db, new SystemConfigService(), accrualOn(db));
  job = new EInvoiceJob(new LocalEInvoiceService(), log);
});

beforeEach(async () => {
  warnings.length = 0;
  await clearTheLedger();
});

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, a folio would hold a booking the next file's
  // fixtures cannot clear, and the failure would surface a file away from its
  // cause.
  await clearTheLedger();
  await pool?.end();
});

describe("agreeing the account", () => {
  it("refuses one the guest has not settled", async () => {
    const { bookingId, folioId } = await aStay();
    await charge(folioId);

    const refusal = await refused(folios.close(db, bookingId));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain(String(A_NIGHT));

    // The account is exactly as it was. A close that half-happened would be a
    // folio nothing can post to and no invoice can be drawn from.
    const [account] = await accountsOf(folioId);

    expect(account?.state).toBe("OPEN");
    expect(account?.closedAt).toBeNull();
  });

  it("refuses one the guest has overpaid", async () => {
    // Not the same refusal in the other direction: money the property is
    // holding and does not account for is refunded, not written off by closing
    // the account over it.
    const { bookingId, folioId } = await aStay();
    await charge(folioId);
    await settle(folioId, A_NIGHT + 50_000n);

    const refusal = await refused(folios.close(db, bookingId));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain("50000");

    const [account] = await accountsOf(folioId);

    expect(account?.state).toBe("OPEN");
  });

  it("agrees one that comes to nothing, and says when", async () => {
    const { bookingId, folioId } = await aSettledStay();

    const before = Date.now();
    const closed = await folios.close(db, bookingId);

    expect(closed.id).toBe(folioId);
    expect(closed.closedAt).toBeInstanceOf(Date);

    const [account] = await accountsOf(folioId);

    expect(account?.state).toBe("CLOSED");
    // Postgres' clock rather than this process's, so this is a window and not
    // an equality — what it proves is that the instant stored is the close's
    // own and not something a fixture supplied.
    expect(account?.closedAt?.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(account?.closedAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    // Nothing has been issued yet, and the null is what the job reads.
    expect(account?.invoiceReference).toBeNull();
  });

  it("agrees an account nobody ever posted to", async () => {
    // A stay that ran up no charge owes nothing, so it settles at nothing. The
    // check-out guard reads the same zero.
    const { bookingId } = await aStay();

    const closed = await folios.close(db, bookingId);

    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it("refuses a second close, and says when the first was", async () => {
    const { bookingId } = await aSettledStay();
    const first = await folios.close(db, bookingId);

    const refusal = await refused(folios.close(db, bookingId));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain(first.closedAt.toISOString());
  });

  it("refuses a stay with no account at all", async () => {
    const refusal = await refused(folios.close(db, ABSENT_ID));

    expect(refusal.code).toBe("NOT_FOUND");
  });

  it("waits for a charge already being written, and counts it", async () => {
    // The race the `FOR UPDATE` in `close` exists for, run for real on two
    // connections. A charge is written and held uncommitted; the close cannot
    // see it in its own snapshot, and without the lock would sum a settled
    // account and agree it — leaving a folio that is closed, invoiced, and owed
    // a night's rent that no invoice mentions and no line can now be added for.
    //
    // The lock makes the close wait for the transaction it is racing. When that
    // one commits, the sum sees the charge and the account is refused, which is
    // the answer it should have had all along.
    const { bookingId, folioId } = await aSettledStay();

    const charged = signal();
    const release = signal();

    const posting = db.transaction(async (tx) => {
      await folios.postRoomCharge(tx, {
        folioId,
        grossAmount: A_NIGHT,
        businessDate: BUSINESS_DATE,
        description: "A night keyed while the desk was closing the account",
        postedBy: null,
      });

      charged.fire();

      await release.fired;
    });

    await charged.fired;

    const closing = db.transaction(async (tx) => folios.close(tx, bookingId));

    // Long enough that a close which was not blocked would have committed by
    // now — which is what makes the refusal below evidence of the lock rather
    // than of the ordering the two happened to take.
    await new Promise((resolve) => setTimeout(resolve, 200));

    release.fire();
    await posting;

    const refusal = await refused(closing);

    expect(refusal.code).toBe("CONFLICT");
    expect(await folios.getBalance(bookingId)).toBe(A_NIGHT);
  });

  it("leaves the agreed account taking no further lines", async () => {
    // `FR-FOL-01`'s other half. The refusal comes off the ledger's own trigger
    // — `folio-storage.e2e-spec.ts` asserts the SQLSTATE — and this is the
    // sentence a receptionist is handed when they post against a stay that has
    // already been invoiced.
    const { bookingId, folioId } = await aSettledStay();
    await folios.close(db, bookingId);

    const refusal = await refused(charge(folioId));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain("closed");

    expect(await folios.getBalance(bookingId)).toBe(0n);
  });
});

describe("the invoice drawn once the account is agreed", () => {
  it("issues one for every account the desk agreed", async () => {
    const { bookingId, folioId } = await aSettledStay();
    await folios.close(db, bookingId);

    expect(await job.run(db)).toEqual([folioId]);

    const [account] = await accountsOf(folioId);

    // The provider's number, opaque here: what is asserted is that it came back
    // and was stored, not what it is made of.
    expect(account?.invoiceReference).toBe(`LOCAL-INV-${folioId}`);
    expect(warnings).toEqual([]);
  });

  it("leaves an account the desk has not agreed alone", async () => {
    // The invoice is drawn from the lines standing at the close. An open folio
    // has no such moment, and `folio_invoice_reference_only_when_closed` would
    // refuse the write even if this job tried.
    const { folioId } = await aSettledStay();

    expect(await job.run(db)).toEqual([]);

    const [account] = await accountsOf(folioId);

    expect(account?.invoiceReference).toBeNull();
  });

  it("does not issue a second invoice for a stay that has one", async () => {
    // `FR-FOL-04`'s idempotency, and the claim the whole design is arranged
    // around: the row the job writes is the row that stops it writing again.
    const { bookingId, folioId } = await aSettledStay();
    await folios.close(db, bookingId);

    await job.run(db);
    const issuedFirst = await accountsOf(folioId);

    expect(await job.run(db)).toEqual([]);

    const issuedAgain = await accountsOf(folioId);

    expect(issuedAgain[0]?.invoiceReference).toBe(
      issuedFirst[0]?.invoiceReference,
    );
  });

  it("changes nothing on a second pass over the same transaction", async () => {
    // Exactly what `JobRunner` does before it commits: run, and if anything was
    // touched, run again and require the second pass to come back empty. A job
    // that failed this would be rolled back whole — after the provider had
    // issued the numbers.
    const { bookingId } = await aSettledStay();
    await folios.close(db, bookingId);

    await db.transaction(async (tx) => {
      const touched = await job.run(tx);

      expect(touched).toHaveLength(1);
      expect(await job.run(tx)).toEqual([]);
    });
  });

  it("addresses it to the booking holder and states what they bought", async () => {
    const recorded: IssueInvoiceInput[] = [];
    const recording = new EInvoiceJob(recorder(recorded), log);

    const { bookingId, folioId } = await aSettledStay();
    const closed = await folios.close(db, bookingId);

    await recording.run(db);

    const [invoice] = recorded;

    expect(invoice?.folioId).toBe(folioId);
    expect(invoice?.buyerName).toBe(A_GUEST);
    // The close's own instant, not the job's: `FR-FOL-04` dates the document by
    // when the desk agreed the account, and the queue may take until morning.
    expect(invoice?.closedAt.getTime()).toBe(closed.closedAt.getTime());

    // The charge and the service charge, with the tax folded onto the charge —
    // and the payment nowhere, because an invoice states what was bought. The
    // two columns together are what the guest handed over.
    expect(invoice?.lines).toHaveLength(2);
    expect(
      invoice?.lines.reduce(
        (total, line) => total + line.netAmount + line.taxAmount,
        0n,
      ),
    ).toBe(A_NIGHT);
  });

  it("waits when the stay has nobody to address the invoice to", async () => {
    // `ports/e-invoice.port.ts` refuses to invent a buyer, and raising would
    // stop every other stay's invoice behind this one. So the account waits and
    // the run says which stay is holding it.
    const { bookingId, folioId } = await aSettledStay({ registered: false });
    await folios.close(db, bookingId);

    expect(await job.run(db)).toEqual([]);

    const [account] = await accountsOf(folioId);

    expect(account?.invoiceReference).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.detail).toMatchObject({
      folio: folioId,
      booking: bookingId,
    });
  });

  it("invoices the accounts around one it cannot address", async () => {
    // The skip above is not allowed to stop the queue. Both stays are closed;
    // one has a holder and is invoiced, and the other is named.
    const nameless = await aSettledStay({ registered: false });
    const holder = await aSettledStay();

    await folios.close(db, nameless.bookingId);
    await folios.close(db, holder.bookingId);

    expect(await job.run(db)).toEqual([holder.folioId]);
    expect(warnings).toHaveLength(1);
  });

  it("leaves the account closed when the issuer fails", async () => {
    // `FR-FOL-04`: a provider timeout never rolls back a checkout. It holds
    // structurally rather than by handling — the close committed in a
    // transaction of its own, and nothing this job does can reach it.
    const failing = new EInvoiceJob(refusingIssuer(), log);

    const { bookingId, folioId } = await aSettledStay();
    await folios.close(db, bookingId);

    await expect(failing.run(db)).rejects.toThrow("the provider is down");

    const [account] = await accountsOf(folioId);

    expect(account?.state).toBe("CLOSED");
    expect(account?.invoiceReference).toBeNull();

    // And the next run, against an issuer that answers, invoices it.
    expect(await job.run(db)).toEqual([folioId]);
  });

  it("is registered on the scheduler, under a cron it can be found by", async () => {
    // The one case that boots the container. `jobs.module.ts` keeps the registry
    // as a list somebody has to edit, and this job is the one that file does not
    // construct — `folio.module.ts` does, because the port it takes does not
    // leave that module. So the wiring is asserted rather than assumed.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, JobsModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const registered = app.get(JobRunner).find("e-invoice");

      expect(registered).toBeInstanceOf(EInvoiceJob);
      // Five fields, and more than once an hour: a guest should have their
      // invoice before they have found the car.
      expect(registered?.schedule).toMatch(/^\S+ \* \* \* \*$/);
    } finally {
      await app.close();
    }
  });
});

/** A one-shot latch, so the two connections in the race above take their turns
 *  by having reached a point rather than by having slept long enough. */
function signal(): { fired: Promise<void>; fire: () => void } {
  let fire = (): void => {};
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });

  return { fired, fire };
}

/** An issuer that records what it was asked for and answers as the stub does. */
function recorder(into: IssueInvoiceInput[]): EInvoicePort {
  const local = new LocalEInvoiceService();

  return {
    issue: (input) => {
      into.push(input);

      return local.issue(input);
    },
    adjust: (input) => local.adjust(input),
    replace: (input) => local.replace(input),
  };
}

/** A provider having the afternoon `FR-FOL-04` promises cannot reach a
 *  checkout. */
function refusingIssuer(): EInvoicePort {
  const down = (): Promise<IssuedInvoice> =>
    Promise.reject(new Error("the provider is down"));

  return { issue: down, adjust: down, replace: down };
}

/** A stay with an account opened against it, and a holder unless the case is
 *  about there being none. */
async function aStay(
  { registered = true }: { registered?: boolean } = {},
): Promise<{ bookingId: string; folioId: string }> {
  stayOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-CLOSE-${String(stayOrdinal).padStart(4, "0")}`,
      state: "CHECKED_IN",
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

  const bookingId = stay!.id;

  if (registered) {
    const [person] = await db
      .insert(guest)
      .values({
        fullName: A_GUEST,
        nationality: "VN",
        cccdNumber: String(10_000_000_000 + stayOrdinal).padStart(12, "0"),
      })
      .returning({ id: guest.id });

    await db.insert(registration).values({
      bookingId,
      guestId: person!.id,
      isPrimary: true,
    });
  }

  return { bookingId, folioId: await folios.ensureFolio(db, bookingId) };
}

/** A stay that has been charged for its night and has paid for it, so its
 *  account comes to nothing and can be agreed. */
async function aSettledStay(
  options: { registered?: boolean } = {},
): Promise<{ bookingId: string; folioId: string }> {
  const stay = await aStay(options);

  await charge(stay.folioId);
  await settle(stay.folioId, A_NIGHT);

  return stay;
}

/** One night, decomposed at the configured rates — `FR-FOL-02`. */
async function charge(folioId: string): Promise<string> {
  return await folios.postRoomCharge(db, {
    folioId,
    grossAmount: A_NIGHT,
    businessDate: BUSINESS_DATE,
    description: `Room charge, night of ${BUSINESS_DATE.toString()}`,
    postedBy: null,
  });
}

/** Money the guest handed over. */
async function settle(folioId: string, amount: bigint): Promise<string> {
  return await folios.postPayment(db, {
    folioId,
    amount,
    businessDate: BUSINESS_DATE,
    description: "Card, ****4242",
    postedBy: null,
  });
}

/** The folio row, whole, as the database holds it. */
async function accountsOf(folioId: string) {
  return await db.select().from(folio).where(eq(folio.id, folioId));
}

async function clearTheLedger(): Promise<void> {
  await db.execute(
    sql`truncate folio_posting, folio, registration, booking, guest restart identity cascade`,
  );
}

/** A room type to hang a booking on, and only if the database holds none. */
async function someRoomType(): Promise<string> {
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

  return created!.id;
}

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
