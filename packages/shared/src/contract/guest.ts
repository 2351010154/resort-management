// The guest record as routes — `FR-GST-03`, which is two endpoints and cannot
// be one.
//
// **Masked is not a mode.** {@link guest.readRecord} answers with
// {@link guestRecordSchema}, and that shape has no field a plain CCCD could
// travel in. There is no `unmasked` flag, no `?reveal=true`, and nothing a
// caller can send to widen the answer — the second route is the only way the
// number leaves, and it is governed by its own matrix row. A flag would put the
// audited path and the ordinary one behind one declaration, and
// `rbac-matrix.md` §2 refuses exactly that shape for cancellation waivers on
// the same grounds: authority belongs to the route, where it can be seen from
// the routing table, and not to a field inside a body.
//
// **The reveal is a POST because it writes.** Reading a number is an event the
// property keeps a record of — `guest.service.ts` writes one audit row in the
// same transaction — so it is not a GET, whatever it looks like from the desk.
// A collection path says the same thing: revealing is per visit, so two
// readings are two entries and never one entry read twice.
//
// **`reason` is optional and stays optional.** `schema/guest.ts` argues it:
// requiring one produces a column full of "check in", and the attribution — who
// looked, and when — is what makes the reading accountable.
//
// What is deliberately NOT here: creating a guest, or editing one. A guest is
// created inside the check-in transition, in that transition's transaction
// (`contract/booking.ts`'s `checkInGuestSchema`), and there is no route anywhere
// that rewrites a guest record from the guest realm — `FR-GST-01`'s profile,
// which is the other half of this file, is a different subject entirely and
// {@link guestProfileSchema} says why.
//
// ## The guest's own profile — `FR-GST-01`
//
// The second half of the file is the same domain read from the other side: two
// routes a signed-in guest reaches about themselves, under the matrix's "Own
// profile, loyalty, VIP tier" row. They are here rather than in a
// `guest-profile.ts` of their own for the reason `/bookings/mine` is in
// `contract/booking.ts`: a domain has one contract, and the guest's view of a
// thing is not a second domain. It is also what keeps the two CCCD fields in
// one file, where the difference between them can be seen at a glance.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/** The person every route below acts on. */
const guestIdFields = { guestId: z.uuid() };

/**
 * A guest as `guest.read-record` is allowed to see them — `GuestRecord`, on the
 * wire.
 *
 * `cccdMasked` is the whole of this file's confidentiality claim as a type: the
 * only CCCD field here is the masked one, so a handler cannot leak the number
 * through this schema by forgetting something. It is nullable because a guest
 * with no number on file and a guest whose number is withheld are different
 * facts, and `cccd-mask.ts` keeps them tellable apart.
 *
 * The birthday is ISO text, per `stay-date.ts`: a response carries the encoded
 * form and the controller performs the crossing. The two timestamps are
 * instants and take the full ISO-8601 form beside it.
 */
export const guestRecordSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  cccdMasked: z.string().nullable(),
  dateOfBirth: isoStayDateSchema.nullable(),
  nationality: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * One decision to look at one number.
 *
 * Bounded rather than free text of any length: the reason is typed at a desk
 * and read back in an investigation, and a column that can absorb a pasted
 * document is a column nobody reads.
 */
export const unmaskCccdInput = z.object({
  ...guestIdFields,
  reason: z.string().trim().max(200).nullish(),
});

/**
 * What was revealed, to whom, and when.
 *
 * `unmaskedBy` and `unmaskedAt` travel back because they are the audit row the
 * call just wrote — the caller is shown the record that was made of them,
 * rather than being asked to trust that one was.
 */
export const cccdRevealSchema = z.object({
  ...guestIdFields,
  cccdNumber: z.string(),
  unmaskedBy: z.uuid(),
  unmaskedAt: z.iso.datetime(),
});

/**
 * The three rungs of `property-and-tariff.md` §7's ladder, as a guest is shown
 * them.
 *
 * `LOYALTY_TIERS` in `rate-calendar.ts` holds two and is not widened to hold
 * this one: that tuple types a *promotion's gate*, and §7 gives the base tier no
 * discount, so a promotion gated on MEMBER would be gated on nothing. This is
 * the other question — what tier is this guest standing at — and MEMBER is a
 * real answer to it.
 *
 * The API's `schema/guest-tier.ts` is the authority on the vocabulary, and it
 * cannot be imported here: it is a Drizzle table on the far side of the
 * contract. What holds the two together is the compiler — the handler answers
 * with the derivation's own `DerivedTier`, so a fourth rung added there and not
 * here stops the API building rather than reaching a client as a string it has
 * no case for.
 */
export const vipTierSchema = z.enum(["MEMBER", "SILVER", "GOLD"]);

/**
 * The guest's own record of themselves, as `GET /profile` answers it —
 * `FR-GST-01`.
 *
 * **Four different facts arrive in one shape, and only one group is writable.**
 *
 * - `id`, `email` and `createdAt` are the *account* — `guest_user`. The address
 *   is what the guest signs in with and is changed through the realm's own
 *   re-verification flow, never here, which is why no update input below
 *   carries one.
 * - `fullName`, `phone`, `dateOfBirth` and `nationality` are the guest's own
 *   claim about themselves, from `guest_user_profile`. These four, and no
 *   others, are what {@link updateProfileInput} takes.
 * - `cccdMasked` is the *property's* record of them — read off a document at the
 *   desk, masked here exactly as {@link guestRecordSchema} masks it, and
 *   read-only in the strongest sense: this file declares no route by which a
 *   guest could write one, and a number typed into a profile screen would be a
 *   second, unverified source for a statutory record.
 * - `vipTier` and `loyaltyPoints` are *derived*. `FR-GST-04` recomputes the
 *   first from the trailing twelve months and `FR-GST-05` sums the second off an
 *   append-only ledger; neither is stored anywhere and neither can be sent in.
 *
 * `id` is a plain string and not a uuid: the guest realm's ids are Better
 * Auth's own base-62 text, per `schema/guest-auth.ts`.
 *
 * `loyaltyPoints` is a `bigint`, which the serialiser puts on the wire as text —
 * `money.ts` argues the choice for money and the argument carries: the column is
 * summed over a guest's whole history, and a `number` here would be a different
 * type for every reader of an integer Postgres already holds exactly. It is a
 * count rather than an amount, so it is not `vndAmountSchema`.
 *
 * The birthday is ISO text and `createdAt` is a full instant, on
 * {@link guestRecordSchema}'s split and for its reason.
 */
export const guestProfileSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.email(),
  dateOfBirth: isoStayDateSchema.nullable(),
  nationality: z.string().nullable(),
  cccdMasked: z.string().nullable(),
  vipTier: vipTierSchema,
  loyaltyPoints: z.bigint(),
  createdAt: z.iso.datetime(),
});

/**
 * The four fields a guest may change about themselves.
 *
 * **Strict, so a field that is not editable is refused rather than dropped.** An
 * ordinary Zod object strips what it does not know, which on a `PATCH` would
 * answer `200` to a caller who sent `cccdNumber` and changed nothing — the one
 * reply that tells somebody their edit landed when it did not. The unknown key
 * is a `400` instead, and the set of writable fields is therefore readable off
 * this schema rather than off the handler.
 *
 * **Absent leaves a field alone; `null` clears it.** That is what makes this a
 * `PATCH` rather than a `PUT`: a screen that edits one field sends one field,
 * and a guest with no nationality on file is not the same request as a guest
 * who did not touch the box. Clearing `fullName` is allowed and means the
 * account falls back to the name it was registered under — `schema/guest-
 * profile.ts` argues why that fallback is not copied into the row.
 *
 * Bounded at the lengths `checkInGuestSchema` bounds the same four facts at, so
 * a guest who fills their profile in is not refused at the desk for a name the
 * profile screen accepted. The blank string is refused by the trim and the
 * minimum rather than stored — `guest_user_profile`'s three checks say the same
 * thing from the database's side.
 *
 * `dateOfBirth` decodes `YYYY-MM-DD` into a `CalendarDate`, per `stay-date.ts`:
 * a request carries the codec and the response carries the text.
 */
export const updateProfileInput = z.strictObject({
  fullName: z.string().trim().min(1).max(120).nullish(),
  phone: z.string().trim().min(1).max(30).nullish(),
  dateOfBirth: stayDateSchema.nullish(),
  nationality: z.string().trim().min(1).max(60).nullish(),
});

export const guest = {
  readRecord: oc
    .route({ method: "GET", path: "/guests/{guestId}" })
    .input(z.object(guestIdFields))
    .output(guestRecordSchema),

  unmaskCccd: oc
    // POST to a collection of readings, and not a GET on the number: the call
    // appends an entry to `cccd_unmask_audit`, and `FR-GST-03` counts those per
    // call. A GET would invite a cache, a retry and a prefetch to each file a
    // reading nobody performed.
    .route({ method: "POST", path: "/guests/{guestId}/cccd-reveals" })
    .input(unmaskCccdInput)
    .output(cccdRevealSchema),

  // ── The guest's own record of themselves — `FR-GST-01` ─────────────────────

  readProfile: oc
    // `/profile` and not `/profile/{userId}`, which is the whole security claim
    // stated as a path. The subject is the session, so there is no id for a
    // caller to substitute and no ownership comparison for a handler to forget;
    // the route that could answer about somebody else does not exist. It is the
    // same choice `/bookings/mine` makes, and for the same reason.
    .route({ method: "GET", path: "/profile" })
    .output(guestProfileSchema),

  updateProfile: oc
    // `PATCH`, because the body is a set of changes and not a whole profile —
    // {@link updateProfileInput} argues what absent and null each mean. `PUT`
    // would oblige a screen editing a phone number to send the birthday back
    // with it, and a screen that got that wrong would clear a field nobody
    // touched.
    //
    // **Feed-forward, and nothing else.** What this writes prefills the next
    // booking and the next check-in. It rewrites no registration, no booking, no
    // folio and no invoice — not by a rule the handler applies but because
    // `guest_user_profile` has no path to any of them, which is what that
    // table's own header is about.
    .route({ method: "PATCH", path: "/profile" })
    .input(updateProfileInput)
    // The profile as it now stands, derived figures included, so a screen that
    // saved a field does not have to fetch the page again to render it.
    .output(guestProfileSchema),
};
