// What the property sells that is not a night — `FR-FOL-03`, and
// `docs/architecture/property-and-tariff.md` §6. Owned by `modules/folio`,
// which is where a catalog item turns into a posting.
//
// §6 ends on the sentence that decides the shape: "Items are data, so the
// catalog grows without a migration." A property that starts charging for a
// cooking class adds a row, and the folio line it posts names that row. The
// alternatives are the same charge with nothing behind it — a `kind` enum on
// the posting needs a deploy to sell anything new, and a free string with a
// figure somebody typed leaves an amount whose tax class is whatever the poster
// believed at the time and a revenue report that cannot group two spellings of
// "minibar" together.
//
// **A price is nullable and that is the requirement, not a shortcut.** §6
// prices two of the eight items and files the other six under §9 as still the
// owner's. An unpriced item is a row without a price and never a guess: a
// `.default(0)` would post a folio line saying something happened for nothing,
// and an invented figure would be invoiced. So the column is nullable, a set
// price is held above zero by a `CHECK`, and posting an item that has no price
// is a refusal the posting path owes. `rate_plan.breakfast_per_person_gross`
// argues the identical case for the identical reason.
//
// **The tax class is a name and never a number.** §5 decides that every room
// type and every service item carries one; §8 decides that the rate behind it
// is not this file's to know, because `const VAT_RATE = 0.08` anywhere in the
// tree is the expensive kind of defect — it does not throw, it mis-invoices.
// The class is what `FR-FOL-02`'s decomposition resolves against
// `system_config` for the business date it is posting on, so there is no rate,
// no percentage and no basis point in this file for a reader to be tempted by.
//
// **One class today, and the reason survived `config.ts` growing a second
// rate.** §6 names eight items and gives none of them a class; §5 says only that
// each carries one. The set of classes that can mean anything is the set
// `system_config` can price — and the two rates that table now holds are the
// **time** axis, not the item axis. Standard against reduced, resolved by the
// business date a line is posted on, is one rate per date for every item alike;
// `system-config.service.ts` picks between them and hands the posting path a
// single figure. A class is a statement about *what is being sold*, and nothing
// in that row varies by that. So a `REDUCED`, an `EXEMPT` or a zero-rated class
// declared now would still be eight assignments nobody made, on a catalog whose
// own document makes none, and a posting resolving one of them would still have
// no rate to find.
//
// §9 names the condition that will change it, and it is a real one rather than a
// hypothetical: Vietnam's reduced-VAT relief excludes goods subject to excise
// tax, so §6's Minibar line is at the standard rate even on a date inside the
// window. The day that item is priced and sold, one rate per date stops being
// enough — and the class joins the enum then, with the accountant's answer and
// the column that prices it, together.
//
// What is deliberately *not* here:
//
// - **A unit.** §6 quotes breakfast per person per night and an extra bed per
//   night, and says nothing about the other six because they have no price to
//   qualify. A unit column would be guessed for three-quarters of the table.
//   The column holds the gross for one of whatever the item is counted in; the
//   count arrives with the posting. The extra bed is counted the same way, and
//   §1 is what decides it is ever counted at all: a bed the party's occupancy
//   requires is free, so this row prices only one a guest asked for.
// - **A tax amount, a rate or a service-charge figure.** Three lines out of one
//   gross is `FR-FOL-02`'s decomposition, computed at posting time. A tax
//   figure stored beside a price would be the rate on the day the row was
//   written, silently outliving the day it changed.
// - **`updated_at` and `updated_by`.** `config.ts` and `pricing.ts` both make
//   the argument and it holds here: nothing reads them at this milestone, and a
//   column nothing reads is worse than its absence, because a reader cannot
//   tell an unset value from an unbuilt one. Who repriced an item and when is
//   `FR-AUD-01`'s audit log, which is one table for every such question rather
//   than two columns per table.

import { TAX_CLASSES } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The tax classes a charge posts under — §5's "every room type and every
 * service item carries one".
 *
 * The tuple moved to `@mariva/shared` on the condition its previous home here
 * set out: it lived beside the schema while no wire schema quoted a class, and
 * `service.listCatalog` now does. Same arrangement `charge_basis` has with
 * `CHARGE_BASES` — Postgres gets its type, TypeScript gets its union and the
 * contract gets its enum, all from one tuple, so the column and the response
 * cannot come to disagree about what the classes are.
 */
export const taxClassEnum = pgEnum("tax_class", TAX_CLASSES);

/**
 * One sellable service — a row per item, because §6 makes the catalog data.
 *
 * `code` is the handle a posting path names an item by, and it is text rather
 * than an enum for the reason `promotion.code` is: the three rate plans are a
 * closed set the property argues about, and this is a set it adds to. A name
 * cannot serve — the property may rename "Breakfast" into Vietnamese on the
 * day it prints a menu, and every line that ever referred to it must survive
 * that.
 *
 * `isActive` is how an item is withdrawn, and deleting is not the alternative:
 * once a posting names a row, the key refuses the delete, and if it did not the
 * property would lose the account of what a past guest was charged for.
 * `promotion.is_active` is the same column for the same reason — pulling
 * something from sale is one column, and it does not rewrite history.
 */
export const serviceCatalog = pgTable(
  "service_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A stable handle — `BREAKFAST`, `AIRPORT_TRANSFER`. Unique, so "the
    // breakfast item" is never a question about which row a query read first.
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    // ⚑ §6: two of the eight are priced and six are unset. Null is unpriced and
    // is not zero — an item nobody has costed yet cannot be posted, and a
    // posting path that read a zero here would put a line on a folio for
    // nothing at all.
    unitPriceGross: bigint("unit_price_gross", { mode: "bigint" }),
    // §5. A class, never a rate: the figure it resolves to is `system_config`'s
    // and is read at posting time, for the business date being posted.
    taxClass: taxClassEnum("tax_class").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    // Zero is not "this service is complimentary" — a comp is a folio
    // adjustment, which is the argument `rate_calendar` already makes about a
    // free night. Here it would also be indistinguishable from the unpriced
    // rows §6 leaves open, and the difference between "costs nothing" and
    // "nobody has said" is the whole point of the column being nullable.
    check(
      "service_catalog_price_positive_when_set",
      sql`${table.unitPriceGross} is null or ${table.unitPriceGross} > 0`,
    ),
    // The shape `serviceCodeSchema` already claims, enforced where rows are
    // actually written. §6 makes the catalog data — a property adds an item by
    // adding a row, and no route edits it — so the only writer is a hand at the
    // database, and a `cooking_class` put in by one would be a row the contract
    // cannot describe. The list read parses every row it returns, so one such
    // row does not hide itself: it takes the whole catalog down for the desk.
    // Upper case is not decoration either — the column is unique, and `Minibar`
    // beside `MINIBAR` is two items nobody can tell apart.
    check(
      "service_catalog_code_is_a_handle",
      sql`${table.code} ~ '^[A-Z][A-Z0-9_]*$' and length(${table.code}) <= 64`,
    ),
    // The same argument, one column over: the wire says an item has a name, and
    // an empty one is a folio line the guest reads as a blank.
    check(
      "service_catalog_name_is_not_blank",
      sql`length(trim(${table.name})) > 0`,
    ),
  ],
);

export type ServiceCatalogRow = typeof serviceCatalog.$inferSelect;
