// The promotion a booking froze, as the pricing arithmetic takes it.
//
// `schema/booking.ts` stores it as three nullable columns held together by
// `booking_quoted_promotion_is_whole_or_absent`, and `@mariva/shared` takes it
// as one nullable object. Two callers reprice a stay from the frozen row — the
// extension in `assignment.service.ts` and the night's charge in
// `room-charge-sweep.ts` — and both have to make the same translation.
//
// It matters that they make the *same* one. A caller that read the columns and
// forgot the promotion would recompute a stay at the undiscounted room rate:
// the extension would raise a total the guest had agreed, and the sweep would
// post a folio line that does not match the booking it belongs to. Neither
// failure raises anything — both produce a plausible number — so the
// translation is written once, here, rather than trusted to two call sites.
//
// Two arguments rather than a row, because the two callers select the columns
// under names of their own and neither should have to rename a field to satisfy
// this signature.

import type { PromotionType, QuotedPromotion } from "@mariva/shared";

/**
 * The frozen pair as a promotion, or null when the booking carries none.
 *
 * The constraint on the table means these are null together or set together, so
 * the check below is one question rather than two. It is still asked of both,
 * because a caller selecting only one of them would otherwise get a promotion
 * with a missing half and a `value` of `null` reaching the arithmetic as zero.
 */
export function quotedPromotion(
  type: PromotionType | null,
  value: bigint | null,
): QuotedPromotion | null {
  return type === null || value === null ? null : { type, value };
}
