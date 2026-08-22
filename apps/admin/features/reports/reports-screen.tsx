"use client";

import type { StaffRole } from "@mariva/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useCommands } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";

import { reportsFor } from "./reports";

/* The Reports menu — `docs/screens.md`'s "short menu of named reports".
 *
 * ## What is on it, and what is deliberately not
 *
 * `screens.md` describes the family as five figures — revenue, room status,
 * occupancy, ADR and RevPAR — and every one of them has a page. `FR-RPT-02` is
 * the first two and `FR-RPT-03` is the last three, which share a page because
 * they share one range and one pair of counts. `reports.ts` holds the inventory
 * and every entry on it is a door that opens.
 *
 * There is no report builder. The requirements enumerate exactly what is needed
 * and `screens.md` says so in as many words.
 *
 * ## Why the menu is filtered per page rather than per family
 *
 * The three pages sit on three different rows of the matrix, and no row contains
 * another. *Revenue and financial reports* is the accountant's and management's;
 * *Operational reports* is the desk's and management's; *Occupancy / ADR /
 * RevPAR* is a row of its own that today grants the same three as the financial
 * one and is still not that row. So a receptionist opening Reports finds exactly
 * the room-status page and an accountant finds the other two — which is why
 * `nav-inventory.ts` grants this family to `LEDGER` and is right to: everybody in
 * that set holds at least one page, and none of them is offered a page they do
 * not hold.
 *
 * Not a wall. The API's capability guard is the wall, and it refuses the route a
 * typed url would reach. What this decides is whether the console offers
 * somebody a door that answers 403.
 *
 * **No entrance animation and nothing to wait for.** The menu is drawn from the
 * session that is already resolved above it, so there is no request behind this
 * screen and nothing on it moves.
 */

export function ReportsScreen() {
  const session = useStaffSession();
  const router = useRouter();

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role === null ? [] : reportsFor(role);

  /* The pages this role may open, under ⌘K. Registered by the menu because the
   * menu is what knows which of the two a role holds — `nav-inventory.ts` owns
   * the family's own door and deliberately says nothing about what is behind
   * it, since the two pages sit on two different rows of the matrix. */
  useCommands(
    offered.map((page) => ({
      id: `reports.${page.id}`,
      label: `Open the ${page.label.toLowerCase()} report`,
      group: "navigation" as const,
      keywords: ["report", "báo cáo", page.id],
      action: () => {
        router.push(page.href);
      },
    })),
  );

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Management
        </p>
        <h1 className="font-display text-display-sm mt-2">Reports</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2 max-w-prose">
          Each report is a page with its own range, a chart and an Excel export.
          Every one of them is stamped with the last business date the night
          audit has closed — a boundary rather than a statement of source: what
          it promises is that no page shows a day the audit has not closed, not
          that every figure on it was read from a frozen row.
        </p>
      </header>

      {offered.length === 0 ? (
        <p className="text-muted-foreground mt-rhythm-2 max-w-prose text-sm">
          No report is yours to open. What the property earned belongs to the
          accountant and management, and where the rooms stand belongs to the
          desk — this account holds neither.
        </p>
      ) : (
        <ul className="mt-rhythm-2 max-w-prose">
          {offered.map((page) => (
            <li className="border-border border-b" key={page.id}>
              <Link
                className="focus-visible:ring-ring block py-rhythm-1 focus-visible:ring-2 focus-visible:outline-none"
                href={page.href}
              >
                <span className="font-display text-lg">{page.label}</span>
                <span className="text-muted-foreground mt-1 block text-sm">
                  {page.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
