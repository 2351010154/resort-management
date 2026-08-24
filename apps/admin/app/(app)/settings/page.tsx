// The settings route — staff access on one side, the property's configuration on
// the other.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
//
// A static route wins over the catch-all in `app/(app)/[...unbuilt]`, so this
// file is also what stops Settings answering as an unbuilt screen.
//
// Everything the screen does needs the browser: a cache the configuration row is
// shared through, a session token held in memory that the staff-account routes
// are reached with, focus moving between two panels. The screen is a client
// component and this file is the boundary between the two.

import { SettingsScreen } from "@/features/settings";

export default function SettingsPage() {
  return <SettingsScreen />;
}
