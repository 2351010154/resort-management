// What the phone says when it rings.
//
// `payment-reconciliation-sweep.e2e-spec.ts` proves the page leaves the process
// and arrives at an endpoint; this proves what is written on it, which is a
// different claim and a cheaper one to make here. A responder woken at four in
// the morning acts on this sentence before they open anything, so each kind has
// to name the money, the reference and the day — and say which side reported
// what, because two of the three are about a figure only one side holds.
//
// A pure function for the reason `reconciliation.service.ts` makes `compare`
// one: it reads no clock, opens no connection and knows no gateway, so all three
// cases are reachable from literals rather than from a night that has to be
// arranged.
//
// The second suite is about the one thing the sweep does that neither the
// classification nor the sentence can be asked about: it draws two lists of
// money and holds them against each other, so it is the only place where the
// property's day boundary can be applied twice and differently. An `ADMIN`
// moving the rollover hour while a sweep runs is a committed row, and
// `transaction-runner.ts` takes `read committed` — so a sweep that asked what
// day it was per transaction would see the old hour on one side of a comparison
// and the new hour on the other. The stand-in for `SystemConfigService` below
// answers with a different hour each time it is asked, which is that edit in the
// only form a unit test can arrange, and the sweep is held to filing nothing.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { VndAmount } from "@mariva/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import {
  type paymentDiscrepancy,
  paymentReconciliationRun,
} from "../../database/schema/reconciliation.js";
import { BusinessDateService } from "../booking/business-date.service.js";
import type {
  OpsAlert,
  OpsAlertService,
} from "../notification/ops-alert.service.js";
import type { SystemConfigService } from "../system-config/system-config.service.js";
import type {
  GatewayTransaction,
  PaymentAttempt,
  PaymentGateway,
} from "./ports/payment-gateway.port.js";
import type { ReconciledAttempt } from "./reconciliation.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { ReconciliationJob, sentenceFor } from "./reconciliation.job.js";

const A_TRADING_DAY = parseDate("2027-09-14");
const A_REFERENCE = "4c1f7a3e8d9b0f6e5a4b3c2d1e0f";

describe("the sentence a discrepancy pages with", () => {
  it("names the gateway's figure when the money never reached an account", () => {
    const said = sentenceFor(
      attempt({
        outcome: "MISSING_LOCALLY",
        gatewayAmount: 1_450_000n,
        ledgerAmount: null,
        paymentId: null,
      }),
      A_TRADING_DAY,
    );

    expect(said).toContain("1450000");
    expect(said).toContain(A_REFERENCE);
    expect(said).toContain("2027-09-14");
    // The consequence, in the responder's terms rather than the table's. This is
    // the direction that costs a guest money, and the sentence has to say so.
    expect(said).toContain("outstanding");
  });

  it("names the ledger's figure when the gateway does not report the money", () => {
    const said = sentenceFor(
      attempt({
        outcome: "MISSING_AT_GATEWAY",
        gatewayAmount: null,
        ledgerAmount: 1_450_000n,
        paymentId: "a-payment",
      }),
      A_TRADING_DAY,
    );

    expect(said).toContain("1450000");
    expect(said).toContain(A_REFERENCE);
    // The property's claim, attributed to the property. A sentence that said
    // only "1450000 đồng is missing" would leave the responder to guess which
    // of the two systems is the one making the claim.
    expect(said).toMatch(/this property recorded/i);
  });

  it("names both figures when the two disagree, and attributes each", () => {
    const said = sentenceFor(
      attempt({
        outcome: "AMOUNT_MISMATCH",
        gatewayAmount: 1_460_000n,
        ledgerAmount: 1_450_000n,
        paymentId: "a-payment",
      }),
      A_TRADING_DAY,
    );

    // Both, because the whole content of this kind is the difference between
    // them — a page carrying one figure is a page that cannot be acted on.
    expect(said).toContain("1460000");
    expect(said).toContain("1450000");
    expect(said.indexOf("1460000")).toBeLessThan(said.indexOf("1450000"));
  });
});

describe("a rollover hour an ADMIN moves while the sweep is running", () => {
  it("does not put the two sides of one night on two day boundaries", async () => {
    // The hour reads 04:00 and then 06:00, which is the edit landing between the
    // gateway's side of the night and the ledger's. The one payment was taken at
    // 05:00 in the property's zone: it belongs to the night under the first hour
    // and to the night before under the second, so a sweep that asks twice puts
    // it in the report and not in the ledger and files money the gateway is
    // holding that this property supposedly never recorded.
    const swept = await sweep({ hours: [4, 6], theGatewaySays: THE_FIGURE });

    expect(swept.filed).toEqual([]);
    expect(swept.paged).toEqual([]);

    // Asked once, which is the whole of the guarantee: whatever the hour is,
    // both sides of the comparison are drawn on it.
    expect(swept.hourReads).toBe(1);

    // And the night is still worked and still marked looked-at. A sweep that
    // avoided the false discrepancy by skipping the date would leave it
    // outstanding, which is a different defect wearing the same green test.
    expect(swept.reconciled).toEqual([THE_NIGHT.toString()]);
    expect(swept.markedReconciled).toEqual([THE_NIGHT.toString()]);
  });

  it("holds that same payment against the gateway's figure for that night", async () => {
    // The case above proves nothing on its own if the payment falls outside the
    // night on both sides, because two empty lists agree. Same fixture, same
    // hour throughout, one đồng of disagreement — and the mismatch can only be
    // reached with the payment on both sides of the night's comparison.
    const swept = await sweep({ hours: [4], theGatewaySays: THE_FIGURE + 1n });

    expect(
      swept.filed.map((row) => [row.businessDate, row.kind, row.ledgerAmount]),
    ).toEqual([[THE_NIGHT.toString(), "AMOUNT_MISMATCH", THE_FIGURE]]);

    expect(swept.paged).toHaveLength(1);
  });
});

/** One classified attempt, with only the fields the sentence reads. */
function attempt(
  outcome: Omit<ReconciledAttempt, "reference">,
): ReconciledAttempt {
  return { reference: A_REFERENCE, ...outcome };
}

/** The day the property is having when the sweep runs, and never reconciles. */
const TODAY = parseDate("2027-11-04");

/** The one closed day the sweep below finds outstanding. */
const THE_NIGHT = TODAY.subtract({ days: 1 });

/**
 * Every other day in the look-back window, already on file.
 *
 * Written as the offsets rather than as six dates, so that the one gap is the
 * visible part: `reconciliation.job.ts` looks back seven days and this leaves
 * exactly the day before today outstanding.
 */
const ALREADY_LOOKED_AT = [7, 6, 5, 4, 3, 2].map((back) =>
  TODAY.subtract({ days: back }).toString(),
);

/**
 * 05:00 on the night, in the property's own zone.
 *
 * The instant the whole suite turns on: past a 04:00 rollover and before a
 * 06:00 one, so the two hours date it to two different business days.
 */
const AT_FIVE_IN_THE_MORNING = new Date("2027-11-02T22:00:00Z");

const AN_ATTEMPT = `3d9a71e0c85b4f26a1470e9d2b6c8f53${"0123456789abcdef".repeat(2)}`;

const THE_FIGURE: VndAmount = 1_200_000n;

type DiscrepancyValues = typeof paymentDiscrepancy.$inferInsert;

/** One night swept, and everything the sweep left behind. */
async function sweep({
  hours,
  theGatewaySays,
}: {
  readonly hours: readonly number[];
  readonly theGatewaySays: VndAmount;
}) {
  const configuration = new RolloverHours(hours);
  const businessDates = new BusinessDateService(
    configuration as unknown as SystemConfigService,
  );
  const books = new TheNightsBooks(ALREADY_LOOKED_AT, [
    {
      id: "the-payment-row",
      reference: AN_ATTEMPT,
      amount: THE_FIGURE,
      // Attempts are opened minutes before they are paid, and the sweep's
      // coarse range is over this column rather than over `paid_at`.
      createdAt: AT_FIVE_IN_THE_MORNING,
      paidAt: AT_FIVE_IN_THE_MORNING,
    },
  ]);
  const paged: OpsAlert[] = [];

  const job = new ReconciliationJob(
    gatewayHolding({
      status: "SUCCESS",
      reference: AN_ATTEMPT,
      amount: theGatewaySays,
      gatewayTransactionId: "vnp-at-the-gateway",
      paidAt: AT_FIVE_IN_THE_MORNING,
    }),
    new ReconciliationService(),
    businessDates,
    {
      page: async (alert: OpsAlert) => {
        paged.push(alert);

        return await Promise.resolve(true);
      },
    } as unknown as OpsAlertService,
    {
      setContext: () => undefined,
      error: () => undefined,
    } as unknown as PinoLogger,
  );

  const reconciled = await job.run(books.executor, TODAY);

  return {
    reconciled,
    paged,
    filed: books.discrepancies,
    markedReconciled: books.markedReconciled,
    hourReads: configuration.reads,
  };
}

/**
 * The configuration row as an `ADMIN` is editing it.
 *
 * Answers with the next hour in the list on each read and with the last one
 * forever after, and counts how many times it was asked. The count is the
 * assertion the suite is really making: a sweep that reads the hour once cannot
 * classify two instants under two hours, whatever anybody does to the row.
 */
class RolloverHours {
  reads = 0;

  constructor(private readonly hours: readonly number[]) {}

  async businessDateRolloverHour(): Promise<number> {
    const hour = this.hours[Math.min(this.reads, this.hours.length - 1)]!;

    this.reads += 1;

    return await Promise.resolve(hour);
  }
}

/** A gateway that answers about one attempt and knows nothing else. */
function gatewayHolding(transaction: GatewayTransaction): PaymentGateway {
  return {
    queryTransaction: async ({ reference }: PaymentAttempt) =>
      await Promise.resolve(
        reference === transaction.reference
          ? transaction
          : { status: "PENDING" as const, reference, amount: 0n },
      ),
  } as unknown as PaymentGateway;
}

/** A payment row, as both statements the sweep issues hand it back. */
interface StoredPayment {
  readonly id: string;
  readonly reference: string;
  readonly amount: VndAmount;
  readonly createdAt: Date;
  readonly paidAt: Date;
}

/**
 * The four statements a sweep issues, and nothing either side of them.
 *
 * The two `select`s are told apart by the table they are `from`, because the
 * sweep asks the run table which days are outstanding and the payment table for
 * both the attempts and the ledger. Neither predicate is read: the ranges in
 * them are coarse bounds a day either side of the business date, and the
 * narrowing that decides which rows belong to the night is exactly what these
 * cases are about — a stand-in that filtered here would be answering the
 * question instead of the sweep.
 *
 * `insert` keeps the unique key over `(business_date, attempt_reference)` and
 * nothing else, for the reason `reconciliation.service.spec.ts` gives about the
 * same stand-in.
 */
class TheNightsBooks {
  readonly discrepancies: DiscrepancyValues[] = [];
  readonly markedReconciled: string[] = [];

  private readonly keys = new Set<string>();

  constructor(
    private readonly alreadyLookedAt: readonly string[],
    private readonly payments: readonly StoredPayment[],
  ) {}

  get executor(): DbExecutor {
    return this as unknown as DbExecutor;
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: async () =>
          await Promise.resolve(
            table === paymentReconciliationRun
              ? this.alreadyLookedAt.map((businessDate) => ({ businessDate }))
              : this.payments,
          ),
      }),
    };
  }

  insert(table: unknown) {
    return table === paymentReconciliationRun
      ? {
          values: async (row: { readonly businessDate: string }) => {
            this.markedReconciled.push(row.businessDate);

            await Promise.resolve();
          },
        }
      : {
          values: (rows: readonly DiscrepancyValues[]) => ({
            onConflictDoNothing: () => ({
              returning: async () => await Promise.resolve(this.commit(rows)),
            }),
          }),
        };
  }

  private commit(rows: readonly DiscrepancyValues[]) {
    const written: {
      id: string;
      reference: string;
      kind: DiscrepancyValues["kind"];
    }[] = [];

    for (const row of rows) {
      const key = `${row.businessDate}|${row.attemptReference}`;

      if (this.keys.has(key)) {
        continue;
      }

      this.keys.add(key);

      const id = `discrepancy-${this.discrepancies.length + 1}`;

      this.discrepancies.push(row);
      written.push({ id, reference: row.attemptReference, kind: row.kind });
    }

    return written;
  }
}
