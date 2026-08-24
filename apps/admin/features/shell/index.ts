/* The authenticated shell, in one import site.
 *
 * The `(app)` layout mounts `AppNav` and `NavCommands`, and nothing else
 * should: a screen rendering either has given itself a second rail or a second
 * set of `Go to` rows the first one already offers.
 *
 * The inventory is exported because it is the console's map. A screen that
 * needs to say where a family lives should read it here rather than typing the
 * path again — the routes move before the families do, and one list is what
 * makes that a single edit.
 */

export { AppNav } from "./app-nav";
export {
  isActivePath,
  NAV_GROUPS,
  NAV_ITEMS,
  type NavGroup,
  type NavGroupId,
  type NavItem as NavItemData,
  navCommandId,
  navItemsFor,
} from "./nav-inventory";
export { NavItem, type NavItemProps } from "./nav-item";
export { NavCommands } from "./nav-commands";
export { UserMenu } from "./user-menu";
