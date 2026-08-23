/* The Reports family, in one import site — `FR-RPT-02` and `FR-RPT-03`.
 *
 * Four surfaces come out of it and all four are screens: the menu `screens.md`
 * calls "a short menu of named reports", and the three pages it lists — revenue,
 * room status, and occupancy/ADR/RevPAR, which share one page because they share
 * one range and one pair of counts. There is no bar and no provider here; the
 * palette entries the family
 * offers are registered by {@link ReportsScreen} itself, which is how
 * `app/(app)/layout.tsx` says a screen declares what it offers.
 *
 * Worth knowing before reaching for it: every module here except `reports.ts` is
 * a client component, and a barrel is resolved as a whole. Anything wanting only
 * the pure module — the matrix predicates, the bucket labels, the chart series —
 * reaches `./reports` by its own path.
 */

export { PerformanceScreen } from "./performance-screen";
export { RangePicker } from "./range-picker";
export {
  PerformanceChart,
  RevenueChart,
  RoomStatusChart,
} from "./report-charts";
export {
  usePerformanceReport,
  useRevenueReport,
  useRoomStatusReport,
} from "./report-queries";
export {
  ABSENT_FIGURE,
  BUCKET_LABELS,
  boundaryNote,
  bucketLabel,
  DEFAULT_PERFORMANCE_FIGURE,
  DEFAULT_RANGE_FIELDS,
  formatFigure,
  formatOccupancy,
  formatRatioVnd,
  mayReadPerformance,
  mayReadRevenue,
  mayReadRoomStatus,
  PERFORMANCE_FIGURE_LABELS,
  PERFORMANCE_FIGURES,
  type PerformanceBar,
  type PerformanceBucketRow,
  type PerformanceFigure,
  type PerformanceFigures,
  type PerformanceQuery,
  type PerformanceReport,
  type PerformanceTypeRow,
  performanceSeries,
  type RangeFields,
  type RangeQuestion,
  REPORT_PAGES,
  REVENUE_SERIES_LABELS,
  type ReportPage,
  type RevenueBar,
  type RevenueBucketRow,
  type RevenueQuery,
  type RevenueReport,
  ROOM_STATUS_LABELS,
  type RoomStatusBar,
  type RoomStatusReport,
  type RoomStatusTypeRow,
  rangeQuestion,
  reportsFor,
  revenueSeries,
  roomStatusSeries,
} from "./reports";
export { ReportsScreen } from "./reports-screen";
export { RevenueScreen } from "./revenue-screen";
export { RoomStatusScreen } from "./room-status-screen";
