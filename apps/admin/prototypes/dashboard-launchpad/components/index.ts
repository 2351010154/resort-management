/** The launchpad prototype's parts. Nothing outside this folder imports them,
 *  and nothing should: half of them draw features the product has not decided
 *  to build, and the ones that survive belong in `components/ui/` or
 *  `features/dashboard/` once a real screen claims them.
 *
 *  See `../ASSETS.md` for what this prototype is and what is wrong with it. */

export { default as ConciergeToolButton } from "./concierge-tool-button";
export type { ConciergeToolButtonProps } from "./concierge-tool-button";

export { default as DataTable } from "./data-table";
export type { DataTableColumn, DataTableProps } from "./data-table";

export { default as HandoffNote } from "./handoff-note";
export type { HandoffNoteProps } from "./handoff-note";

export { default as HousekeepingPanel } from "./housekeeping-panel";
export type {
  HousekeepingItem,
  HousekeepingPanelProps,
} from "./housekeeping-panel";

export { default as PriorityTask } from "./priority-task";
export type { PriorityTaskProps } from "./priority-task";

export { default as StatCard } from "./stat-card";
export type { StatCardProps } from "./stat-card";
