// What the folio is allowed to know about whoever issues its invoices.
//
// `FR-FOL-04` asks for the shape rather than the answer. It names "an
// `EInvoicePort` naming what the folio needs from a provider" and then puts the
// Viettel or MISA client, HSM signing and the *máy tính tiền* decision
// explicitly outside this milestone, because `ASM-03` and `ASM-04` are questions
// the tax agent and the accountant have not answered. Writing the interface now
// is what makes the answer a second adapter instead of a second folio.
//
// `payment/ports/payment-gateway.port.ts` argues the same boundary for the
// gateway that moves the money, and the argument carries over unchanged: a port
// is the caller's list of needs, not the provider's list of capabilities. Form
// codes, template symbols, XML envelopes, transmission status enums and the unit
// a provider happens to count in stay inside the adapter that speaks to it. What
// crosses here is the ledger's own vocabulary — a folio, the lines on it, who it
// is addressed to, and the reference that comes back.
//
// Every method is asynchronous for the reason that file gives at its close:
// whether issuing costs a round trip belongs to the provider, and a synchronous
// signature would make the first one that needs a network the rewrite of every
// caller. `booking/ports/folio-stub.service.ts` shows the other side of that
// trade — an implementation with nothing to await returns a resolved promise and
// pays nothing for it.

import type { VndAmount } from "@mariva/shared";

/**
 * One line of the invoice, as the ledger can honestly state it.
 *
 * Net and tax stand apart because that is how the folio holds them:
 * `FR-FOL-02` decomposes one agreed gross figure into a charge, a service
 * charge and a VAT line, and §5 refuses to fold any of the three into another.
 * A line here is one of those charges together with the tax levied on it.
 *
 * Both amounts are signed, which is what lets an adjustment be described in the
 * same type as an issue. `money.ts` fixes that convention — "a refund or a
 * reversing entry is a negative charge" — and `FR-FOL-04` maps *điều chỉnh* onto
 * exactly those reversing postings.
 *
 * What is absent, and deliberately. **Quantity and unit price**: a
 * `folio_posting` has neither, only an amount and the description written at
 * posting time, so a quantity crossing this port would be invented rather than
 * reported. **The tax rate**: `schema/folio.ts` keeps rates off the ledger on
 * purpose — "what a line's tax was is the line; what the rate was is
 * `system_config` read at posting time" — so the rate is not the folio's to
 * hand over. A provider that requires either arrives with the ruling that says
 * so, and adds the field alongside the column that can answer it.
 */
export interface InvoiceLine {
  /**
   * What the guest reads against this amount.
   *
   * The posting's own description and not a rendering of it. `schema/folio.ts`
   * stores that text at posting time precisely because "an invoice is a legal
   * document that cannot quietly change its own wording" when a catalog item or
   * a room is renamed afterwards.
   */
  readonly description: string;

  /** The charge before tax, in đồng. */
  readonly netAmount: VndAmount;

  /** The VAT levied on {@link netAmount}. Zero is a real answer — §8. */
  readonly taxAmount: VndAmount;
}

/** The parts of an invoice the folio owns, whatever the document is for. */
interface InvoiceContent {
  /**
   * The stay being invoiced, and the caller's name for the document.
   *
   * It is on the port rather than kept privately by the caller because
   * `FR-FOL-04` promises "a provider timeout never rolls back a checkout": the
   * close stands, the job retries, and a retry the provider cannot recognise as
   * the same request issues a second legal invoice for one stay. Only the caller
   * can mint a key that survives its own timeout, so it names the document here
   * and an adapter with somewhere to put that key uses it.
   *
   * The property's idempotency does not depend on the provider honouring it —
   * `FR-FOL-04` keys that at the database — but nothing at the database can
   * withdraw a number a provider already issued.
   */
  readonly folioId: string;

  /**
   * Who the invoice is addressed to: the primary registration's guest.
   *
   * A name and nothing else, because a name is all the property stores. `guest`
   * has no address column and no tax code, so an invoice to a company — which
   * legally needs both — is not something this codebase can produce yet, and
   * optional fields every caller fills with `undefined` would suggest otherwise.
   * The requirement that adds a company buyer adds the columns and these fields
   * together.
   */
  readonly buyerName: string;

  /**
   * The lines, in the order they should appear.
   *
   * No total accompanies them. It would be the sum of what is already here, and
   * `schema/folio.ts` refuses a stored balance for the same reason — a second
   * place for one figure to live is a second figure that can disagree. An
   * adapter whose provider wants the total declared adds it up.
   */
  readonly lines: readonly InvoiceLine[];
}

/** A first invoice for a folio that has just been agreed and closed. */
export interface IssueInvoiceInput extends InvoiceContent {
  /**
   * When the desk closed the folio, by the property's clock.
   *
   * The caller supplies it because issuance is not synchronous: `FR-FOL-04` puts
   * it on a queue so that a slow provider cannot hold up a checkout, and the job
   * may run a moment later or, after a failure, the following morning. An
   * adapter stamping its own clock would date the invoice by when the queue got
   * to it. `schema/folio.ts` says what this instant means — "the invoice is
   * issued when the desk closed the folio".
   */
  readonly closedAt: Date;
}

/**
 * An invoice that corrects one already issued — *điều chỉnh* or *thay thế*.
 *
 * One shape for both, because the two differ in what the lines say rather than
 * in what the provider must be told; {@link EInvoicePort.adjust} and
 * {@link EInvoicePort.replace} each state which reading applies.
 */
export interface CorrectInvoiceInput extends InvoiceContent {
  /**
   * The provider's number for the invoice being corrected.
   *
   * `FR-FOL-04` makes that number "the legal reference", and a correction that
   * did not name it would be an unrelated second invoice for the same stay.
   */
  readonly originalReference: string;

  /**
   * Why, in the words that go on the correcting document.
   *
   * A correction states its own cause on its face; the reversing postings
   * `FR-FOL-04` maps this onto already carry that text, so the caller is
   * repeating what the ledger says rather than composing something new.
   */
  readonly reason: string;

  /** When the correcting postings were written, by the property's clock. */
  readonly correctedAt: Date;
}

/** What came back, and it is the only thing worth keeping. */
export interface IssuedInvoice {
  /**
   * The provider's number. `FR-FOL-04`: this is the legal reference.
   *
   * Opaque here on purpose. Nothing above the adapter parses it, splits it or
   * infers a serial, a form code or a date from it — the moment something does,
   * the format is a contract and the second provider breaks it.
   */
  readonly reference: string;

  /**
   * When the provider issued it, by the provider's clock and not ours.
   *
   * The same distinction `payment-gateway.port.ts` draws for the moment a
   * gateway took the money: what we asked for and what a third party recorded
   * are separate facts, and an invoice dated by our clock cannot be reconciled
   * against the register that will be audited.
   */
  readonly issuedAt: Date;
}

/** The three things the property asks of whoever issues its invoices. */
export interface EInvoicePort {
  /** Issue the invoice for a folio that has been closed. */
  issue(input: IssueInvoiceInput): Promise<IssuedInvoice>;

  /**
   * Correct part of an issued invoice — *điều chỉnh*.
   *
   * The lines are the difference and not the corrected whole: they are the
   * reversing postings, signed as `money.ts` requires, so the original invoice
   * and this one are read together. The original stays valid.
   */
  adjust(input: CorrectInvoiceInput): Promise<IssuedInvoice>;

  /**
   * Supersede an issued invoice entirely — *thay thế*.
   *
   * The lines are the whole folio as it now stands, and the document that comes
   * back stands in place of the original rather than beside it.
   */
  replace(input: CorrectInvoiceInput): Promise<IssuedInvoice>;
}

/** DI token. An interface is a type and erases; the binding needs a value. */
export const E_INVOICE_PORT = Symbol("E_INVOICE_PORT");
