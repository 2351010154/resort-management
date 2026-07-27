"use client";

// Whether a media query currently matches, watched rather than read once.
//
// The funnel needs this for one decision the stylesheet cannot make alone: the
// date grid is either inline under the search band or inside a bottom sheet, and
// rendering both and hiding one with `display: none` mounts two calendars. Two
// React Aria calendars announce their own visible month on mount, so the guest
// hears the month twice — and the second grid is dead weight in the tree.
//
// It *watches* the query rather than reading it at mount. Act 4 learned that the
// hard way with `prefers-reduced-motion`: a preference read once is a preference
// that ignores the guest changing it, and a viewport read once is a layout that is
// wrong the moment a phone is turned sideways.
//
// The initial value is the narrow branch, deliberately. A server render has no
// viewport, so the first client paint has to agree with the server or React
// complains — and being briefly wrong in the direction of "one month, in a sheet"
// costs a phone nothing and a desktop one frame.

import { useEffect, useState } from "react";

export function useViewportMatch(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * The one breakpoint the funnel branches on in JS.
 *
 * 45rem is where two 7-column grids fit side by side at the 44px cell floor, and
 * it is the same number the stylesheets use. Written here so the two cannot
 * disagree about which side of it a layout is on.
 */
export const WIDE_VIEWPORT = "(min-width: 45rem)";
