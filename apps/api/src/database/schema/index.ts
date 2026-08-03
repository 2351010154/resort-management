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
