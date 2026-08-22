// The revenue report — `FR-RPT-02`, the money half.
//
// What the property earned over a stretch of closed trading days: net room
// charges and everything else it sold, read from the night audit's frozen
// figures, with §4's cancellation and no-show charges summed from the folio
// ledger beside them. `revenue-screen.tsx` argues why one page may draw from two
// tables and what the stamp under the heading promises about it.
//
// The matrix's *Revenue and financial reports* row governs it — the accountant
// and management — and the API refuses the route to anybody else. The console
// declines to offer the door as well, which is what stops a receptionist
// reaching a page that answers 403.
//
// A shell around one component, like every other route in this segment.
// Everything the screen does needs the browser: a session whose role decides
// whether the report is read at all, a cache the range and the property's day
// are keyed into, and a chart measured against the element it is drawn in.

import { RevenueScreen } from "@/features/reports";

export default function RevenueReportPage() {
  return <RevenueScreen />;
}
