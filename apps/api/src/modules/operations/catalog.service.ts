// Reads of `service_catalog` — `FR-FOL-03`, and `property-and-tariff.md` §6.
//
// Two of them, and they answer two different questions. The desk asks what is
// for sale and gets the active list; the posting path asks what one item *is*
// and gets the row it must price and classify a line from. Neither writes: §6
// seeds the catalog and calls it data, and `rbac-matrix.md` has no row for
// editing it at this milestone.
//
// **Both take the caller's executor.** The item read is the one that matters:
// `folio.controller.ts` opens a transaction, resolves the item inside it and
// writes the lines from the same snapshot, so a price cannot move between being
// read and being posted. A service that held its own connection would make that
// impossible to guarantee and a cached catalog would make it impossible to
// notice.

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import type { ServiceCatalogRow } from "../../database/schema/service.js";
import { serviceCatalog } from "../../database/schema/service.js";

/** What a caller may sell: the row, less the columns nothing outside needs. */
export type CatalogItem = Pick<
  ServiceCatalogRow,
  "id" | "code" | "name" | "unitPriceGross" | "taxClass"
>;

@Injectable()
export class CatalogService {
  /**
   * Everything currently for sale, by code.
   *
   * Ordered so two calls answer in the same order — the column is unique, so it
   * is a total order and not a tie-break over one. Without it the desk's list
   * would reshuffle between reads for no reason a user could see.
   *
   * `is_active` is the whole of the filter. A withdrawn item stays in the table
   * because a posting names it and `schema/service.ts` refuses to lose what a
   * past guest was charged for; it stops being offered here, which is what
   * withdrawing means.
   */
  async sellable(exec: DbExecutor): Promise<readonly CatalogItem[]> {
    return exec
      .select({
        id: serviceCatalog.id,
        code: serviceCatalog.code,
        name: serviceCatalog.name,
        unitPriceGross: serviceCatalog.unitPriceGross,
        taxClass: serviceCatalog.taxClass,
      })
      .from(serviceCatalog)
      .where(eq(serviceCatalog.isActive, true))
      .orderBy(asc(serviceCatalog.code));
  }

  /**
   * One item, by the handle a posting names it with.
   *
   * **A withdrawn item is not found, and that is the same refusal as a code
   * nobody has ever used.** The two are different facts about the catalog and
   * the same fact about this request: neither is for sale. Telling them apart in
   * the message would describe the property's commercial history to whoever
   * guessed a code, and would not change what the caller does next.
   *
   * Refuses rather than answering null. Every caller of this is about to post a
   * line, so there is no branch on the far side that a null would serve — it
   * would be a `!` at each call site, or an `if` that threw the same error
   * further from the row it is about.
   */
  async sellableItem(exec: DbExecutor, code: string): Promise<CatalogItem> {
    const [found] = await exec
      .select({
        id: serviceCatalog.id,
        code: serviceCatalog.code,
        name: serviceCatalog.name,
        unitPriceGross: serviceCatalog.unitPriceGross,
        taxClass: serviceCatalog.taxClass,
      })
      .from(serviceCatalog)
      .where(
        and(eq(serviceCatalog.code, code), eq(serviceCatalog.isActive, true)),
      )
      .limit(1);

    if (!found) {
      throw new ORPCError("NOT_FOUND", {
        message: `The catalog has nothing for sale under ${code} — read the service catalog for what it does have`,
      });
    }

    return found;
  }
}
