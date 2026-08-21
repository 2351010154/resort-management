/* The desk's day, in one import site.
 *
 * Three surfaces come out of this family and they are mounted in three
 * different places, which is `screens.md`'s arrangement rather than this
 * barrel's: {@link ShiftSurfaceProvider}, {@link ShiftBar} and
 * {@link ShiftCommands} belong to the `(app)` shell, and {@link ShiftsScreen} is
 * the history behind `/shifts`. A screen that rendered the bar or registered the
 * commands itself would be a second drawer indicator on one console.
 *
 * Worth knowing before reaching for it: every module here except `shift-day.ts`
 * is a client component, and a barrel is resolved as a whole. The checkout
 * sequence reaches `./shift-day` and `./drawer-forms` by their own paths for
 * that reason — it needs the refusal's code and the open-drawer form, and has no
 * use for a history screen in the departures bundle.
 */

export {
  CloseDrawerForm,
  ClosedDrawer,
  DrawerFigures,
  OpenDrawerForm,
  PendingItems,
} from "./drawer-forms";
export { ShiftBar } from "./shift-bar";
export {
  type CloseDrawerFields,
  cashDrawerRefusal,
  closeDrawerAttempt,
  DEFAULT_HISTORY_FIELDS,
  expectedInDrawer,
  type HistoryFields,
  historyQuestion,
  isOpen,
  mayPickOperator,
  mayReadDrawers,
  mayWorkADrawer,
  type OpenDrawerFields,
  type Operator,
  openDrawerAttempt,
  operatorChoices,
  operatorsIn,
  type PendingItem,
  parseDrawerAmount,
  pendingItemAttempt,
  type Shift,
  type ShiftHistoryQuery,
  type ShiftPage,
  VARIANCE_LABELS,
  type VarianceReading,
  type VarianceTone,
  varianceReading,
} from "./shift-day";
export { type DrawerIntent, ShiftPanel } from "./shift-panel";
export {
  useCloseDrawer,
  useCurrentShift,
  useOpenDrawer,
  usePendingItems,
  useRaisePendingItem,
  useResolvePendingItem,
  useShiftHistory,
} from "./shift-queries";
export {
  ShiftCommands,
  ShiftSurfaceProvider,
  useShiftSurface,
} from "./shift-surface";
export { ShiftsScreen } from "./shifts-screen";
