// The two links a confirmation email carries, and the account they lead to.
//
// **The credential travels in the body and never in a path or a query.**
// `contract/booking.ts` takes both links that way deliberately: a URL is written
// to an access log, kept in the browser's history and sent on in a `Referer`,
// and a body is none of those. The page reads the link off its own address,
// posts it here once, and `use-presented-link.ts` strips the copy the address
// was carrying — `addressWithoutLink` is that half.
//
// **And the address carries it in the fragment.** A query string is part of the
// request line, so the web tier logs it before any of this code runs; a fragment
// is the one part of a URL a browser keeps to itself. `booking.service.ts` mints
// both links that way, `linkInFragment` is where they are read, and neither can
// be read on the server at all — which is why both screens are clients.
//
// **Nothing here asks whether an address has an account, and nothing it answers
// with could say.** That branch belongs to the confirmation email, which reaches
// the address being asked about and nobody else; a page making it would be an
// enumeration oracle, because a hold is unauthenticated and anyone can take one
// naming a victim's address. What a redemption answers is a booking id and a
// reference, and both are facts about the stay the caller already proved.
//
// Every call resolves rather than throws, in `sign-in.ts`'s shape: each outcome
// is something a screen has a sentence for, and the API's own sentence is
// preferred over anything invented here — `booking.controller.ts` and
// `guest-attach.service.ts` write those refusals for the person who reads them,
// and only that side knows how long a link lives.

import { api, apiMessage } from "@/lib/api";
import type { HeldStay } from "./stay-funnel";

/**
 * The fragment parameters the API mints its two links with.
 *
 * `booking.service.ts` composes both URLs — `/bookings/<reference>#stay=…` and
 * `/bookings/<reference>/account#invitation=…` — so these names are that file's
 * and not this one's. A page looking for a different one would find nothing and
 * quietly show a guest the door.
 */
export const STAY_LINK_PARAM = "stay";
export const ACCOUNT_LINK_PARAM = "invitation";

/**
 * The stay a guest arrived at the log-in screen to claim, and the same stay on
 * the way back from a provider's round trip.
 *
 * A booking id and never a credential: it says which stay the attach is about,
 * and the attach itself is refused unless the booking cookie on the request
 * names that same stay — `guest-attach.controller.ts` compares the two. So this
 * is safe in an address in a way the links above are not.
 *
 * Two names because they mean two different moments. `booking` is *after you
 * sign in*, which is the press that follows the form; `attach` is *now*, which
 * is a browser returning from Google already carrying its session.
 */
export const ATTACHING_BOOKING_PARAM = "booking";
export const ATTACH_ON_ARRIVAL_PARAM = "attach";

/** A stay named both ways a page needs it — the API's `redeemedLinkSchema`. */
export interface AttachedStay {
  readonly bookingId: string;
  readonly reference: string;
}

export type LinkOutcome =
  | { readonly ok: true; readonly stay: AttachedStay }
  | { readonly ok: false; readonly message: string };

/**
 * The sentences this app writes itself, for the failures that carry none.
 *
 * Reached by what never got to a handler — a network that was not there, an API
 * that is not up, a refusal whose body arrived empty. Copy per
 * `design-foundations.md` §6: plain, blameless, and quoting no figure the
 * property owns.
 */
const MESSAGES = {
  stayLink:
    "That link could not be opened just now. Check your connection and try again.",
  account:
    "Your account could not be created just now. Check your connection and try again.",
  attach:
    "This stay could not be added to your account just now. Check your connection and try again.",
  stay: "That booking could not be read just now. Check your connection and try again.",
} as const;

/**
 * The confirmation email's stay link, spent for the cookie it re-issues.
 *
 * Good once, and that is the whole of why the refusal below is ordinary rather
 * than exceptional: a mailbox is copied, forwarded and left open, so the row
 * that says the link has not been followed is consumed by the following.
 */
export async function exchangeStayLink(link: string): Promise<LinkOutcome> {
  try {
    return { ok: true, stay: await api.booking.redeemStayLink({ link }) };
  } catch (error) {
    return { ok: false, message: apiMessage(error, MESSAGES.stayLink) };
  }
}

/**
 * The other link in the same envelope — the account it offers, created.
 *
 * **The password is optional and is omitted rather than sent empty.** The mail
 * proved the address, so the account exists verified either way and the stay is
 * attached before any credential is written; a guest who sets none signs in by
 * resetting to the address that has already been verified. An empty string sent
 * as a password would be a credential the realm's floor refuses, which would
 * turn a guest declining one into a refusal.
 *
 * No address is sent and none can be. `guest-attach.service.ts` reads it off the
 * booking, so the account is made for the address the message went to — a caller
 * naming one would be naming which account this creates.
 */
export async function createAccountFrom(presented: {
  readonly link: string;
  readonly password?: string;
}): Promise<LinkOutcome> {
  try {
    return {
      ok: true,
      stay: await api.booking.createAccountFromLink(
        presented.password === undefined
          ? { link: presented.link }
          : { link: presented.link, password: presented.password },
      ),
    };
  } catch (error) {
    return { ok: false, message: apiMessage(error, MESSAGES.account) };
  }
}

/**
 * The registered address's path — signed in, and holding the stay.
 *
 * No link and no mail: the session proves the account, the booking cookie proves
 * the stay, and both on one request is the trigger. The id below says which stay
 * is meant and proves nothing on its own — the API refuses it unless the cookie
 * names the same booking.
 */
export async function attachStay(bookingId: string): Promise<LinkOutcome> {
  try {
    const attached = await api.booking.attachToAccount({ bookingId });

    return {
      ok: true,
      stay: { bookingId: attached.id, reference: attached.reference },
    };
  } catch (error) {
    return { ok: false, message: apiMessage(error, MESSAGES.attach) };
  }
}

/** What arriving at a stay came to — one of the two, never both. */
export interface StayArrival {
  readonly stay?: HeldStay;
  readonly refusal?: string;
}

/**
 * Opening a stay, with or without a link to spend on the way in.
 *
 * **A spent link is a normal arrival and not a failure.** The credential is good
 * once, so a refresh, a second press from the mailbox, or a mail client that
 * followed it first all land here with nothing left to exchange — and the cookie
 * the first press set still opens the booking. So the exchange's refusal is held
 * back and the read is what decides: the guest sees their stay, and hears about
 * the link only when the stay cannot be read at all.
 *
 * When neither works, the link's own sentence is preferred over the read's. It
 * is the one that names what happened — the link was already used, or has run
 * out — where the read can only say the booking is not this caller's, which is
 * the same 404 the API answers for a stay that does not exist.
 */
export async function openStay(
  reference: string,
  presented: string | null,
): Promise<StayArrival> {
  let refused: string | undefined;

  if (presented !== null) {
    const exchanged = await exchangeStayLink(presented);

    if (!exchanged.ok) {
      refused = exchanged.message;
    }
  }

  try {
    return { stay: await api.booking.readOwn({ reference }) };
  } catch (error) {
    return { refusal: refused ?? apiMessage(error, MESSAGES.stay) };
  }
}

/**
 * Whether this stay is still filed under nobody.
 *
 * **It reads the booking's own owner and could not read anything else.** The
 * argument in the file header applies to the offer this predicate gates: a
 * screen that showed one thing to an address with an account and another to an
 * address without would answer "does this person stay here?" to anyone who
 * created a hold naming them. The column below says whether *this* stay has been
 * claimed, which is a fact about a booking the caller has already proved, and
 * the parameter is narrowed to it so no address can reach this decision.
 */
export function isUnattached(stay: {
  readonly userId: string | null;
}): boolean {
  return stay.userId === null;
}

/**
 * The credential a mailed link left in the address, read off the fragment.
 *
 * `null` for a page nobody arrived at from a message — a guest who navigated
 * here, or one who came back to an address the credential has already been taken
 * off. Neither is an error, and both are the same answer.
 *
 * Parsed as form encoding rather than split on `=`, so it agrees with what
 * {@link addressWithoutLink} writes back and so a fragment carrying anything
 * else beside the credential still yields the credential.
 */
export function linkInFragment(hash: string, param: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get(param);
}

/**
 * The address a page keeps once the credential has been read off it.
 *
 * Every other parameter survives, in the fragment and in the query alike — the
 * confirmation's own `?booked` is one, and a page that dropped it would forget
 * that the guest has just paid.
 *
 * The fragment is where the credential arrives and the query is not, but this
 * clears the named parameter from both: a link mailed by an older release, or
 * pasted by a guest out of one message into another address bar, must not be
 * left sitting in a history entry because it came in the wrong half of the URL.
 */
export function addressWithoutLink(
  location: {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  },
  param: string,
): string {
  const query = without(location.search.replace(/^\?/, ""), param);
  const fragment = without(location.hash.replace(/^#/, ""), param);

  return `${location.pathname}${query === "" ? "" : `?${query}`}${
    fragment === "" ? "" : `#${fragment}`
  }`;
}

/** One parameter gone, and everything that shared the encoding kept. */
function without(encoded: string, param: string): string {
  const params = new URLSearchParams(encoded);

  params.delete(param);

  return params.toString();
}
