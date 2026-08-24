// The housekeeping route — the floors as a grid, and the landing the
// `HOUSEKEEPING` role signs in to.
//
// Its arrival matters beyond this family. `lib/auth/landing-route.ts` sends that
// role here, `features/shell/nav-inventory.ts` offers it this one entry, and
// until this file existed both led to the catch-all beside it: a housekeeper's
// whole console was a 404. It also unblocks the front desk — the check-in guard
// refuses a room that is not clean and tells the operator to ask housekeeping to
// release it, which nothing in the console could do.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from the
// inventory for the whole set at once.
//
// The screen is imported by its own path rather than through
// `features/housekeeping`. That barrel is read by the arrivals queue for the
// board's hooks, and its header says why the grid is not in it.

import { HousekeepingScreen } from "@/features/housekeeping/housekeeping-screen";

export default function HousekeepingPage() {
  return <HousekeepingScreen />;
}
