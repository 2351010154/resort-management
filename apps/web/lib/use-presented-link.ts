"use client";

// Reading a mailed credential off the address, and taking it back off again.
//
// The two screens the confirmation email leads to both do exactly this, and they
// have to do it in exactly this order: read the link as soon as the browser has
// an address to read, before anything can navigate, and strip it immediately —
// not once the exchange has answered. A credential left in the address while a
// round trip is in flight is a credential in the history entry and in the
// address bar over somebody's shoulder.
//
// What is kept is the copy in memory, which is what the exchange spends. So a
// link that never reached the API is not lost by the stripping: it was not
// consumed either, and the message it came in still has it.
//
// **The credential is in the fragment, so only a browser can read it.**
// `booking.service.ts` mints `#stay=…` and `#invitation=…` rather than query
// parameters because a fragment is never put in a request line — no access log
// on the way to this page can record it. The cost is that it does not exist
// during a server render, which is why this reports whether it has looked yet
// rather than answering `null` before it has.

import { useEffect, useState } from "react";
import { addressWithoutLink, linkInFragment } from "./booking-links";

/**
 * The address as this page found it: whether it has been consulted, and what it
 * was carrying.
 *
 * The two are separate because "no credential" and "not yet looked" lead
 * somewhere different — the first is a guest who navigated here and is owed the
 * screen that says so, the second is every guest for the moment before hydration
 * and is owed nothing at all.
 */
export interface PresentedLink {
  /** False through any server render, and through the first client one. */
  readonly read: boolean;
  /** The credential the fragment carried, or `null` when it carried none. */
  readonly link: string | null;
}

const NOT_YET_READ: PresentedLink = { read: false, link: null };

/**
 * The credential this page was opened with, once, and never again from the URL.
 *
 * The value is kept in state that the stripping cannot disturb: the address
 * loses the fragment on the same tick it is read, and the exchange still needs
 * what was there. The update refuses to overwrite a reading that has already
 * happened, which is what makes a second run of this effect — React's
 * development double-invoke, a change of parameter — find the credential rather
 * than the empty address the first run left.
 */
export function usePresentedLink(param: string): PresentedLink {
  const [presented, setPresented] = useState<PresentedLink>(NOT_YET_READ);

  useEffect(() => {
    const hash = window.location.hash;

    // **The address is rewritten rather than navigated to**, and that is the
    // difference between removing the credential and mailing it somewhere else.
    // A router navigation fetches the route again, and a same-origin request
    // carries the address it was made from in its `Referer` — which at that
    // instant is still the URL holding the link. Rewriting touches no network
    // at all: Next reads the router's state back off the history entry, so a
    // later navigation and `useSearchParams` both see the shortened address.
    //
    // Replacing and not pushing, for the reason the whole hook exists: the
    // entry that carried the credential must not be one the back button can
    // return to.
    window.history.replaceState(
      null,
      "",
      addressWithoutLink(window.location, param),
    );

    setPresented((already) =>
      already.read
        ? already
        : { read: true, link: linkInFragment(hash, param) },
    );
  }, [param]);

  return presented;
}
