// What the property sells that is not a night, as a list — `FR-FOL-03`.
//
// One route and one row of the matrix: `service.read-catalog`, declared as a
// read. Every staff role holds it read-only, including `ADMIN`, and `matrix.ts`
// says why in place: nothing edits the catalog at this milestone, so a `full`
// grant would be authority over a write path that does not exist.
//
// The guest realm is denied outright rather than conditioned. A price list is
// not a fact about anybody's own booking, so there is no scope a handler could
// check that would make one guest's view of it different from another's — and
// what a guest is quoted comes from the funnel, which prices a *stay*.
// `property-and-tariff.md` §6 is explicit that the extra bed is desk-posted and
// never quoted, so this list is deliberately not the shape a guest reads.
//
// **The transaction wraps a single statement**, which looks like ceremony and is
// not: `database.module.ts` requires the executor to come from a runner, and a
// read that opened its own connection would be the one place in the tree that
// did. It costs a `BEGIN` on a route the desk calls when a screen opens.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { CatalogService } from "./catalog.service.js";

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Everything for sale, so the desk can name one when it posts.
   *
   * The `id` is dropped here rather than left out of the service's read: the
   * posting path needs it — `folio_posting.service_catalog_id` is a key — and
   * the wire does not, because a line names an item by `code`. One read serves
   * both, and the narrowing happens where the audience differs.
   */
  @RequiresCapability("service.read-catalog", "read")
  @Implement(contract.service.listCatalog)
  listCatalog() {
    return implement(contract.service.listCatalog).handler(async () => {
      const items = await this.transactions.run((exec) =>
        this.catalog.sellable(exec),
      );

      return items.map((item) => ({
        code: item.code,
        name: item.name,
        unitPriceGross: item.unitPriceGross,
        taxClass: item.taxClass,
      }));
    });
  }
}
