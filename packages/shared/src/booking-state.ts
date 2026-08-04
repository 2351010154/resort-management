// The lifecycle vocabulary, in one place because three layers spell it: a
// Postgres enum, the transition table the service enforces, and the wire schema
// a front-desk client reads. `booking-state-machine.md` is the authority for
// what the values mean; this file is the authority for what they are.

import { z } from "zod";

/**
 * Six states and no more — `booking-state-machine.md` §1.
 *
 * A tuple beside the schema for the reason `RATE_PLAN_CODES` is one: Postgres
 * needs an enum type built from the identical values, and deriving both from one
 * array is what stops the database and the wire from drifting.
 *
 * There is no `EXPIRED`. An abandoned hold and a guest cancellation differ in
 * reason and not in effect — both release the nights and end the booking — so
 * the reason is carried by {@link CANCELLATION_REASONS} instead of by a seventh
 * state that would double the transition table and buy nothing.
 */
export const BOOKING_STATES = [
  "HELD",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
] as const;

export const bookingStateSchema = z.enum(BOOKING_STATES);

export type BookingState = z.infer<typeof bookingStateSchema>;

/**
 * Why a booking ended without a stay — `booking-state-machine.md` §1.
 *
 * The reason drives the penalty; the state does not. `HOLD_EXPIRED` is written
 * by the TTL sweep and the other five by whoever cancelled, which is why the
 * grid in `property-and-tariff.md` §4 can charge a guest request and waive a
 * property error without either being a different state.
 */
export const CANCELLATION_REASONS = [
  "HOLD_EXPIRED",
  "GUEST_REQUEST",
  "STAFF_ERROR",
  "PAYMENT_FAILED",
  "OVERBOOK_WALK",
  "FORCE_MAJEURE",
] as const;

export const cancellationReasonSchema = z.enum(CANCELLATION_REASONS);

export type CancellationReason = z.infer<typeof cancellationReasonSchema>;
