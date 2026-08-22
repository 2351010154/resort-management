// The room-status report — `FR-RPT-02`, the operational half.
//
// Where every room stands right now, by condition and by type. It is a live
// count over `room_condition` and not a snapshot read: `docs/screens.md` is
// explicit that a housekeeping status is where a room stands now and is never a
// fact about a night that has ended, so there is no frozen row to report from
// and no range to cut. `room-status-screen.tsx` carries that argument and the
// page carries the instant the rooms were counted.
//
// The matrix's *Operational reports* row governs it — the desk, housekeeping and
// management — which is a different row from the revenue page beside it. That is
// why a receptionist opening Reports finds exactly this one.
//
// A shell around one component. The screen needs the browser for the session,
// the cache and the chart.

import { RoomStatusScreen } from "@/features/reports";

export default function RoomStatusReportPage() {
  return <RoomStatusScreen />;
}
