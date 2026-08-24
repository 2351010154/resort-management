// The dashboard route — the landing for the receptionist, the manager and the
// administrator (`lib/auth/landing-route.ts`). It is the first screen family to
// land under `(app)`, which means the sign-in path now ends on a screen instead
// of on the 404 it honestly was.
//
// The page is a shell around one component and holds nothing else: the
// authenticated layout above it already mounts the session guard, the query
// cache, the rail and the palette, so what is left for a route file is naming
// the screen it draws. Everything the dashboard does needs the browser — a
// cache, a session token held in memory — so the screen itself is a client
// component and this file is the boundary between the two.

import { DashboardScreen } from "@/features/dashboard";

export default function DashboardPage() {
  return <DashboardScreen />;
}
