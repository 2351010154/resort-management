// `FR-GST-04`'s first clause, asserted as a property of the tree: "VIP tier is
// a **derived value**, never hand-set".
//
// `tier-recompute-sweep.e2e-spec.ts` proves the behaviour — a trail row claiming
// GOLD does not make a Silver guest Gold, and emptying the trail moves nobody.
// What behaviour cannot prove is that the *next* reader will ask the derivation
// rather than the table. `guest_tier_change` holds a `to_tier` column, ordered
// by an instant, one row per change: it is shaped exactly like a place to look
// a guest's tier up, and `schema/guest-tier.ts` opens by saying that "a reader
// who takes the last row here as the current tier has read the wrong column of
// the wrong table".
//
// A reader who does that writes code that passes every test in the tree. The
// answer would even be right most of the time — it is only wrong once the
// trailing window moves under a guest and nothing walks past them, which is
// months later and silent. So the guarantee is checked the one way it can be:
// by reading the source and asserting that the trail has exactly one reader and
// that no table anywhere carries a tier of its own.
//
// **What is forbidden.** Reading `guest_tier_change` from anywhere but the sweep
// that writes it, and storing a derived tier in any column.
//
// **What is not forbidden.** Writing the trail, reporting on it, or reading it
// in a test — a report over a property's promotions is history being used as
// history, which is what the table is for. The scan therefore names the files
// that may mention it rather than trying to distinguish a read from a write.
//
// **On vacuity.** A structural scan that visits nothing passes forever and
// guards nothing. Both scans below assert they saw a plausible number of real
// files first, so a renamed directory takes this suite down rather than the
// guarantee it stands for.
//
// No database. This reads the repository from disk, so it behaves the same on a
// Windows machine and in the Linux container CI runs it in.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/database/schema/index.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const API_SRC = join(REPO_ROOT, "apps", "api", "src");

/**
 * The files inside `apps/api/src` that may name the trail, and why each one may.
 *
 * A path added here is a new reader of `guest_tier_change`, and adding one
 * should be a decision somebody defends in review rather than a line that
 * slipped in — which is the whole purpose of the list being exhaustive and
 * short.
 */
const MAY_NAME_THE_TRAIL = new Map([
  ["database/schema/guest-tier.ts", "declares the table"],
  [
    "modules/guest/tier-recompute-sweep.ts",
    "is its only writer, and reads back only its own last observation",
  ],
]);

/** How the table is spelled across Drizzle, SQL and a comment. */
const TRAIL_NAMES = ["guestTierChange", "guest_tier_change"];

/**
 * Every column in the tree whose name mentions a tier, and what each one is.
 *
 * A golden list rather than a pattern, and asserted over the Drizzle tables
 * themselves rather than over source text — an enum *type* is declared with the
 * same spelling a column is, and a text scan cannot tell `pgEnum("loyalty_tier")`
 * from a column that stores one.
 *
 * Seven columns, none of which is a guest's standing:
 *
 * - `promotion.requires_loyalty_tier` is the rung a *discount* is gated on. It
 *   is a condition the property attaches to a price, and which guests it applies
 *   to is decided by deriving their tier at the moment of sale.
 * - `guest_tier_change.from_tier` and `.to_tier` record a change that was
 *   observed on a night. `schema/guest-tier.ts` argues the difference between
 *   that and a stored tier at length, and the behavioural cases in
 *   `tier-recompute-sweep.e2e-spec.ts` prove the derivation ignores them.
 * - `system_config`'s four are the *thresholds* a tier is derived from — the
 *   ladder rather than anybody's position on it. `schema/config.ts` states the
 *   distinction it turns on: a threshold holds until somebody changes it, and a
 *   tier is an answer that is only correct until the window moves under it.
 *
 * An eighth entry appearing here is a tier somebody stored, and `FR-GST-04`
 * refuses one.
 */
const TIER_COLUMNS = [
  "guest_tier_change.from_tier",
  "guest_tier_change.to_tier",
  "promotion.requires_loyalty_tier",
  "system_config.tier_gold_revenue_vnd",
  "system_config.tier_gold_stays",
  "system_config.tier_silver_revenue_vnd",
  "system_config.tier_silver_stays",
];

describe("the trail has one reader", () => {
  it("is named nowhere in the API but the files that declare and write it", () => {
    const sources = typeScriptUnder(API_SRC);

    // The scan is real: `apps/api/src` is a tree of well over a hundred files,
    // and a number far below that means the walk found the wrong directory.
    expect(sources.length).toBeGreaterThan(100);

    const naming = sources.filter((file) =>
      TRAIL_NAMES.some((name) => readFileSync(file, "utf8").includes(name)),
    );

    const unexpected = naming
      .map((file) => relative(API_SRC, file).split(sep).join("/"))
      // Migrations are the table's own definition in SQL and its trigger; they
      // are the schema said twice rather than a second reader of it.
      .filter((path) => !path.startsWith("database/migrations/"))
      .filter((path) => !MAY_NAME_THE_TRAIL.has(path));

    expect(unexpected).toEqual([]);
  });

  it("is actually named by every file the list says may name it", () => {
    // The other half of the guard above. A path left in the list after the file
    // stopped mentioning the trail would quietly widen what the list permits,
    // and the next reader would inherit a licence nobody granted.
    const stale = [...MAY_NAME_THE_TRAIL.keys()].filter((path) => {
      const source = readFileSync(join(API_SRC, ...path.split("/")), "utf8");

      return !TRAIL_NAMES.some((name) => source.includes(name));
    });

    expect(stale).toEqual([]);
  });
});

describe("no table stores what a guest's tier is", () => {
  it("declares exactly the tier columns that are not a guest's tier", () => {
    // Everything the schema exports, keeping the tables and dropping the enums
    // and row types beside them.
    const tables = Object.values(schema).flatMap((exported) =>
      is(exported, Table) ? [exported] : [],
    );

    // Every table in the tree is exported from `schema/index.ts`, so a short
    // list means the export surface moved rather than that the tree shrank.
    expect(tables.length).toBeGreaterThan(20);

    const mentioning = tables
      .flatMap((table) =>
        Object.values(getTableColumns(table))
          .filter((column) => column.name.includes("tier"))
          .map((column) => `${getTableName(table)}.${column.name}`),
      )
      .sort();

    expect(mentioning).toEqual(TIER_COLUMNS);
  });
});

/** Every `.ts` file under a directory, recursively. */
function typeScriptUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return typeScriptUnder(path);
    }

    return entry.name.endsWith(".ts") ? [path] : [];
  });
}
