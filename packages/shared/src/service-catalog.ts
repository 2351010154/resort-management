// What a sellable service is taxed as — `property-and-tariff.md` §5's last row,
// which puts a class on every room type and every service item.
//
// Here at the root rather than in `contract/`, for the reason `policy-charge.ts`
// gives about a charge basis: a tax class is vocabulary, not a route. The
// database's `tax_class` enum is built from this tuple the way `charge_basis` is
// built from `CHARGE_BASES`, so the column, the seed and the wire cannot drift
// into three different ideas of what the classes are.
//
// **A class, never a rate.** §5 decides the classification and §8 files the
// figure attached to one as an answer the accountant still owes. So nothing here
// resolves to a percentage: the rate a posting applies is read from
// `system_config` for the business date being posted, and §9 names the condition
// that will force a rate *per class* — the excise-tax exclusion that keeps a
// priced Minibar at the standard rate inside a relief window. Until an item
// needs that, the class is what a line records and one rate per date is enough.

import { z } from "zod";

/**
 * One member, and the count is honest rather than provisional.
 *
 * §6 assigns no class to any of its eight items and `system_config` prices
 * exactly one rate, so a second class would be a name with no rate behind it and
 * no document saying which item wears it. It is a tuple rather than a lone
 * string because the axis is real and §9 says what will widen it.
 */
export const TAX_CLASSES = ["STANDARD"] as const;

export const taxClassSchema = z.enum(TAX_CLASSES);

export type TaxClass = z.infer<typeof taxClassSchema>;

/**
 * The handle a posting names a catalog item by — `service_catalog.code`.
 *
 * Text and not an enum, and `schema/service.ts` argues why at length: the rate
 * plans are a closed set the property argues about, and the catalog is a set it
 * adds to. §6 says items are data so the catalog grows without a migration, and
 * an enum here would make every new item a deployment.
 *
 * Bounded and trimmed like every other string that arrives, so a code cannot be
 * whitespace or a paragraph. The uppercase shape is the seed's own — `BREAKFAST`,
 * `AIRPORT_TRANSFER` — and it is enforced rather than merely conventional
 * because the column is unique: `Minibar` and `MINIBAR` would be two items with
 * one name, and the desk would have no way to tell which one it posted.
 */
export const serviceCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "a service code is upper-case letters, digits and underscores — `MINIBAR`",
  );
