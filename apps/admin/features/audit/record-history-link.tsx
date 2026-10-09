"use client";

import type { StaffRole } from "@mariva/shared";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { mayReadTheLog } from "./change-log";
import { type RecordTable, recordHistoryHref } from "./record-history";

/* The door `docs/screens.md` asks every record to carry: "Audit is reached from
 * the record, not only from the menu … Whoever opens an audit log arrives with
 * a question about a thing, so the thing carries the door."
 *
 * One component for all of them, rather than a link written out on each screen,
 * and the reason is the gate rather than the markup. The matrix's *Audit log
 * viewer* row grants `ACCOUNTANT`, `MANAGER` and `ADMIN` and nobody else, so a
 * receptionist reading a folio must not be shown a door that answers with the
 * sentence about where their own work is reviewed. A screen that built its own
 * link would be a screen that could forget that, and there would be no way to
 * tell which of the four had. Here there is one predicate — `mayReadTheLog`,
 * the same one the screen itself is drawn behind — and a site that omitted the
 * role would not compile.
 *
 * Not a wall. The API's capability guard is the wall; this decides whether a
 * control is drawn for somebody it would refuse, which is the console's rule for
 * every other role-gated act.
 *
 * The label is the caller's because the thing is: an operator on a folio is
 * asking about an account and an operator on a guest is asking about a person,
 * and "record" is a word neither of them used.
 */

export function RecordHistoryLink({
  role,
  tableName,
  rowId,
  label,
  className,
}: {
  /* Null while the session is still being read. The console's screens narrow
   * their role the same way and for the same reason — the guard above them
   * renders nothing until the session is authenticated, but the narrowing is
   * real and a cast would be a claim about a position in a tree that nothing
   * checks. Null draws nothing: a door offered before anyone knows who is at it
   * is a door offered to whoever that turns out to be. */
  role: StaffRole | null;
  tableName: RecordTable;
  rowId: string;
  label: string;
  className?: string;
}) {
  if (role === null || !mayReadTheLog(role)) {
    return null;
  }

  return (
    <Link
      href={recordHistoryHref(tableName, rowId)}
      className={cn(
        "text-sm font-semibold underline-offset-4 hover:underline",
        className,
      )}
    >
      {label}
    </Link>
  );
}
