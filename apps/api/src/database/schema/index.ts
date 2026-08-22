// The single entry point drizzle-kit reads to diff the schema and the single
// object the Drizzle client is typed by. One file per domain lands here, each
// re-exported below and owned by the module that names it —
// docs/architecture/repository-structure.md §apps/api.

// The staff realm: accounts, roles and refresh tokens. Owned by
// `modules/identity`.
export * from "./identity.js";

// The property — the five room types and the forty rooms — and the two layers
// of inventory sold against them. Owned by `modules/inventory`.
export * from "./inventory.js";

// What a night costs and whether it may be sold — the rate calendar the
// availability query prices against. Owned by `modules/pricing`.
export * from "./pricing.js";

// The stay itself: its state, its nights and the price it was sold at. Owned by
// `modules/booking`.
export * from "./booking.js";

// The links a confirmation email carries — one that re-issues the booking
// cookie, one that creates the account a stay attaches to — and the instant
// each is spent at, which is what makes them single-use. Beside the booking
// because that is what they point at, and owned by `modules/auth/booking-token`
// because that is what signs them.
export * from "./booking-link.js";

// Who stayed and who read their ID number: the guest record, the registration
// written at check-in, and the unmask audit trail. Owned by `modules/guest`.
export * from "./guest.js";

// What an account holder says about themselves, so a future booking and a
// future check-in can be prefilled from it. A different fact from the guest
// record above — that one is read off a document at the desk, this one is
// typed by the subject — and the reason the two are not one table is the
// statutory record that references the first. Owned by `modules/guest`.
export * from "./guest-profile.js";

// What state each room is in — clean, dirty, inspected or out of order — on an
// axis of its own, independent of who is staying in it. Owned by
// `modules/housekeeping`.
export * from "./housekeeping.js";

// The tax and clock figures no calculation may compile in — the VAT rate, the
// dates the reduced rate covers, whether the VAT base includes service charge,
// the service-charge rate and the hour the business date rolls. Edited by
// `ADMIN` behind `system.config`, read at posting time.
export * from "./config.js";

// What the property sells besides a night — the eight seeded items of
// `property-and-tariff.md` §6, each with the tax class its folio line posts
// under. Owned by `modules/folio`.
export * from "./service.js";

// The account a stay runs up, and the append-only lines it is made of. The
// balance is their sum and is never stored; `UPDATE` and `DELETE` on a line are
// refused by the database itself. Owned by `modules/folio`.
export * from "./folio.js";

// What the property was actually paid, as the payer's side reports it — the
// other half of `NFR-02`'s nightly identity. A gateway's own transaction id is
// unique here, which is what makes a replayed callback post one payment rather
// than one per delivery. Owned by `modules/payment`.
export * from "./payment.js";

// Where the gateway's daily report and the property's own ledger disagree —
// one row per attempt per business date, and nothing at all on a day the two
// said the same thing. The unique key on that pair is what lets the nightly
// comparison be re-run without filing the same disagreement twice. Owned by
// `modules/payment`.
export * from "./reconciliation.js";

// What a stay earned its guest — one append-only row per closed folio, and no
// balance anywhere. The tier is not here and never will be: `FR-GST-04` derives
// it. Owned by `modules/guest`.
export * from "./loyalty.js";

// When the nightly recomputation found a guest on a different rung of §7's
// ladder from the one it last recorded. A trail of observations and never the
// tier itself, which stays derived — `modules/guest` owns both, and the
// derivation is the only thing that answers what tier a guest holds.
export * from "./guest-tier.js";

// The desk's working day: who has the drawer open, what was counted into it and
// out of it, and what the outgoing shift could not finish. Every cash payment
// names one of these rows and no gateway payment does, which is what keeps a
// handover variance computable. Owned by `modules/operations`.
export * from "./shift.js";

// The property's own money, which the folio never sees: categorised income and
// expense, append-only, and — where the đồng passed through a till — bound to
// the drawer whose count has to account for them. Owned by `modules/operations`.
export * from "./cash-book.js";

// What a guest thought of a stay they have finished — one row per booking, and
// no row at all for a stay that has not ended. Owned by `modules/feedback`.
export * from "./feedback.js";

// The change log every state-changing action writes to — who changed which row
// of which table, when, and what it looked like on either side. Owned by
// `modules/audit`; written by the module that owns the row being changed.
export * from "./audit.js";

// The guest realm: Better Auth's four core tables. Their in-file names are
// Better Auth's own (`user`, `session`, …) because its Drizzle adapter indexes
// the schema object it is given by those keys. Everything outside
// `modules/auth/guest` refers to them by the `guest*` aliases below, which say
// which realm a query is touching.
export {
  account as guestAccount,
  session as guestSession,
  user as guestUser,
  verification as guestVerification,
} from "./guest-auth.js";
