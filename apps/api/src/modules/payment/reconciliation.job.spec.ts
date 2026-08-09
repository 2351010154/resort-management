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

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import type { ReconciledAttempt } from "./reconciliation.service.js";
import { sentenceFor } from "./reconciliation.job.js";

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

/** One classified attempt, with only the fields the sentence reads. */
function attempt(
  outcome: Omit<ReconciledAttempt, "reference">,
): ReconciledAttempt {
  return { reference: A_REFERENCE, ...outcome };
}
