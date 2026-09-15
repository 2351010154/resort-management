import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_LINK_PARAM,
  addressWithoutLink,
  announceArrival,
  arriveAtStay,
  attachStay,
  createAccountFrom,
  exchangeStayLink,
  forgetArrival,
  isUnattached,
  linkInFragment,
  openStay,
  STAY_LINK_PARAM,
  whenArrived,
} from "./booking-links";

const STAY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const REFERENCE = "MRV4K2QX";

/** A second booking, for the stay a guest moves on to. */
const OTHER_REFERENCE = "MRV7T1ZP";

/**
 * The credential as the API mints it — opaque, signed, and the one thing on this
 * page that must never reach a URL, a log or the DOM.
 */
const LINK = "eyJ2IjoxfQ.c2lnbmF0dXJl";

/** A booking on the wire, in the shape `bookingSchema` puts it there. */
const BOOKING = {
  id: STAY,
  reference: REFERENCE,
  userId: "guest-account",
  contactEmail: "mai@example.com",
  contactName: "Mai Tran",
  state: "CONFIRMED",
  cancellationReason: null,
  roomType: "DELUXE",
  checkIn: "2026-08-20",
  checkOut: "2026-08-22",
  plan: "STANDARD",
  adults: 2,
  childAges: [],
  stayTotalGross: "4200000",
  holdExpiresAt: null,
} as const;

/** One answer per route, keyed on the path the real client asks at. */
type Answers = Readonly<Record<string, { status: number; body: unknown }>>;

/**
 * A refusal in the shape the API puts one on the wire.
 *
 * The whole envelope and not just the sentence: the transport reads its own
 * fields back and falls to the status' generic wording — "Unauthorized" — for a
 * body it does not recognise, so a test that stubbed a bare `{ message }` would
 * assert that the handler's words survive while proving the opposite.
 */
const refusal = (status: number, code: string, message: string) => ({
  status,
  body: { defined: false, code, status, message, data: {} },
});

/** The requests the real client built, caught on their way out. */
function serving(answers: Answers): Request[] {
  const sent: Request[] = [];

  vi.stubGlobal("fetch", async (request: Request) => {
    sent.push(request);

    const answer = answers[new URL(request.url).pathname] ?? {
      status: 404,
      body: { message: "no such route in this test" },
    };

    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  });

  return sent;
}

const REDEMPTION = "/bookings/stay-links/redemption";
const ACCOUNT = "/bookings/account-links/redemption";
const READ = `/bookings/mine/${REFERENCE}`;
const OTHER_READ = `/bookings/mine/${OTHER_REFERENCE}`;
const ATTACHMENT = `/bookings/${STAY}/attachment`;

/** Where each caught request went. */
const paths = (sent: readonly Request[]) =>
  sent.map((request) => new URL(request.url).pathname);

const redeemed = {
  status: 200,
  body: { bookingId: STAY, reference: REFERENCE },
};

/**
 * The account link's answer — the same two names, and the one thing the stay
 * link never says: this browser came away holding a session.
 */
const created = {
  status: 201,
  body: { bookingId: STAY, reference: REFERENCE, signedIn: true },
};

/** The same redemption on the rarer path, where the address already had an
 *  account and only a sign-in speaks for it. */
const attachedWithoutSession = {
  status: 201,
  body: { bookingId: STAY, reference: REFERENCE, signedIn: false },
};

/** What the API says about a link that is gone, in its own words. */
const SPENT =
  "This link has already been used or has expired. Ask for a new one from your booking.";

const spent = refusal(401, "UNAUTHORIZED", SPENT);

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The one property of these calls that is a security requirement rather than a
 * shape: a URL is written to an access log, kept in the browser's history and
 * sent on in a `Referer`, and a body is none of those. `contract/booking.ts`
 * takes both mailed credentials in the body for exactly that reason, so a client
 * that put one in a path or a query would be correct at the call site and wrong
 * on the wire — which is a thing only a test at the wire can see.
 */
describe("where the mailed credential travels", () => {
  it("posts the stay link in the body and never in the address", async () => {
    const sent = serving({ [REDEMPTION]: redeemed });

    await exchangeStayLink(LINK);

    const request = sent[0]!;

    expect(new URL(request.url).pathname).toBe(REDEMPTION);
    expect(request.url).not.toContain(LINK);
    expect(request.headers.get("content-type")).toMatch(/\/json\b/);
    expect(await request.json()).toEqual({ link: LINK });
  });

  it("posts the account link the same way", async () => {
    const sent = serving({ [ACCOUNT]: created });

    await createAccountFrom({ link: LINK, password: "a longer secret" });

    const request = sent[0]!;

    expect(new URL(request.url).pathname).toBe(ACCOUNT);
    expect(request.url).not.toContain(LINK);
    expect(await request.json()).toEqual({
      link: LINK,
      password: "a longer secret",
    });
  });
});

describe("exchanging the stay link", () => {
  it("answers with the stay the link named", async () => {
    serving({ [REDEMPTION]: redeemed });

    expect(await exchangeStayLink(LINK)).toEqual({
      ok: true,
      stay: { bookingId: STAY, reference: REFERENCE },
    });
  });

  // A link is good once, so this is an ordinary Tuesday rather than a fault: a
  // refresh, a second press from the mailbox, or a mail client that followed it
  // first all arrive here. It has to come back as a sentence a screen can render.
  it("resolves a spent link into the API's own sentence rather than throwing", async () => {
    serving({ [REDEMPTION]: spent });

    const outcome = await exchangeStayLink(LINK);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toBe(SPENT);
  });

  it("says something plain when nothing reached a handler at all", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("");
    });

    const outcome = await exchangeStayLink(LINK);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("try again");
  });
});

/**
 * The arrival, which is the whole reason a spent link is not an error state.
 *
 * The first press set the cookie. The second press — the refresh, the second
 * device, the guest who pressed back — finds the link gone and the cookie still
 * good, and what that guest is owed is their booking rather than an explanation.
 */
describe("opening a stay from the confirmation email", () => {
  it("exchanges the link and lands on the stay", async () => {
    const sent = serving({
      [REDEMPTION]: redeemed,
      [READ]: { status: 200, body: BOOKING },
    });

    const arrival = await openStay(REFERENCE, LINK);

    expect(arrival.refusal).toBeUndefined();
    expect(arrival.stay?.reference).toBe(REFERENCE);
    expect(paths(sent)).toEqual([REDEMPTION, READ]);
  });

  it("still shows the stay when the link has already been spent", async () => {
    serving({ [REDEMPTION]: spent, [READ]: { status: 200, body: BOOKING } });

    const arrival = await openStay(REFERENCE, LINK);

    expect(arrival.stay?.reference).toBe(REFERENCE);
    expect(arrival.refusal).toBeUndefined();
  });

  it("hands back the link's own sentence when the stay cannot be read either", async () => {
    serving({
      [REDEMPTION]: spent,
      [READ]: refusal(404, "NOT_FOUND", "There is no such booking"),
    });

    const arrival = await openStay(REFERENCE, LINK);

    expect(arrival.stay).toBeUndefined();
    expect(arrival.refusal).toBe(SPENT);
  });

  it("reads the stay on its own when no link was presented", async () => {
    const sent = serving({ [READ]: { status: 200, body: BOOKING } });

    const arrival = await openStay(REFERENCE, null);

    expect(arrival.stay?.reference).toBe(REFERENCE);
    expect(sent).toHaveLength(1);
  });
});

/**
 * The arrival as the whole stay route shares it.
 *
 * **The credential is good once and more than one component needs the cookie it
 * buys.** The screen renders the booking and the cancellation panel asks what
 * calling it off would cost; they mount together, so the panel's question would
 * otherwise go out before the exchange has answered and be refused for want of
 * a credential — and a refused quote draws nothing, which hides the cancel
 * affordance from the guest reading the confirmation email on a second device.
 * What is asserted here is the ordering that replaced the waiting.
 */
describe("arriving at a stay once for the whole route", () => {
  /** A turn of the loop, for asserting that something has *not* happened yet. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    forgetArrival(REFERENCE);
    forgetArrival(OTHER_REFERENCE);
  });

  it("spends the credential once however many callers join the arrival", async () => {
    const sent = serving({
      [REDEMPTION]: redeemed,
      [READ]: { status: 200, body: BOOKING },
    });

    const presented = { read: true, link: LINK };

    const [joined, joining] = await Promise.all([
      arriveAtStay(REFERENCE, presented),
      arriveAtStay(REFERENCE, presented),
    ]);

    expect(joined).toBe(joining);
    expect(joined.stay?.reference).toBe(REFERENCE);
    expect(paths(sent)).toEqual([REDEMPTION, READ]);
  });

  // A component survives a change of route parameter, so the arrival it asks
  // for next is about another booking entirely. Answering it with the last
  // one's would put one stay's details under another one's reference.
  it("gives a second stay its own arrival rather than the first one's", async () => {
    const sent = serving({
      [REDEMPTION]: redeemed,
      [READ]: { status: 200, body: BOOKING },
      [OTHER_READ]: {
        status: 200,
        body: { ...BOOKING, reference: OTHER_REFERENCE },
      },
    });

    const first = await arriveAtStay(REFERENCE, { read: true, link: LINK });
    const second = await arriveAtStay(OTHER_REFERENCE, {
      read: true,
      link: null,
    });

    expect(first.stay?.reference).toBe(REFERENCE);
    expect(second.stay?.reference).toBe(OTHER_REFERENCE);
    expect(paths(sent)).toEqual([REDEMPTION, READ, OTHER_READ]);
  });

  // The screen's first pass runs before the address has been consulted, so it
  // has no link to spend yet — but the panel beside it asks its question in
  // that same commit. Announcing the arrival there is what gives the panel
  // something to wait on rather than a refusal to interpret.
  it("holds a reader from before the address has been read until the link is spent", async () => {
    const sent = serving({
      [REDEMPTION]: redeemed,
      [READ]: { status: 200, body: BOOKING },
    });

    void arriveAtStay(REFERENCE, { read: false, link: null });

    let arrived = false;

    void whenArrived(REFERENCE).then(() => {
      arrived = true;
    });

    await settle();

    expect(arrived).toBe(false);
    expect(sent).toHaveLength(0);

    await arriveAtStay(REFERENCE, { read: true, link: LINK });
    await settle();

    expect(arrived).toBe(true);
    expect(paths(sent)).toEqual([REDEMPTION, READ]);
  });

  // The composer announces during its own render, before either child has run
  // — this is that announcement on its own, with nothing yet driving it.
  it("holds a reader announced alone until the credential is spent", async () => {
    const sent = serving({
      [REDEMPTION]: redeemed,
      [READ]: { status: 200, body: BOOKING },
    });

    announceArrival(REFERENCE);

    let arrived = false;

    void whenArrived(REFERENCE).then(() => {
      arrived = true;
    });

    await settle();

    expect(arrived).toBe(false);
    expect(sent).toHaveLength(0);

    await arriveAtStay(REFERENCE, { read: true, link: LINK });
    await settle();

    expect(arrived).toBe(true);
    expect(paths(sent)).toEqual([REDEMPTION, READ]);
  });

  // The composer re-renders for reasons that have nothing to do with the
  // arrival, so it announces on every one of them — the second announcement
  // must find the first rather than starting a competing arrival.
  it("makes one arrival however many times it is announced", async () => {
    const sent = serving({
      [REDEMPTION]: redeemed,
      [READ]: { status: 200, body: BOOKING },
    });

    announceArrival(REFERENCE);
    announceArrival(REFERENCE);

    await arriveAtStay(REFERENCE, { read: true, link: LINK });

    expect(paths(sent)).toEqual([REDEMPTION, READ]);
  });

  // The ordinary signed-in read. There is no exchange coming, so there is
  // nothing to wait behind — a request that never answers stands here for the
  // round trip a reader must not be queued behind.
  it("lets a guest who presented no link through without waiting for the read", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));

    void arriveAtStay(REFERENCE, { read: false, link: null });

    let arrived = false;

    void whenArrived(REFERENCE).then(() => {
      arrived = true;
    });

    void arriveAtStay(REFERENCE, { read: true, link: null });
    await settle();

    expect(arrived).toBe(true);
  });

  // A reader spends nothing and starts nothing, so a component asking about a
  // stay no screen is opening carries on exactly as it did before any of this.
  it("does not make a reader wait on a stay nobody is opening", async () => {
    let arrived = false;

    void whenArrived(REFERENCE).then(() => {
      arrived = true;
    });

    await settle();

    expect(arrived).toBe(true);
  });

  // An arrival is remembered so it is not made twice, which stops being right
  // the moment the booking moves: a cancellation changes the very row the
  // arrival answered with.
  it("reads the stay again once the arrival has been forgotten", async () => {
    const sent = serving({ [READ]: { status: 200, body: BOOKING } });

    const presented = { read: true, link: null };

    await arriveAtStay(REFERENCE, presented);
    await arriveAtStay(REFERENCE, presented);

    expect(paths(sent)).toEqual([READ]);

    forgetArrival(REFERENCE);
    await arriveAtStay(REFERENCE, presented);

    expect(paths(sent)).toEqual([READ, READ]);
  });
});

describe("the account the second link offers", () => {
  it("creates one with the password the guest chose", async () => {
    serving({ [ACCOUNT]: created });

    expect(
      await createAccountFrom({ link: LINK, password: "a longer secret" }),
    ).toEqual({
      ok: true,
      stay: { bookingId: STAY, reference: REFERENCE },
      signedIn: true,
    });
  });

  // The skip, and the reason the field is not `required`. The mail proved the
  // address, so the account exists either way and the stay is attached to it —
  // what the guest declined is a way of signing in, not their booking.
  it("creates one without a password, and sends no empty one", async () => {
    const sent = serving({ [ACCOUNT]: created });

    const outcome = await createAccountFrom({ link: LINK });

    expect(outcome).toEqual({
      ok: true,
      stay: { bookingId: STAY, reference: REFERENCE },
      signedIn: true,
    });
    expect(await sent[0]!.json()).toEqual({ link: LINK });
  });

  // The stay stays reachable when no password was set: what comes back names
  // the booking, which is the address the guest is sent on to.
  it("names the booking either way, so the stay is never behind the password", async () => {
    serving({ [ACCOUNT]: created });

    const skipped = await createAccountFrom({ link: LINK });
    const chosen = await createAccountFrom({
      link: LINK,
      password: "a longer secret",
    });

    expect(skipped).toEqual(chosen);
  });

  // The rarer path, and the one the screen after this call has to be able to
  // see: the address already had an account, so the stay attaches to it and no
  // session is issued over it. A page that carried this guest on to their
  // profile would be carrying a browser holding nothing to a door that refuses
  // it, past the link to the booking that is the way on it does have.
  it("says when the redemption left the browser with no session", async () => {
    serving({ [ACCOUNT]: attachedWithoutSession });

    const outcome = await createAccountFrom({ link: LINK });

    expect(outcome).toEqual({
      ok: true,
      stay: { bookingId: STAY, reference: REFERENCE },
      signedIn: false,
    });
  });

  it("resolves a spent account link into a sentence rather than throwing", async () => {
    serving({ [ACCOUNT]: spent });

    const outcome = await createAccountFrom({ link: LINK });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toBe(SPENT);
  });
});

/**
 * What any of this hands a screen to render.
 *
 * **The stay it names says nothing about an address having an account.** That
 * branch is the confirmation email's, because the email reaches the address
 * being asked about and nobody else; a hold is unauthenticated and only
 * rate-limited, so a page making the same branch would answer "does this person
 * stay here?" to anyone who created a hold naming them. This is that invariant
 * held to the answer these screens are built from.
 *
 * `signedIn` rides beside the stay rather than in it, and is about this browser
 * rather than about the address — `contract/booking.ts` argues the difference,
 * and the test below is what keeps the two apart in the shape a screen reads.
 */
describe("what a redemption tells the page", () => {
  it("names the stay and nothing about an account", async () => {
    serving({ [ACCOUNT]: created });

    const outcome = await createAccountFrom({ link: LINK });

    expect(outcome.ok && Object.keys(outcome.stay).sort()).toEqual([
      "bookingId",
      "reference",
    ]);
  });

  // The offer on the stay page turns on whether *this booking* has an owner,
  // which is a fact about a stay the caller has already proved. The parameter is
  // narrowed to that column so no address can reach the decision.
  it("decides the claim offer off the booking's own owner", () => {
    expect(isUnattached({ userId: null })).toBe(true);
    expect(isUnattached({ userId: "guest-account" })).toBe(false);
  });
});

describe("attaching a proven stay to a session", () => {
  it("posts to the booking's own attachment and answers with the stay", async () => {
    const sent = serving({ [ATTACHMENT]: { status: 200, body: BOOKING } });

    expect(await attachStay(STAY)).toEqual({
      ok: true,
      stay: { bookingId: STAY, reference: REFERENCE },
    });
    expect(new URL(sent[0]!.url).pathname).toBe(ATTACHMENT);
  });

  it("resolves the API's refusal when the booking cookie no longer proves the stay", async () => {
    const said =
      "Open this booking from the link in your confirmation email, then add it to your account";

    serving({ [ATTACHMENT]: refusal(403, "FORBIDDEN", said) });

    const outcome = await attachStay(STAY);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toBe(said);
  });
});

/**
 * Where the credential arrives, and the reason it is not the query string.
 *
 * A query string is part of the request line, so the web tier's access log has
 * the credential before any code on this page runs. A fragment is the one part
 * of a URL a browser keeps to itself. `booking.service.ts` mints both mailed
 * links that way and this is the reader that has to agree with it.
 */
describe("linkInFragment", () => {
  it("reads the stay credential the mailed address carried", () => {
    expect(linkInFragment(`#${STAY_LINK_PARAM}=${LINK}`, STAY_LINK_PARAM)).toBe(
      LINK,
    );
  });

  it("reads the account credential the same way", () => {
    expect(
      linkInFragment(`#${ACCOUNT_LINK_PARAM}=${LINK}`, ACCOUNT_LINK_PARAM),
    ).toBe(LINK);
  });

  it("finds it beside whatever else the fragment carried", () => {
    expect(
      linkInFragment(`#from=email&${STAY_LINK_PARAM}=${LINK}`, STAY_LINK_PARAM),
    ).toBe(LINK);
  });

  it("answers with nothing for a page nobody arrived at from a message", () => {
    expect(linkInFragment("", STAY_LINK_PARAM)).toBeNull();
    expect(linkInFragment("#booked", STAY_LINK_PARAM)).toBeNull();
  });
});

/**
 * Taking the credential back off the address.
 *
 * The page reads the link off its own URL and then must not leave it there: an
 * address bar and a history entry are two places one press would otherwise put
 * it — and a fragment lingers in both exactly as a query did.
 */
describe("addressWithoutLink", () => {
  it("removes the credential and keeps the address", () => {
    expect(
      addressWithoutLink(
        {
          pathname: `/bookings/${REFERENCE}`,
          search: "",
          hash: `#${STAY_LINK_PARAM}=${LINK}`,
        },
        STAY_LINK_PARAM,
      ),
    ).toBe(`/bookings/${REFERENCE}`);
  });

  it("keeps every other parameter, including the one that says a guest has just paid", () => {
    const kept = addressWithoutLink(
      {
        pathname: `/bookings/${REFERENCE}`,
        search: "?booked",
        hash: `#${STAY_LINK_PARAM}=${LINK}`,
      },
      STAY_LINK_PARAM,
    );

    expect(kept).not.toContain(LINK);
    expect(kept).toContain("booked");
  });

  // A link out of an older message, or one a guest pasted into an address bar
  // that already had a query on it. It must not be left sitting in the history
  // entry because it came in the half of the URL this no longer mints.
  it("removes it from the query string as well", () => {
    const kept = addressWithoutLink(
      {
        pathname: `/bookings/${REFERENCE}`,
        search: `?${STAY_LINK_PARAM}=${LINK}`,
        hash: "",
      },
      STAY_LINK_PARAM,
    );

    expect(kept).toBe(`/bookings/${REFERENCE}`);
  });

  it("leaves an address that never carried one alone", () => {
    expect(
      addressWithoutLink(
        { pathname: `/bookings/${REFERENCE}`, search: "", hash: "" },
        STAY_LINK_PARAM,
      ),
    ).toBe(`/bookings/${REFERENCE}`);
  });
});
