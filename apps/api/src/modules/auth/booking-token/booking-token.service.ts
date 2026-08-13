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
// **Nothing revokes it, and that is a gap rather than a design.** The ownership
// query in `booking.service.ts` settles *scope* — which stay this credential is
// about — and cannot answer whether the credential was surrendered. So a cookie
// left in a lobby browser opens that stay until it expires, and a guest who
// later attaches the booking to an account does not invalidate the anonymous
// copy. Closing it is a stored instant per booking that a presented token is
// compared against, and it belongs with the account attach that first makes it
// matter — phase 5 of the plan behind this file.
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
import type { Request, Response } from "express";
import { ENV, type Env } from "../../../config/env.js";
import type { BookingPrincipal } from "../../../common/auth/principal.js";

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

/** What a minted token stands for: one booking, addressed either way it can be. */
export interface BookingClaim {
  readonly bookingId: string;
  readonly reference: string;
  /** Checkout plus seven days. */
  readonly expiresAt: Date;
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

    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );

    return `${encoded}.${this.sign(encoded)}`;
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
    if (!token || token.length > LONGEST_PLAUSIBLE_TOKEN) {
      return null;
    }

    const separator = token.lastIndexOf(".");

    if (separator <= 0) {
      return null;
    }

    const encoded = token.slice(0, separator);

    if (!this.signatureMatches(encoded, token.slice(separator + 1))) {
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
