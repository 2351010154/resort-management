// The guest's own record of themselves — `FR-GST-01`.
//
// One read and one write, and the read is four questions rather than one
// because a profile is four different kinds of fact wearing one shape:
//
// - the **account**, from `guest_user`: the id, the address it signs in with,
//   and the day it was opened;
// - the guest's **own claim** about themselves, from `guest_user_profile`, which
//   is the only part {@link GuestProfileService.updateProfile} can touch;
// - the **property's** record of them, from `guest` — the CCCD, masked, read
//   through the one implementation of the mask and never writable from here;
// - two **derived** figures, §7's tier and the ledger's balance, each computed
//   by the service that owns it.
//
// **Nothing here writes outside `guest_user_profile`, and that is the
// requirement rather than a property of this implementation.** `FR-GST-01`'s
// edits are feed-forward: they prefill the next booking and the next check-in
// and never rewrite a registration, a booking, a folio or an invoice.
// `schema/guest-profile.ts` argues at length why that is a table shape instead
// of a rule — the statutory residence record denormalises nothing, so its
// append-only guarantee is only as strong as the immutability of the `guest` row
// it points at, and a subject who could edit that row would leave every
// registration byte-identical and meaning somebody else.
//
// **The whole read is the caller's one transaction.** `database.module.ts`'s
// boundary, and it earns its keep here: the tier is derived from stays inside a
// trailing window and the balance is summed off the ledger those same stays
// wrote, so read on two connections they could straddle a folio close and show a
// guest points for a stay the ladder had not counted yet.
//
// ## Which CCCD a guest is shown, and why it is a proxy
//
// The number comes off the `guest` row registered as the holder on the most
// recent stay this account booked. There is no verified link between an account
// and a guest record — `schema/guest.ts` declined to put one on every walk-in,
// and `schema/guest-profile.ts` keys the other way round — so `booking.user_id`
// is the only bridge there is, and it proves who *booked* rather than who
// stayed. A guest who books for a parent would be shown the parent's masked
// number.
//
// That is tolerable exactly because it is masked. `FR-GST-03`'s threat model is
// staff reading guests' numbers, which is why unmasking is a separate capability
// audited per call; four digits echoed to the person who booked the room
// discloses nothing an investigation counts. Nothing here writes to
// `cccd_unmask_audit`, and it must not: this is not an unmask, and the trail is
// `NOT NULL` against a `staff_user` who did not do anything.
//
// The editable fields are deliberately *not* filled in from the same place, and
// the asymmetry is the point. A masked number is read-only and discloses four
// digits; a birthday and a nationality prefilled off somebody else's document
// would be that person's data presented to this account as its own, in a box it
// could then edit — and an edit that looked like a correction of the desk's
// record while writing somewhere else entirely is the confusion the feed-forward
// rule exists to prevent. An account that has declared nothing gets the name it
// registered under and nulls.

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { guest, registration } from "../../database/schema/guest.js";
import { guestUser } from "../../database/schema/index.js";
import {
  guestUserProfile,
  type GuestUserProfileRow,
} from "../../database/schema/guest-profile.js";
import { maskCccd } from "./cccd-mask.js";
import { LoyaltyService } from "./loyalty.service.js";
import type { DerivedTier } from "./tier-derivation.service.js";
import { TierDerivationService } from "./tier-derivation.service.js";

/** A guest as `GET /profile` answers them about themselves. */
export interface GuestProfile {
  /** The account. Better Auth's own base-62 text, never a uuid. */
  readonly id: string;
  readonly fullName: string;
  readonly phone: string | null;
  /** The address the account signs in with. Changed through the realm's own
   *  re-verification flow and never through this service. */
  readonly email: string;
  readonly dateOfBirth: StayDate | null;
  readonly nationality: string | null;
  /** The property's record of them, masked — see the header on whose number
   *  this is when a guest books for somebody else. Never the number itself. */
  readonly cccdMasked: string | null;
  readonly vipTier: DerivedTier;
  readonly loyaltyPoints: bigint;
  /** When the account was opened, not when the profile row was written. */
  readonly createdAt: Date;
}

/**
 * The four fields a guest may change about themselves.
 *
 * Absent means "leave it alone" and `null` means "clear it", which is what makes
 * the route a `PATCH` — `contract/guest.ts` argues the pair. The distinction is
 * carried in the type rather than collapsed to a nullable, because collapsing it
 * would make a screen that edits a phone number clear the birthday beside it.
 */
export interface ProfileEdit {
  readonly fullName?: string | null;
  readonly phone?: string | null;
  readonly dateOfBirth?: StayDate | null;
  readonly nationality?: string | null;
}

/** What an upsert actually sets, once the untouched fields are dropped. */
type ProfileColumns = Partial<{
  fullName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
}>;

@Injectable()
export class GuestProfileService {
  constructor(
    private readonly tiers: TierDerivationService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /**
   * Everything a guest is shown about themselves.
   *
   * Takes the account off the caller — which is the session, resolved by the
   * guard — so there is no id to compare and no ownership check to forget. The
   * route has no path segment a caller could put somebody else's account in;
   * `contract/guest.ts` says why that is the security claim rather than a
   * convenience.
   *
   * A `404` when the account is gone. Unreachable behind a live session, and
   * stated because the alternative is a null reaching the shape below and a
   * profile answering for nobody.
   */
  async readProfile(exec: DbExecutor, userId: string): Promise<GuestProfile> {
    const [account] = await exec
      .select({
        id: guestUser.id,
        name: guestUser.name,
        email: guestUser.email,
        createdAt: guestUser.createdAt,
      })
      .from(guestUser)
      .where(eq(guestUser.id, userId))
      .limit(1);

    if (!account) {
      throw new ORPCError("NOT_FOUND", {
        message: "No account with that id",
      });
    }

    const [declared] = await exec
      .select()
      .from(guestUserProfile)
      .where(eq(guestUserProfile.userId, userId))
      .limit(1);

    return {
      id: account.id,
      // The account's registered name is the fallback and is never copied into
      // the profile row — `schema/guest-profile.ts` argues why a `NOT NULL`
      // there would be satisfied by a copy nobody could tell from a claim.
      fullName: declared?.fullName ?? account.name,
      phone: declared?.phone ?? null,
      email: account.email,
      dateOfBirth: asStayDate(declared),
      nationality: declared?.nationality ?? null,
      cccdMasked: maskCccd(await this.cccdOnFile(exec, userId)),
      vipTier: await this.tiers.deriveTier(exec, userId),
      loyaltyPoints: await this.loyalty.balance(exec, userId),
      createdAt: account.createdAt,
    };
  }

  /**
   * The guest correcting what the property will use next time.
   *
   * An upsert on the account, because the row is created by the first edit and
   * nothing seeds one: a guest who has never opened the screen has no row, and a
   * write that assumed one would fail on the account's very first save. The
   * conflict target is the primary key, so two saves racing produce one row
   * rather than a unique violation somebody has to catch.
   *
   * **Only the fields that arrived are written.** An edit carrying a phone
   * number leaves the birthday alone, and the `set` below is built from what was
   * sent rather than from the whole shape — a spread of `undefined`s would clear
   * three fields for every one a screen saved.
   *
   * An edit that changes nothing writes nothing, including no `updated_at`. The
   * empty `set` is not merely wasteful: `on conflict do update set` with nothing
   * to set is not a statement Postgres will take, and a row stamped as edited
   * when nobody edited it is a lie the column is there to avoid telling.
   *
   * The profile is read back afterwards, in the same transaction, so the caller
   * gets the derived tier and the balance beside the fields it just wrote and no
   * screen has to fetch the page twice.
   */
  async updateProfile(
    exec: DbExecutor,
    userId: string,
    edit: ProfileEdit,
  ): Promise<GuestProfile> {
    const columns = changed(edit);

    if (Object.keys(columns).length > 0) {
      await exec
        .insert(guestUserProfile)
        .values({ userId, ...columns })
        .onConflictDoUpdate({
          target: guestUserProfile.userId,
          set: { ...columns, updatedAt: new Date() },
        });
    }

    return await this.readProfile(exec, userId);
  }

  /**
   * The number the property holds for whoever this account last registered as
   * the holder of a stay.
   *
   * One statement, and a read: the plain number is selected because computing
   * the mask needs it and it reaches no further than the caller's `maskCccd`.
   * Ordered by the registration rather than by the stay's dates — what is wanted
   * is the most recently *taken* document, and a guest checking in late for an
   * earlier booking registered it later.
   *
   * `is_primary`, so it is the booking holder rather than whichever occupant the
   * desk typed second. `registration_one_primary_per_booking_key` allows exactly
   * one per stay, so the join cannot multiply.
   *
   * Null for an account that has never checked in anywhere, which is most of
   * them: a booking is not a registration, and the property has taken no
   * document until somebody stands at the desk.
   */
  private async cccdOnFile(
    exec: DbExecutor,
    userId: string,
  ): Promise<string | null> {
    const [held] = await exec
      .select({ cccdNumber: guest.cccdNumber })
      .from(registration)
      .innerJoin(booking, eq(booking.id, registration.bookingId))
      .innerJoin(guest, eq(guest.id, registration.guestId))
      .where(and(eq(booking.userId, userId), eq(registration.isPrimary, true)))
      .orderBy(desc(registration.registeredAt))
      .limit(1);

    return held?.cccdNumber ?? null;
  }
}

/**
 * The birthday as the application holds it.
 *
 * `NFR-12`: a date crossing this boundary is a `CalendarDate`, and the string is
 * storage's business. A birthday read as an instant moves by a day in UTC+7,
 * which is the same off-by-one `stay-date.ts` exists to stop and is harder to
 * spot on a date nobody counts nights from.
 */
function asStayDate(row: GuestUserProfileRow | undefined): StayDate | null {
  return row?.dateOfBirth === undefined || row.dateOfBirth === null
    ? null
    : parseDate(row.dateOfBirth);
}

/**
 * The edit, reduced to the columns it actually names.
 *
 * `undefined` is the absence and `null` is the clearing, and the two cannot be
 * confused on the way in: JSON carries no `undefined`, so a key with that value
 * is a key that was not sent. Written out field by field rather than looped,
 * because the set of writable columns is the whole of what this file authorises
 * and a loop over `Object.entries` would authorise whatever arrived — the
 * contract's strict schema refuses an unknown key first, and this is the same
 * refusal stated where the write happens.
 */
function changed(edit: ProfileEdit): ProfileColumns {
  const columns: ProfileColumns = {};

  if (edit.fullName !== undefined) {
    columns.fullName = edit.fullName;
  }

  if (edit.phone !== undefined) {
    columns.phone = edit.phone;
  }

  if (edit.dateOfBirth !== undefined) {
    // The one field that changes shape on the way down: a `CalendarDate` in the
    // application and ISO text in a `date` column.
    columns.dateOfBirth = edit.dateOfBirth?.toString() ?? null;
  }

  if (edit.nationality !== undefined) {
    columns.nationality = edit.nationality;
  }

  return columns;
}
