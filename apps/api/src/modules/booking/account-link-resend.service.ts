// Sending a stay's account link again, because somebody at the property was
// asked to.
//
// ## The hole this fills
//
// A guest who booked anonymously holds two ways back into their stay: the
// booking cookie, and the confirmation email. Lose both and there is nothing
// left — `scopedTo` opens a stay to an anonymous caller by the booking id in
// that cookie and by nothing else, and a booking reference alone deliberately
// opens nothing, because a reference is eight characters printed on a page
// anybody may be holding. That refusal is correct and this does not soften it.
// What it does is give the one recourse the guest already had — ringing the
// property — an outcome other than an apology.
//
// ## Why the desk, and what being behind staff auth changes
//
// A guest-facing "send it to me again" was considered and rejected. It would
// mail an address the caller may not own, because anyone can take an
// unauthenticated hold naming a victim, and it would have to answer identically
// in every case or become an account-enumeration oracle. Behind staff auth both
// problems dissolve. The caller is authenticated and can already read the
// booking, so **this answers honestly**: telling a receptionist that a stay
// already belongs to an account, or that its address already has one, is useful
// at the counter and leaks nothing they could not read on the screen in front of
// them. There is no uniform-response machinery here and there should not be.
//
// The identity check is a human at a desk asking who somebody is. That is the
// only check left once every credential is gone, and it is the real strength of
// this flow rather than a weakness of it — with one accepted cost, that a member
// of staff can be talked into it by a convincing telephone call. Three things
// answer that: the mail says the property was asked and tells a guest who was
// not on that call to ring in, the act is filed against the member of staff who
// caused it, and the link creates an account for the address already on the
// booking and no other.
//
// ## The address is the booking's, and the desk cannot redirect it
//
// **No caller of this ever names where the mail goes.** It is read off
// `contact_email`, the same shape `guest-attach.service.ts` reads it in and for
// a sharper reason here: a resend that accepted an address would be a way to
// hand somebody else's stay to whatever mailbox a caller on the telephone
// recited, and the account the link then creates would own that stay outright.
// Changing which address a stay writes to is a separate act with its own
// authority and its own audit trail; folding it into this one would mean every
// use of this route silently carried that authority too.
//
// ## What happens to a link that is already outstanding
//
// Nothing, and that is `booking-token.service.ts`'s existing rule rather than a
// decision taken here. `mintLink` inserts a row; it updates none. So a link
// minted by the confirmation an hour ago and never followed stays live for the
// rest of its hour, and both links open the same stay for the same address —
// following either creates the one account and attaches the one booking, and the
// conditional update that spends a link then leaves the other pointing at a stay
// whose anonymous access has been given up, which `liveLink` refuses. Two live
// links are therefore two spellings of one offer and not two capabilities, which
// is why a resend does not have to revoke anything to be safe.

import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { eq } from "drizzle-orm";
import { ENV, type Env } from "../../config/env.js";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { afterCommit } from "../../database/transaction-runner.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import { accountForAddress } from "../auth/guest/registered-address.js";
import { AccountLinkMailService } from "../notification/account-link-mail.service.js";
import { accountLinkUrl } from "./mailed-link-urls.js";

/** What the desk is told: where the message went, and about which stay. */
export interface ResentAccountLink {
  readonly to: string;
  readonly reference: string;
}

@Injectable()
export class AccountLinkResendService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly bookingTokens: BookingTokenService,
    private readonly mail: AccountLinkMailService,
  ) {}

  /**
   * Mints an account link for this stay and hands the message over.
   *
   * **Takes the caller's executor, like every other write here.** The link row,
   * the change-log entry that says who caused it and the read that decided it
   * was allowed are one commit — an entry on another connection would survive a
   * rollback and record a link nobody was ever sent, and a link that committed
   * without one would be mail to a guest with nobody's name against it. The
   * entry is filed by the trigger on `booking_link` as the row is inserted, so
   * the three are one commit by construction rather than by this method
   * remembering to make them one. A resend is mail sent to a guest's address on
   * a member of staff's say-so, which is exactly the act `FR-AUD-01` exists for,
   * and it is filed against whoever the access guard resolved rather than
   * against anything the request could have named.
   *
   * **The message is handed over after that commit and not inside it.** The
   * credential it carries is a row, and a message enqueued from inside the
   * transaction would survive a rollback and advertise a link that no longer
   * exists. `announce` in `booking.service.ts` draws the same line for the same
   * reason.
   *
   * Four refusals, each naming itself, because the caller is a member of staff
   * who has to say something to a guest: no such stay, no address to write to,
   * the stay already has an owner, and the address already has an account.
   */
  async resend(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<ResentAccountLink> {
    const stay = await this.stayFor(exec, bookingId);
    const link = await this.bookingTokens.mintAccountLink(exec, { bookingId });

    const message = {
      to: stay.contactEmail,
      guestName: stay.contactName,
      reference: stay.reference,
      createAccountUrl: accountLinkUrl(
        this.env.WEB_ORIGIN,
        stay.reference,
        link,
      ),
    };

    await afterCommit(exec, () => this.mail.enqueue(message));

    return { to: stay.contactEmail, reference: stay.reference };
  }

  /**
   * The stay this may be sent for, or the sentence saying why it may not.
   *
   * Read and decided in one place, so there is no order in which a link could be
   * minted for a stay one of these would have refused.
   *
   * `anon_access_revoked_at` is checked as well as `user_id`, and they are not
   * the same question asked twice: the column pair is what
   * `booking_revokes_anonymous_access_only_with_an_account` keeps honest, and
   * `liveLink` refuses a link for a revoked stay outright — so minting one would
   * be mailing a guest a credential that is dead before it is sent.
   */
  private async stayFor(exec: DbExecutor, bookingId: string) {
    const [row] = await exec
      .select({
        reference: booking.reference,
        contactEmail: booking.contactEmail,
        contactName: booking.contactName,
        userId: booking.userId,
        anonAccessRevokedAt: booking.anonAccessRevokedAt,
      })
      .from(booking)
      .where(eq(booking.id, bookingId))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "There is no booking with that id",
      });
    }

    if (row.contactEmail === null || row.contactName === null) {
      // The desk's own bookings are the ordinary case: a walk-in is somebody at
      // the counter and there was nowhere to write. Taking the address now is
      // the contact route's act, not this one's.
      throw new ORPCError("CONFLICT", {
        message:
          "This booking has no contact email, so there is nowhere to send an account link. Record the guest's address on the booking first.",
      });
    }

    if (row.userId !== null || row.anonAccessRevokedAt !== null) {
      throw new ORPCError("CONFLICT", {
        message:
          "This booking already belongs to a guest account. Ask the guest to sign in, or to reset their password from the address on the booking.",
      });
    }

    if (await accountForAddress(exec, row.contactEmail)) {
      // Honest, and safe to be honest: the caller is a member of staff who can
      // already read this booking, and the answer is the one that helps them —
      // there is nothing to create, so what the guest needs is a sign-in.
      throw new ORPCError("CONFLICT", {
        message:
          "There is already an account for the address on this booking. Ask the guest to sign in, or to reset their password from that address.",
      });
    }

    return {
      reference: row.reference,
      contactEmail: row.contactEmail,
      contactName: row.contactName,
    };
  }
}
