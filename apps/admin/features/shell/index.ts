/* The authenticated shell, in one import site.
 *
 * The `(app)` layout mounts `AppNav` and `NavShortcuts`, and nothing else
 * should: a screen rendering either has given itself a second rail or a second
 * set of `Go to` rows the first one's chords already answer.
 *
 * The inventory is exported because it is the console's map. A screen that
 * needs to say where a family lives should read it here rather than typing the
 * path again — the routes move before the families do, and one list is what
 * makes that a single edit.
 */

export { AppNav } from "./app-nav";
export {
  isActivePath,
  NAV_ITEMS,
  NAV_PREFIX,
  NAV_SEQUENCE_TIMEOUT_MS,
  type NavItem as NavItemData,
  navCommandId,
  navItemsFor,
  navShortcut,
} from "./nav-inventory";
export { NavItem, type NavItemProps } from "./nav-item";
export { NavShortcuts } from "./nav-shortcuts";
export { UserMenu } from "./user-menu";
