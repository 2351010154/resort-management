// `FR-PAY-05` end to end: the night's comparison, and the phone it rings.
//
// The requirement's acceptance is "alert proven by drill", and a drill is not a
// mock that records a call. So the page below leaves this process over HTTP to a
// server this file starts, and what is asserted is the body that server actually
// received. Everything between the money and that request is the real thing —
// the real sweep, the real comparison, the real `OpsAlertService`, real Postgres
// underneath, and `JobRunner`'s own transaction and idempotency check around the
// outside. Only the gateway is a stand-in, because the whole point of
// reconciliation is the cases a gateway cannot be asked to produce: you cannot
// tell VNPay to lose a callback.
//
// `reconciliation.service.spec.ts` already proves the classification from
// literals and says why that belongs in a pure function. This file proves the
// four things that only exist once the pieces are assembled:
//
// - a discrepancy is *found* against rows in a database and a report fetched
//   through the port, and somebody is paged about it;
// - a day still being traded is never reconciled, which is the false page the
//   whole design is arranged to avoid;
// - a clean day is still work — the run is recorded, and nobody is woken;
// - a gateway that cannot be reached leaves the day outstanding rather than
//   filing every payment it failed to ask about as missing.
//
// The server listens on port 0 — an ephemeral port the OS picks — so two suites
// running at once cannot collide on a number, and it is closed in `afterAll`.
//
// Payments are inserted directly rather than driven through `PaymentService`,
// and the reason is that the two states worth reconciling are states no happy
// path produces: an attempt whose callback never arrived, and a ledger row whose
// figure disagrees with the gateway's. Driving them through the service would
// mean stubbing the service into producing rows it exists to prevent.

import "reflect-metadata";

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { Env } from "../src/config/env.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio } from "../src/database/schema/folio.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import {
  paymentDiscrepancy,
  paymentReconciliationRun,
} from "../src/database/schema/reconciliation.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { JobRunner } from "../src/jobs/job-runner.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { OpsAlertService } from "../src/modules/notification/ops-alert.service.js";
import type {
  GatewayTransaction,
  PaymentAttempt,
  PaymentGateway,
} from "../src/modules/payment/ports/payment-gateway.port.js";
import { ReconciliationJob } from "../src/modules/payment/reconciliation.job.js";
import { ReconciliationService } from "../src/modules/payment/reconciliation.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/** The day the property is having. It is never reconciled. */
const TODAY = parseDate("2027-09-15");

/** The day behind it, closed, and the subject of almost every case here. */
const CLOSED_DAY = parseDate("2027-09-14");

/**
 * How many closed days one run picks up, named here rather than imported.
 *
 * An expectation computed from the same constant the code reads would agree
 * with it however wrong both were — the convention `room-charge-sweep.e2e-spec.
 * ts` states about the seeded tariff figures. A run reconciles every closed day
 * in this window that has no row yet, so a suite starting from an empty table
 * sees all of them and not only the one it wrote an attempt on.
 */
const THE_WINDOW = 7;

/** Every closed day one run covers, oldest first. */
const EVERY_CLOSED_DAY = Array.from({ length: THE_WINDOW }, (_, index) =>
  TODAY.subtract({ days: THE_WINDOW - index }).toString(),
);

/**
 * Midday in the property's own zone, which lands inside the business date it
 * names whatever hour the property rolls at. The rollover is configuration —
 * `business-date.service.ts` reads it from `system_config` — and a fixture timed
 * near it would be asserting the rollover rather than the reconciliation.
 */
function middayOn(date: StayDate): Date {
  return new Date(`${date.toString()}T12:00:00+07:00`);
}

/** References in the shape `payment.service.ts` mints them. */
const UNPAID_HERE = "4c1f7a3e8d9b" + "0f6e5a4b3c2d1e0f".repeat(3);
const AGREED = "8b2e6d4c0a91" + "1a2b3c4d5e6f7081".repeat(3);
const DISPUTED = "2f9a1c7b5e30" + "9182736455647382".repeat(3);

const A_SUM = 1_450_000n;
const WHAT_THE_GATEWAY_SAYS = 1_460_000n;

/**
 * A configuration nobody could mistake for a property's real one.
 *
 * Only the rollover hour matters here — it is what maps a gateway's instant of
 * payment onto a business date, which is the whole of what this suite partitions
 * on. The tax figures are deliberately unreal because §8 forbids the tree from
 * carrying a real rate, and nothing below posts anything for them to apply to.
 */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 4,
} satisfies typeof systemConfig.$inferInsert;

/** Pages the on-call endpoint actually received, in arrival order. */
const pages: Record<string, unknown>[] = [];

const logged: { detail: Record<string, unknown>; message: string }[] = [];

// A stand-in rather than pino, for the reason the other sweep suites give: a run
// that could not deliver a page has to say so somewhere, and this is where a
// case can read it. Nothing below asserts on it except the case that has no
// endpoint to reach.
const log = {
  setContext: () => {},
  info: () => {},
  warn: (detail: Record<string, unknown>, message: string) => {
    logged.push({ detail, message });
  },
  error: (detail: Record<string, unknown>, message: string) => {
    logged.push({ detail, message });
  },
} as unknown as PinoLogger;

/**
 * VNPay's answers, written down in advance.
 *
 * `queryTransaction` is the only method the sweep uses; the other three throw so
 * that a sweep which grew a dependency on one fails here rather than silently
 * reaching a gateway. A reference with no entry is answered `FAILED`, which is
 * how a gateway reports an attempt it never took money for.
 */
class RecordedGateway implements PaymentGateway {
  constructor(
    private readonly answers: ReadonlyMap<string, GatewayTransaction>,
    /** Attempts it was asked about, so a case can assert what was not asked. */
    readonly asked: string[] = [],
  ) {}

  async queryTransaction(attempt: PaymentAttempt): Promise<GatewayTransaction> {
    this.asked.push(attempt.reference);

    return (
      this.answers.get(attempt.reference) ?? {
        reference: attempt.reference,
        amount: 0n,
        status: "FAILED",
      }
    );
  }

  createPayment(): never {
    throw new Error("the reconciliation sweep does not open payments");
  }

  verifyCallback(): never {
    throw new Error("the reconciliation sweep does not verify callbacks");
  }

  refund(): never {
    throw new Error("the reconciliation sweep does not refund");
  }
}

/** A gateway that is simply not answering tonight. */
class UnreachableGateway implements PaymentGateway {
  async queryTransaction(): Promise<GatewayTransaction> {
    throw new Error("connect ETIMEDOUT vnpay");
  }

  createPayment(): never {
    throw new Error("unused");
  }

  verifyCallback(): never {
    throw new Error("unused");
  }

  refund(): never {
    throw new Error("unused");
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let server: Server;
let webhook: string;
let bookingId: string;
let folioId: string;
let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // Replaced rather than upserted — the table holds one row and the suites that
  // need a known one all write it the same way. `vitest.config.ts` sets
  // `fileParallelism: false`, so no other suite is reading it meanwhile.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  // Cleared on the way in as well as on the way out. A run row is what stops a
  // day being reconciled again, so one left behind by an earlier invocation of
  // this suite is a day that silently does not happen — which reads as a sweep
  // that found less work than it should have, rather than as stale state.
  await db.delete(paymentDiscrepancy);
  await db.delete(paymentReconciliationRun);

  server = createServer((request, response) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      pages.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(204);
      response.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  webhook = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page`;

  bookingId = await aBooking();
  folioId = await anOpenFolio(bookingId);
});

afterEach(async () => {
  // The three tables every case writes to, cleared in dependency order. A case
  // reading a run row another one left behind would be reading a day nobody
  // reconciled.
  await db.delete(paymentDiscrepancy);
  await db.delete(payment).where(eq(payment.folioId, folioId));
  await db.delete(paymentReconciliationRun);

  pages.length = 0;
  logged.length = 0;
});

afterAll(async () => {
  await db.delete(folio).where(eq(folio.id, folioId));
  await db.delete(booking).where(eq(booking.id, bookingId));

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  await pool.end();
});

describe("money the gateway took that never reached an account", () => {
  it("is written down and pages the on-call endpoint over the wire", async () => {
    // An attempt the payer completed and whose callback never arrived: a
    // `PENDING` row here, and money at VNPay.
    await anAttempt(UNPAID_HERE, { openedOn: CLOSED_DAY, paid: false });

    const { affected } = await runTheSweep(
      gatewayHolding([took(UNPAID_HERE, A_SUM, CLOSED_DAY)]),
    );

    // Every closed day in the window, this one among them.
    expect(affected).toBe(THE_WINDOW);

    const [written] = await db.select().from(paymentDiscrepancy);

    expect(written).toMatchObject({
      businessDate: CLOSED_DAY.toString(),
      attemptReference: UNPAID_HERE,
      kind: "MISSING_LOCALLY",
      gatewayAmount: A_SUM,
      // No payment row holds this money, which is the whole of what
      // `MISSING_LOCALLY` means — so there is no ledger figure and nothing to
      // point at.
      ledgerAmount: null,
      paymentId: null,
    });

    // The drill. This arrived over HTTP at a server outside the application,
    // which is the difference between an alert that is wired and one that is
    // asserted to have been called.
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      kind: "payment-discrepancy",
      businessDate: CLOSED_DAY.toString(),
      reference: UNPAID_HERE,
      discrepancy: "MISSING_LOCALLY",
      // đồng as a string, because a page is JSON and these are `bigint`. The
      // figure a responder goes looking for must survive the trip exactly.
      gatewayAmount: A_SUM.toString(),
      ledgerAmount: null,
    });

    expect(pages[0]!.text).toContain(A_SUM.toString());
    expect(pages[0]!.text).toContain(UNPAID_HERE);
  });

  it("pages once, however often the night is reconciled again", async () => {
    await anAttempt(UNPAID_HERE, { openedOn: CLOSED_DAY, paid: false });

    const gateway = gatewayHolding([took(UNPAID_HERE, A_SUM, CLOSED_DAY)]);

    await runTheSweep(gateway);
    expect(pages).toHaveLength(1);

    // A second run of the same sweep, in its own transaction — the cron's next
    // tick, or a manager re-running the night. The day now has its run row, so
    // there is nothing outstanding and nobody is woken a second time about a
    // disagreement that was already written down.
    const again = await runTheSweep(gateway);

    expect(again.affected).toBe(0);
    expect(pages).toHaveLength(1);
    expect(await db.select().from(paymentDiscrepancy)).toHaveLength(1);
  });
});

describe("a night the two reports agree on", () => {
  it("is recorded as looked at, and wakes nobody", async () => {
    await anAttempt(AGREED, { openedOn: CLOSED_DAY, paid: true, amount: A_SUM });

    const { affected } = await runTheSweep(
      gatewayHolding([took(AGREED, A_SUM, CLOSED_DAY)]),
    );

    // The day is work even though it produced no row. A sweep that reported
    // nothing here would be logged as having done nothing on the night it
    // confirmed the money was right.
    expect(affected).toBe(THE_WINDOW);

    expect(await db.select().from(paymentDiscrepancy)).toEqual([]);
    expect(pages).toEqual([]);

    const days = await db.select().from(paymentReconciliationRun);

    expect(days.map((row) => row.businessDate).sort()).toEqual(
      EVERY_CLOSED_DAY,
    );
  });
});

describe("two figures that disagree", () => {
  it("names both, and says which side said which", async () => {
    await anAttempt(DISPUTED, {
      openedOn: CLOSED_DAY,
      paid: true,
      amount: A_SUM,
    });

    await runTheSweep(
      gatewayHolding([took(DISPUTED, WHAT_THE_GATEWAY_SAYS, CLOSED_DAY)]),
    );

    const [written] = await db.select().from(paymentDiscrepancy);

    expect(written).toMatchObject({
      kind: "AMOUNT_MISMATCH",
      gatewayAmount: WHAT_THE_GATEWAY_SAYS,
      ledgerAmount: A_SUM,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      discrepancy: "AMOUNT_MISMATCH",
      gatewayAmount: WHAT_THE_GATEWAY_SAYS.toString(),
      ledgerAmount: A_SUM.toString(),
    });
  });
});

describe("the day the property is still having", () => {
  it("is not reconciled, and its attempts are not even asked about", async () => {
    // The same shape as the first case — an unpaid attempt with money at the
    // gateway — except that it is happening today. Reconciled now it would be
    // `MISSING_LOCALLY` and a phone ringing about a callback that is four
    // seconds away.
    await anAttempt(UNPAID_HERE, { openedOn: TODAY, paid: false });

    const gateway = gatewayHolding([took(UNPAID_HERE, A_SUM, TODAY)]);
    const { affected } = await runTheSweep(gateway);

    // The closed days were reconciled and found empty; today was not touched.
    expect(affected).toBe(THE_WINDOW);

    const days = await db.select().from(paymentReconciliationRun);

    expect(days.map((row) => row.businessDate).sort()).toEqual(
      EVERY_CLOSED_DAY,
    );
    expect(days.map((row) => row.businessDate)).not.toContain(TODAY.toString());

    expect(await db.select().from(paymentDiscrepancy)).toEqual([]);
    expect(pages).toEqual([]);

    // Asked about while reconciling yesterday — the attempt window spans the
    // neighbouring days on purpose — but the gateway's answer dates it into
    // today, so it is kept out of yesterday's report rather than filed against
    // it. That is the filter that stops a payment being reported missing on one
    // day and unexplained on the next.
    expect(gateway.asked).toContain(UNPAID_HERE);
  });
});

describe("a gateway that cannot be reached", () => {
  it("leaves the night outstanding rather than filing every payment as missing", async () => {
    await anAttempt(AGREED, { openedOn: CLOSED_DAY, paid: true, amount: A_SUM });

    await expect(runTheSweep(new UnreachableGateway())).rejects.toThrow(
      /ETIMEDOUT/,
    );

    // Nothing committed: no run row, so the next tick does the night again, and
    // no discrepancy against a payment the gateway was never actually asked
    // about. Catching per attempt and carrying on would have written one here.
    expect(await db.select().from(paymentReconciliationRun)).toEqual([]);
    expect(await db.select().from(paymentDiscrepancy)).toEqual([]);
    expect(pages).toEqual([]);
  });
});

describe("the sweep itself", () => {
  it("is registered on the scheduler, under a cron it can be found by", async () => {
    // The one case that boots the container. `jobs.module.ts` keeps the registry
    // as a list somebody has to edit, which buys a readable file at the cost of
    // a sweep that can exist and never run — so the registry is asserted rather
    // than assumed.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, JobsModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const registered = app.get(JobRunner).find("payment-reconciliation");

      expect(registered).toBeInstanceOf(ReconciliationJob);
      // Five fields, and one that fires more than once a day. The rollover hour
      // is configuration, so a sweep pinned to a single hour would reconcile the
      // wrong day the morning after somebody moved it.
      expect(registered?.schedule).toMatch(/^\S+ \* \* \* \*$/);
    } finally {
      await app.close();
    }
  });
});

/**
 * Runs the real sweep through the real runner, over `TODAY`.
 *
 * Through `JobRunner` rather than by calling `run` directly, because the runner
 * is what opens the transaction, takes the advisory lock and — on any run that
 * touched something — runs the sweep a second time and requires the second pass
 * to come back empty. Every case here therefore proves the sweep settles as a
 * side effect of proving whatever else it is about.
 */
function runTheSweep(gateway: PaymentGateway) {
  const businessDates = new BusinessDateService(new SystemConfigService());

  const job = new ReconciliationJob(
    gateway,
    new ReconciliationService(),
    businessDates,
    new OpsAlertService({ OPS_ALERT_WEBHOOK_URL: webhook } as Env, log),
    log,
  );

  const runner = new JobRunner(
    [job],
    new TransactionRunner(db),
    businessDates,
    log,
  );

  return runner.run(job, TODAY, "MANUAL");
}

/** A gateway holding exactly these transactions and nothing else. */
function gatewayHolding(
  transactions: readonly GatewayTransaction[],
): RecordedGateway {
  return new RecordedGateway(
    new Map(transactions.map((entry) => [entry.reference, entry])),
  );
}

/** What VNPay says when it took the money. */
function took(
  reference: string,
  amount: bigint,
  on: StayDate,
): GatewayTransaction {
  return {
    reference,
    amount,
    status: "SUCCESS",
    gatewayTransactionId: `vnp-${reference.slice(0, 12)}`,
    paidAt: middayOn(on),
  };
}

/**
 * One attempt this property opened.
 *
 * `paid: false` is the row `createPaymentRequest` writes and nothing has
 * resolved — no time of payment, which is what keeps it off the ledger side of
 * the comparison. `paid: true` is a callback that arrived and posted.
 */
async function anAttempt(
  reference: string,
  attempt: {
    readonly openedOn: StayDate;
    readonly paid: boolean;
    readonly amount?: bigint;
  },
): Promise<void> {
  const amount = attempt.amount ?? A_SUM;

  await db.insert(payment).values({
    folioId,
    method: "VNPAY",
    attemptReference: reference,
    amount,
    status: attempt.paid ? "SUCCESS" : "PENDING",
    // The instant the gateway was handed, which is what a later query names the
    // attempt by — `payment.service.ts` mints one value for the row and the
    // gateway so that this pair is exact.
    createdAt: middayOn(attempt.openedOn),
    paidAt: attempt.paid ? middayOn(attempt.openedOn) : null,
    gatewayTransactionId: attempt.paid ? `vnp-${reference.slice(0, 12)}` : null,
  });
}

/** A stay to hang an account on. */
async function aBooking(): Promise<string> {
  bookingOrdinal += 1;

  const [type] = await db.select({ id: roomType.id }).from(roomType).limit(1);

  if (!type) {
    throw new Error("the property has no room types — run the seed");
  }

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-REC-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId: type.id,
      checkInDate: CLOSED_DAY.toString(),
      checkOutDate: TODAY.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: A_SUM,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning();

  return stay!.id;
}

async function anOpenFolio(onBooking: string): Promise<string> {
  const [opened] = await db
    .insert(folio)
    .values({ bookingId: onBooking })
    .returning();

  return opened!.id;
}
