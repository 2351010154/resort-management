// The three plans, as rows a manager edits — `property-and-tariff.md` §3.
//
// §3 states two of the plans as arithmetic on the third: `NONREF` is `STANDARD`
// − 10%, `BB` is `STANDARD` plus breakfast. `schema/pricing.ts` argues at length
// for why the ten and the breakfast figure are columns rather than literals in a
// service, and this is the endpoint that argument was for — the RBAC matrix
// gives `MANAGER` the rate-plan row, and a value only a deploy can change is not
// a value a manager has.
//
// No create and no delete. The three codes are a Postgres enum built from
// `RATE_PLAN_CODES`, so a fourth plan is a migration and a wire schema change
// before it is a row; a POST here would fail at the enum with a message about
// types when the real answer is that the plan does not exist yet.
//
// Every method takes a `DbExecutor` — `rate-calendar.service.ts` gives the
// reason, and it is `FR-AUD-01`: the edit and the row recording it are one
// commit or they are worth less than either alone. That row is now written by a
// trigger on `rate_plan`, so the commit they share is the statement itself; this
// file files nothing, and a second entry filed here would show every plan edit
// twice in the viewer `FR-AUD-02` asks for.

import type { RatePlanCode, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { ratePlan } from "../../database/schema/pricing.js";

export interface RatePlanView {
  readonly code: RatePlanCode;
  readonly name: string;
  readonly percentAdjustment: number;
  readonly breakfastPerPersonGross: VndAmount | null;
  readonly displayOrder: number;
}

/**
 * A change to one plan. An absent field is one the caller did not mention; a
 * `breakfastPerPersonGross` of `null` is one they cleared.
 */
export interface RatePlanEdit {
  readonly code: RatePlanCode;
  readonly name?: string;
  readonly percentAdjustment?: number;
  readonly breakfastPerPersonGross?: VndAmount | null;
}

const COLUMNS = {
  code: ratePlan.code,
  name: ratePlan.name,
  percentAdjustment: ratePlan.percentAdjustment,
  breakfastPerPersonGross: ratePlan.breakfastPerPersonGross,
  displayOrder: ratePlan.displayOrder,
};

@Injectable()
export class RatePlanService {
  /** All three, in the order the funnel offers them. */
  async list(exec: DbExecutor): Promise<RatePlanView[]> {
    return await exec
      .select(COLUMNS)
      .from(ratePlan)
      .orderBy(asc(ratePlan.displayOrder));
  }

  /**
   * Edits the fields the caller named and leaves the rest alone.
   *
   * The two bounds `schema/pricing.ts` puts on the columns are checked by
   * Postgres and not re-checked here — a discount below −100% and a breakfast of
   * zero are refused by `rate_plan_adjustment_within_bounds` and
   * `rate_plan_breakfast_positive_when_set`. The wire schema mirrors both, so a
   * caller gets a 400 naming the field; the constraints are what makes that true
   * of every writer, including a psql session.
   *
   * **One statement, and no lock taken to read the previous values first.**
   * There used to be a `for update` select in front of this, and its whole job
   * was to capture a pre-image the trigger is now handed by Postgres — under the
   * update's own row lock, which is stronger than anything this file could have
   * arranged. Two managers editing one plan at once are serialised by that lock
   * and each files the change they actually made over the row they actually
   * found.
   */
  async update(exec: DbExecutor, edit: RatePlanEdit): Promise<RatePlanView> {
    const changes = {
      ...(edit.name === undefined ? {} : { name: edit.name }),
      ...(edit.percentAdjustment === undefined
        ? {}
        : { percentAdjustment: edit.percentAdjustment }),
      ...(edit.breakfastPerPersonGross === undefined
        ? {}
        : { breakfastPerPersonGross: edit.breakfastPerPersonGross }),
    };

    // A PATCH naming no field is not an error, and it is not an UPDATE either —
    // Drizzle refuses an empty `set`, and a statement that writes nothing has
    // no business taking a row lock. Nothing is audited either: a gesture that
    // changed no value is not a change, and a log row for it would be an edit an
    // investigation has to rule out.
    if (Object.keys(changes).length === 0) {
      return await this.read(exec, edit.code);
    }

    const [after] = await exec
      .update(ratePlan)
      .set(changes)
      .where(eq(ratePlan.code, edit.code))
      .returning(COLUMNS);

    // An update that matched no row is a plan that does not exist, which is the
    // same answer the read below gives and is reached without a second query.
    if (!after) {
      throw new ORPCError("NOT_FOUND", {
        message: `No ${edit.code} plan — the property has not laid one down`,
      });
    }

    return after;
  }

  private async read(
    exec: DbExecutor,
    code: RatePlanCode,
  ): Promise<RatePlanView> {
    const [found] = await exec
      .select(COLUMNS)
      .from(ratePlan)
      .where(eq(ratePlan.code, code))
      .limit(1);

    if (!found) {
      throw new ORPCError("NOT_FOUND", {
        message: `No ${code} plan — the property has not laid one down`,
      });
    }

    return found;
  }
}
