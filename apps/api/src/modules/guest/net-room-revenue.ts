// What the property billed for rooms, net — the one definition, for the two
// things that price a guest by it.
//
// `docs/architecture/property-and-tariff.md` §7 uses the same figure twice: an
// accrual turns it into points at the folio close, and a tier ladder measures a
// guest's trailing year against it. §7 is explicit about why it is *net* — "so a
// §8 tax answer cannot silently change what a stay earns" — and `FR-GST-04`
// repeats the requirement for the ladder, "net room revenue **excludes VAT and
// service charge**, so a change to the `ASM-01` tax config cannot silently move
// tier boundaries".
//
// That guarantee is only worth as much as its narrowest implementation. Two
// copies of this sum would hold for exactly as long as nobody edited one of
// them, and the one that drifted would move tier boundaries or the earn rate
// without anything failing — a guest quietly promoted, or quietly not, on a
// figure no screen shows. So the sum lives once, here, and the callers supply
// only the scope: which folios they are asking about.
//
// **The exclusion is achieved by not selecting, never by subtracting.**
// `FR-FOL-02` decomposes a gross figure the guest agreed to into three lines,
// and `folio.service.ts` puts the **net** on the `ROOM_CHARGE` row with the
// service charge and the VAT on their own rows beside it. So `SERVICE_ITEM`,
// `SERVICE_CHARGE_FEE`, `VAT`, `POLICY_CHARGE`, `PAYMENT` and `REFUND` are
// absent from the figure because they are absent from the query. Nothing here
// does arithmetic that a rate could get into.

import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { folio, folioPosting } from "../../database/schema/folio.js";

/**
 * The `ROOM_CHARGE` a `REVERSAL` row undoes.
 *
 * A reversal says which line it took back and carries the exact negation of it,
 * so counting both kinds together is what makes an early departure and a
 * corrected night honest without a second query and without a subtraction.
 * `reverses_posting_id` is null on every other posting type, so the join matches
 * nothing for them and the predicate falls through to the posting's own type.
 */
const undone = alias(folioPosting, "undone_room_charge");

/**
 * What the folios a caller names billed for rooms, net, once corrections are
 * applied.
 *
 * `scope` is the caller's own question and the only part that differs between
 * them: an accrual names one folio by its id, and a tier derivation names a
 * guest's closed accounts over a window. Both reach `folio` and `booking`
 * because one of them has to — the joins are along `NOT NULL` keys, so they
 * narrow nothing for the caller that does not use them, and having one shape
 * here is worth more than saving a primary-key lookup there.
 *
 * A list of conditions rather than one already combined, so that a caller
 * assembling a scope out of parts hands the parts over and neither side needs
 * to assert that combining them produced something — `and()` is only optional
 * when every one of its arguments is, and the room-revenue predicate below is
 * never absent.
 *
 * Comes back as `bigint`. Postgres widens `sum(bigint)` to `numeric` and the
 * driver hands a numeric over as text, which is the one route back that cannot
 * lose a đồng; a scope matching no room line at all sums to null and answers
 * zero.
 */
export async function netRoomRevenue(
  exec: DbExecutor,
  scope: SQL[],
): Promise<bigint> {
  const [summed] = await exec
    .select({ net: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .innerJoin(folio, eq(folio.id, folioPosting.folioId))
    .innerJoin(booking, eq(booking.id, folio.bookingId))
    .leftJoin(undone, eq(undone.id, folioPosting.reversesPostingId))
    .where(
      and(
        ...scope,
        or(eq(folioPosting.type, "ROOM_CHARGE"), eq(undone.type, "ROOM_CHARGE")),
      ),
    );

  return BigInt(summed?.net ?? "0");
}
