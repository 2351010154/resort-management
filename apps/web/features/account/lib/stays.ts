// Every stay this account has taken — `GET /bookings/mine`.
//
// One call and no second door: `contract/booking.ts` gives the guest's history a
// route that names no stay, and it is the one guest read a booking token is
// refused on — a credential scoped to one booking must not enumerate the others.
// So the only thing that opens this is the session, which the cookie on the
// request carries.
//
// It resolves rather than throws, in `booking-links.ts`'s shape: a guest with no
// session and a guest with no stays are two different answers, and only the
// first is a sentence to show.

import { api, apiMessage } from "@/lib/api";

/**
 * A stay as the API answers it, inferred from the client rather than written
 * out — the contract types both ends, so a field that changes shape breaks this
 * screen in the pull request that changed it.
 */
export type OwnStay = Awaited<ReturnType<typeof api.booking.listOwn>>[number];

export type StaysOutcome =
  | { readonly ok: true; readonly stays: readonly OwnStay[] }
  | { readonly ok: false; readonly message: string };

const REFUSED =
  "Your stays could not be read just now. Check your connection and try again.";

export async function readStays(): Promise<StaysOutcome> {
  try {
    return { ok: true, stays: await api.booking.listOwn() };
  } catch (error) {
    return { ok: false, message: apiMessage(error, REFUSED) };
  }
}
