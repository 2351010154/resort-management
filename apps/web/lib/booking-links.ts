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
// **And a link is spent once, so arriving at a stay is one shared act rather
// than one per component.** Everything on the stay route reads through the
// cookie that exchange issues, and those components mount together;
// `arriveAtStay` is where the arrival is begun, and `whenArrived` is how the
// rest of the route waits for it instead of asking early and being refused.
//
// Every call resolves rather than throws, in `sign-in.ts`'s shape: each outcome
// is something a screen has a sentence for, and the API's own sentence is
// preferred over anything invented here — `booking.controller.ts` and
// `guest-attach.service.ts` write those refusals for the person who reads them,
// and only that side knows how long a link lives.

import { api, apiMessage } from "@/lib/api";
import type { PresentedLink } from "./use-presented-link";

/**
 * A stay as the API answers it, inferred from the client rather than written
 * out — the same move `stay-funnel.ts` makes for the funnel's own reads, and for
 * the same reason: the contract in `@mariva/shared` types both ends, so a field
 * that changes shape breaks the screens in the pull request that changed it.
 *
 * Inferred here rather than imported from the funnel because `lib/` is beneath
 * `features/` and may not reach back up into one.
 */
type OwnBooking = Awaited<ReturnType<typeof api.booking.readOwn>>;

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
 * A followed account link, settled — the stay, and whether this browser now
 * holds a session over the account the stay was attached to.
 *
 * Its own type rather than a field on `LinkOutcome`, because the other two
 * calls cannot answer it: a stay link issues no session at all, and an attach
 * is made by a browser that already had one.
 */
export type AccountOutcome =
  | {
      readonly ok: true;
      readonly stay: AttachedStay;
      readonly signedIn: boolean;
    }
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
 *
 * **`signedIn` travels beside the stay rather than inside it.** The stay is the
 * two names a page prints; whether a session came back is a fact about this
 * browser, and the screen needs it to decide whether it may carry the guest on
 * to a page that only a session opens.
 */
export async function createAccountFrom(presented: {
  readonly link: string;
  readonly password?: string;
}): Promise<AccountOutcome> {
  try {
    const { signedIn, ...stay } = await api.booking.createAccountFromLink(
      presented.password === undefined
        ? { link: presented.link }
        : { link: presented.link, password: presented.password },
    );

    return { ok: true, stay, signedIn };
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
  readonly stay?: OwnBooking;
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
 * The arrivals this document has begun, one per stay, joined by everyone who
 * asks about the same one.
 *
 * **The mailed credential is good once, and more than one component needs the
 * cookie it buys.** The screen renders the booking and the cancellation panel
 * asks what calling it off would cost, and a link spent twice would be a link
 * found gone the second time — so the exchange has to be one shared act rather
 * than one per component, whatever order the two components start in. Without
 * something shared, the panel's question could go out before the exchange has
 * issued the cookie that answers it, refused for want of a credential. A
 * refused quote means the panel draws nothing, so the guest who most needs the
 * cancel affordance — the one opening the confirmation email on a second
 * device — is the one who would never see it. Waiting on the arrival is that
 * fixed by ordering rather than by guessing how long a network takes.
 *
 * Keyed by the reference, because a component survives a change of route
 * parameter and must never be answered about the booking before last. At module
 * scope rather than in a ref, because the components joining are siblings and
 * have nowhere else to meet.
 *
 * It lasts as long as the document: a settled arrival is remembered for the rest
 * of the visit, and nothing evicts it, which is why {@link forgetArrival} exists
 * for the one moment its answer stops being true.
 */
const arrivals = new Map<string, Arrival>();

interface Arrival {
  /** The stay this arrival came for, read once and handed to every asker. */
  readonly answer: Promise<StayArrival>;
  /**
   * Resolved once the credential has been dealt with, which is the thing a
   * reader of the arrival is actually waiting for: after it, the booking cookie
   * is as good as this arrival is going to make it.
   */
  readonly admitted: Promise<void>;
  /** Both of the above, settled — by whoever holds the link, and only once. */
  readonly open: (answer: Promise<StayArrival>) => void;
  readonly admit: () => void;
  /** Whether the credential has been handed over. Not whether it existed. */
  started: boolean;
}

/** The arrival for this stay, announced if this is the first anyone has heard
 *  of it. Announcing is not starting: an arrival exists as something to wait
 *  for from the moment a screen says it is coming. */
function arrivalFor(reference: string): Arrival {
  const waiting = arrivals.get(reference);

  if (waiting !== undefined) {
    return waiting;
  }

  let open!: (answer: Promise<StayArrival>) => void;
  let admit!: () => void;

  const answer = new Promise<StayArrival>((resolve) => {
    open = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    admit = resolve;
  });

  const arrival: Arrival = { answer, admitted, open, admit, started: false };

  arrivals.set(reference, arrival);

  return arrival;
}

/**
 * This stay, said to be coming, by whoever knows a screen is about to open it.
 *
 * Announcing is not starting: it spends nothing, asks nothing, and reads no
 * address. What it makes is something for the rest of the route to wait on —
 * {@link whenArrived} answers at once for a stay nobody has announced, which is
 * right for a component asking about a booking no screen is opening, and wrong
 * for one asking a beat before the screen beside it has said anything.
 *
 * Idempotent, and meant to be called on every render for that reason: the
 * second announcement of a stay finds the first and is the same arrival.
 */
export function announceArrival(reference: string): void {
  arrivalFor(reference);
}

/**
 * Arriving at a stay, once, however many times this is called.
 *
 * Called by the screen that holds the credential, on every pass of its effect:
 * the first announces the arrival, before the address has been consulted and so
 * before there is a link to spend, and the pass after that hands the credential
 * over and starts it. A second run of the same effect — React's development
 * double-invoke, a re-render while the exchange is in flight — finds the arrival
 * already begun and joins it, which is what keeps the single-use link from being
 * spent twice and found gone the second time.
 *
 * **A guest who presented no link is admitted straight away**, rather than at
 * the end of a read they are already signed in for. There is no exchange coming,
 * so there is nothing for a reader of this arrival to wait behind, and making
 * one wait would put two requests in a queue that today go out together.
 */
export function arriveAtStay(
  reference: string,
  presented: PresentedLink,
): Promise<StayArrival> {
  const arrival = arrivalFor(reference);

  if (presented.read && !arrival.started) {
    arrival.started = true;
    arrival.open(openStay(reference, presented.link));

    if (presented.link === null) {
      arrival.admit();
    } else {
      void arrival.answer.then(arrival.admit);
    }
  }

  return arrival.answer;
}

/**
 * The wait a component takes on before asking anything else about this stay.
 *
 * For a reader rather than a driver: it spends no credential and starts no
 * arrival, so a component that asks about a stay nobody is opening is not left
 * waiting for something that is never going to happen — it is answered at once
 * and carries on exactly as it did before any of this existed.
 */
export function whenArrived(reference: string): Promise<void> {
  return arrivals.get(reference)?.admitted ?? Promise.resolve();
}

/**
 * The arrival forgotten, for a stay that is no longer what it said.
 *
 * An arrival is remembered so it is not made twice, which is right up to the
 * moment the booking moves — a cancellation is the one act on this route that
 * changes the very row the arrival answered with. Whoever moved it says so here,
 * and the next arrival reads the stay again instead of repeating what was true
 * before the press.
 */
export function forgetArrival(reference: string): void {
  arrivals.delete(reference);
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
