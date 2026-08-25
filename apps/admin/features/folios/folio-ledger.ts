/* The folios screen's decisions: which accounts the desk asked the API for,
 * what one account's ledger reads like line by line, and how a correction is
 * shown as the entry it is rather than as a number that quietly changed.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/guests/guest-record.ts` and `features/rooms/room-list.ts` both
 * give: everything below is a judgement the API does not make for the console —
 * whether what an operator typed is a query the contract will take, what order
 * the lines of one account are read in, which line was levied on which sale,
 * which correction undoes which line, and what the account comes to after each
 * of them.
 *
 * Four rules hold throughout, and `folio-ledger.spec.ts` holds this file to
 * them:
 *
 * 1. **Nothing is netted off and nothing disappears.** A reversal is a line of
 *    its own, and the line it corrects keeps its own amount and its own place.
 *    `FR-FOL-01` makes the ledger append-only — a mistake is corrected by a
 *    reversing entry, never an `UPDATE` or a `DELETE` — and a console that
 *    collapsed the pair into one adjusted figure would hide exactly what
 *    `screens.md` says this screen exists to show. {@link ledgerLines} carries
 *    both directions of the pair, so the correction names what it undid and the
 *    corrected line says a correction stands against it.
 * 2. **A decomposed sale stays several lines.** `FR-FOL-02` posts VAT and the
 *    service charge beside the charge they were levied on, and
 *    `property-and-tariff.md` §5 says the folio view is *never* gross — the
 *    guest is quoted one figure and the account shows its components.
 *    {@link ledgerLines} groups the components under the sale so the relation is
 *    legible, and never adds them together into a row of its own.
 * 3. **Whole đồng, added as `bigint`.** The running total is the plain sum of
 *    the amounts in the order they are read, which is why it ends on the same
 *    figure the API derived for `outstanding`. No rounding, no float and no
 *    division anywhere: `money.ts` chose `bigint` precisely so this arithmetic
 *    cannot be done in a type that loses đồng.
 * 4. **An order that cannot move under the reader.** The wire promises no order
 *    inside a single instant — the three lines of one sale are written by one
 *    statement and share one `postedAt` — so this file imposes a total one.
 *    A ledger re-shuffled by a refetch under somebody reading down it is a
 *    ledger nobody can check.
 *
 * The screen is read-only, and that is a property of the module too: nothing
 * here builds a posting, a reversal, a refund or a close. Those are five routes
 * with four capabilities behind them, worked from Departures and Payments, and
 * a helper here that shaped one of their requests would be this family growing
 * an act `rbac-matrix.md` puts somewhere else.
 */

import {
  type ChargeBasis,
  FOLIO_PAGE_SIZE,
  listFoliosInput as filterSchema,
  formatVnd,
  postingTypeSchema,
} from "@mariva/shared";

/* The account's own shapes, taken from the modules that already own them rather
 * than restated. `features/departures` reads one stay's account to settle it and
 * `features/dashboard` counts the accounts that are still short, so both shapes
 * exist; a third copy here would be a third opinion about two routes. Both are
 * reached past their family's barrel, for the reason `room-list.ts` gives about
 * `board-queries`: a spec for a pure module must not drag a screen — and the
 * cache under it — in behind a type. Both modules are themselves pure. */
import type {
  FolioListQuery,
  FolioPage,
} from "@/features/dashboard/day-counts";
import type { FolioPosting } from "@/features/departures/departure-queue";
/* The console's one rendering of an instant in the property's zone, taken from
 * the module that owns it rather than a fourth `Intl.DateTimeFormat` beside it.
 * A ledger reaches back further than a guest record does, which is exactly why
 * this is the formatter to reuse: it carries the year, and a posting from last
 * month printed as "16 Aug 09:05" is a date a reader has to guess at. */
import { formatInstant } from "@/features/guests/guest-record";
import { parseLiberalDate } from "@/lib/date-parser";

/** One account as the collection answers it — no lines, just what it comes to. */
export type ListedFolio = FolioPage["folios"][number];

/** The three figures `NFR-02` asks for, derived by the API on every read. */
export type FolioSummary = ListedFolio["summary"];

/** Open, or agreed and closed. */
export type FolioState = ListedFolio["state"];

/** What a line is, as `posting_type` spells it. */
export type PostingType = FolioPosting["type"];

/**
 * What each kind of line is called on screen.
 *
 * A `Record` over the contract's own union rather than a lookup with a
 * fallback: a ninth posting type added to `contract/folio.ts` stops this file
 * compiling, where a `?? posting.type` would quietly print a database enum at a
 * receptionist. The service charge and VAT are named apart from the charge they
 * were levied on because §5 requires the account to show them apart.
 */
export const POSTING_LABELS: Record<PostingType, string> = {
  ROOM_CHARGE: "Room charge",
  SERVICE_ITEM: "Service",
  SERVICE_CHARGE_FEE: "Service charge",
  VAT: "VAT",
  POLICY_CHARGE: "Policy charge",
  PAYMENT: "Payment",
  REFUND: "Refund",
  REVERSAL: "Reversal",
};

/**
 * Which row of `property-and-tariff.md` §4's grid a policy charge came off.
 *
 * It is printed because the amount alone cannot say it: a cancellation inside
 * the free window and a penalty nobody applied are both nothing, and `NONE` is a
 * row of the grid rather than the absence of one. `contract/folio.ts` carries
 * the basis on the line for this reason, and dropping it here would throw away
 * the only thing that tells the two apart.
 */
export const CHARGE_BASIS_LABELS: Record<ChargeBasis, string> = {
  NONE: "No charge — inside the free window",
  FIRST_NIGHT: "The first night",
  FULL_STAY: "The whole stay",
  REMAINING_NIGHTS_HALF: "Half of the nights left",
  REMAINING_NIGHTS_FULL: "All of the nights left",
};

/** What an account is, in one word — for the row and for the ledger's head. */
export const FOLIO_STATE_LABELS: Record<FolioState, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
};

/** How an account stands against what it has been paid. */
export type Standing = "SETTLED" | "OUTSTANDING" | "OVERPAID";

/**
 * Which of the three an account is.
 *
 * Three and not two, because an over-paid stay is a discrepancy rather than a
 * settled one: the property is holding money it owes back, `check-out.guard.ts`
 * refuses the checkout in both directions, and `listFoliosInput`'s own
 * `OUTSTANDING` is `outstanding <> 0` for exactly that reason. A console that
 * folded an over-payment into "settled" would report the property square while
 * a guest is owed a refund.
 *
 * Not `balanceDue`/`overpayment` from `features/departures` reused: those take
 * the whole account and answer a checkout's two separate questions with two
 * figures. This answers one three-way question that a column prints, off the
 * summary alone — which is all a listed account carries.
 */
export function standing(summary: FolioSummary): Standing {
  if (summary.outstanding > 0n) {
    return "OUTSTANDING";
  }

  return summary.outstanding < 0n ? "OVERPAID" : "SETTLED";
}

/**
 * The same reading as a sentence, with the figure the desk acts on.
 *
 * The over-payment is said as a positive amount, because "−1.500.000 ₫
 * outstanding" is a figure a reader has to translate before they can act on it,
 * and what they do with it — hand it back — is not the negative of collecting.
 */
export function standingLabel(summary: FolioSummary): string {
  switch (standing(summary)) {
    case "SETTLED":
      return "Settled";
    case "OUTSTANDING":
      return `${formatVnd(summary.outstanding)} outstanding`;
    case "OVERPAID":
      return `${formatVnd(-summary.outstanding)} over-paid`;
  }
}

/** What the operator chose in the filters, before any of it is read. */
export interface FolioFilterFields {
  /** `ANY` is the absent filter — the route takes no state at all for it. */
  state: FolioState | "ANY";
  /** The contract's three widths, taken from the route rather than retyped:
   *  every account, every account that fails to balance, or only the ones the
   *  property owes money back on. Derived so that a member added to
   *  `listFoliosInput` reaches every screen that switches on this. */
  balance: NonNullable<FolioListQuery["balance"]>;
  from: string;
  to: string;
}

/**
 * What the screen opens on: every account still short, whatever its state.
 *
 * Outstanding rather than everything, and that is the dashboard's promise kept.
 * Its *Unsettled folios* card counts `balance: "OUTSTANDING"` and leads here, so
 * a receptionist who pressed a figure and landed on a longer list would have
 * been shown a count that named a set the screen then declined to draw.
 * `contract/folio.ts` shapes the collection as that worklist in as many words —
 * "it answers which accounts across the property are still short". Every other
 * account is one press away on the balance filter.
 *
 * No state filter, for `dashboard-queries.ts`'s reason: an account only closes
 * once it settles, so a closed folio that is still short is a discrepancy and
 * exactly the thing a filter on `OPEN` would hide.
 */
export const DEFAULT_FOLIO_FILTERS: FolioFilterFields = {
  state: "ANY",
  balance: "OUTSTANDING",
  from: "",
  to: "",
};

/** Either a query the contract will take, or the sentence that says why not. */
export type FolioFilterAttempt =
  | { readonly input: FolioListQuery }
  | { readonly problem: string };

/**
 * The filters as `listFoliosInput` takes them, and the page being asked for.
 *
 * Dates go through `parseLiberalDate` against the property's business date like
 * every other date on the console — "-7d", "15/3", "today" — and an empty field
 * is an absent filter rather than a refusal, because each end of the range is
 * optional on its own. The business date is only needed when something was
 * typed: the opening list has no dates in it, so a day that has not arrived yet
 * does not hold the accounts back.
 *
 * The window is the trading days the account had lines on, which is the only
 * business date a folio has. Both ends are inclusive, and the summary that comes
 * back is still the whole account's — `contract/folio.ts` is explicit that a
 * balance computed from a window would be a fraction of what the guest owes
 * printed under the word outstanding, so nothing here narrows the figures.
 *
 * `offset` is the screen's, not the operator's: it is rows to skip and it is
 * reset by every change of filter, because a page four of one question is not a
 * page four of the next.
 */
export function folioFilters(
  fields: FolioFilterFields,
  businessDate: string | null,
  offset: number,
): FolioFilterAttempt {
  const typedFrom = fields.from.trim();
  const typedTo = fields.to.trim();

  if ((typedFrom !== "" || typedTo !== "") && businessDate === null) {
    return {
      problem:
        "The property's day has not been read yet, and a typed date is counted from it. Try again.",
    };
  }

  const from =
    typedFrom === "" ? null : parseLiberalDate(typedFrom, businessDate ?? "");
  const to =
    typedTo === "" ? null : parseLiberalDate(typedTo, businessDate ?? "");

  if (typedFrom !== "" && from === null) {
    return {
      problem:
        "The first day is not a date this screen can read. Type 15/3, 2026-03-15, today or -7d.",
    };
  }

  if (typedTo !== "" && to === null) {
    return {
      problem:
        "The last day is not a date this screen can read. Type 15/3, 2026-03-15, today or -7d.",
    };
  }

  // Compared as text, which is exact for `YYYY-MM-DD` and needs no calendar:
  // the contract refuses the same pair, and refusing it here is that sentence
  // said in the property's words where the operator can still fix it.
  if (from !== null && to !== null && from > to) {
    return {
      problem:
        "The last day falls before the first. Swap them, or clear one of the two.",
    };
  }

  const input: FolioListQuery = {
    ...(fields.state === "ANY" ? {} : { state: fields.state }),
    balance: fields.balance,
    ...(from === null ? {} : { from }),
    ...(to === null ? {} : { to }),
    // Stated rather than left to the route's own default, even though the two
    // are the same figure. The pager steps by this number, and a page size the
    // request did not name is a step the screen would be guessing.
    limit: FOLIO_PAGE_SIZE,
    offset,
  };

  // The contract's own schema run here rather than restated, so a bound changed
  // in `packages/shared/src/contract/folio.ts` cannot drift from what this form
  // enforces. What is *sent* is the typed input and never the parsed output — a
  // decoded `CalendarDate` is a shape for a service to hold, not one to put on
  // the wire.
  const checked = filterSchema.safeParse(input);

  if (!checked.success) {
    return {
      problem:
        checked.error.issues[0]?.message ??
        "That is not a set of filters the API takes.",
    };
  }

  return { input };
}

/**
 * The query the screen opens on: {@link DEFAULT_FOLIO_FILTERS}, first page.
 *
 * Derived from the same fields the form is drawn from rather than written out a
 * second time, so what the operator sees selected and what the first request
 * actually asked for cannot drift apart.
 */
export function openingQuery(): FolioListQuery {
  const attempt = folioFilters(DEFAULT_FOLIO_FILTERS, null, 0);

  if ("problem" in attempt) {
    // Unreachable, and thrown rather than quietly replaced by some other query:
    // the only refusal {@link folioFilters} has is about a typed date, the
    // opening fields carry none, and a screen that silently opened on filters
    // nobody chose would be lying about what it is showing.
    throw new Error(attempt.problem);
  }

  return attempt.input;
}

/** Where in the collection this page sits, in the words a pager needs. */
export interface PageWindow {
  /** The 1-based row this page starts at, and 0 when it holds nothing. */
  readonly first: number;
  /** The 1-based row it ends at. */
  readonly last: number;
  /** Every account the filters matched, counted by the API under the same
   *  predicate the page was cut from. */
  readonly total: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** The offset each of the two presses asks for. */
  readonly previousOffset: number;
  readonly nextOffset: number;
}

/**
 * What the pager says, and what its two presses ask for next.
 *
 * `total` is the API's count under the filters rather than the length of what
 * came back, which is what lets the screen say "50 of 213" instead of a page
 * size dressed up as a figure. The order behind the offsets is total and stable
 * — newest account first, the id breaking a tie — so stepping by a page shows
 * each account once.
 *
 * The next offset steps by the page that was asked for rather than by the rows
 * that came back, because a short page is the end of the collection and not a
 * gap in it.
 */
export function pageWindow(
  total: number,
  shown: number,
  offset: number,
  limit: number,
): PageWindow {
  return {
    first: shown === 0 ? 0 : offset + 1,
    last: offset + shown,
    total,
    hasPrevious: offset > 0,
    hasNext: offset + shown < total,
    previousOffset: Math.max(0, offset - limit),
    nextOffset: offset + limit,
  };
}

/** One line of the account, with everything a reader needs around it. */
export interface LedgerLine {
  readonly posting: FolioPosting;
  /**
   * True when this line was levied on the sale above it — the service charge
   * and the VAT of `FR-FOL-02`. The sale itself is false, and so is every line
   * that stands on its own.
   */
  readonly levied: boolean;
  /** The line this one undoes, when it is a correction. */
  readonly reverses: FolioPosting | null;
  /** The correction filed against this line, when one has been. The line keeps
   *  its own amount either way — nothing here nets the pair off. */
  readonly reversedBy: FolioPosting | null;
  /** What the account comes to once this line is counted. */
  readonly runningTotal: bigint;
}

// The order the components of one sale are read in, taken from the contract's
// own enum rather than written out again. The three lines of a sale share an
// instant, so nothing about when they were written can separate them — and a
// tie broken by whatever order the rows arrived in is a ledger that re-orders
// itself under the reader on the next refetch.
const TYPE_ORDER: readonly PostingType[] = postingTypeSchema.options;

function byPostedThenId(left: FolioPosting, right: FolioPosting): number {
  return (
    left.businessDate.localeCompare(right.businessDate) ||
    left.postedAt.localeCompare(right.postedAt) ||
    left.id.localeCompare(right.id)
  );
}

function byTypeThenId(left: FolioPosting, right: FolioPosting): number {
  return (
    TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * The account as it is read down: every line, in order, each with its pair and
 * the balance it leaves behind.
 *
 * **Every posting appears exactly once.** The list is a permutation of what came
 * back and nothing is filtered, folded or summed away, which is what makes the
 * final running total the same figure the API derived for `outstanding` — that
 * identity is the ledger's own, and this file is only allowed to re-order.
 *
 * **A sale carries its components.** A line naming a `parentPostingId` is drawn
 * under the sale it was levied on, in the contract's own type order, so the
 * charge, the 5% service charge and the VAT read as the three lines §5 requires
 * them to be. A component whose parent is not in the answer — which the page
 * cannot produce, since a folio is read whole — falls back to standing on its
 * own rather than disappearing.
 *
 * **A correction is a line, and so is what it corrected.** A `REVERSAL` names
 * the posting it undoes and both ends of that pair are carried here: the
 * reversal knows what it reversed, and the reversed line knows a correction
 * stands against it. Neither is hidden and neither amount is adjusted, because
 * the append-only ledger is the product's integrity story and a net view would
 * hide the screen's purpose.
 */
export function ledgerLines(
  postings: readonly FolioPosting[],
): readonly LedgerLine[] {
  const byId = new Map(postings.map((posting) => [posting.id, posting]));

  const corrections = new Map<string, FolioPosting>();
  const levies = new Map<string, FolioPosting[]>();
  const sales: FolioPosting[] = [];

  for (const posting of postings) {
    if (posting.reversesPostingId !== null) {
      corrections.set(posting.reversesPostingId, posting);
    }

    const parent = posting.parentPostingId;

    if (parent !== null && byId.has(parent)) {
      const group = levies.get(parent);

      if (group === undefined) {
        levies.set(parent, [posting]);
      } else {
        group.push(posting);
      }
    } else {
      sales.push(posting);
    }
  }

  const ordered: { posting: FolioPosting; levied: boolean }[] = [];

  for (const sale of [...sales].sort(byPostedThenId)) {
    ordered.push({ posting: sale, levied: false });

    for (const levy of (levies.get(sale.id) ?? []).sort(byTypeThenId)) {
      ordered.push({ posting: levy, levied: true });
    }
  }

  let running = 0n;

  return ordered.map(({ posting, levied }) => {
    // `bigint` throughout, per `money.ts`: whole đồng added to whole đồng, with
    // no step anywhere that could round or widen into a float.
    running += posting.amount;

    return {
      posting,
      levied,
      reverses:
        posting.reversesPostingId === null
          ? null
          : (byId.get(posting.reversesPostingId) ?? null),
      reversedBy: corrections.get(posting.id) ?? null,
      runningTotal: running,
    };
  });
}

/**
 * Who wrote a line and when, in the property's own zone.
 *
 * The instant and not the business date, because they answer different
 * questions and the ledger prints both: the trading day a line *belongs* to is
 * decided by §2's rollover, and this is the moment somebody's keystroke landed.
 * A charge filed at 01:00 by the night audit belongs to the day that has not
 * rolled yet, and only this half says when it was actually written.
 *
 * A line with no author is said to have none, and said in a way that names the
 * two things it can be. `postedBy` is null for the rows nobody decided on — the
 * night audit's sweep and the gateway's callback — and printing "posted by —"
 * would read like a name the console failed to look up rather than a line no
 * person authored.
 */
export function postedLabel(posting: FolioPosting): string {
  const written = formatInstant(posting.postedAt);

  return posting.postedBy === null
    ? `${written}, by the night audit or the payment gateway`
    : `${written}, by ${posting.postedBy}`;
}

/**
 * How many corrections stand on this account.
 *
 * Counted so the ledger can say it in a sentence before the reader reaches the
 * lines. An account with corrections on it is not a damaged account — it is one
 * where a mistake was answered the only way the ledger allows — and saying how
 * many there are is the difference between a reader noticing the pairs and a
 * reader hunting for them.
 */
export function correctionCount(postings: readonly FolioPosting[]): number {
  return postings.filter((posting) => posting.reversesPostingId !== null)
    .length;
}

/**
 * True when the lines on screen add up to the balance printed above them.
 *
 * `NFR-02` is the identity `Σ postings = Σ payments + outstanding`, and
 * `contract/folio.ts` derives `outstanding` as the plain sum of the amounts on
 * every read. So the last running total and that figure are one number computed
 * twice, on two machines, and a disagreement means the console is drawing a
 * ledger that does not come to the total beside it. The screen says so rather
 * than picking one of the two to believe. An account with no lines is compared
 * too — the sum of nothing is nothing, and an opening balance from somewhere
 * else is exactly the discrepancy worth naming.
 */
export function ledgerAgrees(
  lines: readonly LedgerLine[],
  summary: FolioSummary,
): boolean {
  return (lines.at(-1)?.runningTotal ?? 0n) === summary.outstanding;
}
