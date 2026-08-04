// The handle a guest is given and `M7` routes on — `/bookings/<reference>`.
//
// It is read down a phone line and typed off a printed confirmation, and that
// is what picks the alphabet. `0`/`O` and `1`/`I`/`L` are the pairs people
// transcribe wrongly, so none of the five are in it: a reference that cannot be
// mistyped into a *different valid* reference is worth more than the two bits
// those characters would add. What is left is 31 symbols, and eight of them
// give 8.5 × 10¹¹ references — a 40-room property will not see a second
// collision in its lifetime, and the first one is handled anyway.
//
// **Uniqueness is not this file's claim to make.** `schema/booking.ts` declares
// `reference` as `text().notNull().unique()`, and that index is what actually
// guarantees two bookings never answer to one address — a check-then-insert
// here would race two concurrent funnel sessions and lose. So this generates,
// the database adjudicates, and the caller retries on the unique violation.
// `retryOnCollision` below is that loop, with no knowledge of what it is
// inserting into.
//
// The format is deliberately not pinned in the schema. `schema/booking.ts` says
// why: a column that encoded the shape would make changing it a migration that
// has to rewrite every historical row.

import { randomInt } from "node:crypto";

/**
 * The 31 symbols a reference is built from — digits `2`–`9` and the letters,
 * less `I`, `L` and `O`.
 *
 * `0` and `1` are absent for the same reason their letter twins are. Keeping
 * one of each pair would not help: the confusion is symmetric, and a guest
 * reading `O` aloud produces `0` as often as the reverse.
 */
export const BOOKING_REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Symbols per group. Two groups of four, split by a hyphen — `K7QX-2M9P`. */
export const BOOKING_REFERENCE_GROUP_SIZE = 4;

/**
 * The shape, built from the alphabet above so the two cannot drift.
 *
 * Exported because `M7` routes on it: a request for `/bookings/hello` is a
 * reference that was never issued, and answering it from the shape costs
 * nothing where answering it from the database costs a query per crawler.
 */
export const BOOKING_REFERENCE_PATTERN = new RegExp(
  `^[${BOOKING_REFERENCE_ALPHABET}]{${BOOKING_REFERENCE_GROUP_SIZE}}-` +
    `[${BOOKING_REFERENCE_ALPHABET}]{${BOOKING_REFERENCE_GROUP_SIZE}}$`,
);

/** Whether a string could be a reference this generator issued. */
export function isBookingReference(value: string): boolean {
  return BOOKING_REFERENCE_PATTERN.test(value);
}

/**
 * Picks one index below `bound`, uniformly.
 *
 * `randomInt` and not `Math.random`: the modulo bias a naïve pick introduces
 * would favour the front of a 31-symbol alphabet, which narrows the space the
 * comment at the top of this file just finished counting.
 */
export type RandomIndex = (bound: number) => number;

/**
 * A fresh reference. Not checked for uniqueness — see the note above.
 *
 * The source of randomness is a parameter so the spec can assert an exact
 * string rather than a shape. Production never passes it.
 */
export function generateBookingReference(
  randomIndex: RandomIndex = randomInt,
): string {
  const symbols = Array.from(
    { length: BOOKING_REFERENCE_GROUP_SIZE * 2 },
    () => BOOKING_REFERENCE_ALPHABET[randomIndex(BOOKING_REFERENCE_ALPHABET.length)],
  );

  return `${symbols.slice(0, BOOKING_REFERENCE_GROUP_SIZE).join("")}-${symbols
    .slice(BOOKING_REFERENCE_GROUP_SIZE)
    .join("")}`;
}

/**
 * How many references one insert will try before giving up.
 *
 * Three, because the second attempt already implies something other than
 * chance — at this alphabet the odds of one collision are negligible and of two
 * in a row are not worth a number. A loop that tried harder would spend its
 * retries on the real cause, which is a unique index doing its job against a
 * bug somewhere else.
 */
export const BOOKING_REFERENCE_ATTEMPTS = 3;

/**
 * Runs `insert` with a fresh reference, retrying while it reports a collision.
 *
 * The two callbacks keep this ignorant of Drizzle and of Postgres error codes:
 * the caller knows that `23505` on `booking_reference_unique` is a collision
 * and that `23503` is a missing room type, and only it can tell them apart.
 * Handing this an error matcher rather than a table is what stops a retry loop
 * from silently swallowing a foreign-key failure as bad luck.
 */
export async function retryOnCollision<T>(
  insert: (reference: string) => Promise<T>,
  isCollision: (error: unknown) => boolean,
  randomIndex: RandomIndex = randomInt,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < BOOKING_REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      return await insert(generateBookingReference(randomIndex));
    } catch (error) {
      if (!isCollision(error)) throw error;
      lastError = error;
    }
  }

  // Rethrown rather than wrapped in a friendlier message: three collisions is
  // not a booking problem, and a caller that sees the driver's own error can
  // find the index that refused it.
  throw lastError;
}
