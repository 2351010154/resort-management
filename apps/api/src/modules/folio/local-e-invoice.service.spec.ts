// The stub has one job — a closed folio always gets a reference back — and the
// tests below are attempts to make it fail at that from every direction the
// close flow could arrive from.
//
// No database and no Nest container: the class reads nothing and injects
// nothing, which is what makes it the implementation the close path can be
// written against before a provider exists.

import { describe, expect, it } from "vitest";
import { LocalEInvoiceService } from "./local-e-invoice.service.js";
import type {
  CorrectInvoiceInput,
  IssueInvoiceInput,
} from "./ports/e-invoice.port.js";

const FOLIO_ID = "6f1b7d64-3a2c-4d1e-9b83-0c5e2a7f4d10";

/** One night decomposed the way `FR-FOL-02` posts it, addressed to a guest. */
const CLOSED_FOLIO: IssueInvoiceInput = {
  folioId: FOLIO_ID,
  buyerName: "Nguyễn Thị Hương",
  closedAt: new Date("2026-08-08T10:30:00+07:00"),
  lines: [
    {
      description: "Phòng Deluxe — 07/08/2026",
      netAmount: 881_835n,
      taxAmount: 74_074n,
    },
    { description: "Phí phục vụ 5%", netAmount: 44_091n, taxAmount: 0n },
  ],
};

/** The same folio after a reversing posting — negative, as `money.ts` has it. */
const CORRECTION: CorrectInvoiceInput = {
  folioId: FOLIO_ID,
  buyerName: CLOSED_FOLIO.buyerName,
  originalReference: `LOCAL-INV-${FOLIO_ID}`,
  reason: "Huỷ phí phục vụ tính nhầm",
  correctedAt: new Date("2026-08-09T08:15:00+07:00"),
  lines: [
    { description: "Phí phục vụ 5%", netAmount: -44_091n, taxAmount: 0n },
  ],
};

describe("the local e-invoice issuer", () => {
  it("returns a reference that says which folio it stands for", async () => {
    const issued = await new LocalEInvoiceService().issue(CLOSED_FOLIO);

    expect(issued.reference).toContain(FOLIO_ID);
    // The prefix is what tells a reader afterwards that nothing was ever filed
    // with a tax authority against this stay.
    expect(issued.reference.startsWith("LOCAL-")).toBe(true);
  });

  it("dates the issuance rather than leaving the caller to guess", async () => {
    const before = Date.now();
    const issued = await new LocalEInvoiceService().issue(CLOSED_FOLIO);

    expect(issued.issuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(issued.issuedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  // The retry `FR-FOL-04` promises will happen — "a provider timeout never rolls
  // back a checkout" — arriving at an issuer that has forgotten the first call.
  // One stay must not end up with two legal numbers.
  it("issues one reference per folio however often it is asked", async () => {
    const service = new LocalEInvoiceService();

    const first = await service.issue(CLOSED_FOLIO);
    const second = await service.issue(CLOSED_FOLIO);

    expect(second.reference).toBe(first.reference);
  });

  it("gives two folios two references", async () => {
    const service = new LocalEInvoiceService();
    const other = "0b2f9c81-7e44-4a35-8d6a-1f3c5b9e0724";

    const first = await service.issue(CLOSED_FOLIO);
    const second = await service.issue({ ...CLOSED_FOLIO, folioId: other });

    expect(second.reference).not.toBe(first.reference);
  });

  it("marks an adjustment and a replacement apart from the invoice", async () => {
    const service = new LocalEInvoiceService();

    const adjusted = await service.adjust(CORRECTION);
    const replaced = await service.replace(CORRECTION);

    expect(adjusted.reference).toContain("ADJ");
    expect(replaced.reference).toContain("REP");
    expect(adjusted.reference).not.toBe(replaced.reference);
    expect(adjusted.issuedAt).toBeInstanceOf(Date);
    expect(replaced.issuedAt).toBeInstanceOf(Date);
  });

  // Unlike an invoice, a folio may be corrected more than once, and each
  // correction is its own document.
  it("numbers every correction separately", async () => {
    const service = new LocalEInvoiceService();

    const first = await service.adjust(CORRECTION);
    const second = await service.adjust(CORRECTION);

    expect(second.reference).not.toBe(first.reference);
    expect(second.reference).toContain(FOLIO_ID);
  });

  // The reason it exists at all: checkout completes before a provider does.
  // Every one of these would be a legitimate refusal for a real issuer, and the
  // stub takes all of them rather than blocking a desk.
  it("refuses nothing the close path could hand it", async () => {
    const service = new LocalEInvoiceService();

    const empty = await service.issue({ ...CLOSED_FOLIO, lines: [] });
    const nameless = await service.issue({ ...CLOSED_FOLIO, buyerName: "" });
    const credit = await service.issue({
      ...CLOSED_FOLIO,
      lines: [{ description: "", netAmount: -1n, taxAmount: -1n }],
    });
    const unreasoned = await service.adjust({ ...CORRECTION, reason: "" });
    const unlinked = await service.replace({
      ...CORRECTION,
      originalReference: "",
    });

    for (const issued of [empty, nameless, credit, unreasoned, unlinked]) {
      expect(issued.reference).not.toBe("");
    }
  });
});
