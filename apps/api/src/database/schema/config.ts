// The money figures the tree is forbidden to know — `FR-IDN-03`, and
// `docs/architecture/property-and-tariff.md` §8, which states the prohibition
// outright: `const VAT_RATE = 0.08` anywhere in this repository is a defect,
// and the expensive kind, because it does not throw. It silently mis-invoices,
// and an invoice is a legal document a third party issued and cannot quietly
// reissue.
//
// So the two VAT rates, the dates the reduced one covers, whether the VAT base
// includes service charge, and the service-charge rate are rows a person with
// `system.config` edits — `ADMIN` writes and `MANAGER` reads, per
// `rbac-matrix.md` §3 System. `ASM-01` is answered provisionally from published
// sources rather than by a practising accountant; every value here is still
// provisional and every one of them is editable without a deploy, which is the
// whole point.
//
// **One row, and columns rather than keys.** The obvious shape for something
// called `system_config` is `(key text, value text)`, and it was rejected for
// three reasons that are all about the moment a folio line is posted:
//
//   1. The decomposition in `FR-FOL-02` reads the rate, the window and the
//      base rule *together* to split one gross figure into three lines that
//      must sum back to it exactly. Three key lookups can straddle an `ADMIN`
//      edit and produce a posting computed half under the old configuration
//      and half under the new — the silent mis-invoice §8 is about, arriving
//      by a different door. One row is read atomically or not at all.
//   2. `value text` throws the types away and hands the parsing back to the
//      posting path, where a malformed value becomes a runtime failure at the
//      worst possible moment. A `smallint` bounded by a `CHECK` cannot hold a
//      rate of `"eight percent"`, and no reader has to consider that it might.
//   3. The window's own invariant — it does not close before it opens — is a
//      statement about two values at once. Across two key rows it is not
//      expressible as a constraint at all; it would need a trigger, or it
//      would need nobody to make the mistake.
//
// One row is held to one the way `property_tariff` holds itself to one: the
// primary key is a boolean a `CHECK` pins to `true`, so a second row collides
// with the first. A surrogate key would let a second row exist, and "the VAT
// rate" would become a question about which row a query read first.
//
// **Nothing here has a default, and that is deliberate.** Every money column is
// `NOT NULL` with no default, so the row cannot come into existence until
// somebody supplies each figure. A `.default(800)` would put a tax rate in the
// tree — in this file — which is the thing §8 forbids, merely spelled as a
// column default instead of a constant. The figures arrive from the environment
// at boot, which is what §8 says: "seeded from environment at boot". A database
// that has not been seeded holds no row, and a posting path that finds no row
// must refuse rather than assume; a rate nobody chose is worse than a posting
// that stops.
//
// **Two rates, because statutory relief lapses into a rate rather than into
// nothing.** This table once held a single VAT rate and argued that a second one
// would settle `ASM-01` by guessing. That argument was wrong about what the
// second column *is*. Relief is a temporary reduction from a standard rate that
// never went away, so a reduced-VAT window with an end date has, by
// construction, a rate on the far side of it — and a table that cannot express
// that rate guarantees a refused posting on the day the window lapses, on a
// property that configured the window correctly. What the argument was actually
// defending survives untouched: this file still holds no rate *value*.
// `standard_vat_rate_bps` is `NOT NULL` with no default and is seeded from the
// environment exactly as `reduced_vat_rate_bps` is, so it is as guess-free as
// the first column and refuses a half-supplied row just as loudly. Which of the
// two applies on a business date is `system-config.service.ts`'s question, and
// it is answered from these two columns and the window rather than from anything
// the tree knows.
//
// What is deliberately *not* here:
//
// - **A rate per tax class.** These two columns price the *time* axis — standard
//   against reduced, resolved by business date. A rate that differs by what is
//   being sold is a second axis, and §5 gives every room type and service item a
//   tax class precisely so that axis has somewhere to live when it is needed.
//   `service.ts` records the condition that will force it: the relief excludes
//   goods subject to excise tax, so §6's Minibar line stays at the standard rate
//   even on a date inside the window. There is one class today and therefore
//   nothing to price per class, and a column added ahead of that is a rate
//   nobody would resolve against.
// - **A statutory retention floor.** It is not absent pending an answer; it is
//   absent because no milestone will consume it. The R2 lifecycle rule that
//   expired identity-document images was its only reader, and `FR-GST-02` now
//   stores no image at all. What `ASM-02` leaves is a floor over the
//   registration record — reportedly 36 months under Nghị định 96/2016/NĐ-CP
//   Điều 44, from secondary sources nobody here has checked against the primary
//   text — and a floor is a *do-not-delete-before*, not a delete trigger.
//   `guest.ts` gives `registration` no delete path, so the obligation is
//   already met by the table's shape. A column carrying a number no code reads
//   would be worse than its absence, by the argument the last bullet here makes
//   about `updated_at`.
// - **Gateway credentials.** They stay in the environment. A secret in a table
//   an `ADMIN` screen reads is a secret with a wider audience than the process
//   that uses it.
// - **`updated_at` and `updated_by`.** Nothing reads them at this milestone,
//   and `pricing.ts` already argues that a column nothing reads is worse than
//   its absence: a reader cannot tell an unset value from an unbuilt one. Who
//   changed a configuration and when is `FR-AUD-01`'s audit log, which is one
//   table for every such question rather than two columns per table.

import { sql } from "drizzle-orm";
import { boolean, check, date, pgTable, smallint } from "drizzle-orm/pg-core";

/**
 * The tax and clock figures the property sets, as data.
 *
 * Rates are **basis points** — whole integers, a hundredth of a percent each,
 * so 800 is 8% and 500 is 5%. Never a float and never a decimal: `NFR-12` and
 * §5 both put money on integers, and a rate stored as `0.08` reintroduces at
 * the rate what storing đồng as integers removed at the amount. Basis points
 * also carry the precision a statutory rate actually needs — 1.5% is 150 — with
 * no representation that cannot be compared for equality.
 *
 * Two VAT rates and a window between them. `reducedVatRateBps` applies on the
 * business dates the window covers and `standardVatRateBps` applies on every
 * other date, so no date is left without a rate and no date is charged a rate
 * nobody configured. Both ends of the window are nullable, and null is *no
 * relief period on that side* rather than a missing answer: with neither end
 * set the property is asserting that it has no relief period at all, and every
 * date resolves to the standard rate. Setting the ends is how a relief period —
 * and the day it lapses — becomes visible in data instead of being discovered in
 * an invoice.
 */
export const systemConfig = pgTable(
  "system_config",
  {
    // Not a uuid, deliberately — the same argument `property_tariff` makes. A
    // surrogate key would permit a second row and nothing could then refuse it.
    isTheConfiguration: boolean("is_the_configuration").primaryKey().default(true),
    // ⚑ `ASM-01`, provisional. Basis points. The rate outside the window, and
    // the rate on every date when there is no window — relief lapses back into
    // this figure rather than into no figure at all.
    standardVatRateBps: smallint("standard_vat_rate_bps").notNull(),
    // ⚑ `ASM-01`, provisional. Basis points. The rate on the dates the window
    // below covers, and on no other date.
    reducedVatRateBps: smallint("reduced_vat_rate_bps").notNull(),
    // A date, never a timestamp — `NFR-12`, and the rule applies to a business
    // date and not to an instant. The same `mode: "string"` the rate calendar
    // uses, converted to a `StayDate` by whoever reads it.
    //
    // Null is *no relief period on this side*. Both null is a property stating
    // it has no relief period, and every date then takes the standard rate; it
    // is not a licence for the reduced rate to apply everywhere.
    reducedVatFrom: date("reduced_vat_from", { mode: "string" }),
    reducedVatTo: date("reduced_vat_to", { mode: "string" }),
    // §8: "this changes every gross/net calculation". It is a rule and not a
    // rate, so it is a boolean and not a number, and a posting path reads it
    // rather than picking one of two formulas at compile time.
    vatIncludesServiceCharge: boolean("vat_includes_service_charge").notNull(),
    // ⚑ §5 puts it at 5% over room and service lines. A figure the property
    // tunes, which is why it is here and not in the sentence that applies it.
    serviceChargeRateBps: smallint("service_charge_rate_bps").notNull(),
    // §2's operating clock. It belongs in this row rather than in
    // `property_tariff` because `rbac-matrix.md` §3 files the business date under
    // System config — `ADMIN` edits it and `MANAGER` only looks — while
    // everything in `property_tariff` sits under the rates row a `MANAGER` owns.
    //
    // The seeder fills it once and `BusinessDateService` reads it on every
    // question about what day it is, so an edit here moves the property's day
    // with the next request — which is what §2 means by "changes one row, not a
    // deploy". Nothing holds the value between reads; a column that looks
    // authoritative and is not is the shape this whole file argues against.
    businessDateRolloverHour: smallint("business_date_rollover_hour").notNull(),
  },
  (table) => [
    check(
      "system_config_holds_exactly_one_row",
      sql`${table.isTheConfiguration}`,
    ),
    // 10000 basis points is 100%, and it is the ceiling rather than a rate:
    // above it the figure is a typo in a basis-points field, and a typo that
    // reaches a posting multiplies a room charge by hundreds. Zero is a real
    // answer at the other end — a zero-rated or exempt supply is not a mistake
    // — so only the impossible is refused. A negative rate would credit tax
    // back to the guest on every line.
    check(
      "system_config_standard_vat_rate_within_bounds",
      sql`${table.standardVatRateBps} between 0 and 10000`,
    ),
    check(
      "system_config_reduced_vat_rate_within_bounds",
      sql`${table.reducedVatRateBps} between 0 and 10000`,
    ),
    // Zero here is a property that levies no service charge, which §5 does not
    // describe but which is a coherent configuration rather than a typo.
    check(
      "system_config_service_charge_rate_within_bounds",
      sql`${table.serviceChargeRateBps} between 0 and 10000`,
    ),
    // An hour of the day, in the property's own zone. 24 is the value somebody
    // means as midnight and writes as a count, and it would roll the business
    // date on no hour at all.
    check(
      "system_config_rollover_hour_is_an_hour",
      sql`${table.businessDateRolloverHour} between 0 and 23`,
    ),
    // A window that closes before it opens covers no date, which reads at a
    // posting as relief that never applied — the same shape `promotion` refuses
    // for the same reason.
    check(
      "system_config_reduced_vat_window_opens_before_it_closes",
      sql`${table.reducedVatFrom} is null or ${table.reducedVatTo} is null
        or ${table.reducedVatTo} >= ${table.reducedVatFrom}`,
    ),
  ],
);

export type SystemConfigRow = typeof systemConfig.$inferSelect;
