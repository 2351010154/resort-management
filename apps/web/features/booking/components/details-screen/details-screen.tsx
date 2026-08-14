"use client";

// `/booking/<hold>/details` — the stay read back, and the last thing the guest
// fills in before the money.
//
// The third of `FR-BOOK-06`'s six steps and the first that names a hold. What it
// is *for* is the check the two steps before it could not make: `/booking`
// prices from a fixture and quotes `STANDARD`, and this is where the guest sees
// the figure the property actually priced, against the nights the property
// actually took. A guest who disagrees with it has not paid anything yet.
//
// **It collects the guest's details now, and that is the change.** It used to
// collect nothing, and said so at length: the API's hold door required a name
// and an address, so the room step asked for them and this screen had nothing
// left to ask. That arrangement made the funnel ask who you are in order to
// reserve twenty minutes of a room you were still deciding about. The obligation
// was never the hold's — a hold that expires unpaid is inventory coming back —
// so `contract/booking.ts` moved the pair to `setOwnHoldContact` and it is
// collected here, one press before the gateway.
//
// **Two plates on the left and one column on the right**, which is the shape of
// what is being decided. The left is what the guest is agreeing to and what they
// have to say about themselves; the right is the arithmetic and the one press
// that acts on it. The right column is sticky, because the total is what a guest
// scrolling a form keeps looking back at.
//
// **No step rail.** The other funnel screens carry one and this does not: the
// comp puts a progress bar in the bar and the property does not want one here.
// A guest on this screen has one way forward and the browser's own button back.
//
// **The expiry is shown because it is running.** The hold consumed the nights
// when it was taken, and `hold-expiry-sweep.ts` gives them back two minutes
// after the TTL falls due. A screen that did not say so would let a guest read
// terms at their leisure and find the room gone.
//
// **This screen ends the funnel's own part of the payment.** `Complete booking`
// writes the contact, opens the attempt and leaves for the gateway, which is
// what `/booking/<hold>/payment` used to do on a page of its own. That page is
// still there and still works — a guest who bookmarked it, or who presses back
// out of the gateway, lands on a screen that can still send them on — but
// nothing here links to it any more.

import { type CalendarDate, parseDate } from "@internationalized/date";
import { nightCount, roundVndForDisplay } from "@mariva/shared";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useState } from "react";
import { HoldTimer } from "@/features/booking/components/hold-timer/hold-timer";
import {
  StayShell,
  stayStyles as shellStyles,
} from "@/features/booking/components/stay-shell/stay-shell";
import { writeBookingSearch } from "@/features/booking/lib/booking-search";
import { markedRoomFacts } from "@/features/booking/lib/room-facts";
import { roomLead, tierSrcSet } from "@/features/booking/lib/room-images";
import { roomType } from "@/features/booking/lib/room-types";
import {
  type HeldStay,
  isContactAnswered,
  isLost,
  isSettled,
  openPayment,
  saveContact,
  type StayContact,
  stayContact,
  stayTotal,
} from "@/features/booking/lib/stay-funnel";
import { useHeldStay } from "@/features/booking/lib/use-held-stay";
import { apiMessage } from "@/lib/api";
import { FunnelNav } from "../funnel-nav/funnel-nav";
import { Money } from "../money";
import styles from "./details-screen.module.css";

/**
 * How a guest says they will pay: with a card, or through a provider.
 *
 * Two panels behind one control rather than four entries in one list, because
 * they are two different kinds of answer. A card is details the guest types; a
 * provider is a page the guest is sent to. A single list mixing them would put
 * "Card number" and "PayPal" on the same footing when only one of them has a
 * field under it.
 */
type PayHow = "card" | "provider";

/**
 * The providers the tiles offer, and which of them this property can actually
 * take money through.
 *
 * **`accepted` is a fact about the API and not a feature flag.** `payment.ts`
 * has exactly one gateway adapter — VNPay — and `openAttempt` takes no provider
 * argument, so MoMo and PayPal are drawn and refused rather than drawn and
 * broken. `design-foundations.md` §6 forbids a component inventing a hotel
 * fact, and "we take PayPal" is one. When an adapter lands, this line and the
 * contract change together.
 */
const PROVIDERS: readonly {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly accepted: boolean;
}[] = [
  {
    id: "vnpay",
    name: "VNPay",
    blurb: "Cards, bank transfer and QR, on VNPay's secure page.",
    accepted: true,
  },
  {
    id: "momo",
    name: "MoMo",
    blurb: "Not accepted yet.",
    accepted: false,
  },
  {
    id: "paypal",
    name: "PayPal",
    blurb: "Not accepted yet.",
    accepted: false,
  },
];

/**
 * Why a press on the card panel cannot finish the booking.
 *
 * The panel exists because the comp has it and because a card is what most
 * guests reach for. What it cannot do is charge: no route accepts a card number,
 * and one that did would put this application inside PCI scope.
 *
 * Said on the press rather than standing under the fields, because the comp puts
 * no prose there and a plate that explains itself before it is used explains
 * itself to every guest who was never going to use it. The line lands in the
 * same slot under the button that every other refusal on this screen lands in.
 */
const CARD_NOT_ACCEPTED = "Choose a provider to complete this booking.";

export function DetailsScreen({ hold }: { readonly hold: string }) {
  const router = useRouter();
  const { stay, loading, refusal, reread } = useHeldStay(hold);

  if (loading) {
    return (
      <StayShell
        step="Step 3 of 4"
        subtitle="One moment while the property reads your stay back."
        title="Your stay"
      />
    );
  }

  if (!stay) {
    return (
      <StayShell
        step="Step 3 of 4"
        subtitle="The property could not open this stay."
        title="Your stay"
      >
        <p className={shellStyles.error} role="alert">
          {refusal}
        </p>
        <button
          className={shellStyles.submit}
          onClick={() => router.push("/booking")}
          type="button"
        >
          Start again
        </button>
      </StayShell>
    );
  }

  // A stay the sweep has already taken back, or one that was called off. There
  // is nothing on this screen a guest could do with it, and the button below
  // would open a payment page for a room the property has resold.
  if (isLost(stay)) {
    return (
      <StayShell
        stay={stay}
        step="Step 3 of 4"
        subtitle="This hold has been released, so the nights are back on sale."
        title="The hold has gone"
      >
        <p className={shellStyles.notice} role="status">
          Nothing was charged. Choosing the dates again will show what is still
          available.
        </p>
        <button
          className={shellStyles.submit}
          onClick={() => router.push("/booking")}
          type="button"
        >
          Choose again
        </button>
      </StayShell>
    );
  }

  // Already paid for, which is what a guest pressing back after the gateway
  // sees. Sent on to the booking rather than offered a second payment page.
  if (isSettled(stay)) {
    return (
      <StayShell
        stay={stay}
        step="Confirmed"
        subtitle="This stay is already confirmed."
        title="You are booked"
      >
        <button
          className={shellStyles.submit}
          onClick={() => router.push(`/bookings/${stay.reference}`)}
          type="button"
        >
          See your booking
        </button>
      </StayShell>
    );
  }

  // Keyed on the stay's id so that the form's own state — what has been typed,
  // which payment panel is open — belongs to one stay and cannot be carried
  // onto another by a client-side navigation between two holds.
  return <Review key={stay.id} onReread={reread} stay={stay} />;
}

/** The screen proper, standing on a hold that is live and unpaid. */
function Review({
  stay,
  onReread,
}: {
  readonly stay: HeldStay;
  readonly onReread: () => void;
}) {
  const type = roomType(stay.roomType);
  const lead = roomLead(stay.roomType);
  const facts = markedRoomFacts(type);
  const checkIn = parseDate(stay.checkIn);
  const checkOut = parseDate(stay.checkOut);

  const [contact, setContact] = useState<StayContact>(() => stayContact(stay));
  const [how, setHow] = useState<PayHow>("provider");
  const [provider, setProvider] = useState("vnpay");
  const [billing, setBilling] = useState("");
  const [card, setCard] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The stay is re-read while this screen is open — the timer asks again when it
  // falls due — so an address written by another tab, or by this one before a
  // refresh, arrives after the first paint. Adopted only into fields the guest
  // has not started filling: overwriting what somebody is typing is worse than
  // showing them a value one read out of date.
  const known = stayContact(stay);
  useEffect(() => {
    setContact((typed) => ({
      email: typed.email || known.email,
      name: typed.name || known.name,
    }));
  }, [known.email, known.name]);

  const answered = isContactAnswered(contact);
  const payable = how === "provider" && provider === "vnpay";

  /**
   * Writes who to send the confirmation to, opens the attempt, and leaves.
   *
   * **Two calls and in this order.** The contact is the property's own record
   * and the attempt is a signed url on somebody else's origin; a guest who is
   * bounced back from the gateway or who closes the tab has to leave an address
   * behind either way, and doing it second would mean the one thing that never
   * happens on a failed payment is the one thing the property needed.
   *
   * **`window.location.assign` and not the router.** The address is VNPay's, on
   * another origin; Next's router is for routes this app owns, and handing it an
   * external url is how a payment page ends up rendered inside a client-side
   * navigation that cannot happen. `sign-in.ts` leaves for Google the same way.
   *
   * **The button can only be pressed once.** An attempt is a row and a signed
   * url, and a double press is two attempts on one stay — both `PENDING`, one of
   * which no callback will ever resolve. That is survivable, which is why the
   * guard is a disabled button rather than anything cleverer, but it is still
   * noise on a table `FR-PAY-05` reconciles every night.
   */
  async function complete(): Promise<void> {
    if (leaving) {
      return;
    }

    if (!answered) {
      setNote(
        "We need a name and an email address — that is where the confirmation goes.",
      );
      return;
    }

    if (!payable) {
      setNote(CARD_NOT_ACCEPTED);
      return;
    }

    setLeaving(true);
    setNote(null);

    try {
      const named = await saveContact(stay, contact);
      const { paymentUrl } = await openPayment(named);

      window.location.assign(paymentUrl);
    } catch (error) {
      // The button comes back, because every refusal these calls can carry is
      // one a second press might get past — a gateway with no credentials
      // configured, a hold that has just expired, a network that was not there.
      // Leaving it disabled would strand a guest on a dead page.
      setLeaving(false);
      setNote(
        apiMessage(
          error,
          "The payment page could not be opened just now. Nothing has been charged.",
        ),
      );
    }
  }

  /** Back to the room list, on the stay this hold was taken for. */
  const changeHref = `/booking${writeBookingSearch({
    range: { checkIn, checkOut },
    party: {
      adults: stay.adults,
      children: stay.childAges.map((age) => ({ age })),
    },
    plan: stay.plan,
    step: "rooms",
  })}`;

  return (
    <main className={styles.screen}>
      <FunnelNav />

      <div className={styles.frame}>
        <div className={styles.grid}>
          <div className={styles.column}>
            <section className={styles.plate}>
              <h1 className={`${styles.title} font-display`}>
                Review your booking
              </h1>
              <p className={styles.lede}>
                Please review your selection before entering your details and
                payment information.
              </p>

              <div className={styles.roomHead}>
                <h2 className={`${styles.roomName} font-display`}>
                  {type.name}
                </h2>
                {/* A plain anchor and not `next/link`: it goes back to a route
                    whose whole state is in the query, and a prefetch would pull
                    the room list's bundle in behind a guest who is more likely
                    to be reading than reconsidering. */}
                <a className={styles.change} href={changeHref}>
                  Change
                  <svg
                    aria-hidden="true"
                    className={styles.changeMark}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    viewBox="0 0 16 16"
                  >
                    <path d="M6 3.5 10.5 8 6 12.5" />
                  </svg>
                </a>
              </div>

              {/* The same four facts the room step stated, in the same order and
                  the same words — `room-facts.ts` holds the list both read. */}
              <dl className={styles.facts}>
                {facts.map((fact) => (
                  <div className={styles.fact} key={fact.term}>
                    <Mark slug={fact.icon} />
                    <div className={styles.factLines}>
                      <dd className={styles.factValue}>{fact.value}</dd>
                      <dt className={styles.factTerm}>{fact.term}</dt>
                    </div>
                  </div>
                ))}
              </dl>

              {/* Decorative here, and the `alt` says so by being empty: the same
                  photograph is printed in the summary beside it with a real
                  description, and a screen reader given both reads the room
                  twice. */}
              <img
                alt=""
                className={styles.roomShot}
                decoding="async"
                height={lead.height}
                sizes={ROOM_SHOT_SIZES}
                src={lead.src}
                srcSet={tierSrcSet(lead)}
                width={lead.width}
              />
            </section>

            <section className={styles.plate}>
              <h2 className={`${styles.plateTitle} font-display`}>
                Your details &amp; payment
              </h2>
              {/* Labelled rather than placeheld — a placeholder is the label
                  until the field has anything in it, and then it is gone, which
                  is exactly when a guest checking what they typed needs it. The
                  placeholder underneath is an example, not the label. */}
              <div className={styles.pair}>
                <label className={styles.field}>
                  <span className={styles.fieldTerm}>Name</span>
                  <input
                    autoComplete="name"
                    className={styles.input}
                    disabled={leaving}
                    onChange={(event) =>
                      setContact({ ...contact, name: event.target.value })
                    }
                    placeholder="Enter your full name"
                    type="text"
                    value={contact.name}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldTerm}>Email</span>
                  <input
                    autoComplete="email"
                    className={styles.input}
                    disabled={leaving}
                    // `inputMode` and not `type="email"`, so the browser's own
                    // bubble does not pre-empt the line under the button that
                    // this screen answers every other refusal on.
                    inputMode="email"
                    onChange={(event) =>
                      setContact({ ...contact, email: event.target.value })
                    }
                    placeholder="Enter your email address"
                    type="text"
                    value={contact.email}
                  />
                </label>
              </div>

              <div className={styles.payHead}>
                <p className={styles.payTerm}>
                  Payment information
                  <Mark slug="lock" />
                </p>

                {/* Two radios drawn as a segmented control, not two buttons. A
                    button says "do this"; these say "it is one of these", which
                    is what a radio group means to anything reading the page
                    rather than looking at it. */}
                <fieldset className={styles.swap}>
                  <legend className={styles.swapLegend}>
                    How you will pay
                  </legend>
                  {SWAP.map((option) => (
                    <label className={styles.swapOption} key={option.how}>
                      <input
                        checked={how === option.how}
                        className={styles.swapInput}
                        disabled={leaving}
                        name="pay-how"
                        onChange={() => {
                          setHow(option.how);
                          setNote(null);
                        }}
                        type="radio"
                        value={option.how}
                      />
                      <span className={styles.swapFace}>{option.label}</span>
                    </label>
                  ))}
                </fieldset>
              </div>

              {how === "card" ? (
                <div className={styles.pair}>
                  <label className={styles.boxField}>
                    <Mark slug="billing" />
                    <span className={styles.boxLines}>
                      <span className={styles.boxTerm}>Billing address</span>
                      <input
                        autoComplete="billing street-address"
                        className={styles.boxInput}
                        disabled={leaving}
                        onChange={(event) => setBilling(event.target.value)}
                        placeholder="Enter billing address"
                        type="text"
                        value={billing}
                      />
                    </span>
                  </label>
                  <label className={styles.boxField}>
                    <Mark slug="card" />
                    <span className={styles.boxLines}>
                      <span className={styles.boxTerm}>Card number</span>
                      <input
                        autoComplete="off"
                        className={styles.boxInput}
                        disabled={leaving}
                        inputMode="numeric"
                        onChange={(event) => setCard(event.target.value)}
                        placeholder="1234 5678 9012 3456"
                        type="text"
                        value={card}
                      />
                    </span>
                  </label>
                </div>
              ) : (
                <fieldset className={styles.providers}>
                  <legend className={styles.swapLegend}>Which provider</legend>
                  {PROVIDERS.map((option) => (
                    <label
                      className={styles.provider}
                      data-accepted={option.accepted}
                      key={option.id}
                    >
                      <input
                        checked={provider === option.id}
                        className={styles.swapInput}
                        disabled={leaving || !option.accepted}
                        name="pay-provider"
                        onChange={() => {
                          setProvider(option.id);
                          setNote(null);
                        }}
                        type="radio"
                        value={option.id}
                      />
                      <span className={styles.providerFace}>
                        <span className={styles.providerName}>
                          {option.name}
                        </span>
                        <span className={styles.providerBlurb}>
                          {option.blurb}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </section>
          </div>

          <aside className={styles.aside}>
            <div className={styles.asidePlate}>
              <img
                alt={lead.alt}
                className={styles.asideShot}
                decoding="async"
                height={lead.height}
                sizes={ASIDE_SHOT_SIZES}
                src={lead.src}
                srcSet={tierSrcSet(lead)}
                width={lead.width}
              />

              <h2 className={`${styles.asideTitle} font-display`}>Your stay</h2>

              <dl className={styles.stayRows}>
                <StayRow
                  icon="calendar"
                  term="Check-in"
                  value={longDate(checkIn)}
                />
                <StayRow
                  icon="calendar"
                  term="Check-out"
                  value={longDate(checkOut)}
                />
                <StayRow
                  icon="nights"
                  term="Nights"
                  value={countNights(checkIn, checkOut)}
                />
                <StayRow
                  icon="guest"
                  term="Guests"
                  value={describeParty(stay)}
                />
              </dl>

              {/* The server's deadline, never a duration counted here — and when
                  it falls due the stay is read again rather than assumed lost.
                  The sweep runs every two minutes, so a clock reaching zero
                  means the nights are *about* to go back, and only the API can
                  say whether they have. */}
              {stay.holdExpiresAt ? (
                <div className={styles.timer}>
                  <HoldTimer
                    expiresAt={new Date(stay.holdExpiresAt)}
                    onExpired={onReread}
                  />
                </div>
              ) : null}

              <div className={styles.totalBlock}>
                <span className={styles.totalTerm}>Total</span>
                <span className={`${styles.totalFigure} font-display`}>
                  <Money amount={roundVndForDisplay(stayTotal(stay))} />
                </span>
                <span className={styles.totalNote}>
                  VAT and service included
                </span>
              </div>

              <button
                className={styles.complete}
                data-complete-booking
                disabled={leaving}
                onClick={() => void complete()}
                type="button"
              >
                {leaving ? "Opening the payment page…" : "Complete booking"}
              </button>

              {/* Empty until something is refused, and present the whole time so
                  that it is. A live region added to the page at the moment it
                  has something to say is a region the screen reader was not
                  watching when the message arrived. */}
              <p className={styles.foot} role="status">
                {note}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/** One labelled row of the summary: a glyph, the term, and what it says. */
function StayRow({
  icon,
  term,
  value,
}: {
  readonly icon: string;
  readonly term: string;
  readonly value: string;
}) {
  return (
    <div className={styles.stayRow}>
      <Mark slug={icon} />
      <div className={styles.stayLines}>
        <dt className={styles.stayTerm}>{term}</dt>
        <dd className={styles.stayValue}>{value}</dd>
      </div>
    </div>
  );
}

/**
 * A glyph from the funnel's icon directory, painted as a mask over the colour it
 * inherits — `room-facts.ts` argues the technique at {@link MarkedFact}.
 *
 * `aria-hidden` without exception: every mark on this screen stands beside the
 * word it marks, and a screen reader reading "picture of a calendar, Check-in,
 * 19 August 2026" has been told the same thing twice.
 */
function Mark({ slug }: { readonly slug: string }) {
  return (
    <span
      aria-hidden="true"
      className={styles.mark}
      style={
        {
          "--mark": `url("/images/booking/icons/${slug}.svg")`,
        } as CSSProperties
      }
    />
  );
}

/** The two panels behind the swap, in the order the comp draws them. */
const SWAP: readonly { readonly how: PayHow; readonly label: string }[] = [
  { how: "card", label: "Card" },
  { how: "provider", label: "Providers" },
];

/**
 * What the left plate's photograph is worth downloading at.
 *
 * The frame is a wide strip inside a plate that is a little under two thirds of
 * a 1548px measure, and one column at the point the grid stacks. Stated so the
 * browser picks a tier off the layout rather than off the window.
 */
const ROOM_SHOT_SIZES = "(max-width: 60rem) 92vw, min(60rem, 60vw)";

/** The summary's frame: a fixed 32rem column, or the full measure once stacked. */
const ASIDE_SHOT_SIZES = "(max-width: 60rem) 92vw, 29rem";

/** "19 August 2026" — the property's own date, never the browser's instant. */
function longDate(date: CalendarDate): string {
  // "UTC" is safe here and only here: a `CalendarDate` converted at UTC midnight
  // formats as itself, which is the point. A browser at UTC+9 parsing the ISO
  // text and formatting locally renders the day before, silently, for exactly
  // the guests most likely to book a resort in Vietnam.
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date.toDate("UTC"));
}

/**
 * How many nights the stay covers.
 *
 * `[checkIn, checkOut)`, half-open, so a Monday to a Wednesday is two nights and
 * not three — the same convention `stay-date.ts` states for the range itself.
 */
function countNights(checkIn: CalendarDate, checkOut: CalendarDate): string {
  const nights = nightCount({ checkIn, checkOut });

  return nights === 1 ? "1 night" : `${nights} nights`;
}

/**
 * The party, as heads rather than as bands.
 *
 * The summary answers "who is coming", and a guest who booked two adults and a
 * child is three people arriving. The bands still matter — §3 prices children in
 * three of them — and they are priced into the total this sits above rather than
 * spelled out beside it.
 */
function describeParty(stay: HeldStay): string {
  const heads = stay.adults + stay.childAges.length;

  return heads === 1 ? "1 guest" : `${heads} guests`;
}
