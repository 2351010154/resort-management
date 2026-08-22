// Occupancy, ADR and RevPAR — `FR-RPT-03`.
//
// How full the property was over a stretch of closed trading days, what it sold
// a room for, and what each room it could have sold earned: three divisions of
// the counts the night audit froze, property-wide on the chart and by room type
// in the table under it. `performance-screen.tsx` argues why nothing is stored
// as a ratio, why a per-type series is tabulated rather than charted, and why a
// figure with no denominator is a dash instead of a zero.
//
// The matrix's *Occupancy / ADR / RevPAR* row governs it — a row of its own,
// distinct from the revenue report's even where the two grant the same three
// roles — and the API refuses the route to anybody else. The console declines to
// offer the door as well, which is what stops a receptionist reaching a page
// that answers 403.
//
// A shell around one component, like every other route in this segment.
// Everything the screen does needs the browser: a session whose role decides
// whether the report is read at all, a cache the range and the property's day
// are keyed into, a figure the reader selects, and a chart measured against the
// element it is drawn in.

import { PerformanceScreen } from "@/features/reports";

export default function PerformanceReportPage() {
  return <PerformanceScreen />;
}
