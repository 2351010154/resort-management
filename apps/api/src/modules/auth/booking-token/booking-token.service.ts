// The credential a guest who never signed up is given, and the cookie it rides
// in — minted, verified, named and scoped in one file.
//
// **It is not a session and must never become one.** It authorises two acts on
// one booking: read that stay, and call that stay off. It names no account, it
// satisfies no other row of `docs/architecture/rbac-matrix.md` §3, and
// `access.guard.ts` is where that ceiling is enforced. The reason the funnel
// needs it at all is in `plans/…/phase-02-guest-identity-boundary.md`: creating
// an account from a typed address means looking that address up, and the lookup
// is an account-enumeration oracle this codebase refuses in three other places.
//
// **Signed, and stateless.** The payload is two facts the property already told
// the guest — the booking's id and its reference — plus the instant the
// credential dies. Nothing in it is secret and nothing in it is a capability, so
// the only thing the signature has to buy is that the guest cannot edit it into
// somebody else's stay.
//
// **What revokes it is a column, and it is read by a query that already runs.**
// `booking.anon_access_revoked_at` is the instant a stay's anonymous credential
// was surrendered, and `scopedTo` in `booking.service.ts` carries it on the
// branch that resolves this token. Nothing here reads it and nothing in
// `access.guard.ts` does either: a guard that took a round trip to admit a
// cookie would spend one on every request under `/bookings`, where the ownership
// query at the end of the request was always going to read that row anyway. The
// only place this file consults it is redemption below, where a link that would
// re-issue a credential the guest has already given up must fail closed.
//
// **One credential, two delivery paths.** A browser gets it as a cookie at the
// moment the hold is taken; a mailbox gets it as a link in the confirmation.
// The link is signed by the key below and by no second scheme — what differs is
// that a mailbox is copied, forwarded and left open, so a mailed link is
// spendable exactly once. That "once" is a fact about the world rather than a
// property of a signature, so it lives in `schema/booking-link.ts` and is
// settled by the conditional update in {@link BookingTokenService.redeem}.
//
// **One cookie, so the last hold wins.** A guest who takes a second hold before
// paying for the first can no longer read or cancel the first from that browser.
// Accepted rather than solved with a cookie per booking: the funnel carries one
// stay at a time, and the confirmation email's signed link is what re-opens a
// stay a browser no longer holds.
//
// **The key is derived, not shared.** `BETTER_AUTH_SECRET` signs guest session
// cookies, and `env.ts` is explicit that the staff realm holds a different one
// so that a single leak cannot forge both. The same argument applies one level
// down: HKDF with a label of this file's own means a booking token's signature
// and a session cookie's signature are computed under keys that cannot be
// substituted for one another, while the deployment still configures one secret
// per realm. This credential is the guest realm's, so it derives from the guest
// realm's secret.

import { hkdfSync, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { ENV, type Env } from "../../../config/env.js";
import type { BookingPrincipal } from "../../../common/auth/principal.js";
import type { DbExecutor } from "../../../database/database.module.js";
import { booking } from "../../../database/schema/booking.js";
import {
  type BookingLinkPurpose,
  bookingLink,
} from "../../../database/schema/booking-link.js";

/**
 * The cookie's name and its path.
 *
 * Scoped to `/bookings`, which is where all three of the routes it opens live —
 * the browser does not attach it to the availability search, to the payment
 * callbacks or to anything Better Auth mounts. A credential sent on requests
 * that have no use for it is a credential logged, proxied and cached in more
 * places than the ones that read it.
 */
const COOKIE_NAME = "mariva_booking";
const COOKIE_PATH = "/bookings";

/** Comfortably above the ~150 bytes this file mints, and far below what a
 *  header being used as a buffer carries — so an oversized cookie is dropped
 *  before anything parses it. */
const LONGEST_PLAUSIBLE_TOKEN = 512;

/** HKDF's `info` — what makes this key this file's and not the session's. */
const KEY_LABEL = "mariva:booking-token:v1";

const KEY_BYTES = 32;

const MS_PER_DAY = 86_400_000;

/**
 * How long the credential outlives the stay — decision 3 of the plan.
 *
 * Seven days past checkout, because the post-stay window is what a guest comes
 * back for: a receipt, a date they want to check, and the feedback surface a
 * later milestone puts behind it. It expires rather than living forever because
 * it is a bearer credential in a browser the property does not control, and a
 * link in a confirmation email re-issues it for a guest who cleared their
 * cookies.
 */
const DAYS_PAST_CHECKOUT = 7;

/**
 * How long the link that offers an account lasts.
 *
 * An hour, which is what the guest verification token beside it lasts and what
 * the mail is: a message read once, shortly after it lands. The stay link in the
 * same envelope lives to checkout plus seven days, and the difference is what
 * each one opens — one re-issues a credential for a stay the guest has already
 * paid for, the other creates an account. A create link left standing for a week
 * is a week of anybody who reaches that mailbox being able to become the guest.
 *
 * A guest who reads the mail late has not lost the stay. The stay link is still
 * good, and the page it opens offers the account again.
 */
const ACCOUNT_LINK_MINUTES = 60;

const MS_PER_MINUTE = 60_000;

/** What a minted token stands for: one booking, addressed either way it can be. */
export interface BookingClaim {
  readonly bookingId: string;
  readonly reference: string;
  /** Checkout plus seven days. */
  readonly expiresAt: Date;
}

/**
 * A redeemed stay link, in exactly the shape {@link BookingTokenService.issue}
 * takes.
 *
 * The expiry is the link row's own and is not recomputed from the stay, which
 * is what stops the re-issued cookie outliving the link that re-issued it. The
 * link was minted for checkout plus seven days, the redeeming statement refused
 * it unless that instant is still ahead, and the cookie now dies at the same
 * instant — one figure, decided once, at the moment the mail was sent.
 */
export type ReissuedStay = BookingClaim;

/** What a redeemed account link names: the stay the new account attaches to. */
export interface AttachableStay {
  readonly bookingId: string;
}

/** The payload, as it is signed. Short keys because it travels in a cookie. */
interface TokenPayload {
  /** Format version, so a change of shape is a refusal rather than a mis-parse. */
  readonly v: 1;
  readonly b: string;
  readonly r: string;
  /** Expiry, epoch seconds. */
  readonly e: number;
}

/**
 * The payload of a mailed link: the row that says what it opens and whether it
 * has been opened.
 *
 * **One field, and everything else is read from that row.** The purpose, the
 * deadline and the fact of having been followed all live in `booking_link`, so
 * putting a copy of any of them here would be a second answer to a question the
 * database already answers — and the one in the mailbox is the copy that cannot
 * be corrected. What the signature buys is the same thing it buys for the
 * cookie: an id that was not issued by this deployment is refused by arithmetic,
 * so a caller cannot walk the table by guessing.
 *
 * **Disjoint from {@link TokenPayload} by shape, not by convention.** Neither
 * decoder accepts the other's fields, so a cookie cannot be pasted in as a link
 * and a link cannot be presented as a cookie — the two are signed under one key
 * and separated by what they must parse as.
 */
interface LinkPayload {
  readonly v: 1;
  /** The `booking_link` row this link is. */
  readonly l: string;
}

/** The shape `uuid` columns hold, checked before one reaches a query. The
 *  signature already proves the id is ours; this decides what happens the day a
 *  later version mints a different one — a refusal, rather than Postgres
 *  raising on a value it cannot cast. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class BookingTokenService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(env.BETTER_AUTH_SECRET, "utf8"),
        // No salt. HKDF's salt buys extra-entropy separation between two
        // derivations from one secret; the `info` label above is what separates
        // them here, and a salt this file made up would have to be stored
        // somewhere for every process to agree on it.
        Buffer.alloc(0),
        Buffer.from(KEY_LABEL, "utf8"),
        KEY_BYTES,
      ),
    );
  }

  /** When a token minted for a stay ending on this date stops opening it. */
  expiryFor(checkOut: Date): Date {
    return new Date(checkOut.getTime() + DAYS_PAST_CHECKOUT * MS_PER_DAY);
  }

  /** The signed text: `<payload>.<signature>`, both base64url. */
  mint(claim: BookingClaim): string {
    const payload: TokenPayload = {
      v: 1,
      b: claim.bookingId,
      r: claim.reference,
      e: Math.floor(claim.expiresAt.getTime() / 1000),
    };

    return this.signed(payload);
  }

  /**
   * The link that re-opens one stay in a browser that no longer holds it.
   *
   * What the confirmation email carries, and the reason the cookie's own life
   * can stay bounded: a guest who cleared their cookies, changed device or
   * closed the tab on a shared machine has this and needs nothing else. It
   * grants exactly what the cookie granted — one booking, read and cancel — and
   * it is not a login.
   *
   * It dies when the credential it re-issues would have: `checkOut` is the same
   * instant {@link expiryFor} is given at the hold, so the link cannot be used to
   * extend anything. Following it a second time is refused, because a mailbox is
   * read by more people than a browser is.
   */
  async mintStayLink(
    exec: DbExecutor,
    stay: { readonly bookingId: string; readonly checkOut: Date },
  ): Promise<string> {
    return await this.mintLink(
      exec,
      stay.bookingId,
      "STAY_REISSUE",
      this.expiryFor(stay.checkOut),
    );
  }

  /**
   * The link that offers an account, mailed only to an address that has none.
   *
   * An hour and one use — {@link ACCOUNT_LINK_MINUTES} argues both. It names the
   * stay so that the account it creates can be attached to it, and it names
   * nothing else: the address the account is made under is the one the mail was
   * sent to, read off the booking rather than off anything the caller submits.
   */
  async mintAccountLink(
    exec: DbExecutor,
    stay: { readonly bookingId: string },
  ): Promise<string> {
    return await this.mintLink(
      exec,
      stay.bookingId,
      "ACCOUNT_CREATE",
      new Date(Date.now() + ACCOUNT_LINK_MINUTES * MS_PER_MINUTE),
    );
  }

  /**
   * The stay a presented re-issue link opens, or `null` — and it is spent by
   * the asking.
   *
   * What comes back is a {@link BookingClaim}, so the caller hands it straight
   * to {@link issue} and the browser leaves holding the same credential the
   * hold's cookie was.
   */
  async redeemStayLink(
    exec: DbExecutor,
    presented: string | undefined,
  ): Promise<ReissuedStay | null> {
    return await this.redeem(exec, presented, "STAY_REISSUE");
  }

  /**
   * The stay a presented create link attaches an account to, or `null` — spent
   * by the asking, like the one above.
   *
   * The claim is deliberately not handed back. This link's business is the
   * account, and a caller that received a mintable cookie claim from it could
   * quietly turn the account door into a second way of issuing the credential.
   */
  async redeemAccountLink(
    exec: DbExecutor,
    presented: string | undefined,
  ): Promise<AttachableStay | null> {
    const redeemed = await this.redeem(exec, presented, "ACCOUNT_CREATE");

    return redeemed && { bookingId: redeemed.bookingId };
  }

  /**
   * The stay a create link would attach an account to, asked without spending
   * it — `null` on every one of the five refusals {@link redeem} lists.
   *
   * **Advisory, and it decides nothing.** It exists because the account this
   * flow creates is written by Better Auth on its own connection, and asking
   * that library for a connection while holding a transaction open is how ten
   * concurrent redemptions exhaust a ten-connection pool. So the address is read
   * first, on a connection that is given straight back, and the transaction that
   * spends the link is opened afterwards. `guest-attach.service.ts` sets the
   * order out.
   *
   * The conditional update in {@link redeem} remains the only authority on
   * single use. Two guests reading this at once both see a live link, and
   * exactly one of them then spends it — which is the same guarantee as before,
   * because nothing here writes and nothing downstream trusts what it read.
   */
  async accountLinkStay(
    exec: DbExecutor,
    presented: string | undefined,
  ): Promise<AttachableStay | null> {
    const linkId = this.linkIdOf(presented);

    if (!linkId) {
      return null;
    }

    const [row] = await exec
      .select({ bookingId: bookingLink.bookingId })
      .from(bookingLink)
      .innerJoin(booking, eq(booking.id, bookingLink.bookingId))
      .where(liveLink(linkId, "ACCOUNT_CREATE"))
      .limit(1);

    return row ?? null;
  }

  /**
   * The stay a presented token opens, or `null`.
   *
   * `null` for every failure and the same `null` for each: a token that was
   * never signed here, one edited after it was, one whose stay has been over
   * for a week, and no token at all. The caller turns that into a refusal that
   * names no booking, because a reply distinguishing "expired" from "forged"
   * would tell a caller which half of a guess was right.
   */
  verify(token: string | undefined): BookingPrincipal | null {
    const encoded = this.authentic(token);

    if (!encoded) {
      return null;
    }

    const payload = decode(encoded);

    if (!payload || payload.e * 1000 <= Date.now()) {
      return null;
    }

    return {
      realm: "booking",
      bookingId: payload.b,
      reference: payload.r,
    };
  }

  /** The token this request presented, off the raw cookie header. */
  presentedOn(request: Request): string | undefined {
    return readCookie(request, COOKIE_NAME);
  }

  /** Hands the browser the credential for the stay just held. */
  issue(response: Response, claim: BookingClaim): void {
    response.cookie(COOKIE_NAME, this.mint(claim), {
      ...this.cookieAttributes(),
      expires: claim.expiresAt,
    });
  }

  /**
   * The signed text addressing a link row that already exists.
   *
   * **Separate from minting because a signature is not a secret to be kept but
   * a value to be recomputed.** The row id is opaque and is already at rest in
   * `booking_link`; the key is derived at boot from the realm's secret and is
   * written nowhere. So anything that has to hold on to a mailed link — an
   * outbound message waiting on a queue, above all — holds the row id and asks
   * for the text again at the moment it is needed, and the only at-rest copy of
   * a spendable credential stays the one that never existed.
   *
   * Deterministic: the same row id yields the same text for as long as the
   * realm's secret is the same, which is what lets a link composed in one
   * process be reproduced byte for byte in another.
   */
  signLink(linkId: string): string {
    return this.signed({ v: 1, l: linkId } satisfies LinkPayload);
  }

  /**
   * The link row a presented text names, if this deployment signed it.
   *
   * `null` for a text that was not signed here and for one whose payload is not
   * a link — the same refusal, for the reason {@link verify} gives. Public
   * because {@link signLink}'s inverse is what proves a stored row id will
   * reproduce the text it came from.
   */
  linkIdOf(presented: string | undefined): string | null {
    const encoded = this.authentic(presented);

    return encoded ? decodeLink(encoded) : null;
  }

  /**
   * A link row, and the signed text that addresses it.
   *
   * The row is written before the text exists, because the text is a signature
   * over the row's id. That order is also why a mail that fails to send leaves a
   * link nobody will follow rather than a link nothing recognises — the first is
   * a row that expires, and the second would be a guest holding a credential the
   * property cannot honour.
   */
  private async mintLink(
    exec: DbExecutor,
    bookingId: string,
    purpose: BookingLinkPurpose,
    expiresAt: Date,
  ): Promise<string> {
    const [link] = await exec
      .insert(bookingLink)
      .values({ bookingId, purpose, expiresAt })
      .returning({ id: bookingLink.id });

    return this.signLink(link!.id);
  }

  /**
   * Spending a link: one statement that decides and writes at once.
   *
   * **Why it is an `UPDATE` with a `where` and not a read followed by a write.**
   * A guest double-clicks, a mail client prefetches the link and a forwarded copy
   * is opened at the same moment — all of which arrive as two statements against
   * one row. Postgres makes the second wait for the first, then re-reads the row
   * the first has just written and re-tests this `where` against it; the instant
   * is set by then, so the second matches nothing. A handler that selected,
   * decided and then updated would have let both decide before either wrote, and
   * the second guest would have been handed a credential the first already spent.
   *
   * **Five ways to fail, and one answer for all of them.** A signature that was
   * not made here, an id naming no row, a link already followed, one whose
   * deadline has passed, and one for a stay whose anonymous access has since
   * been given up. `null` for each, for the reason {@link verify} gives: a reply
   * that separated them would tell a caller which half of a guess was right.
   *
   * **The purpose is part of the `where`.** The door that redeems names what it
   * will accept, so the hour-long link that creates an account cannot be spent
   * at the door that re-issues a booking cookie, or the other way about.
   *
   * **Both clocks are Postgres'.** The deadline is compared to `now()` and the
   * instant written is the same `now()`, in one statement — so a link cannot be
   * recorded as consumed after the moment it stopped being live, which is what
   * `booking_link_consumed_while_it_was_live` states.
   */
  private async redeem(
    exec: DbExecutor,
    presented: string | undefined,
    purpose: BookingLinkPurpose,
  ): Promise<BookingClaim | null> {
    const linkId = this.linkIdOf(presented);

    if (!linkId) {
      return null;
    }

    const [redeemed] = await exec
      .update(bookingLink)
      .set({ consumedAt: sql`now()` })
      .from(booking)
      .where(
        and(liveLink(linkId, purpose), eq(booking.id, bookingLink.bookingId)),
      )
      .returning({
        bookingId: bookingLink.bookingId,
        reference: booking.reference,
        expiresAt: bookingLink.expiresAt,
      });

    return redeemed ?? null;
  }

  /**
   * The payload half of a presented text, if the signature over it is ours.
   *
   * Shared by the cookie and by both links because the envelope is one format
   * and one key — what differs is what the payload inside has to parse as, and
   * that is the two decoders below.
   */
  private authentic(presented: string | undefined): string | null {
    if (!presented || presented.length > LONGEST_PLAUSIBLE_TOKEN) {
      return null;
    }

    const separator = presented.lastIndexOf(".");

    if (separator <= 0) {
      return null;
    }

    const encoded = presented.slice(0, separator);

    return this.signatureMatches(encoded, presented.slice(separator + 1))
      ? encoded
      : null;
  }

  /** `<payload>.<signature>`, both base64url. */
  private signed(payload: TokenPayload | LinkPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );

    return `${encoded}.${this.sign(encoded)}`;
  }

  /**
   * How the cookie is scoped, and why `sameSite` is not one value.
   *
   * The same two-valued answer `staff-auth.controller.ts` gives, for the same
   * deployment: the public site is Vercel and this API is Fly, which are
   * different sites, and a `lax` cookie is neither sent nor even stored on a
   * cross-site request. In production that would leave the funnel taking a hold
   * successfully and losing the stay at the next screen, with nothing to
   * restore it from. `none` is what a cookie crossing sites must say, and the
   * browser only accepts it alongside `secure` — which is why development stays
   * `lax`, where `localhost:3000` and `localhost:3001` differ by port and are
   * the same site, and where there is no HTTPS for `secure` to require.
   *
   * `httpOnly`, because page code has no use for it: every route it opens is
   * reached by the browser attaching it. A token JavaScript can read is a token
   * an injected script can post to somewhere else, and this one opens a stay
   * for a week after it ends.
   */
  private cookieAttributes(): {
    httpOnly: true;
    sameSite: "lax" | "none";
    secure: boolean;
    path: string;
  } {
    const isProduction = this.env.NODE_ENV === "production";

    return {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
      path: COOKIE_PATH,
    };
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.key).update(encoded).digest("base64url");
  }

  /** Compared in constant time, so the signature cannot be guessed a byte at a
   *  time off the reply's timing. */
  private signatureMatches(encoded: string, presented: string): boolean {
    const expected = Buffer.from(this.sign(encoded), "utf8");
    const actual = Buffer.from(presented, "utf8");

    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}

/**
 * What makes a link still openable: this row, for this door, unfollowed, inside
 * its deadline, and about a stay whose anonymous access has not been given up.
 *
 * One expression rather than two copies, because the statement that spends a
 * link and the read that offers one must never come to disagree about what
 * "live" means — a read that admitted an expired link would send the flow on to
 * create an account for a link the spend then refuses.
 *
 * The join between the two tables is not here. The spending statement expresses
 * it as an `UPDATE … FROM` predicate and the read as a join condition, which is
 * the one thing about them that genuinely differs.
 */
function liveLink(linkId: string, purpose: BookingLinkPurpose) {
  return and(
    eq(bookingLink.id, linkId),
    eq(bookingLink.purpose, purpose),
    isNull(bookingLink.consumedAt),
    gt(bookingLink.expiresAt, sql`now()`),
    isNull(booking.anonAccessRevokedAt),
  );
}

/** The payload, if it is one this file wrote. Shape-checked rather than cast:
 *  the signature proves the bytes are ours, not that a future version's are. */
function decode(encoded: string): TokenPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as TokenPayload).v !== 1 ||
      typeof (parsed as TokenPayload).b !== "string" ||
      typeof (parsed as TokenPayload).r !== "string" ||
      typeof (parsed as TokenPayload).e !== "number"
    ) {
      return null;
    }

    return parsed as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * The link row an authentic payload names, if it is one this file wrote.
 *
 * Shape-checked like {@link decode} and for the same reason, plus one of its
 * own: this value goes into a `where` against a `uuid` column, so anything that
 * is not one is a refusal here rather than an error Postgres raises about a cast
 * on a route a stranger can reach. The cookie's fields are absent from this
 * shape and this shape's field is absent from the cookie's, which is what keeps
 * one from being presented as the other.
 */
function decodeLink(encoded: string): string | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as LinkPayload).v !== 1 ||
      typeof (parsed as LinkPayload).l !== "string" ||
      !UUID.test((parsed as LinkPayload).l)
    ) {
      return null;
    }

    return (parsed as LinkPayload).l;
  } catch {
    return null;
  }
}

/**
 * One cookie off the raw header.
 *
 * The same loop `staff-auth.controller.ts` writes and for the reason it gives:
 * `cookie-parser` would parse every cookie on every request the API serves to
 * find the one name three routes read.
 */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;

  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        // A percent sign followed by nothing is not a token, and it is also not
        // a 500. Anything that can write a cookie on this host can send one, so
        // an unguarded decode would turn a malformed cookie into an error on
        // every request under `/bookings` instead of an anonymous one.
        return undefined;
      }
    }
  }

  return undefined;
}
