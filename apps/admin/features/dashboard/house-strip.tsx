"use client";

import type { HouseTally, Reading } from "./day-counts";

/* Every room in the property, in one line.
 *
 * The four cards above count queues — work waiting to be done. This counts
 * stock: what the property is holding right now, which is the other question a
 * receptionist answers all day ("can I put a walk-in somewhere?", "how much is
 * the floor still sitting on?"). It is a tally and not a rate: occupancy as a
 * percentage is a KPI, `docs/screens.md` keeps those in Reports because the
 * RBAC matrix denies them to this screen's main user, and four counts of rooms
 * are facts about the building rather than a measure of the business.
 *
 * **The bar is the same four numbers and not a fifth fact.** It carries no
 * label of its own and is `aria-hidden`: the list under it is the accessible
 * reading, and a screen reader announcing four percentages nobody wrote would
 * be inventing precision. What it adds for a sighted operator is the
 * proportion — thirty rooms out and four to clean is a different evening from
 * four out and thirty to clean, and two lists of numbers read the same.
 */

interface Band {
  readonly key: keyof Omit<HouseTally, "total">;
  readonly label: string;
  /** The bar's fill, and the dot beside the figure — one class for both. */
  readonly swatch: string;
}

/* Occupied first because it is the largest on a working night and the bar
   reads left to right as "sold, sellable, coming back, gone". */
const BANDS: readonly Band[] = [
  { key: "occupied", label: "Occupied", swatch: "bg-accent-mark" },
  { key: "readyVacant", label: "Ready & vacant", swatch: "bg-success" },
  { key: "toClean", label: "To clean", swatch: "bg-warning" },
  { key: "outOfOrder", label: "Out of order", swatch: "bg-line" },
];

export function HouseStrip({ reading }: { reading: Reading<HouseTally> }) {
  return (
    <section
      aria-labelledby="house-strip-heading"
      aria-busy={reading.status === "pending" ? true : undefined}
      className="rounded-lg bg-card p-5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="house-strip-heading"
          className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          The house now
        </h2>
        {reading.status === "read" ? (
          <p className="text-sm text-muted-foreground">
            {reading.value.total} rooms
          </p>
        ) : null}
      </div>

      {reading.status === "pending" ? (
        <p className="mt-4 text-sm text-muted-foreground">Reading the board.</p>
      ) : null}

      {reading.status === "failed" ? (
        <p className="mt-4 border-danger border-l-2 pl-3 text-sm text-danger">
          The board could not be read.
        </p>
      ) : null}

      {reading.status === "read" ? <HouseBands tally={reading.value} /> : null}
    </section>
  );
}

function HouseBands({ tally }: { tally: HouseTally }) {
  return (
    <>
      {/* A property with no rooms configured would divide by zero, and the
          honest bar for it is an empty track rather than four NaN widths. */}
      {tally.total > 0 ? (
        <div
          aria-hidden="true"
          className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-muted"
        >
          {BANDS.map((band) =>
            tally[band.key] === 0 ? null : (
              <span
                key={band.key}
                className={band.swatch}
                style={{ width: `${(tally[band.key] / tally.total) * 100}%` }}
              />
            ),
          )}
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {BANDS.map((band) => (
          <div key={band.key} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${band.swatch}`}
            />
            <div className="min-w-0">
              <dd className="text-lg font-semibold leading-tight lining-nums tabular-nums">
                {tally[band.key]}
              </dd>
              <dt className="truncate text-sm text-muted-foreground">
                {band.label}
              </dt>
            </div>
          </div>
        ))}
      </dl>
    </>
  );
}
