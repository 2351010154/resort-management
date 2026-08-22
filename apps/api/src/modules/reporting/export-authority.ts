// Who may take a list away as a file, and how much of it goes in.
//
// **Two capabilities, and the second is the list's own.** Every export route
// declares `reporting.excel-export` at the guard, which is what makes it an
// export; then it asks this file for the grant the caller holds on the row that
// governs the list underneath — `operations.income-expense` for the cash book,
// `operations.cash-drawer` for the shift history, `audit.read` for the change
// log. A caller who may not read the list on screen may not read it in Excel.
//
// **That is how the matrix's "RCP: reporting.excel-export" note gets enforced
// without being copied.** The row hands `RECEPTIONIST` a `⚠` and notes
// "operational lists only", and the temptation is to write that here as a role
// branch or as a list of exports a receptionist may reach. Both would be the
// matrix restated in a second place, and the second place is the one that goes
// stale: the day a sixth role is added to that row, a list of permitted exports
// would say nothing about them and a role branch would say the wrong thing.
// Composing the two grants instead makes the note a consequence rather than a
// rule. A receptionist is denied `operations.income-expense` outright, so no
// cash-book export exists for them to reach; they hold `⚠` on the cash drawer,
// so the shift export answers with their own shifts; they are denied
// `audit.read`, so the change log is refused. Which is, in the matrix's own
// words, operational lists only — and nothing here had to know that.
//
// **An export may never widen what its reader could already see.** That is the
// single property this file exists to hold, and it is why the narrowing travels
// with the grant rather than being decided per route: an accountant's change-log
// export carries financial entries only, exactly as their screen does, and a
// receptionist's shift export carries their own shifts, exactly as their screen
// does. `audit.controller.ts` and `shift.controller.ts` each resolve the same
// fact for their own list, off the grant and never off the role, and
// {@link readsEverythingOn} is that rule written once for the exports.
//
// **It fails closed, in the shape both of those controllers use.** The
// predicate is "only a grant that is unambiguously unnarrowed opens the rest"
// rather than "conditional is narrow", so a grant this file has not heard of —
// or a decision that never arrived — takes the narrow path. A decision that
// never arrived is a guard that did not run, and the honest answer to that is
// the smaller file rather than every figure the property holds.

import { ForbiddenException } from "@nestjs/common";
import type { Principal } from "../../common/auth/principal.js";
import { capability, type CapabilityKey } from "../identity/rbac/matrix.js";
import { type Grant, permits } from "../identity/rbac/roles.js";

/**
 * The grant this caller holds on a row, resolved from the matrix and nothing
 * else.
 *
 * The same three-way lookup `access.guard.ts` makes, and it is made a second
 * time rather than read back off the request because the request carries the
 * decision for `reporting.excel-export` — one route declares one capability, and
 * the row this asks about is the other one.
 *
 * A caller who is neither staff nor a signed-in guest is `denied`, and so is a
 * public row. Neither case arises on the three rows the exports compose: all
 * three are staff rows, and `reporting.excel-export` denies the guest realm at
 * the guard before anything here runs. They are written as refusals anyway,
 * because the direction an authorisation helper has to be wrong in is the one
 * where a caller sees less than they might have.
 */
export function grantHeldOn(
  key: CapabilityKey,
  principal: Principal | null,
): Grant {
  const row = capability(key);

  if (principal?.realm === "staff") {
    return row.staff[principal.role];
  }

  if (principal?.realm === "guest") {
    return row.guest;
  }

  return "denied";
}

/**
 * The caller's grant on the list being exported, or a refusal.
 *
 * `read` is what is asked of the row, because an export reads it — a 👁 grant is
 * authority to see a list and therefore authority to take it away, and demanding
 * `full` here would refuse the accountant the shift history the matrix
 * deliberately hands them.
 *
 * The sentence names the list rather than the export, because that is the fact
 * the caller is missing: somebody refused the cash-book export has not lost an
 * export, they were never able to read the book.
 */
export function readingTheListBehind(
  key: CapabilityKey,
  principal: Principal | null,
): Grant {
  const grant = grantHeldOn(key, principal);

  if (!permits(grant, "read")) {
    throw new ForbiddenException(
      `Not permitted: ${capability(key).row} — an export carries what the ` +
        `screen carries, and this one is not yours to read`,
    );
  }

  return grant;
}

/**
 * Whether this grant reads the whole of its list rather than a slice of it.
 *
 * `full` is the matrix's ✅ and `read` is a 👁 — a read-only grant on a row is
 * not a narrower claim about *which* rows, only about what may be done to them,
 * and an export does nothing to them. Everything else narrows, `conditional`
 * included, which is the ⚠ that carries "ACC: financial entries only" on the
 * change log and "RCP: own shift" on the drawer.
 *
 * One predicate for both, because it is one rule: `audit.controller.ts` spells
 * it as `readsTheWholeLog` and `shift.controller.ts` as the negation of
 * `narrowedToOwnShifts`, and the two are the same sentence about two rows.
 */
export function readsEverythingOn(grant: Grant): boolean {
  return grant === "full" || grant === "read";
}

/**
 * The caller's grant on an *aggregate*, or a refusal — the reads behind the two
 * Reports exports.
 *
 * **A total is not a list, and there is no narrow version of one.** Every other
 * export composes a scope into the rows: an accountant's change log carries
 * financial entries only, a receptionist's shift history carries their own
 * drawers, and {@link readsEverythingOn} decides which. A report has no rows to
 * withhold — a month's room revenue is one figure assembled from every stay the
 * property took, and a narrowed reader handed it would be holding exactly what
 * the narrowing exists to keep from them. So a narrowed grant is refused here
 * rather than scoped, which is the fail-closed direction this file argues for
 * everywhere else.
 *
 * Nothing reaches this refusal today and it is not written for a hypothetical:
 * `reporting.excel-export` denies `HOUSEKEEPING` outright, and they are the only
 * holder of a `⚠` on either row the two reports compose. What it does is make
 * that a consequence of the two rows rather than something this file knows —
 * the day the matrix narrows somebody on revenue or on the operational reports,
 * this refuses them the file instead of quietly handing over the whole property.
 */
export function readingEveryFigureOn(
  key: CapabilityKey,
  principal: Principal | null,
): void {
  if (!readsEverythingOn(readingTheListBehind(key, principal))) {
    throw new ForbiddenException(
      `Not permitted: ${capability(key).row} — a report is one figure over ` +
        `every stay the property took, so there is no narrower file to give you`,
    );
  }
}

/**
 * The staff member behind an export, or a refusal.
 *
 * Only needed where the narrowing is "your own": a receptionist's shift export
 * is scoped to the account that asked for it, and that account has to exist for
 * the scope to mean anything. Every row the exports compose denies the guest
 * realm, so nothing this can refuse reaches it today — it is here because the
 * alternative to refusing is scoping a file to `undefined`, which is a file
 * holding every operator's drawer.
 */
export function exportingStaffMember(principal: Principal | null): string {
  if (principal?.realm !== "staff") {
    throw new ForbiddenException(
      "Only a signed-in member of staff may export management data",
    );
  }

  return principal.userId;
}
