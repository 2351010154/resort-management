// What the pricing declarations say, and what they deliberately leave to a
// database.
//
// The split is the one `inventory.spec.ts` sets out. Drift between a Postgres
// enum and the wire tuple it was built from is a shape question — a value
// renamed on one side produces rows the other cannot read, and no error anybody
// sees — so it is asserted here. Whether Postgres actually refuses a promotion
// that raises a price, or a window that closes before it opens, is a question
// about the migration, and it is answered in `test/promotion-storage.e2e-spec.ts`
// against a real one.

import { LOYALTY_TIERS, PROMOTION_TYPES } from "@mariva/shared";
import { loyaltyTierSchema, promotionTypeSchema } from "@mariva/shared";
import type { LoyaltyTier, PromotionType } from "@mariva/shared";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  loyaltyTierEnum,
  promotion,
  promotionTypeEnum,
  propertyTariff,
  rateCalendar,
  stayRestriction,
} from "./pricing.js";

describe("the promotion type codes", () => {
  it("are the same two in Postgres as on the wire", () => {
    // Both are built from PROMOTION_TYPES, and this asserts that they still
    // are. Inlining either list would let one be edited without the other.
    expect(promotionTypeEnum.enumValues).toEqual([...PROMOTION_TYPES]);
    expect(promotionTypeSchema.options).toEqual([...PROMOTION_TYPES]);
  });

  it("cannot be joined by a third", () => {
    // @ts-expect-error — a promotion either scales with the room rate or it
    // does not, and a third form would have to say which. It fails to compile
    // rather than reaching a quote that cannot apply it.
    const invented: PromotionType = "BUY_ONE_GET_ONE";

    expect(promotionTypeSchema.safeParse(invented).success).toBe(false);
  });
});

describe("the loyalty tiers", () => {
  it("are the same two in Postgres as on the wire", () => {
    expect(loyaltyTierEnum.enumValues).toEqual([...LOYALTY_TIERS]);
    expect(loyaltyTierSchema.options).toEqual([...LOYALTY_TIERS]);
  });

  it("exclude Member, which every guest holds and which discounts nothing", () => {
    // §7's ladder is Member → Silver → Gold, and only the upper two carry a
    // percentage. A promotion gated on Member would be gated on nothing, and
    // the column already spells that with null.
    // @ts-expect-error — Member is not a tier a promotion can require.
    const everyone: LoyaltyTier = "MEMBER";

    expect(loyaltyTierSchema.safeParse(everyone).success).toBe(false);
    expect(LOYALTY_TIERS).toHaveLength(2);
  });
});

describe("the promotion table", () => {
  it("names a promotion by a code nothing else may reuse", () => {
    // The handle a campaign is referred to by. Unique because two rows sharing
    // `EARLY_BIRD` would make "the early bird discount" a question about which
    // row a query read first — the argument `rate_calendar` makes for its own
    // uniqueness rule.
    expect(promotion.code.isUnique).toBe(true);
    expect(promotion.code.notNull).toBe(true);
  });

  it("carries one value column rather than one per form", () => {
    // A percentage row and a fixed-đồng row never both apply, so two nullable
    // columns would admit a row setting neither — a promotion that does
    // nothing, stored without complaint. The CHECK bounds the single column
    // against whichever scale the type names.
    expect(promotion.value.notNull).toBe(true);
    expect(promotion.value.getSQLType()).toBe("bigint");
  });

  it("leaves both ends of the window open", () => {
    // §7's loyalty discount has no start date and no end date. A required
    // window would force a sentinel year onto a promotion that genuinely runs
    // until somebody withdraws it.
    expect(promotion.validFrom.notNull).toBe(false);
    expect(promotion.validTo.notNull).toBe(false);
  });

  it("dates the window rather than timestamping it", () => {
    // A promotion applies to a stay date, and a stay date is a calendar date —
    // NFR-12. A timestamp here would make "valid to the 30th" depend on the
    // timezone the comparison ran in.
    expect(promotion.validFrom.getSQLType()).toBe("date");
    expect(promotion.validTo.getSQLType()).toBe("date");
  });

  it("treats a tier requirement as absent by default", () => {
    // Null is open to everyone. The tier a guest holds is derived by FR-GST-04,
    // a later milestone; what this column stores is only what §7 already
    // decided the promotion requires.
    expect(promotion.requiresLoyaltyTier.notNull).toBe(false);
  });

  it("separates withdrawing a promotion from its window expiring", () => {
    // Two different acts. A campaign that ended stops applying on its own; one
    // pulled early inside its window needs a switch. Deleting the row would do
    // neither — it would take the record of what a past stay was quoted under.
    expect(promotion.isActive.notNull).toBe(true);
    expect(promotion.isActive.hasDefault).toBe(true);
  });

  it("holds no column narrowing a promotion to a plan or a type", () => {
    // Property-wide by decision, not by omission — see the header of
    // pricing.ts. §7's loyalty discount is the only consumer any document
    // names and it applies to whatever the guest booked. A nullable scope
    // nothing reads would leave a reader unable to tell unset from unbuilt.
    const columns = Object.keys(promotion);

    // Asserted first, so the two absences below cannot pass by reading an
    // object that holds no column names at all.
    expect(columns).toContain("code");
    expect(columns).not.toContain("ratePlanId");
    expect(columns).not.toContain("roomTypeId");
  });
});

describe("the property tariff", () => {
  it("can hold only one row", () => {
    // The extra-person rate is the property's, and it has no date and no type
    // to tell two rows apart. A second row would make "the rate" a question
    // about which one a query read first — so the primary key is a boolean and
    // a CHECK pins it to `true`, which leaves Postgres nowhere to put a second.
    const { checks, columns } = getTableConfig(propertyTariff);

    expect(checks.map((check) => check.name)).toContain(
      "property_tariff_holds_exactly_one_row",
    );
    expect(columns.filter((column) => column.primary).map((c) => c.name)).toEqual(
      ["is_the_property"],
    );
  });

  it("prices the extra person in whole đồng and refuses a free one", () => {
    // §3 already has a free band and it is decided by age. A zero here would
    // apply it to everybody without saying so.
    const { checks } = getTableConfig(propertyTariff);

    expect(propertyTariff.extraPersonPerNightGross.getSQLType()).toBe("bigint");
    expect(propertyTariff.extraPersonPerNightGross.notNull).toBe(true);
    expect(checks.map((check) => check.name)).toContain(
      "property_tariff_extra_person_positive",
    );
  });

  it("holds no extra-bed column, and never will, because a required bed is free", () => {
    // §1 makes a bed mandatory when the heads needing bedding exceed what the
    // bedding sleeps, and makes that bed free — the advertised maximum is a
    // promise and the bed is how the property keeps it. §3's extra-person charge
    // is the whole price of the head, and §6's priced bed is a service-catalog
    // item the desk posts. Neither is a property tariff, so this table will
    // never hold an extra-bed price. The absence is permanent, not pending.
    const columns = Object.keys(propertyTariff);

    // Asserted first, so the absence below cannot pass by reading an object
    // that holds no column names at all.
    expect(columns).toContain("extraPersonPerNightGross");
    expect(columns).not.toContain("extraBedPerNightGross");
  });
});

describe("what the pricing tables hang off", () => {
  it("point their room type at room_type and nothing else", () => {
    // A price and a restriction belong to a type, and the type is the
    // inventory module's. Drizzle resolves the target lazily, so a reference
    // aimed at the wrong table typechecks and only fails when a migration is
    // generated against a database somebody has already filled.
    expect(parentOf(rateCalendar)).toEqual({
      table: "room_type",
      from: ["room_type_id"],
      to: ["id"],
    });
    expect(parentOf(stayRestriction)).toEqual({
      table: "room_type",
      from: ["room_type_id"],
      to: ["id"],
    });
  });

  it("leave the promotion and the tariff standing on their own", () => {
    // Both are property-wide. A foreign key on either would be the scoping
    // `pricing.ts` argues against — see the promotion table above.
    expect(getTableConfig(promotion).foreignKeys).toHaveLength(0);
    expect(getTableConfig(propertyTariff).foreignKeys).toHaveLength(0);
  });
});

/** The one table a table references, and the columns joining them. */
function parentOf(table: Parameters<typeof getTableConfig>[0]) {
  const [foreignKey, ...rest] = getTableConfig(table).foreignKeys;

  // A second key would make the assertion above read only the first and pass
  // while saying nothing about the other.
  expect(rest).toHaveLength(0);

  const reference = foreignKey!.reference();

  return {
    table: getTableConfig(reference.foreignTable).name,
    from: reference.columns.map((column) => column.name),
    to: reference.foreignColumns.map((column) => column.name),
  };
}
