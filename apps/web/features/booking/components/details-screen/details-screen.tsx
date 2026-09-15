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
//
// ---
//
// **The summary is a review, not a receipt, and that is what the second pass
// changed.** A review screen has one job — let a guest check what they are about
// to buy against what they meant to buy — and four labelled rows saying
// "Check-in", "Check-out", "Nights" and "3 guests" could not carry it. Three
// things were missing and one was actively wrong:
//
// - **The times were nowhere.** `property-and-tariff.md` §2 publishes 14:00 and
//   12:00 and the pre-arrival mail prints the first of them, so a guest met the
//   property's clock for the first time *after* paying. The two dates are now a
//   rail — an arrival, a leg carrying the nights, a departure — with the
//   published time under each end. `@mariva/shared` owns both strings; a "14:00"
//   typed in here would be a hotel fact invented in the browser.
// - **The party was collapsed to a head count.** §3 prices a child by band, so
//   "3 guests" is precisely the reading a guest cannot check the total against.
//   It says "2 adults, 1 child aged 6" now, which is what was priced.
// - **The rate plan was not stated at all.** It is the field on the stay that
//   decides whether cancelling is free, and `rate-plans.ts` has had the sentence
//   for it the whole time with nobody on this screen reading it.
// - **The address was collected and never shown back.** `screens.md` says the
//   typo risk is handled by showing it "prominently at details", and until now
//   nothing did. A valid address is echoed into the summary as the place the
//   confirmation goes.
//
// **The press moved out of the summary plate into a plate of its own**, and on a
// phone that plate is pinned to the bottom of the window. It used to be the last
// thing on a page about two thousand pixels tall: a guest filled in a name, an
// address and a payment choice without ever having seen the total or known that
// a clock was running. One element serves both — a plate under the summary at a
// laptop's measure, a fixed strip carrying the total, the countdown and the
// button below it.

import { type CalendarDate, parseDate } from "@internationalized/date";
import {
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  formatPresentment,
  type GatewayPaymentMethod,
  nightCount,
  type Presentment,
  roundVndForDisplay,
} from "@mariva/shared";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HoldClock,
  HoldTimer,
} from "@/features/booking/components/hold-timer/hold-timer";
import {
  StayShell,
  stayStyles as shellStyles,
} from "@/features/booking/components/stay-shell/stay-shell";
import { writeBookingSearch } from "@/features/booking/lib/booking-search";
import { planName, planTerm } from "@/features/booking/lib/rate-plans";
import { markedRoomFacts, roomChips } from "@/features/booking/lib/room-facts";
import {
  roomGallery,
  roomLead,
  roomSecond,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import { roomType } from "@/features/booking/lib/room-types";
import {
  collectableGateways,
  gatewayOffer,
  type HeldStay,
  isContactAnswered,
  isEmailAnswered,
  isLost,
  isNameAnswered,
  isSettled,
  type OpenedPayment,
  openPayment,
  type StayContact,
  saveContact,
  stayContact,
  stayTotal,
} from "@/features/booking/lib/stay-funnel";
import { useHeldStay } from "@/features/booking/lib/use-held-stay";
import { apiMessage } from "@/lib/api";
import { FunnelNav } from "../funnel-nav/funnel-nav";
import { pad, RoomGallery } from "../room-gallery/room-gallery";
import { Money } from "../money";
import { formatRate } from "./presentment-rate";
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
 * An opened attempt that froze what a foreign gateway will charge — the one
 * shape {@link Review} keeps between opening it and sending the payer on.
 *
 * A narrower type than {@link OpenedPayment} rather than that interface with
 * an optional field re-checked at every read: `presentment` is what decides
 * whether this screen shows the interstitial at all, and asserting it once,
 * where the attempt is opened, is what lets everything downstream — the
 * confirmation screen among it — read it as present rather than guard it
 * again.
 */
type ForeignAttempt = OpenedPayment & { readonly presentment: Presentment };

/**
 * The providers the tiles offer, and the method each one would open an attempt
 * at.
 *
 * **Whether a tile is accepted is a fact about the API and not a feature flag,
 * and it is asked rather than written down here.** `collectableGateways` reads
 * the adapters this deployment actually bound — a property collects through a
 * provider from the deploy that gives it that provider's credentials, and not
 * before — so a tile is choosable when this list gives it a method and the API
 * answers with that method. A method the API leaves out is drawn and refused
 * rather than drawn and broken, which is what a hard-coded `accepted: true`
 * bought: a guest who typed their name, chose the provider and pressed the
 * button, and read `ports/gateway-registry.ts`'s internal refusal as their
 * answer. A tile the API has not answered about *yet* is neither — it keeps
 * its own blurb and claims nothing, which `gatewayOffer` in `stay-funnel.ts`
 * is the third state for.
 * `design-foundations.md` §6 forbids a component inventing a hotel fact, and
 * "we take PayPal" is one.
 *
 * **`method` is absent on exactly the row no gateway could ever answer for.**
 * MoMo is a slot in the comp with nothing behind it —
 * `contract/payment.ts`'s `gatewayPaymentMethodSchema` has no member for it —
 * and the absence says so at the type rather than leaving `complete()` to
 * trust a disabled radio never gets pressed.
 */
const PROVIDERS: readonly {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly method?: GatewayPaymentMethod;
}[] = [
  {
    id: "vnpay",
    name: "VNPay",
    blurb: "Cards, bank transfer and QR, on VNPay's secure page.",
    method: "VNPAY",
  },
  {
    id: "momo",
    name: "MoMo",
    blurb: "Not accepted yet.",
  },
  {
    id: "paypal",
    name: "PayPal",
    blurb:
      "Pays in US dollars, at the property's own rate. You'll see the exact figure before you're sent to PayPal.",
    method: "PAYPAL",
  },
];

/**
 * What a tile says in place of its blurb when this property cannot collect
 * through it today.
 *
 * The blurbs above describe what paying through a provider is like, which is
 * an invitation; printing one under a tile nobody can choose would be the
 * screen selling a route out of the funnel that does not exist. MoMo keeps its
 * own line, because "not accepted yet" is a fact about the property rather
 * than about this deployment's credentials.
 *
 * **Only once the API has actually refused the provider**, and never while the
 * answer is still on its way. A tile whose standing is not yet known has been
 * refused by nobody — saying otherwise would print this under VNPay, the
 * gateway nearly every guest pays through, for the length of one request on
 * every booking.
 */
const NOT_COLLECTABLE = "Not available at this property just now.";

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

/**
 * Why a press on a provider panel cannot finish the booking either — the two
 * cases, said apart.
 *
 * The first is the property's answer: this deployment holds no credentials for
 * the chosen provider, and another one has to be picked. The second is a press
 * that beat the listing back, which asks the guest for nothing but a moment —
 * telling them to choose another provider would be advice about a tile that is
 * probably about to be fine.
 */
const PROVIDER_NOT_ACCEPTED =
  "That provider is not available just now. Choose another to complete this booking.";
const PROVIDERS_NOT_KNOWN_YET =
  "One moment — the property is still confirming which providers it can take money through.";

/**
 * The three refusals the screen writes itself, before any request is made.
 *
 * **The two field lines stand beside the field they are about, and the third
 * stands under the button.** They are not the same sentence said twice: a guest
 * who pressed a button in a pinned bar at the foot of a phone is looking at the
 * bar, and the field that is not finished may be a screen and a half above them.
 * So the bar says which way to look and the field says what is wrong with it.
 */
const NAME_NEEDED = "We need a name to put on the confirmation.";
const EMAIL_NEEDED =
  "This does not look like a complete address, and the confirmation goes to it.";
const CONTACT_NEEDED = "Your details above are not finished yet.";

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
  return <Review hold={hold} key={stay.id} onReread={reread} stay={stay} />;
}

/** The screen proper, standing on a hold that is live and unpaid. */
function Review({
  hold,
  stay,
  onReread,
}: {
  readonly hold: string;
  readonly stay: HeldStay;
  readonly onReread: () => void;
}) {
  const type = roomType(stay.roomType);
  const lead = roomLead(stay.roomType);
  // A different frame from the summary's. Both were the lead until this line,
  // which printed one photograph twice on a page that stacks into one column.
  const second = roomSecond(stay.roomType);
  const frames = roomGallery(stay.roomType);
  // Where the strip's frame sits in the set, so the counter over it names the
  // photograph it is drawn on rather than the one the summary is showing, and
  // so the gallery opens on the frame the press was made from.
  const shotAt = Math.max(0, frames.indexOf(second));
  const facts = markedRoomFacts(type);
  const chips = roomChips(type);
  const checkIn = parseDate(stay.checkIn);
  const checkOut = parseDate(stay.checkOut);

  // One `Date` for the whole of this stay, not a fresh one per render. Both
  // clocks key their interval on this object, and a new instance every time the
  // guest types a letter would tear the tick down and start it again — a
  // countdown that stutters for exactly as long as somebody is filling the form
  // under it.
  const expiresAt = useMemo(
    () => (stay.holdExpiresAt ? new Date(stay.holdExpiresAt) : null),
    [stay.holdExpiresAt],
  );

  const fieldIds = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [contact, setContact] = useState<StayContact>(() => stayContact(stay));
  const [how, setHow] = useState<PayHow>("provider");
  const [provider, setProvider] = useState("vnpay");
  const [billing, setBilling] = useState("");
  const [card, setCard] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [showing, setShowing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Nothing is marked wrong until the guest has asked for the booking to be
  // completed. Validating as somebody types tells them their address is invalid
  // after the first letter of it, which is true and useless.
  const [asked, setAsked] = useState(false);
  // Set the moment an attempt froze a presentment, which is the moment this
  // screen has anything honest to quote a payer in dollars — see `complete`.
  // A stay's own hold clock keeps running underneath it, because the attempt
  // that produced this is already open and the room is already extended.
  const [confirming, setConfirming] = useState<ForeignAttempt | null>(null);
  // The gateways this deployment can collect through, once the API has said.
  // Undefined until it has — which the tiles read as "not asked yet" and never
  // as a refusal — and empty if it could not be asked at all, which is a
  // refusal of everything and the safe way round: a provider is choosable only
  // once the property has said it can take money through it.
  const [collectable, setCollectable] =
    useState<readonly GatewayPaymentMethod[]>();

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

  // Asked once, when the payment step opens. What comes back changes on a
  // deploy rather than while somebody is reading the page, so there is nothing
  // to poll — and a failure to ask is not shown as an error, because the tiles
  // already say the only thing this screen knows: none of them can be chosen
  // until the property has said which ones it collects through.
  useEffect(() => {
    let live = true;

    collectableGateways()
      .then((methods) => {
        if (live) {
          setCollectable(methods);
        }
      })
      .catch(() => {
        if (live) {
          setCollectable([]);
        }
      });

    return () => {
      live = false;
    };
  }, []);

  const namedOk = isNameAnswered(contact);
  const emailOk = isEmailAnswered(contact);
  const answered = isContactAnswered(contact);
  // What each tile may say about itself, decided in one place and read by the
  // radios, the blurbs and the press. `stay-funnel.ts` holds the rule, so the
  // three states are one derivation rather than a condition per reader.
  const offerOf = (method: GatewayPaymentMethod | undefined) =>
    gatewayOffer(method, collectable);

  // The provider tile the guest actually chose, and the method it opens an
  // attempt with — undefined for the card panel, for a tile this property
  // cannot collect through, and for one whose standing has not come back yet.
  // `complete()` reads its presence rather than a second list of accepted ids
  // kept level with `PROVIDERS` by hand.
  const chosen = PROVIDERS.find((option) => option.id === provider)?.method;
  const chosenMethod: GatewayPaymentMethod | undefined =
    how === "provider" && offerOf(chosen) === "offered" ? chosen : undefined;
  const nameWrong = asked && !namedOk;
  const emailWrong = asked && !emailOk;

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
   *
   * **An unfinished field takes the cursor as well as a message.** The press
   * that reaches here may have come from a bar pinned to the bottom of a phone,
   * with the field at fault scrolled off the top of the window; a line under the
   * button and nothing else would answer a guest who cannot see the question.
   * The browser scrolls a focused input into view for free.
   *
   * **A PayPal attempt does not leave from here.** VNPay is unchanged — the
   * gateway hands back no presentment, `confirming` stays null, and the browser
   * is sent on the moment the attempt is open. PayPal freezes a dollar figure
   * on the very row this call opens, and `contract/payment.ts` argues why that
   * frozen figure is the only one this property may ever show a payer: not a
   * quote computed here from today's rate, which could disagree with the rate
   * the row just froze the instant an `ADMIN` edits it. So a PayPal attempt
   * stops here and hands the interstitial exactly what the attempt returned,
   * and `continueToGateway` is the press that actually leaves.
   */
  /**
   * Which of the three refusals a press that cannot finish the booking gets.
   *
   * The card panel has its own, and the provider panel has two: a tile the
   * property has refused, and a press that arrived before the listing did. A
   * single sentence for the last two would tell a guest to choose a different
   * provider on the one occasion when the provider they chose is fine.
   */
  function refusalForPress(): string {
    if (how !== "provider") {
      return CARD_NOT_ACCEPTED;
    }

    return offerOf(chosen) === "unasked"
      ? PROVIDERS_NOT_KNOWN_YET
      : PROVIDER_NOT_ACCEPTED;
  }

  async function complete(): Promise<void> {
    if (leaving) {
      return;
    }

    setAsked(true);

    if (!answered) {
      // The first of the two, in the order they are read, so a guest with both
      // blank is put at the top of the pair rather than the bottom.
      (namedOk ? emailRef : nameRef).current?.focus();
      setNote(CONTACT_NEEDED);
      return;
    }

    if (!chosenMethod) {
      setNote(refusalForPress());
      return;
    }

    setLeaving(true);
    setNote(null);

    try {
      const named = await saveContact(stay, contact);
      const opened = await openPayment(named, chosenMethod);

      if (opened.presentment) {
        setConfirming({ ...opened, presentment: opened.presentment });
        setLeaving(false);
        return;
      }

      window.location.assign(opened.paymentUrl);
    } catch (error) {
      // The button comes back, because every refusal these calls can carry is
      // one a second press might get past — a gateway with no credentials
      // configured, a hold that has just expired, a network that was not
      // there, or the registry's `503` when a property has not finished
      // onboarding the gateway it was just asked for. Leaving it disabled
      // would strand a guest on a dead page.
      setLeaving(false);
      setNote(
        apiMessage(
          error,
          "The payment page could not be opened just now. Nothing has been charged.",
        ),
      );
    }
  }

  /**
   * Sends the payer on to PayPal, once they have seen what it will charge.
   *
   * The url is the one the attempt already returned — nothing is asked for
   * again, and the figure the guest just read is the figure the payer is
   * about to be shown at the gateway, because both came off the one row.
   */
  function continueToGateway(): void {
    if (!confirming || leaving) {
      return;
    }

    setLeaving(true);
    window.location.assign(confirming.paymentUrl);
  }

  /**
   * The press, however it was made.
   *
   * A `<form>` rather than a button with a handler, and the reason is the
   * keyboard: a guest who finishes typing an address and presses enter expects
   * that to be the press, and on a phone it is what turns the return key into
   * "Go". `noValidate` because the browser's own bubble would pre-empt the two
   * lines this screen answers its refusals on — the same argument the email
   * field's `inputMode` already makes.
   */
  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void complete();
  }

  // The interstitial replaces the form the moment PayPal's attempt is open,
  // rather than sitting inside it. It has one question left to ask — go, or
  // choose again — and a dialog layered over a form still holding a card
  // number and an address is a second, unrelated way to answer that question.
  if (confirming) {
    return (
      <PaypalConfirm
        leaving={leaving}
        onChooseAgain={() => {
          setConfirming(null);
          setNote(null);
        }}
        onContinue={continueToGateway}
        opened={confirming}
        stay={stay}
      />
    );
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
      <FunnelNav returnTo={`/booking/${encodeURIComponent(hold)}/details`} />

      <form className={styles.frame} noValidate onSubmit={onSubmit}>
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
                      <dt className={`${styles.factTerm} caps-label`}>
                        {fact.term}
                      </dt>
                    </div>
                  </div>
                ))}
              </dl>

              {/* A second look at the room rather than the summary's frame
                  again, so its description is worth having: it is the one thing
                  on this plate the guest has not already been shown.

                  The bar over its foot is what turns one photograph into a
                  gallery: it says which frame this is of how many, and the
                  press at the other end opens the rest of them. Without it the
                  strip is a decoration, and the four frames behind it are
                  reachable only by going back to the room list — which is a
                  different question, and the `Change` link's. */}
              <figure className={styles.shot}>
                <img
                  alt={second.alt}
                  className={styles.roomShot}
                  decoding="async"
                  height={second.height}
                  sizes={ROOM_SHOT_SIZES}
                  src={second.src}
                  srcSet={tierSrcSet(second)}
                  width={second.width}
                />

                {/* The wash under the bar. Ivory type over an unknown
                    photograph is a contrast bet, and the pixel that loses it is
                    the room's own name — `room-ground.module.css` seats its
                    counter the same way. */}
                <span aria-hidden="true" className={styles.shotScrim} />

                <figcaption className={styles.shotBar}>
                  <span className={styles.shotWhere}>
                    <span className={styles.shotCount}>
                      {pad(shotAt + 1)} / {pad(frames.length)}
                    </span>
                    <span className={styles.shotName}>{type.name}</span>
                  </span>

                  <span className={styles.shotAside}>
                    <span className={styles.shotSize}>
                      <Mark slug="size" />
                      {type.squareMetres} m²
                    </span>

                    {/* `type="button"`: it stands inside the form that completes
                        the booking, and a button with no type in a form is a
                        submit button. */}
                    <button
                      className={styles.shotOpen}
                      onClick={() => setShowing(true)}
                      type="button"
                    >
                      <Mark slug="photos" />
                      {frames.length} photos
                    </button>
                  </span>
                </figcaption>
              </figure>

              {/* What is in the room, in the property file's own words —
                  `room-facts.ts` reads them out of `ROOM_AMENITIES` rather than
                  letting this component write six hotel facts of its own. A
                  list, because that is what it is; the marks are `aria-hidden`
                  and the words carry it. */}
              <ul className={styles.chips}>
                {chips.map((chip) => (
                  <li className={styles.chip} key={chip.label}>
                    <Mark slug={chip.icon} />
                    {chip.label}
                  </li>
                ))}
              </ul>

              {/* The frames are the property's, and they are not this room. Said
                  once, quietly, under the photograph it is about — a guest who
                  arrives to a different lampshade was told. */}
              <p className={styles.caveat}>
                <Mark slug="info" />
                Images are for illustration purposes. Room layout and view may
                vary.
              </p>
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
                    aria-describedby={
                      nameWrong ? `${fieldIds}-name` : undefined
                    }
                    aria-invalid={nameWrong}
                    autoComplete="name"
                    className={styles.input}
                    disabled={leaving}
                    onChange={(event) =>
                      setContact({ ...contact, name: event.target.value })
                    }
                    placeholder="Enter your full name"
                    ref={nameRef}
                    type="text"
                    value={contact.name}
                  />
                  {/* `role="alert"` and mounted only when it says something: a
                      field message is about the field the cursor was just put
                      into, so it should be announced when it appears rather than
                      wait to be found. The screen's other region is the polite
                      one, under the button. */}
                  {nameWrong ? (
                    <span
                      className={styles.fieldNote}
                      id={`${fieldIds}-name`}
                      role="alert"
                    >
                      {NAME_NEEDED}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldTerm}>Email</span>
                  <input
                    aria-describedby={
                      emailWrong ? `${fieldIds}-email` : undefined
                    }
                    aria-invalid={emailWrong}
                    autoComplete="email"
                    className={styles.input}
                    disabled={leaving}
                    // `inputMode` and not `type="email"`, so the browser's own
                    // bubble does not pre-empt the lines this screen answers
                    // every other refusal on.
                    inputMode="email"
                    onChange={(event) =>
                      setContact({ ...contact, email: event.target.value })
                    }
                    placeholder="Enter your email address"
                    ref={emailRef}
                    type="text"
                    value={contact.email}
                  />
                  {emailWrong ? (
                    <span
                      className={styles.fieldNote}
                      id={`${fieldIds}-email`}
                      role="alert"
                    >
                      {EMAIL_NEEDED}
                    </span>
                  ) : null}
                </label>
              </div>

              <div className={styles.payHead}>
                <p className={`${styles.payTerm} caps-label`}>
                  Payment information
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
                  {PROVIDERS.map((option) => {
                    // Asked once per tile and read three times below, so a
                    // tile cannot say one thing with its border and another
                    // with its blurb. Refused is the only state that closes
                    // the radio: a tile still waiting on the listing stays
                    // pressable, because the press is checked again in
                    // `complete()` and answers with a sentence, whereas a
                    // control that disables itself for the length of one
                    // request loses the tap of anybody quick enough to make
                    // it.
                    const offer = offerOf(option.method);

                    return (
                      <label
                        className={styles.provider}
                        data-accepted={offer !== "refused"}
                        key={option.id}
                      >
                        <input
                          checked={provider === option.id}
                          className={styles.swapInput}
                          disabled={leaving || offer === "refused"}
                          name="pay-provider"
                          onChange={() => {
                            setProvider(option.id);
                            setNote(null);
                          }}
                          type="radio"
                          value={option.id}
                        />
                        <span className={styles.providerFace}>
                          <span
                            aria-hidden="true"
                            className={styles.providerDot}
                          />
                          <span className={styles.providerLines}>
                            <span className={styles.providerName}>
                              {option.name}
                            </span>
                            <span className={styles.providerBlurb}>
                              {option.method && offer === "refused"
                                ? NOT_COLLECTABLE
                                : option.blurb}
                            </span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
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

              {/* An arrival, the nights between, and a departure. An ordered
                  list because the three are a sequence and read as one — the
                  rail drawn beside them is `::before` on the marks, so nothing
                  in the reading order exists only to be a line. */}
              <ol className={styles.rail}>
                <Stop
                  date={longDate(checkIn)}
                  term="Check-in"
                  time={`Your room is ready from ${CHECK_IN_TIME}`}
                />

                <li className={styles.leg}>
                  <span aria-hidden="true" className={styles.legRule} />
                  <span className={styles.legValue}>
                    {countNights(checkIn, checkOut)}
                  </span>
                </li>

                <Stop
                  date={longDate(checkOut)}
                  last
                  term="Check-out"
                  time={`Checkout is at ${CHECK_OUT_TIME}`}
                />
              </ol>

              <dl className={styles.stayRows}>
                <StayRow
                  icon="guests"
                  term="Guests"
                  value={describeParty(stay)}
                />
                <StayRow
                  icon="tariff"
                  note={planTerm(stay.plan)}
                  term="Rate"
                  value={planName(stay.plan)}
                />
                {/* `screens.md`'s own answer to the typo risk, which nothing on
                    this screen used to carry out. Only once the address is
                    shaped like one: echoing back half of what is being typed
                    would be a summary that changes on every keystroke. */}
                {emailOk ? (
                  <StayRow
                    icon="mail"
                    term="Confirmation goes to"
                    value={contact.email.trim()}
                    wrap
                  />
                ) : null}
              </dl>

              {/* The server's deadline, never a duration counted here — and when
                  it falls due the stay is read again rather than assumed lost.
                  The sweep runs every two minutes, so a clock reaching zero
                  means the nights are *about* to go back, and only the API can
                  say whether they have. */}
              {expiresAt ? (
                <div className={styles.timer}>
                  <Mark slug="clock" />
                  <HoldTimer expiresAt={expiresAt} onExpired={onReread} />
                </div>
              ) : null}
            </div>

            {/* The money and the one press on it. A plate under the summary at a
                laptop's measure; a strip pinned to the bottom of the window
                below that, where the page it used to sit at the end of is two
                thousand pixels tall. */}
            <div className={styles.act}>
              <div className={styles.totalBlock}>
                <span className={`${styles.totalTerm} caps-label`}>Total</span>
                <span className={`${styles.totalFigure} font-display`}>
                  <Money amount={roundVndForDisplay(stayTotal(stay))} />
                </span>
                <span className={styles.totalNote}>
                  VAT and service included
                </span>
                {/* Only where the summary's own copy is off-screen. Hidden above
                    the stacking width by the stylesheet, not by a second render
                    — one deadline, one place it is announced from. */}
                {expiresAt ? (
                  <span className={styles.actClock}>
                    <HoldClock expiresAt={expiresAt} />
                  </span>
                ) : null}
              </div>

              <button
                className={styles.complete}
                data-complete-booking
                disabled={leaving}
                type="submit"
              >
                <span className={styles.completeLabel}>
                  {leaving ? "Opening the payment page…" : "Complete booking"}
                </span>
              </button>

              {/* Empty until something is refused, and present the whole time so
                  that it is. A live region added to the page at the moment it
                  has something to say is a region the screen reader was not
                  watching when the message arrived. */}
              <p
                className={styles.foot}
                data-said={Boolean(note)}
                role="status"
              >
                {note}
              </p>
            </div>
          </aside>
        </div>
      </form>

      {/* Outside the form, because a `<dialog>` inside one is a dialog whose
          Escape key and backdrop press are being read by a form that is about
          to take a payment. */}
      <RoomGallery
        frames={frames}
        name={type.name}
        onClose={() => setShowing(false)}
        open={showing}
        startAt={shotAt}
      />
    </main>
  );
}

/**
 * What PayPal will charge, quoted from the one row that can honestly say —
 * the screen a PayPal attempt lands on instead of the gateway.
 *
 * **The whole reason this component exists.** `stay-total.gross` is đồng and
 * PayPal collects dollars, so a payer approving a figure they were never shown
 * is a chargeback the property loses. The fix is not a converter drawn in this
 * app: `opened.presentment` is what `payment.service.ts` already froze onto
 * the row the instant the attempt opened, and this component's only job is to
 * print it — never to call {@link convertVndToPresentment} or anything like
 * it. A quote computed here would be a second read of the configured rate,
 * and the one property fact that must never be read twice for one guest is
 * the rate a payer is about to be charged at.
 *
 * `StayShell` for the same reason `payment-screen.tsx` stands on it: this is
 * a full screen of its own, between the review and the gateway, and the four
 * screens after a room choice already share one frame for exactly this kind
 * of interstitial.
 */
function PaypalConfirm({
  stay,
  opened,
  leaving,
  onContinue,
  onChooseAgain,
}: {
  readonly stay: HeldStay;
  readonly opened: ForeignAttempt;
  readonly leaving: boolean;
  readonly onContinue: () => void;
  readonly onChooseAgain: () => void;
}) {
  return (
    <StayShell
      footnote="You will be taken to PayPal to approve this charge. The property never sees your PayPal password. When you are finished PayPal brings you back here."
      stay={stay}
      step="Step 3 of 4"
      subtitle="This is the exact figure PayPal will ask you to approve, converted from the đồng total at the rate the property has just frozen for this attempt."
      title="Confirm with PayPal"
    >
      <div className={shellStyles.total}>
        <span className={shellStyles.totalLabel}>PayPal will charge</span>
        <span className={shellStyles.totalAmount}>
          {formatPresentment(opened.presentment)}
        </span>
      </div>

      <p className={shellStyles.notice} role="status">
        At {formatRate(opened.presentment.rate)} to US$1 — the property's own
        configured rate, frozen the moment this attempt opened.
      </p>

      <div className={shellStyles.actions}>
        <button
          className={shellStyles.submit}
          disabled={leaving}
          onClick={onContinue}
          type="button"
        >
          {leaving ? "Opening PayPal…" : "Continue to PayPal"}
        </button>

        <button
          className={shellStyles.secondary}
          disabled={leaving}
          onClick={onChooseAgain}
          type="button"
        >
          Choose a different way to pay
        </button>
      </div>
    </StayShell>
  );
}

/**
 * One end of the stay: a mark on the rail, the day, and the property's clock.
 *
 * The mark carries the rail as a `::before`, so the line between the two stops
 * is drawn by the things it connects rather than by an empty element sitting in
 * the reading order pretending to be one. `last` is what stops the line under
 * the departure, which would otherwise run off the bottom of the list.
 */
function Stop({
  term,
  date,
  time,
  last,
}: {
  readonly term: string;
  readonly date: string;
  readonly time: string;
  readonly last?: boolean;
}) {
  return (
    <li className={styles.stop} data-last={Boolean(last)}>
      <span aria-hidden="true" className={styles.stopMark} />
      <span className={styles.stopLines}>
        <span className={`${styles.stopTerm} caps-label`}>{term}</span>
        <span className={styles.stopDate}>{date}</span>
        <span className={styles.stopTime}>{time}</span>
      </span>
    </li>
  );
}

/** One labelled row of the summary: a glyph, the term, and what it says. */
function StayRow({
  icon,
  term,
  value,
  note,
  wrap,
}: {
  readonly icon: string;
  readonly term: string;
  readonly value: string;
  /** A second line qualifying the value — the rate plan's terms, and nothing else yet. */
  readonly note?: string;
  /** Lets a long value break mid-word. An address is the only thing that needs it. */
  readonly wrap?: boolean;
}) {
  return (
    <div className={styles.stayRow}>
      <Mark slug={icon} />
      <div className={styles.stayLines}>
        <dt className={`${styles.stayTerm} caps-label`}>{term}</dt>
        <dd className={styles.stayValue} data-wrap={Boolean(wrap)}>
          {value}
        </dd>
        {note ? <dd className={styles.stayNote}>{note}</dd> : null}
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
function Mark({ slug }: { readonly slug: string }): ReactNode {
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
/**
 * "Mon 19 August 2026" — the property's own date, never the browser's instant.
 *
 * The weekday leads, which it did not before the dates became a rail. A guest
 * checking a stay is checking whether it lands on the weekend they meant, and
 * that is a question "19 August" cannot answer without a calendar open beside
 * it.
 */
function longDate(date: CalendarDate): string {
  // "UTC" is safe here and only here: a `CalendarDate` converted at UTC midnight
  // formats as itself, which is the point. A browser at UTC+9 parsing the ISO
  // text and formatting locally renders the day before, silently, for exactly
  // the guests most likely to book a resort in Vietnam.
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
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
 * The party as it was priced: adults, and every child by the age that priced it.
 *
 * **It used to be a head count, and that was the wrong answer on a review
 * screen.** "3 guests" is true of two adults and a six-year-old and equally true
 * of three adults, and `property-and-tariff.md` §3 charges those two parties
 * differently — under 6 free, 6 to 11 at half the extra-person rate, 12 and over
 * as an adult. A guest asked to check a total against what they chose cannot do
 * it against a figure that has had the deciding fact summed out of it.
 *
 * The ages are printed as `party-rows.tsx` collects them, "under 1" and all, so
 * the words on the screen that took the answer are the words on the screen that
 * reads it back.
 */
function describeParty(stay: HeldStay): string {
  const adults = stay.adults === 1 ? "1 adult" : `${stay.adults} adults`;

  if (stay.childAges.length === 0) {
    return adults;
  }

  const children =
    stay.childAges.length === 1
      ? "1 child"
      : `${stay.childAges.length} children`;
  const ages = new Intl.ListFormat("en-GB", {
    style: "long",
    type: "conjunction",
  }).format(stay.childAges.map((age) => (age === 0 ? "under 1" : String(age))));

  return `${adults}, ${children} aged ${ages}`;
}
