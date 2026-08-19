// What the audit declarations promise about who acted.
//
// One claim carries this file: an entry either names a member of staff or it
// names nobody, and it says which. The failure the check refuses is not the
// missing actor — that is the honest state of a sweep's write — but the row
// where the two columns disagree, because both readings of it are wrong. A
// `staff` row with no actor is an attribution dropped somewhere between the
// guard and the table; a `system` row that names one credits an account with a
// change it did not make, which is what a placeholder staff account would do on
// every unattended write rather than on a buggy one.
//
// The check is asserted over its *text* and not only its name. Written as
// `actor_kind = 'system' or actor_id is not null` it satisfies the name, passes
// any test that only asks whether a constraint by that name exists, and accepts
// the one row that matters: a system entry pointing at a real account. The
// shape is the claim, so the shape is what is read back.
//
// Whether Postgres actually refuses such a row, and whether the backfill in the
// migration leaves every existing entry legible as `staff`, are questions about
// a database with rows in it. No assertion over a schema object can answer
// them, and `test/audit-trail.e2e-spec.ts` is where they are asked.

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { auditActorKindEnum, auditEntry } from "./audit.js";

const dialect = new PgDialect();

function checkNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).checks.map((declared) => declared.name);
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): string {
  const declared = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name,
  );

  if (!declared) {
    throw new Error(`no check named ${name}`);
  }

  return dialect.sqlToQuery(declared.value).sql;
}

describe("the two kinds of actor", () => {
  it("knows a member of staff and the property's own machinery", () => {
    expect(auditActorKindEnum.enumName).toBe("audit_actor_kind");
    expect(auditActorKindEnum.enumValues).toEqual(["staff", "system"]);
  });

  it("says which kind on every row, and never leaves it to be inferred", () => {
    // Without this column a null actor is two different facts — an unattended
    // write and a lost attribution — and a reader has to pick one.
    expect(auditEntry.actorKind.getSQLType()).toBe("audit_actor_kind");
    expect(auditEntry.actorKind.notNull).toBe(true);
    expect(auditEntry.actorKind.hasDefault).toBe(false);
  });

  it("lets an entry name nobody, since a sweep is nobody", () => {
    // The column that was `NOT NULL` while every write in the tree was a
    // manager's. The check below is what stops the room this opens from being
    // used by a write that does have a person behind it.
    expect(auditEntry.actorId.notNull).toBe(false);
  });
});

describe("naming who acted", () => {
  it("demands an actor for a staff entry and refuses one for a system entry", () => {
    expect(checkNames(auditEntry)).toContain("audit_entry_actor_check");

    const sql = checkSql(auditEntry, "audit_entry_actor_check");

    // Both branches, each binding one kind to one state of the actor column.
    expect(sql).toContain("'staff'");
    expect(sql).toContain("'system'");
    expect(sql).toMatch(/'staff'[\s\S]*is not null/);
    expect(sql).toMatch(/'system'[\s\S]*is null/);
  });

  it("states the rule as a pair of kinds rather than as a nullability", () => {
    // `actor_kind = 'system' or actor_id is not null` carries the same name and
    // admits the row this exists to refuse: a system entry pointing at a real
    // account, which reads downstream as a change that member of staff made.
    const sql = checkSql(auditEntry, "audit_entry_actor_check");

    expect(sql).toContain(" or ");
    expect(sql.match(/'staff'/g)).toHaveLength(1);
    expect(sql.match(/'system'/g)).toHaveLength(1);
  });

  it("keeps the trail's other guarantees about the snapshots", () => {
    // The attribution columns are new; these are not, and a migration that
    // rebuilt the table would be the way to lose them silently.
    expect(checkNames(auditEntry)).toContain("audit_entry_states_present");
    expect(checkNames(auditEntry)).toContain(
      "audit_entry_action_matches_states",
    );
  });
});
