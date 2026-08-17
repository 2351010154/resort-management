// The figures no calculation may compile in, as the two calls that read and
// change them — `FR-IDN-03`: the standard and reduced VAT rates and the dates
// dividing them, whether the VAT base includes service charge, the
// service-charge rate and the hour the property's day rolls are "data, editable
// by ADMIN without a deploy".
//
// `docs/architecture/property-and-tariff.md` §8 is the reason there is a wire
// contract for this at all. A rate the tree knows is a rate a deploy changes,
// and the defect that produces does not throw — it silently mis-invoices, and
// an invoice is a legal document a third party issued and cannot quietly
// reissue. The row exists so the accountant's answer can arrive as an edit; a
// screen to make that edit is the other half of the same argument.
//
// **One resource, one row, one read and one PATCH.** `schema/config.ts` argues
// at length for why the table is one row of columns rather than a bag of
// key/value pairs — a decomposition reads the rate, the window and the base
// rule together, and three lookups can straddle an edit. The wire keeps that
// shape for the same reason: a caller reads the whole configuration in one
// answer, so nothing it renders can be half of one configuration and half of
// another.
//
// **§7's loyalty figures ride the same resource, and for a different reason.**
// The tax figures are here because nobody in this repository may answer them.
// The earn rate and the tier thresholds are here because §7 says the developer
// proposes them and the property tunes them — the same storage, a different
// owner. Putting them on this resource rather than on one
// of their own follows the argument below about reading a configuration whole: a
// screen shows what a stay costs and what it earns together, and `schema/
// config.ts` keeps all of it in one row so that nothing can read half of one
// configuration beside half of another. What is *not* here is a tier:
// `FR-GST-04` derives it on read, and these fields are the thresholds it is
// derived from.
//
// **PATCH and not PUT.** Every field is optional and the omitted ones are left
// alone. A PUT would demand every figure on every call, and the fields here are
// answers that arrive at different times — `ASM-01` is answered provisionally
// from published sources rather than by a practising accountant, and a
// correction may land on one rate, or on the relief period, without touching the
// rest. An `ADMIN` correcting the rollover hour must not have to restate a tax
// rate they were not asked about. It also makes the dangerous edit the explicit
// one: a field absent from the body is a field nobody touched.
//
// **Every bound below is a ceiling, never a rate.** 10000 basis points is 100%
// and 23 is the last hour of a day; both are the point past which the figure is
// a typo rather than a decision. No default sits behind any of them, because a
// default rate is the prohibition in §8 wearing a schema's clothes — it would
// put a tax rate in this repository just as surely as a constant would.
//
// **The window's own invariant is deliberately not checked here.** A window
// that closes before it opens covers no date, and refusing that pair needs both
// ends — but a PATCH may name one end and leave the other where it stands, so
// only the server, holding the stored row beside the edit, can see the pair
// this call would produce. `system-config.service.ts` refuses it there, in the
// same transaction that would have written it.
//
// **What this contract cannot carry, and why.** The matrix row governing these
// routes reads "System config (tax rates, business date, gateway credentials)",
// and one of those three is absent from the table and therefore from here.
// Gateway credentials stay in the environment, by the decision
// `schema/config.ts` records: a secret in a table an `ADMIN` screen reads is a
// secret with a wider audience than the process that spends it. So the read
// answers a stated list of figures and there is no field on it a credential
// could travel in. A statutory retention floor is not missing from that list —
// it was removed from the row, because `FR-GST-02` stores no identity-document
// image and the floor that remains over the registration record has no reader.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema, vndAmountSchema } from "../money.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/**
 * The ceiling on a rate expressed in basis points — 100%, and unreachable as an
 * answer.
 *
 * Above it the figure is a typo in a basis-points field, and a typo that
 * reaches a posting multiplies a room charge by hundreds. Zero is a real answer
 * at the other end: a zero-rated supply and a property that levies no service
 * charge are both coherent configurations rather than mistakes.
 */
const HIGHEST_RATE_BPS = 10_000;

/** An hour of the property's own day. 24 is a count somebody means as midnight. */
const LAST_HOUR_OF_THE_DAY = 23;

/**
 * A rate as **basis points** — whole integers, a hundredth of a percent each,
 * so 800 is 8% and 500 is 5%.
 *
 * Never a float and never a decimal: `NFR-12` puts money on integers, and a
 * rate carried as `0.08` reintroduces at the rate what storing đồng as integers
 * removed at the amount. Basis points also carry the precision a statutory rate
 * needs — 1.5% is 150 — with no representation that cannot be compared for
 * equality.
 */
const rateBasisPoints = z.number().int().min(0).max(HIGHEST_RATE_BPS);

const hourOfTheDay = z.number().int().min(0).max(LAST_HOUR_OF_THE_DAY);

/**
 * The largest value a `smallint` column holds, and therefore the last answer
 * this contract can carry into one.
 *
 * Not a policy about how many stays a tier may ask for — nobody has decided
 * that, and inventing a ceiling here would be this file settling a question §7
 * left to the property. It is the point past which the figure stops being
 * storable, and a 400 naming the field is a better answer than the 500 Postgres
 * would give for the same value.
 */
const LARGEST_SMALLINT = 32_767;

/**
 * A count of stays a tier is reached at. At least one: a rung at zero stays is
 * one every guest is already standing on.
 */
const stayCount = z.number().int().min(1).max(LARGEST_SMALLINT);

/**
 * An amount of đồng that has to be more than nothing — a divisor or a rung.
 *
 * Text on the way in and a `bigint` on the way out, which is `money.ts`'s
 * asymmetry rather than this file's: validating an input means checking what
 * arrived, and JSON has no integer wide enough to be trusted with đồng.
 */
const positiveDongInput = vndAmountInputSchema.refine(
  (amount) => amount > 0n,
  "must be more than nothing",
);

/**
 * The configuration as it stands — every figure a posting will read, together.
 *
 * The dates leave as ISO text rather than as decoded calendar dates, which is
 * what `stay-date.ts` requires of a response: the codec decodes on the way in,
 * and a contract that declared it on the way out would hand the client an
 * object of loose numbers where it expects nine characters.
 */
export const systemConfigurationSchema = z.object({
  /** The rate on every business date the window below does not cover. */
  standardVatRateBps: rateBasisPoints,
  /** The rate on the business dates the window below covers, and on no other. */
  reducedVatRateBps: rateBasisPoints,
  /**
   * The dates `reducedVatRateBps` is the applicable rate on, both ends
   * inclusive. Every other date takes `standardVatRateBps`, so no date is left
   * without a rate.
   *
   * Null is *no relief period on that side*, not a missing answer. With neither
   * end set the property is asserting it has no relief period at all and every
   * date resolves to the standard rate. Setting the ends is how a relief period
   * — and the day it lapses — becomes visible in data instead of being
   * discovered in an invoice.
   */
  reducedVatFrom: isoStayDateSchema.nullable(),
  reducedVatTo: isoStayDateSchema.nullable(),
  /** Whether the VAT base includes the service-charge line — §8's tax base. */
  vatIncludesServiceCharge: z.boolean(),
  serviceChargeRateBps: rateBasisPoints,
  /** The hour the property's own day rolls over — §2's operating clock. */
  businessDateRolloverHour: hourOfTheDay,
  /**
   * What a stay earns, in §7's two halves: this many points for every
   * {@link systemConfigurationSchema.shape.loyaltyEarnUnitVnd} đồng of net room
   * revenue. Read by whatever accrues points at folio close (`FR-GST-05`).
   *
   * Two figures rather than one ratio because §7 states it that way and because
   * a single number could not say what a stay below one unit earns.
   */
  loyaltyPointsPerUnit: z.number().int().min(1).max(LARGEST_SMALLINT),
  /**
   * The đồng of net room revenue one lot of points costs. Net is the room charge
   * before VAT and service charge, service items excluded — §7 chose net so that
   * a §8 tax answer cannot silently change what a stay earns.
   */
  loyaltyEarnUnitVnd: vndAmountSchema,
  /**
   * The rungs a tier is derived from, each reached by stays **or** by revenue
   * over a trailing twelve months. Read by the tier derivation that runs at
   * business-date rollover (`FR-GST-04`).
   *
   * **These are thresholds and never a tier.** `FR-GST-04` requires the tier be
   * derived on read and hand-set by nobody, so no field here — and no column
   * behind it — holds one. A guest below the Silver rung is a Member, which is
   * the absence of a match rather than a value anything stores.
   *
   * A Gold figure below the Silver one on the same axis is refused: every Silver
   * guest would already be Gold on it and the rung beneath would stop being
   * reachable. Equal figures are allowed, because each axis is compared with its
   * own and a property may raise one bar while leaving the other.
   */
  tierSilverStays: stayCount,
  tierSilverRevenueVnd: vndAmountSchema,
  tierGoldStays: stayCount,
  tierGoldRevenueVnd: vndAmountSchema,
});

/**
 * A change to the configuration, naming only what it changes.
 *
 * The two window ends distinguish the two ways a field can be absent, the way
 * `updateRatePlanInput` does: undefined leaves the end where it stands, and an
 * explicit null unbounds it. That difference is the whole of "the relief period
 * has no end yet" against "do not touch the end I set last week".
 */
export const updateSystemConfigInput = z
  .object({
    standardVatRateBps: rateBasisPoints.optional(),
    reducedVatRateBps: rateBasisPoints.optional(),
    reducedVatFrom: stayDateSchema.nullable().optional(),
    reducedVatTo: stayDateSchema.nullable().optional(),
    vatIncludesServiceCharge: z.boolean().optional(),
    serviceChargeRateBps: rateBasisPoints.optional(),
    businessDateRolloverHour: hourOfTheDay.optional(),
    loyaltyPointsPerUnit: z
      .number()
      .int()
      .min(1)
      .max(LARGEST_SMALLINT)
      .optional(),
    loyaltyEarnUnitVnd: positiveDongInput.optional(),
    tierSilverStays: stayCount.optional(),
    tierSilverRevenueVnd: positiveDongInput.optional(),
    tierGoldStays: stayCount.optional(),
    tierGoldRevenueVnd: positiveDongInput.optional(),
  })
  .refine((edit) => Object.keys(edit).length > 0, {
    // An edit naming nothing is not a caller politely doing nothing — unknown
    // keys are stripped before this runs, so the body that arrives here empty
    // is usually one that named a field this contract does not have. Answered
    // as a refusal, that is a misspelling reported; accepted, it is an `ADMIN`
    // who believes they changed a tax rate and did not.
    message: "name at least one figure to change",
  });

export const systemConfig = {
  read: oc
    .route({ method: "GET", path: "/system/config" })
    .output(systemConfigurationSchema),

  update: oc
    .route({ method: "PATCH", path: "/system/config" })
    .input(updateSystemConfigInput)
    // The whole configuration back, not the fields that moved. The caller is a
    // screen that has just changed one figure and must now show every figure a
    // posting or an accrual will read — and the answer is the row as it committed, so a
    // concurrent edit is visible rather than painted over by the client's own
    // optimistic copy.
    .output(systemConfigurationSchema),
};
