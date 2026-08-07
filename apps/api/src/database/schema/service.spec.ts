// What the catalog declarations say, and what they refuse to say.
//
// Two claims are worth a test rather than a comment. The first is that an
// unpriced item is representable: `property-and-tariff.md` §6 prices two of its
// eight items and leaves six to the owner, so the column has to be nullable and
// — the part that actually goes wrong — must not carry a default. A
// `.default(0)` would read as "free" everywhere it was posted, and free is a
// comp, which is a folio adjustment and not a catalog price.
//
// The second is that nothing here is a rate. §5 gives every service item a tax
// *class* and §8 puts the rate behind it in `system_config`, where an `ADMIN`
// edits it without a deploy. The failure this guards against is not a rogue
// `const VAT_RATE = 0.08` that review would catch; it is a well-meant
// `vat_rate_bps` column on the catalog, which looks like completeness and
// silently freezes a statutory rate at the moment a row was written.
//
// Whether Postgres actually refuses a price of zero, a second item under one
// code, or a tax class the type does not have is a question about the
// migration, and it is answered in `test/service-catalog-storage.e2e-spec.ts`
// against a real database.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { serviceCatalog, TAX_CLASSES, taxClassEnum } from "./service.js";

describe("the service catalog", () => {
  it("names an item, prices it and classes it, and holds nothing else", () => {
    // §6 is a catalog and not a menu: a code to post against, a name to print,
    // a price when there is one, and the class §5 says every item carries.
    const columns = getTableConfig(serviceCatalog).columns.map(
      (column) => column.name,
    );

    expect(columns).toEqual([
      "id",
      "code",
      "name",
      "unit_price_gross",
      "tax_class",
      "is_active",
    ]);
  });

  it("lets an item exist with no price at all", () => {
    // §6 leaves six of eight unset and says they block nothing. Nullable is how
    // that is stated; the absence of a default is what keeps it stated.
    expect(serviceCatalog.unitPriceGross.notNull).toBe(false);
    expect(serviceCatalog.unitPriceGross.hasDefault).toBe(false);
    expect(serviceCatalog.unitPriceGross.default).toBeUndefined();
  });

  it("never lets an unpriced item become a priced one by default", () => {
    // The shape being rejected. Zero is not "unset" and it is not "free" — a
    // free service is a comp, and `rate_calendar` already argues that a comp is
    // a folio adjustment rather than a price. A default here would make every
    // one of §6's six open items post a line for nothing.
    expect(serviceCatalog.unitPriceGross.default).not.toBe(0);
    expect(serviceCatalog.unitPriceGross.default).not.toBe(0n);
  });

  it("keeps a price in whole đồng and never in a decimal", () => {
    // `NFR-12` and §5. A numeric or a float reintroduces at the service line
    // exactly what integer đồng removed at the room rate, and the ledger stops
    // balancing by amounts too small to notice and too many to reconcile.
    expect(serviceCatalog.unitPriceGross.getSQLType()).toBe("bigint");
  });

  it("carries a tax class on every item, and it is mandatory", () => {
    // §5: "every room type and every service item carries one". Nullable, it
    // would be an item a posting could not decompose.
    expect(serviceCatalog.taxClass.notNull).toBe(true);
    expect(serviceCatalog.taxClass.enumValues).toEqual([...TAX_CLASSES]);
  });

  it("names a class and never quotes a rate", () => {
    // The class is resolved against `system_config` at posting time, for the
    // business date being posted. A member that were a number — "8", "0.08",
    // "800" — would be this enum holding the rate under another name, and it
    // would outlive the day the accountant's answer changed.
    for (const member of taxClassEnum.enumValues) {
      expect(member).toMatch(/^[A-Z_]+$/);
    }

    const declared = getTableConfig(serviceCatalog)
      .columns.map((column) => column.name)
      .join(" ");

    expect(declared).not.toContain("rate");
    expect(declared).not.toContain("vat");
    expect(declared).not.toContain("percent");
    expect(declared).not.toContain("bps");
  });

  it("holds one class, because the configuration prices one rate", () => {
    // §6 assigns no class to any of its eight items and `system_config` holds a
    // single rate — deliberately, because a second would settle `ASM-01` by
    // guessing. A `REDUCED` or an `EXEMPT` declared now would be a name with no
    // rate behind it and no document saying which item wears it. It arrives
    // with the answer and with the column that prices it.
    expect(TAX_CLASSES).toEqual(["STANDARD"]);
  });

  it("refuses a price of zero and lets a missing one through", () => {
    const declared = getTableConfig(serviceCatalog).checks.map(
      (check) => check.name,
    );

    expect(declared).toEqual(["service_catalog_price_positive_when_set"]);
  });

  it("gives an item one code, so a posting names one row", () => {
    // Text and not an enum, because §6 makes the catalog something the property
    // adds to — a new service is a data edit, not a migration. Unique, because
    // two rows under `BREAKFAST` would make "the breakfast item" a question
    // about which one a query read first.
    expect(serviceCatalog.code.isUnique).toBe(true);
    expect(serviceCatalog.code.getSQLType()).toBe("text");
  });

  it("withdraws an item by a column rather than by deleting it", () => {
    // A posting names the row it charged for. Deleting a withdrawn item would
    // either be refused by the key or take the account of what a past guest was
    // charged for with it — `promotion.is_active` for the same reason.
    expect(serviceCatalog.isActive.notNull).toBe(true);
    expect(serviceCatalog.isActive.default).toBe(true);
  });
});
