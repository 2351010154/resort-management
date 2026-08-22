"use client";

import {
  HOUSEKEEPING_STATUSES,
  ROOM_STATUS_REPORT_EXPORT_PATH,
  ROOM_STATUS_REPORT_EXPORT_STEM,
  type StaffRole,
} from "@mariva/shared";
import type * as React from "react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
/* The console's one rendering of an instant in the property's zone, taken from
 * the module that already owns it rather than a second `Intl.DateTimeFormat`
 * beside it. */
import { formatInstant } from "@/features/guests/guest-record";
import { useStaffSession } from "@/lib/auth";
import {
  type ExcelExportSubject,
  mayTakeAnExport,
  useExcelExport,
} from "@/lib/excel-export";

import { RoomStatusChart } from "./report-charts";
import { useRoomStatusReport } from "./report-queries";
import {
  boundaryNote,
  mayReadRoomStatus,
  ROOM_STATUS_LABELS,
  type RoomStatusBar,
  type RoomStatusReport,
  roomStatusSeries,
} from "./reports";

/* Where every room stands — `FR-RPT-02`, the operational half.
 *
 * ## This page is counted, not read back
 *
 * Every other figure the Reports family draws comes from a frozen night-audit
 * snapshot. This one cannot, and `docs/screens.md` says why in as many words:
 * "room status has no frozen row to read — it is a live count over
 * `room_condition`, because a housekeeping status is where a room stands now and
 * is never a fact about a night that has ended, and a frozen copy of it would be
 * exactly that confusion." `schema/housekeeping.ts` makes the same argument from
 * the storage side and is explicit that no history of the column exists.
 *
 * **So there is no range picker here, and its absence is the design.** The
 * family's picker is `range-picker.tsx` and the revenue page mounts it; a
 * control on this page would take two trading days and cut nothing, which is a
 * filter the API would accept and ignore. `roomStatusReportQuery` is empty for
 * the same reason. What this page carries in its place is the instant the rooms
 * were counted — which is the fact a range would have been standing in for.
 *
 * **The boundary stamp is still here.** It is the family's page furniture and it
 * means exactly what it means on the revenue page: no page shows a day the night
 * audit has not closed. It is not where these counts came from, and the page
 * says both things rather than leaving a reader to reconcile them.
 *
 * ## Who this is for
 *
 * The matrix's *Operational reports* row: the desk, housekeeping and management.
 * The accountant is not on it and is refused by the API — the mirror of the
 * revenue page, which the desk is refused. A housekeeper reaches the board
 * itself rather than this, which is their own screen and already shows every
 * room; `nav-inventory.ts` does not offer them the Reports family at all.
 *
 * **No animation.** The chart paints in the state it is going to be in, and what
 * the page says while it is counting is a line of text.
 */

const ROOM_STATUS_EXPORT: ExcelExportSubject = {
  path: ROOM_STATUS_REPORT_EXPORT_PATH,
  stem: ROOM_STATUS_REPORT_EXPORT_STEM,
  failure: "The room-status report could not be exported.",
};

export function RoomStatusScreen() {
  const session = useStaffSession();

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayReadRoomStatus(role);
  /* Both rows, and neither alone — the same conjunction the revenue page makes.
   * Here it lets a receptionist through, which is what the *Excel export* row's
   * "operational lists only" note comes to on an operational page. */
  const exportsTheReport = offered && role !== null && mayTakeAnExport(role);

  const report = useRoomStatusReport(offered);
  const exported = useExcelExport(ROOM_STATUS_EXPORT);

  const bars = useMemo(
    () => (report.data === undefined ? [] : roomStatusSeries(report.data)),
    [report.data],
  );

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Reports
        </p>
        <h1 className="font-display text-display-sm mt-2">Room status</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2 max-w-prose">
          Every room the property has, in the condition it is in and by type.
          This is a count taken now rather than a closed night read back: a
          housekeeping status is where a room stands at this minute, and there
          is no frozen copy of it to report from. There is no range for the same
          reason.
        </p>
      </header>

      {!offered ? (
        <p className="text-muted-foreground mt-rhythm-2 max-w-prose text-sm">
          Where the rooms stand belongs to the desk and to management. What the
          property earned is the report open to you.
        </p>
      ) : (
        <>
          <div className="mt-rhythm-2 flex flex-wrap items-center gap-3">
            <Stamp
              pending={report.isPending}
              failed={report.isError}
              report={report.data ?? null}
            />
            {exportsTheReport ? (
              <Button
                type="button"
                variant="ghost"
                disabled={exported.isPending}
                onClick={() => {
                  // No filters: this page has none, and the file is the count
                  // taken when the API answers rather than the one on screen.
                  // A spreadsheet of a live count is a photograph of the minute
                  // it was written, which is what its own stamp says.
                  exported.mutate({});
                }}
              >
                {exported.isPending ? "Writing the file" : "Export to Excel"}
              </Button>
            ) : null}
          </div>

          <Reading
            pending={report.isPending}
            failed={report.isError}
            report={report.data ?? null}
            bars={bars}
          />
        </>
      )}
    </div>
  );
}

/**
 * Two sentences: when the rooms were counted, and where the family's boundary
 * falls.
 *
 * Both, and in that order, because they are different facts and the order is the
 * one a reader needs them in — what they are looking at, then what the family
 * promises about it. Printing only the boundary would be this page borrowing a
 * stamp that says nothing about its own figures.
 */
function Stamp({
  pending,
  failed,
  report,
}: {
  pending: boolean;
  failed: boolean;
  report: RoomStatusReport | null;
}) {
  if (failed) {
    return null;
  }

  if (pending || report === null) {
    return (
      <span className="text-muted-foreground text-xs">Counting the rooms.</span>
    );
  }

  return (
    <span className="text-muted-foreground text-xs">
      Counted {formatInstant(report.takenAt)} · {report.rooms} rooms ·{" "}
      {boundaryNote(report.lastClosedBusinessDate)}
    </span>
  );
}

/** The counts, the chart, and the grid the two are drawn from. */
function Reading({
  pending,
  failed,
  report,
  bars,
}: {
  pending: boolean;
  failed: boolean;
  report: RoomStatusReport | null;
  bars: readonly RoomStatusBar[];
}) {
  if (failed) {
    return (
      <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
        The room-status report could not be read. Nothing here is a statement
        about where the rooms stand.
      </p>
    );
  }

  if (pending || report === null) {
    return (
      <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
        Counting the rooms.
      </p>
    );
  }

  if (report.rooms === 0) {
    return (
      <p className="text-muted-foreground mt-rhythm-2 max-w-prose text-sm">
        The property has no rooms on record. That is a question for the rooms
        screen rather than an answer this report can give.
      </p>
    );
  }

  return (
    <>
      <dl className="mt-rhythm-2 grid gap-2 text-sm sm:grid-cols-4">
        {report.byStatus.map((count) => (
          <div key={count.status}>
            <dt className="text-muted-foreground text-xs tracking-caps uppercase">
              {ROOM_STATUS_LABELS[count.status]}
            </dt>
            <dd className="font-mono">{count.rooms}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-rhythm-2">
        <RoomStatusChart bars={bars} />
      </section>

      <table className="mt-rhythm-2 w-full border-collapse text-sm">
        <caption className="text-muted-foreground mb-rhythm-1 text-left text-xs">
          Every room type the property operates, in the order it prices them. A
          nought is a real answer — no room of that type is in that condition —
          and a type the property has no rooms of is not a row at all.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Column>Room type</Column>
            <Column align="right">Rooms</Column>
            {HOUSEKEEPING_STATUSES.map((status) => (
              <Column align="right" key={status}>
                {ROOM_STATUS_LABELS[status]}
              </Column>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.byType.map((type) => (
            <tr className="border-border border-b" key={type.roomType}>
              <td className="py-1 pr-3 whitespace-nowrap first:pl-0">
                {type.roomType}
              </td>
              <td className="px-3 py-1 text-right font-mono whitespace-nowrap">
                {type.rooms}
              </td>
              {type.byStatus.map((count) => (
                <td
                  className="text-muted-foreground px-3 py-1 text-right font-mono whitespace-nowrap last:pr-0"
                  key={count.status}
                >
                  {count.rooms}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Column({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={
        align === "right"
          ? "text-muted-foreground px-3 py-2 text-right text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0"
          : "text-muted-foreground px-3 py-2 text-left text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0"
      }
    >
      {children}
    </th>
  );
}
