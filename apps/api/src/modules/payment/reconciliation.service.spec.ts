// The cases nobody can produce on demand against a real gateway.
//
// A matched day is what a sandbox gives you. What `FR-PAY-05` exists for is the
// other four: money the gateway says it took that never reached an account, a
// payment this property recorded that the gateway's report does not mention, two
// figures that disagree, and the same night reconciled twice. The first three
// are unreachable through a gateway on purpose — you cannot ask VNPay to lose a
// callback — so they are reachable here, from literals, or they are not tested
// at all.
//
// That is why the classification is a pure function and not a private method.
// `compare` reads no clock, opens no connection and knows no gateway; every case
// below hands it two reports and reads the outcome, and nothing has to be
// stubbed to make one of them happen.
//
// The re-run is the one case that needs a place to write to, and what stands in
// for the database stands in for exactly one thing: the unique key over
// `(business_date, attempt_reference)`. It is not a ledger and holds no
// constraint beyond that, because that key is the whole of the claim — a second
// pass over the same day must come back having written nothing, which is what
// `job-runner.service.ts` requires of any sweep that calls this. Whether
// Postgres itself refuses the second insert is a question about the migration,
// and `schema/reconciliation.spec.ts` says where that question belongs.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate, VndAmount } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import { paymentDiscrepancy } from "../../database/schema/reconciliation.js";
import {
  type BusinessDateRule,
  BusinessDateService,
} from "../booking/business-date.service.js";
import type { SystemConfigService } from "../system-config/system-config.service.js";
import type { GatewayTransaction } from "./ports/payment-gateway.port.js";
import {
  compare,
  type LedgerPayment,
  ReconciliationService,
} from "./reconciliation.service.js";

/** Two attempts, in the shape `payment.service.ts` mints references in. */
const ONE_ATTEMPT = `7f1c4d2a9b604e188a352c6d0f9e1b47${"0123456789abcdef".repeat(2)}`;
const ANOTHER_ATTEMPT = `91b3e05c47a84d1fa2760c8e5d3419bf${"fedcba9876543210".repeat(2)}`;

/** The trading day every case below reconciles. */
const A_TRADING_DAY = parseDate("2027-11-02");

/**
 * The property rolls its day at 04:00 in its own zone, which is the figure
 * `.env.example` ships and the seeder writes into `system_config`. Set out here
 * because two of the cases below are entirely about which side of it a payment
 * falls on.
 */
const ROLLOVER_HOUR = 4;

describe("an attempt both reports agree on", () => {
  it("is matched, and matched is not a row", async () => {
    const [outcome] = compare(
      [took(ONE_ATTEMPT, 1_200_000n)],
      [recorded(ONE_ATTEMPT, 1_200_000n)],
    );

    expect(outcome?.outcome).toBe("MATCHED");

    // And the day writes nothing at all. An agreement recorded is the gateway's
    // report copied into Postgres — `schema/reconciliation.ts` argues it — and
    // a table of agreements is one an exception cannot be found in.
    const clean = await reconciled(
      [took(ONE_ATTEMPT, 1_200_000n)],
      [paidAt(ONE_ATTEMPT, 1_200_000n, "2027-11-02T09:12:00Z")],
    );

    expect(clean.run.recorded).toEqual([]);
    expect(clean.ledger.discrepancies).toEqual([]);
  });
});

describe("money the gateway took that never reached an account", () => {
  it("is missing locally, and names no payment because there is none", () => {
    // The direction that costs a guest: their card was charged, the callback
    // never arrived, and their folio still shows the amount outstanding.
    const [outcome] = compare([took(ONE_ATTEMPT, 1_200_000n)], []);

    expect(outcome).toEqual({
      reference: ONE_ATTEMPT,
      outcome: "MISSING_LOCALLY",
      gatewayAmount: 1_200_000n,
      ledgerAmount: null,
      paymentId: null,
    });
  });
});

describe("a payment the gateway's report does not account for", () => {
  it("is missing at the gateway, and names the row somebody has to look at", () => {
    const [outcome] = compare([], [recorded(ONE_ATTEMPT, 1_200_000n)]);

    expect(outcome).toEqual({
      reference: ONE_ATTEMPT,
      outcome: "MISSING_AT_GATEWAY",
      gatewayAmount: null,
      ledgerAmount: 1_200_000n,
      paymentId: "the-payment-row",
    });
  });

  it("is the same answer when the report names the attempt and refuses it", () => {
    // A refusal is not money. The gateway holding nothing under a reference and
    // the gateway not mentioning it are the same claim about the same đồng, so
    // a payment recorded against either is the same disagreement.
    const [outcome] = compare(
      [refused(ONE_ATTEMPT, 1_200_000n)],
      [recorded(ONE_ATTEMPT, 1_200_000n)],
    );

    expect(outcome?.outcome).toBe("MISSING_AT_GATEWAY");
  });

  it("and a refusal this property never recorded is not a discrepancy at all", () => {
    // Nobody was charged and nothing was posted. Two systems agreeing that no
    // money moved is an agreement, and it is not somebody's four in the morning.
    expect(compare([refused(ONE_ATTEMPT, 1_200_000n)], [])).toEqual([]);
  });
});

describe("two reports that disagree about the figure", () => {
  it("is an amount mismatch carrying both, to the đồng", () => {
    // A terminal, a currency scale, or a merchant account configured against
    // another property. Both figures are kept because the difference is the
    // whole of what somebody is being asked to explain, and neither side is
    // authoritative enough to be the one that gets stored.
    const [outcome] = compare(
      [took(ONE_ATTEMPT, 1_200_001n)],
      [recorded(ONE_ATTEMPT, 1_200_000n)],
    );

    expect(outcome).toEqual({
      reference: ONE_ATTEMPT,
      outcome: "AMOUNT_MISMATCH",
      gatewayAmount: 1_200_001n,
      ledgerAmount: 1_200_000n,
      paymentId: "the-payment-row",
    });
  });
});

describe("a report this property cannot reconcile against", () => {
  it("naming one attempt twice is refused rather than resolved", () => {
    // There is no honest way to pick. The later figure would file a
    // discrepancy against a number nobody can point at, and the sum would
    // invent a payment.
    expect(() =>
      compare([took(ONE_ATTEMPT, 1_200_000n), took(ONE_ATTEMPT, 900_000n)], []),
    ).toThrow(/more than once/);
  });

  it("naming an amount that is not money is refused at the boundary", () => {
    // Caught where it arrives, so the failure names the report rather than
    // surfacing later as a check constraint naming a column.
    expect(() => compare([took(ONE_ATTEMPT, 0n)], [])).toThrow(
      /not an amount of money/,
    );
  });
});

describe("the day written down", () => {
  it("files one row per disagreement and nothing for the agreement", async () => {
    const { run, ledger } = await reconciled(
      [took(ONE_ATTEMPT, 1_200_001n), took("an-attempt-we-never-opened", 80_000n)],
      [paidAt(ONE_ATTEMPT, 1_200_000n, "2027-11-02T09:12:00Z")],
    );

    expect(run.recorded.map((row) => row.kind).sort()).toEqual([
      "AMOUNT_MISMATCH",
      "MISSING_LOCALLY",
    ]);

    // Every row carries the trading day it was found in, not the day it was
    // looked for on — `property-and-tariff.md` §2, and the column the key is
    // half made of.
    expect(
      ledger.discrepancies.every(
        (row) => row.businessDate === A_TRADING_DAY.toString(),
      ),
    ).toBe(true);

    const mismatch = ledger.discrepancies.find(
      (row) => row.kind === "AMOUNT_MISMATCH",
    );

    expect(mismatch?.gatewayAmount).toBe(1_200_001n);
    expect(mismatch?.ledgerAmount).toBe(1_200_000n);
    // {@link paidAt} gives a row the reference as its id, so a case with more
    // than one payment in it can say which row an outcome names.
    expect(mismatch?.paymentId).toBe(ONE_ATTEMPT);
  });

  it("writes nothing the second time, while still saying what it found", async () => {
    // The claim `job-runner.service.ts` makes of every sweep it runs, and the
    // one a manager re-running a night by hand depends on. The comparison is
    // unchanged — the day still has the same two disagreements in it — and the
    // key is what makes the second pass write none of them.
    const report = [took(ONE_ATTEMPT, 1_200_001n), took(ANOTHER_ATTEMPT, 80_000n)];
    const ledger = new DiscrepancyStore([
      paidAt(ONE_ATTEMPT, 1_200_000n, "2027-11-02T09:12:00Z"),
    ]);
    const service = new ReconciliationService();
    const dates = await propertyDays();

    const first = await service.reconcile(
      ledger.executor,
      A_TRADING_DAY,
      report,
      dates,
    );
    const second = await service.reconcile(
      ledger.executor,
      A_TRADING_DAY,
      report,
      dates,
    );

    expect(first.recorded).toHaveLength(2);
    expect(second.recorded).toEqual([]);
    expect(second.compared).toEqual(first.compared);
    expect(ledger.discrepancies).toHaveLength(2);
  });
});

describe("which payments belong to the trading day", () => {
  it("takes the ones the property's own clock puts in it, not the calendar's", async () => {
    // 01:30 local on the 3rd is 18:30 UTC on the 2nd, and the property has not
    // rolled its day yet — the night audit has not run and the 2nd is not
    // closed. 05:00 local on the 3rd is 22:00 UTC on the 2nd and belongs to the
    // 3rd. A comparison partitioned at midnight would report the first missing
    // on one day and unexplained on the next, every night.
    const { run } = await reconciled(
      [took(ONE_ATTEMPT, 1_200_000n)],
      [
        paidAt(ONE_ATTEMPT, 1_200_000n, "2027-11-02T18:30:00Z"),
        paidAt(ANOTHER_ATTEMPT, 80_000n, "2027-11-02T22:00:00Z"),
      ],
    );

    // One entry: the late payment matched. The 05:00 one is not this day's
    // ledger, so it is not this day's missing money either.
    expect(run.compared).toEqual([
      {
        reference: ONE_ATTEMPT,
        outcome: "MATCHED",
        gatewayAmount: 1_200_000n,
        ledgerAmount: 1_200_000n,
        paymentId: ONE_ATTEMPT,
      },
    ]);
    expect(run.recorded).toEqual([]);
  });
});

/** A transaction the gateway says it took. */
function took(reference: string, amount: VndAmount): GatewayTransaction {
  return {
    status: "SUCCESS",
    reference,
    amount,
    gatewayTransactionId: `${reference.slice(0, 8)}-at-the-gateway`,
    paidAt: new Date("2027-11-02T09:12:00Z"),
  };
}

/** An attempt the gateway refused. `GatewayTransaction` gives it no id. */
function refused(reference: string, amount: VndAmount): GatewayTransaction {
  return { status: "FAILED", reference, amount };
}

/** A payment this property recorded, as the comparison needs it. */
function recorded(reference: string, amount: VndAmount): LedgerPayment {
  return { id: "the-payment-row", reference, amount };
}

/** The same, as the row the statement in `ledgerFor` selects. */
function paidAt(
  reference: string,
  amount: VndAmount,
  instant: string,
): StoredPayment {
  return {
    // The reference doubles as the id, so that a case with two payments in it
    // can say which row an outcome names without a second constant.
    id: reference,
    reference,
    amount,
    paidAt: new Date(instant),
  };
}

/** One reconciliation of {@link A_TRADING_DAY}, and what it wrote. */
async function reconciled(
  report: readonly GatewayTransaction[],
  payments: readonly StoredPayment[],
): Promise<{
  run: Awaited<ReturnType<ReconciliationService["reconcile"]>>;
  ledger: DiscrepancyStore;
}> {
  const ledger = new DiscrepancyStore(payments);
  const service = new ReconciliationService();

  return {
    run: await service.reconcile(
      ledger.executor,
      A_TRADING_DAY,
      report,
      await propertyDays(),
    ),
    ledger,
  };
}

/**
 * The real rule about what day it is, over a configured hour.
 *
 * `SystemConfigService` is what is stood in for, and not `BusinessDateService`
 * itself, so that §2's rollover under test is the one the property runs on.
 * The only thing a unit test cannot supply is the row that holds the hour.
 *
 * It comes back as the rule rather than as the service, because that is what
 * `reconcile` takes: the comparison is handed a day boundary and reads no
 * configuration of its own.
 */
async function propertyDays(): Promise<BusinessDateRule> {
  return await new BusinessDateService({
    businessDateRolloverHour: async () =>
      await Promise.resolve(ROLLOVER_HOUR),
  } as unknown as SystemConfigService).rule(NO_EXECUTOR);
}

// The stand-in above answers out of a field, so the rule is read without a
// connection — the same device `business-date.service.spec.ts` uses.
const NO_EXECUTOR = undefined as unknown as DbExecutor;

/** A payment row as the ledger statement hands it back. */
interface StoredPayment {
  readonly id: string;
  readonly reference: string | null;
  readonly amount: VndAmount;
  readonly paidAt: Date | null;
}

type DiscrepancyValues = typeof paymentDiscrepancy.$inferInsert;

/**
 * The two statements the service issues, and the one guarantee that matters.
 *
 * `select` hands back the payments it was built with and reads no predicate,
 * which is deliberate: the statement's range is a coarse bound a day either
 * side of the business date, and the narrowing that decides which of those rows
 * belongs to the day is the service's own. A stand-in that filtered them here
 * would be answering the question the test is asking.
 *
 * `insert` keeps the unique key and nothing else. Every other constraint on
 * that table is the database's, and imitating them here would be this file
 * asserting against its own imitation.
 */
class DiscrepancyStore {
  readonly discrepancies: (DiscrepancyValues & { readonly id: string })[] = [];

  private readonly keys = new Set<string>();

  constructor(private readonly payments: readonly StoredPayment[]) {}

  get executor(): DbExecutor {
    return this as unknown as DbExecutor;
  }

  select() {
    return {
      from: () => ({ where: async () => await Promise.resolve(this.payments) }),
    };
  }

  insert() {
    return {
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

      // The index, standing in for itself: the second insert of one attempt on
      // one day writes nothing and returns nothing.
      if (this.keys.has(key)) {
        continue;
      }

      this.keys.add(key);

      const id = `discrepancy-${this.discrepancies.length + 1}`;

      this.discrepancies.push({ ...row, id });
      written.push({ id, reference: row.attemptReference, kind: row.kind });
    }

    return written;
  }
}
