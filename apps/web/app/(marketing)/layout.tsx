// Everything the arrival needs and the booking funnel must never load. Lenis is
// the single smoothing layer the acts' ScrollTrigger scrubs are tuned against,
// and the concierge nav reads the act the tracker resolves — all three only mean
// anything on a scrollytelling page, and all three reach three / gsap / lenis.
//
// Keeping them in this route group rather than the root layout is what lets a
// sibling group (booking) render on the same origin with a plain bundle.

import { LenisScrollProvider } from "@/features/arrival/lib/lenis-scroll-provider";
import { ConciergeNav } from "@/features/arrival/components/navigation/concierge-nav";
import { ActiveActTracker } from "@/features/arrival/components/navigation/active-act-tracker";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LenisScrollProvider>
      <ConciergeNav />
      <ActiveActTracker />
      {children}
    </LenisScrollProvider>
  );
}
