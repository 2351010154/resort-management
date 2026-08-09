// Turning a stay's ledger into the document the guest is handed.
//
// The job's other half — which folios it picks up, what it does with the
// reference, and that it picks each up once — needs a database and is asserted
// in `test/folio-close.e2e-spec.ts`. This is the mapping, which needs none: the
// ledger goes in as rows and the invoice comes out as lines, and every case
// below is a row that must not appear on a legal document or an amount that
// must not move.
//
// The claim holding the file together is stated once and checked in every case:
// **the lines total what the guest settled.** A closed folio sums to nothing —
// `FolioService.close` refuses any other kind — so the charges left standing on
// it are exactly the negation of the money taken, and an invoice that dropped a
// line or double-counted a tax would say the property was paid something it was
// not.
//
// The figures are deliberately unreal. §8 forbids the tree from carrying a rate,
// and a fixture that read like the property's own would be that defect wearing a
// test's clothes.

import { describe, expect, it } from "vitest";
import { invoiceLines, type LedgerLine } from "./e-invoice.job.js";

const A_NIGHT = "Room charge, night of 2027-09-02";

/** One night as `FR-FOL-02` posts it: the charge, and the two lines levied on
 *  it. The three sum to the gross figure the guest agreed to. */
const CHARGE: LedgerLine = row("charge", "ROOM_CHARGE", 862_470n, A_NIGHT);
const SERVICE_CHARGE: LedgerLine = row(
  "service",
  "SERVICE_CHARGE_FEE",
  27_685n,
  `Service charge on ${A_NIGHT}`,
  { parentPostingId: "charge" },
);
const VAT: LedgerLine = row("vat", "VAT", 109_845n, `VAT on ${A_NIGHT}`, {
  parentPostingId: "charge",
});

/** What the guest handed over for that night, stored as the ledger holds it. */
const PAYMENT: LedgerLine = row("paid", "PAYMENT", -1_000_000n, "Card, ****4242");

describe("the invoice drawn from a settled account", () => {
  it("states a charge together with the tax levied on it", async () => {
    const lines = invoiceLines([CHARGE, SERVICE_CHARGE, VAT, PAYMENT]);

    // Two lines and not three: `FR-FOL-02` posts the tax as a row of its own
    // because §5 refuses to fold it into the charge, and the port asks for the
    // same fact the other way round.
    expect(lines).toEqual([
      { description: A_NIGHT, netAmount: 862_470n, taxAmount: 109_845n },
      {
        description: `Service charge on ${A_NIGHT}`,
        netAmount: 27_685n,
        // The service charge carries no tax row of its own — `system_config`
        // levies VAT over it and the resulting line hangs off the room charge —
        // so this is zero, and zero is written rather than omitted.
        taxAmount: 0n,
      },
    ]);

    expect(settled(lines)).toBe(1_000_000n);
  });

  it("says nothing about how the account was settled", async () => {
    // A payment and a refund are not things the guest bought. An invoice that
    // listed them would total nothing, because a closed folio sums to nothing.
    const lines = invoiceLines([
      CHARGE,
      SERVICE_CHARGE,
      VAT,
      row("paid", "PAYMENT", -1_200_000n, "Card, ****4242"),
      row("back", "REFUND", 200_000n, "Overpayment returned"),
    ]);

    expect(lines).toHaveLength(2);
    expect(settled(lines)).toBe(1_000_000n);
  });

  it("drops a mistake and the correction that undid it, as a pair", async () => {
    // `FR-FOL-01` corrects with a reversing entry and leaves the mistake
    // standing on the ledger, which is right for the ledger and wrong for the
    // guest: a charge and its cancellation on an invoice reads as something
    // they bought and returned. The pair sums to nothing, so the total does not
    // move — and `migrations/0016` refuses a posting on a closed folio, so every
    // reversal on this account was made before the invoice existed.
    const mistake = row("wrong", "SERVICE_ITEM", 300_000n, "Minibar, room 402", {
      serviceCatalogId: "minibar",
    });

    const lines = invoiceLines([
      CHARGE,
      SERVICE_CHARGE,
      VAT,
      mistake,
      row("undone", "REVERSAL", -300_000n, "Reverses Minibar, room 402", {
        reversesPostingId: "wrong",
      }),
      PAYMENT,
    ]);

    expect(lines.map((line) => line.description)).not.toContain(
      "Minibar, room 402",
    );
    expect(lines).toHaveLength(2);
    expect(settled(lines)).toBe(1_000_000n);
  });

  it("drops the tax of a night that was reversed along with the night", async () => {
    // `reversePosting` undoes the sale and everything levied on it, so all three
    // rows are corrected and all three leave the document. A tax line whose
    // charge had gone would otherwise stay folded into a principal that is no
    // longer there — an amount on the invoice with nothing accounting for it.
    const lines = invoiceLines([
      CHARGE,
      SERVICE_CHARGE,
      VAT,
      row("undo-charge", "REVERSAL", -862_470n, `Reverses ${A_NIGHT}`, {
        reversesPostingId: "charge",
      }),
      row("undo-service", "REVERSAL", -27_685n, "Reverses service charge", {
        reversesPostingId: "service",
      }),
      row("undo-vat", "REVERSAL", -109_845n, "Reverses VAT", {
        reversesPostingId: "vat",
      }),
    ]);

    expect(lines).toEqual([]);
    expect(settled(lines)).toBe(0n);
  });

  it("keeps the order the account was run up in", async () => {
    // The rows arrive in business-date order, and an invoice a guest checks
    // against their stay has to read down the nights in the same direction.
    const second = row("charge-2", "ROOM_CHARGE", 500_000n, "Night two");

    const lines = invoiceLines([CHARGE, SERVICE_CHARGE, VAT, second, PAYMENT]);

    expect(lines.map((line) => line.netAmount)).toEqual([
      862_470n,
      27_685n,
      500_000n,
    ]);
  });

  it("has nothing to say about an account nobody posted to", async () => {
    // A stay that ran up no charge settles at nothing and closes, so this is an
    // ordinary answer rather than a folio in a broken state.
    expect(invoiceLines([])).toEqual([]);
  });
});

/** What the lines say the property was paid, which is the sum of both columns
 *  — the one figure `NFR-02` ties the document back to the ledger with. */
function settled(lines: readonly { netAmount: bigint; taxAmount: bigint }[]) {
  return lines.reduce((total, line) => total + line.netAmount + line.taxAmount, 0n);
}

/** A posting, less every column the invoice does not read. */
function row(
  id: string,
  type: LedgerLine["type"],
  amount: bigint,
  description: string,
  links: Partial<Pick<LedgerLine, "parentPostingId" | "reversesPostingId">> & {
    serviceCatalogId?: string;
  } = {},
): LedgerLine {
  return {
    id,
    type,
    amount,
    description,
    reversesPostingId: links.reversesPostingId ?? null,
    parentPostingId: links.parentPostingId ?? null,
  };
}
