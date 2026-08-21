// Which changes count as the property's money — the whole of "ACC: financial
// entries only", written down once.
//
// `rbac-matrix.md` §"Reports and audit" grants the *Audit log viewer* row
// `ACCOUNTANT: ⚠`, `MANAGER: ✅`, `ADMIN: ✅`, and §2 says what a ⚠ is: a full
// grant whose scope the guard cannot see, with the handler still owing the
// check. This file is the fact that check is made against, and it is a table
// rather than a chain of `if`s in a query builder for the reason the matrix
// itself is a table: a scoping rule spread across a handler is a rule nobody can
// read in one sitting, and the first person to add a route would apply half of
// it.
//
// **The rule the list below was cut with, in one sentence:** a change is
// financial when the row it happened to *is* money the property has to account
// for — a ledger line, a payment, a drawer, or a published price everything
// above is computed from — **and** the accountant already holds a grant on the
// matrix row that governs that table elsewhere in the console.
//
// The second half is what stops this list from quietly widening the accountant's
// authority. The audit log holds a whole row of every table it covers, so an
// entry admitted here hands over a `to_jsonb` of that row — every column of it.
// A table the matrix denies the accountant on its own screen must therefore be
// denied here too, or the viewer becomes the side door to it. `system_config` is
// the case that proves the rule and the reason the rule has two halves: it holds
// the VAT rates, which are unambiguously money, and the matrix gives the
// accountant nothing on that row at all — `MANAGER: 👁`, `ADMIN: ✅` — because
// the same row carries the property's gateway configuration. It is money, and it
// is not theirs, so it is not here.
//
// **What is deliberately not on the list, and why:**
//
// - `system_config` — above. Money, denied elsewhere, excluded here.
// - `property_tariff` — the same argument. `schema/pricing.ts` says the figure
//   in it is "config it is one of" and points at the row `system_config` is
//   under, where the accountant holds nothing.
// - `stay_restriction` — a minimum stay and a closed-to-arrival flag are
//   commercial rules with no đồng in them, and the matrix denies the accountant
//   the *Stay restrictions* row outright.
// - `booking` and `booking_night` — the largest judgement here. Both carry
//   figures, and both are excluded: a booking's subject is a stay, and the money
//   on it is a quote frozen when it was taken rather than an amount the property
//   has accounted for. Admitting them would make the room move, the extension,
//   the cancellation and the guest's own particulars financial by association,
//   which is most of the change log — and the ⚠ on this row exists precisely so
//   the accountant is not handed the operational trail.
// - `loyalty_ledger`, and the trail beside it that records a guest's rung
//   changing — points and a standing, not đồng, and the matrix gives the
//   accountant nothing on the loyalty row.
// - `booking_link`, `pending_item`, `guest`, `registration`, `cccd_unmask_audit`,
//   `room`, `room_type`, `type_inventory`, `room_condition`, `room_assignment`,
//   `staff_user`, `feedback` — none of them holds money, and several of them are
//   the guest's personal data or the property's own accounts.
//
// **A table nobody has heard of is not financial.** The membership test is
// exact-match against this list, so a table added to the schema tomorrow, or one
// audited by a writer added tomorrow, is invisible to a narrowed reader until
// somebody decides here that it should not be. That is the direction a scoping
// rule has to fail in: the honest cost is an accountant who has to ask for a
// table to be added, and the alternative cost is an accountant who was shown
// something nobody decided to show them.
//
// **Some of these are not audited yet, and that is not speculation.** No writer
// files `folio_posting` or `payment` changes today; `contract/index.ts`'s rule
// against listing things speculatively is about promises the type system holds a
// caller to, and this is not one — it is a predicate, and a table named here
// that never appears simply never matches. Naming them now is what makes the day
// the ledger starts filing entries a day with no second authorisation decision
// in it.

/**
 * The tables whose changes an `ACCOUNTANT` may read.
 *
 * In the order the money moves: the account a stay runs up, the lines on it, the
 * money that arrived, what the gateway said about it, the drawer it was counted
 * into, and the published prices all of it is computed from.
 */
export const FINANCIAL_TABLES: readonly string[] = [
  // The stay's account, and every line on it — charges, payments, refunds and
  // the reversals that correct them. `rbac-matrix.md` gives the accountant ✅ on
  // *Read folio*, *Post charge*, *Post payment*, *Reverse a posting* and
  // *Close folio, issue invoice*.
  "folio",
  "folio_posting",
  // Money as the payer's side reported it, and what the nightly comparison made
  // of it. *Gateway reconciliation*, ✅.
  "payment",
  "payment_discrepancy",
  "payment_reconciliation_run",
  // The desk's cash: the float, the count, the variance. *Cash drawer open /
  // close / count*, 👁 — a read-only grant elsewhere is still a grant, and this
  // viewer is a read.
  "shift",
  // What a night is sold at, and the discounts off it. *Rate plans, rate
  // calendar, promotions*, 👁.
  "rate_plan",
  "rate_calendar",
  "promotion",
  // What the property charges for everything that is not a night. *Read the
  // service catalog*, 👁 — a change here is a change to what a guest is billed.
  "service_catalog",
];
