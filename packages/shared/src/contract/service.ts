// The service catalog as the desk reads it — `FR-FOL-03`, and
// `property-and-tariff.md` §6.
//
// One route, and it is a list. §6 makes the catalog data — "items are data, so
// the catalog grows without a migration" — and a client that had the eight codes
// compiled into it would be the migration that sentence exists to avoid. So the
// desk asks what is for sale and posts one of the answers; `folio.postServiceItem`
// is the other half of the pair and takes a `code` this route returned.
//
// **The list is what is *sellable*, not what exists.** `service_catalog.is_active`
// is how an item is withdrawn — never a delete, because a posting that named the
// row would lose what a past guest was charged for — so a withdrawn item stays
// readable on old invoices and stops being offered here. There is no flag to ask
// for the inactive ones: nothing in this milestone edits the catalog, so the only
// caller is a desk about to sell something.
//
// **A price may be null, and the client is told rather than protected from it.**
// §6 prices two of the eight and files the other six under §9 as still the
// owner's. A null is "nobody has costed this yet" and is not zero — `schema/service.ts`
// is emphatic that the difference is the whole point of the column being
// nullable. The desk needs it: an item with a price is posted by naming it, and
// an item without one is posted by naming it *and* the figure the guest agreed
// to. Hiding the null would leave the client unable to tell which of the two
// requests it owes.
//
// **No tax rate, and no room for one.** §5 puts a class on every item and §8
// files the rate behind a class as an answer the accountant still owes. The
// class travels because a client may group by it; the figure it resolves to is
// read from `system_config` for the business date a line is posted on, which is
// a fact about the *posting* and not about the item. A rate on this response
// would be the rate on the day it was read, quoted at a client that will hold it
// longer than the day lasts.
//
// **Read-only, and not because the write is unbuilt.** `rbac-matrix.md` has no
// row for editing the catalog at this milestone. A route declared before the
// matrix governs it is unreachable for everyone, and this file declines to
// promise one — the same argument `folio.ts` makes about the invoice adjustment.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountSchema } from "../money.js";
import { serviceCodeSchema, taxClassSchema } from "../service-catalog.js";

/**
 * One sellable item.
 *
 * The `id` is deliberately absent. A posting names an item by `code` — the
 * column that is unique and stable across a rename — and a client holding a UUID
 * it never sends is a field that exists to be misused. `folio_posting` stores
 * the key, which is a fact about the ledger rather than about this list.
 */
export const serviceCatalogItemSchema = z.object({
  code: serviceCodeSchema,
  /** Display only, and it may be renamed — §6 notes Breakfast may become
   *  Vietnamese the day a menu is printed. Never a handle. */
  name: z.string().min(1),
  /** Gross, for one of whatever the item is counted in. Null is unpriced. */
  unitPriceGross: vndAmountSchema.nullable(),
  taxClass: taxClassSchema,
});

export type ServiceCatalogItem = z.infer<typeof serviceCatalogItemSchema>;

export const service = {
  listCatalog: oc
    // A flat collection and not hung off a stay. The catalog is the property's
    // and is the same list whichever folio is about to be posted to, so a path
    // under `/bookings/{bookingId}` would invite a cache keyed on the wrong
    // thing.
    .route({ method: "GET", path: "/service-catalog" })
    .output(z.array(serviceCatalogItemSchema)),
};
