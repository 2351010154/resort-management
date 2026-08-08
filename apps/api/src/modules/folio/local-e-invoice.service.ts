// An issuer that issues nothing, so that closing a folio still works.
//
// `FR-FOL-04` is conditional on `ASM-03` — whether Nghị định 70/2025 binds this
// operating entity at all — and on `ASM-04`, which of two providers the
// accountant ends up in. Both are unanswered, and the milestone says outright
// that the Viettel or MISA client is not its work. What *is* its work is the
// close flow, its idempotency and the reference stored beside the folio, and
// none of that can be built or tested against a port with nothing behind it.
//
// So this stands in, and the standing in is the whole of it: it returns a
// reference the caller can store and it does not fail. `ports/folio-stub.
// service.ts` was written under the same argument for the same reason — a path
// wired in at the end is a path whose first exercise is in production.
//
// **It records nothing.** No table, no row, no migration. A local invoice table
// would be a second register of legal numbers that the real provider's arrival
// makes wrong, and `schema/folio.ts` already refuses to hold a reference for a
// milestone that does not have the ruling in hand. The reference below is
// therefore the only trace, which is why it carries the folio it belongs to.
//
// **The `LOCAL-` prefix is load-bearing at the desk, not in code.** Nothing here
// parses these strings, and `e-invoice.port.ts` says why nothing should. The
// prefix is for the person who finds one of them on a folio after the real
// provider is live and needs to know at a glance that no invoice was ever filed
// against it.

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  CorrectInvoiceInput,
  EInvoicePort,
  IssuedInvoice,
  IssueInvoiceInput,
} from "./ports/e-invoice.port.js";

@Injectable()
export class LocalEInvoiceService implements EInvoicePort {
  /**
   * One folio, one reference, and the same one however often this is called.
   *
   * Derived from the folio id rather than from a clock or a nonce, because
   * `FR-FOL-04` allows one invoice per folio and this is the only implementation
   * that can be held to it for free. A stub that minted a fresh number on each
   * call would hand a retrying job a second legal reference for one stay —
   * exactly the defect the requirement keys its idempotency against — and would
   * do it in the milestone where the retry path is being written and tested.
   *
   * The caller is not relieved of that check. `FR-FOL-04` keys idempotency at
   * the database because no real provider offers this guarantee.
   */
  // Not `async`, though the port is: there is nothing here to await, and a
  // resolved promise is what an `async` body returning a literal produces
  // anyway. The signature is the port's and is satisfied either way.
  issue(input: IssueInvoiceInput): Promise<IssuedInvoice> {
    return Promise.resolve(this.issued(`LOCAL-INV-${input.folioId}`));
  }

  /** *Điều chỉnh*, and a folio may need more than one — so, a fresh number. */
  adjust(input: CorrectInvoiceInput): Promise<IssuedInvoice> {
    return Promise.resolve(this.corrected("ADJ", input));
  }

  /** *Thay thế*, and a replacement may itself be replaced. Likewise fresh. */
  replace(input: CorrectInvoiceInput): Promise<IssuedInvoice> {
    return Promise.resolve(this.corrected("REP", input));
  }

  /**
   * A correction's reference: the folio, what kind of correction, and a nonce.
   *
   * It does not embed {@link CorrectInvoiceInput.originalReference}. The link
   * between a correction and what it corrects is a column the caller writes, not
   * a substring — and nesting one reference inside another grows without bound
   * once a replacement is replaced.
   */
  private corrected(kind: string, input: CorrectInvoiceInput): IssuedInvoice {
    // Thirty-two characters and no counter this process would have to keep
    // across restarts, which is the reason `payment.service.ts` mints its own
    // references the same way.
    const nonce = randomUUID().replaceAll("-", "");

    return this.issued(`LOCAL-${kind}-${input.folioId}-${nonce}`);
  }

  /**
   * Now, because this class is the issuer.
   *
   * The port has the provider stamp `issuedAt` by its own clock rather than
   * echoing the close, and here the two are the same clock — there is no third
   * party whose record could differ from ours.
   */
  private issued(reference: string): IssuedInvoice {
    return { reference, issuedAt: new Date() };
  }
}
