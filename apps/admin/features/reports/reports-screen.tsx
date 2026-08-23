"use client";

import type { StaffRole } from "@mariva/shared";
import { ArrowUpRightIcon, ChartNoAxesCombinedIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { EmptyState, PageHeader } from "@/components/console";
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
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Reports"
        description="Named hotel reports with closed-day boundaries and Excel export."
      />

      {offered.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No reports available"
          description="This role has no report access."
        />
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offered.map((page) => (
            <li key={page.id}>
              <Link
                className="group flex h-full min-h-44 flex-col rounded-lg bg-card p-5 shadow-card transition-[box-shadow,transform] duration-200 ease-ui hover:-translate-y-0.5 hover:shadow-raised active:translate-y-px"
                href={page.href}
              >
                <span className="grid size-10 place-items-center rounded-md bg-accent-soft text-accent-strong">
                  <ChartNoAxesCombinedIcon
                    aria-hidden="true"
                    className="size-5"
                  />
                </span>
                <span className="mt-4 text-lg font-semibold">{page.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {page.summary}
                </span>
                <span className="mt-auto flex items-center justify-between pt-4 text-sm font-semibold">
                  Open report
                  <ArrowUpRightIcon aria-hidden="true" className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
