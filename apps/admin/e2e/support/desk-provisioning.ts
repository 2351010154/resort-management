import { createApiClient } from "@mariva/api-client";
import type { RoomTypeCode } from "@mariva/shared";
import { expect } from "@playwright/test";

import {
  type Arrival,
  todaysArrivals,
} from "@/features/arrivals/arrival-queue";
import { arrivalCriteria, shiftDate } from "@/features/dashboard/day-counts";
import {
  balanceDue,
  type Departure,
  todaysDepartures,
} from "@/features/departures/departure-queue";

/* The property a queue spec needs, put there before the spec looks.
 *
 * Four of these runs walk a real queue — two arrivals to arrow between, a
 * departure with something still to collect — and until this file existed they
 * took whatever the seed happened to leave on the day they were executed. The
 * seed spreads five hundred stays across a year, about one and a half arrivals
 * a day, so an ordinary date yields one arrival and no departure at all and the
 * runs stopped at "The queue on this screen is empty". A suite whose result
 * depends on which morning it is run on is not a gate, and the failures it
 * produces are evidence about the calendar rather than about the console.
 *
 * ## Provisioned, not faked
 *
 * Nothing here writes to the database and nothing here stubs a response. Every
 * row below is created through the same routes the desk uses — a stay is sold
 * at `POST /bookings`, a guest is sent home early at
 * `POST /bookings/{id}/early-departure`, a charge is posted to a folio — over
 * the console's own {@link createApiClient}. So the queue the spec then walks
 * is a queue the property actually has, priced and constrained exactly as one
 * taken at the counter, and the console is told nothing.
 *
 * The counting is the console's too: {@link todaysArrivals},
 * {@link todaysDepartures} and {@link balanceDue} are the functions the screens
 * themselves cut their queues with. A provisioner with its own idea of what
 * counts as an arrival could satisfy itself while leaving the screen empty.
 *
 * ## Top up, never reset
 *
 * Each function below asks what the property already has and adds only the
 * difference, so a spec that runs against a freshly seeded database and a spec
 * that runs after the one before it consumed a row both get what they asked
 * for, and a re-run does not accumulate.
 *
 * ## The one thing this cannot provision
 *
 * A stay departing today had to arrive before today, and the desk's own door
 * refuses that: `POST /bookings` answers *"A stay cannot arrive on
 * 2026-08-29, which is before the business date 2026-08-30"*, and shortening a
 * stay to the day it arrived is refused too — a booking covers at least one
 * night. So a departure can only be made out of somebody already in the
 * building, by moving their departure forward, which is what a desk does when a
 * guest leaves early. {@link ensureDeparturesOwing} says so by name when the
 * property has nobody left to ask.
 */

/** Where the API answers. The console's origin is `playwright.config.ts`'s. */
const API_URL = process.env.ADMIN_E2E_API_URL ?? "http://localhost:3001";

/**
 * What a provisioned stay owes, in đồng.
 *
 * Any amount above nothing would do — the checkout sequence asks whether the
 * account is short, not by how much — so this is a plausible incidental rather
 * than a figure anything depends on.
 */
const INCIDENTAL_VND = 500_000n;

/** How the provisioned rows are recognisable in the ledger afterwards. */
const PROVISIONED_BY = "Provisioned for the console keyboard run";

interface Desk {
  readonly api: ReturnType<typeof createApiClient>;
  /** The property's day, resolved by the API and never by this process. */
  readonly businessDate: string;
}

/**
 * At least `atLeast` stays waiting to be checked in on the property's day, each
 * with a deposit outstanding.
 *
 * Each one is sold as a type the board still has a clean, empty room of, so the
 * check-in the spec then walks has somewhere to put the guest. A type that
 * turns out to be sold out for the night is refused by the API and the next
 * type is tried, which is what a receptionist does with the same refusal.
 *
 * The deposit is the reason the account is left short. `sequenceSteps` drops the
 * deposit step for a stay that owes nothing, so a run against arrivals that
 * happened to be settled would walk a shorter check-in and prove nothing about
 * the one control in it with no default — how the money arrived. Left owing, the
 * run walks the whole sequence.
 */
export async function ensureArrivalsWaiting(atLeast: number): Promise<void> {
  const desk = await openDesk();

  let waiting = await arrivalsWaiting(desk);

  while (waiting.length < atLeast) {
    await sellAStayArrivingToday(desk);

    const grown = await arrivalsWaiting(desk);

    expect(
      grown.length,
      `A stay was sold arriving on ${desk.businessDate} but the arrivals queue did not grow.`,
    ).toBeGreaterThan(waiting.length);

    waiting = grown;
  }

  for (const stay of waiting) {
    await leaveSomethingToCollect(desk, stay.id);
  }
}

/**
 * At least `atLeast` stays due out on the property's day, every one of them
 * with something still to collect.
 *
 * The balance is the point rather than a detail: a settled account skips the
 * step where the operator says how the money arrived, and that step is the one
 * control in the checkout with no default and therefore the one a keyboard-only
 * run has to prove reachable.
 */
export async function ensureDeparturesOwing(atLeast: number): Promise<void> {
  const desk = await openDesk();

  let leaving = await departuresLeaving(desk);

  while (leaving.length < atLeast) {
    await sendSomebodyHomeEarly(desk);

    const grown = await departuresLeaving(desk);

    expect(
      grown.length,
      `A stay was moved to depart on ${desk.businessDate} but the departures queue did not grow.`,
    ).toBeGreaterThan(leaving.length);

    leaving = grown;
  }

  for (const stay of leaving) {
    await leaveSomethingToCollect(desk, stay.id);
  }
}

/** A signed-in desk, and the day the API says the property is working. */
async function openDesk(): Promise<Desk> {
  const email = process.env.ADMIN_E2E_EMAIL ?? "";
  const password = process.env.ADMIN_E2E_PASSWORD ?? "";

  expect(
    email,
    "Provisioning needs the same staff account the run signs in with — set ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD.",
  ).not.toBe("");

  const response = await fetch(`${API_URL}/auth/staff/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  expect(
    response.status,
    `The API refused the run's staff account: ${await response.clone().text()}`,
  ).toBe(200);

  const { accessToken } = (await response.json()) as { accessToken: string };
  const api = createApiClient({ url: API_URL, staffToken: () => accessToken });

  // The board carries the resolved business date, which is the same request the
  // console makes for the same reason: the day is the property's, cut against
  // `system_config.business_date_rollover_hour`, and never this machine's clock.
  const board = await api.housekeeping.board({});

  return { api, businessDate: board.businessDate };
}

/** The arrivals queue, as the arrivals screen itself would cut it. */
async function arrivalsWaiting(desk: Desk): Promise<readonly Arrival[]> {
  const results = await desk.api.search.operational(
    arrivalCriteria(desk.businessDate),
  );
  const queue = todaysArrivals(results, desk.businessDate);

  expect(
    queue,
    "The search answered a narrowed scope, so this account cannot see stays at all.",
  ).not.toBeNull();

  return queue?.arrivals ?? [];
}

/** The departures queue, as the departures screen itself would cut it. */
async function departuresLeaving(desk: Desk): Promise<readonly Departure[]> {
  const queue = todaysDepartures(
    await desk.api.search.operational(inHouseTonight(desk)),
    desk.businessDate,
  );

  expect(
    queue,
    "The search answered a narrowed scope, so this account cannot see stays at all.",
  ).not.toBeNull();

  return queue?.departures ?? [];
}

/**
 * Everybody checked in whose stay touches tonight.
 *
 * A window of one night rather than the departures card's `[yesterday, today)`,
 * because this answers two questions at once: who is leaving today, and who is
 * still in the building tomorrow and could therefore be asked to leave today.
 * The screens' own filter picks the first set out of it.
 */
function inHouseTonight(desk: Desk) {
  return {
    state: "CHECKED_IN" as const,
    from: shiftDate(desk.businessDate, -1),
    to: shiftDate(desk.businessDate, 1),
  };
}

/**
 * One stay sold to arrive today, in a type the property can actually house.
 *
 * The board is read fresh each time: the type with the most clean, empty rooms
 * before this sale is not necessarily the one after it.
 */
async function sellAStayArrivingToday(desk: Desk): Promise<void> {
  const refusals: string[] = [];

  for (const roomType of await typesWithARoomToSpare(desk)) {
    try {
      await desk.api.booking.createConfirmed({
        roomType,
        checkIn: desk.businessDate,
        checkOut: shiftDate(desk.businessDate, 1),
        plan: "STANDARD",
        adults: 1,
        contactName: PROVISIONED_BY,
      });
      return;
    } catch (refusal) {
      // A type the property has a clean room of can still be sold out for the
      // night — the room is free tonight and the type is not. That is an
      // ordinary answer, and the next type is what a desk tries.
      refusals.push(`${roomType}: ${describe(refusal)}`);
    }
  }

  throw new Error(
    `No room type could be sold for ${desk.businessDate}, so the arrivals queue cannot be provisioned. ${refusals.join(" | ")}`,
  );
}

/** Room types the board has a clean, unoccupied room of, most first. */
async function typesWithARoomToSpare(desk: Desk): Promise<RoomTypeCode[]> {
  const board = await desk.api.housekeeping.board({});
  const spare = new Map<RoomTypeCode, number>();

  for (const room of board.rooms) {
    if (room.isReady && !room.isOccupied) {
      spare.set(room.roomType, (spare.get(room.roomType) ?? 0) + 1);
    }
  }

  expect(
    [...spare.keys()],
    "The property has no clean, empty room of any type, so no arrival could be housed.",
  ).not.toEqual([]);

  return [...spare.entries()]
    .sort(([, left], [, right]) => right - left)
    .map(([roomType]) => roomType);
}

/**
 * One guest already in the building asked to leave today instead.
 *
 * The stay with the earliest departure, because that is the guest a desk would
 * actually be having this conversation with, and because it releases the fewest
 * nights back to the calendar.
 */
async function sendSomebodyHomeEarly(desk: Desk): Promise<void> {
  const results = await desk.api.search.operational(inHouseTonight(desk));

  const stillHere =
    results.scope === "everything"
      ? results.bookings
          .filter(
            (stay) =>
              stay.state === "CHECKED_IN" &&
              // Somebody who slept here: a booking covers at least one night, so
              // a guest who arrived this morning cannot be asked to leave today
              // and the API refuses it in those words.
              stay.checkIn < desk.businessDate &&
              stay.checkOut > desk.businessDate,
          )
          .sort((left, right) => left.checkOut.localeCompare(right.checkOut))
      : [];

  const leaving = stillHere[0];

  expect(
    leaving,
    `Nobody in the building can have their departure brought forward to ${desk.businessDate}, and a stay departing today cannot be created from nothing — the desk refuses an arrival dated before the business date. Seed the database before this run.`,
  ).toBeDefined();

  if (leaving === undefined) {
    return;
  }

  await desk.api.booking.shortenStay({
    bookingId: leaving.id,
    checkOut: desk.businessDate,
  });
}

/** A charge on the account, unless the guest already owes something. */
async function leaveSomethingToCollect(
  desk: Desk,
  bookingId: string,
): Promise<void> {
  if (await alreadyOwesSomething(desk, bookingId)) {
    return;
  }

  // The charge opens the account when the stay has none, which is how a stay
  // nobody has posted anything to yet gets one.
  await desk.api.folio.postCharge({
    bookingId,
    // Whole đồng as decimal text, which is how an amount travels: `money.ts`
    // codes a `bigint` onto the wire as a string and back off it.
    grossAmount: INCIDENTAL_VND.toString(),
    description: `Minibar — ${PROVISIONED_BY}`,
  });
}

/**
 * Whether the account is already short.
 *
 * A stay nobody has posted anything to has no account at all, and the route says
 * so rather than answering an empty one — which is the ordinary condition of a
 * confirmed arrival, not a failure.
 */
async function alreadyOwesSomething(
  desk: Desk,
  bookingId: string,
): Promise<boolean> {
  try {
    return balanceDue(await desk.api.folio.read({ bookingId })) > 0n;
  } catch {
    return false;
  }
}

/** Whatever the API said, for a message the next person can act on. */
function describe(refusal: unknown): string {
  return refusal instanceof Error ? refusal.message : String(refusal);
}
