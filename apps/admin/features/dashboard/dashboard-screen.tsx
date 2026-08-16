"use client";

import { formatLongDate } from "@/lib/business-date";

import { CountCard } from "./count-card";
import { useDayCounts } from "./dashboard-queries";

/* The launchpad three of the five roles land on.
 *
 * `docs/screens.md` §"Staff surfaces" is explicit about what this is and what
 * it is not: today's arrivals awaiting check-in, departures awaiting checkout,
 * rooms not yet ready and unsettled folios, each count leading into its family
 * screen — and **no KPIs**. Occupancy, ADR and RevPAR live in Reports because
 * the RBAC matrix denies them to the receptionist, who is this screen's main
 * user, and a launchpad that carried them would be one screen serving two
 * audiences and answering to the narrower one.
 *
 * So there is nothing here but four numbers and four doors. Each is the count
 * of a queue somebody is about to work, which is why none of them is decorated:
 * the number is read, the card is pressed, and the operator is in the list.
 *
 * **The families behind these links do not exist yet.** `/arrivals`,
 * `/departures`, `/housekeeping` and `/folios` are the paths those screens will
 * occupy and each is a 404 until it lands — the same honest state
 * `lib/auth/landing-route.ts` and `features/shell/nav-inventory.ts` both argue
 * for at length. A placeholder behind each card would be a second opinion about
 * an inventory that has an owner, and would look like progress that has not
 * happened.
 *
 * The date under the heading is the *property's*, not the browser's: it comes
 * back on the housekeeping board, resolved by the API against the configured
 * rollover hour. It is stated because every figure below is keyed to it, and a
 * receptionist working at 01:30 is looking at counts for a day the wall
 * calendar no longer agrees with.
 */

export function DashboardScreen() {
  const counts = useDayCounts();

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Front desk
        </p>
        <h1 className="font-display text-display-sm mt-2">Dashboard</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          {counts.businessDate === null
            ? "Reading the property's day."
            : `The property is working ${formatLongDate(counts.businessDate)}.`}
        </p>
      </header>

      {/* A list, because that is what four counts are, and a screen reader
          announcing "list of 4 items" tells an operator arriving by keyboard
          how much is here before they Tab into it. */}
      <ul className="mt-rhythm-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          label="Arrivals awaiting check-in"
          href="/arrivals"
          description="Confirmed stays due in today."
          reading={counts.arrivals}
        />
        <CountCard
          label="Departures awaiting checkout"
          href="/departures"
          description="Guests in house who leave today."
          reading={counts.departures}
        />
        <CountCard
          label="Rooms not ready"
          href="/housekeeping"
          description="Nobody can be walked into these."
          reading={counts.roomsNotReady}
        />
        <CountCard
          label="Unsettled folios"
          href="/folios"
          description="Accounts that do not balance."
          reading={counts.unsettledFolios}
        />
      </ul>
    </div>
  );
}
