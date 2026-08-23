"use client";

import {
  BedDoubleIcon,
  LogInIcon,
  LogOutIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useStaffSession } from "@/lib/auth";
import {
  formatLongDate,
  greetingFor,
  propertyMomentAt,
} from "@/lib/business-date";

import { CountCard } from "./count-card";
import { useDayCounts } from "./dashboard-queries";
import { HouseStrip } from "./house-strip";
import { ShiftSummary } from "./shift-summary";
import { StaysPreview } from "./stays-preview";

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
 * Everything below the four cards holds that line. The house strip counts rooms
 * and never divides them; the two previews name the stays already counted
 * above; the shift panel is the desk's own drawer and the note the last shift
 * left. All four are operational facts a receptionist is entitled to and acts
 * on, rather than measures of how the property is trading.
 *
 * **Nothing here is a second implementation of anything.** The counts and the
 * previews come out of the same three answers — `dashboard-queries.ts` says why
 * there is no `GET /dashboard` — and the shift acts open the surfaces the
 * command palette opens. The screen composes; it does not own.
 *
 * **The families behind these links do not exist yet.** `/arrivals`,
 * `/departures`, `/housekeeping` and `/folios` are the paths those screens will
 * occupy and each is a 404 until it lands — the same honest state
 * `lib/auth/landing-route.ts` and `features/shell/nav-inventory.ts` both argue
 * for at length. A placeholder behind each card would be a second opinion about
 * an inventory that has an owner, and would look like progress that has not
 * happened.
 *
 * The date under the greeting is the *property's*, not the browser's: it comes
 * back on the housekeeping board, resolved by the API against the configured
 * rollover hour. It is stated because every figure below is keyed to it, and a
 * receptionist working at 01:30 is looking at counts for a day the wall
 * calendar no longer agrees with. The greeting beside it is cut on the
 * property's wall clock for the same reason — `greetingFor` takes the moment in
 * Ho Chi Minh City, so a night porter is not wished good morning because a
 * laptop is set to another zone.
 */

export function DashboardScreen() {
  const counts = useDayCounts();
  const session = useStaffSession();

  // Once per mount. The greeting is a word, not a clock: re-reading it on every
  // render would still only change it twice a day, and a screen that re-rendered
  // to say "Good evening" mid-sentence is a distraction on a surface `NFR-04`
  // keeps still on purpose.
  const greeting = useMemo(() => greetingFor(propertyMomentAt(new Date())), []);

  // The *last* word, which is the name a Vietnamese colleague is addressed by:
  // Trần Minh is Minh. `user-menu.tsx` takes its initials off the same end for
  // the same reason. A greeting that used the first word would call most of the
  // desk by their family name.
  const givenName =
    session.status === "authenticated"
      ? (session.user.fullName.trim().split(/\s+/).at(-1) ?? null)
      : null;

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-3xl font-semibold leading-9 tracking-[-0.02em]">
          {givenName === null ? `${greeting}.` : `${greeting}, ${givenName}.`}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here is what needs the desk today.
        </p>
        <p className="mt-3 text-sm font-semibold">
          {counts.businessDate === null
            ? "Reading the hotel day."
            : formatLongDate(counts.businessDate)}
        </p>
      </header>

      {/* A list, because that is what four counts are, and a screen reader
          announcing "list of 4 items" tells an operator arriving by keyboard
          how much is here before they Tab into it. */}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          label="Arrivals awaiting"
          title="Check-in"
          href="/arrivals"
          description="Confirmed stays due in today that nobody has checked in."
          action="View arrivals"
          icon={LogInIcon}
          reading={counts.arrivals}
        />
        <CountCard
          label="Departures awaiting"
          title="Checkout"
          href="/departures"
          description="Guests in house whose last night was last night."
          action="View departures"
          icon={LogOutIcon}
          reading={counts.departures}
        />
        <CountCard
          label="Rooms not yet"
          title="Ready"
          href="/housekeeping"
          description="Nobody can be walked into these, occupied or otherwise."
          action="View housekeeping"
          icon={BedDoubleIcon}
          reading={counts.roomsNotReady}
        />
        <CountCard
          label="Folios still"
          title="Unsettled"
          href="/folios"
          description="Accounts that do not balance, over or short."
          action="View folios"
          icon={WalletCardsIcon}
          reading={counts.unsettledFolios}
        />
      </ul>

      <div className="mt-4">
        <HouseStrip reading={counts.house} />
      </div>

      {/* Two thirds and one third, which is the reference composition and also
          the right weight: the stays are read, the drawer is acted on, and the
          column that gets pressed is the narrow one nearest the operator's
          reach. They stack on a laptop rather than shrinking to two unreadable
          columns. */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section
          aria-labelledby="today-stays-heading"
          className="rounded-lg bg-card p-5 shadow-card xl:col-span-2"
        >
          <h2 id="today-stays-heading" className="sr-only">
            Today's stays
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
            <StaysPreview
              heading="Due in today"
              subject="arriving today"
              href="/arrivals"
              action="Open the arrivals queue"
              reading={counts.dueIn}
            />
            <StaysPreview
              heading="Due out today"
              subject="leaving today"
              href="/departures"
              action="Open the departures queue"
              reading={counts.dueOut}
            />
          </div>
        </section>

        <ShiftSummary />
      </div>
    </div>
  );
}
