// What the funnel shows while a step is still arriving.
//
// A `loading.tsx` is a Suspense boundary Next puts around everything below this
// segment, so this one file covers every screen in the group: the four auth
// screens, `/booking`, the four steps after a room choice, the account pages.
// Each of those routes is an async server component — it reads its search
// parameters, or its reference, before it can render — and the fallback is what
// the browser sees while that read is in flight. Without one, the router holds
// the screen the guest is leaving on-screen and unresponsive until the next one
// is ready, which is the pause this exists to fill.
//
// It is deliberately one file at the group root rather than one beside each
// route. The curtain is the same curtain wherever the guest is going, and a
// per-route fallback would be an invitation to make it different — which is the
// opposite of what a seam is for.

import { Threshold } from "@/features/threshold/threshold";

export default function BookingLoading() {
  return <Threshold />;
}
