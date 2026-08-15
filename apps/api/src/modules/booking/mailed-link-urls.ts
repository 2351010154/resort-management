// Where a mailed link points — the public site, and never this API.
//
// Three addresses and one rule. The guest lands on a page rather than on a
// redirect a service composed, because what happens next differs: one link hands
// the browser a credential and shows the stay, another asks whether the guest
// would like a password, and the third carries nothing at all because the stay
// already has an owner who reaches it by signing in.
//
// **The credential rides in the fragment, and that is the whole reason for the
// `#`.** A query string is part of the request line, so every server between the
// guest and the page writes it down — the web tier's own access log first, and
// whatever proxy, prefetcher or corporate mail scanner opened the message before
// the guest did. A fragment is never transmitted: the browser keeps it, and the
// page reads it off its own address. What a stay link opens is a booking for
// seven days past checkout, so the difference is not academic.
//
// It is still in the address bar and in the history entry, which is why
// `use-presented-link.ts` takes it back off the moment it has been read.
//
// **Functions of the origin rather than methods on a service**, because two
// senders compose the account link now: the confirmation, when the address had
// no account, and the desk, when a guest has lost the message it was in. Which
// page a mailed link lands on and which fragment parameter carries it is one
// decision, and a second copy of it would be the copy that stayed behind the day
// the route moved.

/**
 * The stay's own page, carrying nothing — where a booking that already has an
 * owner is pointed, because the way into it is the account rather than a
 * credential in a message.
 */
export function bookingPageUrl(webOrigin: string, reference: string): string {
  return `${webOrigin}/bookings/${encodeURIComponent(reference)}`;
}

/** The stay's page with the credential that re-opens it in a browser that no
 *  longer holds one. */
export function stayLinkUrl(
  webOrigin: string,
  reference: string,
  link: string,
): string {
  return `${bookingPageUrl(webOrigin, reference)}#stay=${encodeURIComponent(link)}`;
}

/** The page that offers the account, with the link that creates it. */
export function accountLinkUrl(
  webOrigin: string,
  reference: string,
  link: string,
): string {
  return `${bookingPageUrl(webOrigin, reference)}/account#invitation=${encodeURIComponent(
    link,
  )}`;
}
