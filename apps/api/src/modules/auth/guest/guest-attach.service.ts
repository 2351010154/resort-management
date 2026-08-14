// Turning a stay somebody booked anonymously into a stay an account owns.
//
// Two doors lead here and they differ only in what proves the account. A guest
// whose address had none follows the link in their confirmation, and the link
// is the proof: the message went to that address, so opening it from there is
// possession, and the account this creates arrives with `email_verified` already
// true. A guest whose address *had* an account signs in — the session is the
// proof, and no mail is involved at all.
//
// Both then do the same thing, which is `booking.service.ts`'s
// {@link BookingService.attachToAccount}: write the owner, then give up the
// anonymous credential, in one transaction and in that order.
//
// ## Why the account is created through Better Auth's internal adapter
//
// The realm's public sign-up route cannot make this account. It insists on a
// password, and the whole point of the screen behind this is that the password
// is optional; and `sendOnSignUp` would put a second verification message in the
// mailbox that has just proved itself by delivering the first. Nor can it be
// asked to skip the verification: `sign-up/email` spreads the literal
// `emailVerified: false` last, so a value a caller sends is overwritten, and
// `update-user` filters the field out of what it will accept.
//
// What is left is either the admin plugin, which mounts admin routes on the
// guest realm and needs columns `guest_user` and `guest_session` do not have, or
// `auth.$context.internalAdapter`, which needs neither. This takes the second,
// and pays for it with `guest-attach.internal-api.spec.ts` — a test that fails
// loudly, by name, if a Better Auth upgrade moves the surface used below. That
// failure belongs in CI and not in production, which is the whole reason the
// test exists.
//
// ## Why the account is created between two transactions rather than inside one
//
// Better Auth writes on a connection it asks the pool for, and the pool has ten.
// A flow that opened a transaction, held it, and then asked the library to make
// an account would be holding one connection while waiting for a second — so ten
// concurrent redemptions would hold all ten and wait for connections that cannot
// come, until `connectionTimeoutMillis` fired on every one of them. pg-boss
// draws from the same pool, so it would stall with them.
//
// The order below is what avoids it, and nothing else about it changed:
//
// 1. the link is *read* — signature, unfollowed, unexpired, stay not
//    surrendered — and the booking's contact address read with it, on
//    connections given straight back;
// 2. the account is created or found with no transaction open at all;
// 3. one transaction then spends the link, attaches the stay and gives up its
//    anonymous credential.
//
// Step 1 decides nothing. The conditional `UPDATE … WHERE consumed_at IS NULL`
// in step 3 is still the only authority on single use, so two guests who read a
// live link at the same instant still produce exactly one attach.
//
// ## Why only one of the two doors signs the browser in
//
// The created account is signed in; the account that already existed is not.
//
// A new account holds exactly one thing — the booking the link just attached to
// it — and it was created by a message sent to that address. A session over it
// therefore reaches nothing the link did not already open, and withholding one
// only means a guest who declined a password is locked out of the stay they have
// this second claimed, and must run a password reset to get back to it.
//
// An account that already existed is the opposite. It holds stay history,
// personal details and whatever `FR-GST-05` accrues, none of which the link had
// anything to do with — the link proves a booking, and only a sign-in proves
// that account. So that door still asks for one.
//
// The session is issued through the library's own `/verify-email`, which is the
// door `autoSignInAfterVerification` already opens for an ordinary guest who
// confirms their address: the account is created unverified and verified
// immediately by redeeming the proof the mail carried. Nothing about a cookie is
// composed here — Better Auth writes the `Set-Cookie` lines and
// `guest-attach.controller.ts` copies them onto the response, once the whole
// attach has committed.

import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { createEmailVerificationToken } from "better-auth/api";
import {
  DRIZZLE,
  type Database,
  type DbExecutor,
} from "../../../database/database.module.js";
import { TransactionRunner } from "../../../database/transaction-runner.js";
import { BookingService } from "../../booking/booking.service.js";
import { BookingTokenService } from "../booking-token/booking-token.service.js";
import { GUEST_AUTH, type GuestAuth } from "./guest-auth.tokens.js";
import { accountForAddress } from "./registered-address.js";

/** The stay an attach settled, named both ways a page may need it. */
export interface AttachedStay {
  readonly bookingId: string;
  readonly reference: string;
}

/**
 * A followed account link, settled — the stay, and whatever session it started.
 *
 * The cookie lines are Better Auth's own, verbatim, and there are none of them
 * on the path that found an account already registered. They travel back to the
 * controller rather than being written here because a session must not reach a
 * browser until the attach that justifies it has committed.
 */
export interface RedeemedAccountLink {
  readonly stay: AttachedStay;
  readonly sessionCookies: readonly string[];
}

/** What Better Auth files an email-and-password credential under. */
const CREDENTIAL_PROVIDER = "credential";

/** Postgres' unique violation. */
const UNIQUE_VIOLATION = "23505";

/** The index that makes one address one account, case-insensitively. */
const ONE_ACCOUNT_PER_ADDRESS = "guest_user_email_lower_key";

/** How far down a wrapped error to look for the cause. */
const DEEPEST_CAUSE = 5;

/** A stay a live account link names, and the address its confirmation went to. */
interface OfferedAccount {
  readonly bookingId: string;
  readonly contact: { readonly email: string; readonly name: string };
}

@Injectable()
export class GuestAttachService {
  constructor(
    @Inject(GUEST_AUTH) private readonly auth: GuestAuth,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly transactions: TransactionRunner,
    private readonly bookingTokens: BookingTokenService,
    private readonly bookings: BookingService,
  ) {}

  /**
   * The confirmation mail's account link, followed.
   *
   * **This owns its transaction boundaries rather than taking one**, which is
   * the one place in this codebase a service does. The file header argues it: an
   * account is written on Better Auth's own connection, and the flow must not be
   * holding a transaction open while it waits for one. That is a fact about
   * these three steps rather than a preference of the caller's, so it is stated
   * here, where it cannot be undone by a controller that wrapped the call.
   *
   * The link is spent by the conditional update in `booking-token.service.ts`,
   * so two clicks and a prefetching mail client arrive as two statements against
   * one row and exactly one of them wins. It is spent in the *same* transaction
   * as the attach, which is what makes a failure there recoverable: the rollback
   * puts the link back and the guest can follow it again.
   *
   * **An address that gained an account between the mail and the click is
   * attached to that account rather than refused.** The link was delivered to
   * that address, so whoever holds it holds the mailbox the account was
   * registered from — and the alternative is a guest whose retry can never
   * succeed because their first attempt created the account and then failed to
   * commit.
   */
  async accountFromLink(presented: {
    readonly link: string;
    readonly password?: string;
  }): Promise<RedeemedAccountLink> {
    this.refusePasswordOutsidePolicy(presented.password);

    const offered = await this.offeredBy(presented.link);
    const account = await this.accountFor(offered.contact, presented.password);

    const attached = await this.transactions.run(async (exec) => {
      // Read again, and this time spent. Everything above was advisory: a link
      // followed twice in the same second reaches here twice and this statement
      // is where exactly one of them stops.
      const stay = await this.bookingTokens.redeemAccountLink(
        exec,
        presented.link,
      );

      if (!stay) {
        throw this.linkIsGone();
      }

      return await this.bookings.attachToAccount(exec, {
        bookingId: stay.bookingId,
        userId: account.userId,
      });
    });

    return {
      stay: { bookingId: attached.id, reference: attached.reference },
      sessionCookies: account.sessionCookies,
    };
  }

  /**
   * What a presented link offers, read without spending it — the stay, and the
   * address its confirmation was sent to.
   *
   * **The address is the booking's and never the caller's.** It is read here for
   * the same reason it was read further in before: the account this creates is
   * for the address the mail went to, and that is a property of where the read
   * happens rather than a check somebody has to remember to make.
   */
  private async offeredBy(link: string): Promise<OfferedAccount> {
    const stay = await this.bookingTokens.accountLinkStay(this.db, link);

    if (!stay) {
      throw this.linkIsGone();
    }

    const contact = await this.bookings.contactOn(this.db, stay.bookingId);

    if (!contact) {
      // Unreachable through the funnel: the link is minted only for a stay that
      // has an address to mail it to. Stated rather than asserted, because the
      // alternative is a null address reaching account creation.
      throw new ORPCError("NOT_FOUND", {
        message: "There is no booking behind this link",
      });
    }

    return { bookingId: stay.bookingId, contact };
  }

  /**
   * One sentence for every way a link can fail — never signed here, edited after
   * signing, followed already, out of date, or naming a stay whose anonymous
   * access has since been given up. A reply that separated them would tell
   * whoever is trying which half of a guess was right, so the read that offers
   * and the statement that spends refuse in the same words.
   */
  private linkIsGone(): ORPCError<"UNAUTHORIZED", undefined> {
    return new ORPCError("UNAUTHORIZED", {
      message:
        "This link has already been used or has expired. Open your booking from the confirmation email and ask for a new one.",
    });
  }

  /**
   * The signed-in guest's path — the session and the booking credential both
   * present on one request.
   *
   * No mail, no link and no second round trip: the session proves the account
   * and the token proves the stay, which is everything an attach needs. The
   * controller is where the two are read; this is what they mean.
   */
  async attachProvenStay(
    exec: DbExecutor,
    attachment: { readonly bookingId: string; readonly userId: string },
  ) {
    return await this.bookings.attachToAccount(exec, attachment);
  }

  /**
   * The account for this address — the one already registered under it, or a
   * new one, verified and signed in.
   *
   * The address is the booking's and never the caller's, so there is no
   * same-address check to forget: the account is created for the address the
   * mail was sent to because that is the only address in scope.
   *
   * **Nothing here runs inside a transaction, and that is the point of the whole
   * ordering.** Better Auth takes a connection of its own for each of the calls
   * below; taking them while holding one would be the pool exhaustion the file
   * header describes.
   *
   * **What a later rollback leaves behind, stated plainly.** The account, its
   * verification and its session row are written on that separate connection and
   * commit as they go, so an attach that then refuses rolls back the link's
   * spend and leaves those three rows standing. The guest's retry follows the
   * same link — restored — and takes the registered-address branch above: the
   * stay attaches to the account the first attempt made, and the browser gets no
   * session, because that branch issues none. That is the accepted cost. A guest
   * who set no password reaches the stay by resetting one against an address
   * this flow has already verified, and a guest who set one signs in with it.
   */
  private async accountFor(
    contact: { readonly email: string; readonly name: string },
    password: string | undefined,
  ): Promise<{ readonly userId: string; readonly sessionCookies: string[] }> {
    const existing = await accountForAddress(this.db, contact.email);

    if (existing) {
      // No session. This account is older than the link and holds more than the
      // booking behind it, and only a sign-in speaks for all of that.
      return { userId: existing.id, sessionCookies: [] };
    }

    const context = await this.auth.$context;
    const created = await this.createdFor(context, contact);

    if (!created) {
      // Somebody else registered this address between the read above and the
      // insert. Whoever they are, they are the same person: two confirmations
      // for one address mint two links, both go to that mailbox, and both name
      // stays that mailbox paid for. So the second one attaches to the account
      // the first made rather than answering a guest with a 500 — and it hands
      // back no session, exactly as the registered branch above does, because
      // this call did not create that account either.
      const raced = await accountForAddress(this.db, contact.email);

      if (!raced) {
        throw new ORPCError("CONFLICT", {
          message:
            "Your account could not be created just now. Open your booking from the confirmation email and try again.",
        });
      }

      return { userId: raced.id, sessionCookies: [] };
    }

    const sessionCookies = await this.verifyAndSignIn(context, contact.email);

    if (password !== undefined) {
      await context.internalAdapter.linkAccount({
        userId: created.id,
        accountId: created.id,
        providerId: CREDENTIAL_PROVIDER,
        password: await context.password.hash(password),
      });
    }

    return { userId: created.id, sessionCookies };
  }

  /**
   * The account this call created, or `null` when the address was taken while it
   * was being written.
   *
   * Narrowed to that one failure. Anything else the library raises is rethrown,
   * because a create that failed for a reason nobody has established is not a
   * create that quietly succeeded elsewhere.
   */
  private async createdFor(
    context: Awaited<GuestAuth["$context"]>,
    contact: { readonly email: string; readonly name: string },
  ): Promise<{ readonly id: string } | null> {
    try {
      return await context.internalAdapter.createUser({
        email: contact.email,
        name: contact.name,
        // Unverified for the width of the next statement only. The address is
        // proven by `/verify-email` rather than asserted here, so that the same
        // call both records the proof and issues the session — and so that
        // whatever rolls back leaves an account in the state the library's own
        // verification would have left it in.
        emailVerified: false,
      });
    } catch (error) {
      if (addressWasTakenMeanwhile(error)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * The mail's proof, redeemed at the realm's own verification door.
   *
   * The message went to this address and its link was followed from that
   * mailbox, which is exactly what a verification email asks an address to
   * demonstrate — so the token below stands for a round trip that has already
   * happened, and it is minted and spent inside this call rather than sent
   * anywhere. `/verify-email` marks the address verified and, because
   * `autoSignInAfterVerification` is on, creates the session and composes the
   * cookies that carry it.
   *
   * An empty list means the library declined to sign the guest in, and it is
   * returned rather than thrown. Throwing would roll the link's spend back and
   * send the guest to press it again — but the account exists by then, so the
   * retry takes the registered-address path and ends with no session either
   * way, having also lost the attach. `guest-attach.internal-api.spec.ts` is
   * what notices instead, before a release rather than after one.
   */
  private async verifyAndSignIn(
    context: Awaited<GuestAuth["$context"]>,
    email: string,
  ): Promise<string[]> {
    const token = await createEmailVerificationToken(context.secret, email);

    const { headers } = await this.auth.api.verifyEmail({
      query: { token },
      returnHeaders: true,
    });

    return headers.getSetCookie();
  }

  /**
   * The realm's own password policy, applied to a password the realm's own
   * sign-up route never sees.
   *
   * Read off the configured options rather than restated, so this door and
   * `/sign-up/email` cannot drift into two different floors — `contract/
   * booking.ts` says why the wire schema deliberately states neither figure.
   */
  private refusePasswordOutsidePolicy(password: string | undefined): void {
    if (password === undefined) {
      return;
    }

    const { minPasswordLength, maxPasswordLength } =
      this.auth.options.emailAndPassword;

    if (
      password.length < minPasswordLength ||
      password.length > maxPasswordLength
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: `A password is between ${minPasswordLength} and ${maxPasswordLength} characters`,
      });
    }
  }
}

/**
 * Whether a failed account creation is the unique index refusing an address that
 * already has one.
 *
 * **Read off the error rather than pre-empted with a lock**, because the read
 * and the write are on different connections by design and no lock spans them
 * cheaply. Postgres already answers this question authoritatively, at the moment
 * it matters, with `23505`.
 *
 * The chain is walked because the library wraps what the driver threw, and the
 * shape it wraps it in is the library's business rather than a contract. Being
 * generous here is safe: the caller re-reads the address and rethrows if no
 * account turns up, so mistaking some other unique violation for this one is a
 * lookup that finds nothing and the original error raised anyway.
 */
function addressWasTakenMeanwhile(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < DEEPEST_CAUSE; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }

    const raised = current as {
      readonly code?: unknown;
      readonly constraint?: unknown;
      readonly message?: unknown;
      readonly cause?: unknown;
    };

    if (
      raised.code === UNIQUE_VIOLATION ||
      raised.constraint === ONE_ACCOUNT_PER_ADDRESS ||
      (typeof raised.message === "string" &&
        raised.message.includes(ONE_ACCOUNT_PER_ADDRESS))
    ) {
      return true;
    }

    current = raised.cause;
  }

  return false;
}
