// The routes behind `booking-state-machine.md` §2 — every transition a booking
// makes, and nothing that does not change its state.
//
// The split from `assignment.controller.ts` is §5's own line, drawn through the
// two services rather than invented here: these change the state and each is a
// transition plus the effects §3 gives it; those change what the stay is made of
// and never consult the transition table. One controller per service is what
// keeps the boundary visible from the routing table.
//
// **The transaction is opened here, and only here.** `database.module.ts` says
// why a service takes its executor: a transition consumes or releases inventory,
// rewrites a room hold, writes a registration record and at `M6` will post a
// folio line beside them, and all of it is one commit. `closure.controller.ts`
// draws the same boundary for a much smaller write and gives the argument.
//
// **No logic lives in a handler.** Every one of these is a capability
// declaration, a transaction, one service call, and the wire crossing
// `stay-date.ts` asks for. The guards, the transition table and §4's idempotency
// rule are `booking.service.ts`'s — a handler that re-checked any of them would
// be a second opinion reachable only over HTTP, which is the half of the system
// no service test covers.
//
// **Twelve capability rows govern sixteen routes**, and which row governs which
// is `rbac-matrix.md`'s §3, not this file's judgement. Rows are read more than
// once where two routes are one authority — a walk-in and the deposit that
// confirms a hold are both "create / modify booking", and the guest's own reads
// are four routes under one row — and two of the twelve are the policy/override
// pair §2 refuses to let collapse into one endpoint with a check inside it.
//
// **Seven of the sixteen are the guest's**, and they are the only handlers here
// that finish a decision the guard could not. The funnel's creation grants a
// guest a booking; the rest let that guest read it, say who to write to, keep it
// alive while they are still on it, price calling it off and call it off.
// `rbac-matrix.md` grants every one of those rows `⚠` — the guard admits the
// caller and the ownership check is still owed — and the way it is paid is the
// same every time: what the guard resolved is handed to the service as half of
// the lookup, so the scope is a `where` clause rather than a comparison a handler
// could forget. §2 puts it plainly: "Guest permissions are always scoped to the
// requester's own record."
//
// **What the guard resolves is now one of two credentials.** A guest who books
// without an account has no session, so the hold issues a booking-scoped token
// and those two routes accept it — `booking-token.service.ts` for what it is and
// `access.guard.ts` for the ceiling on it. Nothing about the ownership check
// softens: an account scopes the lookup to `user_id`, a token scopes it to the
// one booking it was minted for, and both are the `where` clause.

import {
  contract,
  PROPERTY_TIME_ZONE,
  type CancellationReason,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
} from "@mariva/shared";
import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import type { Request, Response } from "express";
import {
  CurrentPrincipal,
  RequiresCapability,
  SessionOnly,
  Unguarded,
} from "../../common/auth/access.decorators.js";
import { JsonRequestGuard } from "../../common/auth/json-request.guard.js";
import type { Principal } from "../../common/auth/principal.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import {
  type Booking,
  type BookingOwner,
  BookingService,
  type CreateBookingInput,
} from "./booking.service.js";
import { callerOf } from "./caller-key.js";
import { HoldRateLimitGuard } from "./hold-rate-limit.guard.js";
import { PresenceRateLimitGuard } from "./presence-rate-limit.guard.js";

/** The stay as it arrived, in the shape the service takes. */
interface CreateBookingBody {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly adults: number;
  readonly childAges: readonly number[];
}

@Controller()
export class BookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly transactions: TransactionRunner,
    private readonly bookingTokens: BookingTokenService,
  ) {}

  /**
   * The public funnel's booking — §2's *(new)* → `HELD`.
   *
   * `booking.create-own` is the guest-realm row, and it is the first of this
   * file's three. `FR-BOOK-02` gives the funnel this door alone, which is why
   * the walk-in below is a different path behind a different row rather than a
   * flag on this one.
   *
   * The one guest row that owes no ownership check, and the reason is the order
   * of events: there is no record yet for the caller to be the owner of. What
   * this route *writes* is the ownership the other two read.
   *
   * The account comes off the session and never off the body, the same rule the
   * waiver below keeps. An account id a caller could send is a guest attaching
   * their booking to somebody else's history — and `FR-GST-01` scopes every
   * read of that history to the requester, so the write has to be scoped by the
   * same authority the read will be.
   *
   * **The caller travels with the stay, and it is the same caller the guard
   * counted.** `HoldRateLimitGuard` bounds how often this address may ask;
   * `booking.service.ts` bounds how many rooms it may be holding when it stops
   * asking, and the two are one policy only if they agree about who asked — so
   * both read `caller-key.ts` off the address the proxy reported rather than
   * each deciding for itself. Passed raw and stored hashed: nothing in this
   * request needs an address, and `schema/booking.ts` says why the column may
   * not hold one.
   *
   * Staff are not exempt, and there is nothing to exempt them from that the
   * limiter above does not already apply. A receptionist reaching this row is
   * taking a funnel booking on somebody's behalf and holds the room exactly as
   * a guest would; the walk-in they take at the counter goes through
   * {@link createConfirmed}, which has no TTL and so nothing to cap.
   *
   * **The stay the browser already holds travels with the request, and it comes
   * off the cookie rather than out of the body.** Picking a room is a move: the
   * guest comparing a second room type is leaving the first, and the hold they
   * are leaving is the one their own credential names. That credential is
   * already on this request — `booking-token.service.ts` scopes the cookie to
   * `/bookings` — so nothing was added to the wire to make the release
   * possible, and a booking id a caller could *send* is exactly what this must
   * not be: it would be a way to ask the property to release a hold on the
   * strength of knowing its id.
   *
   * Read here rather than taken from the resolved principal, because this row
   * is public and the principal on it is whatever else arrived. A guest who
   * signed in mid-funnel resolves as their session and is still the same
   * browser carrying the same hold.
   */
  @UseGuards(HoldRateLimitGuard)
  @RequiresCapability("booking.create-own")
  @Implement(contract.booking.createHold)
  createHold(
    @CurrentPrincipal() principal: Principal | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return implement(contract.booking.createHold).handler(async ({ input }) => {
      // Null for a browser holding nothing, one whose credential has expired,
      // and one presenting a token this property did not sign — all three are a
      // first room pick as far as this route is concerned, and the service
      // matches the caller against the row before it releases anything.
      const carried = this.bookingTokens.verify(
        this.bookingTokens.presentedOn(request),
      );

      const held = await this.transactions.run((exec) =>
        this.bookings.createHold(exec, {
          ...asCreateInput(input),
          userId: bookingAccount(principal),
          caller: callerOf(request.ip ?? request.socket.remoteAddress),
          replaces: carried?.bookingId ?? null,
        }),
      );

      // The credential that makes the next four screens reachable, issued
      // inside the same request that created the thing it names. A guest with
      // no account has no session for the ownership check to be about, and
      // `booking-token.service.ts` argues why the answer is a token rather
      // than an account created from the address just typed.
      //
      // Same name and same path, so it replaces the one the browser arrived
      // with — and that overwrite is now the other half of a move rather than a
      // stay quietly going out of reach. The hold the old cookie named has just
      // been released against the same request, so what the browser is losing
      // the address of is a booking that no longer holds a room.
      //
      // Issued to a signed-in guest as well, and deliberately: the funnel does
      // not ask whether anyone is signed in, the cookie is the same width
      // either way — one stay — and a browser that signs out mid-funnel keeps
      // the stay it was part-way through paying for. The guard prefers the
      // session when both arrive.
      //
      // Not to staff. The matrix lets a receptionist reach this row to take a
      // booking on somebody's behalf, and the stay is filed under nobody; a
      // credential for a guest's stay left in a desk browser for a week after
      // checkout is authority the desk was never meant to keep.
      if (principal?.realm !== "staff") {
        this.bookingTokens.issue(response, {
          bookingId: held.id,
          reference: held.reference,
          expiresAt: this.bookingTokens.expiryFor(
            held.checkOut.toDate(PROPERTY_TIME_ZONE),
          ),
        });
      }

      return onWire(held);
    });
  }

  /**
   * The front desk's booking — §2's *(new)* → `CONFIRMED`, no TTL.
   *
   * `booking.write` is "Create / modify booking", which is `RECEPTIONIST` and
   * above and denied to a guest. That denial is the enforcement of §2's "only
   * the public funnel starts at `HELD`" read the other way round: a guest
   * cannot write themselves a confirmed stay with no deposit behind it.
   *
   * **The contact comes off the body here and off no other creating route.**
   * This stay is `CONFIRMED` from birth, so it never becomes a hold and never
   * reaches {@link setOwnHoldContact}: a telephone booking that could not name
   * an address at creation would have none for the rest of its life, and the
   * cancellation and pre-arrival messages would have nowhere to go.
   * `contract/booking.ts` argues why the funnel's door still does not take it.
   *
   * It is an address and not an authority. Nothing is granted by naming one —
   * the stay is filed under nobody, exactly as a walk-in is, and
   * {@link attachToAccount} is the only route that gives a booking an owner.
   */
  @RequiresCapability("booking.write")
  @Implement(contract.booking.createConfirmed)
  createConfirmed() {
    return implement(contract.booking.createConfirmed).handler(
      async ({ input }) =>
        onWire(
          await this.transactions.run((exec) =>
            this.bookings.createConfirmed(exec, {
              ...asCreateInput(input),
              // Whole or absent, which the schema has already held the body to
              // — so one half being present is enough to know both are.
              contact:
                input.contactEmail === undefined ||
                input.contactName === undefined
                  ? null
                  : { email: input.contactEmail, name: input.contactName },
            }),
          ),
        ),
    );
  }

  /** `HELD` → `CONFIRMED` — the deposit was taken. */
  @RequiresCapability("booking.write")
  @Implement(contract.booking.confirm)
  confirm() {
    return implement(contract.booking.confirm).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.confirm(exec, input.bookingId),
        ),
      ),
    );
  }

  /**
   * Cancelling at the policy penalty — `booking.cancel-policy`, `RECEPTIONIST`
   * and above.
   *
   * The amount is not computed here and is not returned.
   * `cancellation-calculator.ts` prices `property-and-tariff.md` §4's grid and
   * persists nothing, and `M6` is the milestone that posts it; `plans/backlog.md`
   * §1 still records `D3`, which owes the grid's own numbers. What this route
   * settles is the transition and who authorised it.
   */
  @RequiresCapability("booking.cancel-policy")
  @Implement(contract.booking.cancel)
  cancel() {
    return implement(contract.booking.cancel).handler(async ({ input }) =>
      this.cancelled({
        bookingId: input.bookingId,
        reason: input.reason,
        waivedBy: null,
      }),
    );
  }

  /**
   * Cancelling with the penalty waived — `booking.cancel-waiver`, `MANAGER` and
   * `ADMIN`.
   *
   * Two endpoints and not one with a flag, which is `rbac-matrix.md` §2's own
   * shape: "policy vs override are separate endpoints, not one endpoint with an
   * amount check". What separates them below the guard is what this route
   * *writes* — the waiver's instant and the manager who granted it, onto the
   * booking. That is the correction this route needed: the capability admitted
   * the caller and then decided nothing, because a guard is an authorisation
   * event and the folio prices §4's grid later, on another request, under
   * `folio.refund-policy`. A receptionist reaching that route on a waived stay
   * was charged the grid's penalty in full and holds no capability to reverse
   * it. With the columns written here, `folio.service.ts` reads the waiver and
   * posts the charge at nothing.
   *
   * The manager comes off the session and never off the body — the same rule
   * `folio.controller.ts` keeps for a reversal and a discretionary refund, and
   * for the same reason: a waiver an invoice cannot attribute is an authority
   * nobody claimed.
   */
  @RequiresCapability("booking.cancel-waiver")
  @Implement(contract.booking.cancelWithWaiver)
  cancelWithWaiver(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.cancelWithWaiver).handler(
      async ({ input }) =>
        this.cancelled({
          bookingId: input.bookingId,
          reason: input.reason,
          waivedBy: attributedStaff(principal, "waive a cancellation penalty"),
        }),
    );
  }

  /** `CONFIRMED` → `CHECKED_IN` — the guest is in the building. */
  @RequiresCapability("booking.check-in")
  @Implement(contract.booking.checkIn)
  checkIn() {
    return implement(contract.booking.checkIn).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.checkIn(exec, {
            bookingId: input.bookingId,
            guests: input.guests,
          }),
        ),
      ),
    );
  }

  /** `CHECKED_IN` → `CHECKED_OUT` — the stay is over and the folio balances. */
  @RequiresCapability("booking.check-out")
  @Implement(contract.booking.checkOut)
  checkOut() {
    return implement(contract.booking.checkOut).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.checkOut(exec, input.bookingId),
        ),
      ),
    );
  }

  /**
   * `CONFIRMED` → `NO_SHOW`, by hand — `booking.mark-no-show`, `MANAGER` and
   * `ADMIN`.
   *
   * The row's own note is "night audit does it automatically", and that sweep
   * reaches the same service method without passing through here. This route is
   * for the manager who knows before the audit runs, and the narrower grant is
   * the matrix's: writing a stay off is a commercial act, and the automatic path
   * has a business date behind it rather than an opinion.
   */
  @RequiresCapability("booking.mark-no-show")
  @Implement(contract.booking.markNoShow)
  markNoShow() {
    return implement(contract.booking.markNoShow).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.markNoShow(exec, input.bookingId),
        ),
      ),
    );
  }

  /**
   * `NO_SHOW` → `CHECKED_IN` — the guest landed at 02:00 after all.
   *
   * `booking.reinstate-no-show` is `MANAGER` and `ADMIN`, which is §2's "`MANAGER`
   * only" stated as a capability at last: until this route existed the rule was
   * a sentence in a document with nothing enforcing it, and `PR #15` carried it
   * as an open item for exactly that reason.
   */
  @RequiresCapability("booking.reinstate-no-show")
  @Implement(contract.booking.reinstate)
  reinstate() {
    return implement(contract.booking.reinstate).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.reinstate(exec, {
            bookingId: input.bookingId,
            guests: input.guests,
            roomNumber: input.roomNumber,
          }),
        ),
      ),
    );
  }

  /**
   * The stay a guest booked, read back — `booking.read-own`, `FR-GST-01`.
   *
   * **Declared as a read**, which is the second argument and not a comment. The
   * default is `write` because that is the safe half of forgetting it, and the
   * cost of the default here would be a 403 for any role the matrix later hands
   * a 👁 over a guest's own record — a receptionist looking up the booking a
   * caller is reading out over the phone. `folio.controller.ts` and
   * `search.controller.ts` declare their reads for the same reason on rows that
   * refuse nobody today.
   *
   * The account is the session's, and the service takes it as half of the
   * lookup. Nothing about a booking arrives from the caller except which one.
   */
  @RequiresCapability("booking.read-own", "read")
  @Implement(contract.booking.readOwn)
  readOwn(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.readOwn).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.ownBooking(exec, {
            reference: input.reference,
            owner: ownerOf(principal, "read their own booking", {
              reference: input.reference,
            }),
          }),
        ),
      ),
    );
  }

  /**
   * The hold the funnel is standing on, read back by its id — the same row and
   * the same capability as the read above.
   *
   * The funnel's third step onward carries the hold id rather than the
   * reference, per `repository-structure.md` §`(booking)`, and this is what lets
   * those screens survive a refresh: the stay, its total and its state are read
   * from the API rather than from whatever the tab happened to be holding. The
   * screen that waits for the gateway reads it too, which is why the route
   * answers a stay in any state and not only a `HELD` one.
   *
   * Declared as a read for the reason {@link readOwn} gives, and scoped the same
   * way — the account is the session's, and the only thing the caller names is
   * which stay.
   */
  @RequiresCapability("booking.read-own", "read")
  @Implement(contract.booking.readOwnHold)
  readOwnHold(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.readOwnHold).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.ownHold(exec, {
            bookingId: input.bookingId,
            owner: ownerOf(principal, "read their own booking", {
              bookingId: input.bookingId,
            }),
          }),
        ),
      ),
    );
  }

  /**
   * Where the confirmation goes, named against a hold already taken.
   *
   * The write half of the funnel's third screen. The room is held by the time
   * this is called and the guest is looking at the total; what they are doing
   * here is telling the property who is taking it, one press before the money.
   * `contract/booking.ts` argues at {@link contract.booking.createHold} why the
   * ask moved off the hold's door.
   *
   * **Its own capability, and the reason is the credential.** A guest who booked
   * without an account carries nothing but the booking token the hold issued, so
   * a row the token does not hold would refuse the very guest the passwordless
   * funnel exists for. `booking.contact-own` is that row, granted to the token
   * beside the read and the cancellation it already holds, and scoped exactly as
   * they are — one stay, proved, and the handler still owes the ownership check
   * that `⚠` stands for.
   *
   * Guarded like {@link cancelOwn}: the booking cookie is `sameSite: none` in
   * production, so a cross-site `<form>` could otherwise post an address onto a
   * stranger's stay. `JsonRequestGuard` refuses the three content types a form
   * can send, which leaves `fetch` and therefore `main.ts`'s origin allowlist.
   */
  @UseGuards(JsonRequestGuard)
  @RequiresCapability("booking.contact-own")
  @Implement(contract.booking.setOwnHoldContact)
  setOwnHoldContact(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.setOwnHoldContact).handler(
      async ({ input }) =>
        onWire(
          await this.transactions.run((exec) =>
            this.bookings.setHoldContact(exec, {
              bookingId: input.bookingId,
              owner: ownerOf(principal, "name the contact on their own stay", {
                bookingId: input.bookingId,
              }),
              contact: {
                email: input.contactEmail,
                name: input.contactName,
              },
            }),
          ),
        ),
    );
  }

  /**
   * The funnel saying the guest is still standing on their hold.
   *
   * `booking.presence-own`, and the fourth of this file's guest routes. It exists
   * so that a hold costs the property the time a guest is actually spending on it
   * rather than a full TTL whatever they did — `booking.service.ts`'s
   * `markPresence` argues the trade, and `hold-expiry-sweep.ts` is what acts on
   * it. Nothing here can lengthen a hold: the sweep takes the earlier of the two
   * deadlines, so the most this route can ever do is bring one forward.
   *
   * Scoped exactly as the routes above it are — {@link ownerOf} builds the owner
   * from what the guard resolved and from nothing in the body, and the service
   * puts it in the `where` clause, so a stay that is not the caller's is the same
   * `NOT_FOUND` as one that does not exist.
   *
   * **Rate-limited on its own policy**, because this is the one route in the
   * application a page calls on a timer. `HoldRateLimitGuard` would be the wrong
   * one: its allowance is thirty in ten minutes, so a single funnel pinging for
   * ten of them would spend the allowance it needs to take a room at all.
   *
   * Guarded like {@link cancelOwn} and {@link setOwnHoldContact}, and here the
   * reason is the departure this route also carries. The booking cookie is
   * `sameSite: none` in production, so a cross-site page can make the browser
   * send a request with it attached — and a request that says the guest has left
   * puts their room back on sale a minute later. `JsonRequestGuard` refuses the
   * three content types a `<form>` can post, which leaves `fetch` and the beacon,
   * both of which preflight into `main.ts`'s origin allowlist.
   */
  @UseGuards(JsonRequestGuard, PresenceRateLimitGuard)
  @RequiresCapability("booking.presence-own")
  @Implement(contract.booking.markHoldPresence)
  markHoldPresence(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.markHoldPresence).handler(
      async ({ input }) => {
        await this.transactions.run((exec) =>
          this.bookings.markPresence(exec, {
            bookingId: input.bookingId,
            owner: ownerOf(principal, "keep their own hold alive", {
              bookingId: input.bookingId,
            }),
            leaving: input.leaving,
          }),
        );

        // The stay it was recorded against, and nothing else. The whole point of
        // this route is that it is one statement — answering with the booking
        // would mean reading back a row the caller is already looking at, once
        // every twenty seconds, for every open funnel.
        return { bookingId: input.bookingId };
      },
    );
  }

  /**
   * Every stay this account has taken — `booking.read-own`'s "stay history"
   * half, which until now had a service method and no door.
   *
   * **A session and never a booking token**, said as `@SessionOnly` so the
   * refusal stays in the guard. The other guest reads name one stay and are
   * opened by whichever credential proves that stay is the caller's; this one
   * names none and answers with all of them. A credential scoped to a single
   * booking that could list the account's others would not be scoped to a single
   * booking, which is also why `rbac-matrix.md` records the token against the
   * routes that name a stay rather than against the row.
   *
   * Ordering, and what the list includes, are `getOwnBookings`'s and are argued
   * there: newest arrival first, cancelled and expired stays kept, because a
   * list that dropped them would answer "where did my booking go?" with nothing.
   */
  @SessionOnly("a list of every stay is not one booking's to answer")
  @RequiresCapability("booking.read-own", "read")
  @Implement(contract.booking.listOwn)
  listOwn(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.listOwn).handler(async () => {
      const stays = await this.transactions.run((exec) =>
        this.bookings.getOwnBookings(
          exec,
          accountOf(principal, "list the stays they have taken"),
        ),
      );

      return stays.map(onWire);
    });
  }

  /**
   * What calling the stay off would cost, before calling it off —
   * `booking.read-own`, because it changes nothing.
   *
   * The figure is `cancellation-calculator.ts`'s, for the same booking at the
   * same instant {@link cancelOwn} would be priced at. Nothing is written and
   * nothing is held: a quote is a question, and a second calculation living here
   * would be a number that could disagree with the charge the folio posts.
   *
   * A booking token opens it, and that is the difference from the list above:
   * this one names the stay it is about, so the credential scoped to that stay
   * is proof enough — {@link ownerOf} scopes the lookup exactly as it does for
   * the read and the cancellation either side of it.
   */
  @RequiresCapability("booking.read-own", "read")
  @Implement(contract.booking.cancellationQuote)
  cancellationQuote(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.cancellationQuote).handler(
      async ({ input }) =>
        this.transactions.run((exec) =>
          this.bookings.cancellationQuote(exec, {
            reference: input.reference,
            owner: ownerOf(principal, "price their own cancellation", {
              reference: input.reference,
            }),
          }),
        ),
    );
  }

  /**
   * The stay a guest calls off — `booking.cancel-own`, at §4's price.
   *
   * A write, so the declaration takes the default. The row is `⚠` for the guest
   * realm and denied to every staff role, which is not an oversight: a member of
   * staff cancelling a stay reaches {@link cancel} under the row that records
   * the desk's authority, and a staff token arriving here is the wrong door
   * rather than the wrong rank.
   *
   * **No reason travels and no waiver can.** The service files `GUEST_REQUEST`,
   * because that is what a guest cancelling their own booking is, and it passes
   * no `waivedBy` — setting §4's penalty aside is `booking.cancel-waiver`, which
   * is `MANAGER` and above and reached from the other door entirely. So the
   * charge `folio.service.ts` prices on the next request is the grid's, unwaived,
   * and identical to the one a desk cancellation leaves behind.
   */
  // The credential on this route can be a cookie, which means the browser
  // presents it whether or not the page that asked meant to — and in production
  // the booking cookie is `sameSite: none`, so a cross-site page can ask. The
  // whole input is in the path, so nothing else would stop a `<form>` post.
  // `json-request.guard.ts` is the answer the staff refresh routes already use,
  // and it is a decision here rather than the accident body parsing currently
  // provides: refuse the three content types a form can send, so the only way
  // in is a `fetch` that preflights into `main.ts`'s origin allowlist.
  @UseGuards(JsonRequestGuard)
  @RequiresCapability("booking.cancel-own")
  @Implement(contract.booking.cancelOwn)
  cancelOwn(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.cancelOwn).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.cancelOwn(exec, {
            reference: input.reference,
            owner: ownerOf(principal, "cancel their own booking", {
              reference: input.reference,
            }),
          }),
        ),
      ),
    );
  }

  /**
   * The confirmation email's stay link, followed — the credential the hold
   * issued, handed to whichever browser opened the message.
   *
   * The other delivery path for one credential, not a second credential:
   * `booking-token.service.ts` mints the link under the same key and re-issues
   * the same cookie, so what the guest ends up holding is exactly what the
   * funnel gave them — one booking, read and cancel, and never a login.
   *
   * **Unguarded because the link is what proves the stay.** There is nothing for
   * a capability to be about yet: the caller arrives holding no cookie, which is
   * the situation the link exists for. What stands in for it is the signature,
   * the row that says the link has not been followed, and the deadline that row
   * carries — and a link that fails any of the three is the same refusal as one
   * that names a stay that does not exist.
   *
   * `JsonRequestGuard` for the reason {@link cancelOwn} carries it: this sets a
   * cookie, and a cross-site `<form>` could otherwise plant one naming somebody
   * else's booking in a guest's browser.
   */
  @UseGuards(JsonRequestGuard)
  @Unguarded("the link out of a confirmation email is itself the credential")
  @Implement(contract.booking.redeemStayLink)
  redeemStayLink(@Res({ passthrough: true }) response: Response) {
    return implement(contract.booking.redeemStayLink).handler(
      async ({ input }) => {
        const stay = await this.transactions.run((exec) =>
          this.bookingTokens.redeemStayLink(exec, input.link),
        );

        if (!stay) {
          throw new ORPCError("UNAUTHORIZED", {
            message:
              "This link has already been used or has expired. Ask for a new one from your booking.",
          });
        }

        // The cookie dies when the link would have, and the instant is the
        // link row's rather than one recomputed from the stay — which is what
        // stops a re-issue extending anything.
        this.bookingTokens.issue(response, stay);

        return { bookingId: stay.bookingId, reference: stay.reference };
      },
    );
  }

  /**
   * The transition both cancellation routes make.
   *
   * Shared because it is one transition — §3 gives `HELD → CANCELLED` and
   * `CONFIRMED → CANCELLED` one inventory effect, and the waiver changes what is
   * charged rather than what is released. What is not shared is the declaration
   * above each route and the manager carried through here, which is the whole
   * point of there being two.
   */
  private async cancelled(cancellation: {
    bookingId: string;
    reason: CancellationReason;
    /** The manager who set §4's penalty aside, or null on the policy route. */
    waivedBy: string | null;
  }) {
    return onWire(
      await this.transactions.run((exec) =>
        this.bookings.cancel(exec, cancellation),
      ),
    );
  }
}

/**
 * The account a stay list is about.
 *
 * The one guest read that {@link ownerOf} cannot serve, and the reason is what
 * the route asks: every other guest route names a stay, so a credential proving
 * that one stay is an answer. This route names none, so the only thing that can
 * scope it is an account — and a booking token has none. That caller is refused
 * by `@SessionOnly` in the guard before reaching here; this is the compiler's
 * half of the same rule, and it means the `where` clause below can never be
 * handed a value that is not an account.
 *
 * `FORBIDDEN` for a staff principal, which `booking.read-own` has already
 * denied — stated for the reason {@link attributedStaff} gives, so that an
 * unreachable branch is a refusal rather than a null meeting a query.
 */
function accountOf(principal: Principal | null, act: string): string {
  if (principal?.realm !== "guest") {
    throw new ORPCError("FORBIDDEN", {
      message: `Only a signed-in guest may ${act}`,
    });
  }

  return principal.userId;
}

/**
 * The account a funnel booking is filed under, or null when there is none.
 *
 * Anonymous is a real answer and not a failure: `booking.create-own` admits an
 * unauthenticated caller, and a funnel that refused to sell a room to somebody
 * who has not registered would be a booking engine nobody could use. That stay
 * is reachable by its reference and by nothing else, which is exactly what the
 * nullable column stores.
 *
 * A staff principal lands on the same null. A receptionist reaching this route
 * is taking the booking rather than owning it, and filing the property's own
 * staff id as the guest would make the stay answer a `read-own` for the wrong
 * realm entirely.
 */
function bookingAccount(principal: Principal | null): string | null {
  return principal?.realm === "guest" ? principal.userId : null;
}

/**
 * What makes the stay being read or called off the caller's own — the account
 * off the session, or the single booking a credential proves.
 *
 * Required where {@link bookingAccount} is nullable, and that is the difference
 * between the two rows rather than a stricter reading of one. Creating a booking
 * admits a caller with no account and files the stay under nobody; a `read-own`
 * with no owner at all is not a narrower request, it is a request with no
 * subject — and answering it with a null would hand the service's `where`
 * clause a value SQL matches against nothing, which is the right answer arrived
 * at by accident.
 *
 * **The token's scope is settled before any lookup.** A credential minted for
 * one stay, presented against another, is refused here from the token alone —
 * no query runs, so the refusal cannot tell the caller whether the reference
 * they named exists. That is why this one is a 403 where the service's
 * mismatched-owner answer is a 404: the service is refusing a stay it looked
 * for, and this is refusing a credential on its face.
 *
 * `FORBIDDEN` and not `UNAUTHORIZED` for a caller who is neither: they hold a
 * valid staff session, and `rbac-matrix.md` §1 fixes a staff token on a guest
 * route at 403. Unreachable — both rows deny every staff role, so the guard has
 * already refused them — and stated because the alternative is a null account
 * meeting a query further in.
 */
function ownerOf(
  principal: Principal | null,
  act: string,
  addressed: { reference?: string; bookingId?: string },
): BookingOwner {
  if (principal?.realm === "guest") {
    return { kind: "account", userId: principal.userId };
  }

  if (principal?.realm === "booking") {
    const opensThis =
      addressed.reference !== undefined
        ? addressed.reference === principal.reference
        : addressed.bookingId === principal.bookingId;

    if (!opensThis) {
      throw new ORPCError("FORBIDDEN", {
        message: "This link opens only the booking it was issued for",
      });
    }

    return { kind: "proven", bookingId: principal.bookingId };
  }

  throw new ORPCError("FORBIDDEN", {
    message: `Only the guest who made a booking may ${act}`,
  });
}

/**
 * The member of staff a waiver is recorded against.
 *
 * `booking_names_a_waiver_authority_exactly_when_waived` makes the instant and
 * the name a pair, so there is no half a waiver to write: a caller the guard
 * admitted who is somehow not staff is refused here rather than met with a null
 * deeper in. Unreachable — `booking.cancel-waiver` is granted to `MANAGER` and
 * `ADMIN` and to nobody else — and stated anyway, because a penalty set aside
 * by nobody is precisely the record this whole route exists to leave.
 *
 * Declared here rather than imported: `folio.controller.ts` and
 * `housekeeping.controller.ts` each own their own, and a shared helper would be
 * one module's session rule governing another's columns.
 */
function attributedStaff(principal: Principal | null, act: string): string {
  if (principal?.realm !== "staff") {
    throw new ORPCError("UNAUTHORIZED", {
      message: `Only a signed-in member of staff may ${act}`,
    });
  }

  return principal.userId;
}

/**
 * The party as the wire states it, in the shape `occupancy-pricing.ts` prices.
 *
 * Ages into `Child` objects and nothing else: `FR-PRC-04` bands a child by age,
 * so the array the funnel sent is already the fact the pricing path needs and
 * this only re-nests it. A shape crossing, exactly like the date one below —
 * neither decides anything.
 */
function asCreateInput(input: CreateBookingBody): CreateBookingInput {
  return {
    roomType: input.roomType,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    plan: input.plan,
    party: {
      adults: input.adults,
      children: input.childAges.map((age) => ({ age })),
    },
  };
}

/**
 * A booking as the wire carries it — `CalendarDate` into ISO text, and the hold
 * expiry into ISO-8601.
 *
 * The crossing `stayDateSchema`'s codec declares, performed where the two meet
 * and once for every route, because every route in this file answers with a
 * booking. The expiry crosses here too and is the one instant: a TTL is a moment
 * rather than a day, so it takes the full timestamp and not the nine characters
 * a stay boundary takes.
 */
export function onWire(booking: Booking) {
  return {
    ...booking,
    checkIn: booking.checkIn.toString(),
    checkOut: booking.checkOut.toString(),
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    // Copied rather than passed through. The service holds the ages `readonly`,
    // which is right for a value nothing downstream may edit, and the schema's
    // array is not — so the copy is where the two meet instead of a cast that
    // would hand the caller's array to a serialiser that could sort it.
    childAges: [...booking.childAges],
  };
}
