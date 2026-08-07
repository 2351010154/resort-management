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

// Who stayed and who read their ID number: the guest record, the registration
// written at check-in, and the unmask audit trail. Owned by `modules/guest`.
export * from "./guest.js";

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
