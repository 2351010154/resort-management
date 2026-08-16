"use client";

/* What every screen in the authenticated realm is given, besides its session.
 *
 * A client component under a server layout, and the boundary is drawn exactly
 * here: `layout.tsx` stays a server component and this file is the one thing in
 * it that must run in the browser, so a screen that is otherwise static is not
 * dragged across the boundary by the cache above it.
 *
 * The cache is created in `useState` rather than at module scope. A module-level
 * client would be shared by every request a Next server process handles — one
 * operator's cached arrivals list served to whoever rendered next — and one
 * created in the component body without `useState` would be thrown away and
 * rebuilt on every re-render, which is a cache that never hits. The initialiser
 * form is deliberate too: `useState(createQueryClient())` would construct a
 * client on every render and discard all but the first.
 *
 * The toaster is mounted here rather than in the root layout because this is
 * where the things that raise toasts live: `lib/query-client.ts` reports every
 * failed read and every failed write through it, and the login screen under
 * `(auth)` reports its own refusals inline where the operator is already
 * looking.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";
import { useState } from "react";

import { Toaster } from "@/components/ui";
import { createQueryClient } from "@/lib/query-client";

import { QueryDevtools } from "./query-devtools";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Bottom right, out of the way of the navigation rail on the left and
       * of the row a table's actions sit in. */}
      <Toaster position="bottom-right" />
      {/* Props are left at their defaults — closed, bottom left — so the
       * production stand-in for this component can be the component that
       * renders nothing and takes nothing. */}
      <QueryDevtools />
    </QueryClientProvider>
  );
}
